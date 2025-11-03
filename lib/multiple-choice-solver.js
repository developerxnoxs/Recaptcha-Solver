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

async function analyzeMultipleChoiceWithGemini(screenshotPath, promptText, choices, apiKey, enableScreenshot = false) {
    const shouldCleanup = !enableScreenshot;
    
    try {
        logger.info(`🤔 Analyzing multiple choice challenge: ${promptText}`);
        
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const imageData = await fs.readFile(screenshotPath);
        const imageBase64 = imageData.toString('base64');
        
        const choicesList = choices.map((c, idx) => `${idx + 1}. ${c.text || `Choice ${idx + 1}`}`).join('\n');
        
        const geminiPrompt = `You are an EXPERT visual recognition AI with PERFECT accuracy solving a hCaptcha MULTIPLE CHOICE challenge. You MUST analyze the image with EXTREME precision and select the CORRECT answer.

🎯 QUESTION: "${promptText}"

📋 AVAILABLE CHOICES:
${choicesList}

═══════════════════════════════════════════════════════════════

🔬 ULTRA-PRECISE ANALYSIS METHOD:

**STEP 1: DEEP IMAGE EXAMINATION**

Analyze EVERY visual detail:
   • 🖼️ Primary Subject: What is the MAIN object/scene in the image?
   • 🎨 Colors & Textures: Dominant colors, patterns, materials
   • 📐 Shapes & Structures: Geometric forms, architectural elements
   • 📍 Context & Setting: Indoor/outdoor, time of day, location type
   • 🔍 Fine Details: Small features that distinguish the subject
   • 🌅 Lighting & Atmosphere: Lighting conditions, weather, mood

**STEP 2: QUESTION TYPE IDENTIFICATION**

Determine EXACTLY what is being asked:

   Type A: **Direct Object Identification**
      "What is this?" / "What animal/vehicle/object is shown?"
      → Identify the SPECIFIC type/species/model
      → Look for distinguishing features (ears, wheels, shape, etc.)
   
   Type B: **Scene/Location Classification**
      "What room/place is this?" / "Where was this taken?"
      → Identify environmental markers (furniture, architecture, natural features)
      → Consider function and purpose of the space
   
   Type C: **Action/Activity Recognition**
      "What is happening?" / "What is the person doing?"
      → Focus on body position, movement, interaction
      → Consider context clues (equipment, location, clothing)
   
   Type D: **Attribute/Property Selection**
      "What color/weather/time?" / "Which feature is present?"
      → Quantify or categorize the specific attribute
      → Compare against all available choices

**STEP 3: SYSTEMATIC CHOICE EVALUATION**

For EACH choice, analyze:
   ✓ Does it match the PRIMARY subject in the image?
   ✓ Are ALL visual characteristics consistent?
   ✓ Does it account for ALL visible details?
   ✓ Is there ANY contradicting evidence?

Scoring system:
   • Perfect match (100%): Every detail aligns, no contradictions
   • Strong match (70-99%): Most details align, minor ambiguity
   • Weak match (30-69%): Some similarities, significant differences
   • No match (0-29%): Fundamental mismatch

**STEP 4: ELIMINATION PROCESS**

Remove choices that:
   ❌ Describe a completely different object/scene
   ❌ Have contradicting visual features
   ❌ Are too general when specific answer exists
   ❌ Are too specific when general answer is correct
   ❌ Confuse similar but distinct items

**STEP 5: FINAL SELECTION WITH CONFIDENCE**

After elimination, select the choice with:
   ✅ HIGHEST visual evidence match
   ✅ MOST SPECIFIC correct description
   ✅ STRONGEST logical consistency
   ✅ CLEAREST alignment with image content

═══════════════════════════════════════════════════════════════

🎓 EXPERT RECOGNITION GUIDELINES:

**Common Distinctions to Master:**

Animals:
   • Cat vs Dog: Ears (pointed vs floppy), face shape, whiskers
   • Horse vs Zebra: Stripes pattern, mane, body shape
   • Bird types: Beak shape, plumage, size, habitat

Vehicles:
   • Car vs Truck: Cargo bed, size, number of doors
   • Bus vs Van: Length, windows, passenger capacity
   • Motorcycle vs Bicycle: Motor, size, wheel configuration

Rooms/Places:
   • Kitchen: Stove, refrigerator, counter, cabinets
   • Bedroom: Bed, dresser, nightstand, closet
   • Bathroom: Toilet, sink, shower/tub, tiles
   • Office: Desk, computer, office chair, filing

Objects:
   • Chair vs Stool: Backrest presence
   • Table vs Desk: Size, drawers, purpose
   • Cup vs Mug: Handle, size, shape

═══════════════════════════════════════════════════════════════

📊 REQUIRED JSON RESPONSE FORMAT:

{
  "selected_index": 2,
  "choice_text": "cat",
  "confidence": "high",
  "visual_evidence": "Pointed triangular ears, visible whiskers, feline facial structure, sitting posture typical of cats",
  "eliminated_choices": "Rejected 'dog' due to ear shape and facial features. Rejected 'rabbit' due to body proportions and tail.",
  "reasoning": "Image clearly shows a domestic cat based on distinctive feline features: pointed ears, whisker pads, almond-shaped eyes, and characteristic sitting posture. No ambiguity."
}

**Field Requirements:**
   • selected_index: Zero-based index (0=first choice, 1=second, etc.)
   • choice_text: EXACT text of the selected choice
   • confidence: "high" (>90% certain), "medium" (70-90%), or "low" (<70%)
   • visual_evidence: List specific visual features that support your choice
   • eliminated_choices: Briefly explain why you rejected other options
   • reasoning: Comprehensive explanation of your decision

⚠️ CRITICAL REQUIREMENTS:
   - Respond with ONLY valid JSON (no markdown, no explanation outside JSON)
   - Select EXACTLY ONE choice
   - Be DECISIVE even if slightly uncertain
   - Use VISUAL EVIDENCE only (no assumptions)
   - Double-check selected_index matches choice_text

Analyze with MAXIMUM precision!`;

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
        logger.info(`✓ Selected choice: ${jsonResponse.choice_text} (index: ${jsonResponse.selected_index})`);
        logger.info(`📊 Confidence: ${jsonResponse.confidence}`);
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

async function solveMultipleChoiceChallenge(page, frame, challengeInfo, apiKey, screenshotDir, enableScreenshot = false) {
    try {
        logger.info('🎯 Solving MULTIPLE_CHOICE challenge...');
        
        const choices = challengeInfo.elements.choices;
        if (!choices || choices.length === 0) {
            logger.error('No choices found in challenge');
            return false;
        }
        
        logger.info(`📋 Found ${choices.length} choices`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const timestamp = Date.now();
        const screenshotPath = path.join(screenshotDir, `multiple_choice_${timestamp}.png`);
        
        const challengeArea = await frame.$('.challenge-view, .challenge-container, .image_label_multiple_choice');
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
        
        const analysis = await analyzeMultipleChoiceWithGemini(
            screenshotPath,
            challengeInfo.prompt?.text || 'Select the correct answer',
            choices,
            apiKey,
            enableScreenshot
        );
        
        if (!analysis || analysis.selected_index === undefined) {
            logger.error('Failed to analyze multiple choice challenge');
            return false;
        }
        
        const selectedIndex = analysis.selected_index;
        if (selectedIndex < 0 || selectedIndex >= choices.length) {
            logger.error(`Invalid choice index: ${selectedIndex}`);
            return false;
        }
        
        logger.info(`🖱️  Clicking choice ${selectedIndex + 1} of ${choices.length}...`);
        
        const buttonPosition = await frame.evaluate((selectors, index) => {
            const buttons = document.querySelectorAll(selectors);
            if (buttons[index]) {
                const rect = buttons[index].getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    width: rect.width,
                    height: rect.height
                };
            }
            return null;
        }, challengeInfo.elements.selectors.choices, selectedIndex);
        
        if (!buttonPosition) {
            logger.error('Failed to get button position');
            return false;
        }
        
        logger.info(`  → Moving cursor to choice button...`);
        const cursor = createCursor(page);
        
        await cursor.moveTo(
            { x: buttonPosition.x, y: buttonPosition.y },
            {
                hesitate: Math.random() * 100 + 50,
                moveDelay: Math.random() * 500 + 300,
                waitForSelector: false
            }
        );
        
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150));
        
        await cursor.click();
        
        logger.info('✓ Multiple choice answer selected!');
        
        await humanDelay(500, 1000);
        
        return true;
        
    } catch (error) {
        logger.error('Error solving multiple choice challenge:', error.message);
        return false;
    }
}

module.exports = {
    solveMultipleChoiceChallenge,
    analyzeMultipleChoiceWithGemini,
    setLogger
};
