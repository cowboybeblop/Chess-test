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
  great: { label: 'Excellent', symbol: '!', color: '#4e94e0' },
  best: { label: 'Meilleur coup', symbol: '✓', color: '#3aab53' },
  excellent: { label: 'Très bien', symbol: '✓', color: '#6fbf73' },
  good: { label: 'Bon coup', symbol: '●', color: '#8fae4a' },
  book: { label: 'Théorie', symbol: '📖', color: '#a58358' },
  forced: { label: 'Forcé', symbol: '→', color: '#8b9199' },
  inaccuracy: { label: 'Imprécision', symbol: '?!', color: '#e0b23a' },
  mistake: { label: 'Erreur', symbol: '?', color: '#e0813a' },
  blunder: { label: 'Gaffe', symbol: '??', color: '#d64545' },
  miss: { label: 'Coup manqué', symbol: '✗', color: '#c0392b' },
};
const DRAW_COLORS = ['#c9a24a', '#4e94e0', '#d64545', '#3aab53', '#9b59b6', '#e8e6df'];

// Table d'ancrage "% de points attendus perdus en moyenne" -> Elo estimé.
// Ordre de grandeur approximatif, pas une calibration scientifique — Chess.com
// calibre le sien avec des données propriétaires par tranche de rating.
const ELO_ANCHORS = [
  { epLossPct: 0.5, elo: 2800 }, { epLossPct: 1.5, elo: 2600 }, { epLossPct: 3, elo: 2400 },
  { epLossPct: 5, elo: 2200 }, { epLossPct: 7, elo: 2000 }, { epLossPct: 9, elo: 1800 },
  { epLossPct: 12, elo: 1600 }, { epLossPct: 15, elo: 1400 }, { epLossPct: 19, elo: 1200 },
  { epLossPct: 24, elo: 1000 }, { epLossPct: 30, elo: 800 }, { epLossPct: 40, elo: 600 },
];
function estimatedEloFromACPL(epLossPct) {
  if (epLossPct <= ELO_ANCHORS[0].epLossPct) return ELO_ANCHORS[0].elo;
  for (let i = 0; i < ELO_ANCHORS.length - 1; i++) {
    const a = ELO_ANCHORS[i], b = ELO_ANCHORS[i + 1];
    if (epLossPct >= a.epLossPct && epLossPct <= b.epLossPct) {
      const t = (epLossPct - a.epLossPct) / (b.epLossPct - a.epLossPct);
      return Math.round(a.elo + t * (b.elo - a.elo));
    }
  }
  return ELO_ANCHORS[ELO_ANCHORS.length - 1].elo;
}

function evalValue(entry) {
  if (!entry) return 0;
  if (entry.mate !== null && entry.mate !== undefined) {
    const sign = entry.mate > 0 ? 1 : -1;
    return sign * (100000 - Math.abs(entry.mate) * 100);
  }
  return entry.cp || 0;
}
// Conversion éval -> "points attendus" (0 = perdu, 1 = gagné, 0.5 = égal).
// Chess.com calibre ça avec le rating du joueur (data propriétaire, non
// publiée) ; on utilise ici une sigmoïde publique standard (même famille que
// celle documentée par Lichess) comme substitut raisonnable, non calibrée
// par rating.
// Mode expérimental : ajuste la sévérité de classification selon le rating
// du joueur. Constaté empiriquement (une seule partie comparée en détail,
// pas une vraie calibration statistique) : notre outil est systématiquement
// plus indulgent que Chess.com pour un joueur à bas rating — cohérent avec
// leur documentation officielle ("points attendus calibrés selon le rating
// du joueur"). Table construite à la main, PAS basée sur des données
// Chess.com réelles — juste une approximation pour voir l'effet.
const RATING_SEVERITY_ANCHORS = [
  { rating: 300, mult: 1.6 }, { rating: 600, mult: 1.4 }, { rating: 900, mult: 1.25 },
  { rating: 1200, mult: 1.1 }, { rating: 1500, mult: 1.0 }, { rating: 1800, mult: 0.92 },
  { rating: 2100, mult: 0.85 }, { rating: 2400, mult: 0.8 },
];
function ratingSeverityMultiplier(rating) {
  if (!rating || isNaN(rating)) return 1.0;
  const anchors = RATING_SEVERITY_ANCHORS;
  if (rating <= anchors[0].rating) return anchors[0].mult;
  if (rating >= anchors[anchors.length - 1].rating) return anchors[anchors.length - 1].mult;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (rating >= a.rating && rating <= b.rating) {
      const t = (rating - a.rating) / (b.rating - a.rating);
      return a.mult + t * (b.mult - a.mult);
    }
  }
  return 1.0;
}
function expectedPoints(entry) {
  if (entry && entry.mate !== null && entry.mate !== undefined) {
    return entry.mate > 0 ? 1 : 0;
  }
  const cp = entry ? (entry.cp || 0) : 0;
  return 1 / (1 + Math.pow(10, -cp / 400));
}
// Valeur signée "brute" (centipions, ou grand nombre pour un mat), utilisée
// UNIQUEMENT comme signal de secours dans les positions déjà saturées (voir
// plus bas) — jamais pour la classification principale.
function rawSignedValue(entry) {
  if (!entry) return 0;
  if (entry.mate !== null && entry.mate !== undefined) {
    const sign = entry.mate > 0 ? 1 : -1;
    return sign * (100000 - Math.abs(entry.mate) * 100);
  }
  return entry.cp || 0;
}
const CLASS_SEVERITY = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
function worsenBy(cls, steps) {
  const idx = CLASS_SEVERITY.indexOf(cls);
  if (idx === -1) return cls; // book/miss/brilliant/great : pas sur cette échelle, inchangé
  return CLASS_SEVERITY[Math.min(CLASS_SEVERITY.length - 1, idx + steps)];
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
function countLegalMoves(state, color) {
  let count = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = state.board[y][x];
    if (p && p.color === color) count += legalMoves(state, x, y).length;
  }
  return count;
}
// Précision par coup à partir des points attendus perdus (méthode Lichess,
// appliquée ici sur l'échelle 0-100 des points attendus perdus x100).
function moveAccuracy(epLossPct) {
  const a = 103.1668 * Math.exp(-0.04354 * epLossPct) - 3.1669;
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
async function analyzeGame(engine, plies, depth, onProgress, severityMult) {
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
    const afterRaw = after.lines[1] || {};

    // Points attendus (0-1) du point de vue du joueur qui vient de jouer.
    const epBefore = expectedPoints(bestLine); // meilleure ligne possible avant le coup
    const epAfterOpp = expectedPoints(afterRaw); // position après coup, du point de vue de l'adversaire au trait
    const epAfterMover = 1 - epAfterOpp;
    let epLoss = epBefore - epAfterMover;
    if (epLoss < 0) epLoss = 0; // le coup joué est encore meilleur que prévu par le moteur (bruit de recherche)
    // Mode expérimental "ajusté au rating" : amplifie ou atténue la perte
    // selon le rating du joueur avant de classifier — voir
    // ratingSeverityMultiplier(). N'affecte QUE la classification/l'affichage
    // de perte, pas epBefore/epAfterMover (donc pas la barre d'éval).
    if (severityMult) epLoss *= (severityMult[mover] || 1.0);
    const epLossPct = epLoss * 100; // pour l'affichage/l'accuracy, sur une échelle 0-100

    // éval du point de vue des Blancs, pour la barre d'avantage (indépendant
    // du camp qui vient de jouer)
    const opponentColor = mover === 'w' ? 'b' : 'w';
    const whiteSign = opponentColor === 'w' ? 1 : -1;
    const evalMateWhite = afterRaw.mate != null ? whiteSign * afterRaw.mate : null;
    const evalCpWhite = afterRaw.mate == null ? whiteSign * (afterRaw.cp || 0) : null;

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
      const secondEp = secondLine ? expectedPoints(secondLine) : null;
      const nextForSac = applyMove(prevState, parsed.move, parsed.promo);
      const sac = isLikelySacrifice(prevState, nextForSac.board, parsed.move, mover);
      const isCheckmate = plies[i].san.endsWith('#');
      const isForced = countLegalMoves(prevState, mover) === 1;

      if (isForced) {
        cls = 'forced';
      } else {
      // Tableau officiel Chess.com "Classification V2" (points attendus
      // perdus, 9 février 2026) : Meilleur 0 · Excellent 0-0.02 ·
      // Bon 0.02-0.05 · Imprécision 0.05-0.10 · Erreur 0.10-0.20 · Gaffe 0.20+
      if (i <= 6 && epLoss <= 0.03) {
        cls = 'book';
      } else if (isCheckmate || matchesBest || epLoss <= 0.0001) {
        cls = 'best';
      } else if (epLoss <= 0.02) cls = 'excellent';
      else if (epLoss <= 0.05) cls = 'good';
      else if (epLoss <= 0.10) cls = 'inaccuracy';
      else if (epLoss <= 0.20) cls = 'mistake';
      else cls = 'blunder';

      // Brillant : sacrifice de qualité qui reste le/proche du meilleur coup,
      // position pas déjà totalement gagnée avant, pas mauvaise après —
      // définition simplifiée V2 de Chess.com.
      if (sac && (matchesBest || epLoss <= 0.02) && epBefore < 0.85 && epAfterMover >= 0.4) {
        cls = 'brilliant';
      // Great Move : coup décisif pour l'issue (perdant->égal, égal->gagnant,
      // ou seul bon coup dans la position).
      } else if ((matchesBest || epLoss <= 0.02) && (
        (epBefore < 0.4 && epAfterMover >= 0.4) ||
        (epBefore >= 0.4 && epBefore < 0.6 && epAfterMover >= 0.6) ||
        (secondEp !== null && (epBefore - secondEp) >= 0.15)
      )) {
        cls = 'great';
      // Miss : position gagnante disponible, non convertie.
      } else if (epBefore >= 0.7 && epAfterMover < 0.5 && !matchesBest) {
        cls = 'miss';
      }

      // Correction de saturation : une fois la position largement gagnée (ou
      // perdue) des deux côtés du coup, la sigmoïde des points attendus se
      // tasse près de 0 ou 1 et perd sa capacité à distinguer les coups — un
      // mat retardé de 3 à 15 coups, ou un avantage de +1500 qui fond à
      // +300, ressortirait "Meilleur coup" alors que ça n'en est pas un.
      // On rattrape ça avec l'éval brute (non saturée) comme signal de
      // secours, uniquement dans cette zone.
      const inSaturatedZone = (epBefore > 0.90 || epBefore < 0.10) && (epAfterMover > 0.90 || epAfterMover < 0.10);
      if (inSaturatedZone && !['brilliant', 'great', 'book', 'miss'].includes(cls)) {
        const rawSwing = rawSignedValue(bestLine) - (-rawSignedValue(afterRaw));
        if (rawSwing >= 900) cls = worsenBy(cls, 3);
        else if (rawSwing >= 400) cls = worsenBy(cls, 2);
        else if (rawSwing >= 150) cls = worsenBy(cls, 1);
      }
      }
    }

    records.push({ ply: i, color: mover, san: plies[i].san, cls, lossCp: epLossPct, epLoss, fen: curFen, playedMove, bestMove, evalCpWhite, evalMateWhite, bestLinePV: bestLine ? bestLine.pv : [] });
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
const ratingModeToggle = document.getElementById('ratingModeToggle');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const boardGrid = document.getElementById('boardGrid');
const arrowSvg = document.getElementById('arrowSvg');
const evalFillEl = document.getElementById('evalFill');
const evalLabelEl = document.getElementById('evalLabel');
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
const compareCard = document.getElementById('compareCard');
const compareButtons = document.getElementById('compareButtons');
const compareResult = document.getElementById('compareResult');
const btnPlayEngineLine = document.getElementById('btnPlayEngineLine');
const extendedPanel = document.getElementById('extendedPanel');
const extendedInfo = document.getElementById('extendedInfo');
const btnExtPrev = document.getElementById('btnExtPrev');
const btnExtNext = document.getElementById('btnExtNext');
const btnExtExit = document.getElementById('btnExtExit');

let engine = null;
const LOCAL_ENGINE_URL = 'http://localhost:8933';

class LocalEngineAdapter {
  constructor() { this.readyPromise = Promise.resolve(); this.isLocal = true; }
  async analyze(fen, opts = {}) {
    const resp = await fetch(LOCAL_ENGINE_URL + '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, ...opts }),
    });
    if (!resp.ok) throw new Error('Serveur local : erreur ' + resp.status);
    return resp.json();
  }
  stop() {}
}

let lastLocalEngineError = null;
async function checkLocalEngine() {
  try {
    const ctrl = new AbortController();
    // Délai généreux : la 1ère fois, Chrome peut afficher un prompt de
    // permission "autoriser l'accès au réseau local" (Local Network Access)
    // qui demande une action humaine — un timeout trop court le couperait
    // avant que tu aies pu cliquer "Autoriser".
    const t = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(LOCAL_ENGINE_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) {
      lastLocalEngineError = 'Réponse HTTP ' + resp.status + ' ' + resp.statusText;
      return false;
    }
    return true;
  } catch (e) {
    if (e.name === 'AbortError') {
      lastLocalEngineError = 'Timeout après 3s (aucune réponse — serveur pas lancé, ou requête bloquée silencieusement par le navigateur)';
    } else {
      lastLocalEngineError = (e.name || 'Erreur') + ': ' + (e.message || 'inconnue') +
        ' — note : par sécurité, les navigateurs ne donnent jamais la vraie raison exacte d\'un blocage réseau/CORS via JS (que ce soit CORS classique, Private/Local Network Access, ou mixed content), ce message générique est tout ce qu\'ils exposent.';
    }
    return false;
  }
}

async function getEngine() {
  if (engine) return engine;
  const badgeEl = document.getElementById('engineBadge');
  const hasLocal = await checkLocalEngine();
  if (hasLocal) {
    engine = new LocalEngineAdapter();
    setState('fetch-ok', '⚡ Moteur natif local détecté (serveur sur ' + LOCAL_ENGINE_URL + ') — analyse accélérée.');
    if (badgeEl) { badgeEl.textContent = '⚡ Moteur natif local (rapide)'; badgeEl.className = 'engine-badge local'; }
  } else {
    engine = new Engine('stockfish-18-lite-single.js');
    if (badgeEl) {
      badgeEl.textContent = '🌐 Moteur WASM navigateur (serveur local non détecté)';
      badgeEl.className = 'engine-badge wasm';
      badgeEl.title = lastLocalEngineError || 'raison inconnue';
      if (lastLocalEngineError) showDebug('Serveur local non détecté : ' + lastLocalEngineError);
    }
  }
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
let currentHeaders = null;
let currentUsername = null;
let lastRatingModeOn = false;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

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
  resultsEl.classList.add('hidden');
  updateEvalBar(null);

  const eng = await getEngine();
  setState('analyzing', 'Démarrage du moteur Stockfish…');
  try {
    await withTimeout(eng.readyPromise, 15000, "Le moteur Stockfish ne répond pas après 15s. Recharge la page (tire vers le bas ou vide le cache) et réessaie — si ça persiste, le fichier .wasm n'a peut-être pas fini de charger.");
  } catch (e) {
    setState('error', e.message);
    return;
  }

  setState('analyzing', `Analyse en cours (0 / ${totalMoves})…`);
  const ratingModeOn = !!(ratingModeToggle && ratingModeToggle.checked);
  lastRatingModeOn = ratingModeOn;
  const severityMult = ratingModeOn ? {
    w: ratingSeverityMultiplier(parseInt(headers.WhiteElo, 10)),
    b: ratingSeverityMultiplier(parseInt(headers.BlackElo, 10)),
  } : null;
  let records;
  try {
    records = await analyzeGame(eng, plies, depth, (done, total) => {
      setState('analyzing', `Analyse en cours (${done} / ${total})…`);
    }, severityMult);
  } catch (e) {
    setState('error', 'Erreur moteur : ' + (e && e.message ? e.message : e));
    return;
  }
  setState('done', `Terminé — ${headers.White || '?'} vs ${headers.Black || '?'} (${headers.Result || ''})`);
  currentPlies = plies;
  currentRecords = records;
  currentHeaders = headers;
  currentUsername = username;
  currentPly = records.length; // se place à la fin par défaut
  try {
    renderResults(records, headers, username);
  } catch (e) {
    setState('error', "Analyse terminée mais erreur d'affichage : " + (e && e.message ? e.message : e));
  }
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
  // Les coups "Théorie" ont une perte quasi nulle par construction — les
  // inclure dans la moyenne fait chuter artificiellement l'ACPL et gonfle
  // l'Elo estimé, surtout sur une partie courte où ils pèsent lourd dans le
  // total. On ne garde que les coups réellement "testés" pour ces stats.
  const nonBook = (arr) => arr.filter((r) => r.cls !== 'book' && r.cls !== 'forced');
  const avgAccuracy = (arr) => arr.length ? arr.reduce((s, r) => s + moveAccuracy(r.lossCp), 0) / arr.length : 0;
  const avgEpLoss = (arr) => arr.length ? arr.reduce((s, r) => s + r.lossCp, 0) / arr.length : 0;
  const wReal = nonBook(byColor.w), bReal = nonBook(byColor.b);
  const accW = avgAccuracy(wReal), accB = avgAccuracy(bReal);
  const acplW = avgEpLoss(wReal), acplB = avgEpLoss(bReal);
  // Échantillon trop petit (partie très courte) : l'estimation Elo devient
  // du bruit statistique plutôt qu'un vrai signal. On l'affiche seulement
  // au-delà d'un minimum de coups réellement testés.
  const MIN_MOVES_FOR_ELO = 8;
  const eloTextFor = (arr, acpl) => arr.length >= MIN_MOVES_FOR_ELO
    ? `≈ ${estimatedEloFromACPL(acpl)}`
    : `non estimable (${arr.length} coup${arr.length > 1 ? 's' : ''} hors théorie, ${MIN_MOVES_FOR_ELO} minimum)`;

  summaryEl.innerHTML = `
    <div class="side-summary"><b>${headers.White || 'Blancs'}</b>${whiteIsUser ? ' (toi)' : ''}<br>
      Précision ≈ ${accW.toFixed(2)}% · pts. attendus perdus ${acplW.toFixed(2)}%<br>
      Elo officiel : ${headers.WhiteElo || '?'} · Elo estimé sur cette partie ${eloTextFor(wReal, acplW)}</div>
    <div class="side-summary"><b>${headers.Black || 'Noirs'}</b>${blackIsUser ? ' (toi)' : ''}<br>
      Précision ≈ ${accB.toFixed(2)}% · pts. attendus perdus ${acplB.toFixed(2)}%<br>
      Elo officiel : ${headers.BlackElo || '?'} · Elo estimé sur cette partie ${eloTextFor(bReal, acplB)}</div>
    <div class="acc-note">Classification calée sur le tableau officiel Chess.com "Classification V2" (points attendus, 9 fév. 2026) — sauf calibration par rating, propriétaire et non reproduite ici. Les coups "Théorie" ne comptent pas dans la précision/Elo estimé (perte quasi nulle par construction, ça fausserait la moyenne). Précision et Elo estimé restent des approximations, peu fiables sur une partie courte.${lastRatingModeOn ? '<br><b style="color:var(--gold);">⚠ Mode ajusté au rating actif</b> — ces chiffres ne sont pas comparables à une analyse sans ce mode.' : ''}</div>
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
function formatEval(cpWhite, mateWhite) {
  if (mateWhite != null) return (mateWhite > 0 ? 'M' : '−M') + Math.abs(mateWhite);
  const v = (cpWhite || 0) / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1);
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
  const evalSpan = document.createElement('span');
  evalSpan.className = 'move-eval';
  evalSpan.textContent = formatEval(rec.evalCpWhite, rec.evalMateWhite);
  cell.appendChild(evalSpan);
  cell.addEventListener('click', () => goToPly(plyIndex));
  return cell;
}

/* ---- Navigation ---- */
function goToPly(ply) {
  if (!currentPlies) return;
  if (extendedLine) { extendedLine = null; extendedPanel.classList.add('hidden'); }
  currentPly = Math.max(0, Math.min(ply, currentRecords.length));
  resetManualArrowsSilently();
  renderPosition(currentPlies[currentPly].fen);
  renderAutoArrows();
  updateEvalBar(currentPly > 0 ? currentRecords[currentPly - 1] : null);
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
  if (rec.lossCp > 1) html += ` <span class="loss-tag">(−${rec.lossCp.toFixed(1)} pts att.)</span>`;
  if (rec.bestMove && rec.playedMove && (rec.bestMove.from.x !== rec.playedMove.from.x || rec.bestMove.from.y !== rec.playedMove.from.y || rec.bestMove.to.x !== rec.playedMove.to.x || rec.bestMove.to.y !== rec.playedMove.to.y)) {
    html += `<br><span class="best-tag">Suggestion du moteur en pointillés</span>`;
  }
  moveInfoEl.innerHTML = html;
}

/* =========================================================
   4. Plateau + flèches (auto : coup joué / meilleur coup —
      manuel : dessin libre façon annotation)
   ========================================================= */
function updateEvalBar(record) {
  let cp = 0, mate = null;
  if (record) { cp = record.evalCpWhite || 0; mate = record.evalMateWhite; }
  const capped = Math.max(-1000, Math.min(1000, cp));
  const pct = 50 + (capped / 1000) * 50;
  evalFillEl.style.height = pct + '%';
  const whiteAhead = mate != null ? mate > 0 : cp >= 0;
  evalLabelEl.textContent = mate != null ? ('M' + Math.abs(mate)) : (cp / 100).toFixed(1);
  evalLabelEl.style.color = whiteAhead ? '#1c1c1c' : '#f7f4ea';
}

function buildBoardGrid() {
  boardGrid.innerHTML = '';
  boardGrid.appendChild(arrowSvg);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const sqEl = document.createElement('div');
    sqEl.className = 'sq ' + ((x + y) % 2 === 1 ? 'dark' : 'light');
    sqEl.dataset.x = x; sqEl.dataset.y = y;
    boardGrid.appendChild(sqEl);
  }
  enforceSquareBoard();
}
function enforceSquareBoard() {
  // Filet de sécurité : force la hauteur du plateau à égaler sa largeur en
  // pixels. Certains navigateurs mobiles ne respectent pas correctement
  // `aspect-ratio` combiné à un parent flex, ce qui écrase le plateau
  // verticalement (cases non carrées). On mesure et on fixe en JS plutôt
  // que de compter uniquement sur le CSS.
  const w = boardGrid.getBoundingClientRect().width;
  if (w > 0) boardGrid.style.height = w + 'px';
}
window.addEventListener('resize', enforceSquareBoard);
window.addEventListener('orientationchange', () => setTimeout(enforceSquareBoard, 200));
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

const ENGINE_LABELS = {
  lc0: { label: 'Lc0 (réseau fort)', kind: 'eval' },
};
for (let elo = 1100; elo <= 1900; elo += 100) {
  ENGINE_LABELS['maia-' + elo] = { label: 'Maia ' + elo, kind: 'suggestion' };
}

async function setupComparePanel() {
  if (!engine || !engine.isLocal) { compareCard.classList.add('hidden'); return; }
  let list = [];
  try {
    const resp = await fetch(LOCAL_ENGINE_URL + '/engines');
    if (resp.ok) list = (await resp.json()).engines || [];
  } catch (e) { /* pas grave, on masque juste le panneau */ }
  const extra = list.filter((name) => name !== 'stockfish');
  if (extra.length === 0) { compareCard.classList.add('hidden'); return; }
  compareCard.classList.remove('hidden');
  compareButtons.innerHTML = '';
  extra.forEach((name) => {
    const meta = ENGINE_LABELS[name] || { label: name, kind: 'eval' };
    const btn = document.createElement('button');
    btn.textContent = meta.label;
    btn.addEventListener('click', () => compareWithEngine(name, meta));
    compareButtons.appendChild(btn);
  });
}

async function compareWithEngine(profileName, meta) {
  if (!currentPlies) return;
  const fen = currentPlies[currentPly].fen;
  compareResult.textContent = meta.label + ' réfléchit…';
  try {
    const result = await engine.analyze(fen, { depth: 12, multipv: 1, engine: profileName });
    const st = fenToState(fen);
    const san = result.bestMoveUci ? uciToSanLabel(st, result.bestMoveUci) : '?';
    if (meta.kind === 'suggestion') {
      // Maia : pas d'éval exploitable (recherche à 1 nœud), juste le coup suggéré.
      compareResult.textContent = `${meta.label} jouerait probablement : ${san}`;
    } else {
      const line = result.lines && result.lines[1];
      const ev = line ? formatEval(line.mate != null ? null : (st.turn === 'w' ? line.cp : -line.cp), line.mate != null ? (st.turn === 'w' ? line.mate : -line.mate) : null) : '?';
      compareResult.textContent = `${meta.label} — coup suggéré : ${san} (éval ${ev})`;
    }
  } catch (e) {
    compareResult.textContent = 'Erreur : ' + (e && e.message ? e.message : e);
  }
}
function uciToSanLabel(state, uci) {
  const from = algToXY(uci.slice(0, 2));
  const to = algToXY(uci.slice(2, 4));
  const moves = legalMoves(state, from.x, from.y);
  const move = moves.find((m) => m.to.x === to.x && m.to.y === to.y);
  if (!move) return uci;
  return sanForMove(state, { ...move, promotionType: uci.length > 4 ? uci[4] : 'q' });
}

let extendedLine = null; // { positions:[{fen, sanFr}], index, returnPly }

function playOutEngineLine() {
  if (!currentPlies) return;
  const rec = currentRecords[currentPly]; // analyse calculée pour LA position affichée en ce moment
  const pv = rec && rec.bestLinePV;
  if (!pv || pv.length === 0) {
    setState('idle-error', "Pas de ligne du moteur enregistrée pour cette position (fin de partie, ou position déjà décisive).");
    return;
  }
  let state = fenToState(currentPlies[currentPly].fen);
  const positions = [{ fen: currentPlies[currentPly].fen, sanFr: null }];
  const cap = Math.min(pv.length, 20);
  for (let i = 0; i < cap; i++) {
    const uci = pv[i];
    const from = algToXY(uci.slice(0, 2));
    const to = algToXY(uci.slice(2, 4));
    const moves = legalMoves(state, from.x, from.y);
    const move = moves.find((m) => m.to.x === to.x && m.to.y === to.y);
    if (!move) break;
    const promo = uci.length > 4 ? uci[4] : 'q';
    const san = sanForMove(state, { ...move, promotionType: promo });
    const nextRaw = applyMove(state, move, promo);
    state = { board: nextRaw.board, turn: nextRaw.turn, castling: nextRaw.castling, enPassant: nextRaw.enPassant, kingPos: nextRaw.kingPos };
    positions.push({ fen: toFEN(state, 1), sanFr: san });
  }
  if (positions.length <= 1) {
    setState('idle-error', "Le moteur n'a proposé aucun coup jouable ici.");
    return;
  }
  extendedLine = { positions, index: 0, returnPly: currentPly };
  extendedPanel.classList.remove('hidden');
  renderExtendedLine();
}
function renderExtendedLine() {
  if (!extendedLine) return;
  const { positions, index } = extendedLine;
  renderPosition(positions[index].fen);
  arrowSvg.innerHTML = '';
  extendedInfo.textContent = index === 0
    ? `Suite du moteur — position de départ (${positions.length - 1} coups disponibles)`
    : `Suite du moteur — coup ${index}/${positions.length - 1} : ${positions[index].sanFr}`;
  btnExtPrev.disabled = index === 0;
  btnExtNext.disabled = index === positions.length - 1;
}
function exitExtendedLine() {
  if (!extendedLine) return;
  const returnPly = extendedLine.returnPly;
  extendedLine = null;
  extendedPanel.classList.add('hidden');
  goToPly(returnPly);
}
btnPlayEngineLine.addEventListener('click', playOutEngineLine);
btnExtPrev.addEventListener('click', () => { if (extendedLine && extendedLine.index > 0) { extendedLine.index--; renderExtendedLine(); } });
btnExtNext.addEventListener('click', () => { if (extendedLine && extendedLine.index < extendedLine.positions.length - 1) { extendedLine.index++; renderExtendedLine(); } });
btnExtExit.addEventListener('click', exitExtendedLine);

buildDrawPalette();
attachDrawEvents();

function csvEscape(field) {
  const s = String(field == null ? '' : field);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(fields) { return fields.map(csvEscape).join(';') + '\r\n'; }

function exportCSV() {
  if (!currentRecords || !currentRecords.length) {
    setState('idle-error', "Aucune partie analysée à exporter pour l'instant.");
    return;
  }
  let csv = '';
  csv += csvRow(['Coup', 'Type de coup', 'Précision +/-']);
  for (let i = 0; i < currentRecords.length; i++) {
    const rec = currentRecords[i];
    const num = Math.ceil((i + 1) / 2);
    const moveLabel = (i % 2 === 0 ? num + '. ' : num + '... ') + rec.san;
    const clsLabel = CLASS_META[rec.cls] ? CLASS_META[rec.cls].label : rec.cls;
    const evalLabel = formatEval(rec.evalCpWhite, rec.evalMateWhite);
    csv += csvRow([moveLabel, clsLabel, evalLabel]);
  }

  // Bilan général, à la fin du fichier
  const byColor = { w: [], b: [] };
  currentRecords.forEach((r) => byColor[r.color].push(r));
  const nonBook = (arr) => arr.filter((r) => r.cls !== 'book' && r.cls !== 'forced');
  const wReal = nonBook(byColor.w), bReal = nonBook(byColor.b);
  const avgAccuracy = (arr) => arr.length ? arr.reduce((s, r) => s + moveAccuracy(r.lossCp), 0) / arr.length : 0;
  const avgEpLoss = (arr) => arr.length ? arr.reduce((s, r) => s + r.lossCp, 0) / arr.length : 0;
  const accW = avgAccuracy(wReal), accB = avgAccuracy(bReal);
  const acplW = avgEpLoss(wReal), acplB = avgEpLoss(bReal);
  const h = currentHeaders || {};
  const MIN_MOVES_FOR_ELO = 8;
  const eloText = (arr, acpl) => arr.length >= MIN_MOVES_FOR_ELO ? String(estimatedEloFromACPL(acpl)) : 'non estimable';

  csv += '\r\n';
  csv += csvRow(['Bilan général', '', '']);
  csv += csvRow(['Mode ajusté au rating', lastRatingModeOn ? 'ACTIF (expérimental)' : 'inactif', '']);
  csv += csvRow(['', 'Blancs — ' + (h.White || '?'), 'Noirs — ' + (h.Black || '?')]);
  csv += csvRow(['Précision', accW.toFixed(2) + '%', accB.toFixed(2) + '%']);
  csv += csvRow(['Points attendus perdus (moy.)', acplW.toFixed(2) + '%', acplB.toFixed(2) + '%']);
  csv += csvRow(['Elo officiel', h.WhiteElo || '?', h.BlackElo || '?']);
  csv += csvRow(['Elo estimé sur cette partie', eloText(wReal, acplW), eloText(bReal, acplB)]);
  csv += csvRow(['Résultat', h.Result || '?', '']);
  csv += csvRow(['Date', h.Date || h.UTCDate || '?', '']);

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = ((h.White || 'Blancs') + '_vs_' + (h.Black || 'Noirs')).replace(/[^\w-]+/g, '_');
  a.href = url;
  a.download = 'analyse_' + safeName + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

/* =========================================================
   Init moteur
   ========================================================= */
let engineLoaded = false;
(async () => {
  engine = await getEngine();
  engine.readyPromise.then(() => { engineLoaded = true; });
  setTimeout(() => {
    if (!engineLoaded && engineWarningEl) engineWarningEl.classList.remove('hidden');
  }, 6000);
  setupComparePanel();
})();
