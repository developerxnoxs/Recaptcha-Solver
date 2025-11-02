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

async function analyzeJigsawWithGemini(screenshotPath, promptText, apiKey, enableScreenshot = false, attemptNumber = 1) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🧩 Analyzing jigsaw/slider puzzle (attempt ${attemptNumber}): ${promptText}`);
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const geminiPrompt = `You are an EXPERT computer vision AI analyzing a hCaptcha JIGSAW/SLIDER puzzle. You MUST calculate ULTRA-PRECISE pixel offsets.

🎯 CHALLENGE: "${promptText}"

═══════════════════════════════════════════════════════════════

📐 CRITICAL ANALYSIS METHOD:

**STEP 1: IDENTIFY PUZZLE COMPONENTS**

Look for TWO main components in the image:
1. 🧩 MOVABLE PIECE - The draggable element (often has border/shadow/outline)
2. 🎯 TARGET GAP - The missing area where the piece should go

Visual indicators of the movable piece:
   • Distinct border (blue, white, or colored outline)
   • Drop shadow or glow effect
   • Slightly elevated or separated from background
   • Different opacity or styling from main image
   • May be positioned outside the main image area initially

Visual indicators of the target gap:
   • Missing section in an otherwise complete image
   • Area with misaligned patterns/edges
   • Visible discontinuity in the background image
   • Empty space that matches the piece shape

**STEP 2: MEASURE PIXEL COORDINATES**

For the MOVABLE PIECE:
   1. Find its EXACT center point (piece_x, piece_y)
   2. Measure from the LEFT edge of the image to piece center = piece_x
   3. Measure from the TOP edge of the image to piece center = piece_y

For the TARGET GAP:
   1. Find the EXACT center where piece should land (target_x, target_y)
   2. Look for edge alignment, pattern continuation, color matching
   3. Measure from LEFT edge to gap center = target_x
   4. Measure from TOP edge to gap center = target_y

**STEP 3: CALCULATE OFFSETS**

horizontal_offset = target_x - piece_x
vertical_offset = target_y - piece_y

Examples:
   • Piece at x=100, gap at x=350 → offset = +250 (move RIGHT 250px)
   • Piece at x=400, gap at x=150 → offset = -250 (move LEFT 250px)
   • Piece at y=100, gap at y=250 → offset = +150 (move DOWN 150px)

**STEP 4: VALIDATE YOUR ANSWER**

Double-check:
   ✓ Do the offsets make logical sense with piece and gap positions?
   ✓ For horizontal sliders: Is vertical_offset close to 0?
   ✓ Are offsets reasonable? (typically -500 to +500 pixels)
   ✓ Will moving the piece by these offsets land it in the gap?

═══════════════════════════════════════════════════════════════

🔬 ADVANCED VISUAL TECHNIQUES:

1. **Edge Detection Analysis:**
   - Find where piece edges should align with gap edges
   - Match texture/pattern boundaries precisely
   - Look for continuation of lines, shapes, or patterns

2. **Color Gradient Matching:**
   - Identify color gradients in both piece and surrounding area
   - Match gradient direction and intensity
   - Find where colors blend seamlessly

3. **Shape Contour Fitting:**
   - Analyze the exact shape of the gap
   - Ensure piece contours match gap contours
   - Check for interlocking shapes or puzzle piece teeth

4. **Pixel-Perfect Precision:**
   - Measure to the EXACT pixel, not approximate
   - Use clear visual landmarks for reference points
   - Account for any visual distortions or shadows

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON RESPONSE FORMAT:

{
  "piece_position": {"x": 95, "y": 210},
  "target_position": {"x": 310, "y": 210},
  "horizontal_offset": 215,
  "vertical_offset": 0,
  "puzzle_type": "slider_horizontal",
  "confidence": "high",
  "visual_landmarks": "Piece has visible border at left side, gap clearly visible at center-right where image pattern is incomplete",
  "reasoning": "Measured from left edge: piece center at x=95px, gap center at x=310px. Offset = 310-95 = 215px RIGHT. Vertical positions align, so vertical_offset = 0."
}

**Field Requirements:**
   • piece_position: Center coordinates of movable piece
   • target_position: Center coordinates of target gap
   • horizontal_offset: EXACT pixel difference (target_x - piece_x)
   • vertical_offset: EXACT pixel difference (target_y - piece_y)
   • puzzle_type: "slider_horizontal" OR "jigsaw_2d"
   • confidence: "high", "medium", or "low"
   • visual_landmarks: Describe key visual features you used
   • reasoning: Explain your measurement and calculation process

⚠️ CRITICAL: 
   - Respond with ONLY valid JSON
   - NO markdown, NO explanation outside JSON
   - Offsets must be INTEGERS (whole numbers)
   - Precision is ESSENTIAL - ±3 pixels can cause failure

Calculate with MAXIMUM precision!`;

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
                maxOutputTokens: 1024,
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
        
        if (!jsonResponse.horizontal_offset && jsonResponse.horizontal_offset !== 0) {
            throw new Error('Missing horizontal_offset in response');
        }
        if (!jsonResponse.vertical_offset && jsonResponse.vertical_offset !== 0) {
            throw new Error('Missing vertical_offset in response');
        }
        
        logger.info(`💡 Puzzle type: ${jsonResponse.puzzle_type}`);
        logger.info(`📏 Offset: H=${jsonResponse.horizontal_offset}, V=${jsonResponse.vertical_offset}`);
        logger.info(`🎯 Confidence: ${jsonResponse.confidence}`);
        
        if (jsonResponse.visual_landmarks) {
            logger.info(`🔍 Landmarks: ${jsonResponse.visual_landmarks}`);
        }
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
        logger.error(`❌ Gemini Analysis Error (attempt ${attemptNumber}): ${error.message}`);
        
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

async function solveJigsawChallenge(page, frame, promptText, apiKey, screenshotDir, enableScreenshot = false, maxAttempts = 2) {
    const MAX_ATTEMPTS = maxAttempts;
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            if (attempt > 1) {
                logger.info(`🔄 Retry attempt ${attempt}/${MAX_ATTEMPTS}...`);
                await humanDelay(1000, 2000);
            } else {
                logger.info('🧩 Solving JIGSAW/SLIDER challenge...');
            }
            
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
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
            }
            
            logger.info(`📐 Puzzle type: ${puzzleInfo.type}`);
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const timestamp = Date.now();
            const screenshotPath = path.join(screenshotDir, `jigsaw_${timestamp}.png`);
            
            const challengeArea = await frame.$('.challenge-view, .challenge-container');
            if (!challengeArea) {
                logger.error('Could not find challenge area');
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
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
                enableScreenshot,
                attempt
            );
            
            if (!analysis) {
                logger.error('Failed to analyze puzzle');
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
            }
            
            const cursor = createCursor(page);
            
            const draggableElement = await frame.$('[draggable="true"], [class*="slider"], [class*="puzzle"]');
            if (!draggableElement) {
                logger.error('Could not get draggable element');
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
            }
            
            const box = await draggableElement.boundingBox();
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;
            
            let offsetX = analysis.horizontal_offset;
            let offsetY = analysis.vertical_offset;
            
            if (attempt > 1 && analysis.confidence === 'low') {
                const adjustment = (attempt - 1) * 5;
                offsetX += Math.random() > 0.5 ? adjustment : -adjustment;
                logger.info(`⚙️  Applying offset adjustment: ±${adjustment}px`);
            }
            
            const endX = startX + offsetX;
            const endY = startY + offsetY;
            
            logger.info(`🖱️  Dragging from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(endY)})`);
            
            await cursor.moveTo({ x: startX, y: startY });
            await humanDelay(300, 600);
            
            await page.mouse.down();
            logger.info('  ✓ Mouse down');
            await humanDelay(200, 400);
            
            const steps = 15 + Math.floor(Math.random() * 10);
            const deltaX = (endX - startX) / steps;
            const deltaY = (endY - startY) / steps;
            
            for (let i = 1; i <= steps; i++) {
                const currentX = startX + (deltaX * i);
                const currentY = startY + (deltaY * i);
                await page.mouse.move(currentX, currentY);
                await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
            }
            
            await humanDelay(300, 600);
            
            await page.mouse.up();
            logger.info('  ✓ Mouse up');
            
            await humanDelay(800, 1200);
            
            const isStillPresent = await frame.evaluate(() => {
                const draggable = document.querySelector('[draggable="true"], [class*="slider"], [class*="puzzle"]');
                return draggable !== null;
            });
            
            if (!isStillPresent || attempt === MAX_ATTEMPTS) {
                logger.info('✓ Jigsaw puzzle solved!');
                return true;
            } else {
                logger.warn('⚠️  Puzzle still present, solution may not be accurate');
                if (analysis.confidence === 'high') {
                    logger.warn('   Despite high confidence, attempting retry with adjustment...');
                }
            }
            
        } catch (error) {
            logger.error(`Error solving jigsaw challenge (attempt ${attempt}): ${error.message}`);
            if (attempt === MAX_ATTEMPTS) {
                return false;
            }
        }
    }
    
    return false;
}

module.exports = {
    solveJigsawChallenge,
    analyzeJigsawWithGemini,
    setLogger
};
