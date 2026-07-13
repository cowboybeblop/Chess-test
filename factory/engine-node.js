/* engine-node.js — adaptateur UCI pour Stockfish NATIF, avec exactement la
   même interface que la classe Engine du navigateur (analyze, readyPromise),
   pour pouvoir réutiliser analyzeGame() du pipeline web tel quel. */
const { spawn } = require('child_process');

class NodeEngine {
  constructor(binPath, threads) {
    this.proc = spawn(binPath || process.env.STOCKFISH_PATH || '/usr/games/stockfish');
    this.busy = false;
    this.queue = [];
    this._current = null;
    this._buf = '';
    this.readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
    this.proc.stdout.on('data', (d) => {
      this._buf += d.toString();
      let idx;
      while ((idx = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, idx).trim();
        this._buf = this._buf.slice(idx + 1);
        if (line) this._onLine(line);
      }
    });
    this.proc.on('error', (e) => { console.error('stockfish:', e.message); process.exit(1); });
    this.send('uci');
    this.send('setoption name Threads value ' + (threads || 2));
    this.send('setoption name Hash value 128');
  }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  _onLine(line) {
    if (line === 'uciok') { this.send('isready'); return; }
    if (line === 'readyok') { this._resolveReady(); this._pump(); return; }
    if (!this._current) return;
    if (line.startsWith('info') && line.includes('score')) this._parseInfo(line);
    else if (line.startsWith('bestmove')) this._finish(line);
  }
  _parseInfo(line) {
    const mpv = parseInt((line.match(/multipv (\d+)/) || [])[1] || '1', 10);
    const depth = parseInt((line.match(/(?:^| )depth (\d+)/) || [])[1] || '0', 10);
    const cp = line.match(/score cp (-?\d+)/);
    const mate = line.match(/score mate (-?\d+)/);
    const pv = line.match(/ pv (.+)$/);
    const entry = { multipv: mpv, depth, cp: cp ? parseInt(cp[1], 10) : null, mate: mate ? parseInt(mate[1], 10) : null, pv: pv ? pv[1].trim().split(' ') : [] };
    const cur = this._current;
    cur.lines[mpv] = entry;
    cur.depthReached = Math.max(cur.depthReached, depth);
    if (cur.onProgress) cur.onProgress(cur.lines, depth);
  }
  _finish(line) {
    const parts = line.split(' ');
    const best = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const job = this._current;
    this._current = null;
    this.busy = false;
    if (job) job.resolve({ bestMoveUci: best, lines: job.lines, depthReached: job.depthReached });
    this._pump();
  }
  _pump() {
    if (this.busy || !this.queue.length) return;
    const job = this.queue.shift();
    this.busy = true;
    this._current = { lines: {}, depthReached: 0, resolve: job.resolve, onProgress: job.onProgress };
    this.send('setoption name MultiPV value ' + (job.multipv || 1));
    this.send('position fen ' + job.fen);
    this.send('go depth ' + (job.depth || 12));
  }
  analyze(fen, opts = {}) {
    return this.readyPromise.then(() => new Promise((resolve) => {
      this.queue.push({ fen, depth: opts.depth, multipv: opts.multipv || 1, onProgress: opts.onProgress, resolve });
      this._pump();
    }));
  }
  newGame() { return this.readyPromise.then(() => { this.send('ucinewgame'); }); }
  terminate() { this.proc.kill(); }
}
module.exports = { NodeEngine };
