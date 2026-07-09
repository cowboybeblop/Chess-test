/* =========================================================
   Constantes
   ========================================================= */
const PIECE_GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CLASS_META = {
  brilliant: { label: 'Brillant', symbol: '★', color: '#1baaa6' },
  great: { label: 'Excellent coup', symbol: '!', color: '#4e94e0' },
  best: { label: 'Meilleur coup', symbol: '✓', color: '#3aab53' },
  excellent: { label: 'Excellent', symbol: '✓', color: '#6fbf73' },
  good: { label: 'Bon coup', symbol: '●', color: '#8fae4a' },
  book: { label: 'Théorie', symbol: '📖', color: '#a58358' },
  inaccuracy: { label: 'Imprécision', symbol: '?!', color: '#e0b23a' },
  mistake: { label: 'Erreur', symbol: '?', color: '#e0813a' },
  blunder: { label: 'Gaffe', symbol: '??', color: '#d64545' },
  miss: { label: 'Occasion manquée', symbol: '✗', color: '#c0392b' },
};
const DRAW_COLORS = ['#c9a24a', '#4e94e0', '#d64545', '#3aab53', '#9b59b6', '#e8e6df'];

function evalValue(entry) {
  if (!entry) return 0;
  if (entry.mate !== null && entry.mate !== undefined) {
    const sign = entry.mate > 0 ? 1 : -1;
    return sign * (100000 - Math.abs(entry.mate) * 100);
  }
  return entry.cp || 0;
}
function uciOfMove(move, promoType) {
  let s = sq(move.from.x, move.from.y) + sq(move.to.x, move.to.y);
  if (move.promotion) s += (promoType || 'q');
  return s;
}
function algToXY(s) { return { x: 'abcdefgh'.indexOf(s[0]), y: 8 - parseInt(s[1], 10) }; }
function isLikelySacrifice(prevState, newBoard, move, moverColor) {
  const piece = prevState.board[move.from.y][move.from.x];
  if (!piece || piece.type === 'p' || piece.type === 'k') return false;
  const enemy = moverColor === 'w' ? 'b' : 'w';
  const captured = move.capture ? (prevState.board[move.to.y][move.to.x] || { type: 'p' }) : null;
  const gained = captured ? (PIECE_VALUE[captured.type] || 0) : 0;
  const risked = PIECE_VALUE[piece.type] || 0;
  if (!isSquareAttacked(newBoard, move.to.x, move.to.y, enemy)) return false;
  return (risked - gained) >= 2;
}
function accuracyFromACPL(acpl) {
  const a = 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

/* =========================================================
   API chess.com : profil, archives, liste de parties, PGN
   ========================================================= */
function parsePGNHeaders(pgn) {
  const headers = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}
async function apiGet(url) {
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    throw new Error('CORS_OR_NETWORK');
  }
  if (resp.status === 404) throw new Error('NOT_FOUND');
  if (!resp.ok) throw new Error('Erreur API chess.com : ' + resp.status);
  return resp.json();
}
async function checkPlayerExists(username) {
  await apiGet(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`);
  return true;
}
async function fetchRecentGames(username, maxGames) {
  const archivesData = await apiGet(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
  const archives = (archivesData.archives || []).slice(-4).reverse(); // mois les plus récents d'abord
  let collected = [];
  for (const url of archives) {
    if (collected.length >= maxGames) break;
    let data;
    try {
      data = await apiGet(url);
    } catch (e) {
      continue;
    }
    const games = (data.games || []).filter((g) => g.pgn);
    collected = collected.concat(games);
  }
  collected.sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
  return collected.slice(0, maxGames);
}

/* =========================================================
   Analyse par lot — capture aussi le coup joué et le meilleur
   coup du moteur (pour les flèches de la revue en direct)
   ========================================================= */
async function analyzeGame(engine, plies, depth, onProgress) {
  const records = [];
  for (let i = 1; i < plies.length; i++) {
    const prevFen = plies[i - 1].fen;
    const curFen = plies[i].fen;
    const prevState = fenToState(prevFen);
    const mover = prevState.turn;
    const parsed = parseSanToken(prevState, plies[i].sanRaw || plies[i].san);
    const before = await engine.analyze(prevFen, { depth, multipv: 2, limitStrength: false });
    const after = await engine.analyze(curFen, { depth, multipv: 1, limitStrength: false });

    const bestLine = before.lines[1];
    const secondLine = before.lines[2];
    const evalBeforeMover = evalValue(bestLine);
    const evalAfterOpp = evalValue(after.lines[1]);
    const evalAfterMover = -evalAfterOpp;
    let lossCp = evalBeforeMover - evalAfterMover;
    if (lossCp < 0) lossCp = 0;

    let cls = 'good';
    let playedMove = null;
    let bestMove = null;
    if (parsed) {
      playedMove = { from: parsed.move.from, to: parsed.move.to };
      if (before.bestMoveUci) {
        bestMove = { from: algToXY(before.bestMoveUci.slice(0, 2)), to: algToXY(before.bestMoveUci.slice(2, 4)) };
      }
      const playedUci = uciOfMove(parsed.move, parsed.promo);
      const bestUci = before.bestMoveUci;
      const matchesBest = playedUci === bestUci;
      const gapToSecond = secondLine ? (evalValue(bestLine) - evalValue(secondLine)) : null;
      const nextForSac = applyMove(prevState, parsed.move, parsed.promo);
      const sac = isLikelySacrifice(prevState, nextForSac.board, parsed.move, mover);

      if (i <= 6 && lossCp <= 15) cls = 'book';
      else if (matchesBest || lossCp <= 4) {
        if (sac && evalBeforeMover >= 100) cls = 'brilliant';
        else if (gapToSecond !== null && gapToSecond >= 150) cls = 'great';
        else cls = 'best';
      } else if (lossCp <= 20) cls = 'excellent';
      else if (lossCp <= 50) cls = 'good';
      else if (lossCp <= 100) cls = 'inaccuracy';
      else if (lossCp <= 200) cls = 'mistake';
      else cls = 'blunder';

      if (evalBeforeMover >= 300 && evalAfterMover < 150 && !['best', 'great', 'brilliant'].includes(cls)) cls = 'miss';
    }

    records.push({ ply: i, color: mover, san: plies[i].san, cls, lossCp, fen: curFen, playedMove, bestMove });
    if (onProgress) onProgress(i, plies.length - 1);
  }
  return records;
}

/* =========================================================
   DOM refs
   ========================================================= */
const usernameInput = document.getElementById('usernameInput');
const btnSearch = document.getElementById('btnSearch');
const gamesListCard = document.getElementById('gamesListCard');
const gamesListEl = document.getElementById('gamesList');
const pgnTextarea = document.getElementById('pgnTextarea');
const btnAnalyzePaste = document.getElementById('btnAnalyzePaste');
const depthSelect = document.getElementById('depthSelect');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const boardGrid = document.getElementById('boardGrid');
const arrowSvg = document.getElementById('arrowSvg');
const summaryEl = document.getElementById('summary');
const moveListEl = document.getElementById('moveList');
const engineWarningEl = document.getElementById('engineWarning');
const moveInfoEl = document.getElementById('moveInfo');
const btnStart = document.getElementById('btnStart');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnEnd = document.getElementById('btnEnd');
const btnDrawMode = document.getElementById('btnDrawMode');
const btnClearDraw = document.getElementById('btnClearDraw');
const drawPalette = document.getElementById('drawPalette');

let engine = null;
function getEngine() {
  if (!engine) engine = new Engine('stockfish-18-lite-single.js');
  return engine;
}

const STATE_META = {
  checking: { icon: '🔍', cls: 'loading' },
  loading: { icon: '⏳', cls: 'loading' },
  analyzing: { icon: '⏳', cls: 'loading' },
  'fetch-ok': { icon: '✅', cls: 'success' },
  done: { icon: '✅', cls: 'success' },
  'not-found': { icon: '❌', cls: 'notfound' },
  'cors-error': { icon: '🚫', cls: 'error' },
  error: { icon: '⚠', cls: 'error' },
  'idle-error': { icon: '⚠', cls: 'error' },
};
function setState(state, text) {
  const meta = STATE_META[state] || { icon: '', cls: '' };
  const spinClass = meta.cls === 'loading' ? ' spin' : '';
  statusEl.innerHTML = (meta.icon ? `<span class="status-icon${spinClass}">${meta.icon}</span> ` : '') + text;
  statusEl.className = 'status' + (meta.cls ? ' ' + meta.cls : '');
}
function setStatus(text, isError) {
  setState(isError ? 'error' : 'analyzing', text);
}

const savedUsername = localStorage.getItem('chesscomUsername');
if (savedUsername) usernameInput.value = savedUsername;

/* =========================================================
   1. Recherche du joueur + liste des parties
   ========================================================= */
btnSearch.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) { setState('idle-error', 'Entre ton pseudo chess.com.'); return; }
  localStorage.setItem('chesscomUsername', username);

  btnSearch.disabled = true;
  const originalLabel = btnSearch.textContent;
  btnSearch.textContent = 'Recherche…';
  gamesListCard.classList.add('hidden');
  resultsEl.classList.add('hidden');

  setState('checking', `Vérification du pseudo "${username}"…`);
  try {
    await checkPlayerExists(username);
  } catch (e) {
    btnSearch.disabled = false;
    btnSearch.textContent = originalLabel;
    if (e.message === 'NOT_FOUND') setState('not-found', `Joueur "${username}" introuvable — vérifie l'orthographe.`);
    else if (e.message === 'CORS_OR_NETWORK') setState('cors-error', "Récupération bloquée (CORS selon le navigateur). Colle le PGN manuellement ci-dessous.");
    else setState('error', e.message);
    return;
  }

  setState('loading', 'Pseudo trouvé — récupération des parties récentes…');
  try {
    const games = await fetchRecentGames(username, 20);
    btnSearch.disabled = false;
    btnSearch.textContent = originalLabel;
    if (games.length === 0) {
      setState('not-found', `Aucune partie trouvée pour "${username}" sur les derniers mois.`);
      return;
    }
    setState('fetch-ok', `${games.length} parties trouvées — choisis celle à étudier.`);
    renderGamesList(games, username);
  } catch (e) {
    btnSearch.disabled = false;
    btnSearch.textContent = originalLabel;
    if (e.message === 'CORS_OR_NETWORK') setState('cors-error', "Récupération bloquée (CORS selon le navigateur). Colle le PGN manuellement ci-dessous.");
    else setState('error', e.message);
  }
});

function renderGamesList(games, username) {
  gamesListCard.classList.remove('hidden');
  gamesListEl.innerHTML = '';
  const uname = username.toLowerCase();
  games.forEach((g) => {
    const headers = parsePGNHeaders(g.pgn);
    const isWhite = (headers.White || '').toLowerCase() === uname;
    const opponent = isWhite ? (headers.Black || '?') : (headers.White || '?');
    const result = headers.Result || '*';
    let outcome = 'Nulle', outcomeCls = 'draw';
    if (result === '1-0') { outcome = isWhite ? 'Victoire' : 'Défaite'; outcomeCls = isWhite ? 'win' : 'loss'; }
    else if (result === '0-1') { outcome = isWhite ? 'Défaite' : 'Victoire'; outcomeCls = isWhite ? 'loss' : 'win'; }
    const date = g.end_time ? new Date(g.end_time * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const timeClass = g.time_class || '';

    const item = document.createElement('div');
    item.className = 'game-item';
    item.innerHTML = `
      <div class="game-item-main">
        <span class="game-color-dot ${isWhite ? 'w' : 'b'}"></span>
        <span class="game-opponent">vs ${opponent}</span>
        <span class="outcome-badge ${outcomeCls}">${outcome}</span>
      </div>
      <div class="game-item-sub">${date} · ${timeClass}</div>
    `;
    item.addEventListener('click', () => {
      pgnTextarea.value = g.pgn;
      runAnalysis(g.pgn, username);
    });
    gamesListEl.appendChild(item);
  });
}

btnAnalyzePaste.addEventListener('click', async () => {
  const pgn = pgnTextarea.value.trim();
  if (!pgn) { setState('idle-error', 'Colle un PGN dans la zone de texte.'); return; }
  await runAnalysis(pgn, usernameInput.value.trim());
});

/* =========================================================
   2. Lancement de l'analyse
   ========================================================= */
let currentPlies = null;
let currentRecords = null;
let currentPly = 0; // 0 = position de départ

async function runAnalysis(pgn, username) {
  let plies, headers;
  try {
    headers = parsePGNHeaders(pgn);
    plies = replayPGN(pgn);
  } catch (e) {
    setState('error', 'Erreur de lecture du PGN : ' + e.message);
    return;
  }
  const depth = parseInt(depthSelect.value, 10);
  const totalMoves = plies.length - 1;
  setState('analyzing', `Analyse en cours (0 / ${totalMoves})…`);
  resultsEl.classList.add('hidden');

  const eng = getEngine();
  let records;
  try {
    records = await analyzeGame(eng, plies, depth, (done, total) => {
      setState('analyzing', `Analyse en cours (${done} / ${total})…`);
    });
  } catch (e) {
    setState('error', 'Erreur moteur : ' + e.message);
    return;
  }
  setState('done', `Terminé — ${headers.White || '?'} vs ${headers.Black || '?'} (${headers.Result || ''})`);
  currentPlies = plies;
  currentRecords = records;
  currentPly = records.length; // se place à la fin par défaut
  renderResults(records, headers, username);
}

/* =========================================================
   3. Résultats + revue en direct avec flèches
   ========================================================= */
function renderResults(records, headers, username) {
  resultsEl.classList.remove('hidden');
  buildBoardGrid();

  const uname = (username || '').toLowerCase();
  const whiteIsUser = (headers.White || '').toLowerCase() === uname;
  const blackIsUser = (headers.Black || '').toLowerCase() === uname;

  const byColor = { w: [], b: [] };
  records.forEach((r) => byColor[r.color].push(r));
  const acpl = (arr) => arr.length ? arr.reduce((s, r) => s + r.lossCp, 0) / arr.length : 0;
  const acplW = acpl(byColor.w), acplB = acpl(byColor.b);

  summaryEl.innerHTML = `
    <div class="side-summary"><b>${headers.White || 'Blancs'}</b>${whiteIsUser ? ' (toi)' : ''}<br>
      Précision ≈ ${accuracyFromACPL(acplW).toFixed(1)}%<br>ACPL ${acplW.toFixed(0)}</div>
    <div class="side-summary"><b>${headers.Black || 'Noirs'}</b>${blackIsUser ? ' (toi)' : ''}<br>
      Précision ≈ ${accuracyFromACPL(acplB).toFixed(1)}%<br>ACPL ${acplB.toFixed(0)}</div>
    <div class="acc-note">Approximation inspirée d'une formule publique (ACPL → précision), pas la formule exacte de Chess.com.</div>
  `;

  moveListEl.innerHTML = '';
  for (let i = 0; i < records.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = (i / 2 + 1) + '.';
    row.appendChild(num);
    row.appendChild(moveCell(records[i], i + 1));
    if (records[i + 1]) row.appendChild(moveCell(records[i + 1], i + 2));
    moveListEl.appendChild(row);
  }

  goToPly(records.length);
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function moveCell(rec, plyIndex) {
  const cell = document.createElement('span');
  cell.className = 'move-cell';
  cell.dataset.ply = plyIndex;
  cell.textContent = rec.san;
  const meta = CLASS_META[rec.cls];
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.style.color = meta.color;
  badge.textContent = meta.symbol;
  cell.appendChild(badge);
  cell.addEventListener('click', () => goToPly(plyIndex));
  return cell;
}

/* ---- Navigation ---- */
function goToPly(ply) {
  if (!currentPlies) return;
  currentPly = Math.max(0, Math.min(ply, currentRecords.length));
  resetManualArrowsSilently();
  renderPosition(currentPlies[currentPly].fen);
  renderAutoArrows();
  updateMoveInfo();
  moveListEl.querySelectorAll('.move-cell').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.ply, 10) === currentPly);
  });
  const activeEl = moveListEl.querySelector('.move-cell.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}
btnStart.addEventListener('click', () => goToPly(0));
btnPrev.addEventListener('click', () => goToPly(currentPly - 1));
btnNext.addEventListener('click', () => goToPly(currentPly + 1));
btnEnd.addEventListener('click', () => goToPly(currentRecords ? currentRecords.length : 0));

function updateMoveInfo() {
  if (!currentRecords) { moveInfoEl.innerHTML = ''; return; }
  if (currentPly === 0) { moveInfoEl.innerHTML = 'Position de départ'; return; }
  const rec = currentRecords[currentPly - 1];
  const meta = CLASS_META[rec.cls];
  const num = Math.ceil(currentPly / 2);
  const colorLabel = rec.color === 'w' ? 'Blancs' : 'Noirs';
  let html = `${num}. ${colorLabel} — <b>${rec.san}</b> <span style="color:${meta.color}">${meta.symbol} ${meta.label}</span>`;
  if (rec.lossCp > 4) html += ` <span class="loss-tag">(−${(rec.lossCp / 100).toFixed(2)})</span>`;
  if (rec.bestMove && rec.playedMove && (rec.bestMove.from.x !== rec.playedMove.from.x || rec.bestMove.from.y !== rec.playedMove.from.y || rec.bestMove.to.x !== rec.playedMove.to.x || rec.bestMove.to.y !== rec.playedMove.to.y)) {
    html += `<br><span class="best-tag">Suggestion du moteur en pointillés</span>`;
  }
  moveInfoEl.innerHTML = html;
}

/* =========================================================
   4. Plateau + flèches (auto : coup joué / meilleur coup —
      manuel : dessin libre façon annotation)
   ========================================================= */
function buildBoardGrid() {
  boardGrid.innerHTML = '';
  boardGrid.appendChild(arrowSvg);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const sqEl = document.createElement('div');
    sqEl.className = 'sq ' + ((x + y) % 2 === 1 ? 'dark' : 'light');
    sqEl.dataset.x = x; sqEl.dataset.y = y;
    boardGrid.appendChild(sqEl);
  }
}
function fenToBoardArray(fen) {
  return fen.split(' ')[0].split('/').map((row) => {
    const line = [];
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let i = 0; i < parseInt(ch, 10); i++) line.push(null); }
      else line.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
    }
    return line;
  });
}
function renderPosition(fen) {
  const board = fenToBoardArray(fen);
  boardGrid.querySelectorAll('.sq').forEach((sqEl) => {
    const x = parseInt(sqEl.dataset.x), y = parseInt(sqEl.dataset.y);
    sqEl.querySelectorAll('.piece').forEach((n) => n.remove());
    const p = board[y][x];
    if (p) {
      const pe = document.createElement('div');
      pe.className = 'piece ' + (p.color === 'w' ? 'white' : 'black');
      pe.textContent = PIECE_GLYPH[p.color][p.type];
      sqEl.appendChild(pe);
    }
  });
}

let manualArrows = [];
let drawMode = false;
let drawColor = DRAW_COLORS[0];
let dragStart = null;

function buildDrawPalette() {
  drawPalette.innerHTML = '';
  DRAW_COLORS.forEach((c) => {
    const sw = document.createElement('div');
    sw.className = 'draw-swatch' + (c === drawColor ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => { drawColor = c; buildDrawPalette(); });
    drawPalette.appendChild(sw);
  });
}
btnDrawMode.addEventListener('click', () => {
  drawMode = !drawMode;
  btnDrawMode.classList.toggle('active', drawMode);
  drawPalette.classList.toggle('hidden', !drawMode);
});
btnClearDraw.addEventListener('click', clearManualArrows);
function clearManualArrows() { manualArrows = []; renderAutoArrows(); }
function resetManualArrowsSilently() { manualArrows = []; }

function attachDrawEvents() {
  boardGrid.addEventListener('pointerdown', (e) => {
    if (!drawMode) return;
    const sqPos = getSquareFromEvent(e);
    if (sqPos) dragStart = sqPos;
  });
  window.addEventListener('pointerup', (e) => {
    if (!drawMode || !dragStart) return;
    const sqPos = getSquareFromEvent(e);
    if (sqPos && (sqPos.x !== dragStart.x || sqPos.y !== dragStart.y)) {
      const idx = manualArrows.findIndex((a) => a.from.x === dragStart.x && a.from.y === dragStart.y && a.to.x === sqPos.x && a.to.y === sqPos.y);
      if (idx >= 0) manualArrows.splice(idx, 1);
      else manualArrows.push({ from: dragStart, to: sqPos, color: drawColor });
      renderAutoArrows();
    }
    dragStart = null;
  });
}
function getSquareFromEvent(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = el ? el.closest('.sq') : null;
  if (!sqEl) return null;
  return { x: parseInt(sqEl.dataset.x), y: parseInt(sqEl.dataset.y) };
}

function renderAutoArrows() {
  const sqEl = boardGrid.querySelector('.sq');
  const sqSize = sqEl ? sqEl.getBoundingClientRect().width : 36;
  arrowSvg.setAttribute('width', sqSize * 8);
  arrowSvg.setAttribute('height', sqSize * 8);
  arrowSvg.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  arrowSvg.appendChild(defs);

  const drawOne = (from, to, color, dashed) => {
    const x1 = from.x * sqSize + sqSize / 2, y1 = from.y * sqSize + sqSize / 2;
    let x2 = to.x * sqSize + sqSize / 2, y2 = to.y * sqSize + sqSize / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const shorten = sqSize * 0.32;
    x2 -= Math.cos(angle) * shorten; y2 -= Math.sin(angle) * shorten;
    const markerId = 'ah-' + color.replace('#', '') + (dashed ? '-d' : '');
    if (!arrowSvg.querySelector('#' + markerId)) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '10'); marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '5'); marker.setAttribute('refY', '5'); marker.setAttribute('orient', 'auto');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0,0 L10,5 L0,10 Z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', sqSize * 0.13);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', 0.85);
    if (dashed) line.setAttribute('stroke-dasharray', (sqSize * 0.12) + ',' + (sqSize * 0.1));
    line.setAttribute('marker-end', `url(#${markerId})`);
    arrowSvg.appendChild(line);
  };

  if (currentRecords && currentPly < currentRecords.length) {
    const rec = currentRecords[currentPly];
    if (rec.playedMove) drawOne(rec.playedMove.from, rec.playedMove.to, '#c9a24a', false);
    if (rec.bestMove) {
      const same = rec.playedMove && rec.bestMove.from.x === rec.playedMove.from.x && rec.bestMove.from.y === rec.playedMove.from.y && rec.bestMove.to.x === rec.playedMove.to.x && rec.bestMove.to.y === rec.playedMove.to.y;
      if (!same) drawOne(rec.bestMove.from, rec.bestMove.to, '#1baaa6', true);
    }
  }
  manualArrows.forEach((a) => drawOne(a.from, a.to, a.color, false));
}

buildDrawPalette();
attachDrawEvents();

/* =========================================================
   Init moteur
   ========================================================= */
let engineLoaded = false;
engine = getEngine();
engine.readyPromise.then(() => { engineLoaded = true; });
setTimeout(() => {
  if (!engineLoaded && engineWarningEl) engineWarningEl.classList.remove('hidden');
}, 6000);
