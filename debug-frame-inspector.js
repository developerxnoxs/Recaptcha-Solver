const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const createLogger = require('./utils/logger');

puppeteerExtra.use(StealthPlugin());

const logger = createLogger({ level: 'info' });

async function launchBrowser() {
    const execSync = require('child_process').execSync;
    let executablePath;
    
    try {
        executablePath = execSync('which chromium').toString().trim();
        logger.info(`Using system chromium: ${executablePath}`);
    } catch (e) {
        executablePath = undefined;
        logger.info('Using bundled chromium');
    }

    const browser = await puppeteerExtra.launch({
        headless: false,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--enable-webgl',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--lang=en',
            '--disable-extensions',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
    });

    return browser;
}

async function inspectFrames(page) {
    logger.info('\n📊 Inspecting all frames...\n');
    
    const frames = page.frames();
    
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const url = frame.url();
        
        logger.info(`\n${'='.repeat(80)}`);
        logger.info(`Frame ${i + 1}/${frames.length}`);
        logger.info(`URL: ${url}`);
        logger.info(`${'='.repeat(80)}\n`);
        
        if (url.includes('hcaptcha.com')) {
            if (url.includes('frame=checkbox')) {
                logger.info('🔲 CHECKBOX FRAME DETECTED');
                await inspectCheckboxFrame(frame);
            } else if (url.includes('frame=challenge')) {
                logger.info('🎯 CHALLENGE FRAME DETECTED');
                await inspectChallengeFrame(frame);
            }
        }
    }
}

async function inspectCheckboxFrame(frame) {
    try {
        const checkboxInfo = await frame.evaluate(() => {
            return {
                checkbox: !!document.querySelector('#checkbox'),
                checkboxLabel: document.querySelector('.checkbox-label')?.textContent || 'N/A',
                allClasses: Array.from(document.querySelectorAll('[class]'))
                    .map(el => el.className)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .slice(0, 20)
            };
        });
        
        logger.info('Checkbox Info:', JSON.stringify(checkboxInfo, null, 2));
    } catch (error) {
        logger.error('Error inspecting checkbox frame:', error.message);
    }
}

async function inspectChallengeFrame(frame) {
    try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const challengeInfo = await frame.evaluate(() => {
            const info = {
                challengeType: 'unknown',
                elements: {},
                selectors: {},
                structure: {}
            };
            
            const promptElement = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt');
            if (promptElement) {
                info.elements.prompt = {
                    text: promptElement.textContent.trim(),
                    html: promptElement.innerHTML.substring(0, 200)
                };
            }
            
            const gridTiles = document.querySelectorAll('.task-image');
            if (gridTiles.length > 0) {
                info.challengeType = 'GRID_BASED';
                info.elements.gridTiles = {
                    count: gridTiles.length,
                    gridSize: gridTiles.length === 9 ? '3x3' : '4x4',
                    sampleClasses: gridTiles[0]?.className || 'N/A',
                    hasSrc: !!gridTiles[0]?.querySelector('img')?.src,
                    hasBackgroundImage: !!window.getComputedStyle(gridTiles[0])?.backgroundImage
                };
            }
            
            const sliderElements = document.querySelectorAll('[class*="slider"], [class*="puzzle"], [draggable="true"]');
            if (sliderElements.length > 0) {
                info.challengeType = 'JIGSAW_SLIDER';
                info.elements.slider = {
                    count: sliderElements.length,
                    elements: Array.from(sliderElements).map(el => ({
                        tag: el.tagName,
                        classes: el.className,
                        draggable: el.draggable,
                        id: el.id || 'N/A'
                    }))
                };
            }
            
            const canvas = document.querySelector('canvas');
            if (canvas) {
                info.challengeType = 'BOUNDING_BOX';
                info.elements.canvas = {
                    width: canvas.width,
                    height: canvas.height,
                    classes: canvas.className
                };
            }
            
            info.selectors.allUniqueClasses = Array.from(document.querySelectorAll('[class]'))
                .map(el => el.className)
                .filter((v, i, a) => a.indexOf(v) === i)
                .slice(0, 30);
            
            info.selectors.allIds = Array.from(document.querySelectorAll('[id]'))
                .map(el => el.id);
            
            const challengeContainer = document.querySelector('.challenge-container, .challenge-view, .task-grid');
            if (challengeContainer) {
                info.structure.containerClass = challengeContainer.className;
                info.structure.innerHTML = challengeContainer.innerHTML.substring(0, 500) + '...';
            }
            
            info.selectors.buttonSelectors = {
                verify: !!document.querySelector('.button-submit, [type="submit"]'),
                audio: !!document.querySelector('.button-audio, [aria-label*="audio"]'),
                refresh: !!document.querySelector('.button-refresh, [aria-label*="refresh"]'),
                skip: !!document.querySelector('.button-skip')
            };
            
            info.structure.bodyHTML = document.body.innerHTML.substring(0, 1000);
            
            return info;
        });
        
        logger.info('\n🎯 CHALLENGE FRAME ANALYSIS:');
        logger.info('='.repeat(80));
        logger.info(JSON.stringify(challengeInfo, null, 2));
        logger.info('='.repeat(80));
        
        if (challengeInfo.challengeType === 'JIGSAW_SLIDER') {
            logger.info('\n🧩 JIGSAW/SLIDER DETECTED! Inspecting further...');
            await inspectJigsawPuzzle(frame);
        }
        
    } catch (error) {
        logger.error('Error inspecting challenge frame:', error.message);
    }
}

async function inspectJigsawPuzzle(frame) {
    try {
        const jigsawDetails = await frame.evaluate(() => {
            const details = {
                draggableElements: [],
                puzzleImages: [],
                sliderControls: [],
                positions: {}
            };
            
            const draggables = document.querySelectorAll('[draggable="true"], [class*="drag"], [class*="piece"]');
            draggables.forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                details.draggableElements.push({
                    index: i,
                    tag: el.tagName,
                    classes: el.className,
                    position: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    },
                    style: el.getAttribute('style') || 'N/A'
                });
            });
            
            const images = document.querySelectorAll('img, [style*="background-image"]');
            images.forEach((el, i) => {
                if (i < 10) {
                    details.puzzleImages.push({
                        tag: el.tagName,
                        src: el.src?.substring(0, 100) || 'N/A',
                        classes: el.className
                    });
                }
            });
            
            const sliders = document.querySelectorAll('[role="slider"], input[type="range"], [class*="slider"]');
            sliders.forEach((el) => {
                details.sliderControls.push({
                    tag: el.tagName,
                    type: el.type || 'N/A',
                    classes: el.className,
                    min: el.min || 'N/A',
                    max: el.max || 'N/A',
                    value: el.value || 'N/A'
                });
            });
            
            return details;
        });
        
        logger.info('\n🧩 JIGSAW PUZZLE DETAILS:');
        logger.info(JSON.stringify(jigsawDetails, null, 2));
        
    } catch (error) {
        logger.error('Error inspecting jigsaw puzzle:', error.message);
    }
}

async function main() {
    const sitekey = '58366d97-3e8c-4b57-a679-4a41c8423be3';
    const url = 'https://nopecha.com/demo/hcaptcha';
    
    logger.info('🚀 Starting Frame Inspector for hCaptcha');
    logger.info(`URL: ${url}`);
    logger.info(`Sitekey: ${sitekey}\n`);
    
    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        logger.info('✅ Page loaded\n');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await inspectFrames(page);
        
        logger.info('\n⏳ Waiting for challenge to appear...');
        logger.info('Please click the hCaptcha checkbox manually in the browser window...\n');
        
        page.on('frameattached', async (frame) => {
            logger.info(`\n🆕 NEW FRAME ATTACHED: ${frame.url()}\n`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await inspectFrames(page);
        });
        
        logger.info('🔍 Inspector is running. Press Ctrl+C to stop.\n');
        logger.info('Try to trigger different types of challenges and I will analyze them.\n');
        
        await new Promise(resolve => setTimeout(resolve, 300000));
        
    } catch (error) {
        logger.error('Error:', error);
    } finally {
        logger.info('\n👋 Closing browser...');
        await browser.close();
    }
}

main().catch(console.error);
