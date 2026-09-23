export type Mood = "offline" | "connecting" | "idle" | "playing" | "frozen" | "stopped" | "won" | "lost";

type Face = { eyes: string[]; mouth: string; colour: string };

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

const CREAM = `${ESC}38;5;180m`;
const GREY = `${ESC}38;5;245m`;
const BLUE = `${ESC}38;5;109m`;
const GREEN = `${ESC}38;5;108m`;
const RED = `${ESC}38;5;174m`;
const YELLOW = `${ESC}38;5;180m`;

const FACES: Record<Mood, Face> = {
  offline: { eyes: ["-", "-"], mouth: "_", colour: GREY },
  connecting: { eyes: ["o", "O", "o", "."], mouth: "_", colour: BLUE },
  idle: { eyes: ["o", "o", "o", "o", "o", "o", "-"], mouth: "_", colour: CREAM },
  playing: { eyes: ["o", "o", "o", "o", "o", "^", "o"], mouth: "w", colour: GREEN },
  frozen: { eyes: ["x", "x"], mouth: "~", colour: BLUE },
  stopped: { eyes: ["-", "-"], mouth: "z", colour: GREY },
  won: { eyes: ["^", "^"], mouth: "D", colour: YELLOW },
  lost: { eyes: ["T", "T"], mouth: "n", colour: RED },
};

export class Mascot {
  private frame = 0;
  private mood: Mood = "offline";

  private flash: { mood: Mood; until: number } | null = null;

  setMood(mood: Mood): void {
    this.mood = mood;
  }

  react(mood: Mood, ms = 2000): void {
    this.flash = { mood, until: Date.now() + ms };
  }

  private current(): Mood {
    if (this.flash !== null) {
      if (Date.now() < this.flash.until) return this.flash.mood;
      this.flash = null;
    }
    return this.mood;
  }

  render(): string {
    const mood = this.current();
    const f = FACES[mood];
    const eye = f.eyes[this.frame % f.eyes.length];
    this.frame++;

    const bob = mood === "playing" && this.frame % 4 < 2 ? "" : " ";
    return `${f.colour}${bob}(${eye}${f.mouth}${eye})${RESET}`;
  }

  renderBig(): string {
    const f = FACES[this.current()];
    const eye = f.eyes[0];
    return [
      `${f.colour}   .-\"\"\"-.${RESET}`,
      `${f.colour}  /  ${eye} ${eye}  \\${RESET}`,
      `${f.colour} |    ${f.mouth}    |${RESET}`,
      `${f.colour}  \\  ___  /${RESET}`,
      `${f.colour}   '-----'${RESET}`,
    ].join("\n");
  }
}

export function moodFrom(phase: string, acting: boolean, frozen: boolean, hasTarget: boolean): Mood {
  if (phase === "offline") return "offline";
  if (phase === "connecting") return "connecting";
  if (frozen) return "frozen";
  if (!acting) return "stopped";
  return hasTarget ? "playing" : "idle";
}
