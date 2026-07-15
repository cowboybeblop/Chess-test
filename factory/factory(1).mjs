/* =========================================================
   factory.mjs — Usine à données du projet LLL (modèle pédagogue).
   Entrée  : un fichier PGN multi-parties (base ouverte Lichess).
   Sortie  : un JSONL, une ligne par coup analysé :
     { fen, san, color, verdict, ep_loss, eval_before, eval_after,
       best_san, best_pv_san, phase, opening, elos, observations[],
       explication_fr }
   Le pipeline (évals, verdicts, bulles) est EXACTEMENT celui de
   l'outil web (analysis-core.js extrait de app.js) — le professeur
   du futur modèle est donc l'outil qu'on a calibré sur Chess.com.

   Usage : node factory.mjs games.pgn out.jsonl [depth] [maxGames]
   ========================================================= */
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/* chess-logic.js est un script navigateur : on l'évalue puis on récupère
   ses fonctions dans le scope global. */
const logicSrc = fs.readFileSync(new URL('../chess-logic.js', import.meta.url), 'utf8');
(0, eval)(logicSrc);
/* Le vrai livre d'ouvertures (Lichess), pour des verdicts "Théorie" et des
   noms d'ouvertures identiques à l'outil web. Optionnel : sans lui,
   l'heuristique de secours prend le relais. */
try {
  const bookSrc = fs.readFileSync(new URL('../openings.js', import.meta.url), 'utf8');
  (0, eval)(bookSrc + '\n;globalThis.OPENING_BOOK = OPENING_BOOK;');
  console.log('Livre d\'ouvertures chargé :', OPENING_BOOK.size, 'positions');
} catch (e) { console.log('openings.js absent — théorie en mode heuristique'); }
/* analysis-core.js référence les fonctions de chess-logic en global : ok. */
const core = require('./analysis-core.js');
const { NodeEngine } = require('./engine-node.js');

const [, , pgnPath, outPath, depthArg, maxGamesArg] = process.argv;
if (!pgnPath || !outPath) {
  console.error('Usage: node factory.mjs <games.pgn> <out.jsonl> [depth=14] [maxGames=50]');
  process.exit(1);
}
const DEPTH = parseInt(depthArg || '14', 10);
const MAX_GAMES = parseInt(maxGamesArg || '50', 10);

/* ---- Découpage d'un fichier PGN multi-parties ---- */
function splitPgn(text) {
  const games = [];
  const chunks = text.split(/\n\s*\n(?=\[Event )/);
  for (const c of chunks) if (c.includes('[Event') && /\n\s*\n/.test(c)) games.push(c.trim());
  return games;
}
function parseHeaders(pgn) {
  const h = {};
  for (const m of pgn.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) h[m[1]] = m[2];
  return h;
}

/* ---- Helpers pédagogiques ---- */
function phaseOf(fen) {
  const board = fen.split(' ')[0];
  const pieces = (board.match(/[nbrqNBRQ]/g) || []).length; // hors pions et rois
  const queens = (board.match(/[qQ]/g) || []).length;
  if (pieces >= 12) return 'ouverture/milieu';
  if (pieces >= 6 || queens) return 'milieu de partie';
  return 'finale';
}
function fmtEval(cp, mate) {
  if (mate != null) return (mate > 0 ? '#' : '#-') + Math.abs(mate);
  return ((cp || 0) / 100).toFixed(1).replace('-0.0', '0.0');
}
function uciPvToSan(fen, pv, maxN) {
  // rejoue la PV pour la convertir en SAN lisible
  const sans = [];
  try {
    let state = fenToState(fen);
    for (const uci of pv.slice(0, maxN)) {
      const from = { x: 'abcdefgh'.indexOf(uci[0]), y: 8 - parseInt(uci[1], 10) };
      const to = { x: 'abcdefgh'.indexOf(uci[2]), y: 8 - parseInt(uci[3], 10) };
      const lm = legalMoves(state, from.x, from.y).find((m) => m.to.x === to.x && m.to.y === to.y);
      if (!lm) break;
      const promo = uci[4] || null;
      sans.push(sanForMove(state, { ...lm, promotionType: promo }));
      const nx = applyMove(state, lm, promo || 'q');
      state = { board: nx.board, turn: nx.turn, castling: nx.castling, enPassant: nx.enPassant, kingPos: nx.kingPos };
    }
  } catch (e) { /* pv partielle */ }
  return sans;
}
/* Observations factuelles simples (les "mots posés sur la position") */
function observations(rec, prevEval, headers) {
  const obs = [];
  const side = rec.color === 'w' ? 'les Blancs' : 'les Noirs';
  if (rec.san.includes('x')) obs.push(`${side} capturent en ${rec.san.match(/[a-h][1-8]/g)?.pop() || '?'}`);
  if (rec.san.includes('+')) obs.push('le coup donne échec');
  if (rec.san.includes('#')) obs.push('le coup donne mat');
  if (rec.san.startsWith('O-O')) obs.push(`${side} roquent${rec.san === 'O-O-O' ? ' grand côté' : ''}`);
  if (/^[a-h]/.test(rec.san) && !rec.san.includes('x')) obs.push('un coup de pion');
  const before = fmtEval(prevEval.cp, prevEval.mate);
  const after = fmtEval(rec.evalCpWhite, rec.evalMateWhite);
  if (before !== after) obs.push(`l'évaluation passe de ${before} à ${after}`);
  else obs.push(`l'évaluation reste ${after}`);
  return obs;
}
/* Explication française (la voix du professeur) */
function explain(rec, bestSan, pvSans, opening) {
  const L = core.CLASS_META[rec.cls] ? core.CLASS_META[rec.cls].label : rec.cls;
  const alt = bestSan && bestSan !== rec.san ? ` Le moteur préférait ${bestSan}${pvSans.length > 1 ? ', avec la suite ' + pvSans.join(' ') : ''}.` : '';
  switch (rec.cls) {
    case 'book': return `${rec.san} est un coup de théorie${rec.note ? ' (' + rec.note + ')' : opening ? ' (' + opening + ')' : ''} : la position reste dans les sentiers connus.`;
    case 'forced': return `${rec.san} est forcé : ${rec.note || 'aucune alternative raisonnable.'}`;
    case 'best': return `${rec.san} est le meilleur coup de la position${rec.note ? ' — ' + rec.note : '.'}`;
    case 'excellent': return `${rec.san} est excellent, quasiment aussi bon que le meilleur coup.${alt}`;
    case 'good': return `${rec.san} est un bon coup, solide, qui ne concède presque rien.${alt}`;
    case 'inaccuracy': return `${rec.san} est une imprécision : ${(rec.lossCp / 100).toFixed(2)} point de gain attendu s'échappe.${rec.note ? ' ' + rec.note : ''}${alt}`;
    case 'mistake': return `${rec.san} est une erreur qui dégrade nettement la position.${rec.note ? ' ' + rec.note : ''}${alt}`;
    case 'blunder': return `${rec.san} est une gaffe : la partie bascule.${rec.note ? ' ' + rec.note : ''}${alt}`;
    case 'miss': return `${rec.san} laisse passer une occasion : ${rec.note || 'une continuation bien plus forte existait.'}${alt}`;
    default: return `${rec.san} — ${L}.${alt}`;
  }
}

/* ---- Boucle principale ---- */
const engine = new NodeEngine();
const pgnText = fs.readFileSync(pgnPath, 'utf8');
const games = splitPgn(pgnText).slice(0, MAX_GAMES);
console.log(`${games.length} parties à analyser (profondeur ${DEPTH})`);
const out = fs.createWriteStream(outPath, { flags: 'a' });
let nMoves = 0, nGames = 0, t0 = Date.now();

for (const pgn of games) {
  const headers = parseHeaders(pgn);
  let plies;
  try { plies = replayPGN(pgn); } catch (e) { console.log('  ⤫ partie ignorée:', e.message.slice(0, 60)); continue; }
  if (plies.length < 12) continue; // parties trop courtes : peu instructives
  let records;
  try {
    records = await core.analyzeGame(engine, plies, DEPTH, null, {
      whiteElo: parseInt(headers.WhiteElo, 10) || 0,
      blackElo: parseInt(headers.BlackElo, 10) || 0,
    });
  } catch (e) { console.log('  ⤫ analyse échouée:', e.message); continue; }
  // Elo moyen (définit la bande d'échantillonnage) + niveau grossier.
  // L'Elo d'UNE partie n'est estimable qu'à ±200-300 : les 4 niveaux
  // servent aux tâches à étiquette grossière et à l'éval stratifiée.
  const ew = parseInt(headers.WhiteElo, 10) || 0;
  const eb = parseInt(headers.BlackElo, 10) || 0;
  const eloAvg = (ew > 0 && eb > 0) ? Math.round((ew + eb) / 2) : null;
  const level = eloAvg == null ? null
    : eloAvg < 1000 ? 'débutant'
    : eloAvg < 1500 ? 'intermédiaire'
    : eloAvg < 2000 ? 'avancé'
    : 'expert';
  let prevEval = { cp: 15, mate: null };
  records.forEach((rec, i) => {
    const fenBefore = plies[i].fen;
    const bestUci = rec.bestMove ? null : null;
    // best move SAN + petite PV lisible depuis la position AVANT le coup
    let bestSan = null, pvSans = [];
    if (rec.bestMove) {
      // reconstruire l'uci du meilleur coup depuis les coordonnées stockées
      const f = 'abcdefgh';
      const uci = f[rec.bestMove.from.x] + (8 - rec.bestMove.from.y) + f[rec.bestMove.to.x] + (8 - rec.bestMove.to.y);
      pvSans = uciPvToSan(fenBefore, [uci], 1);
      bestSan = pvSans[0] || null;
    }
    const obs = observations(rec, prevEval, headers);
    out.write(JSON.stringify({
      fen: fenBefore,
      san: rec.san,
      color: rec.color,
      verdict: rec.cls,
      ep_loss: Math.round(rec.lossCp * 100) / 100,
      eval_after: fmtEval(rec.evalCpWhite, rec.evalMateWhite),
      best_san: bestSan,
      phase: phaseOf(fenBefore),
      opening: headers.Opening || null,
      elo_w: headers.WhiteElo || null, elo_b: headers.BlackElo || null,
      elo_avg: eloAvg, level,
      time_control: headers.TimeControl || null,
      note: rec.note || null,
      observations: obs,
      explication_fr: explain(rec, bestSan, pvSans, headers.Opening),
    }) + '\n');
    prevEval = { cp: rec.evalCpWhite, mate: rec.evalMateWhite };
    nMoves++;
  });
  nGames++;
  const dt = (Date.now() - t0) / 1000;
  console.log(`  ✓ partie ${nGames}/${games.length} (${records.length} coups) — total ${nMoves} exemples, ${dt.toFixed(0)}s, ${(nMoves / dt).toFixed(1)} ex/s`);
}
out.end();
engine.terminate();
console.log(`\nTerminé : ${nMoves} exemples de ${nGames} parties -> ${outPath}`);
