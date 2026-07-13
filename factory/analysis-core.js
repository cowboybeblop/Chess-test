// Extrait automatiquement de app.js (pipeline identique à l'outil web).
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
// Table d'ancrage précision (%) -> Elo estimé, calibrée sur des mesures
// RÉELLES faites avec CET outil (lite, prof. 12-20) comparées au "game
// rating" affiché par Chess.com sur la même partie :
//   notre 73.0%  -> Chess.com 1000
//   notre 94.9%  -> Chess.com 1650
// Notre précision lit ~2-3 points plus haut que la leur dans les hautes
// valeurs (moteur lite = moins de micro-défauts détectés), la table le
// compense. Le reste est interpolé — à affiner avec d'autres parties.
const ACC_ELO_ANCHORS = [
  { acc: 50, elo: 250 }, { acc: 60, elo: 550 }, { acc: 67, elo: 800 },
  { acc: 73, elo: 1000 }, { acc: 80, elo: 1200 }, { acc: 86, elo: 1350 },
  { acc: 91, elo: 1500 }, { acc: 94.9, elo: 1650 }, { acc: 96.5, elo: 1800 },
  { acc: 97.5, elo: 2000 }, { acc: 98.5, elo: 2300 }, { acc: 99.3, elo: 2650 },
  { acc: 99.8, elo: 2900 },
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
  // Moyenne harmonique PONDÉRÉE par les mêmes poids de volatilité, avec un
  // plancher par coup. Deux raisons :
  //  - sans pondération, chaque petit coup "bruité" des longues phases mortes
  //    (finales gagnées, positions saturées) compte plein pot dans la
  //    harmonique -> plus la partie est longue, plus la précision s'érode
  //    mécaniquement, même sans vraie faute ;
  //  - sans plancher, un seul coup à ~0% de précision écrase la moyenne
  //    harmonique à lui tout seul (division par presque zéro).
  let hNum = 0, hDen = 0;
  accs.forEach((a, k) => { const w = Math.sqrt(weights[k]); hNum += w; hDen += w / Math.max(a, 5); });
  const harmonic = hNum / hDen;
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
// Seuil bas de la correction de saturation selon l'Elo. Officiel côté
// Chess.com : le modèle de points attendus dépend du rating ("winning /
// losing" bougent avec l'Elo). Concrètement : à 350, on revient d'une
// position à -5, donc y perdre encore un pion reste une vraie faute ;
// à 2000, la partie y est déjà pliée. Calibré sur les annotations NAG
// de la partie de référence (joueur à 351).
function satThresholdForElo(elo) {
  if (!elo) return 150;
  if (elo <= 600) return 80;
  if (elo >= 1800) return 150;
  return Math.round(80 + (elo - 600) * (150 - 80) / 1200);
}

async function analyzeGame(engine, plies, depth, onProgress, opts = {}) {
  const records = [];
  const eloOf = { w: opts.whiteElo || 0, b: opts.blackElo || 0 };
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
    let note = null; // explication affichée en bulle quand une règle spéciale a joué
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
        note = nLegal === 1 ? 'Un seul coup légal dans cette position.'
          : 'Deux coups légaux seulement, d\'issue équivalente d\'après le moteur.';
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
        if (hasBook) {
          const openingName = OPENING_BOOK.get(epdAfter);
          if (openingName) note = openingName;
        }
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
      const lowElo = eloOf[mover] > 0 && eloOf[mover] < 1200;
      const brillGate = lowElo ? 0.035 : 0.02; // chess.com : "more generous for newer players"
      if (sac && (matchesBest || epLoss <= brillGate) && epBefore < 0.85 && epAfterMover >= (lowElo ? 0.35 : 0.4)) {
        cls = 'brilliant';
        note = 'Sacrifice de matériel justifié : la position reste bonne malgré le don.';
      // Great Move : coup décisif pour l'issue (perdant->égal, égal->gagnant,
      // ou seul bon coup dans la position).
      } else if ((matchesBest || epLoss <= 0.02) && (
        (epBefore < 0.4 && epAfterMover >= 0.4) ||
        (epBefore >= 0.4 && epBefore < 0.6 && epAfterMover >= 0.6) ||
        (secondEp !== null && (epBefore - secondEp) >= 0.15)
      )) {
        cls = 'great';
        note = 'Le seul bon coup : toutes les alternatives faisaient basculer la position.';
      // Miss : position gagnante disponible, non convertie.
      } else if (epBefore >= 0.7 && epAfterMover < 0.5 && !matchesBest) {
        cls = 'miss';
        note = 'Une position gagnante était disponible, ce coup la laisse filer.';
      }

      // Miss (cas Chess.com supplémentaire) : un mat forcé était disponible,
      // le coup joué le laisse filer — même si la position reste totalement
      // gagnante. Ex. : mat en 3 sous la main, on joue une prise à +16 sans
      // mat forcé -> "Occasion manquée", pas "Erreur".
      const hadForcedMate = bestLine && bestLine.mate != null && bestLine.mate > 0;
      const keptForcedMate = afterRaw && afterRaw.mate != null && afterRaw.mate < 0; // POV adversaire : négatif = on mate toujours
      if (hadForcedMate && !keptForcedMate && !matchesBest && !isCheckmate && epAfterMover >= 0.5) {
        cls = 'miss';
        note = 'Un mat forcé en ' + bestLine.mate + ' était disponible (règle Lichess « mat perdu »).';
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
          if (resistanceLost >= 1) {
            note = 'Accélère le mat contre soi : mat en ' + Math.abs(afterRaw.mate) +
              ' au lieu de ' + Math.abs(bestLine.mate) + ' avec la meilleure défense.';
          }
          if (resistanceLost >= 3) atLeast('blunder');
          else if (resistanceLost === 2) atLeast('mistake');
          else if (resistanceLost === 1) atLeast('inaccuracy');
        } else if (!bestMateAgainst && afterMateAgainst) {
          // La meilleure défense évitait encore tout mat forcé ; le coup joué
          // en autorise un. Gradation reprise du vrai code Lichess
          // (lila/Advice.scala, MateCreated) : si la position était déjà
          // désespérée (< -7 pions même en jouant au mieux), c'est une
          // Erreur ; sinon c'est une Gaffe. (Lichess a un 3e palier
          // "Imprécision si < -9.99" qu'on n'adopte pas : Chess.com classe
          // Erreur le cas -16 -> mat en 3 de la partie de référence.)
          const bestCp = bestLine && bestLine.cp != null ? bestLine.cp : -100000;
          note = 'Autorise un mat forcé en ' + Math.abs(afterRaw.mate) +
            ' — la meilleure défense l\'évitait encore' +
            (bestCp <= -700 ? ' (position déjà désespérée : simple Erreur, règle Lichess).' : '.');
          atLeast(bestCp <= -700 ? 'mistake' : 'blunder');
        } else {
          // Zone saturée sans mats des deux côtés : signal de secours sur
          // l'éval brute, comme avant.
          const t1 = satThresholdForElo(eloOf[mover]);
          const t2 = Math.round(t1 * 2.8), t3 = t1 * 6;
          const rawSwing = rawSignedValue(bestLine) - (-rawSignedValue(afterRaw));
          if (rawSwing >= t1) {
            note = 'Position déjà décidée : perte réelle de ' + (rawSwing/100).toFixed(1) +
              ' pion(s) mesurée sur l\'éval brute (la probabilité de gain ne bouge presque plus).';
          }
          if (rawSwing >= t3) cls = worsenBy(cls, 3);
          else if (rawSwing >= t2) cls = worsenBy(cls, 2);
          else if (rawSwing >= t1) cls = worsenBy(cls, 1);
        }
      }
      }
    }

    if (cls !== 'book') stillInBook = false;
    records.push({ ply: i, color: mover, san: plies[i].san, cls, note, lossCp: epLossPct, epLoss, fen: curFen, playedMove, bestMove, evalCpWhite, evalMateWhite });
    if (onProgress) onProgress(i, plies.length - 1);
  }
  return records;
}


module.exports = { CLASS_META, expectedPoints, gameAccuracy, estimatedEloFromAccuracy, analyzeGame, moveAccuracy };
