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
        
        const geminiPrompt = `Analyze this hCaptcha multiple choice challenge carefully.

Task/Question: ${promptText}

Available choices:
${choicesList}

This is a visual question-answering task. You may see:
- A reference/main image that you need to identify or classify
- Multiple choice options (text labels or small images)
- You need to select the SINGLE BEST matching choice

Instructions:
1. Carefully examine the main image or visual content
2. Compare it with each of the available choices
3. Select the ONE choice that best matches the image/question
4. Be confident in your answer - this is usually straightforward

Respond ONLY with JSON in this format:
{
  "selected_index": 0,
  "choice_text": "The text of selected choice",
  "confidence": "high/medium/low",
  "reasoning": "Brief explanation of why this choice is correct"
}

Important:
- selected_index is zero-based (0 for first choice, 1 for second, etc.)
- Only select ONE choice
- Be decisive and pick the most obvious match`;

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
