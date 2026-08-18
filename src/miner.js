#!/usr/bin/env node
/**
 * gnfp-mine — dedicated $GNFP CPU miner.
 * --threads N starts N real worker_threads (cap 256). Main thread only
 * speaks stratum and submits one current-job share at a time.
 * Refuses to connect or hash without a real gnfp1 payout address.
 */
import fs from 'node:fs';
import net from 'net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  createSharePipeline,
  snapshotJob,
} from './hash_share.js';

export {
  createSharePipeline,
  prepareShareSubmit,
  snapshotJob,
  hashMeetsJob,
} from './hash_share.js';

export const VERSION = '1.0.2';
export const CLIENT = 'GNFPHash';
export const ALGORITHM = 'GNFPHash';
export const DEFAULT_POOL = 'de.restoreprivacy.online:1474';
export const MAX_THREADS = 256;
export const CONNECT_TIMEOUT_MS = 15_000;
export const TLS_REQUIRED_MSG = 'pool is TLS. public book/fronts need TLS — drop --notls (or delete ~/.gnfp-mine/config.json)';
export const HASH_WORKER = fileURLToPath(new URL('./hash_worker.js', import.meta.url));
export const GNFP1_RE = /^gnfp1[0-9a-z]{20,80}$/i;
export const DEFAULT_WORKER = 'worker';
export const MIN_WORKER_LEN = 1;
export const MAX_WORKER_LEN = 24;
export const WORKER_RE = /^[a-z0-9_-]{1,24}$/i;
export const REFUSE_MSG = 'gnfp-mine: refuse — need a real gnfp1 payout address (--user gnfp1….worker)';
export const WORKER_REFUSE_MSG = `gnfp-mine: refuse — worker name must be ${MIN_WORKER_LEN}–${MAX_WORKER_LEN} letters, digits, _ or - (--user gnfp1ADDRESS.NAME or --worker NAME)`;
export const OLD_MINER_HINT = 'pool refused this client — use GNFPHash 1.0.2+ (client/algorithm GNFPHash) against gnfp-node 1.0.8+';

export const HELP = `GNFPHash ${VERSION} — $GNFP CPU miner (gnfp-mine binary). CPU-only. BeamHash III mints nothing.

Usage:
  gnfp-mine --pool de.restoreprivacy.online:1474 --user gnfp1YOURADDRESS.worker --threads 8
  gnfp-mine --user gnfp1YOURADDRESS --worker 1 --threads 8

A real gnfp1 payout address is required. Pick your own worker name (1–24
letters/digits/_/-). If you omit it, the default is "${DEFAULT_WORKER}". After a
valid run, pool / user / threads are remembered and reused when you omit those flags.

Options:
  --pool HOST:PORT   default ${DEFAULT_POOL} (TLS by default)
                     also: sg.restoreprivacy.online:1474
  --user NAME.RIG    gnfp1 payout address.worker   (required unless remembered)
  --worker NAME      worker tag 1–${MAX_WORKER_LEN} chars (overrides the .tag on --user)
  --threads N        real CPU workers (default = all device threads minus 1, max ${MAX_THREADS})
  --notls            local plaintext stratum only (public book/fronts are TLS)
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

export function deviceCpuCount() {
  const n = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (os.cpus() || []).length || 1;
  return Math.max(1, Math.floor(Number(n) || 1));
}

/** Never all cores: cap at device CPUs minus 1 (or 1 on a single-core box). */
export function maxHonorThreads(cpus = deviceCpuCount()) {
  const n = Math.max(1, Math.floor(Number(cpus) || 1));
  return Math.min(MAX_THREADS, n <= 1 ? 1 : n - 1);
}

export function defaultThreadCount(cpus = deviceCpuCount()) {
  return maxHonorThreads(cpus);
}

export function honorThreads(raw, cpus = deviceCpuCount()) {
  const cap = maxHonorThreads(cpus);
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return { threads: 1, cap };
  return { threads: Math.min(cap, n), cap };
}

export function isGnfpPayoutAddress(value) {
  return GNFP1_RE.test(String(value || '').trim());
}

export function payoutFromLogin(user) {
  return String(user || '').trim().split('.')[0] || '';
}

export function normalizeMineWorker(raw) {
  const worker = String(raw ?? '').trim();
  if (!worker) return { ok: true, worker: DEFAULT_WORKER };
  if (!WORKER_RE.test(worker) || worker.length < MIN_WORKER_LEN || worker.length > MAX_WORKER_LEN) {
    return { ok: false, reason: 'worker_invalid' };
  }
  return { ok: true, worker };
}

export function validateMinerUser(user, workerOverride) {
  const raw = String(user || '').trim();
  if (!raw) return { ok: false, reason: 'gnfp_address_required' };
  const parts = raw.split('.');
  const address = parts[0];
  if (!isGnfpPayoutAddress(address)) {
    return { ok: false, reason: 'gnfp_address_required' };
  }
  const fromUser = parts.slice(1).join('.');
  const tagged = workerOverride != null && String(workerOverride).trim() !== ''
    ? String(workerOverride).trim()
    : fromUser;
  const gate = normalizeMineWorker(tagged);
  if (!gate.ok) return { ok: false, reason: 'worker_invalid' };
  return { ok: true, address, worker: gate.worker, login: `${address}.${gate.worker}` };
}

export function defaultConfigPath(env = process.env) {
  if (env.GNFP_MINE_CONFIG) return String(env.GNFP_MINE_CONFIG);
  return path.join(os.homedir(), '.gnfp-mine', 'config.json');
}

/** Germany book and join/Helsinki fronts speak TLS. --notls is local only. */
export function isPublicGnfpPool(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  return h === 'restoreprivacy.online' || h.endsWith('.restoreprivacy.online');
}

/**
 * TLS unless `--notls`. A leftover 1.0.7 `tls: false` in config.json must
 * not pin public book/front connections to plaintext.
 */
export function resolveUseTls(argv = [], prior = null, host = '') {
  if (Array.isArray(argv) && argv.includes('--notls')) return false;
  if (Array.isArray(argv) && argv.includes('--tls')) return true;
  if (isPublicGnfpPool(host)) return true;
  if (prior && Object.prototype.hasOwnProperty.call(prior, 'tls')) {
    return Boolean(prior.tls);
  }
  return true;
}

export function looksLikeTlsRecord(chunk) {
  const raw = typeof chunk === 'string' ? chunk : String(chunk || '');
  if (!raw) return false;
  const c = raw.charCodeAt(0);
  return c === 0x14 || c === 0x15 || c === 0x16 || c === 0x17;
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
  const workerFlag = hasFlag(argv, '--worker') ? flag(argv, '--worker') : '';
  const threads = hasFlag(argv, '--threads')
    ? honorThreads(flag(argv, '--threads')).threads
    : (prior.threads != null ? honorThreads(prior.threads).threads : defaultThreadCount());
  const [host, portStr] = String(pool).split(':');
  const useTls = resolveUseTls(argv, prior, host);
  const gate = validateMinerUser(user, workerFlag);
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
    suppliedWorker: hasFlag(argv, '--worker'),
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
  const desc = String(msg.description || msg.result || msg.error || '').toLowerCase();
  const code = Number(msg.code);
  const formed = msg.formed === true || msg.block?.formed === true || Boolean(msg.sealed);
  if (formed || desc.includes('block found')) {
    return { kind: 'block', description: msg.description || 'block' };
  }
  if (desc.includes('old_miner_refused') || desc.includes('client_required')) {
    return { kind: 'rejected', description: OLD_MINER_HINT };
  }
  if (desc.includes('worker_too_short') || desc.includes('worker_invalid')) {
    return { kind: 'rejected', description: WORKER_REFUSE_MSG };
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

/** Threads the farm is actually running on this device — never requested --threads. */
export function liveThreads(cfg, farm) {
  if (farm && typeof farm.running === 'number') {
    return Math.max(0, Math.floor(Number(farm.running) || 0));
  }
  return 0;
}

export function stratumLoginMsg(cfg, farm) {
  return {
    method: 'login',
    login: cfg.user,
    threads: liveThreads(cfg, farm),
    client: CLIENT,
    version: VERSION,
    algorithm: ALGORITHM,
    id: 1,
    jsonrpc: '2.0',
  };
}

export function stratumStatsMsg(cfg, extra = {}, farm) {
  const { threads: _ignoreThreads, client: _c, version: _v, algorithm: _a, ...rest } = extra || {};
  return {
    method: 'stats',
    login: cfg.user,
    ...rest,
    threads: liveThreads(cfg, farm),
    client: CLIENT,
    version: VERSION,
    algorithm: ALGORITHM,
    jsonrpc: '2.0',
  };
}

export function stratumSubmitMsg(cfg, job, nonce, farm) {
  const snap = snapshotJob(job) || {};
  const jobId = snap.jobId || '1';
  return {
    method: 'submit',
    login: cfg.user,
    threads: liveThreads(cfg, farm),
    client: CLIENT,
    version: VERSION,
    algorithm: ALGORITHM,
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
  function drop(w) {
    const i = workers.indexOf(w);
    if (i >= 0) workers.splice(i, 1);
  }
  for (let i = 0; i < n; i += 1) {
    const w = new Worker(workerPath, {
      workerData: { id: i, start: i, stride: n },
    });
    w.on('message', (m) => {
      for (const fn of listeners) fn({ ...m, workerId: i });
    });
    w.on('error', () => drop(w));
    w.on('exit', () => drop(w));
    workers.push(w);
  }
  return {
    count: n,
    get running() { return workers.length; },
    setJob(job) {
      const snap = snapshotJob(job);
      for (const w of workers) w.postMessage({ type: 'job', job: snap });
    },
    go() {
      for (const w of workers) w.postMessage({ type: 'go' });
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    async close() {
      const live = workers.slice();
      workers.length = 0;
      await Promise.all(live.map((w) => w.terminate()));
    },
  };
}

function openStratum(cfg) {
  if (cfg.tls) {
    return tls.connect({
      host: cfg.host,
      port: cfg.port,
      servername: cfg.host,
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
    cfg = { ...cfg, threads: farm.running };

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

    let writeOk = true;
    function send(obj) {
      if (!sock.writable || !obj || typeof obj !== 'object') return false;
      let line;
      try {
        line = `${JSON.stringify(obj)}\n`;
      } catch {
        return false;
      }
      writeOk = sock.write(line);
      return true;
    }

    const pipe = createSharePipeline();
    function flushShares() {
      if (!sock.writable || !writeOk) return;
      for (;;) {
        const prep = pipe.nextToSend();
        if (!prep) return;
        send(stratumSubmitMsg(cfg, prep.job, prep.nonce, farm));
        farm.go();
      }
    }
    function enqueueShare(foundOn, nonce) {
      const prep = pipe.offer(foundOn || job, nonce);
      if (!prep.ok) {
        farm.go();
        return;
      }
      flushShares();
    }
    sock.on('drain', () => {
      writeOk = true;
      flushShares();
    });

    function paintLive() {
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      const line = formatLiveStatus({
        hashrate: hashes / elapsed,
        worker: cfg.worker || 'worker',
        accepted: session.accepted,
        rejected: session.rejected,
        blocks: session.blocks,
        threads: liveThreads(cfg, farm),
        height: job?.height || session.height || 0,
        pool: cfg.pool,
      });
      console.log(line);
    }

    function reportStats() {
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
      send(stratumStatsMsg(cfg, {
        hashes,
        hashrate: hashes / elapsed,
        version: VERSION,
        jobId: job?.jobId || job?.id,
        height: job?.height,
      }, farm));
      paintLive();
    }

    farm.onMessage((msg) => {
      if (msg.type === 'hashed') hashes += Number(msg.n || 0);
      if (msg.type === 'share' && msg.nonce) {
        enqueueShare(msg.job || job, msg.nonce);
      }
    });

    const onReady = () => send(stratumLoginMsg(cfg, farm));
    if (cfg.tls) sock.once('secureConnect', onReady);
    else sock.once('connect', onReady);
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => {
      const why = cfg.tls ? 'tls handshake timeout' : 'connect timeout';
      console.error('socket', why);
      if (!cfg.tls && isPublicGnfpPool(cfg.host)) {
        console.error(TLS_REQUIRED_MSG);
      }
      finish(why);
    });
    sock.on('error', (err) => {
      console.error('socket', err.message);
      if (!cfg.tls && isPublicGnfpPool(cfg.host)) {
        console.error(TLS_REQUIRED_MSG);
      }
      finish(err.message);
    });
    sock.on('data', (chunk) => {
      if (!cfg.tls && looksLikeTlsRecord(chunk)) {
        console.error(TLS_REQUIRED_MSG);
        finish('tls_required');
        return;
      }
      sock.setTimeout(0);
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
          pipe.setJob(job);
          farm.setJob(job);
          console.log(
            `job ${msg.jobId || msg.id} height=${msg.height} diff=${msg.difficulty} algo=${msg.algorithm || ALGORITHM} workers=${liveThreads(cfg, farm)}`,
          );
          continue;
        }
        const reply = classifyPoolReply(msg);
        if (reply.kind === 'accepted' || reply.kind === 'rejected' || reply.kind === 'block') {
          pipe.acked();
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
          flushShares();
        } else if (reply.kind === 'login') {
          console.log('pool:', msg.description, msg.asset || 'GNFP');
        } else if (msg.error && reply.kind === 'other') {
          console.log('pool error:', msg.error);
        }
      }
    });

    const statsTick = setInterval(reportStats, 1000);
    const shareTick = setInterval(flushShares, 100);
    sock.on('close', () => {
      clearInterval(statsTick);
      clearInterval(shareTick);
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
      process.stderr.write(`${cfg.gate.reason === 'worker_invalid' ? WORKER_REFUSE_MSG : REFUSE_MSG}\n`);
      return 2;
    }
    return 0;
  }

  if (!cfg.gate.ok) {
    process.stderr.write(`${cfg.gate.reason === 'worker_invalid' ? WORKER_REFUSE_MSG : REFUSE_MSG}\n`);
    return 2;
  }

  const saved = saveMinerConfig(cfg.configPath, cfg);
  if (!saved) {
    process.stderr.write(`${REFUSE_MSG}\n`);
    return 2;
  }

  const scheme = cfg.tls ? 'tls' : 'tcp';
  console.log(
    `GNFPHash ${VERSION} → ${scheme}://${cfg.host}:${cfg.port} user=${cfg.user} threads=${cfg.threads} coin=GNFP algo=${ALGORITHM}`,
  );
  if (!cfg.tls && isPublicGnfpPool(cfg.host)) {
    console.error(TLS_REQUIRED_MSG);
  }

  const session = createMinerStats();
  const loop = async () => {
    for (;;) {
      const why = await connectOnce(cfg, session);
      console.log('reconnect in 2s', cfg.host, cfg.port, why || 'closed');
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
