const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const createLogger = require('../utils/logger');
const { createCursor } = require('ghost-cursor');
const { analyzePatternCompletion, classifySpatialType } = require('./spatial-reasoning');
const { ImageDragDropChallenge, SPATIAL_TYPES } = require('./models');

let logger = createLogger({ level: 'info' });

function setLogger(newLogger) {
    logger = newLogger;
}

async function humanDelay(minMs = 500, maxMs = 1500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Execute drag operations berdasarkan spatial reasoning solution
 * Mengambil solution mappings dan convert ke actual DOM drag operations
 */
async function executeSpatialDragOperations(page, frame, spatialResult, enableScreenshot = false) {
    try {
        if (!spatialResult || !spatialResult.solution || spatialResult.solution.length === 0) {
            logger.error('No valid spatial solution to execute');
            return false;
        }

        logger.info(`🎯 Executing ${spatialResult.solution.length} spatial drag operation(s)...`);
        
        // CRITICAL: Get iframe offset untuk translate iframe-relative ke page coordinates
        const frameElement = await frame.frameElement();
        let iframeOffset = { x: 0, y: 0 };
        
        if (frameElement) {
            const iframeBox = await frameElement.boundingBox();
            if (iframeBox) {
                iframeOffset = {
                    x: iframeBox.x,
                    y: iframeBox.y
                };
                logger.debug(`🖼️  Iframe offset: (${iframeOffset.x}, ${iframeOffset.y})`);
            } else {
                logger.warn('⚠️ Could not get iframe bounding box, assuming no offset');
            }
        } else {
            logger.debug('No iframe element found, using direct coordinates');
        }
        
        // Identifikasi semua draggable elements dan target positions dalam frame
        const elementsInfo = await frame.evaluate(() => {
            const sources = [];
            const targets = [];
            
            // Cari semua draggable elements (biasanya di kanan untuk drag-drop puzzles)
            const draggables = document.querySelectorAll('[draggable="true"], [class*="draggable"], [class*="source"]');
            draggables.forEach((el, idx) => {
                const rect = el.getBoundingClientRect();
                sources.push({
                    index: idx,
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    width: rect.width,
                    height: rect.height,
                    className: el.className
                });
            });
            
            // Cari target positions (biasanya di kiri atau area drop zones)
            const dropZones = document.querySelectorAll('[class*="drop"], [class*="target"], [class*="slot"]');
            dropZones.forEach((el, idx) => {
                const rect = el.getBoundingClientRect();
                targets.push({
                    index: idx,
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    width: rect.width,
                    height: rect.height,
                    className: el.className
                });
            });
            
            // Jika tidak ada explicit drop zones, cari semua clickable areas
            if (targets.length === 0) {
                const clickables = document.querySelectorAll('[class*="choice"], [class*="option"], [class*="answer"]');
                clickables.forEach((el, idx) => {
                    if (!el.hasAttribute('draggable')) {  // Exclude draggable elements
                        const rect = el.getBoundingClientRect();
                        targets.push({
                            index: idx,
                            x: rect.x + rect.width / 2,
                            y: rect.y + rect.height / 2,
                            width: rect.width,
                            height: rect.height,
                            className: el.className
                        });
                    }
                });
            }
            
            return { sources, targets };
        });
        
        logger.info(`📍 Found ${elementsInfo.sources.length} source elements, ${elementsInfo.targets.length} target positions`);
        
        if (elementsInfo.sources.length === 0) {
            logger.error('No draggable source elements found');
            return false;
        }
        
        if (elementsInfo.targets.length === 0) {
            logger.error('No target drop zones found');
            return false;
        }
        
        // Execute setiap drag operation dari solution
        const cursor = createCursor(page);
        let successCount = 0;
        
        for (const mapping of spatialResult.solution) {
            try {
                // Parse source dan target IDs dari solution
                // Solution format: { source_id: 1, target_id: "A", explanation: "..." }
                const sourceIdx = typeof mapping.source_id === 'number' ? mapping.source_id - 1 : parseInt(mapping.source_id) - 1;
                
                // Target ID bisa berupa number atau string (A, B, C, etc)
                let targetIdx;
                if (typeof mapping.target_id === 'string') {
                    // Convert A->0, B->1, C->2, etc
                    targetIdx = mapping.target_id.charCodeAt(0) - 'A'.charCodeAt(0);
                } else {
                    targetIdx = mapping.target_id - 1;
                }
                
                if (sourceIdx < 0 || sourceIdx >= elementsInfo.sources.length) {
                    logger.warn(`⚠️ Source index ${sourceIdx} out of bounds, skipping...`);
                    continue;
                }
                
                if (targetIdx < 0 || targetIdx >= elementsInfo.targets.length) {
                    logger.warn(`⚠️ Target index ${targetIdx} out of bounds, skipping...`);
                    continue;
                }
                
                const source = elementsInfo.sources[sourceIdx];
                const target = elementsInfo.targets[targetIdx];
                
                // Translate iframe-relative coordinates ke page coordinates
                const pageSourceX = source.x + iframeOffset.x;
                const pageSourceY = source.y + iframeOffset.y;
                const pageTargetX = target.x + iframeOffset.x;
                const pageTargetY = target.y + iframeOffset.y;
                
                logger.info(`🖱️  Dragging source ${mapping.source_id} → target ${mapping.target_id}`);
                logger.info(`   ${mapping.explanation}`);
                logger.info(`   Iframe coords: (${Math.round(source.x)}, ${Math.round(source.y)}) → (${Math.round(target.x)}, ${Math.round(target.y)})`);
                logger.info(`   Page coords: (${Math.round(pageSourceX)}, ${Math.round(pageSourceY)}) → (${Math.round(pageTargetX)}, ${Math.round(pageTargetY)})`);
                
                // Perform drag operation dengan human-like movement
                await humanDelay(300, 600);
                
                await cursor.moveTo({
                    x: pageSourceX,
                    y: pageSourceY
                });
                
                await humanDelay(100, 200);
                await page.mouse.down();
                await humanDelay(150, 300);
                
                // Drag ke target dengan bezier curve movement
                await cursor.moveTo({
                    x: pageTargetX,
                    y: pageTargetY
                });
                
                await humanDelay(150, 300);
                await page.mouse.up();
                await humanDelay(200, 400);
                
                successCount++;
                logger.info(`✅ Drag operation ${successCount}/${spatialResult.solution.length} completed`);
                
            } catch (dragError) {
                logger.error(`❌ Failed to execute drag for mapping: ${dragError.message}`);
            }
        }
        
        if (successCount === spatialResult.solution.length) {
            logger.info(`🎉 All ${successCount} spatial drag operations completed successfully!`);
            return true;
        } else {
            logger.warn(`⚠️ Only ${successCount}/${spatialResult.solution.length} drag operations succeeded`);
            return successCount > 0;  // Partial success
        }
        
    } catch (error) {
        logger.error(`❌ Error executing spatial drag operations: ${error.message}`);
        return false;
    }
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

**STEP 3: CALCULATE ULTRA-PRECISE OFFSETS**

horizontal_offset = target_x - piece_x
vertical_offset = target_y - piece_y

PRECISION REQUIREMENTS:
   • Measure to EXACT pixel - no rounding or approximation
   • Account for partial pixels if visible
   • Verify offset makes geometric sense

Examples:
   • Piece at x=100, gap at x=350 → offset = +250 (move RIGHT 250px)
   • Piece at x=400, gap at x=150 → offset = -250 (move LEFT 250px)
   • Piece at y=100, gap at y=250 → offset = +150 (move DOWN 150px)
   • Use INTEGER values only (no decimals)

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

📊 REQUIRED JSON RESPONSE FORMAT (ULTRA-PRECISE):

{
  "piece_position": {"x": 95, "y": 210},
  "target_position": {"x": 310, "y": 210},
  "horizontal_offset": 215,
  "vertical_offset": 0,
  "puzzle_type": "slider_horizontal",
  "confidence": "high",
  "measurement_process": "Left edge at 0px. Piece: left=70px, right=120px, center=95px. Gap: left=285px, right=335px, center=310px. Top edge at 0px. Both at y=185-235px, center=210px.",
  "visual_landmarks": "Piece has visible border at left side, gap clearly visible at center-right where image pattern is incomplete",
  "reasoning": "Measured from left edge: piece center at x=95px, gap center at x=310px. Offset = 310-95 = 215px RIGHT. Vertical positions align, so vertical_offset = 0."
}

**Field Requirements:**
   • piece_position: Center coordinates of movable piece (integers)
   • target_position: Center coordinates of target gap (integers)
   • horizontal_offset: EXACT pixel difference (target_x - piece_x) - INTEGER ONLY
   • vertical_offset: EXACT pixel difference (target_y - piece_y) - INTEGER ONLY
   • puzzle_type: "slider_horizontal" OR "jigsaw_2d"
   • confidence: "high", "medium", or "low"
   • measurement_process: Show pixel measurements and calculations
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

        let result;
        const maxRetries = 5;
        const baseDelay = 2000;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                result = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: contents,
                    config: {
                        temperature: 0.05,
                        topP: 0.9,
                        topK: 20,
                        maxOutputTokens: 1024,
                    }
                });
                break;
            } catch (apiError) {
                const isRateLimit = apiError.message && (
                    apiError.message.includes('429') || 
                    apiError.message.includes('Resource exhausted') ||
                    apiError.message.includes('RESOURCE_EXHAUSTED')
                );
                
                if (isRateLimit && attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    logger.warn(`⚠️ Rate limit hit, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                logger.error(`Gemini API call failed: ${JSON.stringify(apiError.message || apiError)}`);
                throw apiError;
            }
        }

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
        
        if (!jsonResponse.horizontal_offset && jsonResponse.horizontal_offset !== 0) {
            throw new Error('Missing horizontal_offset in response');
        }
        if (!jsonResponse.vertical_offset && jsonResponse.vertical_offset !== 0) {
            throw new Error('Missing vertical_offset in response');
        }
        
        logger.info(`💡 Puzzle type: ${jsonResponse.puzzle_type}`);
        logger.info(`📏 Offset: H=${jsonResponse.horizontal_offset}px, V=${jsonResponse.vertical_offset}px`);
        logger.info(`🎯 Confidence: ${jsonResponse.confidence}`);
        
        if (jsonResponse.piece_position && jsonResponse.target_position) {
            logger.info(`📍 Piece: (${jsonResponse.piece_position.x}, ${jsonResponse.piece_position.y}) → Target: (${jsonResponse.target_position.x}, ${jsonResponse.target_position.y})`);
        }
        
        if (jsonResponse.measurement_process) {
            logger.info(`📐 Measurement: ${jsonResponse.measurement_process}`);
        }
        
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

/**
 * Solve canvas-based drag challenges
 * These challenges render everything on canvas and require mouse interaction on canvas element
 */
async function solveCanvasBasedDrag(page, frame, promptText, apiKey, screenshotDir, enableScreenshot = false, maxAttempts = 2) {
    logger.info('🎨 Attempting canvas-based drag solution...');
    
    try {
        // Ensure screenshotDir is set
        if (!screenshotDir) {
            screenshotDir = path.join(__dirname, '..', 'screenshots');
            logger.debug(`📁 Using default screenshot directory: ${screenshotDir}`);
        }
        
        // Check if canvas exists
        const canvasInfo = await frame.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return null;
            
            const rect = canvas.getBoundingClientRect();
            return {
                width: canvas.width,
                height: canvas.height,
                displayWidth: rect.width,
                displayHeight: rect.height,
                x: rect.x,
                y: rect.y
            };
        });
        
        if (!canvasInfo) {
            logger.warn('No canvas element found');
            return false;
        }
        
        logger.info(`📐 Canvas: ${canvasInfo.width}x${canvasInfo.height} (display: ${canvasInfo.displayWidth}x${canvasInfo.displayHeight})`);
        
        // Take screenshot of challenge
        const timestamp = Date.now();
        const screenshotPath = path.join(screenshotDir, `canvas_drag_${timestamp}.png`);
        
        const challengeArea = await frame.$('.challenge-view, .challenge-container');
        if (challengeArea) {
            await challengeArea.screenshot({
                path: screenshotPath,
                type: 'png'
            });
            
            if (enableScreenshot) {
                logger.info(`📸 Canvas screenshot saved: ${screenshotPath}`);
            }
            
            // Analyze with Gemini to get source and target coordinates
            logger.info('🧠 Analyzing canvas challenge with Gemini...');
            const analysis = await analyzeCanvasDragWithGemini(
                screenshotPath,
                promptText,
                apiKey,
                canvasInfo,
                enableScreenshot
            );
            
            if (!analysis || !analysis.source || !analysis.target) {
                logger.error('Failed to analyze canvas drag challenge');
                return false;
            }
            
            logger.info(`📍 Source segment at: (${analysis.source.x}, ${analysis.source.y})`);
            logger.info(`🎯 Target position at: (${analysis.target.x}, ${analysis.target.y})`);
            logger.info(`💭 Reasoning: ${analysis.reasoning}`);
            
            // Get iframe offset for coordinate translation
            const frameElement = await frame.frameElement();
            let iframeOffset = { x: 0, y: 0 };
            
            if (frameElement) {
                const iframeBox = await frameElement.boundingBox();
                if (iframeBox) {
                    iframeOffset = { x: iframeBox.x, y: iframeBox.y };
                    logger.debug(`🖼️  Iframe offset: (${iframeOffset.x}, ${iframeOffset.y})`);
                }
            }
            
            // Calculate page coordinates (iframe-relative + iframe offset)
            const pageSourceX = analysis.source.x + canvasInfo.x + iframeOffset.x;
            const pageSourceY = analysis.source.y + canvasInfo.y + iframeOffset.y;
            const pageTargetX = analysis.target.x + canvasInfo.x + iframeOffset.x;
            const pageTargetY = analysis.target.y + canvasInfo.y + iframeOffset.y;
            
            logger.info(`🖱️  Performing canvas drag:`);
            logger.info(`   From: (${Math.round(pageSourceX)}, ${Math.round(pageSourceY)})`);
            logger.info(`   To:   (${Math.round(pageTargetX)}, ${Math.round(pageTargetY)})`);
            
            // Perform human-like drag on canvas
            await humanDelay(500, 800);
            
            // Move to source
            await page.mouse.move(pageSourceX, pageSourceY);
            await humanDelay(150, 250);
            
            // Mouse down to start drag
            await page.mouse.down({ button: 'left' });
            logger.info('  ✓ Mouse down - drag started');
            await humanDelay(200, 350);
            
            // Drag with smooth, human-like movement
            const steps = 30 + Math.floor(Math.random() * 15);
            const deltaX = (pageTargetX - pageSourceX) / steps;
            const deltaY = (pageTargetY - pageSourceY) / steps;
            
            logger.info(`  🔄 Dragging in ${steps} smooth steps...`);
            
            for (let i = 1; i <= steps; i++) {
                const currentX = pageSourceX + (deltaX * i);
                const currentY = pageSourceY + (deltaY * i);
                
                // Add micro-jitter for human-like movement
                const jitter = (i % 3 === 0) ? (Math.random() - 0.5) * 1.2 : 0;
                
                await page.mouse.move(
                    currentX + jitter,
                    currentY + (Math.random() - 0.5) * 0.8,
                    { steps: 1 }
                );
                
                // Variable timing - slower at start/end, faster in middle
                const stepDelay = i < steps / 4 ? 35 + Math.random() * 25 :
                                i > steps * 3 / 4 ? 30 + Math.random() * 20 :
                                20 + Math.random() * 15;
                
                await new Promise(resolve => setTimeout(resolve, stepDelay));
                
                // Add pause at midpoint (human hesitation)
                if (i === Math.floor(steps / 2)) {
                    await humanDelay(50, 120);
                }
            }
            
            logger.info('  ✓ Drag movement completed');
            await humanDelay(100, 200);
            
            // Mouse up to complete drag
            await page.mouse.up({ button: 'left' });
            logger.info('  ✓ Mouse up - drag released');
            
            await humanDelay(500, 800);
            
            logger.info('✅ Canvas drag operation completed');
            return true;
            
        } else {
            logger.error('Could not find challenge area');
            return false;
        }
        
    } catch (error) {
        logger.error(`❌ Canvas drag error: ${error.message}`);
        return false;
    }
}

/**
 * Analyze canvas drag challenge with Gemini to get source and target coordinates
 */
async function analyzeCanvasDragWithGemini(screenshotPath, promptText, apiKey, canvasInfo, enableScreenshot = false) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const geminiPrompt = `You are analyzing a hCaptcha CANVAS-BASED DRAG CHALLENGE.

🎯 CHALLENGE: "${promptText}"

📐 CANVAS INFO:
- Canvas size: ${canvasInfo.width}x${canvasInfo.height} pixels
- Display size: ${canvasInfo.displayWidth}x${canvasInfo.displayHeight} pixels

═══════════════════════════════════════════════════════════════

🔍 YOUR TASK:

1. **IDENTIFY THE SOURCE SEGMENT** (the piece to drag):
   - Usually on the RIGHT side or separate from main pattern
   - Often has a border, shadow, or visual separation
   - May be labeled with a number or positioned distinctly
   - Find the CENTER point of this segment

2. **IDENTIFY THE TARGET POSITION** (where to drag it):
   - The missing/incomplete position in the pattern
   - Where the segment logically fits to complete the pattern
   - Look for gaps, incomplete lines, or missing pieces
   - Find the CENTER point of where segment should go

3. **MEASURE PIXEL COORDINATES**:
   - Measure from the TOP-LEFT corner (0, 0) of the visible canvas area
   - Give EXACT pixel coordinates for both source and target centers
   - Coordinates should be relative to the canvas element, NOT the full page

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON RESPONSE:

{
  "source": {
    "x": 420,
    "y": 150,
    "description": "Segment piece on the right side"
  },
  "target": {
    "x": 180,
    "y": 280,
    "description": "Missing position in the pattern"
  },
  "confidence": "high",
  "reasoning": "The segment on the right at (420, 150) needs to be dragged to complete the line pattern at (180, 280). This creates a continuous path from point 5 to point 1."
}

**CRITICAL**: 
- Coordinates MUST be integers (whole numbers)
- x coordinate: 0 (left) to ${canvasInfo.displayWidth} (right)
- y coordinate: 0 (top) to ${canvasInfo.displayHeight} (bottom)
- Measure to the CENTER of each segment/position
- Be PRECISE - accuracy is critical for success`;

        const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp',
            contents: [
                {
                    inlineData: {
                        data: imageBase64,
                        mimeType: 'image/png'
                    }
                },
                { text: geminiPrompt }
            ],
            config: {
                responseMimeType: 'application/json'
            }
        });

        if (!result || !result.response) {
            throw new Error('No response from Gemini');
        }

        const responseText = result.response.text();
        const analysis = JSON.parse(responseText);
        
        if (!analysis.source || !analysis.target) {
            throw new Error('Missing source or target in response');
        }
        
        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (e) {
                logger.debug(`Failed to delete screenshot: ${e.message}`);
            }
        }
        
        return analysis;
        
    } catch (error) {
        logger.error(`❌ Gemini canvas analysis error: ${error.message}`);
        
        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (e) {
                logger.debug(`Failed to delete screenshot: ${e.message}`);
            }
        }
        
        return null;
    }
}

async function solveJigsawChallenge(page, frame, promptText, apiKey, screenshotDir, enableScreenshot = false, maxAttempts = 2) {
    const MAX_ATTEMPTS = maxAttempts;
    
    // FIRST: Check if this is a canvas-based challenge
    const hasCanvas = await frame.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const draggables = document.querySelectorAll('[draggable="true"], [class*="slider"], [class*="puzzle"], [class*="piece"]');
        // Canvas-based if canvas exists and no traditional draggable elements
        return canvas !== null && draggables.length === 0;
    });
    
    if (hasCanvas) {
        logger.info('🎨 Detected canvas-based drag challenge - using canvas solver');
        const canvasSuccess = await solveCanvasBasedDrag(page, frame, promptText, apiKey, screenshotDir, enableScreenshot, maxAttempts);
        if (canvasSuccess) {
            return true;
        }
        logger.warn('⚠️ Canvas-based solver failed, trying fallback methods...');
    }
    
    // Deteksi jenis spatial challenge
    const spatialType = classifySpatialType(promptText);
    const isComplexPattern = [
        SPATIAL_TYPES.DRAG_DROP_HOLES,
        SPATIAL_TYPES.DRAG_DROP_SIMILARITY,
        SPATIAL_TYPES.PATTERN_COMPLETION,
        SPATIAL_TYPES.DRAG_DROP_POSITION
    ].includes(spatialType);
    
    if (isComplexPattern) {
        logger.info(`🧠 Detected complex pattern challenge: ${spatialType}`);
        logger.info(`📋 Using advanced spatial reasoning with chain-of-thought`);
        
        // Gunakan spatial reasoning untuk pattern completion
        const timestamp = Date.now();
        const screenshotPath = path.join(screenshotDir, `pattern_${timestamp}.png`);
        
        const challengeArea = await frame.$('.challenge-view, .challenge-container');
        if (challengeArea) {
            await challengeArea.screenshot({
                path: screenshotPath,
                type: 'png'
            });
            
            if (enableScreenshot) {
                logger.info(`📸 Screenshot saved for pattern analysis: ${screenshotPath}`);
            }
            
            const spatialResult = await analyzePatternCompletion(
                screenshotPath,
                promptText,
                apiKey,
                enableScreenshot,
                2048  // thinking budget
            );
            
            if (spatialResult && spatialResult.solution && spatialResult.solution.length > 0) {
                logger.info(`✅ Pattern solution found with ${spatialResult.confidence} confidence`);
                logger.info(`🔑 Rule: ${spatialResult.reasoning}`);
                
                // Execute drag operations berdasarkan spatial reasoning
                const success = await executeSpatialDragOperations(page, frame, spatialResult, enableScreenshot);
                
                if (success) {
                    logger.info(`🎉 Complex pattern solved using spatial reasoning!`);
                    return true;
                }
                
                logger.warn(`⚠️ Spatial drag execution failed, falling back to simple jigsaw solver`);
            } else {
                logger.warn(`⚠️ Failed to analyze pattern, falling back to simple jigsaw solver`);
            }
        }
    } else {
        logger.info(`📌 Simple jigsaw/slider detected - using legacy offset solver`);
    }
    
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
            
            const draggableElement = await frame.$('[draggable="true"], [class*="slider"], [class*="puzzle"]');
            if (!draggableElement) {
                logger.error('Could not get draggable element');
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
            }
            
            const box = await draggableElement.boundingBox();
            if (!box) {
                logger.error('Could not get bounding box of draggable element');
                if (attempt === MAX_ATTEMPTS) return false;
                continue;
            }
            
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
            logger.info(`📏 Offset: ${offsetX}px horizontal, ${offsetY}px vertical`);
            
            const cursor = createCursor(page);
            
            logger.info('  → Moving cursor to drag start position...');
            await cursor.moveTo({ x: startX, y: startY }, {
                hesitate: Math.random() * 100 + 50,
                moveDelay: Math.random() * 500 + 300,
                waitForSelector: false
            });
            logger.info('  ✓ Cursor positioned at start');
            await humanDelay(200, 400);
            
            await page.mouse.down({ clickCount: 1 });
            logger.info('  ✓ Mouse down - starting drag');
            await humanDelay(100, 200);
            
            const steps = 25 + Math.floor(Math.random() * 20);
            const deltaX = offsetX / steps;
            const deltaY = offsetY / steps;
            
            logger.info(`  🔄 Dragging in ${steps} smooth steps (offset: ${offsetX}px, ${offsetY}px)...`);
            
            for (let i = 1; i <= steps; i++) {
                const currentX = startX + (deltaX * i);
                const currentY = startY + (deltaY * i);
                
                const jitter = i % 4 === 0 ? (Math.random() - 0.5) * 1.5 : 0;
                
                await page.mouse.move(currentX + jitter, currentY, { 
                    steps: 1 
                });
                
                const stepDelay = i < steps / 3 ? 40 + Math.random() * 30 :
                                i < steps * 2 / 3 ? 25 + Math.random() * 20 :
                                30 + Math.random() * 25;
                
                await new Promise(resolve => setTimeout(resolve, stepDelay));
                
                if (i === Math.floor(steps / 2)) {
                    await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 120));
                }
                
                if (i % 5 === 0) {
                    logger.debug(`    Progress: ${Math.round((i / steps) * 100)}% - position: (${Math.round(currentX)}, ${Math.round(currentY)})`);
                }
            }
            
            logger.info('  ✓ Drag movement completed');
            await humanDelay(150, 300);
            
            await page.mouse.up({ clickCount: 1 });
            logger.info('  ✓ Mouse up - drag released');
            
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
