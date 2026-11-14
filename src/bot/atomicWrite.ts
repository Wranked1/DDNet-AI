import { closeSync, constants, fchmodSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { threadId } from "node:worker_threads";

export const atomicTmpFile = (file: string): string => `${file}.${process.pid}.${threadId}.tmp`;

export function writeJsonAtomic(file: string, text: string): void {
  const tmp = atomicTmpFile(file);
  try {

    rmSync(tmp, { force: true });

    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
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
