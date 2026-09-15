// 果蝇神射手：3D 场景 + 视觉编码 + LIF Worker + 读出规则 + 浮窗 UI
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WindowManager } from './window-manager.js';
import { t, applyLang, toggleLang, onLang } from './i18n.js';
import { NeuralPanel } from './neural-panel.js';

// 版本戳：index.html 以 main.js?v=x 载入，Worker 与数据跟随同一版本，避免 CDN 缓存新旧混装
const V = new URL(import.meta.url).searchParams.get('v') || '';
const vq = (p) => (V ? `${p}?v=${V}` : p);

const DEG = Math.PI / 180;
// 与 doom/fly_doom.py 相同的编码参数
const ENC = { BINO: 6, SIGMA: 0.3, MAX_RATE: 150, TAU: 0.1, FOV: 90 };
const GAME = { TURN_SPEED: 140, COOLDOWN: 0.3, TARGET_R: 0.26 };
const KEYS = ['LC10a_L', 'LC10a_R', 'AOTU019_L', 'AOTU019_R', 'AOTU025_L', 'AOTU025_R', 'DNa02_L', 'DNa02_R'];
const LESIONABLE = ['AOTU019_L', 'AOTU019_R', 'AOTU025_L', 'AOTU025_R', 'DNa02_L', 'DNa02_R'];

const S = {
  paused: false, speed: 1, scrambled: false, silenced: new Set(), nTargets: 3, tSpeed: 1,
  heading: 0, turnCmd: 0, fireCmd: false, searching: false, cooldown: 0, steer: 0, visible: 0,
  rates: Object.fromEntries(KEYS.map(k => [k, 0])), fireFlash: 0, t: 0,
};
const stats = new Map();

applyLang();
document.getElementById('lang-btn').addEventListener('click', toggleLang);

// ── 数据与 Worker ──
const [meta, edges, calFile, cloudBuf] = await Promise.all([
  fetch(vq('data/meta.json')).then(r => r.json()),
  fetch(vq('data/edges.bin')).then(r => r.arrayBuffer()),
  fetch(vq('data/cal.json')).then(r => (r.ok ? r.json() : null)).catch(() => null),
  fetch(vq('data/brain_cloud.bin')).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
]);
// ?focus=brain：打开即是大号「大脑 3D 位置」视图（等浮窗注册完再调整）
if (new URLSearchParams(location.search).get('focus') === 'brain') setTimeout(() => {
  panel.setTab('brain');
  const c = wm.get('circuit'), s = wm.get('signals');
  const narrow = innerWidth < 1000;
  Object.assign(c.style, { left: '12px', top: 'calc(var(--hdr) + 12px)', right: 'auto', bottom: 'auto', transform: 'none', maxWidth: 'none', maxHeight: 'none',
    width: narrow ? 'calc(100vw - 24px)' : 'min(1000px, calc(100vw - 420px))', height: narrow ? '62vh' : 'calc(100vh - var(--hdr) - 24px)' });
  Object.assign(s.style, narrow
    ? { left: '12px', right: 'auto', top: 'auto', bottom: '12px', width: 'calc(100vw - 24px)', height: 'calc(38vh - 90px)' }
    : { left: 'auto', right: '12px', top: 'auto', bottom: '12px', width: '380px', height: '52vh' });
  c.dataset.winDetached = s.dataset.winDetached = '1';
  wm.setVisible('lab', false); wm.setVisible('score', false); syncDock();
}, 0);
const cal = calFile?.cal ?? { turn_th: 100, fire_th: 20, quiet_th: 5 };
const N = meta.n_neurons, G = meta.groups;
const prefEcc = Float32Array.from(meta.neurons, n => 1 - (n.central ?? 0.5));

const worker = new Worker(vq('js/lif-worker.js'));
worker.postMessage({ type: 'init', n: N, nEdges: meta.n_edges, edges: edges.slice(0), params: meta.params, wSyn: meta.w_syn_mv });
const panel = new NeuralPanel({ meta, edges, cal });
panel.cloud = cloudBuf ? new Int16Array(cloudBuf) : null;

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'tick' || !m.steps) return;
  const bioDt = m.steps * 1e-4, a = Math.exp(-bioDt / ENC.TAU);
  for (const k of KEYS) {
    let s = 0; for (const i of G[k]) s += m.counts[i];
    S.rates[k] = a * S.rates[k] + (1 - a) * s / (G[k].length * bioDt);
  }
  readout();
  panel.ingest(m.counts, m.steps, S.rates, S.steer, S.fireCmd, m.cost);
};

// 固定读出规则（与 Doom 实验相同）
function readout() {
  const r = S.rates;
  S.steer = (r.DNa02_R - r.DNa02_L) + (r.AOTU019_R - r.AOTU019_L);
  S.turnCmd = S.steer > cal.turn_th ? 1 : S.steer < -cal.turn_th ? -1 : 0;
  S.fireCmd = Math.min(r.AOTU019_L, r.AOTU019_R) > cal.fire_th;
  const quiet = KEYS.reduce((s, k) => s + r[k], 0) < cal.quiet_th;
  S.searching = S.visible === 0 && quiet;
  if (S.searching) S.turnCmd = 1;
}

// ── 3D 场景 ──
const vp = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
vp.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0a07);
scene.fog = new THREE.Fog(0x0d0a07, 20, 42);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 7.5, -12.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 2);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 4; controls.maxDistance = 32;

scene.add(new THREE.HemisphereLight(0xfff1dc, 0x1a120a, 0.9));
const sun = new THREE.DirectionalLight(0xffe2b0, 1.5); sun.position.set(5, 10, -6); scene.add(sun);

const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96), new THREE.MeshStandardMaterial({ color: 0x15100b, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
for (const r of [3, 6, 9, 12]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.02, r + 0.02, 128),
    new THREE.MeshBasicMaterial({ color: 0xc9944a, transparent: true, opacity: 0.14 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
}
const wall = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.2, 4, 96, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xc9944a, transparent: true, opacity: 0.045, side: THREE.BackSide }));
wall.position.y = 2; scene.add(wall);
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.05, 1.1, 32), new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.8 }));
pedestal.position.y = 0.55; scene.add(pedestal);

// 视野扇区：±90° 可见区 + ±6° 双眼重叠区，随果蝇朝向旋转
const field = new THREE.Group(); field.position.y = 0.02; scene.add(field);
const fov = new THREE.Mesh(new THREE.CircleGeometry(11.6, 64, Math.PI, Math.PI),
  new THREE.MeshBasicMaterial({ color: 0xe8b86d, transparent: true, opacity: 0.045, depthWrite: false }));
fov.rotation.x = -Math.PI / 2; field.add(fov);
const bino = new THREE.Mesh(new THREE.CircleGeometry(11.6, 8, (270 - ENC.BINO) * DEG, 2 * ENC.BINO * DEG),
  new THREE.MeshBasicMaterial({ color: 0xe2735a, transparent: true, opacity: 0.16, depthWrite: false }));
bino.rotation.x = -Math.PI / 2; bino.position.y = 0.005; field.add(bino);

function makeFly() {
  const g = new THREE.Group();
  const cuticle = new THREE.MeshStandardMaterial({ color: 0xb07a3c, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5b3a1c, roughness: 0.6 });
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), cuticle); thorax.scale.set(0.9, 0.8, 1); g.add(thorax);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), cuticle); abdomen.scale.set(0.78, 0.68, 1.25); abdomen.position.set(0, -0.05, -1.05); g.add(abdomen);
  for (const z of [-0.75, -1.05, -1.35]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 32), dark);
    band.position.set(0, -0.05, z); band.scale.set(1.12, 0.98, 1); g.add(band);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 28, 20), cuticle); head.position.set(0, 0.05, 0.72); g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xc0332a, roughness: 0.35, emissive: 0x3a0c08 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 18), eyeMat); eye.position.set(0.24 * s, 0.1, 0.82); eye.scale.set(0.8, 1, 0.9); g.add(eye);
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.7), new THREE.MeshStandardMaterial({ color: 0xe6eef2, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    wing.position.set(0.42 * s, 0.4, -0.75); wing.rotation.set(-Math.PI / 2 + 0.12, 0, -0.35 * s); g.add(wing);
    for (const j of [-1, 0, 1]) {
      const leg = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.7, 6), dark); upper.position.y = -0.35; leg.add(upper);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.8, 6), dark); lower.position.set(0, -0.72, 0); lower.rotation.z = 0.9 * s; lower.position.x = 0.3 * s; leg.add(lower);
      leg.position.set(0.3 * s, -0.2, 0.28 * j); leg.rotation.set(0.3 * j, 0, 1.0 * s); g.add(leg);
    }
  }
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xe8b86d, emissive: 0x6b4a1c, metalness: 0.4, roughness: 0.3 }));
  gun.rotation.x = Math.PI / 2; gun.position.set(0, -0.12, 1.12); g.add(gun);
  return g;
}
const fly = makeFly(); fly.position.y = 1.55; scene.add(fly);

// 目标
const targets = [];
const tgBody = new THREE.SphereGeometry(GAME.TARGET_R, 20, 14);
const tgMat = new THREE.MeshStandardMaterial({ color: 0x1b2a29, emissive: 0x3b9c94, emissiveIntensity: 0.85, roughness: 0.4 });
const tgWingMat = new THREE.MeshBasicMaterial({ color: 0x7fc7c2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
function spawn(tg) {
  tg.ang = Math.random() * Math.PI * 2; tg.r = 5 + Math.random() * 4.5; tg.h = 0.9 + Math.random() * 2.0;
  tg.om = (0.22 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1); tg.ph = Math.random() * 6;
  tg.alive = true; tg.group.visible = true;
}
function addTarget() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(tgBody, tgMat));
  const wings = [-1, 1].map(s => { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2), tgWingMat); w.position.x = 0.28 * s; group.add(w); return w; });
  scene.add(group);
  const tg = { group, wings, respawn: 0 }; spawn(tg); targets.push(tg);
}
function syncTargetCount() {
  while (targets.length < S.nTargets) addTarget();
  while (targets.length > S.nTargets) scene.remove(targets.pop().group);
}
syncTargetCount();
// 开局让一个目标出现在视野里，第一眼就能看到瞄准
targets[0].ang = 35 * DEG; targets[0].r = 7;

// 激光与爆炸
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), new THREE.MeshBasicMaterial({ color: 0xff7a55, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(beam);
const bursts = [];
function explode(pos) {
  const n = 60, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) { p.set([pos.x, pos.y, pos.z], i * 3); v.push(new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 2.5)); }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9ee6df, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts); bursts.push({ pts, v, life: 0.7 });
}

const azOf = (p) => { let rel = Math.atan2(p.x, p.z) - S.heading; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); return -rel / DEG; };

function encode() {
  const rates = new Float32Array(N);
  let vis = 0;
  for (const tg of targets) {
    if (!tg.alive) continue;
    const p = tg.group.position, az = azOf(p);
    if (Math.abs(az) > ENC.FOV) continue;
    vis++;
    const dist = Math.hypot(p.x, p.z), ang = Math.atan(GAME.TARGET_R / dist) / DEG;
    const strength = Math.min(1, 0.35 + ang / 4.5), ecc = Math.min(Math.abs(az) / 90, 1);
    const sides = Math.abs(az) < ENC.BINO ? ['LC10a_L', 'LC10a_R'] : az > 0 ? ['LC10a_R'] : ['LC10a_L'];
    for (const sd of sides) for (const i of G[sd]) {
      const tune = Math.exp(-((prefEcc[i] - ecc) ** 2) / (2 * ENC.SIGMA ** 2));
      rates[i] = Math.min(ENC.MAX_RATE, rates[i] + ENC.MAX_RATE * strength * tune);
    }
  }
  S.visible = vis;
  return rates;
}

const condKey = () => `${S.scrambled ? 'scr' : 'real'}|${[...S.silenced].sort().join(',')}`;
function cond() { const k = condKey(); if (!stats.has(k)) stats.set(k, { time: 0, shots: 0, hits: 0 }); return stats.get(k); }

const muzzle = new THREE.Vector3(), fwd = new THREE.Vector3();
function shoot() {
  const c = cond(); c.shots++;
  fly.updateMatrixWorld();
  muzzle.set(0, -0.12, 1.4).applyMatrix4(fly.matrixWorld);
  fwd.set(Math.sin(S.heading), 0, Math.cos(S.heading));
  let best = null, bestAz = Infinity;
  for (const tg of targets) {
    if (!tg.alive) continue;
    const p = tg.group.position, az = Math.abs(azOf(p)), dist = Math.hypot(p.x, p.z);
    const tol = Math.max(2.5, 1.8 * Math.atan(GAME.TARGET_R / dist) / DEG);
    if (az < tol && az < bestAz) { best = tg; bestAz = az; }
  }
  const end = best ? best.group.position.clone() : muzzle.clone().addScaledVector(fwd, 12);
  const len = muzzle.distanceTo(end);
  beam.scale.set(1, len, 1);
  beam.position.copy(muzzle).lerp(end, 0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(muzzle).normalize());
  beam.material.opacity = 0.95;
  S.fireFlash = 0.15;
  if (best) { c.hits++; explode(best.group.position); best.alive = false; best.group.visible = false; best.respawn = 1.2; }
}

// ── 浮窗 UI ──
const wm = new WindowManager();
const WIN = { circuit: 'win-circuit', signals: 'win-signals', lab: 'win-lab', score: 'win-score', about: 'win-about' };
for (const [id, el] of Object.entries(WIN)) wm.register(document.getElementById(el), { id, hidden: id === 'about' });
const dockBtns = [...document.querySelectorAll('.dock-btn')];
const syncDock = () => dockBtns.forEach(b => b.classList.toggle('on', wm.isVisible(b.dataset.win)));
wm.onVisibility(syncDock);
dockBtns.forEach(b => b.addEventListener('click', () => wm.toggle(b.dataset.win)));
document.getElementById('btn-reset').addEventListener('click', () => { wm.resetLayout(); wm.setVisible('about', false); syncDock(); });
syncDock();
// window-manager 的按钮提示与对话框名写死为中文，这里跟随语言切换
const syncWinTitles = () => {
  document.querySelectorAll('.win-min, .win-close').forEach(b => { b.title = t(b.classList.contains('win-min') ? 'winMin' : 'winClose'); });
  document.querySelectorAll('.panel.win').forEach(p => p.setAttribute('aria-label', p.querySelector('.win-title')?.textContent || ''));
};
syncWinTitles(); onLang(syncWinTitles);

const pauseBtn = document.getElementById('btn-pause');
function setPaused(on) {
  S.paused = on; worker.postMessage({ type: 'pause', on });
  pauseBtn.dataset.i18n = on ? 'resume' : 'pause'; pauseBtn.textContent = t(pauseBtn.dataset.i18n);
  pauseBtn.classList.toggle('on', on);
}
pauseBtn.addEventListener('click', () => setPaused(!S.paused));
document.querySelectorAll('#speed-seg [data-speed]').forEach(b => b.addEventListener('click', () => {
  S.speed = +b.dataset.speed; worker.postMessage({ type: 'speed', value: S.speed });
  document.querySelectorAll('#speed-seg [data-speed]').forEach(x => x.classList.toggle('on', x === b));
}));
const setWiring = (scr) => {
  S.scrambled = scr; worker.postMessage({ type: 'scramble', on: scr }); worker.postMessage({ type: 'reset' });
  document.getElementById('wiring-real').classList.toggle('on', !scr);
  document.getElementById('wiring-scr').classList.toggle('on', scr);
};
document.getElementById('wiring-real').addEventListener('click', () => setWiring(false));
document.getElementById('wiring-scr').addEventListener('click', () => setWiring(true));
const lesBox = document.getElementById('lesions');
for (const k of LESIONABLE) {
  const lab = document.createElement('label');
  lab.innerHTML = `<input type="checkbox" id="les-${k}"> ${k.replace('_', ' ')}`;
  lab.querySelector('input').addEventListener('change', (e) => {
    e.target.checked ? S.silenced.add(k) : S.silenced.delete(k);
    worker.postMessage({ type: 'silence', ids: [...S.silenced].flatMap(g => G[g]) });
  });
  lesBox.appendChild(lab);
}
const inT = document.getElementById('in-targets'), inS = document.getElementById('in-tspeed');
inT.addEventListener('input', () => { S.nTargets = +inT.value; document.getElementById('out-targets').textContent = inT.value; syncTargetCount(); });
inS.addEventListener('input', () => { S.tSpeed = +inS.value; document.getElementById('out-tspeed').textContent = `${(+inS.value).toFixed(1)}×`; });
document.getElementById('btn-brain-reset').addEventListener('click', () => worker.postMessage({ type: 'reset' }));
document.addEventListener('visibilitychange', () => worker.postMessage({ type: 'pause', on: document.hidden || S.paused }));

function condLabel(k) {
  const [w, les] = k.split('|');
  return `${t(w === 'scr' ? 'condScr' : 'condReal')}${les ? ` · ${t('condLesion')} ${les.replaceAll('_', ' ')}` : ''}`;
}
function renderScore() {
  const c = cond();
  const kpm = c.time > 5 ? (c.hits / (c.time / 60)).toFixed(1) : '–';
  document.getElementById('k-hits').textContent = c.hits;
  document.getElementById('k-shots').textContent = c.shots;
  document.getElementById('k-acc').textContent = c.shots ? `${Math.round(100 * c.hits / c.shots)}%` : '–';
  document.getElementById('k-kpm').textContent = kpm;
  const now = condKey();
  document.getElementById('cond-body').innerHTML = [...stats].sort((a, b) => b[1].time - a[1].time).map(([k, s]) =>
    `<tr class="${k === now ? 'now' : ''}"><td>${condLabel(k)}</td><td>${Math.round(s.time)}s</td><td>${s.hits}</td>` +
    `<td>${s.time > 5 ? (s.hits / (s.time / 60)).toFixed(1) : '–'}</td><td>${s.shots ? Math.round(100 * s.hits / s.shots) + '%' : '–'}</td></tr>`).join('');
}

const hud = { L: document.getElementById('hud-left'), H: document.getElementById('hud-hold'), R: document.getElementById('hud-right'), F: document.getElementById('hud-fire'), S: document.getElementById('hud-state') };
function renderHud() {
  hud.L.classList.toggle('on', S.turnCmd < 0); hud.R.classList.toggle('on', S.turnCmd > 0); hud.H.classList.toggle('on', S.turnCmd === 0);
  hud.F.classList.toggle('on', S.fireFlash > 0);
  hud.S.textContent = S.paused ? t('stPaused') : S.searching ? t('stSearch') : t('stTrack');
}

// ── 主循环 ──
function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now(), uiClock = 0;
function frame(now) {
  const wall = Math.min(0.05, (now - last) / 1000); last = now;
  if (!S.paused) {
    const dt = wall * S.speed;
    S.t += dt; cond().time += dt;
    for (const tg of targets) {
      if (!tg.alive) { tg.respawn -= dt; if (tg.respawn <= 0) spawn(tg); continue; }
      tg.ang += tg.om * dt * S.tSpeed;
      tg.group.position.set(tg.r * Math.sin(tg.ang), tg.h + 0.25 * Math.sin(S.t * 2 + tg.ph), tg.r * Math.cos(tg.ang));
      tg.group.lookAt(0, tg.group.position.y, 0);
      tg.wings.forEach((w, j) => { w.rotation.x = Math.sin(S.t * 40 + j) * 0.6; });
    }
    // 比例转向：DNa02 左右差对应转向角速度（论文），转速 ∝ 转向信号；信号达到标定阈值时为 TURN_SPEED
    const yawRate = S.searching ? 0.6 : Math.max(-1.6, Math.min(1.6, Math.abs(S.steer) < 0.08 * cal.turn_th ? 0 : S.steer / cal.turn_th));
    S.heading -= yawRate * GAME.TURN_SPEED * DEG * dt;
    S.turnCmd = yawRate > 0.05 ? 1 : yawRate < -0.05 ? -1 : 0; // HUD 显示与实际转向一致
    const rates = encode();
    worker.postMessage({ type: 'rates', rates }, [rates.buffer]);
    S.cooldown -= dt;
    if (S.fireCmd && S.cooldown <= 0) { shoot(); S.cooldown = GAME.COOLDOWN; }
  }
  fly.rotation.y = S.heading; field.rotation.y = S.heading;
  S.fireFlash -= wall;
  beam.material.opacity = Math.max(0, beam.material.opacity - wall * 7);
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.life -= wall;
    const arr = b.pts.geometry.attributes.position.array;
    b.v.forEach((v, j) => { arr[3 * j] += v.x * wall; arr[3 * j + 1] += v.y * wall; arr[3 * j + 2] += v.z * wall; });
    b.pts.geometry.attributes.position.needsUpdate = true; b.pts.material.opacity = Math.max(0, b.life / 0.7);
    if (b.life <= 0) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); }
  }
  controls.update();
  renderer.render(scene, camera);
  const vis = (id) => wm.isVisible(id) && !wm.get(id).classList.contains('win-collapsed');
  panel.draw(wall, S.rates, S.steer, { circuit: vis('circuit'), signals: vis('signals') });
  renderHud();
  uiClock += wall;
  if (uiClock > 0.25) { uiClock = 0; if (vis('score')) renderScore(); }
  requestAnimationFrame(frame);
}
document.getElementById('loading').hidden = true;
requestAnimationFrame(frame);
