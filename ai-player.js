/**
 * AI Player Module for TaNTЯiS / BLOCKCHaiNSTORM
 * Plays the game automatically using heuristic-based evaluation
 * Uses Web Worker for computation to avoid UI freezes
 */
console.log("🎮 AI Player v3.15 loaded - shadow evaluation for human game analysis");

const AIPlayer = (() => {
    // Configuration
    let enabled = false;
    let thinking = false;
    let moveQueue = [];
    let lastMoveTime = 0;
    let moveDelay = 155; // ms between moves (adjustable for speed, default ~mid speed)
    let thinkDelay = 210; // ms to "think" before executing (default ~mid speed)
    
    // Web Worker for AI computation
    let worker = null;
    let workerReady = false;
    let pendingCallback = null;
    
    // Game state
    let currentSkillLevel = 'tempest';
    let pieceQueue = [];
    let currentMode = 'colorBuilding'; // Track mode for display/logging
    let currentStackHeight = 0; // Track stack height for debugging
    let currentUfoActive = false; // Track UFO state for 42 lines easter egg
    
    // Stuck detection - prevents infinite rotation/movement loops
    let lastPieceKey = null; // Track piece identity (x, y, rotation, shape hash)
    let samePositionCount = 0; // How many times we've calculated for same piece position
    const STUCK_THRESHOLD = 3; // Force drop after this many same-position calculations
    
    // Piece identity tracking - prevent multiple calculations for same piece
    let lastCalculatedPieceId = null; // Track which piece we last calculated for
    let samePieceCount = 0; // How many times we've tried to calculate for same piece
    
    // Decision metadata for recording
    let lastDecisionMeta = null;
    
    // Mode thresholds (reference - actual logic is in worker)
    const modeThresholds = {
        breeze: { upper: 12, lower: 6 },
        tempest: { upper: 12, lower: 6 },
        maelstrom: { upper: 10, lower: 5 },
        hurricane: { upper: 10, lower: 5 }
    };
    
    // ==================== FALLBACK RECORDING SYSTEM ====================
    // Used when Web Worker is not available (e.g., file:// protocol)
    
    let fallbackRecording = {
        startTime: null,
        skillLevel: null,
        decisions: [],
        events: [],
        finalState: null
    };
    
    function fallbackStartRecording() {
        fallbackRecording = {
            startTime: Date.now(),
            skillLevel: currentSkillLevel,
            decisions: [],
            events: [],
            finalState: null
        };
        console.log('🎬 Fallback recording started');
    }
    
    function fallbackRecordDecision(board, piece, placements, chosen) {
        if (!fallbackRecording.startTime) return;
        
        // Sort placements by score
        const sortedPlacements = [...placements].sort((a, b) => b.score - a.score);
        const topPlacements = sortedPlacements.slice(0, 5);
        const bottomPlacements = sortedPlacements.slice(-2);
        
        // Compress board
        const compressedBoard = [];
        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                if (board[y][x]) {
                    compressedBoard.push({ x, y, c: board[y][x] });
                }
            }
        }
        
        fallbackRecording.decisions.push({
            t: Date.now() - fallbackRecording.startTime,
            mode: currentMode,
            stackHeight: currentStackHeight,
            piece: { shape: piece.shape, color: piece.color },
            board: compressedBoard,
            top: topPlacements.map(p => ({ x: p.x, y: p.y, r: p.rotationIndex, s: Math.round(p.score * 100) / 100 })),
            bottom: bottomPlacements.map(p => ({ x: p.x, y: p.y, r: p.rotationIndex, s: Math.round(p.score * 100) / 100 })),
            chosen: { x: chosen.x, y: chosen.y, r: chosen.rotationIndex, s: Math.round(chosen.score * 100) / 100 }
        });
    }
    
    function fallbackRecordEvent(type, data) {
        if (!fallbackRecording.startTime) return;
        fallbackRecording.events.push({
            t: Date.now() - fallbackRecording.startTime,
            type,
            ...data
        });
    }
    
    function fallbackFinalizeRecording(board, cause) {
        if (!fallbackRecording.startTime) return fallbackRecording;
        
        // Compress final board
        const compressedBoard = [];
        if (board) {
            for (let y = 0; y < board.length; y++) {
                for (let x = 0; x < board[y].length; x++) {
                    if (board[y][x]) {
                        compressedBoard.push({ x, y, c: board[y][x] });
                    }
                }
            }
        }
        
        fallbackRecording.finalState = {
            board: compressedBoard,
            cause,
            stackHeight: currentStackHeight,
            mode: currentMode,
            totalDecisions: fallbackRecording.decisions.length,
            duration: Date.now() - fallbackRecording.startTime
        };
        
        console.log('🎬 Fallback recording finalized');
        return fallbackRecording;
    }
    
    /**
     * Initialize the Web Worker
     */
    function initWorker() {
        if (worker) return;
        
        try {
            // Check if we're on file:// protocol - workers don't work there
            if (window.location.protocol === 'file:') {
                console.warn('🤖 Running from file:// - Web Workers disabled, using inline fallback');
                workerReady = false;
                return;
            }
            
            worker = new Worker('ai-worker.js');
            
            // Don't set workerReady until we get a response
            let initTimeout = setTimeout(() => {
                if (!workerReady) {
                    console.warn('🤖 Worker failed to respond, using inline fallback');
                    worker = null;
                }
            }, 2000);
            
            worker.onmessage = function(e) {
                // First message confirms worker is working
                if (!workerReady) {
                    workerReady = true;
                    clearTimeout(initTimeout);
                    console.log('🤖 AI Worker confirmed ready');
                }
                
                const { bestPlacement, reset, stackHeight, decisionMeta } = e.data;
                
                // Track stack height for display
                if (typeof stackHeight === 'number') {
                    currentStackHeight = stackHeight;
                }
                
                // Store decision metadata for recording
                if (decisionMeta) {
                    lastDecisionMeta = decisionMeta;
                }
                
                if (pendingCallback && !reset) {
                    pendingCallback(bestPlacement, decisionMeta);
                    pendingCallback = null;
                }
            };
            
            worker.onerror = function(e) {
                console.error('AI Worker error:', e.message);
                workerReady = false;
                worker = null;
                clearTimeout(initTimeout);
            };
            
            console.log('🤖 AI Worker initializing...');
        } catch (e) {
            console.warn('🤖 Web Worker not available, using inline fallback:', e.message);
            workerReady = false;
        }
    }
    
    /**
     * Initialize the AI
     */
    function init(state) {
        initWorker();
        console.log('🤖 AI Player initialized');
    }
    
    /**
     * Set enabled state
     */
    function setEnabled(value) {
        enabled = value;
        if (value) {
            initWorker();
        }
    }
    
    /**
     * Check if AI is enabled
     */
    function isEnabled() {
        return enabled;
    }
    
    /**
     * Set move speed (1-10, where 10 is fastest)
     */
    function setSpeed(speed) {
        const normalizedSpeed = Math.max(1, Math.min(10, speed));
        moveDelay = 300 - (normalizedSpeed * 29); // 271ms to 10ms
        thinkDelay = 400 - (normalizedSpeed * 38); // 362ms to 20ms
    }
    
    /**
     * Set skill level
     */
    function setSkillLevel(level) {
        currentSkillLevel = level;
    }
    
    /**
     * Calculate moves needed to reach target placement
     * @param {boolean} skipDrop - If true, don't add drop command (for earthquake positioning)
     */
    function calculateMoves(currentPiece, targetPlacement, skipDrop = false) {
        const moves = [];
        
        for (let i = 0; i < targetPlacement.rotationIndex; i++) {
            moves.push('rotate');
        }
        
        const xDiff = targetPlacement.x - currentPiece.x;
        
        if (xDiff < 0) {
            for (let i = 0; i < Math.abs(xDiff); i++) {
                moves.push('left');
            }
        } else if (xDiff > 0) {
            for (let i = 0; i < xDiff; i++) {
                moves.push('right');
            }
        }
        
        if (!skipDrop) {
            moves.push('drop');
        }
        
        return moves;
    }
    
    /**
     * Generate a key to identify piece state for stuck detection
     */
    function getPieceKey(piece) {
        if (!piece || !piece.shape) return null;
        // Include position and shape hash to detect if piece has actually moved
        const shapeStr = piece.shape.map(row => row.join('')).join('|');
        return `${piece.x},${piece.y},${shapeStr}`;
    }
    
    // ============ INLINE FALLBACK (for file:// protocol) ============
    
    function fallbackCloneBoard(board) {
        return board.map(row => row ? [...row] : new Array(10).fill(null));
    }
    
    function fallbackGetAllRotations(shape) {
        const rotations = [shape];
        let current = shape;
        for (let i = 0; i < 3; i++) {
            const rotated = current[0].map((_, colIndex) =>
                current.map(row => row[colIndex]).reverse()
            );
            const isDuplicate = rotations.some(existing =>
                existing.length === rotated.length &&
                existing.every((row, y) => row.length === rotated[y].length && row.every((val, x) => val === rotated[y][x]))
            );
            if (!isDuplicate) rotations.push(rotated);
            current = rotated;
        }
        return rotations;
    }
    
    function fallbackIsValid(board, shape, x, y, cols, rows) {
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (!shape[py][px]) continue;
                const bx = x + px, by = y + py;
                if (bx < 0 || bx >= cols || by >= rows) return false;
                if (by >= 0 && board[by] && board[by][bx]) return false;
            }
        }
        return true;
    }
    
    function fallbackDrop(board, shape, x, cols, rows) {
        let y = -shape.length;
        while (fallbackIsValid(board, shape, x, y + 1, cols, rows)) y++;
        return y;
    }
    
    function fallbackPlace(board, shape, x, y, color) {
        const newBoard = fallbackCloneBoard(board);
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (shape[py][px]) {
                    const by = y + py, bx = x + px;
                    if (by >= 0 && by < newBoard.length && bx >= 0 && bx < newBoard[0].length) {
                        newBoard[by][bx] = color;
                    }
                }
            }
        }
        return newBoard;
    }
    
    function fallbackCountHoles(board) {
        let holes = 0;
        const cols = board[0].length;
        for (let x = 0; x < cols; x++) {
            let found = false;
            for (let y = 0; y < board.length; y++) {
                if (board[y] && board[y][x]) found = true;
                else if (found && board[y]) holes++;
            }
        }
        return holes;
    }
    
    function fallbackGetHeight(board, rows) {
        for (let y = 0; y < board.length; y++) {
            if (board[y] && board[y].some(c => c !== null)) return rows - y;
        }
        return 0;
    }
    
    function fallbackCountLines(board) {
        return board.filter(row => row && row.every(c => c !== null)).length;
    }
    
    function fallbackColorAdjacency(board, shape, x, y, color, cols, rows) {
        let adj = 0;
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (!shape[py][px]) continue;
                const bx = x + px, by = y + py;
                [[bx-1,by],[bx+1,by],[bx,by-1],[bx,by+1]].forEach(([nx,ny]) => {
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && board[ny] && board[ny][nx] === color) adj++;
                });
            }
        }
        return adj;
    }
    
    function fallbackEvaluate(board, shape, x, y, color, cols, rows, linesCleared) {
        const height = fallbackGetHeight(board, rows);
        const holes = fallbackCountHoles(board);
        const adj = fallbackColorAdjacency(board, shape, x, y, color, cols, rows);
        
        let score = 0;
        
        // CASCADE-AWARE: Holes aren't as devastating in this game
        // Blob gravity can fill them when special events clear areas
        score -= holes * 4;       // Reduced from 10 (cascade will help)
        score -= height * 0.6;    // Keep stack low but not obsessively
        
        // Line clears - often BAD when building for special events
        // Only reward them when height is dangerous
        if (height >= 16) {
            score += linesCleared * 30; // Emergency clear
        } else if (height >= 14) {
            score += linesCleared * 10;
        } else {
            // Penalize line clears when building blobs
            score -= linesCleared * 5;
        }
        
        // Compactness: reward touching existing blocks
        const touching = fallbackCountTouching(board, shape, x, y, cols, rows);
        score += touching * 2;
        
        // Color adjacency - MORE important for special events
        // Horizontal adjacency worth more (for tsunamis)
        const horizAdj = fallbackHorizontalAdjacency(board, shape, x, y, color, cols, rows);
        score += horizAdj * 5;   // Strong horizontal bonus
        score += (adj - horizAdj) * 2;  // Vertical is worth less
        
        // Death zone penalties - still important
        if (height >= 19) {
            score -= 200;
        } else if (height >= 17) {
            score -= 50;
        } else if (height >= 15) {
            score -= 10;
        }
        
        return score;
    }
    
    /**
     * Count horizontal same-color adjacency specifically
     */
    function fallbackHorizontalAdjacency(board, shape, x, y, color, cols, rows) {
        let adj = 0;
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (!shape[py][px]) continue;
                const bx = x + px, by = y + py;
                // Left neighbor
                if (bx > 0 && by >= 0 && by < rows && board[by] && board[by][bx-1] === color) {
                    let partOfPiece = px > 0 && shape[py][px-1];
                    if (!partOfPiece) adj++;
                }
                // Right neighbor
                if (bx < cols-1 && by >= 0 && by < rows && board[by] && board[by][bx+1] === color) {
                    let partOfPiece = px < shape[py].length-1 && shape[py][px+1];
                    if (!partOfPiece) adj++;
                }
            }
        }
        return adj;
    }
    
    /**
     * Count how many cells of the placed piece touch existing blocks
     */
    function fallbackCountTouching(board, shape, x, y, cols, rows) {
        let touching = 0;
        for (let sy = 0; sy < shape.length; sy++) {
            for (let sx = 0; sx < shape[sy].length; sx++) {
                if (!shape[sy][sx]) continue;
                const bx = x + sx;
                const by = y + sy;
                
                // Check 4 neighbors
                [[bx-1, by], [bx+1, by], [bx, by-1], [bx, by+1]].forEach(([nx, ny]) => {
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                        if (board[ny] && board[ny][nx]) {
                            touching++;
                        }
                    }
                });
            }
        }
        return touching;
    }
    
    /**
     * Fallback mode switching (mirrors worker logic)
     */
    function fallbackUpdateMode(board, rows) {
        const stackHeight = fallbackGetHeight(board, rows);
        const thresholds = modeThresholds[currentSkillLevel] || modeThresholds.tempest;
        
        currentStackHeight = stackHeight;
        
        if (currentMode === 'colorBuilding' && stackHeight >= thresholds.upper) {
            currentMode = 'survival';
            console.log(`🔴 FALLBACK: Switching to SURVIVAL (height ${stackHeight} >= ${thresholds.upper})`);
            fallbackRecordEvent('modeSwitch', { from: 'colorBuilding', to: 'survival', stackHeight });
        } else if (currentMode === 'survival' && stackHeight <= thresholds.lower) {
            currentMode = 'colorBuilding';
            console.log(`🟢 FALLBACK: Switching to COLOR BUILDING (height ${stackHeight} <= ${thresholds.lower})`);
            fallbackRecordEvent('modeSwitch', { from: 'survival', to: 'colorBuilding', stackHeight });
        }
    }
    
    function fallbackFindBest(board, piece, cols, rows) {
        // Update mode before finding best placement
        fallbackUpdateMode(board, rows);
        
        const rotations = fallbackGetAllRotations(piece.shape);
        let best = null;
        let bestScore = -Infinity;
        const allPlacements = []; // Collect all placements for recording
        
        for (let ri = 0; ri < rotations.length; ri++) {
            const shape = rotations[ri];
            for (let x = -2; x < cols + 2; x++) {
                if (!fallbackIsValid(board, shape, x, 0, cols, rows) && !fallbackIsValid(board, shape, x, -shape.length, cols, rows)) continue;
                const y = fallbackDrop(board, shape, x, cols, rows);
                if (!fallbackIsValid(board, shape, x, y, cols, rows)) continue;
                
                // CRITICAL: Check if piece would extend above the board (game over)
                if (y < 0) {
                    // This placement would cause game over - skip or massive penalty
                    const placement = { x, y, rotationIndex: ri, shape, score: -10000 };
                    allPlacements.push(placement);
                    if (-10000 > bestScore) {
                        bestScore = -10000;
                        best = placement;
                    }
                    continue;
                }
                
                const newBoard = fallbackPlace(board, shape, x, y, piece.color);
                const linesBefore = fallbackCountLines(board);
                const linesAfter = fallbackCountLines(newBoard);
                const score = fallbackEvaluate(newBoard, shape, x, y, piece.color, cols, rows, linesAfter - linesBefore);
                
                const placement = { x, y, rotationIndex: ri, shape, score };
                allPlacements.push(placement);
                
                if (score > bestScore) {
                    bestScore = score;
                    best = placement;
                }
            }
        }
        
        // Record this decision if recording is active
        if (recordingEnabled && best && allPlacements.length > 0) {
            fallbackRecordDecision(board, piece, allPlacements, best);
        }
        
        return best;
    }
    
    // ============ END INLINE FALLBACK ============
    
    /**
     * Request best placement from worker (async)
     */
    function requestBestPlacement(board, piece, queue, cols, rows, callback) {
        if (!workerReady || !worker) {
            // Fallback: use inline synchronous calculation (fallbackFindBest calls fallbackUpdateMode)
            const best = fallbackFindBest(board, piece, cols, rows);
            console.log(`🤖 FALLBACK: mode=${currentMode}, stackHeight=${currentStackHeight}`);
            callback(best, null);
            return;
        }
        
        // Don't send a new request if one is already pending
        // This prevents duplicate calculations when tab is backgrounded/resumed
        if (pendingCallback) {
            // Don't start a new request, but also don't leave caller hanging
            // The pending request will complete and trigger its callback
            return;
        }
        
        pendingCallback = callback;
        
        // Generate all rotations for this piece
        const rotations = fallbackGetAllRotations(piece.shape);
        
        // Serialize data for worker
        worker.postMessage({
            board: board,
            piece: {
                shape: piece.shape,
                color: piece.color,
                rotations: rotations,
                x: piece.x,
                y: piece.y
            },
            queue: queue.map(p => p ? { shape: p.shape, color: p.color, rotations: fallbackGetAllRotations(p.shape) } : null).filter(Boolean),
            cols: cols,
            rows: rows,
            skillLevel: currentSkillLevel,
            ufoActive: currentUfoActive,
            captureDecisionMeta: recordingEnabled
        });
    }
    
    /**
     * Main AI update function - call each frame
     * gameState optional parameter includes: { earthquakeActive, earthquakePhase, ufoActive }
     */
    function update(board, currentPiece, nextPieceOrQueue, cols, rows, callbacks, gameState = {}) {
        if (!enabled || !currentPiece) return;
        
        // Always update mode and stack height on main thread for accurate display
        updateModeFromBoard(board, rows);
        
        const now = Date.now();
        const { earthquakeActive, earthquakePhase, ufoActive } = gameState;
        const duringEarthquake = earthquakeActive && (earthquakePhase === 'shake' || earthquakePhase === 'crack' || earthquakePhase === 'shift');
        
        // Generate piece identity based on color (new piece = new color in this game)
        const currentPieceId = currentPiece.color;
        
        // Execute queued moves
        if (moveQueue.length > 0) {
            if (now - lastMoveTime >= moveDelay) {
                const move = moveQueue.shift();
                executeMove(move, callbacks);
                lastMoveTime = now;
            }
            return;
        }
        
        // Don't start thinking if already thinking
        if (thinking) return;
        
        // If we already calculated for this piece and have no moves, force drop
        // This handles the case where calculation completed but moves didn't execute
        if (lastCalculatedPieceId === currentPieceId) {
            samePieceCount++;
            if (samePieceCount >= STUCK_THRESHOLD) {
                console.log(`🤖 AI stuck on same piece (${samePieceCount} cycles) - forcing drop`);
                moveQueue = ['drop'];
                lastMoveTime = now;
                samePieceCount = 0;
                lastCalculatedPieceId = null;
                return;
            }
        } else {
            // New piece - reset counter
            samePieceCount = 0;
        }
        
        // Stuck detection: check if piece is in same position as last calculation
        // Skip stuck detection during earthquake since we're intentionally not dropping
        const pieceKey = getPieceKey(currentPiece);
        if (!duringEarthquake) {
            if (pieceKey === lastPieceKey) {
                samePositionCount++;
                if (samePositionCount >= STUCK_THRESHOLD) {
                    // Piece hasn't moved after multiple attempts - force immediate drop
                    console.log(`🤖 AI stuck detected (${samePositionCount} attempts at same position) - forcing drop`);
                    moveQueue = ['drop'];
                    lastMoveTime = Date.now();
                    samePositionCount = 0; // Reset after forcing drop
                    lastPieceKey = null;
                    lastCalculatedPieceId = null;
                    return;
                }
            } else {
                // Piece moved or new piece - reset counter
                samePositionCount = 0;
                lastPieceKey = pieceKey;
            }
        }
        
        thinking = true;
        lastCalculatedPieceId = currentPieceId;
        
        // Store UFO state for this decision
        currentUfoActive = ufoActive || false;
        
        // Handle both legacy single piece and new queue array
        if (Array.isArray(nextPieceOrQueue)) {
            pieceQueue = nextPieceOrQueue;
        } else {
            pieceQueue = nextPieceOrQueue ? [nextPieceOrQueue] : [];
        }
        
        // Small delay before thinking (feels more natural)
        setTimeout(() => {
            // Update skill level from global if available
            if (typeof window !== 'undefined' && window.skillLevel) {
                currentSkillLevel = window.skillLevel;
            }
            
            // Request placement from worker
            requestBestPlacement(board, currentPiece, pieceQueue, cols, rows, (bestPlacement, decisionMeta) => {
                if (bestPlacement) {
                    // During earthquake: position piece but don't hard drop (let it fall naturally)
                    moveQueue = calculateMoves(currentPiece, bestPlacement, duringEarthquake);
                } else {
                    // Only drop if not during earthquake
                    moveQueue = duringEarthquake ? [] : ['drop'];
                }
                
                thinking = false;
                lastMoveTime = Date.now();
            });
        }, thinkDelay);
    }
    
    /**
     * Execute a single move
     */
    function executeMove(move, callbacks) {
        switch (move) {
            case 'left':
                if (callbacks.moveLeft) callbacks.moveLeft();
                break;
            case 'right':
                if (callbacks.moveRight) callbacks.moveRight();
                break;
            case 'rotate':
                if (callbacks.rotate) callbacks.rotate();
                break;
            case 'drop':
                if (callbacks.hardDrop) callbacks.hardDrop();
                break;
            case 'down':
                if (callbacks.softDrop) callbacks.softDrop();
                break;
        }
    }
    
    /**
     * Reset AI state
     */
    function reset() {
        moveQueue = [];
        pieceQueue = [];
        thinking = false;
        lastMoveTime = 0;
        pendingCallback = null;
        currentMode = 'colorBuilding'; // Reset to color building mode
        
        // Reset stuck detection
        lastPieceKey = null;
        samePositionCount = 0;
        lastCalculatedPieceId = null;
        samePieceCount = 0;
        
        // Also reset worker's mode
        if (worker && workerReady) {
            worker.postMessage({ command: 'reset' });
        }
    }
    
    /**
     * Get current AI mode
     */
    function getMode() {
        return currentMode;
    }
    
    /**
     * Get current stack height (for debugging)
     */
    function getStackHeight() {
        return currentStackHeight;
    }
    
    /**
     * Calculate stack height directly (for when worker doesn't report it)
     */
    function calculateStackHeight(board, rows) {
        if (!board || board.length === 0) return 0;
        for (let y = 0; y < board.length; y++) {
            const row = board[y];
            if (row) {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] !== null && row[x] !== undefined) {
                        return board.length - y;
                    }
                }
            }
        }
        return 0;
    }
    
    /**
     * Update mode based on stack height (main thread fallback)
     */
    function updateModeFromBoard(board, rows) {
        const stackHeight = calculateStackHeight(board, rows);
        currentStackHeight = stackHeight;
        
        const thresholds = modeThresholds[currentSkillLevel] || modeThresholds.tempest;
        
        if (currentMode === 'colorBuilding' && stackHeight >= thresholds.upper) {
            currentMode = 'survival';
            console.log(`🔴 AI SWITCHING TO SURVIVAL (height ${stackHeight} >= ${thresholds.upper})`);
            recordEvent('modeSwitch', { from: 'colorBuilding', to: 'survival', stackHeight });
        } else if (currentMode === 'survival' && stackHeight <= thresholds.lower) {
            currentMode = 'colorBuilding';
            console.log(`🟢 AI SWITCHING TO COLOR BUILDING (height ${stackHeight} <= ${thresholds.lower})`);
            recordEvent('modeSwitch', { from: 'survival', to: 'colorBuilding', stackHeight });
        }
    }
    
    /**
     * Terminate worker (cleanup)
     */
    function terminate() {
        if (worker) {
            worker.terminate();
            worker = null;
            workerReady = false;
        }
    }
    
    // ==================== RECORDING SYSTEM ====================
    
    let recordingEnabled = false;
    let currentRecording = null;
    
    /**
     * Start recording AI decisions
     */
    function startRecording() {
        recordingEnabled = true;
        currentRecording = null;
        
        if (worker && workerReady) {
            worker.postMessage({ 
                command: 'startRecording',
                skillLevel: currentSkillLevel
            });
            console.log('🎬 AI Recording started (worker)');
        } else {
            // Use fallback recording
            fallbackStartRecording();
        }
    }
    
    /**
     * Stop recording and get the data
     */
    function stopRecording(board, cause) {
        recordingEnabled = false;
        
        return new Promise((resolve) => {
            if (worker && workerReady) {
                const handler = function(e) {
                    if (e.data.recordingStopped) {
                        currentRecording = e.data.recording;
                        worker.removeEventListener('message', handler);
                        console.log('🎬 AI Recording stopped (worker)');
                        resolve(currentRecording);
                    }
                };
                worker.addEventListener('message', handler);
                worker.postMessage({ 
                    command: 'stopRecording',
                    board: board,
                    cause: cause || 'unknown'
                });
            } else {
                // Use fallback recording
                currentRecording = fallbackFinalizeRecording(board, cause || 'unknown');
                resolve(currentRecording);
            }
        });
    }
    
    /**
     * Record a game event (tsunami, line clear, mode switch, etc.)
     */
    function recordEvent(eventType, eventData) {
        if (!recordingEnabled) return;
        
        if (worker && workerReady) {
            worker.postMessage({
                command: 'recordEvent',
                eventType: eventType,
                eventData: eventData
            });
        } else {
            // Use fallback recording
            fallbackRecordEvent(eventType, eventData);
        }
    }
    
    /**
     * Download recording as JSON file
     */
    function downloadRecording(recording) {
        const data = recording || currentRecording;
        if (!data) {
            console.warn('No recording available to download');
            return;
        }
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-game-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('🎬 Recording downloaded');
    }
    
    /**
     * Check if recording is active
     */
    function isRecording() {
        return recordingEnabled;
    }
    
    /**
     * Get current recording data
     */
    function getRecording() {
        return currentRecording;
    }
    
    /**
     * Get last decision metadata (for external use by game recorder)
     */
    function getLastDecisionMeta() {
        return lastDecisionMeta;
    }
    
    /**
     * Clear last decision metadata
     */
    function clearLastDecisionMeta() {
        lastDecisionMeta = null;
    }
    
    // ==================== SHADOW MODE (for human game analysis) ====================
    
    let shadowCallback = null;
    
    /**
     * Calculate what the AI would do without executing moves
     * Used during human gameplay to compare decisions
     * Returns promise that resolves with decision metadata
     */
    function shadowEvaluate(board, piece, queue, cols, rows) {
        return new Promise((resolve) => {
            if (!worker || !workerReady) {
                // No worker available - can't shadow evaluate
                resolve(null);
                return;
            }
            
            // Update skill level from global if available
            if (typeof window !== 'undefined' && window.skillLevel) {
                currentSkillLevel = window.skillLevel;
            }
            
            // Generate all rotations for this piece
            const rotations = fallbackGetAllRotations(piece.shape);
            
            // Set up one-time handler for shadow response
            const shadowHandler = function(e) {
                if (e.data.shadowResponse) {
                    worker.removeEventListener('message', shadowHandler);
                    resolve(e.data.decisionMeta);
                }
            };
            worker.addEventListener('message', shadowHandler);
            
            // Send shadow evaluation request
            worker.postMessage({
                command: 'shadowEvaluate',
                board: board,
                piece: {
                    shape: piece.shape,
                    color: piece.color,
                    rotations: rotations,
                    x: piece.x,
                    y: piece.y
                },
                queue: queue.map(p => p ? { shape: p.shape, color: p.color, rotations: fallbackGetAllRotations(p.shape) } : null).filter(Boolean),
                cols: cols,
                rows: rows,
                skillLevel: currentSkillLevel,
                ufoActive: currentUfoActive
            });
            
            // Timeout fallback
            setTimeout(() => {
                worker.removeEventListener('message', shadowHandler);
                resolve(null);
            }, 500);
        });
    }
    
    return {
        init,
        setEnabled,
        isEnabled,
        setSpeed,
        setSkillLevel,
        update,
        reset,
        terminate,
        getMode,
        getStackHeight,
        modeThresholds,
        // Recording API
        startRecording,
        stopRecording,
        recordEvent,
        downloadRecording,
        isRecording,
        getRecording,
        getLastDecisionMeta,
        clearLastDecisionMeta,
        // Shadow mode for human game analysis
        shadowEvaluate
    };
})();

window.AIPlayer = AIPlayer;
