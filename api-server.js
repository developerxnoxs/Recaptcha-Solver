#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const path = require('path');
const { launchBrowser, solveCaptchaChallenge, setLogger } = require('./lib/captcha-solver');
const ResultTracker = require('./lib/result-tracker');
const createLogger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const logger = createLogger({ level: 'info' });
setLogger(logger);

const screenshotDir = path.join(__dirname, 'screenshots');

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'reCAPTCHA v2 AI Solver API',
        version: '1.0.0',
        endpoints: {
            solve: {
                method: 'POST',
                path: '/solve',
                description: 'Solve reCAPTCHA v2 challenge',
                parameters: {
                    sitekey: 'reCAPTCHA site key (required)',
                    pageurl: 'Target URL/domain (required)'
                }
            }
        }
    });
});

app.post('/solve', async (req, res) => {
    const { sitekey, pageurl } = req.body;

    if (!sitekey || !pageurl) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameters',
            message: 'Both sitekey and pageurl are required'
        });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: 'Server configuration error',
            message: 'GEMINI_API_KEY not configured'
        });
    }

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('📥 New API Request');
    logger.info(`   Sitekey: ${sitekey}`);
    logger.info(`   Page URL: ${pageurl}`);
    logger.info('   Mode: inject (API default)');
    logger.info('   Headless: false (API default)');
    logger.info('═══════════════════════════════════════════════════════════');

    const resultTracker = new ResultTracker();
    let browser;

    try {
        logger.info('🚀 Starting browser...');
        browser = await launchBrowser(false);
        logger.info('✓ Browser launched');

        const page = await browser.newPage();

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            delete navigator.__proto__.webdriver;
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        logger.info(`🌐 Navigating to target URL: ${pageurl}`);
        await page.goto(pageurl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        logger.info('✓ Target page loaded');

        logger.info('🗑️  Clearing original page content...');
        await page.evaluate(() => {
            document.body.innerHTML = '';
            document.head.innerHTML = '<meta charset="UTF-8"><title>reCAPTCHA Solver API</title>';
        });
        logger.info('✓ Original content cleared');

        logger.info('💉 Injecting reCAPTCHA widget...');
        await page.evaluate((sitekey) => {
            document.body.innerHTML = `
                <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                            background: white; padding: 40px; border-radius: 10px; 
                            box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 999999;">
                    <h2 style="text-align: center; margin-bottom: 20px;">🤖 reCAPTCHA Solver API</h2>
                    <div id="recaptcha-container" style="display: flex; justify-content: center; margin: 20px 0;">
                        <div id="recaptcha-element"></div>
                    </div>
                    <div id="status" style="text-align: center; padding: 10px; background: #f0f4ff; border-radius: 4px;">
                        Initializing...
                    </div>
                </div>
            `;
            
            window._recaptchaSitekey = sitekey;
        }, sitekey);
        logger.info('✓ Widget injected');

        logger.info('💉 Injecting reCAPTCHA API script...');
        await page.addScriptTag({
            url: 'https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit',
            type: 'text/javascript'
        });

        await page.evaluate(() => {
            window.onRecaptchaLoad = function() {
                console.log('reCAPTCHA API loaded!');
                const sitekey = window._recaptchaSitekey;
                grecaptcha.render('recaptcha-element', {
                    'sitekey': sitekey,
                    'callback': function(token) {
                        console.log('✅ Token received:', token);
                        document.getElementById('status').textContent = '✅ Success!';
                    }
                });
                document.getElementById('status').textContent = '✅ reCAPTCHA loaded';
                console.log('reCAPTCHA rendered with sitekey:', sitekey);
            };
        });

        logger.info('⏳ Waiting for reCAPTCHA to render...');
        await page.waitForFunction(() => {
            const frames = Array.from(document.querySelectorAll('iframe'));
            return frames.some(f => f.src.includes('api2/anchor'));
        }, { timeout: 15000 });
        
        logger.info('✓ reCAPTCHA rendered successfully');
        logger.info('');
        logger.info('🎯 Starting CAPTCHA solving process...');

        const startTime = Date.now();
        const token = await solveCaptchaChallenge(page, apiKey, screenshotDir, false);
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        await browser.close();
        logger.info('✓ Browser closed');

        if (token) {
            logger.info(`🎉 SUCCESS! Token solved in ${duration}s`);
            resultTracker.addResult({ token: token });
            
            return res.json({
                success: true,
                token: token,
                duration: parseFloat(duration),
                sitekey: sitekey,
                pageurl: pageurl
            });
        } else {
            logger.error(`❌ FAILED! Unable to solve after ${duration}s`);
            resultTracker.addResult({ token: null });
            
            return res.status(500).json({
                success: false,
                error: 'Solver failed',
                message: 'Unable to solve the reCAPTCHA challenge',
                duration: parseFloat(duration)
            });
        }

    } catch (error) {
        logger.error('❌ API Error:', error.message);
        
        if (browser) {
            await browser.close();
            logger.info('✓ Browser closed');
        }
        
        resultTracker.addResult({ token: null });
        
        return res.status(500).json({
            success: false,
            error: error.message,
            message: 'An error occurred while solving the CAPTCHA'
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 reCAPTCHA v2 AI Solver - API Server              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
    logger.info(`✅ API Server is running on port ${PORT}`);
    logger.info('');
    logger.info('📋 Available Endpoints:');
    logger.info(`   GET  / - API information`);
    logger.info(`   POST /solve - Solve reCAPTCHA (sitekey, pageurl)`);
    logger.info('');
    logger.info('🔑 API Key Status: ' + (process.env.GEMINI_API_KEY ? '✓ Loaded' : '✗ Missing'));
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
});
