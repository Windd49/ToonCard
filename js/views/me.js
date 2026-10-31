/* 我的：主角管理、統計、成就、結局收藏 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const Me = (TT.views.me = {
    async mount(el) {
      Me.el = el;
      Me.sessions = await TT.store.allSessions();
      Me.render();
      el.addEventListener('click', Me.onClick);
    },

    render() {
      const st = TT.achv.state;
      const def = TT.store.defaultPersona();
      const turns = TT.achv.count('turns');
      const scenes = TT.achv.count('scenes');
      const endingsByCard = Object.entries(st.endings).filter(([id, l]) => l.length && TT.store.getCard(id));
      Me.el.innerHTML = String(html`<div class="view me">
        ${TT.ui.topbar({ title: '我的', back: 'auto' })}
        <div class="view-body">
          <div class="me-head">
            ${TT.ui.avatar({ kind: 'persona', id: def.avatar ? def.id : '', name: def.name, size: 64 })}
            <div><h2>${def.name}</h2><p class="muted">目前的預設主角</p></div>
          </div>
          <a class="persona-row assets-link" href="#/assets"><span class="avatar add-av">${icon('box', 22)}</span><span class="pr-main"><b>素材庫</b><small>所有故事的立繪、特殊場景圖與音效，集中查看、編輯、匯出</small></span>${icon('forward', 18)}</a>
          <div class="facts">
            <div><b>${TT.store.cards.length}</b><span>故事</span></div>
            <div><b>${turns}</b><span>回合</span></div>
            <div><b>${scenes}</b><span>場景圖</span></div>
            <div><b>${TT.achv.totalEndings()}</b><span>結局</span></div>
          </div>

          <section class="card-sec">
            <h3 class="sec-title">我的主角 <small>在故事中扮演的角色（{{user}}）</small></h3>
            <div class="persona-list">
              ${TT.store.personas.map((p) => html`<button class="persona-row" data-pid="${p.id}">
                ${TT.ui.avatar({ kind: 'persona', id: p.avatar ? p.id : '', name: p.name, size: 48 })}
                <span class="pr-main"><b>${p.name}${p.id === def.id ? html`<em class="badge">預設</em>` : ''}</b><small>${TT.truncate(p.description || '尚未填寫設定', 60)}</small></span>
                ${icon('forward', 18)}
              </button>`)}
              <button class="persona-row add" data-act="newpersona"><span class="avatar add-av">${icon('plus', 22)}</span><span class="pr-main"><b>建立新主角</b><small>名字、設定、外貌與頭像</small></span></button>
            </div>
          </section>

          <section class="card-sec">
            <h3 class="sec-title">成就 <small>${Object.keys(st.unlocked).length} / ${TT.achv.LIST.length}</small></h3>
            <div class="achv-grid">${TT.achv.LIST.map((a) => {
              const t = st.unlocked[a.id];
              return html`<div class="achv ${t ? 'on' : ''}" title="${a.desc}">
                <span class="achv-ic">${icon(a.icon, 22)}</span>
                <b>${a.title}</b><small>${t ? new Date(t).toLocaleDateString('zh-TW') : a.desc}</small>
              </div>`;
            })}</div>
          </section>

          <section class="card-sec">
            <h3 class="sec-title">結局收藏</h3>
            ${endingsByCard.length ? endingsByCard.map(([id, list]) => {
              const c = TT.store.getCard(id);
              return html`<div class="ending-group" data-card="${id}">
                <img data-media="card:${id}" alt="">
                <div><b>${c.name}</b><div class="ending-chips">${list.map((e) => html`<span class="ending-chip">${icon('flag', 12)} ${e.title}</span>`)}</div></div>
              </div>`;
            }) : html`<p class="muted">還沒有達成任何結局。故事走到終點時，AI 會宣告結局名稱並收錄在這裡。</p>`}
          </section>
        </div>
        ${TT.ui.tabbar('me')}
      </div>`);
      TT.media.hydrate(Me.el);
    },

    async onClick(e) {
      const p = e.target.closest('[data-pid]');
      if (p) { await TT.actions.editPersona(TT.store.getPersona(p.dataset.pid)); return Me.render(); }
      const g = e.target.closest('[data-card]');
      if (g) return TT.router.go('/card/' + g.dataset.card);
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'newpersona') { await TT.actions.editPersona(null); Me.render(); }
      if (a && a.dataset.act === 'back') TT.router.back('/');
    },
  });
})();
