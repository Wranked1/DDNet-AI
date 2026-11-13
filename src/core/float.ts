const same = (x: number): number => x;

export let fl: (x: number) => number = same;

export let float32 = false;

export function setFloat32(on: boolean): void {
  float32 = on;
  fl = on ? Math.fround : same;
}
