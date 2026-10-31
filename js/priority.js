/* 優先指示：玩家自己寫、優先於其他規則的指示（要記住的事、劇情走向、輸出方式、禁止事項）。
 * 分三層：所有故事（預設）、這個作品（所有存檔共用）、這個存檔；每一條都可以單獨開關。
 * 每回合放在給 AI 的導演指示最後面，越後面（越貼近這個存檔）的越優先。
 * 也在這裡：遊玩前設定（點存檔、作品時先調整優先指示、角色池、主角，再開始或繼續） */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));
  const cur = (m) => m.swipes[m.sw || 0];

  const KINDS = [
    { key: 'memo', label: '要記住的事', hint: '一直成立的事實，劇情不能和它矛盾', ph: '例如：主角的左手受了傷；瑟拉答應過要替主角保守秘密' },
    { key: 'plot', label: '劇情走向', hint: '接下來的發展要朝這個方向', ph: '例如：慢慢推進感情線，不要太快確定關係' },
    { key: 'style', label: '輸出方式', hint: '文風、長度、對話與旁白的比例', ph: '例如：多寫角色之間的對話，旁白精簡' },
    { key: 'ban', label: '禁止事項', hint: '絕對不要出現', ph: '例如：不要讓主要角色死亡' },
    { key: 'other', label: '其他', hint: '', ph: '其他要 AI 優先遵守的事' },
  ];
  const kindOf = (k) => KINDS.find((x) => x.key === k) || KINDS[KINDS.length - 1];

  const TEMPLATES = [
    ['plot', '慢慢推進感情線，不要太快確定關係'],
    ['plot', '多安排日常與角色之間的互動，少一點戰鬥'],
    ['plot', '接下來安排一個意外事件，讓劇情出現轉折'],
    ['style', '多寫角色之間的對話，旁白精簡'],
    ['style', '旁白多一些細膩的環境與心理描寫'],
    ['style', '每次回覆短一點（大約 8～12 行）'],
    ['style', '每次回覆長一點，多寫細節'],
    ['style', '台詞口語化，符合每個角色的說話習慣'],
    ['ban', '不要替主角說話、做決定或描寫主角的內心'],
    ['ban', '不要出現血腥、獵奇或過度暴力的描寫'],
    ['ban', '不要讓主要角色死亡'],
    ['ban', '不要突然加入新的主要角色'],
    ['ban', '不要使用網路用語或現代流行語'],
  ];

  const SCOPES = {
    session: { label: '這個存檔', hint: '只影響這個存檔：適合寫要記住的事、這段劇情的走向' },
    card: { label: '這個作品', hint: '這個作品的所有存檔都會套用' },
    all: { label: '所有故事', hint: '每個故事都會套用：適合寫輸出方式和禁止事項' },
  };

  // 每一層的清單（沒有就建立）
  function listOf(scope, { card, session } = {}) {
    if (scope === 'all') return (TT.settings.story.priority = Array.isArray(TT.settings.story.priority) ? TT.settings.story.priority : []);
    const owner = scope === 'card' ? card : session;
    if (!owner) return [];
    return (owner.priority = Array.isArray(owner.priority) ? owner.priority : []);
  }
  function saveScope(scope, { card, session } = {}) {
    if (scope === 'all') TT.saveSettings();
    else if (scope === 'card' && card) TT.store.saveCard(card);
    else if (scope === 'session' && session) TT.store.saveSession(session, true);
  }

  // 生效中的指示：所有故事 → 這個作品 → 這個存檔
  function active(ctx = {}) {
    const out = [];
    for (const scope of ['all', 'card', 'session']) {
      if (scope !== 'all' && !(scope === 'card' ? ctx.card : ctx.session)) continue;
      for (const e of listOf(scope, ctx)) if (e.on !== false && String(e.text || '').trim()) out.push({ ...e, scope });
    }
    return out;
  }

  // 給 AI 的區塊（放在導演指示最後）
  function promptBlock(ctx, mctx) {
    const list = active(ctx);
    if (!list.length) return '';
    const M = (t) => (mctx ? TT.macros.apply(t, mctx) : t);
    const groups = KINDS.map((k) => ({ k, items: list.filter((e) => kindOf(e.kind).key === k.key) })).filter((g) => g.items.length);
    return '【玩家的優先指示｜最優先】下面是玩家親自寫的指示，優先於上面所有劇情、文風、長度與節奏的規則，每一回合都要遵守；同一類有衝突時，以排在後面的為準（分鏡標籤格式與成人內容的年齡規定仍然有效）：\n'
      + groups.map((g) => `◆${g.k.label}${g.k.hint ? `（${g.k.hint}）` : ''}\n` + g.items.map((e) => `- ${M(String(e.text).trim())}`).join('\n')).join('\n');
  }

  // 一行摘要：「生效 3 條：要記住的事 2、禁止事項 1」
  function summary(ctx) {
    const list = active(ctx);
    if (!list.length) return '';
    const counts = KINDS.map((k) => [k.label, list.filter((e) => kindOf(e.kind).key === k.key).length]).filter(([, n]) => n);
    return `生效 ${list.length} 條：${counts.map(([l, n]) => `${l} ${n}`).join('、')}`;
  }

  // 交由 AI：要記住的事（從這個存檔的劇情整理）、劇情走向（構想 3 個方向）；回傳字串陣列
  async function conceive(kind, { card, session, persona }) {
    const p = persona || TT.store.defaultPersona();
    const recent = session ? session.messages.slice(-12)
      .map((m) => (m.role === 'user' ? (m.hidden ? '' : `${p.name}：${cur(m).raw}`) : TT.parser.beatsToProse(cur(m).beats || [])))
      .filter(Boolean).join('\n').slice(-6000) : '';
    const known = active({ card, session }).filter((e) => kindOf(e.kind).key === kind).map((e) => `- ${e.text}`).join('\n');
    const src = recent
      ? `【劇情摘要】\n${(session.summary || '').trim() || '（無）'}\n\n【最近的劇情】\n${recent}`
      : `【作品資料（節錄）】\n${TT.truncate(TT.cast.cardText(card), 6000)}`;
    const task = kind === 'memo'
      ? '從下面的劇情整理出 AI 之後演出時一定要記住、不能前後矛盾的事：承諾與約定、受傷或身體狀態、得到或失去的東西、秘密、人物關係的變化、重要的名字與地點。每條一句，具體簡短，最多 8 條，不要重複已經記下的。只輸出 JSON：{"items":["…"]}'
      : `依下面的內容，替接下來的劇情構想 3 個不同的發展方向，寫成給 AI 的導演指示（每個一句話，具體、有畫面，不要替主角「${p.name}」做決定）。只輸出 JSON：{"items":["…","…","…"]}`;
    const prompt = `${task}\n${known ? `\n【已經記下的】\n${known}\n` : ''}\n【作品】${card ? card.name : ''}\n${src}`;
    const out = await TT.llm.complete([{ role: 'user', content: prompt }], { maxTokens: 4000, json: true, cfg: { thinking: 'low' } });
    const j = TT.cast.parseJson(out, '{');
    const items = Array.isArray(j) ? j : (j && (j.items || Object.values(j).find(Array.isArray))) || [];
    return items.map((s) => String(typeof s === 'string' ? s : (s && (s.text || s.item)) || '').trim()).filter(Boolean);
  }

  // 編輯面板：有存檔時多一段「這個存檔」，有作品時多一段「這個作品」，「所有故事」一定有
  function sheet({ card = null, session = null, persona = null, back = false } = {}) {
    const ctx = { card, session, persona };
    const scopes = ['session', 'card', 'all'].filter((s) => s === 'all' || (s === 'card' ? card : session));
    const rowHTML = (scope, e) => html`<div class="pri-row ${e.on === false ? 'off' : ''}" data-scope="${scope}" data-id="${e.id}">
        <div class="pri-top">
          <select class="input small pri-kind" data-pri="kind">${KINDS.map((k) => html`<option value="${k.key}" ${kindOf(e.kind).key === k.key ? 'selected' : ''}>${k.label}</option>`)}</select>
          <label class="pri-on" title="開關這一條"><input type="checkbox" class="switch" data-pri="on" ${e.on === false ? '' : 'checked'}></label>
          <button class="icon-btn pri-del" data-pri="del" title="刪除這一條">${icon('trash', 16)}</button>
        </div>
        <textarea class="input small pri-text" rows="2" data-pri="text" placeholder="${kindOf(e.kind).ph}">${e.text || ''}</textarea>
      </div>`;
    const secHTML = (scope) => {
      const l = listOf(scope, ctx);
      const sc = SCOPES[scope];
      return html`<section class="pri-sec" data-sec="${scope}">
        <h4 class="sec-title">${sc.label}${scope === 'card' ? `：${card.name}` : ''} <small>${sc.hint}</small></h4>
        ${l.length ? l.map((e) => rowHTML(scope, e)) : html`<p class="hint">還沒有。</p>`}
        <div class="btn-row wrap">
          <button class="btn small" data-pri="add" data-scope="${scope}">${icon('plus', 14)} 新增</button>
          <button class="btn small" data-pri="tpl" data-scope="${scope}">${icon('list', 14)} 從範本加入</button>
          ${scope === 'session' ? html`<button class="btn small" data-pri="ai-memo" data-scope="${scope}">${icon('sparkles', 14)} AI 整理要記住的事</button>` : ''}
          ${scope !== 'all' ? html`<button class="btn small" data-pri="ai-plot" data-scope="${scope}">${icon('sparkles', 14)} AI 構想劇情走向</button>` : ''}
        </div>
      </section>`;
    };
    const inner = () => html`<p class="hint">這裡寫的指示會放在每回合給 AI 的指示最後面，優先於其他規則（仍然使用分鏡格式、遵守成人內容的年齡規定）。每一條都可以單獨開關。</p>
      ${scopes.map(secHTML)}
      <p class="hint pri-status" data-pri-status></p>`;
    return TT.sheet({
      title: '優先指示',
      back,
      className: 'pri-sheet',
      body: html`<div class="pri">${inner()}</div>`,
      actions: [{ label: '完成', primary: true }],
      onMount: (el) => {
        const box = el.querySelector('.pri');
        const status = (t) => { const s = box.querySelector('[data-pri-status]'); if (s) s.textContent = t || ''; };
        const render = (focusId) => {
          box.innerHTML = String(inner());
          if (focusId) { const t = box.querySelector(`[data-id="${focusId}"] [data-pri="text"]`); if (t) t.focus(); }
        };
        const find = (row) => {
          const l = listOf(row.dataset.scope, ctx);
          return { l, i: l.findIndex((x) => x.id === row.dataset.id) };
        };
        const add = (scope, kind, text) => {
          const e = { id: TT.uid(), kind, text, on: true };
          listOf(scope, ctx).push(e);
          saveScope(scope, ctx);
          return e;
        };
        let timer = 0;
        box.addEventListener('input', (e) => {
          const row = e.target.closest('.pri-row');
          if (!row || e.target.dataset.pri !== 'text') return;
          const { l, i } = find(row);
          if (i < 0) return;
          l[i].text = e.target.value;
          clearTimeout(timer);
          timer = setTimeout(() => saveScope(row.dataset.scope, ctx), 400);
        });
        box.addEventListener('change', (e) => {
          const row = e.target.closest('.pri-row');
          if (!row) return;
          const { l, i } = find(row);
          if (i < 0) return;
          if (e.target.dataset.pri === 'kind') {
            l[i].kind = e.target.value;
            row.querySelector('[data-pri="text"]').placeholder = kindOf(l[i].kind).ph;
          } else if (e.target.dataset.pri === 'on') {
            l[i].on = e.target.checked;
            row.classList.toggle('off', !e.target.checked);
          } else if (e.target.dataset.pri === 'text') l[i].text = e.target.value;
          saveScope(row.dataset.scope, ctx);
        });
        box.addEventListener('click', async (e) => {
          const b = e.target.closest('button[data-pri]');
          if (!b) return;
          const v = b.dataset.pri;
          const scope = b.dataset.scope || (b.closest('.pri-row') && b.closest('.pri-row').dataset.scope);
          if (v === 'del') {
            const row = b.closest('.pri-row');
            const { l, i } = find(row);
            if (i < 0) return;
            if (String(l[i].text || '').trim() && !(await TT.confirm('刪除這一條指示？', { okText: '刪除', danger: true }))) return;
            l.splice(i, 1);
            saveScope(row.dataset.scope, ctx);
            return render();
          }
          if (v === 'add') {
            const kind = await TT.choose('新增哪一類？', KINDS.map((k) => ({ label: k.label, value: k.key, hint: k.hint })));
            if (!kind) return;
            return render(add(scope, kind, '').id);
          }
          if (v === 'tpl') {
            const i = await TT.choose('從範本加入', TEMPLATES.map(([k, t], n) => ({ label: t, value: String(n), hint: kindOf(k).label })), { wrap: true });
            if (i == null) return;
            const [k, t] = TEMPLATES[+i];
            add(scope, k, t);
            return render();
          }
          if (v === 'ai-memo' || v === 'ai-plot') {
            if (!(await TT.actions.ensureLLM())) return;
            b.disabled = true;
            status(v === 'ai-memo' ? 'AI 整理要記住的事中…' : 'AI 構想劇情走向中…');
            try {
              const items = await conceive(v === 'ai-memo' ? 'memo' : 'plot', { card, session: scope === 'session' ? session : null, persona });
              if (!items.length) { status('AI 沒有整理出內容，可以稍後再試。'); b.disabled = false; return; }
              if (v === 'ai-memo') {
                const have = new Set(listOf(scope, ctx).map((x) => String(x.text || '').trim()));
                const fresh = items.filter((t) => !have.has(t));
                fresh.forEach((t) => add(scope, 'memo', t));
                render();
                status(fresh.length ? `加入了 ${fresh.length} 條要記住的事，可以修改或關掉不需要的。` : '整理出來的都已經記下了。');
              } else {
                const pick = await TT.choose('選一個劇情走向', items.map((t, n) => ({ label: t, value: String(n) })), { wrap: true });
                if (pick == null) { status(''); b.disabled = false; return; }
                add(scope, 'plot', items[+pick]);
                render();
                status('已加入劇情走向，可以再修改。');
              }
            } catch (err) {
              status('沒有完成：' + TT.llm.describeError(err));
              b.disabled = false;
            }
          }
        });
      },
    });
  }

  // 遊玩前設定：優先指示、角色池與立繪、主角、特殊場景與背景，看完再開始或繼續遊玩。回傳 'go'（開始／繼續）或其他（返回）
  function prePlay(card, session = null) {
    if (!card) return Promise.resolve('');
    const persona = (session && TT.store.getPersona(session.personaId)) || TT.store.defaultPersona();
    const ctx = { card, session, persona };
    const inner = () => {
      const pool = TT.cast.pool(card);
      const turns = session ? session.messages.filter((m) => m.role === 'user').length : 0;
      const cgs = (card.cgs || []).filter((g) => g.blob).length;
      const bgs = (card.bgs || []).filter((g) => g.blob).length;
      const art = TT.authorArt.summary(card);
      const notes = TT.authorNotes.summary(card);
      const row = (k, ic, title, sub) => html`<button class="pp-row" data-pp="${k}"><span class="pp-ic">${icon(ic, 18)}</span><span class="pp-t"><b>${title}</b><small>${sub}</small></span>${icon('forward', 16)}</button>`;
      return html`<div class="pp-head"><span class="pp-cover"><img data-media="card:${card.id}" alt=""></span>
          <span class="pp-title"><b>${card.name}</b><small>${session ? `${session.title}・${turns} 回合・${TT.fmtTime(session.updatedAt)}` : '開始新故事前'}</small></span></div>
        ${row('priority', 'flag', '優先指示', summary(ctx) || '要記住的事、劇情走向、輸出方式、禁止事項（還沒有）')}
        ${row('chars', 'users', '角色池與立繪', pool.length ? `${pool.join('、')}（只有角色池裡的角色有資訊欄）` : '還沒整理登場人物')}
        ${row('charimport', 'upload', '匯入其他角色卡的角色', '把別本書或角色卡裡的角色，連同立繪與設定加進角色池')}
        ${row('hero', 'user', '主角', persona.name)}
        ${row('cgs', 'image', '特殊場景與背景', `特殊場景圖 ${cgs} 張・背景 ${bgs} 張`)}
        ${row('bgm', 'music', '這本書的配樂', (TT.bgm.names(card.id).join('、') || '還沒有') + '（每本書的配樂分開）')}
        ${art ? row('art', 'sparkles', '作者附的立繪與插圖', TT.authorArt.imported(card) ? art : `${art}，還沒匯入`) : ''}
        ${notes ? row('notes', 'book', '作者的設定與規則', notes) : ''}
        <label class="switch-row"><span><b>點存檔時先顯示這個畫面</b><small>關掉後點存檔就直接進入故事；之後可以從存檔選單的「遊玩前設定」打開</small></span><input type="checkbox" class="switch" data-pp-always ${TT.settings.story.prePlay !== false ? 'checked' : ''}></label>`;
    };
    return TT.sheet({
      title: '遊玩前設定',
      className: 'pp-sheet',
      body: html`<div class="pp">${inner()}</div>`,
      actions: [{ label: '返回', value: '' }, { label: session ? '繼續遊玩' : '開始新故事', value: 'go', primary: true }],
      onMount: (el) => {
        const box = el.querySelector('.pp');
        TT.media.hydrate(box);
        const refresh = () => { box.innerHTML = String(inner()); TT.media.hydrate(box); };
        box.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-pp]');
          if (!b) return;
          const v = b.dataset.pp;
          if (v === 'priority') await sheet({ ...ctx, back: true });
          else if (v === 'bgm') await TT.bgm.manager({ card, back: true });
          else if (v === 'art') await TT.authorArt.sheet(card, { back: true });
          else if (v === 'notes') await TT.authorNotes.sheet(card, { back: true });
          else if (v === 'charimport') await TT.charImport.intoBook(card);
          else await TT.sprites.manager(card, { tab: v, persona, back: true });
          refresh();
        });
        box.addEventListener('change', (e) => {
          if (!e.target.matches('[data-pp-always]')) return;
          TT.settings.story.prePlay = e.target.checked;
          TT.saveSettings();
        });
      },
    });
  }

  // 點存檔：設定成先顯示遊玩前設定時先看那裡，否則直接進入故事
  async function openSave(s) {
    const card = s && TT.store.getCard(s.cardId);
    if (!card) return;
    if (TT.settings.story.prePlay !== false && (await prePlay(card, s)) !== 'go') return;
    TT.router.go('/play/' + s.id);
  }

  TT.priority = { KINDS, TEMPLATES, listOf, active, promptBlock, summary, conceive, sheet };
  Object.assign(TT.actions, { prePlay, openSave });
})();
