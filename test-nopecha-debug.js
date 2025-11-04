#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs').promises;

puppeteer.use(StealthPlugin());

async function debugNopechaChallenge() {
    console.log('🚀 Starting debug session for nopecha hCaptcha...');
    
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium'
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        console.log('🌐 Navigating to nopecha demo...');
        await page.goto('https://nopecha.com/demo/hcaptcha', { waitUntil: 'networkidle0' });
        
        console.log('⏳ Waiting for hCaptcha iframe...');
        await page.waitForSelector('iframe[src*="hcaptcha.com"]', { timeout: 10000 });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const frames = page.frames();
        console.log(`\n📋 Found ${frames.length} frames:`);
        frames.forEach((f, i) => console.log(`  ${i}: ${f.url()}`));
        
        // Find checkbox frame
        const checkboxFrame = frames.find(f => f.url().includes('checkbox'));
        if (!checkboxFrame) {
            throw new Error('Checkbox frame not found');
        }
        
        console.log('\n🖱️  Clicking hCaptcha checkbox...');
        const checkbox = await checkboxFrame.$('#checkbox');
        if (checkbox) {
            await checkbox.click();
            console.log('✓ Checkbox clicked');
        }
        
        console.log('\n⏳ Waiting for challenge to appear...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Find challenge frame
        const challengeFrame = frames.find(f => f.url().includes('hcaptcha.com') && f.url().includes('challenge'));
        if (!challengeFrame) {
            console.log('❌ No challenge frame found - might have passed instantly');
            await new Promise(resolve => setTimeout(resolve, 60000));
            return;
        }
        
        console.log('\n🔍 Analyzing challenge frame DOM structure...');
        
        const domAnalysis = await challengeFrame.evaluate(() => {
            const analysis = {
                prompt: '',
                allElements: [],
                draggableElements: [],
                canvasElements: [],
                buttonElements: [],
                challengeContainer: null
            };
            
            // Get prompt
            const promptEl = document.querySelector('.prompt-text, .challenge-prompt, h2.prompt');
            if (promptEl) analysis.prompt = promptEl.textContent.trim();
            
            // Find all elements with useful classes
            const allEls = document.querySelectorAll('*');
            allEls.forEach(el => {
                const classList = Array.from(el.classList);
                const attrs = {};
                for (let attr of el.attributes) {
                    attrs[attr.name] = attr.value;
                }
                
                if (classList.length > 0 || el.tagName === 'CANVAS' || el.hasAttribute('draggable')) {
                    analysis.allElements.push({
                        tag: el.tagName,
                        classes: classList,
                        attributes: attrs,
                        text: el.textContent ? el.textContent.substring(0, 50) : ''
                    });
                }
            });
            
            // Find draggable elements
            const draggables = document.querySelectorAll('[draggable="true"], [class*="drag"], [class*="move"], [class*="piece"], [class*="segment"]');
            draggables.forEach(el => {
                const rect = el.getBoundingClientRect();
                analysis.draggableElements.push({
                    tag: el.tagName,
                    classes: Array.from(el.classList),
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    draggable: el.hasAttribute('draggable')
                });
            });
            
            // Find canvas
            const canvases = document.querySelectorAll('canvas');
            canvases.forEach(canvas => {
                const rect = canvas.getBoundingClientRect();
                analysis.canvasElements.push({
                    width: canvas.width,
                    height: canvas.height,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                });
            });
            
            // Find buttons
            const buttons = document.querySelectorAll('button, [role="button"], .button, [class*="move"], [class*="submit"]');
            buttons.forEach(btn => {
                analysis.buttonElements.push({
                    tag: btn.tagName,
                    classes: Array.from(btn.classList),
                    text: btn.textContent.trim(),
                    type: btn.getAttribute('type')
                });
            });
            
            // Get challenge container
            const container = document.querySelector('.challenge-container, .task-grid, .challenge-view, [class*="challenge"]');
            if (container) {
                analysis.challengeContainer = {
                    classes: Array.from(container.classList),
                    innerHTML: container.innerHTML.substring(0, 500)
                };
            }
            
            return analysis;
        });
        
        console.log('\n📊 DOM Analysis Results:');
        console.log('═══════════════════════════════════════');
        console.log('Prompt:', domAnalysis.prompt);
        console.log('\nDraggable Elements:', domAnalysis.draggableElements.length);
        domAnalysis.draggableElements.forEach((el, i) => {
            console.log(`  ${i + 1}. ${el.tag} - ${el.classes.join(', ')} - draggable=${el.draggable}`);
        });
        
        console.log('\nCanvas Elements:', domAnalysis.canvasElements.length);
        domAnalysis.canvasElements.forEach((canvas, i) => {
            console.log(`  ${i + 1}. ${canvas.width}x${canvas.height}`);
        });
        
        console.log('\nButton Elements:', domAnalysis.buttonElements.length);
        domAnalysis.buttonElements.forEach((btn, i) => {
            console.log(`  ${i + 1}. ${btn.tag} [${btn.classes.join(', ')}] - "${btn.text}"`);
        });
        
        console.log('\nAll Elements (first 20):');
        domAnalysis.allElements.slice(0, 20).forEach((el, i) => {
            console.log(`  ${i + 1}. <${el.tag}> class="${el.classes.join(' ')}"`);
        });
        
        // Save to file
        await fs.writeFile(
            path.join(__dirname, 'nopecha-dom-analysis.json'),
            JSON.stringify(domAnalysis, null, 2)
        );
        console.log('\n✓ Full DOM analysis saved to: nopecha-dom-analysis.json');
        
        // Take screenshot
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots/nopecha-debug.png'),
            fullPage: true 
        });
        console.log('✓ Screenshot saved to: screenshots/nopecha-debug.png');
        
        console.log('\n⏳ Keeping browser open for 60 seconds for manual inspection...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
        console.log('\n✓ Browser closed');
    }
}

debugNopechaChallenge().catch(console.error);
