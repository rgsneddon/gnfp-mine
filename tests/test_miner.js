import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHashFarm, honorThreads, MAX_THREADS, parseMinerArgs, stratumLoginMsg, stratumStatsMsg, stratumSubmitMsg, VERSION } from '../src/miner.js';
import { gnfpWorkHash, hashMeetsJob, hashNonceRange, meetsTarget } from '../src/hash_share.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('cli help names GNFP stratum 1474', () => {
  const r = spawnSync(process.execPath, ['src/miner.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GNFP/);
  assert.match(r.stdout, /1474/);
  assert.match(r.stdout, /gnfp-mine/);
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
  const printed = spawnSync(process.execPath, ['src/miner.js', '--print-config', '--threads', '4'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(printed.status, 0);
  const j = JSON.parse(printed.stdout);
  assert.equal(j.threads, 4);
  assert.equal(j.coin, 'GNFP');
  assert.equal(j.version, VERSION);
});

test('stratum login, stats and submit all report threads', () => {
  const cfg = parseMinerArgs(['node', 'miner.js', '--user', 'gnfp1abc.rig', '--threads', '8']);
  const login = stratumLoginMsg(cfg);
  const stats = stratumStatsMsg(cfg, { hashes: 10 });
  const sub = stratumSubmitMsg(cfg, { jobId: 'j1' }, 'aa');
  assert.equal(login.threads, 8);
  assert.equal(login.login, 'gnfp1abc.rig');
  assert.equal(stats.threads, 8);
  assert.equal(stats.method, 'stats');
  assert.equal(sub.threads, 8);
  assert.equal(sub.method, 'submit');
  assert.equal(sub.login, 'gnfp1abc.rig');
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
