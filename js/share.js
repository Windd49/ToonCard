/* 分享書本與遊玩檔案：角色卡（含世界書）、立繪、特殊場景圖、背景、這本書的配樂，連同勾選的存檔與存檔用的主角，
 * 打包成一個 .json 檔。別人（或換電腦的自己）匯入時：書架上已經有同一本書，可以加進那一本
 * （存檔加進去，立繪與圖只補上沒有的，不會蓋掉），也可以匯入成另一本 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const TYPE = 'tavern-toon-book';
  const SPRITE_FIELDS = ['expr', 'exprCut', 'sprites', 'spriteCut', 'spriteRaw', 'poseKinds', 'spriteAlias'];
  const LISTS = ['cgs', 'bgs'];

  // 存檔用到的場景圖與角色頭像（存在 images 表）
  function imageIds(s) {
    const ids = new Set();
    for (const m of s.messages || []) for (const sw of m.swipes || []) for (const b of sw.beats || []) if (b.imageId) ids.add(b.imageId);
    for (const o of Object.values(s.castOverrides || {})) if (o && o.avatarImageId) ids.add(o.avatarImageId);
    return [...ids];
  }
  const countImages = (card) => TT.sprites.spriteNames(card).reduce((n, x) => n + (Object.values((card.expr || {})[x] || {}).filter(Boolean).length || 1), 0)
    + LISTS.reduce((n, l) => n + (card[l] || []).filter((g) => g.blob).length, 0);
  const turnsOf = (s) => (s.messages || []).filter((m) => m.role === 'user').length;

  async function pack(card, { sessionIds = [], assets = true, bgm = true, personas = true } = {}) {
    await TT.store.flushAll();
    const c = { ...card };
    delete c.lastPlayed;
    // 作者附圖的下載紀錄留著（對方再按匯入只會補缺的），復原用的舊圖不帶
    if (c.authorArt) c.authorArt = { urls: assets ? c.authorArt.urls || {} : {}, disabledByUs: c.authorArt.disabledByUs || [], last: null };
    if (!assets) {
      for (const f of SPRITE_FIELDS) delete c[f];
      for (const l of LISTS) c[l] = (c[l] || []).map((g) => ({ ...g, blob: null }));
    }
    const sessions = (await TT.store.sessionsForCard(card.id)).filter((s) => sessionIds.includes(s.id));
    const images = [];
    for (const s of sessions) for (const id of imageIds(s)) { const r = await TT.db.get('images', id); if (r) images.push(r); }
    const ps = personas ? [...new Set(sessions.map((s) => s.personaId))].map((id) => TT.store.getPersona(id)).filter(Boolean) : [];
    const sounds = bgm ? (await TT.bgm.load()).filter((r) => r.cardId === card.id).map(({ id, name, words, blob, file }) => ({ id, name, words, blob, file })) : [];
    return JSON.stringify(await TT.encodeBlobs({ type: TYPE, version: 1, exportedAt: new Date().toISOString(), card: c, sessions, images, personas: ps, sounds }));
  }

  // 匯出：sessionIds 有給時是「遊玩檔案」（預先勾好那個存檔），否則是整本書
  async function exportSheet(card, { sessionIds = null, back = false } = {}) {
    const all = await TT.store.sessionsForCard(card.id);
    const pre = new Set(sessionIds || []);
    const imgs = countImages(card);
    const music = (await TT.bgm.load()).filter((r) => r.cardId === card.id).length;
    let opts = null;
    const res = await TT.sheet({
      title: sessionIds ? '匯出遊玩檔案' : '匯出書本',
      back,
      className: 'share-sheet',
      body: html`<div class="share">
        <p class="hint">打包成一個檔案，可以傳給別人匯入，也可以換電腦時自己匯入。角色卡與世界書一定會包含。</p>
        ${imgs ? html`<label class="switch-row"><span><b>立繪、特殊場景圖、背景</b><small>${imgs} 張；不包含的話檔案小很多，對方只拿到角色卡與存檔</small></span><input type="checkbox" class="switch" data-sh="assets" checked></label>` : ''}
        ${music ? html`<label class="switch-row"><span><b>這本書的配樂</b><small>${music} 首</small></span><input type="checkbox" class="switch" data-sh="bgm" checked></label>` : ''}
        <h4 class="sec-title share-title">存檔 <small>${all.length ? '勾選要一起分享的存檔（劇情裡的場景圖會一起包含）' : '這本書還沒有存檔'}</small></h4>
        ${all.map((s) => html`<label class="share-row"><input type="checkbox" data-sh-save="${s.id}" ${pre.has(s.id) ? 'checked' : ''}><span><b>${s.title}</b><small>${turnsOf(s)} 回合・${TT.fmtTime(s.updatedAt)}</small></span></label>`)}
        ${all.length ? html`<label class="switch-row"><span><b>存檔用的主角</b><small>名字、設定、外貌與主角立繪；對方沒有這個主角時會一起匯入</small></span><input type="checkbox" class="switch" data-sh="personas" checked></label>` : ''}
      </div>`,
      actions: [{ label: '取消', value: null }, {
        label: '匯出', primary: true, onClick: (el) => {
          const on = (k) => { const x = el.querySelector(`[data-sh="${k}"]`); return x ? x.checked : true; };
          opts = { assets: on('assets'), bgm: on('bgm'), personas: on('personas'), sessionIds: [...el.querySelectorAll('[data-sh-save]:checked')].map((x) => x.dataset.shSave) };
        },
      }],
    });
    if (res === '__back') return res;
    if (!res || !opts) return null;
    TT.toast('正在打包…');
    const text = await pack(card, opts);
    const one = opts.sessionIds.length === 1 && all.find((s) => s.id === opts.sessionIds[0]);
    TT.download(TT.safeFileName(one ? `${card.name}-${one.title}-遊玩檔案` : `${card.name}-書本`) + '.json', text, 'application/json');
    TT.toast(`已匯出（${(text.length / 1048576).toFixed(1)} MB）`, { icon: 'check', type: 'ok' });
    return true;
  }

  /* ---------- 匯入 ---------- */
  const isShare = (d) => !!d && (d.type === TYPE || d.type === 'tavern-toon-session');

  // 讀 .json 檔：是分享的書本／遊玩檔案就回傳內容（Blob 還沒轉回來），不是就回傳 null；備份檔與素材包說明要去哪裡匯入
  async function readFile(f) {
    if (!/\.json$/i.test(f.name || '') && !/json/.test(f.type || '')) return null;
    let d;
    try { d = JSON.parse(await f.text()); } catch (e) { return null; }
    if (d && d.type === 'tavern-toon-backup') throw new Error('這是完整備份檔，請到「設定 → 資料 → 匯入備份」匯入');
    if (d && d.type === 'tavern-toon-assets') throw new Error('這是素材包，請到作品設定的「保存」分頁或素材庫匯入');
    return isShare(d) ? d : null;
  }

  // 書架上是不是已經有同一本書：同一個 id（自己匯出又匯入）、同一張 chub.ai 卡，或名字、作者、描述都一樣
  function findSame(card) {
    return TT.store.getCard(card.id)
      || (card.chub && card.chub.fullPath && TT.chub.findLocal(card.chub.fullPath))
      || TT.store.cards.find((c) => c.name === card.name && (c.creator || '') === (card.creator || '') && (c.description || '') === (card.description || ''))
      || null;
  }

  // 加進已經有的書：立繪、特殊場景圖、背景、角色池只補上沒有的
  function mergeAssets(to, from) {
    let n = 0;
    for (const name of TT.sprites.spriteNames(from)) n += TT.sprites.fillSprites(from, name, to, name);
    for (const [a, who] of Object.entries(from.spriteAlias || {})) if (!(to.spriteAlias || {})[a]) to.spriteAlias = { ...(to.spriteAlias || {}), [a]: who };
    for (const c of from.castList || []) if (!TT.cast.find(to, c.name)) TT.cast.upsert(to, c.name, c);
    for (const l of LISTS) {
      for (const g of from[l] || []) {
        const same = (to[l] || []).find((x) => x.name === g.name);
        if (!same) { to[l] = [...(to[l] || []), { ...g, id: TT.uid() }]; if (g.blob) n++; } else if (!same.blob && g.blob) { same.blob = g.blob; n++; }
      }
    }
    return n;
  }

  // 存檔換新的 id 放進這本書；場景圖也換新的 id（同一個檔匯入兩次也不會互相蓋掉）
  async function addSessions(target, sessions, images, personaMap) {
    const titles = new Set((await TT.store.sessionsForCard(target.id)).map((s) => s.title));
    const byId = new Map((images || []).map((r) => [r.id, r]));
    const added = [];
    for (const s0 of sessions) {
      const s = TT.clone(s0);
      s.id = TT.uid();
      s.cardId = target.id;
      s.personaId = personaMap[s0.personaId] || TT.store.defaultPersona().id;
      if (titles.has(s.title)) s.title += '（匯入）';
      const ids = new Map();
      const newId = async (old) => {
        if (ids.has(old)) return ids.get(old);
        const r = byId.get(old);
        const id = r ? TT.uid() : null;
        if (r) await TT.db.put('images', { ...r, id, sessionId: s.id });
        ids.set(old, id);
        return id;
      };
      for (const m of s.messages || []) {
        for (const sw of m.swipes || []) {
          for (const b of sw.beats || []) {
            if (!b.imageId) continue;
            const id = await newId(b.imageId);
            if (id) b.imageId = id;
            else { delete b.imageId; b.status = TT.img.scenesEnabled() ? 'idle' : 'none'; }
          }
        }
      }
      for (const o of Object.values(s.castOverrides || {})) {
        if (!o || !o.avatarImageId) continue;
        const id = await newId(o.avatarImageId);
        if (id) o.avatarImageId = id; else delete o.avatarImageId;
      }
      await TT.store.saveSession(s, true);
      added.push(s);
    }
    if (added.length) TT.bus.emit('sessions:changed');
    return added;
  }

  // 舊版「完整存檔備份」只有存檔、沒有角色卡：放進書架上同名的書
  async function importOldSession(d) {
    if (!d.session) throw new Error('檔案裡沒有存檔');
    const list = TT.store.cards.filter((c) => c.name === d.cardName);
    if (!list.length) throw new Error(`這是舊版匯出的存檔，沒有附角色卡。請先匯入「${d.cardName}」這張角色卡，再匯入這個存檔`);
    const id = list.length === 1 ? list[0].id : await TT.choose(`要把存檔「${d.session.title}」放進哪一本？`, list.map((c) => ({ label: c.name, value: c.id, icon: 'book', hint: c.creator || '' })));
    const target = id && TT.store.getCard(id);
    if (!target) return null;
    const [s] = await addSessions(target, [d.session], [], {});
    TT.toast(`已把存檔「${s.title}」放進「${target.name}」`, { icon: 'check', type: 'ok' });
    return target;
  }

  // 匯入：先說明檔案裡有什麼、要加進哪裡，確定後才寫入。回傳匯入到的書或 null
  async function importData(raw) {
    const d = TT.decodeBlobs(raw);
    if (d.type === 'tavern-toon-session') return importOldSession(d);
    const card = d.card;
    if (!card || !card.name) throw new Error('檔案裡沒有角色卡');
    const sessions = d.sessions || [];
    const same = findSame(card);
    const imgs = countImages(card);
    // 對方的主角：這裡已經有（同一個或同名）就用這裡的，沒有的可以一起匯入
    const newPersonas = (d.personas || []).filter((p) => !TT.store.getPersona(p.id) && !TT.store.personas.some((x) => x.name === p.name));
    let mode = same ? 'merge' : 'new';
    let takePersonas = true;
    const res = await TT.sheet({
      title: sessions.length ? '匯入遊玩檔案' : '匯入書本',
      className: 'share-sheet',
      body: html`<div class="share">
        <p class="sheet-msg"><b>${card.name}</b>${card.creator ? `（${card.creator}）` : ''}</p>
        <ul class="share-list">
          <li>角色卡與世界書</li>
          ${imgs ? html`<li>立繪、特殊場景圖、背景 ${imgs} 張</li>` : ''}
          ${(d.sounds || []).length ? html`<li>配樂 ${d.sounds.length} 首</li>` : ''}
          ${sessions.length ? html`<li>存檔 ${sessions.length} 個：${sessions.map((s) => `${s.title}（${turnsOf(s)} 回合）`).join('、')}</li>` : ''}
        </ul>
        ${same ? html`<label class="share-row"><input type="radio" name="sh-mode" value="merge" checked><span><b>加進書架上的「${same.name}」</b><small>存檔加進這本書；立繪、場景圖、配樂只補上你沒有的，不會蓋掉你的</small></span></label>
          <label class="share-row"><input type="radio" name="sh-mode" value="new"><span><b>匯入成另一本書</b><small>和你原本的那本分開</small></span></label>` : ''}
        ${newPersonas.length ? html`<label class="switch-row"><span><b>一併匯入主角「${newPersonas.map((p) => p.name).join('、')}」</b><small>關掉的話，這些存檔改用你的預設主角</small></span><input type="checkbox" class="switch" data-sh="personas" checked></label>` : ''}
      </div>`,
      actions: [{ label: '取消', value: null }, {
        label: '匯入', primary: true, onClick: (el) => {
          const m = el.querySelector('[name="sh-mode"]:checked');
          if (m) mode = m.value;
          const p = el.querySelector('[data-sh="personas"]');
          takePersonas = p ? p.checked : true;
        },
      }],
    });
    if (!res) return null;
    // 1) 書
    let target;
    if (mode === 'merge' && same) {
      target = same;
      mergeAssets(target, card);
      await TT.store.saveCard(target);
    } else {
      target = { ...card, id: TT.uid(), shelved: true, favorite: false, createdAt: Date.now(), lastPlayed: Date.now() };
      // 已經有同一本時：副本換個名字，也不算那張 chub.ai 卡（「從 chub.ai 下載最新版」等只對原本那本）
      if (same) { target.name = `${card.name}（匯入）`; if (target.chub) target.chub = { ...target.chub, copy: true }; }
      await TT.store.saveCard(target);
    }
    // 2) 主角
    const personaMap = {};
    for (const p of d.personas || []) {
      const local = TT.store.getPersona(p.id) || TT.store.personas.find((x) => x.name === p.name);
      if (local) personaMap[p.id] = local.id;
      else if (takePersonas) { const np = { ...p, id: TT.uid(), createdAt: Date.now() }; await TT.store.savePersona(np); personaMap[p.id] = np.id; }
    }
    // 3) 存檔與場景圖
    const added = await addSessions(target, sessions, d.images, personaMap);
    // 4) 配樂（同一首不會重複加）
    const music = (d.sounds || []).filter((r) => r.blob instanceof Blob);
    if (music.length) await TT.bgm.copyTo(music, target.id);
    TT.toast(`已匯入「${target.name}」${added.length ? `：${added.length} 個存檔` : ''}`, { icon: 'check', type: 'ok', duration: 4000 });
    return target;
  }

  TT.share = { pack, exportSheet, readFile, importData, isShare };
})();
