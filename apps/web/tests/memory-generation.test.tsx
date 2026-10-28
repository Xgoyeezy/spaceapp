import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryWorkspace } from "../src/features/memory-workspace/MemoryWorkspace.js";
import { prepareMemoryGpuData } from "../src/features/memory-workspace/memory-webgl-data.js";
import { buildMemoryPickIndex } from "../src/features/memory-workspace/memory-picking.js";

const apiMock=vi.hoisted(()=>({memoryGraphOverview:vi.fn(),memoryGraphNode:vi.fn(()=>new Promise(()=>{}))}));
vi.mock("../src/api.js",()=>({api:apiMock}));
vi.mock("../src/features/memory-workspace/MemoryGraph3D.js",()=>({MemoryGraph3D:(props:{nodes:{id:string}[];coordinates:{get:(id:string)=>unknown};pickIds:string[];onSelectNode:(id:string)=>void;loading:boolean})=><div data-testid="generation" data-ids={props.nodes.map(n=>n.id).join(",")} data-pick-ids={props.pickIds?.join(",")} data-loading={props.loading}>{props.nodes.map(n=><button key={n.id} onClick={()=>props.onSelectNode(n.id)}>{n.id}:{JSON.stringify(props.coordinates.get(n.id))}</button>)}</div>}));

const graph=(id:string)=>({data:{nodes:[{id,label:id,type:"SOURCE" as const,recordId:null,sourcePath:null}],edges:[],summary:{recordCount:0},totalMatchingNodes:1,totalMatchingEdges:0,truncated:false}});
class WorkerMock {
  static instances:WorkerMock[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null; onerror=null;
  postMessage=vi.fn(); terminate=vi.fn();
  constructor(){WorkerMock.instances.push(this);}
  emit(data:unknown){this.onmessage?.({data});}
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();history.replaceState(null,"","/");WorkerMock.instances=[];});

it.each([false,true])("keeps the complete prior graph selectable until replacement and rejects stale messages (diagnostics=%s)",async diagnostic=>{
  history.replaceState(null,"",`/demo-workspace?memoryBenchmark=1${diagnostic ? "&memoryDiagnostics=1" : ""}`);vi.stubGlobal("Worker",WorkerMock);
  const a=graph("old"),b=graph("new"),empty={...graph("empty"),data:{...graph("empty").data,nodes:[]}};
  apiMock.memoryGraphOverview.mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(empty);
  render(<MemoryWorkspace shellMode="desktop" activeRoomId={null} onClose={()=>{}}/>);
  await waitFor(()=>expect(WorkerMock.instances).toHaveLength(1));
  const first=WorkerMock.instances[0]!;
  const publish=(worker:WorkerMock,g:typeof a,x:number,iteration:number,done:boolean)=>{
    const gpu=prepareMemoryGpuData(g.data.nodes,[],new Map()),depth=new Float32Array([x,0,0]);
    worker.emit({gpu,depth,gpuPositions:new Float32Array(1024),extent:60,volume:0,picking:buildMemoryPickIndex(depth,gpu.radii),iteration,done});
  };
  act(()=>{first.emit({nodeIndices:[0]});publish(first,a,1,180,true);});
  expect(screen.getByTestId("generation").dataset.ids).toBe("old");
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:"next"}});fireEvent.submit(screen.getByRole("search"));
  await waitFor(()=>expect(WorkerMock.instances).toHaveLength(2));
  const second=WorkerMock.instances[1]!;
  expect(screen.getByTestId("generation").dataset).toMatchObject({ids:"old",pickIds:"old",loading:"true"});
  fireEvent.click(screen.getByRole("button",{name:'old:{"x":1,"y":0,"z":0}'}));expect(apiMock.memoryGraphNode).toHaveBeenLastCalledWith("old");
  act(()=>{second.emit({nodeIndices:[0]});publish(first,a,99,180,true);});
  expect(screen.getByTestId("generation").dataset.ids).toBe("old");
  act(()=>publish(second,b,2,0,false));
  expect(screen.getByTestId("generation").dataset).toMatchObject({ids:"new",pickIds:"new",loading:"true"});
  fireEvent.click(screen.getByRole("button",{name:'new:{"x":2,"y":0,"z":0}'}));expect(apiMock.memoryGraphNode).toHaveBeenLastCalledWith("new");
  act(()=>publish(second,b,3,180,true));
  expect(screen.getByTestId("generation").dataset.loading).toBe("false");
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:"empty"}});fireEvent.submit(screen.getByRole("search"));
  await waitFor(()=>expect(screen.getByTestId("generation").dataset.ids).toBe(""));
});

it("cancels initialization and ignores late snapshots after unmount",async()=>{
  history.replaceState(null,"","/demo-workspace?memoryBenchmark=1");vi.stubGlobal("Worker",WorkerMock);
  apiMock.memoryGraphOverview.mockResolvedValue(graph("cancelled"));
  const view=render(<MemoryWorkspace shellMode="desktop" activeRoomId={null} onClose={()=>{}}/>);
  await waitFor(()=>expect(WorkerMock.instances).toHaveLength(1));
  const worker=WorkerMock.instances[0]!;
  view.unmount();
  expect(worker.terminate).toHaveBeenCalled();
  const sent=worker.postMessage.mock.calls.length;
  await act(async()=>{worker.emit({nodeIndices:[0]});worker.emit({done:true,iteration:180});await new Promise(resolve=>setTimeout(resolve,10));});
  expect(worker.postMessage).toHaveBeenCalledTimes(sent);
  expect(screen.queryByTestId("generation")).toBeNull();
});
