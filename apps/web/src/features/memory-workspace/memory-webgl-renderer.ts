import { IndexedMemoryCoordinates, type MemoryCoordinates } from "./memory-coordinates.js";
import type { MemoryGraphNode } from "@space/contracts";
import { type MemoryCamera3D, type MemoryPoint3D } from "./memory-3d.js";
import { MEMORY_LABEL_LIMIT, type prepareMemoryGpuData } from "./memory-webgl-data.js";
import { MemoryLabelCache } from "./memory-label-cache.js";

import { pickMemoryNode, type MemoryPickIndex } from "./memory-picking.js";

import { getMemoryDiagnostics, type MemoryDiagnosticTags } from "./memory-diagnostics.js";

type GraphData = ReturnType<typeof prepareMemoryGpuData>;
const projection = `
uniform sampler2D uPositions;
uniform sampler2D uFocusFlags;
uniform vec2 uViewport;
uniform vec4 uRotation;
uniform float uScale, uZoom, uExtent, uDpr;
uniform int uFocus;
vec4 point(int id) { return texelFetch(uPositions, ivec2(id % 256, id / 256), 0); }
float flag(int id) { return texelFetch(uFocusFlags, ivec2(id % 256, id / 256), 0).r; }
vec4 project(vec3 p) {
  float x = p.x * uRotation.x + p.z * uRotation.y;
  float d = -p.x * uRotation.y + p.z * uRotation.x;
  float y = p.y * uRotation.z - d * uRotation.w;
  float z = p.y * uRotation.w + d * uRotation.z;
  float perspective = 650.0 / max(120.0, 650.0 + z * uScale);
  return vec4(vec2(x, y) * uScale * uZoom * perspective * 2.0 / uViewport, z / max(1.0, uExtent * 1.01), perspective);
}`;
const nodeVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aColor;
${projection}
out vec2 vCorner;
out vec4 vColor;
void main() {
  int id = gl_InstanceID;
  vec4 p = point(id), projected = project(p.xyz);
  bool focused = id == uFocus;
  float radius = max(1.0, p.w * projected.w * sqrt(uZoom)) * (focused ? 1.5 : 1.0);
  gl_Position = vec4(projected.xy + aCorner * radius * 2.0 / uViewport, projected.z, 1.0);
  float alpha = uFocus >= 0 && !focused && flag(id) < 0.5 ? 0.2 : clamp(projected.w, 0.4, 1.0);
  vColor = vec4(focused ? vec3(1.0) : aColor.rgb, alpha);
  vCorner = aCorner;
}`;
const nodeFragment = `#version 300 es
precision highp float;
in vec2 vCorner;
in vec4 vColor;
out vec4 color;
void main() {
  float r = dot(vCorner, vCorner);
  if (r > 1.0) discard;
  color = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.82, 1.0, r)));
}`;
const edgeVertex = `#version 300 es
precision highp float;
layout(location=0) in uvec2 aEnds;
layout(location=1) in float aKind;
${projection}
out vec4 vColor;
void main() {
  int id = int(gl_VertexID == 0 ? aEnds.x : aEnds.y);
  vec4 projected = project(point(id).xyz);
  gl_Position = vec4(projected.xyz, 1.0);
  bool incident = int(aEnds.x) == uFocus || int(aEnds.y) == uFocus;
  vec3 base = aKind > 0.5 ? vec3(0.22,0.31,0.41) : vec3(0.13,0.20,0.26);
  vColor = vec4(incident ? vec3(0.60,0.85,0.98) : base, uFocus >= 0 && !incident ? 0.3 : 0.8);
}`;
const edgeFragment = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 color;
void main() { color = vColor; }`;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const shaders: WebGLShader[] = [];
  const result = gl.createProgram();
  if (!result) throw new Error("WebGL program unavailable");
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("WebGL shader unavailable");
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
      gl.attachShader(result, shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "Shader linking failed");
    return result;
  } catch (error) { gl.deleteProgram(result); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

/** Two GPU draws per frame; static geometry is uploaded only when the graph changes. */
export class MemoryWebGLRenderer {
  private readonly diagnostics = getMemoryDiagnostics();
  readonly diagnosticTags: MemoryDiagnosticTags = { renderer: this.diagnostics?.identity(this) };
  private readonly nodeProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly textures: WebGLTexture[] = [];
  private readonly nodeVao: WebGLVertexArrayObject;
  private readonly edgeVao: WebGLVertexArrayObject;
  private readonly positionTexture: WebGLTexture;
  private readonly focusTexture: WebGLTexture;
  private readonly uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private data: GraphData | null = null;
  private nodes: MemoryGraphNode[] = [];
  private labelCache = new MemoryLabelCache([], []);
  private readonly labelPoint: MemoryPoint3D = { x: 0, y: 0, z: 0 };
  private readonly labelBoxes = new Float64Array(MEMORY_LABEL_LIMIT * 3);
  private labelContext: CanvasRenderingContext2D | null = null;
  private labelFont = "";
  private coordinates: MemoryCoordinates = new Map<string, MemoryPoint3D>();
  private picking: MemoryPickIndex | null = null;
  private pickStack = new Int32Array(0);
  private pickIds: string[] = [];
  private pickIdIndex = new Map<string, number>();
  private flags = new Uint8Array(0);
  private textureData: Float32Array = new Float32Array(0);
  private textureRows = 1;
  private extent = 60;
  private focus = -1;
  private nodeColorBuffer: WebGLBuffer;
  private edgeBuffer: WebGLBuffer;
  private edgeKindBuffer: WebGLBuffer;
  width = 1; height = 1; dpr = 1;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.nodeProgram = program(gl, nodeVertex, nodeFragment);
    this.edgeProgram = program(gl, edgeVertex, edgeFragment);
    const vao = () => { const value = gl.createVertexArray(); if (!value) throw new Error("VAO unavailable"); this.vaos.push(value); return value; };
    const buffer = () => { const value = gl.createBuffer(); if (!value) throw new Error("Buffer unavailable"); this.buffers.push(value); return value; };
    const texture = () => { const value = gl.createTexture(); if (!value) throw new Error("Texture unavailable"); this.textures.push(value);
      gl.bindTexture(gl.TEXTURE_2D, value); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return value; };
    this.nodeVao = vao(); gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.nodeColorBuffer = buffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeColorBuffer);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 0, 0); gl.vertexAttribDivisor(1, 1);
    this.edgeVao = vao(); gl.bindVertexArray(this.edgeVao);
    this.edgeBuffer = buffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(0, 1);
    this.edgeKindBuffer = buffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeKindBuffer);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.positionTexture = texture(); this.focusTexture = texture();

  }

  setGraph(nodes: MemoryGraphNode[], data: GraphData) {
    const started = this.diagnostics ? performance.now() : 0;
    if (this.diagnostics) this.diagnosticTags.graph = this.diagnostics.identity(nodes);
    this.nodes = nodes; this.data = data; this.focus = -1;
    this.labelCache = new MemoryLabelCache(nodes, data.labels);
    const gl = this.gl;
    this.textureRows = Math.max(1, Math.ceil(nodes.length / 256));
    this.textureData = new Float32Array(256 * this.textureRows * 4);
    this.flags = new Uint8Array(256 * this.textureRows);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, this.textureRows, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeColorBuffer); gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer); gl.bufferData(gl.ARRAY_BUFFER, data.endpoints, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeKindBuffer); gl.bufferData(gl.ARRAY_BUFFER, data.edgeKinds, gl.STATIC_DRAW);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.focusTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, this.textureRows, 0, gl.RED, gl.UNSIGNED_BYTE, this.flags);
    this.diagnostics?.count("graph.sync.calls");
    this.diagnostics?.record("graph.sync", started, performance.now(), this.diagnosticTags, { nodes: nodes.length, staticBytes: data.colors.byteLength + data.endpoints.byteLength + data.edgeKinds.byteLength + this.flags.byteLength });
  }

  setPositions(coordinates: MemoryCoordinates, packed?: Float32Array, extent?: number) {
    const started = this.diagnostics ? performance.now() : 0;
    if (this.diagnostics) this.diagnosticTags.layout = this.diagnostics.identity(packed ?? coordinates);
    this.coordinates = coordinates; this.extent = 60;
    if (packed) { this.textureData = packed; this.extent = extent ?? 60; }
    else for (let i = 0; i < this.nodes.length; i++) {
      const p = coordinates.get(this.nodes[i]!.id);
      const at = i * 4;
      this.textureData[at] = p?.x ?? 0; this.textureData[at + 1] = p?.y ?? 0; this.textureData[at + 2] = p?.z ?? 0;
      this.textureData[at + 3] = this.data?.radii[i] ?? 2.1;
      if (p) this.extent = Math.max(this.extent, Math.hypot(p.x, p.y, p.z));
    }
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, this.textureRows, gl.RGBA, gl.FLOAT, this.textureData);
    this.diagnostics?.count("positions.upload.calls"); this.diagnostics?.count("positions.upload.bytes", this.textureData.byteLength);
    this.diagnostics?.record("positions.upload", started, performance.now(), this.diagnosticTags, { bytes: this.textureData.byteLength });
  }

  setFocus(id: string | null) {
    const next = id ? this.data?.index.get(id) ?? -1 : -1;
    if (next === this.focus) return;
    const started = this.diagnostics ? performance.now() : 0;
    this.focus = next; this.flags.fill(0);
    if (this.data && next >= 0) for (let i = this.data.offsets[next]!; i < this.data.offsets[next + 1]!; i++) this.flags[this.data.neighbors[i]!] = 255;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.focusTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, this.textureRows, gl.RED, gl.UNSIGNED_BYTE, this.flags);
    this.diagnostics?.count("focus.upload.calls"); this.diagnostics?.count("focus.upload.bytes", this.flags.byteLength);
    this.diagnostics?.record("focus.upload", started, performance.now(), this.diagnosticTags, { bytes: this.flags.byteLength, focus: next });
  }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.dpr = dpr;
    const gl = this.gl, w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    let assignments = 0;
    if (gl.canvas.width !== w) { gl.canvas.width = w; assignments++; }
    if (gl.canvas.height !== h) { gl.canvas.height = h; assignments++; }
    this.diagnostics?.count("canvas.backing.assignments", assignments); this.diagnostics?.event("resize", this.diagnosticTags, { width, height, dpr, assignments });

  }

  private uniform(program: WebGLProgram, name: string) {
    let cache = this.uniforms.get(program);
    if (!cache) { cache = new Map(); this.uniforms.set(program, cache); }
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(program, name));
    return cache.get(name)!;
  }

  private bind(program: WebGLProgram, camera: MemoryCamera3D) {
    const gl = this.gl; gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.focusTexture);
    gl.uniform1i(this.uniform(program, "uPositions"), 0); gl.uniform1i(this.uniform(program, "uFocusFlags"), 1);
    gl.uniform2f(this.uniform(program, "uViewport"), this.width, this.height);
    gl.uniform4f(this.uniform(program, "uRotation"), Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch));
    gl.uniform1f(this.uniform(program, "uScale"), Math.min(this.width, this.height) * 0.4 / this.extent);
    gl.uniform1f(this.uniform(program, "uZoom"), camera.zoom); gl.uniform1f(this.uniform(program, "uExtent"), this.extent);
    gl.uniform1i(this.uniform(program, "uFocus"), this.focus);
  }

  render(camera: MemoryCamera3D) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.data || !this.coordinates.size) return;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bind(this.edgeProgram, camera); gl.bindVertexArray(this.edgeVao); gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 2, this.data.endpoints.length / 2);
    gl.depthMask(true); this.bind(this.nodeProgram, camera); gl.bindVertexArray(this.nodeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodes.length); gl.bindVertexArray(null);
  }

  setPicking(picking: MemoryPickIndex | null, ids: string[], index?: Map<string, number>) {
    if (this.diagnostics) this.diagnosticTags.picking = this.diagnostics.identity(picking);
    this.diagnostics?.event("picking.publish", this.diagnosticTags);
    this.picking = picking;
    const stackSize = (picking?.tree.length ?? 0) / 4;
    if (this.pickStack.length !== stackSize) this.pickStack = new Int32Array(stackSize);
    if (this.pickIds !== ids) { this.pickIds = ids; this.pickIdIndex = index ?? new Map(ids.map((id, i) => [id, i])); }
  }

  pick(x: number, y: number, camera: MemoryCamera3D): string | null {
    if (!this.picking || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const focusId = this.nodes[this.focus]?.id;
    // The worker's sorted IDs are stable across frames; avoid a linear search on each pointer move.
    const focused = focusId ? this.pickIdIndex.get(focusId) ?? -1 : -1;
    const selected = pickMemoryNode(this.picking, camera, Math.min(this.width, this.height) * 0.4 / this.extent, this.width, this.height, x, y, focused, this.pickStack);
    return this.pickIds[selected] ?? null;
  }

  invalidateLabelMeasurements() { this.labelCache.invalidateMeasurements(); }

  labels(context: CanvasRenderingContext2D, camera: MemoryCamera3D, visible: boolean) {
    context.clearRect(0, 0, this.width, this.height);
    if (!visible || !this.data) return;
    const boxes = this.labelBoxes;
    let boxCount = 0;
    context.font = "11px system-ui, sans-serif";
    if (this.labelContext !== context || this.labelFont !== context.font) {
      this.invalidateLabelMeasurements(); this.labelContext = context; this.labelFont = context.font;
    }
    const scale = Math.min(this.width, this.height) * 0.4 / this.extent;
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const measureText = (text: string) => { this.diagnostics?.count("labels.measureText.calls"); return context.measureText(text).width; };
    for (const index of this.labelCache.atZoom(camera.zoom, this.focus)) {
      const node = this.nodes[index]!;
      let point: MemoryPoint3D;
      if (this.coordinates instanceof IndexedMemoryCoordinates) {
        if (!this.coordinates.readInto(node.id, this.labelPoint)) continue;
        point = this.labelPoint;
      } else {
        const value = this.coordinates.get(node.id); if (!value) continue;
        point = value;
      }
      // Keep projectMemoryPoint's operation order, including its boundary rounding.
      const rotatedX = point.x * cy + point.z * sy, depth = -point.x * sy + point.z * cy;
      const rotatedY = point.y * cp - depth * sp, z = point.y * sp + depth * cp;
      const perspective = 650 / Math.max(120, 650 + z * scale);
      const x = this.width / 2 + rotatedX * scale * camera.zoom * perspective + 9;
      const y = this.height / 2 - rotatedY * scale * camera.zoom * perspective;
      if (x < 0 || x > this.width - 25 || y < 14 || y > this.height - 5) continue;
      const { text: label, width } = this.labelCache.measure(index, measureText);
      if (x + width > this.width) continue;
      let collision = false;
      for (let i = 0; i < boxCount * 3; i += 3) {
        if (Math.abs(boxes[i + 1]! - y) < 16 && x < boxes[i]! + boxes[i + 2]! + 5 && x + width + 5 > boxes[i]!) { collision = true; break; }
      }
      if (collision) continue;
      const at = boxCount++ * 3;
      boxes[at] = x; boxes[at + 1] = y; boxes[at + 2] = width;
      context.fillStyle = "#09111bea"; context.fillRect(x - 3, y - 11, width + 6, 16);
      context.fillStyle = this.data.radii[index] === 10 ? "#fff0b0" : "#c6dfed"; context.fillText(label, x, y + 1);
      if (boxCount === MEMORY_LABEL_LIMIT) break;
    }
  }

  dispose() {
    const gl = this.gl;
    this.buffers.forEach(value => gl.deleteBuffer(value)); this.textures.forEach(value => gl.deleteTexture(value)); this.vaos.forEach(value => gl.deleteVertexArray(value));
    gl.deleteProgram(this.nodeProgram); gl.deleteProgram(this.edgeProgram);
  }
}
