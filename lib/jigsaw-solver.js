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
        
        const geminiPrompt = `You are analyzing a hCaptcha jigsaw/slider puzzle challenge. This requires spatial reasoning to determine where a piece should be moved.

TASK: ${promptText}

PUZZLE TYPE IDENTIFICATION:
1. Slider Puzzle: A piece that moves ONLY horizontally (left/right) along a track
   - Usually has a visible slider bar or track
   - Piece slides to fit a gap in the image
   - Common prompt: "Move the slider to align the image"
   
2. Jigsaw Puzzle: A piece that can move in 2D space (horizontal AND vertical)
   - Piece can be dragged in any direction
   - Must fit into a specific spot in the puzzle
   - Common prompt: "Drag the piece to complete the puzzle"

YOUR TASK:
1. Identify the puzzle piece that needs to be moved (often highlighted, has different background, or is obviously separate)
2. Locate the TARGET position where this piece belongs (usually a gap or missing area)
3. Calculate the EXACT pixel offset needed to move the piece to the target
4. Determine if this is a horizontal slider or 2D jigsaw

SPATIAL REASONING GUIDE:
- Look for visual cues: gaps in the image, misaligned areas, highlighted pieces
- The piece to move is usually visually distinct (different opacity, border, or position)
- For sliders: measure horizontal distance from piece to gap
- For jigsaw: measure both horizontal and vertical distance
- Offsets should be precise - accuracy matters for solving the puzzle

COORDINATE SYSTEM:
- Positive horizontal_offset = move RIGHT
- Negative horizontal_offset = move LEFT
- Positive vertical_offset = move DOWN
- Negative vertical_offset = move UP

RESPONSE FORMAT (JSON only):
{
  "piece_position": {"x": 50, "y": 100},
  "target_position": {"x": 200, "y": 100},
  "horizontal_offset": 150,
  "vertical_offset": 0,
  "puzzle_type": "slider_horizontal",
  "reasoning": "Slider piece at left needs to move 150px right to align with gap in image"
}

Analyze the image and return the JSON response.`;

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
