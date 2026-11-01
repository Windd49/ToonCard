/* chub.ai（Character Hub）角色卡：搜尋、預覽、一鍵匯入 */
(function () {
  'use strict';
  const TT = window.TT;
  const API = 'https://api.chub.ai';
  const AVATARS = 'https://avatars.charhub.io/avatars';

  // 排序和 chub.ai 網站的「Sort」選單一一對應：[API 的 sort 值, 中文名稱, 網站上的名稱]
  const SORTS = [
    ['trending', '熱門趨勢', 'Trending'],
    ['default', '預設推薦', 'User Default'],
    ['download_count', '下載最多', '# Downloads'],
    ['star_count', '人氣最高', 'Popularity'],
    ['n_favorites', '最多收藏', '# Favorited'],
    ['rating', '評分最高', 'Rating'],
    ['ai_rating', 'AI 評分', 'AI Rating'],
    ['last_activity_at', '最近更新', 'Update Time'],
    ['created_at', '最新上架', 'Creation Time'],
    ['random', '隨機探索', 'Random'],
  ];
  // 網站搜尋頁一律加上的篩選（至少 2 個標籤、50～100000 tokens、包含轉載）：加上才會和網站的結果與順序相同
  const SITE_FILTERS = { include_forks: 'true', chub: 'true', min_tags: '2', min_tokens: '50', max_tokens: '100000', asc: 'false', exclude_mine: 'true' };
  const LANGS = [['', '全部語言'], ['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];

  // 把 chub 的搜尋結果整理成介面需要的欄位
  function normalize(n) {
    const fullPath = n.fullPath || (n.definition && n.definition.full_path) || '';
    return {
      id: n.id,
      fullPath,
      name: n.name || fullPath.split('/').pop(),
      creator: fullPath.split('/')[0] || '',
      tagline: n.tagline || '',
      description: n.description || '',
      topics: (n.topics || []).filter((t) => !/^(TAVERN|ROOT|SFW|NSFW)$/i.test(t)),
      stars: n.starCount || 0,
      favorites: n.n_favorites || 0,
      chats: n.nChats || 0,
      tokens: n.nTokens || 0,
      rating: n.rating || 0,
      avatar: n.avatar_url || `${AVATARS}/${fullPath}/avatar.webp`,
      card: n.max_res_url || `${AVATARS}/${fullPath}/chara_card_v2.png`,
      nsfw: !!n.nsfw_image,
      lorebooks: (n.related_lorebooks || []).length,
      url: `https://chub.ai/characters/${fullPath}`,
      createdAt: n.createdAt,
      updatedAt: n.lastActivityAt,
    };
  }

  // 比對同名書用：去掉空白、標點與大小寫（「我的蜘蛛娘」＝「我的 蜘蛛娘」、「（中文版）」＝「中文版」）
  const normName = (s) => String(s || '').toLowerCase().replace(/[\s\-_·・.,，。、!！?？:：;；()（）[\]【】{}「」『』<>《》"'“”‘’~～|/\\]+/g, '');
  const verCache = new Map();

  async function getJSON(url) {
    const res = await TT.net.fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`chub.ai 回應錯誤（HTTP ${res.status}）`);
    return res.json();
  }

  // 從網址或文字中取出 creator/slug
  function parsePath(text) {
    const s = String(text || '').trim();
    let m = s.match(/(?:chub\.ai|charhub\.io)\/(?:characters\/|avatars\/)?([\w.-]+\/[\w.-]+)/i);
    if (m) return m[1].replace(/\/(chara_card_v2\.png|avatar\.webp)$/i, '');
    m = s.match(/^(?:characters\/)?([\w.-]+\/[\w.-]+)$/);
    return m ? m[1] : '';
  }

  const chub = {
    SORTS,
    LANGS,
    normalize,
    normName,
    parsePath,
    pageUrl: (fullPath) => `https://chub.ai/characters/${fullPath}`,

    async search({ q = '', page = 1, first = 24, sort, lang, topics = '', nsfw } = {}) {
      const st = TT.settings.chub;
      const adult = nsfw == null ? !!st.nsfw : !!nsfw;
      const params = new URLSearchParams({
        search: q,
        first: String(first),
        page: String(page),
        sort: sort || st.sort || 'trending',
        nsfw: String(adult),
        nsfl: 'false',
        namespace: 'characters',
        ...SITE_FILTERS,
      });
      const language = lang != null ? lang : st.lang;
      if (language) params.set('language', language);
      if (topics) params.set('topics', topics);
      if (!adult) params.set('excludetopics', 'NSFW');
      const j = await getJSON(`${API}/search?${params}`);
      const data = j.data || j;
      return { count: data.count || 0, nodes: (data.nodes || []).map(normalize) };
    },

    // 完整定義（含所有序章），用於匯入前預覽
    async detail(fullPath) {
      const j = await getJSON(`${API}/api/characters/${fullPath}?full=true`);
      const node = j.node || j;
      const def = node.definition || {};
      return {
        ...normalize(node),
        greetings: [def.first_message, ...(def.alternate_greetings || [])].filter((g) => g && String(g).trim()),
        scenario: def.scenario || '',
        personality: def.personality || '',
      };
    },

    // 同一本書的其他版本：同一個作者用同樣書名上傳的其他卡（作者更新時常另外上傳一張），
    // 以及別人轉載、內容一樣（token 數相同）的卡。回傳 { self, list }，list 新的在前，作者最新的一本標 newest
    async versions(fullPath) {
      if (verCache.has(fullPath)) return verCache.get(fullPath);
      // 用 chub.ai 上的書名（角色卡檔案裡的名字可能不一樣）
      const j = await getJSON(`${API}/api/characters/${fullPath}`);
      const self = normalize(j.node || j);
      const user = fullPath.split('/')[0];
      const want = normName(self.name);
      const st = TT.settings.chub;
      const find = async (extra) => {
        const p = new URLSearchParams({ search: self.name, first: '48', page: '1', sort: 'created_at', nsfw: String(!!st.nsfw), nsfl: 'false', namespace: 'characters', ...extra });
        if (st.nsfw === false) p.set('excludetopics', 'NSFW');
        const r = await getJSON(`${API}/search?${p}`);
        return ((r.data || r).nodes || []).map(normalize).filter((n) => n.fullPath && n.fullPath !== fullPath && normName(n.name) === want);
      };
      const [mine, all] = await Promise.all([find({ username: user }), find({})]);
      const time = (n) => new Date(n.createdAt || 0).getTime();
      const list = [...new Map([...all, ...mine].map((n) => [n.fullPath, n])).values()]
        .map((n) => ({ ...n, author: n.creator.toLowerCase() === user.toLowerCase() }))
        .filter((n) => n.author || (self.tokens && n.tokens === self.tokens))
        .sort((a, b) => time(b) - time(a));
      const newest = [...list.filter((n) => n.author), self].sort((a, b) => time(b) - time(a))[0];
      list.forEach((n) => { n.newest = n.fullPath === newest.fullPath; });
      const out = { self, list, newer: list.filter((n) => n.author && time(n) > time(self)) };
      verCache.set(fullPath, out);
      return out;
    },

    // 匯入成另一本的副本（chub.copy）不算
    findLocal(fullPath) {
      return TT.store.cards.find((c) => c.chub && c.chub.fullPath === fullPath && !c.chub.copy) || null;
    },

    // chub.ai 的 PNG 角色卡有時放的是作者另外連結的世界書（例如作者自用的那本），不是這張卡自己的：以網站上的「內嵌世界書」為準
    async ownBook(fullPath, name) {
      const j = await getJSON(`${API}/api/characters/${fullPath}?full=true`);
      const def = (j.node || j).definition || {};
      const eb = def.embedded_lorebook;
      const book = eb && eb.entries ? TT.card.normalizeBook(eb, `${name || ''} 的世界書`) : null;
      return book && book.entries.length ? book : null;
    },

    // 已經匯入的卡：世界書沒自己改過時，換成這張卡自己的世界書（每張卡只檢查一次）；回傳 { from, to, count } 或 null
    async refreshBook(card) {
      if (!card || !card.chub || card.chubBookChecked) return null;
      let book = null;
      try { book = await chub.ownBook(card.chub.fullPath, card.name); } catch (e) { return null; }
      card.chubBookChecked = Date.now();
      const old = card.book;
      const same = old && book && old.name === book.name && old.entries.length === book.entries.length;
      let changed = null;
      if (book && !same && !card.bookDirty) {
        changed = { from: old ? old.name : '', to: book.name, count: book.entries.length };
        card.book = book;
        card.bookDirty = true;
      }
      await TT.store.saveCard(card);
      return changed;
    },

    // 下載角色卡 PNG；已存在時直接回傳（update=true 會覆蓋為最新版）
    // shelve=false：只是從探索點開來看，先不加入書架（之後在作品頁決定）
    async importCard(item, { update = false, shelve = true } = {}) {
      const fullPath = item.fullPath || item;
      const existing = chub.findLocal(fullPath);
      if (existing && !update) {
        if (shelve && existing.shelved === false) { existing.shelved = true; await TT.store.saveCard(existing); }
        return existing;
      }
      const url = item.card || `${AVATARS}/${fullPath}/chara_card_v2.png`;
      const res = await TT.net.fetch(url);
      if (!res.ok) throw new Error(`下載角色卡失敗（HTTP ${res.status}）`);
      const blob = await res.blob();
      const file = new File([blob], fullPath.split('/').pop() + '.png', { type: 'image/png' });
      const parsed = await TT.card.parseFile(file);
      if (parsed.kind !== 'card') throw new Error('下載的檔案不是角色卡');
      const card = parsed.card;
      // PNG 裡的世界書有時是作者另外連結的那本：改用這張卡自己的世界書
      try { const own = await chub.ownBook(fullPath, card.name); if (own) { card.book = own; card.bookDirty = true; } } catch (e) { /* 留著 PNG 裡的 */ }
      card.chubBookChecked = Date.now();
      const topics = item.topics || [];
      if (!card.tags.length && topics.length) card.tags = topics.slice(0, 12);
      const meta = {
        id: item.id || null,
        fullPath,
        url: chub.pageUrl(fullPath),
        tagline: item.tagline || '',
        stars: item.stars || 0,
        importedAt: Date.now(),
      };
      let rec;
      if (existing) {
        // 更新：保留書架上的個人設定與存檔關聯
        rec = { ...existing, ...card, id: existing.id, appearance: existing.appearance, style: existing.style, extraBooks: existing.extraBooks, favorite: existing.favorite, lastPlayed: existing.lastPlayed, createdAt: existing.createdAt, generatedCover: false, chub: meta };
      } else {
        rec = await TT.card.toRecord(card, { source: 'chub', chub: meta });
        rec.shelved = !!shelve;
      }
      await TT.store.saveCard(rec);
      TT.achv.unlock('first_import');
      if (TT.store.cards.length >= 10) TT.achv.unlock('collector');
      return rec;
    },
  };

  TT.chub = chub;
})();
