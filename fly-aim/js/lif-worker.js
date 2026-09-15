// 子图 LIF 仿真 Worker —— 与 flycircuit/lif.py、Shiu et al. 2024 全脑模型同一套方程与参数。
//   dv/dt = (v0 - v + g) / t_mbr（不应期内不积分）；dg/dt = -g / tau
//   v > v_th → 放电、复位、不应期 2.2 ms；突触延迟 1.8 ms 后 g_post += 突触数 × 正负号 × 0.275 mV
//   外部刺激：泊松脉冲直接给 v 加 68.75 mV
const DT = 1e-4;
let N = 0, off, post, postScr, w, v, g, rfc, buf, counts, mute, rates;
let P, aV, decayG, rfcSteps, dly, rows, slot = 0;
let scramble = false, paused = false, speed = 1, tBio = 0, last = 0;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function init(m) {
  N = m.n; P = m.params;
  const buffer = m.edges, E = m.nEdges;
  off = new Uint32Array(buffer, 0, N + 1);
  post = new Uint16Array(buffer.slice(4 * (N + 1), 4 * (N + 1) + 2 * E));
  const wi = new Int16Array(buffer.slice(4 * (N + 1) + 2 * E, 4 * (N + 1) + 4 * E));
  w = new Float32Array(E); for (let k = 0; k < E; k++) w[k] = wi[k] * m.wSyn;
  // 度保持打乱对照：只打乱「连给谁」，每个神经元的出度、入度、正负号不变
  postScr = post.slice(); const rnd = mulberry32(101);
  for (let k = E - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); const t = postScr[k]; postScr[k] = postScr[j]; postScr[j] = t; }
  aV = DT * 1e3 / P.t_mbr_ms; decayG = Math.exp(-DT * 1e3 / P.tau_ms);
  rfcSteps = Math.round(P.t_rfc_ms * 1e-3 / DT); dly = Math.round(P.t_dly_ms * 1e-3 / DT); rows = dly + 1;
  v = new Float32Array(N).fill(P.v0); g = new Float32Array(N); rfc = new Int16Array(N);
  buf = new Float32Array(rows * N); counts = new Uint16Array(N); mute = new Uint8Array(N); rates = new Float32Array(N);
  last = performance.now();
  setInterval(loop, 16);
}

function step() {
  const base = slot * N, dst = ((slot + dly) % rows) * N, tgt = scramble ? postScr : post;
  const v0 = P.v0, vr = P.v_rst, vth = P.v_th, kick = P.poisson_kick_mv;
  for (let i = 0; i < N; i++) {
    g[i] += buf[base + i]; buf[base + i] = 0;
    if (mute[i]) { v[i] = v0; g[i] = 0; continue; } // 敲除：钳在静息电位，不放电、不输出
    if (rfc[i] <= 0) { v[i] += aV * (v0 - v[i] + g[i]); g[i] *= decayG; }
    rfc[i]--;
    const r = rates[i];
    if (r > 0 && Math.random() < r * DT) v[i] += kick;
    if (v[i] > vth) {
      v[i] = vr; g[i] = 0; rfc[i] = rfcSteps; counts[i]++;
      if (!mute[i]) for (let k = off[i], e = off[i + 1]; k < e; k++) buf[dst + tgt[k]] += w[k];
    }
  }
  slot = (slot + 1) % rows; tBio += DT;
}

function loop() {
  const now = performance.now();
  const wall = Math.min(0.1, (now - last) / 1000); last = now;
  if (paused || !N) return;
  const n = Math.min(Math.round(wall * speed / DT), 1500);
  const t0 = performance.now();
  for (let s = 0; s < n; s++) step();
  const out = counts; counts = new Uint16Array(N);
  self.postMessage({ type: 'tick', counts: out, steps: n, tBio, cost: performance.now() - t0 }, [out.buffer]);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m);
  else if (m.type === 'rates') rates.set(m.rates);
  else if (m.type === 'scramble') scramble = !!m.on;
  else if (m.type === 'silence') { mute.fill(0); for (const i of m.ids) mute[i] = 1; }
  else if (m.type === 'speed') speed = m.value;
  else if (m.type === 'pause') paused = !!m.on;
  else if (m.type === 'reset') { v.fill(P.v0); g.fill(0); rfc.fill(0); buf.fill(0); }
};
