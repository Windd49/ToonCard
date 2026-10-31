/* IndexedDB 儲存層、設定與資料快取 */
(function () {
  'use strict';
  const TT = window.TT;
  const DB_NAME = 'tavern-toon';
  const DB_VER = 2; // 2：加上音效庫（sounds）

  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('personas')) db.createObjectStore('personas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('cardId', 'cardId');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        // 新版本在別的分頁開啟資料庫升級時，讓出連線（這個分頁之後重新整理即可）
        req.result.onversionchange = () => { req.result.close(); dbp = null; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('資料庫被其他分頁占用，請關閉其他分頁後重新整理'));
    });
    return dbp;
  }
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('交易中止')); });

  TT.db = {
    open,
    async get(store, key) { const db = await open(); return wrap(db.transaction(store).objectStore(store).get(key)); },
    async all(store) { const db = await open(); return wrap(db.transaction(store).objectStore(store).getAll()); },
    async byIndex(store, index, value) { const db = await open(); return wrap(db.transaction(store).objectStore(store).index(index).getAll(value)); },
    async keysByIndex(store, index, value) { const db = await open(); return wrap(db.transaction(store).objectStore(store).index(index).getAllKeys(value)); },
    async put(store, val) { const db = await open(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); return done(t); },
    async putMany(store, vals) { const db = await open(); const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store); vals.forEach((v) => s.put(v)); return done(t); },
    async del(store, key) { const db = await open(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).delete(key); return done(t); },
    async delMany(store, keys) { const db = await open(); const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store); keys.forEach((k) => s.delete(k)); return done(t); },
    async clear(store) { const db = await open(); const t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); return done(t); },
  };

  /* ---------- 設定 ---------- */
  TT.DEFAULT_NEGATIVE =
    'lowres, worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed, blurry, jpeg artifacts, text, watermark, signature, logo, speech bubble';

  TT.defaults = {
    llm: {
      preset: 'custom', type: 'openai', baseUrl: '', apiKey: '', model: '', temperature: '', topP: '', maxTokens: 2048, contextSize: 32000, stream: true, extraBody: '',
      saved: {}, safety: 'OFF', location: 'global', thinking: 'auto', showThoughts: false, modelLists: {},
    },
    image: {
      backend: 'none', baseUrl: '', apiKey: '', model: '', location: '', aspect: 'portrait', size: '', safety: 'OFF',
      steps: 28, cfg: 6, sampler: 'Euler a', comfyWorkflow: '', comfyModel: '',
      style: 'anime', customStyle: '', negative: TT.DEFAULT_NEGATIVE, auto: true, useRef: false, concurrency: 1,
      // 立繪預設不自動畫：剛進故事不產生，需要時到「立繪與特殊場景圖」匯入或生成
      sceneMode: 'background', portraits: false, scenes: true, expressions: true, preExpr: false,
    },
    story: {
      language: 'zh-Hant', length: 'medium', choices: 3, stats: true, endings: true, adaptGreeting: true, mature: false,
      useCardSystem: true, useCardPHI: true, summary: true, scanDepth: 2, mainPrompt: '', formatPrompt: '',
      viewMode: 'theater', autoPlay: false, typeSpeed: 26, textEffect: 'fade', autoSpeed: '1', minimizeUser: false, userSprite: true,
      // 優先指示（所有故事都套用的那一層）：[{ id, kind, text, on }]；prePlay：點存檔時先顯示遊玩前設定
      priority: [], prePlay: true,
    },
    // sfx：劇情裡的 [SFX] 從音效庫挑音檔播放；bgm：[BGM:名稱] 從配樂庫挑音樂循環播放
    audio: { tts: false, narratorVoice: '', charVoice: '', rate: 1.05, sfx: true, sfxVolume: 0.8, bgm: true, bgmVolume: 0.5 },
    net: { proxy: 'auto' },
    chub: { sort: 'trending', lang: '', nsfw: false, layout: 'scroll', q: '' },
    ui: { onboarded: false, defaultPersona: '', localConfigHash: 0 },
    // 費用估算用的單價（美元／每百萬 token）；沒填的用內建參考價
    usage: { prices: {}, range: 'month' },
    globalVars: {},
  };
  TT.settings = TT.clone(TT.defaults);
  const persistSettings = TT.debounce(() => TT.db.put('kv', { key: 'settings', value: TT.settings }).catch((e) => console.error(e)), 300);
  TT.saveSettings = () => persistSettings();

  /* ---------- 資料快取 ---------- */
  const sessionCache = new Map();
  const saveTimers = new Map();

  const store = (TT.store = {
    cards: [],
    personas: [],

    async init() {
      const st = await TT.db.get('kv', 'settings');
      TT.settings = TT.deepMerge(TT.defaults, st ? st.value : {});
      store.cards = (await TT.db.all('cards')).sort((a, b) => (b.lastPlayed || b.updatedAt || 0) - (a.lastPlayed || a.updatedAt || 0));
      store.personas = (await TT.db.all('personas')).sort((a, b) => a.createdAt - b.createdAt);
      if (!store.personas.length) {
        const p = { id: TT.uid(), name: '旅人', description: '', appearance: '', avatar: null, createdAt: Date.now(), updatedAt: Date.now() };
        await TT.db.put('personas', p);
        store.personas.push(p);
        TT.settings.ui.defaultPersona = p.id;
        TT.saveSettings();
      }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 忽略 */ }
    },

    /* 角色卡 */
    getCard: (id) => store.cards.find((c) => c.id === id) || null,
    // 書架上的故事；從探索點開、還沒加入書架的故事 shelved === false
    shelf: () => store.cards.filter((c) => c.shelved !== false),
    // 立繪、特殊場景圖等自己做的素材
    hasAssets: (c) => !!(Object.keys(c.expr || {}).length || Object.keys(c.sprites || {}).length || (c.cgs || []).length || (c.bgs || []).some((g) => g.blob)),
    // 只是點開看過、沒有存檔也沒有素材的故事，下次開啟時清掉
    async gc() {
      const drop = [];
      for (const c of store.cards) {
        if (c.shelved !== false || store.hasAssets(c) || c.favorite) continue;
        // 有自己的配樂的書也留著
        if (TT.bgm && (await TT.bgm.available(c.id)).length) continue;
        const keys = await TT.db.keysByIndex('sessions', 'cardId', c.id);
        if (!keys.length) drop.push(c.id);
      }
      for (const id of drop) await store.deleteCard(id);
    },
    async saveCard(card) {
      card.updatedAt = Date.now();
      if (!card.createdAt) card.createdAt = card.updatedAt;
      await TT.db.put('cards', card);
      const i = store.cards.findIndex((c) => c.id === card.id);
      if (i >= 0) store.cards[i] = card; else store.cards.unshift(card);
      TT.media.invalidate('card', card.id);
      TT.bus.emit('cards:changed');
      return card;
    },
    async deleteCard(id) {
      const sessions = await TT.db.byIndex('sessions', 'cardId', id);
      for (const s of sessions) await store.deleteSession(s.id);
      // 這本書自己的配樂一起刪掉
      if (TT.bgm) await TT.bgm.removeScope(id);
      await TT.db.del('cards', id);
      store.cards = store.cards.filter((c) => c.id !== id);
      TT.media.invalidate('card', id);
      TT.bus.emit('cards:changed');
    },

    /* 主角 */
    getPersona: (id) => store.personas.find((p) => p.id === id) || null,
    defaultPersona: () => store.getPersona(TT.settings.ui.defaultPersona) || store.personas[0],
    async savePersona(p) {
      p.updatedAt = Date.now();
      if (!p.createdAt) p.createdAt = p.updatedAt;
      await TT.db.put('personas', p);
      const i = store.personas.findIndex((x) => x.id === p.id);
      if (i >= 0) store.personas[i] = p; else store.personas.push(p);
      TT.media.invalidate('persona', p.id);
      TT.bus.emit('personas:changed');
      return p;
    },
    async deletePersona(id) {
      await TT.db.del('personas', id);
      store.personas = store.personas.filter((p) => p.id !== id);
      if (TT.settings.ui.defaultPersona === id) { TT.settings.ui.defaultPersona = store.personas[0] ? store.personas[0].id : ''; TT.saveSettings(); }
      TT.media.invalidate('persona', id);
      TT.bus.emit('personas:changed');
    },

    /* 存檔（劇情進度） */
    async getSession(id) {
      if (sessionCache.has(id)) return sessionCache.get(id);
      const s = await TT.db.get('sessions', id);
      if (s) sessionCache.set(id, s);
      return s || null;
    },
    // 寫入有防抖；immediate=true 時立即寫入
    saveSession(s, immediate = false) {
      s.updatedAt = Date.now();
      sessionCache.set(s.id, s);
      clearTimeout(saveTimers.get(s.id));
      const run = () => {
        saveTimers.delete(s.id);
        return TT.db.put('sessions', s).catch((e) => { console.error(e); TT.toast('存檔失敗：' + e.message, { type: 'error' }); });
      };
      if (immediate) return run();
      saveTimers.set(s.id, setTimeout(run, 600));
      return Promise.resolve();
    },
    async mutateSession(id, fn) {
      const s = await store.getSession(id);
      if (!s) return null;
      fn(s);
      store.saveSession(s);
      return s;
    },
    async deleteSession(id) {
      clearTimeout(saveTimers.get(id));
      saveTimers.delete(id);
      sessionCache.delete(id);
      const imgKeys = await TT.db.keysByIndex('images', 'sessionId', id);
      if (imgKeys.length) await TT.db.delMany('images', imgKeys);
      imgKeys.forEach((k) => TT.media.invalidate('img', k));
      await TT.db.del('sessions', id);
      TT.bus.emit('sessions:changed');
    },
    async sessionsForCard(cardId) {
      const list = await TT.db.byIndex('sessions', 'cardId', cardId);
      return list.map((s) => sessionCache.get(s.id) || s).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async allSessions() {
      const list = await TT.db.all('sessions');
      return list.map((s) => sessionCache.get(s.id) || s).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async flushAll() {
      const pending = [...saveTimers.keys()];
      for (const id of pending) {
        clearTimeout(saveTimers.get(id));
        saveTimers.delete(id);
        const s = sessionCache.get(id);
        if (s) await TT.db.put('sessions', s);
      }
    },

    /* 鍵值 */
    async kvGet(key, def = null) { const r = await TT.db.get('kv', key); return r ? r.value : def; },
    kvSet: (key, value) => TT.db.put('kv', { key, value }),
  });

  window.addEventListener('pagehide', () => { store.flushAll(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flushAll(); });

  /* ---------- 圖片網址快取 ---------- */
  const urlCache = new Map();
  async function blobFor(kind, id) {
    if (kind === 'card') { const c = store.getCard(id); return c && c.avatar; }
    if (kind === 'persona') { const p = store.getPersona(id); return p && p.avatar; }
    if (kind === 'img') { const r = await TT.db.get('images', id); return r ? r.blob || r.url || null : null; }
    if (kind === 'sprite') {
      // id = 角色卡（或主角）id|角色名[|表情]
      const [cid, name, expr] = id.split('|');
      const c = store.getCard(cid) || store.getPersona(cid);
      if (!c) return null;
      if (expr && c.expr && c.expr[name] && c.expr[name][expr]) return c.expr[name][expr];
      return (c.sprites && c.sprites[name]) || null;
    }
    if (kind === 'cg' || kind === 'bg') {
      // id = 角色卡 id|特殊場景圖或背景 id
      const [cid, gid] = id.split('|');
      const c = store.getCard(cid);
      const g = c && (c[kind === 'cg' ? 'cgs' : 'bgs'] || []).find((x) => x.id === gid);
      return (g && g.blob) || null;
    }
    if (kind === 'sound') { const r = await TT.db.get('sounds', id); return (r && r.blob) || null; }
    return null;
  }
  const splitRef = (ref) => { const i = ref.indexOf(':'); return [ref.slice(0, i), ref.slice(i + 1)]; };
  TT.media = {
    async url(kind, id) {
      if (!id) return '';
      const key = kind + ':' + id;
      if (urlCache.has(key)) return urlCache.get(key);
      const b = await blobFor(kind, id);
      if (!b) return '';
      const u = typeof b === 'string' ? b : URL.createObjectURL(b);
      urlCache.set(key, u);
      return u;
    },
    peek: (kind, id) => urlCache.get(kind + ':' + id) || '',
    invalidate(kind, id) {
      const key = kind + ':' + id;
      const u = urlCache.get(key);
      if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
      urlCache.delete(key);
    },
    // 將 <img data-media="kind:id"> 與 [data-bg-media] 補上實際網址
    hydrate(root) {
      root.querySelectorAll('[data-media]').forEach(async (el) => {
        const [kind, id] = splitRef(el.dataset.media);
        const u = await TT.media.url(kind, id);
        if (u) { el.src = u; el.classList.add('loaded'); } else el.classList.add('empty');
      });
      root.querySelectorAll('[data-bg-media]').forEach(async (el) => {
        const [kind, id] = splitRef(el.dataset.bgMedia);
        const u = await TT.media.url(kind, id);
        if (u) el.style.backgroundImage = `url("${u}")`;
      });
    },
  };
})();
