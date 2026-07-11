/* =========================================================
   dames-logic.js — Dames internationales 10×10.
   Représentation : cases 1..50 (numérotation Manoury), tableau
   d'objets { color:'w'|'b', king:bool } indexé 0..49 (case n-1).
   Les Blancs démarrent sur 31-50 et jouent vers les petits numéros.

   Règles implémentées (FMJD, jeu international) :
   - pion : avance en diagonale d'une case ; prend en avant ET en arrière ;
   - dame : "volante" (glisse à distance), prise à distance avec
     atterrissage libre derrière la pièce prise, sur la même diagonale ;
   - prise MAJORITAIRE obligatoire : on doit jouer une rafle qui capture
     le nombre MAXIMUM de pièces (pion ou dame comptent pareil) ;
   - pendant une rafle, les pièces prises restent sur le damier (elles
     bloquent le passage) et ne peuvent pas être sautées deux fois ;
     elles sont retirées seulement à la fin du coup ;
   - promotion uniquement si le pion TERMINE son coup sur la dernière
     rangée (s'il ne fait qu'y passer en rafle, pas de promotion).
   ========================================================= */

/* ---- Géométrie : case 1-50 <-> (x,y) sur la grille 10x10 ---- */
function sqToXY(n) {
  const i = n - 1;
  const y = Math.floor(i / 5);
  const x = 2 * (i % 5) + (y % 2 === 0 ? 1 : 0);
  return { x, y };
}
function xyToSq(x, y) {
  if (x < 0 || x > 9 || y < 0 || y > 9) return 0;
  if ((x + y) % 2 === 0) return 0; // case blanche, non jouable
  return y * 5 + Math.floor(x / 2) + 1;
}
const DIAGS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // NO, NE, SO, SE (y vers le bas)

/* ---- État ---- */
function dInitialBoard() {
  const b = new Array(50).fill(null);
  for (let n = 1; n <= 20; n++) b[n - 1] = { color: 'b', king: false };
  for (let n = 31; n <= 50; n++) b[n - 1] = { color: 'w', king: false };
  return b;
}
function dNewState() {
  return { board: dInitialBoard(), turn: 'w' };
}
function dCloneBoard(b) { return b.map((p) => p ? { ...p } : null); }

/* ---- Génération des rafles (récursif) ----
   Retourne des séquences { path:[cases], captured:[cases] }.
   `board` n'est jamais muté : on passe un Set des cases déjà prises. */
function captureSequencesFrom(board, sq, piece, capturedSet) {
  const { x, y } = sqToXY(sq);
  const enemy = piece.color === 'w' ? 'b' : 'w';
  const results = [];
  for (const [dx, dy] of DIAGS) {
    if (!piece.king) {
      // pion : pièce adverse adjacente + case libre juste derrière
      const overSq = xyToSq(x + dx, y + dy);
      const landSq = xyToSq(x + 2 * dx, y + 2 * dy);
      if (!overSq || !landSq) continue;
      const overP = board[overSq - 1];
      if (!overP || overP.color !== enemy || capturedSet.has(overSq)) continue;
      if (board[landSq - 1] && landSq !== sq) continue; // atterrissage occupé
      const newCaptured = new Set(capturedSet); newCaptured.add(overSq);
      const deeper = captureSequencesFrom(board, landSq, piece, newCaptured);
      if (deeper.length) {
        for (const d of deeper) results.push({ path: [sq, ...d.path], captured: [overSq, ...d.captured] });
      } else {
        results.push({ path: [sq, landSq], captured: [overSq] });
      }
    } else {
      // dame volante : glisse, rencontre UNE pièce adverse non encore prise,
      // puis peut atterrir sur n'importe quelle case libre derrière elle
      let cx = x + dx, cy = y + dy, overSq = 0;
      while (true) {
        const s = xyToSq(cx, cy);
        if (!s) break;
        const p = board[s - 1];
        if (p && s !== sq) {
          // pièce déjà capturée = mur infranchissable (règle internationale)
          if (capturedSet.has(s)) break;
          if (p.color !== enemy) break;
          overSq = s; break;
        }
        cx += dx; cy += dy;
      }
      if (!overSq) continue;
      // cases d'atterrissage : toutes les cases libres derrière overSq
      let lx = cx + dx, ly = cy + dy;
      while (true) {
        const landSq = xyToSq(lx, ly);
        if (!landSq) break;
        const lp = board[landSq - 1];
        if (lp && landSq !== sq) break;
        const newCaptured = new Set(capturedSet); newCaptured.add(overSq);
        const deeper = captureSequencesFrom(board, landSq, piece, newCaptured);
        if (deeper.length) {
          for (const d of deeper) results.push({ path: [sq, ...d.path], captured: [overSq, ...d.captured] });
        } else {
          results.push({ path: [sq, landSq], captured: [overSq] });
        }
        lx += dx; ly += dy;
      }
    }
  }
  return results;
}

/* ---- Tous les coups légaux ----
   Coup = { from, to, path:[...], captured:[...], promotion:bool } */
function dLegalMoves(state) {
  const { board, turn } = state;
  let allCaptures = [];
  const quiets = [];
  for (let sq = 1; sq <= 50; sq++) {
    const piece = board[sq - 1];
    if (!piece || piece.color !== turn) continue;
    const seqs = captureSequencesFrom(board, sq, piece, new Set());
    for (const s of seqs) allCaptures.push({ from: sq, to: s.path[s.path.length - 1], path: s.path, captured: s.captured, piece });
    if (!seqs.length || allCaptures.length === 0) {
      const { x, y } = sqToXY(sq);
      if (!piece.king) {
        const fwd = piece.color === 'w' ? -1 : 1;
        for (const dx of [-1, 1]) {
          const t = xyToSq(x + dx, y + fwd);
          if (t && !board[t - 1]) quiets.push({ from: sq, to: t, path: [sq, t], captured: [], piece });
        }
      } else {
        for (const [dx, dy] of DIAGS) {
          let cx = x + dx, cy = y + dy;
          while (true) {
            const t = xyToSq(cx, cy);
            if (!t || board[t - 1]) break;
            quiets.push({ from: sq, to: t, path: [sq, t], captured: [], piece });
            cx += dx; cy += dy;
          }
        }
      }
    }
  }
  let moves;
  if (allCaptures.length) {
    // prise majoritaire : seules les rafles au max de prises sont légales
    const maxCap = Math.max(...allCaptures.map((m) => m.captured.length));
    moves = allCaptures.filter((m) => m.captured.length === maxCap);
  } else {
    moves = quiets;
  }
  const promoRow = turn === 'w' ? 0 : 9;
  for (const m of moves) {
    m.promotion = !m.piece.king && sqToXY(m.to).y === promoRow;
    delete m.piece;
  }
  return moves;
}

function dApplyMove(state, move) {
  const board = dCloneBoard(state.board);
  const piece = board[move.from - 1];
  board[move.from - 1] = null;
  for (const c of move.captured) board[c - 1] = null; // retirées en fin de coup
  board[move.to - 1] = { color: piece.color, king: piece.king || !!move.promotion };
  return { board, turn: state.turn === 'w' ? 'b' : 'w' };
}

function dGameStatus(state) {
  return dLegalMoves(state).length === 0 ? 'lost' : 'ok'; // plus de coup = perdu (bloqué ou plus de pièces)
}

/* ---- Notation ---- */
function dMoveNotation(move) {
  return move.captured.length ? move.from + 'x' + move.to : move.from + '-' + move.to;
}

/* ---- Rejeu d'une liste de coups PDN / NDJSON ----
   Jetons acceptés : "32-28", "27x18", "27x38x49" (chemin explicite).
   Ambiguïté PDN : "AxB" peut correspondre à plusieurs rafles (même départ,
   même arrivée, même nombre de prises, chemins différents). Dans ce cas on
   suit le standard PDN : si des cases intermédiaires sont fournies on les
   respecte, sinon on prend la première rafle trouvée (les prises sont au
   même nombre par construction — la position résultante peut différer sur
   les pièces retirées, cas très rare, signalé dans `ambiguous`). */
function dReplayMoves(tokens) {
  let state = dNewState();
  const plies = [{ fen: dToFen(state), notation: null, move: null }];
  const warnings = [];
  tokens.forEach((tokenRaw, idx) => {
    const token = tokenRaw.trim();
    if (!token) return;
    const isCapture = token.includes('x');
    const nums = token.split(/[x-]/).map((s) => parseInt(s, 10));
    if (nums.some(isNaN)) throw new Error('Coup illisible : "' + token + '"');
    const from = nums[0], to = nums[nums.length - 1];
    const legal = dLegalMoves(state);
    let candidates = legal.filter((m) => m.from === from && m.to === to && (m.captured.length > 0) === isCapture);
    if (nums.length > 2) {
      // cases intermédiaires fournies -> filtrer par le chemin
      candidates = candidates.filter((m) => nums.every((n) => m.path.includes(n)));
    }
    if (!candidates.length) {
      throw new Error('Coup illégal au demi-coup ' + (idx + 1) + ' : "' + token + '" (' + legal.length + ' coups légaux ici)');
    }
    if (candidates.length > 1 && nums.length === 2) warnings.push('Rafle ambiguë au demi-coup ' + (idx + 1) + ' : "' + token + '"');
    const move = candidates[0];
    state = dApplyMove(state, move);
    plies.push({ fen: dToFen(state), notation: dMoveNotation(move), move, ambiguous: candidates.length > 1 });
  });
  return { plies, warnings };
}

/* ---- FEN ----
   Format lidraughts : "W:W31,32,K40:B1,2,K5"  (K = dame)
   Format hub Scan   : "W" + 50 caractères parmi w/b/W/B/e  */
function dToFen(state) {
  const w = [], b = [];
  state.board.forEach((p, i) => {
    if (!p) return;
    const s = (p.king ? 'K' : '') + (i + 1);
    (p.color === 'w' ? w : b).push(s);
  });
  return state.turn.toUpperCase() + ':W' + w.join(',') + ':B' + b.join(',');
}
function dFenToState(fen) {
  const board = new Array(50).fill(null);
  const parts = fen.split(':');
  const turn = parts[0].toLowerCase() === 'b' ? 'b' : 'w';
  for (const part of parts.slice(1)) {
    const color = part[0] === 'W' ? 'w' : 'b';
    if (part.length < 2) continue;
    for (const tok of part.slice(1).split(',')) {
      if (!tok) continue;
      const king = tok[0] === 'K';
      const n = parseInt(king ? tok.slice(1) : tok, 10);
      if (n >= 1 && n <= 50) board[n - 1] = { color, king };
    }
  }
  return { board, turn };
}
function dToScanFen(state) {
  let s = state.turn.toUpperCase();
  for (let i = 0; i < 50; i++) {
    const p = state.board[i];
    if (!p) s += 'e';
    else s += p.king ? p.color.toUpperCase() : p.color;
  }
  return s;
}

/* export node (tests) */
if (typeof module !== 'undefined') {
  module.exports = { sqToXY, xyToSq, dNewState, dLegalMoves, dApplyMove, dReplayMoves, dToFen, dFenToState, dToScanFen, dMoveNotation, dGameStatus };
}
