/* 音效庫與配樂庫：匯入音檔、依名稱或內容挑選。
 * 音效：劇情裡的 [SFX] 依音效名稱或擬聲詞內容挑一個音檔播放（不顯示置中的大字）
 * 配樂（BGM）：劇情裡的 [BGM:名稱] 換配樂（循環播放、淡入淡出），[BGM:off] 停止 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  // 常用種類：名稱＋用來比對擬聲詞、檔名的關鍵字（正規表示式）。還沒有音檔的種類不會告訴 AI
  const SFX_PRESETS = [
    ['敲門', '敲門|叩叩|knock'],
    ['開門', '開門|推開|吱呀|door.?open|creak'],
    ['關門', '關門|甩上|door.?(close|slam)|slam'],
    ['腳步聲', '腳步|步伐|噠噠|footstep|steps?\\b|walk'],
    ['奔跑', '奔跑|狂奔|run'],
    ['心跳', '心跳|噗通|撲通|怦|heart.?beat'],
    ['刀劍', '劍|刀|鏘|鏗|錚|sword|blade|clash|slash'],
    ['打擊', '拳|揍|踢|打擊|啪|punch|hit|impact|kick'],
    ['爆炸', '爆炸|轟|explosion|boom|blast'],
    ['槍聲', '槍|gun|shot'],
    ['雷聲', '雷|閃電|thunder'],
    ['雨聲', '雨|淅瀝|rain'],
    ['風聲', '風|wind'],
    ['水聲', '水|嘩啦|潑|滴答|water|splash|drip'],
    ['鳥鳴', '鳥|bird|chirp'],
    ['鐘聲', '鐘|噹|bell|chime'],
    ['電話', '電話|手機|鈴聲|phone|ring'],
    ['碎裂', '玻璃|碎|破裂|glass|shatter|break'],
    ['尖叫', '尖叫|驚叫|scream'],
    ['笑聲', '笑聲|哈哈|laugh|giggle'],
    ['親吻', '親吻|吻|kiss'],
    ['衣物摩擦', '衣|布料|窸窣|沙沙|cloth|rustle'],
    ['倒地', '倒地|摔|跌|fall|thud'],
    ['魔法', '魔法|咒|光芒|magic|spell'],
  ];
  const BGM_PRESETS = [
    ['日常', '日常|平靜|輕鬆|daily|calm|peaceful|relax'],
    ['溫馨', '溫馨|溫暖|治癒|warm|gentle|heal'],
    ['歡樂', '歡樂|開心|熱鬧|happy|cheerful|fun'],
    ['浪漫', '浪漫|戀愛|心動|曖昧|romance|romantic|love'],
    ['悲傷', '悲傷|哀傷|難過|離別|sad|sorrow|tragic'],
    ['緊張', '緊張|懸疑|危機|tension|suspense|tense'],
    ['戰鬥', '戰鬥|打鬥|交手|battle|fight|combat|action'],
    ['神秘', '神秘|奇幻|mystery|mysterious|fantasy'],
    ['恐怖', '恐怖|驚悚|陰森|horror|scary|creepy'],
    ['搞笑', '搞笑|滑稽|comedy|funny|comic'],
    ['夜晚', '夜晚|深夜|月夜|night|moon'],
    ['雨天', '雨天|下雨|rain'],
    ['史詩', '史詩|壯闊|宏大|epic|grand'],
    ['結局', '結局|尾聲|ending|finale|credits'],
  ];
  const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const wordsRe = (w) => { try { return w ? new RegExp(w, 'i') : null; } catch (e) { return null; } };

  // 一種音檔庫（音效或配樂）：記錄都存在 sounds，配樂的 type 是 'bgm'（舊的音效沒有 type）。
  // 配樂每本書分開：記錄上有 cardId，scope 就是那本書的 id；沒有 cardId 的是改版前所有書共用的配樂，可以一鍵加入某本書
  function makeLib(type, presets, label) {
    const scoped = type === 'bgm';
    const mine = (r) => (type === 'bgm' ? r.type === 'bgm' : r.type !== 'bgm');
    const inScope = (r, scope) => !scoped || (r.cardId || '') === (scope || '');
    let cache = null;
    async function load() {
      if (!cache) cache = (await TT.db.all('sounds')).filter(mine);
      return cache;
    }
    function kindsOf(list) {
      const map = new Map();
      for (const [name, words] of presets) map.set(name, { name, words, files: [], preset: true });
      for (const r of list) {
        let k = map.get(r.name);
        if (!k) { k = { name: r.name, words: r.words || '', files: [], preset: false }; map.set(r.name, k); }
        if (r.words && !k.preset) k.words = r.words;
        k.files.push(r);
      }
      return [...map.values()];
    }
    const kinds = async (scope) => kindsOf((await load()).filter((r) => inScope(r, scope)));
    const available = async (scope) => (await kinds(scope)).filter((k) => k.files.length);
    // 給提示詞用（同步）：有音檔的種類名稱
    const names = (scope) => (cache ? kindsOf(cache.filter((r) => inScope(r, scope))).filter((k) => k.files.length).map((k) => k.name) : []);

    // 依名稱或內容找一種有音檔的
    function match(list, name, text) {
      const n = norm(name);
      if (n) {
        const exact = list.find((k) => norm(k.name) === n);
        if (exact) return exact;
        const part = list.find((k) => norm(k.name).length >= 2 && (norm(k.name).includes(n) || n.includes(norm(k.name))));
        if (part) return part;
      }
      const t = `${name || ''} ${text || ''}`;
      for (const k of list) { const re = wordsRe(k.words); if (re && re.test(t)) return k; }
      return list.find((k) => k.name.length >= 2 && t.includes(k.name)) || null;
    }

    // 由檔名猜種類：符合常用種類的關鍵字就歸進去，否則用檔名當新的種類
    function guess(fileName) {
      const stem = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
      for (const [name, words] of presets) {
        const re = wordsRe(words);
        if (stem.includes(name) || (re && re.test(stem))) return name;
      }
      return stem.replace(/\s*\d+$/, '').slice(0, 16) || label;
    }

    // 配樂記錄要帶的欄位（type 與所屬的書）
    const tagOf = (scope) => (type === 'bgm' ? { type: 'bgm', ...(scope ? { cardId: scope } : {}) } : {});

    async function addFiles(files, name = '', scope = '') {
      const list = await load();
      const added = [];
      for (const f of files) {
        if (!/^audio\//.test(f.type || '') && !AUDIO_EXT.test(f.name || '')) continue;
        const blob = new Blob([f], { type: f.type || 'audio/mpeg' });
        const rec = { id: TT.uid(), name: String(name || guess(f.name)).trim(), words: '', blob, file: f.name || '', createdAt: Date.now(), ...tagOf(scope) };
        await TT.db.put('sounds', rec);
        list.push(rec);
        added.push(rec);
      }
      if (added.length) TT.bus.emit('sfx:changed', { type, scope });
      return added;
    }
    async function remove(id) {
      await TT.db.del('sounds', id);
      cache = (await load()).filter((r) => r.id !== id);
      TT.media.invalidate('sound', id);
      TT.bus.emit('sfx:changed', { type });
    }
    async function update(name, fn, scope = '') {
      for (const r of (await load()).filter((x) => x.name === name && inScope(x, scope))) { fn(r); await TT.db.put('sounds', r); }
      TT.bus.emit('sfx:changed', { type, scope });
    }
    // 把別的書（或改版前共用）的配樂複製一份到這本書
    async function copyTo(records, scope) {
      const list = await load();
      const have = new Set(list.filter((r) => inScope(r, scope)).map((r) => `${r.name}|${r.file}|${r.blob && r.blob.size}`));
      let n = 0;
      for (const r of records) {
        if (have.has(`${r.name}|${r.file}|${r.blob && r.blob.size}`)) continue;
        const rec = { id: TT.uid(), name: r.name, words: r.words || '', blob: r.blob, file: r.file || '', createdAt: Date.now(), ...tagOf(scope) };
        await TT.db.put('sounds', rec);
        list.push(rec);
        n++;
      }
      if (n) TT.bus.emit('sfx:changed', { type, scope });
      return n;
    }
    // 其他書與改版前共用的配樂：[{ scope, files: [記錄] }]（scope 空白＝共用）
    async function elsewhere(scope) {
      const groups = new Map();
      for (const r of await load()) {
        if (inScope(r, scope)) continue;
        const k = r.cardId || '';
        if (!groups.has(k)) groups.set(k, { scope: k, files: [] });
        groups.get(k).files.push(r);
      }
      return [...groups.values()];
    }
    // 書被刪除時，它的配樂一起刪掉
    async function removeScope(scope) {
      if (!scoped || !scope) return;
      const gone = (await load()).filter((r) => r.cardId === scope);
      for (const r of gone) { await TT.db.del('sounds', r.id); TT.media.invalidate('sound', r.id); }
      cache = (await load()).filter((r) => r.cardId !== scope);
      if (gone.length) TT.bus.emit('sfx:changed', { type, scope });
    }

    async function exportLib(scope = '') {
      const list = (await load()).filter((r) => inScope(r, scope)).map(({ id, name, words, blob, file }) => ({ id, name, words, blob, file }));
      return JSON.stringify(await TT.encodeBlobs({ type: type === 'bgm' ? 'tavern-toon-bgm' : 'tavern-toon-sounds', version: 1, sounds: list }));
    }
    async function importLib(text, scope = '') {
      let d;
      try { d = TT.decodeBlobs(JSON.parse(text)); } catch (e) { throw new Error('檔案格式錯誤'); }
      if (!d || d.type !== (type === 'bgm' ? 'tavern-toon-bgm' : 'tavern-toon-sounds')) throw new Error(`這不是漫劇卡的${label}庫檔案`);
      let n = 0;
      for (const r of d.sounds || []) {
        if (!(r.blob instanceof Blob)) continue;
        // 配樂匯入到某本書時用新的 id，同一個檔案可以放進好幾本書
        await TT.db.put('sounds', { id: scoped ? TT.uid() : r.id || TT.uid(), name: r.name || label, words: r.words || '', blob: r.blob, file: r.file || '', createdAt: Date.now(), ...tagOf(scope) });
        n++;
      }
      cache = null;
      await load();
      TT.bus.emit('sfx:changed', { type, scope });
      return n;
    }

    return { load, kinds, available, names, match, guess, addFiles, remove, update, copyTo, elsewhere, removeScope, exportLib, importLib };
  }

  const sfxLib = makeLib('sfx', SFX_PRESETS, '音效');
  const bgmLib = makeLib('bgm', BGM_PRESETS, '配樂');

  /* ---------- 音效播放 ---------- */
  const playing = new Set();
  async function playRecord(r, volume) {
    const url = await TT.media.url('sound', r.id);
    if (!url) return false;
    const au = new Audio(url);
    au.volume = volume != null ? volume : Math.max(0, Math.min(1, +TT.settings.audio.sfxVolume || 0.8));
    playing.add(au);
    au.onended = () => playing.delete(au);
    au.play().catch(() => playing.delete(au));
    return au;
  }
  // 播放劇情裡的一個 [SFX]；回傳播放的音效名稱（沒有適合的音檔就回傳 null）
  async function playSfx(beat) {
    if (TT.settings.audio.sfx === false) return null;
    const k = sfxLib.match(await sfxLib.available(), beat.name, beat.text);
    if (!k) return null;
    return (await playRecord(k.files[Math.floor(Math.random() * k.files.length)])) ? k.name : null;
  }
  function stopSfx() {
    playing.forEach((a) => a.pause());
    playing.clear();
  }

  /* ---------- 配樂播放：循環、換曲時淡入淡出（只用這本書自己的配樂） ---------- */
  const P = { name: '', scope: '', el: null };
  const bgmVol = () => Math.max(0, Math.min(1, TT.settings.audio.bgmVolume != null && TT.settings.audio.bgmVolume !== '' ? +TT.settings.audio.bgmVolume : 0.5));
  function fade(el, to, ms, done) {
    const from = el.volume;
    const t0 = performance.now();
    clearInterval(el._fade);
    el._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(el._fade); if (done) done(); }
    }, 40);
  }
  // name 空白＝停止；這本書（scope）沒有這種配樂的音檔時維持目前播放的（換了書就停掉上一本的）
  async function setTrack(name, scope = '') {
    if (TT.settings.audio.bgm === false || !name) return stopBgm();
    const k = bgmLib.match(await bgmLib.available(scope), name, '');
    if (!k) return P.scope === scope ? P.name : stopBgm();
    if (P.name === k.name && P.scope === scope && P.el && !P.el.paused) return P.name;
    const r = k.files[Math.floor(Math.random() * k.files.length)];
    const url = await TT.media.url('sound', r.id);
    if (!url) return P.name;
    const old = P.el;
    const au = new Audio(url);
    au.loop = true;
    au.volume = 0;
    P.el = au;
    P.name = k.name;
    P.scope = scope;
    const start = () => au.play().then(() => fade(au, bgmVol(), 1200));
    // 瀏覽器不允許自動播放時，等使用者下一次點畫面再開始
    start().catch(() => document.addEventListener('pointerdown', () => { if (P.el === au) start().catch(() => {}); }, { once: true }));
    if (old) fade(old, 0, 900, () => old.pause());
    TT.bus.emit('bgm:changed', { name: k.name });
    return k.name;
  }
  function stopBgm(ms = 700) {
    const old = P.el;
    P.el = null;
    P.name = '';
    P.scope = '';
    if (old) fade(old, 0, ms, () => old.pause());
    TT.bus.emit('bgm:changed', { name: '' });
    return '';
  }
  function setBgmVolume() { if (P.el) { clearInterval(P.el._fade); P.el.volume = bgmVol(); } }

  /* ---------- 管理面板（音效庫、配樂庫共用；配樂庫是某一本書的） ---------- */
  function manager(lib, { title, intro, onKey, volKey, offText, back = false, playable, scoped = false }) {
    return async function open(opts = {}) {
      await lib.load();
      const a = TT.settings.audio;
      const card = scoped ? opts.card : null;
      const scope = card ? card.id : '';
      let off = () => {};
      const res = await TT.sheet({
        title: card ? `${title}・${card.name}` : title,
        wide: true,
        back: opts.back != null ? opts.back : back,
        className: 'sfx-sheet',
        body: html`<div class="sfx">
          <p class="hint">${intro}</p>
          <label class="switch-row"><span><b>${offText[0]}</b><small>${offText[1]}</small></span><input type="checkbox" class="switch" data-sfx="on" ${a[onKey] !== false ? 'checked' : ''}></label>
          <label class="field"><span>音量</span><input type="range" min="0" max="1" step="0.05" data-sfx="vol" value="${a[volKey] != null && a[volKey] !== '' ? +a[volKey] : volKey === 'bgmVolume' ? 0.5 : 0.8}"></label>
          <div class="btn-row wrap">
            <button class="btn small" data-sfx="bulk">${icon('upload', 16)} 批次匯入（依檔名分類）</button>
            <button class="btn small" data-sfx="add">${icon('plus', 16)} 新增種類</button>
            ${scoped ? html`<button class="btn small" data-sfx="export">${icon('download', 16)} 匯出這本書的配樂</button><button class="btn small" data-sfx="importlib">${icon('upload', 16)} 匯入配樂檔（.json）</button>` : ''}
          </div>
          <div class="sfx-list" data-sfx="list"></div>
          ${scoped ? html`<div class="sfx-other" data-sfx="other"></div>` : ''}
        </div>`,
        actions: [{ label: '完成', primary: true }],
        onMount: (el) => {
          const box = el.querySelector('[data-sfx="list"]');
          const otherBox = el.querySelector('[data-sfx="other"]');
          let preview = null;
          // 其他書、以及改版前所有書共用的配樂：一鍵加入這本書
          const renderOther = async () => {
            if (!otherBox) return;
            const groups = (await lib.elsewhere(scope)).map((g) => ({ ...g, card: g.scope ? TT.store.getCard(g.scope) : null })).filter((g) => !g.scope || g.card);
            otherBox.innerHTML = groups.length ? String(html`<h4 class="sec-title">其他書的配樂 <small>點「加入這本書」複製一份過來，之後兩邊各自獨立</small></h4>
              ${groups.map((g) => html`<div class="sfx-row has" data-from="${g.scope}">
                <span class="sfx-ic">${icon(g.card ? 'book' : 'music', 16)}</span>
                <span class="sfx-main"><b>${g.card ? g.card.name : '改版前共用的配樂'}</b><small>${[...new Set(g.files.map((r) => r.name))].join('、')}（${g.files.length} 首）</small></span>
                <button class="btn small" data-sfx="copy">${icon('plus', 14)} 加入這本書</button>
              </div>`)}`) : '';
          };
          const render = async () => {
            renderOther();
            const ks = await lib.kinds(scope);
            box.innerHTML = ks.map((k) => String(html`<div class="sfx-row ${k.files.length ? 'has' : ''}" data-name="${k.name}">
              <span class="sfx-ic">${icon('music', 16)}</span>
              <span class="sfx-main"><b>${k.name}</b><small>${k.files.length ? `${k.files.length} 個音檔` : '尚未匯入'}</small></span>
              ${k.files.length ? html`<button class="icon-btn" data-sfx="play" title="試聽">${icon('play', 16)}</button>` : ''}
              <button class="btn small" data-sfx="import">${icon('upload', 14)} 匯入</button>
              ${k.files.length || !k.preset ? html`<button class="icon-btn" data-sfx="more" title="更多">${icon('more', 18)}</button>` : ''}
            </div>`)).join('');
          };
          render();
          const offChanged = TT.bus.on('sfx:changed', render);
          off = () => { offChanged(); if (preview) preview.pause(); };
          el.addEventListener('change', (e) => {
            const t = e.target;
            if (t.dataset.sfx === 'on') { a[onKey] = t.checked; TT.saveSettings(); TT.bus.emit('audio:settings'); }
            if (t.dataset.sfx === 'vol') { a[volKey] = +t.value; TT.saveSettings(); TT.bus.emit('audio:settings'); }
          });
          el.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-sfx]');
            if (!b || b.tagName === 'INPUT') return;
            const row = b.closest('[data-name]');
            const name = row && row.dataset.name;
            const k = name && (await lib.kinds(scope)).find((x) => x.name === name);
            switch (b.dataset.sfx) {
              case 'copy': {
                const from = b.closest('[data-from]').dataset.from;
                const g = (await lib.elsewhere(scope)).find((x) => x.scope === from);
                const n = g ? await lib.copyTo(g.files, scope) : 0;
                TT.toast(n ? `已把 ${n} 首配樂加入「${card.name}」` : '這些配樂這本書已經有了', { type: n ? 'ok' : '', icon: n ? 'check' : 'music' });
                return;
              }
              case 'export': {
                if (!(await lib.available(scope)).length) return TT.toast('這本書還沒有配樂');
                TT.download(TT.safeFileName(`${card.name}-配樂`) + '.json', await lib.exportLib(scope), 'application/json');
                return;
              }
              case 'importlib': {
                const [f] = await TT.pickFiles({ accept: '.json,application/json' });
                if (!f) return;
                try { TT.toast(`已匯入 ${await lib.importLib(await f.text(), scope)} 首配樂到「${card.name}」`, { icon: 'check', type: 'ok' }); } catch (err) { TT.toast(err.message, { type: 'error' }); }
                return;
              }
              case 'bulk': {
                const files = await TT.pickFiles({ accept: 'audio/*', multiple: true });
                const added = await lib.addFiles(files, '', scope);
                if (files.length) TT.toast(added.length ? `已匯入 ${added.length} 個音檔：${[...new Set(added.map((r) => r.name))].join('、')}` : '沒有可用的音檔（支援 mp3、wav、ogg、m4a 等）', { type: added.length ? 'ok' : 'error', duration: 4000 });
                return;
              }
              case 'add': {
                const n = await TT.promptText('新增種類', '', { placeholder: playable ? '例如：拔刀、馬蹄聲、鐘樓' : '例如：茶館、決戰前夕、回憶', hint: '接著選擇音檔；AI 演出時會用這個名稱叫出它。' });
                if (!n || !n.trim()) return;
                const files = await TT.pickFiles({ accept: 'audio/*', multiple: true });
                if (files.length) await lib.addFiles(files, n.trim(), scope);
                return;
              }
              case 'import': {
                const files = await TT.pickFiles({ accept: 'audio/*', multiple: true });
                if (files.length) await lib.addFiles(files, name, scope);
                return;
              }
              case 'play': {
                if (!k || !k.files.length) return;
                if (preview) preview.pause();
                preview = await playRecord(k.files[Math.floor(Math.random() * k.files.length)], volKey === 'bgmVolume' ? bgmVol() : undefined);
                return;
              }
              case 'more': {
                if (!k) return;
                const v = await TT.choose(`${title.replace('庫', '')}・${k.name}`, [
                  ...(!k.preset ? [{ label: '重新命名', value: 'rename', icon: 'edit' }, { label: '比對關鍵字', value: 'words', icon: 'search', hint: k.words || '未設定' }] : []),
                  ...k.files.map((r, i) => ({ label: `刪除：${r.file || `音檔 ${i + 1}`}`, value: 'del:' + r.id, icon: 'trash', danger: true })),
                ]);
                if (!v) return;
                if (v === 'rename') {
                  const to = await TT.promptText('重新命名', k.name);
                  if (to && to.trim() && to.trim() !== k.name) await lib.update(k.name, (r) => { r.name = to.trim(); }, scope);
                } else if (v === 'words') {
                  const w = await TT.promptText('比對關鍵字', k.words || '', { hint: '名稱或內容含有這些字時用這個，用 | 分隔，例如：馬蹄|噠噠噠' });
                  if (w != null) await lib.update(k.name, (r) => { r.words = w.trim(); }, scope);
                } else if (v.startsWith('del:')) await lib.remove(v.slice(4));
                return;
              }
            }
          });
        },
      });
      off();
      return res;
    };
  }

  TT.sfx = {
    PRESETS: SFX_PRESETS, ...sfxLib, play: playSfx, playRecord, stopAll: stopSfx,
    manager: manager(sfxLib, {
      title: '音效庫', onKey: 'sfx', volKey: 'sfxVolume', playable: true,
      offText: ['播放音效', '關閉後 [SFX] 只顯示擬聲詞'],
      intro: '劇情裡出現 [SFX] 時，依音效名稱或擬聲詞內容挑一個音檔播放；畫面只會在字幕上方淡淡顯示擬聲詞。音效庫所有故事共用，AI 只會用到有音檔的種類。',
    }),
  };
  const bgmOpen = manager(bgmLib, {
    title: '配樂庫', onKey: 'bgm', volKey: 'bgmVolume', playable: false, scoped: true,
    offText: ['播放配樂', '關閉後不播放背景音樂（所有書一起）'],
    intro: '每本書有自己的配樂庫，這裡的音樂只會在這本書播放（本程式不生成音樂，自己匯入）。劇情的氣氛或場景改變時，AI 用 [BGM:名稱] 換配樂，循環播放、換曲時淡入淡出；[BGM:off] 停止。AI 只會用到有音檔的種類。',
  });
  // 配樂庫是某一本書的：沒指定書時先選一本
  async function bgmManager(opts = {}) {
    let card = opts.card || null;
    if (!card) {
      const all = await bgmLib.load();
      const count = (id) => all.filter((r) => r.cardId === id).length;
      const list = TT.store.cards.slice().sort((x, y) => count(y.id) - count(x.id)).slice(0, 80);
      if (!list.length) { TT.toast('還沒有任何書'); return null; }
      const id = await TT.choose('要管理哪一本書的配樂？', list.map((c) => ({ label: c.name, value: c.id, icon: 'book', hint: count(c.id) ? `${count(c.id)} 首` : '' })), { back: opts.back });
      if (!id || id === '__back') return id;
      card = TT.store.getCard(id);
    }
    return bgmOpen({ ...opts, card });
  }
  TT.bgm = { PRESETS: BGM_PRESETS, ...bgmLib, setTrack, stop: stopBgm, setVolume: setBgmVolume, current: () => P.name, manager: bgmManager };
})();
