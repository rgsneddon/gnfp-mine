/**
 * CPU hash worker. One OS thread. Main process owns stratum I/O.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { hashNonceRange } from './hash_share.js';

const workerId = Number(workerData?.id || 0);
const stride = Math.max(1, Math.floor(Number(workerData?.stride || 1)));
let start = Math.max(0, Math.floor(Number(workerData?.start || workerId)));
let job = null;
let running = true;

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'job') {
    job = msg.job || null;
    start = workerId;
  }
  if (msg.type === 'stop') running = false;
});

function pump() {
  if (!running) return;
  if (job) {
    const got = hashNonceRange(job, start, 256, stride);
    start = got.nextNonce;
    if (got.hashes) parentPort.postMessage({ type: 'hashed', n: got.hashes, workerId });
    for (const nonce of got.shares) {
      parentPort.postMessage({ type: 'share', nonce, workerId });
    }
  }
  setImmediate(pump);
}

pump();
