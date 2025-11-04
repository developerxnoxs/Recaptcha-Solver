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
 * Verify if puzzle is solved by taking screenshot and checking with Gemini
 */
async function verifyPuzzleCompletion(frame, screenshotDir, apiKey, enableScreenshot = false) {
    try {
        const timestamp = Date.now();
        const verifyPath = path.join(screenshotDir, `verify_${timestamp}.png`);
        
        const challengeArea = await frame.$('.challenge-view, .challenge-container');
        if (!challengeArea) {
            logger.warn('Could not find challenge area for verification');
            return { complete: false, confidence: 'unknown' };
        }
        
        await challengeArea.screenshot({
            path: verifyPath,
            type: 'png'
        });
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(verifyPath);
        const imageBase64 = imageData.toString('base64');
        
        const verifyPrompt = `Analyze this hCaptcha puzzle image and determine if it is SOLVED or UNSOLVED.

A puzzle is SOLVED when:
✓ All pieces fit perfectly with no gaps
✓ Image patterns/edges align seamlessly
✓ No visible misalignment or offset
✓ The puzzle appears complete and correct

A puzzle is UNSOLVED when:
✗ Visible gaps or misalignment
✗ Piece is offset from target
✗ Pattern edges don't match
✗ Puzzle still appears incomplete

Respond with ONLY valid JSON:
{
  "status": "solved" or "unsolved",
  "confidence": "high", "medium", or "low",
  "offset_detected": {"x": 0, "y": 0},
  "reasoning": "Brief explanation"
}`;

        const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [
                {
                    inlineData: {
                        mimeType: "image/png",
                        data: imageBase64
                    }
                },
                verifyPrompt
            ],
            config: {
                temperature: 0.1,
                maxOutputTokens: 512
            }
        });
        
        const responseText = result.response.text();
        let jsonStr = responseText.trim();
        if (jsonStr.includes('```json')) {
            jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
        } else if (jsonStr.includes('```')) {
            jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
        }
        
        const verification = JSON.parse(jsonStr);
        
        // Cleanup screenshot if not keeping
        if (!enableScreenshot) {
            try {
                await fs.unlink(verifyPath);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        
        logger.info(`🔍 Verification: ${verification.status} (${verification.confidence} confidence)`);
        if (verification.reasoning) {
            logger.info(`   Reason: ${verification.reasoning}`);
        }
        
        return {
            complete: verification.status === 'solved',
            confidence: verification.confidence,
            offset: verification.offset_detected || { x: 0, y: 0 }
        };
        
    } catch (error) {
        logger.warn(`⚠️ Verification failed: ${error.message}`);
        return { complete: false, confidence: 'unknown' };
    }
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
            // Include scroll offset for accurate coordinates (sama seperti bounding-box-solver)
            iframeOffset = await frameElement.evaluate((iframe) => {
                const rect = iframe.getBoundingClientRect();
                const scrollX = window.scrollX || window.pageXOffset || 0;
                const scrollY = window.scrollY || window.pageYOffset || 0;
                return {
                    x: rect.left + scrollX,
                    y: rect.top + scrollY
                };
            });
            logger.debug(`🖼️  Iframe offset (with scroll): (${iframeOffset.x}, ${iframeOffset.y})`);
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
        
        const geminiPrompt = `You are an EXPERT computer vision AI analyzing a hCaptcha JIGSAW/SLIDER puzzle. You MUST calculate PIXEL-PERFECT offsets with ZERO tolerance for error.

🎯 CHALLENGE: "${promptText}"

═══════════════════════════════════════════════════════════════

📐 MEASUREMENT SYSTEM - CRITICAL:

**COORDINATE GRID REFERENCE:**
- Origin (0,0) = TOP-LEFT corner of the image
- X-axis increases → RIGHTWARD (0 → width)
- Y-axis increases ↓ DOWNWARD (0 → height)
- All measurements in PIXELS (integers only)

**MENTAL GRID OVERLAY:**
Imagine a ruler along the top and left edges:
   Top ruler:    0px ────→ 100px ────→ 200px ────→ 300px ────→ ...
   Left ruler:   0px
                 ↓
                100px
                 ↓
                200px
                 ↓

═══════════════════════════════════════════════════════════════

📍 STEP-BY-STEP MEASUREMENT PROTOCOL:

**STEP 1: IDENTIFY COMPONENTS**

🧩 MOVABLE PIECE indicators:
   • Distinct colored border (blue, white, black outline)
   • Drop shadow or glow effect
   • Visually separated from background
   • Often positioned at LEFT or RIGHT edge initially

🎯 TARGET GAP indicators:
   • Missing puzzle piece in otherwise complete image
   • Visible edge discontinuity
   • Pattern/color mismatch at boundaries
   • Incomplete section waiting for piece

**STEP 2: MEASURE WITH PIXEL PRECISION**

For MOVABLE PIECE:
   1. Identify LEFT edge of piece → count pixels from image left edge
   2. Identify RIGHT edge of piece → count pixels from image left edge
   3. Calculate CENTER: piece_x = (left_edge + right_edge) / 2
   4. Identify TOP edge → count pixels from image top edge
   5. Identify BOTTOM edge → count pixels from image top edge
   6. Calculate CENTER: piece_y = (top_edge + bottom_edge) / 2
   
   EXAMPLE:
   - Piece spans from x=80 to x=120 → center_x = 100px
   - Piece spans from y=200 to y=240 → center_y = 220px

For TARGET GAP:
   1. Find the EXACT missing area in the background
   2. Identify LEFT boundary of gap
   3. Identify RIGHT boundary of gap
   4. Calculate CENTER: target_x = (left_bound + right_bound) / 2
   5. Identify TOP boundary
   6. Identify BOTTOM boundary
   7. Calculate CENTER: target_y = (top_bound + bottom_bound) / 2

**STEP 3: CALCULATE OFFSET (CRITICAL!)**

horizontal_offset = target_x - piece_x
vertical_offset = target_y - piece_y

SIGN CONVENTION:
   • Positive H offset = move piece RIGHT →
   • Negative H offset = move piece LEFT ←
   • Positive V offset = move piece DOWN ↓
   • Negative V offset = move piece UP ↑

**STEP 4: TRIPLE-CHECK VALIDATION**

✓ Position sanity: Are piece_x, piece_y within image bounds?
✓ Offset sanity: Are offsets reasonable? (typically -500 to +500px)
✓ Direction check: Does offset direction match visual gap position?
✓ Magnitude check: Does offset magnitude match distance?
✓ For horizontal sliders: vertical_offset should be ≈ 0 (±5px max)

═══════════════════════════════════════════════════════════════

🎯 PRECISION TECHNIQUES:

1. **Edge Alignment Analysis:**
   - Trace piece edges and gap edges
   - Find exact pixel where patterns should connect
   - Match texture boundaries pixel-by-pixel

2. **Pattern Continuation:**
   - Identify patterns (lines, shapes, colors) in background
   - Trace how they continue into the gap
   - Find EXACT pixel where piece pattern matches

3. **Sub-Pixel Accuracy:**
   - If boundary appears between pixels, round to nearest integer
   - Prefer the pixel that creates better visual alignment
   - Document uncertainty in measurement_process

4. **Visual Landmarks:**
   - Use distinct features (corners, color changes, pattern edges)
   - Cross-reference multiple landmarks for verification
   - State which landmarks you used for measurement

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON OUTPUT (EXACT FORMAT):

{
  "piece_position": {"x": 100, "y": 220},
  "target_position": {"x": 315, "y": 220},
  "horizontal_offset": 215,
  "vertical_offset": 0,
  "puzzle_type": "slider_horizontal",
  "confidence": "high",
  "measurement_process": "Piece edges: left=80px, right=120px → center_x=100px. Gap edges: left=295px, right=335px → center_x=315px. Vertical: piece y=200-240 → center=220px, gap y=200-240 → center=220px. Offset: H=315-100=215px, V=220-220=0px.",
  "visual_landmarks": "Piece has blue border at x=80-120. Gap visible at x=295-335 where sky pattern is incomplete. Both at same vertical level y=220.",
  "reasoning": "Measured pixel-by-pixel from image edges. Piece center at (100,220), gap center at (315,220). Horizontal offset = 315-100 = 215px RIGHT. Vertical positions identical, offset = 0px."
}

**MANDATORY FIELDS:**
   • piece_position: {x, y} - integers, piece center coordinates
   • target_position: {x, y} - integers, gap center coordinates
   • horizontal_offset: INTEGER (target_x - piece_x)
   • vertical_offset: INTEGER (target_y - piece_y)
   • puzzle_type: "slider_horizontal" | "jigsaw_2d"
   • confidence: "high" | "medium" | "low"
   • measurement_process: DETAILED pixel counting explanation
   • visual_landmarks: Specific features you used
   • reasoning: Full calculation walkthrough

⚠️ ULTRA-CRITICAL REQUIREMENTS:
   - Output ONLY valid JSON (no markdown, no text outside JSON)
   - ALL offsets MUST be INTEGERS (whole numbers)
   - ±1 pixel error can cause FAILURE - be EXACT!
   - Show your pixel counting work in measurement_process
   - Document ALL measurement steps clearly

MEASURE WITH SURGICAL PRECISION! Every pixel counts!`;

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
                    model: 'gemini-2.0-flash',
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
            
            // Get iframe offset for coordinate translation (include scroll)
            const frameElement = await frame.frameElement();
            let iframeOffset = { x: 0, y: 0 };
            
            if (frameElement) {
                iframeOffset = await frameElement.evaluate((iframe) => {
                    const rect = iframe.getBoundingClientRect();
                    const scrollX = window.scrollX || window.pageXOffset || 0;
                    const scrollY = window.scrollY || window.pageYOffset || 0;
                    return {
                        x: rect.left + scrollX,
                        y: rect.top + scrollY
                    };
                });
                logger.debug(`🖼️  Iframe offset (with scroll): (${iframeOffset.x}, ${iframeOffset.y})`);
            }
            
            // CRITICAL: Calculate scaling factor
            // AI analyzes canvas at full size, but browser displays it scaled down
            const scaleX = canvasInfo.displayWidth / canvasInfo.width;
            const scaleY = canvasInfo.displayHeight / canvasInfo.height;
            
            logger.debug(`📏 Scale factors: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`);
            
            // Convert AI coordinates (canvas size) to display coordinates (scaled)
            const displaySourceX = analysis.source.x * scaleX;
            const displaySourceY = analysis.source.y * scaleY;
            const displayTargetX = analysis.target.x * scaleX;
            const displayTargetY = analysis.target.y * scaleY;
            
            // Calculate final page coordinates (display coords + canvas position + iframe offset)
            const pageSourceX = displaySourceX + canvasInfo.x + iframeOffset.x;
            const pageSourceY = displaySourceY + canvasInfo.y + iframeOffset.y;
            const pageTargetX = displayTargetX + canvasInfo.x + iframeOffset.x;
            const pageTargetY = displayTargetY + canvasInfo.y + iframeOffset.y;
            
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
        const maxRetries = 3;
        const baseDelay = 2000;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                result = await ai.models.generateContent({
                    model: 'gemini-2.0-flash',
                    contents: contents,
                    config: {
                        temperature: 0.1,
                        topP: 0.9,
                        topK: 20,
                        maxOutputTokens: 2048
                    }
                });
                break;
            } catch (apiError) {
                const isOverloaded = apiError.message && (
                    apiError.message.includes('503') || 
                    apiError.message.includes('overloaded') ||
                    apiError.message.includes('UNAVAILABLE')
                );
                
                if (isOverloaded && attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    logger.warn(`⚠️ API overloaded, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                throw apiError;
            }
        }

        if (!result) {
            throw new Error('No result from Gemini API');
        }
        
        // Try different response formats
        let responseText;
        if (result.response && typeof result.response.text === 'function') {
            responseText = await result.response.text();
        } else if (result.response && result.response.text) {
            responseText = result.response.text;
        } else if (typeof result.text === 'function') {
            responseText = await result.text();
        } else if (result.text) {
            responseText = result.text;
        } else if (result.response && result.response.candidates && result.response.candidates[0]) {
            const candidate = result.response.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
                responseText = candidate.content.parts[0].text;
            }
        } else {
            logger.error('Unexpected result structure:', Object.keys(result));
            if (result.response) {
                logger.error('Response keys:', Object.keys(result.response));
            }
            throw new Error('No response text from Gemini');
        }
        // Parse JSON response (handle markdown code blocks)
        let jsonStr = responseText.trim();
        if (jsonStr.includes('```json')) {
            jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
        } else if (jsonStr.includes('```')) {
            jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
        }
        
        const analysis = JSON.parse(jsonStr);
        
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
            
            // Get iframe offset dengan scroll untuk koordinat akurat
            const frameElement = await frame.frameElement();
            let iframeOffset = { x: 0, y: 0 };
            
            if (frameElement) {
                iframeOffset = await frameElement.evaluate((iframe) => {
                    const rect = iframe.getBoundingClientRect();
                    const scrollX = window.scrollX || window.pageXOffset || 0;
                    const scrollY = window.scrollY || window.pageYOffset || 0;
                    return {
                        x: rect.left + scrollX,
                        y: rect.top + scrollY
                    };
                });
            }
            
            // Get element position relative to iframe
            const elementRect = await draggableElement.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                };
            });
            
            // Calculate page coordinates (iframe-relative + iframe offset)
            const startX = elementRect.x + elementRect.width / 2 + iframeOffset.x;
            const startY = elementRect.y + elementRect.height / 2 + iframeOffset.y;
            
            logger.debug(`🎯 Draggable element: iframe(${Math.round(elementRect.x)}, ${Math.round(elementRect.y)}) + offset(${Math.round(iframeOffset.x)}, ${Math.round(iframeOffset.y)}) = page(${Math.round(startX)}, ${Math.round(startY)})`);
            
            // Use exact offset from Gemini analysis
            let offsetX = analysis.horizontal_offset;
            let offsetY = analysis.vertical_offset;
            
            // Validate offset values (sanity check)
            const maxReasonableOffset = 800;  // pixels
            if (Math.abs(offsetX) > maxReasonableOffset || Math.abs(offsetY) > maxReasonableOffset) {
                logger.warn(`⚠️ Offset seems unreasonably large: (${offsetX}, ${offsetY})`);
                logger.warn(`   This might indicate a measurement error.`);
            }
            
            // Hanya apply adjustment jika attempt > 1 AND confidence rendah
            if (attempt > 1 && analysis.confidence === 'low') {
                const adjustment = (attempt - 1) * 2;  // Small adjustment untuk retry
                offsetX += Math.random() > 0.5 ? adjustment : -adjustment;
                logger.info(`⚙️  Low confidence adjustment: ±${adjustment}px (attempt ${attempt})`);
            }
            
            const endX = startX + offsetX;
            const endY = startY + offsetY;
            
            logger.info(`📏 Puzzle Analysis:`);
            logger.info(`   • Piece position: (${analysis.piece_position?.x || 'N/A'}, ${analysis.piece_position?.y || 'N/A'})`);
            logger.info(`   • Target position: (${analysis.target_position?.x || 'N/A'}, ${analysis.target_position?.y || 'N/A'})`);
            logger.info(`   • Calculated offset: H=${offsetX}px, V=${offsetY}px`);
            logger.info(`   • Confidence: ${analysis.confidence || 'unknown'}`);
            logger.info(`🖱️  Drag coordinates:`);
            logger.info(`   • Start: (${Math.round(startX)}, ${Math.round(startY)})`);
            logger.info(`   • End:   (${Math.round(endX)}, ${Math.round(endY)})`);
            logger.info(`   • Distance: ${Math.round(Math.sqrt(offsetX**2 + offsetY**2))}px`);
            
            // Take before-drag screenshot if enabled (for debugging)
            if (enableScreenshot) {
                const beforeTimestamp = Date.now();
                const beforePath = path.join(screenshotDir, `before_${beforeTimestamp}.png`);
                const challengeArea = await frame.$('.challenge-view, .challenge-container');
                if (challengeArea) {
                    await challengeArea.screenshot({ path: beforePath, type: 'png' });
                    logger.info(`📸 Before-drag screenshot saved: ${beforePath}`);
                }
            }
            
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
            
            // Take after-drag screenshot if enabled
            if (enableScreenshot) {
                const afterTimestamp = Date.now();
                const afterPath = path.join(screenshotDir, `after_${afterTimestamp}.png`);
                const challengeArea = await frame.$('.challenge-view, .challenge-container');
                if (challengeArea) {
                    await challengeArea.screenshot({ path: afterPath, type: 'png' });
                    logger.info(`📸 After-drag screenshot saved: ${afterPath}`);
                }
            }
            
            // Verify puzzle completion with Gemini (PRIMARY CHECK)
            logger.info('🔍 Verifying puzzle completion...');
            const verification = await verifyPuzzleCompletion(frame, screenshotDir, apiKey, enableScreenshot);
            
            if (verification.complete) {
                logger.info('✅ Puzzle verified as SOLVED!');
                return true;
            }
            
            // Secondary check: DOM verification
            const isStillPresent = await frame.evaluate(() => {
                const draggable = document.querySelector('[draggable="true"], [class*="slider"], [class*="puzzle"]');
                return draggable !== null;
            });
            
            if (!isStillPresent) {
                // Element removed but verification says not complete - trust verification
                logger.warn('⚠️  Draggable removed but verification shows incomplete - this is unusual');
                if (attempt === MAX_ATTEMPTS) {
                    logger.warn('   Max attempts reached, accepting DOM result');
                    return true;
                }
                // Continue to retry on next attempt
                continue;
            }
            
            // Puzzle incomplete - try micro-adjustment if offset detected
            const hasOffset = verification.offset && (Math.abs(verification.offset.x) > 0 || Math.abs(verification.offset.y) > 0);
            const shouldAdjust = hasOffset && (Math.abs(verification.offset.x) <= 10 && Math.abs(verification.offset.y) <= 10);
            
            if (shouldAdjust) {
                logger.warn(`⚠️  Puzzle incomplete. Detected offset: (${verification.offset.x}, ${verification.offset.y})`);
                logger.info('🔧 Attempting micro-adjustment...');
                
                try {
                    // Get current draggable position
                    const currentElement = await frame.$('[draggable="true"], [class*="slider"], [class*="puzzle"]');
                    if (currentElement) {
                        const currentRect = await currentElement.evaluate((el) => {
                            const rect = el.getBoundingClientRect();
                            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                        });
                        
                        const currentX = currentRect.x + currentRect.width / 2 + iframeOffset.x;
                        const currentY = currentRect.y + currentRect.height / 2 + iframeOffset.y;
                        
                        // Apply micro-adjustment based on detected offset
                        const adjustX = verification.offset.x * -1; // Reverse direction
                        const adjustY = verification.offset.y * -1;
                        
                        logger.info(`   Adjusting by (${adjustX}, ${adjustY}) pixels...`);
                        
                        await page.mouse.move(currentX, currentY);
                        await humanDelay(100, 200);
                        await page.mouse.down({ clickCount: 1 });
                        await humanDelay(100, 150);
                        
                        const targetX = currentX + adjustX;
                        const targetY = currentY + adjustY;
                        
                        // Smooth micro-adjustment
                        for (let i = 1; i <= 10; i++) {
                            const stepX = currentX + (adjustX * i / 10);
                            const stepY = currentY + (adjustY * i / 10);
                            await page.mouse.move(stepX, stepY, { steps: 1 });
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                        
                        await humanDelay(100, 150);
                        await page.mouse.up({ clickCount: 1 });
                        await humanDelay(500, 800);
                        
                        logger.info('   ✓ Micro-adjustment applied');
                        
                        // Verify again
                        const finalVerification = await verifyPuzzleCompletion(frame, screenshotDir, apiKey, enableScreenshot);
                        if (finalVerification.complete) {
                            logger.info('🎉 Puzzle solved after micro-adjustment!');
                            return true;
                        }
                    }
                } catch (adjustError) {
                    logger.warn(`   Micro-adjustment failed: ${adjustError.message}`);
                }
            }
            
            logger.warn(`⚠️  Puzzle still incomplete after attempt ${attempt}/${MAX_ATTEMPTS}`);
            if (analysis.confidence === 'high') {
                logger.warn('   Despite high confidence from analysis, puzzle not solved');
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
