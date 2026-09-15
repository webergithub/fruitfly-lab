/**
 * WindowManager —— 把面板变成可拖动 / 最小化 / 关闭 / 拖角缩放的浮窗。
 * 与 airport-twin 的实现保持同一套交互习惯（标题栏拖动、— 最小化、✕ 关闭、右下角缩放）。
 * 关闭走 setVisible，顶栏 dock 的按钮状态由 onVisibility 回调同步。
 */
export class WindowManager {
  constructor() { this._z = 50; this._wins = new Map(); }

  register(el, opts = {}) {
    if (!el || el.classList.contains('win')) return el;
    el.classList.add('win');
    // a11y 基线（G-A11Y-1）：浮窗是非模态对话框，标题作为可访问名
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', (opts.title ?? '').replace(/<[^>]*>/g, '') || opts.id || 'panel');
    if (opts.id) this._wins.set(opts.id, el);

    const srcTitle = el.querySelector(':scope > .panel-head');
    const titleEl = srcTitle?.querySelector('h2');
    const titleHTML = opts.title ?? titleEl?.innerHTML ?? '窗口';
    const i18nKey = opts.i18n ?? titleEl?.dataset?.i18n;
    srcTitle?.remove();

    const bar = document.createElement('div');
    bar.className = 'win-bar';
    const actorChip = opts.actor
      ? `<span class="win-actor" data-i18n="actor_${opts.actor}"></span>`
      : '';
    bar.innerHTML =
      `<span class="win-title"${i18nKey ? ` data-i18n="${i18nKey}"` : ''}>${titleHTML}</span>` + actorChip +
      `<button class="win-min" title="最小化 / 还原" aria-label="minimize" aria-expanded="true">—</button>` +
      `<button class="win-close" title="关闭" aria-label="close">✕</button>`;
    if (opts.actor) el.classList.add('win-actor-' + opts.actor);

    const body = document.createElement('div');
    body.className = 'win-body';
    while (el.firstChild) body.appendChild(el.firstChild);

    el.appendChild(bar);
    el.appendChild(body);

    if (opts.resizable !== false) {
      const grip = document.createElement('div');
      grip.className = 'win-resize';
      el.appendChild(grip);
      this._bindResize(el, grip);
    }

    this._bindDrag(el, bar);
    this._bindMinimize(el, bar.querySelector('.win-min'));
    this._bindClose(el, bar.querySelector('.win-close'));
    el.addEventListener('pointerdown', () => this._raise(el), true);

    if (opts.collapsed) el.classList.add('win-collapsed');
    if (opts.hidden) el.classList.add('win-hidden');
    return el;
  }

  get(id) { return this._wins.get(id); }
  ids() { return [...this._wins.keys()]; }

  setVisible(el, on) {
    if (typeof el === 'string') el = this._wins.get(el);
    if (!el) return;
    el.classList.toggle('win-hidden', !on);
    el.setAttribute('aria-hidden', String(!on));
    if (on) { el.classList.remove('win-collapsed'); this._raise(el); }
    this._onVis?.(el, !!on);
  }
  toggle(id) { const el = this._wins.get(id); if (el) this.setVisible(el, !this.isVisible(el)); }
  isVisible(el) {
    if (typeof el === 'string') el = this._wins.get(el);
    return !!el && !el.classList.contains('win-hidden');
  }
  onVisibility(cb) { this._onVis = cb; }

  /** 全部复位到初始位置与尺寸 */
  resetLayout() {
    for (const el of this._wins.values()) {
      el.removeAttribute('style');
      delete el.dataset.winDetached;
      el.classList.remove('win-collapsed', 'win-hidden');
      el.querySelector('.win-min').textContent = '—';
    }
    this._onVis?.(null, true);
  }

  _raise(el) {
    el.style.zIndex = String(++this._z);
    // 半透明规则的"当前窗"：最近被操作的窗口保持不透明，其余淡出让 3D 透出来
    if (this._focused && this._focused !== el) this._focused.classList.remove('win-focus');
    el.classList.add('win-focus');
    this._focused = el;
  }

  // 把 CSS 定位的面板转成显式 left/top，才能自由移动
  _detach(el) {
    if (el.dataset.winDetached) return;
    const r = el.getBoundingClientRect();
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
    el.style.width = r.width + 'px';
    el.dataset.winDetached = '1';
  }

  _bindDrag(el, handle) {
    let sx, sy, ox, oy, dragging = false;
    const onMove = e => {
      if (!dragging) return;
      el.style.left = Math.max(0, Math.min(innerWidth - 80, ox + e.clientX - sx)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - 28, oy + e.clientY - sy)) + 'px';
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('.win-min, .win-close')) return;
      e.preventDefault();
      this._detach(el); this._raise(el);
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      dragging = true;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  _bindResize(el, grip) {
    let sx, sy, ow, oh, resizing = false;
    const onMove = e => {
      if (!resizing) return;
      el.style.width = Math.max(200, ow + e.clientX - sx) + 'px';
      el.style.height = Math.max(80, oh + e.clientY - sy) + 'px';
    };
    const onUp = () => {
      resizing = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      this._detach(el); this._raise(el);
      el.classList.remove('win-collapsed');
      el.style.maxHeight = 'none'; el.style.maxWidth = 'none';
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ow = r.width; oh = r.height;
      resizing = true;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  _bindMinimize(el, btn) {
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const collapsed = el.classList.toggle('win-collapsed');
      btn.textContent = collapsed ? '▢' : '—';
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  _bindClose(el, btn) {
    if (!btn) return;
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.stopPropagation(); this.setVisible(el, false); });
  }
}
