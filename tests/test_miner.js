import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';

/** Default runner concurrency starves the event loop once hash workers pump. */
function test(name, fn) {
  return nodeTest(name, { concurrency: false }, fn);
}
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyShareAck,
  classifyPoolReply,
  createHashFarm,
  createMinerStats,
  liveThreads,
  createSharePipeline,
  formatLiveStatus,
  honorThreads,
  deviceCpuCount,
  deviceCpuReport,
  deviceCpuInventory,
  loadMinerConfig,
  DEFAULT_POOL,
  MAX_THREADS,
  MIN_WORKER_LEN,
  MAX_WORKER_LEN,
  DEFAULT_WORKER,
  WORKER_REFUSE_MSG,
  OLD_MINER_HINT,
  parseMinerArgs,
  prepareShareSubmit,
  REFUSE_MSG,
  resolveMinerConfig,
  resolveUseTls,
  isPublicGnfpPool,
  looksLikeTlsRecord,
  saveMinerConfig,
  stratumLoginMsg,
  stratumStatsMsg,
  stratumSubmitMsg,
  validateMinerUser,
  VERSION,
} from '../src/miner.js';
import {
  gnfpWorkHash,
  hashMeetsJob,
  hashNonceRange,
  meetsTarget,
  normalizeCpuNonce,
  MAX_IN_FLIGHT,
  MAX_SHARE_QUEUE,
} from '../src/hash_share.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID = 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c';
const VALID_LOGIN = `${VALID}.rig`;

function scratchConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnfp-mine-'));
  return path.join(dir, 'config.json');
}

function runMiner(args, extraEnv = {}) {
  return spawnSync(process.execPath, ['src/miner.js', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...extraEnv },
  });
}

test('cli help names GNFP stratum 1474 and --user', () => {
  const r = runMiner(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GNFP/);
  assert.match(r.stdout, /1474/);
  assert.match(r.stdout, /gnfp-mine/);
  assert.match(r.stdout, /--user/);
});

test('TLS is the shipped default; --notls is the local opt-out', () => {
  const secured = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN]);
  assert.equal(secured.tls, true);
  const plain = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN, '--notls']);
  assert.equal(plain.tls, false);
});

test('stale 1.0.7 tls:false does not pin the public book to plaintext', () => {
  assert.equal(isPublicGnfpPool('de.restoreprivacy.online'), true);
  assert.equal(isPublicGnfpPool('sg.restoreprivacy.online'), true);
  assert.equal(isPublicGnfpPool('hel.restoreprivacy.online'), true);
  assert.equal(isPublicGnfpPool('127.0.0.1'), false);
  assert.equal(looksLikeTlsRecord('\u0015\u0003\u0003'), true);
  assert.equal(looksLikeTlsRecord('{"method":"job"}'), false);
  const leftover = { pool: DEFAULT_POOL, user: VALID_LOGIN, threads: 4, tls: false };
  const upgraded = parseMinerArgs(
    ['node', 'miner.js', '--pool', 'de.restoreprivacy.online:1474', '--user', VALID_LOGIN, '--threads', '4'],
    leftover,
  );
  assert.equal(upgraded.tls, true);
  assert.equal(resolveUseTls([], leftover, 'de.restoreprivacy.online'), true);
  assert.equal(resolveUseTls(['--notls'], leftover, 'de.restoreprivacy.online'), false);
  const local = parseMinerArgs(
    ['node', 'miner.js', '--pool', '127.0.0.1:1474', '--user', VALID_LOGIN],
    leftover,
  );
  assert.equal(local.tls, false);
  const file = scratchConfig();
  fs.writeFileSync(file, `${JSON.stringify({
    pool: 'de.restoreprivacy.online:1474',
    user: VALID_LOGIN,
    threads: 4,
    tls: false,
  }, null, 2)}\n`);
  const printed = runMiner(
    ['--pool', 'de.restoreprivacy.online:1474', '--user', VALID_LOGIN, '--threads', '4', '--print-config'],
    { GNFP_MINE_CONFIG: file },
  );
  assert.equal(printed.status, 0);
  const got = JSON.parse(printed.stdout);
  assert.equal(got.tls, true);
  assert.equal(got.version, VERSION);
});

test('parse args default to GNFP pool and clamp threads 1–256', () => {
  const cfg = parseMinerArgs(['node', 'miner.js']);
  assert.equal(cfg.port, 1474);
  assert.match(cfg.pool, /1474/);
  assert.ok(cfg.threads >= 1 && cfg.threads <= MAX_THREADS);
  assert.equal(honorThreads(0, 8).threads, 1);
  assert.equal(honorThreads(180, 8).threads, 8, '1 thread = 1 core');
  assert.equal(honorThreads(8, 8).threads, 8);
  assert.equal(honorThreads(10, 12).threads, 10);
  assert.equal(honorThreads(12, 12).threads, 12);
  assert.equal(honorThreads(4, 8).threads, 4);
  assert.equal(honorThreads(9999, 16).threads, 16);
  assert.equal(honorThreads(8, 1).threads, 1);
  assert.equal(honorThreads(10, 12).cpuCores, 12);
  assert.equal(MAX_THREADS, 256);
});

test('validateMinerUser accepts a real gnfp1 and refuses missing or fake', () => {
  const ok = validateMinerUser(VALID_LOGIN);
  assert.equal(ok.ok, true);
  assert.equal(ok.address, VALID);
  assert.equal(ok.worker, 'rig');
  assert.equal(ok.login, VALID_LOGIN);
  assert.equal(validateMinerUser(VALID).ok, true);
  assert.equal(validateMinerUser(VALID).worker, DEFAULT_WORKER);
  assert.equal(validateMinerUser(`${VALID}.1`).ok, true);
  assert.equal(validateMinerUser(`${VALID}.1`).worker, '1');
  assert.equal(validateMinerUser(`${VALID}.a`).ok, true);
  assert.equal(validateMinerUser(VALID, 'ryzen5600').worker, 'ryzen5600');
  assert.equal(validateMinerUser(`${VALID}.${'x'.repeat(24)}`).ok, true);
  assert.equal(validateMinerUser(`${VALID}.${'x'.repeat(25)}`).ok, false);
  assert.equal(validateMinerUser(`${VALID}.${'x'.repeat(25)}`).reason, 'worker_invalid');
  assert.equal(validateMinerUser('').ok, false);
  assert.equal(validateMinerUser('GNFP_USERNAME.WORKER').ok, false);
  assert.equal(validateMinerUser('gnfp1short.rig').ok, false);
  assert.equal(validateMinerUser('beam1aaaaaaaaaaaaaaaaaaaa.rig').ok, false);
  assert.equal(MIN_WORKER_LEN, 1);
  assert.equal(MAX_WORKER_LEN, 24);
});

test('short or invalid --worker exits without starting workers', () => {
  const cfgPath = scratchConfig();
  const long = runMiner(['--user', VALID, '--worker', 'x'.repeat(25)], { GNFP_MINE_CONFIG: cfgPath });
  assert.equal(long.status, 2);
  assert.equal(String(long.stderr).includes(WORKER_REFUSE_MSG), true);
  const bang = runMiner(['--user', `${VALID}.nope!`], { GNFP_MINE_CONFIG: cfgPath });
  assert.equal(bang.status, 2);
  assert.equal(String(bang.stderr).includes(WORKER_REFUSE_MSG), true);
});

test('invalid or missing --user exits without starting workers', () => {
  const cfgPath = scratchConfig();
  const missing = runMiner([], { GNFP_MINE_CONFIG: cfgPath });
  assert.equal(missing.status, 2);
  assert.equal(String(missing.stderr).includes(REFUSE_MSG), true);
  assert.equal(String(missing.stdout + missing.stderr).includes('workers='), false);
  assert.equal(fs.existsSync(cfgPath), false);

  const bad = runMiner(['--user', 'not-an-address.rig'], { GNFP_MINE_CONFIG: cfgPath });
  assert.equal(bad.status, 2);
  assert.match(String(bad.stderr), /refuse/);
  assert.equal(String(bad.stdout + bad.stderr).includes('createHashFarm'), false);
  assert.equal(fs.existsSync(cfgPath), false);
});

test('stratum login, stats and submit all report threads', () => {
  const cfg = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN, '--threads', '4']);
  const farm = { running: 4 };
  const login = stratumLoginMsg(cfg, farm);
  const stats = stratumStatsMsg(cfg, { hashes: 10 }, farm);
  const sub = stratumSubmitMsg(cfg, { jobId: 'j1' }, 'aa', farm);
  assert.equal(login.threads, 4);
  assert.equal(login.login, VALID_LOGIN);
  assert.equal(stats.threads, 4);
  assert.equal(stats.method, 'stats');
  assert.equal(sub.threads, 4);
  assert.equal(sub.method, 'submit');
  assert.equal(sub.login, VALID_LOGIN);
  assert.equal(login.client, 'GNFPHash');
  assert.equal(sub.client, 'GNFPHash');
  assert.equal(stats.client, 'GNFPHash');
  assert.equal(login.algorithm, 'GNFPHash');
  assert.equal(liveThreads(cfg), 0);
});

test('wire identity is GNFPHash 1.0.2; --notls is loopback-only', () => {
  const local = parseMinerArgs([
    'node', 'miner.js',
    '--pool', '127.0.0.1:1474',
    '--user', VALID_LOGIN,
    '--threads', '1',
    '--notls',
  ]);
  assert.equal(local.tls, false);
  assert.equal(local.host, '127.0.0.1');
  assert.equal(local.port, 1474);
  const publicPool = parseMinerArgs([
    'node', 'miner.js',
    '--pool', 'de.restoreprivacy.online:1474',
    '--user', VALID_LOGIN,
    '--threads', '1',
  ]);
  assert.equal(publicPool.tls, true);
  assert.equal(isPublicGnfpPool('sg.restoreprivacy.online'), true);
  const farm = { running: 1 };
  const login = stratumLoginMsg(local, farm);
  const stats = stratumStatsMsg(local, { hashes: 1 }, farm);
  const sub = stratumSubmitMsg(local, { jobId: 'j1' }, 'aa', farm);
  for (const msg of [login, stats, sub]) {
    assert.equal(msg.client, 'GNFPHash');
    assert.equal(msg.algorithm, 'GNFPHash');
    assert.equal(msg.version, VERSION);
  }
  assert.equal(VERSION, '1.0.6');
});

test('login/stats/submit report farm.running not requested --threads', async () => {
  const farm = createHashFarm(2);
  assert.equal(farm.running, 2);
  const cfg = { user: VALID_LOGIN, threads: 99 };
  assert.equal(liveThreads(cfg, farm), 2);
  assert.equal(stratumLoginMsg(cfg, farm).threads, 2);
  assert.equal(stratumStatsMsg(cfg, {}, farm).threads, 2);
  assert.equal(stratumSubmitMsg(cfg, { jobId: 'j' }, 'aa', farm).threads, 2);
  await farm.close();
  assert.equal(farm.running, 0);
  assert.equal(stratumLoginMsg(cfg, farm).threads, 0);
  const spoof = stratumStatsMsg(cfg, { threads: 256, client: 'gnfp-mine', algorithm: 'beamhashIII' }, { running: 2 });
  assert.equal(spoof.threads, 2);
  assert.equal(spoof.client, 'GNFPHash');
  assert.equal(spoof.algorithm, 'GNFPHash');
});

test('prepareShareSubmit keeps a share on the job it was found on', () => {
  const jobA = { jobId: 'job-a', input: 'pre-a', difficulty: 1 };
  const jobB = { jobId: 'job-b', input: 'pre-b', difficulty: 1 };
  let nonce = '';
  for (let i = 0; i < 40000 && !nonce; i += 1) {
    const hex = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(jobA, hex, '') && !hashMeetsJob(jobB, hex, '')) nonce = hex;
  }
  assert.ok(nonce, 'need a nonce that meets A only');
  const seen = new Set();
  const ok = prepareShareSubmit({ foundOn: jobA, nonce, seen });
  assert.equal(ok.ok, true);
  assert.equal(ok.job.jobId, 'job-a');
  assert.equal(prepareShareSubmit({ foundOn: jobA, nonce, seen }).ok, false);
  assert.equal(prepareShareSubmit({ foundOn: jobB, nonce, seen }).reason, 'local_below_target');
  assert.equal(prepareShareSubmit({ foundOn: null, nonce: 'aa', seen }).ok, false);
});

test('normalizeCpuNonce is always 16 hex; stale jobs never go on the wire', () => {
  assert.equal(normalizeCpuNonce('aa'), '00000000000000aa');
  assert.equal(normalizeCpuNonce('0xdeadbeef'), '00000000deadbeef');
  assert.equal(normalizeCpuNonce('ffffffffffffffffff'), 'ffffffffffffffff');
  assert.equal(normalizeCpuNonce('nope'), '');
  const jobA = { jobId: 'job-a', input: 'pre-a', difficulty: 1 };
  const jobB = { jobId: 'job-b', input: 'pre-b', difficulty: 1 };
  let nonce = '';
  for (let i = 0; i < 40000 && !nonce; i += 1) {
    const hex = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(jobA, hex, '')) nonce = hex;
  }
  assert.ok(nonce);
  assert.equal(
    prepareShareSubmit({ foundOn: jobA, nonce, liveJob: jobB }).reason,
    'stale_job',
  );
  assert.equal(prepareShareSubmit({ foundOn: jobA, nonce, liveJob: jobA }).ok, true);
});

test('hashNonceRange counts one GNFPHash per nonce, not eight inner SHA rounds', () => {
  const job = { jobId: 'job-hs', input: 'pre-hs', difficulty: 1 };
  const got = hashNonceRange(job, 0, 1000, 1);
  assert.equal(got.hashes, 1000);
  assert.notEqual(got.hashes, 8000);
});

test('share pipeline sends nothing until the live job is set', () => {
  const jobA = { jobId: 'job-a', input: 'pre-a', difficulty: 1 };
  let nonce = '';
  for (let i = 0; i < 40000 && !nonce; i += 1) {
    const hex = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(jobA, hex, '')) nonce = hex;
  }
  assert.ok(nonce);
  const pipe = createSharePipeline({ maxInFlight: 1, maxQueued: 2 });
  assert.equal(pipe.nextToSend(), null);
  const queued = pipe.offer(jobA, nonce);
  assert.equal(queued.ok, true);
  assert.equal(pipe.nextToSend(), null, 'no wire submit before setJob');
  pipe.setJob(jobA);
  assert.equal(pipe.queued(), 0);
  assert.equal(pipe.offer(jobA, nonce).ok, true);
  const sent = pipe.nextToSend();
  assert.equal(sent.job.jobId, 'job-a');
});

test('share pipeline can carry a 10-thread 310 kH/s farm onto the wire', () => {
  assert.ok(MAX_IN_FLIGHT >= 8);
  assert.ok(MAX_SHARE_QUEUE >= 32);
  assert.equal(MAX_THREADS, 256);
});

test('share pipeline sends one current-job share at a time and drops the rest', () => {
  const jobA = { jobId: 'job-a', input: 'pre-a', difficulty: 1 };
  const jobB = { jobId: 'job-b', input: 'pre-b', difficulty: 1 };
  const hitsA = [];
  const hitsB = [];
  for (let i = 0; i < 80000 && (hitsA.length < 3 || hitsB.length < 1); i += 1) {
    const hex = i.toString(16).padStart(16, '0');
    if (hitsA.length < 3 && hashMeetsJob(jobA, hex, '')) hitsA.push(hex);
    if (hitsB.length < 1 && hashMeetsJob(jobB, hex, '')) hitsB.push(hex);
  }
  assert.equal(hitsA.length, 3);
  const pipe = createSharePipeline({ maxInFlight: 1, maxQueued: 2 });
  pipe.setJob(jobA);
  assert.equal(pipe.offer(jobA, hitsA[0]).ok, true);
  assert.equal(pipe.offer(jobA, hitsA[1]).ok, true);
  assert.equal(pipe.offer(jobA, hitsA[2]).reason, 'queue_full');
  assert.equal(pipe.offer(jobB, hitsB[0]).reason, 'stale_job');
  const first = pipe.nextToSend();
  assert.equal(first.job.jobId, 'job-a');
  assert.equal(first.nonce, hitsA[0]);
  assert.equal(pipe.nextToSend(), null);
  pipe.acked();
  const second = pipe.nextToSend();
  assert.equal(second.nonce, hitsA[1]);
  pipe.setJob(jobB);
  assert.equal(pipe.queued(), 0);
  assert.equal(pipe.offer(jobA, hitsA[0]).reason, 'stale_job');
});

test('share acks update accepted, rejected and blocks found', () => {
  let stats = createMinerStats();
  assert.equal(classifyPoolReply({ code: 1, description: 'accepted' }).kind, 'accepted');
  assert.equal(classifyPoolReply({ code: -32003, description: 'rejected' }).kind, 'rejected');
  assert.equal(classifyPoolReply({ formed: true, description: 'accepted' }).kind, 'block');
  assert.equal(classifyPoolReply({ sealed: { height: 2 }, description: 'accepted' }).kind, 'block');
  assert.equal(classifyPoolReply({ description: 'old_miner_refused' }).kind, 'rejected');
  assert.equal(classifyPoolReply({ description: 'old_miner_refused' }).description, OLD_MINER_HINT);
  assert.equal(classifyPoolReply({ description: 'client_required' }).kind, 'rejected');
  assert.equal(classifyPoolReply({ description: 'Login Successful', code: 0 }).kind, 'login');
  stats = applyShareAck(stats, classifyPoolReply({ code: 1, description: 'accepted' }));
  stats = applyShareAck(stats, classifyPoolReply({ code: 1, description: 'accepted' }));
  stats = applyShareAck(stats, classifyPoolReply({ code: -32003, description: 'stale' }));
  stats = applyShareAck(stats, classifyPoolReply({ block: { formed: true } }));
  assert.equal(stats.accepted, 3);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.blocks, 1);
});

test('live status line names hashrate, worker, shares, blocks, threads, height', () => {
  const line = formatLiveStatus({
    hashrate: 12.5,
    worker: 'rig',
    accepted: 4,
    rejected: 1,
    blocks: 2,
    threads: 8,
    height: 29131,
    pool: 'de.restoreprivacy.online:1474',
  });
  assert.match(line, /hashrate=/);
  assert.match(line, /12\.5 H\/s/);
  assert.match(line, /worker=rig/);
  assert.match(line, /accepted=4/);
  assert.match(line, /rejected=1/);
  assert.match(line, /blocks=2/);
  assert.match(line, /threads=8/);
  assert.match(line, /height=29131/);
});

test('remembers last valid pool/user/threads when flags are omitted', () => {
  const file = scratchConfig();
  const wrote = saveMinerConfig(file, {
    pool: 'hel.restoreprivacy.online:1474',
    user: VALID,
    threads: 2,
  });
  assert.ok(wrote);
  assert.equal(wrote.user, `${VALID}.worker`);
  const loaded = loadMinerConfig(file);
  assert.equal(loaded.pool, 'hel.restoreprivacy.online:1474');
  assert.equal(loaded.user, `${VALID}.worker`);
  assert.equal(loaded.threads, 2);
  const resolved = resolveMinerConfig(['node', 'miner.js'], { configPath: file });
  assert.equal(resolved.gate.ok, true);
  assert.equal(resolved.pool, 'hel.restoreprivacy.online:1474');
  assert.equal(resolved.user, `${VALID}.worker`);
  assert.equal(resolved.threads, 2);
  assert.equal(resolved.worker, 'worker');
});

test('--print-config after a saved valid setup reprints remembered flags', () => {
  const file = scratchConfig();
  const first = runMiner(
    ['--user', VALID_LOGIN, '--threads', '2', '--pool', 'sg.restoreprivacy.online:1474', '--print-config'],
    { GNFP_MINE_CONFIG: file },
  );
  assert.equal(first.status, 0);
  const a = JSON.parse(first.stdout);
  assert.equal(a.user, VALID_LOGIN);
  assert.equal(a.threads, 2);
  assert.equal(a.pool, 'sg.restoreprivacy.online:1474');
  assert.equal(a.coin, 'GNFP');
  assert.equal(a.version, VERSION);
  assert.equal(VERSION, '1.0.6');
  assert.equal(typeof a.cpuCores, 'number');
  assert.ok(a.cpuCores >= 1);
  assert.ok(a.threads <= a.cpuThreads || a.threads <= a.cpuCores);
  const second = runMiner(['--print-config'], { GNFP_MINE_CONFIG: file });
  assert.equal(second.status, 0);
  const b = JSON.parse(second.stdout);
  assert.equal(b.user, VALID_LOGIN);
  assert.equal(b.threads, 2);
  assert.equal(b.pool, 'sg.restoreprivacy.online:1474');
});

test('hash share helper matches difficulty-gated work hashes', () => {
  const hash = gnfpWorkHash('pre', 'aa', '');
  assert.equal(hash.length, 64);
  const job = { input: 'pre', difficulty: 1 };
  let hit = false;
  for (let i = 0; i < 20000; i += 1) {
    const n = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(job, n, '')) {
      hit = true;
      assert.equal(meetsTarget(gnfpWorkHash('pre', n, ''), 1), true);
      break;
    }
  }
  assert.equal(hit, true);
});

test('hashNonceRange finds a share on an easy job', () => {
  const job = { input: 'pre', difficulty: 1 };
  const got = hashNonceRange(job, 0, 20000, 1);
  assert.equal(got.hashes, 20000);
  assert.ok(got.shares.length > 0);
  assert.equal(got.shares[0].length, 16);
  assert.match(got.shares[0], /^[0-9a-f]{16}$/);
  assert.equal(hashMeetsJob(job, got.shares[0], ''), true);
});

test('createHashFarm starts real workers that each hash', async () => {
  const farm = createHashFarm(2);
  assert.equal(farm.count, 2);
  const seen = new Set();
  let hashed = 0;
  farm.onMessage((m) => {
    if (m.type === 'hashed' && m.n > 0) {
      seen.add(m.workerId);
      hashed += m.n;
    }
  });
  farm.setJob({ input: 'pre', difficulty: 1, jobId: 't' });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && seen.size < 2) {
    await new Promise((r) => setTimeout(r, 20));
  }
  await farm.close();
  assert.equal(seen.size, 2);
  assert.ok(hashed > 0);
});

test('hash farm falls back to JS when the native binary cannot run', async () => {
  const junk = path.join(os.tmpdir(), `gnfp-not-native-${process.pid}`);
  fs.writeFileSync(junk, 'not a native hasher\n');
  fs.chmodSync(junk, 0o755);
  const prevBin = process.env.GNFP_NATIVE_BIN;
  const prevNat = process.env.GNFP_NATIVE;
  process.env.GNFP_NATIVE = '1';
  process.env.GNFP_NATIVE_BIN = junk;
  try {
    const farm = createHashFarm(1);
    let hashed = 0;
    farm.onMessage((m) => {
      if (m.type === 'hashed') hashed += Number(m.n) || 0;
    });
    farm.setJob({ input: 'pre', difficulty: 1, jobId: 't' });
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && hashed < 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await farm.close();
    assert.ok(hashed > 0);
  } finally {
    if (prevBin == null) delete process.env.GNFP_NATIVE_BIN;
    else process.env.GNFP_NATIVE_BIN = prevBin;
    if (prevNat == null) delete process.env.GNFP_NATIVE;
    else process.env.GNFP_NATIVE = prevNat;
    fs.rmSync(junk, { force: true });
  }
});

test('login/stats/submit report live farm threads, never a fake --threads count', () => {
  const farm = { running: 3 };
  const cfg = { user: VALID_LOGIN, threads: 64 };
  const login = stratumLoginMsg(cfg, farm, 12);
  const stats = stratumStatsMsg(cfg, {}, farm, 12);
  const submit = stratumSubmitMsg(cfg, { jobId: 'j1', input: 'pre', difficulty: 1 }, '0000000000000001', farm, 12);
  assert.equal(login.threads, 3);
  assert.equal(stats.threads, 3);
  assert.equal(submit.threads, 3);
  assert.equal(login.cpuCores, 12);
  assert.equal(stats.cpuCores, 12);
  assert.equal(submit.cpuCores, 12);
  assert.equal(login.maxThreads, 12);
  assert.ok(login.threads <= login.maxThreads);
  assert.equal(login.client, 'GNFPHash');
  assert.equal(login.algorithm, 'GNFPHash');
  assert.equal(login.version, VERSION);
  assert.notEqual(login.threads, cfg.threads);
});

test('10 workers on a 12-core device is an honest 1-thread-per-core farm', () => {
  const honor = honorThreads(10, 12);
  assert.equal(honor.threads, 10);
  assert.equal(honor.cpuCores, 12);
  assert.equal(honor.cap, 12);
  const farm = { running: 10 };
  const login = stratumLoginMsg({ user: VALID_LOGIN, threads: 10 }, farm, 12);
  assert.equal(login.threads, 10);
  assert.equal(login.cpuCores, 12);
  assert.ok(login.threads <= login.cpuCores);
  const report = deviceCpuReport(12);
  assert.equal(report.cpuCores, 12);
  assert.equal(report.maxThreads, 12);
  assert.ok(deviceCpuCount() >= 1);
});

test('physical cores and SMT threads are distinct; --threads does not auto-double', () => {
  const inv = deviceCpuInventory(5, 10);
  assert.equal(inv.cpuCores, 5);
  assert.equal(inv.cpuThreads, 10);
  assert.equal(inv.smt, 2);
  const five = honorThreads(5, 10, 5);
  assert.equal(five.threads, 5, '5 cores requested → 5 workers, not 10');
  assert.equal(five.cpuCores, 5);
  assert.equal(five.cpuThreads, 10);
  assert.equal(five.smt, 2);
  const smtFarm = honorThreads(10, 10, 5);
  assert.equal(smtFarm.threads, 10, '10 of 10 SMT threads on 5 cores');
  assert.ok(smtFarm.threads <= smtFarm.cpuThreads);
  const farm = { running: 5 };
  const login = stratumLoginMsg({ user: VALID_LOGIN, threads: 5 }, farm, 5, 10);
  assert.equal(login.threads, 5);
  assert.equal(login.cpuCores, 5);
  assert.equal(login.cpuThreads, 10);
  assert.equal(login.smt, 2);
  assert.equal(login.maxThreads, 10);
});

test('honorThreads(10, 12, 6) runs 10 workers on a 12-thread CPU', () => {
  assert.equal(MAX_THREADS, 256);
  const honor = honorThreads(10, 12, 6);
  assert.equal(honor.cpuCores, 6);
  assert.equal(honor.cpuThreads, 12);
  assert.equal(honor.smt, 2);
  assert.equal(honor.cap, 12);
  assert.equal(honor.threads, 10);
  assert.ok(honor.threads <= honor.cpuThreads);
  assert.ok(honor.cap <= MAX_THREADS);
  const farm = { running: honor.threads };
  const login = stratumLoginMsg({ user: VALID_LOGIN, threads: 10 }, farm, honor.cpuCores, honor.cpuThreads);
  assert.equal(login.threads, 10);
  assert.equal(login.cpuCores, 6);
  assert.equal(login.cpuThreads, 12);
  assert.equal(login.smt, 2);
  assert.equal(login.version, VERSION);
  assert.ok(login.threads <= login.cpuThreads);
  assert.equal(typeof login.platform, 'string');
  assert.equal(typeof login.arch, 'string');
  assert.ok(login.platform.length > 0);
  assert.ok(login.arch.length > 0);
});
