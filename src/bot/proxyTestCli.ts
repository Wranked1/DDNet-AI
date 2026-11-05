import { testProxy } from "./socksUdp.ts";

let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d: string) => {
  text += d;
});
process.stdin.on("end", () => {
  void testProxy(text.trim()).then((r) => {
    process.stdout.write(`${JSON.stringify(r)}\n`, () => process.exit(0));
  });
});
