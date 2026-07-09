/* Lightweight UCI wrapper around the Stockfish.js Web Worker.
   One engine instance, one query in flight at a time (queued). */
class Engine {
  constructor(path) {
    this.worker = new Worker(path);
    this.busy = false;
    this.queue = [];
    this.readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
    this.worker.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : String(e.data));
    this.worker.onerror = (e) => {
      console.error('Stockfish worker error:', e.message || e);
    };
    this._current = null;
    this.send('uci');
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  _onLine(raw) {
    raw.split('\n').forEach((line) => {
      if (!line) return;
      if (line === 'uciok') {
        this.send('isready');
        return;
      }
      if (line === 'readyok') {
        this._resolveReady();
        this._pump();
        return;
      }
      if (!this._current) return;
      if (line.startsWith('info') && line.includes('score')) {
        this._parseInfo(line);
      } else if (line.startsWith('bestmove')) {
        this._finish(line);
      }
    });
  }

  _parseInfo(line) {
    const mpvMatch = line.match(/multipv (\d+)/);
    const mpv = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;
    const depthMatch = line.match(/(?:^| )depth (\d+)/);
    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);
    const entry = {
      multipv: mpv,
      depth,
      cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
      mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
      pv: pvMatch ? pvMatch[1].trim().split(' ') : [],
    };
    if (this._current) {
      this._current.lines[mpv] = entry;
      this._current.depthReached = Math.max(this._current.depthReached, depth);
      if (this._current.onProgress) this._current.onProgress(this._current.lines, depth);
    }
  }

  _finish(line) {
    const parts = line.split(' ');
    const bestMoveUci = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const job = this._current;
    this._current = null;
    this.busy = false;
    if (job) {
      job.resolve({
        bestMoveUci,
        lines: job.lines,
        depthReached: job.depthReached,
      });
    }
    this._pump();
  }

  _pump() {
    if (this.busy || this.queue.length === 0) return;
    const job = this.queue.shift();
    this.busy = true;
    this._current = { lines: {}, depthReached: 0, resolve: job.resolve, onProgress: job.onProgress };
    this.send('setoption name MultiPV value ' + (job.multipv || 1));
    if (job.limitStrength) {
      this.send('setoption name UCI_LimitStrength value true');
      this.send('setoption name UCI_Elo value ' + job.elo);
    } else {
      this.send('setoption name UCI_LimitStrength value false');
    }
    this.send('position fen ' + job.fen);
    if (job.movetime) this.send('go movetime ' + job.movetime);
    else this.send('go depth ' + (job.depth || 12));
  }

  /**
   * Analyze a position.
   * opts: { depth, movetime, multipv, limitStrength, elo, onProgress }
   */
  analyze(fen, opts = {}) {
    return this.readyPromise.then(() => new Promise((resolve) => {
      this.queue.push({
        fen,
        depth: opts.depth,
        movetime: opts.movetime,
        multipv: opts.multipv || 1,
        limitStrength: !!opts.limitStrength,
        elo: opts.elo || 1500,
        onProgress: opts.onProgress,
        resolve,
      });
      this._pump();
    }));
  }

  // Vide la table de transposition et l'historique interne du moteur.
  // À appeler avant d'analyser une nouvelle partie : sans ça, les données
  // laissées par les positions précédentes peuvent légèrement influencer
  // l'éval/le meilleur coup calculés sur une position pourtant identique
  // d'une fois à l'autre — source de non-déterminisme entre deux analyses.
  newGame() {
    this.send('ucinewgame');
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}
