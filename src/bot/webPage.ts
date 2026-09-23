import {
  ANIMS,
  CHARFLAG,
  SPRITES,
  affine3,
  animSeq,
  animState,
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
import { createView } from "./webView.ts";

let cached: string | null = null;

export const PAGE_FUNCTIONS = [
  animSeq,
  animState,
  teeAnimFor,
  ddnetColor,
  skinColorable,
  skinTint,
  spriteRect,
  spriteScale,
  tileMatrix,
  affine3,
  groupView,
  chunkLod,
  tickClock,
  envEval,
  envRgbConst,
  buildPasses,
  gradientPixels,
  hslRgb,
  boardMetrics,
  boardColumns,
  hudWeapons,
  jumpIcons,
  freezeBarPieces,
  flakeStep,
  createView,
];

export function pageScript(): string {
  if (cached !== null) return cached;
  cached =
    `const SPRITES=${JSON.stringify(SPRITES)};\nconst ANIMS=${JSON.stringify(ANIMS)};\nconst CHARFLAG=${JSON.stringify(CHARFLAG)};\n` +
    PAGE_FUNCTIONS.map((f) => f.toString()).join("\n");
  return cached;
}
