const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const createLogger = require('../utils/logger');
const { createCursor } = require('ghost-cursor');

let logger = createLogger({ level: 'info' });

function setLogger(newLogger) {
    logger = newLogger;
}

async function humanDelay(minMs = 500, maxMs = 1500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function analyzeBoundingBoxWithGemini(screenshotPath, promptText, canvasSize, apiKey, enableScreenshot = false) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🔍 Analyzing bounding box challenge: ${promptText}`);
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const geminiPrompt = `Analyze this hCaptcha challenge. Task: "${promptText}". Canvas size: ${canvasSize.width}x${canvasSize.height} pixels.

Find objects matching the task and return their center coordinates as JSON:
{"clicks": [{"x": 120, "y": 95}, {"x": 410, "y": 350}], "reasoning": "explanation"}

Common tasks:
- "all [object]" = find every instance
- "different/doesn't match" = find outliers
- "largest" = find biggest one

Return ONLY valid JSON, no markdown.`;

        const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{
                inlineData: { mimeType: "image/png", data: imageBase64 }
            }, geminiPrompt],
            config: {
                temperature: 0.1,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 512,
            }
        });

        if (!result || !result.text) {
            throw new Error('No response from Gemini API');
        }

        const response = result.text;
        logger.debug("Gemini Response:", response);

        let jsonStr = response.trim();
        if (jsonStr.includes('```json')) {
            jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
        } else if (jsonStr.includes('```')) {
            jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
        }

        const jsonResponse = JSON.parse(jsonStr);
        
        if (!jsonResponse.clicks) {
            throw new Error('Invalid response - missing clicks array');
        }
        
        logger.info(`✓ Found ${jsonResponse.clicks.length} click points`);
        if (jsonResponse.reasoning) {
            logger.info(`💡 ${jsonResponse.reasoning}`);
        }

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (e) {}
        }

        return jsonResponse.clicks;

    } catch (error) {
        logger.error(`❌ Gemini Error: ${error.message}`);
        
        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (e) {}
        }
        
        return null;
    }
}

async function solveBoundingBoxChallenge(page, frame, promptText, apiKey, screenshotDir, enableScreenshot = false) {
    try {
        logger.info('🎯 Solving BOUNDING_BOX challenge...');
        
        const canvasInfo = await frame.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            return {
                width: canvas.width,
                height: canvas.height,
                boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            };
        });
        
        if (!canvasInfo) {
            logger.error('Canvas not found');
            return false;
        }
        
        logger.info(`📐 Canvas: ${canvasInfo.width}x${canvasInfo.height}`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const screenshotPath = path.join(screenshotDir, `bbox_${Date.now()}.png`);
        const canvas = await frame.$('canvas');
        if (!canvas) {
            logger.error('Canvas element not found');
            return false;
        }
        
        await canvas.screenshot({ path: screenshotPath, type: 'png' });
        
        if (enableScreenshot) {
            logger.info(`📸 Screenshot: ${screenshotPath}`);
        }
        
        const clickPoints = await analyzeBoundingBoxWithGemini(
            screenshotPath,
            promptText,
            { width: canvasInfo.width, height: canvasInfo.height },
            apiKey,
            enableScreenshot
        );
        
        if (!clickPoints || clickPoints.length === 0) {
            logger.warn('No click points');
            return false;
        }
        
        const cursor = createCursor(page);
        logger.info(`🖱️  Clicking ${clickPoints.length} points...`);
        
        for (let i = 0; i < clickPoints.length; i++) {
            const point = clickPoints[i];
            
            const canvasPos = await frame.evaluate((selector, px, py) => {
                const c = document.querySelector(selector);
                if (!c) return null;
                const rect = c.getBoundingClientRect();
                const scaleX = rect.width / c.width;
                const scaleY = rect.height / c.height;
                return {
                    x: rect.left + (px * scaleX),
                    y: rect.top + (py * scaleY)
                };
            }, 'canvas', point.x, point.y);
            
            if (!canvasPos) continue;
            
            await cursor.moveTo({ x: canvasPos.x, y: canvasPos.y }, {
                hesitate: Math.random() * 100 + 50,
                moveDelay: Math.random() * 800 + 400
            });
            
            await humanDelay(100, 300);
            await cursor.click();
            
            logger.info(`  ✓ Point ${i + 1}/${clickPoints.length} (${point.x}, ${point.y})`);
            await humanDelay(400, 800);
        }
        
        logger.info('✓ Bounding box complete');
        return true;
        
    } catch (error) {
        logger.error(`Error: ${error.message}`);
        return false;
    }
}

module.exports = {
    solveBoundingBoxChallenge,
    analyzeBoundingBoxWithGemini,
    setLogger
};
