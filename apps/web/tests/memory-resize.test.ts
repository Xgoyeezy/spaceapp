import { expect, it, vi } from "vitest";
import { MemoryWebGLRenderer } from "../src/features/memory-workspace/memory-webgl-renderer.js";
import { fakeGl } from "./fixtures/memory-renderer-harness.js";

it("assigns backing dimensions only when their rounded values change",()=>{
  const {gl,canvas}=fakeGl();let width=300,height=150;
  const setWidth=vi.fn((value:number)=>{width=value;}),setHeight=vi.fn((value:number)=>{height=value;});
  Object.defineProperties(canvas,{width:{get:()=>width,set:setWidth},height:{get:()=>height,set:setHeight}});
  const renderer=new MemoryWebGLRenderer(gl);renderer.resize(900,460,2);
  for(let i=0;i<100;i++)renderer.resize(900,460,2);
  expect(setWidth).toHaveBeenCalledTimes(1);expect(setHeight).toHaveBeenCalledTimes(1);
  renderer.resize(900.1,460,2);expect(renderer.width).toBe(900.1);expect(setWidth).toHaveBeenCalledTimes(1);
  renderer.resize(901,460,2);expect(setWidth).toHaveBeenCalledTimes(2);expect(setHeight).toHaveBeenCalledTimes(1);
  renderer.resize(901,460,1);expect(setWidth).toHaveBeenCalledTimes(3);expect(setHeight).toHaveBeenCalledTimes(2);
  expect(canvas).toMatchObject({width:901,height:460});expect(renderer.dpr).toBe(1);
});
