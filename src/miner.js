#!/usr/bin/env node
/**
 * gnfp-mine — dedicated $GNFP CPU miner.
 * --threads N starts N real worker_threads (cap 256). Main thread only
 * speaks stratum and submits every valid share immediately.
 * Refuses to connect or hash without a real gnfp1 payout address.
 */
import fs from 'node:fs';
import net from 'net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { hashMeetsJob, prepareShareSubmit, snapshotJob } from './hash_share.js';

export { prepareShareSubmit, snapshotJob, hashMeetsJob } from './hash_share.js';

export const VERSION = '1.0.6';
export const CLIENT = 'gnfp-mine';
export const DEFAULT_POOL = 'de.restoreprivacy.online:1474';
export const MAX_THREADS = 256;
export const HASH_WORKER = fileURLToPath(new URL('./hash_worker.js', import.meta.url));
export const GNFP1_RE = /^gnfp1[0-9a-z]{20,80}$/i;
export const REFUSE_MSG = 'gnfp-mine: refuse — need a real gnfp1 payout address (--user gnfp1….worker)';

export const HELP = `gnfp-mine ${VERSION} — $GNFP CPU miner (BeamHash III wire)

Usage:
  gnfp-mine --pool de.restoreprivacy.online:1474 --user gnfp1YOURADDRESS.worker --threads 8

A real gnfp1 payout address is required. The miner will not connect or hash
without one. After a valid run, pool / user / threads are remembered and
reused when you omit those flags.

Options:
  --pool HOST:PORT   default ${DEFAULT_POOL} (plain TCP, --notls implied)
                     also: sg.restoreprivacy.online:1474 (join)
                           hel.restoreprivacy.online:1474 (Helsinki front)
  --user NAME.RIG    gnfp1 payout address.worker   (required unless remembered)
  --threads N        real CPU workers (default = CPU count, max ${MAX_THREADS})
  --tls              TLS stratum (off for GNFP :1474, which is plain TCP)
  --print-config     print resolved pool/user/threads and exit
  --help
`;

export function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

export function hasFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined;
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

export function isGnfpPayoutAddress(value) {
  return GNFP1_RE.test(String(value || '').trim());
}

export function payoutFromLogin(user) {
  return String(user || '').trim().split('.')[0] || '';
}

export function validateMinerUser(user) {
  const raw = String(user || '').trim();
  if (!raw) return { ok: false, reason: 'gnfp_address_required' };
  const parts = raw.split('.');
  const address = parts[0];
  const worker = parts.slice(1).join('.') || 'worker';
  if (!isGnfpPayoutAddress(address)) {
    return { ok: false, reason: 'gnfp_address_required' };
  }
  return { ok: true, address, worker, login: `${address}.${worker}` };
}

export function defaultConfigPath(env = process.env) {
  if (env.GNFP_MINE_CONFIG) return String(env.GNFP_MINE_CONFIG);
  return path.join(os.homedir(), '.gnfp-mine', 'config.json');
}

export function loadMinerConfig(file) {
  const dest = String(file || '');
  if (!dest || !fs.existsSync(dest)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(dest, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const user = String(raw.user || '').trim();
    if (!validateMinerUser(user).ok) return null;
    const pool = String(raw.pool || '').trim() || DEFAULT_POOL;
    const threads = honorThreads(raw.threads).threads;
    return { pool, user, threads, tls: Boolean(raw.tls) };
  } catch {
    return null;
  }
}

export function saveMinerConfig(file, cfg) {
  const dest = String(file || '');
  if (!dest) return null;
  const gate = validateMinerUser(cfg?.user);
  if (!gate.ok) return null;
  const rec = {
    pool: String(cfg.pool || DEFAULT_POOL),
    user: gate.login,
    threads: honorThreads(cfg.threads).threads,
    tls: Boolean(cfg.tls),
    version: VERSION,
    coin: 'GNFP',
  };
  const dir = path.dirname(dest);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dest}.tmp`, `${JSON.stringify(rec, null, 2)}\n`);
  fs.renameSync(`${dest}.tmp`, dest);
  return rec;
}

export function parseMinerArgs(argv = process.argv, saved = null) {
  const prior = saved && typeof saved === 'object' ? saved : {};
  const pool = hasFlag(argv, '--pool') ? flag(argv, '--pool') : (prior.pool || DEFAULT_POOL);
  const user = hasFlag(argv, '--user') ? flag(argv, '--user') : (prior.user || '');
  const threads = hasFlag(argv, '--threads')
    ? honorThreads(flag(argv, '--threads')).threads
    : (prior.threads != null ? honorThreads(prior.threads).threads : defaultThreadCount());
  const useTls = argv.includes('--tls') || (prior.tls === true && !argv.includes('--notls'));
  const [host, portStr] = String(pool).split(':');
  const gate = validateMinerUser(user);
  return {
    pool,
    user: gate.ok ? gate.login : user,
    host,
    port: Number(portStr || 1474),
    threads,
    tls: useTls,
    worker: gate.ok ? gate.worker : '',
    address: gate.ok ? gate.address : payoutFromLogin(user),
    suppliedUser: hasFlag(argv, '--user'),
    suppliedPool: hasFlag(argv, '--pool'),
    suppliedThreads: hasFlag(argv, '--threads'),
    suppliedTls: argv.includes('--tls') || argv.includes('--notls'),
  };
}

export function resolveMinerConfig(argv = process.argv, { configPath, env = process.env } = {}) {
  const file = configPath || defaultConfigPath(env);
  const saved = loadMinerConfig(file);
  const cfg = parseMinerArgs(argv, saved);
  const gate = validateMinerUser(cfg.user);
  return { ...cfg, configPath: file, saved: Boolean(saved), gate };
}

export function classifyPoolReply(msg) {
  if (!msg || typeof msg !== 'object') return { kind: 'unknown' };
  const desc = String(msg.description || msg.result || '').toLowerCase();
  const code = Number(msg.code);
  const formed = msg.formed === true || msg.block?.formed === true;
  if (formed || /\bblock\b/.test(desc) || desc.includes('block found')) {
    return { kind: 'block', description: msg.description || 'block' };
  }
  if (desc === 'accepted' || code === 1) {
    return { kind: 'accepted', description: msg.description || 'accepted' };
  }
  if (desc.includes('login')) return { kind: 'login', description: msg.description };
  if (desc === 'stats ok' || desc.includes('stats')) return { kind: 'stats', description: msg.description };
  if (msg.error || desc.includes('rejected') || (Number.isFinite(code) && code < 0)) {
    return {
      kind: 'rejected',
      description: msg.description || (typeof msg.error === 'string' ? msg.error : 'rejected'),
    };
  }
  return { kind: 'other', description: msg.description };
}

export function createMinerStats() {
  return { accepted: 0, rejected: 0, blocks: 0, hashes: 0 };
}

export function applyShareAck(stats, reply) {
  const next = {
    accepted: Number(stats?.accepted || 0),
    rejected: Number(stats?.rejected || 0),
    blocks: Number(stats?.blocks || 0),
    hashes: Number(stats?.hashes || 0),
  };
  if (reply?.kind === 'accepted') next.accepted += 1;
  if (reply?.kind === 'rejected') next.rejected += 1;
  if (reply?.kind === 'block') {
    next.accepted += 1;
    next.blocks += 1;
  }
  return next;
}

export function fmtRate(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MH/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} kH/s`;
  return `${v.toFixed(1)} H/s`;
}

export function formatLiveStatus({
  hashrate = 0,
  worker = 'worker',
  accepted = 0,
  rejected = 0,
  blocks = 0,
  threads = 0,
  height = 0,
  pool = DEFAULT_POOL,
} = {}) {
  return [
    `hashrate=${fmtRate(hashrate)}`,
    `worker=${worker}`,
    `accepted=${Number(accepted) || 0}`,
    `rejected=${Number(rejected) || 0}`,
    `blocks=${Number(blocks) || 0}`,
    `threads=${Number(threads) || 0}`,
    `height=${Number(height) || 0}`,
    `pool=${pool}`,
  ].join(' ');
}

export function stratumLoginMsg(cfg) {
  return {
    method: 'login',
    login: cfg.user,
    threads: cfg.threads,
    client: CLIENT,
    version: VERSION,
    id: 1,
    jsonrpc: '2.0',
  };
}

export function stratumStatsMsg(cfg, extra = {}) {
  return {
    method: 'stats',
    login: cfg.user,
    threads: cfg.threads,
    client: CLIENT,
    version: VERSION,
    jsonrpc: '2.0',
    ...extra,
  };
}

export function stratumSubmitMsg(cfg, job, nonce) {
  const snap = snapshotJob(job) || {};
  const jobId = snap.jobId || '1';
  return {
    method: 'submit',
    login: cfg.user,
    threads: cfg.threads,
    client: CLIENT,
    version: VERSION,
    id: jobId,
    nonce: String(nonce || ''),
    output: '',
    jobId,
    jsonrpc: '2.0',
  };
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
      const snap = snapshotJob(job);
      for (const w of workers) w.postMessage({ type: 'job', job: snap });
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    async close() {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

function openStratum(cfg) {
  if (cfg.tls) {
    return tls.connect({
      host: cfg.host,
      port: cfg.port,
      rejectUnauthorized: false,
      requestCert: false,
    });
  }
  return net.connect(cfg.port, cfg.host);
}

function connectOnce(cfg, session) {
  return new Promise((resolve) => {
    const sock = openStratum(cfg);
    sock.setEncoding('utf8');
    let buf = '';
    let job = null;
    const started = Date.now();
    let hashes = 0;
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
      if (!sock.writable || !obj || typeof obj !== 'object') return;
      let line;
      try {
        line = `${JSON.stringify(obj)}\n`;
      } catch {
        return;
      }
      sock.write(line);
    }

    const seenShares = new Set();
    const shareQueue = [];
    const seenJobs = [];
    function rememberJob(next) {
      const id = String(next?.jobId || next?.id || '');
      if (!id) return;
      if (!seenJobs.includes(id)) seenJobs.push(id);
      while (seenJobs.length > 8) {
        const drop = seenJobs.shift();
        for (const key of [...seenShares]) {
          if (String(key).startsWith(`${drop}:`)) seenShares.delete(key);
        }
        for (let i = shareQueue.length - 1; i >= 0; i -= 1) {
          if (shareQueue[i].job.jobId === drop) shareQueue.splice(i, 1);
        }
      }
    }
    function enqueueShare(foundOn, nonce) {
      const prep = prepareShareSubmit({ foundOn, nonce, seen: seenShares });
      if (!prep.ok) return;
      shareQueue.push(prep);
    }
    function drainShares() {
      let n = 0;
      while (n < 4 && shareQueue.length) {
        const prep = shareQueue.shift();
        if (!prep || !hashMeetsJob(prep.job, prep.nonce, '')) continue;
        send(stratumSubmitMsg(cfg, prep.job, prep.nonce));
        n += 1;
      }
    }

    function paintLive() {
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      const line = formatLiveStatus({
        hashrate: hashes / elapsed,
        worker: cfg.worker || 'worker',
        accepted: session.accepted,
        rejected: session.rejected,
        blocks: session.blocks,
        threads: cfg.threads,
        height: job?.height || session.height || 0,
        pool: cfg.pool,
      });
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${line}`);
      } else {
        console.log(line);
      }
    }

    function reportStats() {
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      send(stratumStatsMsg(cfg, {
        hashes,
        hashrate: hashes / elapsed,
        version: VERSION,
        jobId: job?.jobId || job?.id,
        height: job?.height,
      }));
      paintLive();
    }

    farm.onMessage((msg) => {
      if (msg.type === 'hashed') hashes += Number(msg.n || 0);
      if (msg.type === 'share' && msg.nonce) {
        enqueueShare(msg.job || job, msg.nonce);
      }
    });

    const onReady = () => send(stratumLoginMsg(cfg));
    if (cfg.tls) sock.once('secureConnect', onReady);
    else sock.once('connect', onReady);
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
          job = snapshotJob(msg);
          session.height = Number(job?.height) || session.height || 0;
          rememberJob(job);
          farm.setJob(job);
          console.log(
            `job ${msg.jobId || msg.id} height=${msg.height} diff=${msg.difficulty} algo=${msg.algorithm || 'beamhashIII'} workers=${cfg.threads}`,
          );
          continue;
        }
        const reply = classifyPoolReply(msg);
        if (reply.kind === 'accepted' || reply.kind === 'rejected' || reply.kind === 'block') {
          const next = applyShareAck(session, reply);
          session.accepted = next.accepted;
          session.rejected = next.rejected;
          session.blocks = next.blocks;
          if (reply.kind === 'block') {
            console.log(`BLOCK FOUND worker=${cfg.worker} height=${job?.height || session.height || 0}`);
          } else {
            console.log(`${reply.kind} share worker=${cfg.worker} ${reply.description || ''}`);
          }
          paintLive();
        } else if (reply.kind === 'login') {
          console.log('pool:', msg.description, msg.asset || 'GNFP');
        } else if (msg.error && reply.kind === 'other') {
          console.log('pool error:', msg.error);
        }
      }
    });

    const statsTick = setInterval(reportStats, 1000);
    const shareTick = setInterval(drainShares, 20);
    sock.on('close', () => {
      clearInterval(statsTick);
      clearInterval(shareTick);
      if (process.stdout.isTTY) process.stdout.write('\n');
      finish('closed');
    });
  });
}

export function main(argv = process.argv, opts = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const resolved = resolveMinerConfig(argv, opts);
  const cfg = resolved;
  if (argv.includes('--print-config')) {
    if (cfg.gate.ok && (cfg.suppliedUser || cfg.suppliedPool || cfg.suppliedThreads || cfg.suppliedTls || !cfg.saved)) {
      saveMinerConfig(cfg.configPath, cfg);
    }
    process.stdout.write(`${JSON.stringify({
      pool: cfg.pool,
      user: cfg.user,
      threads: cfg.threads,
      tls: Boolean(cfg.tls),
      host: cfg.host,
      port: cfg.port,
      worker: cfg.worker,
      coin: 'GNFP',
      version: VERSION,
    })}\n`);
    if (!cfg.gate.ok) {
      process.stderr.write(`${REFUSE_MSG}\n`);
      return 2;
    }
    return 0;
  }

  if (!cfg.gate.ok) {
    process.stderr.write(`${REFUSE_MSG}\n`);
    return 2;
  }

  const saved = saveMinerConfig(cfg.configPath, cfg);
  if (!saved) {
    process.stderr.write(`${REFUSE_MSG}\n`);
    return 2;
  }

  console.log(
    `gnfp-mine ${VERSION} → tcp://${cfg.host}:${cfg.port} user=${cfg.user} threads=${cfg.threads} coin=GNFP`,
  );

  const session = createMinerStats();
  const loop = async () => {
    for (;;) {
      await connectOnce(cfg, session);
      console.log('reconnect in 2s', cfg.host, cfg.port);
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  loop();
  return { cfg, session };
}

const here = import.meta.url;
if (process.argv[1] && here.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const code = main(process.argv);
  if (typeof code === 'number') process.exit(code);
}
