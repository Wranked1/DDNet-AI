export const CHAT_PENALTY = 250;
export const CHAT_THRESHOLD = 1000;
export const CHAT_DECAY_PER_S = 50;

export const CHAT_AUTO_LIMIT = 750;

export function chatCost(text: string): number {
  const t = text.trim();
  if (!t.startsWith("/")) return CHAT_PENALTY;
  return /^\/(?:w|whisper|c|converse)(?:\s|$)/i.test(t) ? CHAT_PENALTY : 0;
}

export function mutedSeconds(serverLine: string): number | null {
  const m = /(?:not permitted to talk for the next|will be able to talk in|will need to wait) (\d+) seconds?/i.exec(serverLine);
  return m === null ? null : Number(m[1]);
}

export class ChatBudget {
  private score = 0;
  private atMs = 0;
  private heldUntilMs = 0;

  private decay(nowMs: number): void {
    if (nowMs > this.atMs) this.score = Math.max(0, this.score - (CHAT_DECAY_PER_S * (nowMs - this.atMs)) / 1000);
    this.atMs = nowMs;
  }

  allows(text: string, nowMs: number, automatic: boolean): boolean {

    const cost = chatCost(text);
    if (cost === 0) return true;
    if (nowMs < this.heldUntilMs) return false;
    this.decay(nowMs);
    return this.score + cost <= (automatic ? CHAT_AUTO_LIMIT : CHAT_THRESHOLD);
  }

  record(text: string, nowMs: number): void {
    this.decay(nowMs);
    this.score += chatCost(text);
  }

  hold(seconds: number, nowMs: number): void {
    this.heldUntilMs = Math.max(this.heldUntilMs, nowMs + seconds * 1000);
    this.score = 0;
    this.atMs = this.heldUntilMs;
  }
}
