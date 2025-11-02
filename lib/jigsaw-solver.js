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

async function analyzeJigsawWithGemini(screenshotPath, promptText, apiKey, enableScreenshot = false) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🧩 Analyzing jigsaw/slider puzzle: ${promptText}`);
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const geminiPrompt = `You are an expert spatial reasoning AI analyzing a hCaptcha JIGSAW/SLIDER puzzle. You must calculate precise pixel offsets to solve the puzzle.

🎯 TASK: "${promptText}"

🧩 PUZZLE TYPE DETECTION:

**Type 1: HORIZONTAL SLIDER**
- 📏 Piece moves LEFT/RIGHT only along a track
- 🎚️ Usually has a visible slider bar/handle
- 🖼️ Goal: Align piece horizontally to complete the image
- Common prompts: "Move the slider to align the image"

**Type 2: 2D JIGSAW**
- 🔄 Piece can move in ANY direction (horizontal + vertical)
- 🧩 Must fit into a specific gap/position
- 🖼️ Goal: Complete the puzzle by filling the missing area
- Common prompts: "Drag the piece to complete the puzzle"

🔍 VISUAL ANALYSIS STEPS:

1. **Identify the Movable Piece:**
   - Look for element with different styling (border, shadow, highlight)
   - Usually has different opacity or background
   - May be positioned separately from the main image
   - Often the only draggable/movable element

2. **Locate the Target Position:**
   - Find the GAP or MISSING AREA in the image
   - Look for incomplete patterns that need filling
   - Identify misaligned sections that need correction
   - For sliders: Find where the piece creates perfect alignment

3. **Calculate Precise Offsets:**
   - Measure from CURRENT piece center to TARGET position center
   - Use image patterns, edges, and alignment cues
   - For sliders: Focus on horizontal alignment only
   - For jigsaw: Consider both horizontal and vertical movement

**4. Visual Cues to Look For:**
   ✓ Edge alignment: Where does the piece edge align with image edges?
   ✓ Pattern continuation: What pattern should continue across the gap?
   ✓ Color matching: Where do colors/textures match between piece and gap?
   ✓ Shape fitting: Does the piece shape fit the gap perfectly?

**5. Precision Requirements:**
   - Offsets must be in PIXELS (whole numbers)
   - Horizontal: Positive = RIGHT, Negative = LEFT
   - Vertical: Positive = DOWN, Negative = UP
   - Accuracy critical: ±5 pixels can cause failure

**6. Common Puzzle Patterns:**
   - Slider at left, gap at center/right: Large positive offset
   - Slider at right, gap at center/left: Large negative offset
   - Jigsaw piece above gap: Positive vertical offset
   - Jigsaw piece displaced diagonally: Both horizontal + vertical offsets

📊 RESPONSE FORMAT (JSON only):
{
  "piece_position": {"x": 85, "y": 200},
  "target_position": {"x": 285, "y": 200},
  "horizontal_offset": 200,
  "vertical_offset": 0,
  "puzzle_type": "slider_horizontal",
  "confidence": "high",
  "reasoning": "Clear gap at x=285, piece at x=85. Slider needs 200px right movement to align image perfectly."
}

⚠️ Respond with JSON ONLY. Calculate offsets carefully!`;

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
        logger.info(`💡 Puzzle type: ${jsonResponse.puzzle_type}`);
        logger.info(`📏 Offset: H=${jsonResponse.horizontal_offset}, V=${jsonResponse.vertical_offset}`);
        
        if (jsonResponse.reasoning) {
            logger.info(`💭 ${jsonResponse.reasoning}`);
        }

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete screenshot: ${unlinkError.message}`);
            }
        }

        return jsonResponse;

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

async function solveJigsawChallenge(page, frame, promptText, apiKey, screenshotDir, enableScreenshot = false) {
    try {
        logger.info('🧩 Solving JIGSAW/SLIDER challenge...');
        
        const puzzleInfo = await frame.evaluate(() => {
            const draggable = document.querySelector('[draggable="true"], [class*="slider"], [class*="puzzle"], [class*="piece"]');
            if (!draggable) return null;
            
            const rect = draggable.getBoundingClientRect();
            
            const slider = document.querySelector('[role="slider"], input[type="range"]');
            if (slider) {
                return {
                    type: 'slider',
                    element: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    },
                    slider: {
                        min: parseInt(slider.min) || 0,
                        max: parseInt(slider.max) || 100,
                        value: parseInt(slider.value) || 0
                    }
                };
            }
            
            return {
                type: 'jigsaw',
                element: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            };
        });
        
        if (!puzzleInfo) {
            logger.error('No draggable element found');
            return false;
        }
        
        logger.info(`📐 Puzzle type: ${puzzleInfo.type}`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const timestamp = Date.now();
        const screenshotPath = path.join(screenshotDir, `jigsaw_${timestamp}.png`);
        
        const challengeArea = await frame.$('.challenge-view, .challenge-container');
        if (!challengeArea) {
            logger.error('Could not find challenge area');
            return false;
        }
        
        await challengeArea.screenshot({
            path: screenshotPath,
            type: 'png'
        });
        
        if (enableScreenshot) {
            logger.info(`📸 Screenshot saved: ${screenshotPath}`);
        }
        
        const analysis = await analyzeJigsawWithGemini(
            screenshotPath,
            promptText,
            apiKey,
            enableScreenshot
        );
        
        if (!analysis) {
            logger.error('Failed to analyze puzzle');
            return false;
        }
        
        const cursor = createCursor(page);
        
        const draggableElement = await frame.$('[draggable="true"], [class*="slider"], [class*="puzzle"]');
        if (!draggableElement) {
            logger.error('Could not get draggable element');
            return false;
        }
        
        const box = await draggableElement.boundingBox();
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        
        const endX = startX + analysis.horizontal_offset;
        const endY = startY + analysis.vertical_offset;
        
        logger.info(`🖱️  Dragging from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(endY)})`);
        
        await cursor.moveTo({ x: startX, y: startY });
        await humanDelay(300, 600);
        
        await page.mouse.down();
        logger.info('  ✓ Mouse down');
        await humanDelay(200, 400);
        
        await cursor.moveTo({ x: endX, y: endY }, {
            hesitate: Math.random() * 100 + 50,
            moveDelay: Math.random() * 1000 + 500
        });
        
        await humanDelay(300, 600);
        
        await page.mouse.up();
        logger.info('  ✓ Mouse up');
        
        logger.info('✓ Jigsaw puzzle solved!');
        
        await humanDelay(500, 1000);
        
        return true;
        
    } catch (error) {
        logger.error('Error solving jigsaw challenge:', error.message);
        return false;
    }
}

module.exports = {
    solveJigsawChallenge,
    analyzeJigsawWithGemini,
    setLogger
};
