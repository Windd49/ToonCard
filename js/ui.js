/* 共用介面元件與全域動作（匯入、開始故事、主角編輯） */
(function () {
  'use strict';
  const TT = window.TT;
  const { html, raw, icon } = { html: TT.html, raw: TT.raw, icon: (n, s, c) => TT.raw(TT.icon(n, s, c)) };

  const TABS = [
    ['feed', '/', 'compass', '探索'],
    ['library', '/library', 'library', '書架'],
    ['me', '/me', 'user', '我的'],
    ['settings', '/settings', 'settings', '設定'],
  ];

  TT.ui = {
    tabbar(active) {
      return html`<nav class="tabbar">${TABS.map(
        ([id, path, ic, label]) => html`<a class="tab ${id === active ? 'active' : ''}" href="#${path}">${icon(ic, 22)}<span>${label}</span></a>`
      )}</nav>`;
    },

    // back：true 一律顯示返回鍵；'auto' 只在從故事、詳情等頁面打開時顯示（返回上一步）
    topbar({ title, back = false, actions = '' }) {
      const showBack = back === 'auto' ? TT.router.cameFromPage() : back;
      return html`<header class="topbar">
        ${showBack ? html`<button class="icon-btn" data-act="back" aria-label="返回上一步">${icon('back', 24)}</button>` : ''}
        <h1>${title}</h1><div class="spacer"></div>${raw(String(actions))}
      </header>`;
    },

    // 名字縮寫頭像
    nameAvatar(name, size = 40, cls = '') {
      const ch = Array.from(String(name || '?').trim())[0] || '?';
      return html`<span class="avatar initials ${cls}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${TT.hashColor(name, 55, 45)}">${ch}</span>`;
    },

    // kind: card / persona / img；沒有圖時退回縮寫
    avatar({ kind, id, name, size = 40, cls = '' }) {
      if (!id) return TT.ui.nameAvatar(name, size, cls);
      return html`<span class="avatar ${cls}" style="width:${size}px;height:${size}px">${TT.ui.nameAvatar(name, size, 'fallback')}<img data-media="${kind}:${id}" alt=""></span>`;
    },

    // 依對話者找頭像
    speakerAvatar(name, ctx, size = 40) {
      const { card, persona, session } = ctx;
      if (card && card.sprites && card.sprites[name]) return TT.ui.avatar({ kind: 'sprite', id: card.id + '|' + name, name, size });
      if (card && (name === card.name || name === card.nickname)) return TT.ui.avatar({ kind: 'card', id: card.id, name, size });
      if (persona && name === persona.name) return TT.ui.avatar({ kind: 'persona', id: persona.avatar ? persona.id : '', name, size });
      const ov = session && session.castOverrides && session.castOverrides[name];
      if (ov && ov.avatarImageId) return TT.ui.avatar({ kind: 'img', id: ov.avatarImageId, name, size });
      return TT.ui.nameAvatar(name, size);
    },

    empty({ ic = 'book', title, text = '', actions = '' }) {
      return html`<div class="empty">
        <div class="empty-ic">${icon(ic, 34)}</div>
        <h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}
        <div class="empty-actions">${raw(String(actions))}</div>
      </div>`;
    },

    excerpt(card, n = 120) {
      const g = TT.engine.greetings(card)[0] || card.description || '';
      const p = TT.store.defaultPersona();
      const t = TT.macros.apply(g, { char: card.nickname || card.name, user: p ? p.name : '你', card, persona: p, vars: {} });
      return TT.truncate(TT.stripHtml(t).replace(/[*_~`#>]/g, '').replace(/\s+/g, ' ').trim(), n);
    },

    bookCount(card) {
      return [card.book, ...(card.extraBooks || [])].filter(Boolean).reduce((n, b) => n + b.entries.length, 0);
    },

    llmReady() {
      const l = TT.settings.llm;
      return !!(l.model && (l.baseUrl || l.type === 'anthropic' || l.type === 'gemini' || l.type === 'vertex'));
    },
  };

  /* ---------- 全域動作 ---------- */
  TT.actions = {
    async pickAndImport(opts = {}) {
      const files = await TT.pickFiles({ accept: '.png,.json,image/png,application/json', multiple: true });
      if (files.length) return TT.actions.importFiles(files, opts);
      return [];
    },

    async importFiles(files, { attachTo = null, navigate = true } = {}) {
      const imported = [];
      const books = [];
      const errors = [];
      // 分享的書本、遊玩檔案
      const shared = [];
      for (const f of files) {
        try {
          const d = await TT.share.readFile(f);
          if (d) { const rec = await TT.share.importData(d); if (rec) shared.push(rec); continue; }
          const r = await TT.card.parseFile(f);
          if (r.kind === 'card') {
            const rec = await TT.card.toRecord(r.card);
            await TT.store.saveCard(rec);
            imported.push(rec);
          } else books.push(r.book);
        } catch (e) {
          console.error(e);
          errors.push(`${f.name}：${e.message}`);
        }
      }
      if (books.length) {
        let target = attachTo || (imported.length === 1 ? imported[0] : null);
        if (!target && TT.store.cards.length) {
          const id = await TT.choose(`要把世界書「${books.map((b) => b.name).join('、')}」附加到哪個故事？`, TT.store.cards.slice(0, 30).map((c) => ({ label: c.name, value: c.id, icon: 'book' })));
          target = id ? TT.store.getCard(id) : null;
        }
        if (target) {
          target.extraBooks = (target.extraBooks || []).concat(books);
          await TT.store.saveCard(target);
          TT.toast(`已將 ${books.length} 本世界書附加到「${target.name}」`, { icon: 'book' });
        } else if (!imported.length) TT.toast('世界書需要附加到一個故事上，請先匯入角色卡', { type: 'error' });
      }
      if (imported.length) {
        TT.achv.unlock('first_import');
        if (TT.store.cards.length >= 10) TT.achv.unlock('collector');
        TT.toast(imported.length === 1 ? `已匯入「${imported[0].name}」` : `已匯入 ${imported.length} 張角色卡`, { icon: 'check', type: 'ok' });
      }
      if (errors.length) TT.sheet({ title: '部分檔案無法匯入', body: html`<ul class="err-list">${errors.map((e) => html`<li>${e}</li>`)}</ul>`, actions: [{ label: '知道了', primary: true }] });
      if (navigate && imported.length === 1) TT.router.go('/card/' + imported[0].id);
      else if (navigate && !imported.length && shared.length === 1) TT.router.go('/card/' + shared[0].id);
      return [...imported, ...shared];
    },

    // 存檔選單（書架的「繼續遊玩」、作品頁的存檔列表共用）：回傳做了什麼（'go'／'rename'／'del'…）
    async sessionMenu(s) {
      const c = TT.store.getCard(s.cardId);
      const v = await TT.choose(`${c ? c.name + '・' : ''}${s.title}`, [
        { label: '繼續遊玩', value: 'go', icon: 'play' },
        ...(c ? [{ label: '遊玩前設定（優先指示、角色池、主角）', value: 'preplay', icon: 'flag' }] : []),
        { label: '重新命名', value: 'rename', icon: 'edit' },
        { label: '複製成新的存檔', value: 'copy', icon: 'branch' },
        ...(c ? [{ label: '匯出遊玩檔案（分享給別人或換電腦）', value: 'share', icon: 'download' }, { label: '作品設定（角色、立繪、場景）', value: 'settings', icon: 'image' }, { label: '故事詳情', value: 'detail', icon: 'info' }] : []),
        { label: '刪除存檔', value: 'del', icon: 'trash', danger: true },
      ]);
      if (v === 'go') TT.router.go('/play/' + s.id);
      else if (v === 'preplay') { if ((await TT.actions.prePlay(c, s)) === 'go') { TT.router.go('/play/' + s.id); return 'go'; } }
      else if (v === 'detail') TT.router.go('/card/' + s.cardId);
      else if (v === 'share') await TT.share.exportSheet(c, { sessionIds: [s.id] });
      else if (v === 'settings') await TT.sprites.manager(c, { persona: TT.store.getPersona(s.personaId) });
      else if (v === 'rename') {
        const t = await TT.promptText('存檔名稱', s.title);
        if (!t || !t.trim()) return null;
        s.title = t.trim();
        await TT.store.saveSession(s, true);
      } else if (v === 'copy') {
        const card = TT.store.getCard(s.cardId);
        const persona = TT.store.getPersona(s.personaId) || TT.store.defaultPersona();
        if (!card) return null;
        await TT.engine.branch({ session: s, card, persona }, s.messages.length - 1);
        TT.toast('已複製成新的存檔', { icon: 'branch' });
      } else if (v === 'del') {
        if (!(await TT.confirm(`刪除存檔「${s.title}」？場景圖也會一併刪除。`, { danger: true, okText: '刪除' }))) return null;
        await TT.store.deleteSession(s.id);
      }
      return v;
    },

    async importChubUrl() {
      const text = await TT.promptText('從 chub.ai 匯入', '', { placeholder: 'https://chub.ai/characters/作者/角色', hint: '在 chub.ai 打開角色頁面，複製網址貼在這裡。', okText: '匯入' });
      if (!text) return null;
      const path = TT.chub.parsePath(text);
      if (!path) { TT.toast('看不懂這個網址，請貼上 chub.ai 的角色頁面網址', { type: 'error' }); return null; }
      TT.toast('正在從 chub.ai 下載…', { icon: 'download' });
      try {
        const card = await TT.chub.importCard({ fullPath: path });
        TT.toast(`已加入書架：${card.name}`, { icon: 'check', type: 'ok' });
        TT.router.go('/card/' + card.id);
        return card;
      } catch (e) {
        TT.toast(TT.llm.describeError(e), { type: 'error', duration: 5000 });
        return null;
      }
    },

    async ensureLLM() {
      if (TT.ui.llmReady()) return true;
      const go = await TT.sheet({
        title: '還差一步：選擇文字模型',
        body: html`<p class="sheet-msg">故事需要一個文字模型來演出角色。</p>
          <ul class="sheet-list">
            <li><b>免費試玩</b>：使用 Pollinations 的免費模型（免金鑰、不用註冊），文字與場景圖都能用，但速度較慢、文筆普通。</li>
            <li><b>自己的 API</b>：DeepSeek、Gemini、Claude、OpenRouter、各種中轉站或本機模型，品質與速度都更好。</li>
          </ul>`,
        actions: [{ label: '設定自己的 API', value: 'settings' }, { label: '免費試玩', value: 'free', primary: true }],
      });
      if (go === 'free') { TT.actions.useFreeTrial(); return true; }
      if (go === 'settings') TT.router.go('/settings');
      return false;
    },

    // 切換到 Pollinations 免費模型；原本的金鑰依服務商分開保存，不會送到別的服務
    useFreeTrial() {
      TT.actions.applyPreset('pollinations');
      const im = TT.settings.image;
      if (!im.backend || im.backend === 'none') Object.assign(im, { backend: 'pollinations', baseUrl: '', model: '', apiKey: '' });
      TT.saveSettings();
      TT.toast('已切換為免費試玩模型（Pollinations）', { icon: 'check', type: 'ok' });
    },

    // 每個服務商各自記住網址、模型與金鑰，切換時互不覆蓋
    applyPreset(name) {
      const l = TT.settings.llm;
      const pr = TT.llm.PRESETS[name];
      if (!pr) return;
      l.saved = l.saved || {};
      if (l.preset) l.saved[l.preset] = { apiKey: l.apiKey || '', baseUrl: l.baseUrl || '', model: l.model || '', extraBody: l.extraBody || '' };
      const sv = l.saved[name] || {};
      l.preset = name;
      l.type = pr.type;
      l.baseUrl = sv.baseUrl || pr.baseUrl || '';
      l.model = sv.model || pr.model || '';
      l.apiKey = pr.free ? '' : sv.apiKey || '';
      l.extraBody = sv.extraBody != null && sv.extraBody !== '' ? sv.extraBody : pr.extraBody || '';
      if (pr.maxTokens) l.maxTokens = Math.max(+l.maxTokens || 0, pr.maxTokens);
      TT.saveSettings();
    },

    // 遊玩前先畫好主要角色的立繪與各種表情；可以選擇先開始、在背景繼續
    async prepareSprites(card) {
      const st = TT.settings.image;
      if (!st.portraits || !st.preExpr || !TT.img.exprEnabled()) return;
      const name = card.nickname || card.name;
      if (TT.img.hasExprSet(card, name)) return;
      let tags = card.appearance;
      if (!tags && (card.generatedCover || !card.avatar) && TT.ui.llmReady()) {
        try {
          tags = await TT.engine.generateAppearance(name, [card.description, card.personality].join('\n'));
          card.appearance = tags;
          await TT.store.saveCard(card);
        } catch (e) { console.warn('外貌標籤產生失敗', e); }
      }
      const job = TT.img.enqueuePortrait(card, name, tags || '');
      if (!job || job === true) return;
      const total = TT.sprites.kinds(card, name).length;
      let off = () => {};
      const res = await TT.sheet({
        title: '準備角色立繪',
        dismissable: false,
        body: html`<p class="sheet-msg">正在為「${name}」生成立繪與 ${total} 種表情、動作，完成後自動開始故事。</p>
          <div class="prep-bar"><i style="width:0%"></i></div>
          <p class="prep-text">0 / ${total}</p>
          <p class="hint prep-wait"></p>
          <div class="btn-row"><button class="btn small" data-prep="pause">${icon('pause', 14)} 暫停</button><button class="btn small danger" data-prep="stop">${icon('stop', 14)} 停止</button></div>
          <div class="prep-thumbs"></div>`,
        actions: [{ label: '先開始，背景繼續畫', value: 'skip' }],
        onMount: (el, close) => {
          const bar = el.querySelector('.prep-bar i');
          const text = el.querySelector('.prep-text');
          const wait = el.querySelector('.prep-wait');
          const thumbs = el.querySelector('.prep-thumbs');
          const pauseBtn = el.querySelector('[data-prep="pause"]');
          const syncPause = () => {
            const p = job.ctl.paused;
            pauseBtn.innerHTML = TT.icon(p ? 'play' : 'pause', 14) + (p ? ' 繼續' : ' 暫停');
            if (p) wait.textContent = job.inflight ? '畫完目前這張後暫停…' : '已暫停';
          };
          el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-prep]');
            if (!b) return;
            if (b.dataset.prep === 'pause') { if (job.ctl.paused) TT.img.resumeJob(job); else TT.img.pauseJob(job); syncPause(); }
            if (b.dataset.prep === 'stop') { TT.img.cancelJob(job); close('stop'); }
          });
          const offWait = TT.bus.on('img:wait', ({ sec }) => { wait.textContent = `圖像服務忙線中（每分鐘能畫的張數有限），約 ${sec} 秒後自動重試…`; });
          const offTasks = TT.bus.on('tasks:changed', syncPause);
          const offUpdate = TT.bus.on('img:update', async (d) => {
            if (d.kind !== 'portrait' || d.cardId !== card.id || d.name !== name) return;
            wait.textContent = '';
            const n = d.done || 0;
            bar.style.width = Math.round((n / (d.total || total)) * 100) + '%';
            text.textContent = d.status === 'error' ? '生成失敗：' + (d.error || '') : `${n} / ${d.total || total}${d.expr ? `・${d.expr}` : ''}`;
            if (d.expr) {
              const u = await TT.media.url('sprite', `${card.id}|${name}|${d.expr}`);
              if (u) thumbs.insertAdjacentHTML('beforeend', String(html`<figure><img src="${u}" alt=""><figcaption>${d.expr}</figcaption></figure>`));
            }
            if (d.status === 'done') setTimeout(() => close('done'), 500);
            if (d.status === 'error') setTimeout(() => close('error'), 2500);
            if (d.status === 'cancelled') close('stop');
            // 暫停前已送出的那張畫完時還會更新一次進度，暫停的提示要留著
            syncPause();
          });
          off = () => { offWait(); offUpdate(); offTasks(); };
        },
      });
      off();
      if (res === 'error') TT.toast('立繪沒有畫完，會先用角色卡圖片演出', { type: 'error', duration: 4000 });
      if (res === 'stop') TT.toast('已停止生成立繪，可以之後到「立繪與特殊場景圖」繼續');
    },

    // 第一次開演前，從角色卡整理這個作品的主要登場人物（只需要一次；可以略過，會在背景繼續）
    async prepareCast(card) {
      if (card.castListAt || !TT.ui.llmReady()) return;
      const job = TT.cast.ensure(card);
      const sheet = TT.sheet({
        title: '整理登場人物',
        dismissable: false,
        body: html`<p class="sheet-msg">第一次開演前，先從角色卡整理出這個作品的主要角色（名字、別名、關係、資訊、外貌）。之後劇情、立繪與角色狀態都用同一份名單，同一個角色不會因為叫法不同變成好幾個人。</p>
          <div class="prep-bar indet"><i></i></div><p class="hint">只需要一次，可以在「作品設定 → 角色」修改。</p>`,
        actions: [{ label: '略過，先開始', value: 'skip' }],
      });
      const r = await Promise.race([job.then(() => 'done'), sheet]);
      if (r === 'done') sheet.close('done');
      else TT.toast('登場人物會在背景繼續整理');
    },

    async startStory(card, { personaId, greetingIndex = 0 } = {}) {
      const persona = TT.store.getPersona(personaId) || TT.store.defaultPersona();
      await TT.actions.prepareCast(card);
      await TT.actions.prepareSprites(card);
      const s = await TT.engine.createSession(card, persona, greetingIndex);
      TT.router.go('/play/' + s.id);
      return s;
    },

    async resumeOrStart(card) {
      const list = await TT.store.sessionsForCard(card.id);
      if (list.length) return TT.router.go('/play/' + list[0].id);
      return TT.actions.startStory(card);
    },

    // 主角編輯面板；回傳儲存後的主角或 null
    async editPersona(persona) {
      const isNew = !persona;
      const p = persona ? { ...persona } : { id: TT.uid(), name: '', description: '', appearance: '', avatar: null };
      let avatarBlob = p.avatar;
      let avatarUrl = avatarBlob ? URL.createObjectURL(avatarBlob) : '';
      const body = html`
        <div class="persona-form">
          <div class="pf-avatar">
            <button class="pf-pic" data-pf="pick">${avatarUrl ? html`<img src="${avatarUrl}" alt="">` : icon('user', 36)}</button>
            <div class="pf-pic-actions">
              <button class="btn small" data-pf="pick">${icon('upload', 16)} 上傳</button>
              <button class="btn small" data-pf="gen">${icon('sparkles', 16)} AI 生成</button>
              <button class="btn small" data-pf="import" title="用別本書或角色卡裡的角色當主角（名字、設定、外貌、頭像與立繪）">${icon('users', 16)} 從角色卡匯入</button>
            </div>
          </div>
          <label class="field"><span>主角名字（{{user}}）</span><input class="input" data-pf-name value="${p.name}" placeholder="例如：林遙"></label>
          <label class="field"><span>主角設定（身分、性格、背景，會提供給 AI）</span><textarea class="input" rows="4" data-pf-desc placeholder="例如：剛搬到這座城市的大學生，好奇心旺盛，怕狗。">${p.description}</textarea></label>
          <label class="field"><span>外貌標籤（英文，用於畫面與頭像）</span>
            <div class="row"><input class="input" data-pf-app value="${p.appearance}" placeholder="1boy, short black hair, hoodie…"><button class="btn small" data-pf="app">${icon('wand', 16)}</button></div>
          </label>
          <label class="check"><input type="checkbox" data-pf-default ${TT.settings.ui.defaultPersona === p.id ? 'checked' : ''}> 設為預設主角</label>
        </div>`;
      const actions = [];
      if (!isNew && TT.store.personas.length > 1) actions.push({ label: '刪除', value: 'delete', danger: true });
      actions.push({ label: '取消', value: null }, { label: '儲存', value: 'save', primary: true, onClick: (el) => {
        if (!el.querySelector('[data-pf-name]').value.trim()) { TT.toast('請輸入主角名字', { type: 'error' }); return false; }
      } });
      let formEl = null;
      // 從角色卡匯入時，儲存後把那個角色的立繪補到主角身上
      let spriteFrom = null;
      const res = await TT.sheet({
        title: isNew ? '建立主角' : '編輯主角',
        body,
        actions,
        onMount: (el) => {
          formEl = el;
          const setPic = (blob) => {
            avatarBlob = blob;
            if (avatarUrl) URL.revokeObjectURL(avatarUrl);
            avatarUrl = blob ? URL.createObjectURL(blob) : '';
            el.querySelector('.pf-pic').innerHTML = avatarUrl ? `<img src="${avatarUrl}" alt="">` : TT.icon('user', 36);
          };
          el.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-pf]');
            if (!b) return;
            const act = b.dataset.pf;
            if (act === 'pick') {
              const [f] = await TT.pickFiles({ accept: 'image/*' });
              if (f) setPic(await TT.resizeImageBlob(f, 768, 'image/png'));
            } else if (act === 'import') {
              const d = await TT.charImport.personaData();
              if (!d) return;
              el.querySelector('[data-pf-name]').value = d.name;
              el.querySelector('[data-pf-desc]').value = d.description;
              el.querySelector('[data-pf-app]').value = d.appearance;
              if (d.avatar) setPic(d.avatar);
              spriteFrom = d.from;
              TT.toast(`已填入「${d.name}」的資料${d.from ? '，按「儲存」時會一起匯入立繪' : ''}，可以再修改`);
            } else if (act === 'app') {
              if (!(await TT.actions.ensureLLM())) return;
              b.disabled = true;
              try {
                const name = el.querySelector('[data-pf-name]').value || '主角';
                el.querySelector('[data-pf-app]').value = await TT.engine.generateAppearance(name, el.querySelector('[data-pf-desc]').value);
              } catch (err) { TT.toast(TT.llm.describeError(err), { type: 'error' }); }
              b.disabled = false;
            } else if (act === 'gen') {
              if (!TT.img.enabled()) { TT.toast('請先在設定中選擇圖像生成服務', { type: 'error' }); return; }
              const app = el.querySelector('[data-pf-app]').value.trim();
              if (!app) { TT.toast('請先填寫外貌標籤（可按旁邊的魔杖自動生成）'); return; }
              b.disabled = true;
              b.innerHTML = TT.icon('sparkles', 16) + ' 生成中…';
              try {
                const [w, h] = TT.img.dims({ ...TT.settings.image, aspect: 'square' });
                const out = await TT.img.generate({ positive: [TT.img.styleText(null), app, 'portrait, upper body, looking at viewer, simple background'].filter(Boolean).join(', '), negative: TT.settings.image.negative, width: w, height: h, seed: Math.floor(Math.random() * 1e9), refs: [] });
                if (out instanceof Blob) setPic(await TT.resizeImageBlob(out, 768, 'image/png'));
                else TT.toast('圖片無法下載保存（跨域限制）', { type: 'error' });
              } catch (err) { TT.toast('頭像生成失敗：' + err.message, { type: 'error' }); }
              b.disabled = false;
              b.innerHTML = TT.icon('sparkles', 16) + ' AI 生成';
            }
          });
        },
      });
      if (avatarUrl) setTimeout(() => URL.revokeObjectURL(avatarUrl), 1000);
      if (res === 'delete') {
        if (await TT.confirm(`刪除主角「${p.name}」？使用此主角的存檔會改用預設主角。`, { danger: true, okText: '刪除' })) await TT.store.deletePersona(p.id);
        return null;
      }
      if (res !== 'save' || !formEl) return null;
      p.name = formEl.querySelector('[data-pf-name]').value.trim();
      p.description = formEl.querySelector('[data-pf-desc]').value.trim();
      p.appearance = formEl.querySelector('[data-pf-app]').value.trim();
      p.avatar = avatarBlob || null;
      const makeDefault = formEl.querySelector('[data-pf-default]').checked;
      await TT.store.savePersona(p);
      if (spriteFrom && TT.sprites.fillSprites(spriteFrom.owner, spriteFrom.name, p, p.name)) await TT.store.savePersona(p);
      if (makeDefault) { TT.settings.ui.defaultPersona = p.id; TT.saveSettings(); }
      if (isNew) TT.achv.unlock('persona');
      return p;
    },
  };

  /* ---------- 橫向捲動列：電腦的滑鼠也能左右滑 ---------- */
  // 序章、主角、繼續遊玩、排序標籤、分頁這些橫向列，手機用手指滑；電腦的滾輪只會上下捲、捲軸又藏起來，所以網頁版滑不動。
  // 滑鼠移到這種列上時滾輪改成左右捲（捲到頭再交還給頁面），也可以按住拖曳
  const sideways = (el) => {
    for (let x = el instanceof Element ? el : null; x && x !== document.body; x = x.parentElement) {
      // 只管左右有東西可捲、上下沒有的列（overflow-x: auto 時 overflow-y 也會算成 auto，所以看實際高度）
      if (x.scrollWidth <= x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1) continue;
      if (/(auto|scroll)/.test(getComputedStyle(x).overflowX)) return x;
    }
    return null;
  };
  // 捲動時暫停吸附，免得每捲一下就被拉回卡片邊緣
  const free = (el) => {
    el.classList.add('hs-free');
    clearTimeout(el.__hsT);
    el.__hsT = setTimeout(() => el.classList.remove('hs-free'), 250);
  };
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const el = sideways(e.target);
    if (!el) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
    const max = el.scrollWidth - el.clientWidth;
    if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
    e.preventDefault();
    free(el);
    el.scrollLeft += dy;
  }, { passive: false });
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const el = sideways(e.target);
    if (el) drag = { el, id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      drag.el.classList.add('hs-drag');
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
    free(drag.el);
    drag.el.scrollLeft = drag.left - dx;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    d.el.classList.remove('hs-drag');
    // 拖曳後放開滑鼠不算點了一下（不會選到序章、打開存檔）
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
})();
