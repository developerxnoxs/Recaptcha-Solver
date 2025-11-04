#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs').promises;

puppeteer.use(StealthPlugin());

async function deepCanvasDebug() {
    console.log('🔬 Deep Canvas Interaction Debug...');
    
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium'
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        console.log('🌐 Navigating to nopecha demo...');
        await page.goto('https://nopecha.com/demo/hcaptcha', { waitUntil: 'networkidle0' });
        
        await page.waitForSelector('iframe[src*="hcaptcha.com"]', { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const frames = page.frames();
        const checkboxFrame = frames.find(f => f.url().includes('checkbox'));
        
        if (checkboxFrame) {
            console.log('🖱️  Clicking checkbox...');
            const checkbox = await checkboxFrame.$('#checkbox');
            if (checkbox) await checkbox.click();
        }
        
        console.log('⏳ Waiting for challenge...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const challengeFrame = frames.find(f => f.url().includes('challenge'));
        if (!challengeFrame) {
            console.log('No challenge appeared');
            await new Promise(resolve => setTimeout(resolve, 60000));
            return;
        }
        
        console.log('\n🔍 Injecting event listeners to monitor canvas interactions...');
        
        // Inject event monitoring into challenge frame
        const eventData = await challengeFrame.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return { error: 'No canvas found' };
            
            const events = [];
            const maxEvents = 50;
            
            // Monitor all mouse events
            ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu'].forEach(eventType => {
                canvas.addEventListener(eventType, (e) => {
                    if (events.length < maxEvents) {
                        events.push({
                            type: eventType,
                            x: e.offsetX,
                            y: e.offsetY,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            button: e.button,
                            buttons: e.buttons,
                            timestamp: Date.now()
                        });
                    }
                }, true);
            });
            
            // Monitor drag events
            ['drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop'].forEach(eventType => {
                canvas.addEventListener(eventType, (e) => {
                    if (events.length < maxEvents) {
                        events.push({
                            type: eventType,
                            x: e.offsetX,
                            y: e.offsetY,
                            timestamp: Date.now()
                        });
                    }
                }, true);
            });
            
            // Monitor touch events for mobile simulation
            ['touchstart', 'touchend', 'touchmove'].forEach(eventType => {
                canvas.addEventListener(eventType, (e) => {
                    if (events.length < maxEvents && e.touches.length > 0) {
                        const touch = e.touches[0];
                        events.push({
                            type: eventType,
                            x: touch.clientX,
                            y: touch.clientY,
                            timestamp: Date.now()
                        });
                    }
                }, true);
            });
            
            // Store events globally so we can retrieve them later
            window._capturedEvents = events;
            
            // Get canvas details
            const rect = canvas.getBoundingClientRect();
            
            // Check for existing event listeners (inspect __listeners if available)
            const hasListeners = {
                mousedown: false,
                mousemove: false,
                mouseup: false
            };
            
            // Try to detect if canvas has interactive elements
            const computedStyle = window.getComputedStyle(canvas);
            
            return {
                canvas: {
                    width: canvas.width,
                    height: canvas.height,
                    displayWidth: rect.width,
                    displayHeight: rect.height,
                    cursor: computedStyle.cursor,
                    pointerEvents: computedStyle.pointerEvents,
                    position: {
                        x: rect.x,
                        y: rect.y
                    }
                },
                eventsInjected: true,
                message: 'Event listeners injected. Please interact with canvas manually.'
            };
        });
        
        console.log('\n📊 Canvas Details:');
        console.log(JSON.stringify(eventData, null, 2));
        
        console.log('\n👆 Please manually interact with the canvas challenge:');
        console.log('   1. Try clicking on segments');
        console.log('   2. Try dragging segments');
        console.log('   3. Try using the "+ Move" button');
        console.log('\n⏳ Monitoring for 30 seconds...');
        
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Retrieve captured events
        const capturedEvents = await challengeFrame.evaluate(() => {
            return window._capturedEvents || [];
        });
        
        console.log(`\n📝 Captured ${capturedEvents.length} events:`);
        
        if (capturedEvents.length > 0) {
            console.log('\nEvent Timeline:');
            capturedEvents.forEach((event, i) => {
                console.log(`  ${i + 1}. [${event.type}] at (${event.x}, ${event.y}) - buttons: ${event.buttons}`);
            });
            
            // Analyze event patterns
            const eventTypes = {};
            capturedEvents.forEach(e => {
                eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
            });
            
            console.log('\nEvent Type Summary:');
            Object.entries(eventTypes).forEach(([type, count]) => {
                console.log(`  ${type}: ${count} times`);
            });
            
            // Save to file
            await fs.writeFile(
                path.join(__dirname, 'canvas-events-captured.json'),
                JSON.stringify({ events: capturedEvents, summary: eventTypes }, null, 2)
            );
            console.log('\n✓ Events saved to: canvas-events-captured.json');
        } else {
            console.log('❌ No events captured. Canvas might not be interactive or no interaction occurred.');
        }
        
        // Now let's try programmatic interaction
        console.log('\n🤖 Attempting programmatic canvas interaction...');
        
        const interactionResult = await challengeFrame.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return { error: 'No canvas' };
            
            const rect = canvas.getBoundingClientRect();
            
            // Try different interaction methods
            const methods = [];
            
            // Method 1: Dispatch mouse events
            try {
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                const mouseDownEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + centerX,
                    clientY: rect.top + centerY,
                    button: 0
                });
                
                canvas.dispatchEvent(mouseDownEvent);
                methods.push('mousedown dispatched');
                
                const mouseMoveEvent = new MouseEvent('mousemove', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + centerX + 50,
                    clientY: rect.top + centerY,
                    button: 0,
                    buttons: 1
                });
                
                canvas.dispatchEvent(mouseMoveEvent);
                methods.push('mousemove dispatched');
                
                const mouseUpEvent = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + centerX + 50,
                    clientY: rect.top + centerY,
                    button: 0
                });
                
                canvas.dispatchEvent(mouseUpEvent);
                methods.push('mouseup dispatched');
            } catch (e) {
                methods.push('Error: ' + e.message);
            }
            
            // Method 2: Look for move button
            const moveButton = document.querySelector('.button[class*="move"], button:has-text("Move"), [class*="move"][role="button"]');
            if (moveButton) {
                methods.push('Found move button: ' + moveButton.className);
            } else {
                methods.push('No move button found');
            }
            
            // Method 3: Check for clickable regions
            const allElements = Array.from(document.querySelectorAll('*'));
            const clickableElements = allElements.filter(el => {
                const style = window.getComputedStyle(el);
                return style.cursor === 'pointer' || style.cursor === 'grab' || style.cursor === 'grabbing';
            });
            
            methods.push(`Found ${clickableElements.length} clickable elements`);
            
            return {
                methodsTried: methods,
                canvasRect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            };
        });
        
        console.log('\n🔧 Programmatic Interaction Results:');
        console.log(JSON.stringify(interactionResult, null, 2));
        
        console.log('\n⏳ Keeping browser open for final inspection (30s)...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
        console.log('\n✓ Debug session complete');
    }
}

deepCanvasDebug().catch(console.error);
