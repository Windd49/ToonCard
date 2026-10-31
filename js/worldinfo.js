/* 世界書（Lorebook）觸發：關鍵字、次要關鍵字邏輯、常駐、機率、遞迴、預算 */
(function () {
  'use strict';
  const TT = window.TT;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function makeMatcher(text, mctx) {
    const lower = text.toLowerCase();
    return (rawKey, entry) => {
      const key = TT.macros.apply(rawKey, mctx).trim();
      if (!key) return false;
      const rx = key.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
      if (rx) {
        try { return new RegExp(rx[1], rx[2].replace('g', '')).test(text); } catch (e) { return false; }
      }
      const ascii = /^[\w\s'-]+$/.test(key);
      if (entry.wholeWords && ascii) return new RegExp(`\\b${escRe(key)}\\b`, entry.caseSensitive ? '' : 'i').test(text);
      return entry.caseSensitive ? text.includes(key) : lower.includes(key.toLowerCase());
    };
  }

  function entryHits(entry, match) {
    if (!entry.keys.some((k) => match(k, entry))) return false;
    if (entry.selective && entry.secondary.length) {
      const hits = entry.secondary.map((k) => match(k, entry));
      const any = hits.some(Boolean);
      const all = hits.every(Boolean);
      switch (entry.logic) {
        case 1: return !all; // NOT ALL
        case 2: return !any; // NOT ANY
        case 3: return all; // AND ALL
        default: return any; // AND ANY
      }
    }
    return true;
  }

  // books: [book]；texts: 最近訊息（舊→新）；回傳各插入位置的內容
  function activate({ books, texts, mctx, scanDepth = 2, budgetTokens = 2000 }) {
    const result = { before: [], after: [], depth: [], count: 0 };
    const all = [];
    let recursive = false;
    for (const b of books || []) {
      if (!b || !Array.isArray(b.entries)) continue;
      if (b.recursive) recursive = true;
      const depth = b.scanDepth != null ? b.scanDepth : scanDepth;
      b.entries.forEach((e) => { if (e.enabled && e.content && e.content.trim()) all.push({ e, depth }); });
    }
    if (!all.length) return result;

    const scanFor = (depth) => texts.slice(-Math.max(1, depth)).join('\n');
    const activated = new Set();
    const order = [];
    let recursionBuf = '';

    for (let pass = 0; pass < (recursive ? 4 : 1); pass++) {
      let added = 0;
      for (const item of all) {
        const { e } = item;
        if (activated.has(e)) continue;
        let hit = false;
        if (e.constant) hit = pass === 0;
        else if (e.keys.length) {
          if (pass > 0 && e.excludeRecursion) continue;
          const text = scanFor(item.depth) + (pass > 0 ? '\n' + recursionBuf : '');
          hit = entryHits(e, makeMatcher(text, mctx));
        }
        if (!hit) continue;
        if (e.probability < 100 && Math.random() * 100 >= e.probability) continue;
        activated.add(e);
        order.push(e);
        added++;
      }
      if (!added) break;
      recursionBuf = order.filter((e) => !e.preventRecursion).map((e) => e.content).join('\n');
    }

    // 預算：常駐優先，其次 order 高者優先
    const ranked = order.slice().sort((a, b) => (b.constant - a.constant) || (b.order - a.order));
    let used = 0;
    const kept = new Set();
    for (const e of ranked) {
      const content = TT.macros.apply(e.content, mctx);
      const t = TT.estimateTokens(content);
      if (used + t > budgetTokens && kept.size) continue;
      used += t;
      kept.add(e);
      e._rendered = content;
    }
    const sorted = order.filter((e) => kept.has(e)).sort((a, b) => a.order - b.order);
    for (const e of sorted) {
      if (e.position === 'after') result.after.push(e._rendered);
      else if (e.position === 'depth') result.depth.push({ depth: e.depth, content: e._rendered });
      else result.before.push(e._rendered);
      delete e._rendered;
    }
    result.count = sorted.length;
    return result;
  }

  TT.wi = { activate };
})();
