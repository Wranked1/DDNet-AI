import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Vec2 } from "../core/vmath.ts";
import { vdistance } from "../core/vmath.ts";
import { Collision } from "../core/collision.ts";
import { PHYSICAL_SIZE, TUNING } from "../core/tuning.ts";
import type { PlayerInput, TeeState } from "../core/types.ts";
import { WEAPON_HAMMER, emptyInput, wireAngleRad } from "../core/types.ts";
import { HOOK_FLYING } from "../core/characterCore.ts";
import type { RecurrentPolicy } from "../nn/gru.ts";
import { PLANNER_DEFAULTS, Planner } from "../plan/planner.ts";
import { getLang, isLang, setLang, t } from "../i18n.ts";
import type { Lang } from "../i18n.ts";

const TRY_SETTINGS: Record<string, Record<string, unknown>> = {

  trackaim: { trackAim: true },

  launch: { launchExposure: 1.0 },

  both: { trackAim: true, launchExposure: 1.0 },

  careful: { selfFreezeBias: 1.5 },

  careful2: { selfFreezeBias: 2.0 },

  bold: { selfFreezeBias: 1.0 },

  nothaw: { noThaw: true },

  readsyou: { opponentModel: "learned" },

  bothcareful: { trackAim: true, launchExposure: 1.0, selfFreezeBias: 1.5 },

  others2: { planOthers: 2 },
  oldcopy: { liveTransfer: "legacy" },

  smooth: { warmShiftElapsed: true },
};

const LIVE_BUDGET_MS = 18;

export const PLANNER_BOLD = { population: 64, iterations: 3, budgetMs: LIVE_BUDGET_MS } as const;
import { SimWorld } from "../core/world.ts";
import { Rng } from "../nn/rng.ts";
import { ACTION_SIZE, decodeAction } from "../env/action.ts";
import { OBS_SIZE, encodeObs, isGrounded} from "../env/obs.ts";
import { scriptedAction } from "../env/scripted.ts";
import { LiveWorld, mapCollisionFromClient } from "./liveWorld.ts";
import { RingRecorder, snapInput, snapTee } from "../watch/recording.ts";
import type { RecFrame } from "../watch/recording.ts";
import { enemyInputFromSnapshot, syncOthers, syncPlanningWorld, syncPlanningWorldLegacy } from "../plan/livePlan.ts";
import { sealedIn } from "../plan/seal.ts";
import { escapeExists, saferInput } from "../plan/shield.ts";
import { deadZone, findRoute, spawnTiles } from "../plan/route.ts";
import { FreezeMemory } from "../plan/memory.ts";
import type { RouteStep } from "../plan/route.ts";
import type { Mlp } from "../nn/mlp.ts";
import type { Recording } from "../watch/recording.ts";
import { findIncidents, mergeOverlapping } from "../watch/incidents.ts";
import { Navigator, teleGoals, tileGoal } from "./navigate.ts";
import type { NavGoal } from "./navigate.ts";
import { installNetworkGuard, patchHuffman, patchRedirect } from "./netPatch.ts";
import type { NetGuard } from "./netPatch.ts";
import type { MapClientLike, SnapshotSource } from "./liveWorld.ts";

const require = createRequire(import.meta.url);

type TwPlayerInput = {
  m_Direction: number;
  m_TargetX: number;
  m_TargetY: number;
  m_Jump: number;
  m_Fire: number;
  m_Hook: number;
  m_PlayerFlags: number;
  m_WantedWeapon: number;
  m_NextWeapon: number;
  m_PrevWeapon: number;
};

type TwMovement = {
  RunLeft(): void;
  RunRight(): void;
  RunStop(): void;
  Jump(state?: boolean): void;
  Fire(): void;
  Hook(state?: boolean): void;
  WantedWeapon(weapon: number): void;
  SetAim(x: number, y: number): void;
  FlagPlaying(toggle?: boolean): void;
  FlagScoreboard?(toggle?: boolean): void;
};

type TwGame = {
  Say(message: string, team?: boolean): void;
  ChangePlayerInfo?(info: {
    name: string;
    clan: string;
    country: number;
    skin: string;
    use_custom_color: boolean;
    color_body: number;
    color_feet: number;
  }): void;
  SetTeam(team: number): void;
  Kill(): void;
  Vote(yes: boolean): void;
  CallVoteOption(value: string, reason: string): void;
  Emote(emoticon: number): void;
};

const EMOTICON_EXCLAMATION = 1;
const EMOTICON_HEARTS = 2;
const EMOTICON_DROP = 3;
const EMOTICON_SORRY = 6;
const EMOTICON_SPLATTEE = 9;
const EMOTICON_ZZZ = 12;
const EMOTICON_QUESTION = 15;

const PLAN_OTHERS_PX = 500;

const ECHO_MAX_TICKS = 10;
const ECHO_MIN_SAMPLES = 40;

const ECHO_MATCH_MAX = 0.3;

const ECHO_MATCH_GAP = 0.05;
const ECHO_LOG = 8;

const MAX_LAG_TICKS = 6;
const DUEL_ACCEPT_COOLDOWN_MS = 15000;
const EMOTE_COOLDOWN_MS = 3000;

export const COMMAND_PREFIXES = ["!", "?"];

const BRUSH_OFFS = ["не", "лол", "ахах нет", "скилл", "чё", "не бот", "мимо", "ну да ну да"];

const BRUSH_OFFS_EN = ["no", "lol", "haha no", "skill", "what", "not a bot", "missed", "yeah yeah"];

const REPLY_DELAY_MS = 2200;
const REPLY_JITTER_MS = 1800;

const REPLY_COOLDOWN_MS = 60_000;

const ACCUSATION = /(?<![a-zа-яё])(bot|бот|боты|aimbot|аимбот|аимбота|cheat|чит|читер|читак|читы|hack|хак|aim|аим)(?![a-zа-яё])/iu;

const TARGET_MAX_PX = 1600;
const AGGRESSOR_RANGE_PX = 500;
const AGGRESSOR_MEMORY_TICKS = 3 * 50;

const GO_HOME_AFTER_TICKS = 4 * 50;

const TRAVEL_RETRY_TICKS = 5 * 50;

const CROWD_RADIUS_PX = 600;
const ACTION_MEMORY_TICKS = 2 * 50;

const SEEK_MARGIN = 3;
const SEEK_PATIENCE_TICKS = 4 * 50;
const SEEK_ARRIVED_PX = 500;

const TREK_REACHED_PX = 56;

const PATH_NEAR_PX = 420;
const PATH_REACHED_PX = 56;

const PATH_REFRESH_TICKS = 25;
const PATH_MIN_REFRESH_TICKS = 6;
const PATH_MOVED_PX = 96;

const PATH_PROGRESS_WINDOW = 10;
const TREK_STALL_TICKS = 150;

const ENGAGED_PX = 420;

const AFK_RADIUS_PX = 24;
const AFK_TICKS = 10 * 50;

function listed(list: Map<string, string>, nameKey: string): boolean {
  if (nameKey === "" || list.size === 0) return false;
  if (list.has(nameKey)) return true;
  for (const key of list.keys()) {
    if (key !== "" && (nameKey.includes(key) || key.includes(nameKey))) return true;
  }
  return false;
}

const RELATIONS_FILE = "runs/relations.json";

const HALF_TEE = PHYSICAL_SIZE / 2;
const BLOCKING_RANGE_PX = 320;

const FINISH_BLOCK_TICKS = 150;
const FINISH_BLOCK_SCORE = 600;

const SEAL_NEAR_TILES = 2;

const SEAL_ANSWER_TICKS = 6;

const BYSTANDER_PX = 160;

const REACH_ANSWER_TICKS = 25;

const OUT_OF_REACH_SCORE = 700;
const REACH_MAX_NODES = 20000;

const TARGET_HOLD_SCORE = 400;

const HOLD_FADE_PX = 400;
const TARGET_DIST_WEIGHT = 0.25;

const EMOTICON_BY_NAME: Record<string, number> = {
  exclamation: EMOTICON_EXCLAMATION,
  hearts: EMOTICON_HEARTS,
  drop: EMOTICON_DROP,
  sorry: EMOTICON_SORRY,
  splat: EMOTICON_SPLATTEE,
  zzz: EMOTICON_ZZZ,
  question: EMOTICON_QUESTION,
};

export function cursorOf(input: PlayerInput): { x: number; y: number } | undefined {
  const len = Math.hypot(input.targetX, input.targetY);
  if (!(len >= 1)) return undefined;
  const k = Math.min(1, 400 / len);
  return { x: Math.round(input.targetX * k), y: Math.round(input.targetY * k) };
}

export type BotLine = { kind: "log" | "chat" | "event" | "whisper"; text: string; from?: string; sys?: boolean };

const CHAT_ALL = 0;
const CHAT_TEAM = 1;
const CHAT_WHISPER_SENT = 2;
const CHAT_WHISPER_RECV = 3;

export type LiveMap = {
  name: string;
  width: number;
  height: number;
  kinds: string;

  traps?: string;
};
export type LiveTee = {
  id: number;
  name: string;
  x: number;
  y: number;
  frozen: boolean;
  hook: number;
  hx: number;
  hy: number;
  hooked: number;

  clan?: string;
  skin?: string;
  cc?: boolean;
  cb?: number;
  cf?: number;
  aim?: number;
  wp?: number;
  emote?: number;
  vx?: number;
  vy?: number;
  dir?: number;
  jumped?: number;
  atk?: number;
  fz?: number;
  pf?: number;
  jl?: number;
  fzf?: number;
  deep?: boolean;
  xf?: number;
  jt?: number;
};

export type LivePlayer = {
  id: number;
  name: string;
  clan: string;
  score: number;
  ping: number;
  team: number;
  skin?: string;
  cc?: boolean;
  cb?: number;
  cf?: number;
};
export type LiveFrame = {
  tick: number;
  selfId: number;
  target: number;
  map: string;
  tees: LiveTee[];

  doing: string;
  goal: { x: number; y: number } | null;
  route: { x: number; y: number; kind: string }[];

  cursor?: { x: number; y: number };
  players?: LivePlayer[];

  roundStart?: number;
};

export type BotStatus = {
  phase: "offline" | "connecting" | "online";
  acting: boolean;
  brain: "planner" | "net" | "scripted";
  mode: "fight" | "passive" | "hold" | "goto";
  server: string;
  name: string;
  targetName: string | null;
  targetDist: number | null;

  walk: string | null;

  offlineReason: string;
  frozen: boolean;
  tick: number;
  stats: BotStats;
};

type TwPlayerInfo = { local: number; client_id: number; team: number; score: number; latency: number };

type TwClientInfo = {
  name: string;
  clan: string;
  id: number;
  skin?: string;
  use_custom_color?: number;
  color_body?: number;
  color_feet?: number;
};

interface TwSnapshotUnpacker extends SnapshotSource {
  readonly OwnID: number | undefined;
  getObjPlayerInfo(id: number): TwPlayerInfo | undefined;
  readonly AllObjClientInfo: TwClientInfo[];
}

type TwKill = { killer_id: number; victim_id: number; weapon: number };

type TwMessage = { team: number; client_id: number; message: string };

interface TwClient extends MapClientLike {
  on(event: "connected", listener: () => void): this;
  on(event: "disconnect", listener: (reason: string, fromServer: boolean) => void): this;
  on(event: "snapshot", listener: (items: unknown[]) => void): this;
  on(event: "kill", listener: (kill: TwKill) => void): this;
  on(event: "message", listener: (message: TwMessage) => void): this;
  on(event: "map_change", listener: (change: { map_name: string }) => void): this;
  connect(): Promise<void>;
  Disconnect(): Promise<unknown>;
  readonly State: number;
  readonly SnapshotUnpacker: TwSnapshotUnpacker;
  readonly movement: TwMovement;
  readonly game: TwGame;
  sendInput(): void;
  readonly input: TwPlayerInput;

  readonly currentSnapshotGameTick?: number;
}

type TwIdentity = {
  name: string;
  clan: string;
  country: number;
  skin: string;
  use_custom_color: number;
  color_body: number;
  color_feet: number;
};

type TwOptions = {
  identity?: TwIdentity;
  password?: string;
  ddnet_version?: { version: number; release_version: string };
  timeout?: number;
  lightweight?: boolean;
  downloadMap?: boolean;
};

type TeeworldsModule = {
  Client: new (host: string, port: number, nickname: string, options?: TwOptions) => TwClient;
  Protocol: { States: { STATE_OFFLINE: number; STATE_CONNECTING: number; STATE_LOADING: number; STATE_ONLINE: number } };
};

const teeworlds = require("teeworlds") as TeeworldsModule;

const DEFAULT_PROTOCOL_VERSION = 19000;
const CLIENT_VERSION = { version: DEFAULT_PROTOCOL_VERSION, release_version: "19.0" };

const CHAT_MIN_INTERVAL_MS = 2000;
const JOIN_RETRY_MS = 3000;
const COLLISION_RETRY_MS = 2000;
const STATUS_INTERVAL_MS = 5000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const KILL_COOLDOWN_TICKS = 10 * 50;

const HELPED_LIMIT_TICKS = 30 * 50;

const HELPER_RANGE_PX = 140;

const SNAPSHOTS_PER_SECOND = 25;
const CLIP_SECONDS = 30;

const CLIP_SCAN_EVERY_FRAMES = 50;

const CLIP_COOLDOWN_TICKS = 45 * 50;

const CLIP_SEVERITY = 250;

const CLIP_SEVERITY_BY_KIND: Record<string, number> = { "self-freeze": 180, "chased-into-freeze": 180 };
const DEFAULT_CLIP_DIR = "runs/clips";

const CLIP_KEEP = 24;
const CLIP_KEEP_PER_KIND = 16;

const LIVE_PLANNER_CFG: Record<string, unknown> = { thirdTeeExposure: 0, memoryTrust: 0.9 };

export type BotConfig = {
  host: string;
  port: number;
  name: string;
  clan?: string;

  clipDir?: string;

  acceptDuels?: boolean;

  relationsFile?: string;

  settingsFile?: string;

  autoServer?: boolean;

  autoAvoidFile?: string;

  lagCompensation?: boolean;

  password?: string;
  skin?: string;
  country?: number;
  colorBody?: number;
  colorFeet?: number;
  policy?: RecurrentPolicy;

  planner?: boolean;

  plannerCfg?: ConstructorParameters<typeof Planner>[0];

  memoryDir?: string;

  opponentDirNet?: Mlp | null;
  scripted?: boolean;
  mapDir: string;
  chat?: boolean;

  emotes?: boolean;
  targetName?: string;

  brushOff?: boolean;

  protocolVersion?: number;

  goto?: string;
  reconnect?: boolean;
  verbose?: boolean;
};

export type BotStats = {
  ticks: number;
  kills: number;
  deaths: number;
  selfKills: number;
  clips: number;
  hammerFires: number;
  hooksFired: number;
  disconnects: number;
  errors: number;
};

export type Travel = { start: Vec2 | null; end: Vec2 | null; distance: number };

export function wanderHazardBelow(col: { isSolid(x: number, y: number): boolean; isFreeze(x: number, y: number): boolean; isDeath(x: number, y: number): boolean }, x: number, y: number): boolean {
  for (let k = 1; k <= 6; k++) {
    const yy = y + k * 32;
    if (col.isSolid(x, yy)) return false;
    if (col.isFreeze(x, yy) || col.isDeath(x, yy)) return true;
  }
  return false;
}

export function firePressed(prev: PlayerInput, cur: PlayerInput): boolean {
  return cur.fire !== prev.fire && (cur.fire & 1) !== 0;
}

export class DdnetBot {
  readonly stats: BotStats = { ticks: 0, kills: 0, deaths: 0, selfKills: 0, clips: 0, hammerFires: 0, hooksFired: 0, disconnects: 0, errors: 0 };
  readonly travel: Travel = { start: null, end: null, distance: 0 };

  private readonly cfg: BotConfig;
  private client: TwClient | undefined;
  private readonly world: LiveWorld;
  private collisionReady = false;
  private lastCollisionTryMs = 0;
  private phase: "offline" | "connecting" | "online" = "offline";
  private stopping = false;
  private acting = true;

  private mode: "fight" | "passive" | "hold" | "goto" = "fight";
  private nav: Navigator | null = null;

  private pendingGoto: string | null = null;

  private navReturnMode: "fight" | "passive" | "hold" = "fight";

  private navPending = false;
  private ownId = -1;
  private targetId = -1;
  private prevInput: PlayerInput = emptyInput();

  private sent: { tick: number; input: PlayerInput }[] = [];
  private readonly obs = new Float64Array(OBS_SIZE);
  private readonly raw = new Float64Array(ACTION_SIZE);
  private readonly rng = new Rng((Date.now() ^ process.pid) >>> 0);
  private reconnectDelayMs = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastChatMs = 0;
  private lastJoinMs = 0;
  private lastStatusMs = 0;
  private lastPos: Vec2 | null = null;

  private stuckAnchor: Vec2 | null = null;
  private stuckAnchorTick = 0;
  private stuckAnchorMs = 0;
  private stuckAnchorFrozen = false;

  private frozenSince = -1;

  private lastDisconnect = "";

  private readonly frozenSinceById = new Map<number, number>();

  private readonly lastMovedById = new Map<number, { x: number; y: number; tick: number }>();

  private readonly relations = {
    war: new Map<string, string>(),
    friend: new Map<string, string>(),
    clanWar: new Map<string, string>(),
    clanFriend: new Map<string, string>(),

    ignore: new Map<string, string>(),
  };

  private home: { tx: number; ty: number } | null = null;
  private idleSinceTick = -1;

  private travelSinceTick = -1000;
  private dullSinceTick = -1;
  private seekingGame = false;

  private trek: { steps: RouteStep[]; at: number; since: number; best: number; bestTick: number } | null = null;

  private deadCells: { width: number; cells: Uint8Array } | null = null;

  private memory: FreezeMemory | null = null;
  private lastTileIndex = -1;

  private path: { steps: RouteStep[]; at: number; target: number; to: Vec2; done: number } | null = null;

  private readonly clipRing = new RingRecorder(CLIP_SECONDS * SNAPSHOTS_PER_SECOND);
  private clipMapSet = false;
  private lastClipTick = -Infinity;
  private framesSinceScan = 0;
  private lastKillTick = -Infinity;
  private lastEmoteMs = 0;
  private lastAcceptMs = 0;
  private readonly lastSeenDist = new Map<number, number>();
  private readonly lastReplyMs = new Map<number, number>();
  private readonly replyTimers = new Set<NodeJS.Timeout>();
  private wanderDir = 0;
  private wanderUntilTick = 0;
  private wanderAim = 0;
  private wanderJumpUntilTick = 0;
  private wanderHookUntilTick = 0;
  private readonly wanderRng = new Rng(0x5eed ^ Date.now());
  private planner: Planner | null = null;
  private planSim: SimWorld | null = null;

  private sealSim: SimWorld | null = null;

  private shieldSim: SimWorld | null = null;
  private sealAnswers = new Map<number, { tick: number; sealed: boolean }>();

  private reachAnswers = new Map<number, { tick: number; from: number; to: number; ok: boolean }>();

  private readonly planOthersIn = new Set<number>();
  private planTargetId = -1;
  private planSelfId = -1;
  private planCollision: Collision | null = null;
  private wasFrozen = false;
  private wasAlive = false;
  private startWaiter: { resolve: () => void; reject: (err: Error) => void } | undefined;

  constructor(cfg: BotConfig) {
    if (!cfg.scripted && !cfg.policy && !cfg.planner) {
      throw new Error("DdnetBot: one of policy, scripted or planner is required");
    }

    Object.assign(this.baseCfg, LIVE_PLANNER_CFG, cfg.plannerCfg ?? {});
    if (cfg.policy) {
      const { inputs, outputs } = cfg.policy.shape;
      if (inputs !== OBS_SIZE || outputs !== ACTION_SIZE) {
        throw new Error(`DdnetBot: policy shape ${inputs}->${outputs} does not match OBS_SIZE=${OBS_SIZE}/ACTION_SIZE=${ACTION_SIZE}`);
      }
    }
    this.cfg = { ...cfg, plannerCfg: { ...this.baseCfg } };

    this.world = new LiveWorld(new Collision(1, 1, new Uint8Array(1)));
    this.loadRelations();
  }

  start(): Promise<void> {

    if (!patchHuffman()) this.log("could not bound the huffman decoder; a malformed packet may still be fatal");
    if (!patchRedirect()) this.log("could not teach the network library server redirects");
    this.netGuard ??= installNetworkGuard((message, dropped) => {
      this.stats.errors++;
      this.emit("event", `dropped an undecodable packet (${dropped} so far): ${message}`);

      if (dropped === 1 || dropped % 50 === 0) {
        if (dropped >= 50) this.log(`${dropped} undecodable packets from this server -- the connection may be unusable`);
      }
    });
    this.netGuard.install();
    if (this.client) return Promise.reject(new Error("DdnetBot.start: already started"));
    this.watchServer();
    const client = new teeworlds.Client(this.cfg.host, this.cfg.port, this.cfg.name, {
      identity: {
        name: this.cfg.name,
        clan: this.cfg.clan ?? "",
        country: this.cfg.country ?? -1,
        skin: this.cfg.skin ?? "default",
        use_custom_color: this.cfg.colorBody !== undefined || this.cfg.colorFeet !== undefined ? 1 : 0,
        color_body: this.cfg.colorBody ?? 0,
        color_feet: this.cfg.colorFeet ?? 0,
      },
      ...(this.cfg.password !== undefined && this.cfg.password.length > 0 ? { password: this.cfg.password } : {}),
      ddnet_version:
        this.cfg.protocolVersion === undefined
          ? CLIENT_VERSION
          : { version: this.cfg.protocolVersion, release_version: `${(this.cfg.protocolVersion / 1000).toFixed(1)}` },
      downloadMap: true,
    });
    this.client = client;
    client.on("connected", () => this.onConnected());
    client.on("disconnect", (reason, fromServer) => this.onDisconnect(reason, fromServer));

    (client as unknown as { on(e: "redirect", fn: (port: number) => void): void }).on("redirect", (port) => {
      if (port === this.cfg.port) return;
      this.emit("event", `the server redirects us to port ${port}`);
      this.cfg.port = port;
      (client as unknown as { port: number }).port = port;
      this.reconnectDelayMs = RECONNECT_MIN_MS;

      void client.Disconnect().catch(() => {});
    });
    client.on("snapshot", () => this.onSnapshot());
    client.on("kill", (kill) => this.onKill(kill));
    client.on("message", (msg) => this.onMessage(msg));
    client.on("map_change", (change) => {
      this.collisionReady = false;
      this.lastCollisionTryMs = 0;

      this.onTickReset(0);
      this.targetId = -1;
      this.lastSeenDist.clear();

      if (this.nav !== null) {
        this.emit("event", `goto: dropped, the map is now '${change.map_name}'`);
        this.endNav();
      }

      this.navPending = this.cfg.goto !== undefined && this.cfg.goto.trim().length > 0;
      this.log(`map change: ${change.map_name}`);
    });
    return new Promise((resolve, reject) => {
      this.startWaiter = { resolve, reject };
      this.connect();
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.serverWatch !== null) clearInterval(this.serverWatch);
    this.serverWatch = null;
    this.netGuard?.uninstall();

    for (const t of this.replyTimers) clearTimeout(t);
    this.replyTimers.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const client = this.client;
    if (!client) return;

    if (client.State !== teeworlds.Protocol.States.STATE_OFFLINE) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2500);
      });
      await Promise.race([client.Disconnect(), timeout]);
      if (timer) clearTimeout(timer);
    }
    this.phase = "offline";
  }

  statsLine(): string {
    const s = this.stats;

    const held = this.world.getTee(this.ownId ?? -1)?.activeWeapon;
    const weapon = held === undefined ? "?" : held === WEAPON_HAMMER ? "hammer" : `weapon${held}`;

    return `ticks=${s.ticks} brain=${this.brainName()} weapon=${weapon} try=${this.tryName} kills=${s.kills} deaths=${s.deaths} selfKills=${s.selfKills} clips=${s.clips} hammerFires=${s.hammerFires} hooksFired=${s.hooksFired} disconnects=${s.disconnects} errors=${s.errors}`;
  }

  private sink: ((line: BotLine) => void) | null = null;

  onOutput(sink: ((line: BotLine) => void) | null): void {
    this.sink = sink;
  }

  private quitRequested: (() => void) | null = null;
  private netGuard: NetGuard | null = null;

  onQuitRequested(fn: () => void): void {
    this.quitRequested = fn;
  }

  private switchRequested: (() => void) | null = null;
  private serverWatch: ReturnType<typeof setInterval> | null = null;
  private emptySince = 0;

  onSwitchRequested(fn: () => void): void {
    this.switchRequested = fn;
  }

  private watchServer(): void {
    if (this.cfg.autoServer !== true || this.serverWatch !== null) return;
    this.serverWatch = setInterval(() => void this.checkServer(), 30_000);
    this.serverWatch.unref?.();
  }

  private offlineSince = 0;

  private async checkServer(): Promise<void> {
    if (this.stopping || this.switchRequested === null) return;
    const now = Date.now();
    const here = `${this.cfg.host}:${this.cfg.port}`;

    if (this.phase !== "online") {
      if (this.offlineSince === 0) this.offlineSince = now;
      if (now - this.offlineSince < 120_000) return;
      this.offlineSince = 0;
      try {
        if (this.cfg.autoAvoidFile !== undefined) {
          const { addAvoid } = await import("./serverPick.ts");
          addAvoid(this.cfg.autoAvoidFile, here, 30 * 60_000);
        }
      } catch {

      }
      this.emit("event", t("на {addr} не пускает, ищу другой сервер", { addr: here }));
      this.switchRequested?.();
      return;
    }
    this.offlineSince = 0;
    const others = Math.max(0, (this.client?.SnapshotUnpacker?.AllObjClientInfo?.length ?? 1) - 1);
    if (others >= 2) {
      this.emptySince = 0;
      return;
    }
    if (this.emptySince === 0) this.emptySince = now;
    if (now - this.emptySince < 180_000) return;

    this.emptySince = now;
    try {
      const { fetchMaster, pickBlockServer, readAvoid } = await import("./serverPick.ts");
      const avoid = [here, ...(this.cfg.autoAvoidFile !== undefined ? readAvoid(this.cfg.autoAvoidFile) : [])];
      const pick = pickBlockServer(await fetchMaster(), { avoid, lang: getLang() });
      if (pick === null || pick.players < others + 3) return;
      this.emit("event", t("здесь почти никого, перехожу на {name} ({n} игроков)", { name: pick.name, n: pick.players }));
      this.switchRequested?.();
    } catch (err) {
      this.log(`auto server: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emit(kind: BotLine["kind"], text: string, from?: string, sys?: boolean): void {
    if (this.sink !== null) {
      this.sink(sys === true ? { kind, text, from, sys } : { kind, text, from });
      return;
    }
    if (kind === "log" && !this.cfg.verbose) return;
    console.log(kind === "chat" ? `<${from ?? "?"}> ${text}` : `[bot ${new Date().toISOString()}] ${text}`);
  }

  private log(msg: string): void {
    this.emit("log", msg);
  }

  status(): BotStatus {
    const self = this.ownId >= 0 ? this.world.getTee(this.ownId) : undefined;
    const target = this.targetId >= 0 ? this.world.getTee(this.targetId) : undefined;
    return {
      phase: this.phase,
      acting: this.acting,
      brain: this.cfg.planner === true ? "planner" : this.cfg.scripted === true ? "scripted" : "net",
      mode: this.mode,
      server: `${this.cfg.host}:${this.cfg.port}`,
      name: this.cfg.name,
      targetName: this.targetId >= 0 ? this.nameOfLive(this.targetId) : null,
      targetDist: self && target ? Math.round(vdistance(self.pos, target.pos)) : null,
      walk: this.nav === null ? null : this.nav.brief(self ?? null),
      offlineReason: this.phase === "online" ? "" : this.lastDisconnect,
      frozen: self?.frozen ?? false,
      tick: this.world.tick,
      stats: this.stats,
    };
  }

  private tryName = "off";

  private readonly baseCfg: Record<string, unknown> = {};

  private resetControllers(): void {
    this.planner?.reset();
    this.cfg.policy?.reset();
  }

  private maybeAcceptDuel(msg: TwMessage, who: string): void {
    if (this.cfg.acceptDuels === false) return;
    const text = msg.message.toLowerCase();
    const invited = /\/accept|accept|challeng|duel|дуэл|вызов|вызвал/.test(text);

    const already = /accepted|started|ended|won|lost|declin|отклон|начал|закончил/.test(text);
    if (!invited || already) return;
    const now = Date.now();
    if (now - this.lastAcceptMs < DUEL_ACCEPT_COOLDOWN_MS) return;
    this.lastAcceptMs = now;
    if (this.say("/accept")) this.emit("event", `duel invitation from ${who}: answered /accept`);
    else this.emit("event", `duel invitation from ${who}: could not answer, chat cooldown`);
  }

  private maybeAnswerAccusation(msg: TwMessage): void {
    if (this.cfg.brushOff !== true) return;
    if (!ACCUSATION.test(msg.message)) return;
    const now = Date.now();
    const last = this.lastReplyMs.get(msg.client_id) ?? 0;
    if (now - last < REPLY_COOLDOWN_MS) return;
    this.lastReplyMs.set(msg.client_id, now);
    const pool = /[а-яё]/i.test(msg.message) || !/[a-z]/i.test(msg.message) ? BRUSH_OFFS : BRUSH_OFFS_EN;
    const text = pool[Math.floor(this.wanderRng.nextFloat() * pool.length)];
    const delay = REPLY_DELAY_MS + Math.floor(this.wanderRng.nextFloat() * REPLY_JITTER_MS);
    this.emit("event", `'${this.nameOfLive(msg.client_id)}' asked; answering '${text}' in ${(delay / 1000).toFixed(1)}s`);
    const timer = setTimeout(() => {
      this.replyTimers.delete(timer);
      if (!this.stopping) this.say(text);
    }, delay);
    this.replyTimers.add(timer);
  }

  private onTickReset(newTick: number): void {

    if (this.world.tick > 0) this.log(`server game tick restarted (${this.world.tick} -> ${newTick}); clearing tick-keyed state`);
    this.lastKillTick = -Infinity;
    this.sent = [];
    this.wanderUntilTick = 0;
    this.wanderJumpUntilTick = 0;
    this.wanderHookUntilTick = 0;
    this.stuckAnchor = null;
    this.stuckAnchorTick = newTick;
    this.frozenSince = -1;
    this.planSim = null;

    this.travelSinceTick = -1000;
    this.dullSinceTick = -1;
    this.idleSinceTick = -1;
    this.lastClipTick = -Infinity;
    this.path = null;
    if (this.trek !== null) this.endTrek();
    this.frozenSinceById.clear();
    this.lastMovedById.clear();
  }

  private nameOfLive(id: number): string {

    const info = this.client?.SnapshotUnpacker?.AllObjClientInfo?.find((c) => c.id === id);
    return info?.name ?? `#${id}`;
  }

  voteOptions(): string[] {
    try {
      const list = (this.client as unknown as { VoteOptionList?: unknown } | undefined)?.VoteOptionList;
      return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && v !== "") : [];
    } catch {
      return [];
    }
  }

  handleConsole(line: string): string {
    const trimmed = line.trim();
    if (trimmed.length === 0) return "";

    if (!COMMAND_PREFIXES.includes(trimmed[0])) {
      return this.say(trimmed) ? "" : "not sent: chat cooldown, try again in a moment";
    }
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "help":
        return [
          "  type anything          say it in the game chat, as the bot",
          "",
          "  !stop / !go            stop playing and stand still / resume",
          "  !war [name|off]        fight them on sight  ·  !friend [name|off]  never touch them",
          "  !ignore [name|off]     never touch them, never answer them",
          "  !clanwar [clan|off]    the same by clan tag  ·  !clanfriend [clan|off]",
          "  !home [x y|off]        mark a spot to return to when there is nobody to fight",
          "  !clip [note]           save the last 30s to a file for review",
          "  !log on|off            show every debug line, or just the status bar",
          "  !mode <name>           fight (default) | passive (never engage) | hold",
          "  !try <name>|off        switch a candidate planner setting on mid-game",
          "  !target <nick>         fight only this player, '!target -' to clear",
          "  !brain <name>          planner | net | scripted, swapped live",
          "",
          "  !goto tele             walk to the nearest teleporter",
          "  !goto <x> <y>          walk to that tile; '!goto' alone reports progress",
          "",
          "  !stats / !where        counters / position, target and freeze state",
          "  !emote <name>          " + Object.keys(EMOTICON_BY_NAME).join(", "),
          "  !reset, !kill          kill and respawn",
          "  !yes, !no              vote on the running vote, like F3 / F4",
          "  !votes / !vote <text>  list the server's votes / call the one whose name matches",
          "  !spec / !join          go to the spectators / back into the game",
          "  !lang ru|en            the language of the console and the bot's window",
          "  !quit                  disconnect and exit",
          "",
          "  '?' works too. Neither prefix ever reaches the server.",
        ].join("\n");
      case "mode": {
        const want = arg.toLowerCase();
        if (want === "" ) return `mode: ${this.mode} (fight | passive | hold)`;
        if (want !== "fight" && want !== "passive" && want !== "hold") return "!mode fight | passive | hold";
        const gave = this.dropNav("?mode");
        this.mode = want;
        this.acting = want !== "hold";
        if (want !== "fight") this.targetId = -1;
        return `${gave}mode: ${want}`;
      }
      case "goto":
        return this.gotoCommand(arg);
      case "stop":

        if (this.nav !== null) return this.cancelNav("cancelled");
        this.mode = "hold";
        this.acting = false;
        return "stopped";
      case "go": {
        const gave = this.dropNav("?go");
        this.mode = "fight";
        this.acting = true;
        return `${gave}playing`;
      }

      case "yes":
      case "f3":
      case "no":
      case "f4": {
        const yes = cmd.toLowerCase() === "yes" || cmd.toLowerCase() === "f3";
        try {
          this.client?.game.Vote(yes);
        } catch {
          return "not connected";
        }
        return yes ? "voted yes (F3)" : "voted no (F4)";
      }
      case "votes": {
        const list = this.voteOptions();
        return list.length === 0 ? "the server offers no votes" : list.map((v, i) => `${i + 1}. ${v}`).join("\n");
      }
      case "vote": {
        const list = this.voteOptions();
        const want = arg.trim();
        if (want === "") return "!vote <name>; !votes lists them";
        const n = Number.parseInt(want, 10);
        const low = want.toLowerCase();
        const pick =
          (String(n) === want && n >= 1 && n <= list.length ? list[n - 1] : undefined) ??
          list.find((v) => v.toLowerCase() === low) ??
          list.find((v) => v.toLowerCase().includes(low));
        if (pick === undefined) return `no vote matches "${want}"; !votes lists them`;
        try {
          this.client?.game.CallVoteOption(pick, "");
        } catch {
          return "not connected";
        }
        return `called the vote: ${pick}`;
      }
      case "spec":
      case "join": {
        const spec = cmd.toLowerCase() === "spec";
        try {
          this.client?.game.SetTeam(spec ? -1 : 0);
        } catch {
          return "not connected";
        }
        return spec ? "went to the spectators" : "joined the game";
      }
      case "kill":
      case "reset": {
        if (this.world.tick - this.lastKillTick < KILL_COOLDOWN_TICKS) return "reset is on cooldown";
        this.lastKillTick = this.world.tick;
        this.stuckAnchor = null;
        this.stats.selfKills++;
        try {
          this.client?.game.Kill();
        } catch {
          return "the server refused /kill";
        }
        return "killed, respawning";
      }
      case "target":
        if (arg === "" || arg === "-") {
          this.cfg.targetName = undefined;
          return "target cleared, back to picking automatically";
        }
        this.cfg.targetName = arg;
        return `target set to '${arg}'`;
      case "brain": {
        const want = arg.toLowerCase();
        if (want === "planner") {
          if (this.planner === undefined) return "no planner in this build";
          this.cfg.planner = true;
          this.cfg.scripted = false;
        } else if (want === "net") {
          if (this.cfg.policy === undefined) return "no policy was loaded (start with --policy)";
          this.cfg.planner = false;
          this.cfg.scripted = false;
        } else if (want === "scripted") {
          this.cfg.planner = false;
          this.cfg.scripted = true;
        } else {
          return "!brain planner | net | scripted";
        }
        this.resetControllers();
        return `brain: ${want}`;
      }

      case "try": {
        const want = arg.trim().toLowerCase();
        if (want === "" || want === "?") {
          return `!try ${Object.keys(TRY_SETTINGS).join(" | ")} | off   (now: ${this.tryName})`;
        }
        if (want === "off" || want === "-") {
          this.tryName = "off";
          this.cfg.plannerCfg = { ...this.baseCfg };
          this.planner = null;
          return "try: off, back to the defaults";
        }
        const found = TRY_SETTINGS[want];
        if (found === undefined) return `!try ${Object.keys(TRY_SETTINGS).join(" | ")} | off`;
        this.tryName = want;
        this.cfg.plannerCfg = { ...this.baseCfg, ...found };

        this.planner = null;
        return `try: ${want} -> ${JSON.stringify(found)}`;
      }
      case "stats":
        return this.statsLine();
      case "lang": {
        const want = arg.trim().toLowerCase();
        if (want === "") return `lang: ${getLang()} (ru | en)`;
        if (!isLang(want)) return "!lang ru | en";
        setLang(want);
        this.saveLang(want);
        return want === "ru" ? "язык: русский" : "language: English";
      }
      case "log": {

        const want = arg.toLowerCase();
        if (want !== "on" && want !== "off") return "!log on | off";
        this.emit("event", `log lines: ${want}`);
        return `verbose logging ${want}`;
      }
      case "war":
        return this.relationCommand("war", arg, "war");
      case "friend":
        return this.relationCommand("friend", arg, "friends");
      case "ignore":
        return this.relationCommand("ignore", arg, "ignored");
      case "clanwar":
        return this.relationCommand("clanWar", arg, "clan war");
      case "clanfriend":
        return this.relationCommand("clanFriend", arg, "friendly clans");
      case "home": {
        const self = this.ownId >= 0 ? this.world.getTee(this.ownId) : undefined;
        if (arg.toLowerCase() === "off") {
          this.home = null;
          return "home cleared: it will stay wherever the fight is";
        }
        const parts = arg.split(/[\s,]+/).filter((x) => x !== "");
        if (parts.length === 2 && Number.isFinite(Number(parts[0])) && Number.isFinite(Number(parts[1]))) {
          this.home = { tx: Math.trunc(Number(parts[0])), ty: Math.trunc(Number(parts[1])) };
        } else if (parts.length === 0) {
          if (self === undefined) return "no tee yet -- stand somewhere first, or !home <x> <y>";
          this.home = { tx: Math.trunc(self.pos.x / 32), ty: Math.trunc(self.pos.y / 32) };
        } else {
          return "!home            mark where you are standing\n!home <x> <y>    mark a tile\n!home off        forget it";
        }
        return `home set to tile (${this.home.tx},${this.home.ty}); it walks back there after ${GO_HOME_AFTER_TICKS / 50}s with nobody to fight`;
      }
      case "clip": {

        if (this.ownId < 0) return "no tee yet";
        const rec = this.clipRing.toRecording({ map: this.mapName(), controller: this.brainName(), selfId: this.ownId, label: arg === "" ? undefined : arg });
        if (rec === null) return "nothing recorded yet";
        const file = this.writeClip(rec, `manual-${this.world.tick}${arg === "" ? "" : `-${arg}`}`);
        return file === null ? "could not write the clip" : `saved ${(rec.frames.length / 25).toFixed(0)}s to ${file}`;
      }
      case "where": {
        const st = this.status();
        const self = this.ownId >= 0 ? this.world.getTee(this.ownId) : undefined;
        const at = self === undefined ? "" : `tile (${Math.trunc(self.pos.x / 32)},${Math.trunc(self.pos.y / 32)}), `;
        const walk = this.nav === null ? "" : `, goto: ${this.nav.progress(self ?? null)}`;
        return `${st.phase}, ${at}${st.acting ? "playing" : "stopped"}, ${st.frozen ? "frozen" : "free"}, target ${st.targetName ?? "none"}${st.targetDist === null ? "" : ` at ${st.targetDist}px`}, tick ${st.tick}${walk}`;
      }
      case "emote": {
        const id = EMOTICON_BY_NAME[arg.toLowerCase()];
        if (id === undefined) return `unknown emote; try ${Object.keys(EMOTICON_BY_NAME).join(", ")}`;
        this.lastEmoteMs = 0;
        this.emote(id);
        return "";
      }
      case "quit":

        if (this.quitRequested !== null) this.quitRequested();
        else void this.stop();
        return "disconnecting";
      default:
        return `unknown command '${cmd}' -- try !help`;
    }
  }

  private gotoCommand(arg: string, navOpts: { throughFreeze?: boolean } = {}): string {
    const text = arg.trim();
    const word = text.toLowerCase();
    if (word === "stop" || word === "-" || word === "off") {
      const wasQueued = this.pendingGoto !== null;
      this.pendingGoto = null;
      if (this.nav === null) return wasQueued ? "queued walk dropped" : "not going anywhere";
      return this.cancelNav("cancelled");
    }
    const col = this.world.collision;
    const self = this.ownId >= 0 ? this.world.getTee(this.ownId) : undefined;

    if (text !== "" && (!this.collisionReady || self === undefined || !self.alive)) {
      this.pendingGoto = text;
      const why = !this.collisionReady ? "the map is still loading" : "the tee has not spawned";
      return `queued: ${why}, starting as soon as it is ready`;
    }
    if (!this.collisionReady) return "no map yet: without a collision grid there is nowhere to walk to";

    if (text === "") {
      if (this.nav !== null) return this.nav.progress(self ?? null);
      if (self === undefined || !self.alive) return "nothing set, and the tee is not alive yet";
      if (!col.hasTele()) return `nothing set. This map has no teleport layer, so '?goto <x> <y>' (tiles, 0..${col.width - 1} by 0..${col.height - 1}) is the only form`;
      const goals = teleGoals(col, self.pos.x, self.pos.y);
      if (goals.length === 0) return "nothing set, and no teleporter on this map can be reached from here by walking";
      return `nothing set. '?goto tele' would walk to the ${goals[0].label}`;
    }

    if (self === undefined || !self.alive) return "the tee is not alive; try again once it has spawned";

    if (word === "tele" || word === "teleport" || word === "tp") {
      if (!col.hasTele()) return "this map has no teleport layer";
      const goals = teleGoals(col, self.pos.x, self.pos.y);
      if (goals.length === 0) return "no teleporter on this map can be reached from here by walking";
      return this.startNav(goals, navOpts);
    }

    const parts = text.split(/[\s,]+/);
    const tx = parts.length === 2 ? Number.parseInt(parts[0], 10) : Number.NaN;
    const ty = parts.length === 2 ? Number.parseInt(parts[1], 10) : Number.NaN;
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
      return "?goto tele | ?goto <x> <y> in tiles | ?goto for progress | ?stop to call it off";
    }
    if (tx < 0 || ty < 0 || tx >= col.width || ty >= col.height) {
      return `(${tx},${ty}) is off the map -- it is ${col.width}x${col.height} tiles`;
    }

    const px = tx * 32 + 16;
    const py = ty * 32 + 16;
    if (col.isSolid(px, py)) return `(${tx},${ty}) is a wall`;
    if (col.isDeath(px, py)) return `(${tx},${ty}) is a death tile`;
    if (col.isFreeze(px, py)) return `(${tx},${ty}) is freeze -- walking into it on purpose is not a plan`;
    return this.startNav([tileGoal(col, tx, ty)], navOpts);
  }

  private startNav(goals: NavGoal[], navOpts: { throughFreeze?: boolean } = {}): string {
    if (this.nav !== null) this.emit("event", "goto: replaced by a new destination");

    if (this.mode !== "goto") this.navReturnMode = this.mode;
    this.nav = new Navigator(this.world.collision, goals, navOpts);
    this.mode = "goto";
    this.acting = true;
    this.targetId = -1;
    const rest = goals.length > 1 ? `, then ${goals.length - 1} more candidate${goals.length > 2 ? "s" : ""} if it is not a doorway` : "";
    return `goto: ${goals[0].label}${rest}`;
  }

  private endNav(): void {
    this.nav = null;
    this.mode = this.navReturnMode;
    this.acting = this.mode !== "hold";
    if (this.mode !== "fight") this.targetId = -1;
  }

  private cancelNav(why: string): string {
    this.nav?.cancel(why);
    const back = this.navReturnMode;
    this.endNav();
    return `goto: ${why}, back to ${back}`;
  }

  private dropNav(by: string): string {
    if (this.nav === null) return "";
    this.nav.cancel(`dropped by ${by}`);
    this.nav = null;
    return `goto: dropped by ${by}. `;
  }

  private driveNav(client: TwClient, self: TeeState): void {
    const nav = this.nav;
    if (nav === null) return;

    if (this.world.collision !== nav.collision) {
      this.emit("event", "goto: the map changed under it, giving up");
      this.endNav();
      this.idle();
      return;
    }
    const input = this.guard(self, nav.step(self, this.world.tick));
    for (const note of nav.takeNotes()) this.emit("event", `goto: ${note}`);
    this.applyInput(client, input, self.activeWeapon);
    if (nav.done) {
      const back = this.navReturnMode;
      this.endNav();
      this.emit("event", `goto: ${back === "hold" ? "standing by" : `back to ${back}`}`);
    }
  }

  private connect(): void {
    const client = this.client;
    if (!client || this.stopping) return;
    if (client.State !== teeworlds.Protocol.States.STATE_OFFLINE) return;
    this.phase = "connecting";
    this.log(`connecting to ${this.cfg.host}:${this.cfg.port} as '${this.cfg.name}'`);
    client.connect().catch((err: unknown) => {
      this.stats.errors++;
      this.emit("event", `could not connect to ${this.cfg.host}:${this.cfg.port}: ${String(err)}`);
      this.onDisconnect(`connect failed: ${String(err)}`, false);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    this.log(`reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private onConnected(): void {
    const client = this.client;
    if (!client) return;
    this.phase = "online";
    this.reconnectDelayMs = RECONNECT_MIN_MS;
    this.ownId = -1;
    this.targetId = -1;
    this.lastPos = null;
    this.wasAlive = false;
    this.navPending = this.cfg.goto !== undefined && this.cfg.goto.trim().length > 0;
    client.movement.FlagPlaying(true);
    client.movement.SetAim(0, -1);
    this.idle();

    client.game.Say("/showall 1");
    this.log(`connected (map '${client.map?.map_name ?? "?"}')`);
    if (!this.collisionReady) this.refreshCollision();
    const waiter = this.startWaiter;
    this.startWaiter = undefined;
    waiter?.resolve();
  }

  private onDisconnect(reason: string, fromServer: boolean): void {

    for (const t of this.replyTimers) clearTimeout(t);
    this.replyTimers.clear();
    this.lastReplyMs.clear();
    this.lastSeenDist.clear();
    this.planSim = null;

    if (fromServer && this.cfg.autoServer === true && /\bban/i.test(reason) && this.switchRequested !== null && !this.stopping) {
      const here = `${this.cfg.host}:${this.cfg.port}`;
      void import("./serverPick.ts")
        .then(({ addAvoid }) => {
          if (this.cfg.autoAvoidFile !== undefined) addAvoid(this.cfg.autoAvoidFile, here, 60 * 60_000);
        })
        .catch(() => {})
        .finally(() => {
          this.emit("event", t("на {addr} не пускает, ищу другой сервер", { addr: here }));
          this.switchRequested?.();
        });
    }

    if (this.phase === "offline") return;
    this.phase = "offline";
    this.lastPos = null;

    this.emit("event", `disconnected${fromServer ? " BY THE SERVER" : ""}: ${reason || "(no reason given)"}`);
    this.lastDisconnect = reason || (fromServer ? "kicked, no reason given" : "connection lost");
    if (this.stopping) return;
    this.stats.disconnects++;
    if (this.cfg.reconnect === false) {
      const waiter = this.startWaiter;
      this.startWaiter = undefined;
      waiter?.reject(new Error(`connection to ${this.cfg.host}:${this.cfg.port} lost: ${reason}`));
      return;
    }
    this.scheduleReconnect();
  }

  private onKill(kill: TwKill): void {
    if (this.ownId < 0) return;
    if (kill.victim_id === this.ownId) {
      this.stats.deaths++;
      this.emote(kill.killer_id === this.ownId ? EMOTICON_ZZZ : EMOTICON_SORRY);
    } else if (kill.killer_id === this.ownId) {
      this.stats.kills++;
      this.emote(EMOTICON_SPLATTEE);
    } else if (kill.victim_id === this.targetId) {

      this.emote(EMOTICON_QUESTION);
    }
  }

  private emote(emoticon: number): void {
    if (this.cfg.emotes === false) return;
    const now = Date.now();
    if (now - this.lastEmoteMs < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteMs = now;
    try {
      this.client?.game.Emote(emoticon);
    } catch {

    }
  }

  private onMessage(msg: TwMessage): void {

    if (msg.client_id < 0) {
      this.emit("chat", msg.message, t("сервер"), true);
      return;
    }
    if (msg.client_id === this.ownId) {
      this.emit("chat", msg.message, this.cfg.name);
      return;
    }
    const who = this.nameOfLive(msg.client_id);
    const whisper = msg.team === CHAT_WHISPER_RECV;

    const mentioned = msg.message.toLowerCase().includes(this.cfg.name.toLowerCase());
    if (whisper) this.emit("whisper", msg.message, who);
    else this.emit("chat", `${msg.team === CHAT_TEAM ? "(team) " : ""}${mentioned ? "*" : ""}${msg.message}`, who);

    if (listed(this.relations.ignore, who.trim().toLowerCase())) return;
    if (whisper) this.maybeAcceptDuel(msg, who);
    this.maybeAnswerAccusation(msg);
    if (!this.cfg.chat) return;
    const text = msg.message.trim().toLowerCase();
    const me = this.cfg.name;
    if (text === "!bot") {
      this.say(`${me}: DDNet AI bot (${this.cfg.scripted ? "scripted baseline" : "neural policy"}); commands: !bot !stop !go !stats !reset !hi`);
      this.emote(EMOTICON_HEARTS);
    } else if (text === "!stop") {
      this.acting = false;
      this.say(`${me}: stopped (say !go to resume)`);
    } else if (text === "!go") {
      this.acting = true;
      this.say(`${me}: resumed`);
    } else if (text === "!stats") {
      this.say(`${me}: ${this.statsLine()}`);
    } else if (text.startsWith("!try")) {

      this.say(`${me}: ${this.handleConsole(text).split("\n")[0]}`);
    } else if (text === "!hi" || text === "!hello" || text === "!привет") {

      this.lastEmoteMs = 0;
      this.emote(EMOTICON_HEARTS);
      this.say(`${me}: hi`);
    } else if (text === "!reset") {

      if (this.world.tick - this.lastKillTick < KILL_COOLDOWN_TICKS) {
        this.say(`${me}: reset is on cooldown`);
        return;
      }
      this.lastKillTick = this.world.tick;
      this.stuckAnchor = null;
      this.stats.selfKills++;
      this.say(`${me}: resetting (kill + respawn)`);
      try {
        this.client?.game.Kill();
      } catch {

      }
    }
  }

  private say(text: string): boolean {
    const now = Date.now();
    if (now - this.lastChatMs < CHAT_MIN_INTERVAL_MS) return false;
    if (this.client === undefined || this.client === null) return false;
    this.lastChatMs = now;
    this.client.game.Say(text);
    return true;
  }

  private refreshCollision(): void {
    const client = this.client;
    if (!client) return;
    const now = Date.now();
    if (now - this.lastCollisionTryMs < COLLISION_RETRY_MS) return;
    this.lastCollisionTryMs = now;
    const collision = mapCollisionFromClient(client, this.cfg.mapDir);
    if (!collision) {
      this.log(
        `no collision grid for map '${client.map?.map_name ?? "?"}' (downloaded ${client.map?.mapBuffer?.length ?? 0} bytes, fallback ${this.cfg.mapDir}); idling`,
      );
      return;
    }
    this.world.setCollision(collision);
    this.collisionReady = true;

    this.clipRing.clear();
    this.clipMapSet = false;

    const spawns = spawnTiles(collision);
    this.deadCells = spawns.length === 0 ? null : { width: collision.width, cells: deadZone(collision, spawns) };
    let deadCount = 0;
    if (this.deadCells !== null) for (const v of this.deadCells.cells) deadCount += v;
    this.planner?.setDeadZone(this.deadCells);
    this.memory = FreezeMemory.load(this.memoryFile(), collision.width, collision.height);
    this.planner?.setFreezeMemory(this.memory);
    this.log(
      `collision grid ready: ${collision.width}x${collision.height} tiles` +
        (this.deadCells === null ? "" : `, ${deadCount} of them no way back from (${spawns.length} spawns)`),
    );
  }

  private onSnapshot(): void {
    const client = this.client;
    if (!client) return;
    try {
      this.stats.ticks++;
      if (!this.collisionReady) this.refreshCollision();

      const snap = client.SnapshotUnpacker;
      const ownId = snap.OwnID;
      if (ownId === undefined) {
        this.idle();
        return;
      }
      this.ownId = ownId;
      const tick = typeof client.currentSnapshotGameTick === "number" ? client.currentSnapshotGameTick : undefined;
      if (tick !== undefined && tick < this.world.tick) this.onTickReset(tick);
      this.world.updateFromSnapshot(snap, ownId, tick);

      const self = this.world.getTee(ownId);
      if (!self || !self.alive) {

        this.lastPos = null;
        this.wasAlive = false;

        this.wasFrozen = false;
        this.maybeJoinGame(snap, ownId);
        this.idle();
        return;
      }
      if (!this.wasAlive) {

        this.wasAlive = true;
        this.cfg.policy?.reset();
        this.prevInput = emptyInput();

        if (this.pendingGoto !== null && this.collisionReady) {
          const want = this.pendingGoto;
          this.pendingGoto = null;
          this.emit("event", `starting the queued walk: ${this.gotoCommand(want)}`);
        }

        this.nav?.respawned();
      }
      this.trackTravel(self.pos);

      if (this.memory !== null && self.alive && !self.frozen) {
        const tile = Math.trunc(self.pos.y / 32) * this.world.collision.width + Math.trunc(self.pos.x / 32);
        if (tile !== this.lastTileIndex) {
          this.lastTileIndex = tile;
          this.memory.notePass(self.pos.x, self.pos.y);
        }
      }
      this.measureEcho(self);
      this.recordFrame(self);
      this.maybeLogStatus(self);
      this.maybeUnstick(client, self);

      if (self.frozen !== this.wasFrozen) {
        this.emote(self.frozen ? EMOTICON_DROP : EMOTICON_EXCLAMATION);

        if (self.frozen && this.memory !== null) {
          this.memory.note(self.pos.x, self.pos.y);
          if (this.memory.noted % 20 === 0) this.memory.save(this.memoryFile());
        }
        this.wasFrozen = self.frozen;
      }

      if (!this.collisionReady || !this.acting) {
        this.idle();
        return;
      }

      if (this.navPending && this.nav === null) {
        this.navPending = false;
        const reply = this.gotoCommand(this.cfg.goto ?? "");
        this.emit("event", `--goto ${this.cfg.goto}: ${reply}`);
      }

      if (this.trek !== null && this.someoneWorthFighting(ownId, self.pos, SEEK_ARRIVED_PX)) {
        this.endTrek();
        this.log("found a game on the way; stopping the walk");
      }
      if (this.nav !== null) {
        if (this.seekingGame && this.someoneWorthFighting(ownId, self.pos, SEEK_ARRIVED_PX)) {
          this.seekingGame = false;
          this.endNav();
          this.log("found a game on the way; stopping the walk");
        } else {
          this.driveNav(client, self);
          return;
        }
      }

      const targetId = this.mode === "fight" ? this.pickTarget(snap, ownId, self.pos) : -1;
      if (targetId !== this.targetId) {
        this.targetId = targetId;

        if (targetId === -1) this.log("no target in reach");
      }

      if (
        this.mode === "fight" &&
        this.seekEnabled() &&
        this.nav === null &&
        this.world.tick - this.travelSinceTick > TRAVEL_RETRY_TICKS &&
        !this.engagedNow(ownId, self)
      ) {
        const here = this.crowdAt(ownId, self.pos);
        const spot = this.busiestSpot(ownId, self.pos);
        if (spot !== null && spot.tees + spot.busy >= here.tees + here.busy + SEEK_MARGIN) {
          if (this.dullSinceTick < 0) this.dullSinceTick = this.world.tick;
          if (this.world.tick - this.dullSinceTick > SEEK_PATIENCE_TICKS) {
            this.travelSinceTick = this.world.tick;
            this.dullSinceTick = -1;
            const tx = Math.trunc(spot.x / 32);
            const ty = Math.trunc(spot.y / 32);
            const reply = this.startTrek(self.pos, spot);
            this.log(
              `here: ${here.tees} tees, ${here.busy} fighting; there: ${spot.tees}/${spot.busy} at (${tx},${ty}), ${Math.round(spot.dist)}px -- ${reply}`,
            );

          }
        } else this.dullSinceTick = -1;
      }

      if (targetId === -1) {

        if (this.idleSinceTick < 0) this.idleSinceTick = this.world.tick;
        if (this.nav === null && this.world.tick - this.travelSinceTick > TRAVEL_RETRY_TICKS) {
          const spot = this.busiestSpot(ownId, self.pos);
          if (spot !== null) {
            this.travelSinceTick = this.world.tick;
            const tx = Math.trunc(spot.x / 32);
            const ty = Math.trunc(spot.y / 32);

            const way = findRoute(this.world.collision, self.pos, spot, { nearTiles: 3, partial: false, allowKill: true, throughFreeze: false, maxNodes: REACH_MAX_NODES });
            if (way === null) {
              this.log(`nobody in reach; the game is at (${tx},${ty}) but there is no way there without freeze -- staying`);
            } else {
              const reply = this.gotoCommand(`${tx} ${ty}`, { throughFreeze: false });
              this.log(`nobody in reach; walking to where the game is: (${tx},${ty}), ${Math.round(spot.dist)}px, ${spot.tees} tees, ${spot.busy} of them fighting -- ${reply}`);
            }
          }
        }
        if (this.home !== null && this.nav === null && this.world.tick - this.idleSinceTick > GO_HOME_AFTER_TICKS) {
          const here = { tx: Math.trunc(self.pos.x / 32), ty: Math.trunc(self.pos.y / 32) };
          if (Math.abs(here.tx - this.home.tx) > 2 || Math.abs(here.ty - this.home.ty) > 2) {
            const reply = this.gotoCommand(`${this.home.tx} ${this.home.ty}`);
            this.emit("event", `nobody to fight: walking home to (${this.home.tx},${this.home.ty}) -- ${reply}`);
          }
          this.idleSinceTick = this.world.tick;
        }
        this.wander(client, self);
        return;
      }
      this.idleSinceTick = -1;

      let input: PlayerInput;
      if (this.cfg.planner) {
        input = this.planAction(ownId, targetId, self);
        this.applyInput(client, input, self.activeWeapon);
        return;
      }
      encodeObs(this.world, ownId, targetId, this.obs);
      if (this.cfg.scripted || !this.cfg.policy) {
        input = scriptedAction(this.world, ownId, targetId, this.prevInput, this.rng);
      } else {
        this.raw.set(this.cfg.policy.act(this.obs));
        input = decodeAction(this.raw, this.prevInput, undefined, !isGrounded(this.world, self));
      }

      input = this.guard(self, input);
      this.applyInput(client, input, self.activeWeapon);
    } catch (err) {
      this.stats.errors++;
      this.log(`snapshot error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }

  private maybeJoinGame(snap: TwSnapshotUnpacker, ownId: number): void {
    const info = snap.getObjPlayerInfo(ownId);
    if (!info || info.team !== -1) return;
    const now = Date.now();
    if (now - this.lastJoinMs < JOIN_RETRY_MS) return;
    this.lastJoinMs = now;
    this.log("in spectators, joining the game");
    this.client?.game.SetTeam(0);

    this.sendIdentity();
  }

  private sendIdentity(): void {
    const game = this.client?.game;
    if (game === undefined || typeof game.ChangePlayerInfo !== "function") return;
    try {
      game.ChangePlayerInfo({
        name: this.cfg.name,
        clan: this.cfg.clan ?? "",
        country: this.cfg.country ?? -1,
        skin: this.cfg.skin ?? "default",
        use_custom_color: this.cfg.colorBody !== undefined || this.cfg.colorFeet !== undefined,
        color_body: this.cfg.colorBody ?? 0,
        color_feet: this.cfg.colorFeet ?? 0,
      });
    } catch {

    }
  }

  liveMap(): LiveMap | null {
    if (!this.collisionReady) return null;
    const c = this.world.collision;
    const kinds = new Uint8Array(c.width * c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const px = x * 32 + 16;
        const py = y * 32 + 16;

        kinds[y * c.width + x] = c.isSolid(px, py)
          ? c.isNoHook(px, py)
            ? 5
            : 1
          : c.isFreeze(px, py)
            ? 2
            : c.isDeath(px, py)
              ? 3
              : c.isUnFreeze(px, py)
                ? 4
                : c.teleAt(px, py).type > 0
                  ? 6
                  : 0;
      }
    }
    return {
      name: this.mapName(),
      width: c.width,
      height: c.height,
      kinds: Buffer.from(kinds).toString("base64"),
      traps: this.deadCells === null ? undefined : Buffer.from(this.deadCells.cells).toString("base64"),
    };
  }

  liveFrame(): LiveFrame | null {
    if (!this.collisionReady || this.ownId < 0) return null;
    const tees: LiveTee[] = [];

    const snap = this.client?.SnapshotUnpacker;
    const cards = new Map((snap?.AllObjClientInfo ?? []).map((c) => [c.id, c]));
    const chars = new Map((snap?.AllObjCharacter ?? []).map((c) => [c.client_id, c]));
    for (const t of this.world.allTees()) {
      if (!t.alive) continue;
      const card = cards.get(t.id);
      const ch = chars.get(t.id);
      const ex = snap?.getObjExDDNetCharacter(t.id);
      tees.push({
        id: t.id,
        name: this.nameOfLive(t.id),
        x: Math.round(t.pos.x),
        y: Math.round(t.pos.y),
        frozen: t.frozen,
        hook: t.hookState,
        hx: Math.round(t.hookPos.x),
        hy: Math.round(t.hookPos.y),
        hooked: t.hookedPlayer,
        clan: card?.clan ?? "",
        skin: card?.skin ?? "default",
        cc: (card?.use_custom_color ?? 0) !== 0,
        cb: card?.color_body ?? 0,
        cf: card?.color_feet ?? 0,
        aim: Math.round(wireAngleRad(t.angle) * 100) / 100,
        wp: t.activeWeapon,
        emote: ch?.emote ?? 0,
        vx: Math.round(t.vel.x * 1000) / 1000,
        vy: Math.round(t.vel.y * 1000) / 1000,
        dir: t.direction,
        jumped: t.jumped,
        atk: Math.max(0, this.world.tick - t.attackTick),
        fz: t.freezeTicksLeft,
        pf: ch?.player_flags ?? 0,
        jl: t.jumpsLeft,
        fzf: t.frozenFor,
        deep: t.deepFrozen === true,
        xf: ex?.m_Flags,
        jt: ex?.m_Jumps,
      });
    }
    const players: LivePlayer[] = [];
    for (const c of cards.values()) {
      const p = snap?.getObjPlayerInfo(c.id);
      players.push({
        id: c.id,
        name: c.name,
        clan: c.clan,
        score: p?.score ?? 0,
        ping: p?.latency ?? 0,
        team: p?.team ?? 0,
        skin: c.skin ?? "default",
        cc: (c.use_custom_color ?? 0) !== 0,
        cb: c.color_body ?? 0,
        cf: c.color_feet ?? 0,
      });
    }
    const gameInfo = (snap as { AllObjGameInfo?: { round_start_tick?: number }[] } | undefined)?.AllObjGameInfo?.[0];
    const goal = this.planner?.travelGoal ?? null;
    const steps = this.trek !== null ? this.trek.steps.slice(this.trek.at) : (this.path?.steps ?? []);
    const self = this.world.getTee(this.ownId);
    const doing =
      self === undefined || !self.alive
        ? t("мёртв")
        : self.frozen
          ? this.inDeadZone(self.pos)
            ? t("во фризе в кармане без выхода")
            : t("во фризе")
          : this.trek !== null
            ? t("идёт туда, где игра ({n} шагов)", { n: this.trek.steps.length - this.trek.at })
            : this.targetId >= 0
              ? goal !== null
                ? t("идёт к цели в обход ({n} тайлов до точки)", { n: Math.round(vdistance(self.pos, goal) / 32) })
                : t("дерётся")
              : t("цели нет");
    return {
      tick: this.world.tick,
      selfId: this.ownId,
      target: this.targetId,
      map: this.mapName(),
      tees,
      doing,
      goal: goal === null ? null : { x: Math.round(goal.x), y: Math.round(goal.y) },
      route: steps.slice(0, 40).map((s) => ({ x: s.x, y: s.y, kind: s.kind })),
      cursor: cursorOf(this.prevInput),
      players,
      roundStart: typeof gameInfo?.round_start_tick === "number" ? gameInfo.round_start_tick : undefined,
    };
  }

  private nameOf(snap: TwSnapshotUnpacker, id: number): string {
    return snap.AllObjClientInfo.find((c) => c.id === id)?.name ?? "?";
  }

  private nearFreeze(pos: Vec2): boolean {
    const c = this.world.collision;
    for (let oy = -SEAL_NEAR_TILES; oy <= SEAL_NEAR_TILES; oy++) {
      for (let ox = -SEAL_NEAR_TILES; ox <= SEAL_NEAR_TILES; ox++) {
        if (c.isFreeze(pos.x + ox * 32, pos.y + oy * 32)) return true;
      }
    }
    return false;
  }

  private guard(self: TeeState, input: PlayerInput): PlayerInput {
    if (self.frozen || !self.alive || !this.collisionReady) return input;
    if (this.shieldSim === null || this.shieldSim.collision !== this.world.collision) {
      this.shieldSim = new SimWorld(this.world.collision, { svHit: true, respawnDelayTicks: 0, infiniteAmmo: true });
    }
    const sim = this.shieldSim;
    try {
      for (const other of sim.allTees()) if (other.id !== self.id) sim.removeTee(other.id);
      if (sim.getTee(self.id) === undefined) sim.addTee(self.id, self.pos);
      sim.applyTeeState(self.id, self);
      for (let t = 0; t < this.lagTicks(); t++) {
        sim.setInput(self.id, this.prevInput);
        sim.step();
      }
      if (escapeExists(sim, self.id, input, 2)) return input;
      return saferInput(sim, self.id, input, 2) ?? input;
    } catch {
      return input;
    }
  }

  private isFriendId(id: number): boolean {
    const card = this.client?.SnapshotUnpacker?.AllObjClientInfo?.find((c) => c.id === id);
    if (card === undefined) return false;
    return listed(this.relations.friend, (card.name ?? "").trim().toLowerCase()) || listed(this.relations.clanFriend, (card.clan ?? "").trim().toLowerCase());
  }

  private reachable(from: Vec2, tee: TeeState): boolean {
    const w = this.world.collision.width;
    const a = Math.trunc(from.y / 32) * w + Math.trunc(from.x / 32);
    const b = Math.trunc(tee.pos.y / 32) * w + Math.trunc(tee.pos.x / 32);
    const seen = this.reachAnswers.get(tee.id);
    if (seen !== undefined && seen.from === a && seen.to === b && this.world.tick - seen.tick < REACH_ANSWER_TICKS && this.world.tick >= seen.tick) return seen.ok;
    let ok = true;
    try {
      ok = findRoute(this.world.collision, from, tee.pos, { nearTiles: 3, partial: false, maxNodes: REACH_MAX_NODES, throughFreeze: false }) !== null;
    } catch {
      ok = true;
    }
    this.reachAnswers.set(tee.id, { tick: this.world.tick, from: a, to: b, ok });
    if (this.reachAnswers.size > 64) this.reachAnswers.clear();
    return ok;
  }

  private isSealed(tee: TeeState): boolean {
    const seen = this.sealAnswers.get(tee.id);
    if (seen !== undefined && this.world.tick - seen.tick < SEAL_ANSWER_TICKS && this.world.tick >= seen.tick) return seen.sealed;
    if (this.sealSim === null || this.sealSim.collision !== this.world.collision) {
      this.sealSim = new SimWorld(this.world.collision, { svHit: true, respawnDelayTicks: 0, infiniteAmmo: true });
    }
    let sealed = false;
    try {
      sealed = sealedIn(this.sealSim, tee.id, tee, enemyInputFromSnapshot(tee));
    } catch {
      sealed = false;
    }
    this.sealAnswers.set(tee.id, { tick: this.world.tick, sealed });
    if (this.sealAnswers.size > 64) this.sealAnswers.clear();
    return sealed;
  }

  private pickTarget(snap: TwSnapshotUnpacker, ownId: number, selfPos: Vec2): number {
    if (this.cfg.targetName !== undefined) {
      const info = snap.AllObjClientInfo.find((c) => c.name === this.cfg.targetName);
      if (!info || info.id === ownId) return -1;
      const tee = this.world.getTee(info.id);
      return tee && tee.alive ? info.id : -1;
    }

    const me = this.world.getTee(ownId);
    let best = -1;
    let bestScore = -Infinity;

    for (const tee of this.world.allTees()) {
      if (!tee.alive || !tee.frozen) this.frozenSinceById.delete(tee.id);
      else if (!this.frozenSinceById.has(tee.id)) this.frozenSinceById.set(tee.id, this.world.tick);
      const seen = this.lastMovedById.get(tee.id);
      if (!tee.alive) this.lastMovedById.delete(tee.id);
      else if (seen === undefined || vdistance(seen, tee.pos) > AFK_RADIUS_PX) {
        this.lastMovedById.set(tee.id, { x: tee.pos.x, y: tee.pos.y, tick: this.world.tick });
      }
    }
    const info = new Map(snap.AllObjClientInfo.map((c) => [c.id, c]));
    let keepSettled = false;
    for (const tee of this.world.allTees()) {
      if (tee.id === ownId || !tee.alive) continue;
      const card = info.get(tee.id);
      const nameKey = (card?.name ?? "").trim().toLowerCase();
      const clanKey = (card?.clan ?? "").trim().toLowerCase();

      if (listed(this.relations.friend, nameKey) || listed(this.relations.ignore, nameKey)) continue;
      if (listed(this.relations.clanFriend, clanKey)) continue;
      const atWar = listed(this.relations.war, nameKey) || listed(this.relations.clanWar, clanKey);

      const moved = this.lastMovedById.get(tee.id);
      if (!atWar && !tee.frozen && moved !== undefined && this.world.tick - moved.tick > AFK_TICKS) continue;
      const d = vdistance(selfPos, tee.pos);
      if (d > TARGET_MAX_PX) continue;

      if (this.trapCare() && this.inDeadZone(tee.pos) && !this.inDeadZone(selfPos)) continue;

      const frozenFor = tee.frozen ? this.world.tick - (this.frozenSinceById.get(tee.id) ?? this.world.tick) : 0;

      const sealed = (tee.frozen || (tee.id === this.targetId && this.nearFreeze(tee.pos))) && this.isSealed(tee);

      const finishing = tee.id === this.targetId && tee.frozen && !sealed && frozenFor <= FINISH_BLOCK_TICKS && this.nearFreeze(tee.pos);
      const settled =
        sealed || (!finishing && frozenFor > (this.cfg.plannerCfg?.settledFreezeTicks ?? PLANNER_DEFAULTS.settledFreezeTicks));

      if (settled) {
        if (tee.id === this.targetId) keepSettled = true;
        continue;
      }

      const outOfReach = d >= PATH_NEAR_PX && !atWar && tee.hookedPlayer !== ownId && me?.hookedPlayer !== tee.id && !this.reachable(selfPos, tee);
      let score = 0;
      if (atWar) score += 900;
      if (tee.hookedPlayer === ownId) score += 1000;
      if (me?.hookedPlayer === tee.id) score += 800;

      if (tee.id === this.targetId && tee.frozen && d < BLOCKING_RANGE_PX) score += this.cfg.plannerCfg?.blockHoldScore ?? PLANNER_DEFAULTS.blockHoldScore;
      if (finishing && d < BLOCKING_RANGE_PX) score += FINISH_BLOCK_SCORE;
      if (this.world.tick - tee.attackTick < AGGRESSOR_MEMORY_TICKS && d < AGGRESSOR_RANGE_PX) score += 500;
      const prev = this.lastSeenDist.get(tee.id);
      if (prev !== undefined && d < prev - 1) score += 200;

      if (tee.id === this.targetId) {
        const hold = this.cfg.plannerCfg?.targetHold ?? TARGET_HOLD_SCORE;
        score += d <= ENGAGED_PX ? hold : hold * Math.max(0, 1 - (d - ENGAGED_PX) / HOLD_FADE_PX);
      }
      score -= d * TARGET_DIST_WEIGHT;
      if (outOfReach) score -= OUT_OF_REACH_SCORE;
      this.lastSeenDist.set(tee.id, d);
      if (score > bestScore) {
        bestScore = score;
        best = tee.id;
      }
    }

    if (best === -1 && keepSettled) return this.targetId;
    return best;
  }

  private lastPlan: RecFrame["plan"] = undefined;

  private readonly aimLog: { tick: number; x: number; y: number }[] = [];
  private readonly echoMiss = new Float64Array(ECHO_MAX_TICKS + 1);
  private readonly echoSeen = new Float64Array(ECHO_MAX_TICKS + 1);
  private echoSamples = 0;
  private snapshotGap = 2;
  private lastSnapTick = -1;

  private recordFrame(self: TeeState): void {
    if (!this.clipMapSet && this.collisionReady) {
      this.clipRing.setMap(this.world.collision);
      this.clipMapSet = true;
    }
    if (!this.clipMapSet) return;

    const near = this.world
      .allTees()
      .filter((t) => t.id !== self.id && t.alive)
      .sort((a, b) => vdistance(a.pos, self.pos) - vdistance(b.pos, self.pos))
      .slice(0, 3);
    this.clipRing.push({
      tick: this.world.tick,
      tees: [snapTee(self), ...near.map(snapTee)],

      inputs: [snapInput(self.id, this.prevInput)],
      events: [],
      plan: this.lastPlan,
    });

    this.lastPlan = undefined;
    if (++this.framesSinceScan >= CLIP_SCAN_EVERY_FRAMES) {
      this.framesSinceScan = 0;
      this.maybeClip(self.id);
    }
  }

  private maybeClip(selfId: number): void {
    if (this.world.tick - this.lastClipTick < CLIP_COOLDOWN_TICKS) return;
    const rec = this.clipRing.toRecording({ map: this.mapName(), controller: this.brainName(), selfId });
    if (rec === null || rec.frames.length < 50) return;
    const worst = mergeOverlapping(findIncidents(rec, { selfId }))
      .filter((i) => i.severity >= (CLIP_SEVERITY_BY_KIND[i.kind] ?? CLIP_SEVERITY))

      .filter((i) => i.tick >= rec.frames[Math.floor(rec.frames.length / 2)].tick)
      .sort((a, b) => b.severity - a.severity)[0];
    if (worst === undefined) return;
    this.lastClipTick = this.world.tick;
    const file = this.writeClip(rec, `${worst.kind}-${worst.tick}-s${Math.round(worst.severity)}`);
    if (file !== null) this.emit("event", `clip saved: ${worst.kind} (${worst.note}) -> ${file}`);
  }

  private writeClip(rec: Recording, name: string): string | null {
    try {
      const dir = this.cfg.clipDir ?? DEFAULT_CLIP_DIR;
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
      const cards = this.client?.SnapshotUnpacker?.AllObjClientInfo ?? [];
      rec.players = cards.map((c) => ({
        id: c.id,
        name: c.name ?? "",
        clan: c.clan ?? "",
        skin: c.skin ?? "default",
        cc: (c.use_custom_color ?? 0) !== 0,
        cb: c.color_body ?? 0,
        cf: c.color_feet ?? 0,
      }));
      writeFileSync(file, JSON.stringify(rec));
      this.stats.clips++;
      this.pruneClips(dir);
      return file;
    } catch (err) {
      this.log(`could not write clip: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private pruneClips(dir: string): void {
    try {
      const auto: { file: string; kind: string; mtime: number; severity: number }[] = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name.startsWith("manual-")) continue;
        const m = /^(.*)-\d+-s(\d+)\.json$/.exec(name);
        if (m === null) continue;
        const file = join(dir, name);
        auto.push({ file, kind: m[1], mtime: statSync(file).mtimeMs, severity: Number(m[2]) });
      }
      auto.sort((a, b) => b.mtime - a.mtime || b.severity - a.severity);
      const perKind = new Map<string, number>();
      let kept = 0;
      for (const c of auto) {
        const n = perKind.get(c.kind) ?? 0;
        if (kept < CLIP_KEEP && n < CLIP_KEEP_PER_KIND) {
          perKind.set(c.kind, n + 1);
          kept++;
          continue;
        }
        rmSync(c.file, { force: true });
        rmSync(c.file.replace(/\.json$/, ".html"), { force: true });
      }
    } catch (err) {
      this.log(`could not prune clips: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private ensurePlanner(): Planner {
    if (this.planner === null) {
      this.planner = new Planner({ budgetMs: LIVE_BUDGET_MS, explain: true, ...this.cfg.plannerCfg });
      this.planner.setDeadZone(this.deadCells);
      this.planner.setFreezeMemory(this.memory);
      if (this.cfg.opponentDirNet) this.planner.setOpponentDirNet(this.cfg.opponentDirNet);
    }
    return this.planner;
  }

  clipList(): { name: string; size: number; when: number }[] {
    try {
      const dir = this.cfg.clipDir ?? DEFAULT_CLIP_DIR;
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const st = statSync(join(dir, f));
          return { name: f, size: st.size, when: st.mtimeMs };
        })
        .sort((a, b) => b.when - a.when)
        .slice(0, 200);
    } catch {
      return [];
    }
  }

  clipPath(name: string): string | null {
    if (!/^[\w.-]+\.json$/.test(name)) return null;
    const dir = this.cfg.clipDir ?? DEFAULT_CLIP_DIR;
    const full = join(dir, name);
    return existsSync(full) ? full : null;
  }

  commandNames(): string[] {
    return [
      "stop","go","war","friend","ignore","clanwar","clanfriend","home","clip","log","mode","try",
      "target","brain","goto","stats","where","emote","reset","kill","yes","no","votes","vote","spec","join","lang","quit","help","seek","say",
    ];
  }

  knobs(): { key: string; value: unknown; def: unknown; changed: boolean }[] {
    const over = (this.cfg.plannerCfg ?? {}) as Record<string, unknown>;
    return Object.entries(PLANNER_DEFAULTS)
      .map(([key, def]) => {
        const value = key in over ? over[key] : def;
        return { key, value, def, changed: key in over && over[key] !== def };
      })
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  setKnob(key: string, raw: unknown): string {
    const defaults = PLANNER_DEFAULTS as Record<string, unknown>;
    if (!(key in defaults)) return t("нет такой настройки: {key}", { key });
    const def = defaults[key];
    let value: unknown = raw;
    if (typeof def === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(n)) return t("{key}: нужно число", { key });
      value = n;
    } else if (typeof def === "boolean") {
      value = raw === true || raw === "true" || raw === 1 || raw === "1";
    } else if (typeof def === "string") {
      value = String(raw);
    }
    const next = { ...(this.cfg.plannerCfg ?? {}) } as Record<string, unknown>;
    if (value === def) delete next[key];
    else next[key] = value;
    this.cfg.plannerCfg = next as BotConfig["plannerCfg"];

    for (const k of Object.keys(this.baseCfg)) delete this.baseCfg[k];
    Object.assign(this.baseCfg, next);
    this.planner = null;
    this.log(t(value === def ? "настройка {key} = {value} (по умолчанию)" : "настройка {key} = {value}", { key, value: JSON.stringify(value) }));
    return `${key} = ${JSON.stringify(value)}`;
  }

  configInfo(): {
    map: string;
    planner: Record<string, unknown>;
    memory: { events: number; map: string } | null;
    traps: number;
  } {
    let traps = 0;
    if (this.deadCells !== null) for (const v of this.deadCells.cells) traps += v;
    return {
      map: this.mapName(),
      planner: { ...(this.cfg.plannerCfg ?? {}) },
      memory: this.memory === null ? null : { events: this.memory.noted, map: this.mapName() },
      traps,
    };
  }

  private brainName(): string {
    return this.cfg.planner === true ? "planner" : this.cfg.scripted === true ? "scripted" : "net";
  }

  private loadRelations(): void {
    try {
      const raw = JSON.parse(readFileSync(this.cfg.relationsFile ?? RELATIONS_FILE, "utf8")) as Record<string, string[]>;
      for (const key of ["war", "friend", "clanWar", "clanFriend", "ignore"] as const) {
        for (const v of raw[key] ?? []) this.relations[key].set(v.trim().toLowerCase(), v);
      }
    } catch {

    }
  }

  private saveLang(l: Lang): void {
    const file = this.cfg.settingsFile;
    if (file === undefined) return;
    try {
      const cur = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (cur === null || typeof cur !== "object" || Array.isArray(cur) || typeof (cur as Record<string, unknown>).server !== "string") return;
      if ((cur as Record<string, unknown>).lang === l) return;
      writeFileSync(file, JSON.stringify({ ...(cur as Record<string, unknown>), lang: l }, null, 2));
    } catch {

    }
  }

  private saveRelations(): void {
    try {
      const file = this.cfg.relationsFile ?? RELATIONS_FILE;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify(
          {
            war: [...this.relations.war.values()],
            friend: [...this.relations.friend.values()],
            clanWar: [...this.relations.clanWar.values()],
            clanFriend: [...this.relations.clanFriend.values()],
            ignore: [...this.relations.ignore.values()],
          },
          null,
          1,
        ),
      );
    } catch (err) {
      this.log(`could not save the war list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private relationCommand(key: "war" | "friend" | "clanWar" | "clanFriend" | "ignore", arg: string, label: string): string {
    const set = this.relations[key];
    let what = arg.trim();

    if (what !== "" && what.toLowerCase() !== "off" && (key === "war" || key === "friend" || key === "ignore")) {
      const hits = this.playersMatching(what);

      const exact = hits.find((h) => h.toLowerCase() === what.toLowerCase());
      if (exact !== undefined) what = exact;
      else if (hits.length > 1) return t('{label}: "{what}" -- это {n}: {list}. Уточни.', { label, what, n: hits.length, list: hits.join(", ") });
      else if (hits.length === 1) what = hits[0];
    }
    if (what === "") return set.size === 0 ? `${label}: nobody` : `${label}: ${[...set.values()].join(", ")}`;
    if (what.toLowerCase() === "off") {
      set.clear();
      this.saveRelations();
      return `${label}: cleared`;
    }
    const who = what.toLowerCase();
    if (set.has(who)) {
      const had = set.get(who) ?? what;
      set.delete(who);
      this.saveRelations();
      return `${label}: removed ${had}`;
    }

    const opposite = key === "war" ? "friend" : key === "friend" ? "war" : key === "clanWar" ? "clanFriend" : key === "ignore" ? "war" : "clanWar";
    const moved = this.relations[opposite].delete(who);
    set.set(who, what);
    this.saveRelations();
    return `${label}: ${what}${moved ? ` (was on the ${opposite} list)` : ""}`;
  }

  relationsInfo(): Record<"war" | "friend" | "ignore" | "clanWar" | "clanFriend", string[]> {
    const r = this.relations;
    return {
      war: [...r.war.values()],
      friend: [...r.friend.values()],
      ignore: [...r.ignore.values()],
      clanWar: [...r.clanWar.values()],
      clanFriend: [...r.clanFriend.values()],
    };
  }

  setRelation(list: "war" | "friend" | "ignore", name: string, on: boolean): string {
    const what = name.trim();
    if (what === "" || !["war", "friend", "ignore"].includes(list)) return "";
    const who = what.toLowerCase();
    const r = this.relations;
    if (!on) {

      for (const key of [...r[list].keys()]) if (key === who || (key !== "" && (who.includes(key) || key.includes(who)))) r[list].delete(key);
      this.saveRelations();
      return `${list}: removed ${what}`;
    }
    if (list === "war") {
      r.friend.delete(who);
      r.ignore.delete(who);
    } else r.war.delete(who);
    r[list].set(who, what);
    this.saveRelations();
    return `${list}: ${what}`;
  }

  private crowdAt(ownId: number, at: Vec2): { tees: number; busy: number } {
    let tees = 0;
    let busy = 0;
    for (const t of this.world.allTees()) {
      if (t.id === ownId || !t.alive) continue;
      if (vdistance(at, t.pos) > CROWD_RADIUS_PX) continue;
      const moved = this.lastMovedById.get(t.id);
      if (moved !== undefined && this.world.tick - moved.tick > AFK_TICKS) continue;
      tees++;
      if (t.hookState >= HOOK_FLYING || this.world.tick - t.attackTick < ACTION_MEMORY_TICKS) busy++;
    }
    return { tees, busy };
  }

  private engagedNow(ownId: number, self: TeeState): boolean {
    if (self.frozen || self.hookedPlayer >= 0) return true;
    for (const t of this.world.allTees()) {
      if (t.id === ownId || !t.alive) continue;
      if (t.hookedPlayer === ownId) return true;
      if (!t.frozen && vdistance(self.pos, t.pos) < ENGAGED_PX) {
        const moved = this.lastMovedById.get(t.id);
        if (moved === undefined || this.world.tick - moved.tick <= AFK_TICKS) return true;
      }
    }
    return false;
  }

  private someoneWorthFighting(ownId: number, at: Vec2, within: number): boolean {
    for (const t of this.world.allTees()) {
      if (t.id === ownId || !t.alive || t.frozen) continue;
      if (vdistance(at, t.pos) > within) continue;
      const moved = this.lastMovedById.get(t.id);
      if (moved === undefined || this.world.tick - moved.tick <= AFK_TICKS) return true;
    }
    return false;
  }

  private freezeWithin(tx: number, ty: number, r: number): boolean {
    const c = this.world.collision;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (c.isFreeze((tx + ox) * 32 + 16, (ty + oy) * 32 + 16)) return true;
    return false;
  }

  private startTrek(from: Vec2, to: { x: number; y: number }): string {

    let route = findRoute(this.world.collision, from, to, { nearTiles: 3, partial: true, allowKill: true, throughFreeze: false });

    if (route !== null && route.steps.length > 0) {
      const end = route.steps[route.steps.length - 1];
      const gx = Math.trunc(to.x / 32);
      const gy = Math.trunc(to.y / 32);
      const short = Math.abs(end.x - gx) > 3 || Math.abs(end.y - gy) > 3;
      if (short && this.freezeWithin(end.x, end.y, 2)) route = null;
    }
    if (route === null || route.steps.length === 0) {
      this.trek = null;
      this.seekingGame = false;
      const t = { x: Math.trunc(to.x / 32), y: Math.trunc(to.y / 32) };
      return `no route there (map ${this.mapName()}, to tile ${t.x},${t.y})`;
    }
    this.trek = { steps: route.steps, at: 0, since: this.world.tick, best: Infinity, bestTick: this.world.tick };
    this.seekingGame = true;
    const hooks = route.steps.filter((s) => s.kind === "hook").length;
    return `walking over: ${route.steps.length} steps${hooks > 0 ? `, ${hooks} on the rope` : ""}`;
  }

  private trekGoal(self: TeeState): Vec2 | null {
    const trek = this.trek;
    if (trek === null) return null;
    while (trek.at < trek.steps.length) {
      const s = trek.steps[trek.at];

      if (s.kind === "kill") {
        trek.at++;
        trek.best = Infinity;
        trek.bestTick = this.world.tick;
        if (this.world.tick - this.lastKillTick >= KILL_COOLDOWN_TICKS) {
          this.lastKillTick = this.world.tick;
          this.stats.selfKills++;
          this.log("the way there starts with a respawn -> /kill");
          try {
            this.client?.game.Kill();
          } catch {

          }
        }
        continue;
      }
      const p = { x: s.x * 32 + 16, y: s.y * 32 + 16 };
      const d = vdistance(self.pos, p);
      if (d < TREK_REACHED_PX) {
        trek.at++;
        trek.best = Infinity;
        trek.bestTick = this.world.tick;
        continue;
      }
      if (d < trek.best - 8) {
        trek.best = d;
        trek.bestTick = this.world.tick;
      } else if (this.world.tick - trek.bestTick > TREK_STALL_TICKS) {
        this.log(`the walk stalled ${Math.round(d)}px from step ${trek.at + 1}/${trek.steps.length} (${s.kind}); rethinking`);
        this.endTrek();
        return null;
      }
      return p;
    }
    this.endTrek();
    return null;
  }

  private pathGoal(self: TeeState, target: TeeState): Vec2 | null {
    if (((this.cfg.plannerCfg as { pathToTarget?: boolean } | undefined)?.pathToTarget ?? PLANNER_DEFAULTS.pathToTarget) !== true) return null;
    const d = vdistance(self.pos, target.pos);
    if (d < PATH_NEAR_PX && this.lineIsClear(self.pos, target.pos)) {
      this.path = null;
      return null;
    }
    const path = this.path;
    const age = path === null ? Infinity : this.world.tick - path.at;
    const stale =
      path === null ||
      path.target !== target.id ||
      age > PATH_REFRESH_TICKS ||
      (age >= PATH_MIN_REFRESH_TICKS && (vdistance(target.pos, path.to) > PATH_MOVED_PX || this.offPath(path, self.pos)));
    if (stale) {

      const route = findRoute(this.world.collision, self.pos, target.pos, { nearTiles: 3, partial: false, maxNodes: 4000, throughFreeze: false });
      this.path = { steps: route === null ? [] : route.steps, at: this.world.tick, target: target.id, to: { x: target.pos.x, y: target.pos.y }, done: 0 };
    }
    return this.pathAhead(this.path as NonNullable<typeof this.path>, self.pos);
  }

  private pathAhead(path: NonNullable<typeof this.path>, at: Vec2): Vec2 | null {
    const steps = path.steps;
    let near = path.done;
    let nearD = Infinity;
    for (let i = path.done; i < Math.min(steps.length, path.done + PATH_PROGRESS_WINDOW); i++) {
      const d = vdistance(at, { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 });
      if (d < nearD) {
        nearD = d;
        near = i;
      }
    }
    path.done = near;
    for (let i = near; i < steps.length; i++) {
      const p = { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 };
      if (vdistance(at, p) > PATH_REACHED_PX) return p;
    }
    return null;
  }

  private offPath(path: NonNullable<typeof this.path>, at: Vec2): boolean {
    const steps = path.steps;
    if (steps.length === 0) return true;
    for (let i = path.done; i < Math.min(steps.length, path.done + PATH_PROGRESS_WINDOW); i++) {
      if (vdistance(at, { x: steps[i].x * 32 + 16, y: steps[i].y * 32 + 16 }) <= PATH_MOVED_PX) return false;
    }
    return true;
  }

  private lineIsClear(a: Vec2, b: Vec2): boolean {
    const steps = Math.max(1, Math.trunc(vdistance(a, b) / 16));
    for (let i = 1; i < steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const y = a.y + ((b.y - a.y) * i) / steps;
      if (this.world.collision.isSolid(x, y) || this.world.collision.isFreeze(x, y) || this.world.collision.isDeath(x, y)) return false;
    }
    return true;
  }

  private endTrek(): void {
    this.trek = null;
    this.seekingGame = false;
    this.planner?.setTravelGoal(null);
  }

  private trapCare(): boolean {
    return (this.cfg.plannerCfg?.deadZoneCost ?? 0) > 0;
  }

  private seekEnabled(): boolean {
    return (this.cfg.plannerCfg as { seek?: boolean } | undefined)?.seek !== false;
  }

  private memoryFile(): string {
    const safe = this.mapName().replace(/[^\w.-]+/g, "_");
    return (this.cfg.memoryDir ?? "runs/memory") + `/${safe}.json`;
  }

  private helperNear(self: TeeState): boolean {
    const cards = this.client?.SnapshotUnpacker?.AllObjClientInfo;
    if (cards === undefined) return false;
    const info = new Map(cards.map((c) => [c.id, c]));
    for (const other of this.world.allTees()) {
      if (other.id === self.id || !other.alive || other.frozen) continue;
      if (vdistance(other.pos, self.pos) > HELPER_RANGE_PX) continue;
      const card = info.get(other.id);
      const nameKey = (card?.name ?? "").trim().toLowerCase();
      const clanKey = (card?.clan ?? "").trim().toLowerCase();
      if (listed(this.relations.friend, nameKey) || listed(this.relations.ignore, nameKey)) return true;
      if (listed(this.relations.clanFriend, clanKey)) return true;
    }
    return false;
  }

  private inDeadZone(pos: Vec2): boolean {
    const dead = this.deadCells;
    if (dead === null) return false;
    const tx = Math.trunc(pos.x / 32);
    const ty = Math.trunc(pos.y / 32);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const i = (ty + oy) * dead.width + (tx + ox);
        if (i >= 0 && i < dead.cells.length && dead.cells[i] === 1) return true;
      }
    }
    return false;
  }

  private busiestSpot(ownId: number, from: Vec2): { x: number; y: number; dist: number; tees: number; busy: number } | null {
    const tees = this.world.allTees().filter((t) => t.alive && t.id !== ownId);
    const active = (t: TeeState): boolean => t.hookState >= HOOK_FLYING || this.world.tick - t.attackTick < ACTION_MEMORY_TICKS;
    const awake = (t: TeeState): boolean => {
      const moved = this.lastMovedById.get(t.id);
      return moved === undefined || this.world.tick - moved.tick <= AFK_TICKS;
    };
    let best: { x: number; y: number; dist: number; tees: number; busy: number } | null = null;
    let bestScore = -Infinity;
    for (const centre of tees) {
      if (!awake(centre)) continue;
      let near = 0;
      let busy = 0;
      for (const other of tees) {
        if (vdistance(centre.pos, other.pos) > CROWD_RADIUS_PX) continue;
        if (!awake(other)) continue;
        near++;
        if (active(other)) busy++;
      }
      const dist = vdistance(from, centre.pos);
      const score = near + busy - dist / 1500;
      if (score > bestScore) {
        bestScore = score;
        best = { x: centre.pos.x, y: centre.pos.y, dist, tees: near, busy };
      }
    }

    if (best === null || best.dist < TARGET_MAX_PX / 2) return null;
    return best;
  }

  private playersMatching(text: string): string[] {
    const needle = text.trim().toLowerCase();
    if (needle === "") return [];
    const snap = this.client?.SnapshotUnpacker;
    const out: string[] = [];
    for (const c of snap?.AllObjClientInfo ?? []) {
      const name = (c.name ?? "").trim();
      if (name !== "" && name.toLowerCase().includes(needle)) out.push(name);
    }
    return out;
  }

  private lagTicks(): number {
    if (this.cfg.lagCompensation === false) return 0;
    const echo = this.echoLagTicks();
    if (echo >= 0) return Math.min(MAX_LAG_TICKS, echo);
    return Math.min(MAX_LAG_TICKS, this.pingLagTicks());
  }

  private pingLagTicks(): number {
    const snap = this.client?.SnapshotUnpacker;
    const info = this.ownId >= 0 ? snap?.getObjPlayerInfo(this.ownId) : undefined;
    const ms = typeof info?.latency === "number" && info.latency > 0 ? info.latency : 0;
    return Math.round(ms / 20);
  }

  private echoLagTicks(): number {
    if (this.echoSamples < ECHO_MIN_SAMPLES) return -1;

    let best = -1;
    let bestMiss = Infinity;
    for (let d = 1; d < this.echoMiss.length; d++) {
      if (this.echoSeen[d] < ECHO_MIN_SAMPLES) continue;
      const miss = this.echoMiss[d] / this.echoSeen[d];
      if (miss < bestMiss) {
        bestMiss = miss;
        best = d;
      }
    }
    if (best < 0 || bestMiss > ECHO_MATCH_MAX) return -1;

    for (let d = 1; d < best; d++) {
      if (this.echoSeen[d] < ECHO_MIN_SAMPLES) continue;
      if (this.echoMiss[d] / this.echoSeen[d] <= bestMiss + ECHO_MATCH_GAP) {
        best = d;
        break;
      }
    }

    return Math.max(0, best - this.snapshotGap);
  }

  private measureEcho(self: TeeState): void {
    const now = this.world.tick;
    if (this.lastSnapTick > 0 && now > this.lastSnapTick && now - this.lastSnapTick <= 4) {
      this.snapshotGap = now - this.lastSnapTick;
    }
    this.lastSnapTick = now;
    if (!self.alive || this.aimLog.length < 2) return;
    const a = wireAngleRad(self.angle);
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    for (let i = 0; i < this.aimLog.length; i++) {
      const dec = this.aimLog[i];
      const d = now - dec.tick;
      if (d < 1 || d >= this.echoMiss.length) continue;
      const before = this.aimLog[i + 1];

      if (before === undefined || dec.x * before.x + dec.y * before.y > 0.98) continue;
      this.echoMiss[d] += 1 - (ax * dec.x + ay * dec.y);
      this.echoSeen[d]++;
      if (d === 1 || d === 2) this.echoSamples++;
    }
  }

  private noteAim(input: PlayerInput): void {
    const n = Math.hypot(input.targetX, input.targetY);
    if (n === 0) return;
    this.aimLog.unshift({ tick: this.world.tick, x: input.targetX / n, y: input.targetY / n });
    if (this.aimLog.length > ECHO_LOG) this.aimLog.length = ECHO_LOG;
  }

  private mapName(): string {
    return this.client?.map?.map_name ?? this.client?.lastMapDetails?.map_name ?? "?";
  }

  private maybeUnstick(client: TwClient, self: TeeState): void {

    const STUCK_FROZEN_TICKS = 9 * 50;
    const STUCK_WEDGED_TICKS = 4 * 50;
    const STUCK_RADIUS = 48;

    const FROZEN_HARD_LIMIT_TICKS = 8 * 50;

    const FROZEN_IN_TILE_TICKS = 4 * 50;

    if (!self.frozen) this.frozenSince = -1;
    else if (this.frozenSince < 0) this.frozenSince = this.world.tick;
    const frozenFor = self.frozen && this.frozenSince >= 0 ? this.world.tick - this.frozenSince : 0;

    if (!this.acting) {
      this.stuckAnchor = null;
      return;
    }

    if (!self.frozen && this.targetId === -1) {
      this.stuckAnchor = null;
      return;
    }

    const inTiles =
      self.frozen &&
      [-HALF_TEE, HALF_TEE].some((dx) =>
        [-HALF_TEE, HALF_TEE].some((dy) => this.world.collision.isFreeze(self.pos.x + dx, self.pos.y + dy)),
      );
    const hooked = this.world.allTees().some((o) => o.id !== self.id && o.alive && o.hookedPlayer === self.id);

    const trapped = !hooked && this.inDeadZone(self.pos);
    const TRAPPED_TICKS = 1.5 * 50;

    const helped = this.helperNear(self);
    const overdue =
      (frozenFor >= FROZEN_HARD_LIMIT_TICKS ||
        (inTiles && !hooked && frozenFor >= FROZEN_IN_TILE_TICKS) ||
        (trapped && frozenFor >= TRAPPED_TICKS)) &&

      (!helped || frozenFor >= HELPED_LIMIT_TICKS);
    if (overdue && this.world.tick - this.lastKillTick >= KILL_COOLDOWN_TICKS) {
      this.lastKillTick = this.world.tick;
      this.stuckAnchor = null;
      this.frozenSince = -1;
      this.stats.selfKills++;
      this.log(
        trapped && frozenFor < FROZEN_IN_TILE_TICKS
          ? `frozen ${(frozenFor / 50).toFixed(1)}s where there is no way back to the game -> /kill`
          : `frozen without a break for ${(frozenFor / 50).toFixed(1)}s${inTiles ? " standing in the tiles" : ""} (a strong player's longest in an hour is 4.0s) -> /kill`,
      );
      try {
        client.game.Kill();
      } catch {

      }
      return;
    }

    if (this.stuckAnchor === null || vdistance(self.pos, this.stuckAnchor) > STUCK_RADIUS || self.frozen !== this.stuckAnchorFrozen) {
      this.stuckAnchor = { x: self.pos.x, y: self.pos.y };
      this.stuckAnchorTick = this.world.tick;
      this.stuckAnchorMs = Date.now();
      this.stuckAnchorFrozen = self.frozen;
      return;
    }
    const stuckTicks = this.world.tick - this.stuckAnchorTick;
    if (stuckTicks < (self.frozen ? STUCK_FROZEN_TICKS : STUCK_WEDGED_TICKS)) return;

    if (self.frozen) {

      for (const other of this.world.allTees()) {
        if (other.id !== self.id && other.alive && other.hookedPlayer === self.id) return;
      }

      if (this.helperNear(self) && stuckTicks < HELPED_LIMIT_TICKS) return;

      if (!this.world.collision.isFreeze(self.pos.x, self.pos.y)) return;
    }
    if (this.world.tick - this.lastKillTick < KILL_COOLDOWN_TICKS) return;

    this.lastKillTick = this.world.tick;
    const wallMs = Date.now() - this.stuckAnchorMs;
    this.stuckAnchor = null;
    this.stats.selfKills++;
    this.log(`stuck for ${(stuckTicks / 50).toFixed(1)}s of server ticks (${wallMs}ms wall clock)${self.frozen ? " (frozen)" : ""} -> /kill`);
    try {
      client.game.Kill();
    } catch {

    }
  }

  private planAction(ownId: number, targetId: number, self: TeeState): PlayerInput {
    const target = this.world.getTee(targetId);
    if (target === undefined) return emptyInput();

    if (this.planSim === null || this.planSelfId !== ownId || this.planCollision !== this.world.collision) {
      this.planSim = new SimWorld(this.world.collision, { svHit: true, respawnDelayTicks: 0, infiniteAmmo: true });
      this.planSim.addTee(ownId, self.pos);
      this.planOthersIn.clear();
      this.planTargetId = -1;
      this.planSelfId = ownId;
      this.planCollision = this.world.collision;
      this.ensurePlanner().reset();
    }
    const sim = this.planSim;

    if (this.planTargetId !== targetId) {
      if (this.planTargetId >= 0 && !this.planOthersIn.has(this.planTargetId) && sim.getTee(this.planTargetId) !== undefined) {
        sim.removeTee(this.planTargetId);
      }
      if (sim.getTee(targetId) === undefined) sim.addTee(targetId, target.pos);

      this.planOthersIn.delete(targetId);
      this.planTargetId = targetId;
    }
    const enemyInput = enemyInputFromSnapshot(target);

    const lag = this.lagTicks();

    const nOthers = Math.max(0, Math.floor(this.cfg.plannerCfg?.planOthers ?? 0));
    const others =
      nOthers === 0
        ? []
        : this.world
            .allTees()
            .filter((t) => t.alive && t.id !== ownId && t.id !== targetId && vdistance(t.pos, self.pos) <= PLAN_OTHERS_PX)
            .sort((a, b) => vdistance(a.pos, self.pos) - vdistance(b.pos, self.pos))
            .slice(0, nOthers);
    syncOthers(sim, this.planOthersIn, others);
    if (this.cfg.plannerCfg?.liveTransfer === "legacy") syncPlanningWorldLegacy(sim, ownId, self, targetId, target, this.prevInput, enemyInput, lag);
    else {
      const flight = this.inFlightInputs(this.world.tick, lag);
      syncPlanningWorld(sim, ownId, self, targetId, target, this.prevInput, enemyInput, lag, flight.inFlight, flight.held);
    }

    const planner = this.ensurePlanner();

    planner.setTravelGoal(this.trek === null ? this.pathGoal(self, target) : this.trekGoal(self));

    planner.setThirdTees(
      (this.cfg.plannerCfg?.thirdTeeExposure ?? 0) > 0
        ? this.world
            .allTees()
            .filter((t) => t.alive && !t.frozen && t.id !== ownId && t.id !== targetId && vdistance(t.pos, self.pos) <= TUNING.hookLength)
            .sort((a, b) => vdistance(a.pos, self.pos) - vdistance(b.pos, self.pos))
            .slice(0, 2)
            .map((t) => ({ x: t.pos.x, y: t.pos.y }))
        : [],
    );

    planner.setFrozenBystanders(
      this.world
        .allTees()
        .filter((t) => t.alive && t.frozen && t.id !== ownId && t.id !== targetId && vdistance(t.pos, self.pos) <= BYSTANDER_PX && !this.isFriendId(t.id))
        .map((t) => ({ x: t.pos.x, y: t.pos.y })),
    );
    const out = planner.decide(sim, ownId, targetId, this.prevInput, enemyInput);
    this.noteAim(out);
    this.lastPlan = {
      target: targetId,
      lag,
      lagPing: this.pingLagTicks(),
      others: others.length,
      arm: this.tryName,
      trek: this.trek === null ? -1 : this.trek.steps.length - this.trek.at,
      ...planner.lastInfo,
    };
    return out;
  }

  private applyInput(client: TwClient, input: PlayerInput, activeWeapon: number): void {
    const mv = client.movement;
    if (input.direction < 0) mv.RunLeft();
    else if (input.direction > 0) mv.RunRight();
    else mv.RunStop();

    mv.Jump(input.jump !== 0);

    if (input.hook !== 0 && this.prevInput.hook === 0) this.stats.hooksFired++;
    mv.Hook(input.hook !== 0);

    mv.SetAim(input.targetX, input.targetY);

    mv.FlagScoreboard?.(this.world.tick % 50 < 2);

    mv.WantedWeapon(input.wantedWeapon === 0 ? WEAPON_HAMMER + 1 : input.wantedWeapon);

    if (firePressed(this.prevInput, input)) {
      if (client.input.m_Fire & 1) mv.Fire();
      mv.Fire();
      if (activeWeapon === WEAPON_HAMMER) this.stats.hammerFires++;
    } else if ((input.fire & 1) === 0 && client.input.m_Fire & 1) {
      mv.Fire();
    }

    try {
      client.sendInput();
    } catch {

    }

    this.prevInput = { ...input };

    this.sent.push({ tick: this.world.tick, input: { ...input } });
    if (this.sent.length > 16) this.sent.shift();
  }

  private inFlightInputs(tick: number, lag: number): { held: PlayerInput; inFlight: PlayerInput[] } {
    const at = (k: number): PlayerInput => {
      let pick: PlayerInput | undefined;
      for (const d of this.sent) if (d.tick <= tick + k - lag - 1) pick = d.input;
      return pick ?? this.prevInput;
    };
    const inFlight: PlayerInput[] = [];
    for (let k = 1; k <= lag; k++) inFlight.push(at(k));
    return { held: at(0), inFlight };
  }

  private wander(client: TwClient, self: TeeState): void {
    if (!this.collisionReady || !this.acting) {
      this.idle();
      return;
    }
    const mv = client.movement;
    const tick = this.world.tick;
    if (tick >= this.wanderUntilTick) {

      this.wanderDir = this.wanderRng.nextFloat() < 0.22 ? 0 : this.wanderRng.nextFloat() < 0.5 ? -1 : 1;
      this.wanderUntilTick = tick + 25 + Math.floor(this.wanderRng.nextFloat() * 175);
      this.wanderAim = (this.wanderRng.nextFloat() * 2 - 1) * Math.PI;
    }

    const ahead = { x: self.pos.x + this.wanderDir * 40, y: self.pos.y };
    const col = this.world.collision;
    if (this.wanderDir !== 0 && col !== undefined) {
      const blocked = col.isSolid(ahead.x, ahead.y) || col.isFreeze(ahead.x, ahead.y) || col.isDeath(ahead.x, ahead.y);
      const drop = !col.isSolid(ahead.x, self.pos.y + 40) && !col.isSolid(ahead.x, self.pos.y + 80);
      const hazardBelow = wanderHazardBelow(col, ahead.x, self.pos.y);
      if (blocked || hazardBelow || (drop && this.wanderRng.nextFloat() < 0.7)) {
        this.wanderDir = -this.wanderDir;
        this.wanderUntilTick = tick + 40;
      }
    }

    if (this.wanderDir < 0) mv.RunLeft();
    else if (this.wanderDir > 0) mv.RunRight();
    else mv.RunStop();

    if (tick >= this.wanderJumpUntilTick && this.wanderRng.nextFloat() < 0.03) {
      this.wanderJumpUntilTick = tick + 3 + Math.floor(this.wanderRng.nextFloat() * 8);
    }
    if (tick >= this.wanderHookUntilTick && this.wanderRng.nextFloat() < 0.02) {
      this.wanderHookUntilTick = tick + 15 + Math.floor(this.wanderRng.nextFloat() * 35);
    }
    let jump = tick < this.wanderJumpUntilTick;
    let hook = tick < this.wanderHookUntilTick;

    const want = { ...this.prevInput, direction: this.wanderDir, jump: jump ? 1 : 0, hook: hook ? 1 : 0 };
    const safe = this.guard(self, want);
    const guarded = safe !== want;
    if (guarded) {
      this.wanderDir = safe.direction;
      jump = safe.jump !== 0;
      hook = safe.hook !== 0;

      if (hook) {
        this.wanderHookUntilTick = Math.max(this.wanderHookUntilTick, tick + 20);
        this.wanderAim = Math.atan2(safe.targetY, safe.targetX);
      }
      if (this.wanderDir < 0) mv.RunLeft();
      else if (this.wanderDir > 0) mv.RunRight();
      else mv.RunStop();
      this.wanderUntilTick = tick + 25;
    }
    mv.Jump(jump);
    mv.Hook(hook);
    if (client.input.m_Fire & 1) mv.Fire();

    const cur = Math.atan2(this.prevInput.targetY, this.prevInput.targetX);
    let d = this.wanderAim - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const step = Math.max(-0.12, Math.min(0.12, d));
    const a = cur + step;
    const tx = guarded && hook ? safe.targetX : Math.round(Math.cos(a) * 300);
    const ty = guarded && hook ? safe.targetY : Math.round(Math.sin(a) * 300);
    mv.SetAim(tx, ty);
    this.prevInput.targetX = tx === 0 && ty === 0 ? 300 : tx;
    this.prevInput.targetY = ty;
    this.prevInput.direction = this.wanderDir;
    this.prevInput.jump = jump ? 1 : 0;
    this.prevInput.hook = hook ? 1 : 0;
    client.sendInput();
  }

  private idle(): void {
    const client = this.client;
    if (!client) return;
    const mv = client.movement;
    mv.RunStop();
    mv.Jump(false);
    mv.Hook(false);
    if (client.input.m_Fire & 1) mv.Fire();
    this.prevInput.direction = 0;
    this.prevInput.jump = 0;
    this.prevInput.hook = 0;
  }

  private trackTravel(pos: Vec2): void {
    if (!this.travel.start) this.travel.start = { ...pos };
    if (this.lastPos) this.travel.distance += vdistance(this.lastPos, pos);
    this.lastPos = { ...pos };
    this.travel.end = this.lastPos;
  }

  private maybeLogStatus(self: { pos: Vec2; vel: Vec2; activeWeapon: number; frozen: boolean }): void {
    if (!this.cfg.verbose) return;
    const now = Date.now();
    if (now - this.lastStatusMs < STATUS_INTERVAL_MS) return;
    this.lastStatusMs = now;
    this.log(
      `status: tick=${this.world.tick} id=${this.ownId} pos=(${self.pos.x}, ${self.pos.y}) vel=(${self.vel.x.toFixed(2)}, ${self.vel.y.toFixed(2)}) weapon=${self.activeWeapon} frozen=${self.frozen} target=${this.targetId} travelled=${this.travel.distance.toFixed(0)}px ${this.statsLine()}`,
    );
  }
}
