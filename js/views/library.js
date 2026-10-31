/* 書架：繼續遊玩（所有存檔，可編輯）＋ 書架上的角色卡格狀列表 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const L = (TT.views.library = {
    filter: 'all',
    query: '',
    editing: false,

    async mount(el) {
      L.el = el;
      L.editing = false;
      L.sessions = await TT.store.allSessions();
      el.innerHTML = String(html`<div class="view library">
        ${TT.ui.topbar({
          title: '書架',
          back: 'auto',
          actions: html`<button class="icon-btn" data-act="create" title="建立新角色卡">${icon('plus', 22)}</button><button class="icon-btn" data-act="chuburl" title="貼上 chub.ai 網址匯入">${icon('link', 22)}</button><button class="icon-btn" data-act="import" title="匯入角色卡、分享的書本或遊玩檔案">${icon('upload', 22)}</button>`,
        })}
        <div class="view-body">
          <div class="search"><span>${icon('search', 18)}</span><input class="input" type="search" placeholder="搜尋角色、標籤、作者…" value="${L.query}" data-search></div>
          <div class="recent"></div>
          <div class="chips">
            <button class="chip" data-filter="all">全部</button>
            <button class="chip" data-filter="fav">${icon('heart', 14)} 收藏</button>
            <button class="chip" data-filter="saved">有存檔</button>
          </div>
          <div class="card-grid"></div>
        </div>
        ${TT.ui.tabbar('library')}
      </div>`);
      L.renderRecent();
      L.renderGrid();
      el.querySelector('[data-search]').addEventListener('input', (e) => { L.query = e.target.value; L.renderGrid(); });
      el.addEventListener('click', L.onClick);
    },

    // 繼續遊玩：所有存檔（包含還沒加入書架的故事），按「編輯」可以重新命名、複製或刪除
    renderRecent() {
      const box = L.el.querySelector('.recent');
      const list = L.sessions.filter((s) => TT.store.getCard(s.cardId));
      if (!list.length) { box.innerHTML = ''; return; }
      box.innerHTML = String(html`<div class="sec-row"><h3 class="sec-title">繼續遊玩 <small>${list.length} 個存檔</small></h3>
          <button class="link-btn" data-act="editrecent">${L.editing ? '完成' : '編輯'}</button></div>
        <div class="hscroll ${L.editing ? 'editing' : ''}">${list.map((s) => {
          const c = TT.store.getCard(s.cardId);
          const ended = TT.engine.deriveState(s, c, null).ending;
          const turns = s.messages.filter((m) => m.role === 'user').length;
          return html`<div class="resume-wrap" data-sid="${s.id}">
            <button class="resume" data-act="resume">
              <img data-media="card:${c.id}" alt="">
              <span class="resume-shade"></span>
              ${ended ? html`<span class="resume-badge">${icon('flag', 12)} 結局</span>` : ''}
              ${c.shelved === false ? html`<span class="resume-badge off">未在書架</span>` : ''}
              <span class="resume-info"><b>${c.name}</b><small>${s.title}</small><small>${turns} 回合・${TT.fmtTime(s.updatedAt)}</small></span>
            </button>
            ${L.editing ? html`<button class="resume-x" data-act="delsave" title="刪除存檔">${icon('x', 14)}</button><button class="resume-edit" data-act="savemenu" title="重新命名、複製…">${icon('edit', 14)}</button>` : ''}
          </div>`;
        })}</div>`);
      TT.media.hydrate(box);
    },

    renderGrid() {
      const grid = L.el.querySelector('.card-grid');
      L.el.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === L.filter));
      const q = L.query.trim().toLowerCase();
      const saved = new Set(L.sessions.map((s) => s.cardId));
      const shelf = TT.store.shelf();
      const list = shelf.filter((c) => {
        if (L.filter === 'fav' && !c.favorite) return false;
        if (L.filter === 'saved' && !saved.has(c.id)) return false;
        if (!q) return true;
        return [c.name, c.creator, ...(c.tags || [])].join(' ').toLowerCase().includes(q);
      });
      if (!shelf.length) {
        grid.innerHTML = String(TT.ui.empty({
          ic: 'library',
          title: '書架還是空的',
          text: '到「探索」點開喜歡的作品，在作品頁按「加入書架」；或貼上 chub.ai 角色網址。',
          actions: html`<a class="btn primary" href="#/">${icon('compass', 18)} 瀏覽 chub.ai</a><button class="btn" data-act="chuburl">${icon('link', 18)} 貼上 chub.ai 網址</button><button class="btn" data-act="sample">${icon('sparkles', 18)} 內建範例故事</button>`,
        }));
        return;
      }
      if (!list.length) { grid.innerHTML = '<p class="muted center">沒有符合的故事</p>'; return; }
      // 每本書右上角的「⋯」：不用進入作品也能打開作品設定
      grid.innerHTML = list
        .map((c) => String(html`<div class="tile-wrap"><button class="tile" data-id="${c.id}">
          <span class="tile-cover"><img data-media="card:${c.id}" alt="">${c.favorite ? html`<span class="tile-fav">${icon('heartFill', 14)}</span>` : ''}</span>
          <span class="tile-name">${c.name}</span>
          <span class="tile-tags">${(c.tags || []).slice(0, 3).map((t) => '#' + t).join(' ') || (c.creator ? 'by ' + c.creator : '')}</span>
        </button><button class="tile-more" data-act="tilemenu" data-card="${c.id}" title="作品設定、移出書架…">${icon('more', 18)}</button></div>`))
        .join('');
      TT.media.hydrate(grid);
    },

    async tileMenu(c) {
      if (!c) return;
      const v = await TT.choose(c.name, [
        { label: '遊玩前設定（優先指示、角色池、主角）', value: 'preplay', icon: 'flag' },
        { label: '作品設定（角色池、立繪、主角、特殊場景、背景）', value: 'settings', icon: 'image' },
        { label: '開始新故事', value: 'start', icon: 'play' },
        { label: '故事詳情', value: 'detail', icon: 'info' },
        { label: '移出書架', value: 'unshelf', icon: 'bookmark', hint: '存檔與素材保留' },
      ]);
      if (v === 'preplay') {
        if ((await TT.actions.prePlay(c)) === 'go') return TT.actions.startStory(c);
        return L.refresh();
      }
      if (v === 'settings') { await TT.sprites.manager(c); return L.refresh(); }
      if (v === 'start') return TT.actions.startStory(c);
      if (v === 'detail') return TT.router.go('/card/' + c.id);
      if (v === 'unshelf') {
        c.shelved = false;
        await TT.store.saveCard(c);
        TT.toast(`已把「${c.name}」移出書架`);
        return L.refresh();
      }
    },

    async refresh() {
      L.sessions = await TT.store.allSessions();
      if (!L.el) return;
      L.renderRecent();
      L.renderGrid();
    },

    async onClick(e) {
      const f = e.target.closest('[data-filter]');
      if (f) { L.filter = f.dataset.filter; return L.renderGrid(); }
      const a = e.target.closest('[data-act]');
      const wrap = e.target.closest('[data-sid]');
      const s = wrap && L.sessions.find((x) => x.id === wrap.dataset.sid);
      if (a && s) {
        if (a.dataset.act === 'resume') {
          // 點存檔：先看遊玩前設定（優先指示、角色池…），可以在那裡關掉直接進入
          if (!L.editing) { await TT.actions.openSave(s); if (TT.router.current === 'library') L.refresh(); return; }
          const v = await TT.actions.sessionMenu(s);
          if (v && v !== 'go' && v !== 'detail') L.refresh();
          return;
        }
        if (a.dataset.act === 'savemenu') {
          const v = await TT.actions.sessionMenu(s);
          if (v && v !== 'go' && v !== 'detail') L.refresh();
          return;
        }
        if (a.dataset.act === 'delsave') {
          if (!(await TT.confirm(`刪除存檔「${s.title}」？場景圖也會一併刪除。`, { danger: true, okText: '刪除' }))) return;
          await TT.store.deleteSession(s.id);
          return L.refresh();
        }
      }
      if (a && a.dataset.act === 'tilemenu') return L.tileMenu(TT.store.getCard(a.dataset.card));
      const t = e.target.closest('.tile');
      if (t) return TT.router.go('/card/' + t.dataset.id);
      if (!a) return;
      switch (a.dataset.act) {
        case 'back': return TT.router.back('/');
        case 'editrecent': L.editing = !L.editing; return L.renderRecent();
        case 'import': return TT.actions.pickAndImport();
        case 'chuburl': return TT.actions.importChubUrl();
        case 'create': return TT.router.go('/edit/new');
        case 'sample': { const c = await TT.sample.install(); TT.router.go('/card/' + c.id); }
      }
    },
  });
})();
