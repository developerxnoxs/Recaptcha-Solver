const puppeteer = require('puppeteer');

(async () => {
    console.log('🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ],
        executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium'
    });

    const page = await browser.newPage();
    
    console.log('🌐 Navigating to 2captcha demo...');
    await page.goto('https://2captcha.com/demo/hcaptcha', {
        waitUntil: 'networkidle0',
        timeout: 30000
    });
    
    console.log('✓ Page loaded');
    
    // Wait a bit for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check what's on the page
    const pageInfo = await page.evaluate(() => {
        const captchaElements = document.querySelectorAll('[class*="captcha"], [id*="captcha"], .h-captcha');
        const iframes = document.querySelectorAll('iframe');
        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src).filter(Boolean);
        
        return {
            captchaElements: Array.from(captchaElements).map(el => ({
                tag: el.tagName,
                className: el.className,
                id: el.id,
                hasDataSitekey: el.hasAttribute('data-sitekey'),
                sitekey: el.getAttribute('data-sitekey')
            })),
            iframes: Array.from(iframes).map(f => ({
                src: f.src,
                width: f.width,
                height: f.height
            })),
            scripts: scripts.filter(s => s.includes('hcaptcha') || s.includes('captcha')),
            bodyText: document.body.innerText.substring(0, 500)
        };
    });
    
    console.log('\n📋 Page Information:');
    console.log('Captcha Elements:', JSON.stringify(pageInfo.captchaElements, null, 2));
    console.log('\niFrames:', JSON.stringify(pageInfo.iframes, null, 2));
    console.log('\nScripts:', pageInfo.scripts);
    console.log('\nBody Text Preview:', pageInfo.bodyText);
    
    // Wait longer to see if iframe appears
    console.log('\n⏳ Waiting 10 seconds to see if hCaptcha loads...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const afterWait = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        return Array.from(iframes).map(f => f.src);
    });
    
    console.log('\n🔍 iFrames after waiting:', afterWait);
    
    console.log('\n✓ Test complete. Browser will stay open for inspection...');
    
    // Keep browser open
    await new Promise(resolve => setTimeout(resolve, 30000));
    await browser.close();
})();
