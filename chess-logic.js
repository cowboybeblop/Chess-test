function initialBoard(){
  const b = Array.from({length:8},()=>Array(8).fill(null));
  const back = ['r','n','b','q','k','b','n','r'];
  for(let c=0;c<8;c++){
    b[0][c] = {type:back[c], color:'b'};
    b[1][c] = {type:'p', color:'b'};
    b[6][c] = {type:'p', color:'w'};
    b[7][c] = {type:back[c], color:'w'};
  }
  return b;
}
function cloneBoard(b){ return b.map(row=>row.map(p=>p?{...p}:null)); }
function inB(x,y){ return x>=0&&x<8&&y>=0&&y<8; }
function newState(){
  return {
    board: initialBoard(), turn: 'w',
    castling: {wK:true,wQ:true,bK:true,bQ:true},
    enPassant: null,
    kingPos: {w:{x:4,y:7}, b:{x:4,y:0}},
  };
}
const KNIGHT_OFF = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
const KING_OFF = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const BISHOP_DIR = [[1,1],[1,-1],[-1,1],[-1,-1]];
const ROOK_DIR = [[1,0],[-1,0],[0,1],[0,-1]];
function isSquareAttacked(board, tx, ty, byColor){
  const pawnDir = byColor==='w' ? -1 : 1;
  for(const dx of [-1,1]){
    const sx = tx+dx, sy = ty-pawnDir;
    if(inB(sx,sy)){
      const p = board[sy][sx];
      if(p && p.color===byColor && p.type==='p') return true;
    }
  }
  for(const [dx,dy] of KNIGHT_OFF){
    const sx=tx+dx, sy=ty+dy;
    if(inB(sx,sy)){
      const p = board[sy][sx];
      if(p && p.color===byColor && p.type==='n') return true;
    }
  }
  for(const [dx,dy] of KING_OFF){
    const sx=tx+dx, sy=ty+dy;
    if(inB(sx,sy)){
      const p = board[sy][sx];
      if(p && p.color===byColor && p.type==='k') return true;
    }
  }
  for(const [dx,dy] of BISHOP_DIR){
    let sx=tx+dx, sy=ty+dy;
    while(inB(sx,sy)){
      const p = board[sy][sx];
      if(p){ if(p.color===byColor && (p.type==='b'||p.type==='q')) return true; break; }
      sx+=dx; sy+=dy;
    }
  }
  for(const [dx,dy] of ROOK_DIR){
    let sx=tx+dx, sy=ty+dy;
    while(inB(sx,sy)){
      const p = board[sy][sx];
      if(p){ if(p.color===byColor && (p.type==='r'||p.type==='q')) return true; break; }
      sx+=dx; sy+=dy;
    }
  }
  return false;
}
function pseudoMoves(state, x, y){
  const board = state.board;
  const piece = board[y][x];
  if(!piece) return [];
  const moves = [];
  const color = piece.color;
  const enemy = color==='w'?'b':'w';
  if(piece.type==='p'){
    const dir = color==='w' ? -1 : 1;
    const startRow = color==='w' ? 6 : 1;
    const promoRow = color==='w' ? 0 : 7;
    if(inB(x,y+dir) && !board[y+dir][x]){
      moves.push({from:{x,y}, to:{x,y:y+dir}, promotion: (y+dir===promoRow)});
      if(y===startRow && !board[y+2*dir][x]){
        moves.push({from:{x,y}, to:{x,y:y+2*dir}, doubleStep:true});
      }
    }
    for(const dx of [-1,1]){
      const nx=x+dx, ny=y+dir;
      if(inB(nx,ny)){
        const target = board[ny][nx];
        if(target && target.color===enemy){
          moves.push({from:{x,y}, to:{x:nx,y:ny}, capture:true, promotion:(ny===promoRow)});
        } else if(state.enPassant && state.enPassant.x===nx && state.enPassant.y===ny){
          moves.push({from:{x,y}, to:{x:nx,y:ny}, capture:true, enPassant:true});
        }
      }
    }
  } else if(piece.type==='n'){
    for(const [dx,dy] of KNIGHT_OFF){
      const nx=x+dx, ny=y+dy;
      if(inB(nx,ny)){
        const target = board[ny][nx];
        if(!target || target.color===enemy) moves.push({from:{x,y}, to:{x:nx,y:ny}, capture: !!target});
      }
    }
  } else if(piece.type==='k'){
    for(const [dx,dy] of KING_OFF){
      const nx=x+dx, ny=y+dy;
      if(inB(nx,ny)){
        const target = board[ny][nx];
        if(!target || target.color===enemy) moves.push({from:{x,y}, to:{x:nx,y:ny}, capture: !!target});
      }
    }
    const homeRow = color==='w' ? 7 : 0;
    if(y===homeRow && x===4 && !isSquareAttacked(board, x, y, enemy)){
      const rights = state.castling;
      const kSideOk = color==='w' ? rights.wK : rights.bK;
      const qSideOk = color==='w' ? rights.wQ : rights.bQ;
      if(kSideOk && !board[homeRow][5] && !board[homeRow][6]){
        const rook = board[homeRow][7];
        if(rook && rook.type==='r' && rook.color===color){
          if(!isSquareAttacked(board, 5, homeRow, enemy) && !isSquareAttacked(board, 6, homeRow, enemy)){
            moves.push({from:{x,y}, to:{x:6,y:homeRow}, castle:'k'});
          }
        }
      }
      if(qSideOk && !board[homeRow][3] && !board[homeRow][2] && !board[homeRow][1]){
        const rook = board[homeRow][0];
        if(rook && rook.type==='r' && rook.color===color){
          if(!isSquareAttacked(board, 3, homeRow, enemy) && !isSquareAttacked(board, 2, homeRow, enemy)){
            moves.push({from:{x,y}, to:{x:2,y:homeRow}, castle:'q'});
          }
        }
      }
    }
  } else {
    let dirs = [];
    if(piece.type==='b') dirs = BISHOP_DIR;
    else if(piece.type==='r') dirs = ROOK_DIR;
    else if(piece.type==='q') dirs = [...BISHOP_DIR, ...ROOK_DIR];
    for(const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while(inB(nx,ny)){
        const target = board[ny][nx];
        if(!target){
          moves.push({from:{x,y}, to:{x:nx,y:ny}});
        } else {
          if(target.color===enemy) moves.push({from:{x,y}, to:{x:nx,y:ny}, capture:true});
          break;
        }
        nx+=dx; ny+=dy;
      }
    }
  }
  return moves;
}
function applyMove(state, move, promotionType){
  const board = cloneBoard(state.board);
  const {from, to} = move;
  const piece = board[from.y][from.x];
  const color = piece.color;
  let castling = {...state.castling};
  let enPassant = null;
  if(move.enPassant){
    board[from.y][to.x] = null;
  }
  board[to.y][to.x] = piece;
  board[from.y][from.x] = null;
  if(move.promotion){
    board[to.y][to.x] = {type: promotionType||'q', color};
  }
  if(move.castle){
    const homeRow = from.y;
    if(move.castle==='k'){
      board[homeRow][5] = board[homeRow][7];
      board[homeRow][7] = null;
    } else {
      board[homeRow][3] = board[homeRow][0];
      board[homeRow][0] = null;
    }
  }
  if(move.doubleStep){
    enPassant = {x: from.x, y: (from.y+to.y)/2};
  }
  if(piece.type==='k'){
    if(color==='w'){ castling.wK=false; castling.wQ=false; }
    else { castling.bK=false; castling.bQ=false; }
  }
  if(piece.type==='r'){
    if(color==='w'){
      if(from.x===0 && from.y===7) castling.wQ=false;
      if(from.x===7 && from.y===7) castling.wK=false;
    } else {
      if(from.x===0 && from.y===0) castling.bQ=false;
      if(from.x===7 && from.y===0) castling.bK=false;
    }
  }
  if(to.x===0 && to.y===7) castling.wQ=false;
  if(to.x===7 && to.y===7) castling.wK=false;
  if(to.x===0 && to.y===0) castling.bQ=false;
  if(to.x===7 && to.y===0) castling.bK=false;
  let kingPos = {...state.kingPos};
  if(piece.type==='k'){
    kingPos = {...kingPos, [color]: {x:to.x,y:to.y}};
  }
  return { board, turn: color==='w'?'b':'w', castling, enPassant, kingPos };
}
function legalMoves(state, x, y){
  const piece = state.board[y][x];
  if(!piece) return [];
  const color = piece.color;
  const pseudo = pseudoMoves(state, x, y);
  const legal = [];
  for(const m of pseudo){
    const next = applyMove(state, m, 'q');
    const kp = next.kingPos[color];
    if(!isSquareAttacked(next.board, kp.x, kp.y, color==='w'?'b':'w')){
      legal.push(m);
    }
  }
  return legal;
}
function allLegalMoves(state, color){
  const moves = [];
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p = state.board[y][x];
    if(p && p.color===color){
      moves.push(...legalMoves(state,x,y));
    }
  }
  return moves;
}
function isInCheck(state, color){
  const kp = state.kingPos[color];
  return isSquareAttacked(state.board, kp.x, kp.y, color==='w'?'b':'w');
}
function gameStatus(state){
  const color = state.turn;
  const inCheck = isInCheck(state, color);
  const moves = allLegalMoves(state, color);
  if(moves.length===0){
    return inCheck ? 'checkmate' : 'stalemate';
  }
  return inCheck ? 'check' : 'ok';
}

/* ---- FEN / SAN helpers ---- */
const FILES = 'abcdefgh';
function sq(x,y){ return FILES[x] + (8-y); }
function toFEN(state, fullmove){
  const board = state.board;
  let rows = [];
  for(let y=0;y<8;y++){
    let run = 0, row = '';
    for(let x=0;x<8;x++){
      const p = board[y][x];
      if(!p){ run++; continue; }
      if(run){ row += run; run = 0; }
      let ch = p.type === 'n' ? 'n' : p.type;
      ch = p.color === 'w' ? ch.toUpperCase() : ch;
      row += ch;
    }
    if(run) row += run;
    rows.push(row);
  }
  const boardStr = rows.join('/');
  const turn = state.turn;
  let castle = '';
  if(state.castling.wK) castle += 'K';
  if(state.castling.wQ) castle += 'Q';
  if(state.castling.bK) castle += 'k';
  if(state.castling.bQ) castle += 'q';
  if(!castle) castle = '-';
  const ep = state.enPassant ? sq(state.enPassant.x, state.enPassant.y) : '-';
  return `${boardStr} ${turn} ${castle} ${ep} 0 ${fullmove||1}`;
}

function sanForMove(state, move){
  const piece = state.board[move.from.y][move.from.x];
  if(move.castle==='k') return finishSAN(state, move, 'O-O');
  if(move.castle==='q') return finishSAN(state, move, 'O-O-O');
  const destSq = sq(move.to.x, move.to.y);
  const capture = !!move.capture;
  let s = '';
  if(piece.type === 'p'){
    if(capture) s = FILES[move.from.x] + 'x' + destSq;
    else s = destSq;
    if(move.promotion) s += '=' + (move.promotionType||'Q').toUpperCase();
  } else {
    const letter = piece.type.toUpperCase();
    // disambiguation: other same-type same-color pieces that can also legally reach move.to
    const others = [];
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      if(x===move.from.x && y===move.from.y) continue;
      const p = state.board[y][x];
      if(p && p.color===piece.color && p.type===piece.type){
        const lm = legalMoves(state, x, y);
        if(lm.some(m=>m.to.x===move.to.x && m.to.y===move.to.y)) others.push({x,y});
      }
    }
    let disambig = '';
    if(others.length){
      const sameFile = others.some(o=>o.x===move.from.x);
      const sameRank = others.some(o=>o.y===move.from.y);
      if(!sameFile) disambig = FILES[move.from.x];
      else if(!sameRank) disambig = String(8-move.from.y);
      else disambig = FILES[move.from.x] + String(8-move.from.y);
    }
    s = letter + disambig + (capture ? 'x' : '') + destSq;
  }
  return finishSAN(state, move, s);
}
function finishSAN(state, move, s){
  const next = applyMove(state, move, move.promotionType||'q');
  const opColor = next.turn;
  if(isInCheck(next, opColor)){
    const moves = allLegalMoves(next, opColor);
    s += moves.length===0 ? '#' : '+';
  }
  return s;
}


/* ---- Parseur PGN : jeton SAN -> coup légal (par comparaison avec sanForMove) ---- */
function stripSuffix(san) {
  return san.replace(/[+#!?]+$/g, '');
}
function parseSanToken(state, token) {
  const clean = stripSuffix(token.trim());
  const color = state.turn;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = state.board[y][x];
    if (!p || p.color !== color) continue;
    for (const m of legalMoves(state, x, y)) {
      const promoChoices = m.promotion ? ['q', 'r', 'b', 'n'] : [null];
      for (const promo of promoChoices) {
        const san = stripSuffix(sanForMove(state, { ...m, promotionType: promo }));
        if (san === clean) return { move: m, promo };
      }
    }
  }
  return null;
}
function tokenizePGN(pgn) {
  // enlève les commentaires {...}, les NAG $n, les tags [Event "..."], et les numéros de coup
  let text = pgn.replace(/\{[^}]*\}/g, ' ').replace(/\$\d+/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.filter(t => !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}
function replayPGN(pgn) {
  const tokens = tokenizePGN(pgn);
  let state = newState();
  const plies = [{ fen: toFEN(state, 1), san: null }];
  for (const token of tokens) {
    const result = parseSanToken(state, token);
    if (!result) throw new Error('Coup illisible: "' + token + '" (position: ' + toFEN(state, 1) + ')');
    const sanEn = sanForMove(state, { ...result.move, promotionType: result.promo });
    const next = applyMove(state, result.move, result.promo);
    state = { board: next.board, turn: next.turn, castling: next.castling, enPassant: next.enPassant, kingPos: next.kingPos };
    plies.push({ fen: toFEN(state, Math.ceil(plies.length / 2) + 1), san: sanEn, sanRaw: token });
  }
  return plies;
}

function fenToState(fen) {
  const parts = fen.split(' ');
  const rows = parts[0].split('/');
  const board = [];
  for (const row of rows) {
    const line = [];
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let i = 0; i < parseInt(ch, 10); i++) line.push(null); }
      else { line.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' }); }
    }
    board.push(line);
  }
  const castling = { wK: parts[2].includes('K'), wQ: parts[2].includes('Q'), bK: parts[2].includes('k'), bQ: parts[2].includes('q') };
  let enPassant = null;
  if (parts[3] !== '-') enPassant = { x: 'abcdefgh'.indexOf(parts[3][0]), y: 8 - parseInt(parts[3][1], 10) };
  const kingPos = { w: null, b: null };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = board[y][x]; if (p && p.type === 'k') kingPos[p.color] = { x, y }; }
  return { board, turn: parts[1], castling, enPassant, kingPos };
}
