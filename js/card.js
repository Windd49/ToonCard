/* SillyTavern 角色卡：解析（V1/V2/V3、PNG/JSON）、世界書正規化、匯出 */
(function () {
  'use strict';
  const TT = window.TT;
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  const num = (v, d) => (v === '' || v == null || isNaN(+v) ? d : +v);
  const toArr = (v) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
      .map((x) => str(x).trim())
      .filter(Boolean);

  // SillyTavern 數字位置 → 內部位置
  // 0 角色定義前、1 角色定義後、2/3 作者註記、4 @深度、5/6 範例對話前後、7 外部
  const POS_MAP = { 0: 'before', 1: 'after', 2: 'depth', 3: 'depth', 4: 'depth', 5: 'after', 6: 'after', 7: 'depth' };
  const POS_REV = { before: 0, after: 1, depth: 4 };

  function normalizeBook(b, fallbackName) {
    if (!b || typeof b !== 'object') return null;
    const raw = Array.isArray(b.entries) ? b.entries : b.entries && typeof b.entries === 'object' ? Object.values(b.entries) : [];
    const entries = raw
      .filter((e) => e && typeof e === 'object')
      .map((e, i) => {
        const ext = e.extensions && typeof e.extensions === 'object' ? e.extensions : {};
        const secondary = toArr(e.secondary_keys !== undefined ? e.secondary_keys : e.keysecondary);
        const numPos = typeof ext.position === 'number' ? ext.position : typeof e.position === 'number' ? e.position : null;
        let position = 'before';
        if (numPos != null) position = POS_MAP[numPos] || 'before';
        else if (e.position === 'after_char') position = 'after';
        const prob = num(ext.probability !== undefined ? ext.probability : e.probability, 100);
        const useProb = ext.useProbability !== undefined ? ext.useProbability : e.useProbability;
        return {
          id: e.id !== undefined ? e.id : e.uid !== undefined ? e.uid : i,
          comment: str(e.comment || e.name || ''),
          keys: toArr(e.keys !== undefined ? e.keys : e.key),
          secondary,
          content: str(e.content),
          enabled: e.enabled !== undefined ? !!e.enabled : !e.disable,
          constant: !!e.constant,
          selective: e.selective !== undefined ? !!e.selective : secondary.length > 0,
          logic: num(ext.selectiveLogic !== undefined ? ext.selectiveLogic : e.selectiveLogic, 0),
          order: num(e.insertion_order !== undefined ? e.insertion_order : e.order, 100),
          position,
          depth: num(ext.depth !== undefined ? ext.depth : e.depth, 4),
          caseSensitive: !!(e.case_sensitive || ext.case_sensitive || e.caseSensitive),
          wholeWords: !!(ext.match_whole_words || e.matchWholeWords),
          probability: useProb === false ? 100 : prob,
          excludeRecursion: !!(ext.exclude_recursion || e.excludeRecursion),
          preventRecursion: !!(ext.prevent_recursion || e.preventRecursion),
        };
      });
    return {
      name: str(b.name || fallbackName || '世界書'),
      scanDepth: num(b.scan_depth, null),
      tokenBudget: num(b.token_budget, null),
      recursive: !!b.recursive_scanning,
      entries,
    };
  }

  function denormalizeBook(book) {
    return {
      name: book.name,
      description: '',
      scan_depth: book.scanDepth == null ? undefined : book.scanDepth,
      token_budget: book.tokenBudget == null ? undefined : book.tokenBudget,
      recursive_scanning: !!book.recursive,
      extensions: {},
      entries: book.entries.map((e, i) => ({
        id: i,
        keys: e.keys,
        secondary_keys: e.secondary,
        comment: e.comment,
        content: e.content,
        constant: e.constant,
        selective: e.selective,
        insertion_order: e.order,
        enabled: e.enabled,
        position: e.position === 'before' ? 'before_char' : 'after_char',
        use_regex: true,
        extensions: {
          position: POS_REV[e.position] != null ? POS_REV[e.position] : 0,
          depth: e.depth,
          selectiveLogic: e.logic,
          probability: e.probability,
          useProbability: true,
          exclude_recursion: e.excludeRecursion,
          prevent_recursion: e.preventRecursion,
          match_whole_words: e.wholeWords,
          case_sensitive: e.caseSensitive,
        },
      })),
    };
  }

  function isWorldInfoJson(j) {
    if (!j || typeof j !== 'object' || j.spec || j.data || j.first_mes !== undefined) return false;
    return !!j.entries && (Array.isArray(j.entries) || typeof j.entries === 'object');
  }

  function normalizeCard(json) {
    if (!json || typeof json !== 'object') throw new Error('角色卡內容不是 JSON 物件');
    const isV2 = /^chara_card_v[23]$/.test(json.spec || '') || (json.data && typeof json.data === 'object' && json.data.name !== undefined);
    const d = isV2 ? json.data : json;
    const tags = Array.isArray(d.tags) ? d.tags : toArr(d.tags);
    const card = {
      name: str(d.name || json.name || json.char_name || '未命名角色').trim(),
      nickname: str(d.nickname).trim(),
      description: str(d.description || json.char_persona),
      personality: str(d.personality),
      scenario: str(d.scenario || json.world_scenario),
      first_mes: str(d.first_mes || json.char_greeting),
      mes_example: str(d.mes_example || json.example_dialogue),
      creator_notes: str(d.creator_notes || d.creatorcomment || json.creatorcomment),
      system_prompt: str(d.system_prompt),
      post_history_instructions: str(d.post_history_instructions),
      alternate_greetings: (Array.isArray(d.alternate_greetings) ? d.alternate_greetings : []).map(str).filter((s) => s.trim()),
      tags: tags.map(str).map((t) => t.trim()).filter(Boolean).slice(0, 30),
      creator: str(d.creator),
      character_version: str(d.character_version),
      extensions: d.extensions && typeof d.extensions === 'object' ? d.extensions : {},
      book: d.character_book ? normalizeBook(d.character_book, str(d.name) + ' 的世界書') : null,
      spec: json.spec || 'v1',
      raw: json,
    };
    if (card.book && !card.book.entries.length) card.book = null;
    return card;
  }

  function decodeCardText(t) {
    const s = String(t).trim();
    if (s.startsWith('{')) return s;
    return TT.b64ToUtf8(s);
  }

  // 解析檔案 → { kind: 'card', card } | { kind: 'worldinfo', book }
  async function parseFile(file) {
    const name = file.name || '';
    const lower = name.toLowerCase();
    const baseName = name.replace(/\.[^.]+$/, '');
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (TT.png.isPng(head)) {
      const buf = await file.arrayBuffer();
      const texts = await TT.png.readText(buf);
      const keys = Object.keys(texts);
      const order = [keys.find((k) => k.toLowerCase() === 'ccv3'), keys.find((k) => k.toLowerCase() === 'chara')].filter(Boolean);
      let json = null;
      let lastErr = null;
      for (const k of order) {
        try { json = JSON.parse(decodeCardText(texts[k])); break; } catch (e) { lastErr = e; }
      }
      if (!json) throw new Error(lastErr ? '角色卡資料損毀：' + lastErr.message : '這張 PNG 沒有內嵌 SillyTavern 角色卡資料');
      const card = normalizeCard(json);
      card.avatar = new Blob([buf], { type: 'image/png' });
      card.fileName = name;
      return { kind: 'card', card };
    }
    if (lower.endsWith('.json') || file.type === 'application/json' || head[0] === 0x7b || head[0] === 0xef) {
      const text = (await file.text()).replace(/^﻿/, '');
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('JSON 格式錯誤：' + e.message); }
      if (isWorldInfoJson(json)) {
        const book = normalizeBook(json, json.name || baseName);
        if (!book || !book.entries.length) throw new Error('世界書沒有任何條目');
        return { kind: 'worldinfo', book };
      }
      const card = normalizeCard(json);
      card.fileName = name;
      return { kind: 'card', card };
    }
    if (/\.(webp|jpe?g|gif|charx|zip)$/i.test(lower)) throw new Error('目前僅支援 PNG 或 JSON 格式的角色卡');
    throw new Error('無法辨識的檔案格式');
  }

  // 建立存入資料庫的角色卡紀錄
  async function toRecord(card, extra = {}) {
    const rec = {
      id: TT.uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastPlayed: 0,
      favorite: false,
      appearance: '',
      style: '',
      extraBooks: [],
      source: 'import',
      ...card,
      ...extra,
    };
    if (!rec.avatar) {
      rec.avatar = await makeCover(rec.name, rec.tags && rec.tags[0]);
      rec.generatedCover = true;
    }
    return rec;
  }

  /* ---------- 匯出 ---------- */
  function buildData(card) {
    const base = card.raw && typeof card.raw === 'object' ? TT.clone(card.raw) : {};
    const data = base.data && typeof base.data === 'object' ? base.data : {};
    Object.assign(data, {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.first_mes,
      mes_example: card.mes_example,
      creator_notes: card.creator_notes,
      system_prompt: card.system_prompt,
      post_history_instructions: card.post_history_instructions,
      alternate_greetings: card.alternate_greetings || [],
      tags: card.tags || [],
      creator: card.creator,
      character_version: card.character_version,
      extensions: card.extensions || {},
    });
    if (card.book) {
      if (card.bookDirty || !data.character_book) data.character_book = denormalizeBook(card.book);
    } else delete data.character_book;
    return data;
  }

  function toV2(card) {
    const data = buildData(card);
    return {
      name: data.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario,
      first_mes: data.first_mes,
      mes_example: data.mes_example,
      creatorcomment: data.creator_notes,
      avatar: 'none',
      talkativeness: '0.5',
      fav: !!card.favorite,
      tags: data.tags,
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data,
      create_date: new Date(card.createdAt || Date.now()).toISOString(),
    };
  }

  function toV3(card) {
    const data = buildData(card);
    data.group_only_greetings = Array.isArray(data.group_only_greetings) ? data.group_only_greetings : [];
    if (card.nickname) data.nickname = card.nickname;
    data.modification_date = Math.floor(Date.now() / 1000);
    return { spec: 'chara_card_v3', spec_version: '3.0', data };
  }

  async function exportPng(card) {
    let blob = card.avatar;
    if (!blob) blob = await makeCover(card.name);
    let u8 = new Uint8Array(await blob.arrayBuffer());
    if (!TT.png.isPng(u8)) {
      const png = await TT.resizeImageBlob(blob, 2048, 'image/png');
      u8 = new Uint8Array(await png.arrayBuffer());
    }
    const out = TT.png.writeText(u8, {
      chara: TT.utf8ToB64(JSON.stringify(toV2(card))),
      ccv3: TT.utf8ToB64(JSON.stringify(toV3(card))),
    });
    return new Blob([out], { type: 'image/png' });
  }

  function exportJson(card) {
    return new Blob([JSON.stringify(toV2(card), null, 2)], { type: 'application/json' });
  }

  function exportBook(book) {
    // SillyTavern 世界書格式
    const entries = {};
    book.entries.forEach((e, i) => {
      entries[i] = {
        uid: i, key: e.keys, keysecondary: e.secondary, comment: e.comment, content: e.content,
        constant: e.constant, selective: e.selective, selectiveLogic: e.logic, order: e.order,
        position: POS_REV[e.position] != null ? POS_REV[e.position] : 0, depth: e.depth, disable: !e.enabled,
        probability: e.probability, useProbability: true, excludeRecursion: e.excludeRecursion,
        preventRecursion: e.preventRecursion, caseSensitive: e.caseSensitive, matchWholeWords: e.wholeWords,
      };
    });
    return new Blob([JSON.stringify({ entries }, null, 2)], { type: 'application/json' });
  }

  /* ---------- 自動封面 ---------- */
  async function makeCover(name, subtitle = '') {
    const W = 512, H = 768;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const h = TT.hashStr(name) % 360;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `hsl(${h} 55% 26%)`);
    grad.addColorStop(0.55, `hsl(${(h + 40) % 360} 50% 14%)`);
    grad.addColorStop(1, `hsl(${(h + 80) % 360} 45% 8%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 光暈
    const glow = g.createRadialGradient(W * 0.7, H * 0.28, 10, W * 0.7, H * 0.28, 320);
    glow.addColorStop(0, `hsla(${(h + 20) % 360} 90% 70% / .55)`);
    glow.addColorStop(1, 'transparent');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    // 漫畫網點
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let y = 0; y < H; y += 14) for (let x = (y / 14) % 2 ? 7 : 0; x < W; x += 14) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
    // 大字
    const ch = Array.from(name.trim() || '?')[0];
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.font = '700 260px "Noto Serif TC","Microsoft JhengHei",serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = `hsla(${h} 90% 60% / .8)`;
    g.shadowBlur = 40;
    g.fillText(ch, W / 2, H * 0.42);
    g.shadowBlur = 0;
    // 名稱
    g.font = '700 46px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    g.fillStyle = '#fff';
    g.fillText(TT.truncate(name, 10), W / 2, H * 0.74);
    if (subtitle) {
      g.font = '400 24px "Noto Sans TC","Microsoft JhengHei",sans-serif';
      g.fillStyle = 'rgba(255,255,255,.7)';
      g.fillText('# ' + TT.truncate(subtitle, 12), W / 2, H * 0.81);
    }
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  }

  TT.card = { parseFile, normalizeCard, normalizeBook, denormalizeBook, toRecord, toV2, toV3, exportPng, exportJson, exportBook, makeCover, isWorldInfoJson };
})();
