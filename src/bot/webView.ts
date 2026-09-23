/* The drawing below follows DDNet's client (zlib license): CRenderTools::
   RenderTee6, CPlayers, CNamePlates, CScoreboard, CHud, CFreezeBars, CEffects
   and the map layer renderer.
   Copyright (C) 2007-2014 Magnus Auvinen (Teeworlds); Copyright (C) DDRace and
   DDNet contributors. This is an altered version, not the original software. */

import {
  ANIMS,
  CHARFLAG,
  SPRITES,
  affine3,
  boardColumns,
  boardMetrics,
  buildPasses,
  chunkLod,
  ddnetColor,
  envEval,
  envRgbConst,
  flakeStep,
  freezeBarPieces,
  gradientPixels,
  groupView,
  hslRgb,
  hudWeapons,
  jumpIcons,
  skinColorable,
  skinTint,
  spriteRect,
  spriteScale,
  teeAnimFor,
  tickClock,
  tileMatrix,
} from "./webDraw.ts";

void ANIMS;

type AnyImg = HTMLImageElement | HTMLCanvasElement;
type Img = { el: HTMLImageElement; ok: boolean; bad: boolean };
type Tee = {
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

type Looks = { skin?: string; cc?: boolean; cb?: number; cf?: number };
type Player = { id: number; name: string; clan: string; score: number; ping: number; team: number } & Looks;
type Frame = {
  tick: number;
  selfId: number;
  target: number;
  map: string;
  tees: Tee[];
  doing: string;
  goal: { x: number; y: number } | null;
  route: { x: number; y: number; kind: string }[];
  players?: Player[];
  emoticons?: { id: number; e: number; age: number }[];
  roundStart?: number;
  cursor?: { x: number; y: number };
};
type LiveMap = { name: string; width: number; height: number; k: Uint8Array; t?: Uint8Array };
type Layer = {
  kind: "tiles" | "quads";
  id: number;
  w: number;
  h: number;
  color: number[];
  image: number;
  role: string;
  quads: number[];
  env?: number;
  envOff?: number;
  g?: number;

  sx?: number;
  sy?: number;
};
type Group = { ox: number; oy: number; px: number; py: number; clip: number[] | null; layers: Layer[] };
type Envelope = { c: number; p: number[] };
type Scene = { name?: string; groups: Group[]; images: { name: string; w: number; h: number; external: boolean }[]; envelopes?: Envelope[] };
type Pass = { kind: string; g: number; side: string; layers: Layer[]; key: string; env: number; envOff: number };
type Chunk = { c: HTMLCanvasElement | null; used: number; px: number };
type Flake = { x: number; y: number; vx: number; vy: number; g: number; rot: number; life: number; size: number };

export type ViewOptions = {
  css: (name: string) => string;

  onInfo?: (info: { spec: number; zoom: number; fps: number; data: boolean; scene: boolean; own: boolean }) => void;
};

export function createView(cv: HTMLCanvasElement, opt: ViewOptions) {

  let ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  const st = {
    frames: [] as { f: Frame; at: number }[],
    clock: null as number | null,
    liveMap: null as LiveMap | null,
    scene: null as Scene | null,
    sceneName: "",
    sceneGen: 0,
    sceneTries: 0,
    tiles: new Map<number, Uint8Array>(),
    images: [] as (Img | null)[],
    passes: [] as Pass[],
    entLayers: [] as { layer: Layer; g: number }[],
    gameGroup: -1,
    envRgb: [] as (number[] | null)[],
    envMs: 0,
    envCache: new Map<string, number[]>(),
    envFrame: -1,
    chunks: new Map<string, Chunk>(),
    chunkPx: 0,
    chunksDrawn: 0,
    chunksDrawnLast: 0,

    mapTints: new Map<string, { c: HTMLCanvasElement | null; px: number; pat: CanvasPattern | null | undefined }>(),
    mapTintPx: 0,

    skinTints: new Map<string, HTMLCanvasElement | null>(),
    quadCache: new Map<string, HTMLCanvasElement | null>(),

    envChunks: new Map<string, { c: HTMLCanvasElement; tint: string; from: HTMLCanvasElement; used: number }>(),

    staticN: 0,
    bgCache: null as HTMLCanvasElement | null,
    bgKey: "",
    notReady: false,
    frameNo: 0,
    cam: { x: 0, y: 0 },
    camSet: false,
    lastFollow: { id: -1, x: 0, y: 0 },
    zoom: 1,
    spec: -1,
    follow: true,
    mode: "map" as "map" | "ent" | "both",
    show: { route: true, traps: true, names: true, board: false, clans: false, cursor: true },
    data: false,
    fps: 0,
    fpsAcc: 0,
    fpsN: 0,
    fpsAt: 0,
    lastDraw: 0,
    emotes: new Map<number, { e: number; start: number }>(),
    flakes: [] as Flake[],
    flakeClock: 0,
    frictionClock: 0,
    feed: [] as { text: string; id: number; good: boolean; at: number; kind: string }[],
    lastTees: new Map<number, Tee>(),
    lastPlayers: new Map<number, Player>(),
    icons: new Map<string, string>(),
    budget: 0,

    builds: 0,
    buildMs: 0,
  };
  const TM: number[][] = [];
  for (let f = 0; f < 16; f++) TM.push(tileMatrix(f));
  const QUAD_REC = 38;

  const CHUNK_PX_MAX = 48 * 1024 * 1024;
  const MAP_TINT_PX_MAX = 40 * 1024 * 1024;

  function image(url: string): Img {
    const el = new Image();
    const o: Img = { el, ok: false, bad: false };
    el.onload = () => {
      o.ok = true;
    };
    el.onerror = () => {
      o.bad = true;
    };
    el.src = url;
    return o;
  }
  const sheets = {
    game: null as Img | null,
    emoticons: null as Img | null,
    extras: null as Img | null,
    hud: null as Img | null,
    ent: null as Img | null,
    arrow: null as Img | null,
  };
  const skins = new Map<string, { img: Img; gray: Uint8ClampedArray | null; used: number }>();

  let skinsAsked = false;
  function loadData(found: boolean): void {
    st.data = found;
    if (!skinsAsked) {
      skinsAsked = true;
      skin("default");
      skin("x_ninja");
    }
    if (!found || sheets.game !== null) return;
    sheets.game = image("/assets/game.png");
    sheets.emoticons = image("/assets/emoticons.png");
    sheets.extras = image("/assets/extras.png");
    sheets.hud = image("/assets/hud.png");
    sheets.ent = image("/assets/editor/entities_clear/ddnet.png");
    sheets.arrow = image("/assets/arrow.png");
  }
  function skin(name: string) {
    let s = skins.get(name);
    if (!s) {
      s = { img: image("/skins/" + encodeURIComponent(name) + ".png"), gray: null, used: st.frameNo };
      skins.set(name, s);

      if (skins.size > 128) {
        const old = [...skins.entries()].filter(([n]) => n !== "default" && n !== "x_ninja").sort((a, b) => a[1].used - b[1].used);
        for (const [n] of old.slice(0, skins.size - 112)) {
          skins.delete(n);
          for (const k of [...st.skinTints.keys()]) if (k.startsWith(n + "|")) st.skinTints.delete(k);
        }
      }
    }
    s.used = st.frameNo;
    return s;
  }
  function canvas(w: number, h: number): HTMLCanvasElement | null {
    try {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      return c;
    } catch {
      return null;
    }
  }

  function teeAtlas(t: Looks & { frozen?: boolean }, dimFeet: boolean, real: boolean): AnyImg | null {
    const ninja = !real && !!t.frozen;
    let name = ninja ? "x_ninja" : t.skin || "default";
    let s = skin(name);
    if (s.img.bad || !s.img.ok) {

      name = "default";
      s = skin("default");
      if (!s.img.ok) return null;
    }
    const custom = !ninja && !!t.cc;
    if (!custom && !dimFeet) return s.img.el;
    const key = name + "|" + (custom ? (t.cb ?? 0) + "/" + (t.cf ?? 0) : "o") + (dimFeet ? "|d" : "");
    const hit = st.skinTints.get(key);
    if (hit !== undefined) {

      st.skinTints.delete(key);
      st.skinTints.set(key, hit);
      return hit ?? s.img.el;
    }
    const w = s.img.el.naturalWidth || 256;
    const h = s.img.el.naturalHeight || 128;
    const c = canvas(w, h);
    let out: HTMLCanvasElement | null = null;
    if (c) {
      try {
        const g = c.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(s.img.el, 0, 0);
        const data = g.getImageData(0, 0, w, h);
        let src: Uint8ClampedArray = data.data;
        if (custom) {
          if (!s.gray) {
            s.gray = new Uint8ClampedArray(data.data);
            skinColorable(s.gray, w, h);
          }
          src = s.gray;
        }
        const body = custom ? ddnetColor(t.cb ?? 0) : [1, 1, 1];
        const feet = custom ? ddnetColor(t.cf ?? 0) : [1, 1, 1];
        data.data.set(skinTint(src, w, h, body, feet, dimFeet ? 0.5 : 1));
        g.putImageData(data, 0, 0);
        out = c;
      } catch {
        out = null;
      }
    }
    st.skinTints.set(key, out);
    while (st.skinTints.size > 96) st.skinTints.delete(st.skinTints.keys().next().value as string);
    return out ?? s.img.el;
  }

  async function loadScene(name: string): Promise<void> {
    const gen = ++st.sceneGen;
    if (name !== st.sceneName) st.sceneTries = 0;
    st.sceneName = name;
    st.scene = null;
    st.passes = [];
    st.entLayers = [];
    st.gameGroup = -1;
    st.envRgb = [];
    st.staticN = 0;
    st.bgCache = null;
    st.bgKey = "";
    st.tiles.clear();
    st.chunks.clear();
    st.chunkPx = 0;
    st.quadCache.clear();
    st.envChunks.clear();
    st.mapTints.clear();
    st.mapTintPx = 0;
    st.images = [];
    let sc: Scene | null = null;
    try {
      const r = await fetch("/api/scene?m=" + encodeURIComponent(name));
      sc = r.status === 200 ? ((await r.json()) as Scene | null) : null;
    } catch {
      sc = null;
    }
    if (gen !== st.sceneGen) return;

    if (!sc || !Array.isArray(sc.groups) || (typeof sc.name === "string" && sc.name !== name)) {
      retryScene(name, gen);
      return;
    }
    const q = "?m=" + encodeURIComponent(name);
    st.images = sc.images.map((im, i) => (im.external ? (st.data ? image("/assets/mapres/" + encodeURIComponent(im.name) + ".png") : null) : image("/api/scene/image/" + i + q)));
    const jobs: Promise<void>[] = [];
    let stale = false;
    sc.groups.forEach((g, gi) => {
      for (const l of g.layers) {
        l.g = gi;
        if (l.kind !== "tiles") continue;
        const url = "/api/scene/tiles/" + l.id + q;
        jobs.push(
          (async () => {
            try {
              const r = await fetch(url);
              if (r.status === 409) stale = true;
              const buf = new Uint8Array(await r.arrayBuffer());
              if (buf.length >= l.w * l.h * 2) st.tiles.set(l.id, buf);
            } catch {

            }
          })(),
        );
      }
    });
    await Promise.all(jobs);
    if (gen !== st.sceneGen) return;
    if (stale) {
      retryScene(name, gen);
      return;
    }
    const built = buildPasses(sc.groups);
    for (const p of built.passes) {
      const base = sc.groups[p.g];
      for (const l of p.layers) {
        const own = sc.groups[l.g ?? p.g];
        l.sx = base.ox - own.ox;
        l.sy = base.oy - own.oy;
      }
    }
    st.passes = built.passes;
    st.entLayers = built.ent.map((e) => ({ layer: e.layer, g: e.g }));
    st.gameGroup = built.ent.find((e) => e.layer.role === "game")?.g ?? -1;
    st.envRgb = (sc.envelopes ?? []).map((e) => envRgbConst(e.p, e.c));
    st.staticN = staticPrefix(sc, built.passes, st.gameGroup);
    st.scene = sc;
    st.sceneTries = 0;
  }

  function staticPrefix(sc: Scene, passes: Pass[], gameGroup: number): number {
    const still = (idx: number): boolean => {
      const e = sc.envelopes?.[idx];
      if (!e) return true;
      const n = Math.floor(e.p.length / 6);
      for (let i = 1; i < n; i++) for (let c = 0; c < 4; c++) if (e.p[i * 6 + 2 + c] !== e.p[2 + c]) return false;
      return true;
    };
    let n = 0;
    for (const p of passes) {
      const g = sc.groups[p.g];
      if (p.side !== "bg" || g.px !== 0 || g.py !== 0 || g.clip !== null) break;
      if (gameGroup >= 0 && p.layers.some((l) => (l.g ?? p.g) >= gameGroup)) break;
      if (p.kind === "tiles") {
        if (p.env >= 0 && !still(p.env)) break;
      } else {
        const q = p.layers[0].quads;
        let moving = false;
        for (let i = 0; i + QUAD_REC <= q.length && !moving; i += QUAD_REC) {
          if ((q[i + 34] >= 0 && !still(q[i + 34])) || (q[i + 36] >= 0 && !still(q[i + 36]))) moving = true;
        }
        if (moving) break;
      }
      n++;
    }
    return n;
  }
  function retryScene(name: string, gen: number): void {
    const wait = Math.min(15000, 1000 * 2 ** Math.min(4, st.sceneTries++));
    setTimeout(() => {
      if (st.sceneGen === gen && st.sceneName === name && st.scene === null) void loadScene(name);
    }, wait);
  }

  function envAt(idx: number, off: number, ch: number, def: number[]): number[] {
    if (st.envFrame !== st.frameNo) {
      st.envCache.clear();
      st.envFrame = st.frameNo;
    }
    const key = idx + "|" + off + "|" + ch;
    const hit = st.envCache.get(key);
    if (hit) return hit;
    const e = st.scene?.envelopes?.[idx];
    const out = def.slice();
    if (e && e.c > 0) {
      const v = envEval(e.p, Math.min(ch, e.c, 4), st.envMs + off);
      for (let c = 0; c < v.length; c++) out[c] = v[c];
    }
    st.envCache.set(key, out);
    return out;
  }

  function bakedColor(l: Layer): number[] {
    const c = [l.color[0], l.color[1], l.color[2]];
    const env = l.env ?? -1;
    if (env >= 0) {
      const k = st.envRgb[env];
      if (k) for (let i = 0; i < 3; i++) c[i] = Math.round(c[i] * Math.max(0, Math.min(1, k[i])));
    }
    return c;
  }
  function tintedTiles(l: Layer): AnyImg | null {
    const c = bakedColor(l);
    return tinted(l.image, c[0], c[1], c[2]);
  }

  function tintEntry(image: number, r: number, g: number, b: number) {
    const im = st.images[image];
    if (!im || !im.ok) return null;
    const key = image + "|" + r + "," + g + "," + b;
    const hit = st.mapTints.get(key);
    if (hit) {
      st.mapTints.delete(key);
      st.mapTints.set(key, hit);
      return hit;
    }
    let c: HTMLCanvasElement | null = null;
    if (!(r >= 250 && g >= 250 && b >= 250)) {
      c = canvas(im.el.naturalWidth, im.el.naturalHeight);
      if (c) {
        const x = c.getContext("2d") as CanvasRenderingContext2D;
        x.drawImage(im.el, 0, 0);
        x.globalCompositeOperation = "multiply";
        x.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        x.fillRect(0, 0, c.width, c.height);
        x.globalCompositeOperation = "destination-in";
        x.drawImage(im.el, 0, 0);
      }
    }
    const e = { c, px: c ? c.width * c.height : 0, pat: undefined as CanvasPattern | null | undefined };
    st.mapTints.set(key, e);
    st.mapTintPx += e.px;
    while (st.mapTintPx > MAP_TINT_PX_MAX && st.mapTints.size > 1) {
      const oldest = st.mapTints.keys().next().value as string;
      st.mapTintPx -= st.mapTints.get(oldest)?.px ?? 0;
      st.mapTints.delete(oldest);
    }
    return e;
  }
  function tinted(image: number, r: number, g: number, b: number): AnyImg | null {
    const e = tintEntry(image, r, g, b);
    const im = st.images[image];
    if (!e || !im) return null;
    return e.c ?? im.el;
  }

  function chunk(p: Pass | null, layers: Layer[], ent: boolean, lod: number, T: number, cx: number, cy: number): HTMLCanvasElement | null | undefined {
    const key = (p ? p.key : "ent" + layers[0].id) + "|" + lod + "|" + cx + "|" + cy;
    st.chunksDrawn++;
    const hit = st.chunks.get(key);
    if (hit) {
      hit.used = st.frameNo;
      return hit.c;
    }
    if (st.budget <= 0) return undefined;
    const t0 = performance.now();
    const imgs: (AnyImg | null)[] = [];
    for (const l of layers) {
      const im = ent ? (sheets.ent && sheets.ent.ok ? sheets.ent.el : null) : l.image < 0 ? null : tintedTiles(l);
      if (!ent && l.image >= 0 && !im) {
        const raw = st.images[l.image];
        if (raw && !raw.bad) return undefined;
      }
      imgs.push(im);
    }
    const c = canvas(T * lod, T * lod);
    let any = false;
    if (c) {
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.imageSmoothingEnabled = true;

      const X0 = cx * T * 32;
      const Y0 = cy * T * 32;
      const k = lod / 32;
      layers.forEach((l, li) => {
        const im = imgs[li];
        const data = st.tiles.get(l.id);
        if (!im || !data) return;
        const iw = (im as HTMLImageElement).naturalWidth || im.width;
        const ts = iw / 16;
        g.globalAlpha = ent ? 1 : l.color[3] / 255;
        const sx = ent ? 0 : (l.sx ?? 0);
        const sy = ent ? 0 : (l.sy ?? 0);
        const x0 = Math.max(0, Math.floor((X0 - sx) / 32));
        const y0 = Math.max(0, Math.floor((Y0 - sy) / 32));
        const x1 = Math.min(l.w, Math.ceil((X0 + T * 32 - sx) / 32));
        const y1 = Math.min(l.h, Math.ceil((Y0 + T * 32 - sy) / 32));
        for (let y = y0; y < y1; y++) {
          let i = (y * l.w + x0) * 2;
          const py = (y * 32 + sy - Y0) * k;
          for (let x = x0; x < x1; x++, i += 2) {
            const idx = data[i];
            if (idx === 0) continue;
            const m = TM[data[i + 1] & 15];
            g.setTransform(lod * m[0], lod * m[1], lod * m[2], lod * m[3], (x * 32 + sx - X0) * k + lod * m[4], py + lod * m[5]);
            g.drawImage(im, (idx & 15) * ts, (idx >> 4) * ts, ts, ts, 0, 0, 1, 1);
            any = true;
          }
        }
      });
    }
    const took = performance.now() - t0;
    st.budget -= took;
    st.builds++;
    st.buildMs += took;
    const out = any ? c : null;
    const px = out ? out.width * out.height : 0;
    st.chunks.set(key, { c: out, used: st.frameNo, px });
    st.chunkPx += px;
    evictChunks();
    return out;
  }

  function evictChunks(): void {
    const cap = Math.max(160, 2 * st.chunksDrawnLast);
    if (st.chunks.size <= cap && st.chunkPx <= CHUNK_PX_MAX) return;
    const old = [...st.chunks.entries()].filter((e) => e[1].used < st.frameNo - 1).sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of old) {
      if (st.chunks.size <= cap * 0.8 && st.chunkPx <= CHUNK_PX_MAX * 0.8) break;
      st.chunks.delete(k);
      st.chunkPx -= e.px;
    }
  }

  type View = { w: number; h: number; dpr: number; aspect: number };
  function viewOf(g: { px: number; py: number; ox: number; oy: number }, v: View): { l: number; t: number; s: number; ww: number; wh: number } {
    const r = groupView(st.cam.x, st.cam.y, st.zoom, v.aspect, g.px, g.py, g.ox, g.oy);
    return { l: r[0], t: r[1], s: v.w / r[2], ww: r[2], wh: r[3] };
  }
  function setWorld(gv: { l: number; t: number; s: number }, dpr: number): void {
    ctx.setTransform(gv.s * dpr, 0, 0, gv.s * dpr, -gv.l * gv.s * dpr, -gv.t * gv.s * dpr);
  }

  function drawTilePass(
    p: Pass | null,
    layers: Layer[],
    ent: boolean,
    g: Group,
    v: View,
    to: CanvasRenderingContext2D,
    wrap?: (c: HTMLCanvasElement, key: string) => HTMLCanvasElement | null,
  ): number[] | null {
    const gv = viewOf(g, v);
    const pxPerTile = 32 * gv.s * v.dpr;
    const { lod, tiles: T } = chunkLod(pxPerTile);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const l of layers) {
      const sx = ent ? 0 : (l.sx ?? 0);
      const sy = ent ? 0 : (l.sy ?? 0);
      minX = Math.min(minX, sx);
      minY = Math.min(minY, sy);
      maxX = Math.max(maxX, l.w * 32 + sx);
      maxY = Math.max(maxY, l.h * 32 + sy);
    }
    const span = T * 32;
    const cx0 = Math.max(Math.floor(minX / span), Math.floor(gv.l / span));
    const cy0 = Math.max(Math.floor(minY / span), Math.floor(gv.t / span));
    const cx1 = Math.min(Math.ceil(maxX / span) - 1, Math.floor((gv.l + gv.ww) / span));
    const cy1 = Math.min(Math.ceil(maxY / span) - 1, Math.floor((gv.t + gv.wh) / span));
    to.setTransform(1, 0, 0, 1, 0, 0);
    const k = gv.s * v.dpr;
    let box: number[] | null = null;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const base = chunk(p, layers, ent, lod, T, cx, cy);
        if (base === undefined) st.notReady = true;
        const c = base && wrap ? wrap(base, (p ? p.key : "e") + "|" + lod + "|" + cx + "|" + cy) : base;
        if (!c) continue;

        const x0 = Math.round((cx * span - gv.l) * k);
        const y0 = Math.round((cy * span - gv.t) * k);
        const x1 = Math.round(((cx + 1) * span - gv.l) * k);
        const y1 = Math.round(((cy + 1) * span - gv.t) * k);
        to.drawImage(c, x0, y0, x1 - x0, y1 - y0);
        if (box === null) box = [x0, y0, x1, y1];
        else {
          box[0] = Math.min(box[0], x0);
          box[1] = Math.min(box[1], y0);
          box[2] = Math.max(box[2], x1);
          box[3] = Math.max(box[3], y1);
        }
      }
    }
    return box;
  }

  function drawEnvTilePass(p: Pass, g: Group, v: View): void {
    const e = envAt(p.env, p.envOff, 4, [1, 1, 1, 1]);
    const a = Math.max(0, Math.min(1, e[3]));
    if (a < 1 / 255) return;
    const rgbFixed = st.envRgb[p.env] !== null;
    const q = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 32);
    const r = q(e[0]);
    const gg = q(e[1]);
    const b = q(e[2]);
    ctx.globalAlpha = a;
    if (rgbFixed || (r === 32 && gg === 32 && b === 32)) {
      drawTilePass(p, p.layers, false, g, v, ctx);
    } else {
      const tint = r + "," + gg + "," + b;
      const fill = "rgb(" + Math.round((r * 255) / 32) + "," + Math.round((gg * 255) / 32) + "," + Math.round((b * 255) / 32) + ")";
      drawTilePass(p, p.layers, false, g, v, ctx, (c, key) => {
        const hit = st.envChunks.get(key);
        if (hit && hit.tint === tint && hit.from === c) {
          hit.used = st.frameNo;
          return hit.c;
        }
        const t = hit && hit.c && hit.c.width === c.width && hit.c.height === c.height ? hit.c : canvas(c.width, c.height);
        if (!t) return c;
        const x = t.getContext("2d") as CanvasRenderingContext2D;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalCompositeOperation = "copy";
        x.drawImage(c, 0, 0);
        x.globalCompositeOperation = "multiply";
        x.fillStyle = fill;
        x.fillRect(0, 0, t.width, t.height);
        x.globalCompositeOperation = "destination-in";
        x.drawImage(c, 0, 0);
        x.globalCompositeOperation = "source-over";
        st.envChunks.set(key, { c: t, tint, from: c, used: st.frameNo });

        if (st.envChunks.size > 48) for (const [k, v] of st.envChunks) if (v.used < st.frameNo - 1) st.envChunks.delete(k);
        return t;
      });
    }
    ctx.globalAlpha = 1;
  }

  function drawQuads(l: Layer, g: Group, v: View): void {
    const gv = viewOf(g, v);
    setWorld(gv, v.dpr);
    const q = l.quads;
    const im = l.image >= 0 ? st.images[l.image] : null;
    if (l.image >= 0 && (!im || !im.ok)) {
      if (im && !im.bad) st.notReady = true;
      return;
    }
    const quant = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 32) / 32;
    const pts = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i + QUAD_REC <= q.length; i += QUAD_REC) {

      const colEnv = q[i + 36];
      let env = [1, 1, 1, 1];
      if (colEnv >= 0) {
        env = envAt(colEnv, q[i + 37], 4, [1, 1, 1, 1]);
        if (env[3] < 0.004) continue;
      }
      let ox = 0;
      let oy = 0;
      let rot = 0;
      if (q[i + 34] >= 0) {
        const pe = envAt(q[i + 34], q[i + 35], 3, [0, 0, 0]);
        ox = pe[0];
        oy = pe[1];
        rot = (pe[2] / 180) * Math.PI;
      }
      const cxp = q[i + 32];
      const cyp = q[i + 33];
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < 4; k++) {
        let x = q[i + k * 2];
        let y = q[i + k * 2 + 1];
        if (rot !== 0) {
          const dx = x - cxp;
          const dy = y - cyp;
          x = cxp + dx * cos - dy * sin;
          y = cyp + dx * sin + dy * cos;
        }
        x += ox;
        y += oy;
        pts[k * 2] = x;
        pts[k * 2 + 1] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < gv.l || minX > gv.l + gv.ww || maxY < gv.t || minY > gv.t + gv.wh) continue;
      const cornerA = q[i + 11] + q[i + 15] + q[i + 19] + q[i + 23];
      if (cornerA / 4 < 2.55) continue;
      const fixed = colEnv >= 0 ? st.envRgb[colEnv] : [1, 1, 1];
      const rgb = fixed ?? [quant(env[0]), quant(env[1]), quant(env[2])];
      if (!im) {
        let same = true;
        for (let k = 4; k < 16 && same; k++) if (q[i + 8 + k] !== q[i + 8 + (k % 4)]) same = false;
        if (same) {
          const r = Math.round(q[i + 8] * rgb[0]);
          const gg = Math.round(q[i + 9] * rgb[1]);
          const b = Math.round(q[i + 10] * rgb[2]);
          ctx.fillStyle = "rgba(" + r + "," + gg + "," + b + "," + (q[i + 11] / 255) * env[3] + ")";
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          ctx.lineTo(pts[2], pts[3]);
          ctx.lineTo(pts[6], pts[7]);
          ctx.lineTo(pts[4], pts[5]);
          ctx.closePath();
          ctx.fill();
          continue;
        }

        const n = Math.max(2, Math.min(64, Math.ceil(Math.max(maxX - minX, maxY - minY) / 24)));
        const key = l.id + ":" + i + "|" + n + "|" + rgb.join(",");
        let c2 = st.quadCache.get(key);
        if (c2 === undefined) {
          c2 = canvas(n, n);
          if (c2) {
            const x = c2.getContext("2d") as CanvasRenderingContext2D;
            const col: number[] = [];
            for (let k = 0; k < 16; k++) col.push(k % 4 === 3 ? q[i + 8 + k] : q[i + 8 + k] * rgb[k % 4]);
            const d = x.createImageData(n, n);
            d.data.set(gradientPixels(col, n));
            x.putImageData(d, 0, 0);
          }
          st.quadCache.set(key, c2);
          if (st.quadCache.size > 1500) st.quadCache.delete(st.quadCache.keys().next().value as string);
        }
        if (!c2) continue;
        ctx.save();
        const m = affine3([0, 0, 1, 0, 0, 1], [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.globalAlpha = Math.max(0, Math.min(1, env[3]));
        ctx.drawImage(c2, 0.5, 0.5, n - 1, n - 1, 0, 0, 1, 1);
        ctx.restore();
      } else {

        const r = Math.round(((q[i + 8] + q[i + 12] + q[i + 16] + q[i + 20]) / 4) * rgb[0]);
        const gg = Math.round(((q[i + 9] + q[i + 13] + q[i + 17] + q[i + 21]) / 4) * rgb[1]);
        const b = Math.round(((q[i + 10] + q[i + 14] + q[i + 18] + q[i + 22]) / 4) * rgb[2]);
        const e = tintEntry(l.image, r, gg, b);
        if (!e) continue;
        if (e.pat === undefined) e.pat = ctx.createPattern(e.c ?? im.el, "repeat");
        const pat = e.pat;
        if (!pat) continue;
        const W = im.el.naturalWidth;
        const H = im.el.naturalHeight;
        const m = affine3([q[i + 24] * W, q[i + 25] * H, q[i + 26] * W, q[i + 27] * H, q[i + 28] * W, q[i + 29] * H], [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
        try {
          pat.setTransform(new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
        } catch {
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, (cornerA / 4 / 255) * env[3]));
        ctx.fillStyle = pat;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        ctx.lineTo(pts[2], pts[3]);
        ctx.lineTo(pts[6], pts[7]);
        ctx.lineTo(pts[4], pts[5]);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawPass(p: Pass, v: View): void {
    const sc = st.scene;
    if (!sc) return;
    const g = sc.groups[p.g];
    if (g.clip) {

      const gv = viewOf({ px: 100, py: 100, ox: 0, oy: 0 }, v);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      const k = gv.s * v.dpr;
      ctx.rect((g.clip[0] - gv.l) * k, (g.clip[1] - gv.t) * k, g.clip[2] * k, g.clip[3] * k);
      ctx.clip();
    }
    if (p.kind === "tiles") {
      if (p.env >= 0) drawEnvTilePass(p, g, v);
      else drawTilePass(p, p.layers, false, g, v, ctx);
    } else drawQuads(p.layers[0], g, v);
    if (g.clip) ctx.restore();
  }

  function sceneMissing(): boolean {
    for (const p of st.passes) {
      if (p.kind !== "tiles") continue;
      for (const l of p.layers) {
        if (l.image < 0) continue;
        const im = st.images[l.image];
        if (!im || im.bad || !im.ok) return true;
      }
    }
    return false;
  }

  function drawKinds(v: View, alpha: number): void {
    const m = st.liveMap;
    if (!m) return;
    const gv = viewOf({ px: 100, py: 100, ox: 0, oy: 0 }, v);
    setWorld(gv, v.dpr);
    const x0 = Math.max(0, Math.floor(gv.l / 32));
    const y0 = Math.max(0, Math.floor(gv.t / 32));
    const x1 = Math.min(m.width - 1, Math.ceil((gv.l + gv.ww) / 32));
    const y1 = Math.min(m.height - 1, Math.ceil((gv.t + gv.wh) / 32));
    const cols = ["", opt.css("--solid"), opt.css("--freeze"), opt.css("--death"), opt.css("--unfreeze"), opt.css("--nohook"), opt.css("--tele")];
    ctx.globalAlpha = alpha;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = m.k[y * m.width + x];
        if (!k) continue;
        ctx.fillStyle = cols[k] || cols[4];
        ctx.fillRect(x * 32, y * 32, 32.5, 32.5);
        if (gv.s > 0.35) {
          const up = y > 0 ? m.k[(y - 1) * m.width + x] : 0;
          const dn = y + 1 < m.height ? m.k[(y + 1) * m.width + x] : 0;
          if (up !== k) {
            ctx.fillStyle = "rgba(255,255,255,.08)";
            ctx.fillRect(x * 32, y * 32, 32, 3);
          }
          if (dn !== k) {
            ctx.fillStyle = "rgba(0,0,0,.25)";
            ctx.fillRect(x * 32, y * 32 + 29, 32, 3);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTraps(v: View): void {
    const m = st.liveMap;
    if (!m || !m.t || !st.show.traps) return;
    const gv = viewOf({ px: 100, py: 100, ox: 0, oy: 0 }, v);
    setWorld(gv, v.dpr);
    ctx.fillStyle = opt.css("--trap");
    const x0 = Math.max(0, Math.floor(gv.l / 32));
    const y0 = Math.max(0, Math.floor(gv.t / 32));
    const x1 = Math.min(m.width - 1, Math.ceil((gv.l + gv.ww) / 32));
    const y1 = Math.min(m.height - 1, Math.ceil((gv.t + gv.wh) / 32));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.t[y * m.width + x]) ctx.fillRect(x * 32, y * 32, 32, 32);
  }

  function kindAt(x: number, y: number): number {
    const m = st.liveMap;
    if (!m) return 0;
    const tx = Math.floor(x / 32);
    const ty = Math.floor(y / 32);
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return 1;
    return m.k[ty * m.width + tx];
  }
  function solidAt(x: number, y: number): boolean {
    const k = kindAt(x, y);
    return k === 1 || k === 5;
  }

  function pushFrame(f: Frame): void {
    const now = performance.now();
    const last = st.frames[st.frames.length - 1];
    if (last && (f.tick < last.f.tick - 50 || f.map !== last.f.map)) {
      st.frames = [];
      st.clock = null;

      st.camSet = false;
    }
    if (last && f.tick === last.f.tick) {
      st.frames[st.frames.length - 1] = { f, at: now };
    } else st.frames.push({ f, at: now });
    if (st.frames.length > 12) st.frames.shift();
    st.clock = tickClock(st.clock, f.tick, now);
    for (const e of f.emoticons ?? []) {
      const start = now - e.age;
      const old = st.emotes.get(e.id);
      if (!old || Math.abs(old.start - start) > 300) st.emotes.set(e.id, { e: e.e, start });
    }

    for (const t of f.tees) {
      const was = st.lastTees.get(t.id);
      if (was && !was.frozen && t.frozen) addFeed(t.id, (t.name || "#" + t.id) + " заморожен", t.id !== f.selfId, "freeze");
      if (was && was.frozen && !t.frozen) addFeed(t.id, (t.name || "#" + t.id) + " разморожен", t.id === f.selfId, "thaw");
    }
    st.lastTees = new Map(f.tees.map((t) => [t.id, t]));
    if (f.players && f.players.length) st.lastPlayers = new Map(f.players.map((p) => [p.id, p]));
  }
  function addFeed(id: number, text: string, good: boolean, kind: string): void {
    const now = performance.now();

    if (st.feed.some((e) => e.id === id && e.kind !== "note" && now - e.at < 3000)) return;
    st.feed.push({ id, text, good, kind, at: now });
    if (st.feed.length > 8) st.feed.shift();
  }

  function lerpAngle(a: number, b: number, k: number): number {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * k;
  }

  function current(now: number): { f: Frame; tees: Tee[]; tickF: number } | null {
    const fr = st.frames;
    if (fr.length === 0) return null;
    const newest = fr[fr.length - 1];
    if (fr.length === 1 || st.clock === null) return { f: newest.f, tees: newest.f.tees, tickF: newest.f.tick };
    const rt = (now + st.clock - 100) / 20;
    let a = fr[0];
    let b = fr[0];
    for (let i = 1; i < fr.length; i++) {
      if (fr[i].f.tick >= rt) {
        a = fr[i - 1];
        b = fr[i];
        break;
      }
      a = fr[i];
      b = fr[i];
    }
    const span = b.f.tick - a.f.tick;
    const k = span > 0 ? Math.max(0, Math.min(1, (rt - a.f.tick) / span)) : 1;
    const prev = new Map(a.f.tees.map((t) => [t.id, t]));
    const tees = b.f.tees.map((t) => {
      const o = prev.get(t.id);
      if (!o || Math.hypot(t.x - o.x, t.y - o.y) > 300) return t;
      return {
        ...t,
        x: o.x + (t.x - o.x) * k,
        y: o.y + (t.y - o.y) * k,
        hx: o.hx + (t.hx - o.hx) * k,
        hy: o.hy + (t.hy - o.hy) * k,
        aim: t.aim !== undefined && o.aim !== undefined ? lerpAngle(o.aim, t.aim, k) : t.aim,
        vx: o.vx !== undefined && t.vx !== undefined ? o.vx + (t.vx - o.vx) * k : t.vx,
        atk: t.atk,
      };
    });
    return { f: b.f, tees, tickF: a.f.tick + span * k };
  }

  function spr(img: AnyImg, r: number[], x: number, y: number, w: number, h: number, rot: number): void {
    if (rot === 0 && w > 0) {
      ctx.drawImage(img, r[0], r[1], r[2], r[3], x - w / 2, y - h / 2, w, h);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    if (w < 0) ctx.scale(-1, 1);
    const aw = Math.abs(w);
    ctx.drawImage(img, r[0], r[1], r[2], r[3], -aw / 2, -h / 2, aw, h);
    ctx.restore();
  }

  function teeRects(img: AnyImg) {
    const W = (img as HTMLImageElement).naturalWidth || img.width;
    const H = (img as HTMLImageElement).naturalHeight || img.height;
    const g = SPRITES.tee;
    return {
      body: spriteRect(SPRITES.body, g, W, H),
      bodyO: spriteRect(SPRITES.bodyOutline, g, W, H),
      foot: spriteRect(SPRITES.foot, g, W, H),
      footO: spriteRect(SPRITES.footOutline, g, W, H),
      hand: spriteRect(SPRITES.hand, g, W, H),
      handO: spriteRect(SPRITES.handOutline, g, W, H),
      eyes: SPRITES.eyes.map((e) => spriteRect(e, g, W, H)),
    };
  }

  function renderTee(img: AnyImg, anim: { body: number[]; back: number[]; front: number[] }, emote: number, dx: number, dy: number, x: number, y: number, alpha: number): void {
    const R = teeRects(img);
    const bx = x + anim.body[0];
    const by = y + anim.body[1];
    ctx.globalAlpha = alpha;
    for (let pass = 0; pass < 2; pass++) {
      const outline = pass === 0;
      for (let filling = 0; filling < 2; filling++) {
        if (filling === 1) {
          spr(img, outline ? R.bodyO : R.body, bx, by, 64, 64, anim.body[2] * Math.PI * 2);
          if (!outline) {
            const eye = emote === 1 ? 2 : emote === 2 ? 3 : emote === 3 ? 5 : emote === 4 ? 1 : 0;
            const es = 64 * 0.4;
            const eh = emote === 5 ? 64 * 0.15 : es;
            const sep = (0.075 - 0.01 * Math.abs(dx)) * 64;
            const ox = dx * 0.125 * 64;
            const oy = (-0.05 + dy * 0.1) * 64;
            spr(img, R.eyes[eye], bx - sep + ox, by + oy, es, eh, 0);
            spr(img, R.eyes[eye], bx + sep + ox, by + oy, -es, eh, 0);
          }
        }
        const foot = filling ? anim.front : anim.back;
        spr(img, outline ? R.footO : R.foot, x + foot[0], y + foot[1], 64, 32, foot[2] * Math.PI * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function renderHand(img: AnyImg, cx: number, cy: number, dx: number, dy: number, angleOff: number, postX: number, postY: number, alpha: number): void {
    const R = teeRects(img);
    let ny = -dy;
    let nx = dx;
    if (dx < 0) {
      ny = -ny;
      nx = -nx;
    }

    const hx = cx + dx + dx * postX + ny * postY;
    const hy = cy + dy + dy * postX + nx * postY;
    const a = Math.atan2(dy, dx);
    const ang = dx < 0 ? a - angleOff : a + angleOff;
    ctx.globalAlpha = alpha;
    spr(img, R.handO, hx, hy, 20, 20, ang);
    spr(img, R.hand, hx, hy, 20, 20, ang);
    ctx.globalAlpha = 1;
  }

  function renderWeapon(t: Tee, atlas: AnyImg, anim: { attach: number[] }, dx: number, dy: number, attackSec: number): void {
    const game = sheets.game;
    if (!game || !game.ok || t.frozen) return;
    const wp = Math.max(0, Math.min(5, t.wp ?? 0));
    const spec = SPRITES.weapons[wp];
    const r = spriteRect(spec.body, SPRITES.game, game.el.naturalWidth, game.el.naturalHeight);
    const sc = spriteScale(spec.body);
    const w = spec.size * sc[0];
    const h = spec.size * sc[1];
    const flip = dx < 0;
    const angle = Math.atan2(dy, dx);
    const att = anim.attach[2] * Math.PI * 2;
    if (wp === 0 || wp === 5) {
      let x = t.x + anim.attach[0];
      const y = t.y + anim.attach[1] + spec.oy;
      if (flip) x -= spec.ox;
      const rot = flip ? -Math.PI / 2 - att : -Math.PI / 2 + att;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      if (flip) ctx.scale(1, -1);
      ctx.drawImage(game.el, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }
    const ticks = attackSec * 50;
    const recoil = ticks / 5 < 1 ? Math.sin((ticks / 5) * Math.PI) : 0;
    const x = t.x + dx * spec.ox - dx * recoil * 10;
    const y = t.y + dy * spec.ox - dy * recoil * 10 + spec.oy;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(att + angle);
    if (flip) ctx.scale(1, -1);
    ctx.drawImage(game.el, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h);
    ctx.restore();
    if (wp === 1) renderHand(atlas, x, y, dx, dy, (-3 * Math.PI) / 4, -15, 4, 1);
    else if (wp === 2) renderHand(atlas, x, y, dx, dy, -Math.PI / 2, -5, 4, 1);
    else if (wp === 3) renderHand(atlas, x, y, dx, dy, -Math.PI / 2, -4, 7, 1);
  }

  function renderHook(t: Tee, byId: Map<number, Tee>, atlas: AnyImg | null): void {
    if (t.hook <= 0) return;
    let hx = t.hx;
    let hy = t.hy;
    if (t.hooked >= 0) {
      const o = byId.get(t.hooked);
      if (o) {
        hx = o.x;
        hy = o.y;
      }
    }
    const d = Math.hypot(t.x - hx, t.y - hy);
    if (d < 1) return;
    const dx = (t.x - hx) / d;
    const dy = (t.y - hy) / d;
    const rot = Math.atan2(dy, dx) + Math.PI;
    const game = sheets.game;
    if (game && game.ok) {
      const W = game.el.naturalWidth;
      const H = game.el.naturalHeight;
      const head = spriteRect(SPRITES.hookHead, SPRITES.game, W, H);
      const link = spriteRect(SPRITES.hookChain, SPRITES.game, W, H);
      for (let f = 24; f < d && f < 24 * 1024; f += 24) spr(game.el, link, hx + dx * f, hy + dy * f, 24, 16, rot);
      spr(game.el, head, hx, hy, 24, 16, rot);
      if (atlas) renderHand(atlas, t.x, t.y, -dx, -dy, -Math.PI / 2, 20, 0, 1);
    } else {
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = "#bfbfbf";
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, 6.2832);
      ctx.fill();
    }
  }

  function renderPlainTee(t: { x: number; y: number; frozen?: boolean }, dx: number, dy: number, color: string): void {
    ctx.fillStyle = "rgba(0,0,0,.55)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(t.x + s * 7, t.y + 12, 13, 7, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(t.x, t.y - 4, 28, 0, 6.2832);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.stroke();
    if (!t.frozen) {
      for (const s of [-1, 1]) {
        const ex = t.x + dx * 8 + s * 7;
        const ey = t.y - 7 + dy * 6;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(ex, ey, 5, 8, 0, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(ex + dx * 2, ey + dy * 2, 3, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  function freezeBarOf(t: Tee): number | null {
    if (!t.frozen || t.deep) return null;
    const inFreeze = t.xf !== undefined ? (t.xf & CHARFLAG.inFreeze) !== 0 : kindAt(t.x, t.y) === 2;
    if (inFreeze) return null;
    const left = t.fz ?? 0;
    const whole = t.fzf !== undefined ? left + t.fzf : Math.max(150, left);
    if (left <= 0 || whole <= 0) return null;
    return Math.max(0, Math.min(1, left / whole));
  }
  function renderFreezeBar(x0: number, y0: number, progress: number): void {
    const hud = sheets.hud;
    const x = x0 - 32;
    const y = y0 + 32;
    if (hud && hud.ok) {
      const W = hud.el.naturalWidth;
      const H = hud.el.naturalHeight;
      const g = SPRITES.hud;
      const rects: Record<string, number[]> = {
        fullLeft: spriteRect(SPRITES.freezeBarFullLeft, g, W, H),
        full: spriteRect(SPRITES.freezeBarFull, g, W, H),
        empty: spriteRect(SPRITES.freezeBarEmpty, g, W, H),
        emptyRight: spriteRect(SPRITES.freezeBarEmptyRight, g, W, H),
      };
      for (const p of freezeBarPieces(progress)) {
        if (p.w <= 0) continue;
        const r = rects[p.s];
        const u0 = Math.min(p.u0, p.u1);
        const uw = Math.abs(p.u1 - p.u0);
        if (uw <= 0) continue;
        if (p.u0 <= p.u1) {
          ctx.drawImage(hud.el, r[0] + u0 * r[2], r[1], uw * r[2], r[3], x + p.x, y, p.w, 16);
        } else {

          ctx.save();
          ctx.translate(x + p.x + p.w, y);
          ctx.scale(-1, 1);
          ctx.drawImage(hud.el, r[0] + u0 * r[2], r[1], uw * r[2], r[3], 0, 0, p.w, 16);
          ctx.restore();
        }
      }
    } else {
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(x, y + 4, 64, 8);
      ctx.fillStyle = "#cfe8ff";
      ctx.fillRect(x + 1, y + 5, 62 * progress, 6);
    }
  }

  function renderEmote(t: Tee, now: number): void {
    const em = sheets.emoticons;
    if (!em || !em.ok) return;
    const W = em.el.naturalWidth;
    const H = em.el.naturalHeight;
    if (((t.pf ?? 0) & 4) !== 0) {
      spr(em.el, spriteRect([0, 1, 1, 1], SPRITES.emoticons, W, H), t.x + 24, t.y - 40, 64, 64, 0);
    }
    const e = st.emotes.get(t.id);
    if (!e) return;
    const since = (now - e.start) / 1000;
    const fromEnd = 2 - since;
    if (since < 0 || fromEnd <= 0) return;
    const a = fromEnd < 0.2 ? fromEnd / 0.2 : 1;
    const h = since < 0.1 ? since / 0.1 : 1;
    const wig = since < 0.2 ? since / 0.2 : 0;
    const cell = [e.e % 4, Math.floor(e.e / 4) % 4, 1, 1];
    ctx.globalAlpha = a;
    spr(em.el, spriteRect(cell, SPRITES.emoticons, W, H), t.x, t.y - 23 - 32 * h, 64, 64 * h, (Math.PI / 6) * Math.sin(5 * wig));
    ctx.globalAlpha = 1;
  }

  function spawnFlakes(tees: Tee[], dt: number): void {
    st.flakeClock += dt;
    if (st.flakeClock < 0.2) return;
    st.flakeClock %= 0.2;
    for (const t of tees) {
      if (!t.frozen) continue;
      st.flakes.push({
        x: t.x + (Math.random() - 0.5) * 32,
        y: t.y - 4 + (Math.random() - 0.5) * 32,
        vx: 0,
        vy: 0,
        g: Math.random() * 250,
        rot: Math.random() * Math.PI * 2,
        life: 0,
        size: (0.5 + Math.random()) * 16,
      });
    }
    if (st.flakes.length > 600) st.flakes.splice(0, st.flakes.length - 600);
  }
  function renderFlakes(dt: number): void {
    const ex = sheets.extras;
    if (!ex || !ex.ok) {
      st.flakes = [];
      return;
    }
    st.frictionClock += dt;
    if (st.frictionClock > 2) st.frictionClock = 0;
    let steps = 0;
    while (st.frictionClock > 0.05) {
      steps++;
      st.frictionClock -= 0.05;
    }
    const r = spriteRect(SPRITES.snowflake, { gx: 16, gy: 16 }, ex.el.naturalWidth, ex.el.naturalHeight);
    st.flakes = st.flakes.filter((p) => p.life < 1.5);
    for (const p of st.flakes) {
      flakeStep(p, dt, steps);
      const a = Math.min(1, p.life / 1.5);
      const size = p.size * (1 - 0.5 * a);
      ctx.globalAlpha = Math.max(0, 1 - a);
      spr(ex.el, r, p.x, p.y, size, size, p.rot);
    }
    ctx.globalAlpha = 1;
  }

  function draw(): void {
    const now = performance.now();
    const dt = st.lastDraw ? Math.min(0.1, (now - st.lastDraw) / 1000) : 0.016;
    st.lastDraw = now;
    st.frameNo++;
    st.budget = 8;
    st.chunksDrawnLast = st.chunksDrawn;
    st.chunksDrawn = 0;
    st.fpsAcc += dt;
    st.fpsN++;
    if (now - st.fpsAt > 500) {
      st.fps = Math.round(st.fpsN / Math.max(0.001, st.fpsAcc));
      st.fpsAcc = 0;
      st.fpsN = 0;
      st.fpsAt = now;
    }
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const v: View = { w: rect.width, h: rect.height, dpr, aspect: rect.width / Math.max(1, rect.height) };
    const cur = current(now);
    const byId = new Map<number, Tee>();
    if (cur) for (const t of cur.tees) byId.set(t.id, t);

    st.envMs = cur ? Math.max(0, (cur.tickF - (cur.f.roundStart ?? 0)) * 20) : 0;

    const followId = cur ? (st.spec >= 0 && byId.has(st.spec) ? st.spec : cur.f.selfId) : -1;
    if (cur && st.follow) {
      const t = byId.get(followId);
      if (t) {
        const lf = st.lastFollow;
        const jumped = lf.id === t.id && Math.hypot(t.x - lf.x, t.y - lf.y) > 300;
        if (!st.camSet || jumped) {
          st.cam.x = t.x;
          st.cam.y = t.y;
          st.camSet = true;
        }
        const k = 1 - Math.exp(-dt * 14);
        st.cam.x += (t.x - st.cam.x) * k;
        st.cam.y += (t.y - st.cam.y) * k;
      }
    }
    const ft = byId.get(followId);
    st.lastFollow = ft ? { id: ft.id, x: ft.x, y: ft.y } : { id: -1, x: 0, y: 0 };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sc = st.scene;
    const showMap = sc !== null && st.mode !== "ent";
    ctx.fillStyle = st.mode === "ent" ? "#7f7f7f" : opt.css("--sky") || "#0d0f12";
    ctx.fillRect(0, 0, W, H);

    const ownBase = sc === null || (showMap && sceneMissing());
    if (showMap) {
      let kindsDone = !ownBase;
      let from = 0;
      if (st.staticN > 0) {
        from = st.staticN;
        const key = W + "x" + H + "|" + dpr + "|" + st.sceneGen;
        if (st.bgKey !== key || !st.bgCache) {
          const c = st.bgCache && st.bgCache.width === W && st.bgCache.height === H ? st.bgCache : canvas(W, H);
          if (c) {
            const saved = ctx;
            ctx = c.getContext("2d") as CanvasRenderingContext2D;
            st.notReady = false;
            try {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.globalAlpha = 1;
              ctx.fillStyle = opt.css("--sky") || "#0d0f12";
              ctx.fillRect(0, 0, W, H);
              for (let i = 0; i < st.staticN; i++) drawPass(st.passes[i], v);
            } finally {
              ctx = saved;
            }
            st.bgCache = c;

            st.bgKey = st.notReady ? "" : key;
          } else from = 0;
        }
        if (from > 0 && st.bgCache) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(st.bgCache, 0, 0);
        }
      }
      for (let i = from; i < st.passes.length; i++) {
        const p = st.passes[i];
        if (p.side !== "bg") continue;
        if (!kindsDone && st.gameGroup >= 0 && p.layers.some((l) => (l.g ?? p.g) >= st.gameGroup)) {
          drawKinds(v, 1);
          kindsDone = true;
        }
        drawPass(p, v);
      }
      if (!kindsDone) drawKinds(v, 1);
    }
    const entOk = sc !== null && sheets.ent !== null && sheets.ent.ok && st.entLayers.length > 0;
    if (sc === null) drawKinds(v, 1);
    else if (st.mode !== "map") {
      if (entOk) {
        for (const e of st.entLayers) drawTilePass(null, [e.layer], true, sc.groups[e.g], v, ctx);
      } else drawKinds(v, st.mode === "both" ? 0.55 : 1);
    }
    drawTraps(v);

    const gv = viewOf({ px: 100, py: 100, ox: 0, oy: 0 }, v);
    setWorld(gv, dpr);

    if (cur && st.show.route && cur.f.route && cur.f.route.length) {
      ctx.strokeStyle = opt.css("--acc") || "#a8cbee";
      ctx.lineWidth = 3 / gv.s;
      ctx.setLineDash([12 / gv.s, 8 / gv.s]);
      ctx.beginPath();
      const me = byId.get(cur.f.selfId);
      const pts = cur.f.route.map((s) => ({ x: s.x * 32 + 16, y: s.y * 32 + 16, kind: s.kind }));
      if (me) ctx.moveTo(me.x, me.y);
      else ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of pts) {
        if (p.kind === "walk" || p.kind === "fall") continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, 6.2832);
        ctx.fillStyle = p.kind === "hook" ? opt.css("--acc") : p.kind === "kill" ? opt.css("--bad") : opt.css("--ok");
        ctx.fill();
      }
      if (cur.f.goal) {
        ctx.strokeStyle = opt.css("--ok");
        ctx.lineWidth = 3 / gv.s;
        ctx.beginPath();
        ctx.arc(cur.f.goal.x, cur.f.goal.y, 16, 0, 6.2832);
        ctx.stroke();
      }
    }

    const order: Tee[] = [];
    const bars: { x: number; y: number; p: number }[] = [];
    if (cur) {
      for (const t of cur.tees) if (t.id !== followId) order.push(t);
      if (ft) order.push(ft);
      const skinsOk = skinsAsked && skin("default").img.ok;
      const atlases = new Map<number, AnyImg | null>();
      for (const t of order) atlases.set(t.id, skinsOk ? teeAtlas(t, ((t.jumped ?? 0) & 2) !== 0, false) : null);
      for (const t of order) if (t.id !== cur.f.selfId) renderHook(t, byId, atlases.get(t.id) ?? null);
      const own = byId.get(cur.f.selfId);
      if (own) renderHook(own, byId, atlases.get(own.id) ?? null);
      for (const t of order) {
        const aim = t.aim ?? 0;
        let dx = Math.cos(aim);
        let dy = Math.sin(aim);
        if (t.aim === undefined) {
          dx = (t.vx ?? 0) >= 0 ? 1 : -1;
          dy = 0;
        }
        const atlas = atlases.get(t.id) ?? null;
        const inAir = st.liveMap ? !solidAt(t.x, t.y + 16) : Math.abs(t.vy ?? 0) > 0.01;
        const attackSec = (t.atk ?? 50) / 50;
        const anim = teeAnimFor(t.vx ?? 0, inAir, t.dir ?? 0, t.x, attackSec, t.frozen ? -1 : (t.wp ?? 0));
        if (atlas) {
          renderWeapon(t, atlas, anim, dx, dy, attackSec);
          const emote = t.emote ?? (t.frozen ? 1 : 0);
          renderTee(atlas, anim, emote, dx, dy, t.x, t.y, 1);
        } else {
          const col = t.frozen ? opt.css("--freeze") : t.id === cur.f.selfId ? opt.css("--ok") : t.id === cur.f.target ? opt.css("--bad") : opt.css("--dim");
          renderPlainTee(t, dx, dy, col);
        }
        renderEmote(t, now);
        const bar = freezeBarOf(t);
        if (bar !== null) bars.push({ x: t.x, y: t.y, p: bar });
      }
      spawnFlakes(order, dt);
    }

    if (showMap) {
      for (const p of st.passes) if (p.side === "fg") drawPass(p, v);
    }

    const k = gv.s;
    const tiny = 64 * k < 10;
    if (cur && st.show.names && !tiny && k > 0.28) renderPlates(order, cur.f, gv, v);

    setWorld(gv, dpr);
    if (cur) renderFlakes(dt);
    for (const b of bars) renderFreezeBar(b.x, b.y, b.p);

    if (cur && tiny) renderMarkers(order, cur.f, gv, v);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cur) {
      renderHud(cur.f, byId, v, now);
      if (st.show.cursor) renderCursor(cur.f, byId, gv, v);
      if (st.show.board) renderBoard(cur.f, byId, v);
    }

    const own = ownBase || (st.mode !== "map" && !entOk);
    opt.onInfo?.({ spec: st.spec, zoom: st.zoom, fps: st.fps, data: st.data, scene: st.scene !== null, own });
  }

  const FONT = '"DejaVu Sans DDNet","DejaVu Sans",ui-sans-serif,system-ui,sans-serif';

  function renderPlates(tees: Tee[], f: Frame, gv: { l: number; t: number; s: number }, v: View): void {
    const k = gv.s;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    const arrow = sheets.arrow && sheets.arrow.ok ? sheets.arrow.el : null;
    for (const t of tees) {
      const sx = (t.x - gv.l) * k;
      const sy = (t.y - gv.t) * k;
      if (sx < -400 || sx > v.w + 400 || sy < -100 || sy > v.h + 800) continue;
      const local = t.id === f.selfId;
      let bottom = t.y - 30;
      if (!local) {
        if (arrow) {
          const cy = (bottom - 18 - gv.t) * k;
          const size = 24 * k;
          const parts: [number, number, boolean][] = [
            [-29, Math.PI, t.dir === -1],
            [0, -Math.PI / 2, ((t.jumped ?? 0) & 1) !== 0],
            [29, 0, t.dir === 1],
          ];
          for (const [ox, rot, on] of parts) {
            if (!on) continue;
            ctx.save();
            ctx.translate(sx + ox * k, cy);
            ctx.rotate(rot);
            ctx.drawImage(arrow, -size / 2, -size / 2, size, size);
            ctx.restore();
          }
        }
        bottom -= 36;
      }

      const foe = t.id === f.target;
      const label = t.name || "#" + t.id;
      ctx.font = (28 * k).toFixed(1) + "px " + FONT;
      ctx.lineWidth = Math.max(2, 4 * k);
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      const ny = (bottom - 2.5 - gv.t) * k;
      ctx.strokeText(label, sx, ny);
      ctx.fillStyle = foe ? "#ffc6ba" : "#fff";
      ctx.fillText(label, sx, ny);
      if (t.clan && st.show.clans) {
        const cy = (bottom - 33 - 2.5 - gv.t) * k;
        ctx.font = (24 * k).toFixed(1) + "px " + FONT;
        ctx.strokeText(t.clan, sx, cy);
        ctx.fillStyle = "#fff";
        ctx.fillText(t.clan, sx, cy);
      }
    }
    ctx.textAlign = "left";
  }

  function renderCursor(f: Frame, byId: Map<number, Tee>, gv: { l: number; t: number; s: number }, v: View): void {
    const own = byId.get(f.selfId);
    if (!own || !f.cursor) return;
    const k = gv.s;
    let x = (own.x + f.cursor.x - gv.l) * k;
    let y = (own.y + f.cursor.y - gv.t) * k;
    const hx = v.w / 2;
    const hy = v.h / 2;
    const clamp = Math.max(1, Math.abs((x - hx) / hx), Math.abs((y - hy) / hy));
    let alpha = 1;
    if (clamp !== 1) {
      x = hx + (x - hx) / clamp;
      y = hy + (y - hy) / clamp;
      alpha = 0.5;
    }
    const game = sheets.game;
    ctx.globalAlpha = alpha;
    if (game && game.ok) {
      const cell = SPRITES.cursors[Math.max(0, Math.min(5, own.wp ?? 0))];
      const r = spriteRect(cell, SPRITES.game, game.el.naturalWidth, game.el.naturalHeight);
      const sc = spriteScale(cell);
      spr(game.el, r, x, y, 64 * sc[0] * k, 64 * sc[1] * k, 0);
    } else {
      const s = Math.max(6, 14 * k);
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s, y);
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function renderMarkers(tees: Tee[], f: Frame, gv: { l: number; t: number; s: number }, v: View): void {
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    for (const t of tees) {
      const x = (t.x - gv.l) * gv.s;
      const y = (t.y - gv.t) * gv.s;
      const me = t.id === f.selfId;
      const r = me ? 5 : 4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fillStyle = me ? opt.css("--ok") || "#9fe8b0" : t.id === f.target ? opt.css("--bad") || "#ffb09c" : t.id === st.spec ? opt.css("--acc") || "#a9d0ff" : t.frozen ? opt.css("--freeze") || "#4d8fc9" : "#fff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.stroke();
    }
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function looksOf(id: number, fallback?: Looks): Looks | undefined {
    return st.lastPlayers.get(id) ?? st.lastTees.get(id) ?? fallback;
  }
  function uiTee(info: Looks | undefined, x: number, y: number, size: number): void {
    if (!info) return;
    const atlas = skinsAsked && skin("default").img.ok ? teeAtlas(info, false, true) : null;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 64, size / 64);
    const anim = teeAnimFor(0, false, 0, 0, 1, -1);
    if (atlas) renderTee(atlas, anim, 0, 1, 0, 0, 0, 1);
    else renderPlainTee({ x: 0, y: 0 }, 1, 0, opt.css("--dim"));
    ctx.restore();
  }

  function teeIcon(info: Looks, px: number): string | null {
    const key = (info.skin || "default") + "|" + (info.cc ? (info.cb ?? 0) + "/" + (info.cf ?? 0) : "o") + "|" + px;
    const hit = st.icons.get(key);
    if (hit !== undefined) return hit;
    if (!skinsAsked) return null;
    const def = skin("default");
    if (def.img.bad) return "";
    const atlas = def.img.ok ? teeAtlas(info, false, true) : null;
    if (!atlas) return null;
    const s = skin(info.skin || "default");
    if (!s.img.ok && !s.img.bad) return null;
    const c = canvas(px, px);
    if (!c) return "";
    const saved = ctx;
    let url = "";
    try {
      ctx = c.getContext("2d") as CanvasRenderingContext2D;
      ctx.setTransform(px / 80, 0, 0, px / 80, 0, 0);
      renderTee(atlas, teeAnimFor(0, false, 0, 0, 1, -1), 0, 1, 0, 40, 40, 1);
      url = c.toDataURL("image/png");
    } catch {
      url = "";
    } finally {
      ctx = saved;
    }
    st.icons.set(key, url);
    if (st.icons.size > 200) st.icons.delete(st.icons.keys().next().value as string);
    return url;
  }

  function renderHud(f: Frame, byId: Map<number, Tee>, v: View, now: number): void {
    const self = (f.players ?? []).find((p) => p.id === f.selfId);
    const who = byId.get(st.spec >= 0 && byId.has(st.spec) ? st.spec : f.selfId);
    const game = sheets.game;
    const hud = sheets.hud;
    if (who && game && game.ok && hud && hud.ok) {
      const u = v.h / 300;
      ctx.save();
      ctx.scale(u, u);
      const gw = game.el.naturalWidth;
      const gh = game.el.naturalHeight;
      const held = who.wp ?? 0;
      const widths = [16, 12, 12, 12, 12, 12];
      const first = [-3, -4, -1, -1, -2, -4];
      let x = 17;
      hudWeapons(who.xf, held).forEach((w, i) => {
        if (i === 0) x += first[w];
        const spec = SPRITES.weapons[w];
        const r = spriteRect(spec.body, SPRITES.game, gw, gh);
        const sc = spriteScale(spec.body);
        const ww = spec.size * sc[0] * 0.25;
        const hh = spec.size * sc[1] * 0.25;
        ctx.globalAlpha = held === w ? 1 : 0.4;
        ctx.save();
        ctx.translate(x, 17);
        ctx.rotate((Math.PI * 7) / 4);
        ctx.drawImage(game.el, r[0], r[1], r[2], r[3], -ww / 2, -hh / 2, ww, hh);
        ctx.restore();
        x += widths[w];
      });
      ctx.globalAlpha = 1;
      const hw = hud.el.naturalWidth;
      const hh = hud.el.naturalHeight;
      const icon = (cell: number[], ix: number, iy: number): void => {
        const r = spriteRect(cell, SPRITES.hud, hw, hh);
        ctx.drawImage(hud.el, r[0], r[1], r[2], r[3], ix, iy, 12, 12);
      };
      const j = jumpIcons(who.jt, who.jl, who.jumped ?? 0);
      for (let i = 0; i < j.total; i++) icon(i < j.avail ? SPRITES.airjump : SPRITES.airjumpEmpty, 5 + i * 12, 29);
      let y = 29;
      if (j.total > 0) y += 12;
      const xf = who.xf ?? 0;
      const got = (w: number): boolean => (xf & (CHARFLAG.weaponHammer << w)) !== 0;
      const row = (cells: number[][]): boolean => {
        cells.forEach((c, i) => icon(c, 5 + i * 12, y));
        return cells.length > 0;
      };
      const caps: number[][] = [];
      if (xf & CHARFLAG.endlessJump) caps.push(SPRITES.endlessJump);
      if (xf & CHARFLAG.endlessHook) caps.push(SPRITES.endlessHook);
      if (xf & CHARFLAG.jetpack) caps.push(SPRITES.jetpack);
      if (xf & CHARFLAG.teleGun && got(1)) caps.push(SPRITES.teleGun);
      if (xf & CHARFLAG.teleGrenade && got(3)) caps.push(SPRITES.teleGrenade);
      if (xf & CHARFLAG.teleLaser && got(4)) caps.push(SPRITES.teleLaser);
      if (row(caps)) y += 12;
      const nos: number[][] = [];
      if (xf & CHARFLAG.solo) nos.push(SPRITES.solo);
      if (xf & CHARFLAG.collisionOff) nos.push(SPRITES.collisionOff);
      if (xf & CHARFLAG.hookHitOff) nos.push(SPRITES.hookHitOff);
      if (xf & CHARFLAG.hammerHitOff) nos.push(SPRITES.hammerHitOff);
      if (xf & CHARFLAG.grenadeHitOff && xf & CHARFLAG.teleGun && got(1)) nos.push(SPRITES.gunHitOff);
      if (xf & CHARFLAG.shotgunHitOff && got(2)) nos.push(SPRITES.shotgunHitOff);
      if (xf & CHARFLAG.grenadeHitOff && got(3)) nos.push(SPRITES.grenadeHitOff);
      if (xf & CHARFLAG.laserHitOff && got(4)) nos.push(SPRITES.laserHitOff);
      if (row(nos)) y += 12;
      const states: number[][] = [];
      if (xf & CHARFLAG.lockMode) states.push(SPRITES.lockMode);
      if (xf & CHARFLAG.practice) states.push(SPRITES.practice);
      if (xf & CHARFLAG.team0Mode) states.push(SPRITES.team0Mode);
      if (who.deep) states.push(SPRITES.deepFrozen);
      if (xf & CHARFLAG.movementsOff) states.push(SPRITES.liveFrozen);
      row(states);
      ctx.restore();
    }
    ctx.font = "12px " + FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const line = st.fps + " FPS" + (self ? "  ·  пинг " + self.ping : "");
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.strokeText(line, v.w - 10, 8);
    ctx.fillStyle = "#fff";
    ctx.fillText(line, v.w - 10, 8);

    const fs = Math.max(0.7, Math.min(1, v.h / 480));
    ctx.save();
    ctx.translate(v.w, 0);
    ctx.scale(fs, fs);
    ctx.translate(-v.w, 0);
    let y = 30;
    ctx.font = "13px " + FONT;
    ctx.textBaseline = "middle";

    for (const e of st.show.board ? [] : st.feed.slice(-5)) {
      const age = (now - e.at) / 1000;
      if (age > 10) continue;
      const a = age > 9 ? 10 - age : 1;
      const tw = ctx.measureText(e.text).width;
      const w = tw + 46;
      ctx.globalAlpha = a;
      ctx.fillStyle = e.id === f.selfId ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.35)";
      roundRect(v.w - 10 - w, y, w, 28, 6);
      ctx.fill();
      uiTee(looksOf(e.id, byId.get(e.id)), v.w - 10 - w + 18, y + 14, 26);
      ctx.fillStyle = e.kind === "freeze" ? "#bfe3ff" : "#d8ffd8";
      ctx.fillText(e.text, v.w - 16, y + 14);
      ctx.globalAlpha = 1;
      y += 32;
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  function renderBoard(f: Frame, byId: Map<number, Tee>, v: View): void {
    const all: Player[] = f.players && f.players.length ? f.players.slice() : f.tees.map((t) => ({ id: t.id, name: t.name, clan: t.clan ?? "", score: 0, ping: 0, team: 0, skin: t.skin, cc: t.cc, cb: t.cb, cf: t.cf }));
    const players = all.filter((p) => p.team !== -1).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const specs = all.filter((p) => p.team === -1).sort((a, b) => a.name.localeCompare(b.name));
    const layout = boardColumns(players.length);
    const bw = layout.width;
    const total = 385 + 5 + 100;
    let u = Math.min(v.w / (bw + 20), Math.max(v.h / 600, 0.62));
    let top = 75 * u;
    if (top + total * u > v.h - 4) top = Math.max(4, v.h - 4 - total * u);
    if (top + total * u > v.h - 4) {
      u = (v.h - 8) / total;
      top = 4;
    }
    const x0 = (v.w - bw * u) / 2;
    ctx.save();
    ctx.translate(x0, top);
    ctx.scale(u, u);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    roundRect(0, 0, bw, 385, 7.5);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "20px " + FONT;
    ctx.fillText(f.map || "", 10, 15, bw - 120);
    const focus = players.find((p) => p.id === (st.spec >= 0 ? st.spec : f.selfId));
    if (focus && focus.score > -9999) {
      ctx.textAlign = "right";
      ctx.fillText(String(focus.score), bw - 10, 15);
    }
    for (let c = 0; c < layout.cols; c++) {
      const rows = players.slice(c * layout.per, (c + 1) * layout.per);
      const cw = bw / layout.cols;
      boardColumn(rows, f, byId, c * cw, 30, cw, layout.cols === 1 ? players.length : layout.per);
    }

    const sy = 385 + 5;
    const sw = 385;
    const sx = (bw - sw) / 2;
    ctx.fillStyle = "rgba(0,0,0,.5)";
    roundRect(sx, sy, sw, 100, 7.5);
    ctx.fill();
    ctx.font = "11px " + FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    const words = ["Наблюдают" + (specs.length ? ":" : "")].concat(specs.map((s, i) => s.name + (i < specs.length - 1 ? "," : "")));
    let lx = sx + 5;
    let ly = sy + 5;
    for (const w of words) {
      const ww = ctx.measureText(w + " ").width;
      if (lx + ww > sx + sw - 5 && lx > sx + 5) {
        lx = sx + 5;
        ly += 11;
      }
      if (ly > sy + 100 - 16) {
        ctx.fillText("…", lx, ly);
        break;
      }
      ctx.fillText(w, lx, ly);
      lx += ww;
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function boardColumn(rows: Player[], f: Frame, byId: Map<number, Tee>, x: number, y: number, w: number, nForSize: number): void {
    const narrow = w < 350;
    const m = boardMetrics(nForSize, narrow);
    ctx.font = m.font + "px " + FONT;
    const scoreLen = ctx.measureText("99999").width;
    const scoreX = x + 10;
    const teeX = scoreX + scoreLen + 10;
    const teeLen = 60 * m.tee;
    const nameX = teeX + teeLen;
    const countryLen = (m.line - m.spacing - m.tee * 5) * 2;
    const pingLen = 27.5;
    const pingX = x + w - pingLen - 10;
    const countryX = pingX - countryLen;
    let nameLen = (narrow ? 90 : 150) - teeLen;
    if (nameLen + 5 > countryX - nameX) nameLen = Math.max(0, (countryX - nameX - 5) * 0.7);
    const clanX = nameX + nameLen + 2.5;
    const clanLen = Math.max(0, countryX - clanX - 2.5);

    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.font = "11px " + FONT;
    ctx.textAlign = "right";
    ctx.fillText("Очки", scoreX + scoreLen, y + 11);
    ctx.textAlign = "left";
    ctx.fillText("Имя", nameX, y + 11);
    ctx.textAlign = "center";
    ctx.fillText("Клан", clanX + clanLen / 2, y + 11);
    ctx.textAlign = "right";
    ctx.fillText("Пинг", pingX + pingLen, y + 11);
    let ry = y + 22;
    const fit = (text: string, max: number): string => {
      if (max <= 0) return "";
      if (ctx.measureText(text).width <= max) return text;
      let s = text;
      while (s.length > 0 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
      return s + "…";
    };
    for (const p of rows) {
      const cy = ry + m.line / 2;

      if ((st.spec < 0 && p.id === f.selfId) || p.id === st.spec) {
        ctx.fillStyle = "rgba(255,255,255,.25)";
        roundRect(x, ry, w, m.line, m.round);
        ctx.fill();
      }
      ctx.font = m.font + "px " + FONT;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "right";

      ctx.fillText(p.score <= -9999 ? "" : String(Math.max(-999, Math.min(99999, p.score))), scoreX + scoreLen, cy);
      const size = 64 * m.tee;
      uiTee(looksOf(p.id, p), teeX + teeLen / 2, cy + size * 0.08, size);
      ctx.textAlign = "left";
      ctx.fillStyle = p.id === f.target ? "#ffb4a6" : "#fff";
      ctx.fillText(fit(p.name, nameLen), nameX, cy);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(fit(p.clan, clanLen), clanX + clanLen / 2, cy);

      const pc = hslRgb((300 - Math.max(0, Math.min(300, p.ping))) / 1000, 1, 0.5);
      ctx.fillStyle = "rgb(" + Math.round(pc[0] * 255) + "," + Math.round(pc[1] * 255) + "," + Math.round(pc[2] * 255) + ")";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.max(0, Math.min(999, p.ping))), pingX + pingLen, cy);
      ry += m.line + m.spacing;
    }
    void byId;
  }

  function toWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = cv.getBoundingClientRect();
    const gv = groupView(st.cam.x, st.cam.y, st.zoom, rect.width / Math.max(1, rect.height), 100, 100, 0, 0);
    const s = rect.width / gv[2];
    return { x: gv[0] + sx / s, y: gv[1] + sy / s };
  }
  function pick(sx: number, sy: number): number {
    const cur = current(performance.now());
    if (!cur) return -1;
    const p = toWorld(sx, sy);
    const rect = cv.getBoundingClientRect();
    const s = rect.width / groupView(st.cam.x, st.cam.y, st.zoom, rect.width / Math.max(1, rect.height), 100, 100, 0, 0)[2];
    let best = -1;

    let bd = Math.max(60, 12 / s);
    for (const t of cur.tees) {

      const d = Math.min(Math.hypot(t.x - p.x, t.y - p.y), Math.hypot(t.x - p.x, t.y - 80 - p.y));
      if (d < bd) {
        bd = d;
        best = t.id;
      }
    }
    return best;
  }
  function pan(dxPx: number, dyPx: number): void {
    const rect = cv.getBoundingClientRect();
    const gv = groupView(st.cam.x, st.cam.y, st.zoom, rect.width / Math.max(1, rect.height), 100, 100, 0, 0);
    const s = rect.width / gv[2];
    st.follow = false;
    st.cam.x -= dxPx / s;
    st.cam.y -= dyPx / s;
  }
  function fit(): boolean {
    const m = st.liveMap;
    if (!m) return false;
    const rect = cv.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const base = groupView(0, 0, 1, aspect, 100, 100, 0, 0);
    st.follow = false;
    st.zoom = Math.min(40, Math.max((m.width * 32) / base[2], (m.height * 32) / base[3]));
    st.cam.x = (m.width * 32) / 2;
    st.cam.y = (m.height * 32) / 2;
    return true;
  }

  return {
    draw,
    pushFrame,
    loadData,
    loadScene,
    setLiveMap(m: LiveMap | null): void {
      st.liveMap = m;
    },
    sceneName: (): string => st.sceneName,
    setMode(m: "map" | "ent" | "both"): void {
      st.mode = m;
    },
    mode: (): string => st.mode,
    toggle(key: "route" | "traps" | "names" | "board" | "clans" | "cursor", on?: boolean): boolean {
      st.show[key] = on === undefined ? !st.show[key] : on;
      return st.show[key];
    },
    zoomBy(f: number): void {
      st.zoom = Math.max(0.25, Math.min(40, st.zoom * f));
    },
    setZoom(z: number): void {
      st.zoom = Math.max(0.25, Math.min(40, z));
    },
    zoom: (): number => st.zoom,
    follow(on: boolean): void {
      st.follow = on;
    },
    following: (): boolean => st.follow,
    spectate(id: number): void {
      st.spec = id;
      st.follow = true;
    },
    spec: (): number => st.spec,
    pick,
    pan,
    fit,
    teeIcon,
    stats: () => ({
      builds: st.builds,
      buildMs: Math.round(st.buildMs),
      chunks: st.chunks.size,
      chunkMpx: Math.round(st.chunkPx / 1e5) / 10,
      passes: st.passes.length,
      drawn: st.chunksDrawnLast,
      cam: { x: Math.round(st.cam.x), y: Math.round(st.cam.y) },
    }),
    latest: (): Frame | null => (st.frames.length ? st.frames[st.frames.length - 1].f : null),
    feed: (id: number, text: string, good: boolean): void => addFeed(id, text, good, "note"),
  };
}
