(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TEE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function teeBox(s) {
    return { w: Math.round(80 * s), h: Math.round(64 * s), px: 40 * s, py: 36 * s };
  }

  function teeParts(look) {
    const dx = look ? look[0] : 1;
    const dy = look ? look[1] : 0;
    const body = (sx) => ({ sx, sy: 0, sw: 96, sh: 96, cx: 0, cy: -4, w: 64, h: 64, flip: false });
    const foot = (fx, sy) => ({ sx: 192, sy, sw: 64, sh: 32, cx: fx, cy: 10, w: 64, h: 32, flip: false });
    const sep = (0.075 - 0.01 * Math.abs(dx)) * 64;
    const ox = dx * 0.125 * 64;
    const oy = (-0.05 + dy * 0.1) * 64;
    const es = 0.4 * 64;
    const eye = (cx, flip) => ({ sx: 64, sy: 96, sw: 32, sh: 32, cx, cy: -4 + oy, w: es, h: es, flip });
    return [foot(-7, 64), body(96), foot(7, 64), foot(-7, 32), body(0), eye(-sep + ox, false), eye(sep + ox, true), foot(7, 32)];
  }

  function drawTee(ctx, img, x, y, s, look, grey) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (img === null || img === undefined) {
      if (grey && grey.complete && grey.naturalWidth > 0) {

        const w = (50 / 384) * 512 * s;
        ctx.drawImage(grey, x - w / 2, y - 4 * s - w / 2 + (20 / 512) * w, w, w);
      }
      return;
    }
    const k = img.naturalWidth / 256;
    for (const p of teeParts(look)) {
      const dw = p.w * s;
      const dh = p.h * s;
      ctx.save();
      ctx.translate(x + p.cx * s, y + p.cy * s);
      if (p.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, p.sx * k, p.sy * k, p.sw * k, p.sh * k, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
  }

  return { teeBox, teeParts, drawTee };
});
