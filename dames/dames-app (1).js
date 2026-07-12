/* =========================================================
   dames-app.js — Analyse de parties Lidraughts avec Scan.
   Pipeline de classification et de précision repris de l'outil
   échecs (points attendus, seuils Chess.com V2, précision
   Lichess pondérée volatilité + harmonique).
   Différences dames :
   - Scan n'a pas de MultiPV -> pas de "Brillant"/"Excellent coup",
     et "Forcé" = un seul coup légal (fréquent avec les rafles) ;
   - "gain forcé en N" (winIn) joue le rôle du "mat en N" ;
   - pas de base d'ouvertures libre -> Théorie heuristique
     (8 premiers demi-coups quasi sans perte).
   ========================================================= */

/* ---- Points attendus & précision (repris de l'outil échecs) ---- */
const EP_SCALE = 400; // à calibrer contre l'analyse serveur Lidraughts
function expectedPoints(entry) {
  // entry: { cp, winIn } POV Blancs. winIn signé (positif = Blancs gagnent).
  if (entry.winIn != null && entry.winIn !== 0) return entry.winIn > 0 ? 1 : 0;
  return 1 / (1 + Math.pow(10, -(entry.cp || 0) / EP_SCALE));
}
function moveAccuracy(epLossPct) {
  const a = 103.1668 * Math.exp(-0.04354 * epLossPct) - 3.1669;
  return Math.max(0, Math.min(100, a));
}
function gameAccuracy(allRecords, color) {
  const wp = [50];
  for (const r of allRecords) wp.push(expectedPoints({ cp: r.evalCpWhite, winIn: r.winInWhite }) * 100);
  const windowSize = Math.max(2, Math.min(8, Math.floor(wp.length / 10)));
  const accs = [], weights = [];
  for (let i = 0; i < allRecords.length; i++) {
    const r = allRecords[i];
    if (r.color !== color) continue;
    if (r.cls === 'book' || r.cls === 'forced') continue;
    accs.push(moveAccuracy(r.lossCp));
    const lo = Math.max(0, i + 1 - windowSize);
    const sub = wp.slice(lo, i + 2);
    const m = sub.reduce((s, x) => s + x, 0) / sub.length;
    const sd = Math.sqrt(sub.reduce((s, x) => s + (x - m) * (x - m), 0) / sub.length);
    weights.push(Math.max(0.5, Math.min(12, sd)));
  }
  if (!accs.length) return { acc: 0, n: 0 };
  let num = 0, den = 0;
  accs.forEach((a, k) => { num += a * weights[k]; den += weights[k]; });
  let hNum = 0, hDen = 0;
  accs.forEach((a, k) => { const w = Math.sqrt(weights[k]); hNum += w; hDen += w / Math.max(a, 5); });
  return { acc: (num / den + hNum / hDen) / 2, n: accs.length };
}
// Table précision -> Elo reprise de l'outil échecs. ATTENTION : calibrée sur
// des parties d'ÉCHECS Chess.com — pour les dames c'est un ordre de grandeur
// en attendant une calibration contre les ratings Lidraughts.
const ACC_ELO_ANCHORS = [
  { acc: 50, elo: 250 }, { acc: 60, elo: 550 }, { acc: 67, elo: 800 },
  { acc: 73, elo: 1000 }, { acc: 80, elo: 1200 }, { acc: 86, elo: 1350 },
  { acc: 91, elo: 1500 }, { acc: 94.9, elo: 1650 }, { acc: 96.5, elo: 1800 },
  { acc: 97.5, elo: 2000 }, { acc: 98.5, elo: 2300 }, { acc: 99.3, elo: 2650 }, { acc: 99.8, elo: 2900 },
];
function estimatedEloFromAccuracy(acc) {
  if (acc <= ACC_ELO_ANCHORS[0].acc) return ACC_ELO_ANCHORS[0].elo;
  const last = ACC_ELO_ANCHORS[ACC_ELO_ANCHORS.length - 1];
  if (acc >= last.acc) return last.elo;
  for (let i = 0; i < ACC_ELO_ANCHORS.length - 1; i++) {
    const a = ACC_ELO_ANCHORS[i], b = ACC_ELO_ANCHORS[i + 1];
    if (acc <= b.acc) return Math.round(a.elo + (acc - a.acc) / (b.acc - a.acc) * (b.elo - a.elo));
  }
  return last.elo;
}

const CLASS_META = {
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
const CLASS_SEVERITY = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
function worsenBy(cls, steps) {
  const i = CLASS_SEVERITY.indexOf(cls);
  if (i === -1) return cls;
  return CLASS_SEVERITY[Math.min(CLASS_SEVERITY.length - 1, i + steps)];
}

/* ---- Coup hub Scan : "32-28" ou "33x6x11" (départ x arrivée x prises) ---- */
function parseHubMove(str) {
  if (!str) return null;
  if (str.includes('x')) {
    const parts = str.split('x').map((n) => parseInt(n, 10));
    return { from: parts[0], to: parts[1], captured: parts.slice(2).sort((a, b) => a - b) };
  }
  const [f, t] = str.split('-').map((n) => parseInt(n, 10));
  return { from: f, to: t, captured: [] };
}
function sameMove(hub, move) {
  if (!hub || !move) return false;
  if (hub.from !== move.from || hub.to !== move.to) return false;
  const c = [...move.captured].sort((a, b) => a - b);
  if (hub.captured.length !== c.length) return false;
  return hub.captured.every((v, i) => v === c[i]);
}

/* ---- Détection du coup Brillant (spécifique dames) ----
   Aux dames, les prises sont OBLIGATOIRES : après un coup, toute la
   séquence d'échanges forcés est calculable exactement (petit minimax
   matériel sur les positions où le camp au trait a une prise).
   Signature d'un coup brillant = un SACRIFICE assumé :
   - combinaison : on investit du matériel (déficit temporaire) et la
     séquence forcée le rend avec intérêts (gain net >= +1) ;
   - gros investissement (déficit >= 2 pièces à un moment) ;
   - sacrifice positionnel : matériel jamais rendu mais position >= égale.
   Le tout seulement si le coup est (quasi) le meilleur, qu'il y avait un
   vrai choix (pas un coup forcé), et que la position n'était pas déjà
   totalement gagnée. Valeurs : pion 1, dame 1.6. */
function pieceValue(p) { return p.king ? 1.6 : 1; }
function materialOf(board, color) {
  let v = 0;
  for (const p of board) if (p && p.color === color) v += pieceValue(p);
  return v;
}
// Minimax matériel sur la séquence de prises forcées uniquement.
// Retourne { net, minDeficit } du point de vue de `mover`, où net est le
// delta matériel (mover - adversaire) par rapport à `ref`, et minDeficit le
// pire creux rencontré le long de la ligne principale.
function forcedExchangeOutcome(state, mover, ref, depth) {
  const netNow = (materialOf(state.board, mover) - materialOf(state.board, mover === 'w' ? 'b' : 'w')) - ref;
  if (depth <= 0) return { net: netNow, minDeficit: netNow };
  const moves = dLegalMoves(state);
  if (!moves.length || !moves[0].captured.length) {
    return { net: netNow, minDeficit: netNow }; // plus de prise forcée : la poussière retombe
  }
  const maximizing = state.turn === mover;
  let best = null;
  for (const m of moves) {
    const sub = forcedExchangeOutcome(dApplyMove(state, m), mover, ref, depth - 1);
    if (!best || (maximizing ? sub.net > best.net : sub.net < best.net)) best = sub;
  }
  return { net: best.net, minDeficit: Math.min(netNow, best.minDeficit) };
}
function detectBrilliant(prevState, move, mover, opts) {
  if (opts.nLegal <= 1) return null;                    // pas de mérite sans choix
  if (!(opts.matchesBest || opts.epLoss <= 0.02)) return null;
  if (opts.epBefore >= 0.90 || opts.epAfterMover < 0.45) return null;
  const ref = materialOf(prevState.board, mover) - materialOf(prevState.board, mover === 'w' ? 'b' : 'w');
  const after = dApplyMove(prevState, move);
  const out = forcedExchangeOutcome(after, mover, ref, 12);
  if (out.net >= 1 && out.minDeficit <= -1) {
    return 'Combinaison : sacrifie du matériel que la séquence forcée rend avec intérêts (+' + out.net.toFixed(1).replace('.0', '') + ').';
  }
  if (out.minDeficit <= -2) {
    return 'Sacrifice profond : jusqu\'à ' + Math.abs(out.minDeficit).toFixed(1).replace('.0', '') + ' pièces investies dans la séquence forcée.';
  }
  if (out.net <= -1 && opts.epAfterMover >= 0.5) {
    return 'Sacrifice positionnel : matériel donné sans retour immédiat, mais la position le justifie.';
  }
  return null;
}

/* ---- Analyse d'une partie ----
   plies: sortie de dReplayMoves. Rend des records compatibles avec le
   pipeline échecs (evalCpWhite / winInWhite / lossCp / cls / note). */
async function analyzeDraughtsGame(engine, plies, depth, onProgress) {
  const records = [];
  // éval de chaque position (POV camp au trait -> convertie POV Blancs)
  const evals = [];
  for (let i = 0; i < plies.length; i++) {
    const st = dFenToState(plies[i].fen);
    const isWhiteTurn = st.turn === 'w';
    const nLegal = dLegalMoves(st).length;
    let r;
    if (nLegal === 0) {
      // camp au trait bloqué/sans pièce = perdu
      r = { scoreCp: -10000, winIn: -0, bestMove: null, pv: [] };
      r.winIn = -1;
    } else {
      r = await engine.analyze(dToScanFen(st), { depth });
    }
    evals.push({
      cpWhite: isWhiteTurn ? r.scoreCp : -r.scoreCp,
      winInWhite: r.winIn != null ? (isWhiteTurn ? r.winIn : -r.winIn) : null,
      bestMoveHub: parseHubMove(r.bestMove),
      pv: r.pv || [], // la variante complète du moteur (format hub)
      nLegal,
    });
    if (onProgress) onProgress(i, plies.length - 1);
  }
  for (let i = 1; i < plies.length; i++) {
    const mover = i % 2 === 1 ? 'w' : 'b'; // les Blancs commencent toujours
    const before = evals[i - 1], after = evals[i];
    const epBeforeWhite = expectedPoints({ cp: before.cpWhite, winIn: before.winInWhite });
    const epAfterWhite = expectedPoints({ cp: after.cpWhite, winIn: after.winInWhite });
    const epBefore = mover === 'w' ? epBeforeWhite : 1 - epBeforeWhite;
    const epAfterMover = mover === 'w' ? epAfterWhite : 1 - epAfterWhite;
    const epLoss = Math.max(0, epBefore - epAfterMover);
    const epLossPct = epLoss * 100;
    const move = plies[i].move;
    const matchesBest = sameMove(before.bestMoveHub, move);
    const isForced = before.nLegal === 1;

    let cls = 'good';
    let note = null;
    if (isForced) {
      cls = 'forced';
      note = move.captured.length ? 'Prise obligatoire : une seule rafle légale (prise majoritaire).' : 'Un seul coup légal dans cette position.';
    } else if (i <= 8 && epLoss <= 0.03) {
      cls = 'book'; // heuristique : pas de base d'ouvertures dames libre
    } else if (matchesBest || epLoss <= 0.0001) {
      cls = 'best';
    } else if (epLoss <= 0.02) cls = 'excellent';
    else if (epLoss <= 0.05) cls = 'good';
    else if (epLoss <= 0.10) cls = 'inaccuracy';
    else if (epLoss <= 0.20) cls = 'mistake';
    else cls = 'blunder';

    if (cls !== 'book' && cls !== 'forced') {
      // Gain forcé raté (équivalent "mat perdu") : gain en N disponible,
      // coup joué le laisse filer en restant gagnant -> Occasion manquée.
      const hadWin = before.winInWhite != null && (mover === 'w' ? before.winInWhite > 0 : before.winInWhite < 0);
      const keptWin = after.winInWhite != null && (mover === 'w' ? after.winInWhite > 0 : after.winInWhite < 0);
      if (hadWin && !keptWin && !matchesBest && epAfterMover >= 0.5) {
        cls = 'miss';
        note = 'Un gain forcé en ' + Math.abs(before.winInWhite) + ' était disponible.';
      }
      // Autorise une perte forcée alors que la meilleure défense l'évitait.
      const bestAvoided = before.winInWhite == null || (mover === 'w' ? before.winInWhite >= 0 : before.winInWhite <= 0);
      const nowLosing = after.winInWhite != null && (mover === 'w' ? after.winInWhite < 0 : after.winInWhite > 0);
      if (bestAvoided && nowLosing && (before.winInWhite == null)) {
        const bestCpMover = mover === 'w' ? before.cpWhite : -before.cpWhite;
        note = 'Autorise une perte forcée en ' + Math.abs(after.winInWhite) + (bestCpMover <= -700 ? ' (position déjà désespérée).' : '.');
        const atLeast = bestCpMover <= -700 ? 'mistake' : 'blunder';
        if (CLASS_SEVERITY.indexOf(cls) < CLASS_SEVERITY.indexOf(atLeast)) cls = atLeast;
      }
      // Saturation : position déjà pliée des deux côtés, perte réelle mesurée
      // sur l'éval brute.
      const sat = (epBefore > 0.90 || epBefore < 0.10) && (epAfterMover > 0.90 || epAfterMover < 0.10);
      if (sat && before.winInWhite == null && after.winInWhite == null && cls !== 'miss') {
        const bestRaw = mover === 'w' ? before.cpWhite : -before.cpWhite;
        const afterRaw = mover === 'w' ? after.cpWhite : -after.cpWhite;
        const swing = bestRaw - afterRaw;
        if (swing >= 150) note = 'Position déjà décidée : perte réelle de ' + (swing / 100).toFixed(1) + ' pion(s) sur l\'éval brute.';
        if (swing >= 900) cls = worsenBy(cls, 3);
        else if (swing >= 400) cls = worsenBy(cls, 2);
        else if (swing >= 150) cls = worsenBy(cls, 1);
      }
    }
    // ★ Brillant : bonus qui S'AJOUTE au verdict (Meilleur coup + Brillant),
    // il ne remplace jamais la classification.
    let brilliant = null;
    if (!['book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss'].includes(cls)) {
      const prevState = dFenToState(plies[i - 1].fen);
      brilliant = detectBrilliant(prevState, move, mover, {
        nLegal: before.nLegal, matchesBest, epLoss, epBefore, epAfterMover,
      });
      if (brilliant && !note) note = brilliant;
    }
    records.push({
      ply: i, color: mover, notation: plies[i].notation, cls, note, brilliant: !!brilliant,
      lossCp: epLossPct, fen: plies[i].fen,
      playedMove: { from: move.from, to: move.to, path: move.path, captured: move.captured },
      bestMove: before.bestMoveHub,
      bestPv: before.pv, // pour "jouer la ligne moteur" depuis la position d'avant ce coup
      evalCpWhite: after.cpWhite, winInWhite: after.winInWhite,
    });
  }
  return records;
}
