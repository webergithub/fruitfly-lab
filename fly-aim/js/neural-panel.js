// 神经活动面板：回路分层图（3,963 个神经元逐个闪烁）、大脑 3D 位置、关键神经元仪表与轨迹
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { t, onLang } from './i18n.js';

const NT_COLOR = { acetylcholine: '#e8b86d', gaba: '#7fc7c2', glutamate: '#b7a3dc' };
const OTHER = '#8a8178';
const KEY_NODES = ['AOTU019_L', 'AOTU025_L', 'AOTU025_R', 'AOTU019_R'];
const DN_NODES = ['DNa03_L', 'DNa11_L', 'DNa01_L', 'DNa02_L', 'DNa04_L', 'DNa04_R', 'DNa02_R', 'DNa01_R', 'DNa11_R', 'DNa03_R'];
const METERS = ['LC10a_L', 'LC10a_R', 'AOTU019_L', 'AOTU019_R', 'AOTU025_L', 'AOTU025_R', 'DNa02_L', 'DNa02_R'];
const TRACE = [
  { k: 'DNa02_L', c: '#e8b86d', dash: [] }, { k: 'DNa02_R', c: '#e8b86d', dash: [4, 3] },
  { k: 'AOTU019_L', c: '#7fc7c2', dash: [] }, { k: 'AOTU019_R', c: '#7fc7c2', dash: [4, 3] },
];
const TRACE_KEYS = { DNa02_L: 'trDNa02L', DNa02_R: 'trDNa02R', AOTU019_L: 'trAOTU019L', AOTU019_R: 'trAOTU019R' };

export class NeuralPanel {
  constructor({ meta, edges, cal }) {
    this.meta = meta; this.cal = cal;
    this.N = meta.n_neurons;
    this.groups = meta.groups;
    this.glow = new Float32Array(this.N);
    this.color = meta.neurons.map(n => NT_COLOR[n.nt] || OTHER);
    this.keyEdges = this._keyEdges(edges);
    this.hist = [];            // 轨迹：{t, rates, steer, fire}
    this.spikeWin = [];        // 最近 1 秒放电计数
    this.simRatio = 1; this.tab = 'map';

    this.mapCanvas = document.getElementById('map-canvas');
    this.brainCanvas = document.getElementById('brain-canvas');
    this.traceCanvas = document.getElementById('trace-canvas');
    this.statEl = document.getElementById('net-stat');
    this._buildMeters();
    this._buildTraceLegend();
    onLang(() => { this._layoutMap(); this._buildTraceLegend(); });

    new ResizeObserver(() => this._layoutMap()).observe(document.getElementById('map-wrap'));
    document.querySelectorAll('#win-circuit .tab').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
  }

  // ── 数据 ──
  _keyEdges(buffer) {
    const N = this.N, E = this.meta.n_edges;
    const off = new Uint32Array(buffer, 0, N + 1);
    const post = new Uint16Array(buffer, 4 * (N + 1), E);
    const w = new Int16Array(buffer.slice(4 * (N + 1) + 2 * E, 4 * (N + 1) + 4 * E));
    const owner = new Map();
    for (const [g, ids] of Object.entries(this.groups)) for (const i of ids) owner.set(i, g);
    const want = new Set([...KEY_NODES, ...DN_NODES, 'LC10a_L', 'LC10a_R']);
    const sums = new Map();
    for (const [g, ids] of Object.entries(this.groups)) {
      if (!want.has(g) || g.startsWith('DN')) continue;
      for (const i of ids) for (let k = off[i]; k < off[i + 1]; k++) {
        const dst = owner.get(post[k]);
        if (!dst || !want.has(dst) || dst === g || dst.startsWith('LC10a')) continue;
        const key = g + '>' + dst; sums.set(key, (sums.get(key) || 0) + w[k]);
      }
    }
    return [...sums].filter(([, s]) => Math.abs(s) >= 60).map(([k, s]) => { const [a, b] = k.split('>'); return { a, b, s }; });
  }

  ingest(counts, steps, rates, steer, fire, cost) {
    let active = 0, total = 0;
    for (let i = 0; i < this.N; i++) {
      const c = counts[i];
      if (c) { this.glow[i] = Math.min(1, this.glow[i] + 0.35 + 0.25 * c); active++; total += c; }
    }
    const now = performance.now();
    this.spikeWin.push([now, total, active, steps]);
    while (this.spikeWin.length && now - this.spikeWin[0][0] > 1000) this.spikeWin.shift();
    this.hist.push({ t: now, r: { ...rates }, steer, fire });
    while (this.hist.length && now - this.hist[0].t > 4000) this.hist.shift();
    this.lastCost = cost;
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('#win-circuit .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.mapCanvas.hidden = tab !== 'map';
    this.brainCanvas.hidden = tab !== 'brain';
    if (tab === 'brain' && !this.brain) this._initBrain();
    this._layoutMap();
  }

  // ── 回路分层图 ──
  _layoutMap() {
    const wrap = document.getElementById('map-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [this.mapCanvas, this.brainCanvas]) { c.width = W * dpr; c.height = H * dpr; }
    this.dpr = dpr; this.W = W; this.H = H;
    if (this.brain) { this.brain.renderer.setSize(W, H, false); this.brain.camera.aspect = W / H; this.brain.camera.updateProjectionMatrix(); }

    const neurons = this.meta.neurons;
    const bands = { 0: [0.07, 0.19], 1: [0.25, 0.36], 2: [0.42, 0.74], 3: null };
    const padX = 56, mid = W / 2, gap = 10;
    this.pos = new Float32Array(this.N * 2).fill(-1);
    this.cell = {};
    for (const layer of [0, 1, 2]) {
      const [y0, y1] = bands[layer];
      for (const side of ['left', 'right']) {
        const ids = neurons.map((n, i) => (n.layer === layer && (n.side === side || (side === 'left' && n.side === 'center')) &&
          !KEY_NODES.includes(`${n.type}_${n.side[0].toUpperCase()}`) ? i : -1)).filter(i => i >= 0);
        const x0 = side === 'left' ? padX : mid + gap, x1 = side === 'left' ? mid - gap : W - 10;
        const bw = x1 - x0, bh = (y1 - y0) * H;
        const cell = Math.max(2, Math.min(7, Math.sqrt((bw * bh) / Math.max(ids.length, 1))));
        const cols = Math.max(1, Math.floor(bw / cell));
        this.cell[layer] = cell;
        ids.forEach((i, j) => {
          const cx = side === 'left' ? x1 - (j % cols) * cell - cell : x0 + (j % cols) * cell;
          this.pos[2 * i] = cx; this.pos[2 * i + 1] = y0 * H + Math.floor(j / cols) * cell;
        });
      }
    }
    // 关键节点位置
    this.node = {};
    const relayY = 0.305 * H, dnY = 0.87 * H;
    const lw = mid - gap - padX, rw = W - 10 - (mid + gap);
    const relayX = { AOTU025_L: padX + 0.22 * lw, AOTU019_L: padX + 0.78 * lw, AOTU019_R: mid + gap + 0.22 * rw, AOTU025_R: mid + gap + 0.78 * rw };
    for (const k of KEY_NODES) this.node[k] = { x: relayX[k], y: relayY };
    const dnSpan = W - padX - 20;
    DN_NODES.forEach((k, j) => { this.node[k] = { x: padX + (j + 0.5) * dnSpan / DN_NODES.length, y: dnY }; });
    this.node.LC10a_L = { x: (padX + mid) / 2, y: 0.13 * H };
    this.node.LC10a_R = { x: (mid + W) / 2, y: 0.13 * H };
    this.bandY = { bandEye: 0.13, bandL1: 0.305, bandL2: 0.58, bandDN: 0.87 };

    // 静态底图
    const base = document.createElement('canvas');
    base.width = W * dpr; base.height = H * dpr;
    const g = base.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#0b0906'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(201,148,74,.10)'; g.beginPath(); g.moveTo(mid, 6); g.lineTo(mid, H - 6); g.stroke();
    g.font = '600 10px Inter, sans-serif'; g.fillStyle = '#6d655c'; g.textBaseline = 'middle';
    for (const [k, fy] of Object.entries(this.bandY)) g.fillText(t(k), 6, fy * H, padX - 10);
    g.textAlign = 'center'; g.fillText(t('leftBrain'), (padX + mid) / 2, 10); g.fillText(t('rightBrain'), (mid + W) / 2, 10);
    g.globalAlpha = 0.16;
    for (let i = 0; i < this.N; i++) {
      const x = this.pos[2 * i]; if (x < 0) continue;
      const c = this.cell[neurons[i].layer] || 3;
      g.fillStyle = this.color[i]; g.fillRect(x, this.pos[2 * i + 1], Math.max(1.2, c - 1), Math.max(1.2, c - 1));
    }
    this.base = base;
  }

  _drawMap(ctxRates) {
    const c = this.mapCanvas.getContext('2d'), dpr = this.dpr, W = this.W, H = this.H;
    if (!this.base) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.base, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const neurons = this.meta.neurons;
    for (let i = 0; i < this.N; i++) {
      const gl = this.glow[i]; if (gl < 0.04) continue;
      const x = this.pos[2 * i]; if (x < 0) continue;
      const s = this.cell[neurons[i].layer] || 3;
      c.globalAlpha = Math.min(1, 0.25 + gl);
      c.fillStyle = this.color[i];
      c.fillRect(x - 0.5, this.pos[2 * i + 1] - 0.5, Math.max(2, s), Math.max(2, s));
    }
    c.globalAlpha = 1;
    // 关键连接
    for (const e of this.keyEdges) {
      const a = this.node[e.a], b = this.node[e.b]; if (!a || !b) continue;
      const act = Math.min(1, (ctxRates[e.a] || 0) / 150);
      c.strokeStyle = e.s > 0 ? `rgba(232,184,109,${0.12 + 0.75 * act})` : `rgba(127,199,194,${0.12 + 0.75 * act})`;
      c.lineWidth = 0.6 + Math.min(3, Math.abs(e.s) / 250) * (0.4 + act);
      c.setLineDash(e.s > 0 ? [] : [4, 3]);
      c.beginPath(); c.moveTo(a.x, a.y);
      const my = (a.y + b.y) / 2, bend = e.a.endsWith('_L') === e.b.endsWith('_L') ? 0 : 20;
      c.bezierCurveTo(a.x, my + bend, b.x, my - bend, b.x, b.y); c.stroke();
    }
    c.setLineDash([]);
    // 关键节点
    c.font = '600 9.5px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const k of [...KEY_NODES, ...DN_NODES]) {
      const p = this.node[k]; const r = ctxRates[k] ?? this._rateOf(k); const act = Math.min(1, r / 150);
      const isGaba = k.startsWith('AOTU019');
      c.beginPath(); c.arc(p.x, p.y, 6 + 5 * act, 0, Math.PI * 2);
      c.fillStyle = isGaba ? `rgba(127,199,194,${0.2 + 0.8 * act})` : `rgba(232,184,109,${0.2 + 0.8 * act})`;
      c.fill(); c.lineWidth = 1; c.strokeStyle = isGaba ? '#7fc7c2' : '#e8b86d'; c.stroke();
      c.fillStyle = '#e8e3dc';
      const label = k.replace('_L', ' L').replace('_R', ' R');
      if (k.startsWith('DN')) { c.save(); c.translate(p.x, p.y + 10); c.fillText(label.replace('DNa', 'a'), 0, 0); c.restore(); }
      else c.fillText(label, p.x, p.y + 12);
      if (r > 1) { c.fillStyle = '#9a8f83'; c.fillText(`${r.toFixed(0)}Hz`, p.x, p.y + (k.startsWith('DN') ? 21 : 23)); }
    }
  }

  _rateOf(k) { return this.hist.length ? (this.hist[this.hist.length - 1].r[k] || 0) : 0; }

  // ── 大脑 3D ──
  _initBrain() {
    const neurons = this.meta.neurons;
    const renderer = new THREE.WebGLRenderer({ canvas: this.brainCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0b0906);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    const pos = new Float32Array(this.N * 3), col = new Float32Array(this.N * 3);
    let cx = 0, cy = 0, cz = 0;
    const cloud = this.cloud; // 全脑 13.9 万个胞体（Int16，0.1 μm），作为暗色背景勾勒出大脑形状
    if (cloud && cloud.length) {
      const M = cloud.length / 3;
      for (let i = 0; i < M; i++) { cx += cloud[3 * i]; cy += cloud[3 * i + 1]; cz += cloud[3 * i + 2]; }
      cx /= 10 * M; cy /= 10 * M; cz /= 10 * M;
      const bg = new Float32Array(M * 3);
      for (let i = 0; i < M; i++) { bg[3 * i] = cloud[3 * i] / 10 - cx; bg[3 * i + 1] = -(cloud[3 * i + 1] / 10 - cy); bg[3 * i + 2] = -(cloud[3 * i + 2] / 10 - cz); }
      const bgGeo = new THREE.BufferGeometry();
      bgGeo.setAttribute('position', new THREE.BufferAttribute(bg, 3));
      scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x9a8f83, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.16, depthWrite: false })));
    } else {
      neurons.forEach(n => { cx += n.x; cy += n.y; cz += n.z; });
      cx /= this.N; cy /= this.N; cz /= this.N;
    }
    this.baseCol = new Float32Array(this.N * 3);
    neurons.forEach((n, i) => {
      pos[3 * i] = n.x - cx; pos[3 * i + 1] = -(n.y - cy); pos[3 * i + 2] = -(n.z - cz);
      const c = new THREE.Color(this.color[i]);
      this.baseCol.set([c.r, c.g, c.b], 3 * i);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 4.5, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    camera.position.set(0, 90, cloud && cloud.length ? 1150 : 560); // 全脑宽约 820 μm
    const controls = new OrbitControls(camera, this.brainCanvas);
    controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.6;
    this.brain = { renderer, scene, camera, controls, geo };
    this._layoutMap();
  }

  _drawBrain() {
    const b = this.brain; if (!b) return;
    const col = b.geo.attributes.color.array, base = this.baseCol;
    for (let i = 0; i < this.N; i++) {
      const k = 0.07 + this.glow[i] * 1.2;
      col[3 * i] = base[3 * i] * k; col[3 * i + 1] = base[3 * i + 1] * k; col[3 * i + 2] = base[3 * i + 2] * k;
    }
    b.geo.attributes.color.needsUpdate = true;
    b.controls.update();
    b.renderer.render(b.scene, b.camera);
  }

  // ── 仪表与轨迹 ──
  _buildMeters() {
    const box = document.getElementById('meters');
    box.innerHTML = '';
    this.meterEls = {};
    for (const k of METERS) {
      const row = document.createElement('div'); row.className = 'meter';
      const color = k.startsWith('DNa02') ? '#e8b86d' : k.startsWith('AOTU019') ? '#7fc7c2' : k.startsWith('AOTU025') ? '#e8b86d' : '#8a8178';
      row.innerHTML = `<span class="nm">${k.replace('_', ' ')}</span><span class="bar"><i style="background:${color}"></i></span><span class="val">0 Hz</span>`;
      box.appendChild(row);
      this.meterEls[k] = { bar: row.querySelector('i'), val: row.querySelector('.val') };
    }
    const th = document.querySelectorAll('#steer-track .th');
    this.steerMax = Math.max(4 * this.cal.turn_th, 200);
    const p = 50 * this.cal.turn_th / this.steerMax;
    th[0].style.left = `${50 - p}%`; th[1].style.left = `${50 + p}%`;
  }

  _buildTraceLegend() {
    const el = document.getElementById('trace-legend');
    el.innerHTML = TRACE.map(s => `<span><i class="ln" style="background:${s.c};${s.dash.length ? 'background:repeating-linear-gradient(90deg,' + s.c + ' 0 4px,transparent 4px 7px)' : ''}"></i>${t(TRACE_KEYS[s.k])}</span>`).join('')
      + `<span><i class="ln" style="background:#e2735a"></i>${t('trFire')}</span>`;
  }

  _drawTrace() {
    const cv = this.traceCanvas, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const now = performance.now(), span = 4000, ymax = 260, L = 30, R = W - 4, T = 6, B = H - 14;
    const x = tt => L + (1 - (now - tt) / span) * (R - L), y = v => B - Math.min(v, ymax) / ymax * (B - T);
    c.font = '9.5px "JetBrains Mono", monospace'; c.fillStyle = '#6d655c'; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of [0, 100, 200]) {
      c.strokeStyle = 'rgba(255,255,255,.05)'; c.beginPath(); c.moveTo(L, y(v)); c.lineTo(R, y(v)); c.stroke();
      c.fillText(String(v), L - 4, y(v));
    }
    c.textAlign = 'left'; c.fillText('Hz', 2, T + 2); c.textAlign = 'right'; c.fillText('−4 s', L + 26, H - 5); c.fillText('0', R, H - 5);
    for (const h of this.hist) if (h.fire) { c.fillStyle = 'rgba(226,115,90,.35)'; c.fillRect(x(h.t), T, 1.5, B - T); }
    for (const s of TRACE) {
      c.strokeStyle = s.c; c.lineWidth = 1.5; c.setLineDash(s.dash); c.beginPath();
      this.hist.forEach((h, j) => { const px = x(h.t), py = y(h.r[s.k] || 0); j ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
    }
    c.setLineDash([]);
  }

  draw(dtWall, rates, steer, visible) {
    const decay = Math.exp(-dtWall / 0.22);
    for (let i = 0; i < this.N; i++) this.glow[i] *= decay;
    if (visible.circuit) { if (this.tab === 'map') this._drawMap(rates); else this._drawBrain(); }
    if (visible.signals) {
      for (const k of METERS) {
        const r = rates[k] || 0, m = this.meterEls[k];
        m.bar.style.width = `${Math.min(100, r / 2.5)}%`; m.val.textContent = `${r.toFixed(0)} Hz`;
      }
      const pct = 50 + 50 * Math.max(-1, Math.min(1, steer / this.steerMax));
      document.getElementById('steer-needle').style.left = `${pct}%`;
      document.getElementById('steer-val').textContent = `${steer >= 0 ? '+' : ''}${steer.toFixed(0)}`;
      this._drawTrace();
    }
    if (this.spikeWin.length) {
      const spikes = this.spikeWin.reduce((s, r) => s + r[1], 0);
      const active = new Set(); // 近 1 秒内的活跃数用最近一帧近似
      const steps = this.spikeWin.reduce((s, r) => s + r[3], 0);
      const wallS = Math.max(0.001, (performance.now() - this.spikeWin[0][0]) / 1000);
      const ratio = (steps * 1e-4) / wallS;
      let a = 0; for (let i = 0; i < this.N; i++) if (this.glow[i] > 0.2) a++;
      this.statEl.textContent = t('netStat', { a, s: Math.round(spikes / Math.max(steps * 1e-4, 1e-3)).toLocaleString(), r: ratio.toFixed(2) });
      active.clear();
    }
  }
}
