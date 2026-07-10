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
  forced: { label: 'Forcé', symbol: '→', color: '#8b9199' },
  inaccuracy: { label: 'Imprécision', symbol: '?!', color: '#e0b23a' },
  mistake: { label: 'Erreur', symbol: '?', color: '#e0813a' },
  blunder: { label: 'Gaffe', symbol: '??', color: '#d64545' },
  miss: { label: 'Occasion manquée', symbol: '✗', color: '#c0392b' },
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
// Table d'ancrage précision (%) -> Elo estimé. Les deux points 73.4->1000 et
// 91.9->1650 viennent d'une comparaison réelle avec le "game rating" affiché
// par Chess.com (partie du 08/07/2026) ; le reste est interpolé/extrapolé.
// Ça reste un ordre de grandeur, pas une calibration scientifique.
const ACC_ELO_ANCHORS = [
  { acc: 50, elo: 250 }, { acc: 60, elo: 550 }, { acc: 67, elo: 800 },
  { acc: 73.4, elo: 1000 }, { acc: 80, elo: 1250 }, { acc: 86, elo: 1450 },
  { acc: 91.9, elo: 1650 }, { acc: 95, elo: 1950 }, { acc: 97, elo: 2300 },
  { acc: 98.5, elo: 2650 }, { acc: 99.5, elo: 2900 },
];
function estimatedEloFromAccuracy(acc) {
  if (acc <= ACC_ELO_ANCHORS[0].acc) return ACC_ELO_ANCHORS[0].elo;
  const last = ACC_ELO_ANCHORS[ACC_ELO_ANCHORS.length - 1];
  if (acc >= last.acc) return last.elo;
  for (let i = 0; i < ACC_ELO_ANCHORS.length - 1; i++) {
    const a = ACC_ELO_ANCHORS[i], b = ACC_ELO_ANCHORS[i + 1];
    if (acc <= b.acc) {
      const t = (acc - a.acc) / (b.acc - a.acc);
      return Math.round(a.elo + t * (b.elo - a.elo));
    }
  }
  return last.elo;
}
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
// Précision de PARTIE — méthode Lichess complète, pas une simple moyenne.
// Une moyenne arithmétique des précisions par coup surestime énormément :
// dans une position déjà morte (gagnée ou perdue), presque tous les coups
// ressortent ~100% et noient les 2-3 gaffes qui ont décidé la partie
// (c'était la cause principale des Elo "ridiculement hauts").
// Lichess combine :
//  1) une moyenne PONDÉRÉE par la volatilité de la position (écart-type des
//     points attendus sur une fenêtre glissante) — les coups joués quand la
//     partie se joue vraiment pèsent lourd, ceux joués quand tout est plié
//     pèsent peu ;
//  2) une moyenne HARMONIQUE — punit fortement les quelques très mauvais
//     coups au lieu de les laisser se diluer.
// Résultat = moyenne des deux.
function gameAccuracy(allRecords, color) {
  // Série des points attendus (POV Blancs, échelle 0-100) après chaque
  // demi-coup, position initiale incluse.
  const wp = [50];
  for (const r of allRecords) {
    const entry = r.evalMateWhite != null ? { mate: r.evalMateWhite, cp: null } : { mate: null, cp: r.evalCpWhite || 0 };
    wp.push(expectedPoints(entry) * 100);
  }
  const windowSize = Math.max(2, Math.min(8, Math.floor(wp.length / 10)));
  const accs = [], weights = [];
  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (r.color !== color) continue;
    if (r.cls === 'book' || r.cls === 'forced') continue; // hors calcul, comme avant
    accs.push(moveAccuracy(r.lossCp));
    // volatilité locale : écart-type des points attendus autour de ce coup
    const lo = Math.max(0, i + 1 - windowSize);
    const sub = wp.slice(lo, i + 2);
    const m = sub.reduce((s, x) => s + x, 0) / sub.length;
    const sd = Math.sqrt(sub.reduce((s, x) => s + (x - m) * (x - m), 0) / sub.length);
    weights.push(Math.max(0.5, Math.min(12, sd)));
  }
  if (!accs.length) return { acc: 0, n: 0 };
  let num = 0, den = 0;
  accs.forEach((a, k) => { num += a * weights[k]; den += weights[k]; });
  const weighted = num / den;
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1e-9), 0);
  return { acc: (weighted + harmonic) / 2, n: accs.length };
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
  let stillInBook = true; // vrai tant que TOUS les coups depuis le début sont dans le livre
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
      const nLegal = countLegalMoves(prevState, mover);
      // Forcé : un seul coup légal, OU (comme Chess.com) seulement deux coups
      // légaux dont l'issue est quasi identique d'après le moteur (MultiPV 2
      // couvre alors la totalité des coups) — typiquement un roi en échec avec
      // deux cases de fuite équivalentes.
      let isForced = nLegal === 1;
      if (!isForced && nLegal === 2 && secondLine) {
        const m1 = bestLine ? bestLine.mate : null, m2 = secondLine.mate;
        if (m1 != null && m2 != null && Math.sign(m1) === Math.sign(m2) && Math.abs(Math.abs(m1) - Math.abs(m2)) <= 1) {
          isForced = true; // deux défenses menant au même mat (à 1 coup près)
        } else if (m1 == null && m2 == null && Math.abs((bestLine ? bestLine.cp || 0 : 0) - (m2 == null ? secondLine.cp || 0 : 0)) <= 30) {
          isForced = true; // deux coups d'éval quasi égale
        }
      }

      if (isForced) {
        cls = 'forced';
      } else {
      // Tableau officiel Chess.com "Classification V2" (points attendus
      // perdus, 9 février 2026) : Meilleur 0 · Excellent 0-0.02 ·
      // Bon 0.02-0.05 · Imprécision 0.05-0.10 · Erreur 0.10-0.20 · Gaffe 0.20+
      // Théorie : la position APRÈS le coup figure dans la base d'ouvertures
      // (Lichess, CC0, ~7900 positions EPD dans openings.js), et tous les
      // coups précédents étaient eux-mêmes théoriques (une fois sorti du
      // livre, on n'y "rentre" plus — même logique que Chess.com).
      // Chess.com utilise sa propre base : de petites différences de
      // couverture restent possibles sur des lignes rares.
      const hasBook = typeof OPENING_BOOK !== 'undefined';
      const epdAfter = curFen.split(' ').slice(0, 4).join(' ');
      const inBookLine = hasBook
        ? (stillInBook && OPENING_BOOK.has(epdAfter))
        : (i <= 6 && epLoss <= 0.03); // fallback si openings.js non chargé
      if (inBookLine) {
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
      // définition simplifiée V2 de Chess.com. Un coup encore dans la
      // Théorie n'est jamais surclassé (un sacrifice de théorie connu,
      // comme 3...Nxe4 dans la Vienne, reste "Théorie" chez Chess.com).
      if (cls !== 'book') {
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

      // Miss (cas Chess.com supplémentaire) : un mat forcé était disponible,
      // le coup joué le laisse filer — même si la position reste totalement
      // gagnante. Ex. : mat en 3 sous la main, on joue une prise à +16 sans
      // mat forcé -> "Occasion manquée", pas "Erreur".
      const hadForcedMate = bestLine && bestLine.mate != null && bestLine.mate > 0;
      const keptForcedMate = afterRaw && afterRaw.mate != null && afterRaw.mate < 0; // POV adversaire : négatif = on mate toujours
      if (hadForcedMate && !keptForcedMate && !matchesBest && !isCheckmate && epAfterMover >= 0.5) {
        cls = 'miss';
      }
      } // fin du garde-fou cls !== 'book'

      // Correction de saturation : une fois la position largement gagnée (ou
      // perdue) des deux côtés du coup, la sigmoïde des points attendus se
      // tasse près de 0 ou 1 et perd sa capacité à distinguer les coups — un
      // mat retardé de 3 à 15 coups, ou un avantage de +1500 qui fond à
      // +300, ressortirait "Meilleur coup" alors que ça n'en est pas un.
      // On rattrape ça avec l'éval brute (non saturée) comme signal de
      // secours, uniquement dans cette zone.
      const inSaturatedZone = (epBefore > 0.90 || epBefore < 0.10) && (epAfterMover > 0.90 || epAfterMover < 0.10);
      if (inSaturatedZone && !['brilliant', 'great', 'book', 'miss', 'forced'].includes(cls)) {
        const bestMateAgainst = bestLine && bestLine.mate != null && bestLine.mate < 0;   // même en jouant au mieux, on se fait mater
        const afterMateAgainst = afterRaw && afterRaw.mate != null && afterRaw.mate > 0;  // après le coup, l'adversaire a un mat forcé
        const atLeast = (c) => { // au moins cette sévérité, sans jamais adoucir
          if (CLASS_SEVERITY.indexOf(cls) < CLASS_SEVERITY.indexOf(c)) cls = c;
        };
        if (bestMateAgainst && afterMateAgainst) {
          // Défense dans une position matée : classement par la RÉSISTANCE
          // PERDUE en distance de mat. La sigmoïde ne voit rien (0 -> 0),
          // et rawSwing non plus (~100/coup de mat) — c'est le cas 26.Kb1
          // (mat en 2 dispo, coup joué -> mat en 1 = Imprécision chez
          // Chess.com, "Meilleur" chez nous avant ce correctif).
          const resistanceLost = Math.abs(bestLine.mate) - Math.abs(afterRaw.mate);
          if (resistanceLost >= 3) atLeast('blunder');
          else if (resistanceLost === 2) atLeast('mistake');
          else if (resistanceLost === 1) atLeast('inaccuracy');
        } else if (!bestMateAgainst && afterMateAgainst) {
          // La meilleure défense évitait encore tout mat forcé ; le coup joué
          // en autorise un -> au moins Erreur (cas 22.Kb3 : -16 sans mat
          // forcé -> mat en 3 contre soi = Erreur chez Chess.com).
          atLeast('mistake');
        } else {
          // Zone saturée sans mats des deux côtés : signal de secours sur
          // l'éval brute, comme avant.
          const rawSwing = rawSignedValue(bestLine) - (-rawSignedValue(afterRaw));
          if (rawSwing >= 900) cls = worsenBy(cls, 3);
          else if (rawSwing >= 400) cls = worsenBy(cls, 2);
          else if (rawSwing >= 150) cls = worsenBy(cls, 1);
        }
      }
      }
    }

    if (cls !== 'book') stillInBook = false;
    records.push({ ply: i, color: mover, san: plies[i].san, cls, lossCp: epLossPct, epLoss, fen: curFen, playedMove, bestMove, evalCpWhite, evalMateWhite });
    if (onProgress) onProgress(i, plies.length - 1);
  }
  return records;
}

/* =========================================================
   DOM refs
   ========================================================= */
const $ = (id) => document.getElementById(id);
const usernameInput = $('usernameInput');
const btnSearch = $('btnSearch');
const gamesListCard = $('gamesListCard');
const gamesListEl = $('gamesList');
const pgnTextarea = $('pgnTextarea');
const btnAnalyzePaste = $('btnAnalyzePaste');
const depthSelect = $('depthSelect');
const statusEl = $('status');
const resultsEl = $('results');
const boardGrid = $('boardGrid');
const pieceLayer = $('pieceLayer');
const arrowSvg = $('arrowSvg');
const evalFillEl = $('evalFill');
const evalLabelEl = $('evalLabel');
const summaryEl = $('summary');
const moveListEl = $('moveList');
const moveInfoEl = $('moveInfo');
const historyListEl = $('historyList');
const historyEmptyEl = $('historyEmpty');
const btnClearHistory = $('btnClearHistory');
const tabAnalyze = $('tabAnalyze');
const tabHistory = $('tabHistory');
const viewAnalyze = $('viewAnalyze');
const viewHistory = $('viewHistory');
const resultsTitleEl = $('resultsTitle');

let engine = null;
function getEngine() {
  if (!engine) engine = new Engine('stockfish-18-lite-single.js');
  return engine;
}

/* ---- Statut ---- */
const STATE_META = {
  checking: { icon: '◌', cls: 'loading' },
  loading: { icon: '◌', cls: 'loading' },
  analyzing: { icon: '◌', cls: 'loading' },
  'fetch-ok': { icon: '●', cls: 'success' },
  done: { icon: '●', cls: 'success' },
  'not-found': { icon: '✕', cls: 'error' },
  'cors-error': { icon: '✕', cls: 'error' },
  error: { icon: '✕', cls: 'error' },
  'idle-error': { icon: '✕', cls: 'error' },
};
function setState(state, text) {
  const meta = STATE_META[state] || { icon: '', cls: '' };
  const spin = meta.cls === 'loading' ? ' spin' : '';
  statusEl.innerHTML = (meta.icon ? `<span class="status-icon${spin}">${meta.icon}</span> ` : '') + text;
  statusEl.className = 'status' + (meta.cls ? ' ' + meta.cls : '');
}

/* =========================================================
   Onglets
   ========================================================= */
function showTab(which) {
  const isA = which === 'analyze';
  tabAnalyze.classList.toggle('active', isA);
  tabHistory.classList.toggle('active', !isA);
  viewAnalyze.classList.toggle('hidden', !isA);
  viewHistory.classList.toggle('hidden', isA);
  if (!isA) renderHistory();
}
tabAnalyze.addEventListener('click', () => showTab('analyze'));
tabHistory.addEventListener('click', () => showTab('history'));

/* =========================================================
   Historique (localStorage)
   ========================================================= */
const HISTORY_KEY = 'chessAnalyses.v1';
const HISTORY_MAX = 25; // ~15 Ko par partie, on reste loin du quota

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch (e) { return []; }
}
function saveHistory(list) {
  // Si le quota est dépassé, on retire les plus anciennes jusqu'à ce que ça rentre.
  for (let keep = list.length; keep > 0; keep--) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, keep))); return; }
    catch (e) { /* QuotaExceeded : on réessaie avec une de moins */ }
  }
}
function saveAnalysisToHistory(plies, records, headers, username, depth) {
  const list = loadHistory();
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    username: username || '',
    depth,
    headers: {
      White: headers.White || '?', Black: headers.Black || '?',
      WhiteElo: headers.WhiteElo || '', BlackElo: headers.BlackElo || '',
      Result: headers.Result || '', Date: headers.Date || headers.UTCDate || '',
    },
    accW: Math.round(gameAccuracy(records, 'w').acc * 10) / 10,
    accB: Math.round(gameAccuracy(records, 'b').acc * 10) / 10,
    fens: plies.map((p) => p.fen),
    records,
  };
  // même partie déjà enregistrée (mêmes fens) -> on remplace au lieu de dupliquer
  const dupIdx = list.findIndex((e) => e.fens.length === entry.fens.length && e.fens[e.fens.length - 1] === entry.fens[entry.fens.length - 1] && e.headers.White === entry.headers.White && e.headers.Black === entry.headers.Black);
  if (dupIdx >= 0) list.splice(dupIdx, 1);
  list.unshift(entry);
  saveHistory(list.slice(0, HISTORY_MAX));
}
function renderHistory() {
  const list = loadHistory();
  historyListEl.innerHTML = '';
  historyEmptyEl.classList.toggle('hidden', list.length > 0);
  btnClearHistory.classList.toggle('hidden', list.length === 0);
  list.forEach((entry) => {
    const h = entry.headers;
    const uname = (entry.username || '').toLowerCase();
    const isWhite = h.White.toLowerCase() === uname;
    const meAcc = uname ? (isWhite ? entry.accW : entry.accB) : null;
    let outcome = '½', outcomeCls = 'draw';
    if (h.Result === '1-0') { outcome = uname ? (isWhite ? 'V' : 'D') : '1-0'; outcomeCls = !uname ? 'draw' : (isWhite ? 'win' : 'loss'); }
    else if (h.Result === '0-1') { outcome = uname ? (isWhite ? 'D' : 'V') : '0-1'; outcomeCls = !uname ? 'draw' : (isWhite ? 'loss' : 'win'); }
    const when = new Date(entry.ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    const item = document.createElement('div');
    item.className = 'game-item';
    item.innerHTML = `
      <div class="game-item-main">
        <span class="game-opponent">${h.White} <span class="vs">vs</span> ${h.Black}</span>
        <span class="outcome-badge ${outcomeCls}">${outcome}</span>
      </div>
      <div class="game-item-sub">${when} · prof. ${entry.depth}${meAcc != null ? ' · ta précision ' + meAcc.toFixed(1) + '%' : ` · ${entry.accW.toFixed(1)}% / ${entry.accB.toFixed(1)}%`}
        <button class="mini-del" title="Supprimer">✕</button></div>`;
    item.querySelector('.mini-del').addEventListener('click', (e) => {
      e.stopPropagation();
      saveHistory(loadHistory().filter((x) => x.id !== entry.id));
      renderHistory();
    });
    item.addEventListener('click', () => openFromHistory(entry));
    historyListEl.appendChild(item);
  });
}
function openFromHistory(entry) {
  currentPlies = entry.fens.map((f) => ({ fen: f }));
  currentRecords = entry.records;
  currentHeaders = entry.headers;
  currentUsername = entry.username;
  showTab('analyze');
  setState('done', `${entry.headers.White} vs ${entry.headers.Black} — rechargée depuis l'historique`);
  renderResults(entry.records, entry.headers, entry.username);
}
btnClearHistory.addEventListener('click', () => {
  if (confirm("Effacer tout l'historique d'analyses ?")) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
});

/* =========================================================
   1. Recherche du joueur + liste des parties
   ========================================================= */
const savedUsername = localStorage.getItem('chesscomUsername');
if (savedUsername) usernameInput.value = savedUsername;

btnSearch.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) { setState('idle-error', 'Entre ton pseudo chess.com.'); return; }
  localStorage.setItem('chesscomUsername', username);
  btnSearch.disabled = true;
  gamesListCard.classList.add('hidden');
  resultsEl.classList.add('hidden');
  setState('checking', `Recherche de « ${username} »…`);
  try {
    await checkPlayerExists(username);
    setState('loading', 'Récupération des parties…');
    const games = await fetchRecentGames(username, 20);
    if (games.length === 0) { setState('not-found', `Aucune partie récente pour « ${username} ».`); return; }
    setState('fetch-ok', `${games.length} parties — choisis-en une.`);
    renderGamesList(games, username);
  } catch (e) {
    if (e.message === 'NOT_FOUND') setState('not-found', `Joueur « ${username} » introuvable.`);
    else if (e.message === 'CORS_OR_NETWORK') setState('cors-error', 'Récupération bloquée par le navigateur — colle le PGN plus bas.');
    else setState('error', e.message);
  } finally {
    btnSearch.disabled = false;
  }
});
usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSearch.click(); });

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
    const date = g.end_time ? new Date(g.end_time * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
    const item = document.createElement('div');
    item.className = 'game-item';
    item.innerHTML = `
      <div class="game-item-main">
        <span class="game-color-dot ${isWhite ? 'w' : 'b'}"></span>
        <span class="game-opponent">vs ${opponent}</span>
        <span class="outcome-badge ${outcomeCls}">${outcome}</span>
      </div>
      <div class="game-item-sub">${date} · ${g.time_class || ''}</div>`;
    item.addEventListener('click', () => runAnalysis(g.pgn, username));
    gamesListEl.appendChild(item);
  });
}

btnAnalyzePaste.addEventListener('click', async () => {
  const pgn = pgnTextarea.value.trim();
  if (!pgn) { setState('idle-error', 'Colle un PGN d\'abord.'); return; }
  await runAnalysis(pgn, usernameInput.value.trim());
});

/* =========================================================
   2. Lancement de l'analyse
   ========================================================= */
let currentPlies = null;
let currentRecords = null;
let currentPly = 0;
let currentHeaders = null;
let currentUsername = null;

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
    setState('error', 'PGN illisible : ' + e.message);
    return;
  }
  const depth = parseInt(depthSelect.value, 10);
  const totalMoves = plies.length - 1;
  resultsEl.classList.add('hidden');
  gamesListCard.classList.add('hidden');

  const eng = getEngine();
  setState('analyzing', 'Chargement de Stockfish…');
  try {
    await withTimeout(eng.readyPromise, 15000, 'Stockfish ne répond pas — recharge la page.');
  } catch (e) { setState('error', e.message); return; }

  setState('analyzing', `Analyse 0 / ${totalMoves}`);
  let records;
  try {
    records = await analyzeGame(eng, plies, depth, (done, total) => {
      setState('analyzing', `Analyse ${done} / ${total}`);
    });
  } catch (e) {
    setState('error', 'Erreur moteur : ' + (e && e.message ? e.message : e));
    return;
  }
  setState('done', `${headers.White || '?'} vs ${headers.Black || '?'} ${headers.Result || ''}`);
  currentPlies = plies;
  currentRecords = records;
  currentHeaders = headers;
  currentUsername = username;
  saveAnalysisToHistory(plies, records, headers, username, depth);
  try {
    renderResults(records, headers, username);
  } catch (e) {
    setState('error', "Erreur d'affichage : " + (e && e.message ? e.message : e));
  }
}

/* =========================================================
   3. Résultats
   ========================================================= */
function renderResults(records, headers, username) {
  resultsEl.classList.remove('hidden');
  buildBoardGrid();

  resultsTitleEl.textContent = (headers.White || 'Blancs') + '  —  ' + (headers.Black || 'Noirs');

  const uname = (username || '').toLowerCase();
  const whiteIsUser = (headers.White || '').toLowerCase() === uname;
  const blackIsUser = (headers.Black || '').toLowerCase() === uname;

  const byColor = { w: [], b: [] };
  records.forEach((r) => byColor[r.color].push(r));
  const nonBook = (arr) => arr.filter((r) => r.cls !== 'book' && r.cls !== 'forced');
  const wReal = nonBook(byColor.w), bReal = nonBook(byColor.b);
  const accW = gameAccuracy(records, 'w').acc, accB = gameAccuracy(records, 'b').acc;
  const MIN_MOVES_FOR_ELO = 8;
  const eloTextFor = (arr, acc) => arr.length >= MIN_MOVES_FOR_ELO ? '≈ ' + estimatedEloFromAccuracy(acc) : '—';

  const sideCard = (name, isUser, elo, acc, arr) => `
    <div class="side-summary">
      <div class="side-name">${name}${isUser ? ' <span class="you">toi</span>' : ''}</div>
      <div class="side-acc">${acc.toFixed(1)}<span class="pct">%</span></div>
      <div class="side-sub">Elo ${elo || '?'} · estimé ${eloTextFor(arr, acc)}</div>
    </div>`;
  summaryEl.innerHTML =
    sideCard(headers.White || 'Blancs', whiteIsUser, headers.WhiteElo, accW, wReal) +
    sideCard(headers.Black || 'Noirs', blackIsUser, headers.BlackElo, accB, bReal);

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
  if (mateWhite != null) {
    if (Math.abs(mateWhite) === 0) return '#'; // mat sur l'echiquier
    return (mateWhite > 0 ? 'M' : '−M') + Math.abs(mateWhite);
  }
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
  cell.addEventListener('click', () => goToPly(plyIndex));
  return cell;
}

/* ---- Navigation ---- */
function goToPly(ply) {
  if (!currentPlies) return;
  currentPly = Math.max(0, Math.min(ply, currentRecords.length));
  manualArrows = [];
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
$('btnStart').addEventListener('click', () => goToPly(0));
$('btnPrev').addEventListener('click', () => goToPly(currentPly - 1));
$('btnNext').addEventListener('click', () => goToPly(currentPly + 1));
$('btnEnd').addEventListener('click', () => goToPly(currentRecords ? currentRecords.length : 0));

// La bande sous le plateau porte le nom du coup + sa classification en
// couleur — c'est elle qui "met du texte sur le coup" au lieu de charger la
// flèche elle-même.
function updateMoveInfo() {
  if (!currentRecords) { moveInfoEl.innerHTML = ''; return; }
  if (currentPly === 0) { moveInfoEl.innerHTML = '<span class="mi-start">Position de départ</span>'; return; }
  const rec = currentRecords[currentPly - 1];
  const meta = CLASS_META[rec.cls];
  const num = Math.ceil(currentPly / 2);
  const dots = rec.color === 'w' ? '.' : '…';
  let html = `<span class="mi-move">${num}${dots} ${rec.san}</span>
    <span class="mi-chip" style="color:${meta.color};border-color:${meta.color}55;background:${meta.color}18">${meta.symbol} ${meta.label}</span>
    <span class="mi-eval">${formatEval(rec.evalCpWhite, rec.evalMateWhite)}</span>`;
  moveInfoEl.innerHTML = html;
}

/* =========================================================
   4. Plateau — grille de fond fixe + calque de pièces séparé.
   Les pièces ne vivent plus DANS les cases de la grille : de gros
   glyphes texte dans des cellules 1fr forçaient la hauteur des
   rangées et déformaient le plateau à chaque coup. Ici la grille ne
   contient que des cases vides (indéformable), et les pièces sont
   posées au-dessus en position absolue (% de la taille du plateau),
   ce qui permet en plus d'animer les déplacements.
   ========================================================= */
function updateEvalBar(record) {
  let cp = 0, mate = null;
  if (record) { cp = record.evalCpWhite || 0; mate = record.evalMateWhite; }
  const capped = Math.max(-1000, Math.min(1000, cp));
  const pct = mate != null ? (mate > 0 ? 100 : 0) : 50 + (capped / 1000) * 50;
  evalFillEl.style.height = pct + '%';
  const whiteAhead = mate != null ? mate > 0 : cp >= 0;
  evalLabelEl.textContent = mate != null ? ('M' + Math.abs(mate)) : (cp / 100).toFixed(1);
  evalLabelEl.classList.toggle('on-dark', !whiteAhead);
}

function buildBoardGrid() {
  boardGrid.querySelectorAll('.sq').forEach((n) => n.remove());
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const sqEl = document.createElement('div');
    sqEl.className = 'sq ' + ((x + y) % 2 === 1 ? 'dark' : 'light');
    sqEl.dataset.x = x; sqEl.dataset.y = y;
    // coordonnées discrètes sur les bords
    if (x === 0) sqEl.innerHTML += `<span class="coord rank">${8 - y}</span>`;
    if (y === 7) sqEl.innerHTML += `<span class="coord file">${'abcdefgh'[x]}</span>`;
    boardGrid.insertBefore(sqEl, pieceLayer);
  }
  syncPieceFontSize();
}
function syncPieceFontSize() {
  const w = boardGrid.getBoundingClientRect().width;
  if (w > 0) boardGrid.style.setProperty('--piece-size', (w / 8) * 0.78 + 'px');
}
window.addEventListener('resize', () => { syncPieceFontSize(); renderAutoArrows(); });
window.addEventListener('orientationchange', () => setTimeout(() => { syncPieceFontSize(); renderAutoArrows(); }, 200));

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
// Réutilise les éléments de pièces existants (par identité type+couleur la
// plus proche) pour que les déplacements soient animés par transition CSS.
function renderPosition(fen) {
  const board = fenToBoardArray(fen);
  const wanted = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = board[y][x];
    if (p) wanted.push({ x, y, key: p.color + p.type });
  }
  const existing = [...pieceLayer.querySelectorAll('.piece')];
  const used = new Set();
  const leftovers = [];
  // 1er passage : pièce déjà à la bonne case
  wanted.forEach((wp) => {
    const hit = existing.find((el) => !used.has(el) && el.dataset.key === wp.key && el.dataset.x == wp.x && el.dataset.y == wp.y);
    if (hit) { used.add(hit); wp.el = hit; }
  });
  // 2e passage : même pièce ailleurs -> on la déplace (animation)
  wanted.forEach((wp) => {
    if (wp.el) return;
    const hit = existing.find((el) => !used.has(el) && el.dataset.key === wp.key);
    if (hit) { used.add(hit); wp.el = hit; }
  });
  existing.forEach((el) => { if (!used.has(el)) el.remove(); });
  wanted.forEach((wp) => {
    let el = wp.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'piece ' + (wp.key[0] === 'w' ? 'white' : 'black');
      el.dataset.key = wp.key;
      el.textContent = PIECE_GLYPH[wp.key[0]][wp.key[1]];
      pieceLayer.appendChild(el);
    }
    el.dataset.x = wp.x; el.dataset.y = wp.y;
    el.style.transform = `translate(${wp.x * 100}%, ${wp.y * 100}%)`;
  });
}

/* ---- Flèches ---- */
let manualArrows = [];
let drawMode = false;
let drawColor = DRAW_COLORS[0];
let dragStart = null;

function buildDrawPalette() {
  const drawPalette = $('drawPalette');
  drawPalette.innerHTML = '';
  DRAW_COLORS.forEach((c) => {
    const sw = document.createElement('div');
    sw.className = 'draw-swatch' + (c === drawColor ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => { drawColor = c; buildDrawPalette(); });
    drawPalette.appendChild(sw);
  });
}
$('btnDrawMode').addEventListener('click', () => {
  drawMode = !drawMode;
  $('btnDrawMode').classList.toggle('active', drawMode);
  $('drawPalette').classList.toggle('hidden', !drawMode);
});
$('btnClearDraw').addEventListener('click', () => { manualArrows = []; renderAutoArrows(); });

/* ---- Dictionnaire des types de coups ---- */
const DICO_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss'];
const DICO_DESC = {
  brilliant: 'sacrifice fort et justifié',
  great: 'coup qui change l\'issue de la partie',
  best: 'le choix du moteur',
  excellent: 'quasi aussi bon que le meilleur',
  good: 'solide, légère perte',
  book: 'coup d\'ouverture connu',
  forced: 'seul coup raisonnable',
  inaccuracy: 'perte légère mais réelle',
  mistake: 'perte sérieuse',
  blunder: 'perte décisive',
  miss: 'gain ou mat raté',
};
function buildDico() {
  const panel = $('dicoPanel');
  panel.innerHTML = DICO_ORDER.map((key) => {
    const m = CLASS_META[key];
    return `<div class="dico-item">
      <span class="dico-pin" style="background:${m.color}">${m.symbol}</span>
      <span class="dico-label">${m.label}<span class="dico-desc">${DICO_DESC[key]}</span></span>
    </div>`;
  }).join('');
}
$('btnDico').addEventListener('click', () => {
  const panel = $('dicoPanel');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  $('btnDico').classList.toggle('active', opening);
  if (opening && !panel.childElementCount) buildDico();
});

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
function getSquareFromEvent(e) {
  const r = boardGrid.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
  const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  return { x, y };
}

// Flèche effilée dessinée d'un seul tracé (corps qui s'affine + tête),
// plus fine et plus élégante que l'ancienne ligne épaisse à marker.
function taperedArrowPath(x1, y1, x2, y2, sq) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const startOffset = sq * 0.30;
  x1 += Math.cos(angle) * startOffset; y1 += Math.sin(angle) * startOffset;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const headLen = Math.min(sq * 0.34, len * 0.45);
  const bx = x2 - Math.cos(angle) * headLen, by = y2 - Math.sin(angle) * headLen;
  const wTail = sq * 0.055, wBase = sq * 0.09, wHead = sq * 0.19;
  const px = -Math.sin(angle), py = Math.cos(angle);
  const pts = [
    [x1 + px * wTail, y1 + py * wTail],
    [bx + px * wBase, by + py * wBase],
    [bx + px * wHead, by + py * wHead],
    [x2, y2],
    [bx - px * wHead, by - py * wHead],
    [bx - px * wBase, by - py * wBase],
    [x1 - px * wTail, y1 - py * wTail],
  ];
  return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' Z';
}

function renderAutoArrows() {
  const rect = boardGrid.getBoundingClientRect();
  const size = rect.width;
  if (!size) return;
  const sq = size / 8;
  arrowSvg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  arrowSvg.innerHTML = '';
  const center = (c) => c * sq + sq / 2;

  const drawOne = (from, to, color, opts = {}) => {
    const d = taperedArrowPath(center(from.x), center(from.y), center(to.x), center(to.y), sq);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color);
    path.setAttribute('opacity', opts.opacity != null ? opts.opacity : 0.9);
    path.setAttribute('stroke', 'rgba(10,10,10,0.35)');
    path.setAttribute('stroke-width', '1');
    if (opts.dashed) { path.setAttribute('fill-opacity', 0.45); path.setAttribute('stroke-dasharray', '4,3'); }
    arrowSvg.appendChild(path);
  };
  // Pastille de classification sur la case d'arrivée du coup joué,
  // façon Chess.com.
  const drawBadge = (to, meta) => {
    const cx = to.x * sq + sq * 0.80, cy = to.y * sq + sq * 0.20, r = sq * 0.19;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
    circle.setAttribute('fill', meta.color);
    circle.setAttribute('stroke', 'rgba(12,12,12,0.55)');
    circle.setAttribute('stroke-width', '1.2');
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', cx); txt.setAttribute('y', cy);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('font-size', r * 1.15);
    txt.setAttribute('font-family', 'inherit');
    txt.setAttribute('font-weight', 'bold');
    txt.setAttribute('fill', '#14181c');
    txt.textContent = meta.symbol;
    g.appendChild(circle); g.appendChild(txt);
    arrowSvg.appendChild(g);
  };

  if (currentRecords && currentPly > 0) {
    // Flèche du coup qui VIENT d'être joué (on regarde la position après
    // coup, la flèche montre d'où il vient), colorée par sa classification.
    const rec = currentRecords[currentPly - 1];
    const meta = CLASS_META[rec.cls];
    if (rec.playedMove) {
      drawOne(rec.playedMove.from, rec.playedMove.to, meta.color, { opacity: 0.85 });
      drawBadge(rec.playedMove.to, meta);
    }
  }
  if (currentRecords && currentPly < currentRecords.length) {
    // Suggestion du moteur pour le coup SUIVANT, discrète.
    const next = currentRecords[currentPly];
    if (next.bestMove) drawOne(next.bestMove.from, next.bestMove.to, '#2fb3ab', { dashed: true, opacity: 0.8 });
  }
  manualArrows.forEach((a) => drawOne(a.from, a.to, a.color));
}

buildDrawPalette();

/* =========================================================
   5. Export CSV
   ========================================================= */
function csvEscape(field) {
  const s = String(field == null ? '' : field);
  return (s.includes(';') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(fields) { return fields.map(csvEscape).join(';') + '\r\n'; }
function exportCSV() {
  if (!currentRecords) return;
  let csv = csvRow(['Coup', 'Type de coup', 'Éval']);
  for (let i = 0; i < currentRecords.length; i++) {
    const rec = currentRecords[i];
    const num = Math.ceil((i + 1) / 2);
    const moveLabel = (i % 2 === 0 ? num + '. ' : num + '... ') + rec.san;
    const clsLabel = CLASS_META[rec.cls] ? CLASS_META[rec.cls].label : rec.cls;
    csv += csvRow([moveLabel, clsLabel, formatEval(rec.evalCpWhite, rec.evalMateWhite)]);
  }
  const byColor = { w: [], b: [] };
  currentRecords.forEach((r) => byColor[r.color].push(r));
  const nonBook = (arr) => arr.filter((r) => r.cls !== 'book' && r.cls !== 'forced');
  const wReal = nonBook(byColor.w), bReal = nonBook(byColor.b);
  const accW = gameAccuracy(currentRecords, 'w').acc, accB = gameAccuracy(currentRecords, 'b').acc;
  const h = currentHeaders || {};
  const MIN_MOVES_FOR_ELO = 8;
  const eloText = (arr, acc) => arr.length >= MIN_MOVES_FOR_ELO ? String(estimatedEloFromAccuracy(acc)) : 'non estimable';
  csv += '\r\n';
  csv += csvRow(['Bilan général', '', '']);
  csv += csvRow(['', 'Blancs — ' + (h.White || '?'), 'Noirs — ' + (h.Black || '?')]);
  csv += csvRow(['Précision', accW.toFixed(2) + '%', accB.toFixed(2) + '%']);
  csv += csvRow(['Elo officiel', h.WhiteElo || '?', h.BlackElo || '?']);
  csv += csvRow(['Elo estimé sur cette partie', eloText(wReal, accW), eloText(bReal, accB)]);
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
$('btnExportCSV').addEventListener('click', exportCSV);

/* =========================================================
   Init : moteur préchargé en arrière-plan
   ========================================================= */
getEngine();
