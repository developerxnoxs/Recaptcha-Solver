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
                elements: {},
                prompt: null
            };
            
            const promptElement = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt');
            if (promptElement) {
                info.prompt = {
                    text: promptElement.textContent.trim(),
                    element: promptElement
                };
            }
            
            const gridTiles = document.querySelectorAll('.task-image, .challenge-image, .image-task');
            if (gridTiles.length > 0) {
                info.type = 'GRID_BASED';
                info.elements = {
                    tiles: gridTiles.length,
                    gridSize: gridTiles.length === 9 ? '3x3' : (gridTiles.length === 16 ? '4x4' : 'custom'),
                    selector: '.task-image'
                };
                return info;
            }
            
            const draggableElements = document.querySelectorAll(
                '[draggable="true"], [class*="slider"], [class*="puzzle"], [class*="piece"], [role="slider"]'
            );
            if (draggableElements.length > 0) {
                info.type = 'JIGSAW_SLIDER';
                info.elements = {
                    count: draggableElements.length,
                    draggable: Array.from(draggableElements).map(el => ({
                        className: el.className,
                        tag: el.tagName,
                        draggable: el.draggable
                    }))
                };
                return info;
            }
            
            const canvas = document.querySelector('canvas');
            if (canvas) {
                info.type = 'BOUNDING_BOX';
                info.elements = {
                    canvas: {
                        width: canvas.width,
                        height: canvas.height,
                        selector: 'canvas'
                    }
                };
                return info;
            }
            
            return info;
        });
        
        logger.info(`🔍 Detected Challenge Type: ${challengeInfo.type}`);
        if (challengeInfo.prompt) {
            logger.info(`📝 Prompt: ${challengeInfo.prompt.text}`);
        }
        
        return challengeInfo;
        
    } catch (error) {
        logger.error('Error detecting challenge type:', error.message);
        return { type: 'unknown', elements: {}, prompt: null };
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
