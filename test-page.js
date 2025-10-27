const puppeteer = require('puppeteer');
const { exec } = require('child_process');

async function test() {
    let executablePath;
    try {
        executablePath = require('child_process').execSync('which chromium').toString().trim();
        console.log(`Using chromium: ${executablePath}`);
    } catch (e) {
        console.log('Using bundled chromium');
    }

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
    });

    const page = await browser.newPage();
    const sitekey = '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';
    const url = `http://localhost:8000/fakepage.html?sitekey=${sitekey}`;
    
    console.log(`Loading: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('\n=== Page Loaded ===');
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const grecaptchaStatus = await page.evaluate(() => {
        return {
            grecaptchaExists: typeof grecaptcha !== 'undefined',
            grecaptchaReady: typeof grecaptcha !== 'undefined' && typeof grecaptcha.render === 'function',
            error: window.lastError || 'none'
        };
    });
    
    console.log('\n=== Grecaptcha Status ===');
    console.log(grecaptchaStatus);
    
    console.log('\n=== Manually calling grecaptcha.render() ===');
    await page.evaluate(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const sitekey = urlParams.get('sitekey') || '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';
        
        grecaptcha.render('recaptcha-element', {
            'sitekey': sitekey
        });
        
        console.log('Render called with sitekey:', sitekey);
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const frames = page.frames();
    console.log(`\nTotal frames: ${frames.length}`);
    
    frames.forEach((frame, index) => {
        console.log(`Frame ${index}: ${frame.url()}`);
    });
    
    const hasRecaptchaElement = await page.evaluate(() => {
        return {
            hasRecaptchaDiv: !!document.querySelector('.g-recaptcha'),
            hasRecaptchaElement: !!document.querySelector('#recaptcha-element'),
            hasTextarea: !!document.querySelector('textarea[name="g-recaptcha-response"]'),
            sitekeyDisplay: document.querySelector('#sitekey-display')?.textContent,
            domainDisplay: document.querySelector('#domain-display')?.textContent,
        };
    });
    
    console.log('\n=== Page Elements ===');
    console.log(hasRecaptchaElement);
    
    const anchorFrame = frames.find(f => f.url().includes('api2/anchor'));
    if (anchorFrame) {
        console.log('\n=== Found Anchor Frame! ===');
        const checkboxExists = await anchorFrame.evaluate(() => {
            return {
                hasCheckbox: !!document.querySelector('.recaptcha-checkbox-border'),
                body: document.body.innerHTML.substring(0, 200)
            };
        });
        console.log(checkboxExists);
    } else {
        console.log('\n❌ No anchor frame found');
    }
    
    await browser.close();
}

test().catch(console.error);
