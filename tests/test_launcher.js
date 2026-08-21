import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import {
  VERSION,
  TLS_REQUIRED_MSG,
  REFUSE_MSG,
  OLD_MINER_HINT,
  NODE_REQUIRED_MSG,
} from '../src/miner.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const unixLauncher = path.join(root, 'pack/unix/gnfp-mine');
const winLauncher = path.join(root, 'pack/win/gnfp-mine.cmd');

function runUnixLauncher(args = [], extraEnv = {}) {
  return spawnSync(unixLauncher, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: extraEnv,
  });
}

test('unix launcher missing node prints Node.js 18+ and exits non-zero', () => {
  const r = runUnixLauncher(['--help'], {
    PATH: '/usr/bin:/bin',
    HOME: process.env.HOME,
  });
  assert.notEqual(r.status, 0);
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  assert.match(text, /Node\.js 18\+/);
  assert.equal(text.includes('exec: node: not found'), false);
  assert.match(text, /nodejs\.org/);
  assert.match(text, /do not npm install this miner/);
  assert.match(NODE_REQUIRED_MSG, /Node\.js 18\+/);
});

test('windows cmd launcher probes node before exec', () => {
  const cmd = fs.readFileSync(winLauncher, 'utf8');
  assert.match(cmd, /where node/);
  assert.match(cmd, /Node\.js 18\+/);
  assert.match(cmd, /exit \/b 1/);
  assert.match(cmd, /do not npm install this miner/);
  assert.equal(cmd.includes('exec: node: not found'), false);
});

test('miner-visible refuses stay one-line and actionable', () => {
  assert.match(TLS_REQUIRED_MSG, /TLS/);
  assert.match(TLS_REQUIRED_MSG, /--notls/);
  assert.match(REFUSE_MSG, /gnfp1/);
  assert.match(OLD_MINER_HINT, /1\.0\.4/);
  assert.equal(VERSION, '1.0.6');
});

test('README how-to names solo mine and Node 18+', () => {
  const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(md, /How-to: solo mine/);
  assert.match(md, /--equal/);
  assert.match(md, /127\.0\.0\.1:1474/);
  assert.match(md, /--notls/);
  assert.match(md, /1\.0\.6/);
  assert.match(md, /do \*\*not\*\* `npm install` this miner/);
});
