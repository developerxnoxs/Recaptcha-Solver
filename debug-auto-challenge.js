const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const createLogger = require('./utils/logger');
const fs = require('fs').promises;

puppeteerExtra.use(StealthPlugin());

const logger = createLogger({ level: 'info' });

async function launchBrowser() {
    const execSync = require('child_process').execSync;
    let executablePath;
    
    try {
        executablePath = execSync('which chromium').toString().trim();
    } catch (e) {
        executablePath = undefined;
    }

    return await puppeteerExtra.launch({
        headless: false,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--enable-webgl',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
    });
}

async function deepInspectChallenge(frame) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const fullAnalysis = await frame.evaluate(() => {
        const analysis = {
            type: 'unknown',
            prompt: null,
            gridBased: null,
            jigsawSlider: null,
            boundingBox: null,
            allElements: {},
            domStructure: ''
        };
        
        const promptEl = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt');
        if (promptEl) {
            analysis.prompt = {
                text: promptEl.textContent.trim(),
                innerHTML: promptEl.innerHTML
            };
        }
        
        const gridTiles = document.querySelectorAll('.task-image, .challenge-image, .image-task');
        if (gridTiles.length > 0) {
            analysis.type = 'GRID_BASED';
            analysis.gridBased = {
                tileCount: gridTiles.length,
                gridSize: gridTiles.length === 9 ? '3x3' : (gridTiles.length === 16 ? '4x4' : 'unknown'),
                tiles: Array.from(gridTiles).slice(0, 3).map((tile, idx) => ({
                    index: idx,
                    className: tile.className,
                    innerHTML: tile.innerHTML.substring(0, 200),
                    hasImage: !!tile.querySelector('img'),
                    imagesSrc: tile.querySelector('img')?.src?.substring(0, 100) || 'N/A',
                    backgroundImage: window.getComputedStyle(tile).backgroundImage?.substring(0, 100) || 'none'
                }))
            };
        }
        
        const possibleJigsawElements = [
            '[class*="slider"]',
            '[class*="puzzle"]',
            '[class*="jigsaw"]',
            '[draggable="true"]',
            '[class*="piece"]',
            '[class*="drag"]',
            'canvas[class*="puzzle"]',
            '[role="slider"]',
            'input[type="range"]'
        ];
        
        const jigsawElements = [];
        possibleJigsawElements.forEach(selector => {
            const els = document.querySelectorAll(selector);
            if (els.length > 0) {
                jigsawElements.push({
                    selector: selector,
                    count: els.length,
                    elements: Array.from(els).map(el => {
                        const rect = el.getBoundingClientRect();
                        return {
                            tag: el.tagName,
                            className: el.className,
                            id: el.id || '',
                            draggable: el.draggable || false,
                            position: {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height)
                            },
                            innerHTML: el.innerHTML?.substring(0, 150) || '',
                            style: el.getAttribute('style') || ''
                        };
                    })
                });
            }
        });
        
        if (jigsawElements.length > 0) {
            analysis.type = 'JIGSAW_SLIDER';
            analysis.jigsawSlider = jigsawElements;
        }
        
        const canvases = document.querySelectorAll('canvas');
        if (canvases.length > 0) {
            analysis.boundingBox = {
                count: canvases.length,
                canvases: Array.from(canvases).map(c => ({
                    width: c.width,
                    height: c.height,
                    className: c.className,
                    id: c.id || ''
                }))
            };
            
            if (analysis.type === 'unknown') {
                analysis.type = 'BOUNDING_BOX';
            }
        }
        
        analysis.allElements = {
            allClassNames: Array.from(new Set(
                Array.from(document.querySelectorAll('[class]'))
                    .map(el => el.className)
            )).slice(0, 50),
            allIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id),
            allTags: Array.from(new Set(
                Array.from(document.querySelectorAll('*'))
                    .map(el => el.tagName.toLowerCase())
            ))
        };
        
        const container = document.querySelector('.challenge-container, .challenge-view, body');
        if (container) {
            analysis.domStructure = container.innerHTML.substring(0, 2000);
        }
        
        return analysis;
    });
    
    return fullAnalysis;
}

async function waitForChallengeFrame(page, timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const frames = page.frames();
        const challengeFrame = frames.find(f => f.url().includes('hcaptcha.com') && f.url().includes('frame=challenge'));
        
        if (challengeFrame) {
            const hasContent = await challengeFrame.evaluate(() => {
                return !!document.querySelector('.challenge-container, .prompt-text');
            }).catch(() => false);
            
            if (hasContent) {
                return challengeFrame;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return null;
}

async function main() {
    const url = 'https://nopecha.com/demo/hcaptcha';
    
    logger.info('🚀 Auto Challenge Inspector');
    logger.info(`URL: ${url}\n`);
    
    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        logger.info('✅ Page loaded');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const frames = page.frames();
        const checkboxFrame = frames.find(f => f.url().includes('hcaptcha.com') && f.url().includes('frame=checkbox'));
        
        if (!checkboxFrame) {
            logger.error('❌ Checkbox frame not found');
            return;
        }
        
        logger.info('🔲 Clicking checkbox...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const clicked = await checkboxFrame.evaluate(() => {
            const checkbox = document.querySelector('#checkbox, .check, [type="checkbox"]');
            if (checkbox) {
                checkbox.click();
                return true;
            }
            return false;
        }).catch(() => false);
        
        if (!clicked) {
            logger.warn('⚠️  Could not click checkbox, trying anchor method...');
            await checkboxFrame.evaluate(() => {
                const anchor = document.querySelector('.anchor, #anchor');
                if (anchor) anchor.click();
            });
        }
        
        logger.info('⏳ Waiting for challenge frame...');
        const challengeFrame = await waitForChallengeFrame(page, 15000);
        
        if (!challengeFrame) {
            logger.error('❌ Challenge frame did not appear');
            logger.info('💡 Captcha might have been solved immediately or blocked');
            
            await new Promise(resolve => setTimeout(resolve, 60000));
            return;
        }
        
        logger.info('🎯 Challenge frame found! Analyzing...\n');
        
        const analysis = await deepInspectChallenge(challengeFrame);
        
        logger.info('═'.repeat(100));
        logger.info('🔍 CHALLENGE TYPE: ' + analysis.type);
        logger.info('═'.repeat(100));
        
        if (analysis.prompt) {
            logger.info('\n📝 PROMPT:');
            logger.info(JSON.stringify(analysis.prompt, null, 2));
        }
        
        if (analysis.gridBased) {
            logger.info('\n🎯 GRID-BASED CHALLENGE DETAILS:');
            logger.info(JSON.stringify(analysis.gridBased, null, 2));
        }
        
        if (analysis.jigsawSlider) {
            logger.info('\n🧩 JIGSAW/SLIDER CHALLENGE DETAILS:');
            logger.info(JSON.stringify(analysis.jigsawSlider, null, 2));
        }
        
        if (analysis.boundingBox) {
            logger.info('\n🎨 BOUNDING BOX DETAILS:');
            logger.info(JSON.stringify(analysis.boundingBox, null, 2));
        }
        
        logger.info('\n📊 ALL ELEMENTS:');
        logger.info(JSON.stringify(analysis.allElements, null, 2));
        
        await fs.writeFile('debug-challenge-structure.json', JSON.stringify(analysis, null, 2));
        logger.info('\n💾 Full analysis saved to: debug-challenge-structure.json');
        
        logger.info('\n⏸️  Keeping browser open for 120 seconds for manual inspection...');
        logger.info('You can refresh or try different challenges...\n');
        
        await new Promise(resolve => setTimeout(resolve, 120000));
        
    } catch (error) {
        logger.error('❌ Error:', error);
    } finally {
        await browser.close();
        logger.info('👋 Browser closed');
    }
}

main().catch(console.error);
