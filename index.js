#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { launchBrowser, solveCaptchaWithStrategy, setLogger } = require('./lib/captcha-solver');
const ResultTracker = require('./lib/result-tracker');
const createLogger = require('./utils/logger');

const program = new Command();

program
    .name('hcaptcha-solver')
    .description('🤖 CLI tool untuk menyelesaikan hCaptcha menggunakan AI')
    .version('1.0.0')
    .option('-s, --sitekey <sitekey>', 'hCaptcha site key')
    .option('-u, --url <url>', 'Target URL (domain yang sebenarnya)')
    .option('-m, --mode <mode>', 'Mode operasi: normal atau inject (default: normal)', 'normal')
    .option('--audio', 'Use audio challenge instead of image challenge', false)
    .option('--screenshot', 'Enable screenshot capture (default: false)', false)
    .option('--headless', 'Run browser dalam headless mode', false)
    .option('--debug', 'Enable debug logging', false)
    .option('--api', 'Run as API server on port 5000', false)
    .parse(process.argv);

const options = program.opts();

if (options.api) {
    console.log('🚀 Starting API Server mode...');
    require('./api-server');
    return;
}

if (!options.sitekey || !options.url) {
    console.error('❌ Error: --sitekey dan --url wajib diisi (kecuali mode --api)');
    process.exit(1);
}

if (!['normal', 'inject'].includes(options.mode)) {
    console.error('❌ Error: Mode harus "normal" atau "inject"');
    process.exit(1);
}

const logger = createLogger({ level: options.debug ? 'debug' : 'info' });
setLogger(logger);

const screenshotDir = path.join(__dirname, 'screenshots');

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 hCaptcha AI Solver - CLI Tool                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

    logger.info('📋 Configuration:');
    logger.info(`   Sitekey: ${options.sitekey}`);
    logger.info(`   Target URL: ${options.url}`);
    logger.info(`   Mode: ${options.mode}`);
    logger.info(`   Audio Challenge: ${options.audio ? 'enabled' : 'disabled'}`);
    logger.info(`   Headless: ${options.headless}`);
    logger.info(`   Screenshot: ${options.screenshot ? 'enabled' : 'disabled'}`);
    if (options.screenshot) {
        logger.info(`   Screenshot dir: ${screenshotDir}`);
    }
    logger.info('');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        logger.error('❌ GEMINI_API_KEY environment variable not set!');
        logger.error('   Please set your Gemini API key:');
        logger.error('   export GEMINI_API_KEY="your-api-key-here"');
        process.exit(1);
    }

    logger.info('✓ Gemini API key loaded');
    logger.info('');

    const resultTracker = new ResultTracker();

    logger.info('🚀 Starting browser...');
    const browser = await launchBrowser(options.headless);
    
    logger.info('✓ Browser launched');
    logger.info('');

    try {
        const page = await browser.newPage();

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            delete navigator.__proto__.webdriver;
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        if (options.mode === 'inject') {
            logger.info(`🌐 Navigating to target URL: ${options.url}`);
            await page.goto(options.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            logger.info('✓ Target page loaded');

            logger.info('🗑️  Clearing original content and injecting hCaptcha...');
            
            const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>hCaptcha Solver</title>
    <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
        }
        h2 {
            margin-bottom: 30px;
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>🤖 hCaptcha Solver</h2>
        <div class="h-captcha" data-sitekey="${options.sitekey}"></div>
    </div>
</body>
</html>`;
            
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            logger.info('✓ hCaptcha widget injected with sitekey: ' + options.sitekey);
        } else {
            logger.info(`🌐 Navigating to target URL: ${options.url}`);
            await page.goto(options.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            logger.info('✓ Target page loaded');
            logger.info('🔍 Mode normal: menggunakan hCaptcha yang ada di halaman...');
        }

        logger.info('⏳ Waiting for hCaptcha to render...');
        await page.waitForFunction(() => {
            const frames = Array.from(document.querySelectorAll('iframe'));
            return frames.some(f => f.src.includes('hcaptcha.com'));
        }, { timeout: 15000 });
        
        logger.info('✓ hCaptcha rendered successfully');
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('🎯 Starting CAPTCHA solving process...');
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('');

        const startTime = Date.now();
        const token = await solveCaptchaWithStrategy(page, apiKey, screenshotDir, options.screenshot, options.audio);
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════');

        if (token) {
            logger.info('🎉 SUCCESS! Token berhasil didapatkan');
            logger.info('');
            logger.info(`⏱️  Time taken: ${duration}s`);
            logger.info('');
            logger.info('🎫 Token:');
            console.log('\x1b[32m%s\x1b[0m', token);
            logger.info('');
            
            resultTracker.addResult({ token: token });

            logger.info('✅ Token has been verified and is ready to use!');
        } else {
            logger.error('❌ FAILED! Tidak berhasil mendapatkan token');
            logger.error(`⏱️  Time taken: ${duration}s`);
            resultTracker.addResult({ token: null });
        }

        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('');

        logger.info('📸 Screenshots tersimpan di: ' + screenshotDir);
        logger.info('');
        logger.info('Press Ctrl+C to close browser and exit...');

        await new Promise(resolve => {
            process.on('SIGINT', () => {
                logger.info('');
                logger.info('🛑 Shutting down...');
                resolve();
            });
        });

    } catch (error) {
        logger.error('❌ Error:', error.message || error);
        if (error.stack) {
            logger.debug('Stack trace:', error.stack);
        }
        resultTracker.addResult({ token: null });
    } finally {
        await browser.close();
        logger.info('✓ Browser closed');
        logger.info('👋 Goodbye!');
        process.exit(0);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
