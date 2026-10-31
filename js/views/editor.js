/* 角色卡編輯器（含世界書條目） */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const E = (TT.views.editor = {
    async mount(el, { id }) {
      E.el = el;
      E.isNew = id === 'new';
      const src = E.isNew ? null : TT.store.getCard(id);
      if (!E.isNew && !src) { TT.router.go('/library'); return; }
      E.card = src
        ? TT.clone({ ...src, avatar: null })
        : { name: '', nickname: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1.0', extensions: {}, book: null, spec: 'chara_card_v2', raw: null, appearance: '' };
      E.avatar = src ? src.avatar : null;
      E.avatarChanged = false;
      E.render();
      el.addEventListener('click', E.onClick);
    },

    collect() {
      const c = E.card;
      const q = (f) => E.el.querySelector(`[data-f="${f}"]`);
      ['name', 'nickname', 'creator', 'character_version', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'appearance'].forEach((f) => {
        const n = q(f);
        if (n) c[f] = n.value;
      });
      c.tags = q('tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      c.alternate_greetings = [...E.el.querySelectorAll('[data-alt]')].map((t) => t.value).filter((s) => s.trim());
      const rows = [...E.el.querySelectorAll('.wi-entry')];
      if (rows.length || c.book) {
        const split = (s) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
        const old = (c.book && c.book.entries) || [];
        const entries = rows.map((r, i) => ({
          ...(old[+r.dataset.i] || { id: i, selective: false, logic: 0, depth: 4, caseSensitive: false, wholeWords: false, probability: 100, excludeRecursion: false, preventRecursion: false }),
          comment: r.querySelector('[data-w="comment"]').value,
          keys: split(r.querySelector('[data-w="keys"]').value),
          secondary: split(r.querySelector('[data-w="secondary"]').value),
          content: r.querySelector('[data-w="content"]').value,
          enabled: r.querySelector('[data-w="enabled"]').checked,
          constant: r.querySelector('[data-w="constant"]').checked,
          position: r.querySelector('[data-w="position"]').value,
          order: +r.querySelector('[data-w="order"]').value || 100,
        }));
        entries.forEach((e) => { e.selective = e.secondary.length > 0; });
        c.book = entries.length ? { ...(c.book || { name: (c.name || '角色') + ' 的世界書', scanDepth: null, tokenBudget: null, recursive: false }), entries } : null;
        c.bookDirty = true;
      }
    },

    entryHTML(e, i) {
      return html`<div class="wi-entry" data-i="${i}">
        <div class="wi-head">
          <input class="input small" data-w="comment" value="${e.comment || ''}" placeholder="條目名稱">
          <label class="mini-check"><input type="checkbox" data-w="enabled" ${e.enabled !== false ? 'checked' : ''}> 啟用</label>
          <label class="mini-check"><input type="checkbox" data-w="constant" ${e.constant ? 'checked' : ''}> 常駐</label>
          <button class="icon-btn" data-act="rmentry" title="刪除條目">${icon('trash', 18)}</button>
        </div>
        <input class="input small" data-w="keys" value="${(e.keys || []).join(', ')}" placeholder="觸發關鍵字（以逗號分隔，可用 /正則/）">
        <input class="input small" data-w="secondary" value="${(e.secondary || []).join(', ')}" placeholder="次要關鍵字（選填）">
        <textarea class="input small" rows="3" data-w="content" placeholder="條目內容">${e.content || ''}</textarea>
        <div class="wi-foot">
          <select class="input small" data-w="position">
            <option value="before" ${e.position === 'before' ? 'selected' : ''}>角色設定前</option>
            <option value="after" ${e.position === 'after' ? 'selected' : ''}>角色設定後</option>
            <option value="depth" ${e.position === 'depth' ? 'selected' : ''}>最新訊息附近</option>
          </select>
          <label class="mini-num">順序 <input class="input small" type="number" data-w="order" value="${e.order != null ? e.order : 100}"></label>
        </div>
      </div>`;
    },

    render() {
      const c = E.card;
      const avatarUrl = E.avatar ? URL.createObjectURL(E.avatar) : '';
      const area = (f, label, rows = 4, ph = '') => html`<label class="field"><span>${label}</span><textarea class="input" rows="${rows}" data-f="${f}" placeholder="${ph}">${c[f] || ''}</textarea></label>`;
      const text = (f, label, ph = '') => html`<label class="field"><span>${label}</span><input class="input" data-f="${f}" value="${c[f] || ''}" placeholder="${ph}"></label>`;
      E.el.innerHTML = String(html`<div class="view editor">
        ${TT.ui.topbar({ title: E.isNew ? '建立角色卡' : '編輯角色卡', back: true, actions: html`<button class="btn primary small" data-act="save">${icon('check', 16)} 儲存</button>` })}
        <div class="view-body">
          <div class="ed-avatar">
            <button class="ed-pic" data-act="pic">${avatarUrl ? html`<img src="${avatarUrl}" alt="">` : html`${icon('image', 30)}<span>選擇封面</span>`}</button>
            <div class="ed-basic">
              ${text('name', '角色名稱 {{char}}', '必填')}
              ${text('tags', '標籤（以逗號分隔）')}
              <div class="grid2">${text('creator', '作者')}${text('character_version', '版本')}</div>
            </div>
          </div>
          <section class="card-sec">
            <h3 class="sec-title">角色設定</h3>
            ${area('description', '描述（外貌、身分、背景）', 7)}
            ${area('personality', '性格摘要', 2)}
            ${area('scenario', '情境', 3)}
            <label class="field"><span>外貌標籤（英文，用於繪圖）</span><textarea class="input" rows="2" data-f="appearance" placeholder="1girl, long silver hair, …">${c.appearance || ''}</textarea></label>
          </section>
          <section class="card-sec">
            <h3 class="sec-title">序章（開場白）</h3>
            ${area('first_mes', '序章 1（first_mes）', 6, '*動作* 「台詞」，或直接使用 [SCENE] [NARR] [SAY:名字] 分鏡標籤')}
            <div class="alt-list">${(c.alternate_greetings || []).map((g, i) => html`<div class="alt-row"><label class="field"><span>序章 ${i + 2}</span><textarea class="input" rows="4" data-alt>${g}</textarea></label><button class="icon-btn" data-act="rmalt" data-i="${i}" title="刪除">${icon('trash', 18)}</button></div>`)}</div>
            <button class="btn small" data-act="addalt">${icon('plus', 16)} 新增序章</button>
          </section>
          <section class="card-sec">
            <h3 class="sec-title">進階</h3>
            ${area('mes_example', '對話範例（mes_example）', 4, '<START>\n{{user}}：…\n{{char}}：…')}
            ${area('system_prompt', '系統提示（system_prompt）', 3)}
            ${area('post_history_instructions', '後置指示（post_history_instructions）', 3)}
            ${area('creator_notes', '作者備註／簡介（creator_notes）', 3)}
            ${text('nickname', '暱稱（V3，選填）')}
          </section>
          <section class="card-sec">
            <h3 class="sec-title">世界書 <small>${c.book ? c.book.entries.length : 0} 條</small></h3>
            <div class="wi-list">${((c.book && c.book.entries) || []).map((e, i) => E.entryHTML(e, i))}</div>
            <button class="btn small" data-act="addentry">${icon('plus', 16)} 新增條目</button>
          </section>
          <div class="btn-row"><button class="btn primary block" data-act="save">${icon('check', 18)} 儲存角色卡</button></div>
        </div>
      </div>`);
      if (avatarUrl) setTimeout(() => URL.revokeObjectURL(avatarUrl), 4000);
    },

    async onClick(e) {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      switch (a.dataset.act) {
        case 'back':
          if (await TT.confirm('離開編輯？尚未儲存的修改會遺失。', { okText: '離開' })) TT.router.back(E.isNew ? '/library' : '/card/' + E.card.id);
          return;
        case 'pic': {
          const [f] = await TT.pickFiles({ accept: 'image/*' });
          if (!f) return;
          E.collect();
          E.avatar = f.type === 'image/png' ? f : await TT.resizeImageBlob(f, 1536, 'image/png');
          E.avatarChanged = true;
          return E.render();
        }
        case 'addalt': E.collect(); E.card.alternate_greetings.push(''); return E.render();
        case 'rmalt': E.collect(); E.card.alternate_greetings.splice(+a.dataset.i, 1); return E.render();
        case 'addentry':
          E.collect();
          if (!E.card.book) E.card.book = { name: (E.card.name || '角色') + ' 的世界書', scanDepth: null, tokenBudget: null, recursive: false, entries: [] };
          E.card.book.entries.push({ id: E.card.book.entries.length, comment: '', keys: [], secondary: [], content: '', enabled: true, constant: false, selective: false, logic: 0, order: 100, position: 'before', depth: 4, caseSensitive: false, wholeWords: false, probability: 100, excludeRecursion: false, preventRecursion: false });
          E.render();
          E.el.querySelector('.wi-entry:last-child [data-w="comment"]').focus();
          return;
        case 'rmentry': {
          const row = a.closest('.wi-entry');
          row.remove();
          return;
        }
        case 'save': return E.save();
      }
    },

    async save() {
      E.collect();
      const c = E.card;
      c.name = (c.name || '').trim();
      if (!c.name) { TT.toast('請輸入角色名稱', { type: 'error' }); return; }
      let rec;
      if (E.isNew) {
        rec = await TT.card.toRecord({ ...c, raw: null }, { source: 'created', avatar: E.avatar || null });
      } else {
        const orig = TT.store.getCard(c.id);
        rec = { ...orig, ...c, avatar: E.avatarChanged ? E.avatar : orig.avatar };
        if (E.avatarChanged) rec.generatedCover = false;
      }
      await TT.store.saveCard(rec);
      TT.toast('已儲存角色卡', { icon: 'check', type: 'ok' });
      TT.router.go('/card/' + rec.id);
    },
  });
})();
