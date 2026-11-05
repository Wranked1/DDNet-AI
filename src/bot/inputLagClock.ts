const TICK_MS = 20;

const SENT_KEEP = 200;

const OFFSETS_KEEP = 25;

export const MAX_SAMPLE_LAG = 50;

export function keptRange(tick: number, timeLeft: number): { lo: number; hi: number } {
  if (timeLeft > 0) return { lo: tick, hi: tick };
  if (timeLeft === 0) return { lo: tick, hi: tick + 1 };
  const late = -timeLeft;
  const kept = tick + 1 + Math.floor(late / TICK_MS);

  if (late % TICK_MS === 0) return { lo: kept - 1, hi: kept };
  return { lo: kept, hi: kept };
}

export type InputLagSample = { at: number; lag: number; snap: number; sentAt: number };

export type InputLagStats = {

  sent: number;
  answers: number;
  matched: number;
  decisions: number;

  samples: number;
  edge: number;
  crowded: number;
  odd: number;
};

type Sent = {
  at: number;
  tick: number;
  snap: number | null;

  answerable: boolean;

  answered: boolean;
  lost: boolean;

  lo: number;
  hi: number;
};

export class InputLagClock {
  readonly stats: InputLagStats = { sent: 0, answers: 0, matched: 0, decisions: 0, samples: 0, edge: 0, crowded: 0, odd: 0 };

  private lastNamed = -1;
  private readonly sent: Sent[] = [];

  private readonly offsets: number[] = [];

  reset(): void {
    this.lastNamed = -1;
    this.sent.length = 0;
    this.offsets.length = 0;
  }

  onSend(at: number, tick: number, snap: number | null): void {
    if (!Number.isFinite(at) || !Number.isInteger(tick)) return;
    this.stats.sent++;
    this.sent.push({ at, tick, snap, answerable: tick > this.lastNamed, answered: false, lost: false, lo: NaN, hi: NaN });
    this.lastNamed = tick;
    if (this.sent.length > SENT_KEEP) this.sent.shift();
  }

  onAnswer(at: number, intendedTick: number, timeLeft: number): InputLagSample | null {
    this.stats.answers++;
    if (!Number.isInteger(intendedTick) || !Number.isInteger(timeLeft)) return null;
    let k = -1;
    for (let i = 0; i < this.sent.length; i++) {
      const s = this.sent[i];
      if (s.answerable && !s.answered && !s.lost && s.tick === intendedTick && s.at <= at) {
        k = i;
        break;
      }
    }
    if (k < 0) return null;

    for (let i = 0; i < k; i++) {
      const s = this.sent[i];
      if (s.answerable && !s.answered) s.lost = true;
    }
    const r = this.sent[k];
    r.answered = true;
    this.stats.matched++;
    const unbias = timeLeft < 0 ? timeLeft - 0.5 : timeLeft > 0 ? timeLeft + 0.5 : 0;
    this.offsets.push(r.at + unbias - intendedTick * TICK_MS);
    if (this.offsets.length > OFFSETS_KEEP) this.offsets.shift();
    const kept = keptRange(intendedTick, timeLeft);
    r.lo = kept.lo;
    r.hi = kept.hi;
    if (r.snap === null) return null;
    this.stats.decisions++;
    if (kept.lo !== kept.hi) {
      this.stats.edge++;
      return null;
    }
    const tick = kept.lo;
    if (this.crowded(k, tick)) {
      this.stats.crowded++;
      return null;
    }
    const lag = tick - r.snap - 1;
    if (lag < 0 || lag > MAX_SAMPLE_LAG) {
      this.stats.odd++;
      return null;
    }
    this.stats.samples++;
    return { at: tick - 1, lag, snap: r.snap, sentAt: r.at };
  }

  private crowded(k: number, tick: number): boolean {
    let lo = Infinity;
    let hi = -Infinity;
    for (const o of this.offsets) {
      if (o < lo) lo = o;
      if (o > hi) hi = o;
    }
    for (let i = 0; i < k; i++) {
      const s = this.sent[i];
      let first: number;
      let last: number;
      if (s.answered) {
        first = s.lo;
        last = s.hi;
      } else {
        first = Math.max(s.tick, Math.ceil((s.at - hi - 1) / TICK_MS));
        last = Math.max(s.tick, Math.ceil((s.at - lo + 1) / TICK_MS));
      }
      if (first <= tick && tick <= last) return true;
    }
    return false;
  }
}
