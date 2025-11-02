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
        
        const geminiPrompt = `You are an expert visual AI analyzing a hCaptcha BOUNDING BOX challenge. You must precisely identify object center coordinates on a canvas.

🎯 TASK: "${promptText}"

📐 CANVAS: ${canvasSize.width} × ${canvasSize.height} pixels

🔍 ANALYSIS REQUIREMENTS:

**1. Understanding the Task:**
   - "Click on the TWO ICONS that are DIFFERENT" → Find 2 unique/outlier objects
   - "Click on the LARGEST object" → Select the single biggest object
   - "Click on ALL [object]" → Select every instance of that object type
   - "Click objects that DON'T MATCH" → Find items that differ from the majority

**2. Visual Recognition Strategy:**
   📌 Step 1: Scan entire canvas systematically (left-to-right, top-to-bottom)
   📌 Step 2: Categorize all visible objects by type/similarity
   📌 Step 3: Apply task criteria to select correct objects
   📌 Step 4: Calculate precise CENTER coordinates for each selected object
   
**3. Common Object Types in hCaptcha:**
   - 🔷 Simple Icons: geometric shapes, symbols, emojis
   - 🐾 Animals: cats, dogs, birds, elephants, fish, horses
   - 🚗 Vehicles: cars, motorcycles, bicycles, buses, trucks, airplanes, boats
   - 📦 Objects: chairs, tables, umbrellas, phones, glasses, tools
   - 🏗️ Structures: buildings, bridges, towers, houses
   
**4. Coordinate Precision Rules:**
   - Calculate the CENTER point (midpoint) of the object's bounding area
   - X must be between 0 and ${canvasSize.width}
   - Y must be between 0 and ${canvasSize.height}
   - Round to whole numbers (no decimals)
   - Double-check coordinates are inside canvas bounds
   
**5. Special Task Handling:**

   a) "DIFFERENT from others" tasks:
      - Identify the majority pattern/type
      - Select ONLY the objects that don't match this pattern
      - Usually 1-3 different objects

   b) "LARGEST object" tasks:
      - Compare relative sizes of all objects
      - Select ONLY the single biggest one
      - Return exactly 1 click coordinate

   c) "ALL [specific object]" tasks:
      - Find EVERY instance of the named object
      - Don't confuse similar objects (e.g., car ≠ truck)
      - Include all instances, no matter how small

**6. Quality Assurance:**
   ✓ Verify each click coordinate points to correct object center
   ✓ Confirm no objects missed that should be selected
   ✓ Ensure no incorrect objects selected
   ✓ Check coordinates are valid (within canvas bounds)

📊 RESPONSE FORMAT (JSON only):
{
  "clicks": [
    {"x": 245, "y": 180},
    {"x": 520, "y": 340}
  ],
  "reasoning": "Brief explanation of which objects selected and why"
}

⚠️ IMPORTANT: If NO objects match the task criteria, return {"clicks": [], "reasoning": "No matching objects found"}

Respond with JSON ONLY.`;

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
            
            const success = await frame.evaluate((canvasSelector, x, y) => {
                const canvas = document.querySelector(canvasSelector);
                if (!canvas) return false;
                
                const rect = canvas.getBoundingClientRect();
                
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                
                const clickX = rect.left + (x * scaleX);
                const clickY = rect.top + (y * scaleY);
                
                const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: clickX,
                    clientY: clickY
                });
                
                canvas.dispatchEvent(clickEvent);
                return true;
            }, 'canvas', point.x, point.y);
            
            if (success) {
                logger.info(`  ✓ Clicked point ${i + 1}/${clickPoints.length} at (${point.x}, ${point.y})`);
            } else {
                logger.warn(`  ✗ Failed to click point ${i + 1}`);
            }
            
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
