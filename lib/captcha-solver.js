const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const CaptchaWatcher = require('./captcha-watcher');
const createLogger = require('../utils/logger');
const { createCursor } = require('ghost-cursor');
const axios = require('axios');

puppeteerExtra.use(StealthPlugin());

let logger = createLogger({ level: 'info' });

function setLogger(newLogger) {
    logger = newLogger;
}

async function humanDelay(minMs = 500, maxMs = 1500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function humanClick(page, selector, useCursor = true) {
    try {
        await humanDelay(300, 800);
        
        if (useCursor) {
            const cursor = createCursor(page);
            const element = await page.$(selector);
            if (element) {
                await cursor.move(element, {
                    hesitate: Math.random() * 100 + 50,
                    moveDelay: Math.random() * 1000 + 500
                });
                await humanDelay(200, 500);
                await cursor.click();
                return true;
            }
        } else {
            await page.click(selector);
            return true;
        }
        return false;
    } catch (error) {
        logger.debug(`Human click error: ${error.message}`);
        return false;
    }
}

async function launchBrowser(headless = false) {
    const execSync = require('child_process').execSync;
    let executablePath;
    
    try {
        executablePath = execSync('which chromium').toString().trim();
        logger.info(`Using system chromium: ${executablePath}`);
    } catch (e) {
        executablePath = undefined;
        logger.info('Using bundled chromium');
    }

    const browser = await puppeteerExtra.launch({
        headless: headless,
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--enable-webgl',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--lang=en',
            '--single-process',
            '--disable-extensions',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
    });

    return browser;
}

async function analyzeWithGemini(screenshotPath, prompt, gridType, apiKey, enableScreenshot = false) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🔍 Analyzing: ${prompt}`);

        const mainPrompt = prompt.split('Click verify once there are none left')[0].trim()
            .replace(/\.$/, '');

        const ai = new GoogleGenAI({ apiKey: apiKey });

        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');

        const gridDesc = gridType.includes('44') ?
            `Row 4: [1,1] - [1,2] - [1,3] - [1,4]
             Row 3: [2,1] - [2,2] - [2,3] - [2,4]
             Row 2: [3,1] - [3,2] - [3,3] - [3,4]
             Row 1: [4,1] - [4,2] - [4,3] - [4,4]` :
            `Row 3: [1,1] - [1,2] - [1,3]
             Row 2: [2,1] - [2,2] - [2,3]
             Row 1: [3,1] - [3,2] - [3,3]`;

        const finalPrompt = `For each tile in the grid, check if it contains a VISIBLE -- ${mainPrompt.toUpperCase()} -- .
If the object is not present in ANY of the tiles, mark ALL tiles as "has_match": false.
Only mark a tile as "has_match": true if you are CERTAIN the object appears in that specific tile.
Respond with a JSON object where each key is the tile coordinate in [row,col] format and the value has a 'has_match' boolean.

Grid layout (row,column coordinates):
${gridDesc}

Important: If ${mainPrompt} does not appear in ANY tile, ALL tiles should have "has_match": false.
Respond ONLY with the JSON object.`;

        const contents = [
            {
                inlineData: {
                    mimeType: "image/png",
                    data: imageBase64
                }
            },
            finalPrompt
        ];

        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                temperature: 0.1,
                topP: 0.95,
                topK: 40,
            }
        });

        const response = result.text;
        logger.debug("Gemini Response:", response);

        let jsonStr = response;
        if (response.includes('```json')) {
            jsonStr = response.split('```json')[1].split('```')[0].trim();
        } else if (response.includes('```')) {
            jsonStr = response.split('```')[1].split('```')[0].trim();
        }

        const jsonResponse = JSON.parse(jsonStr);
        const tilesToClick = Object.entries(jsonResponse)
            .filter(([_, data]) => data.has_match)
            .map(([coord]) => coord);

        logger.info(`✓ Found ${tilesToClick.length} tiles to click: ${tilesToClick.join(', ')}`);

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete temporary screenshot: ${unlinkError.message}`);
            }
        }

        return tilesToClick;

    } catch (error) {
        logger.error(`❌ Gemini Analysis Error: ${error.message}`);
        
        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete temporary screenshot: ${unlinkError.message}`);
            }
        }
        
        return null;
    }
}

async function takeScreenshotAndAnalyze(frame, challengeInfo, watcher, iterationInfo = '', apiKey, screenshotDir, enableScreenshot = false) {
    const timestamp = Date.now();
    const screenshotPath = path.join(screenshotDir, `challenge_${timestamp}.png`);

    const challengeArea = await frame.$('.rc-imageselect-challenge');
    if (!challengeArea) {
        logger.error('Could not find challenge area element');
        return null;
    }

    await new Promise((resolve, reject) => {
        let hasResolved = false;
        const timeout = setTimeout(() => {
            if (!hasResolved) {
                reject(new Error('Timeout waiting for tiles to be ready'));
            }
        }, 10000);

        watcher.onTilesReady(() => {
            if (!hasResolved) {
                hasResolved = true;
                clearTimeout(timeout);
                resolve();
            }
        });
    }).catch(error => {
        logger.error('Error waiting for tiles:', error.message);
        return null;
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    await challengeArea.screenshot({
        path: screenshotPath,
        type: 'png',
        omitBackground: false
    });

    if (enableScreenshot) {
        logger.info(`📸 Screenshot saved: ${screenshotPath} ${iterationInfo}`);
    }

    const result = await analyzeWithGemini(
        screenshotPath,
        challengeInfo.promptText || challengeInfo.text,
        challengeInfo.gridType,
        apiKey,
        enableScreenshot
    );

    return result;
}

async function clickTile(frame, coord, challengeInfo) {
    try {
        return await frame.evaluate((coord) => {
            const tiles = document.querySelectorAll('.rc-imageselect-tile');
            const gridSize = tiles.length === 9 ? 3 : 4;
            
            let cleanCoord = coord.trim();
            if (cleanCoord.startsWith('[') && cleanCoord.endsWith(']')) {
                cleanCoord = cleanCoord.substring(1, cleanCoord.length - 1);
            }
            
            const [row, col] = cleanCoord.split(',').map(s => parseInt(s.trim()));
            const index = (row - 1) * gridSize + (col - 1);

            if (tiles[index]) {
                tiles[index].click();
                return true;
            }
            return false;
        }, coord);
    } catch (error) {
        logger.error(`Error clicking tile ${coord}: ${error.message}`);
        return false;
    }
}

async function waitForToken(watcher) {
    return new Promise((resolve) => {
        watcher.onTokenFound((tokenInfo) => {
            resolve({ type: 'token', value: tokenInfo.token });
        });
    });
}

async function waitForChallenge(watcher) {
    return new Promise((resolve) => {
        watcher.onChallengeOpen((info) => {
            logger.info(`🎯 Challenge Detected: ${info.text}`);
            logger.info(`📋 Dynamic: ${info.isDynamic}`);
            resolve({ type: 'challenge', value: info });
        });
    });
}

async function waitForNewChallenge(watcher) {
    return new Promise((resolve) => {
        watcher.onChallengeChange((info) => {
            logger.info(`🔄 Challenge Changed: ${info.text}`);
            resolve({ type: 'challenge', value: info });
        });
    });
}

async function solveCaptchaWithStrategy(page, apiKey, screenshotDir, enableScreenshot = false, useAudio = false) {
    const watcher = new CaptchaWatcher();
    watcher.setPage(page);

    try {
        page.on('dialog', async dialog => {
            logger.warn('Alert detected:', dialog.message());
            await dialog.accept();
        });

        await new Promise((resolve) => {
            watcher.onCaptchaReady((captchaInfo) => {
                logger.info('✅ Captcha Ready');
                resolve();
            });
        });

        const checkbox = watcher.getCheckbox();
        if (!checkbox) {
            logger.error('Could not get checkbox element');
            return null;
        }

        await humanDelay(500, 1200);
        await checkbox.click();
        logger.info('🖱️  Clicked reCAPTCHA checkbox');

        const result = await Promise.race([
            waitForToken(watcher),
            waitForChallenge(watcher)
        ]);

        if (result?.type === 'token') {
            logger.info('🎉 Captcha solved immediately!');
            return result.value;
        }

        if (useAudio) {
            logger.info('🎵 Audio mode enabled - attempting audio challenge...');
            await humanDelay(1000, 2000);
            const audioToken = await solveAudioChallenge(page, watcher, apiKey);
            if (audioToken) {
                return audioToken;
            }
            logger.warn('Audio challenge failed, falling back to image challenge...');
        }

        return await solveChallengeLoop(watcher, apiKey, screenshotDir, enableScreenshot);

    } catch (error) {
        logger.error('Error in solveCaptcha:', error);
        return null;
    } finally {
        watcher.cleanup();
    }
}

async function solveCaptchaChallenge(page, apiKey, screenshotDir, enableScreenshot = false) {
    return await solveCaptchaWithStrategy(page, apiKey, screenshotDir, enableScreenshot, false);
}

async function solveChallengeLoop(watcher, apiKey, screenshotDir, enableScreenshot = false) {
    const maxAttempts = 4;
    let attempts = 0;

    while (attempts < maxAttempts) {
        const challengeInfo = await getCurrentChallenge(watcher);
        if (!challengeInfo) {
            logger.warn('Failed to get valid challenge');
            attempts++;
            continue;
        }

        const success = await handleChallengeTiles(watcher, challengeInfo, apiKey, screenshotDir, enableScreenshot);
        if (!success) {
            logger.warn(`❌ Challenge attempt ${attempts + 1} failed`);
            attempts++;
            continue;
        }

        const token = await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
        if (token) {
            logger.info('🎉 Challenge solved successfully!');
            return token;
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.error(`❌ Challenge failed after ${maxAttempts} attempts`);
    return null;
}

async function getCurrentChallenge(watcher) {
    const frame = watcher.getChallengeFrame();
    if (!frame) {
        logger.error('No challenge frame available');
        return null;
    }

    const challengeInfo = await frame.evaluate(() => {
        const promptElement = document.querySelector('.rc-imageselect-instructions');
        if (!promptElement) return null;

        const text = promptElement.textContent.trim();
        const hasCorrectFormat = text.includes('Select all images with');

        let promptText = '';
        const strongElement = promptElement.querySelector('strong');
        if (strongElement) {
            promptText = strongElement.textContent.trim();
        } else {
            const match = text.match(/Select all images with (.*?)(?:$|\.|\n)/i);
            if (match) {
                promptText = match[1].trim();
            }
        }

        return {
            text: text,
            promptText: promptText,
            hasCorrectFormat: hasCorrectFormat,
            isDynamic: text.includes('Click verify once there are none left'),
            gridType: document.querySelector('.rc-imageselect-table-33, .rc-imageselect-table-44')?.className || ''
        };
    });

    return challengeInfo;
}

async function handleChallengeTiles(watcher, challengeInfo, apiKey, screenshotDir, enableScreenshot = false) {
    const maxDynamicIterations = 4;
    let dynamicIteration = 0;

    while (true) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const tilesToClick = await takeScreenshotAndAnalyze(
            watcher.getChallengeFrame(),
            challengeInfo,
            watcher,
            challengeInfo.isDynamic ? `(${dynamicIteration + 1}/${maxDynamicIterations})` : '',
            apiKey,
            screenshotDir,
            enableScreenshot
        );

        if (!tilesToClick) {
            logger.error('Failed to get Gemini analysis');
            return false;
        }

        if (tilesToClick.length === 0) {
            logger.info('✓ No matching tiles found - proceeding to verify');
            return true;
        }

        logger.info('🖱️  Clicking tiles...');
        for (const coord of tilesToClick) {
            const clicked = await clickTile(watcher.getChallengeFrame(), coord, challengeInfo);
            if (!clicked) {
                logger.error(`Failed to click tile ${coord}`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
        }
        logger.info('✓ Finished clicking tiles');

        if (!challengeInfo.isDynamic) break;

        dynamicIteration++;
        if (dynamicIteration >= maxDynamicIterations) {
            logger.info(`Reached maximum dynamic iterations (${maxDynamicIterations})`);
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return true;
}

async function downloadAudio(audioUrl) {
    try {
        const response = await axios.get(audioUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return Buffer.from(response.data);
    } catch (error) {
        logger.error(`Error downloading audio: ${error.message}`);
        return null;
    }
}

async function transcribeAudioWithGemini(audioBuffer, apiKey) {
    try {
        logger.info('🎤 Transcribing audio with Gemini...');
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const audioBase64 = audioBuffer.toString('base64');

        const contents = [
            {
                inlineData: {
                    mimeType: "audio/mp3",
                    data: audioBase64
                }
            },
            "Transcribe this audio carefully. Return ONLY the exact words or numbers spoken, without any additional text, explanations, or formatting. Just the raw transcription."
        ];

        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                temperature: 0.1,
            }
        });

        const transcription = result.text.trim();
        logger.info(`✓ Transcription: ${transcription}`);
        return transcription;

    } catch (error) {
        logger.error(`❌ Gemini Transcription Error: ${error.message}`);
        return null;
    }
}

async function solveAudioChallenge(page, watcher, apiKey) {
    try {
        const frame = watcher.getChallengeFrame();
        if (!frame) {
            logger.error('No challenge frame for audio');
            return null;
        }

        logger.info('🎵 Attempting audio challenge...');
        
        await humanDelay(800, 1500);
        
        const audioButton = await frame.$('#recaptcha-audio-button');
        if (!audioButton) {
            logger.warn('Audio button not found');
            return null;
        }

        logger.info('🖱️  Clicking audio button with human-like movement...');
        const cursor = createCursor(page, await frame.executionContext());
        
        await cursor.move(audioButton, {
            hesitate: Math.random() * 150 + 100,
            moveDelay: Math.random() * 1200 + 800
        });
        
        await humanDelay(300, 700);
        await cursor.click();
        
        logger.info('✓ Audio button clicked');
        
        await humanDelay(2000, 3500);
        
        const audioSourceUrl = await frame.evaluate(() => {
            const audioElement = document.querySelector('#audio-source, .rc-audiochallenge-tdownload-link');
            return audioElement ? audioElement.getAttribute('src') || audioElement.href : null;
        });

        if (!audioSourceUrl) {
            logger.error('Could not find audio source URL');
            return null;
        }

        const fullAudioUrl = audioSourceUrl.startsWith('http') ? 
            audioSourceUrl : 
            `https://www.google.com${audioSourceUrl}`;
        
        logger.info(`📥 Downloading audio from: ${fullAudioUrl.substring(0, 60)}...`);
        const audioBuffer = await downloadAudio(fullAudioUrl);
        
        if (!audioBuffer) {
            logger.error('Failed to download audio');
            return null;
        }

        logger.info('✓ Audio downloaded successfully');
        
        const transcription = await transcribeAudioWithGemini(audioBuffer, apiKey);
        
        if (!transcription) {
            logger.error('Failed to transcribe audio');
            return null;
        }

        await humanDelay(1000, 2000);
        
        const audioInput = await frame.$('#audio-response');
        if (!audioInput) {
            logger.error('Audio input field not found');
            return null;
        }

        logger.info('⌨️  Typing transcription with human-like delays...');
        
        await audioInput.click();
        await humanDelay(300, 600);
        
        for (const char of transcription) {
            await audioInput.type(char, { 
                delay: Math.random() * 100 + 50 
            });
            await humanDelay(50, 150);
        }
        
        logger.info('✓ Transcription entered');
        
        await humanDelay(500, 1000);
        
        const verifyButton = await frame.$('#recaptcha-verify-button');
        if (!verifyButton) {
            logger.error('Verify button not found');
            return null;
        }

        await cursor.move(verifyButton, {
            hesitate: Math.random() * 100 + 50,
            moveDelay: Math.random() * 800 + 400
        });
        
        await humanDelay(200, 500);
        await cursor.click();
        
        logger.info('✓ Clicked verify button');
        
        const result = await Promise.race([
            waitForToken(watcher),
            new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 5000))
        ]);

        if (result?.type === 'token') {
            logger.info('🎉 Audio challenge solved successfully!');
            return result.value;
        }

        logger.warn('Audio challenge verification timed out or failed');
        return null;

    } catch (error) {
        logger.error(`Error in audio challenge: ${error.message}`);
        return null;
    }
}

async function verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot = false) {
    const frame = watcher.getChallengeFrame();
    if (!frame) {
        logger.error('No challenge frame available for verification');
        return null;
    }

    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

    const verifyButton = await frame.$('#recaptcha-verify-button');
    if (!verifyButton) {
        logger.error('Could not find verify button');
        return null;
    }

    await verifyButton.click();
    logger.info('✓ Clicked verify button');

    const result = await Promise.race([
        waitForToken(watcher),
        waitForNewChallenge(watcher),
        new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 5000))
    ]);

    if (result?.type === 'token') {
        logger.info('✅ Verification successful - token received');
        return result.value;
    }

    if (result?.type === 'challenge') {
        logger.info('🔄 New challenge appeared after verification');
        const newChallengeInfo = result.value;

        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

        const success = await handleChallengeTiles(watcher, newChallengeInfo, apiKey, screenshotDir, enableScreenshot);
        if (!success) {
            logger.error('Failed to handle new challenge tiles');
            return null;
        }

        return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
    }

    logger.warn('Verification timed out');
    return null;
}

module.exports = {
    launchBrowser,
    solveCaptchaChallenge,
    solveCaptchaWithStrategy,
    solveAudioChallenge,
    setLogger
};
