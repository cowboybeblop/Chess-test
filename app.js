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
   PGN : récupération depuis l'API publique chess.com (best-effort,
   peut échouer à cause du CORS — voir le guide d'utilisation)
   ========================================================= */
function splitPGNGames(text) {
  return text.split(/\n(?=\[Event )/).map((s) => s.trim()).filter(Boolean);
}
function parsePGNHeaders(pgn) {
  const headers = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}
async function checkPlayerExists(username) {
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    throw new Error('CORS_OR_NETWORK');
  }
  if (resp.status === 404) throw new Error('PLAYER_NOT_FOUND');
  if (!resp.ok) throw new Error('Erreur API chess.com : ' + resp.status);
  return true;
}
async function fetchLastGamePGN(username) {
  await checkPlayerExists(username);
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const url = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/${yyyy}/${mm}/pgn`;
    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      throw new Error('CORS_OR_NETWORK');
    }
    if (resp.status === 404) continue;
    if (!resp.ok) throw new Error('Erreur API chess.com : ' + resp.status);
    const text = await resp.text();
    const games = splitPGNGames(text);
    if (games.length > 0) return games[games.length - 1];
  }
  throw new Error('NO_RECENT_GAMES');
}

/* =========================================================
   Analyse par lot
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
    if (parsed) {
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

    records.push({ ply: i, color: mover, san: plies[i].san, cls, lossCp, fen: curFen });
    if (onProgress) onProgress(i, plies.length - 1);
  }
  return records;
}

/* =========================================================
   UI
   ========================================================= */
const usernameInput = document.getElementById('usernameInput');
const btnFetch = document.getElementById('btnFetch');
const pgnTextarea = document.getElementById('pgnTextarea');
const btnAnalyzePaste = document.getElementById('btnAnalyzePaste');
const depthSelect = document.getElementById('depthSelect');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const boardGrid = document.getElementById('boardGrid');
const summaryEl = document.getElementById('summary');
const moveListEl = document.getElementById('moveList');
const engineWarningEl = document.getElementById('engineWarning');

let engine = null;
function getEngine() {
  if (!engine) engine = new Engine('stockfish-18-lite-single.js');
  return engine;
}

const savedUsername = localStorage.getItem('chesscomUsername');
if (savedUsername) usernameInput.value = savedUsername;

btnFetch.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) { setState('idle-error', 'Entre ton pseudo chess.com.'); return; }
  localStorage.setItem('chesscomUsername', username);

  btnFetch.disabled = true;
  const originalLabel = btnFetch.textContent;
  btnFetch.textContent = 'Recherche…';
  resultsEl.classList.add('hidden');

  setState('checking', `Vérification du pseudo "${username}"…`);
  try {
    await checkPlayerExists(username);
  } catch (e) {
    btnFetch.disabled = false;
    btnFetch.textContent = originalLabel;
    if (e.message === 'PLAYER_NOT_FOUND') {
      setState('not-found', `Joueur "${username}" introuvable sur chess.com — vérifie l'orthographe du pseudo.`);
    } else if (e.message === 'CORS_OR_NETWORK') {
      setState('cors-error', "La récupération auto a été bloquée (CORS, ça arrive selon le navigateur). Colle le PGN manuellement ci-dessus.");
    } else {
      setState('error', e.message);
    }
    return;
  }

  setState('loading', `Pseudo trouvé — récupération de la dernière partie…`);
  try {
    const pgn = await fetchLastGamePGN(username);
    setState('fetch-ok', 'Partie récupérée — lancement de l\'analyse…');
    pgnTextarea.value = pgn;
    btnFetch.disabled = false;
    btnFetch.textContent = originalLabel;
    await runAnalysis(pgn, username);
  } catch (e) {
    btnFetch.disabled = false;
    btnFetch.textContent = originalLabel;
    if (e.message === 'NO_RECENT_GAMES') {
      setState('not-found', `Aucune partie trouvée pour "${username}" sur les 3 derniers mois. Colle le PGN manuellement ci-dessus.`);
    } else if (e.message === 'CORS_OR_NETWORK') {
      setState('cors-error', "La récupération auto a été bloquée (CORS, ça arrive selon le navigateur). Colle le PGN manuellement ci-dessus.");
    } else {
      setState('error', e.message);
    }
  }
});
btnAnalyzePaste.addEventListener('click', async () => {
  const pgn = pgnTextarea.value.trim();
  if (!pgn) { setStatus('Colle un PGN dans la zone de texte.', true); return; }
  await runAnalysis(pgn, usernameInput.value.trim());
});

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

async function runAnalysis(pgn, username) {
  let plies, headers;
  try {
    headers = parsePGNHeaders(pgn);
    plies = replayPGN(pgn);
  } catch (e) {
    setStatus('Erreur de lecture du PGN : ' + e.message, true);
    return;
  }
  const depth = parseInt(depthSelect.value, 10);
  const totalMoves = plies.length - 1;
  setStatus(`Analyse en cours (0 / ${totalMoves})…`);
  resultsEl.classList.add('hidden');

  const eng = getEngine();
  let records;
  try {
    records = await analyzeGame(eng, plies, depth, (done, total) => {
      setStatus(`Analyse en cours (${done} / ${total})…`);
    });
  } catch (e) {
    setStatus('Erreur moteur : ' + e.message, true);
    return;
  }
  setStatus(`Terminé — ${headers.White || '?'} vs ${headers.Black || '?'} (${headers.Result || ''})`);
  renderResults(records, headers, username, plies[plies.length - 1].fen);
}

function renderResults(records, headers, username, finalFen) {
  resultsEl.classList.remove('hidden');
  buildBoardGrid();
  renderPosition(finalFen);

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
    row.appendChild(moveCell(records[i]));
    if (records[i + 1]) row.appendChild(moveCell(records[i + 1]));
    moveListEl.appendChild(row);
  }
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function moveCell(rec) {
  const cell = document.createElement('span');
  cell.className = 'move-cell';
  cell.textContent = rec.san;
  const meta = CLASS_META[rec.cls];
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.style.color = meta.color;
  badge.textContent = meta.symbol;
  badge.title = meta.label + ` (−${(rec.lossCp / 100).toFixed(2)})`;
  cell.appendChild(badge);
  cell.addEventListener('click', () => {
    renderPosition(rec.fen);
    boardGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return cell;
}
function buildBoardGrid() {
  boardGrid.innerHTML = '';
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

let engineLoaded = false;
engine = getEngine();
engine.readyPromise.then(() => { engineLoaded = true; });
setTimeout(() => {
  if (!engineLoaded && engineWarningEl) engineWarningEl.classList.remove('hidden');
}, 6000);
