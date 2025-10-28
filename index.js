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
    .requiredOption('-u, --url <url>', 'Target URL (domain yang sebenarnya)')
    .option('-m, --mode <mode>', 'Mode operasi: normal atau inject (default: normal)', 'normal')
    .option('--headless', 'Run browser dalam headless mode', false)
    .option('--debug', 'Enable debug logging', false)
    .parse(process.argv);

const options = program.opts();

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
║        🤖 reCAPTCHA v2 AI Solver - CLI Tool                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

    logger.info('📋 Configuration:');
    logger.info(`   Sitekey: ${options.sitekey}`);
    logger.info(`   Target URL: ${options.url}`);
    logger.info(`   Mode: ${options.mode}`);
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

        logger.info(`🌐 Navigating to target URL: ${options.url}`);
        await page.goto(options.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        logger.info('✓ Target page loaded');

        if (options.mode === 'inject') {
            logger.info('🗑️  Clearing original page content...');
            await page.evaluate(() => {
                document.body.innerHTML = '';
                document.head.innerHTML = '<meta charset="UTF-8"><title>reCAPTCHA Solver</title>';
            });
            logger.info('✓ Original content cleared');

            logger.info('💉 Injecting fake page with reCAPTCHA...');
            await page.evaluate((sitekey) => {
                document.body.innerHTML = `
                    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                                background: white; padding: 40px; border-radius: 10px; 
                                box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 999999;">
                        <h2 style="text-align: center; margin-bottom: 20px;">🤖 reCAPTCHA Solver</h2>
                        <div id="recaptcha-container" style="display: flex; justify-content: center; margin: 20px 0;">
                            <div id="recaptcha-element"></div>
                        </div>
                        <div id="status" style="text-align: center; padding: 10px; background: #f0f4ff; border-radius: 4px;">
                            Initializing...
                        </div>
                    </div>
                `;
                
                window._recaptchaSitekey = sitekey;
            }, options.sitekey);
            logger.info('✓ Fake page injected');

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
        } else {
            logger.info('🔍 Mode normal: menggunakan reCAPTCHA yang ada di halaman...');
        }

        logger.info('⏳ Waiting for reCAPTCHA to render...');
        await page.waitForFunction(() => {
            const frames = Array.from(document.querySelectorAll('iframe'));
            return frames.some(f => f.src.includes('api2/anchor'));
        }, { timeout: 15000 });
        
        logger.info('✓ reCAPTCHA rendered successfully');
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
