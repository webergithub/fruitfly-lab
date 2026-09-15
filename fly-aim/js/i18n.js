// OPC Studio 标准 i18n：共享 localStorage key + t() + applyLang()
export const LANG_KEY = 'opcstudio_lang';
let lang = 'zh';
try { lang = localStorage.getItem(LANG_KEY) || 'zh'; } catch { /* 隐私模式 */ }

const dict = {
  zh: {
    back: '← 返回主页', langBtn: 'EN',
    brand: '果蝇神射手', sub: 'FlyWire 真实视觉追踪回路 · 3,963 个神经元实时驱动瞄准',
    pause: '暂停', resume: '继续', brainSpeed: '大脑速度', resetLayout: '复位布局', winMin: '最小化 / 还原', winClose: '关闭',
    vpTip: '拖动旋转视角 · 滚轮缩放', loading: '正在载入果蝇连接组…',
    turnL: '◀ 左转', hold: '保持', turnR: '右转 ▶', fire: '开火',
    stSearch: '没看到目标 · 向右搜索', stTrack: '追踪中', stPaused: '已暂停',
    winCircuit: '神经回路 · 实时激活', winSignals: '关键神经元', winLab: '实验台', winScore: '战绩', winAbout: '哪些是真的',
    tabMap: '回路分层图', tabBrain: '大脑 3D 位置',
    ntAch: '乙酰胆碱（兴奋）', ntGaba: 'GABA（抑制）', ntGlu: '谷氨酸（抑制）', ntOther: '其他',
    mapNote: '亮点 = 刚刚放电',
    bandEye: '眼 · LC10a', bandL1: '第 1 层', bandL2: '第 2 层', bandDN: '下行 · DN', leftBrain: '左脑', rightBrain: '右脑',
    netStat: '活跃 {a} / 3963 · {s} 放电/秒 · 仿真 {r}× 实时',
    steerSignal: '转向信号 = (DNa02 右−左) + (AOTU019 右−左)',
    trDNa02L: 'DNa02 左', trDNa02R: 'DNa02 右', trAOTU019L: 'AOTU019 左', trAOTU019R: 'AOTU019 右', trFire: '开火',
    wiring: '接线', wiringReal: '真实连接组', wiringScr: '打乱接线（对照）',
    lesionTitle: '敲除神经元（让它沉默）', targets: '目标数量', targetSpeed: '目标速度', brainReset: '重置大脑状态',
    labHint: '试试：打乱接线，或敲除 AOTU019，看果蝇还能不能瞄准。不同条件的战绩会分别记录在「战绩」里。',
    statHits: '命中', statShots: '射击', statAcc: '命中率', statKpm: '击杀/分', statCond: '条件', statTime: '时长',
    condReal: '真实', condScr: '打乱', condLesion: '敲除',
  },
  en: {
    back: '← Home', langBtn: '中文',
    brand: 'Fly Marksman', sub: 'Real FlyWire pursuit circuit · 3,963 live neurons aim the gun',
    pause: 'Pause', resume: 'Resume', brainSpeed: 'Brain speed', resetLayout: 'Reset layout', winMin: 'Minimize / restore', winClose: 'Close',
    vpTip: 'Drag to orbit · scroll to zoom', loading: 'Loading the fly connectome…',
    turnL: '◀ Left', hold: 'Hold', turnR: 'Right ▶', fire: 'FIRE',
    stSearch: 'No target in view · searching right', stTrack: 'Tracking', stPaused: 'Paused',
    winCircuit: 'Neural circuit · live', winSignals: 'Key neurons', winLab: 'Lab bench', winScore: 'Scoreboard', winAbout: 'What is real',
    tabMap: 'Layer map', tabBrain: 'Brain 3D',
    ntAch: 'Acetylcholine (exc.)', ntGaba: 'GABA (inh.)', ntGlu: 'Glutamate (inh.)', ntOther: 'Other',
    mapNote: 'Bright dot = just fired',
    bandEye: 'Eye · LC10a', bandL1: 'Layer 1', bandL2: 'Layer 2', bandDN: 'Descending · DN', leftBrain: 'Left', rightBrain: 'Right',
    netStat: 'Active {a} / 3963 · {s} spikes/s · sim {r}× real time',
    steerSignal: 'Steer = (DNa02 R−L) + (AOTU019 R−L)',
    trDNa02L: 'DNa02 L', trDNa02R: 'DNa02 R', trAOTU019L: 'AOTU019 L', trAOTU019R: 'AOTU019 R', trFire: 'Fire',
    wiring: 'Wiring', wiringReal: 'Real connectome', wiringScr: 'Scrambled (control)',
    lesionTitle: 'Silence neurons', targets: 'Targets', targetSpeed: 'Target speed', brainReset: 'Reset brain state',
    labHint: 'Try scrambling the wiring or silencing AOTU019 and see whether the fly can still aim. Each condition is scored separately.',
    statHits: 'Hits', statShots: 'Shots', statAcc: 'Accuracy', statKpm: 'Kills/min', statCond: 'Condition', statTime: 'Time',
    condReal: 'Real', condScr: 'Scrambled', condLesion: 'silenced',
  },
};

const listeners = new Set();
export function getLang() { return lang; }
export function t(key, vars) {
  let s = dict[lang]?.[key] ?? dict.zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
export function onLang(fn) { listeners.add(fn); }
export function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const btn = document.getElementById('lang-btn');
  if (btn) btn.textContent = t('langBtn');
  document.title = `${t('brand')} · ${lang === 'zh' ? 'Fly Marksman' : '果蝇神射手'}`;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  listeners.forEach(fn => fn(lang));
}
export function toggleLang() { lang = lang === 'zh' ? 'en' : 'zh'; applyLang(); }
