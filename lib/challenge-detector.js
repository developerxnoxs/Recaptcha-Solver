const createLogger = require('../utils/logger');
let logger = createLogger({ level: 'info' });

function setLogger(newLogger) {
    logger = newLogger;
}

async function detectChallengeType(frame) {
    try {
        const challengeInfo = await frame.evaluate(() => {
            const info = {
                type: 'unknown',
                subtype: null,
                elements: {},
                prompt: null
            };
            
            const promptElement = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt, .prompt, h2.prompt-text, div.prompt-text');
            if (promptElement) {
                info.prompt = {
                    text: promptElement.textContent.trim(),
                    element: promptElement.className
                };
            }
            
            const multipleChoiceContainer = document.querySelector('.image_label_multiple_choice, .multiple-choice, .answer-container, .challenge-multiple-choice, .choices-container');
            const choiceButtons = document.querySelectorAll('.answer-button, .choice-button, [data-choice], .multiple-choice-option, .choice-item');
            const referenceImage = document.querySelector('.reference-image, .question-image, .main-image');
            
            if (multipleChoiceContainer || (choiceButtons.length > 0 && choiceButtons.length <= 6)) {
                info.type = 'MULTIPLE_CHOICE';
                info.elements = {
                    choiceCount: choiceButtons.length,
                    choices: Array.from(choiceButtons).map((el, idx) => ({
                        index: idx,
                        text: el.textContent.trim(),
                        className: el.className,
                        hasImage: !!el.querySelector('img')
                    })),
                    hasReferenceImage: !!referenceImage,
                    selectors: {
                        container: multipleChoiceContainer ? multipleChoiceContainer.className : null,
                        choices: '.answer-button, .choice-button, [data-choice]',
                        referenceImage: referenceImage ? referenceImage.className : null
                    }
                };
                return info;
            }
            
            const gridTiles = document.querySelectorAll('.task-image, .challenge-image, .image-task, div.task-image, [class*="task-image"]');
            if (gridTiles.length > 0) {
                info.type = 'GRID_BASED';
                info.subtype = 'image_label_binary';
                info.elements = {
                    tiles: gridTiles.length,
                    gridSize: gridTiles.length === 9 ? '3x3' : (gridTiles.length === 16 ? '4x4' : 'custom'),
                    selector: '.task-image, div.task-image',
                    isDynamic: info.prompt && (
                        info.prompt.text.includes('verify once there are none') ||
                        info.prompt.text.includes('new images will appear') ||
                        info.prompt.text.includes('new images appear') ||
                        info.prompt.text.includes('Click verify once')
                    )
                };
                return info;
            }
            
            const draggableElements = document.querySelectorAll(
                '[draggable="true"], [class*="slider"], [class*="puzzle"], [class*="piece"], [role="slider"], .slide-verify-slider-mask-item, .geetest_slider_button'
            );
            const sliderContainer = document.querySelector('.challenge-slider, .slider-container, [class*="drag-drop"]');
            
            if (draggableElements.length > 0 || sliderContainer) {
                const sliderInput = document.querySelector('[role="slider"], input[type="range"]');
                info.type = 'JIGSAW_SLIDER';
                info.subtype = sliderInput ? 'slider' : 'jigsaw';
                info.elements = {
                    count: draggableElements.length,
                    isSlider: !!sliderInput || !!sliderContainer,
                    draggable: Array.from(draggableElements).map(el => ({
                        className: el.className,
                        tag: el.tagName,
                        draggable: el.draggable
                    }))
                };
                return info;
            }
            
            const canvas = document.querySelector('canvas, canvas.overlay-canvas, canvas.geetest_canvas_img');
            const areaSelectContainer = document.querySelector('.challenge-area-select, [class*="area-select"]');
            
            if (canvas || areaSelectContainer) {
                const isDragChallenge = info.prompt && (
                    info.prompt.text.toLowerCase().includes('drag') ||
                    info.prompt.text.toLowerCase().includes('slide') ||
                    info.prompt.text.toLowerCase().includes('move') ||
                    info.prompt.text.toLowerCase().includes('position')
                );
                
                if (isDragChallenge) {
                    info.type = 'JIGSAW_SLIDER';
                    info.subtype = 'jigsaw';
                    info.elements = {
                        count: 1,
                        isSlider: false,
                        draggable: [{
                            className: 'canvas-drag-challenge',
                            tag: 'CANVAS',
                            draggable: true
                        }]
                    };
                    return info;
                }
                
                const hasMultiplePoints = info.prompt && (
                    info.prompt.text.toLowerCase().includes('two') ||
                    info.prompt.text.toLowerCase().includes('three') ||
                    info.prompt.text.toLowerCase().includes('multiple') ||
                    info.prompt.text.toLowerCase().includes('all') ||
                    info.prompt.text.toLowerCase().includes('different') ||
                    info.prompt.text.toLowerCase().includes('icons')
                );
                
                info.type = 'BOUNDING_BOX';
                info.subtype = hasMultiplePoints ? 'area_select_multiple' : 'area_select_point';
                info.elements = {
                    canvas: {
                        width: canvas ? canvas.width : 0,
                        height: canvas ? canvas.height : 0,
                        selector: 'canvas, canvas.overlay-canvas'
                    },
                    expectedClicks: hasMultiplePoints ? 'multiple' : 'single'
                };
                return info;
            }
            
            return info;
        });
        
        logger.info(`🔍 Detected Challenge Type: ${challengeInfo.type}${challengeInfo.subtype ? ` (${challengeInfo.subtype})` : ''}`);
        if (challengeInfo.prompt) {
            logger.info(`📝 Prompt: ${challengeInfo.prompt.text}`);
        }
        if (challengeInfo.elements.isDynamic) {
            logger.info(`🔄 Dynamic challenge detected`);
        }
        
        return challengeInfo;
        
    } catch (error) {
        logger.error('Error detecting challenge type:', error.message);
        return { type: 'unknown', subtype: null, elements: {}, prompt: null };
    }
}

async function waitForChallengeReady(frame, challengeType, timeout = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        try {
            const isReady = await frame.evaluate((type) => {
                if (type === 'GRID_BASED') {
                    const tiles = document.querySelectorAll('.task-image');
                    if (tiles.length === 0) return false;
                    
                    const hasImages = Array.from(tiles).every(tile => {
                        const img = tile.querySelector('img');
                        const bgImage = window.getComputedStyle(tile).backgroundImage;
                        return img?.complete || bgImage !== 'none';
                    });
                    
                    return hasImages;
                }
                
                if (type === 'MULTIPLE_CHOICE') {
                    const choices = document.querySelectorAll('.answer-button, .choice-button, [data-choice]');
                    if (choices.length === 0) return false;
                    
                    const referenceImage = document.querySelector('.reference-image, .question-image, .main-image');
                    if (referenceImage) {
                        const img = referenceImage.querySelector('img') || referenceImage;
                        if (img.tagName === 'IMG' && !img.complete) return false;
                    }
                    
                    const choiceImagesReady = Array.from(choices).every(choice => {
                        const img = choice.querySelector('img');
                        return !img || img.complete;
                    });
                    
                    return choiceImagesReady;
                }
                
                if (type === 'BOUNDING_BOX') {
                    const canvas = document.querySelector('canvas');
                    return canvas && canvas.width > 0 && canvas.height > 0;
                }
                
                if (type === 'JIGSAW_SLIDER') {
                    const draggable = document.querySelector('[draggable="true"]');
                    return !!draggable;
                }
                
                return false;
            }, challengeType);
            
            if (isReady) {
                logger.info(`✅ Challenge ready: ${challengeType}`);
                return true;
            }
            
        } catch (error) {
            // Continue waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    logger.warn(`⚠️  Challenge not ready after ${timeout}ms`);
    return false;
}

module.exports = {
    detectChallengeType,
    waitForChallengeReady,
    setLogger
};
