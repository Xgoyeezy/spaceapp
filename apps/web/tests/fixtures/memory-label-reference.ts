import type { MemoryGraphNode } from "@space/contracts";
import { projectMemoryPoint, type MemoryCamera3D } from "../../src/features/memory-workspace/memory-3d.js";
import type { MemoryCoordinates } from "../../src/features/memory-workspace/memory-coordinates.js";
import { MemoryLabelCache } from "../../src/features/memory-workspace/memory-label-cache.js";
import { MEMORY_LABEL_LIMIT, prepareMemoryGpuData } from "../../src/features/memory-workspace/memory-webgl-data.js";
export type LabelState = { width: number; height: number; extent: number; nodes: MemoryGraphNode[]; coordinates: MemoryCoordinates; data: ReturnType<typeof prepareMemoryGpuData>; labelCache: MemoryLabelCache; focus: number };
// Exact pre-change label loop from f0a2078, retained as an independent output oracle.
export function referenceLabels(this: LabelState, context: CanvasRenderingContext2D, camera: MemoryCamera3D, visible: boolean) {
    context.clearRect(0, 0, this.width, this.height);
    if (!visible || !this.data) return;
    const boxes: Array<{ x: number; y: number; width: number }> = [];
    context.font = "11px system-ui, sans-serif";
    const scale = Math.min(this.width, this.height) * 0.4 / this.extent;
    const measureText = (text: string) => context.measureText(text).width;
    for (const index of this.labelCache.atZoom(camera.zoom, this.focus)) {
      const node = this.nodes[index]!, point = this.coordinates.get(node.id); if (!point) continue;
      const p = projectMemoryPoint(point, camera, scale, this.width, this.height), x = p.x + 9, y = p.y;
      if (x < 0 || x > this.width - 25 || y < 14 || y > this.height - 5) continue;
      const { text: label, width } = this.labelCache.measure(index, measureText);
      if (x + width > this.width || boxes.some(box => Math.abs(box.y - y) < 16 && x < box.x + box.width + 5 && x + width + 5 > box.x)) continue;
      boxes.push({ x, y, width });
      context.fillStyle = "#09111bea"; context.fillRect(x - 3, y - 11, width + 6, 16);
      context.fillStyle = this.data.radii[index] === 10 ? "#fff0b0" : "#c6dfed"; context.fillText(label, x, y + 1);
      if (boxes.length === MEMORY_LABEL_LIMIT) break;
    }
  }
