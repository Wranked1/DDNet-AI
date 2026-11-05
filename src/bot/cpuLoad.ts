export const SNAPSHOT_PERIOD_MS = 40;

export type CpuSettings = {

  budgetMs: number;
  hardMs: number;

  commit: number;

  explain: boolean;

  navMs: number;

  reachChecks: number;
};

export const LOW_CPU: Readonly<CpuSettings> = { budgetMs: 6, hardMs: 11, commit: 2, explain: false, navMs: 10, reachChecks: 2 };

export const STRONG_WB = { population: 40, iterations: 3, budgetMs: 30, hardMs: 36 } as const;

export function lowCpuWanted(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === "string" && ["on", "true", "yes", "1"].includes(v.trim().toLowerCase()));
}

export const strongWanted = lowCpuWanted;

const WINDOW_MS = 1000;

const WARMUP_MS = 60_000;

const WAITING_GAP_MS = 16;

const BUSY_WORK_MS = SNAPSHOT_PERIOD_MS;

const BEHIND_SKIPS = 2;

export const HINT_AFTER_MS = 5000;

const CLEAR_AFTER_MS = 30_000;

const STALE_MS = 5000;

export type LagSummary = {

  hint: boolean;

  workMs: number;

  skipped: number;

  behindMs: number;
};

export class LagWatch {
  private windowStart = -1;
  private work = 0;
  private processed = 0;
  private busySkips = 0;
  private prevEnd = -Infinity;
  private prevWork = 0;
  private runStart = -1;
  private goodSince = -1;

  private firstMs = -1;
  private hintValue = false;
  private last: LagSummary = { hint: false, workMs: 0, skipped: 0, behindMs: 0 };

  private readonly warmupMs: number;

  constructor(warmupMs = WARMUP_MS) {
    this.warmupMs = warmupMs;
  }

  get hint(): boolean {
    return this.hintValue;
  }

  summary(): LagSummary {
    return { ...this.last, hint: this.hintValue };
  }

  note(firstReadMs: number, arrived: number, startMs: number, endMs: number): string | null {
    if (this.windowStart < 0 || startMs - this.windowStart > STALE_MS) {
      this.startWindow(startMs);
      this.runStart = -1;
      this.firstMs = startMs;
    }
    const waiting = firstReadMs - this.prevEnd <= WAITING_GAP_MS && this.prevWork >= BUSY_WORK_MS;
    if (arrived > 1 && waiting) this.busySkips += arrived - 1;
    this.prevEnd = endMs;
    this.prevWork = endMs - startMs;
    this.work += endMs - startMs;
    this.processed++;
    if (endMs - this.windowStart < WINDOW_MS) return null;
    return this.judge(endMs);
  }

  private startWindow(nowMs: number): void {
    this.windowStart = nowMs;
    this.work = 0;
    this.processed = 0;
    this.busySkips = 0;
  }

  private judge(nowMs: number): string | null {
    const workMs = this.processed > 0 ? this.work / this.processed : 0;
    const skipped = this.busySkips;
    const behind = skipped >= BEHIND_SKIPS && nowMs - this.firstMs >= this.warmupMs;
    if (behind) {
      if (this.runStart < 0) this.runStart = this.windowStart;
      this.goodSince = -1;
    } else {
      this.runStart = -1;
      if (this.goodSince < 0) this.goodSince = this.windowStart;
    }
    const behindMs = this.runStart < 0 ? 0 : nowMs - this.runStart;
    this.last = { hint: this.hintValue, workMs, skipped, behindMs };
    this.startWindow(nowMs);
    if (!this.hintValue && behindMs > HINT_AFTER_MS) {
      this.hintValue = true;
      return `this PC is not keeping up: a snapshot takes ${workMs.toFixed(0)} ms of the ${SNAPSHOT_PERIOD_MS} there are and ${skipped} a second are skipped; the mode for a weak PC may help (!low on)`;
    }
    if (this.hintValue && this.goodSince >= 0 && nowMs - this.goodSince >= CLEAR_AFTER_MS) this.hintValue = false;
    return null;
  }
}

export const ADAPT_WINDOW = 50;
export const ADAPT_SLOW_RATIO = 1.3;
export const ADAPT_SLOW_RUN = 50;
export const ADAPT_FAST_RATIO = 0.6;
export const ADAPT_FAST_RUN = 200;
export const ADAPT_STEP = 0.75;
export const ADAPT_FLOOR = 8;

export const ADAPT_HELPED_RATIO = 0.9;

export function adaptedPopulation(natural: number, level: number, floorWanted = ADAPT_FLOOR): number {
  const floor = Math.min(floorWanted, natural);
  let pop = natural;
  for (let i = 0; i < level; i++) pop = Math.max(floor, Math.floor(pop * ADAPT_STEP));
  return pop;
}

export type AdaptStep = { from: number; to: number; p90: number; budgetMs: number };

export class AdaptiveSearch {

  level = 0;
  private readonly window: number[] = [];
  private slowRun = 0;
  private fastRun = 0;
  private budget = -1;
  private natural = -1;

  private stepP90 = -1;

  private pinned = false;

  population(natural: number, floor = ADAPT_FLOOR): number {
    return adaptedPopulation(natural, this.level, floor);
  }

  reset(): void {
    this.level = 0;
    this.pinned = false;
    this.budget = -1;
    this.natural = -1;
    this.restart();
  }

  private restart(): void {
    this.window.length = 0;
    this.slowRun = 0;
    this.fastRun = 0;
    this.stepP90 = -1;
  }

  note(searchMs: number, budgetMs: number, natural: number, floor = ADAPT_FLOOR): AdaptStep | null {
    if (!(budgetMs > 0) || !Number.isFinite(searchMs)) return null;

    if (budgetMs !== this.budget || natural !== this.natural) {
      this.budget = budgetMs;
      this.natural = natural;
      this.pinned = false;
      this.restart();
      while (this.level > 0 && adaptedPopulation(natural, this.level - 1) === adaptedPopulation(natural, this.level)) this.level--;
    }
    this.window.push(searchMs);
    if (this.window.length > ADAPT_WINDOW) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
    const from = this.population(natural, floor);
    if (this.stepP90 >= 0 && this.window.length >= ADAPT_WINDOW) {
      const limit = this.stepP90;
      this.stepP90 = -1;
      if (p90 > limit && this.level > 0) {
        this.level--;
        this.pinned = true;
        this.restart();
        const to = this.population(natural, floor);
        return to === from ? null : { from, to, p90, budgetMs };
      }
    }
    this.slowRun = !this.pinned && p90 > budgetMs * ADAPT_SLOW_RATIO ? this.slowRun + 1 : 0;
    this.fastRun = p90 < budgetMs * ADAPT_FAST_RATIO ? this.fastRun + 1 : 0;
    if (this.slowRun >= ADAPT_SLOW_RUN) {
      this.slowRun = 0;

      if (adaptedPopulation(natural, this.level + 1, floor) === from) return null;
      this.level++;
      this.restart();
      const to = this.population(natural, floor);
      this.stepP90 = p90 * (1 - (1 - ADAPT_HELPED_RATIO) * ((1 - to / from) / (1 - ADAPT_STEP)));
      return { from, to, p90, budgetMs };
    }
    if (this.fastRun >= ADAPT_FAST_RUN) {
      this.fastRun = 0;
      if (this.level === 0) return null;
      this.level--;
      this.restart();
      const to = this.population(natural, floor);
      return to === from ? null : { from, to, p90, budgetMs };
    }
    return null;
  }
}
