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
        
        const geminiPrompt = `You are an expert visual recognition AI solving a hCaptcha MULTIPLE CHOICE challenge. Analyze the image and select the BEST answer.

🎯 QUESTION/TASK: "${promptText}"

📋 AVAILABLE CHOICES:
${choicesList}

🔍 ANALYSIS FRAMEWORK:

**1. Image Understanding:**
   - 🖼️ Examine the reference/main image carefully
   - 🏷️ Identify: What is the primary subject/object?
   - 📍 Context: Where is this scene? What's the setting?
   - 🎨 Details: Colors, shapes, distinctive features
   
**2. Common Question Types:**

   a) **Object Identification:**
      - "What animal is this?" → Identify species/type
      - "What vehicle is shown?" → Car, bus, motorcycle, etc.
      - "What object is this?" → Name the primary object

   b) **Scene Classification:**
      - "What room is this?" → Bedroom, kitchen, bathroom, etc.
      - "Where was this photo taken?" → Indoor, outdoor, specific location
      - "What type of place is this?" → Park, street, office, etc.

   c) **Action/Activity:**
      - "What is the person doing?" → Walking, running, sitting, etc.
      - "What activity is shown?" → Sports, work, leisure, etc.

   d) **Attribute Selection:**
      - "What color is dominant?" → Red, blue, green, etc.
      - "What is the weather?" → Sunny, rainy, cloudy, etc.

**3. Decision Strategy:**
   📌 Step 1: Identify what the question is asking for
   📌 Step 2: Analyze the main image to extract relevant information
   📌 Step 3: Eliminate obviously wrong choices
   📌 Step 4: Compare remaining choices with image details
   📌 Step 5: Select the MOST ACCURATE and SPECIFIC choice

**4. Common Pitfalls to Avoid:**
   ❌ Don't confuse similar but different items (cat ≠ dog)
   ❌ Don't over-think - usually the obvious answer is correct
   ❌ Don't select partially correct answers - find the BEST match
   ❌ Don't guess randomly - use visual evidence

**5. Confidence Assessment:**
   - HIGH: Clear, unmistakable match between image and choice
   - MEDIUM: Strong match with minor ambiguity
   - LOW: Uncertain or multiple possible matches (but still select best one)

**6. Selection Rules:**
   ✓ Choose the MOST SPECIFIC correct answer
   ✓ If multiple choices seem right, pick the MORE PRECISE one
   ✓ Prefer exact matches over general categories
   ✓ Use context clues from the image to resolve ambiguity

📊 RESPONSE FORMAT (JSON only):
{
  "selected_index": 2,
  "choice_text": "kitchen",
  "confidence": "high",
  "reasoning": "Clear view of kitchen appliances (stove, refrigerator, countertop). Unmistakable kitchen environment."
}

⚠️ IMPORTANT:
- selected_index is zero-based (0=first, 1=second, 2=third, etc.)
- Select EXACTLY ONE choice
- Be decisive - pick the best match even if uncertain

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
        
        const success = await frame.evaluate((selectors, index) => {
            const buttons = document.querySelectorAll(selectors);
            if (buttons[index]) {
                buttons[index].click();
                return true;
            }
            return false;
        }, challengeInfo.elements.selectors.choices, selectedIndex);
        
        if (!success) {
            logger.error('Failed to click the selected choice');
            return false;
        }
        
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
