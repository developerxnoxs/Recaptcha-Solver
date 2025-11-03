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
        
        const geminiPrompt = `You are a ULTRA-PRECISE computer vision AI analyzing a hCaptcha challenge. You MUST provide PIXEL-PERFECT center coordinates.

🎯 TASK: "${promptText}"
📐 Canvas: ${canvasSize.width} × ${canvasSize.height} pixels

═══════════════════════════════════════════════════════════════

🔬 ULTRA-PRECISE COORDINATE ANALYSIS METHOD:

**STEP 1: GRID-BASED SYSTEMATIC SCAN**

Mentally divide the canvas into a 3×3 grid:
┌─────────┬─────────┬─────────┐
│ TOP-L   │ TOP-C   │ TOP-R   │  Y: 0-${Math.floor(canvasSize.height/3)}
├─────────┼─────────┼─────────┤
│ MID-L   │ MID-C   │ MID-R   │  Y: ${Math.floor(canvasSize.height/3)}-${Math.floor(canvasSize.height*2/3)}
├─────────┼─────────┼─────────┤
│ BOT-L   │ BOT-C   │ BOT-R   │  Y: ${Math.floor(canvasSize.height*2/3)}-${canvasSize.height}
└─────────┴─────────┴─────────┘
X: 0-${Math.floor(canvasSize.width/3)}  ${Math.floor(canvasSize.width/3)}-${Math.floor(canvasSize.width*2/3)}  ${Math.floor(canvasSize.width*2/3)}-${canvasSize.width}

Scan each grid section THOROUGHLY - count ALL objects in each section.

**STEP 2: PRECISE OBJECT INVENTORY**

For EACH object found:
1. Identify its EXACT bounding box edges (left, right, top, bottom)
2. Calculate PRECISE center: x = (left + right) / 2, y = (top + bottom) / 2
3. Round to nearest integer pixel
4. Record grid location for verification

**STEP 3: IDENTIFY MATCHING OBJECTS**

Task type analysis:
- "Click all [X]" → Select ALL instances of X
- "Click two/three [X]" → Select EXACTLY that number of X
- "Click different/doesn't match" → Select objects NOT matching the majority
- "Click largest [X]" → Select the ONE with biggest area

**STEP 4: PIXEL-PERFECT CENTER CALCULATION**

For each matching object:
1. Find its VISUAL center (not geometric - account for shape)
2. Measure from LEFT edge: count pixels to center = X coordinate
3. Measure from TOP edge: count pixels to center = Y coordinate
4. Double-check measurement against grid divisions
5. Verify: Does coordinate fall within object's visual bounds?

**STEP 5: QUALITY VERIFICATION**

✓ Did I scan ALL 9 grid sections?
✓ Did I count EVERY object visible?
✓ Are coordinates within canvas bounds (0-${canvasSize.width}, 0-${canvasSize.height})?
✓ Do coordinates point to object CENTERS, not edges?
✓ Did I find the CORRECT number of matches for the task?

═══════════════════════════════════════════════════════════════

🎯 RECOGNITION GUIDE (with distinguishing features):

**Shapes & Icons:**
- Concentric Circles: Multiple rings, circular
- 3D Cube/Box: Has depth, perspective lines, isometric view
- Zig-zag/Z-shape: Angular lines in Z pattern
- Diamond/Rhombus: 4 equal sides, rotated square
- Star: Pointed radiating shape
- Abstract shapes: Any irregular geometric pattern

**Common Objects:**
- Animals: Cat (pointed ears), Dog (floppy ears), Bird (wings, beak)
- Vehicles: Car (sedan shape), Truck (cargo bed), Bus (long, windows)
- Items: Phone, umbrella, chair, tree, building

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON RESPONSE (ULTRA-PRECISE FORMAT):

{
  "grid_scan_results": "TOP-L: 1 circle, TOP-C: 1 cube, TOP-R: 1 circle, MID-L: 1 circle, MID-C: 1 circle, MID-R: 1 zigzag, BOT-L: 1 circle, BOT-C: 1 circle, BOT-R: 1 circle",
  "total_objects_seen": 9,
  "matching_objects_count": 2,
  "clicks": [
    {"x": 516, "y": 220, "grid": "TOP-C", "object": "3D cube"},
    {"x": 733, "y": 430, "grid": "MID-R", "object": "zigzag shape"}
  ],
  "measurement_notes": "Cube: measured from left edge 480px to 552px, center = 516px. From top 187px to 253px, center = 220px. Zigzag: left 700px to 766px = 733px center, top 397px to 463px = 430px center.",
  "reasoning": "Scanned all 9 grid sections. Found 9 total objects: 7 concentric circles (majority) + 1 cube + 1 zigzag. Task asks for 'different from others' so selected the 2 non-circle shapes: cube at (516,220) and zigzag at (733,430)."
}

**CRITICAL REQUIREMENTS:**
- grid_scan_results: List what you found in EACH of 9 grid sections
- measurement_notes: Show your coordinate calculation work
- clicks: EXACT center coordinates (integers only)
- Each click must include: x, y, grid location, object name
- Coordinates must be PRECISE - ±5 pixels can cause failure
- Return ONLY valid JSON (no markdown, no code blocks)

Calculate with MAXIMUM PRECISION!`;

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
        
        if (jsonResponse.grid_scan_results) {
            logger.info(`📊 Grid Scan: ${jsonResponse.grid_scan_results}`);
        }
        
        for (let i = 0; i < jsonResponse.clicks.length; i++) {
            const point = jsonResponse.clicks[i];
            const gridInfo = point.grid ? ` [${point.grid}]` : '';
            const objInfo = point.object ? ` - ${point.object}` : '';
            logger.info(`   Point ${i + 1}: (${point.x}, ${point.y})${gridInfo}${objInfo}`);
        }
        
        if (jsonResponse.measurement_notes) {
            logger.info(`📏 Measurements: ${jsonResponse.measurement_notes}`);
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
                
                const relativeX = pointX * scaleX;
                const relativeY = pointY * scaleY;
                
                const absoluteX = rect.left + relativeX;
                const absoluteY = rect.top + relativeY;
                
                return {
                    x: Math.round(absoluteX * 100) / 100,
                    y: Math.round(absoluteY * 100) / 100,
                    scale: { x: scaleX, y: scaleY },
                    canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    original: { x: pointX, y: pointY }
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
            
            logger.debug(`  📐 Point ${i + 1} transform: Canvas(${canvasPosition.original.x}, ${canvasPosition.original.y}) → Scale(${canvasPosition.scale.x.toFixed(3)}, ${canvasPosition.scale.y.toFixed(3)}) → Viewport(${canvasPosition.x.toFixed(2)}, ${canvasPosition.y.toFixed(2)})`);
            
            const jitterX = (Math.random() - 0.5) * 0.5;
            const jitterY = (Math.random() - 0.5) * 0.5;
            
            clickPositions.push({
                x: Math.round(canvasPosition.x + jitterX),
                y: Math.round(canvasPosition.y + jitterY),
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
