/**
 * CPU hash worker. One OS thread. Main process owns stratum I/O.
 * Each batch snapshots the job so a mid-hash job change cannot retarget shares.
 * After reporting one share, hold until main says go or a new job arrives.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { hashNonceRange, snapshotJob } from './hash_share.js';

const workerId = Number(workerData?.id || 0);
const stride = Math.max(1, Math.floor(Number(workerData?.stride || 1)));
let start = Math.max(0, Math.floor(Number(workerData?.start || workerId)));
let job = null;
let running = true;
let hold = false;

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'job') {
    job = snapshotJob(msg.job);
    start = workerId;
    hold = false;
  }
  if (msg.type === 'go') hold = false;
  if (msg.type === 'stop') running = false;
});

function pump() {
  if (!running) return;
  const current = job;
  if (current) {
    const got = hashNonceRange(current, start, 32, stride);
    start = got.nextNonce;
    if (got.hashes) parentPort.postMessage({ type: 'hashed', n: got.hashes, workerId });
    if (!hold && got.shares.length) {
      parentPort.postMessage({ type: 'share', nonce: got.shares[0], job: current, workerId });
      hold = true;
    }
  }
  setImmediate(pump);
}

pump();
