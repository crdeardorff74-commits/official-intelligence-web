// AI Worker v4.5 - Enhanced special event building (2026-01-16)
console.log("🤖 AI Worker v4.5 loaded - tsunami/volcano priority, cascade-aware hole tolerance");

const AI_VERSION = "4.5";

/**
 * AI for TaNTЯiS / BLOCKCHaiNSTORM
 * 
 * Key insight from game analysis: Score DENSITY (points per line) matters more than survival.
 * Special events (tsunamis, volcanoes, black holes) use cubic scoring:
 *   - 20-block tsunami = 1.6M base points vs typical line clear = thousands
 *   - Holes aren't as bad here due to blob gravity / cascade filling
 * 
 * Priorities:
 * 1. Build toward special events (tsunamis, volcanoes, black holes)
 * 2. Avoid line clears when building toward specials
 * 3. Keep stack manageable (but accept temporary messiness for specials)
 * 4. Holes can fill via cascade - tolerate them when building specials
 */

let currentSkillLevel = 'tempest';
let pieceQueue = [];
let currentUfoActive = false; // Track UFO state for 42 lines easter egg

// ==================== GAME RECORDING ====================
let gameRecording = {
    startTime: null,
    decisions: [],
    events: [],
    finalState: null
};

function startRecording() {
    gameRecording = {
        version: AI_VERSION,
        startTime: Date.now(),
        skillLevel: currentSkillLevel,
        decisions: [],
        events: [],
        finalState: null
    };
}

function recordDecision(board, piece, placements, chosen, stackHeight) {
    const sortedPlacements = [...placements].sort((a, b) => b.score - a.score);
    const topPlacements = sortedPlacements.slice(0, 5);
    
    const compressedBoard = [];
    for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board[y].length; x++) {
            if (board[y][x]) {
                compressedBoard.push({ x, y, c: board[y][x] });
            }
        }
    }
    
    gameRecording.decisions.push({
        time: Date.now() - gameRecording.startTime,
        board: compressedBoard,
        piece: { color: piece.color },
        stackHeight,
        top: topPlacements.map(p => ({ x: p.x, y: p.y, r: p.rotationIndex, s: p.score })),
        chosen: { x: chosen.x, y: chosen.y, r: chosen.rotationIndex, s: chosen.score }
    });
}

function recordEvent(type, data) {
    if (gameRecording.startTime) {
        gameRecording.events.push({
            time: Date.now() - gameRecording.startTime,
            type,
            ...data
        });
    }
}

function finalizeRecording(board, cause) {
    const compressedBoard = [];
    for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board[y].length; x++) {
            if (board[y][x]) {
                compressedBoard.push({ x, y, c: board[y][x] });
            }
        }
    }
    
    gameRecording.finalState = {
        board: compressedBoard,
        cause,
        duration: Date.now() - gameRecording.startTime,
        totalDecisions: gameRecording.decisions.length
    };
    
    return gameRecording;
}

function getRecording() {
    return gameRecording;
}

// ==================== UTILITY FUNCTIONS ====================

function getStackHeight(board, rows) {
    for (let y = 0; y < rows; y++) {
        if (board[y] && board[y].some(cell => cell !== null)) {
            return rows - y;
        }
    }
    return 0;
}

function countHoles(board) {
    let holes = 0;
    const rows = board.length;
    const cols = board[0] ? board[0].length : 10;
    
    for (let x = 0; x < cols; x++) {
        let foundBlock = false;
        for (let y = 0; y < rows; y++) {
            if (board[y] && board[y][x]) {
                foundBlock = true;
            } else if (foundBlock) {
                holes++;
            }
        }
    }
    return holes;
}

function getBumpiness(board) {
    const rows = board.length;
    const cols = board[0] ? board[0].length : 10;
    
    const heights = [];
    for (let x = 0; x < cols; x++) {
        let height = 0;
        for (let y = 0; y < rows; y++) {
            if (board[y] && board[y][x]) {
                height = rows - y;
                break;
            }
        }
        heights.push(height);
    }
    
    let bumpiness = 0;
    for (let i = 0; i < heights.length - 1; i++) {
        bumpiness += Math.abs(heights[i] - heights[i + 1]);
    }
    return bumpiness;
}

function getColumnHeights(board, cols, rows) {
    const heights = [];
    for (let x = 0; x < cols; x++) {
        let height = 0;
        for (let y = 0; y < rows; y++) {
            if (board[y] && board[y][x]) {
                height = rows - y;
                break;
            }
        }
        heights.push(height);
    }
    return heights;
}

// Count same-color neighbors for the placed piece
function getColorAdjacency(board, shape, x, y, color, cols, rows) {
    let adjacent = 0;
    
    for (let py = 0; py < shape.length; py++) {
        for (let px = 0; px < shape[py].length; px++) {
            if (!shape[py][px]) continue;
            
            const boardX = x + px;
            const boardY = y + py;
            
            const neighbors = [
                [boardX - 1, boardY],
                [boardX + 1, boardY],
                [boardX, boardY - 1],
                [boardX, boardY + 1]
            ];
            
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                
                // Skip if this neighbor is part of the piece being placed
                let isPartOfPiece = false;
                for (let ppy = 0; ppy < shape.length; ppy++) {
                    for (let ppx = 0; ppx < shape[ppy].length; ppx++) {
                        if (shape[ppy][ppx] && x + ppx === nx && y + ppy === ny) {
                            isPartOfPiece = true;
                            break;
                        }
                    }
                    if (isPartOfPiece) break;
                }
                if (isPartOfPiece) continue;
                
                if (board[ny] && board[ny][nx] === color) {
                    adjacent++;
                }
            }
        }
    }
    return adjacent;
}

// Find all connected blobs
function getAllBlobs(board, cols, rows) {
    const visited = Array(rows).fill(null).map(() => Array(cols).fill(false));
    const blobs = [];
    
    function floodFill(startX, startY, color) {
        const positions = [];
        const stack = [[startX, startY]];
        
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            
            if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
            if (visited[y][x]) continue;
            if (!board[y] || board[y][x] !== color) continue;
            
            visited[y][x] = true;
            positions.push([x, y]);
            
            stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
        }
        
        return positions;
    }
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (board[y] && board[y][x] && !visited[y][x]) {
                const color = board[y][x];
                const positions = floodFill(x, y, color);
                if (positions.length > 0) {
                    blobs.push({ color, positions, size: positions.length });
                }
            }
        }
    }
    
    return blobs;
}

// Get blob width info
function getBlobWidth(blob, cols) {
    if (!blob || blob.positions.length === 0) return { width: 0, minX: cols, maxX: 0 };
    
    let minX = cols, maxX = 0;
    for (const [x, y] of blob.positions) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    
    return { width: maxX - minX + 1, minX, maxX };
}

// ==================== VOLCANO DETECTION ====================
// Volcano requires: blob touching bottom + side edge, SURROUNDED by another color blob

/**
 * Check if a blob touches the bottom and a side edge
 * Returns: { touchesBottom, touchesLeft, touchesRight, touchesBothEdges }
 */
function getBlobEdgeContact(blob, cols, rows) {
    if (!blob || blob.positions.length === 0) {
        return { touchesBottom: false, touchesLeft: false, touchesRight: false, touchesBothEdges: false };
    }
    
    let touchesBottom = false, touchesLeft = false, touchesRight = false;
    
    for (const [x, y] of blob.positions) {
        if (y === rows - 1) touchesBottom = true;
        if (x === 0) touchesLeft = true;
        if (x === cols - 1) touchesRight = true;
    }
    
    return {
        touchesBottom,
        touchesLeft,
        touchesRight,
        touchesBothEdges: touchesBottom && (touchesLeft || touchesRight)
    };
}

/**
 * Check if innerBlob is surrounded by outerBlob (for volcano/black hole detection)
 * Surrounded means: every cell adjacent to innerBlob (not part of innerBlob) is either:
 *   - Part of outerBlob, OR
 *   - Outside the board
 */
function isBlobSurrounded(innerBlob, outerBlob, cols, rows) {
    if (!innerBlob || !outerBlob || innerBlob.positions.length === 0) return false;
    
    const innerSet = new Set(innerBlob.positions.map(([x, y]) => `${x},${y}`));
    const outerSet = new Set(outerBlob.positions.map(([x, y]) => `${x},${y}`));
    
    for (const [x, y] of innerBlob.positions) {
        const neighbors = [[x-1, y], [x+1, y], [x, y-1], [x, y+1]];
        for (const [nx, ny] of neighbors) {
            // Skip if this neighbor is part of innerBlob
            if (innerSet.has(`${nx},${ny}`)) continue;
            
            // Skip if outside board (edges count as "surrounded")
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            
            // This neighbor must be part of outerBlob
            if (!outerSet.has(`${nx},${ny}`)) {
                return false;
            }
        }
    }
    
    return true;
}

/**
 * Find volcano potential in the board
 * Returns: { hasPotential, innerBlob, outerBlob, innerSize, progress }
 * Progress: 0-1 indicating how close to volcano (touching edges, surrounded %)
 */
function findVolcanoPotential(board, cols, rows) {
    const blobs = getAllBlobs(board, cols, rows);
    
    let bestPotential = { hasPotential: false, progress: 0, innerSize: 0 };
    
    for (const innerBlob of blobs) {
        const edgeContact = getBlobEdgeContact(innerBlob, cols, rows);
        
        // Must touch bottom + side edge for volcano
        if (!edgeContact.touchesBothEdges) continue;
        
        // Look for surrounding blob of different color
        for (const outerBlob of blobs) {
            if (outerBlob.color === innerBlob.color) continue;
            
            // Check if inner is surrounded by outer
            if (isBlobSurrounded(innerBlob, outerBlob, cols, rows)) {
                // Full volcano potential!
                const potential = {
                    hasPotential: true,
                    progress: 1.0,
                    innerBlob,
                    outerBlob,
                    innerSize: innerBlob.positions.length,
                    edgeType: edgeContact.touchesLeft ? 'left' : 'right'
                };
                if (potential.innerSize > bestPotential.innerSize) {
                    bestPotential = potential;
                }
            }
        }
        
        // Even if not fully surrounded, track progress toward volcano
        if (edgeContact.touchesBothEdges && innerBlob.positions.length >= 4) {
            // Partial progress - has edge contact, decent size
            const progress = 0.3 + (innerBlob.positions.length / 20) * 0.3;
            if (progress > bestPotential.progress && !bestPotential.hasPotential) {
                bestPotential = {
                    hasPotential: false,
                    progress: Math.min(0.6, progress),
                    innerSize: innerBlob.positions.length,
                    edgeType: edgeContact.touchesLeft ? 'left' : 'right'
                };
            }
        }
    }
    
    return bestPotential;
}

// ==================== PLACEMENT HELPERS ====================

function dropPiece(board, shape, x, cols, rows) {
    let y = 0;
    while (isValidPosition(board, shape, x, y + 1, cols, rows)) {
        y++;
    }
    return y;
}

function isValidPosition(board, shape, x, y, cols, rows) {
    for (let py = 0; py < shape.length; py++) {
        for (let px = 0; px < shape[py].length; px++) {
            if (!shape[py][px]) continue;
            
            const boardX = x + px;
            const boardY = y + py;
            
            if (boardX < 0 || boardX >= cols) return false;
            if (boardY >= rows) return false;
            if (boardY >= 0 && board[boardY] && board[boardY][boardX]) return false;
        }
    }
    return true;
}

function placePiece(board, shape, x, y, color) {
    const newBoard = board.map(row => row ? [...row] : new Array(board[0].length).fill(null));
    
    for (let py = 0; py < shape.length; py++) {
        for (let px = 0; px < shape[py].length; px++) {
            if (shape[py][px]) {
                const boardY = y + py;
                const boardX = x + px;
                if (boardY >= 0 && boardY < newBoard.length) {
                    newBoard[boardY][boardX] = color;
                }
            }
        }
    }
    
    return newBoard;
}

function countCompleteLines(board) {
    let count = 0;
    for (const row of board) {
        if (row && row.every(cell => cell !== null)) {
            count++;
        }
    }
    return count;
}

// ==================== HORIZONTAL CONNECTIVITY ANALYSIS ====================

/**
 * Analyze horizontal color runs in the board
 * Returns array of runs: { color, row, startX, endX, width, touchesLeft, touchesRight }
 */
function getHorizontalRuns(board, cols, rows) {
    const runs = [];
    
    for (let row = 0; row < rows; row++) {
        if (!board[row]) continue;
        
        let runStart = -1;
        let runColor = null;
        
        for (let x = 0; x <= cols; x++) {
            const cell = x < cols ? board[row][x] : null;
            
            if (cell === runColor && cell !== null) {
                // Continue current run
            } else {
                // End current run if exists
                if (runColor !== null && runStart >= 0) {
                    const width = x - runStart;
                    if (width >= 2) { // Only track runs of 2+
                        runs.push({
                            color: runColor,
                            row,
                            startX: runStart,
                            endX: x - 1,
                            width,
                            touchesLeft: runStart === 0,
                            touchesRight: x - 1 === cols - 1
                        });
                    }
                }
                // Start new run
                runStart = x;
                runColor = cell;
            }
        }
    }
    
    return runs;
}

/**
 * Find the best horizontal run for each color (widest, preferring edge-touching)
 */
function getBestRunsPerColor(runs) {
    const bestByColor = {};
    
    for (const run of runs) {
        const existing = bestByColor[run.color];
        if (!existing) {
            bestByColor[run.color] = run;
        } else {
            // Prefer wider runs, then edge-touching runs
            const existingScore = existing.width * 10 + (existing.touchesLeft ? 5 : 0) + (existing.touchesRight ? 5 : 0);
            const newScore = run.width * 10 + (run.touchesLeft ? 5 : 0) + (run.touchesRight ? 5 : 0);
            if (newScore > existingScore) {
                bestByColor[run.color] = run;
            }
        }
    }
    
    return bestByColor;
}

// ==================== SINGLE EVALUATION FUNCTION ====================

/**
 * Evaluate board and return detailed breakdown for analysis
 * Returns: { score, breakdown } where breakdown contains all individual factors
 */
function evaluateBoardWithBreakdown(board, shape, x, y, color, cols, rows) {
    const breakdown = {
        holes: { count: 0, penalty: 0 },
        height: { value: 0, penalty: 0 },
        bumpiness: { value: 0, penalty: 0 },
        wells: { count: 0, penalty: 0 },
        criticalHeight: { penalty: 0 },
        lineClears: { count: 0, bonus: 0 },
        tsunami: { potential: false, achievable: false, nearCompletion: false, width: 0, color: null, bonus: 0 },
        volcano: { potential: false, progress: 0, innerSize: 0, bonus: 0 },
        blob: { horizontalAdj: 0, verticalAdj: 0, bonus: 0 },
        runs: { bonus: 0 },
        edge: { bonus: 0 },
        queue: { matchingPieces: 0, bonus: 0 },
        classification: 'neutral' // 'defensive', 'offensive', 'opportunistic', 'survival'
    };
    
    let score = 0;
    
    const holes = countHoles(board);
    const stackHeight = getStackHeight(board, rows);
    const bumpiness = getBumpiness(board);
    const colHeights = getColumnHeights(board, cols, rows);
    
    breakdown.holes.count = holes;
    breakdown.height.value = stackHeight;
    breakdown.bumpiness.value = bumpiness;
    
    const isBreeze = currentSkillLevel === 'breeze';
    
    // ====== SPECIAL EVENT DETECTION ======
    const runs = getHorizontalRuns(board, cols, rows);
    const bestRuns = getBestRunsPerColor(runs);
    
    let hasTsunamiPotential = false;
    let tsunamiLikelyAchievable = false;
    let tsunamiNearCompletion = false;
    let bestTsunamiWidth = 0;
    let bestTsunamiColor = null;
    
    if (!isBreeze) {
        for (const runColor in bestRuns) {
            const run = bestRuns[runColor];
            const queueMatches = pieceQueue.filter(p => p && p.color === runColor).length;
            const effectiveThreshold = queueMatches >= 2 ? 5 : (queueMatches >= 1 ? 6 : 7);
            
            if (run.width >= effectiveThreshold) {
                hasTsunamiPotential = true;
                if (run.width > bestTsunamiWidth) {
                    bestTsunamiWidth = run.width;
                    bestTsunamiColor = runColor;
                }
            }
            
            if (run.width >= 9 || (run.width >= 8 && queueMatches >= 1) || (run.width >= 7 && queueMatches >= 2)) {
                tsunamiLikelyAchievable = true;
            }
            
            if (run.width >= 9 || (run.width >= 8 && queueMatches >= 2)) {
                tsunamiNearCompletion = true;
            }
        }
    }
    
    breakdown.tsunami.potential = hasTsunamiPotential;
    breakdown.tsunami.achievable = tsunamiLikelyAchievable;
    breakdown.tsunami.nearCompletion = tsunamiNearCompletion;
    breakdown.tsunami.width = bestTsunamiWidth;
    breakdown.tsunami.color = bestTsunamiColor;
    
    // Volcano detection
    let volcanoPotential = { hasPotential: false, progress: 0, innerSize: 0 };
    if (!isBreeze) {
        volcanoPotential = findVolcanoPotential(board, cols, rows);
    }
    breakdown.volcano.potential = volcanoPotential.hasPotential;
    breakdown.volcano.progress = volcanoPotential.progress;
    breakdown.volcano.innerSize = volcanoPotential.innerSize;
    
    const buildingSpecialEvent = tsunamiLikelyAchievable || volcanoPotential.hasPotential;
    
    // ====== HOLE PENALTIES - CASCADE AWARE ======
    if (buildingSpecialEvent) {
        breakdown.holes.penalty = holes * 1;
    } else if (hasTsunamiPotential || volcanoPotential.progress > 0.3) {
        breakdown.holes.penalty = holes * 3;
    } else if (holes <= 3) {
        breakdown.holes.penalty = holes * 5;
    } else if (holes <= 6) {
        breakdown.holes.penalty = 15 + (holes - 3) * 6;
    } else {
        breakdown.holes.penalty = 33 + (holes - 6) * 10;
    }
    score -= breakdown.holes.penalty;
    
    // ====== HEIGHT PENALTY ======
    if (buildingSpecialEvent && stackHeight < 17) {
        breakdown.height.penalty = stackHeight * 0.6;
    } else {
        breakdown.height.penalty = stackHeight * 1.0;
    }
    score -= breakdown.height.penalty;
    
    // ====== BUMPINESS ======
    if (buildingSpecialEvent) {
        breakdown.bumpiness.penalty = bumpiness * 0.3;
    } else {
        breakdown.bumpiness.penalty = bumpiness * 0.8;
    }
    score -= breakdown.bumpiness.penalty;
    
    // ====== DEEP WELLS ======
    let wellPenalty = 0;
    let wellCount = 0;
    for (let col = 0; col < cols; col++) {
        const leftHeight = col > 0 ? colHeights[col - 1] : colHeights[col];
        const rightHeight = col < cols - 1 ? colHeights[col + 1] : colHeights[col];
        const minNeighbor = Math.min(leftHeight, rightHeight);
        const wellDepth = minNeighbor - colHeights[col];
        if (wellDepth > 3) {
            wellPenalty += (wellDepth - 3) * 3;
            wellCount++;
        }
    }
    breakdown.wells.count = wellCount;
    breakdown.wells.penalty = wellPenalty;
    score -= wellPenalty;
    
    // ====== CRITICAL HEIGHT ======
    if (stackHeight >= 19) {
        breakdown.criticalHeight.penalty = 200;
        breakdown.classification = 'survival';
    } else if (stackHeight >= 17) {
        breakdown.criticalHeight.penalty = 60;
        breakdown.classification = 'defensive';
    } else if (stackHeight >= 15) {
        breakdown.criticalHeight.penalty = 15;
    }
    score -= breakdown.criticalHeight.penalty;
    
    // ====== LINE CLEARS ======
    let completeRows = 0;
    for (let row = 0; row < rows; row++) {
        if (board[row] && board[row].every(cell => cell !== null)) {
            completeRows++;
        }
    }
    breakdown.lineClears.count = completeRows;
    
    if (completeRows > 0) {
        if (stackHeight >= 18) {
            breakdown.lineClears.bonus = completeRows * 150;
            breakdown.classification = 'survival';
        } else if (stackHeight >= 16) {
            breakdown.lineClears.bonus = completeRows * 50;
        } else if (currentUfoActive) {
            breakdown.lineClears.bonus = -completeRows * 50;
        } else if (tsunamiNearCompletion) {
            breakdown.lineClears.bonus = -completeRows * 80;
        } else if (tsunamiLikelyAchievable) {
            breakdown.lineClears.bonus = -completeRows * 50;
        } else if (hasTsunamiPotential) {
            breakdown.lineClears.bonus = -completeRows * 25;
        } else if (volcanoPotential.hasPotential) {
            breakdown.lineClears.bonus = -completeRows * 40;
        } else {
            breakdown.lineClears.bonus = completeRows * 3;
        }
        score += breakdown.lineClears.bonus;
    }
    
    // ====== TSUNAMI BUILDING BONUS ======
    if (!isBreeze && hasTsunamiPotential && bestTsunamiColor && color === bestTsunamiColor) {
        const matchingInQueue = pieceQueue.filter(p => p && p.color === bestTsunamiColor).length;
        let tsunamiBonus = 15;
        
        if (bestTsunamiWidth >= 9) {
            tsunamiBonus += 50 + (bestTsunamiWidth - 9) * 30;
        } else if (bestTsunamiWidth >= 8) {
            tsunamiBonus += 25;
        } else if (bestTsunamiWidth >= 7) {
            tsunamiBonus += 10;
        }
        
        tsunamiBonus += matchingInQueue * 8;
        breakdown.tsunami.bonus = tsunamiBonus;
        score += breakdown.tsunami.bonus;
        
        if (!breakdown.classification || breakdown.classification === 'neutral') {
            breakdown.classification = 'offensive';
        }
    }
    
    // ====== VOLCANO BUILDING BONUS ======
    if (!isBreeze && volcanoPotential.hasPotential) {
        breakdown.volcano.bonus = 100 + volcanoPotential.innerSize * 10;
        score += breakdown.volcano.bonus;
        breakdown.classification = 'offensive';
    } else if (!isBreeze && volcanoPotential.progress > 0.3) {
        breakdown.volcano.bonus = volcanoPotential.progress * 30;
        score += breakdown.volcano.bonus;
    }
    
    // ====== BLOB BUILDING ======
    const canBuildBlobs = stackHeight <= 17 || buildingSpecialEvent;
    
    if (canBuildBlobs) {
        const runsAfter = getHorizontalRuns(board, cols, rows);
        
        let horizontalAdj = 0;
        let verticalAdj = 0;
        
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (!shape[py][px]) continue;
                const bx = x + px;
                const by = y + py;
                
                if (bx > 0 && board[by] && board[by][bx - 1] === color) {
                    let partOfPiece = px > 0 && shape[py][px - 1];
                    if (!partOfPiece) horizontalAdj++;
                }
                
                if (bx < cols - 1 && board[by] && board[by][bx + 1] === color) {
                    let partOfPiece = px < shape[py].length - 1 && shape[py][px + 1];
                    if (!partOfPiece) horizontalAdj++;
                }
                
                if (by > 0 && board[by - 1] && board[by - 1][bx] === color) {
                    let partOfPiece = py > 0 && shape[py - 1] && shape[py - 1][px];
                    if (!partOfPiece) verticalAdj++;
                }
                if (by < rows - 1 && board[by + 1] && board[by + 1][bx] === color) {
                    let partOfPiece = py < shape.length - 1 && shape[py + 1] && shape[py + 1][px];
                    if (!partOfPiece) verticalAdj++;
                }
            }
        }
        
        breakdown.blob.horizontalAdj = horizontalAdj;
        breakdown.blob.verticalAdj = verticalAdj;
        
        if (isBreeze) {
            breakdown.blob.bonus = horizontalAdj * 5 + verticalAdj * 5;
            for (const run of runsAfter) {
                if (run.width >= 3 && run.color === color) {
                    breakdown.blob.bonus += run.width * 3;
                }
            }
        } else {
            breakdown.blob.bonus = horizontalAdj * 8 + verticalAdj * 2;
            
            for (const run of runsAfter) {
                if (run.width >= 4) {
                    let runBonus = run.width * 3;
                    if (run.touchesLeft) runBonus += run.width * 2;
                    if (run.touchesRight) runBonus += run.width * 2;
                    if (run.touchesLeft && run.touchesRight) {
                        runBonus += 400 + run.width * 15;
                        breakdown.classification = 'opportunistic';
                    }
                    if (run.color === color) runBonus *= 1.5;
                    if (run.width >= 10) {
                        runBonus += (run.width - 9) * 40;
                    } else if (run.width >= 9) {
                        runBonus += 30;
                    } else if (run.width >= 8) {
                        runBonus += 15;
                    }
                    breakdown.runs.bonus += runBonus;
                }
            }
            
            const ourRuns = runsAfter.filter(r => r.color === color);
            for (const run of ourRuns) {
                if (run.width >= 4) {
                    let atRunEdge = false;
                    for (let py = 0; py < shape.length; py++) {
                        for (let px = 0; px < shape[py].length; px++) {
                            if (!shape[py][px]) continue;
                            const cellX = x + px;
                            const cellY = y + py;
                            if (cellY === run.row && (cellX === run.startX || cellX === run.endX)) {
                                atRunEdge = true;
                            }
                        }
                    }
                    
                    if (atRunEdge) {
                        breakdown.edge.bonus += run.width * 5;
                    }
                }
            }
            
            const ourBestRun = bestRuns[color];
            if (ourBestRun && ourBestRun.width >= 5) {
                const pieceMinX = x;
                const pieceMaxX = x + (shape[0] ? shape[0].length - 1 : 0);
                
                if (ourBestRun.touchesLeft && !ourBestRun.touchesRight && pieceMaxX >= ourBestRun.endX) {
                    breakdown.edge.bonus += 25 + (ourBestRun.width * 3);
                } else if (ourBestRun.touchesRight && !ourBestRun.touchesLeft && pieceMinX <= ourBestRun.startX) {
                    breakdown.edge.bonus += 25 + (ourBestRun.width * 3);
                } else if (!ourBestRun.touchesLeft && !ourBestRun.touchesRight) {
                    if (pieceMinX <= ourBestRun.startX || pieceMaxX >= ourBestRun.endX) {
                        breakdown.edge.bonus += 15 + ourBestRun.width;
                    }
                }
                
                const queueMatches = pieceQueue.filter(p => p && p.color === color).length;
                breakdown.queue.matchingPieces = queueMatches;
                if (queueMatches >= 3) {
                    breakdown.queue.bonus = ourBestRun.width * 6;
                } else if (queueMatches >= 2) {
                    breakdown.queue.bonus = ourBestRun.width * 4;
                } else if (queueMatches >= 1) {
                    breakdown.queue.bonus = ourBestRun.width * 2;
                }
            }
        }
        
        score += breakdown.blob.bonus;
        score += breakdown.runs.bonus;
        score += breakdown.edge.bonus;
        score += breakdown.queue.bonus;
    }
    
    // Set default classification
    if (!breakdown.classification || breakdown.classification === 'neutral') {
        if (breakdown.blob.bonus > 20 || breakdown.runs.bonus > 30 || breakdown.volcano.bonus > 0) {
            breakdown.classification = 'offensive';
        } else if (breakdown.holes.penalty > 20 || breakdown.height.penalty > 15) {
            breakdown.classification = 'defensive';
        } else {
            breakdown.classification = 'neutral';
        }
    }
    
    return { score, breakdown };
}

function evaluateBoard(board, shape, x, y, color, cols, rows) {
    let score = 0;
    
    const holes = countHoles(board);
    const stackHeight = getStackHeight(board, rows);
    const bumpiness = getBumpiness(board);
    const colHeights = getColumnHeights(board, cols, rows);
    
    const isBreeze = currentSkillLevel === 'breeze';
    
    // ====== SPECIAL EVENT DETECTION ======
    const runs = getHorizontalRuns(board, cols, rows);
    const bestRuns = getBestRunsPerColor(runs);
    
    // Tsunami detection
    let hasTsunamiPotential = false;
    let tsunamiLikelyAchievable = false;
    let tsunamiNearCompletion = false;  // NEW: width >= 9
    let bestTsunamiWidth = 0;
    let bestTsunamiColor = null;
    
    if (!isBreeze) {
        for (const runColor in bestRuns) {
            const run = bestRuns[runColor];
            const queueMatches = pieceQueue.filter(p => p && p.color === runColor).length;
            // Lower threshold with queue support
            const effectiveThreshold = queueMatches >= 2 ? 5 : (queueMatches >= 1 ? 6 : 7);
            
            if (run.width >= effectiveThreshold) {
                hasTsunamiPotential = true;
                if (run.width > bestTsunamiWidth) {
                    bestTsunamiWidth = run.width;
                    bestTsunamiColor = runColor;
                }
            }
            
            // Achievable = high confidence we can complete
            if (run.width >= 9 || (run.width >= 8 && queueMatches >= 1) || (run.width >= 7 && queueMatches >= 2)) {
                tsunamiLikelyAchievable = true;
            }
            
            // Near completion = should be top priority
            if (run.width >= 9 || (run.width >= 8 && queueMatches >= 2)) {
                tsunamiNearCompletion = true;
            }
        }
    }
    
    // Volcano detection (non-Breeze only)
    let volcanoPotential = { hasPotential: false, progress: 0, innerSize: 0 };
    if (!isBreeze) {
        volcanoPotential = findVolcanoPotential(board, cols, rows);
    }
    
    // Combined "building special event" flag
    const buildingSpecialEvent = tsunamiLikelyAchievable || volcanoPotential.hasPotential;
    
    // ====== HOLE PENALTIES - CASCADE AWARE ======
    // Key insight: holes aren't as bad in this game because blob gravity can fill them
    // When building special events, holes are even less concerning
    
    if (buildingSpecialEvent) {
        // Very minimal penalty - special events will clear/rearrange the board
        score -= holes * 1;
    } else if (hasTsunamiPotential || volcanoPotential.progress > 0.3) {
        // Building toward something - moderate tolerance
        score -= holes * 3;
    } else if (holes <= 3) {
        score -= holes * 5;
    } else if (holes <= 6) {
        score -= 15 + (holes - 3) * 6;
    } else {
        score -= 33 + (holes - 6) * 10;
    }
    
    // ====== HEIGHT PENALTIES ======
    if (buildingSpecialEvent && stackHeight < 17) {
        // Relaxed height penalty when building specials
        score -= stackHeight * 0.6;
    } else {
        score -= stackHeight * 1.0;
    }
    
    // ====== BUMPINESS ======
    if (buildingSpecialEvent) {
        score -= bumpiness * 0.3;
    } else {
        score -= bumpiness * 0.8;
    }
    
    // ====== DEEP WELLS ======
    for (let col = 0; col < cols; col++) {
        const leftHeight = col > 0 ? colHeights[col - 1] : colHeights[col];
        const rightHeight = col < cols - 1 ? colHeights[col + 1] : colHeights[col];
        const minNeighbor = Math.min(leftHeight, rightHeight);
        const wellDepth = minNeighbor - colHeights[col];
        if (wellDepth > 3) {
            score -= (wellDepth - 3) * 3;
        }
    }
    
    // ====== CRITICAL HEIGHT ======
    if (stackHeight >= 19) {
        score -= 200;
    } else if (stackHeight >= 17) {
        score -= 60;
    } else if (stackHeight >= 15) {
        score -= 15;
    }
    
    // ====== LINE CLEARS - OFTEN BAD! ======
    let completeRows = 0;
    for (let row = 0; row < rows; row++) {
        if (board[row] && board[row].every(cell => cell !== null)) {
            completeRows++;
        }
    }
    
    if (completeRows > 0) {
        if (stackHeight >= 18) {
            // Critical emergency - must clear
            score += completeRows * 150;
        } else if (stackHeight >= 16) {
            // Dangerous - clearing is good
            score += completeRows * 50;
        } else if (currentUfoActive) {
            // UFO easter egg - avoid clears
            score -= completeRows * 50;
        } else if (tsunamiNearCompletion) {
            // STRONG penalty - we're about to complete a tsunami!
            // A 20-block tsunami = 1.6M points, don't throw it away for a line clear
            score -= completeRows * 80;
        } else if (tsunamiLikelyAchievable) {
            // Significant penalty - we have a good tsunami in progress
            score -= completeRows * 50;
        } else if (hasTsunamiPotential) {
            // Moderate penalty - building toward tsunami
            score -= completeRows * 25;
        } else if (volcanoPotential.hasPotential) {
            // Penalty - don't disrupt volcano
            score -= completeRows * 40;
        } else {
            // No special event building - small bonus for clearing
            score += completeRows * 3;
        }
    }
    
    // ====== TSUNAMI BUILDING BONUSES ======
    if (!isBreeze && hasTsunamiPotential && bestTsunamiColor && color === bestTsunamiColor) {
        const matchingInQueue = pieceQueue.filter(p => p && p.color === bestTsunamiColor).length;
        
        // Base bonus for matching color
        let tsunamiBonus = 15;
        
        // Scale with width - exponential as we approach completion
        if (bestTsunamiWidth >= 9) {
            tsunamiBonus += 50 + (bestTsunamiWidth - 9) * 30;
        } else if (bestTsunamiWidth >= 8) {
            tsunamiBonus += 25;
        } else if (bestTsunamiWidth >= 7) {
            tsunamiBonus += 10;
        }
        
        // Queue support bonus
        tsunamiBonus += matchingInQueue * 8;
        
        score += tsunamiBonus;
    }
    
    // ====== VOLCANO BUILDING BONUSES ======
    if (!isBreeze && volcanoPotential.hasPotential) {
        // Full volcano ready - massive bonus
        score += 100 + volcanoPotential.innerSize * 10;
    } else if (!isBreeze && volcanoPotential.progress > 0.3) {
        // Building toward volcano
        score += volcanoPotential.progress * 30;
    }
    
    // ====== BLOB BUILDING ======
    // More relaxed conditions - build blobs even with holes (cascade will help)
    const canBuildBlobs = stackHeight <= 17 || buildingSpecialEvent;
    
    if (canBuildBlobs) {
        const runsAfter = getHorizontalRuns(board, cols, rows);
        
        // Adjacency bonuses
        let horizontalAdj = 0;
        let verticalAdj = 0;
        
        for (let py = 0; py < shape.length; py++) {
            for (let px = 0; px < shape[py].length; px++) {
                if (!shape[py][px]) continue;
                const bx = x + px;
                const by = y + py;
                
                // Left neighbor
                if (bx > 0 && board[by] && board[by][bx - 1] === color) {
                    let partOfPiece = px > 0 && shape[py][px - 1];
                    if (!partOfPiece) horizontalAdj++;
                }
                
                // Right neighbor
                if (bx < cols - 1 && board[by] && board[by][bx + 1] === color) {
                    let partOfPiece = px < shape[py].length - 1 && shape[py][px + 1];
                    if (!partOfPiece) horizontalAdj++;
                }
                
                // Top neighbor
                if (by > 0 && board[by - 1] && board[by - 1][bx] === color) {
                    let partOfPiece = py > 0 && shape[py - 1] && shape[py - 1][px];
                    if (!partOfPiece) verticalAdj++;
                }
                
                // Bottom neighbor
                if (by < rows - 1 && board[by + 1] && board[by + 1][bx] === color) {
                    let partOfPiece = py < shape.length - 1 && shape[py + 1] && shape[py + 1][px];
                    if (!partOfPiece) verticalAdj++;
                }
            }
        }
        
        if (isBreeze) {
            // Breeze: all adjacency equal for blob size
            score += horizontalAdj * 5;
            score += verticalAdj * 5;
            
            for (const run of runsAfter) {
                if (run.width >= 3 && run.color === color) {
                    score += run.width * 3;
                }
            }
        } else {
            // Non-Breeze: Horizontal adjacency worth more (tsunami building)
            score += horizontalAdj * 8;  // Increased from 6
            score += verticalAdj * 2;
        
            // Wide horizontal run bonuses
            for (const run of runsAfter) {
                if (run.width >= 4) {
                    let runBonus = run.width * 3;  // Increased from 2
                    
                    // Edge bonuses
                    if (run.touchesLeft) runBonus += run.width * 2;
                    if (run.touchesRight) runBonus += run.width * 2;
                    if (run.touchesLeft && run.touchesRight) {
                        // FULL SPAN = TSUNAMI!
                        runBonus += 400 + run.width * 15;
                    }
                    
                    // Same color bonus
                    if (run.color === color) {
                        runBonus *= 1.5;
                    }
                    
                    // Near-completion bonuses
                    if (run.width >= 10) {
                        runBonus += (run.width - 9) * 40;
                    } else if (run.width >= 9) {
                        runBonus += 30;
                    } else if (run.width >= 8) {
                        runBonus += 15;
                    }
                    
                    score += runBonus;
                }
            }
            
            // Edge extension bonuses
            const ourRuns = runsAfter.filter(r => r.color === color);
            for (const run of ourRuns) {
                if (run.width >= 4) {
                    let atRunEdge = false;
                    for (let py = 0; py < shape.length; py++) {
                        for (let px = 0; px < shape[py].length; px++) {
                            if (!shape[py][px]) continue;
                            const cellX = x + px;
                            const cellY = y + py;
                            if (cellY === run.row && (cellX === run.startX || cellX === run.endX)) {
                                atRunEdge = true;
                            }
                        }
                    }
                    
                    if (atRunEdge) {
                        score += run.width * 5;  // Increased from 4
                    }
                }
            }
            
            // Strategic edge placement
            const pieceMinX = x;
            const pieceMaxX = x + (shape[0] ? shape[0].length - 1 : 0);
            
            const ourBestRun = bestRuns[color];
            if (ourBestRun && ourBestRun.width >= 5) {
                // Reward extending toward missing edge
                if (ourBestRun.touchesLeft && !ourBestRun.touchesRight && pieceMaxX >= ourBestRun.endX) {
                    score += 25 + (ourBestRun.width * 3);
                } else if (ourBestRun.touchesRight && !ourBestRun.touchesLeft && pieceMinX <= ourBestRun.startX) {
                    score += 25 + (ourBestRun.width * 3);
                } else if (!ourBestRun.touchesLeft && !ourBestRun.touchesRight) {
                    if (pieceMinX <= ourBestRun.startX || pieceMaxX >= ourBestRun.endX) {
                        score += 15 + ourBestRun.width;
                    }
                }
            }
            
            // Queue awareness
            if (ourBestRun && ourBestRun.width >= 5) {
                const queueMatches = pieceQueue.filter(p => p && p.color === color).length;
                if (queueMatches >= 3) {
                    score += ourBestRun.width * 6;
                } else if (queueMatches >= 2) {
                    score += ourBestRun.width * 4;
                } else if (queueMatches >= 1) {
                    score += ourBestRun.width * 2;
                }
            }
            
            // Volcano-building: reward bottom-edge + side-edge placements
            const pieceMinY = y;
            const pieceMaxY = y + shape.length - 1;
            
            // If piece touches bottom
            if (pieceMaxY === rows - 1) {
                // And touches a side edge
                if (pieceMinX === 0 || pieceMaxX === cols - 1) {
                    // This is good for volcano potential
                    score += 10;
                    
                    // Extra bonus if we're already building a volcano
                    if (volcanoPotential.progress > 0.2) {
                        score += 15;
                    }
                }
            }
        }
    }
    
    return score;
}

// ==================== PLACEMENT GENERATION ====================

function generatePlacements(board, piece, cols, rows, captureBreakdown = false) {
    const placements = [];
    const shape = piece.shape;
    const rotations = piece.rotations || [shape];
    
    for (let rotationIndex = 0; rotationIndex < rotations.length; rotationIndex++) {
        const rotatedShape = rotations[rotationIndex];
        const pieceWidth = rotatedShape[0].length;
        
        for (let x = 0; x <= cols - pieceWidth; x++) {
            const y = dropPiece(board, rotatedShape, x, cols, rows);
            
            if (!isValidPosition(board, rotatedShape, x, y, cols, rows)) continue;
            
            // Game over check
            if (y < 0) {
                placements.push({ x, y, rotationIndex, shape: rotatedShape, score: -10000 });
                continue;
            }
            
            const newBoard = placePiece(board, rotatedShape, x, y, piece.color);
            
            if (captureBreakdown) {
                const { score, breakdown } = evaluateBoardWithBreakdown(newBoard, rotatedShape, x, y, piece.color, cols, rows);
                placements.push({ x, y, rotationIndex, shape: rotatedShape, score, breakdown });
            } else {
                const score = evaluateBoard(newBoard, rotatedShape, x, y, piece.color, cols, rows);
                placements.push({ x, y, rotationIndex, shape: rotatedShape, score });
            }
        }
    }
    
    return placements;
}

function findBestPlacement(board, piece, cols, rows, queue, captureDecisionMeta = false) {
    // Use breakdown capture for decision metadata
    const placements = generatePlacements(board, piece, cols, rows, captureDecisionMeta);
    
    if (placements.length === 0) {
        return captureDecisionMeta ? { placement: null, decisionMeta: null } : null;
    }
    
    let bestPlacement;
    
    // Use queue for 4-ply lookahead (current + 3 next pieces)
    // All 4 queue pieces are still considered for tsunami potential in evaluateBoard
    const nextPiece = queue && queue.length > 0 ? queue[0] : null;
    const thirdPiece = queue && queue.length > 1 ? queue[1] : null;
    const fourthPiece = queue && queue.length > 2 ? queue[2] : null;
    
    if (nextPiece) {
        // 4-ply lookahead: consider where next pieces can go
        for (const placement of placements) {
            const newBoard = placePiece(board, placement.shape, placement.x, placement.y, piece.color);
            const nextPlacements = generatePlacements(newBoard, nextPiece, cols, rows);
            
            if (nextPlacements.length > 0) {
                // Get top 5 next placements to limit computation
                const topNext = nextPlacements.sort((a, b) => b.score - a.score).slice(0, 5);
                
                let bestNextScore = -Infinity;
                
                for (const nextPlacement of topNext) {
                    let nextScore = nextPlacement.score;
                    
                    // 3-ply: look at third piece
                    if (thirdPiece) {
                        const nextBoard = placePiece(newBoard, nextPlacement.shape, nextPlacement.x, nextPlacement.y, nextPiece.color);
                        const thirdPlacements = generatePlacements(nextBoard, thirdPiece, cols, rows);
                        
                        if (thirdPlacements.length > 0) {
                            // Get top 4 third placements
                            const topThird = thirdPlacements.sort((a, b) => b.score - a.score).slice(0, 4);
                            let bestThirdScore = -Infinity;
                            
                            for (const thirdPlacement of topThird) {
                                let thirdScore = thirdPlacement.score;
                                
                                // 4-ply: look at fourth piece
                                if (fourthPiece) {
                                    const thirdBoard = placePiece(nextBoard, thirdPlacement.shape, thirdPlacement.x, thirdPlacement.y, thirdPiece.color);
                                    const fourthPlacements = generatePlacements(thirdBoard, fourthPiece, cols, rows);
                                    
                                    if (fourthPlacements.length > 0) {
                                        const bestFourth = fourthPlacements.reduce((a, b) => a.score > b.score ? a : b);
                                        thirdScore += bestFourth.score * 0.25; // 4th piece counts 25%
                                    }
                                }
                                
                                if (thirdScore > bestThirdScore) {
                                    bestThirdScore = thirdScore;
                                }
                            }
                            nextScore += bestThirdScore * 0.35; // 3rd piece counts 35%
                        }
                    }
                    
                    if (nextScore > bestNextScore) {
                        bestNextScore = nextScore;
                    }
                }
                
                // Combined score: current + 50% of best future
                placement.combinedScore = placement.score + bestNextScore * 0.5;
            } else {
                // Can't place next piece = bad
                placement.combinedScore = placement.score - 100;
            }
        }
        
        bestPlacement = placements.reduce((a, b) => 
            (a.combinedScore || a.score) > (b.combinedScore || b.score) ? a : b
        );
    } else {
        // No queue, just pick best immediate score
        bestPlacement = placements.reduce((a, b) => a.score > b.score ? a : b);
    }
    
    // Record decision
    const stackHeight = getStackHeight(board, rows);
    if (gameRecording.startTime) {
        recordDecision(board, piece, placements, bestPlacement, stackHeight);
    }
    
    // Build decision metadata if requested
    if (captureDecisionMeta) {
        const sortedPlacements = [...placements].sort((a, b) => 
            (b.combinedScore || b.score) - (a.combinedScore || a.score)
        );
        
        const secondBest = sortedPlacements.length > 1 ? sortedPlacements[1] : null;
        const scoreDifferential = secondBest ? 
            (bestPlacement.combinedScore || bestPlacement.score) - (secondBest.combinedScore || secondBest.score) : null;
        
        // Get board metrics
        const holes = countHoles(board);
        const bumpiness = getBumpiness(board);
        
        const decisionMeta = {
            chosen: {
                x: bestPlacement.x,
                y: bestPlacement.y,
                rotation: bestPlacement.rotationIndex,
                immediateScore: Math.round(bestPlacement.score * 100) / 100,
                combinedScore: bestPlacement.combinedScore ? Math.round(bestPlacement.combinedScore * 100) / 100 : null,
                breakdown: bestPlacement.breakdown || null,
                classification: bestPlacement.breakdown?.classification || 'unknown'
            },
            alternatives: sortedPlacements.slice(1, 4).map(p => ({
                x: p.x,
                y: p.y,
                rotation: p.rotationIndex,
                immediateScore: Math.round(p.score * 100) / 100,
                combinedScore: p.combinedScore ? Math.round(p.combinedScore * 100) / 100 : null,
                classification: p.breakdown?.classification || 'unknown'
            })),
            scoreDifferential: scoreDifferential ? Math.round(scoreDifferential * 100) / 100 : null,
            boardMetrics: {
                stackHeight,
                holes,
                bumpiness
            },
            lookahead: {
                depth: fourthPiece ? 4 : (thirdPiece ? 3 : (nextPiece ? 2 : 1)),
                queueColors: queue ? queue.map(p => p?.color || null) : []
            },
            candidatesEvaluated: placements.length,
            skillLevel: currentSkillLevel
        };
        
        return { placement: bestPlacement, decisionMeta };
    }
    
    return bestPlacement;
}

// ==================== MESSAGE HANDLER ====================

self.onmessage = function(e) {
    const { command, board, piece, queue, cols, rows, skillLevel, ufoActive, cause } = e.data;
    
    if (command === 'reset') {
        self.postMessage({ reset: true });
        return;
    }
    
    if (command === 'startRecording') {
        startRecording();
        gameRecording.skillLevel = skillLevel || currentSkillLevel;
        self.postMessage({ recordingStarted: true });
        return;
    }
    
    if (command === 'stopRecording') {
        if (board) {
            const recording = finalizeRecording(board, cause || 'manual_stop');
            self.postMessage({ recordingStopped: true, recording });
        } else {
            self.postMessage({ recordingStopped: true, recording: getRecording() });
        }
        return;
    }
    
    if (command === 'getRecording') {
        self.postMessage({ recording: getRecording() });
        return;
    }
    
    if (command === 'recordEvent') {
        recordEvent(e.data.eventType, e.data.eventData || {});
        return;
    }
    
    // Shadow evaluation - calculate what AI would do without recording or executing
    if (command === 'shadowEvaluate') {
        currentSkillLevel = skillLevel || 'tempest';
        pieceQueue = queue || [];
        currentUfoActive = ufoActive || false;
        
        setTimeout(() => {
            const result = findBestPlacement(board, piece, cols, rows, pieceQueue, true);
            self.postMessage({ 
                shadowResponse: true,
                decisionMeta: result ? result.decisionMeta : null
            });
        }, 0);
        return;
    }
    
    currentSkillLevel = skillLevel || 'tempest';
    pieceQueue = queue || [];
    currentUfoActive = ufoActive || false;
    
    // Check if decision metadata is requested
    const captureDecisionMeta = e.data.captureDecisionMeta || false;
    
    setTimeout(() => {
        const result = findBestPlacement(board, piece, cols, rows, pieceQueue, captureDecisionMeta);
        const stackHeight = getStackHeight(board, rows);
        
        if (captureDecisionMeta && result) {
            self.postMessage({ 
                bestPlacement: result.placement, 
                stackHeight,
                decisionMeta: result.decisionMeta
            });
        } else {
            self.postMessage({ bestPlacement: result, stackHeight });
        }
    }, 0);
};

// Send ready message immediately when worker loads
self.postMessage({ ready: true, version: AI_VERSION });
