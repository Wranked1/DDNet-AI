import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

export function writeJsonAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {

    const fd = openSync(tmp, "w", 0o600);
    try {

      if (process.platform !== "win32") {
        try {
          fchmodSync(fd, 0o600);
        } catch {}
      }
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
