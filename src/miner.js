#!/usr/bin/env node
/**
 * gnfp-mine — dedicated $GNFP CPU miner.
 * --threads N starts N real worker_threads (cap 256). Main thread only
 * speaks stratum and submits every valid share immediately.
 */
import net from 'net';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.1';
export const DEFAULT_POOL = 'de.restoreprivacy.online:1474';
export const MAX_THREADS = 256;
export const HASH_WORKER = fileURLToPath(new URL('./hash_worker.js', import.meta.url));

export const HELP = `gnfp-mine ${VERSION} — $GNFP CPU miner (BeamHash III wire)

Usage:
  gnfp-mine --pool de.restoreprivacy.online:1474 --user YOUR_GNFP1.worker --threads 8

Options:
  --pool HOST:PORT   default ${DEFAULT_POOL} (plain TCP, --notls implied)
                     also: sg.restoreprivacy.online:1474 (join)
                           hel.restoreprivacy.online:1474 (Helsinki front)
  --user NAME.RIG    gnfp1 payout address.worker
  --threads N        real CPU workers (default = CPU count, max ${MAX_THREADS})
  --help
`;

function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

export function defaultThreadCount() {
  const n = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (os.cpus() || []).length || 1;
  return honorThreads(n).threads;
}

export function honorThreads(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return { threads: 1 };
  return { threads: Math.min(MAX_THREADS, n) };
}

export function parseMinerArgs(argv = process.argv) {
  const pool = flag(argv, '--pool', DEFAULT_POOL);
  const user = flag(argv, '--user', 'GNFP_USERNAME.WORKER');
  const rawThreads = flag(argv, '--threads', '');
  const threads = rawThreads === '' || rawThreads == null
    ? defaultThreadCount()
    : honorThreads(rawThreads).threads;
  const [host, portStr] = String(pool).split(':');
  return { pool, user, host, port: Number(portStr || 1474), threads };
}

export function createHashFarm(threadCount, workerPath = HASH_WORKER) {
  const n = honorThreads(threadCount).threads;
  const workers = [];
  const listeners = [];
  for (let i = 0; i < n; i += 1) {
    const w = new Worker(workerPath, {
      workerData: { id: i, start: i, stride: n },
    });
    w.on('message', (m) => {
      for (const fn of listeners) fn({ ...m, workerId: i });
    });
    w.on('error', () => {});
    workers.push(w);
  }
  return {
    count: n,
    setJob(job) {
      for (const w of workers) w.postMessage({ type: 'job', job });
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    async close() {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

function connectOnce(cfg) {
  return new Promise((resolve) => {
    const sock = net.connect(cfg.port, cfg.host);
    sock.setEncoding('utf8');
    let buf = '';
    let job = null;
    let hashes = 0;
    const started = Date.now();
    let done = false;
    const farm = createHashFarm(cfg.threads);

    function finish(why) {
      if (done) return;
      done = true;
      farm.close().catch(() => {});
      try {
        sock.destroy();
      } catch {
        /* already closed */
      }
      resolve(why);
    }

    function send(obj) {
      if (!sock.writable) return;
      sock.write(`${JSON.stringify(obj)}\n`);
    }

    function reportStats() {
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      send({
        method: 'stats',
        login: cfg.user,
        threads: cfg.threads,
        hashes,
        hashrate: hashes / elapsed,
        version: VERSION,
        jobId: job?.jobId || job?.id,
        height: job?.height,
        jsonrpc: '2.0',
      });
    }

    farm.onMessage((msg) => {
      if (msg.type === 'hashed') hashes += Number(msg.n || 0);
      if (msg.type === 'share' && msg.nonce) {
        send({
          method: 'submit',
          id: job?.jobId || job?.id || '1',
          nonce: msg.nonce,
          output: '',
          jobId: job?.jobId || job?.id,
          jsonrpc: '2.0',
        });
      }
    });

    sock.on('connect', () => {
      send({ method: 'login', login: cfg.user, id: 1, jsonrpc: '2.0' });
    });
    sock.on('error', (err) => {
      console.error('socket', err.message);
      finish(err.message);
    });
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method === 'job' || msg.input || msg.preWork) {
          job = msg;
          farm.setJob(job);
          console.log(
            `job ${msg.jobId || msg.id} height=${msg.height} diff=${msg.difficulty} algo=${msg.algorithm || 'beamhashIII'} workers=${cfg.threads}`,
          );
        } else if (msg.description) {
          console.log('pool:', msg.description, msg.asset || '');
        } else if (msg.error) {
          console.log('pool error:', msg.error);
        }
      }
    });

    const statsTick = setInterval(reportStats, 1000);
    sock.on('close', () => {
      clearInterval(statsTick);
      finish('closed');
    });
  });
}

export function main(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const cfg = parseMinerArgs(argv);
  if (argv.includes('--print-config')) {
    process.stdout.write(`${JSON.stringify({ ...cfg, coin: 'GNFP', version: VERSION })}\n`);
    return 0;
  }

  console.log(
    `gnfp-mine ${VERSION} → tcp://${cfg.host}:${cfg.port} user=${cfg.user} threads=${cfg.threads} coin=GNFP`,
  );

  const loop = async () => {
    for (;;) {
      await connectOnce(cfg);
      console.log('reconnect in 2s', cfg.host, cfg.port);
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  loop();
  return { cfg };
}

const here = import.meta.url;
if (process.argv[1] && here.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const code = main(process.argv);
  if (typeof code === 'number') process.exit(code);
}
