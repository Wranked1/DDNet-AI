export const ECHO_MAX_TICKS = 10;
export const ECHO_MIN_SAMPLES = 40;

export const ECHO_MATCH_MAX = 0.3;

export const ECHO_MATCH_GAP = 0.05;
export const ECHO_LOG = 8;

export const ECHO_MOVED_COS = 0.98;

export type AimLogEntry = { tick: number; x: number; y: number };

export function logAim(log: AimLogEntry[], tick: number, tx: number, ty: number): void {
  const n = Math.hypot(tx, ty);
  if (n === 0) return;
  log.unshift({ tick, x: tx / n, y: ty / n });
  if (log.length > ECHO_LOG) log.length = ECHO_LOG;
}

export function echoEvidence(miss: Float64Array, seen: Float64Array, log: readonly AimLogEntry[], now: number, ax: number, ay: number): number {
  let added = 0;
  for (let i = 0; i < log.length; i++) {
    const dec = log[i];
    const d = now - dec.tick;
    if (d < 1 || d >= miss.length) continue;
    const before = log[i + 1];

    if (before === undefined || dec.x * before.x + dec.y * before.y > ECHO_MOVED_COS) continue;
    miss[d] += 1 - (ax * dec.x + ay * dec.y);
    seen[d]++;
    if (d === 1 || d === 2) added++;
  }
  return added;
}

export function echoLag(miss: ArrayLike<number>, seen: ArrayLike<number>, samples: number, snapshotGap: number): number {
  if (samples < ECHO_MIN_SAMPLES) return -1;

  let best = -1;
  let bestMiss = Infinity;
  for (let d = 1; d < miss.length; d++) {
    if (seen[d] < ECHO_MIN_SAMPLES) continue;
    const m = miss[d] / seen[d];
    if (m < bestMiss) {
      bestMiss = m;
      best = d;
    }
  }
  if (best < 0 || bestMiss > ECHO_MATCH_MAX) return -1;

  for (let d = 1; d < best; d++) {
    if (seen[d] < ECHO_MIN_SAMPLES) continue;
    if (miss[d] / seen[d] <= bestMiss + ECHO_MATCH_GAP) {
      best = d;
      break;
    }
  }

  return Math.max(0, best - snapshotGap);
}
