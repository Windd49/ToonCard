/* 路由與啟動 */
(function () {
  'use strict';
  const TT = window.TT;

  const ROUTES = [
    [/^\/$/, 'feed'],
    [/^\/library$/, 'library'],
    [/^\/me$/, 'me'],
    [/^\/settings$/, 'settings'],
    [/^\/assets$/, 'assets'],
    [/^\/card\/([^/]+)$/, 'detail', ['id']],
    [/^\/play\/([^/]+)$/, 'play', ['sid']],
    [/^\/edit\/([^/]+)$/, 'editor', ['id']],
  ];
  const TABS = new Set(['feed', 'library', 'me', 'settings']);
  const routeName = (path) => { const p = String(path || '/').split('?')[0]; const r = ROUTES.find(([re]) => re.test(p)); return r ? r[1] : ''; };
  const curPath = () => (location.hash || '#/').slice(1) || '/';

  let current = null;
  // 每一筆瀏覽紀錄蓋上序號（history.state.ttIdx），分得出「回上一頁」和「新開一頁」，
  // 返回鍵才能回到真正的上一步（例如從遊玩畫面打開設定，返回就回到遊玩畫面）
  let idx = 0;
  let replacing = false;
  let trail = [];
  try { trail = JSON.parse(sessionStorage.getItem('tt-trail') || '[]'); } catch (e) { trail = []; }
  function stamp(first = false) {
    const st = history.state;
    if (st && typeof st.ttIdx === 'number') idx = st.ttIdx;
    else {
      if (first) { idx = 0; trail = []; } else if (!replacing) idx++;
      history.replaceState({ ...(st || {}), ttIdx: idx }, '');
      trail.length = idx;
    }
    replacing = false;
    trail[idx] = curPath();
    try { sessionStorage.setItem('tt-trail', JSON.stringify(trail)); } catch (e) { /* 忽略 */ }
  }

  TT.router = {
    go(path) {
      if (location.hash === '#' + path) TT.router.render();
      else location.hash = '#' + path;
    },
    // 有上一步就回上一步，否則到 fallback（取代目前這筆紀錄）
    back(fallback = '/') {
      if (idx > 0) history.back();
      else { replacing = true; location.replace('#' + fallback); }
    },
    canBack: () => idx > 0,
    // 上一頁是哪個畫面（feed／library／play…）
    prevRoute: () => (idx > 0 ? routeName(trail[idx - 1]) : ''),
    // 分頁（探索、書架、我的、設定）是從故事、詳情等頁面打開的：顯示返回鍵
    cameFromPage: () => { const p = TT.router.prevRoute(); return !!p && !TABS.has(p); },
    async render() {
      const full = curPath();
      const [path, qs] = full.split('?');
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      let view = null;
      let params = {};
      for (const [re, name, keys] of ROUTES) {
        const m = path.match(re);
        if (m) {
          view = name;
          (keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          break;
        }
      }
      if (!view) { location.hash = '#/'; return; }
      if (current && current.view.unmount) {
        try { current.view.unmount(); } catch (e) { console.error(e); }
      }
      const app = document.getElementById('app');
      const el = document.createElement('div');
      el.className = 'route';
      app.replaceChildren(el);
      current = { name: view, view: TT.views[view] };
      // 遊玩畫面在寬螢幕上鋪滿視窗，其他頁面維持手機寬度
      document.body.classList.toggle('play-wide', view === 'play');
      document.body.dataset.route = view;
      document.querySelectorAll('.sheet-overlay').forEach((o) => o.remove());
      try {
        await current.view.mount(el, params, query);
      } catch (e) {
        console.error(e);
        el.innerHTML = `<div class="view"><div class="empty"><h3>畫面載入失敗</h3><p>${TT.esc(e.message)}</p><a class="btn" href="#/">回首頁</a></div></div>`;
      }
    },
    get current() { return current && current.name; },
  };

  TT.app = {
    setBackdrop(kind, id) {
      TT.media.url(kind, id).then((u) => TT.app.setBackdropUrl(u));
    },
    setBackdropUrl(u) {
      if (u) document.getElementById('backdrop').style.backgroundImage = `url("${String(u).replace(/"/g, '%22')}")`;
    },
    // 用 server.js 開啟時，讀取同資料夾的 config.local.json；內容改變才套用一次，之後仍可在設定頁調整
    async applyLocalConfig() {
      if (!/^https?:$/.test(location.protocol)) return;
      try {
        const r = await fetch('config.local.json', { cache: 'no-store' });
        if (!r.ok) return;
        const text = await r.text();
        const hash = TT.hashStr(text);
        if (TT.settings.ui.localConfigHash === hash) return;
        const cfg = JSON.parse(text);
        for (const sec of ['llm', 'image', 'story', 'audio', 'net', 'chub']) {
          if (cfg[sec] && typeof cfg[sec] === 'object') TT.settings[sec] = TT.deepMerge(TT.settings[sec], cfg[sec]);
        }
        TT.settings.ui.localConfigHash = hash;
        TT.saveSettings();
        TT.toast('已套用 config.local.json 的設定', { icon: 'check', type: 'ok' });
      } catch (e) {
        console.warn('config.local.json 讀取失敗', e);
      }
    },
  };

  window.addEventListener('hashchange', () => { stamp(); TT.router.render(); });

  // 拖曳匯入
  let dragN = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    dragN++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    dragN = 0;
    document.body.classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    const card = TT.router.current === 'detail' && TT.views.detail.card;
    TT.actions.importFiles(files, { attachTo: card || null }).then(() => { if (card && TT.router.current === 'detail') TT.views.detail.render(); });
  });

  async function boot() {
    try {
      await TT.store.init();
      await TT.store.gc().catch((e) => console.warn('清理暫存故事失敗', e));
      await TT.sfx.load().catch((e) => console.warn('音效庫讀取失敗', e));
      await TT.bgm.load().catch((e) => console.warn('配樂庫讀取失敗', e));
      await TT.achv.init();
      await TT.net.detect();
      await TT.app.applyLocalConfig();
    } catch (e) {
      console.error(e);
      document.getElementById('app').innerHTML = `<div class="view"><div class="empty"><h3>無法開啟本機資料庫</h3><p>${TT.esc(e.message)}</p><p>請確認瀏覽器允許網站儲存資料（無痕模式可能無法使用）。</p></div></div>`;
      return;
    }
    stamp(!(history.state && typeof history.state.ttIdx === 'number'));
    await TT.router.render();
    document.body.classList.add('ready');
  }
  boot();
})();
