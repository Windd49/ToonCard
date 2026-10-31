/* 作者的設定與規則：角色卡裡作者寫給 AI 的提示詞（Character Note、系統提示、後置指示）、作者需知、角色定義，
 * 以及世界書的每一條（常駐的規則、文風、狀態欄…）。像 chub.ai 的「Definitions」一樣列出來給玩家看；
 * 世界書條目可以在這裡開關（作者標「选开」的就是給玩家自己選的） */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const books = (card) => [card.book, ...(card.extraBooks || [])].filter(Boolean);
  const size = (s) => String(s || '').trim().length;
  const fmtSize = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n) + ' 字';
  const entryName = (e, i) => e.comment || (e.keys || []).slice(0, 3).join('、') || `第 ${i + 1} 條`;
  // 顯示用：{{char}}、{{user}} 換成名字，其他巨集照原樣
  const show = (card, text) => {
    const p = TT.store.defaultPersona();
    return String(text || '').replace(/\{\{char\}\}|<BOT>/gi, card.nickname || card.name).replace(/\{\{user\}\}|<USER>/gi, p ? p.name : '主角').trim();
  };

  // 角色卡附帶的提示詞與說明：{ key, title, text, note }
  function prompts(card) {
    const st = TT.settings.story;
    const dp = (card.extensions && card.extensions.depth_prompt) || null;
    return [
      { key: 'creator', title: '作者需知（Creator\'s Notes）', text: card.creator_notes, note: '作者寫給玩家的說明，不會送給 AI' },
      { key: 'note', title: 'Character Note（角色筆記）', text: dp && dp.prompt, note: '每回合都會送給 AI' },
      { key: 'system', title: '系統提示（System Prompt）', text: card.system_prompt, note: st.useCardSystem ? '使用中（「設定 → 劇情」可以關掉）' : '目前沒有使用（「設定 → 劇情」可以打開）' },
      { key: 'phi', title: '後置指示（Post History Instructions）', text: card.post_history_instructions, note: st.useCardPHI ? '使用中，每回合放在最後面' : '目前沒有使用（「設定 → 劇情」可以打開）' },
      { key: 'desc', title: '角色描述（Description）', text: card.description, note: '' },
      { key: 'pers', title: '性格（Personality）', text: card.personality, note: '' },
      { key: 'scen', title: '情境（Scenario）', text: card.scenario, note: '' },
      { key: 'ex', title: '對話範例（Example Dialogs）', text: card.mes_example, note: '' },
    ].filter((x) => size(x.text));
  }

  // 一行摘要（作品頁、遊玩前設定用）
  function summary(card) {
    const p = prompts(card).filter((x) => ['note', 'system', 'phi'].includes(x.key)).map((x) => x.title.replace(/（.*$/, ''));
    const all = books(card).flatMap((b) => b.entries || []);
    const on = all.filter((e) => e.enabled !== false);
    const parts = [...p];
    if (all.length) parts.push(`世界書 ${all.length} 條（開著 ${on.length} 條，其中常駐 ${on.filter((e) => e.constant).length} 條）`);
    if (size(card.creator_notes)) parts.unshift('作者需知');
    return parts.join('・');
  }

  async function sheet(card, { back = false } = {}) {
    if (card.chub && !card.chubBookChecked) await TT.chub.refreshBook(card);
    const ours = () => (card.authorArt && card.authorArt.disabledByUs) || [];
    let filter = 'all';
    let q = '';
    const match = (e, i) => {
      if (filter === 'const' && !e.constant) return false;
      if (filter === 'keys' && e.constant) return false;
      if (filter === 'off' && e.enabled !== false) return false;
      if (!q) return true;
      const t = q.toLowerCase();
      return [entryName(e, i), ...(e.keys || []), e.content].some((s) => String(s || '').toLowerCase().includes(t));
    };
    const entryHTML = (e, bi, i) => html`<details class="an-entry ${e.enabled === false ? 'off' : ''}" data-an-entry="${bi}:${i}">
        <summary>
          <input type="checkbox" class="switch" data-an-toggle="${bi}:${i}" ${e.enabled !== false ? 'checked' : ''} title="開關這一條">
          <span class="an-name"><b>${entryName(e, i)}</b><small>${e.constant ? '常駐・每回合都送出' : `關鍵字：${(e.keys || []).slice(0, 4).join('、') || '（沒有）'}`}・${fmtSize(size(e.content))}${ours().includes(e.id) && e.enabled === false ? '・匯入作者附圖時停用' : ''}</small></span>
        </summary>
        <div class="an-text">${show(card, e.content)}</div>
      </details>`;
    const bookHTML = (b, bi) => {
      const list = (b.entries || []).map((e, i) => [e, i]).filter(([e, i]) => match(e, i));
      // 常駐的條目（規則、文風、狀態欄）放前面
      list.sort((x, y) => (y[0].constant ? 1 : 0) - (x[0].constant ? 1 : 0));
      return html`<div class="an-book">
        <h4 class="sec-title">${bi === 0 ? '世界書' : '附加世界書'}「${b.name || '未命名'}」<small>${(b.entries || []).filter((e) => e.enabled !== false).length} / ${(b.entries || []).length} 條開著</small></h4>
        ${list.length ? list.map(([e, i]) => entryHTML(e, bi, i)) : html`<p class="muted">沒有符合的條目</p>`}
      </div>`;
    };
    const listHTML = () => books(card).map(bookHTML);
    const total = books(card).reduce((n, b) => n + (b.entries || []).length, 0);
    const body = html`<div class="an">
      <p class="hint">這張卡的作者寫給 AI 的提示詞、說明與世界書，本程式都會照著用。世界書的每一條都可以在這裡開關：作者標「选开／選開」的是給你自己選的，例如文風、第一人稱或第三人稱。</p>
      ${prompts(card).map((x) => html`<details class="an-entry" ${x.key === 'creator' || x.key === 'note' ? 'open' : ''}>
        <summary><span class="an-name"><b>${x.title}</b><small>${fmtSize(size(x.text))}${x.note ? `・${x.note}` : ''}</small></span></summary>
        <div class="an-text">${show(card, x.key === 'creator' ? TT.stripHtml(x.text) : x.text)}</div>
      </details>`)}
      ${total ? html`<div class="an-tools">
          <div class="an-filters">${[['all', '全部'], ['const', '常駐（規則）'], ['keys', '關鍵字'], ['off', '已關閉']].map(([k, l]) => html`<button class="chip ${k === filter ? 'active' : ''}" data-an-filter="${k}">${l}</button>`)}</div>
          ${total > 12 ? html`<input class="input small" data-an-q placeholder="搜尋條目名稱、關鍵字或內容">` : ''}
        </div>
        <div data-an-list>${listHTML()}</div>` : html`<p class="muted">這張卡沒有世界書。</p>`}
    </div>`;
    return TT.sheet({
      title: '作者的設定與規則',
      back,
      wide: true,
      className: 'an-sheet',
      body,
      actions: [{ label: '完成', primary: true }],
      onMount: (el) => {
        const box = el.querySelector('[data-an-list]');
        const redraw = () => { if (box) box.innerHTML = String(html`${listHTML()}`); };
        el.addEventListener('click', (e) => {
          // 點開關不要順便展開／收起條目
          if (e.target.closest('[data-an-toggle]')) { e.stopPropagation(); return; }
          const f = e.target.closest('[data-an-filter]');
          if (!f) return;
          filter = f.dataset.anFilter;
          el.querySelectorAll('[data-an-filter]').forEach((b) => b.classList.toggle('active', b === f));
          redraw();
        });
        el.addEventListener('input', (e) => {
          if (!e.target.matches('[data-an-q]')) return;
          q = e.target.value.trim();
          redraw();
        });
        el.addEventListener('change', async (e) => {
          const t = e.target.closest('[data-an-toggle]');
          if (!t) return;
          const [bi, i] = t.dataset.anToggle.split(':').map(Number);
          const entry = (books(card)[bi].entries || [])[i];
          if (!entry) return;
          entry.enabled = t.checked;
          card.bookDirty = true;
          // 玩家自己開關過的條目，作者附圖的「復原」不再動它
          if (card.authorArt && card.authorArt.disabledByUs) card.authorArt.disabledByUs = card.authorArt.disabledByUs.filter((id) => id !== entry.id);
          await TT.store.saveCard(card);
          const row = t.closest('.an-entry');
          if (row) row.classList.toggle('off', !t.checked);
          const head = t.closest('.an-book') && t.closest('.an-book').querySelector('h4 small');
          const b = books(card)[bi];
          if (head) head.textContent = `${b.entries.filter((x) => x.enabled !== false).length} / ${b.entries.length} 條開著`;
          TT.toast(`${t.checked ? '已打開' : '已關閉'}「${entryName(entry, i)}」`);
        });
      },
    });
  }

  TT.authorNotes = { prompts, summary, sheet };
})();
