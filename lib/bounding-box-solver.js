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
        
        const geminiPrompt = `You are analyzing a hCaptcha challenge. You MUST find EVERY SINGLE matching object.

🎯 TASK: "${promptText}"
📐 Canvas: ${canvasSize.width} × ${canvasSize.height} pixels

⚠️ CRITICAL INSTRUCTION: COUNT ALL OBJECTS FIRST, THEN IDENTIFY EVERY MATCH

STEP-BY-STEP ANALYSIS:
1. SCAN ENTIRE IMAGE - Look at EVERY corner, edge, and section
2. COUNT all objects you see in total
3. IDENTIFY which objects match the task
4. DOUBLE-CHECK - Did you find ALL matches? Look again!
5. Calculate CENTER coordinate (x, y) for EACH matching object

TASK TYPES:
- "Click all [object]" → Find EVERY SINGLE instance, no exceptions
- "Click two/three [object]" → Find EXACTLY that number
- "Click different/doesn't match" → Find ALL objects that differ
- "Click largest" → Find the ONE biggest object only

⚠️ COMMON MISTAKES TO AVOID:
❌ Missing objects in corners or edges
❌ Stopping after finding just 1 when there are multiple
❌ Confusing similar objects (cat vs dog, car vs truck)
❌ Missing partially visible objects

✅ RECOGNITION GUIDE:
Animals: 
- Cat (pointy/triangular ears, whiskers, small nose)
- Dog (floppy/rounded ears, longer snout)
- Elephant (trunk, large ears, gray)
- Horse (long face, mane)
- Bird (wings, beak, feathers)

Vehicles:
- Car (4 wheels, compact, sedan/hatchback)
- Motorcycle (2 wheels, rider seat)
- Bus (large, long, many windows)
- Truck (cargo bed or large vehicle, 4+ wheels)
- Airplane (wings, tail, fuselage)

Shapes: circle, square, triangle, star, heart
Objects: phone, umbrella, chair, tree, building, house, bicycle

JSON RESPONSE FORMAT (NO MARKDOWN):
{
  "total_objects_seen": 5,
  "matching_objects_count": 2,
  "clicks": [
    {"x": 120, "y": 95},
    {"x": 410, "y": 350}
  ],
  "reasoning": "Saw 5 total objects: 2 cats (at x120y95 and x410y350), 2 dogs, 1 bird. Returning coordinates for the 2 cats."
}

⚠️ MANDATORY REQUIREMENTS:
- Count total_objects_seen first
- Return coordinates for ALL matching objects
- If 2 targets exist, you MUST return 2 coordinates
- If 3 targets exist, you MUST return 3 coordinates
- Coordinates = object CENTER point (x, y)
- Return ONLY valid JSON, no markdown, no extra text
- If no matches: {"total_objects_seen": N, "matching_objects_count": 0, "clicks": [], "reasoning": "No matches found"}`;

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
        
        for (let i = 0; i < jsonResponse.clicks.length; i++) {
            const point = jsonResponse.clicks[i];
            logger.info(`   Point ${i + 1}: (${point.x}, ${point.y})`);
        }
        
        if (jsonResponse.reasoning) {
            logger.info(`💡 Reasoning: ${jsonResponse.reasoning}`);
        }
        
        const validClicks = jsonResponse.clicks.filter(click => {
            if (!click || typeof click.x !== 'number' || typeof click.y !== 'number') {
                logger.warn(`⚠️  Skipping invalid click: ${JSON.stringify(click)}`);
                return false;
            }
            if (click.x < 0 || click.x > canvasSize.width || click.y < 0 || click.y > canvasSize.height) {
                logger.warn(`⚠️  Skipping out-of-bounds click: (${click.x}, ${click.y}) - Canvas: ${canvasSize.width}x${canvasSize.height}`);
                return false;
            }
            return true;
        });
        
        if (validClicks.length !== jsonResponse.clicks.length) {
            logger.warn(`⚠️  Filtered ${jsonResponse.clicks.length - validClicks.length} invalid coordinates`);
        }

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete screenshot: ${unlinkError.message}`);
            }
        }

        return validClicks;

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
        
        logger.info('⏳ Waiting for canvas content to fully render...');
        await new Promise(resolve => setTimeout(resolve, 2500));
        
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
        
        logger.info(`🖱️  Preparing to click ${clickPoints.length} points on canvas...`);
        
        const clickPositions = [];
        for (let i = 0; i < clickPoints.length; i++) {
            const point = clickPoints[i];
            
            const canvasPosition = await frame.evaluate((canvasSelector, pointX, pointY) => {
                const canvas = document.querySelector(canvasSelector);
                if (!canvas) {
                    return { error: 'Canvas not found' };
                }
                
                const rect = canvas.getBoundingClientRect();
                
                if (!rect || rect.width === 0 || rect.height === 0) {
                    return { error: 'Invalid canvas dimensions' };
                }
                
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                
                const absoluteX = rect.left + (pointX * scaleX);
                const absoluteY = rect.top + (pointY * scaleY);
                
                return {
                    x: absoluteX,
                    y: absoluteY
                };
            }, 'canvas', point.x, point.y);
            
            if (!canvasPosition || canvasPosition.error) {
                logger.error(`  ✗ Failed to calculate position for point ${i + 1}: ${canvasPosition?.error || 'Unknown error'}`);
                continue;
            }
            
            if (!isFinite(canvasPosition.x) || !isFinite(canvasPosition.y)) {
                logger.error(`  ✗ Invalid position for point ${i + 1}: (${canvasPosition.x}, ${canvasPosition.y})`);
                continue;
            }
            
            const jitterX = (Math.random() - 0.5) * 2;
            const jitterY = (Math.random() - 0.5) * 2;
            
            clickPositions.push({
                x: canvasPosition.x + jitterX,
                y: canvasPosition.y + jitterY,
                originalX: point.x,
                originalY: point.y,
                index: i + 1
            });
        }
        
        if (clickPositions.length === 0) {
            logger.error('No valid click positions calculated');
            return false;
        }
        
        logger.info(`✓ Calculated ${clickPositions.length} positions, executing clicks rapidly...`);
        
        const cursor = createCursor(page);
        
        for (const pos of clickPositions) {
            logger.info(`  → Moving cursor to point ${pos.index}/${clickPositions.length}...`);
            
            await cursor.moveTo(
                { x: pos.x, y: pos.y },
                { 
                    hesitate: Math.random() * 80 + 40,
                    moveDelay: Math.random() * 400 + 200,
                    waitForSelector: false
                }
            );
            
            await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150));
            
            await cursor.click();
            
            logger.info(`  ✓ Clicked point ${pos.index}/${clickPositions.length} at (${Math.round(pos.originalX)}, ${Math.round(pos.originalY)})`);
            
            if (pos.index < clickPositions.length) {
                await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 250));
            }
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
