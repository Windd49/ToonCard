/* 探索：瀏覽 chub.ai 角色卡（全螢幕滑動或格狀），點作品直接進入作品頁，要不要加入書架自己決定 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));
  const fmtN = (n) => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '萬' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0));

  // 模組層級狀態：切換分頁回來時保留列表與捲動位置
  // groups：同一本書的鍵 → items 裡的位置；seen：看過的所有卡（包含收進其他版本、沒有顯示的）
  const S = { key: '', epoch: 0, items: [], page: 0, count: 0, done: false, loading: false, error: '', scroll: 0, groups: new Map(), seen: new Set() };

  // 同名的書：同一個作者重複上傳（作者更新時常另外上傳一張）只顯示最新的一本；別人轉載、內容一樣（token 數相同）的也收在一起，
  // 不同作者、內容不同的同名卡（例如好幾個不同的「Yui」）照樣分開。其他版本在作品頁的「其他版本」
  const authorKey = (n) => `a|${n.creator.toLowerCase()}|${TT.chub.normName(n.name)}`;
  const copyKey = (n) => (n.tokens ? `c|${TT.chub.normName(n.name)}|${n.tokens}` : '');
  const newer = (a, b) => new Date(a.createdAt || 0) > new Date(b.createdAt || 0);
  // 回傳畫面上要重畫的位置（換成作者的新版本，或多收了其他版本、要更新「另有 N 個版本」）
  function addNodes(nodes) {
    const changed = new Set();
    for (const n of nodes) {
      if (!n.fullPath || S.seen.has(n.fullPath)) continue;
      S.seen.add(n.fullPath);
      let i = S.groups.get(authorKey(n));
      if (i == null && copyKey(n)) i = S.groups.get(copyKey(n));
      if (i == null) {
        n.others = [];
        S.groups.set(authorKey(n), S.items.length);
        if (copyKey(n)) S.groups.set(copyKey(n), S.items.length);
        S.items.push(n);
        continue;
      }
      const cur = S.items[i];
      if (cur.creator.toLowerCase() === n.creator.toLowerCase() && newer(n, cur)) {
        n.others = [cur, ...cur.others];
        cur.others = [];
        S.items[i] = n;
        if (copyKey(n)) S.groups.set(copyKey(n), i);
      } else cur.others.push(n);
      changed.add(i);
    }
    return [...changed];
  }

  const F = (TT.views.feed = {
    async mount(el) {
      F.el = el;
      const st = TT.settings.chub;
      // 排序和 chub.ai 網站一致；存的排序不在清單裡時改回熱門趨勢
      if (!TT.chub.SORTS.some(([k]) => k === st.sort)) { st.sort = 'trending'; TT.saveSettings(); }
      const key = [st.q || '', st.sort, st.lang, st.nsfw].join('|');
      el.innerHTML = String(html`<div class="view feed layout-${st.layout || 'scroll'}">
        <div class="feed-top">
          <div class="brand"><span class="brand-mark">${icon('film', 18)}</span><span>漫劇卡<small>chub.ai</small></span></div>
          <div class="feed-tools">
            <button class="icon-btn glass" data-act="search" title="搜尋或貼上 chub.ai 網址">${icon('search', 20)}</button>
            <button class="icon-btn glass" data-act="layout" title="切換瀏覽方式">${icon(st.layout === 'grid' ? 'film' : 'comic', 20)}</button>
            <button class="icon-btn glass" data-act="filter" title="篩選">${icon('settings', 20)}</button>
          </div>
        </div>
        <div class="feed-chips">
          <button class="chip glass ${st.lang ? 'active' : ''}" data-act="lang">${icon('globe', 14)} ${(TT.chub.LANGS.find((l) => l[0] === st.lang) || TT.chub.LANGS[0])[1]}</button>
          ${st.q ? html`<button class="chip glass active" data-act="clearq">${icon('search', 14)} ${TT.truncate(st.q, 12)} ${icon('x', 14)}</button>` : ''}
          ${TT.chub.SORTS.map(([k, label, site]) => html`<button class="chip glass ${st.sort === k ? 'active' : ''}" data-sort="${k}" title="chub.ai 的「${site}」">${label}</button>`)}
        </div>
        <div class="feed-scroll"><div class="feed-list"></div><div class="feed-foot"></div></div>
        ${TT.ui.tabbar('feed')}
      </div>`);
      F.list = el.querySelector('.feed-list');
      F.foot = el.querySelector('.feed-foot');
      F.scroller = el.querySelector('.feed-scroll');
      // reload/remount 會重用同一個容器；先移除舊監聽，避免每套用一次篩選就多觸發一次。
      el.removeEventListener('click', F.onClick);
      el.addEventListener('click', F.onClick);
      F.observe();
      if (S.key === key && S.items.length) {
        F.renderItems(0);
        F.renderFoot();
        requestAnimationFrame(() => (F.scroller.scrollTop = S.scroll));
      } else {
        Object.assign(S, { key, epoch: S.epoch + 1, items: [], page: 0, count: 0, done: false, loading: false, error: '', scroll: 0, groups: new Map(), seen: new Set() });
        F.renderFoot();
        F.loadMore();
      }
    },

    unmount() {
      if (F.scroller) S.scroll = F.scroller.scrollTop;
      if (F.io) F.io.disconnect();
      if (F.lazy) F.lazy.disconnect();
      F.el = null;
    },

    observe() {
      // 接近底部時載入下一頁；接近畫面時才載入高解析封面
      F.io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) F.loadMore(); }, { root: F.scroller, rootMargin: '0px 0px 1200px 0px' });
      F.io.observe(F.foot);
      F.lazy = new IntersectionObserver((ents) => {
        ents.forEach((e) => {
          if (!e.isIntersecting) return;
          const img = e.target;
          if (img.dataset.full) {
            const full = new Image();
            full.onload = () => { img.src = full.src; img.classList.add('hires'); };
            full.src = img.dataset.full;
            delete img.dataset.full;
          }
          if (e.target.closest('.feed-item')) TT.app.setBackdropUrl(img.dataset.thumb || img.src);
          F.lazy.unobserve(img);
        });
      }, { root: F.scroller, rootMargin: '100% 0px' });
    },

    async loadMore() {
      if (S.loading || S.done || !F.el) return;
      const epoch = S.epoch;
      S.loading = true;
      S.error = '';
      F.renderFoot();
      const st = TT.settings.chub;
      const query = { q: st.q || '', page: S.page + 1, sort: st.sort, lang: st.lang, nsfw: !!st.nsfw };
      try {
        const r = await TT.chub.search(query);
        if (epoch !== S.epoch) return;
        const start = S.items.length;
        const changed = addNodes(r.nodes);
        S.page++;
        S.count = r.count;
        S.done = r.nodes.length === 0 || S.seen.size >= r.count || (st.sort === 'random' && S.page >= 20);
        if (F.el) {
          F.renderItems(start);
          changed.filter((i) => i < start).forEach(F.renderOne);
        }
      } catch (e) {
        if (epoch === S.epoch) S.error = TT.llm.describeError(e);
      }
      if (epoch !== S.epoch) return;
      S.loading = false;
      if (F.el) F.renderFoot();
    },

    itemHTML(it, i) {
      const found = TT.chub.findLocal(it.fullPath);
      const local = found && found.shelved !== false ? found : null;
      const grid = (TT.settings.chub.layout || 'scroll') === 'grid';
      // 收在一起的其他版本（作者的舊版、別人轉載的相同內容）
      const more = (it.others || []).length;
      if (grid) {
        return html`<button class="tile chub-tile" data-i="${i}">
          <span class="tile-cover"><img src="${it.avatar}" data-thumb="${it.avatar}" alt="" loading="lazy" referrerpolicy="no-referrer">${local ? html`<span class="in-lib">${icon('check', 12)} 書架</span>` : ''}</span>
          <span class="tile-name">${it.name}</span>
          <span class="tile-tags">${icon('star', 12)} ${fmtN(it.stars)}・${it.creator}${more ? `・${more + 1} 個版本` : ''}</span>
        </button>`;
      }
      return html`<section class="feed-item" data-i="${i}">
        <div class="feed-bg" style="background-image:url('${it.avatar}')"></div>
        <img class="feed-cover loaded" src="${it.avatar}" data-thumb="${it.avatar}" data-full="${it.card}" alt="" referrerpolicy="no-referrer">
        <div class="feed-shade"></div>
        <div class="feed-side">
          <span class="side-btn">${icon('star', 26)}<span>${fmtN(it.stars)}</span></span>
          <span class="side-btn">${icon('heart', 26)}<span>${fmtN(it.favorites)}</span></span>
          <span class="side-btn">${icon('chat', 26)}<span>${fmtN(it.chats)}</span></span>
          <button class="side-btn" data-act="open" title="在 chub.ai 開啟">${icon('link', 26)}<span>chub</span></button>
        </div>
        <div class="feed-info">
          ${it.topics.length ? html`<div class="feed-tags">${it.topics.slice(0, 4).map((t) => html`<span>#${t}</span>`)}</div>` : ''}
          <h2>${it.name}</h2>
          <div class="feed-meta"><span>by ${it.creator}</span>${it.tokens ? html`<span>${fmtN(it.tokens)} tokens</span>` : ''}${it.lorebooks ? html`<span>${icon('book', 12)} 世界書</span>` : ''}${more ? html`<span title="作品頁的「其他版本」可以看到">${icon('layers', 12)} 另有 ${more} 個版本</span>` : ''}${local ? html`<span class="in-lib-text">${icon('check', 12)} 已在書架</span>` : ''}</div>
          <p class="feed-excerpt">${TT.truncate(TT.stripHtml(it.tagline || it.description).replace(/[#*_>`~]/g, '').replace(/\s+/g, ' '), 140)}</p>
          <div class="feed-actions">
            <button class="btn primary big" data-act="play">${icon('play', 18)} ${found ? '繼續故事' : '開始故事'}</button>
            <button class="btn glass" data-act="preview">序章與詳情</button>
          </div>
        </div>
      </section>`;
    },

    renderItems(from) {
      const frag = document.createElement('div');
      frag.innerHTML = S.items.slice(from).map((it, k) => String(F.itemHTML(it, from + k))).join('');
      const nodes = [...frag.children];
      if (from === 0) F.list.replaceChildren(...nodes); else F.list.append(...nodes);
      nodes.forEach((n) => { const img = n.querySelector('img'); if (img) F.lazy.observe(img); });
    },

    // 已經顯示的那一格換成作者的新版本
    renderOne(i) {
      const old = F.list && F.list.querySelector(`[data-i="${i}"]`);
      if (!old) return;
      const frag = document.createElement('div');
      frag.innerHTML = String(F.itemHTML(S.items[i], i));
      const n = frag.firstElementChild;
      old.replaceWith(n);
      const img = n.querySelector('img');
      if (img) F.lazy.observe(img);
    },

    renderFoot() {
      if (!F.foot) return;
      if (S.error) {
        F.foot.innerHTML = String(html`<div class="feed-msg">${icon('alert', 28)}<b>無法連線到 chub.ai</b><small>${S.error}</small><div class="btn-row"><button class="btn primary" data-act="retry">重試</button><a class="btn" href="#/library">前往書架</a></div></div>`);
      } else if (S.loading) {
        F.foot.innerHTML = '<div class="feed-msg loading"><span class="spinner"></span><small>載入 chub.ai 角色卡…</small></div>';
      } else if (S.done && !S.items.length) {
        F.foot.innerHTML = String(html`<div class="feed-msg">${icon('search', 28)}<b>找不到符合的角色卡</b><small>換個關鍵字、語言或排序試試。</small><button class="btn" data-act="clearq">清除搜尋</button></div>`);
      } else if (S.done) {
        F.foot.innerHTML = String(html`<div class="feed-end">已顯示全部 ${S.items.length} 張</div>`);
      } else F.foot.innerHTML = '';
    },

    reload() {
      Object.assign(S, { key: '', items: [], scroll: 0 });
      TT.saveSettings();
      F.remount();
    },

    remount() {
      if (!F.el) return;
      if (F.io) F.io.disconnect();
      if (F.lazy) F.lazy.disconnect();
      F.mount(F.el);
    },

    async onClick(e) {
      const sort = e.target.closest('[data-sort]');
      if (sort) { TT.settings.chub.sort = sort.dataset.sort; return F.reload(); }
      const a = e.target.closest('[data-act]');
      const item = e.target.closest('[data-i]');
      const it = item ? S.items[+item.dataset.i] : null;
      if (!a && it) return F.open(it);
      if (!a) return;
      const st = TT.settings.chub;
      switch (a.dataset.act) {
        case 'retry': S.error = ''; return F.loadMore();
        case 'search': {
          const q = await TT.promptText('搜尋 chub.ai', st.q || '', { placeholder: '角色名、標籤、關鍵字，或貼上 chub.ai 角色網址', okText: '搜尋' });
          if (q == null) return;
          const path = TT.chub.parsePath(q);
          if (path) return F.open({ fullPath: path, name: path.split('/').pop(), topics: [] });
          st.q = q.trim();
          return F.reload();
        }
        case 'clearq': st.q = ''; return F.reload();
        case 'layout': st.layout = st.layout === 'grid' ? 'scroll' : 'grid'; S.scroll = 0; TT.saveSettings(); return F.remount();
        case 'lang': {
          const v = await TT.choose('角色卡語言', TT.chub.LANGS.map(([k, l]) => ({ label: l, value: k || 'all', icon: 'globe' })));
          if (v == null) return;
          st.lang = v === 'all' ? '' : v;
          return F.reload();
        }
        case 'filter': return F.filterSheet();
        case 'open': if (it) window.open(it.url, '_blank', 'noopener'); return;
        case 'preview': return it && F.open(it);
        case 'play': return it && F.play(it, 0);
      }
    },

    async filterSheet() {
      const st = TT.settings.chub;
      const res = await TT.sheet({
        title: '篩選 chub.ai',
        body: html`
          <label class="field"><span>排序</span><select class="input" data-k="sort">${TT.chub.SORTS.map(([k, l, site]) => html`<option value="${k}" ${st.sort === k ? 'selected' : ''}>${l}（chub：${site}）</option>`)}</select></label>
          <label class="field"><span>語言</span><select class="input" data-k="lang">${TT.chub.LANGS.map(([k, l]) => html`<option value="${k}" ${st.lang === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="switch-row"><span><b>顯示成人內容（NSFW）</b><small>僅限已成年者；預設關閉</small></span><input type="checkbox" class="switch" data-k="nsfw" ${st.nsfw ? 'checked' : ''}></label>
          <p class="hint" style="margin-top:12px">角色卡來自 chub.ai 公開資料庫，內容由各作者上傳。</p>`,
        actions: [{ label: '取消', value: null }, { label: '套用', primary: true, onClick: (el) => {
          st.sort = el.querySelector('[data-k="sort"]').value;
          st.lang = el.querySelector('[data-k="lang"]').value;
          st.nsfw = el.querySelector('[data-k="nsfw"]').checked;
        } }],
      });
      if (res) F.reload();
    },

    // 下載（必要時）並開始；從探索開始的故事先不加入書架，之後在作品頁決定
    async play(it, greetingIndex = 0) {
      const local = TT.chub.findLocal(it.fullPath);
      if (local) return TT.actions.resumeOrStart(local);
      TT.toast(`正在從 chub.ai 下載「${it.name}」…`, { icon: 'download' });
      let card;
      try { card = await TT.chub.importCard(it, { shelve: false }); } catch (e) { return TT.toast(TT.llm.describeError(e), { type: 'error', duration: 5000 }); }
      return TT.actions.startStory(card, { greetingIndex });
    },

    // 點作品直接進入作品頁（簡介、序章、主角、存檔、立繪都在那裡）；要不要加入書架在作品頁決定
    async open(it) {
      if (F.opening) return;
      const local = TT.chub.findLocal(it.fullPath);
      if (local) return TT.router.go('/card/' + local.id);
      F.opening = true;
      TT.toast(`正在從 chub.ai 讀取「${it.name}」…`, { icon: 'download' });
      try {
        const card = await TT.chub.importCard(it, { shelve: false });
        if (F.el) TT.router.go('/card/' + card.id);
      } catch (e) {
        TT.toast(TT.llm.describeError(e), { type: 'error', duration: 5000 });
      }
      F.opening = false;
    },
  });
})();
