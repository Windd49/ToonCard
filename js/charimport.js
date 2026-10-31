/* 從其他角色卡匯入角色：把別本書（或角色卡檔案、分享的書本檔、chub.ai 網址）裡的角色，連同立繪、設定與世界書裡關於他的條目，
 * 加進這本書的角色池；也可以把角色卡裡的角色匯入成主角（名字、設定、外貌、頭像與立繪） */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;

  const spriteCount = (card, name) => Object.values((card.expr || {})[name] || {}).filter(Boolean).length || ((card.sprites || {})[name] ? 1 : 0);
  // 一本書裡可以匯入的角色：角色池（含角色卡本身的角色）與有立繪的角色
  function charsOf(card) {
    const main = card.nickname || card.name;
    return [...new Set([...TT.cast.pool(card), ...TT.sprites.spriteNames(card)])]
      .map((name) => ({ name, entry: TT.cast.find(card, name) || {}, sprites: spriteCount(card, name), main: name === main }));
  }

  // 選來源：書架上的書、角色卡檔案（PNG／JSON，也可以是分享的書本檔）、chub.ai 網址。回傳角色卡記錄（檔案讀進來的不會存進書架）
  async function pickSource({ exclude = null, title }) {
    const cards = TT.store.cards.filter((c) => !exclude || c.id !== exclude.id);
    const v = await TT.choose(title, [
      { label: '從角色卡檔案（PNG／JSON／書本檔）', value: '__file', icon: 'upload' },
      { label: '從 chub.ai 網址', value: '__chub', icon: 'link' },
      ...cards.map((c) => {
        const n = TT.sprites.spriteNames(c).reduce((s, x) => s + spriteCount(c, x), 0);
        return { label: c.name, value: c.id, icon: 'book', hint: `${charsOf(c).length} 個角色${n ? `・立繪 ${n} 張` : ''}` };
      }),
    ], { wrap: true });
    if (!v) return null;
    if (v === '__file') {
      const [f] = await TT.pickFiles({ accept: '.png,.json,image/png,application/json' });
      if (!f) return null;
      const shared = await TT.share.readFile(f);
      if (shared && shared.card) return TT.decodeBlobs(shared.card);
      const r = await TT.card.parseFile(f);
      if (r.kind !== 'card') throw new Error('這個檔案不是角色卡（世界書請用「附加世界書」）');
      return TT.card.toRecord(r.card);
    }
    if (v === '__chub') {
      const text = await TT.promptText('從 chub.ai 網址', '', { placeholder: 'https://chub.ai/characters/作者/角色', okText: '下載' });
      const path = text && TT.chub.parsePath(text);
      if (!path) { if (text) TT.toast('看不懂這個網址，請貼上 chub.ai 的角色頁面網址', { type: 'error' }); return null; }
      TT.toast('正在從 chub.ai 下載…', { icon: 'download' });
      return TT.chub.importCard({ fullPath: path }, { shelve: false });
    }
    return TT.store.getCard(v);
  }

  async function pickChar(card, title) {
    const list = charsOf(card);
    if (!list.length) { TT.toast('這本書裡沒有可以匯入的角色', { type: 'error' }); return null; }
    if (list.length === 1) return list[0];
    const v = await TT.choose(title || `「${card.name}」裡的角色`, list.map((x) => ({
      label: x.name, value: x.name, icon: 'user',
      hint: [x.entry.role, x.sprites ? `立繪 ${x.sprites} 張` : '沒有立繪'].filter(Boolean).join('・'),
    })), { wrap: true });
    return v ? list.find((x) => x.name === v) : null;
  }

  const sub = (text, name) => String(text || '').replace(/\{\{char\}\}|<BOT>/gi, name).trim();
  // 來源卡裡的 {{char}} 指的是那張卡自己的角色（多人卡通常是卡名），搬過來前先換成名字，免得變成這本書的角色
  const srcChar = (src) => src.nickname || src.name;
  // 角色卡本身的角色：描述與性格（給 AI 的角色設定）；角色池裡的其他角色靠名單上的關係、資訊與世界書條目
  function profileOf(src, ch) {
    if (!ch.main) return '';
    return TT.truncate(TT.stripHtml([sub(src.description, ch.name), sub(src.personality, ch.name)].filter(Boolean).join('\n\n')), 3000);
  }
  // 世界書裡關於這個角色的條目：關鍵字含他的名字或別名、或條目名稱提到他
  function loreOf(src, ch) {
    const names = [ch.name, ...(ch.entry.aliases || [])].filter((n) => n && n.length >= 2);
    return [src.book, ...(src.extraBooks || [])].filter(Boolean).flatMap((b) => b.entries || [])
      .filter((e) => e.content && names.some((n) => (e.keys || []).some((k) => String(k).includes(n)) || String(e.comment || '').includes(n)));
  }

  // 匯入到這本書的角色池；回傳在這本書裡的名字（取消時 null）
  async function intoBook(card) {
    let src;
    try { src = await pickSource({ exclude: card, title: '從哪本書（或角色卡）匯入角色？' }); } catch (e) { TT.toast(e.message || String(e), { type: 'error' }); return null; }
    if (!src) return null;
    const ch = await pickChar(src, `要匯入「${src.name}」裡的哪個角色？`);
    if (!ch) return null;
    const profile = profileOf(src, ch);
    const lore = loreOf(src, ch);
    const useAvatar = ch.main && !ch.sprites && src.avatar;
    let opts = null;
    const res = await TT.sheet({
      title: `匯入「${ch.name}」`,
      className: 'share-sheet',
      body: html`<div class="share">
        <label class="field"><span>在這本書裡的名字</span><input class="input" data-ci="name" value="${ch.name}"></label>
        <p class="hint" data-ci="same"></p>
        ${ch.sprites ? html`<label class="switch-row"><span><b>立繪</b><small>${ch.sprites} 張（含自訂的種類）；這本書已經有的種類不會被蓋掉</small></span><input type="checkbox" class="switch" data-ci="sprites" checked></label>` : ''}
        ${useAvatar ? html`<label class="switch-row"><span><b>用角色卡圖片當「平常」立繪</b><small>這個角色還沒有立繪；之後可以再依它生成其他表情</small></span><input type="checkbox" class="switch" data-ci="avatar"></label>` : ''}
        ${profile ? html`<label class="switch-row"><span><b>角色設定</b><small>角色卡的描述與性格（${profile.length} 字），會提供給 AI；匯入後可以在角色池修改</small></span><input type="checkbox" class="switch" data-ci="profile" checked></label>` : ''}
        ${lore.length ? html`<label class="switch-row"><span><b>世界書裡關於${ch.name}的設定</b><small>${lore.length} 條：${lore.slice(0, 4).map((e) => e.comment || (e.keys || [])[0] || '設定').join('、')}${lore.length > 4 ? '…' : ''}（成為這本書的附加世界書）</small></span><input type="checkbox" class="switch" data-ci="lore" checked></label>` : ''}
        <p class="hint">會加進這本書的角色池（只有角色池裡的角色有資訊欄）；關係、資訊、別名與外貌標籤一起帶過來。</p>
      </div>`,
      actions: [{ label: '取消', value: null }, {
        label: '匯入', primary: true, onClick: (el) => {
          const on = (k) => { const x = el.querySelector(`[data-ci="${k}"]`); return !!x && x.checked; };
          const name = el.querySelector('[data-ci="name"]').value.trim();
          if (!name) { TT.toast('請填寫名字', { type: 'error' }); return false; }
          opts = { name, sprites: on('sprites'), avatar: on('avatar'), profile: on('profile'), lore: on('lore') };
        },
      }],
      onMount: (el) => {
        const note = el.querySelector('[data-ci="same"]');
        const check = () => {
          const n = el.querySelector('[data-ci="name"]').value.trim();
          const had = n && (TT.cast.find(card, n) || TT.sprites.hasSprites(card, n));
          note.textContent = had ? `這本書已經有「${n}」：只會補上沒有的立繪與資料，不會蓋掉。` : '';
        };
        el.querySelector('[data-ci="name"]').addEventListener('input', check);
        check();
      },
    });
    if (!res || !opts) return null;
    const name = opts.name;
    const had = TT.cast.find(card, name) || {};
    const e = ch.entry;
    const patch = {
      aliases: [...new Set([...(had.aliases || []), ...(e.aliases || []), ...(name !== ch.name ? [ch.name] : [])])].filter((a) => a && a !== name),
      role: had.role || e.role || '',
      info: had.info || e.info || '',
      appearance: had.appearance || e.appearance || (ch.main ? src.appearance || '' : ''),
      from: had.from || src.name,
    };
    if (opts.profile && profile && !had.profile) patch.profile = profile;
    TT.cast.upsert(card, name, patch);
    if (opts.sprites) TT.sprites.fillSprites(src, ch.name, card, name);
    else if (opts.avatar && !TT.sprites.hasSprites(card, name)) TT.sprites.setSprite(card, name, '平常', await TT.sprites.prepare(src.avatar, true));
    if (opts.lore && lore.length) {
      card.extraBooks = [...(card.extraBooks || []), { name: `${name}（來自《${src.name}》）`, entries: lore.map((x) => ({ ...TT.clone(x), id: TT.uid(), content: sub(x.content, srcChar(src)), enabled: x.enabled !== false })) }];
    }
    await TT.store.saveCard(card);
    TT.bus.emit('cast:changed', { cardId: card.id });
    TT.toast(`已把「${name}」加進角色池`, { icon: 'check', type: 'ok' });
    return name;
  }

  /* ---------- 主角 ---------- */
  // 從角色卡挑一個角色，整理成主角的資料：{ name, description, appearance, avatar, from: { owner, name } }
  async function personaData() {
    let src;
    try { src = await pickSource({ title: '從哪本書（或角色卡）匯入主角？' }); } catch (e) { TT.toast(e.message || String(e), { type: 'error' }); return null; }
    if (!src) return null;
    const ch = await pickChar(src, `要用「${src.name}」裡的哪個角色當主角？`);
    if (!ch) return null;
    const e = ch.entry;
    const lore = loreOf(src, ch).filter((x) => !x.constant).map((x) => sub(x.content, srcChar(src)));
    const description = TT.truncate(TT.stripHtml([profileOf(src, ch), [e.role, e.info].filter(Boolean).join('｜'), ...lore].filter(Boolean).join('\n\n')), 3000);
    const pic = ch.main && src.avatar ? src.avatar : (((src.expr || {})[ch.name] || {})['平常'] || (src.sprites || {})[ch.name] || null);
    return {
      name: ch.name,
      description,
      appearance: e.appearance || (ch.main ? src.appearance || '' : ''),
      avatar: pic ? await TT.resizeImageBlob(pic, 768, 'image/png') : null,
      from: ch.sprites ? { owner: src, name: ch.name } : null,
    };
  }

  // 建立一個主角（已經有同名的主角時，補上那個主角空白的欄位與沒有的立繪）；回傳主角或 null
  async function newPersona() {
    const d = await personaData();
    if (!d) return null;
    const same = TT.store.personas.find((p) => p.name === d.name);
    const p = same || { id: TT.uid(), name: d.name, description: '', appearance: '', avatar: null };
    if (!p.description) p.description = d.description;
    if (!p.appearance) p.appearance = d.appearance;
    if (!p.avatar) p.avatar = d.avatar;
    if (d.from) TT.sprites.fillSprites(d.from.owner, d.from.name, p, p.name);
    await TT.store.savePersona(p);
    TT.toast(same ? `已補上主角「${p.name}」的設定與立繪` : `已建立主角「${p.name}」`, { icon: 'check', type: 'ok' });
    return p;
  }

  TT.charImport = { charsOf, intoBook, personaData, newPersona };
})();
