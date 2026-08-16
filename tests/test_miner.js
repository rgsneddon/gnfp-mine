import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  formatLiveStatus,
  honorThreads,
  loadMinerConfig,
  MAX_THREADS,
  parseMinerArgs,
  REFUSE_MSG,
  resolveMinerConfig,
  saveMinerConfig,
  stratumLoginMsg,
  stratumStatsMsg,
  stratumSubmitMsg,
  validateMinerUser,
  VERSION,
} from '../src/miner.js';
import { gnfpWorkHash, hashMeetsJob, hashNonceRange, meetsTarget } from '../src/hash_share.js';

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

test('parse --tls for PERC stratum and default off for GNFP', () => {
  const plain = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN]);
  assert.equal(plain.tls, false);
  const secured = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN, '--tls']);
  assert.equal(secured.tls, true);
});

test('parse args default to GNFP pool and clamp threads 1–256', () => {
  const cfg = parseMinerArgs(['node', 'miner.js']);
  assert.equal(cfg.port, 1474);
  assert.match(cfg.pool, /1474/);
  assert.ok(cfg.threads >= 1 && cfg.threads <= MAX_THREADS);
  assert.equal(honorThreads(0).threads, 1);
  assert.equal(honorThreads(180).threads, 180);
  assert.equal(honorThreads(8).threads, 8);
  assert.equal(honorThreads(9999).threads, 256);
  assert.equal(MAX_THREADS, 256);
});

test('validateMinerUser accepts a real gnfp1 and refuses missing or fake', () => {
  const ok = validateMinerUser(VALID_LOGIN);
  assert.equal(ok.ok, true);
  assert.equal(ok.address, VALID);
  assert.equal(ok.worker, 'rig');
  assert.equal(ok.login, VALID_LOGIN);
  assert.equal(validateMinerUser(VALID).ok, true);
  assert.equal(validateMinerUser('').ok, false);
  assert.equal(validateMinerUser('GNFP_USERNAME.WORKER').ok, false);
  assert.equal(validateMinerUser('gnfp1short.rig').ok, false);
  assert.equal(validateMinerUser('beam1aaaaaaaaaaaaaaaaaaaa.rig').ok, false);
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
  const cfg = parseMinerArgs(['node', 'miner.js', '--user', VALID_LOGIN, '--threads', '8']);
  const login = stratumLoginMsg(cfg);
  const stats = stratumStatsMsg(cfg, { hashes: 10 });
  const sub = stratumSubmitMsg(cfg, { jobId: 'j1' }, 'aa');
  assert.equal(login.threads, 8);
  assert.equal(login.login, VALID_LOGIN);
  assert.equal(stats.threads, 8);
  assert.equal(stats.method, 'stats');
  assert.equal(sub.threads, 8);
  assert.equal(sub.method, 'submit');
  assert.equal(sub.login, VALID_LOGIN);
});

test('share acks update accepted, rejected and blocks found', () => {
  let stats = createMinerStats();
  assert.equal(classifyPoolReply({ code: 1, description: 'accepted' }).kind, 'accepted');
  assert.equal(classifyPoolReply({ code: -32003, description: 'rejected' }).kind, 'rejected');
  assert.equal(classifyPoolReply({ formed: true, description: 'accepted' }).kind, 'block');
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
    threads: 6,
  });
  assert.ok(wrote);
  assert.equal(wrote.user, `${VALID}.worker`);
  const loaded = loadMinerConfig(file);
  assert.equal(loaded.pool, 'hel.restoreprivacy.online:1474');
  assert.equal(loaded.user, `${VALID}.worker`);
  assert.equal(loaded.threads, 6);
  const resolved = resolveMinerConfig(['node', 'miner.js'], { configPath: file });
  assert.equal(resolved.gate.ok, true);
  assert.equal(resolved.pool, 'hel.restoreprivacy.online:1474');
  assert.equal(resolved.user, `${VALID}.worker`);
  assert.equal(resolved.threads, 6);
  assert.equal(resolved.worker, 'worker');
});

test('--print-config after a saved valid setup reprints remembered flags', () => {
  const file = scratchConfig();
  const first = runMiner(
    ['--user', VALID_LOGIN, '--threads', '4', '--pool', 'sg.restoreprivacy.online:1474', '--print-config'],
    { GNFP_MINE_CONFIG: file },
  );
  assert.equal(first.status, 0);
  const a = JSON.parse(first.stdout);
  assert.equal(a.user, VALID_LOGIN);
  assert.equal(a.threads, 4);
  assert.equal(a.pool, 'sg.restoreprivacy.online:1474');
  assert.equal(a.coin, 'GNFP');
  assert.equal(a.version, VERSION);
  const second = runMiner(['--print-config'], { GNFP_MINE_CONFIG: file });
  assert.equal(second.status, 0);
  const b = JSON.parse(second.stdout);
  assert.equal(b.user, VALID_LOGIN);
  assert.equal(b.threads, 4);
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
