import { describe, expect, it, vi } from "vitest";
import type { MemoryGraphNode } from "@space/contracts";
import { MemoryLabelCache } from "../src/features/memory-workspace/memory-label-cache.js";
import { MEMORY_LABEL_CANDIDATES, memoryLabelCandidates, memoryLabelsAtZoom } from "../src/features/memory-workspace/memory-webgl-data.js";
import { OriginalMemoryLabelCache } from "./fixtures/memory-label-cache-reference.js";

const nodes: MemoryGraphNode[] = Array.from({ length: 2000 }, (_, index) => ({
  id: `node:${index}`, type: index < 20 ? "SOURCE" : "MEMORY",
  label: index === 1000 ? "space.md" : `Node ${index}`, recordId: null, sourcePath: null
}));
const candidates = memoryLabelCandidates(nodes);

describe("memory label cache", () => {
  it("preserves core/source priority, zoom boundaries and focus changes while reusing stable lists", () => {
    const cache = new MemoryLabelCache(nodes, candidates);
    for (const zoom of [0.5, 1, 1.599, 1.6, 2, 1]) {
      for (const focus of [-1, 0, 1999, 1000, -1]) {
        const actual = cache.atZoom(zoom, focus);
        expect(actual).toEqual(memoryLabelsAtZoom(nodes, candidates, zoom, focus));
        expect(actual.length).toBeLessThanOrEqual(MEMORY_LABEL_CANDIDATES);
        expect(cache.atZoom(zoom, focus)).toBe(actual);
      }
    }
    const unzoomed = cache.atZoom(1, -1);
    expect(cache.atZoom(1.5, -1)).toBe(unzoomed);
    expect(unzoomed[0]).toBe(1000);
  });

  it("pins lazy candidate measurements through extensive hover churn with one outside slot", () => {
    const cache = new MemoryLabelCache(nodes, candidates);
    const original = new OriginalMemoryLabelCache(nodes, candidates), oldMeasure = vi.fn((text: string) => text.length * 5);
    const measure = vi.fn((text: string) => text.length * 5);
    expect(measure).not.toHaveBeenCalled();
    for(const index of candidates) {cache.measure(index,measure);original.measure(index,oldMeasure);}
    const outside=nodes.map((_,i)=>i).filter(i=>!candidates.includes(i)).slice(0,1000);
    for(const focus of outside) {
      for(const index of cache.atZoom(2,focus)) expect(cache.measure(index,measure)).toEqual(original.measure(index,oldMeasure));
      const retained = cache as unknown as {labels:Map<number,unknown>;focusedLabel:unknown};
      expect(retained.labels.size+Number(Boolean(retained.focusedLabel))).toBeLessThanOrEqual(385);
    }
    for(const index of candidates) cache.measure(index,measure);
    expect(measure).toHaveBeenCalledTimes(MEMORY_LABEL_CANDIDATES+outside.length);
    expect(oldMeasure.mock.calls.length).toBeGreaterThan(measure.mock.calls.length);
    console.info(JSON.stringify({test:"1000 outside focuses, 384 candidates",beforeMeasurements:oldMeasure.mock.calls.length,afterMeasurements:measure.mock.calls.length,maxRetained:385}));
    cache.measure(outside.at(-1)!,measure);expect(measure).toHaveBeenCalledTimes(1384);
    cache.measure(outside[0]!,measure);expect(measure).toHaveBeenCalledTimes(1385);
    cache.invalidateMeasurements();cache.measure(candidates[0]!,measure);expect(measure).toHaveBeenCalledTimes(1386);
  });

  it("measures the displayed truncated text and starts fresh for a replacement graph", () => {
    const measure = vi.fn((text: string) => text.length * 5);
    const long = new MemoryLabelCache([{ ...nodes[0]!, label: "a".repeat(49) }], [0]);
    expect(long.measure(0, measure)).toEqual({ text: `${"a".repeat(45)}…`, width: 230 });
    expect(measure).toHaveBeenLastCalledWith(`${"a".repeat(45)}…`);
    const replacement = new MemoryLabelCache([{ ...nodes[0]!, label: "New title" }], [0]);
    expect(replacement.measure(0, measure)).toEqual({ text: "New title", width: 45 });
  });
});
