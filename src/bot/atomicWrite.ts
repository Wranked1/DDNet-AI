import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

export function writeJsonAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
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
