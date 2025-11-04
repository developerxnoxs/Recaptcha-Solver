/**
 * Spatial Reasoning Module untuk Drag-Drop Challenges
 * Terinspirasi dari QIN2DIM/hcaptcha-challenger SpatialPathReasoner
 */

const fs = require('fs').promises;
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const createLogger = require('../utils/logger');
const { ImageDragDropChallenge, SpatialReasoningResult, SPATIAL_TYPES } = require('./models');

let logger = createLogger({ level: 'info' });

function setLogger(newLogger) {
    logger = newLogger;
}

/**
 * Enhanced Thinking Prompt untuk Spatial Reasoning
 * Menggunakan Chain-of-Thought seperti Python repo
 */
const THINKING_PROMPT_SPATIAL = `You are an EXPERT spatial reasoning AI solving a complex visual puzzle. You MUST use step-by-step Chain-of-Thought reasoning.

═══════════════════════════════════════════════════════════════
🧩 **SYSTEMATIC SPATIAL ANALYSIS METHOD**
═══════════════════════════════════════════════════════════════

**STEP 1: GOAL ANALYSIS**
First, understand EXACTLY what the puzzle asks:
   • Read the prompt carefully
   • Identify the PRIMARY objective (drag, match, complete, etc.)
   • Determine the TYPE of spatial task

**STEP 2: SOURCE IDENTIFICATION**
Analyze the movable/draggable elements:
   • COUNT: How many pieces/elements can be moved?
   • POSITION: Where are they located currently?
   • FEATURES: What are their distinguishing characteristics?
     - Shape (circle, square, triangle, irregular)
     - Size (small, medium, large)
     - Internal features (holes, patterns, lines, segments)
     - Color/shading (if relevant)
   • UNIQUE IDENTIFIERS: What makes each source unique?

**STEP 3: DESTINATION/TARGET IDENTIFICATION**
Analyze where elements should go:
   • COUNT: How many target positions/options exist?
   • POSITION: Where are they located?
   • CONTEXT: What is the surrounding pattern/structure?
   • CLUES: Visual hints for correct placement

**STEP 4: RULE INFERENCE** ⚠️ CRITICAL STEP
Determine the LOGICAL PATTERN connecting sources to destinations:

Common Pattern Types:
   🔹 **Hole Matching**: "Shapes with same number of holes"
      → Count holes in source, find destination with same hole count
   
   🔹 **Shape Similarity**: "Most similar shape"
      → Compare overall form, ignore minor details
      → Match geometric structure (angles, curves, symmetry)
   
   🔹 **Pattern Completion**: "Complete the sequence"
      → Identify existing pattern (rotation, size progression, etc.)
      → Determine what's missing to continue the pattern
   
   🔹 **Position Logic**: "Missing position in grid"
      → Analyze spatial arrangement
      → Find empty slot that makes pattern consistent
   
   🔹 **Feature Matching**: "Match by specific attribute"
      → Isolate the matching criterion (color, orientation, parts)
      → Find exact correspondence

**STEP 5: VERIFICATION**
Double-check your reasoning:
   ✓ Does the rule explain ALL pairings/placements?
   ✓ Is there contradicting evidence?
   ✓ Are you following the EXACT prompt requirement?
   ✓ Have you counted/analyzed EVERY element?

**STEP 6: SOLUTION DETERMINATION**
Based on inferred rule, determine:
   • Which source goes to which destination
   • The exact drag path (start → end coordinates)
   • Confidence level in the solution

═══════════════════════════════════════════════════════════════
📊 **REQUIRED RESPONSE FORMAT** (JSON only)
═══════════════════════════════════════════════════════════════

{
  "goal_analysis": "User needs to drag shapes on the right to match shapes on the left based on hole count",
  "source_elements": [
    {
      "id": 1,
      "position": "top-right",
      "description": "Circle with 2 holes (top and bottom)",
      "features": {
        "shape": "circle",
        "holes": 2,
        "distinctive_marks": "symmetric holes"
      }
    },
    {
      "id": 2,
      "position": "bottom-right",
      "description": "Triangle with 0 holes",
      "features": {
        "shape": "triangle",
        "holes": 0,
        "distinctive_marks": "solid shape"
      }
    }
  ],
  "target_positions": [
    {
      "id": "A",
      "position": "left-top",
      "description": "Square with 2 holes (left and right)",
      "features": {
        "shape": "square",
        "holes": 2
      }
    },
    {
      "id": "B",
      "position": "left-bottom",
      "description": "Pentagon with 0 holes",
      "features": {
        "shape": "pentagon",
        "holes": 0
      }
    }
  ],
  "inferred_rule": "Match draggable shapes (right) to target shapes (left) based on the NUMBER OF HOLES, regardless of shape type",
  "reasoning_steps": [
    "Step 1: Counted holes in each source - Circle has 2, Triangle has 0",
    "Step 2: Counted holes in each target - Square has 2, Pentagon has 0",
    "Step 3: Prompt says 'match shapes' - testing different criteria",
    "Step 4: Shape type doesn't match (circle ≠ square), so that's not the rule",
    "Step 5: Hole count DOES match - Circle(2) → Square(2), Triangle(0) → Pentagon(0)",
    "Step 6: Verified rule works for all pairs"
  ],
  "solution": [
    {
      "source_id": 1,
      "target_id": "A",
      "explanation": "Circle with 2 holes → Square with 2 holes"
    },
    {
      "source_id": 2,
      "target_id": "B",
      "explanation": "Triangle with 0 holes → Pentagon with 0 holes"
    }
  ],
  "confidence": "high",
  "visual_evidence": "Clear visual count of holes in all shapes, rule is unambiguous",
  "alternative_interpretations": "None - hole count is the only consistent pattern"
}

⚠️ **CRITICAL REQUIREMENTS:**
- Use systematic analysis - don't skip steps
- INFER THE RULE explicitly - this is key to solving puzzles
- Show your reasoning process step-by-step
- Return ONLY valid JSON (no markdown, no extra text)
- Be PRECISE with descriptions and features`;

async function analyzePatternCompletion(screenshotPath, promptText, apiKey, enableScreenshot = false, thinkingBudget = 2048) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🧩 Analyzing pattern completion puzzle: ${promptText}`);
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const finalPrompt = `${THINKING_PROMPT_SPATIAL}

🎯 **YOUR TASK**: "${promptText}"

Analyze this image systematically and provide a complete JSON response with:
1. Goal analysis
2. Source elements (what can be dragged)
3. Target positions (where they should go)
4. Inferred rule (THE KEY PATTERN)
5. Reasoning steps (chain-of-thought)
6. Solution (source → target mappings)
7. Confidence level

Use the EXACT JSON format shown above. Think step-by-step!`;

        const contents = [
            {
                inlineData: {
                    mimeType: "image/png",
                    data: imageBase64
                }
            },
            finalPrompt
        ];

        let result;
        const maxRetries = 5;
        const baseDelay = 2000;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                result = await ai.models.generateContent({
                    model: 'gemini-2.5-pro',  // Pro model for complex reasoning
                    contents: contents,
                    config: {
                        temperature: 0.1,  // Low temperature for consistency
                        topP: 0.95,
                        topK: 40,
                        maxOutputTokens: thinkingBudget,
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
        logger.debug("Gemini Spatial Reasoning Response:", response);

        let jsonStr = response;
        if (response && response.includes('```json')) {
            jsonStr = response.split('```json')[1].split('```')[0].trim();
        } else if (response && response.includes('```')) {
            jsonStr = response.split('```')[1].split('```')[0].trim();
        }

        const jsonResponse = JSON.parse(jsonStr);
        
        logger.info(`🎯 Goal: ${jsonResponse.goal_analysis || 'Not specified'}`);
        logger.info(`📊 Sources: ${jsonResponse.source_elements?.length || 0}, Targets: ${jsonResponse.target_positions?.length || 0}`);
        logger.info(`🔑 Inferred Rule: ${jsonResponse.inferred_rule || 'Not identified'}`);
        logger.info(`💡 Confidence: ${jsonResponse.confidence || 'unknown'}`);
        
        if (jsonResponse.reasoning_steps && Array.isArray(jsonResponse.reasoning_steps)) {
            logger.info(`🧠 Reasoning Process:`);
            jsonResponse.reasoning_steps.forEach((step, idx) => {
                logger.info(`   ${idx + 1}. ${step}`);
            });
        }
        
        if (jsonResponse.solution && Array.isArray(jsonResponse.solution)) {
            logger.info(`✅ Solution:`);
            jsonResponse.solution.forEach(mapping => {
                logger.info(`   Source ${mapping.source_id} → Target ${mapping.target_id}: ${mapping.explanation}`);
            });
        }

        if (shouldCleanup) {
            try {
                await fs.unlink(screenshotPath);
            } catch (unlinkError) {
                logger.debug(`Failed to delete screenshot: ${unlinkError.message}`);
            }
        }

        return new SpatialReasoningResult({
            confidence: jsonResponse.confidence || 'medium',
            reasoning: jsonResponse.inferred_rule,
            solution: jsonResponse.solution,
            thinkingProcess: jsonResponse.reasoning_steps,
            visualEvidence: jsonResponse.visual_evidence,
            metadata: {
                goalAnalysis: jsonResponse.goal_analysis,
                sourceElements: jsonResponse.source_elements,
                targetPositions: jsonResponse.target_positions,
                alternativeInterpretations: jsonResponse.alternative_interpretations
            }
        });

    } catch (error) {
        logger.error(`❌ Spatial Reasoning Error: ${error.message}`);
        
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
 * Deteksi jenis spatial challenge dari prompt
 */
function classifySpatialType(promptText) {
    const prompt = promptText.toLowerCase();
    
    if (prompt.includes('hole') || prompt.includes('holes')) {
        return SPATIAL_TYPES.DRAG_DROP_HOLES;
    }
    
    if (prompt.includes('similar') || prompt.includes('match')) {
        return SPATIAL_TYPES.DRAG_DROP_SIMILARITY;
    }
    
    if (prompt.includes('complete') || prompt.includes('pattern') || prompt.includes('sequence')) {
        return SPATIAL_TYPES.PATTERN_COMPLETION;
    }
    
    if (prompt.includes('position') || prompt.includes('missing position')) {
        return SPATIAL_TYPES.DRAG_DROP_POSITION;
    }
    
    if (prompt.includes('slider') || prompt.includes('slide')) {
        return SPATIAL_TYPES.SLIDER;
    }
    
    return SPATIAL_TYPES.JIGSAW;
}

module.exports = {
    analyzePatternCompletion,
    classifySpatialType,
    setLogger,
    THINKING_PROMPT_SPATIAL
};
