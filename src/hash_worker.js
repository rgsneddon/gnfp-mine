/**
 * CPU hash worker. One OS thread. Main process owns stratum I/O.
 * Each batch snapshots the job so a mid-hash job change cannot retarget shares.
 * Report every find — the main pipeline serializes the wire for the equal book.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { hashNonceRange, snapshotJob } from './hash_share.js';

const nativeBin = process.env.GNFP_NATIVE_BIN
  || fileURLToPath(new URL('./native/gnfphash', import.meta.url));
const nativeWanted = process.env.GNFP_NATIVE === '1' && fs.existsSync(nativeBin);
let nativeDead = false;
let nativeEverHashed = false;
let native = null;
let nativeBuf = '';
const nativeQueue = [];

function failWaiters() {
  while (nativeQueue.length) {
    const w = nativeQueue.shift();
    if (typeof w.fail === 'function') w.fail();
  }
}

function startNative() {
  if (nativeDead || !nativeWanted) return null;
  if (native) return native;
  try {
    native = spawn(nativeBin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    nativeDead = true;
    return null;
  }
  native.stdout.setEncoding('utf8');
  native.stdout.on('data', (chunk) => {
    nativeBuf += chunk;
    let idx;
    while ((idx = nativeBuf.indexOf('\n')) >= 0) {
      const line = nativeBuf.slice(0, idx);
      nativeBuf = nativeBuf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const waiter = nativeQueue[0];
        if (!waiter) continue;
        if (msg.type === 'share' && msg.nonce) waiter.shares.push(String(msg.nonce));
        if (msg.type === 'hashed') {
          waiter.hashes = Number(msg.n) || waiter.count;
          nativeQueue.shift();
          nativeEverHashed = true;
          waiter.done();
        }
      } catch {
        /* skip */
      }
    }
  });
  native.on('error', () => {
    nativeDead = true;
    native = null;
    failWaiters();
  });
  native.on('exit', () => {
    native = null;
    if (!nativeEverHashed) {
      nativeDead = true;
      failWaiters();
    }
  });
  return native;
}

function nativeRange(job, start, count, stride) {
  const proc = startNative();
  if (!proc || !proc.stdin.writable) return Promise.resolve(null);
  return new Promise((resolve) => {
    const waiter = {
      shares: [],
      hashes: 0,
      count,
      done: () => resolve({
        hashes: waiter.hashes || count,
        shares: waiter.shares,
        nextNonce: start + count * stride,
      }),
      fail: () => resolve(null),
    };
    nativeQueue.push(waiter);
    try {
      proc.stdin.write(`${JSON.stringify({
        type: 'job',
        pre: String(job?.input || job?.preWork || ''),
        bits: Math.max(1, Number(job?.difficulty) || 1),
        start,
        count,
        stride,
      })}\n`);
    } catch {
      nativeDead = true;
      failWaiters();
    }
  });
}

const workerId = Number(workerData?.id || 0);
const stride = Math.max(1, Math.floor(Number(workerData?.stride || 1)));
let start = Math.max(0, Math.floor(Number(workerData?.start || workerId)));
let job = null;
let running = true;

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'job') {
    job = snapshotJob(msg.job);
    start = workerId;
  }
  if (msg.type === 'stop') running = false;
});

async function pump() {
  if (!running) return;
  const current = job;
  if (current) {
    const useNative = nativeWanted && !nativeDead;
    const batch = useNative ? 8192 : 256;
    const got = (useNative ? await nativeRange(current, start, batch, stride) : null)
      || hashNonceRange(current, start, batch, stride);
    start = got.nextNonce;
    if (got.hashes) parentPort.postMessage({ type: 'hashed', n: got.hashes, workerId });
    const nShare = Math.min(got.shares.length, 4);
    for (let i = 0; i < nShare; i += 1) {
      parentPort.postMessage({ type: 'share', nonce: got.shares[i], job: current, workerId });
    }
  }
  setImmediate(pump);
}

pump();
