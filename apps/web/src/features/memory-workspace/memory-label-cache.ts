import type { MemoryGraphNode } from "@space/contracts";
import { MEMORY_LABEL_CANDIDATES, memoryLabelsAtZoom } from "./memory-webgl-data.js";

type Label = { text: string; width: number };

/** Graph-scoped label preparation; camera motion does not change text metrics. */
export class MemoryLabelCache {
  private readonly labels = new Map<number, Label>();
  private readonly candidateSet: Set<number>;
  private focusedIndex = -1;
  private focusedLabel: Label | undefined;
  private visible: number[] = [];
  private zoomed: boolean | undefined;
  private focus = -1;

  constructor(private readonly nodes: MemoryGraphNode[], private readonly candidates: number[]) {
    this.candidateSet = new Set(candidates.slice(0, MEMORY_LABEL_CANDIDATES));
  }

  invalidateMeasurements() { this.labels.clear(); this.focusedIndex = -1; this.focusedLabel = undefined; }

  atZoom(zoom: number, focus: number): number[] {
    const zoomed = zoom >= 1.6;
    if (this.zoomed !== zoomed || this.focus !== focus) {
      this.visible = memoryLabelsAtZoom(this.nodes, this.candidates, zoom, focus);
      this.zoomed = zoomed; this.focus = focus;
    }
    return this.visible;
  }

  measure(index: number, measureText: (text: string) => number): Label {
    const candidate = this.candidateSet.has(index);
    const cached = candidate ? this.labels.get(index) : this.focusedIndex === index ? this.focusedLabel : undefined;
    if (cached) return cached;
    const original = this.nodes[index]!.label;
    const text = original.length > 48 ? `${original.slice(0, 45)}…` : original;
    const label = { text, width: measureText(text) };
    // Pin lazy candidate measurements; hover churn gets one replaceable slot.
    if (candidate) this.labels.set(index, label);
    else { this.focusedIndex = index; this.focusedLabel = label; }
    return label;
  }
}
