/* scan-engine.js — wrapper léger autour du worker Scan (protocole Hub).
   Même philosophie que le wrapper UCI Stockfish de l'outil échecs :
   une instance, une requête à la fois, file d'attente.

   Protocole (lu dans lidrobile/ScanClient.ts) :
   <- 'hub'                          -> 'id name=Scan version=3.1' … 'wait'
   <- 'set-param name=X value=Y'
   <- 'init'                         -> 'ready'
   <- 'pos pos=Wbbb…eee…www'
   <- 'level depth=N'
   <- 'go analyze'                   -> 'info depth=… score=… pv="…"' … 'done move=…'
   Score : float en unités de pion, POV du camp au trait.
   |score*100| > 8000 : gain/perte forcé(e) (équivalent du "mat en N"). */
class ScanEngine {
  constructor(path) {
    this.worker = new Worker(path || 'scan_normal.js');
    this.busy = false;
    this.queue = [];
    this._current = null;
    this.engineName = 'Scan';
    this.readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
    this.worker.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : String(e.data));
    this.worker.onerror = (e) => console.error('Scan worker error:', e.message || e);
    // Handshake. bb-size=0 : les bitbases de finales ne sont pas incluses
    // dans scan_normal.data (cf. README scan-wasm), on les désactive.
    this.send('hub');
    this.send('set-param name=tt-size value=20');
    this.send('set-param name=bb-size value=0');
    this.send('init');
  }
  send(cmd) { this.worker.postMessage(cmd); }

  _onLine(raw) {
    raw.split('\n').forEach((line) => {
      if (!line) return;
      if (line.startsWith('id ')) {
        const m = line.match(/name=(\S+)\s+version=(\S+)/);
        if (m) this.engineName = m[1] + ' ' + m[2];
        return;
      }
      if (line.startsWith('ready')) { this._resolveReady(); this._pump(); return; }
      if (!this._current) return;
      if (line.startsWith('info ')) this._parseInfo(line);
      else if (line.startsWith('done')) this._finish(line);
    });
  }

  _parseInfo(line) {
    const depth = (line.match(/depth=(\d+)/) || [])[1];
    const score = (line.match(/score=(-?[\d.]+)/) || [])[1];
    const pv = (line.match(/pv="?([0-9x\-\s]+)"?/) || [])[1];
    if (score == null) return;
    const cur = this._current;
    cur.depth = parseInt(depth || '0', 10);
    cur.scoreCp = Math.round(parseFloat(score) * 100); // centi-pions, POV camp au trait
    cur.pv = pv ? pv.trim().split(/\s+/) : cur.pv;
    // encodage des gains forcés (cf. ScanClient.ts) : |cp|>9000 = gain
    // prouvé par la recherche, |cp|>8000 = gain prouvé par bitbase
    cur.winIn = null;
    const a = Math.abs(cur.scoreCp);
    if (a > 9000) { const ply = cur.scoreCp > 0 ? 10000 - cur.scoreCp : -(10000 + cur.scoreCp); cur.winIn = Math.round((ply + (ply % 2)) / 2); }
    else if (a > 8000) { const ply = cur.scoreCp > 0 ? 9000 - cur.scoreCp : -(9000 + cur.scoreCp); cur.winIn = Math.round((ply + (ply % 2)) / 2); }
    if (cur.onProgress) cur.onProgress(cur.scoreCp, cur.depth);
  }

  _finish(line) {
    const m = line.match(/move=([0-9x\-]+)/);
    const job = this._current;
    this._current = null;
    this.busy = false;
    if (job) {
      job.resolve({
        bestMove: m ? m[1] : (job.pv && job.pv[0]) || null,
        scoreCp: job.scoreCp != null ? job.scoreCp : 0, // POV camp au trait
        winIn: job.winIn, // gain forcé en N coups (signe = camp au trait), sinon null
        depth: job.depth || 0,
        pv: job.pv || [],
      });
    }
    this._pump();
  }

  _pump() {
    if (this.busy || this.queue.length === 0) return;
    const job = this.queue.shift();
    this.busy = true;
    this._current = { resolve: job.resolve, onProgress: job.onProgress, pv: [], scoreCp: null };
    this.send('pos pos=' + job.scanFen);
    this.send('level depth=' + (job.depth || 11));
    this.send('go analyze');
  }

  /** Analyse une position. scanFen = format hub ('W'+50 chars). */
  analyze(scanFen, opts = {}) {
    return this.readyPromise.then(() => new Promise((resolve) => {
      this.queue.push({ scanFen, depth: opts.depth, onProgress: opts.onProgress, resolve });
      this._pump();
    }));
  }
  stop() { this.send('stop'); }
  terminate() { this.worker.terminate(); }
}
