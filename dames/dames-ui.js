/* dames-ui.js — interface de l'analyseur Lidraughts. */
const API = 'https://lidraughts.org';
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const STATE_META = { loading: { icon: '◌', cls: 'loading' }, success: { icon: '●', cls: 'success' }, error: { icon: '✕', cls: 'error' } };
function setState(state, text) {
  const m = STATE_META[state] || { icon: '', cls: '' };
  statusEl.innerHTML = (m.icon ? `<span class="status-icon${m.cls === 'loading' ? ' spin' : ''}">${m.icon}</span> ` : '') + text;
  statusEl.className = 'status' + (m.cls ? ' ' + m.cls : '');
}

/* ---- Moteur : préchargé en arrière-plan ---- */
let engine = null;
function getEngine() {
  if (!engine) {
    engine = new ScanEngine('scan_normal.js');
    engine.readyPromise.then(() => { $('engineStatus').innerHTML = '● Moteur ' + engine.engineName + ' prêt'; $('engineStatus').className = 'status success'; });
  }
  return engine;
}

/* ---- Onglets ---- */
function showTab(which) {
  const isA = which === 'analyze';
  $('tabAnalyze').classList.toggle('active', isA);
  $('tabHistory').classList.toggle('active', !isA);
  $('viewAnalyze').classList.toggle('hidden', !isA);
  $('viewHistory').classList.toggle('hidden', isA);
  if (!isA) renderHistory();
}
$('tabAnalyze').addEventListener('click', () => showTab('analyze'));
$('tabHistory').addEventListener('click', () => showTab('history'));

/* ---- Historique ---- */
const HISTORY_KEY = 'damesAnalyses.v1';
const HISTORY_MAX = 25;
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; } }
function saveHistory(list) {
  for (let keep = list.length; keep > 0; keep--) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, keep))); return; } catch (e) { /* quota */ }
  }
}
function saveAnalysisToHistory(plies, records, headers, username, depth) {
  const list = loadHistory();
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now(),
    username: username || '', depth, headers,
    accW: Math.round(gameAccuracy(records, 'w').acc * 10) / 10,
    accB: Math.round(gameAccuracy(records, 'b').acc * 10) / 10,
    fens: plies.map((p) => p.fen),
    notations: plies.map((p) => p.notation),
    records,
  };
  const dup = list.findIndex((e) => e.fens.length === entry.fens.length && e.fens[e.fens.length - 1] === entry.fens[entry.fens.length - 1]);
  if (dup >= 0) list.splice(dup, 1);
  list.unshift(entry);
  saveHistory(list.slice(0, HISTORY_MAX));
}
function renderHistory() {
  const list = loadHistory();
  $('historyList').innerHTML = '';
  $('historyEmpty').classList.toggle('hidden', list.length > 0);
  $('btnClearHistory').classList.toggle('hidden', list.length === 0);
  list.forEach((entry) => {
    const h = entry.headers || {};
    const item = document.createElement('div');
    item.className = 'game-item';
    const when = new Date(entry.ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    item.innerHTML = `
      <div class="game-item-main"><span class="game-opponent">${h.White || '?'} vs ${h.Black || '?'}</span>
        <span class="outcome-badge draw">${h.Result || ''}</span></div>
      <div class="game-item-sub">${when} · prof. ${entry.depth} · ${entry.accW.toFixed(1)}% / ${entry.accB.toFixed(1)}%
        <button class="mini-del">✕</button></div>`;
    item.querySelector('.mini-del').addEventListener('click', (e) => {
      e.stopPropagation();
      saveHistory(loadHistory().filter((x) => x.id !== entry.id));
      renderHistory();
    });
    item.addEventListener('click', () => {
      currentPlies = entry.fens.map((f, i) => ({ fen: f, notation: entry.notations ? entry.notations[i] : null }));
      currentRecords = entry.records;
      currentHeaders = entry.headers;
      currentUsername = entry.username;
      showTab('analyze');
      setState('success', `${entry.headers.White || '?'} vs ${entry.headers.Black || '?'} — rechargée depuis l'historique`);
      renderResults(entry.records, entry.headers, entry.username);
    });
    $('historyList').appendChild(item);
  });
}
$('btnClearHistory').addEventListener('click', () => {
  if (confirm("Effacer tout l'historique d'analyses ?")) { localStorage.removeItem(HISTORY_KEY); renderHistory(); }
});

/* ---- Recherche + liste (repris de l'étape 1) ---- */
const saved = localStorage.getItem('lidraughtsUsername');
if (saved) $('usernameInput').value = saved;
$('btnSearch').addEventListener('click', searchPlayer);
$('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPlayer(); });

async function searchPlayer() {
  const username = $('usernameInput').value.trim();
  if (!username) { setState('error', 'Entre ton pseudo lidraughts.'); return; }
  localStorage.setItem('lidraughtsUsername', username);
  $('btnSearch').disabled = true;
  $('gamesListCard').classList.add('hidden');
  $('results').classList.add('hidden');
  setState('loading', `Recherche de « ${username} »…`);
  try {
    const uRes = await fetch(`${API}/api/user/${encodeURIComponent(username)}`);
    if (uRes.status === 404) { setState('error', `Joueur « ${username} » introuvable.`); return; }
    if (!uRes.ok) throw new Error('HTTP ' + uRes.status);
    setState('loading', 'Récupération des parties…');
    const gRes = await fetch(`${API}/api/games/user/${encodeURIComponent(username)}?max=20&moves=true`, { headers: { Accept: 'application/x-ndjson' } });
    if (!gRes.ok) throw new Error('HTTP ' + gRes.status);
    const games = (await gRes.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((g) => g.variant === 'standard' || g.variant === 'fromPosition' ? g.variant === 'standard' : false);
    if (!games.length) { setState('error', 'Aucune partie 10×10 standard récente (les variantes ne sont pas encore analysables).'); return; }
    setState('success', `${games.length} parties — choisis-en une, l'analyse démarre direct.`);
    renderGamesList(games, username);
  } catch (e) {
    if (e instanceof TypeError) setState('error', 'Connexion à lidraughts.org impossible (réseau ou CORS) — utilise « Coller un PDN ».');
    else setState('error', 'Erreur : ' + e.message);
  } finally { $('btnSearch').disabled = false; }
}
function renderGamesList(games, username) {
  $('gamesListCard').classList.remove('hidden');
  const listEl = $('gamesList');
  listEl.innerHTML = '';
  const uname = username.toLowerCase();
  games.forEach((g) => {
    const pw = g.players.white || {}, pb = g.players.black || {};
    const nameOf = (p) => (p.user && p.user.name) || (p.aiLevel ? 'Scan niv.' + p.aiLevel : 'Anonyme');
    const isWhite = nameOf(pw).toLowerCase() === uname;
    const opp = isWhite ? pb : pw;
    let outcome = 'Nulle', ocls = 'draw';
    if (g.winner === 'white') { outcome = isWhite ? 'Victoire' : 'Défaite'; ocls = isWhite ? 'win' : 'loss'; }
    else if (g.winner === 'black') { outcome = isWhite ? 'Défaite' : 'Victoire'; ocls = isWhite ? 'loss' : 'win'; }
    const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
    const item = document.createElement('div');
    item.className = 'game-item';
    item.innerHTML = `
      <div class="game-item-main"><span class="game-color-dot ${isWhite ? 'w' : 'b'}"></span>
        <span class="game-opponent">vs ${nameOf(opp)} (${opp.rating || '?'})</span>
        <span class="outcome-badge ${ocls}">${outcome}</span></div>
      <div class="game-item-sub">${date} · ${g.speed || ''} · ${Math.ceil((g.moves || '').split(' ').length / 2)} coups</div>`;
    item.addEventListener('click', () => {
      const headers = {
        White: (pw.user && pw.user.name) || 'Blancs', Black: (pb.user && pb.user.name) || 'Noirs',
        WhiteElo: pw.rating || '', BlackElo: pb.rating || '',
        Result: g.winner === 'white' ? '2-0' : g.winner === 'black' ? '0-2' : '1-1',
      };
      const tokens = (g.moves || '').split(' ').filter(Boolean);
      // 1) Le PDN d'abord : toujours disponible à la copie, même si le rejeu
      //    ou l'analyse échoue ensuite (les rafles y sont fusionnées pour
      //    être un PDN standard lisible).
      showPdn(headers, dMergeCaptureSegments(tokens), 'https://lidraughts.org/' + g.id);
      // 2) puis tentative d'analyse
      runAnalysis(tokens, headers, username);
    });
    listEl.appendChild(item);
  });
}
function showPdn(headers, mergedTokens, siteUrl) {
  const tags = [
    ['Event', 'Lidraughts game'],
    siteUrl ? ['Site', siteUrl] : null,
    ['White', headers.White || '?'], ['Black', headers.Black || '?'],
    ['Result', headers.Result || '*'],
    ['WhiteElo', headers.WhiteElo || '?'], ['BlackElo', headers.BlackElo || '?'],
    ['GameType', '20'],
  ].filter(Boolean);
  let body = '';
  for (let i = 0; i < mergedTokens.length; i += 2) {
    body += (i / 2 + 1) + '. ' + mergedTokens[i] + (mergedTokens[i + 1] ? ' ' + mergedTokens[i + 1] : '') + ' ';
  }
  $('pdnOut').value = tags.map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n' + body.trim() + ' ' + (headers.Result || '*');
  $('pdnState').textContent = '';
  $('pdnCard').classList.remove('hidden');
}
$('btnCopyPdn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('pdnOut').value); $('pdnState').textContent = '— copié ✓'; }
  catch (e) { $('pdnOut').select(); document.execCommand('copy'); $('pdnState').textContent = '— copié ✓'; }
});

$('btnAnalyzePdn').addEventListener('click', () => {
  const pdn = $('pdnTextarea').value.trim();
  if (!pdn) { setState('error', 'Colle un PDN d\'abord.'); return; }
  const tags = {};
  for (const m of pdn.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) tags[m[1]] = m[2];
  const body = pdn.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  const tokens = body.split(/\s+/).filter((t) => /^\d+[x-]\d+([x-]\d+)*$/.test(t));
  if (!tokens.length) { setState('error', 'Aucun coup Manoury trouvé.'); return; }
  runAnalysis(tokens, { White: tags.White || 'Blancs', Black: tags.Black || 'Noirs', WhiteElo: tags.WhiteElo || '', BlackElo: tags.BlackElo || '', Result: tags.Result || '' }, $('usernameInput').value.trim());
});

/* ---- Analyse ---- */
let currentPlies = null, currentRecords = null, currentHeaders = null, currentUsername = null, currentPly = 0;

async function runAnalysis(tokens, headers, username) {
  let plies;
  try {
    const r = dReplayMoves(tokens);
    plies = r.plies;
    if (r.warnings.length) console.warn(r.warnings.join('\n'));
  } catch (e) { setState('error', 'Rejeu impossible : ' + e.message); return; }
  $('results').classList.add('hidden');
  $('gamesListCard').classList.add('hidden');
  const depth = parseInt($('depthSelect').value, 10);
  const eng = getEngine();
  setState('loading', 'Chargement de Scan…');
  try {
    await Promise.race([eng.readyPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Scan ne répond pas — recharge la page.')), 30000))]);
  } catch (e) { setState('error', e.message); return; }
  setState('loading', `Analyse 0 / ${plies.length - 1}`);
  let records;
  try {
    records = await analyzeDraughtsGame(eng, plies, depth, (done, total) => setState('loading', `Analyse ${done} / ${total}`));
  } catch (e) { setState('error', 'Erreur moteur : ' + (e.message || e)); return; }
  setState('success', `${headers.White} vs ${headers.Black} ${headers.Result || ''}`);
  currentPlies = plies; currentRecords = records; currentHeaders = headers; currentUsername = username;
  saveAnalysisToHistory(plies, records, headers, username, depth);
  renderResults(records, headers, username);
}

/* ---- Résultats ---- */
function renderResults(records, headers, username) {
  $('results').classList.remove('hidden');
  buildBoardGrid();
  $('resultsTitle').textContent = (headers.White || 'Blancs') + '  —  ' + (headers.Black || 'Noirs');
  const uname = (username || '').toLowerCase();
  const byColor = { w: [], b: [] };
  records.forEach((r) => byColor[r.color].push(r));
  const nonBook = (arr) => arr.filter((r) => r.cls !== 'book' && r.cls !== 'forced');
  const accW = gameAccuracy(records, 'w').acc, accB = gameAccuracy(records, 'b').acc;
  const MIN_MOVES = 8;
  const eloTxt = (arr, acc) => arr.length >= MIN_MOVES ? '≈ ' + estimatedEloFromAccuracy(acc) : '—';
  const sideCard = (name, elo, acc, arr) => `
    <div class="side-summary">
      <div class="side-name">${name}${name.toLowerCase() === uname ? ' <span class="you">toi</span>' : ''}</div>
      <div class="side-acc">${acc.toFixed(1)}<span class="pct">%</span></div>
      <div class="side-sub">Rating ${elo || '?'} · estimé ${eloTxt(arr, acc)}</div>
    </div>`;
  $('summary').innerHTML = sideCard(headers.White || 'Blancs', headers.WhiteElo, accW, nonBook(byColor.w)) + sideCard(headers.Black || 'Noirs', headers.BlackElo, accB, nonBook(byColor.b));

  const counts = { w: {}, b: {} };
  records.forEach((r) => { counts[r.color][r.cls] = (counts[r.color][r.cls] || 0) + 1; });
  const ORDER = ['best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  $('classTable').innerHTML = ORDER.map((key) => {
    const m = CLASS_META[key];
    const cw = counts.w[key] || 0, cb = counts.b[key] || 0;
    return `<div class="ct-row${cw === 0 && cb === 0 ? ' zero' : ''}">
      <span class="ct-label">${m.label}</span>
      <span class="ct-count" style="color:${m.color}">${cw}</span>
      <span class="dico-pin" style="background:${m.color}">${m.symbol}</span>
      <span class="ct-count" style="color:${m.color}">${cb}</span></div>`;
  }).join('');

  const listEl = $('moveList');
  listEl.innerHTML = '';
  for (let i = 0; i < records.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    row.innerHTML = `<span class="move-num">${i / 2 + 1}.</span>`;
    row.appendChild(moveCell(records[i], i + 1));
    if (records[i + 1]) row.appendChild(moveCell(records[i + 1], i + 2));
    listEl.appendChild(row);
  }
  goToPly(records.length);
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function moveCell(rec, plyIndex) {
  const cell = document.createElement('span');
  cell.className = 'move-cell';
  cell.dataset.ply = plyIndex;
  cell.textContent = rec.notation;
  const meta = CLASS_META[rec.cls];
  const b = document.createElement('span');
  b.className = 'badge'; b.style.color = meta.color; b.textContent = meta.symbol;
  cell.appendChild(b);
  cell.addEventListener('click', () => goToPly(plyIndex));
  return cell;
}

/* ---- Navigation + damier ---- */
function goToPly(ply) {
  if (!currentPlies) return;
  currentPly = Math.max(0, Math.min(ply, currentRecords.length));
  renderPosition(currentPlies[currentPly].fen);
  renderArrows();
  updateEvalBar(currentPly > 0 ? currentRecords[currentPly - 1] : null);
  updateMoveInfo();
  document.querySelectorAll('.move-cell').forEach((el) => el.classList.toggle('active', parseInt(el.dataset.ply, 10) === currentPly));
  const act = document.querySelector('.move-cell.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}
$('btnStart').addEventListener('click', () => goToPly(0));
$('btnPrev').addEventListener('click', () => goToPly(currentPly - 1));
$('btnNext').addEventListener('click', () => goToPly(currentPly + 1));
$('btnEnd').addEventListener('click', () => goToPly(currentRecords ? currentRecords.length : 0));

function formatEval(rec) {
  if (!rec) return '0.0';
  if (rec.winInWhite != null && rec.winInWhite !== 0) return (rec.winInWhite > 0 ? 'G' : '−G') + Math.abs(rec.winInWhite);
  const v = (rec.evalCpWhite || 0) / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
function updateMoveInfo() {
  const el = $('moveInfo');
  if (!currentRecords) { el.innerHTML = ''; return; }
  if (currentPly === 0) { el.innerHTML = '<span class="mi-start">Position de départ</span>'; return; }
  const rec = currentRecords[currentPly - 1];
  const meta = CLASS_META[rec.cls];
  const num = Math.ceil(currentPly / 2);
  const dots = rec.color === 'w' ? '.' : '…';
  let html = `<span class="mi-move">${num}${dots} ${rec.notation}</span>
    <span class="mi-chip" style="color:${meta.color};border-color:${meta.color}55;background:${meta.color}18">${meta.symbol} ${meta.label}</span>
    <span class="mi-eval">${formatEval(rec)}</span>`;
  if (rec.note) html += `<span class="mi-note" style="border-left-color:${meta.color}">${rec.note}</span>`;
  el.innerHTML = html;
}
function updateEvalBar(rec) {
  const cp = rec ? rec.evalCpWhite || 0 : 0;
  const winIn = rec ? rec.winInWhite : null;
  const pct = winIn != null && winIn !== 0 ? (winIn > 0 ? 100 : 0) : 50 + Math.max(-1000, Math.min(1000, cp)) / 1000 * 50;
  $('evalFill').style.height = pct + '%';
  $('evalLabel').textContent = formatEval(rec).replace('+', '');
  $('evalLabel').classList.toggle('on-dark', winIn != null && winIn !== 0 ? winIn < 0 : cp < 0);
}

function buildBoardGrid() {
  const grid = $('boardGrid');
  grid.querySelectorAll('.sq').forEach((n) => n.remove());
  const layer = $('pieceLayer');
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const sqEl = document.createElement('div');
    const dark = (x + y) % 2 === 1;
    sqEl.className = 'sq' + (dark ? ' dark' : '');
    if (dark) sqEl.innerHTML = `<span class="coord">${xyToSq(x, y)}</span>`;
    grid.insertBefore(sqEl, layer);
  }
  syncCellSize();
}
function syncCellSize() {
  const w = $('boardGrid').getBoundingClientRect().width;
  if (w > 0) $('boardGrid').style.setProperty('--cell', (w / 10) + 'px');
}
window.addEventListener('resize', () => { syncCellSize(); renderArrows(); });

function renderPosition(fen) {
  const state = dFenToState(fen);
  const layer = $('pieceLayer');
  const wanted = [];
  state.board.forEach((p, i) => {
    if (p) wanted.push({ sq: i + 1, key: p.color + (p.king ? 'K' : 'm') });
  });
  const existing = [...layer.querySelectorAll('.disc')];
  const used = new Set();
  wanted.forEach((wp) => {
    let hit = existing.find((el) => !used.has(el) && el.dataset.key === wp.key && el.dataset.sq == wp.sq);
    if (!hit) hit = existing.find((el) => !used.has(el) && el.dataset.key === wp.key);
    if (hit) { used.add(hit); wp.el = hit; }
  });
  existing.forEach((el) => { if (!used.has(el)) el.remove(); });
  wanted.forEach((wp) => {
    let el = wp.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'disc ' + wp.key[0] + (wp.key[1] === 'K' ? ' king' : '');
      el.dataset.key = wp.key;
      layer.appendChild(el);
    }
    el.dataset.sq = wp.sq;
    const { x, y } = sqToXY(wp.sq);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  });
}

function renderArrows() {
  const svg = $('arrowSvg');
  const rect = $('boardGrid').getBoundingClientRect();
  const size = rect.width;
  if (!size) return;
  const cell = size / 10;
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = '';
  const center = (sq) => { const { x, y } = sqToXY(sq); return [x * cell + cell / 2, y * cell + cell / 2]; };
  const polyArrow = (path, color, dashed) => {
    const pts = path.map(center);
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', color);
    pl.setAttribute('stroke-width', cell * 0.13);
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('opacity', dashed ? 0.55 : 0.85);
    if (dashed) pl.setAttribute('stroke-dasharray', '5,4');
    svg.appendChild(pl);
    // tête de flèche sur le dernier segment
    const [x1, y1] = pts[pts.length - 2], [x2, y2] = pts[pts.length - 1];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const h = cell * 0.28;
    const tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tri.setAttribute('d', `M${x2},${y2} L${x2 - h * Math.cos(ang - 0.5)},${y2 - h * Math.sin(ang - 0.5)} L${x2 - h * Math.cos(ang + 0.5)},${y2 - h * Math.sin(ang + 0.5)} Z`);
    tri.setAttribute('fill', color);
    tri.setAttribute('opacity', dashed ? 0.55 : 0.9);
    svg.appendChild(tri);
  };
  const badge = (sq, meta) => {
    const { x, y } = sqToXY(sq);
    const cx = x * cell + cell * 0.78, cy = y * cell + cell * 0.22, r = cell * 0.2;
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', meta.color); c.setAttribute('stroke', 'rgba(12,12,12,.55)');
    svg.appendChild(c);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', cx); t.setAttribute('y', cy);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', r * 1.1); t.setAttribute('font-weight', 'bold'); t.setAttribute('fill', '#14181c');
    t.textContent = meta.symbol;
    svg.appendChild(t);
  };
  if (currentRecords && currentPly > 0) {
    const rec = currentRecords[currentPly - 1];
    const meta = CLASS_META[rec.cls];
    if (rec.playedMove && rec.playedMove.path) {
      polyArrow(rec.playedMove.path, meta.color, false); // la flèche suit toute la rafle
      badge(rec.playedMove.to, meta);
    }
  }
  if (currentRecords && currentPly < currentRecords.length) {
    const next = currentRecords[currentPly];
    if (next.bestMove) polyArrow([next.bestMove.from, next.bestMove.to], '#2fb3ab', true);
  }
}

/* ---- Export CSV ---- */
function csvEscape(f) { const s = String(f == null ? '' : f); return (s.includes(';') || s.includes('"')) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvRow(a) { return a.map(csvEscape).join(';') + '\r\n'; }
$('btnExportCSV').addEventListener('click', () => {
  if (!currentRecords) return;
  let csv = csvRow(['Coup', 'Type de coup', 'Éval']);
  currentRecords.forEach((rec, i) => {
    const num = Math.ceil((i + 1) / 2);
    csv += csvRow([(i % 2 === 0 ? num + '. ' : num + '... ') + rec.notation, CLASS_META[rec.cls].label, formatEval(rec)]);
  });
  const accW = gameAccuracy(currentRecords, 'w').acc, accB = gameAccuracy(currentRecords, 'b').acc;
  const h = currentHeaders || {};
  csv += '\r\n' + csvRow(['Bilan', 'Blancs — ' + (h.White || '?'), 'Noirs — ' + (h.Black || '?')]);
  csv += csvRow(['Précision', accW.toFixed(2) + '%', accB.toFixed(2) + '%']);
  csv += csvRow(['Rating', h.WhiteElo || '?', h.BlackElo || '?']);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'analyse_dames_' + ((h.White || 'B') + '_vs_' + (h.Black || 'N')).replace(/[^\w-]+/g, '_') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
});

/* ---- Init ---- */
getEngine();
