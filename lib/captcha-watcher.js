const createLogger = require('../utils/logger');
const logger = createLogger({ level: 'info' });

class CaptchaWatcher {
    constructor() {
        this.page = null;
        this.isWatching = false;
        this.currentChallengeText = null;
        this.currentCaptchaFrame = null;
        this.currentChallengeFrame = null;
        this.currentImageUrls = null;
        this.currentCheckbox = null;
        this.callbacks = {
            onChallengeOpen: () => { },
            onCaptchaReady: () => { },
            onChallengeChange: () => { },
            onTilesReady: () => { },
            onTokenFound: () => { }
        };
    }

    setPage(page) {
        this.page = page;
        this.currentChallengeText = null;
        this.startWatching();
        return this;
    }

    async startWatching() {
        if (!this.page) {
            logger.error('No page set. Call setPage(page) first');
            return;
        }

        if (this.isWatching) {
            logger.info('Watcher is already running');
            return;
        }

        this.isWatching = true;
        this._pollForCaptchaReady();
        this._pollForChallengeFrame();
        this._pollForToken();
    }

    async stopWatching() {
        this.isWatching = false;
    }

    onChallengeOpen(callback) {
        this.callbacks.onChallengeOpen = callback;
    }

    onCaptchaReady(callback) {
        this.callbacks.onCaptchaReady = callback;
    }

    onChallengeChange(callback) {
        this.callbacks.onChallengeChange = callback;
    }

    onTilesReady(callback) {
        this.callbacks.onTilesReady = callback;
    }

    onTokenFound(callback) {
        this.callbacks.onTokenFound = callback;
    }

    async _pollForCaptchaReady() {
        try {
            let loggedOnce = false;
            let frameCheckCount = 0;
            while (this.isWatching) {
                try {
                    const frames = await this.page.frames();
                    
                    let captchaFrame = frames.find(frame => {
                        const url = frame.url();
                        return url && url.length > 0 && url.includes('hcaptcha.com') && url.includes('frame=checkbox');
                    });
                    
                    if (!captchaFrame) {
                        for (const frame of frames) {
                            try {
                                const hasCheckbox = await frame.evaluate(() => {
                                    const checkbox = document.querySelector('#checkbox, .checkbox, [id*="checkbox"]');
                                    return !!checkbox;
                                }).catch(() => false);
                                
                                if (hasCheckbox) {
                                    captchaFrame = frame;
                                    break;
                                }
                            } catch (e) {
                            }
                        }
                    }

                    if (!loggedOnce && frameCheckCount % 10 === 0) {
                        console.log(`[DEBUG] Found ${frames.length} frames (attempt ${frameCheckCount})`);
                        frames.forEach((f, i) => {
                            const url = f.url() || '(empty)';
                            console.log(`  Frame ${i}: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
                        });
                        if (frameCheckCount > 30) loggedOnce = true;
                    }
                    frameCheckCount++;

                    if (captchaFrame) {
                        let checkCount = 0;
                        while (this.isWatching && checkCount < 50) {
                            try {
                                const captchaInfo = await captchaFrame.evaluate(() => {
                                    const checkbox = document.querySelector('#checkbox, .checkbox');
                                    if (!checkbox) return null;

                                    const rect = checkbox.getBoundingClientRect();
                                    const style = window.getComputedStyle(checkbox);

                                    const isVisible = rect.width > 0 &&
                                        rect.height > 0 &&
                                        style.visibility !== 'hidden' &&
                                        style.display !== 'none';

                                    const isClickable = !checkbox.disabled &&
                                        !checkbox.getAttribute('disabled') &&
                                        isVisible;

                                    if (isClickable) {
                                        return {
                                            timestamp: new Date().toISOString(),
                                            element: 'checkbox',
                                            status: 'ready'
                                        };
                                    }
                                    return null;
                                });

                                if (captchaInfo) {
                                    this.currentCaptchaFrame = captchaFrame;
                                    this.currentCheckbox = await captchaFrame.$('#checkbox, .checkbox');
                                    this.callbacks.onCaptchaReady({
                                        ...captchaInfo,
                                        frame: captchaFrame
                                    });
                                    return;
                                }
                            } catch (err) {
                                if (err.message && (err.message.includes('detached') || err.message.includes('Execution context was destroyed'))) {
                                    break;
                                }
                            }

                            await new Promise(resolve => setTimeout(resolve, 100));
                            checkCount++;
                        }
                    }
                } catch (err) {
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error('Error in captcha ready polling:', error);
        }
    }

    async _pollForChallengeFrame() {
        try {
            while (this.isWatching) {
                try {
                    const frames = await this.page.frames();
                    
                    let challengeFrame = frames.find(frame => {
                        const url = frame.url();
                        return url && url.length > 0 && url.includes('hcaptcha.com') && url.includes('frame=challenge');
                    });
                    
                    if (!challengeFrame) {
                        for (const frame of frames) {
                            try {
                                const hasChallengeElements = await frame.evaluate(() => {
                                    const hasPrompt = !!document.querySelector('.prompt-text, .challenge-prompt');
                                    const hasTiles = document.querySelectorAll('.task-image').length > 0;
                                    const hasCanvas = !!document.querySelector('canvas');
                                    const hasChoice = document.querySelectorAll('[data-choice], .choice-item').length > 0;
                                    return hasPrompt || hasTiles || hasCanvas || hasChoice;
                                }).catch(() => false);
                                
                                if (hasChallengeElements) {
                                    challengeFrame = frame;
                                    break;
                                }
                            } catch (e) {
                            }
                        }
                    }

                    if (challengeFrame) {
                        let checkCount = 0;
                        while (this.isWatching && checkCount < 50) {
                            try {
                                const challengeInfo = await challengeFrame.evaluate(() => {
                            const checkTilesLoaded = () => {
                                const element = document.querySelector('.challenge-view, .task-grid');
                                if (!element) return false;

                                const tiles = element.querySelectorAll('.task-image');
                                if (!tiles.length) return false;

                                const anyTilesInTransition = Array.from(tiles).some(tile =>
                                    tile.classList.contains('task-selected') || tile.classList.contains('loading')
                                );

                                if (anyTilesInTransition) {
                                    return false;
                                }

                                return true;
                            };

                            const getImageUrls = () => {
                                const images = document.querySelectorAll('.task-image img, .task-image');
                                return Array.from(images).map(img => {
                                    const style = window.getComputedStyle(img);
                                    const backgroundImage = style.backgroundImage || '';
                                    const src = img.src || img.querySelector('img')?.src || '';
                                    return backgroundImage.replace(/url\(['"]?(.*?)['"]?\)/, '$1') || src;
                                }).filter(Boolean);
                            };

                            const payload = document.querySelector('.challenge-container, .challenge-view');
                            const desc = document.querySelector('.prompt-text, .challenge-prompt, .task-prompt, h2.prompt-text');
                            const tiles = document.querySelectorAll('.task-image');
                            const table = tiles.length > 0 ? { className: tiles.length === 9 ? 'grid-33' : 'grid-44' } : null;
                            
                            const canvas = document.querySelector('canvas');
                            const draggable = document.querySelector('[draggable="true"], [class*="slider"], [class*="puzzle"]');
                            const multipleChoice = document.querySelectorAll('.answer-button, .choice-button, [data-choice]');
                            
                            const hasAnyChallenge = table || canvas || draggable || multipleChoice.length > 0;

                            if (payload && desc && hasAnyChallenge) {
                                const tilesReady = table ? checkTilesLoaded() : true;

                                if (tilesReady) {
                                    const text = desc.textContent.trim();
                                    const hasCorrectFormat = text.includes('Select all') || text.includes('Please click');

                                    let promptText = '';
                                    const strongElement = desc.querySelector('strong');
                                    if (strongElement) {
                                        promptText = strongElement.textContent.trim();
                                    } else {
                                        const match = text.match(/(?:Select all|Please click each image containing) (?:a |an |the )?(.*?)(?:$|\.|\n)/i);
                                        if (match) {
                                            promptText = match[1].trim();
                                        }
                                    }

                                    const imageUrls = getImageUrls();
                                    const allTiles = document.querySelectorAll('.task-image');

                                    return {
                                        text: text,
                                        type: desc.className,
                                        gridType: table ? table.className : 'unknown',
                                        imageCount: allTiles.length,
                                        timestamp: new Date().toISOString(),
                                        hasCorrectFormat: hasCorrectFormat,
                                        isDynamic: text.includes('verify once there are none') || text.includes('new images will appear'),
                                        mainText: text,
                                        promptText: promptText,
                                        tilesReady: true,
                                        imageUrls: imageUrls
                                    };
                                }
                            }
                            return null;
                                });

                                if (challengeInfo) {
                                    this.currentChallengeFrame = challengeFrame;

                                    this.callbacks.onTilesReady({
                                        ...challengeInfo,
                                        frame: challengeFrame
                                    });

                                    const hasChanged = this._checkIfChallengeChanged(challengeInfo);

                                    if (!this.currentChallengeText) {
                                        this._updateCurrentChallenge(challengeInfo);
                                        this.callbacks.onChallengeOpen({
                                            ...challengeInfo,
                                            frame: challengeFrame
                                        });
                                    }
                                    else if (hasChanged) {
                                        this._updateCurrentChallenge(challengeInfo);
                                        this.callbacks.onChallengeChange({
                                            ...challengeInfo,
                                            frame: challengeFrame
                                        });
                                    }
                                }
                            } catch (err) {
                                if (err.message && (err.message.includes('detached') || err.message.includes('Execution context was destroyed') || err.message.includes('Target closed'))) {
                                    break;
                                }
                            }

                            await new Promise(resolve => setTimeout(resolve, 100));
                            checkCount++;
                        }
                    }
                } catch (err) {
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error('Error in challenge frame polling:', error);
        }
    }

    _checkIfChallengeChanged(newChallengeInfo) {
        if (this.currentChallengeText !== newChallengeInfo.text) {
            return true;
        }

        if (!this.currentImageUrls || !newChallengeInfo.imageUrls) {
            return true;
        }

        if (this.currentImageUrls.length !== newChallengeInfo.imageUrls.length) {
            return true;
        }

        return this.currentImageUrls.some((url, index) =>
            url !== newChallengeInfo.imageUrls[index]
        );
    }

    _updateCurrentChallenge(challengeInfo) {
        this.currentChallengeText = challengeInfo.text;
        this.currentImageUrls = challengeInfo.imageUrls;
    }

    async _pollForToken() {
        try {
            while (this.isWatching) {
                try {
                    if (!this.page || !this.page.isClosed()) {
                        const token = await this.page.evaluate(() => {
                            const textarea = document.querySelector('textarea[name="h-captcha-response"]');
                            return textarea ? textarea.value : null;
                        });

                        if (token) {
                            this.callbacks.onTokenFound({
                                timestamp: new Date().toISOString(),
                                token: token
                            });
                            return;
                        }
                    }
                } catch (evalError) {
                    if (evalError.message && !(evalError.message.includes('Execution context was destroyed') || evalError.message.includes('detached') || evalError.message.includes('Target closed'))) {
                        console.error('Token polling evaluation error:', evalError);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error('Error in token polling:', error);
        }
    }

    getCaptchaFrame() {
        return this.currentCaptchaFrame;
    }

    getChallengeFrame() {
        return this.currentChallengeFrame;
    }

    getCheckbox() {
        return this.currentCheckbox;
    }

    cleanup() {
        this.stopWatching();
        this.page = null;
        this.currentCaptchaFrame = null;
        this.currentChallengeFrame = null;
        this.currentCheckbox = null;
        this.currentChallengeText = null;
        this.currentImageUrls = null;
    }
}

module.exports = CaptchaWatcher;
