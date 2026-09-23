"use strict";

const HEALTHY_MS = 60_000;
const DELAYS_MS = [1000, 3000, 5000, 10_000, 30_000];
const CRASH_LOOP = 3;

class RestartPolicy {
  constructor() {
    this.streak = 0;
  }

  onExit({ uptimeMs, planned }) {
    if (planned) {
      this.streak = 0;
      return { delayMs: 500, crashLoop: false };
    }
    if (uptimeMs >= HEALTHY_MS) this.streak = 0;
    this.streak++;
    const delayMs = DELAYS_MS[Math.min(this.streak - 1, DELAYS_MS.length - 1)];
    return { delayMs, crashLoop: this.streak === CRASH_LOOP };
  }

  reset() {
    this.streak = 0;
  }
}

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = [];
    this.total = 0;
  }
  push(item) {
    this.items.push(item);
    this.total++;
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  toArray() {
    return this.items.slice();
  }
}

class LineSplitter {
  constructor(onLine, maxLine = 8192) {
    this.onLine = onLine;
    this.maxLine = maxLine;
    this.rest = "";
    this.decoder = new TextDecoder("utf-8");
  }
  write(chunk) {
    this.rest += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    let at;
    while ((at = this.rest.search(/\r?\n/)) >= 0) {
      const line = this.rest.slice(0, at);
      this.rest = this.rest.slice(this.rest[at] === "\r" ? at + 2 : at + 1);
      this.onLine(line);
    }
    if (this.rest.length > this.maxLine) {
      this.onLine(this.rest);
      this.rest = "";
    }
  }
  end() {
    this.rest += this.decoder.decode();
    if (this.rest !== "") this.onLine(this.rest);
    this.rest = "";
  }
}

class PhaseWatcher {
  constructor(graceMs = 8000) {
    this.graceMs = graceMs;
    this.phase = null;
    this.offlineSince = null;
    this.announcedOffline = false;
    this.everOnline = false;
  }
  update(phase, reason, now) {
    const events = [];
    if (phase === "online") {
      if (this.announcedOffline) events.push({ kind: "reconnected" });
      this.everOnline = true;
      this.offlineSince = null;
      this.announcedOffline = false;
    } else if (this.everOnline) {
      if (this.offlineSince === null) this.offlineSince = now;
      if (!this.announcedOffline && now - this.offlineSince >= this.graceMs) {
        this.announcedOffline = true;
        events.push({ kind: "disconnected", reason: reason || "" });
      }
    }
    this.phase = phase;
    return events;
  }
  reset() {
    this.phase = null;
    this.offlineSince = null;
    this.announcedOffline = false;
    this.everOnline = false;
  }
}

module.exports = { RestartPolicy, RingBuffer, LineSplitter, PhaseWatcher, HEALTHY_MS, DELAYS_MS, CRASH_LOOP };
