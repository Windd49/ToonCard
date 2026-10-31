/* 素材庫：所有故事的立繪與特殊場景圖集中查看、編輯、匯出（素材包可以套用到別的故事），以及所有故事共用的音效庫 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const count = (c) => {
    const names = TT.sprites.spriteNames(c);
    return { chars: names.length, imgs: names.reduce((n, x) => n + Object.values((c.expr || {})[x] || {}).filter(Boolean).length, 0), cgs: (c.cgs || []).length, bgs: (c.bgs || []).filter((g) => g.blob).length };
  };

  // 配樂每本書分開：依書整理（沒有書的是改版前共用的配樂）
  async function musicByCard() {
    const by = new Map();
    for (const r of await TT.bgm.load()) by.set(r.cardId || '', (by.get(r.cardId || '') || []).concat(r));
    return [...by.entries()]
      .map(([id, files]) => ({ id, card: id ? TT.store.getCard(id) : null, files, kinds: [...new Set(files.map((r) => r.name))] }))
      .filter((g) => !g.id || g.card)
      .sort((a, b) => !a.id - !b.id);
  }

  const A = (TT.views.assets = {
    async mount(el) {
      A.el = el;
      A.sounds = await TT.sfx.available();
      A.music = await musicByCard();
      A.render();
      el.addEventListener('click', A.onClick);
      A.off = TT.bus.on('sfx:changed', async () => { A.sounds = await TT.sfx.available(); A.music = await musicByCard(); if (A.el) A.render(); });
    },
    unmount() { if (A.off) A.off(); A.el = null; },

    rowHTML(c) {
      const n = count(c);
      const thumbs = [
        ...TT.sprites.spriteNames(c).slice(0, 5).map((x) => {
          const set = (c.expr || {})[x] || {};
          return set['平常'] ? `sprite:${c.id}|${x}|平常` : `sprite:${c.id}|${x}`;
        }),
        ...(c.cgs || []).slice(0, 3).map((g) => `cg:${c.id}|${g.id}`),
      ];
      return html`<div class="asset-row" data-id="${c.id}">
        <img class="asset-cover" data-media="card:${c.id}" alt="">
        <div class="asset-main">
          <b>${c.name}</b>
          <small>${n.chars ? `立繪 ${n.chars} 人・${n.imgs} 張` : '還沒有立繪'}${n.cgs ? `｜特殊場景圖 ${n.cgs} 張` : ''}${n.bgs ? `｜背景 ${n.bgs} 張` : ''}${c.shelved === false ? '｜未在書架' : ''}</small>
          ${thumbs.length ? html`<div class="asset-thumbs">${thumbs.map((m) => html`<img data-media="${m}" alt="" class="${m.startsWith('cg:') ? 'blurred' : ''}" title="${m.startsWith('cg:') ? '特殊場景圖（模糊預覽，避免劇透）' : ''}">`)}</div>` : ''}
        </div>
        <div class="asset-acts">
          <button class="btn small" data-act="edit">${icon('edit', 14)} 編輯</button>
          <button class="icon-btn" data-act="more" title="匯出、匯入、清除">${icon('more', 18)}</button>
        </div>
      </div>`;
    },

    render() {
      const all = TT.store.cards.slice();
      const withAssets = all.filter(TT.store.hasAssets);
      const rest = all.filter((c) => !TT.store.hasAssets(c));
      const files = A.sounds.reduce((n, k) => n + k.files.length, 0);
      A.el.innerHTML = String(html`<div class="view assets">
        ${TT.ui.topbar({ title: '素材庫', back: true, actions: html`<button class="icon-btn" data-act="importpack" title="匯入素材包">${icon('upload', 22)}</button>` })}
        <div class="view-body">
          <p class="hint">立繪與特殊場景圖存在各自的故事裡，同一個故事的所有存檔共用；劇情裡同一個角色的不同叫法會自動用同一組立繪（也可以在立繪管理裡設定別名）。別的故事有同名角色的立繪時，在立繪管理裡可以一鍵套用。完整備份也會包含這些素材。</p>
          <section class="card-sec">
            <h3 class="sec-title">${icon('image', 18)} 立繪與特殊場景圖 <small>${withAssets.length} 個故事</small></h3>
            ${withAssets.length ? html`<div class="asset-list">${withAssets.map((c) => A.rowHTML(c))}</div>` : html`<p class="muted">還沒有任何立繪或特殊場景圖。到故事的作品頁或遊玩選單的「立繪與特殊場景圖」匯入或生成。</p>`}
            ${rest.length ? html`<details class="asset-rest"><summary>其他故事（${rest.length}）</summary><div class="asset-list">${rest.map((c) => A.rowHTML(c))}</div></details>` : ''}
          </section>
          <section class="card-sec">
            <h3 class="sec-title">${icon('music', 18)} 配樂庫（BGM） <small>每本書分開</small></h3>
            <p class="hint">每本書有自己的配樂，只在那本書播放。劇情的氣氛或場景改變時，AI 用 [BGM:名稱] 換配樂（循環播放、淡入淡出）。匯出、匯入在各書的配樂庫裡。</p>
            ${A.music.length ? html`<div class="asset-list">${A.music.map((g) => html`<div class="asset-row" data-bgmcard="${g.id}">
              ${g.card ? html`<img class="asset-cover" data-media="card:${g.card.id}" alt="">` : html`<span class="asset-cover sfx-ic">${icon('music', 18)}</span>`}
              <div class="asset-main"><b>${g.card ? g.card.name : '改版前共用的配樂'}</b><small>${g.kinds.join('、')}（${g.files.length} 首）${g.card ? '' : '・可以在各書的配樂庫按「加入這本書」'}</small></div>
              ${g.card ? html`<div class="asset-acts"><button class="btn small" data-act="bgm">${icon('music', 14)} 管理</button></div>` : ''}
            </div>`)}</div>` : html`<p class="muted">還沒有任何配樂。</p>`}
            <div class="btn-row wrap"><button class="btn small" data-act="bgm">${icon('music', 16)} 管理某本書的配樂</button></div>
          </section>
          <section class="card-sec">
            <h3 class="sec-title">${icon('volume', 18)} 音效庫 <small>${A.sounds.length} 種・${files} 個音檔</small></h3>
            <p class="hint">所有故事共用。劇情裡的 [SFX] 依音效名稱或擬聲詞內容挑一個音檔播放。${A.sounds.length ? `目前有：${A.sounds.map((k) => k.name).join('、')}` : ''}</p>
            <div class="btn-row wrap">
              <button class="btn small" data-act="sfx">${icon('music', 16)} 管理音效庫</button>
              <button class="btn small" data-act="sfxexport">${icon('download', 16)} 匯出音效庫</button>
              <button class="btn small" data-act="sfximport">${icon('upload', 16)} 匯入音效庫</button>
            </div>
          </section>
        </div>
      </div>`);
      TT.media.hydrate(A.el);
    },

    // 選一個故事（匯入素材包時）
    pickCard(title) {
      return TT.choose(title, TT.store.cards.slice(0, 60).map((c) => ({ label: c.name, value: c.id, icon: 'book', hint: count(c).chars ? `立繪 ${count(c).chars} 人` : '' })));
    },

    async importPackTo(card, data) {
      const r = await TT.sprites.importPack(card, data);
      TT.toast(`已匯入「${card.name}」：${r.chars} 個角色的立繪、${r.cgs} 張特殊場景圖`, { icon: 'check', type: 'ok', duration: 4000 });
      if (A.el) A.render();
    },

    async readPack() {
      const [f] = await TT.pickFiles({ accept: '.json,application/json' });
      if (!f) return null;
      try { return TT.sprites.parsePack(await f.text()); } catch (e) { TT.toast(e.message, { type: 'error' }); return null; }
    },

    async onClick(e) {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const row = a.closest('[data-id]');
      const card = row && TT.store.getCard(row.dataset.id);
      switch (a.dataset.act) {
        case 'back': return TT.router.back('/me');
        case 'edit':
          if (!card) return;
          await TT.sprites.manager(card);
          return A.el && A.render();
        case 'more': {
          if (!card) return;
          const v = await TT.choose(card.name, [
            { label: '匯出素材包', value: 'export', icon: 'download', hint: '立繪、自訂種類、別名、特殊場景圖' },
            { label: '匯入素材包到這個故事', value: 'import', icon: 'upload' },
            { label: '故事詳情', value: 'detail', icon: 'info' },
            ...(TT.store.hasAssets(card) ? [{ label: '清除這個故事的所有立繪、特殊場景圖與背景', value: 'clear', icon: 'trash', danger: true }] : []),
          ]);
          if (v === 'export') TT.download(TT.safeFileName(`${card.name}-素材包`) + '.json', await TT.sprites.exportPack(card), 'application/json');
          else if (v === 'import') { const d = await A.readPack(); if (d) await A.importPackTo(card, d); }
          else if (v === 'detail') TT.router.go('/card/' + card.id);
          else if (v === 'clear') {
            if (!(await TT.confirm(`清除「${card.name}」的所有立繪、特殊場景圖與背景？建議先匯出素材包。`, { danger: true, okText: '清除' }))) return;
            for (const f of ['expr', 'exprCut', 'sprites', 'spriteCut', 'spriteRaw', 'poseKinds', 'spriteAlias']) delete card[f];
            (card.cgs || []).forEach((g) => TT.media.invalidate('cg', `${card.id}|${g.id}`));
            (card.bgs || []).forEach((g) => TT.media.invalidate('bg', `${card.id}|${g.id}`));
            card.cgs = [];
            card.bgs = [];
            await TT.store.saveCard(card);
            TT.toast('已清除');
            A.render();
          }
          return;
        }
        case 'importpack': {
          const d = await A.readPack();
          if (!d) return;
          const same = TT.store.cards.find((c) => c.name === d.cardName);
          const id = await A.pickCard(`把「${d.cardName || '素材包'}」的素材匯入到哪個故事？${same ? `（建議：${same.name}）` : ''}`);
          const target = id && TT.store.getCard(id);
          if (target) await A.importPackTo(target, d);
          return;
        }
        case 'sfx': await TT.sfx.manager(); return;
        case 'bgm': {
          const b = a.closest('[data-bgmcard]');
          await TT.bgm.manager({ card: b && b.dataset.bgmcard ? TT.store.getCard(b.dataset.bgmcard) : null });
          return;
        }
        case 'sfxexport': {
          if (!A.sounds.length) return TT.toast('音效庫還是空的');
          TT.download('ToonCard-音效庫.json', await TT.sfx.exportLib(), 'application/json');
          return;
        }
        case 'sfximport': {
          const [f] = await TT.pickFiles({ accept: '.json,application/json' });
          if (!f) return;
          try {
            const n = await TT.sfx.importLib(await f.text());
            TT.toast(`已匯入 ${n} 個音檔`, { icon: 'check', type: 'ok' });
          } catch (err) { TT.toast(err.message, { type: 'error' }); }
        }
      }
    },
  });
})();
