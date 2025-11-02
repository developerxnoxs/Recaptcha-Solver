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
        
        const geminiPrompt = `Analyze this hCaptcha challenge and return click coordinates.

TASK: "${promptText}"
Canvas: ${canvasSize.width} × ${canvasSize.height} pixels

INSTRUCTIONS:
1. Scan the entire image for ALL objects
2. Identify which objects match the task requirement
3. For each matching object, calculate its CENTER coordinate (x, y)
4. Coordinates must be integers within canvas bounds

TASK TYPES:
- "Click all [object]" → Find ALL instances of that object
- "Click different/doesn't match" → Find objects that differ from the majority
- "Click largest" → Find the single biggest object

COMMON OBJECTS TO RECOGNIZE:
Animals: cat (pointy ears), dog (floppy ears), elephant (trunk), horse, bird
Vehicles: car (4 wheels), motorcycle (2 wheels), bus (large/long), truck (cargo bed), airplane (wings)
Shapes: circle, square, triangle, star, heart
Other: phone, umbrella, chair, tree, building

JSON RESPONSE FORMAT:
{
  "clicks": [
    {"x": 120, "y": 95},
    {"x": 410, "y": 350}
  ],
  "reasoning": "Brief explanation"
}

IMPORTANT:
- Return ONLY valid JSON, no markdown
- If no objects match, return {"clicks": [], "reasoning": "No matches found"}
- Coordinates must point to object centers, not edges`;

        const contents = [
            {
                inlineData: {
                    mimeType: "image/png",
                    data: imageBase64
                }
            },
            geminiPrompt
        ];

        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                temperature: 0.05,
                topP: 0.9,
                topK: 20,
                maxOutputTokens: 1536,
            }
        });

        if (!result || !result.text) {
            throw new Error('No response from Gemini API');
        }

        const response = result.text;
        logger.debug("Gemini Response:", response);

        let jsonStr = response;
        if (response && response.includes('```json')) {
            jsonStr = response.split('```json')[1].split('```')[0].trim();
        } else if (response && response.includes('```')) {
            jsonStr = response.split('```')[1].split('```')[0].trim();
        }

        const jsonResponse = JSON.parse(jsonStr);
        
        if (!jsonResponse.clicks) {
            throw new Error('Invalid response format - missing clicks array');
        }
        
        logger.info(`✓ Found ${jsonResponse.clicks.length} click points`);
        if (jsonResponse.reasoning) {
            logger.info(`💡 Reasoning: ${jsonResponse.reasoning}`);
        }

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete screenshot: ${unlinkError.message}`);
            }
        }

        return jsonResponse.clicks;

    } catch (error) {
        logger.error(`❌ Gemini Analysis Error: ${error.message}`);
        
        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete screenshot: ${unlinkError.message}`);
            }
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
                boundingRect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            };
        });
        
        if (!canvasInfo) {
            logger.error('Canvas element not found');
            return false;
        }
        
        logger.info(`📐 Canvas size: ${canvasInfo.width}x${canvasInfo.height}`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const timestamp = Date.now();
        const screenshotPath = path.join(screenshotDir, `bounding_box_${timestamp}.png`);
        
        const canvas = await frame.$('canvas');
        if (!canvas) {
            logger.error('Could not get canvas element');
            return false;
        }
        
        await canvas.screenshot({
            path: screenshotPath,
            type: 'png'
        });
        
        if (enableScreenshot) {
            logger.info(`📸 Screenshot saved: ${screenshotPath}`);
        }
        
        const clickPoints = await analyzeBoundingBoxWithGemini(
            screenshotPath,
            promptText,
            { width: canvasInfo.width, height: canvasInfo.height },
            apiKey,
            enableScreenshot
        );
        
        if (!clickPoints || clickPoints.length === 0) {
            logger.warn('No click points identified');
            return false;
        }
        
        const cursor = createCursor(page);
        
        logger.info(`🖱️  Clicking ${clickPoints.length} points on canvas...`);
        
        for (let i = 0; i < clickPoints.length; i++) {
            const point = clickPoints[i];
            
            const canvasPosition = await frame.evaluate((canvasSelector, pointX, pointY) => {
                const canvas = document.querySelector(canvasSelector);
                if (!canvas) return null;
                
                const rect = canvas.getBoundingClientRect();
                
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                
                const absoluteX = rect.left + (pointX * scaleX);
                const absoluteY = rect.top + (pointY * scaleY);
                
                return {
                    x: absoluteX,
                    y: absoluteY
                };
            }, 'canvas', point.x, point.y);
            
            if (!canvasPosition) {
                logger.warn(`  ✗ Failed to calculate position for point ${i + 1}`);
                continue;
            }
            
            await cursor.moveTo(
                { x: canvasPosition.x, y: canvasPosition.y },
                { 
                    hesitate: Math.random() * 100 + 50,
                    moveDelay: Math.random() * 800 + 400
                }
            );
            
            await humanDelay(100, 300);
            
            await cursor.click();
            
            logger.info(`  ✓ Clicked point ${i + 1}/${clickPoints.length} at (${point.x}, ${point.y})`);
            
            await humanDelay(400, 800);
        }
        
        logger.info('✓ Finished clicking bounding box points');
        return true;
        
    } catch (error) {
        logger.error('Error solving bounding box challenge:', error.message);
        return false;
    }
}

module.exports = {
    solveBoundingBoxChallenge,
    analyzeBoundingBoxWithGemini,
    setLogger
};
