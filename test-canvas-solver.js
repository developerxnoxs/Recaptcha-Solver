#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { solveCaptchaChallenge } = require('./lib/captcha-solver');
const createLogger = require('./utils/logger');

puppeteer.use(StealthPlugin());

const logger = createLogger({ level: 'info' });

async function testCanvasSolver() {
    console.log('🧪 Testing Canvas-Based hCaptcha Solver...\n');
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set');
        process.exit(1);
    }
    
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
        await page.goto('https://nopecha.com/demo/hcaptcha', { 
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        
        console.log('⏳ Waiting for hCaptcha iframe...');
        await page.waitForSelector('iframe[src*="hcaptcha.com"]', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🤖 Attempting to solve hCaptcha...\n');
        
        const startTime = Date.now();
        const token = await solveCaptchaChallenge(page, apiKey, './screenshots', true);
        const timeTaken = Date.now() - startTime;
        
        console.log('\n' + '='.repeat(60));
        if (token) {
            console.log('✅ SUCCESS! hCaptcha solved!');
            console.log(`⏱️  Time taken: ${timeTaken}ms`);
            console.log(`🎫 Token: ${token.substring(0, 50)}...`);
        } else {
            console.log('❌ FAILED to solve hCaptcha');
            console.log(`⏱️  Time taken: ${timeTaken}ms`);
        }
        console.log('='.repeat(60) + '\n');
        
        console.log('⏳ Keeping browser open for 30 seconds to observe result...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
    } catch (error) {
        console.error('❌ Test error:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
        console.log('\n✓ Test complete');
    }
}

testCanvasSolver().catch(console.error);
