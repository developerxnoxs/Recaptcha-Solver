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
            while (this.isWatching) {
                const frames = await this.page.frames();
                const captchaFrame = frames.find(frame => frame.url().includes('api2/anchor'));

                if (captchaFrame) {
                    let checkCount = 0;
                    while (this.isWatching && checkCount < 50) {
                        const captchaInfo = await captchaFrame.evaluate(() => {
                            const checkbox = document.querySelector('.recaptcha-checkbox-border');
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
                            this.currentCheckbox = await captchaFrame.$('.recaptcha-checkbox-border');
                            this.callbacks.onCaptchaReady({
                                ...captchaInfo,
                                frame: captchaFrame
                            });
                            return;
                        }

                        await new Promise(resolve => setTimeout(resolve, 100));
                        checkCount++;
                    }
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
                const frames = await this.page.frames();
                const challengeFrame = frames.find(frame => frame.url().includes('api2/bframe'));

                if (challengeFrame) {
                    let checkCount = 0;
                    while (this.isWatching && checkCount < 50) {
                        const challengeInfo = await challengeFrame.evaluate(() => {
                            const checkTilesLoaded = () => {
                                const element = document.querySelector('.rc-imageselect-challenge');
                                if (!element) return false;

                                const tiles = element.querySelectorAll('.rc-imageselect-tile');
                                if (!tiles.length) return false;

                                const anyTilesInTransition = Array.from(tiles).some(tile =>
                                    tile.classList.contains('rc-imageselect-dynamic-selected')
                                );

                                if (anyTilesInTransition) {
                                    return false;
                                }

                                return true;
                            };

                            const getImageUrls = () => {
                                const images = document.querySelectorAll('.rc-image-tile-33, .rc-image-tile-44');
                                return Array.from(images).map(img => {
                                    const style = window.getComputedStyle(img);
                                    const backgroundImage = style.backgroundImage || '';
                                    const src = img.src || '';
                                    return backgroundImage.replace(/url\(['"]?(.*?)['"]?\)/, '$1') || src;
                                }).filter(Boolean);
                            };

                            const payload = document.querySelector('.rc-imageselect-payload');
                            const desc = document.querySelector('.rc-imageselect-desc, .rc-imageselect-desc-no-canonical');
                            const table = document.querySelector('.rc-imageselect-table-33, .rc-imageselect-table-44');

                            if (payload && desc && table) {
                                const tilesReady = checkTilesLoaded();

                                if (tilesReady) {
                                    const text = desc.textContent.trim();
                                    const hasCorrectFormat = text.includes('Select all images with');

                                    let promptText = '';
                                    const strongElement = desc.querySelector('strong');
                                    if (strongElement) {
                                        promptText = strongElement.textContent.trim();
                                    } else {
                                        const match = text.match(/Select all images with (.*?)(?:$|\.|\n)/i);
                                        if (match) {
                                            promptText = match[1].trim();
                                        }
                                    }

                                    const imageUrls = getImageUrls();

                                    return {
                                        text: text,
                                        type: desc.className,
                                        gridType: table.className,
                                        imageCount: table.querySelectorAll('img').length,
                                        timestamp: new Date().toISOString(),
                                        hasCorrectFormat: hasCorrectFormat,
                                        isDynamic: text.includes('Click verify once there are none left'),
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

                        await new Promise(resolve => setTimeout(resolve, 100));
                        checkCount++;
                    }
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
                            const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
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
                    if (!evalError.message.includes('Execution context was destroyed')) {
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
