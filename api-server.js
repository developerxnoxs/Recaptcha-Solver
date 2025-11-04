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
        service: 'hCaptcha AI Solver API',
        version: '1.0.0',
        endpoints: {
            solve: {
                method: 'POST',
                path: '/solve',
                description: 'Solve hCaptcha challenge',
                parameters: {
                    sitekey: 'hCaptcha site key (required)',
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

        logger.info('🗑️  Clearing original content and injecting hCaptcha...');
        
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>hCaptcha</title>
    <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
</head>
<body>
    <div class="h-captcha" data-sitekey="${sitekey}"></div>
</body>
</html>`;
        
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        logger.info('✓ hCaptcha widget injected with sitekey: ' + sitekey);

        logger.info('⏳ Waiting for hCaptcha to render...');
        await page.waitForFunction(() => {
            const frames = Array.from(document.querySelectorAll('iframe'));
            return frames.some(f => f.src.includes('hcaptcha.com'));
        }, { timeout: 15000 });
        
        logger.info('✓ hCaptcha rendered successfully');
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
║        🤖 hCaptcha AI Solver - API Server                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
    logger.info(`✅ API Server is running on port ${PORT}`);
    logger.info('');
    logger.info('📋 Available Endpoints:');
    logger.info(`   GET  / - API information`);
    logger.info(`   POST /solve - Solve hCaptcha (sitekey, pageurl)`);
    logger.info('');
    logger.info('🔑 API Key Status: ' + (process.env.GEMINI_API_KEY ? '✓ Loaded' : '✗ Missing'));
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
});
