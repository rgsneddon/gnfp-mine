/**
 * Difficulty-gated GNFP work hash — same algorithm as perc_chain/src/gnfp_pow.js.
 */
import { createHash } from 'crypto';

const HASH_FIELD_MAX = 256;

function clipHashField(value) {
  return String(value || '').slice(0, HASH_FIELD_MAX);
}

export function gnfpWorkHash(preWork, nonce, solution) {
  return createHash('sha256')
    .update(clipHashField(preWork), 'utf8')
    .update(clipHashField(nonce), 'utf8')
    .update(clipHashField(solution), 'utf8')
    .digest('hex');
}

export function jobDifficultyBits(difficulty) {
  return Math.max(1, Number(difficulty) || 1);
}

export function meetsTarget(hash, bits) {
  const n = Math.max(0, Math.min(256, Number(bits) || 0));
  if (n === 0) return true;
  const hex = String(hash || '');
  const fullNibbles = Math.floor(n / 4);
  const rem = n % 4;
  if (hex.length < fullNibbles + (rem ? 1 : 0)) return false;
  if (fullNibbles && hex.slice(0, fullNibbles) !== '0'.repeat(fullNibbles)) return false;
  if (!rem) return true;
  const v = parseInt(hex[fullNibbles] || 'f', 16);
  return v < 1 << (4 - rem);
}

export function hashMeetsJob(job, nonce, solution = '') {
  const pre = String(job?.input || job?.preWork || '');
  const bits = jobDifficultyBits(job?.difficulty);
  return meetsTarget(gnfpWorkHash(pre, nonce, solution), bits);
}

export function snapshotJob(job) {
  if (!job || typeof job !== 'object') return null;
  const jobId = String(job.jobId || job.id || '');
  const input = String(job.input || job.preWork || '');
  if (!jobId && !input) return null;
  return {
    jobId,
    id: jobId,
    input,
    preWork: input,
    difficulty: jobDifficultyBits(job.difficulty),
    height: Number(job.height) || 0,
  };
}

/** Only submit a nonce found on this exact job snapshot. Never retarget onto a later job. */
export function prepareShareSubmit({ foundOn, nonce, seen } = {}) {
  const job = snapshotJob(foundOn);
  const n = String(nonce || '');
  if (!job || !job.jobId || !n) return { ok: false, reason: 'incomplete' };
  const key = `${job.jobId}:${n}`;
  if (seen && seen.has(key)) return { ok: false, reason: 'duplicate' };
  if (!hashMeetsJob(job, n, '')) return { ok: false, reason: 'local_below_target' };
  if (seen) seen.add(key);
  return { ok: true, key, job, nonce: n };
}

/** Hash `count` nonces starting at `start`, stepping by `stride`. */
export function hashNonceRange(job, start, count, stride = 1) {
  const shares = [];
  let nonce = Math.max(0, Math.floor(Number(start) || 0));
  const step = Math.max(1, Math.floor(Number(stride) || 1));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  for (let i = 0; i < n; i += 1) {
    const hex = nonce.toString(16).padStart(16, '0');
    nonce += step;
    if (hashMeetsJob(job, hex, '')) shares.push(hex);
  }
  return { hashes: n, shares, nextNonce: nonce };
}
