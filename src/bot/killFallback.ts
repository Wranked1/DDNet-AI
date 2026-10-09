export const KILL_COOLDOWN_TICKS = 10 * 50;

export const EFFECT_WAIT_TICKS = 50;

export const MAX_COMMANDS_PER_LIFE = 3;

export const KILL_COMMAND = "/kill";

const TICKS_PER_MINUTE = 3000;
const NEVER = -(2 ** 30);

const NOTICE_PREFIX = "Kill Protection enabled";

export function isKillProtectionNotice(clientId: number, text: string): boolean {
  return clientId === -1 && text.startsWith(NOTICE_PREFIX);
}

export type Learned = { lifeMinutes: number };

export class KillFallback {

  private awaiting: number | null = null;

  private sentFor = false;

  private noticeSeen = false;
  private lastCommand = NEVER;
  private commandsThisLife = 0;
  private givenUp = false;
  private lifeStart: number | null = null;

  private commandTick: number | null = null;

  private deadTick: number | null = null;

  reset(): void {
    this.awaiting = null;
    this.sentFor = false;
    this.noticeSeen = false;
    this.lastCommand = NEVER;
    this.commandsThisLife = 0;
    this.givenUp = false;
    this.lifeStart = null;
    this.commandTick = null;
    this.deadTick = null;
  }

  onNotice(): void {
    this.noticeSeen = true;
  }

  noticed(): boolean {
    return this.noticeSeen;
  }

  onProtocolKill(tick: number): void {
    this.awaiting = tick;
    this.sentFor = false;
  }

  awaitedTick(): number | null {
    return this.awaiting;
  }

  onDead(tick: number): void {
    this.awaiting = null;
    this.sentFor = false;
    if (this.commandTick !== null && this.deadTick === null) this.deadTick = tick;
  }

  onLifeStarted(tick: number): Learned | null {
    const effect = this.deadTick ?? tick;
    this.deadTick = null;
    const cmd = this.commandTick;
    this.commandTick = null;
    let learned: Learned | null = null;
    if (cmd !== null && this.lifeStart !== null && cmd >= this.lifeStart && effect - cmd >= 0 && effect - cmd <= EFFECT_WAIT_TICKS) {
      learned = { lifeMinutes: (cmd - this.lifeStart) / TICKS_PER_MINUTE };
    }
    this.awaiting = null;
    this.sentFor = false;
    this.noticeSeen = false;
    this.commandsThisLife = 0;
    this.givenUp = false;
    this.lifeStart = tick;
    return learned;
  }

  poll(tick: number): boolean {
    const asked = this.awaiting;
    if (asked === null) return false;
    if (this.sentFor || this.givenUp) return false;
    if (!(this.noticeSeen || tick - asked >= EFFECT_WAIT_TICKS)) return false;
    if (tick - this.lastCommand < KILL_COOLDOWN_TICKS) return false;
    if (this.commandsThisLife >= MAX_COMMANDS_PER_LIFE) {
      this.givenUp = true;
      return false;
    }
    this.lastCommand = tick;
    this.sentFor = true;
    this.commandsThisLife++;
    this.commandTick = tick;
    this.deadTick = null;
    return true;
  }

  cancelPending(): void {
    this.awaiting = null;
    this.sentFor = false;
    this.commandTick = null;
    this.deadTick = null;
  }

  gaveUp(): boolean {
    return this.givenUp;
  }
}
