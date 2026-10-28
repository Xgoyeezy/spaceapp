import { vi } from "vitest";

export function fakeGl() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const canvas = { width: 300, height: 150 };
  const gl = new Proxy({ canvas }, { get(target, key: string) {
    if (key === "canvas") return target.canvas;
    if (key.toUpperCase() === key) return key;
    if (!calls.has(key)) calls.set(key, vi.fn(() => key.startsWith("create") ? {} : key === "getShaderParameter" || key === "getProgramParameter" ? true : undefined));
    return calls.get(key);
  } }) as unknown as WebGL2RenderingContext;
  return { gl, calls, canvas };
}

export function labelContext() {
  const commands: unknown[][] = [];
  const context = {
    font: "", fillStyle: "", measureText: vi.fn((text: string) => ({ width: text.length * 5 })),
    clearRect: (...args: number[]) => commands.push(["clear", ...args]),
    fillRect(...args: number[]) { commands.push(["rect", this.fillStyle, ...args]); },
    fillText(text: string, ...args: number[]) { commands.push(["text", this.font, this.fillStyle, text, ...args]); }
  };
  return { context: context as unknown as CanvasRenderingContext2D, commands, measure: context.measureText };
}
