import { existsSync } from "node:fs";
import { join as pathJoin } from "node:path";

export type PcCheck = { ranHere: boolean; fakeFiles: string[] };

const SERVICE_DIR = "DDNetServices";
const FAKE_FILES = [
  "app-win/resources/app/bin/nodejs_inject.exe",
  "app-win/resources/app/bin/node_inject.exe",
];

export function findStealerTraces(opts: { platform: string; localAppData: string | undefined; root: string; exists?: (p: string) => boolean; join?: (...p: string[]) => string }): PcCheck {
  const has = (p: string): boolean => {
    try {
      return (opts.exists ?? existsSync)(p);
    } catch {
      return false;
    }
  };
  const join = opts.join ?? pathJoin;
  let ranHere = false;
  if (opts.platform === "win32" && typeof opts.localAppData === "string" && opts.localAppData !== "") {
    ranHere = has(join(opts.localAppData, SERVICE_DIR));
  }

  const fakeFiles = FAKE_FILES.filter((f) => has(join(opts.root, f)));
  return { ranHere, fakeFiles };
}
