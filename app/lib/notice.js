"use strict";

const CRASH_NOTICE_GAP_MS = 60_000;

function shouldNoticeCrash({ platform, hasTray, planned, stopped, code, now, last }) {
  if (platform !== "linux" || hasTray) return false;
  if (planned || stopped || code === 0) return false;
  return !(Number.isFinite(last) && now - last < CRASH_NOTICE_GAP_MS);
}

module.exports = { shouldNoticeCrash, CRASH_NOTICE_GAP_MS };
