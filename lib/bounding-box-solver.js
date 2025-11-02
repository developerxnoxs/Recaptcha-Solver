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
        
        const geminiPrompt = `You are an EXPERT computer vision AI with PERFECT object detection capabilities solving a hCaptcha BOUNDING BOX challenge. You MUST identify objects with ULTRA-PRECISION.

🎯 TASK: "${promptText}"

📐 CANVAS DIMENSIONS: ${canvasSize.width} × ${canvasSize.height} pixels

═══════════════════════════════════════════════════════════════

🎯 CRITICAL ANALYSIS PROTOCOL:

**PHASE 1: COMPLETE OBJECT INVENTORY**

Scan the ENTIRE canvas systematically:
   1. Grid Scan: Divide canvas into 9 sections (3×3 grid)
   2. Section-by-Section: Examine each section thoroughly
   3. Object Catalog: List EVERY visible object with its:
      • Type/Category (animal, vehicle, shape, symbol, etc.)
      • Position (approximate x, y coordinates)
      • Size (small, medium, large)
      • Distinguishing features

Example inventory:
   • Top-left (x≈100, y≈80): Blue triangle, medium
   • Top-center (x≈250, y≈90): Red square, small
   • Center (x≈240, y≈200): Cat icon, large
   • etc.

**PHASE 2: TASK TYPE CLASSIFICATION**

Identify EXACTLY what the task requires:

   🔵 Type A: "Find ALL [object_name]"
      Goal: Select EVERY instance of the named object
      Strategy: Match object_name to your inventory
      Example: "Click all cars" → Find every car icon

   🔵 Type B: "Find objects that are DIFFERENT"
      Goal: Select outliers/unique objects
      Strategy: Group by similarity, select minority items
      Example: 8 circles + 2 squares → Select the 2 squares

   🔵 Type C: "Find the LARGEST object"
      Goal: Select ONE biggest object
      Strategy: Compare sizes, select single largest
      Example: Among 10 icons → Select biggest one

   🔵 Type D: "Find objects that DON'T MATCH"
      Goal: Select items different from majority
      Strategy: Identify pattern, select exceptions
      Example: 7 red items + 3 blue items → Select 3 blue

**PHASE 3: PRECISE COORDINATE CALCULATION**

For EACH selected object:

   1. **Identify Object Boundaries:**
      • Left edge X coordinate (x_min)
      • Right edge X coordinate (x_max)
      • Top edge Y coordinate (y_min)
      • Bottom edge Y coordinate (y_max)

   2. **Calculate CENTER:**
      • center_x = (x_min + x_max) / 2
      • center_y = (y_min + y_max) / 2
      • Round to nearest integer

   3. **Validate Coordinates:**
      • Ensure 0 ≤ center_x ≤ ${canvasSize.width}
      • Ensure 0 ≤ center_y ≤ ${canvasSize.height}
      • Verify center point is visually inside object

**PHASE 4: VERIFICATION CHECKLIST**

Before finalizing:
   ✅ Did I scan the ENTIRE canvas?
   ✅ Does my selection match the task requirement?
   ✅ Are coordinates pointing to object CENTERS (not edges)?
   ✅ Did I miss any objects that should be selected?
   ✅ Did I include any objects that shouldn't be selected?
   ✅ Are all coordinates within canvas bounds?

═══════════════════════════════════════════════════════════════

🎓 OBJECT RECOGNITION REFERENCE:

**Common hCaptcha Objects:**

Animals:
   • 🐱 Cat: Pointy ears, whiskers, feline face
   • 🐶 Dog: Floppy/varied ears, canine snout
   • 🐘 Elephant: Trunk, large ears, tusks
   • 🐴 Horse: Mane, hooves, equine shape
   • 🐦 Bird: Wings, beak, feathers

Vehicles:
   • 🚗 Car: 4 wheels, passenger compartment, sedan shape
   • 🏍️ Motorcycle: 2 wheels, handlebar, compact
   • 🚌 Bus: Large, many windows, long body
   • 🚚 Truck: Cargo bed, larger than car
   • ✈️ Airplane: Wings, tail, fuselage

Shapes:
   • 🔵 Circle/Ellipse: Curved, round
   • 🔴 Square/Rectangle: 4 sides, right angles
   • 🔺 Triangle: 3 sides, pointed
   • ⭐ Star: Multiple points radiating
   • ❤️ Heart: Curved top, pointed bottom

Objects:
   • 📱 Phone: Rectangular, screen-like
   • ☂️ Umbrella: Dome shape, handle
   • 🪑 Chair: Seat, backrest, legs
   • 🚪 Door: Rectangular, portal-like

**Size Comparison:**
   • Small: <20% of canvas dimension
   • Medium: 20-50% of canvas dimension
   • Large: >50% of canvas dimension

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON RESPONSE FORMAT:

{
  "object_inventory": [
    {"type": "cat", "position": "top-left", "approx_coords": {"x": 120, "y": 95}},
    {"type": "dog", "position": "center", "approx_coords": {"x": 240, "y": 200}},
    {"type": "cat", "position": "bottom-right", "approx_coords": {"x": 410, "y": 350}}
  ],
  "task_interpretation": "Select all cat icons (Type A: find all [object])",
  "selection_logic": "Identified 2 cats among 3 total objects. Excluding 1 dog.",
  "clicks": [
    {"x": 120, "y": 95},
    {"x": 410, "y": 350}
  ],
  "reasoning": "Canvas contains 2 cat icons and 1 dog icon. Task requires selecting all cats. Selected both cat instances at their precise center coordinates."
}

**Field Requirements:**
   • object_inventory: List ALL objects found on canvas
   • task_interpretation: Your understanding of the task
   • selection_logic: Why you selected these specific objects
   • clicks: Array of {x, y} coordinates (center points of selected objects)
   • reasoning: Complete explanation of your analysis

⚠️ CRITICAL REQUIREMENTS:
   - Scan ENTIRE canvas (don't miss corners or edges)
   - Respond with ONLY valid JSON
   - Coordinates must be INTEGERS (whole numbers)
   - Click coordinates must point to object CENTERS
   - If no matches found, return empty clicks array: {"clicks": [], "reasoning": "..."}

Analyze with MAXIMUM precision and thoroughness!`;

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
