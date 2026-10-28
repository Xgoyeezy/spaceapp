import { describe, expect, it, vi } from "vitest";
import { MemoryRendererSync, type MemoryRenderSnapshot } from "../src/features/memory-workspace/memory-renderer-sync.js";
import { prepareMemoryGpuData } from "../src/features/memory-workspace/memory-webgl-data.js";
import { buildMemoryPickIndex } from "../src/features/memory-workspace/memory-picking.js";

function snapshot(id: string): MemoryRenderSnapshot {
  const nodes = [{ id, label:id, type:"SOURCE" as const, recordId:null, sourcePath:null }];
  return { nodes, data:prepareMemoryGpuData(nodes,[],new Map()), coordinates:new Map([[id,{x:1,y:2,z:3}]]), positions:new Float32Array(1024), extent:60,
    picking:buildMemoryPickIndex(new Float32Array([1,2,3]),new Float32Array([4.6])), ids:[id] };
}
function target() { const order:string[]=[]; return {order,setGraph:vi.fn(()=>order.push("graph")),setPositions:vi.fn(()=>order.push("positions")),setPicking:vi.fn(()=>order.push("picking"))}; }

describe("memory snapshot ownership", () => {
  it("uploads graph-plus-position replacement once, streams once, and skips unchanged snapshots", () => {
    const sync=new MemoryRendererSync(), renderer=target(), first=snapshot("first");
    sync.synchronize(renderer,1,first); sync.synchronize(renderer,1,{...first});
    expect(renderer.order).toEqual(["graph","positions","picking"]);
    const stream={...first,coordinates:new Map([["first",{x:4,y:5,z:6}]]),positions:new Float32Array(1024),picking:snapshot("first").picking};
    sync.synchronize(renderer,1,stream); sync.synchronize(renderer,1,stream);
    expect(renderer.setGraph).toHaveBeenCalledTimes(1); expect(renderer.setPositions).toHaveBeenCalledTimes(2);
    expect(renderer.setPicking).toHaveBeenLastCalledWith(stream.picking,stream.ids,undefined);
    const replacement=snapshot("different-identity-same-size");
    sync.synchronize(renderer,1,replacement); sync.synchronize(renderer,1,replacement);
    expect(renderer.setGraph).toHaveBeenCalledTimes(2); expect(renderer.setPositions).toHaveBeenCalledTimes(3);
    expect(renderer.order).toEqual(["graph","positions","picking","positions","picking","graph","positions","picking"]);
  });

  it("reuploads on renderer or context generation changes and after graph texture allocation", () => {
    const sync=new MemoryRendererSync(), first=target(), second=target(), value=snapshot("n");
    sync.synchronize(first,1,value); sync.synchronize(first,2,value); sync.synchronize(second,2,value);
    expect(first.setPositions).toHaveBeenCalledTimes(2); expect(second.setPositions).toHaveBeenCalledTimes(1);
    sync.synchronize(second,2,{...value,nodes:[...value.nodes]});
    expect(second.setPositions).toHaveBeenCalledTimes(2);
  });

  it("does not accept a failed upload or publish its picking index", () => {
    const sync=new MemoryRendererSync(), renderer=target(), value=snapshot("n");
    renderer.setPositions.mockImplementationOnce(()=>{throw new Error("lost context");});
    expect(()=>sync.synchronize(renderer,1,value)).toThrow("lost context");
    expect(renderer.setPicking).not.toHaveBeenCalled();
    sync.synchronize(renderer,2,value);
    expect(renderer.setPositions).toHaveBeenCalledTimes(2); expect(renderer.setPicking).toHaveBeenCalledTimes(1);
  });
});
