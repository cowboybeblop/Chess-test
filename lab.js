/* =========================================================
   lab.js — Le Lab : Stockfish contre Stockfish avec objectifs.
   Principe : Stockfish n'a pas de notion de "but", il maximise
   l'évaluation. On le biaise donc PAR LA SÉLECTION : à chaque coup
   on lui demande ses N meilleures lignes (MultiPV), puis on choisit
   parmi les candidates raisonnables (perte plafonnée) celle qui
   maximise  points_attendus + λ · bonus_objectif.
   Les évals récoltées pendant la partie servent directement au
   bilan (classification + précision), sans seconde analyse.
   Dépend des globaux de app.js (Engine, CLASS_META, expectedPoints,
   gameAccuracy, …) et de chess-logic.js.
   ========================================================= */

/* ---- RNG déterministe par partie (variété reproductible) ---- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Objectifs ----
   Chaque objectif = fonction bonus(state, move, ctx) -> [0..1].
   ctx : { ply, rng, usedOpenings, epdAfter, inBook } */
const HOME_ROW = { w: 7, b: 0 };
function pieceAt(state, m) { return state.board[m.from.y][m.from.x]; }
function distKings(state, m, targetColor) {
  const kp = state.kingPos[targetColor];
  return Math.max(Math.abs(m.to.x - kp.x), Math.abs(m.to.y - kp.y));
}
const LAB_GOALS = {
  none: {
    label: 'Stockfish pur',
    desc: 'Joue toujours le meilleur coup.',
    bonus: null, // pas de MultiPV, ligne 1 directe
  },
  bishops: {
    label: 'Autour des fous',
    desc: 'Développe et fait jouer ses fous au maximum.',
    bonus: (state, m, ctx) => {
      const p = pieceAt(state, m);
      if (p.type !== 'b') return 0;
      let b = 0.6;
      if (m.from.y === HOME_ROW[p.color] && ctx.ply <= 20) b += 0.4; // sortir un fou de sa case initiale
      return b;
    },
  },
  knights: {
    label: 'Autour des cavaliers',
    desc: 'Développe et fait jouer ses cavaliers au maximum.',
    bonus: (state, m, ctx) => {
      const p = pieceAt(state, m);
      if (p.type !== 'n') return 0;
      let b = 0.6;
      if (m.from.y === HOME_ROW[p.color] && ctx.ply <= 20) b += 0.4;
      return b;
    },
  },
  attack_king: {
    label: 'Chasse au roi',
    desc: 'Rapproche ses pièces du roi adverse, aime les échecs.',
    bonus: (state, m) => {
      const p = pieceAt(state, m);
      const enemy = p.color === 'w' ? 'b' : 'w';
      const d = distKings(state, m, enemy);
      let b = Math.max(0, (5 - d)) / 5 * 0.7;
      if (m.capture) b += 0.15;
      return b;
    },
  },
  center: {
    label: 'Occupation du centre',
    desc: 'Pions et pièces vers les cases centrales.',
    bonus: (state, m, ctx) => {
      const cx = Math.abs(m.to.x - 3.5), cy = Math.abs(m.to.y - 3.5);
      const central = cx <= 1 && cy <= 1;
      const p = pieceAt(state, m);
      let b = central ? 0.6 : 0;
      if (central && p.type === 'p' && ctx.ply <= 16) b += 0.4;
      return b;
    },
  },
  castle_fast: {
    label: 'Roque express',
    desc: 'Roque le plus vite possible, met son roi à l\'abri.',
    bonus: (state, m, ctx) => {
      if (m.castle) return 1;
      if (ctx.ply > 20) return 0;
      const p = pieceAt(state, m);
      // dégager les cases entre roi et tour
      if ((p.type === 'n' || p.type === 'b') && m.from.y === HOME_ROW[p.color]) return 0.5;
      return 0;
    },
  },
  aggressive: {
    label: 'Agressif',
    desc: 'Prises, échecs, avancées — jamais un pas en arrière.',
    bonus: (state, m) => {
      const p = pieceAt(state, m);
      let b = 0;
      if (m.capture) b += 0.5;
      const fwd = p.color === 'w' ? m.from.y - m.to.y : m.to.y - m.from.y;
      if (fwd > 0) b += 0.25;
      return b;
    },
  },
  vary_openings: {
    label: 'Ouverture différente à chaque partie',
    desc: 'Suit le livre d\'ouvertures en évitant les lignes déjà jouées dans ce batch.',
    bonus: (state, m, ctx) => {
      if (ctx.ply > 14) return 0;
      if (!ctx.inBook) return 0;
      // en début de batch : aléa fort pour disperser ; ensuite : éviter le déjà-vu
      let b = 0.35 + ctx.rng() * 0.4;
      if (ctx.usedOpenings.has(ctx.epdAfter)) b -= 0.6; // ligne déjà explorée -> malus
      return b;
    },
  },
};

/* ---- Sélection d'un coup pour un camp ---- */
const LAB_FREEDOM = { strict: 0.03, normal: 0.08, creative: 0.15 }; // perte ep max tolérée vs meilleur

async function labPickMove(engine, state, fen, cfg, side, ctx) {
  const goal = LAB_GOALS[cfg.goals[side]];
  const multipv = goal.bonus ? cfg.multipv : 1;
  const res = await engine.analyze(fen, { depth: cfg.depth, multipv });
  const lines = Object.values(res.lines || {}).filter((l) => l.pv && l.pv.length);
  if (!lines.length || !res.bestMoveUci) return null;
  // candidates : premier coup de chaque ligne MultiPV
  const legal = allLegalMoves(state, state.turn);
  const toUci = (m, promo) => uciOfMoveLab(m, promo);
  const findMove = (uci) => {
    for (const m of legal) {
      if (m.promotion) {
        for (const pr of ['q', 'r', 'b', 'n']) if (toUci(m, pr) === uci) return { ...m, promotionType: pr };
      } else if (toUci(m, null) === uci) return m;
    }
    return null;
  };
  const cands = [];
  for (const l of lines) {
    const mv = findMove(l.pv[0]);
    if (!mv) continue;
    const ep = expectedPoints({ cp: l.cp, mate: l.mate });
    cands.push({ mv, uci: l.pv[0], ep, cp: l.cp, mate: l.mate, multipv: l.multipv });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.ep - a.ep || a.multipv - b.multipv);
  const best = cands[0];
  if (!goal.bonus) return { ...best, bestUci: best.uci, bestEp: best.ep };
  const cap = LAB_FREEDOM[cfg.freedom] || 0.08;
  const lambda = 0.10;
  let chosen = best, chosenScore = -Infinity;
  for (const c of cands) {
    if (best.ep - c.ep > cap) continue;             // trop cher : hors budget
    if (c.mate != null && c.mate < 0) continue;      // jamais un mat contre soi volontaire
    const b = goal.bonus(state, c.mv, ctx) || 0;
    const score = c.ep + lambda * b + ctx.rng() * 0.002; // micro-aléa départage
    if (score > chosenScore) { chosenScore = score; chosen = c; }
  }
  return { ...chosen, bestUci: best.uci, bestEp: best.ep };
}
function uciOfMoveLab(m, promo) {
  const f = 'abcdefgh';
  return f[m.from.x] + (8 - m.from.y) + f[m.to.x] + (8 - m.to.y) + (m.promotion ? (promo || 'q') : '');
}

/* ---- Une partie du Lab ---- */
async function labPlayGame(engine, cfg, gameIndex, usedOpenings, onTick) {
  const rng = mulberry32(cfg.seed + gameIndex * 7919);
  let state = newState();
  const plies = [{ fen: toFEN(state, 1) }];
  const records = [];
  let stillInBook = true;
  let openingName = null;
  let badEvalStreak = { w: 0, b: 0 };
  let result = '1/2-1/2', endReason = 'limite de coups';

  for (let ply = 1; ply <= cfg.maxPlies; ply++) {
    const mover = state.turn;
    const fen = toFEN(state, Math.ceil(ply / 2));
    const status = gameStatus(state);
    if (status === 'checkmate') { result = mover === 'w' ? '0-1' : '1-0'; endReason = 'mat'; break; }
    if (status === 'stalemate') { result = '1/2-1/2'; endReason = 'pat'; break; }

    const hasBook = typeof OPENING_BOOK !== 'undefined';
    const ctx = {
      ply, rng, usedOpenings,
      epdAfter: null, inBook: false,
    };
    // pré-calcul livre pour le bonus vary_openings : approx sur la position courante
    if (hasBook && stillInBook) {
      ctx.inBook = true;
      ctx.epdAfter = fen.split(' ').slice(0, 4).join(' ');
    }
    const pick = await labPickMove(engine, state, fen, cfg, mover, ctx);
    if (!pick) { result = mover === 'w' ? '0-1' : '1-0'; endReason = 'aucun coup'; break; }

    const san = sanForMove(state, { ...pick.mv, promotionType: pick.mv.promotionType || 'q' });
    const nLegal = allLegalMoves(state, mover).length;
    const next = applyMove(state, pick.mv, pick.mv.promotionType || 'q');
    state = { board: next.board, turn: next.turn, castling: next.castling, enPassant: next.enPassant, kingPos: next.kingPos };
    const newFen = toFEN(state, Math.ceil((ply + 1) / 2));
    plies.push({ fen: newFen });

    // éval POV Blancs de la ligne choisie (référence du bilan)
    const cpWhite = pick.cp != null ? (mover === 'w' ? pick.cp : -pick.cp) : null;
    const mateWhite = pick.mate != null ? (mover === 'w' ? pick.mate : -pick.mate) : null;
    // classification à partir des évals de jeu
    const epBefore = pick.bestEp;               // meilleur dispo pour le joueur
    const epPlayed = pick.ep;                   // ce qu'il a choisi
    const epLoss = Math.max(0, epBefore - epPlayed);
    const epdAfter = newFen.split(' ').slice(0, 4).join(' ');
    const inBookLine = typeof OPENING_BOOK !== 'undefined' ? (stillInBook && OPENING_BOOK.has(epdAfter)) : ply <= 6;
    let cls;
    if (nLegal === 1) cls = 'forced';
    else if (inBookLine) { cls = 'book'; openingName = (typeof OPENING_BOOK !== 'undefined' && OPENING_BOOK.get(epdAfter)) || openingName; usedOpenings.add(epdAfter); }
    else if (pick.uci === pick.bestUci || epLoss <= 0.0001) cls = 'best';
    else if (epLoss <= 0.02) cls = 'excellent';
    else if (epLoss <= 0.05) cls = 'good';
    else if (epLoss <= 0.10) cls = 'inaccuracy';
    else if (epLoss <= 0.20) cls = 'mistake';
    else cls = 'blunder';
    if (cls !== 'book') stillInBook = false;

    records.push({
      ply, color: mover, san, cls, note: null, lossCp: epLoss * 100,
      fen: newFen,
      playedMove: { from: pick.mv.from, to: pick.mv.to },
      bestMove: pick.bestUci ? { from: algToXY(pick.bestUci.slice(0, 2)), to: algToXY(pick.bestUci.slice(2, 4)) } : null,
      evalCpWhite: cpWhite, evalMateWhite: mateWhite,
    });

    // abandon : éval désespérée 4 demi-coups de suite
    const cpMover = pick.cp != null ? pick.cp : (pick.mate > 0 ? 10000 : -10000);
    badEvalStreak[mover] = cpMover <= -900 ? badEvalStreak[mover] + 1 : 0;
    if (badEvalStreak[mover] >= 4) { result = mover === 'w' ? '0-1' : '1-0'; endReason = 'abandon (éval)'; break; }
    if (onTick) onTick(ply, san);
  }
  // adjudication si limite atteinte sans fin naturelle
  if (endReason === 'limite de coups' && records.length) {
    const last = records[records.length - 1];
    const cp = last.evalMateWhite != null ? (last.evalMateWhite > 0 ? 10000 : -10000) : (last.evalCpWhite || 0);
    if (cp >= 300) { result = '1-0'; endReason = 'adjudication (+' + (cp / 100).toFixed(1) + ')'; }
    else if (cp <= -300) { result = '0-1'; endReason = 'adjudication (' + (cp / 100).toFixed(1) + ')'; }
    else endReason = 'adjudication (égalité)';
  }
  const accW = gameAccuracy(records, 'w').acc;
  const accB = gameAccuracy(records, 'b').acc;
  return { plies, records, result, endReason, openingName: openingName || 'Hors livre', accW, accB };
}

/* ---- Le batch ---- */
let labRunning = false;
let labResults = [];

async function labRun() {
  if (labRunning) return;
  const cfg = {
    goals: { w: $('labGoalW').value, b: $('labGoalB').value },
    depth: parseInt($('labDepth').value, 10),
    maxPlies: parseInt($('labMaxMoves').value, 10) * 2,
    games: Math.max(1, Math.min(100, parseInt($('labGames').value, 10) || 1)),
    freedom: $('labFreedom').value,
    multipv: 6,
    seed: Date.now() % 100000,
  };
  labRunning = true;
  labResults = [];
  $('btnLabRun').classList.add('hidden');
  $('btnLabStop').classList.remove('hidden');
  $('labResults').innerHTML = '';
  $('labSummary').classList.add('hidden');
  const usedOpenings = new Set();
  const eng = getEngine();
  await eng.readyPromise;
  const t0 = Date.now();
  for (let g = 0; g < cfg.games && labRunning; g++) {
    $('labStatus').innerHTML = `<span class="status-icon spin">◌</span> Partie ${g + 1}/${cfg.games} — coup 0`;
    $('labStatus').className = 'status loading';
    const game = await labPlayGame(eng, cfg, g, usedOpenings, (ply, san) => {
      $('labStatus').innerHTML = `<span class="status-icon spin">◌</span> Partie ${g + 1}/${cfg.games} — ${Math.ceil(ply / 2)}. ${san}`;
    });
    if (!labRunning) break;
    labResults.push(game);
    labRenderRow(game, g);
    labRenderSummary(cfg);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  $('labStatus').innerHTML = labRunning ? `● Batch terminé : ${labResults.length} parties en ${dt}s` : `● Arrêté : ${labResults.length} parties jouées`;
  $('labStatus').className = 'status success';
  labRunning = false;
  $('btnLabRun').classList.remove('hidden');
  $('btnLabStop').classList.add('hidden');
}

function labRenderRow(game, idx) {
  const item = document.createElement('div');
  item.className = 'game-item';
  const rCls = game.result === '1-0' ? 'win' : game.result === '0-1' ? 'loss' : 'draw';
  const accBar = (acc, color) => `
    <div class="lab-accbar"><div class="lab-accfill" style="width:${Math.max(2, acc).toFixed(1)}%;background:${color}"></div>
    <span>${acc.toFixed(1)}%</span></div>`;
  item.innerHTML = `
    <div class="game-item-main">
      <span class="game-opponent">Partie ${idx + 1} — ${game.openingName.split(':')[0]}</span>
      <span class="outcome-badge ${rCls}">${game.result}</span>
    </div>
    <div class="game-item-sub">${Math.ceil(game.records.length / 2)} coups · ${game.endReason}</div>
    <div class="lab-accrow">${accBar(game.accW, '#e9e2cd')}${accBar(game.accB, '#8b9199')}</div>`;
  item.addEventListener('click', () => labOpenGame(game, idx));
  $('labResults').appendChild(item);
}

function labRenderSummary(cfg) {
  if (labResults.length < 2) return;
  const w = labResults.filter((g) => g.result === '1-0').length;
  const b = labResults.filter((g) => g.result === '0-1').length;
  const d = labResults.length - w - b;
  const avg = (sel) => labResults.reduce((s, g) => s + sel(g), 0) / labResults.length;
  const openings = new Set(labResults.map((g) => g.openingName)).size;
  $('labSummary').classList.remove('hidden');
  $('labSummary').innerHTML = `
    <b>${LAB_GOALS[cfg.goals.w].label}</b> ${w} — ${d} — ${b} <b>${LAB_GOALS[cfg.goals.b].label}</b><br>
    Précision moyenne : Blancs ${avg((g) => g.accW).toFixed(1)}% · Noirs ${avg((g) => g.accB).toFixed(1)}%
    · ${openings} ouverture(s) différente(s)`;
}

function labOpenGame(game, idx) {
  currentPlies = game.plies;
  currentRecords = game.records;
  currentHeaders = {
    White: 'SF — ' + LAB_GOALS[$('labGoalW').value].label,
    Black: 'SF — ' + LAB_GOALS[$('labGoalB').value].label,
    Result: game.result, WhiteElo: '', BlackElo: '',
  };
  currentUsername = '';
  showTab('analyze');
  setState('done', `Lab — partie ${idx + 1} (${game.openingName}) ${game.result}`);
  renderResults(currentRecords, currentHeaders, '');
}

// peupler les listes d'objectifs
(function initLabSelects() {
  for (const id of ['labGoalW', 'labGoalB']) {
    const sel = $(id);
    sel.innerHTML = Object.entries(LAB_GOALS).map(([k, g]) =>
      `<option value="${k}" title="${g.desc}">${g.label}</option>`).join('');
  }
  $('labGoalW').value = 'bishops';
  $('labGoalB').value = 'vary_openings';
})();

$('btnLabRun').addEventListener('click', labRun);
$('btnLabStop').addEventListener('click', () => { labRunning = false; });
