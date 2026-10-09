export function needsOfficialClient(reason: string): boolean {
  return /checksum|client check|modified client/i.test(reason);
}

export function bannedOrKicked(reason: string): boolean {
  if (needsOfficialClient(reason)) return true;
  const lower = reason.toLowerCase();
  if (/\bban(?:s|ned|ning)?\b/.test(lower) || /\bvpn\b/.test(lower)) return true;
  if (!/\bkicked\b/.test(lower)) return false;
  return !/\binactiv/.test(lower);
}
