#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { launchBrowser, solveCaptchaChallenge, setLogger } = require('./lib/captcha-solver');
const ResultTracker = require('./lib/result-tracker');
const createLogger = require('./utils/logger');

const program = new Command();

program
    .name('recaptcha-solver')
    .description('🤖 CLI tool untuk menyelesaikan reCAPTCHA v2 menggunakan AI')
    .version('1.0.0')
    .requiredOption('-s, --sitekey <sitekey>', 'reCAPTCHA site key')
    .option('-d, --domain <domain>', 'Domain untuk testing (default: localhost)', 'localhost')
    .option('-p, --port <port>', 'Port untuk fakepage server (default: 8000)', '8000')
    .option('--headless', 'Run browser dalam headless mode', false)
    .option('--debug', 'Enable debug logging', false)
    .parse(process.argv);

const options = program.opts();

const logger = createLogger({ level: options.debug ? 'debug' : 'info' });
setLogger(logger);

const screenshotDir = path.join(__dirname, 'screenshots');

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🤖 reCAPTCHA v2 AI Solver - CLI Tool                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

    logger.info('📋 Configuration:');
    logger.info(`   Sitekey: ${options.sitekey}`);
    logger.info(`   Domain: ${options.domain}`);
    logger.info(`   Port: ${options.port}`);
    logger.info(`   Headless: ${options.headless}`);
    logger.info(`   Screenshots: ${screenshotDir}`);
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

    const fakepageUrl = `http://${options.domain}:${options.port}/fakepage.html?sitekey=${options.sitekey}`;

    logger.info('🚀 Starting browser...');
    const browser = await launchBrowser(options.headless);
    
    logger.info('✓ Browser launched');
    logger.info('');
    logger.info(`🌐 Opening fakepage: ${fakepageUrl}`);
    logger.info('');

    try {
        const page = await browser.newPage();

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            delete navigator.__proto__.webdriver;
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        logger.info('⏳ Loading page...');
        await page.goto(fakepageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        logger.info('✓ Page loaded successfully');
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('🎯 Starting CAPTCHA solving process...');
        logger.info('═══════════════════════════════════════════════════════════');
        logger.info('');

        const startTime = Date.now();
        const token = await solveCaptchaChallenge(page, apiKey, screenshotDir);
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
        logger.error('❌ Error:', error.message);
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
