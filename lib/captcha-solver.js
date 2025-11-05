const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const CaptchaWatcher = require('./captcha-watcher');
const createLogger = require('../utils/logger');
const { createCursor } = require('ghost-cursor');
const axios = require('axios');
const { detectChallengeType, waitForChallengeReady } = require('./challenge-detector');
const { solveBoundingBoxChallenge } = require('./bounding-box-solver');
const { solveJigsawChallenge } = require('./jigsaw-solver');
const { solveMultipleChoiceChallenge } = require('./multiple-choice-solver');
const { analyzePatternCompletion, classifySpatialType } = require('./spatial-reasoning');
const { ImageDragDropChallenge, SPATIAL_TYPES } = require('./models');

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
            '--window-size=2560,1440',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--lang=en',
            '--single-process',
            '--disable-extensions',
            '--start-maximized',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null,
    });

    return browser;
}

async function setPageZoom(page, zoomLevel = 0.7) {
    // Zoom disabled to prevent click/drag coordinate issues
    // Using larger window size instead (2560x1440)
    logger.debug(`✓ Using large window size for better visibility`);
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

        const finalPrompt = `You are an expert visual recognition AI analyzing a hCaptcha challenge. Your task is to identify which grid tiles contain the TARGET OBJECT with high precision.

🎯 TARGET OBJECT: **${mainPrompt.toUpperCase()}**

📐 GRID LAYOUT (row, column coordinates):
${gridDesc}

🔍 VISUAL RECOGNITION GUIDELINES:

1. **Object Identification Standards:**
   - ✅ INCLUDE: Clear, unmistakable instances of "${mainPrompt}"
   - ✅ INCLUDE: Partially visible objects (cut off by edges) if you can confidently identify them
   - ✅ INCLUDE: Objects at any angle, rotation, or perspective
   - ✅ INCLUDE: Small or large instances, as long as identifiable
   - ❌ EXCLUDE: Ambiguous, blurry, or uncertain objects
   - ❌ EXCLUDE: Similar but different objects (e.g., "motorcycle" ≠ "bicycle")
   - ❌ EXCLUDE: Reflections, shadows, or paintings/images of the object (unless specifically asked for)

2. **Common Object Categories & Similar Confusions:**
   - 🚗 Vehicles: car vs truck vs SUV, motorcycle vs bicycle vs scooter, bus vs van
   - 🐾 Animals: cat vs dog, horse vs donkey, bird vs airplane
   - 🏗️ Structures: bridge vs overpass, stairs vs ladder, chimney vs tower
   - 🚦 Street Objects: traffic light vs street light, fire hydrant vs mailbox
   - 🌳 Nature: tree vs bush, mountain vs hill, flower vs plant
   - 📱 Objects: phone vs tablet, chair vs stool, umbrella vs tent

3. **Precision vs Recall Trade-off:**
   - FALSE POSITIVES (marking wrong tiles) = CRITICAL FAILURE
   - FALSE NEGATIVES (missing tiles) = Less critical but still avoid
   - When in doubt: Mark as "has_match": false (conservative approach)
   - Confidence threshold: Only mark true if you're >85% certain

4. **Edge Cases:**
   - Partial objects visible at tile edges: Include if >40% visible and clearly identifiable
   - Tiny/distant objects: Include only if you can definitively identify the object type
   - Multiple similar objects: Evaluate each one independently
   - Context clues: Use surrounding environment to help identify ambiguous cases

5. **Quality Check:**
   - Re-examine each "true" marking: "Am I absolutely sure this is ${mainPrompt}?"
   - If ANY doubt exists → mark as false
   - Better to solve the challenge in 2 rounds than fail with wrong clicks

📊 RESPONSE FORMAT (JSON only, no explanations):
{
  "[1,1]": {"has_match": false},
  "[1,2]": {"has_match": true},
  ... (continue for all tiles)
}

🎯 TARGET: ${mainPrompt}
⚠️ Respond with JSON ONLY. No additional text.`;

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
            model: 'gemini-2.0-flash',
            contents: contents,
            config: {
                temperature: 0.05,
                topP: 0.9,
                topK: 20,
                maxOutputTokens: 2048,
            }
        });

        if (!result || !result.response) {
            throw new Error('No response from Gemini API');
        }

        const response = result.response.text();
        logger.debug("Gemini Response:", response);

        let jsonStr = response;
        if (response && response.includes('```json')) {
            jsonStr = response.split('```json')[1].split('```')[0].trim();
        } else if (response && response.includes('```')) {
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

    const challengeArea = await frame.$('.challenge-view, .task-grid');
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
        let cleanCoord = coord.trim();
        if (cleanCoord.startsWith('[') && cleanCoord.endsWith(']')) {
            cleanCoord = cleanCoord.substring(1, cleanCoord.length - 1);
        }
        
        const [row, col] = cleanCoord.split(',').map(s => parseInt(s.trim()));
        
        const tilePosition = await frame.evaluate((row, col) => {
            const tiles = document.querySelectorAll('.task-image');
            const gridSize = tiles.length === 9 ? 3 : 4;
            const index = (row - 1) * gridSize + (col - 1);
            
            if (!tiles[index]) return null;
            
            const rect = tiles[index].getBoundingClientRect();
            return {
                frameRelativeX: rect.left + rect.width / 2,
                frameRelativeY: rect.top + rect.height / 2,
                width: rect.width,
                height: rect.height
            };
        }, row, col);
        
        if (!tilePosition) {
            logger.error(`Tile at [${row},${col}] not found`);
            return false;
        }
        
        const page = frame.page ? frame.page() : frame;
        
        const frameElement = await frame.frameElement();
        let iframeOffset = { x: 0, y: 0 };
        
        if (frameElement) {
            iframeOffset = await frameElement.evaluate((iframe) => {
                const rect = iframe.getBoundingClientRect();
                const scrollX = window.scrollX || window.pageXOffset || 0;
                const scrollY = window.scrollY || window.pageYOffset || 0;
                return {
                    x: rect.left + scrollX,
                    y: rect.top + scrollY
                };
            });
        }
        
        const pageX = tilePosition.frameRelativeX + iframeOffset.x;
        const pageY = tilePosition.frameRelativeY + iframeOffset.y;
        
        const cursor = createCursor(page);
        
        await cursor.moveTo(
            { x: pageX, y: pageY },
            { 
                hesitate: Math.random() * 100 + 50,
                moveDelay: Math.random() * 800 + 400
            }
        );
        
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        await page.mouse.click(pageX, pageY, { delay: 50 + Math.random() * 50 });
        
        return true;
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

        logger.info('⏳ Waiting for captcha to be ready...');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for captcha to be ready (30s)'));
            }, 30000);
            
            watcher.onCaptchaReady((captchaInfo) => {
                clearTimeout(timeout);
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
        logger.info('🖱️  Clicked hCaptcha checkbox');

        logger.info('⏳ Waiting for challenge or token (max 15s)...');
        const result = await Promise.race([
            waitForToken(watcher),
            waitForChallenge(watcher),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for challenge/token after checkbox click')), 15000))
        ]).catch(error => {
            logger.error(`Timeout: ${error.message}`);
            logger.info('💡 Challenge might not have appeared. Checking current state...');
            return null;
        });

        if (result?.type === 'token') {
            logger.info('🎉 Captcha solved immediately!');
            return result.value;
        }
        
        if (!result) {
            logger.warn('⚠️  No challenge detected after clicking checkbox');
            logger.info('🔍 This might be an auto-pass scenario or the challenge failed to load');
            
            const tokenAfterWait = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 3000);
                watcher.onTokenFound((tokenInfo) => {
                    clearTimeout(timeout);
                    resolve(tokenInfo.token);
                });
            });
            
            if (tokenAfterWait) {
                logger.info('🎉 Token received after additional wait!');
                return tokenAfterWait;
            }
            
            return null;
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
    const maxAttempts = 5;
    let attempts = 0;
    let lastError = null;

    const frame = watcher.getChallengeFrame();
    if (!frame) {
        logger.error('No challenge frame available');
        return null;
    }

    await new Promise(resolve => setTimeout(resolve, 800));

    const challengeType = await detectChallengeType(frame);
    
    if (challengeType.type === 'BOUNDING_BOX') {
        logger.info('🎯 Using BOUNDING_BOX solver');
        
        for (let attempt = 1; attempt <= 2; attempt++) {
            if (attempt > 1) {
                logger.info(`🔄 Retry attempt ${attempt} for bounding box`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            const success = await solveBoundingBoxChallenge(
                watcher.page || frame.page(),
                frame,
                challengeType.prompt?.text || 'Click on matching objects',
                apiKey,
                screenshotDir,
                enableScreenshot
            );
            
            if (success) {
                const token = await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
                if (token) {
                    logger.info('🎉 Bounding box challenge solved!');
                    return token;
                }
            }
            
            if (attempt < 2) {
                logger.warn(`⚠️ Bounding box attempt ${attempt} failed, retrying...`);
            }
        }
        
        logger.warn('❌ Bounding box challenge failed after retries');
        return null;
    }
    
    if (challengeType.type === 'JIGSAW_SLIDER') {
        logger.info('🧩 Using JIGSAW/SLIDER solver');
        
        for (let attempt = 1; attempt <= 2; attempt++) {
            if (attempt > 1) {
                logger.info(`🔄 Retry attempt ${attempt} for jigsaw`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            const success = await solveJigsawChallenge(
                watcher.page || frame.page(),
                frame,
                challengeType.prompt?.text || 'Move the piece to the correct position',
                apiKey,
                screenshotDir,
                enableScreenshot
            );
            
            if (success) {
                const token = await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
                if (token) {
                    logger.info('🎉 Jigsaw challenge solved!');
                    return token;
                }
            }
            
            if (attempt < 2) {
                logger.warn(`⚠️ Jigsaw attempt ${attempt} failed, retrying...`);
            }
        }
        
        logger.warn('❌ Jigsaw challenge failed after retries');
        return null;
    }
    
    if (challengeType.type === 'MULTIPLE_CHOICE') {
        logger.info('🤔 Using MULTIPLE_CHOICE solver');
        const success = await solveMultipleChoiceChallenge(
            watcher.page || frame.page(),
            frame,
            challengeType,
            apiKey,
            screenshotDir,
            enableScreenshot
        );
        
        if (success) {
            const token = await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
            if (token) {
                logger.info('🎉 Multiple choice challenge solved!');
                return token;
            }
        }
        
        logger.warn('❌ Multiple choice challenge failed');
        return null;
    }

    logger.info('🎯 Using GRID_BASED solver');
    
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
        const promptElement = document.querySelector('.prompt-text, .challenge-prompt');
        if (!promptElement) return null;

        const text = promptElement.textContent.trim();
        const hasCorrectFormat = text.includes('Select all') || text.includes('Please click');

        let promptText = '';
        const strongElement = promptElement.querySelector('strong');
        if (strongElement) {
            promptText = strongElement.textContent.trim();
        } else {
            const match = text.match(/(?:Select all|Please click each image containing) (?:a |an |the )?(.*?)(?:$|\.|\n)/i);
            if (match) {
                promptText = match[1].trim();
            }
        }

        const tiles = document.querySelectorAll('.task-image');
        const gridSize = tiles.length === 9 ? 3 : 4;
        const gridType = gridSize === 3 ? '33' : '44';

        return {
            text: text,
            promptText: promptText,
            hasCorrectFormat: hasCorrectFormat,
            isDynamic: text.includes('verify once there are none') || text.includes('new images will appear'),
            gridType: gridType
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
            model: 'gemini-2.0-flash',
            contents: contents,
            config: {
                temperature: 0.1,
            }
        });

        const transcription = result.response.text().trim();
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
        
        const audioButton = await frame.$('.button-audio, [aria-label="Get an audio challenge"]');
        if (!audioButton) {
            logger.warn('Audio button not found');
            return null;
        }

        logger.info('🖱️  Clicking audio button with human-like movement...');
        const cursor = createCursor(page);
        
        await cursor.move(audioButton, {
            hesitate: Math.random() * 150 + 100,
            moveDelay: Math.random() * 1200 + 800
        });
        
        await humanDelay(300, 700);
        await cursor.click();
        
        logger.info('✓ Audio button clicked');
        
        await humanDelay(2000, 3500);
        
        const audioSourceUrl = await frame.evaluate(() => {
            const audioElement = document.querySelector('audio source, .audio-download-link, audio');
            return audioElement ? audioElement.getAttribute('src') || audioElement.src : null;
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
        
        const audioInput = await frame.$('input[type="text"], .audio-input, input[name="audio"]');
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
        
        const verifyButton = await frame.$('.button-submit, [type="submit"]');
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
            new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 300000))
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

    const verifyButton = await frame.$('.button-submit, [type="submit"]');
    if (!verifyButton) {
        logger.error('Could not find verify button');
        return null;
    }

    await verifyButton.click();
    logger.info('✓ Clicked verify button');
    logger.info('⏳ Waiting for token or new challenge (max 30s)...');

    const result = await Promise.race([
        waitForToken(watcher),
        waitForNewChallenge(watcher),
        new Promise(resolve => setTimeout(() => resolve({ type: 'timeout' }), 30000))
    ]);

    if (result?.type === 'token') {
        logger.info('✅ Verification successful - token received');
        return result.value;
    }

    if (result?.type === 'challenge') {
        logger.info('🔄 New challenge appeared after verification');
        const newChallengeInfo = result.value;

        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

        const newChallengeType = await detectChallengeType(frame);
        logger.info(`🔍 New challenge type: ${newChallengeType.type}`);

        if (newChallengeType.type === 'BOUNDING_BOX') {
            const success = await solveBoundingBoxChallenge(
                watcher.page || frame.page(),
                frame,
                newChallengeType.prompt?.text || 'Click on matching objects',
                apiKey,
                screenshotDir,
                enableScreenshot
            );
            
            if (success) {
                return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
            }
            logger.error('Failed to solve new BOUNDING_BOX challenge');
            return null;
        }
        
        if (newChallengeType.type === 'JIGSAW_SLIDER') {
            const success = await solveJigsawChallenge(
                watcher.page || frame.page(),
                frame,
                newChallengeType.prompt?.text || 'Move the piece',
                apiKey,
                screenshotDir,
                enableScreenshot
            );
            
            if (success) {
                return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
            }
            logger.error('Failed to solve new JIGSAW_SLIDER challenge');
            return null;
        }

        if (newChallengeType.type === 'MULTIPLE_CHOICE') {
            const success = await solveMultipleChoiceChallenge(
                watcher.page || frame.page(),
                frame,
                newChallengeType.prompt?.text || 'Select the correct answer',
                apiKey,
                screenshotDir,
                enableScreenshot
            );
            
            if (success) {
                return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
            }
            logger.error('Failed to solve new MULTIPLE_CHOICE challenge');
            return null;
        }

        const success = await handleChallengeTiles(watcher, newChallengeInfo, apiKey, screenshotDir, enableScreenshot);
        if (!success) {
            logger.error('Failed to handle new challenge tiles');
            return null;
        }

        return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
    }

    if (result?.type === 'timeout') {
        logger.warn('⚠️ Timeout waiting for token/challenge, checking manually...');
        
        const manualToken = await watcher.page.evaluate(() => {
            const textarea = document.querySelector('textarea[name="h-captcha-response"]');
            return textarea ? textarea.value : null;
        }).catch(() => null);
        
        if (manualToken) {
            logger.info('✅ Token found after manual check!');
            return manualToken;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const newChallengeType = await detectChallengeType(frame).catch(() => ({ type: 'UNKNOWN' }));
        
        if (newChallengeType.type !== 'UNKNOWN') {
            logger.info(`🔄 New ${newChallengeType.type} challenge detected after timeout`);
            
            if (newChallengeType.type === 'BOUNDING_BOX') {
                const success = await solveBoundingBoxChallenge(
                    watcher.page || frame.page(),
                    frame,
                    newChallengeType.prompt?.text || 'Click on matching objects',
                    apiKey,
                    screenshotDir,
                    enableScreenshot
                );
                
                if (success) {
                    return await verifyChallenge(watcher, apiKey, screenshotDir, enableScreenshot);
                }
            }
        }
    }

    logger.warn('Verification timed out - no token or new challenge found');
    return null;
}

module.exports = {
    launchBrowser,
    solveCaptchaChallenge,
    solveCaptchaWithStrategy,
    solveAudioChallenge,
    setLogger,
    setPageZoom
};
