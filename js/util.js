/* 漫劇卡 ToonCard — 共用工具函式 */
(function () {
  'use strict';
  const TT = (window.TT = window.TT || {});
  TT.views = TT.views || {};

  /* ---------- HTML 組裝與跳脫 ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  TT.esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ESC[c]);

  class Raw {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  TT.raw = (s) => new Raw(s == null ? '' : String(s));

  function interp(v) {
    if (v == null || v === false) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(interp).join('');
    return TT.esc(v);
  }
  // 標記模板：插值一律跳脫，只有 TT.raw()/TT.html 的結果原樣輸出
  TT.html = (strings, ...vals) => {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += interp(vals[i]) + strings[i + 1];
    return new Raw(out);
  };
  TT.setHTML = (el, content) => { el.innerHTML = String(content); return el; };

  TT.$ = (sel, root = document) => root.querySelector(sel);
  TT.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  TT.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  TT.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 可中斷的等待：signal 被中止時立刻丟出 AbortError（停止生成時不用等重試倒數）
  TT.wait = (ms, signal) => new Promise((res, rej) => {
    const abort = () => rej(new DOMException('aborted', 'AbortError'));
    if (signal && signal.aborted) return abort();
    const onAbort = () => { clearTimeout(t); abort(); };
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); res(); }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  TT.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  TT.truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  TT.debounce = (fn, ms) => {
    let t = null;
    const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    d.flush = (...args) => { clearTimeout(t); fn(...args); };
    return d;
  };

  TT.getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  TT.setPath = (obj, path, val) => {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
      o = o[ks[i]];
    }
    o[ks[ks.length - 1]] = val;
  };
  const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Blob);
  TT.deepMerge = (base, extra) => {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!isPlain(extra)) return out;
    for (const [k, v] of Object.entries(extra)) {
      out[k] = isPlain(v) && isPlain(base[k]) ? TT.deepMerge(base[k], v) : v;
    }
    return out;
  };
  TT.clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  /* ---------- 文字 ---------- */
  // 粗估 token：中日韓字元約 1 token，其餘約 3.6 字元 1 token
  TT.estimateTokens = (s) => {
    if (!s) return 0;
    s = String(s);
    let cjk = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x2e80) cjk++;
    return Math.ceil(cjk * 1.1 + (s.length - cjk) / 3.6);
  };

  TT.stripHtml = (s) => {
    if (!s) return '';
    if (!/[<&]/.test(s)) return String(s);
    try {
      const doc = new DOMParser().parseFromString(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n'), 'text/html');
      doc.querySelectorAll('style,script').forEach((n) => n.remove());
      return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) {
      return String(s);
    }
  };

  // 輕量 Markdown：先跳脫，再處理 **粗體**、*斜體*、換行
  TT.mdLite = (s) =>
    TT.esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/\n/g, '<br>');

  TT.fmtTime = (ts) => {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60e3) return '剛剛';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分鐘前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小時前';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
    const t = new Date(ts);
    return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
  };

  TT.hashStr = (s) => {
    let h = 2166136261;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  TT.hashColor = (s, sat = 62, light = 58) => `hsl(${TT.hashStr(s) % 360} ${sat}% ${light}%)`;

  /* ---------- 二進位 / Base64 ---------- */
  TT.b64ToBytes = (b64) => {
    const bin = atob(String(b64).replace(/[\s\r\n]/g, ''));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  TT.bytesToB64 = (u8) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  };
  TT.utf8ToB64 = (str) => TT.bytesToB64(new TextEncoder().encode(str));
  TT.b64ToUtf8 = (b64) => new TextDecoder().decode(TT.b64ToBytes(b64));

  TT.blobToDataURL = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  TT.dataURLToBlob = (url) => {
    const i = url.indexOf(',');
    const head = url.slice(0, i);
    const data = url.slice(i + 1);
    const mime = (head.match(/data:([^;,]+)/) || [])[1] || 'application/octet-stream';
    const bytes = /;base64/i.test(head) ? TT.b64ToBytes(data) : new TextEncoder().encode(decodeURIComponent(data));
    return new Blob([bytes], { type: mime });
  };

  // 備份與素材包：物件裡所有的圖片、音檔（Blob）都轉成 { __blob: data URL }，匯入時再轉回來
  TT.encodeBlobs = async (v) => {
    if (v instanceof Blob) return { __blob: await TT.blobToDataURL(v) };
    if (Array.isArray(v)) return Promise.all(v.map(TT.encodeBlobs));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = await TT.encodeBlobs(x);
      return out;
    }
    return v;
  };
  TT.decodeBlobs = (v) => {
    if (Array.isArray(v)) return v.map(TT.decodeBlobs);
    if (v && typeof v === 'object') {
      if (typeof v.__blob === 'string' && Object.keys(v).length === 1) return TT.dataURLToBlob(v.__blob);
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = TT.decodeBlobs(x);
      return out;
    }
    return v;
  };

  TT.loadImage = (src) =>
    new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('圖片載入失敗'));
      img.src = src;
    });

  // 等比縮小圖片（用於參考圖、頭像）
  TT.resizeImageBlob = async (blob, maxDim = 768, type = 'image/jpeg', quality = 0.9) => {
    const url = URL.createObjectURL(blob);
    try {
      const img = await TT.loadImage(url);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
      g.drawImage(img, 0, 0, w, h);
      return await new Promise((r) => c.toBlob(r, type, quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  TT.download = (filename, data, mime = 'application/octet-stream') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };

  TT.safeFileName = (s) => String(s || 'untitled').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);

  TT.pickFiles = ({ accept = '', multiple = false } = {}) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      let done = false;
      const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
      input.addEventListener('change', () => finish(Array.from(input.files || [])));
      input.addEventListener('cancel', () => finish([]));
      input.click();
    });

  /* ---------- 事件匯流排 ---------- */
  const handlers = {};
  TT.bus = {
    on(evt, fn) {
      (handlers[evt] = handlers[evt] || new Set()).add(fn);
      return () => handlers[evt] && handlers[evt].delete(fn);
    },
    emit(evt, data) {
      (handlers[evt] || []).forEach((fn) => {
        try { fn(data); } catch (e) { console.error('[bus]', evt, e); }
      });
    },
  };

  /* ---------- 提示訊息 ---------- */
  TT.toast = (msg, opts = {}) => {
    const root = document.getElementById('toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (opts.type || '');
    el.innerHTML = (opts.icon && TT.icon ? TT.icon(opts.icon, 18) : '') + `<span>${TT.esc(msg)}</span>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, opts.duration || 2800);
  };

  /* ---------- 底部彈出面板 ---------- */
  // sheet({ title, body, actions:[{label, value, primary, danger}], wide, back, onMount(el, close) })
  // 回傳 Promise，按下 action 時以其 value 解析；關閉則為 null；back 時標題左邊多一個返回鍵，按下解析為 '__back'
  TT.sheet = (opts) => {
    const root = document.getElementById('modal-root');
    const ov = document.createElement('div');
    ov.className = 'sheet-overlay';
    const acts = (opts.actions || [])
      .map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-sheet-act="${i}">${TT.esc(a.label)}</button>`)
      .join('');
    ov.innerHTML = `
      <div class="sheet ${opts.wide ? 'wide' : ''} ${opts.className || ''}" role="dialog" aria-modal="true">
        <div class="sheet-grip"></div>
        ${opts.title ? `<div class="sheet-head">${opts.back ? `<button class="icon-btn sheet-back" data-sheet-back aria-label="返回上一步">${TT.icon('back', 20)}</button>` : ''}<h3>${TT.esc(opts.title)}</h3><button class="icon-btn" data-sheet-close aria-label="關閉">${TT.icon('x', 20)}</button></div>` : ''}
        <div class="sheet-body">${opts.body ? String(opts.body) : ''}</div>
        ${acts ? `<div class="sheet-actions">${acts}</div>` : ''}
      </div>`;
    root.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    let resolve;
    const p = new Promise((r) => (resolve = r));
    let closed = false;
    const close = (val = null) => {
      if (closed) return;
      closed = true;
      ov.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => ov.remove(), 260);
      if (opts.onClose) opts.onClose(val);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape' && opts.dismissable !== false) close(null); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', async (e) => {
      if (e.target === ov && opts.dismissable !== false) return close(null);
      if (e.target.closest('[data-sheet-close]')) return close(null);
      if (e.target.closest('[data-sheet-back]')) return close('__back');
      const b = e.target.closest('[data-sheet-act]');
      if (b) {
        const a = opts.actions[+b.dataset.sheetAct];
        if (a.onClick) {
          const r = await a.onClick(ov.querySelector('.sheet'), close);
          if (r === false) return;
        }
        close(a.value !== undefined ? a.value : true);
      }
    });
    if (opts.onMount) opts.onMount(ov.querySelector('.sheet'), close);
    p.close = close;
    p.el = ov.querySelector('.sheet');
    return p;
  };

  TT.confirm = (message, { title = '確認', okText = '確定', cancelText = '取消', danger = false } = {}) =>
    TT.sheet({
      title,
      body: `<p class="sheet-msg">${TT.esc(message)}</p>`,
      actions: [
        { label: cancelText, value: false },
        { label: okText, value: true, primary: !danger, danger },
      ],
    }).then((v) => v === true);

  TT.promptText = (title, value = '', { multiline = false, placeholder = '', okText = '確定', hint = '' } = {}) =>
    TT.sheet({
      title,
      body: `${hint ? `<p class="hint">${TT.esc(hint)}</p>` : ''}${
        multiline
          ? `<textarea class="input" rows="8" data-prompt-input placeholder="${TT.esc(placeholder)}">${TT.esc(value)}</textarea>`
          : `<input class="input" data-prompt-input placeholder="${TT.esc(placeholder)}" value="${TT.esc(value)}">`
      }`,
      actions: [
        { label: '取消', value: null },
        { label: okText, primary: true, onClick: (el, close) => { close(el.querySelector('[data-prompt-input]').value); return false; } },
      ],
      onMount: (el, close) => {
        const inp = el.querySelector('[data-prompt-input]');
        setTimeout(() => { inp.focus(); if (!multiline) inp.select(); }, 60);
        if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) close(inp.value); });
      },
    });

  // 動作選單：options [{label, value, icon, danger, disabled}]；opts.back 顯示返回上一步；opts.wrap 讓長的選項換行顯示完整
  TT.choose = (title, options, opts = {}) =>
    TT.sheet({
      title,
      back: opts.back,
      className: 'action-sheet' + (opts.wrap ? ' wrap-items' : ''),
      body: `<div class="menu-list">${options
        .map(
          (o, i) =>
            `<button class="menu-item ${o.danger ? 'danger' : ''}" data-choose="${i}" ${o.disabled ? 'disabled' : ''}>${o.icon ? TT.icon(o.icon, 20) : ''}<span>${TT.esc(o.label)}</span>${o.hint ? `<small>${TT.esc(o.hint)}</small>` : ''}</button>`
        )
        .join('')}</div>`,
      onMount: (el, close) => {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-choose]');
          if (b) close(options[+b.dataset.choose].value);
        });
      },
    });
})();
