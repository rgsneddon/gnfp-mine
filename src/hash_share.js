/**
 * Difficulty-gated GNFP work hash — same algorithm as perc_chain/src/gnfp_pow.js.
 */
import { createHash } from 'crypto';

export function gnfpWorkHash(preWork, nonce, solution) {
  return createHash('sha256')
    .update(String(preWork || ''), 'utf8')
    .update(String(nonce || ''), 'utf8')
    .update(String(solution || ''), 'utf8')
    .digest('hex');
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
  const bits = Number(job?.difficulty) || 1;
  return meetsTarget(gnfpWorkHash(pre, nonce, solution), bits);
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
