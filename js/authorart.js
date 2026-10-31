/* 作者附的圖：有些角色卡在序章或世界書裡放了作者畫好的立繪與插圖（圖片網址），再用世界書叫 AI 輸出 <img> 標籤。
 * 本程式不顯示那種標籤，所以把圖下載成這個作品的立繪、特殊場景圖或背景：
 * - 掃描序章與世界書裡的 <img>、![](網址)、「名稱＋網址」清單，列成一張清單，每張都可以勾選、改名、改分類
 * - 下載放在「生成工作」裡，可以暫停／繼續／停止；每完成一張就存，記下來源網址，中斷後再按只補缺的，失敗的可以重試
 * - 下載後確認圖片打得開、沒有只下載到一半；壞掉的標成失敗，不存
 * - 可以復原上一次匯入（刪掉這次加的圖、換回被覆蓋的圖、重新打開停用的世界書條目）
 * 名稱看起來露骨的圖照樣列出，只在分類旁邊用紅色三角形提醒，要不要匯入由使用者決定 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const IMG_URL = /https?:\/\/[^\s"'<>)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)]*)?/gi;
  const EXPLICIT = /足交|口交|乳交|手交|腿交|肛交|性交|性爱|性愛|做爱|做愛|后入|後入|前入|侧入|側入|骑乘|騎乘|体位|體位|正常位|传教士|傳教士|精液|射精|颜射|顏射|吞精|内射|內射|中出|自慰|潮吹|高潮|插入|侵犯|强奸|強姦|调教|調教|裸体|裸體|全裸|肉棒|阴茎|陰莖|小穴|乳头|乳頭|淫|舔|侍奉|nsfw|r-?18|hentai|nude|naked|porn|\bsex\b|\bcum\b/i;
  const SPRITE_ENTRY = /立绘|立繪|sprite|portrait/i;
  // 叫 AI 輸出圖片標籤、或自己定義狀態欄的條目：本程式有自己的立繪、插圖與狀態欄，留著只會打架
  const IMG_RULE = /<img|插图输出|插圖輸出|生成器/i;
  const STATUS_RULE = /状态栏|狀態欄/;
  const TYPES = [['sprite', '立繪'], ['cg', '插圖'], ['bg', '背景']];
  const LISTS = { cg: 'cgs', bg: 'bgs' };

  const clean = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/[*_`#>]/g, '').replace(/[:：]\s*$/, '').trim();
  // 條目名稱「<立绘>（校服）」→ 造型「校服」；沒有括號的是預設的「平常」
  const kindOf = (entryName) => { const m = String(entryName || '').match(/[（(]([^）)]{1,12})[）)]/); return m ? m[1].trim() : '平常'; };
  // 劇情裡的別名、稱謂對到角色池裡的名字（不猜錯字：「艾莉尔」和「芬莉尔」只差一個字，卻是兩個人）
  const matchName = (card, name) => TT.cast.canon(card, name);
  const urlId = (url) => { let h = 0; for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) | 0; return 'a' + (h >>> 0).toString(36); };
  const bookEntries = (card) => [card.book, ...(card.extraBooks || [])].filter(Boolean).flatMap((b) => b.entries || []);

  // 一段文字裡的圖：<img src>、![](網址)、或單獨一行網址；名稱取同一行網址前面的字，沒有就取上一行（再不然下一行）
  function imagesIn(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    const hasUrl = (s) => { IMG_URL.lastIndex = 0; const r = IMG_URL.test(s); IMG_URL.lastIndex = 0; return r; };
    lines.forEach((line, i) => {
      const urls = line.match(IMG_URL);
      if (!urls) return;
      for (const url of urls) {
        const before = clean(line.slice(0, line.indexOf(url)).replace(/<img[\s\S]*$/i, '').replace(/!\[([^\]]*)\]\($/, '$1'));
        let label = before && before.length <= 24 ? before : '';
        for (let k = i - 1; !label && k >= 0 && k >= i - 2; k--) { const c = clean(lines[k]); if (c && !hasUrl(lines[k]) && c.length <= 24) label = c; }
        for (let k = i + 1; !label && k < lines.length && k <= i + 2; k++) { const c = clean(lines[k]).replace(/^[（(]|[）)]$/g, ''); if (c && !/style=|<img/i.test(lines[k]) && c.length <= 24) label = c; }
        out.push({ url, label });
      }
    });
    return out;
  }

  // 匯入紀錄：card.authorArt = { urls: { 網址: { status: 'done'|'failed', type, name, kind, id, error } }, last: 上一次匯入（復原用），
  //   disabledByUs: 本程式停用的世界書條目（和作者預設關閉的分開） }
  const art = (card) => {
    const a = card.authorArt && card.authorArt.urls ? card.authorArt : { urls: {}, last: null };
    card.authorArt = a;
    return a;
  };

  // 這張圖要放的地方現在有沒有圖
  function slotFilled(card, it) {
    if (it.type === 'sprite') return !!(((card.expr || {})[it.name] || {})[it.kind || '平常']);
    return (card[LISTS[it.type]] || []).some((g) => g.blob && (g.src === it.url || g.name === it.name));
  }
  // 之前匯入的那張還在不在
  function stillThere(card, r) {
    if (r.type === 'sprite') return !!(((card.expr || {})[r.name] || {})[r.kind || '平常']);
    return (card[LISTS[r.type]] || []).some((g) => g.id === r.id && g.blob);
  }

  // 整理這張卡附的圖：{ groups: [{ key, title, enabled, items }], rules: [{ e, name, why }] }
  // item：{ id, url, name, type, kind, state: new|exists|done|removed|failed, error, checked, warn }
  function scan(card) {
    if (!card) return null;
    const entries = bookEntries(card);
    const rec = (card.authorArt && card.authorArt.urls) || {};
    const groups = [];
    const seen = new Set();
    const add = (group, x, type, kind) => {
      if (seen.has(x.url)) return;
      seen.add(x.url);
      const name = type === 'sprite' ? matchName(card, x.label) : x.label || `${type === 'bg' ? '背景' : '插圖'} ${group.items.length + 1}`;
      const it = { id: urlId(x.url), url: x.url, name, type, kind: type === 'sprite' ? kind : '' };
      // 作者標的名稱或所在的條目看起來露骨：照樣列出、照樣預設勾選，只提醒（看的是作者原本的名稱，改名也不會消失）
      if (EXPLICIT.test(x.label)) it.warn = `作者標的名稱是「${x.label}」`;
      else if (EXPLICIT.test(group.title)) it.warn = `放在${group.title}裡`;
      const r = rec[x.url];
      if (r && r.status === 'done') { Object.assign(it, { name: r.name, type: r.type, kind: r.kind || it.kind }); it.state = stillThere(card, r) ? 'done' : 'removed'; }
      else if (r && r.status === 'failed') { it.state = 'failed'; it.error = r.error; }
      else it.state = slotFilled(card, it) ? 'exists' : 'new';
      it.checked = it.state === 'failed' || (it.state === 'new' && group.enabled);
      group.items.push(it);
    };
    const group = (key, title, enabled) => { const g = { key, title, enabled, items: [] }; groups.push(g); return g; };
    // 世界書裡的立繪清單（名稱是角色名）先處理，插圖清單裡同一張圖就不會又算成插圖
    entries.forEach((e) => {
      if (!SPRITE_ENTRY.test(e.comment || '')) return;
      const found = imagesIn(e.content).filter((x) => x.label && x.label.length <= 12);
      if (!found.length) return;
      // 被本程式停用的條目（不是作者預設關閉的）照樣算開著
      const ours = ((card.authorArt && card.authorArt.disabledByUs) || []).includes(e.id);
      const g = group(`lore:${e.id}`, `世界書「${e.comment}」`, e.enabled !== false || ours);
      found.forEach((x) => add(g, x, 'sprite', kindOf(e.comment)));
    });
    // 序章裡的圖，與其他世界書條目裡的圖：插圖
    const greet = group('greeting', '序章', true);
    for (const t of [card.first_mes, ...(card.alternate_greetings || [])]) for (const x of imagesIn(t)) add(greet, x, 'cg');
    entries.forEach((e) => {
      if (SPRITE_ENTRY.test(e.comment || '')) return;
      const found = imagesIn(e.content);
      if (!found.length) return;
      const g = group(`lore:${e.id}`, `世界書「${e.comment || '未命名'}」`, true);
      found.forEach((x) => add(g, x, 'cg'));
    });
    // 和本程式衝突的條目
    const rules = [];
    entries.forEach((e, i) => {
      if (e.enabled === false) return;
      const c = String(e.content || '');
      const urls = (c.match(IMG_URL) || []).length;
      if (IMG_RULE.test(c) || IMG_RULE.test(e.comment || '') || (SPRITE_ENTRY.test(e.comment || '') && urls) || urls >= 3) rules.push({ e, name: e.comment || `第 ${i + 1} 條`, why: 'img' });
      else if (STATUS_RULE.test(c) || STATUS_RULE.test(e.comment || '')) rules.push({ e, name: e.comment || `第 ${i + 1} 條`, why: 'status' });
    });
    const used = groups.filter((g) => g.items.length);
    if (!used.length) return null;
    return { groups: used, rules };
  }

  const items = (found) => found.groups.flatMap((g) => g.items);

  // 一行摘要（作品頁、遊玩前設定用）
  function summary(card) {
    const f = scan(card);
    if (!f) return '';
    const all = items(f);
    const done = all.filter((x) => x.state === 'done').length;
    const failed = all.filter((x) => x.state === 'failed').length;
    if (jobOf(card)) return `下載中（${done} / ${all.length}）`;
    if (done) return `已匯入 ${done} / ${all.length} 張${failed ? `，${failed} 張上次沒下載到` : ''}`;
    const n = (t) => all.filter((x) => x.type === t).length;
    const sets = new Set(all.filter((x) => x.type === 'sprite').map((x) => x.kind)).size;
    return [n('sprite') ? `立繪 ${n('sprite')} 張${sets > 1 ? `（${sets} 套）` : ''}` : '', n('cg') ? `插圖 ${n('cg')} 張` : '', n('bg') ? `背景 ${n('bg')} 張` : ''].filter(Boolean).join('、');
  }
  const imported = (card) => { const f = scan(card); return !!f && items(f).some((x) => x.state === 'done'); };

  /* ---------- 下載 ---------- */
  async function download(url, signal) {
    const res = await TT.net.fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 壓縮傳送時 content-length 是壓縮後的長度，不能拿來和下載到的大小比
    const len = res.headers.get('content-encoding') ? 0 : +res.headers.get('content-length') || 0;
    const blob = await res.blob();
    if (len && blob.size < len) throw new Error('只下載到一部分');
    return blob;
  }
  // 檔案完整嗎：瀏覽器會照樣顯示只有一半的 PNG／JPEG，所以照檔案結構一段一段走到結尾標記。
  // 結尾標記後面多出來的資料（例如圖床或修圖程式加的浮水印紀錄）不算壞掉
  async function complete(blob) {
    const b = new Uint8Array(await blob.arrayBuffer());
    const n = b.length;
    const u16 = (i) => (b[i] << 8) | b[i + 1];
    const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    // PNG：照每一塊的長度跳到 IEND
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      for (let i = 8; i + 8 <= n; i += 12 + u32(i)) if (b[i + 4] === 0x49 && b[i + 5] === 0x45 && b[i + 6] === 0x4e && b[i + 7] === 0x44) return true;
      return false;
    }
    // JPEG：照長度跳過檔頭各段（EXIF 裡的縮圖也有結尾標記）到影像資料，影像資料裡出現 FFD9 就是結尾
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 4 <= n;) {
        // 段與段之間多了雜訊（解碼器會略過）：往後找下一個 FF
        if (b[i] !== 0xff || b[i + 1] === 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xd9) return true;
        if (m === 0xda) {
          for (let k = i + 2 + u16(i + 2); k + 1 < n; k++) if (b[k] === 0xff && b[k + 1] === 0xd9) return true;
          return false;
        }
        i += m === 0x01 || (m >= 0xd0 && m <= 0xd7) ? 2 : 2 + u16(i + 2);
      }
      return false;
    }
    // GIF：跳過色盤與各區塊，走到結尾的 3B
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      let i = 13 + (b[10] & 0x80 ? 3 << ((b[10] & 7) + 1) : 0);
      const blocks = () => { while (i < n && b[i]) i += b[i] + 1; i++; };
      while (i < n) {
        if (b[i] === 0x3b) return true;
        if (b[i] === 0x21) { i += 2; blocks(); } else if (b[i] === 0x2c) {
          const flags = b[i + 9];
          i += 11 + (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
          blocks();
        } else return false;
      }
      return false;
    }
    // WebP：檔頭寫的長度都要在
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return new DataView(b.buffer).getUint32(4, true) + 8 <= n;
    return true;
  }
  // 確認圖片打得開（壞掉的、不是圖片的、只有一半的都算失敗）
  async function verify(blob) {
    if (!blob || blob.size < 64) throw new Error('檔案是空的');
    if (!(await complete(blob))) throw new Error('只下載到一部分，圖片不完整');
    const url = URL.createObjectURL(blob);
    try {
      const img = await TT.loadImage(url);
      if (img.decode) await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('bad');
    } catch (e) {
      throw new Error('圖片打不開或不完整');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 放進作品：立繪（角色＋造型）、插圖或背景。被覆蓋的舊圖留在紀錄裡，復原時換回來
  async function place(card, it, last, blob) {
    if (it.type === 'sprite') {
      const name = it.name.trim();
      const kind = (it.kind || '平常').trim() || '平常';
      // 角色池裡還沒有這個角色就加進去（作者的立繪清單就是主要角色）
      if (!TT.cast.find(card, name)) { TT.cast.upsert(card, name, {}); last.cast.push(name); }
      if (!TT.sprites.kinds(card, name).some((k) => k.key === kind)) { TT.sprites.setKind(card, name, { key: kind, desc: `${kind}造型（作者的立繪）` }); last.kinds.push([name, kind]); }
      const prepared = await TT.sprites.prepare(blob, true);
      for (const k of kind === '平常' || ((card.expr || {})[name] || {})['平常'] ? [kind] : [kind, '平常']) {
        const slot = `${name}|${k}`;
        const old = ((card.expr || {})[name] || {})[k];
        if (old && !last.prev[slot]) last.prev[slot] = { blob: old, cut: !!(((card.exprCut || {})[name] || {})[k]), raw: k === '平常' ? (card.spriteRaw || {})[name] : null };
        TT.sprites.setSprite(card, name, k, prepared);
        last.added.push({ type: 'sprite', name, kind: k });
      }
      return { type: 'sprite', name, kind };
    }
    const list = LISTS[it.type];
    const small = await TT.resizeImageBlob(blob, 2048, blob.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
    const g = (card[list] || []).find((x) => x.src === it.url) || (it.state === 'exists' ? (card[list] || []).find((x) => x.name === it.name) : null);
    if (g) {
      if (!last.prev[g.id]) last.prev[g.id] = { blob: g.blob, list };
      g.blob = small;
      g.src = it.url;
      TT.media.invalidate(it.type, `${card.id}|${g.id}`);
      return { type: it.type, name: g.name, id: g.id };
    }
    const n = { id: TT.uid(), name: it.name.trim(), desc: `作者的${it.type === 'bg' ? '背景' : '插圖'}：${it.name.trim()}`, blob: small, prompt: '', src: it.url, createdAt: Date.now() };
    card[list] = [...(card[list] || []), n];
    last.added.push({ type: it.type, id: n.id });
    return { type: it.type, name: n.name, id: n.id };
  }

  const jobKey = (card) => `art|${card.id}`;
  const jobOf = (card) => TT.img.findJob(jobKey(card));

  // 開始下載勾選的圖（放在生成工作裡）；rules：要停用的衝突條目
  function start(card, picks, rules) {
    if (jobOf(card)) return jobOf(card);
    const a = art(card);
    // 只能復原最後一次：開始新的一次就把上一次的紀錄換掉
    const last = { at: Date.now(), added: [], prev: {}, cast: [], kinds: [], disabled: [], urls: [] };
    a.last = last;
    for (const r of rules) if (r.e.enabled !== false) { r.e.enabled = false; last.disabled.push(r.e.id); }
    if (last.disabled.length) {
      card.bookDirty = true;
      a.disabledByUs = [...new Set([...(a.disabledByUs || []), ...last.disabled])];
    }
    const failed = [];
    let ok = 0;
    const job = TT.img.startJob({
      key: jobKey(card),
      label: `下載作者的圖：${card.name}`,
      cardId: card.id,
      total: picks.length,
      body: async (j) => {
        await TT.store.saveCard(card);
        for (const it of picks) {
          await TT.img.gate(j);
          j.cur = it.type === 'sprite' ? `${it.name}・${it.kind || '平常'}` : it.name;
          j.inflight = 1;
          TT.bus.emit('tasks:changed');
          try {
            const blob = await download(it.url, j.ctl.controller.signal);
            await verify(blob);
            const where = await place(card, it, last, blob);
            a.urls[it.url] = { status: 'done', ...where, at: Date.now() };
            last.urls.push(it.url);
            ok++;
          } catch (e) {
            if (e.name === 'AbortError' || j.ctl.cancelled) throw e;
            a.urls[it.url] = { status: 'failed', type: it.type, name: it.name, kind: it.kind, error: e.message || String(e) };
            failed.push(`${it.name}（${e.message}）`);
          } finally {
            j.inflight = 0;
          }
          j.done++;
          // 每完成一張就存：中途關掉網頁，已經下載的也不會白費
          await TT.store.saveCard(card);
          TT.bus.emit('art:progress', { cardId: card.id });
        }
      },
    });
    job.promise.then(async (o) => {
      await TT.store.saveCard(card);
      TT.bus.emit('art:progress', { cardId: card.id, finished: true });
      TT.bus.emit('cast:changed', { cardId: card.id });
      if (o.cancelled) { TT.toast(`已停止下載：完成 ${ok} 張，剩下的之後再按「匯入」就會補上`); return; }
      const label = `下載作者的圖：${card.name}`;
      if (failed.length) TT.img.report({ kind: 'job', label, ok: false, error: `完成 ${ok} 張，${failed.length} 張沒下載到：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`, failText: `「${card.name}」有 ${failed.length} 張圖沒下載到（點「生成工作」可以重試）`, retry: () => sheet(card), retryLabel: '重試沒下載到的' });
      else TT.img.report({ kind: 'job', label, ok: true, okText: `下載完成 ${ok} 張` });
      if (!failed.length) TT.toast(`已匯入作者的圖 ${ok} 張`, { icon: 'check', type: 'ok' });
    });
    return job;
  }

  // 復原上一次匯入：刪掉加進來的圖、換回被覆蓋的圖、拿掉這次加進角色池且沒有其他資料的角色、重新打開停用的條目
  async function undo(card) {
    const a = art(card);
    const last = a.last;
    if (!last || jobOf(card)) return false;
    for (const x of last.added) {
      if (x.type !== 'sprite') { card[LISTS[x.type]] = (card[LISTS[x.type]] || []).filter((g) => g.id !== x.id); TT.media.invalidate(x.type, `${card.id}|${x.id}`); continue; }
      const p = last.prev[`${x.name}|${x.kind}`];
      if (p) TT.sprites.setSprite(card, x.name, x.kind, { blob: p.blob, cut: p.cut, raw: p.raw || p.blob });
      else TT.sprites.removeSprite(card, x.name, x.kind);
    }
    for (const [id, p] of Object.entries(last.prev)) {
      if (!p.list) continue;
      const g = (card[p.list] || []).find((x) => x.id === id);
      if (g) { g.blob = p.blob; delete g.src; TT.media.invalidate(p.list === 'cgs' ? 'cg' : 'bg', `${card.id}|${id}`); }
    }
    for (const [name, kind] of last.kinds) if (!(((card.expr || {})[name] || {})[kind])) TT.sprites.removeKind(card, name, kind);
    for (const name of last.cast) {
      const e = TT.cast.find(card, name);
      if (e && !e.role && !e.info && !e.appearance && !TT.sprites.hasSprites(card, name)) TT.cast.remove(card, name);
    }
    const entries = bookEntries(card);
    for (const id of last.disabled) { const e = entries.find((x) => x.id === id); if (e) e.enabled = true; }
    if (last.disabled.length) {
      card.bookDirty = true;
      a.disabledByUs = (a.disabledByUs || []).filter((id) => !last.disabled.includes(id));
    }
    for (const url of last.urls) delete a.urls[url];
    a.last = null;
    await TT.store.saveCard(card);
    TT.bus.emit('cast:changed', { cardId: card.id });
    return true;
  }

  /* ---------- 面板 ---------- */
  const STATE = { new: '', exists: '這一格已經有圖，勾選會換成這張', done: '已匯入', removed: '之前匯入過，後來刪掉了', failed: '上次沒下載到' };

  async function sheet(card, { back = false } = {}) {
    // 舊版匯入的 chub.ai 卡可能拿到作者另外連結的世界書，先換成這張卡自己的（立繪、插圖清單在那裡面）
    if (card.chub && !card.chubBookChecked) await TT.chub.refreshBook(card);
    let found = scan(card);
    if (!found) { TT.toast('這張卡沒有附圖片'); return null; }
    const byId = () => new Map(items(found).map((x) => [x.id, x]));
    // 面板上的進度：進度條、目前這張、暫停／繼續；下載中「開始下載」不能再按
    const sync = (el) => {
      const j = jobOf(card);
      const box = el.querySelector('[data-art-job]');
      const btn = el.querySelector('.sheet-actions .btn.primary');
      if (btn) { btn.disabled = !!j; if (j) btn.textContent = '下載中…'; }
      // 下載中不能復原（下載完會重畫，再出現）
      const undoBox = el.querySelector('.art-undo');
      if (undoBox) undoBox.hidden = !!j;
      if (!box) return;
      box.hidden = !j;
      if (!j) return;
      box.querySelector('.prep-bar i').style.width = Math.round((j.done / Math.max(1, j.total)) * 100) + '%';
      box.querySelector('[data-art-jobtext]').textContent = j.ctl.cancelled ? '停止中…'
        : j.ctl.paused ? (j.inflight ? '這張下載完就暫停…' : `已暫停（完成 ${j.done} / ${j.total}）`)
          : `下載中 ${Math.min(j.done + 1, j.total)} / ${j.total}${j.cur ? `：${j.cur}` : ''}`;
      box.querySelector('[data-art-ctl="pause"]').innerHTML = TT.icon(j.ctl.paused ? 'play' : 'pause', 14) + (j.ctl.paused ? ' 繼續' : ' 暫停');
    };
    const itemHTML = (it) => html`<div class="art-item ${it.state}" data-art-id="${it.id}">
        <input type="checkbox" class="art-pick" data-art-pick ${it.checked ? 'checked' : ''}>
        <img class="art-thumb ${it.type === 'sprite' ? 'portrait' : ''}" src="${it.url}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="art-fields">
          <input class="input small" data-art-name value="${it.name}" placeholder="${it.type === 'sprite' ? '角色名' : '名稱'}">
          <div class="art-row2">
            <select class="input small" data-art-type>${TYPES.map(([k, l]) => html`<option value="${k}" ${it.type === k ? 'selected' : ''}>${l}</option>`)}</select>
            ${it.warn ? html`<button type="button" class="art-warn" data-art-warn title="可能是露骨的圖：${it.warn}" aria-label="可能是露骨的圖：${it.warn}">${icon('alertFill', 20)}</button>` : ''}
            <input class="input small" data-art-kind value="${it.kind || ''}" placeholder="造型（平常）" ${it.type === 'sprite' ? '' : 'hidden'}>
          </div>
          ${STATE[it.state] || it.error ? html`<small class="art-state">${STATE[it.state]}${it.error ? `：${it.error}` : ''}</small>` : ''}
        </div>
      </div>`;
    const groupHTML = (g, gi) => {
      const on = g.items.filter((x) => x.checked).length;
      // 收起來的組也看得到裡面有幾張要注意的
      const warned = g.items.filter((x) => x.warn).length;
      return html`<details class="art-group" ${g.enabled || on ? 'open' : ''}>
        <summary><input type="checkbox" class="art-pick" data-art-group="${gi}" ${on && on === g.items.length ? 'checked' : ''}><b>${g.title}</b><small>${warned ? html`<span class="art-warn-n" title="${warned} 張可能是露骨的圖">${icon('alertFill', 14)}${warned}</span>` : ''}${g.items.length} 張${g.enabled ? '' : '・作者預設關閉'}</small></summary>
        <div class="art-items">${g.items.map(itemHTML)}</div>
      </details>`;
    };
    const imgRules = () => found.rules.filter((r) => r.why === 'img');
    const statusRules = () => found.rules.filter((r) => r.why === 'status');
    const bodyHTML = () => html`
      <p class="hint">這張卡的序章或世界書裡放了作者畫好的圖。勾選要的、改好名字與分類（立繪要填角色名，造型留空就是「平常」），再按「開始下載」。下載在「生成工作」裡進行，關掉這個視窗也會繼續，可以暫停或停止；每下載完一張就存起來。</p>
      <div class="art-job" data-art-job hidden>
        <div class="prep-bar"><i style="width:0%"></i></div>
        <p class="hint" data-art-jobtext></p>
        <div class="btn-row"><button class="btn small" data-art-ctl="pause">${icon('pause', 14)} 暫停</button><button class="btn small danger" data-art-ctl="stop">${icon('stop', 14)} 停止</button></div>
      </div>
      <div class="art-bulk"><button class="btn small" data-art-all="1">全選</button><button class="btn small" data-art-all="0">全不選</button><span class="muted" data-art-count></span></div>
      ${found.groups.map(groupHTML)}
      ${found.rules.length ? html`<h4 class="sec-title">和本程式衝突的世界書條目 <small>開始下載時停用；復原或在「編輯角色卡 → 世界書」可以重新打開</small></h4>
        ${imgRules().length ? html`<label class="switch-row"><span><b>停用圖片清單與插圖輸出規則</b><small>${imgRules().map((r) => r.name).join('、')}（圖片改由本程式顯示，也省下每回合的字數）</small></span><input type="checkbox" class="switch" data-art-rule="img" checked></label>` : ''}
        ${statusRules().length ? html`<label class="switch-row"><span><b>停用作者自製的狀態欄</b><small>${statusRules().map((r) => r.name).join('、')}（本程式有自己的狀態欄）</small></span><input type="checkbox" class="switch" data-art-rule="status" checked></label>` : ''}` : ''}
      ${art(card).last && art(card).last.added.length ? html`<div class="spm-reuse art-undo">${icon('refresh', 14)}<span>上一次匯入了 ${art(card).last.urls.length} 張${art(card).last.disabled.length ? `、停用 ${art(card).last.disabled.length} 條世界書` : ''}</span><button class="btn small" data-art-undo>復原上一次匯入</button></div>` : ''}`;

    let off = () => {};
    const res = await TT.sheet({
      title: '作者附的立繪與插圖',
      back,
      wide: true,
      className: 'art-sheet',
      body: html`<div class="art">${bodyHTML()}</div>`,
      actions: [{ label: '關閉', value: '' }, {
        label: '開始下載', primary: true, onClick: (el) => {
          if (jobOf(card)) return false;
          const picks = items(found).filter((x) => x.checked && x.name.trim());
          if (!picks.length) { TT.toast('還沒有勾選任何一張'); return false; }
          const rules = found.rules.filter((r) => (el.querySelector(`[data-art-rule="${r.why}"]`) || {}).checked);
          start(card, picks, rules);
          sync(el);
          return false;
        },
      }],
      onMount: (el) => {
        const box = el.querySelector('.art');
        const count = () => {
          const all = items(found);
          const c = el.querySelector('[data-art-count]');
          if (c) c.textContent = `已勾選 ${all.filter((x) => x.checked).length} / ${all.length} 張`;
          el.querySelectorAll('[data-art-group]').forEach((g) => {
            const list = found.groups[+g.dataset.artGroup].items;
            const on = list.filter((x) => x.checked).length;
            g.checked = on === list.length;
            g.indeterminate = on > 0 && on < list.length;
          });
          const btn = el.querySelector('.sheet-actions .btn.primary');
          if (btn && !jobOf(card)) { btn.disabled = false; btn.textContent = `開始下載（${all.filter((x) => x.checked).length} 張）`; }
        };
        const rerender = () => { found = scan(card) || found; box.innerHTML = String(bodyHTML()); count(); sync(el); };
        count();
        sync(el);
        box.addEventListener('change', (e) => {
          const map = byId();
          const row = e.target.closest('[data-art-id]');
          const it = row && map.get(row.dataset.artId);
          if (e.target.matches('[data-art-group]')) {
            found.groups[+e.target.dataset.artGroup].items.forEach((x) => (x.checked = e.target.checked));
            e.target.closest('.art-group').querySelectorAll('[data-art-pick]').forEach((c) => (c.checked = e.target.checked));
          } else if (it && e.target.matches('[data-art-pick]')) it.checked = e.target.checked;
          else if (it && e.target.matches('[data-art-type]')) {
            it.type = e.target.value;
            row.querySelector('[data-art-kind]').hidden = it.type !== 'sprite';
            row.querySelector('.art-thumb').classList.toggle('portrait', it.type === 'sprite');
            if (it.type === 'sprite' && !it.kind) it.kind = '平常';
          }
          count();
        });
        box.addEventListener('input', (e) => {
          const row = e.target.closest('[data-art-id]');
          const it = row && byId().get(row.dataset.artId);
          if (!it) return;
          if (e.target.matches('[data-art-name]')) it.name = e.target.value;
          if (e.target.matches('[data-art-kind]')) it.kind = e.target.value.trim() || '平常';
        });
        box.addEventListener('click', async (e) => {
          const all = e.target.closest('[data-art-all]');
          if (all) { items(found).forEach((x) => (x.checked = all.dataset.artAll === '1')); box.querySelectorAll('[data-art-pick]').forEach((c) => { if (!c.dataset.artGroup) c.checked = all.dataset.artAll === '1'; }); count(); return; }
          // 手機沒有滑鼠提示：點紅色三角形說明為什麼提醒
          const warn = e.target.closest('[data-art-warn]');
          if (warn) { TT.toast(`${warn.title}。要不要匯入由你決定`, { icon: 'alert', type: 'error', duration: 4000 }); return; }
          const ctl = e.target.closest('[data-art-ctl]');
          if (ctl) {
            const j = jobOf(card);
            if (!j) return;
            if (ctl.dataset.artCtl === 'stop') TT.img.cancelJob(j);
            else if (j.ctl.paused) TT.img.resumeJob(j);
            else TT.img.pauseJob(j);
            sync(el);
            return;
          }
          if (e.target.closest('[data-art-undo]')) {
            if (!(await TT.confirm('復原上一次匯入？這次加進來的圖會刪掉、被換掉的圖會換回來，停用的世界書條目會重新打開。', { okText: '復原' }))) return;
            if (await undo(card)) { TT.toast('已復原上一次匯入'); rerender(); }
          }
        });
        const onProgress = (d) => { if (d.cardId !== card.id) return; if (d.finished) rerender(); else sync(el); };
        const offP = TT.bus.on('art:progress', onProgress);
        const offT = TT.bus.on('tasks:changed', () => sync(el));
        off = () => { offP(); offT(); };
      },
    });
    off();
    return res;
  }

  TT.authorArt = { scan, summary, imported, start, undo, sheet, imagesIn };
})();
