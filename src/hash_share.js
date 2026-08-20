/**
 * GNFPHash — dedicated CPU work hash (same as gnfp/src/gnfp_pow.js).
 * Eight sequential rounds stay: that is the GPU/ASIC brake.
 * Faster software path (stem copy, buffers, bigger batches) does not
 * reduce rounds. Only current-job 16-hex empty-output shares go on the wire.
 */
import { createHash } from 'crypto';

const HASH_FIELD_MAX = 256;
export const CPU_NONCE_HEX_LEN = 16;
export const MAX_IN_FLIGHT = 16;
export const MAX_SHARE_QUEUE = 64;
export const IN_FLIGHT_TIMEOUT_MS = 5_000;

function clipHashField(value) {
  return String(value || '').slice(0, HASH_FIELD_MAX);
}

/** Always exactly 16 lowercase hex chars, or ''. */
export function normalizeCpuNonce(nonce) {
  const raw = String(nonce ?? '').trim().toLowerCase().replace(/^0x/i, '');
  if (!raw || !/^[0-9a-f]+$/.test(raw)) return '';
  if (raw.length > CPU_NONCE_HEX_LEN) return raw.slice(-CPU_NONCE_HEX_LEN);
  return raw.padStart(CPU_NONCE_HEX_LEN, '0');
}

export function isCpuNonce(nonce) {
  return new RegExp(`^[0-9a-f]{${CPU_NONCE_HEX_LEN}}$`, 'i').test(String(nonce || ''));
}

export const CPU_HASH_ROUNDS = 8;
export const CPU_HASH_PERSONAL = 'GNFPHash-v1';
export const ALGORITHM = 'GNFPHash';
const PERSONAL_BUF = Buffer.from(CPU_HASH_PERSONAL, 'utf8');
const ALGO_BUF = Buffer.from(ALGORITHM, 'utf8');
const ROUND_TAGS = Array.from({ length: CPU_HASH_ROUNDS }, (_, i) => Buffer.from(String(i), 'utf8'));
const HEX_DIGITS = Buffer.from('0123456789abcdef');

export function gnfpWorkHash(preWork, nonce, solution) {
  const pre = clipHashField(preWork);
  const n = clipHashField(nonce);
  const sol = clipHashField(solution);
  let acc = createHash('sha256')
    .update(PERSONAL_BUF)
    .update(ALGO_BUF)
    .update(pre, 'utf8')
    .update(n, 'utf8')
    .update(sol, 'utf8')
    .digest();
  for (let i = 0; i < CPU_HASH_ROUNDS; i += 1) {
    acc = createHash('sha256')
      .update(acc)
      .update(PERSONAL_BUF)
      .update(ROUND_TAGS[i])
      .update(pre, 'utf8')
      .update(n, 'utf8')
      .digest();
  }
  return acc.toString('hex');
}

function nonceHex16(value) {
  let x = Math.max(0, Math.floor(Number(value) || 0));
  const out = Buffer.allocUnsafe(16);
  for (let i = 15; i >= 0; i -= 1) {
    out[i] = HEX_DIGITS[x & 15];
    x = Math.floor(x / 16);
  }
  return out;
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

/**
 * Only submit a nonce found on this exact job snapshot.
 * Never retarget onto a later job. If liveJob is set, drop anything else.
 */
export function prepareShareSubmit({ foundOn, nonce, seen, liveJob } = {}) {
  const job = snapshotJob(foundOn);
  const n = normalizeCpuNonce(nonce);
  if (!job || !job.jobId || !n) return { ok: false, reason: 'incomplete' };
  if (liveJob != null) {
    const live = snapshotJob(liveJob);
    if (!live || !live.jobId || live.jobId !== job.jobId) {
      return { ok: false, reason: 'stale_job' };
    }
  }
  const key = `${job.jobId}:${n}`;
  if (seen && seen.has(key)) return { ok: false, reason: 'duplicate' };
  if (!hashMeetsJob(job, n, '')) return { ok: false, reason: 'local_below_target' };
  if (seen) seen.add(key);
  return { ok: true, key, job, nonce: n };
}

/**
 * At most one unacked submit. Queue is tiny. A new job drops everything
 * still sitting locally so stale lines never hit the book.
 */
export function createSharePipeline({
  maxInFlight = MAX_IN_FLIGHT,
  maxQueued = MAX_SHARE_QUEUE,
  inflightTimeoutMs = IN_FLIGHT_TIMEOUT_MS,
} = {}) {
  const seen = new Set();
  const queue = [];
  let live = null;
  let inFlight = 0;
  let sentAt = 0;

  function releaseTimedOut(now = Date.now()) {
    if (inFlight > 0 && sentAt && now - sentAt >= inflightTimeoutMs) {
      inFlight = 0;
      sentAt = 0;
      return true;
    }
    return false;
  }

  return {
    setJob(job) {
      live = snapshotJob(job);
      queue.length = 0;
      seen.clear();
      return live;
    },
    liveJob() {
      return live;
    },
    offer(foundOn, nonce) {
      const prep = prepareShareSubmit({ foundOn, nonce, seen, liveJob: live });
      if (!prep.ok) return prep;
      if (queue.length >= maxQueued) {
        seen.delete(prep.key);
        return { ok: false, reason: 'queue_full' };
      }
      queue.push(prep);
      return prep;
    },
    nextToSend(now = Date.now()) {
      releaseTimedOut(now);
      if (!live || inFlight >= maxInFlight) return null;
      while (queue.length) {
        const prep = queue.shift();
        if (!prep || prep.job.jobId !== live.jobId) continue;
        if (!isCpuNonce(prep.nonce) || !hashMeetsJob(prep.job, prep.nonce, '')) continue;
        inFlight += 1;
        sentAt = now;
        return prep;
      }
      return null;
    },
    acked() {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) sentAt = 0;
    },
    queued() {
      return queue.length;
    },
    inFlight() {
      return inFlight;
    },
    releaseTimedOut,
  };
}

/** Hash `count` nonces starting at `start`, stepping by `stride`. */
export function hashNonceRange(job, start, count, stride = 1) {
  const shares = [];
  let nonce = Math.max(0, Math.floor(Number(start) || 0));
  const step = Math.max(1, Math.floor(Number(stride) || 1));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const pre = clipHashField(String(job?.input || job?.preWork || ''));
  const bits = jobDifficultyBits(job?.difficulty);
  const preBuf = Buffer.from(pre, 'utf8');
  const stem = createHash('sha256').update(PERSONAL_BUF).update(ALGO_BUF).update(preBuf);
  for (let i = 0; i < n; i += 1) {
    const nBuf = nonceHex16(nonce);
    nonce += step;
    let acc = stem.copy().update(nBuf).digest();
    for (let r = 0; r < CPU_HASH_ROUNDS; r += 1) {
      acc = createHash('sha256')
        .update(acc)
        .update(PERSONAL_BUF)
        .update(ROUND_TAGS[r])
        .update(preBuf)
        .update(nBuf)
        .digest();
    }
    const hex = acc.toString('hex');
    if (meetsTarget(hex, bits)) shares.push(nBuf.toString('utf8'));
  }
  return { hashes: n, shares, nextNonce: nonce };
}
