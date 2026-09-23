export function terminalSafe(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}
