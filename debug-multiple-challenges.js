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
        args: ['--no-sandbox', '--disable-gpu', '--enable-webgl', '--window-size=1920,1080'],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
    });
}

async function analyzeChallengeStructure(frame) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return await frame.evaluate(() => {
        const analysis = { type: 'unknown', elements: {} };
        
        const promptEl = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt');
        if (promptEl) analysis.elements.prompt = promptEl.textContent.trim();
        
        const gridTiles = document.querySelectorAll('.task-image, .challenge-image, .image-task');
        if (gridTiles.length > 0) {
            analysis.type = 'GRID_BASED';
            analysis.elements.grid = {
                count: gridTiles.length,
                size: gridTiles.length === 9 ? '3x3' : '4x4',
                sampleHTML: gridTiles[0].outerHTML.substring(0, 300),
                containerHTML: document.querySelector('.task-grid, .challenge-view')?.outerHTML.substring(0, 500)
            };
        }
        
        const sliders = document.querySelectorAll('[class*="slider"], [draggable="true"], [role="slider"]');
        if (sliders.length > 0) {
            analysis.type = 'JIGSAW_SLIDER';
            analysis.elements.slider = Array.from(sliders).map(s => ({
                tag: s.tagName,
                className: s.className,
                draggable: s.draggable,
                html: s.outerHTML.substring(0, 300)
            }));
        }
        
        const canvas = document.querySelector('canvas');
        if (canvas) {
            if (analysis.type === 'unknown') analysis.type = 'BOUNDING_BOX';
            analysis.elements.canvas = {
                width: canvas.width,
                height: canvas.height,
                parentHTML: canvas.parentElement?.outerHTML.substring(0, 400)
            };
        }
        
        analysis.elements.verifyButton = document.querySelector('.button-submit')?.outerHTML.substring(0, 200);
        analysis.elements.skipButton = document.querySelector('.skip')?.outerHTML.substring(0, 200) || null;
        
        return analysis;
    });
}

async function tryMultipleChallenges() {
    const results = [];
    const browser = await launchBrowser();
    
    for (let attempt = 1; attempt <= 5; attempt++) {
        logger.info(`\n${'='.repeat(80)}`);
        logger.info(`🎯 ATTEMPT ${attempt}/5`);
        logger.info(`${'='.repeat(80)}\n`);
        
        const page = await browser.newPage();
        
        try {
            await page.goto('https://nopecha.com/demo/hcaptcha', { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const frames = page.frames();
            const checkboxFrame = frames.find(f => f.url().includes('frame=checkbox'));
            
            if (checkboxFrame) {
                await checkboxFrame.evaluate(() => {
                    const cb = document.querySelector('#checkbox, .check');
                    if (cb) cb.click();
                }).catch(() => {});
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const challengeFrame = page.frames().find(f => 
                    f.url().includes('frame=challenge') && 
                    f.url().includes('hcaptcha.com')
                );
                
                if (challengeFrame) {
                    const analysis = await analyzeChallengeStructure(challengeFrame);
                    logger.info(`✅ Challenge Type: ${analysis.type}`);
                    logger.info(`📝 Prompt: ${analysis.elements.prompt || 'N/A'}`);
                    
                    results.push({
                        attempt: attempt,
                        type: analysis.type,
                        analysis: analysis
                    });
                    
                    if (analysis.type === 'GRID_BASED') {
                        logger.info(`🎯 GRID DETECTED! Grid size: ${analysis.elements.grid.size}`);
                        logger.info('Sample HTML:', analysis.elements.grid.sampleHTML);
                    } else if (analysis.type === 'JIGSAW_SLIDER') {
                        logger.info('🧩 JIGSAW/SLIDER DETECTED!');
                        logger.info(JSON.stringify(analysis.elements.slider, null, 2));
                    } else if (analysis.type === 'BOUNDING_BOX') {
                        logger.info('📍 BOUNDING BOX DETECTED!');
                    }
                } else {
                    logger.warn('⚠️  No challenge appeared (might be auto-solved)');
                }
            }
            
        } catch (error) {
            logger.error(`Error in attempt ${attempt}:`, error.message);
        } finally {
            await page.close();
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await browser.close();
    
    await fs.writeFile('all-challenge-types.json', JSON.stringify(results, null, 2));
    logger.info('\n💾 All results saved to: all-challenge-types.json');
    
    const summary = {
        total: results.length,
        types: {}
    };
    
    results.forEach(r => {
        summary.types[r.type] = (summary.types[r.type] || 0) + 1;
    });
    
    logger.info('\n📊 SUMMARY:');
    logger.info(JSON.stringify(summary, null, 2));
    
    return results;
}

tryMultipleChallenges().catch(console.error);
