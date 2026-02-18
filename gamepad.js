/**
 * gamepad.js - Gamepad Controller System for BLOCKCHaiNSTORM / TaNTRiS
 *
 * Handles gamepad connection/disconnection, input polling, button mapping,
 * menu navigation, haptic feedback (vibration patterns for game events),
 * and controller UI display.
 *
 * Accesses game globals (currentPiece, collides, rotatePiece, etc.) which
 * are defined in game.js. This file must be loaded BEFORE game.js so the
 * GamepadController object exists when game.js references it. The actual
 * init() and update() calls happen asynchronously after all globals exist.
 *
 * Exports: window.GamepadController
 */

const GamepadController = {
    enabled: false,
    connected: false,
    deadzone: 0.25,
    repeatDelay: 120, // ms between repeated directional inputs
    lastMoveTime: 0,
    buttonStates: {},
    menuStickWasUp: false,
    menuStickWasDown: false,
    // Right stick state tracking for rotation
    rightStickWasLeft: false,
    rightStickWasRight: false,
    rightStickWasUp: false,
    rightStickWasDown: false,
    // Menu navigation state
    menuNav: {
        activeScreen: null,
        focusIndex: 0,
        lastItems: null  // Track items to detect changes
    },
    // Haptic feedback state
    vibrationSupported: false,
    vibrationEnabled: true, // Can be toggled by user
    activeVibration: null,  // Track ongoing vibration effect
    
    // Button mappings (Standard Gamepad layout)
    buttons: {
        A: 0,           // A (Xbox) / Cross (PS) - Hard drop
        B: 1,           // B (Xbox) / Circle (PS) - Rotate clockwise
        X: 2,           // X (Xbox) / Square (PS) - Rotate counter-clockwise
        Y: 3,           // Y (Xbox) / Triangle (PS) - Rotate clockwise
        LB: 4,          // Left Bumper - Rotate counter-clockwise
        RB: 5,          // Right Bumper - Rotate clockwise
        LT: 6,          // Left Trigger - Hard drop
        RT: 7,          // Right Trigger - Hard drop
        BACK: 8,        // Back/Select - (unused)
        START: 9,       // Start/Options - Pause
        L_STICK: 10,    // Left Stick Click
        R_STICK: 11,    // Right Stick Click - Hard drop
        D_UP: 12,       // D-Pad Up - Hard drop
        D_DOWN: 13,     // D-Pad Down - Soft drop
        D_LEFT: 14,     // D-Pad Left - Move left
        D_RIGHT: 15     // D-Pad Right - Move right
    },
    
    init() {
        try {
            // Listen for controller connection
            window.addEventListener("gamepadconnected", (e) => {
                this.onConnect(e.gamepad);
            });
            
            // Listen for controller disconnection
            window.addEventListener("gamepaddisconnected", (e) => {
                this.onDisconnect(e.gamepad);
            });
            
            // Some browsers need polling to detect controllers
            this.startPolling();
        } catch (error) {
            // Silently fail if gamepad API not available or blocked by permissions
            console.log('Gamepad API not available');
            this.enabled = false;
        }
    },
    
    onConnect(gamepad) {
        console.log('🎮 Controller connected:', gamepad.id);
        console.log('   Buttons:', gamepad.buttons.length);
        console.log('   Axes:', gamepad.axes.length);
        
        this.connected = true;
        this.enabled = true;
        
        // Check for vibration support
        this.vibrationSupported = !!(gamepad.vibrationActuator || gamepad.hapticActuators);
        console.log('   Vibration:', this.vibrationSupported ? 'Supported' : 'Not supported');
        
        // Update controls display to show controller buttons
        this.updateControlsDisplay();
        
        // Flag gamepad usage on the visit record
        if (window._visitId) {
            fetch(`https://blockchainstorm.onrender.com/api/visit/${window._visitId}/gamepad`, {
                method: 'PATCH'
            }).catch(() => {});
        }
        
        // Show notification to player
        this.showNotification('🎮 Controller Connected!', gamepad.id);
    },
    
    onDisconnect(gamepad) {
        console.log('🎮 Controller disconnected:', gamepad.id);
        
        // Check if any controllers still connected
        const gamepads = navigator.getGamepads();
        this.connected = gamepads && Array.from(gamepads).some(gp => gp !== null);
        
        if (!this.connected) {
            this.enabled = false;
            this.vibrationSupported = false;
            this.showNotification('🎮 Controller Disconnected', '');
            
            // Stop any ongoing vibration
            this.stopVibration();
            
            // Clear menu focus
            this.clearFocus();
            this.menuNav.activeScreen = null;
        }
        
        // Update controls display to show keyboard controls
        this.updateControlsDisplay();
    },
    
    startPolling() {
        // Check for controllers periodically (some browsers don't fire events)
        setInterval(() => {
            if (!this.connected) {
                try {
                    const gamepads = navigator.getGamepads();
                    if (gamepads) {
                        for (let i = 0; i < gamepads.length; i++) {
                            if (gamepads[i] && !this.connected) {
                                this.onConnect(gamepads[i]);
                                break;
                            }
                        }
                    }
                } catch (error) {
                    // Silently fail if permissions error
                }
            }
        }, 1000); // Check every second
    },
    
    update() {
        if (!this.enabled || !this.connected) return;
        
        try {
            const gamepads = navigator.getGamepads();
            if (!gamepads) return;
            
            // Use first connected controller
            const gp = gamepads[0];
            if (!gp) return;
            
            // Handle menu navigation (intro, mode menu, modals, game over, etc.)
            if (this.updateMenuNavigation(gp)) {
                return; // Menu consumed input
            }
            
            // Handle pause toggle even when paused
            if (this.wasButtonJustPressed(gp, this.buttons.START)) {
                togglePause();
                return;
            }
            
            if (!gameRunning || paused || GameReplay.isActive()) return;
            if (!currentPiece) return;
            
            const now = Date.now();
            
            // === MOVEMENT (D-Pad or Left Stick) ===
            // Movement also checks configured buttons + analog stick
            const leftPressed = this.isActionPressed(gp, 'moveLeft') || 
                               gp.axes[0] < -this.deadzone;
            const rightPressed = this.isActionPressed(gp, 'moveRight') || 
                                gp.axes[0] > this.deadzone;
            const downPressed = this.isActionPressed(gp, 'softDrop') || 
                               gp.axes[1] > this.deadzone;
        
        // Apply movement with repeat delay
        if (now - this.lastMoveTime >= this.repeatDelay) {
            if (leftPressed) {
                movePiece(-1);
                this.lastMoveTime = now;
            } else if (rightPressed) {
                movePiece(1);
                this.lastMoveTime = now;
            }
            
            if (downPressed) {
                if (!collides(currentPiece, 0, 1)) {
                    currentPiece.y++;
                    updateStats();
                    // Record soft drop for replay
                    if (window.GameRecorder && window.GameRecorder.isActive()) {
                        window.GameRecorder.recordInput('softDrop', {
                            x: currentPiece.x,
                            y: currentPiece.y,
                            rotation: currentPiece.rotationIndex || 0
                        });
                    }
                }
                this.lastMoveTime = now;
            }
        }
        
        // === ROTATION ===
        // Rotate clockwise (uses configured buttons)
        if (this.wasActionJustPressed(gp, 'rotateCW')) {
            rotatePiece();
        }
        
        // Rotate counter-clockwise (uses configured buttons)
        if (this.wasActionJustPressed(gp, 'rotateCCW')) {
            rotatePieceCounterClockwise();
        }
        
        // === MUSIC CONTROLS ===
        // Next song (uses configured buttons) - not during replay
        if (this.wasActionJustPressed(gp, 'nextSong') && !GameReplay.isActive()) {
            skipToNextSong();
        }
        // Previous song (uses configured buttons) - not during replay
        if (this.wasActionJustPressed(gp, 'prevSong') && !GameReplay.isActive()) {
            skipToPreviousSong();
        }
        
        // === RIGHT STICK ROTATION (always available) ===
        // Right stick axes are typically axes[2] (X) and axes[3] (Y)
        const rightStickLeft = gp.axes[2] < -0.5;
        const rightStickRight = gp.axes[2] > 0.5;
        const rightStickUp = gp.axes[3] < -0.5;
        const rightStickDown = gp.axes[3] > 0.5;
        
        // Right stick left or up - Rotate counter-clockwise (on rising edge)
        if ((rightStickLeft && !this.rightStickWasLeft) || 
            (rightStickUp && !this.rightStickWasUp)) {
            rotatePieceCounterClockwise();
        }
        
        // Right stick right or down - Rotate clockwise (on rising edge)
        if ((rightStickRight && !this.rightStickWasRight) || 
            (rightStickDown && !this.rightStickWasDown)) {
            rotatePiece();
        }
        
        // Update right stick state
        this.rightStickWasLeft = rightStickLeft;
        this.rightStickWasRight = rightStickRight;
        this.rightStickWasUp = rightStickUp;
        this.rightStickWasDown = rightStickDown;
        
        // === HARD DROP ===
        // Uses configured buttons
        if (this.wasActionJustPressed(gp, 'hardDrop')) {
            hardDrop();
        }
        } catch (error) {
            // Silently fail if permissions error or gamepad API blocked
        }
    },
    
    isButtonPressed(gamepad, buttonIndex) {
        return gamepad.buttons[buttonIndex] && gamepad.buttons[buttonIndex].pressed;
    },
    
    wasButtonJustPressed(gamepad, buttonIndex) {
        const pressed = this.isButtonPressed(gamepad, buttonIndex);
        const key = `btn_${buttonIndex}`;
        const wasPressed = this.buttonStates[key] || false;
        
        this.buttonStates[key] = pressed;
        
        // Return true only on the rising edge (button just pressed)
        return pressed && !wasPressed;
    },
    
    // Check if any button for an action was just pressed (uses ControlsConfig)
    wasActionJustPressed(gamepad, action) {
        let buttons;
        
        // Try to get buttons from ControlsConfig
        if (typeof ControlsConfig !== 'undefined' && ControlsConfig.gamepad && ControlsConfig.gamepad[action]) {
            buttons = ControlsConfig.gamepad[action];
        } else {
            // Fallback to hardcoded defaults
            const defaults = {
                moveLeft: [14],
                moveRight: [15],
                softDrop: [13],
                hardDrop: [6, 7, 12, 11],
                rotateCW: [1, 3],
                rotateCCW: [0, 2],
                pause: [9],
                nextSong: [5],
                prevSong: [4]
            };
            buttons = defaults[action] || [];
        }
        
        return buttons.some(btn => this.wasButtonJustPressed(gamepad, btn));
    },
    
    // Check if any button for an action is currently pressed (uses ControlsConfig)
    isActionPressed(gamepad, action) {
        let buttons;
        
        // Try to get buttons from ControlsConfig
        if (typeof ControlsConfig !== 'undefined' && ControlsConfig.gamepad && ControlsConfig.gamepad[action]) {
            buttons = ControlsConfig.gamepad[action];
        } else {
            // Fallback to hardcoded defaults
            const defaults = {
                moveLeft: [14],
                moveRight: [15],
                softDrop: [13],
                hardDrop: [6, 7, 12, 11],
                rotateCW: [1, 3],
                rotateCCW: [0, 2],
                pause: [9],
                nextSong: [5],
                prevSong: [4]
            };
            buttons = defaults[action] || [];
        }
        
        return buttons.some(btn => this.isButtonPressed(gamepad, btn));
    },
    
    showNotification(title, subtitle) {
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(0, 0, 0, 0.95);
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            z-index: 10000;
            border: 2px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            max-width: 300px;
        `;
        
        notification.innerHTML = `
            <div style="margin-bottom: 5px;">${title}</div>
            ${subtitle ? `<div style="font-size: 12px; opacity: 0.7; font-weight: normal;">${subtitle}</div>` : ''}
            <div style="font-size: 11px; opacity: 0.6; margin-top: 8px; font-weight: normal;">
                Configure controls in ⚙️ Settings
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Fade in
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(50px)';
        notification.style.transition = 'all 0.3s ease-out';
        
        setTimeout(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Fade out and remove
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(50px)';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    },
    
    getControllerType(gamepad) {
        const id = gamepad.id.toLowerCase();
        
        if (id.includes('xbox')) return 'Xbox';
        if (id.includes('playstation') || id.includes('dualshock') || id.includes('dualsense')) return 'PlayStation';
        if (id.includes('switch')) return 'Nintendo Switch';
        if (id.includes('stadia')) return 'Stadia';
        
        return 'Generic';
    },
    
    // Check if any button was just pressed (for menu/game over navigation)
    anyButtonJustPressed() {
        if (!this.enabled || !this.connected) return false;
        
        try {
            const gamepads = navigator.getGamepads();
            if (!gamepads) return false;
            
            const gp = gamepads[0];
            if (!gp) return false;
            
            // Check face buttons (A, B, X, Y) and Start
            const buttonsToCheck = [
                this.buttons.A, this.buttons.B, this.buttons.X, this.buttons.Y, this.buttons.START
            ];
            
            for (const btn of buttonsToCheck) {
                if (this.wasButtonJustPressed(gp, btn)) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    },
    
    // === MENU NAVIGATION SYSTEM ===
    
    // Detect which screen is currently active and return its focusable items
    detectActiveScreen() {
        // Check modals first (highest priority - they overlay everything)
        const skillModal = document.getElementById('skillLevelModalOverlay');
        if (skillModal && window.getComputedStyle(skillModal).display !== 'none') {
            const options = Array.from(skillModal.querySelectorAll('.selection-option'));
            const selectedIdx = options.findIndex(o => o.classList.contains('selected'));
            return { 
                id: 'skillModal', items: options, 
                defaultIndex: Math.max(0, selectedIdx), 
                onBack: () => { skillModal.style.display = 'none'; } 
            };
        }
        
        const diffModal = document.getElementById('difficultyModalOverlay');
        if (diffModal && window.getComputedStyle(diffModal).display !== 'none') {
            const options = Array.from(diffModal.querySelectorAll('.selection-option'));
            const selectedIdx = options.findIndex(o => o.classList.contains('selected'));
            return { 
                id: 'diffModal', items: options, 
                defaultIndex: Math.max(0, selectedIdx), 
                onBack: () => { diffModal.style.display = 'none'; } 
            };
        }
        
        const comboModal = document.getElementById('comboModalOverlay');
        if (comboModal && window.getComputedStyle(comboModal).display !== 'none') {
            const checkboxLabels = Array.from(comboModal.querySelectorAll('.combo-checkbox-option label'));
            const cancelBtn = document.getElementById('comboCancelBtn');
            const applyBtn = document.getElementById('comboApplyBtn');
            const items = [...checkboxLabels];
            if (cancelBtn) items.push(cancelBtn);
            if (applyBtn) items.push(applyBtn);
            return { 
                id: 'comboModal', items, defaultIndex: 0, 
                onBack: () => { if (cancelBtn) cancelBtn.click(); } 
            };
        }
        
        const settings = document.getElementById('settingsOverlay');
        if (settings && window.getComputedStyle(settings).display !== 'none') {
            const closeBtn = document.getElementById('settingsCloseBtn');
            return { 
                id: 'settings', items: closeBtn ? [closeBtn] : [], defaultIndex: 0, 
                onBack: () => { if (closeBtn) closeBtn.click(); } 
            };
        }
        
        const nameEntry = document.getElementById('nameEntryOverlay');
        if (nameEntry && window.getComputedStyle(nameEntry).display !== 'none') {
            const submitBtn = document.getElementById('nameEntrySubmit');
            return { 
                id: 'nameEntry', items: submitBtn && !submitBtn.disabled ? [submitBtn] : [], 
                defaultIndex: 0 
            };
        }
        
        const gameOver = document.getElementById('gameOver');
        if (gameOver && gameOver.style.display === 'block') {
            const playAgain = document.getElementById('playAgainBtn');
            return { id: 'gameOver', items: playAgain ? [playAgain] : [], defaultIndex: 0 };
        }
        
        const shareOverlay = document.getElementById('shareOverlay');
        if (shareOverlay && window.getComputedStyle(shareOverlay).display !== 'none') {
            const closeBtn = document.getElementById('shareCloseBtn');
            return { 
                id: 'share', items: closeBtn ? [closeBtn] : [], defaultIndex: 0, 
                onBack: () => { if (closeBtn) closeBtn.click(); } 
            };
        }
        
        const intro = document.getElementById('startOverlay');
        if (intro && window.getComputedStyle(intro).display !== 'none' && 
            window.getComputedStyle(intro).visibility !== 'hidden') {
            const items = [];
            const skillBtn = document.getElementById('introSkillLevelBtn');
            const diffBtn = document.getElementById('introDifficultyBtn');
            const challengeBtn = document.getElementById('introChallengeBtn');
            const startBtn = document.getElementById('startGameBtn');
            
            if (skillBtn) items.push(skillBtn);
            if (diffBtn) items.push(diffBtn);
            if (challengeBtn) items.push(challengeBtn);
            
            // Add toggle switches (Music, Fullscreen)
            const toggles = document.querySelectorAll('.intro-toggles-row .intro-toggle');
            toggles.forEach(t => items.push(t));
            
            if (startBtn) items.push(startBtn);
            
            return { id: 'intro', items, defaultIndex: items.length - 1 }; // Default to Start Game
        }
        
        const modeMenu = document.getElementById('modeMenu');
        if (modeMenu && !modeMenu.classList.contains('hidden')) {
            const items = [];
            const skillBtn = document.getElementById('skillLevelMenuBtn');
            const diffBtn = document.getElementById('difficultyMenuBtn');
            const challengeBtn = document.getElementById('challengeSelectBtn');
            const startBtn = document.getElementById('menuStartGameBtn');
            
            if (skillBtn) items.push(skillBtn);
            if (diffBtn) items.push(diffBtn);
            if (challengeBtn) items.push(challengeBtn);
            if (startBtn) items.push(startBtn);
            
            return { id: 'modeMenu', items, defaultIndex: items.length - 1 }; // Default to START GAME
        }
        
        return null; // No menu screen active
    },
    
    // Main menu navigation handler - returns true if a menu consumed input
    updateMenuNavigation(gp) {
        const screen = this.detectActiveScreen();
        
        if (!screen || !screen.items || screen.items.length === 0) {
            // No active menu screen
            if (this.menuNav.activeScreen) {
                this.clearFocus();
                this.menuNav.activeScreen = null;
            }
            return false;
        }
        
        // Screen changed - reset focus to default
        if (screen.id !== this.menuNav.activeScreen) {
            this.clearFocus();
            this.menuNav.activeScreen = screen.id;
            this.menuNav.focusIndex = screen.defaultIndex || 0;
        }
        
        // Clamp focus index to valid range
        if (this.menuNav.focusIndex >= screen.items.length) {
            this.menuNav.focusIndex = screen.items.length - 1;
        }
        if (this.menuNav.focusIndex < 0) {
            this.menuNav.focusIndex = 0;
        }
        
        // Apply visual focus
        this.applyFocus(screen.items, this.menuNav.focusIndex);
        
        const now = Date.now();
        const stickUp = gp.axes[1] < -0.5;
        const stickDown = gp.axes[1] > 0.5;
        
        // Up/Down navigation with repeat delay
        if (now - this.lastMoveTime >= this.repeatDelay) {
            if (this.wasButtonJustPressed(gp, this.buttons.D_UP) || (stickUp && !this.menuStickWasUp)) {
                this.menuNav.focusIndex--;
                if (this.menuNav.focusIndex < 0) this.menuNav.focusIndex = screen.items.length - 1;
                this.applyFocus(screen.items, this.menuNav.focusIndex);
                if (typeof playSoundEffect === 'function') playSoundEffect('move', true);
                this.lastMoveTime = now;
            } else if (this.wasButtonJustPressed(gp, this.buttons.D_DOWN) || (stickDown && !this.menuStickWasDown)) {
                this.menuNav.focusIndex++;
                if (this.menuNav.focusIndex >= screen.items.length) this.menuNav.focusIndex = 0;
                this.applyFocus(screen.items, this.menuNav.focusIndex);
                if (typeof playSoundEffect === 'function') playSoundEffect('move', true);
                this.lastMoveTime = now;
            }
        }
        this.menuStickWasUp = stickUp;
        this.menuStickWasDown = stickDown;
        
        // A button (or Start) to activate focused item
        if (this.wasButtonJustPressed(gp, this.buttons.A) || this.wasButtonJustPressed(gp, this.buttons.START)) {
            const item = screen.items[this.menuNav.focusIndex];
            if (item) {
                // For toggle labels, click the checkbox inside
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.click();
                } else {
                    item.click();
                }
                if (typeof playSoundEffect === 'function') playSoundEffect('rotate', true);
            }
        }
        
        // B button or Back button to go back/close modal
        if (this.wasButtonJustPressed(gp, this.buttons.B) || this.wasButtonJustPressed(gp, this.buttons.BACK)) {
            if (screen.onBack) {
                screen.onBack();
                if (typeof playSoundEffect === 'function') playSoundEffect('move', true);
            }
        }
        
        // Consume all other button presses so they don't leak to gameplay
        // (Read remaining face buttons to update their states)
        this.wasButtonJustPressed(gp, this.buttons.X);
        this.wasButtonJustPressed(gp, this.buttons.Y);
        
        return true; // Menu consumed input
    },
    
    // Apply visual focus indicator to the focused item
    applyFocus(items, focusIndex) {
        // Remove focus from all items
        document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));
        
        // Apply focus to current item
        if (items && items[focusIndex]) {
            items[focusIndex].classList.add('gamepad-focus');
            // Scroll into view if needed (for long lists like combo modal)
            items[focusIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },
    
    // Remove all focus indicators
    clearFocus() {
        document.querySelectorAll('.gamepad-focus').forEach(el => el.classList.remove('gamepad-focus'));
        this.menuNav.focusIndex = 0;
    },
    
    // === HAPTIC FEEDBACK METHODS ===
    
    // Trigger a single vibration pulse
    vibrate(duration = 200, weakMagnitude = 0.5, strongMagnitude = 1.0) {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        try {
            const gamepads = navigator.getGamepads();
            if (!gamepads) return;
            
            const gp = gamepads[0];
            if (!gp) return;
            
            if (gp.vibrationActuator) {
                gp.vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration: duration,
                    weakMagnitude: weakMagnitude,
                    strongMagnitude: strongMagnitude
                });
            } else if (gp.hapticActuators && gp.hapticActuators[0]) {
                // Fallback for older API
                gp.hapticActuators[0].pulse(strongMagnitude, duration);
            }
        } catch (error) {
            // Silently fail - vibration is non-critical
        }
    },
    
    // Start continuous rumble effect (for ongoing events like earthquakes)
    startContinuousRumble(weakMagnitude = 0.3, strongMagnitude = 0.6) {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        // Clear any existing rumble
        this.stopVibration();
        
        // Pulse every 100ms to create continuous effect
        this.activeVibration = setInterval(() => {
            this.vibrate(120, weakMagnitude, strongMagnitude);
        }, 100);
    },
    
    // Earthquake rumble - strong, irregular vibration
    startEarthquakeRumble() {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        this.stopVibration();
        
        // Irregular rumble pattern for earthquake feel
        this.activeVibration = setInterval(() => {
            const intensity = 0.5 + Math.random() * 0.5; // 0.5 to 1.0
            const weak = 0.3 + Math.random() * 0.4;
            this.vibrate(150, weak, intensity);
        }, 120);
    },
    
    // Black hole rumble - pulsing, building intensity
    startBlackHoleRumble(progress = 0) {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        // Single pulse based on current progress (0-1)
        // Intensity builds as black hole progresses
        const baseIntensity = 0.2 + (progress * 0.6);
        const strongMag = Math.min(1.0, baseIntensity + Math.sin(Date.now() / 200) * 0.2);
        const weakMag = strongMag * 0.5;
        
        this.vibrate(100, weakMag, strongMag);
    },
    
    // Tsunami rumble - wave-like pattern that builds, crashes, then recedes
    startTsunamiRumble() {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        this.stopVibration();
        
        const tsunamiDuration = 2083; // Match game's tsunami duration
        const startTime = Date.now();
        
        // Wave pattern: build up (0-40%), crash/peak (40-60%), recede (60-100%)
        this.activeVibration = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / tsunamiDuration;
            
            if (progress >= 1) {
                this.stopVibration();
                return;
            }
            
            let intensity, weakMag;
            
            if (progress < 0.4) {
                // Building wave - intensity rises
                intensity = 0.2 + (progress / 0.4) * 0.6; // 0.2 → 0.8
                weakMag = intensity * 0.4;
            } else if (progress < 0.6) {
                // Crash/peak - maximum intensity with variation
                intensity = 0.8 + Math.sin((progress - 0.4) * Math.PI * 10) * 0.2; // 0.6-1.0 oscillating
                weakMag = 0.5 + Math.random() * 0.3;
            } else {
                // Receding - intensity falls
                const recedeProgress = (progress - 0.6) / 0.4; // 0 → 1
                intensity = 0.8 - recedeProgress * 0.7; // 0.8 → 0.1
                weakMag = intensity * 0.3;
            }
            
            this.vibrate(120, weakMag, intensity);
        }, 100);
    },
    
    // Alternative: Rolling waves pattern (multiple hits)
    startRollingWavesRumble() {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        this.stopVibration();
        
        // Three waves of decreasing intensity
        const waves = [
            { delay: 0, intensity: 1.0, duration: 400 },
            { delay: 600, intensity: 0.7, duration: 350 },
            { delay: 1100, intensity: 0.5, duration: 300 },
            { delay: 1500, intensity: 0.3, duration: 250 }
        ];
        
        waves.forEach(wave => {
            setTimeout(() => {
                if (this.vibrationEnabled && this.connected) {
                    this.vibrate(wave.duration, wave.intensity * 0.4, wave.intensity);
                }
            }, wave.delay);
        });
        
        // Clear active vibration marker after all waves complete
        this.activeVibration = setTimeout(() => {
            this.activeVibration = null;
        }, 1800);
    },
    
    // Line clear vibration - intensity scales with blob score value
    vibrateLineClear(scoreValue = 0) {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        // Scale intensity logarithmically based on score
        // 1,000 points = light buzz, 100,000+ = strong thump
        const logScore = Math.log10(Math.max(scoreValue, 1000)); // 3 to ~6+
        const normalizedScore = (logScore - 3) / 3; // 0 to 1 (capped at ~1M points)
        
        const duration = 60 + Math.min(normalizedScore * 120, 140); // 60ms to 200ms
        const intensity = 0.3 + Math.min(normalizedScore * 0.7, 0.7); // 0.3 to 1.0
        const weakMag = intensity * 0.4;
        
        this.vibrate(duration, weakMag, Math.min(1.0, intensity));
    },
    
    // Volcano rumble - builds during warming, peaks at eruption
    startVolcanoRumble() {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        this.stopVibration();
        
        const warmingDuration = 3000; // Match game's volcano warming
        const startTime = Date.now();
        
        // Builds from gentle rumble to intense shake
        this.activeVibration = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / warmingDuration, 1);
            
            // Intensity builds over time
            const intensity = 0.2 + progress * 0.6; // 0.2 → 0.8
            const weakMag = intensity * 0.4;
            
            // Add some variation like magma bubbling
            const variation = Math.sin(elapsed / 100) * 0.15;
            
            this.vibrate(100, weakMag, Math.min(1.0, intensity + variation));
        }, 80);
    },
    
    // Volcano eruption burst - strong burst when eruption starts
    vibrateVolcanoEruption() {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        this.stopVibration();
        
        // Strong initial burst
        this.vibrate(300, 0.6, 1.0);
    },
    
    // Tornado touchdown/destruction - sharp impact
    vibrateTornadoImpact(isDestruction = false) {
        if (!this.vibrationEnabled || !this.vibrationSupported || !this.connected) return;
        
        if (isDestruction) {
            // Blob destroyed - sharp crack
            this.vibrate(100, 0.5, 0.9);
        } else {
            // Touchdown bonus - celebratory double pulse
            this.vibrate(80, 0.4, 0.8);
            setTimeout(() => {
                if (this.vibrationEnabled && this.connected) {
                    this.vibrate(120, 0.5, 1.0);
                }
            }, 120);
        }
    },
    
    // Stop any ongoing vibration
    stopVibration() {
        if (this.activeVibration) {
            clearInterval(this.activeVibration);
            this.activeVibration = null;
        }
        
        // Send a zero-intensity pulse to stop hardware vibration
        try {
            const gamepads = navigator.getGamepads();
            if (gamepads && gamepads[0] && gamepads[0].vibrationActuator) {
                gamepads[0].vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration: 1,
                    weakMagnitude: 0,
                    strongMagnitude: 0
                });
            }
        } catch (error) {
            // Ignore
        }
    },
    
    // Update the controls display based on controller connection
    updateControlsDisplay() {
        const keyboardControls = document.querySelector('.controls:not(#controllerControls)');
        let controllerControls = document.getElementById('controllerControls');
        
        if (!keyboardControls) return;
        
        // Create controller controls if they don't exist
        if (!controllerControls) {
            controllerControls = this.createControllerControls();
            if (keyboardControls.parentNode) {
                keyboardControls.parentNode.insertBefore(controllerControls, keyboardControls.nextSibling);
            }
        }
        
        // Toggle which controls are shown (but don't override hidden-during-play)
        if (this.connected && controllerControls) {
            keyboardControls.style.display = 'none';
            controllerControls.style.display = '';  // Let CSS handle it
        } else if (keyboardControls) {
            keyboardControls.style.display = '';  // Let CSS handle it
            if (controllerControls) controllerControls.style.display = 'none';
        }
    },
    
    // Create the controller controls display element
    createControllerControls() {
        const div = document.createElement('div');
        div.id = 'controllerControls';
        div.className = 'controls';
        div.style.display = 'none';
        div.innerHTML = `
            <strong>🎮 Controller</strong>
            <div class="control-row"><span class="control-key">D-Pad / L-Stick</span> : <span class="control-label">Move</span></div>
            <div class="control-row"><span class="control-key">LT / RT / Up / RSB</span> : <span class="control-label">Hard Drop</span></div>
            <div class="control-row"><span class="control-key">B / Y / RS→↓</span> : <span class="control-label">Rotate CW</span></div>
            <div class="control-row"><span class="control-key">A / X / RS←↑</span> : <span class="control-label">Rotate CCW</span></div>
            <div class="control-row"><span class="control-key">RB / LB</span> : <span class="control-label">Next / Prev Song</span></div>
            <div class="control-row"><span class="control-key">Start</span> : <span class="control-label">Pause</span></div>
        `;
        return div;
    },
    
    // Navigate mode menu
    navigateMenu(direction) {
        const modeButtonsNodeList = document.querySelectorAll('.mode-button');
        if (!modeButtonsNodeList || modeButtonsNodeList.length === 0) return;
        
        const buttons = Array.from(modeButtonsNodeList);
        let currentIndex = buttons.findIndex(btn => btn.classList.contains('selected'));
        if (currentIndex === -1) currentIndex = 0;
        
        let newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = buttons.length - 1;
        if (newIndex >= buttons.length) newIndex = 0;
        
        // Update the global selectedModeIndex
        if (typeof selectedModeIndex !== 'undefined') {
            selectedModeIndex = newIndex;
        }
        
        // Use updateSelectedMode to update visuals AND leaderboard
        if (typeof updateSelectedMode === 'function') {
            updateSelectedMode();
        } else {
            // Fallback: Update selection visually if updateSelectedMode not available yet
            buttons.forEach((btn, i) => {
                if (i === newIndex) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            });
        }
        
        // Play move sound
        if (typeof playSoundEffect === 'function') {
            playSoundEffect('move', true);
        }
    },
    
    // Select current mode from menu
    selectCurrentMode() {
        const menuStartBtn = document.getElementById('menuStartGameBtn');
        if (menuStartBtn) {
            menuStartBtn.click();
        } else {
            const selectedButton = document.querySelector('.mode-button.selected');
            if (selectedButton) {
                selectedButton.click();
            }
        }
    }
};

window.GamepadController = GamepadController;
