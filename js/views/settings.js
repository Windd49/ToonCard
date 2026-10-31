/* 設定：文字模型、圖像生成、劇情、聲音、網路、資料備份 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));
  const get = (p) => TT.getPath(TT.settings, p);
  const val = (p) => { const v = get(p); return v == null ? '' : v; };

  const F = {
    text: (p, label, o = {}) => html`<label class="field"><span>${label}</span><input class="input" type="${o.type || 'text'}" data-bind="${p}" value="${val(p)}" placeholder="${o.ph || ''}" ${o.list ? html`list="${o.list}"` : ''} autocomplete="off" spellcheck="false">${o.hint ? html`<small class="hint">${o.hint}</small>` : ''}</label>`,
    secret: (p, label, o = {}) => html`<label class="field"><span>${label}</span><div class="row"><input class="input" type="password" data-bind="${p}" value="${val(p)}" placeholder="${o.ph || ''}" autocomplete="off" spellcheck="false"><button class="icon-btn" data-act="reveal" type="button" title="顯示／隱藏">${icon('eye', 18)}</button></div>${o.hint ? html`<small class="hint">${o.hint}</small>` : ''}</label>`,
    number: (p, label, o = {}) => html`<label class="field"><span>${label}</span><input class="input" type="number" data-bind="${p}" data-num value="${val(p)}" min="${o.min != null ? o.min : ''}" max="${o.max != null ? o.max : ''}" step="${o.step || 1}">${o.hint ? html`<small class="hint">${o.hint}</small>` : ''}</label>`,
    select: (p, label, opts, o = {}) => html`<label class="field"><span>${label}</span><select class="input" data-bind="${p}" ${o.act ? html`data-rerender="1"` : ''}>${opts.map(([v, l]) => html`<option value="${v}" ${String(val(p)) === String(v) ? 'selected' : ''}>${l}</option>`)}</select>${o.hint ? html`<small class="hint">${o.hint}</small>` : ''}</label>`,
    toggle: (p, label, hint = '') => html`<label class="switch-row"><span><b>${label}</b>${hint ? html`<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" data-bind="${p}" ${get(p) ? 'checked' : ''}></label>`,
    area: (p, label, o = {}) => html`<label class="field"><span>${label}</span><textarea class="input mono" rows="${o.rows || 4}" data-bind="${p}" placeholder="${o.ph || ''}" spellcheck="false">${val(p)}</textarea>${o.hint ? html`<small class="hint">${o.hint}</small>` : ''}</label>`,
    range: (p, label, min, max, step, fmt = (v) => v) => html`<label class="field"><span>${label}：<b data-range-out="${p}">${fmt(val(p))}</b></span><input type="range" data-bind="${p}" data-num min="${min}" max="${max}" step="${step}" value="${val(p)}"></label>`,
  };

  // 圖像、語音、向量等不是聊天用的模型
  const IMAGE_MODEL = /image|banana|imagen|veo|tts|embedding|audio/i;

  const S = (TT.views.settings = {
    async mount(el) {
      S.el = el;
      S.autoFetched = false;
      S.render();
      el.addEventListener('input', S.onInput);
      el.addEventListener('change', S.onChange);
      el.addEventListener('click', S.onClick);
      if (TT.tts.supported && !TT.tts.voices().length) setTimeout(() => S.el && S.renderSection('audio'), 900);
    },
    unmount() { S.el = null; },

    render() {
      S.el.innerHTML = String(html`<div class="view settings">
        ${TT.ui.topbar({ title: '設定', back: 'auto' })}
        <div class="view-body">
          ${!TT.ui.llmReady() ? html`<div class="notice">${icon('info', 18)}<span>先設定「文字模型」才能開始故事。沒有 API 的話，可以先用免費試玩模型（文字與場景圖都免金鑰）。<br><button class="btn small primary" data-act="freetrial" style="margin-top:8px">${icon('bolt', 14)} 一鍵使用免費試玩</button></span></div>` : ''}
          <section class="card-sec" data-sec="llm">${S.llmSection()}</section>
          <section class="card-sec" data-sec="chub">${S.chubSection()}</section>
          <section class="card-sec" data-sec="image">${S.imageSection()}</section>
          <section class="card-sec" data-sec="usage">${S.usageSection()}</section>
          <section class="card-sec" data-sec="story">${S.storySection()}</section>
          <section class="card-sec" data-sec="audio">${S.audioSection()}</section>
          <section class="card-sec" data-sec="net">${S.netSection()}</section>
          <section class="card-sec" data-sec="data">${S.dataSection()}</section>
          <p class="about">漫劇卡 ToonCard v1.0・所有資料（含 API 金鑰）只存在這個瀏覽器中。</p>
        </div>
        ${TT.ui.tabbar('settings')}
      </div>`);
    },

    renderSection(name) {
      const sec = S.el && S.el.querySelector(`[data-sec="${name}"]`);
      if (!sec) return;
      sec.innerHTML = String(S[name + 'Section']());
    },

    llmSection() {
      const presets = Object.entries(TT.llm.PRESETS).map(([k, v]) => [k, v.label]);
      const type = TT.settings.llm.type;
      if (type === 'vertex') setTimeout(() => S.checkVertex(), 0);
      return html`<h3 class="sec-title">${icon('chat', 18)} 文字模型（演出角色）</h3>
        ${F.select('llm.preset', '服務商預設', presets, { act: true })}
        ${F.select('llm.type', 'API 類型', [['openai', 'OpenAI 相容（/chat/completions）'], ['gemini', 'Google Gemini 原生（generateContent）'], ['vertex', 'Google Vertex AI（經本機伺服器）'], ['anthropic', 'Anthropic 原生（/messages）']], { act: true })}
        ${type === 'gemini' || type === 'vertex' ? F.select('llm.safety', 'Gemini 安全過濾（Safety Settings）', [['OFF', '關閉（OFF）'], ['BLOCK_NONE', '不封鎖（BLOCK_NONE）'], ['default', 'Google 預設值']], { hint: '關閉後由你自行負責內容；Google 仍保留無法關閉的基本過濾。' }) : ''}
        ${type === 'vertex' ? html`
          ${F.text('llm.location', 'Vertex AI 地區', { ph: 'global', list: 'vertex-locs', hint: 'global 最多模型可用；也可填 us、eu 或 us-central1 等單一區域。' })}
          <datalist id="vertex-locs"><option value="global"><option value="us"><option value="eu"><option value="us-central1"><option value="asia-northeast1"><option value="europe-west4"></datalist>
          <p class="hint vertex-status" data-vertex-status>正在檢查本機伺服器的 Google Cloud 金鑰…</p>` : html`
          ${F.text('llm.baseUrl', 'API 網址', { ph: 'https://api.example.com/v1', hint: '與 SillyTavern 的「自訂 OpenAI 相容」填法相同；只填網域時會自動補上 /v1。' })}
          ${F.secret('llm.apiKey', 'API 金鑰', { ph: 'sk-…' })}`}
        ${S.modelField('llm.model', S.modelList().filter((m) => !IMAGE_MODEL.test(m)), { ph: '例如 deepseek-chat' })}
        ${F.select('llm.thinking', '思考程度', [['auto', '自動（模型預設）'], ['off', '關閉／盡量少'], ['low', '低（較快）'], ['medium', '中'], ['high', '高（較仔細、較慢）']], { hint: type === 'anthropic' ? 'Anthropic 原生 API 不使用這個設定。' : '思考會占用「單次回覆上限」並計費。gemini-4-argon 不能完全關閉思考，選「關閉」會用最低等級；模型不支援某種設定時會自動改用可用的。' })}
        ${type !== 'anthropic' ? F.toggle('llm.showThoughts', '生成時顯示思考摘要', '等待時顯示模型目前在想什麼（Gemini 的思考摘要）') : ''}
        <div class="grid2">
          ${F.number('llm.maxTokens', '單次回覆上限（tokens）', { min: 256, max: 64000, step: 256 })}
          ${F.number('llm.contextSize', '上下文長度（tokens）', { min: 2048, max: 2000000, step: 1024 })}
        </div>
        <div class="grid2">
          ${F.text('llm.temperature', '溫度（留空＝模型預設）', { ph: '例如 0.9' })}
          ${F.text('llm.topP', 'Top P（留空＝模型預設）', { ph: '例如 0.95' })}
        </div>
        ${F.toggle('llm.stream', '串流輸出', '邊生成邊顯示，建議開啟')}
        <details class="adv"><summary>進階</summary>
          ${F.area('llm.extraBody', '額外請求參數（JSON，會合併到請求內容）', { rows: 3, ph: '{"top_p": 0.95}' })}
        </details>
        <div class="btn-row"><button class="btn primary" data-act="testllm">${icon('bolt', 16)} 測試連線</button></div>`;
    },

    // 取過的模型清單依服務記在設定裡，下次打開就能直接從下拉選單挑
    modelList() {
      const l = TT.settings.llm;
      const list = (l.modelLists || {})[TT.llm.listKey(l)] || [];
      if (l.type === 'vertex' && !list.length && !S.autoFetched) {
        S.autoFetched = true;
        setTimeout(() => S.fetchModels(true), 0);
      }
      return list;
    },

    async fetchModels(quiet = false) {
      try {
        const list = await TT.llm.listModels();
        const l = TT.settings.llm;
        l.modelLists = { ...(l.modelLists || {}), [TT.llm.listKey(l)]: list };
        TT.saveSettings();
        S.renderSection('llm');
        S.renderSection('image');
        if (!quiet) TT.toast(`找到 ${list.length} 個模型`);
      } catch (err) {
        if (!quiet) TT.toast('取得模型列表失敗：' + TT.llm.describeError(err), { type: 'error', duration: 5000 });
      }
    },

    // 有清單時用下拉選單，也可以選「自訂」直接輸入名稱
    modelField(p, list, { label = '模型', ph = '', hint = '' } = {}) {
      const v = String(val(p));
      const opts = !v || list.includes(v) ? list : [v, ...list];
      return html`<label class="field"><span>${label}</span>
        ${opts.length ? html`<div class="row"><select class="input" data-model-pick="${p}">${opts.map((m) => html`<option value="${m}" ${m === v ? 'selected' : ''}>${m}</option>`)}<option value="__custom">自訂（直接輸入）…</option></select><button class="btn small" data-act="models" title="重新取得模型列表">${icon('refresh', 16)}</button></div>` : ''}
        <div class="row" ${opts.length ? html`data-model-custom="${p}" hidden` : ''}><input class="input" data-bind="${p}" value="${v}" placeholder="${ph}" autocomplete="off" spellcheck="false">${opts.length ? '' : html`<button class="btn small" data-act="models">${icon('list', 16)} 取得列表</button>`}</div>
        ${hint ? html`<small class="hint">${hint}</small>` : ''}</label>`;
    },

    // Vertex AI 的金鑰在本機伺服器上，這裡只顯示它找到的專案與金鑰檔名
    async checkVertex() {
      const el = S.el && S.el.querySelector('[data-vertex-status]');
      if (!el) return;
      const s = await TT.llm.vertexStatus();
      if (!el.isConnected) return;
      el.textContent = s.ok ? `已連上 Google Cloud：專案 ${s.project}（金鑰檔 ${s.file}）。金鑰只留在這台電腦，不會存進瀏覽器。` : s.error;
      el.classList.toggle('err', !s.ok);
    },

    usageSection() {
      setTimeout(() => S.renderUsage(true), 0);
      const r = TT.settings.usage.range || 'month';
      return html`<h3 class="sec-title">${icon('coin', 18)} 用量與費用估算</h3>
        <div class="usage-range">${[['today', '今天'], ['month', '本月'], ['all', '全部']].map(([k, l]) => html`<button class="chip ${k === r ? 'active' : ''}" data-act="usagerange" data-range="${k}">${l}</button>`)}</div>
        <div class="usage-table" data-usage-table><p class="hint">統計中…</p></div>
        <details class="adv"><summary>單價設定（美元／每百萬 token）</summary>
          <div class="usage-prices" data-usage-prices></div>
          <p class="hint">預設是 2026 年 10 月第三方整理的公開價：gemini-4-argon 輸入 $2、輸出 $10（12/1 起約 $4／$20）；gemini-3.8-flash $0.75／$3.75（2027/1/1 起約 $1.5／$7.5）；gemini-nano-banana-2.1 輸入 $1.5、文字與思考 $7.5、圖片輸出 $30（一張 1K 圖約 $0.034）。實際費用以 Google Cloud 帳單為準。</p>
        </details>
        <p class="hint">只記錄這個瀏覽器發出的請求；思考 token 按輸出價計算。</p>
        <div class="btn-row"><button class="btn small" data-act="usagereset">${icon('trash', 16)} 清除統計</button></div>`;
    },

    async renderUsage(withPrices) {
      const box = S.el && S.el.querySelector('[data-usage-table]');
      if (!box) return;
      const { rows, total } = await TT.usage.summary(TT.settings.usage.range || 'month');
      const n = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : String(v));
      const usd = (c) => '$' + (c > 0 && c < 0.01 ? c.toFixed(4) : c.toFixed(2));
      box.innerHTML = rows.length
        ? String(html`<table><thead><tr><th>模型</th><th>次數</th><th>輸入</th><th>輸出</th><th>思考</th><th>圖片</th><th>估計</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr><td>${r.model}</td><td>${r.req}</td><td>${n(r.in)}</td><td>${n(Math.max(0, r.out - r.imgTok))}</td><td>${n(r.think)}</td><td>${r.img || ''}</td><td>${usd(r.cost)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="6">合計</td><td>${usd(total)}</td></tr></tfoot></table>`)
        : String(html`<p class="hint">還沒有紀錄。之後每次呼叫模型的 token 數與圖片數都會記在這裡。</p>`);
      if (!withPrices) return;
      const pbox = S.el.querySelector('[data-usage-prices]');
      const models = [...new Set([...Object.keys(TT.usage.DEFAULT_PRICES), ...rows.map((r) => r.model), TT.settings.llm.model, TT.settings.image.model].filter(Boolean))];
      const own = TT.settings.usage.prices || {};
      pbox.innerHTML = models.map((m) => {
        const d = TT.usage.DEFAULT_PRICES[m] || {};
        const f = (k, label) => html`<label><small>${label}</small><input class="input small" type="number" min="0" step="0.01" data-price="${m}|${k}" value="${own[m] && own[m][k] != null ? own[m][k] : ''}" placeholder="${d[k] != null ? d[k] : '0'}"></label>`;
        return String(html`<div class="usage-price"><b>${m}</b>${f('in', '輸入')}${f('out', '輸出')}${f('img', '圖片')}</div>`);
      }).join('');
    },

    chubSection() {
      return html`<h3 class="sec-title">${icon('compass', 18)} 角色卡來源（chub.ai）</h3>
        <p class="hint" style="margin-bottom:12px">「探索」分頁直接瀏覽 chub.ai 公開角色卡，點「開始故事」即自動下載完整角色卡（含世界書）到書架。</p>
        <div class="grid2">
          ${F.select('chub.sort', '預設排序', TT.chub.SORTS)}
          ${F.select('chub.lang', '角色卡語言', TT.chub.LANGS)}
        </div>
        ${F.toggle('chub.nsfw', '顯示成人內容（NSFW）', '僅限已成年者；預設關閉')}`;
    },

    imageSection() {
      const st = TT.settings.image;
      const b = st.backend;
      const backends = Object.entries(TT.img.BACKENDS).map(([k, v]) => [k, v.label]);
      const styles = Object.entries(TT.img.STYLES).map(([k, v]) => [k, v.label]);
      const fields = [];
      const imgModels = (b === 'gemini' || b === 'vertex') ? S.modelList().filter((m) => /image|banana/i.test(m)) : [];
      // 圖像也有自己的安全過濾（預設關閉，包含 Vertex 針對圖片的類別）
      const imgSafety = F.select('image.safety', '圖像安全過濾（Safety Settings）', [['OFF', '關閉（OFF）'], ['BLOCK_NONE', '不封鎖（BLOCK_NONE）'], ['default', 'Google 預設值']], { hint: '和文字模型分開設定。關閉後由你自行負責內容；Google 仍保留無法關閉的基本過濾（例如回覆 IMAGE_SAFETY）。' });
      if (b === 'gemini') {
        fields.push(
          S.modelField('image.model', imgModels, { label: '圖像模型', ph: 'gemini-nano-banana-2.1', hint: '能看參考圖的 Gemini 圖像模型，用來畫立繪、表情與特殊場景圖。' }),
          F.secret('image.apiKey', 'Gemini 金鑰（留空＝沿用文字模型的 Gemini 金鑰）'),
          F.text('image.baseUrl', 'API 網址（留空＝官方）', { ph: 'https://generativelanguage.googleapis.com/v1beta' }),
          imgSafety
        );
      } else if (b === 'vertex') {
        fields.push(
          S.modelField('image.model', imgModels, { label: '圖像模型', ph: 'gemini-nano-banana-2.1', hint: '能看參考圖的 Gemini 圖像模型，用來畫立繪、表情與特殊場景圖。用本機伺服器的 Google Cloud 金鑰，不用另外填金鑰。' }),
          F.text('image.location', 'Vertex AI 地區（留空＝與文字模型相同，否則 global）', { ph: 'global' }),
          imgSafety
        );
      } else if (b === 'pollinations') {
        fields.push(F.text('image.model', '模型（選填）', { ph: 'flux' }), F.secret('image.apiKey', 'Token（選填）'));
      } else if (b === 'openai') {
        fields.push(F.text('image.baseUrl', 'API 網址', { ph: 'https://api.openai.com/v1' }), F.secret('image.apiKey', 'API 金鑰'), F.text('image.model', '模型', { ph: 'gpt-image-1' }));
      } else if (b === 'chat') {
        fields.push(
          F.text('image.baseUrl', 'API 網址（留空＝與文字模型相同）', { ph: TT.settings.llm.baseUrl || 'https://…/v1' }),
          F.secret('image.apiKey', 'API 金鑰（留空＝與文字模型相同）'),
          F.text('image.model', '圖像模型', { ph: '例如 gemini-2.5-flash-image', hint: '需為會在回覆中輸出圖片的模型（許多中轉站與 OpenRouter 提供）。' })
        );
      } else if (b === 'sdwebui') {
        fields.push(
          F.text('image.baseUrl', 'WebUI 網址', { ph: 'http://127.0.0.1:7860', hint: '啟動參數需加上 --api，並允許跨域：--cors-allow-origins=*（或使用 server.js 代理）。' }),
          html`<div class="grid2">${F.number('image.steps', '步數', { min: 1, max: 150 })}${F.number('image.cfg', 'CFG', { min: 1, max: 30, step: 0.5 })}</div>`,
          F.text('image.sampler', '取樣器', { ph: 'Euler a' })
        );
      } else if (b === 'comfyui') {
        fields.push(
          F.text('image.baseUrl', 'ComfyUI 網址', { ph: 'http://127.0.0.1:8188', hint: '啟動參數加上 --enable-cors-header "*"（或使用 server.js 代理）。' }),
          F.text('image.comfyModel', 'Checkpoint 檔名（對應 %model%）', { ph: 'animagineXL.safetensors' }),
          html`<div class="grid2">${F.number('image.steps', '步數', { min: 1, max: 150 })}${F.number('image.cfg', 'CFG', { min: 1, max: 30, step: 0.5 })}</div>`,
          F.area('image.comfyWorkflow', '工作流程（API 格式 JSON，留空使用內建 SDXL/SD1.5 流程）', { rows: 4, ph: '可用變數：%prompt% %negative_prompt% %width% %height% %seed% %steps% %scale% %sampler% %model%' })
        );
      }
      return html`<h3 class="sec-title">${icon('image', 18)} 圖像生成（場景分鏡）</h3>
        ${F.select('image.backend', '生成服務', backends, { act: true })}
        ${b === 'none' ? html`<p class="hint">不生成圖片時，劇場會用角色卡圖片當背景，漫畫模式顯示文字分鏡。</p>` : html`
          ${fields}
          <div class="grid2">
            ${F.select('image.aspect', '畫面比例', [['portrait', '直式（手機）'], ['landscape', '橫式'], ['square', '方形']])}
            ${F.text('image.size', '自訂尺寸（選填）', { ph: '例如 832x1216' })}
          </div>
          ${F.select('image.style', '預設畫風', styles, { act: true })}
          ${st.style === 'custom' ? F.area('image.customStyle', '自訂畫風提示詞', { rows: 2, ph: 'masterpiece, best quality, …' }) : ''}
          ${F.toggle('image.scenes', '生成場景圖', '每段劇情畫一張背景；關閉則用角色卡圖片當背景，只畫立繪')}
          ${st.scenes !== false ? F.select('image.sceneMode', '場景圖內容', [['background', '只畫背景，人物用立繪顯示'], ['full', '人物與背景畫在同一張']]) : ''}
          ${F.toggle('image.portraits', '自動生成角色立繪', '預設關閉：進入故事時不畫立繪，改在「作品設定」匯入或生成。開啟後，新角色登場時會自動畫立繪')}
          ${F.toggle('image.expressions', '立繪表情組', '每個角色畫多種表情與動作（預設 8 種，可在作品設定自己新增），台詞會自動換立繪；需要能看參考圖的服務（Gemini、對話式圖像模型、gpt-image）')}
          ${F.toggle('image.preExpr', '遊玩前先畫好主要角色的表情', '開始故事前等主要角色的立繪與表情畫完；配角在登場時於背景補畫')}
          ${b !== 'openai' && b !== 'chat' ? F.area('image.negative', '負面提示詞', { rows: 2 }) : ''}
          ${F.toggle('image.auto', '自動生成場景圖', '每個新場景出現時自動繪製；關閉則需手動點擊')}
          ${b === 'chat' || b === 'openai' ? F.toggle('image.useRef', '附上角色參考圖', '把角色卡／主角頭像當參考圖傳送，提升長相一致性（需模型支援圖片輸入）') : ''}
          ${F.number('image.concurrency', '同時生成數量', { min: 1, max: 4 })}
          <div class="btn-row"><button class="btn primary" data-act="testimg">${icon('sparkles', 16)} 測試生成</button></div>`}`;
    },

    storySection() {
      const langs = Object.entries(TT.prompt.LANGS);
      return html`<h3 class="sec-title">${icon('film', 18)} 劇情</h3>
        <div class="grid2">
          ${F.select('story.language', '劇情語言', langs)}
          ${F.select('story.length', '每段長度', [['short', '短（150～250 字）'], ['medium', '中（300～500 字）'], ['long', '長（600～900 字）']])}
        </div>
        <div class="grid2">
          ${F.number('story.choices', '選項數量', { min: 0, max: 5 })}
          ${F.select('story.viewMode', '預設閱讀模式', [['theater', '劇場'], ['comic', '漫畫'], ['novel', '小說']])}
        </div>
        <div class="field"><span>優先指示（所有故事）</span>
          <p class="hint">${TT.priority.summary({}) ? TT.priority.summary({}) + '。' : '還沒有。'}要記住的事、劇情走向、輸出方式、禁止事項會放在給 AI 的指示最後面，優先於其他規則；作品與存檔自己的優先指示在遊玩前設定或遊玩選單裡寫。</p>
          <div class="btn-row"><button class="btn small" data-act="priority">${icon('flag', 16)} 編輯優先指示</button></div></div>
        ${F.toggle('story.prePlay', '點存檔時先顯示遊玩前設定', '可以先調整優先指示、角色池與主角再繼續；關掉就直接進入故事')}
        ${F.toggle('story.adaptGreeting', 'AI 改編序章', '開始故事時，把角色卡的開場白改編成分鏡（含場景圖）')}
        ${F.toggle('story.mature', '成人內容（僅限成年使用者）', '親密場景以精確的身體細節與生動的感官描寫呈現；只適用於明確已成年的角色')}
        <div class="grid2">
          ${F.select('story.textEffect', '劇場文字效果', [['fade', '整句淡入'], ['type', '打字機逐字']])}
          ${F.select('story.autoSpeed', '自動播放速度', [['0.5', '×0.5'], ['1', '×1.0'], ['1.5', '×1.5'], ['2', '×2.0']])}
        </div>
        ${F.toggle('story.minimizeUser', '主角台詞最小化', '劇場中你的台詞以較小字顯示')}
        ${F.toggle('story.stats', '數值系統', '讓 AI 追蹤好感度、體力等數值')}
        ${F.toggle('story.endings', '結局系統', '故事自然結束時宣告結局並收錄')}
        ${F.toggle('story.summary', '長期記憶（前情提要）', '對話超出上下文時，自動把舊劇情濃縮成摘要')}
        ${F.toggle('story.useCardSystem', '使用角色卡的系統提示', 'system_prompt 欄位')}
        ${F.toggle('story.useCardPHI', '使用角色卡的後置指示', 'post_history_instructions 欄位')}
        ${F.range('story.typeSpeed', '劇場打字速度（毫秒／字，0＝立即顯示）', 0, 80, 2)}
        ${F.number('story.scanDepth', '世界書掃描深度（則）', { min: 1, max: 20 })}
        <details class="adv"><summary>進階：提示詞</summary>
          ${F.area('story.mainPrompt', '主提示詞（留空使用內建）', { rows: 6, ph: TT.prompt.DEFAULT_MAIN })}
          <div class="btn-row"><button class="btn small" data-act="fillmain">填入內建內容以修改</button></div>
          ${F.area('story.formatPrompt', '分鏡格式指示（留空使用內建）', { rows: 6, ph: '可用變數：{{castList}} {{length}} {{sceneRule}} {{statsRule}} {{endingRule}} {{choiceCount}} {{language}}' })}
          <div class="btn-row"><button class="btn small" data-act="fillformat">填入內建內容以修改</button></div>
        </details>`;
    },

    audioSection() {
      const sfx = html`${F.toggle('audio.bgm', '播放配樂（BGM）', '劇情裡的 [BGM:名稱] 從配樂庫挑一首音樂循環播放，換曲時淡入淡出（自己匯入音樂，本程式不生成）')}
        ${F.range('audio.bgmVolume', '配樂音量', 0, 1, 0.05, (v) => Math.round(+v * 100) + '%')}
        ${F.toggle('audio.sfx', '播放音效', '劇情裡的 [SFX] 依音效名稱或擬聲詞，從音效庫挑一個音檔播放（自己匯入音檔）')}
        ${F.range('audio.sfxVolume', '音效音量', 0, 1, 0.05, (v) => Math.round(+v * 100) + '%')}
        <p class="hint">配樂庫每本書分開（遊玩選單、遊玩前設定或作品頁裡管理）；音效庫所有書共用。</p>
        <div class="btn-row wrap"><button class="btn" data-act="bgmlib">${icon('music', 16)} 管理某本書的配樂</button><button class="btn" data-act="sfxlib">${icon('volume', 16)} 管理音效庫</button></div>`;
      if (!TT.tts.supported) return html`<h3 class="sec-title">${icon('volume', 18)} 聲音</h3>${sfx}<p class="hint">此瀏覽器不支援語音朗讀。</p>`;
      const voices = [['', '自動（依劇情語言）'], ...TT.tts.voices().map((v) => [v.voiceURI, `${v.name}（${v.lang}）`])];
      return html`<h3 class="sec-title">${icon('volume', 18)} 聲音</h3>
        ${sfx}
        ${F.toggle('audio.tts', '劇場模式朗讀', '使用瀏覽器內建語音念出台詞與旁白（Edge 的「自然」語音效果最好）')}
        ${F.select('audio.narratorVoice', '旁白聲音', voices)}
        ${F.select('audio.charVoice', '角色預設聲音', voices, { hint: '個別角色可在劇情選單「角色與狀態」中指定聲音。' })}
        ${F.range('audio.rate', '語速', 0.6, 1.8, 0.05, (v) => (+v).toFixed(2))}
        <div class="btn-row"><button class="btn" data-act="testvoice">${icon('volume', 16)} 試聽</button></div>
        <p class="hint">語音輸入：遊玩時按輸入框左側的麥克風（需 Chrome／Edge）。</p>`;
    },

    netSection() {
      const proxyNote = TT.net.proxyAvailable ? '已偵測到 server.js 本機代理。' : location.protocol === 'file:' ? '目前直接開啟檔案，未使用代理。' : '未偵測到代理伺服器。';
      return html`<h3 class="sec-title">${icon('globe', 18)} 網路</h3>
        ${F.select('net.proxy', '透過本機代理轉送 API 請求', [['auto', '自動（有 server.js 時使用）'], ['on', '一律使用'], ['off', '不使用']], { hint: proxyNote + '若 API 不允許瀏覽器直接連線（CORS 錯誤），請用 server.js 啟動本程式。' })}`;
    },

    dataSection() {
      return html`<h3 class="sec-title">${icon('save', 18)} 資料</h3>
        <p class="hint">角色卡、存檔、場景圖、立繪、特殊場景圖與音效庫都儲存在這個瀏覽器的 IndexedDB。換電腦或清除瀏覽器資料前，請先匯出備份（會包含這些素材）。</p>
        <div class="btn-row wrap">
          <a class="btn" href="#/assets">${icon('box', 16)} 素材庫</a>
          <button class="btn" data-act="backup">${icon('download', 16)} 匯出完整備份</button>
          <button class="btn" data-act="restore">${icon('upload', 16)} 匯入備份</button>
          <button class="btn danger" data-act="wipe">${icon('trash', 16)} 清除所有資料</button>
        </div>`;
    },

    readInput(t) {
      if (t.type === 'checkbox') return t.checked;
      if (t.dataset.num !== undefined) return t.value === '' ? '' : +t.value;
      return t.value;
    },

    onInput(e) {
      const t = e.target;
      if (t.dataset.price) {
        const [model, k] = t.dataset.price.split('|');
        const pr = TT.settings.usage.prices;
        const o = { ...(pr[model] || {}) };
        if (t.value === '' || isNaN(+t.value)) delete o[k]; else o[k] = +t.value;
        if (Object.keys(o).length) pr[model] = o; else delete pr[model];
        TT.saveSettings();
        clearTimeout(S.usageTimer);
        S.usageTimer = setTimeout(() => S.renderUsage(false), 400);
        return;
      }
      const p = t.dataset.bind;
      if (!p || t.tagName === 'SELECT' || t.type === 'checkbox') return;
      TT.setPath(TT.settings, p, S.readInput(t));
      TT.saveSettings();
      const out = S.el.querySelector(`[data-range-out="${p}"]`);
      if (out) out.textContent = p === 'audio.rate' ? (+t.value).toFixed(2) : p === 'audio.sfxVolume' || p === 'audio.bgmVolume' ? Math.round(+t.value * 100) + '%' : t.value;
      if (p === 'audio.bgmVolume') TT.bgm.setVolume();
    },

    onChange(e) {
      const t = e.target;
      const pick = t.dataset.modelPick;
      if (pick) {
        const custom = S.el.querySelector(`[data-model-custom="${pick}"]`);
        if (t.value === '__custom') { custom.hidden = false; custom.querySelector('input').focus(); return; }
        custom.hidden = true;
        custom.querySelector('input').value = t.value;
        TT.setPath(TT.settings, pick, t.value);
        TT.saveSettings();
        return;
      }
      const p = t.dataset.bind;
      if (!p) return;
      if (p === 'llm.preset') {
        TT.actions.applyPreset(t.value);
        S.models = [];
        S.renderSection('llm');
        return;
      }
      TT.setPath(TT.settings, p, S.readInput(t));
      if (p === 'llm.type') {
        if (t.value === 'anthropic' && !TT.settings.llm.baseUrl) TT.settings.llm.baseUrl = 'https://api.anthropic.com/v1';
        if (t.value === 'gemini' && !/googleapis/.test(TT.settings.llm.baseUrl)) TT.settings.llm.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
        if (t.value === 'vertex' && !TT.settings.llm.location) TT.settings.llm.location = 'global';
        S.renderSection('llm');
      } else if (p === 'image.backend' || p === 'image.style' || p === 'image.scenes') {
        S.renderSection('image');
      }
      TT.saveSettings();
    },

    async onClick(e) {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      switch (a.dataset.act) {
        case 'back': return TT.router.back('/');
        case 'sfxlib': await TT.sfx.manager(); return S.renderSection('audio');
        case 'bgmlib': await TT.bgm.manager(); return S.renderSection('audio');
        case 'priority': await TT.priority.sheet({}); return S.renderSection('story');
        case 'reveal': {
          const inp = a.parentElement.querySelector('input');
          inp.type = inp.type === 'password' ? 'text' : 'password';
          return;
        }
        case 'models':
          a.disabled = true;
          await S.fetchModels();
          a.disabled = false;
          return;
        case 'usagerange':
          TT.settings.usage.range = a.dataset.range;
          TT.saveSettings();
          return S.renderSection('usage');
        case 'usagereset':
          if (!(await TT.confirm('清除所有用量統計？單價設定會保留。', { danger: true, okText: '清除' }))) return;
          await TT.usage.reset();
          return S.renderSection('usage');
        case 'testllm': {
          a.disabled = true;
          const t0 = performance.now();
          try {
            const text = await TT.llm.chat({ messages: [{ role: 'user', content: '這是連線測試，請只回覆「連線成功」。' }], stream: false, maxTokens: 64 });
            TT.sheet({ title: '連線成功', body: html`<p class="sheet-msg">耗時 ${Math.round(performance.now() - t0)} 毫秒，模型回覆：</p><blockquote>${TT.truncate(text.trim(), 300) || '（空白）'}</blockquote>`, actions: [{ label: '好', primary: true }] });
          } catch (err) {
            TT.sheet({ title: '連線失敗', body: html`<p class="sheet-msg">${TT.llm.describeError(err)}</p>`, actions: [{ label: '知道了', primary: true }] });
          }
          a.disabled = false;
          return;
        }
        case 'testimg': {
          a.disabled = true;
          a.innerHTML = TT.icon('sparkles', 16) + ' 生成中…';
          try {
            const [w, h] = TT.img.dims(TT.settings.image);
            const out = await TT.img.generate({ positive: [TT.img.styleText(null), 'a cozy bookstore on a rainy night, warm light from the windows, wide shot'].join(', '), negative: TT.settings.image.negative, width: w, height: h, seed: Math.floor(Math.random() * 1e9), refs: [] });
            const url = out instanceof Blob ? URL.createObjectURL(out) : out.url;
            await TT.sheet({ title: '測試成功', wide: true, body: html`<img class="viewer-img" src="${url}" alt=""><p class="hint">${w}×${h}${out instanceof Blob ? '' : '（以網址顯示，無法離線保存）'}</p>`, actions: [{ label: '好', primary: true }] });
            if (out instanceof Blob) URL.revokeObjectURL(url);
          } catch (err) {
            TT.sheet({ title: '生成失敗', body: html`<p class="sheet-msg">${TT.llm.describeError(err)}</p>`, actions: [{ label: '知道了', primary: true }] });
          }
          a.disabled = false;
          a.innerHTML = TT.icon('sparkles', 16) + ' 測試生成';
          return;
        }
        case 'testvoice':
          return TT.tts.speak('歡迎光臨夜行書店。這麼大的雨，你居然能找到這裡。', { uri: TT.settings.audio.charVoice });
        case 'fillmain':
          TT.settings.story.mainPrompt = TT.prompt.DEFAULT_MAIN;
          TT.saveSettings();
          return S.renderSection('story');
        case 'fillformat':
          TT.settings.story.formatPrompt = TT.prompt.DEFAULT_FORMAT;
          TT.saveSettings();
          return S.renderSection('story');
        case 'freetrial':
          TT.actions.useFreeTrial();
          return S.render();
        case 'backup': return S.backup();
        case 'restore': return S.restore();
        case 'wipe': return S.wipe();
      }
    },

    async backup() {
      const withKeys = await TT.sheet({
        title: '匯出完整備份',
        body: html`<p class="sheet-msg">備份包含角色卡、主角、存檔、場景圖、立繪、特殊場景圖、音效庫與設定。要一併包含 API 金鑰嗎？（分享備份檔時請勿包含）</p>`,
        actions: [{ label: '不含金鑰', value: 'no', primary: true }, { label: '包含金鑰', value: 'yes' }],
      });
      if (!withKeys) return;
      TT.toast('正在打包…');
      await TT.store.flushAll();
      const enc = async (o, key) => (o && o[key] instanceof Blob ? { ...o, [key]: await TT.blobToDataURL(o[key]) } : o);
      const settings = TT.clone(TT.settings);
      if (withKeys !== 'yes') { settings.llm.apiKey = ''; settings.image.apiKey = ''; }
      // 角色卡上的立繪、表情、特殊場景圖與音效檔都是 Blob，整個物件一起轉成 data URL
      const data = {
        type: 'tavern-toon-backup',
        version: 2,
        exportedAt: new Date().toISOString(),
        settings,
        achv: TT.achv.state,
        cards: await TT.encodeBlobs(await TT.db.all('cards')),
        personas: await TT.encodeBlobs(await TT.db.all('personas')),
        sessions: await TT.db.all('sessions'),
        images: await Promise.all((await TT.db.all('images')).map((i) => enc(i, 'blob'))),
        sounds: await TT.encodeBlobs(await TT.db.all('sounds')),
      };
      const d = new Date();
      TT.download(`ToonCard-備份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, JSON.stringify(data), 'application/json');
    },

    async restore() {
      const [f] = await TT.pickFiles({ accept: '.json,application/json' });
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { return TT.toast('備份檔格式錯誤', { type: 'error' }); }
      if (!data || data.type !== 'tavern-toon-backup') return TT.toast('這不是漫劇卡的備份檔', { type: 'error' });
      if (!(await TT.confirm(`將匯入 ${data.cards.length} 個故事、${data.sessions.length} 個存檔、${data.images.length} 張圖片，與現有資料合併（相同項目會被覆蓋）。`, { okText: '匯入' }))) return;
      const dec = (o, key) => (o && typeof o[key] === 'string' && o[key].startsWith('data:') ? { ...o, [key]: TT.dataURLToBlob(o[key]) } : o);
      // 舊版備份的封面是 data URL 字串；新版所有圖片、音檔都是 { __blob }
      await TT.db.putMany('cards', TT.decodeBlobs(data.cards).map((c) => dec(c, 'avatar')));
      if (data.sounds && data.sounds.length) await TT.db.putMany('sounds', TT.decodeBlobs(data.sounds));
      await TT.db.putMany('personas', TT.decodeBlobs(data.personas).map((p) => dec(p, 'avatar')));
      await TT.db.putMany('sessions', data.sessions);
      await TT.db.putMany('images', data.images.map((i) => dec(i, 'blob')));
      if (data.achv) await TT.store.kvSet('achv', data.achv);
      if (data.settings) {
        const keep = { llm: TT.settings.llm.apiKey, img: TT.settings.image.apiKey };
        TT.settings = TT.deepMerge(TT.defaults, data.settings);
        if (!TT.settings.llm.apiKey) TT.settings.llm.apiKey = keep.llm;
        if (!TT.settings.image.apiKey) TT.settings.image.apiKey = keep.img;
        await TT.db.put('kv', { key: 'settings', value: TT.settings });
      }
      TT.toast('匯入完成，重新載入中…');
      setTimeout(() => location.reload(), 700);
    },

    async wipe() {
      if (!(await TT.confirm('清除所有角色卡、存檔、場景圖與設定？此動作無法復原，建議先匯出備份。', { danger: true, okText: '全部清除' }))) return;
      if (!(await TT.confirm('真的要清除嗎？', { danger: true, okText: '確定清除' }))) return;
      const db = await TT.db.open();
      db.close();
      await new Promise((r) => { const req = indexedDB.deleteDatabase('tavern-toon'); req.onsuccess = req.onerror = req.onblocked = () => r(); });
      location.hash = '#/';
      location.reload();
    },
  });
})();
