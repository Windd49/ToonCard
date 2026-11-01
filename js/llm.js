/* 文字模型連線：OpenAI 相容 API（含中轉、DeepSeek、OpenRouter、本機模型）、Gemini／Vertex AI 原生與 Anthropic 原生 API */
(function () {
  'use strict';
  const TT = window.TT;

  /* ---------- 網路（可選本機代理，用來避開 CORS） ---------- */
  TT.net = {
    proxyAvailable: false,
    async detect() {
      if (!/^https?:$/.test(location.protocol)) return;
      try {
        const r = await fetch('proxy/ping', { cache: 'no-store' });
        TT.net.proxyAvailable = r.ok && (await r.text()).includes('tavern-toon');
      } catch (e) { TT.net.proxyAvailable = false; }
    },
    useProxy() {
      const mode = TT.settings.net.proxy;
      return mode === 'on' || (mode === 'auto' && TT.net.proxyAvailable);
    },
    fetch(url, init = {}) {
      if (TT.net.useProxy() && /^https?:\/\//i.test(url)) return fetch('proxy?url=' + encodeURIComponent(url), init);
      return fetch(url, init);
    },
  };

  const PRESETS = {
    custom: { label: '自訂 / 中轉 API（OpenAI 相容）', type: 'openai', baseUrl: '', model: '' },
    // 免費的推理模型輸出上限約 1500 tokens，降低思考量才有字數寫劇情
    pollinations: { label: '免費試玩：Pollinations（免金鑰，較慢）', type: 'openai', baseUrl: 'https://text.pollinations.ai/openai', model: 'openai', maxTokens: 4096, extraBody: '{"reasoning_effort": "low"}', free: true },
    openai: { label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' },
    deepseek: { label: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    gemini: { label: 'Google Gemini（原生 API，可關閉安全過濾）', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash', maxTokens: 8192 },
    vertex: { label: 'Google Vertex AI（Google Cloud 額度，需用 .bat 開啟）', type: 'vertex', baseUrl: '', model: 'gemini-3.8-flash', maxTokens: 8192 },
    claude: { label: 'Anthropic Claude（原生 API）', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
    openrouter: { label: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
    siliconflow: { label: '硅基流動 SiliconFlow', type: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '' },
    ollama: { label: 'Ollama（本機）', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: '' },
    lmstudio: { label: 'LM Studio（本機）', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '' },
  };

  function normalizeBase(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    u = u.replace(/\/(chat\/completions|completions|messages|models|images\/generations)$/i, '');
    if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|192\.168\.|10\.)/.test(u) ? 'http://' : 'https://') + u;
    try {
      const p = new URL(u);
      if (p.pathname === '/' || p.pathname === '') u = u.replace(/\/$/, '') + '/v1';
    } catch (e) { /* 留給 fetch 報錯 */ }
    return u;
  }

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  async function httpError(res) {
    let text = '';
    try { text = await res.text(); } catch (e) { /* 忽略 */ }
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = (j.error && (j.error.message || j.error.msg || (typeof j.error === 'string' ? j.error : ''))) || j.message || j.detail || text;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (e) { /* 非 JSON */ }
    return new ApiError(`HTTP ${res.status}：${String(msg || res.statusText).slice(0, 400)}`, res.status, text);
  }

  function describeError(e) {
    if (!e) return '未知錯誤';
    if (e.name === 'AbortError') return '已停止生成';
    if (e instanceof ApiError) {
      const body = e.body || e.message;
      if (e.status === 402 && /prepayment credits are depleted/i.test(body)) {
        return 'Gemini 額度已用完（HTTP 402）：請到 AI Studio（https://ai.studio/projects）替這把金鑰的專案儲值或開啟計費，再重試。';
      }
      if (/VERTEX_SETUP/.test(body)) return e.message.replace(/^HTTP \d+：/, 'Vertex AI：');
      if (/aiplatform\.googleapis\.com|Vertex AI API/i.test(body) && /has not been used|disabled/i.test(body)) {
        return e.message + '（請到 Google Cloud 控制台替這個專案啟用 Vertex AI API，幾分鐘後再試）';
      }
      if (/Publisher Model/i.test(body)) return e.message + '（這個地區沒有此模型，或專案沒有存取權：可把地區改成 global 或換一個模型）';
      // Vertex AI 的 429「Resource exhausted. Please try again later.」是共用算力暫時不夠，不是固定配額用完
      if (e.status === 429 && /resource exhausted/i.test(body) && !/quota/i.test(body)) {
        return e.message + '（Google 這個模型的共用算力暫時不夠，不是你的額度用完；程式已經自動等待重試過。新上線的大模型、以及最近 30 天花費還很少的新帳戶最容易遇到：可以過一會兒再重試，或到設定改用 Flash 等較快的模型）';
      }
      const hint =
        e.status === 401 || e.status === 403 ? '（API 金鑰無效或沒有權限）'
          : e.status === 402 ? '（額度不足或需要付款）'
            : e.status === 404 ? '（找不到端點或模型，請檢查 API 網址與模型名稱）'
              : e.status === 429 ? '（請求過於頻繁或額度不足）'
                : e.status >= 500 ? '（伺服器暫時錯誤，可稍後重試）' : '';
      return e.message + hint;
    }
    if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) {
      return '無法連線：請確認網址與網路；若 API 不允許瀏覽器跨域（CORS），請改用 server.js 啟動並開啟代理。';
    }
    return e.message || String(e);
  }

  // 讀取 SSE 串流，每個 data JSON 呼叫 onEvent
  async function readSSE(res, onEvent, signal) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') return;
          let j;
          try { j = JSON.parse(data); } catch (e) { continue; }
          onEvent(j);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (e) { /* 忽略 */ }
    }
  }

  const partText = (c) =>
    typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p && (p.text || ''))).join('') : '';

  /* ---------- OpenAI 相容 ---------- */
  async function chatOpenAI(cfg, { messages, stream, signal, onText, onReasoning, maxTokens }) {
    const base = normalizeBase(cfg.baseUrl);
    if (!base) throw new Error('尚未設定 API 網址');
    const body = { model: cfg.model, messages, stream: !!stream };
    if (maxTokens) body.max_tokens = maxTokens;
    if (numOr(cfg.temperature) != null) body.temperature = numOr(cfg.temperature);
    if (numOr(cfg.topP) != null) body.top_p = numOr(cfg.topP);
    // 推理模型的思考程度（OpenAI 相容的 reasoning_effort；「關閉」以最低的 low 代替）
    if (cfg.thinking && cfg.thinking !== 'auto') body.reasoning_effort = cfg.thinking === 'off' ? 'low' : cfg.thinking;
    if (cfg.extraBody && cfg.extraBody.trim()) {
      try { Object.assign(body, JSON.parse(cfg.extraBody)); } catch (e) { throw new Error('「額外參數」不是有效的 JSON'); }
    }
    if (/text\.pollinations\.ai/.test(base) && body.reasoning_effort == null) body.reasoning_effort = 'low';
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey.trim();
    if (/openrouter\.ai/.test(base)) { headers['X-Title'] = 'ToonCard'; }
    const res = await TT.net.fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw await httpError(res);
    const ct = res.headers.get('content-type') || '';
    let full = '';
    let usage = null;
    if (stream && res.body && !ct.includes('application/json')) {
      await readSSE(res, (j) => {
        if (j.error) throw new ApiError(typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error), 0);
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        if (!ch) return;
        const d = ch.delta || ch.message || {};
        const r = d.reasoning_content || d.reasoning;
        if (r && onReasoning) onReasoning(typeof r === 'string' ? r : '');
        const t = partText(d.content);
        if (t) { full += t; if (onText) onText(t); }
      }, signal);
    } else {
      const j = await res.json();
      if (j.error) throw new ApiError(j.error.message || JSON.stringify(j.error), res.status);
      usage = j.usage || null;
      const msg = j.choices && j.choices[0] && (j.choices[0].message || {});
      full = partText(msg && msg.content);
      if (full && onText) onText(full);
    }
    if (usage && TT.usage) TT.usage.record(cfg.model, { in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0 });
    return full;
  }

  /* ---------- Anthropic 原生 ---------- */
  function toAnthropic(messages) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const last = rest[rest.length - 1];
      if (last && last.role === role) last.content += '\n\n' + m.content;
      else rest.push({ role, content: m.content });
    }
    if (!rest.length || rest[0].role !== 'user') rest.unshift({ role: 'user', content: '[開始]' });
    if (rest[rest.length - 1].role !== 'user') rest.push({ role: 'user', content: '[繼續]' });
    return { system, messages: rest };
  }

  function anthropicHeaders(cfg) {
    return {
      'content-type': 'application/json',
      'x-api-key': (cfg.apiKey || '').trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async function chatAnthropic(cfg, { messages, stream, signal, onText, maxTokens }) {
    const base = normalizeBase(cfg.baseUrl || 'https://api.anthropic.com/v1');
    const conv = toAnthropic(messages);
    // 新款模型的思考也計入 max_tokens，因此保留較大的上限
    const body = { model: cfg.model, max_tokens: Math.max(maxTokens || 0, 16000), messages: conv.messages, stream: !!stream };
    if (conv.system) body.system = conv.system;
    if (numOr(cfg.temperature) != null) body.temperature = numOr(cfg.temperature);
    else if (numOr(cfg.topP) != null) body.top_p = numOr(cfg.topP);
    if (cfg.extraBody && cfg.extraBody.trim()) {
      try { Object.assign(body, JSON.parse(cfg.extraBody)); } catch (e) { throw new Error('「額外參數」不是有效的 JSON'); }
    }
    const res = await TT.net.fetch(base + '/messages', { method: 'POST', headers: anthropicHeaders(cfg), body: JSON.stringify(body), signal });
    if (!res.ok) throw await httpError(res);
    let full = '';
    let stop = '';
    const used = { in: 0, out: 0 };
    if (stream && res.body) {
      await readSSE(res, (j) => {
        if (j.type === 'error') throw new ApiError((j.error && j.error.message) || '串流錯誤', 0);
        if (j.type === 'message_start' && j.message && j.message.usage) used.in = j.message.usage.input_tokens || 0;
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') {
          full += j.delta.text;
          if (onText) onText(j.delta.text);
        }
        if (j.type === 'message_delta' && j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
        if (j.type === 'message_delta' && j.usage) used.out = j.usage.output_tokens || 0;
      }, signal);
    } else {
      const j = await res.json();
      stop = j.stop_reason;
      if (j.usage) { used.in = j.usage.input_tokens || 0; used.out = j.usage.output_tokens || 0; }
      full = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (full && onText) onText(full);
    }
    if ((used.in || used.out) && TT.usage) TT.usage.record(cfg.model, used);
    if (stop === 'refusal' && !full.trim()) throw new Error('模型拒絕了這次請求（refusal）');
    return full;
  }

  /* ---------- Google Gemini 原生（generateContent）與 Vertex AI ---------- */
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const SAFETY_CATS = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'];
  const NEED_BAT = 'Vertex AI 要用「啟動漫劇卡.bat」開啟本程式（http://127.0.0.1:8787），由本機伺服器用 Google Cloud 金鑰代簽請求。';
  const OLD_SERVER = '本機伺服器是舊版、還不支援 Vertex AI：請關掉黑色視窗，再重新雙擊「啟動漫劇卡.bat」。';

  function geminiBase(url) {
    let u = String(url || GEMINI_BASE).trim().replace(/\/+$/, '').replace(/\/models(\/.*)?$/, '').replace(/\/openai$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (/googleapis\.com$/.test(u)) u += '/v1beta';
    return u;
  }

  // 安全過濾：OFF（關閉）／BLOCK_NONE（不封鎖）／default（用 Google 預設值）
  // 圖像模型另外有針對輸出圖片的類別（Vertex AI）；image=true 時一起送出
  const IMAGE_CATS = ['HARM_CATEGORY_IMAGE_HATE', 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', 'HARM_CATEGORY_IMAGE_HARASSMENT', 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT'];
  function geminiSafety(level, { image = false } = {}) {
    if (level === 'default') return undefined;
    return SAFETY_CATS.concat(image ? IMAGE_CATS : []).map((category) => ({ category, threshold: level || 'OFF' }));
  }

  function toGemini(messages) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += '\n\n' + m.content;
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '[開始]' }] });
    if (contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', parts: [{ text: '[繼續]' }] });
    return { system, contents };
  }

  // 送出 generateContent 類請求：Gemini 直接帶金鑰；Vertex AI 經 server.js 代簽，瀏覽器不碰 Google Cloud 金鑰
  async function geminiFetch(cfg, model, method, body, signal) {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
    if (cfg.type !== 'vertex') {
      init.headers['x-goog-api-key'] = (cfg.apiKey || '').trim();
      return TT.net.fetch(`${geminiBase(cfg.baseUrl)}/models/${encodeURIComponent(model)}:${method}`, init);
    }
    if (!/^https?:$/.test(location.protocol)) throw new Error(NEED_BAT);
    const loc = encodeURIComponent(String(cfg.location || 'global').trim().toLowerCase());
    const res = await fetch(`vertex/${loc}/models/${encodeURIComponent(model)}:${method}`, init);
    if ((res.status === 404 || res.status === 405) && !/json/.test(res.headers.get('content-type') || '')) throw new Error(OLD_SERVER);
    return res;
  }

  // Google 的共享算力忙碌時會回 429／503（Resource exhausted），官方建議指數退避後重試。
  // 同一個模型共用一個冷卻時間：一個請求被限流時，同時要送的其他請求也先等，不會一起擠在同一秒重試
  // onWait(秒數, 第幾次重試（0＝在等別的請求的冷卻）, 最多幾次, HTTP 狀態碼)
  const cooldown = {};
  async function geminiCall(cfg, model, method, body, { signal, waits = [2, 5, 10], onWait } = {}) {
    const key = `${cfg.type}|${cfg.location || ''}|${model}`;
    for (let i = 0; ; i++) {
      const left = (cooldown[key] || 0) - Date.now();
      if (left > 0) {
        if (onWait) onWait(Math.ceil(left / 1000), 0, waits.length, 0);
        await TT.wait(left + Math.random() * 1000, signal);
      }
      const res = await geminiFetch(cfg, model, method, body, signal);
      if ((res.status !== 429 && res.status !== 503) || i >= waits.length) return res;
      const after = +res.headers.get('retry-after');
      const sec = after > 0 && after <= 120 ? after : waits[i];
      try { await res.body.cancel(); } catch (e) { /* 忽略 */ }
      cooldown[key] = Math.max(cooldown[key] || 0, Date.now() + sec * 1000);
      if (onWait) onWait(sec, i + 1, waits.length, res.status);
      await TT.wait(sec * 1000 + Math.random() * 1500, signal);
    }
  }

  async function vertexStatus() {
    if (!/^https?:$/.test(location.protocol)) return { ok: false, error: NEED_BAT };
    try {
      const r = await fetch('vertex/status', { cache: 'no-store' });
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return { ok: false, error: OLD_SERVER };
      return await r.json();
    } catch (e) {
      return { ok: false, error: '連不到本機伺服器：' + e.message };
    }
  }

  const BLOCK_REASONS = { SAFETY: '安全過濾', PROHIBITED_CONTENT: '禁止內容', BLOCKLIST: '封鎖詞', SPII: '個資', RECITATION: '引用來源', OTHER: '其他原因' };

  // 思考程度：auto（模型預設）／off（盡量少想）／low／medium／high。
  // 新模型（如 gemini-4-argon）只接受 thinkingLevel 而且不能完全關閉，舊模型只接受 thinkingBudget；
  // 被拒絕就換另一種寫法並記住這個模型
  const thinkForm = {};
  const LEVELS = { off: 'LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
  const BUDGETS = { off: 0, low: 1024, medium: 4096, high: 16384 };
  function thinkingConfig(cfg) {
    const t = cfg.thinking || 'auto';
    const form = thinkForm[cfg.model] || (t === 'off' ? 'budget' : 'level');
    const tc = {};
    if (t !== 'auto' && form !== 'none') {
      if (form === 'level') tc.thinkingLevel = LEVELS[t];
      else tc.thinkingBudget = BUDGETS[t];
    }
    if (cfg.showThoughts && form !== 'none') tc.includeThoughts = true;
    return Object.keys(tc).length ? tc : null;
  }
  const numOr = (v) => (v !== '' && v != null && !isNaN(+v) ? +v : null);

  // json：要求模型只回 JSON（整理登場人物、AI 構想等），回覆一定能解析
  async function chatGemini(cfg, { messages, stream, signal, onText, onReasoning, onWait, maxTokens, json }) {
    const { system, contents } = toGemini(messages);
    // 思考也算在輸出額度裡：小請求（摘要、連線測試）至少留一點空間給思考
    const floor = cfg.thinking === 'off' || cfg.thinking === 'low' ? 1024 : 2048;
    const body = { contents, generationConfig: { maxOutputTokens: Math.max(+maxTokens || 8192, floor) } };
    if (json) body.generationConfig.responseMimeType = 'application/json';
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (numOr(cfg.temperature) != null) body.generationConfig.temperature = numOr(cfg.temperature);
    if (numOr(cfg.topP) != null) body.generationConfig.topP = numOr(cfg.topP);
    const tc = thinkingConfig(cfg);
    if (tc) body.generationConfig.thinkingConfig = tc;
    const safety = geminiSafety(cfg.safety);
    if (safety) body.safetySettings = safety;
    if (cfg.extraBody && cfg.extraBody.trim()) {
      try { Object.assign(body, JSON.parse(cfg.extraBody)); } catch (e) { throw new Error('「額外參數」不是有效的 JSON'); }
    }
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    let res = await geminiCall(cfg, cfg.model, method, body, { signal, onWait });
    // 模型不接受這種思考設定：換另一種寫法（level ↔ budget），兩種都不行就不送，最多換兩次
    const tried = new Set();
    for (let tries = 0; res.status === 400 && body.generationConfig.thinkingConfig && tries < 2; tries++) {
      const text = await res.text();
      if (!/thinking/i.test(text)) throw await httpError(new Response(text, { status: 400 }));
      const now = body.generationConfig.thinkingConfig;
      tried.add(now.thinkingLevel ? 'level' : now.thinkingBudget != null ? 'budget' : 'other');
      thinkForm[cfg.model] = ['level', 'budget'].find((f) => !tried.has(f)) || 'none';
      const next = thinkingConfig(cfg);
      if (next && JSON.stringify(next) !== JSON.stringify(now)) body.generationConfig.thinkingConfig = next;
      else { thinkForm[cfg.model] = 'none'; delete body.generationConfig.thinkingConfig; }
      res = await geminiCall(cfg, cfg.model, method, body, { signal, onWait });
    }
    if (!res.ok) throw await httpError(res);
    let full = '';
    let blocked = '';
    let finish = '';
    let usage = null;
    const handle = (j) => {
      if (j.error) throw new ApiError(j.error.message || JSON.stringify(j.error), j.error.code || 0, JSON.stringify(j.error));
      if (j.usageMetadata) usage = j.usageMetadata;
      if (j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
      const cand = j.candidates && j.candidates[0];
      if (!cand) return;
      if (cand.finishReason) finish = cand.finishReason;
      for (const p of (cand.content && cand.content.parts) || []) {
        if (!p.text) continue;
        if (p.thought) { if (onReasoning) onReasoning(p.text); continue; }
        full += p.text;
        if (onText) onText(p.text);
      }
    };
    if (stream && res.body) await readSSE(res, handle, signal);
    else handle(await res.json());
    if (usage && TT.usage) TT.usage.record(cfg.model, TT.usage.fromGemini(usage));
    if (!full.trim() && (blocked || BLOCK_REASONS[finish])) {
      throw new Error(`Gemini 拒絕了這次請求（${BLOCK_REASONS[blocked || finish] || blocked || finish}）。可在設定把安全過濾改為「關閉」，或調整劇情內容。`);
    }
    return full;
  }

  /* ---------- 對外介面 ---------- */
  async function chat(opts) {
    const selected = TT.settings.llm;
    // 個別功能可以調整思考程度等生成參數，但不得換掉使用者在設定中選定的文字服務或模型。
    const cfg = {
      ...selected,
      ...(opts.cfg || {}),
      type: selected.type,
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      model: selected.model,
      location: selected.location,
    };
    if (!cfg.model) throw new Error('尚未設定模型名稱');
    const o = { stream: cfg.stream !== false, maxTokens: +cfg.maxTokens || 2048, ...opts };
    if (cfg.type === 'anthropic') return chatAnthropic(cfg, o);
    if (cfg.type === 'gemini' || cfg.type === 'vertex') return chatGemini(cfg, o);
    return chatOpenAI(cfg, o);
  }

  // 非串流的一次性呼叫（摘要、外貌標籤等）
  const complete = (messages, opts = {}) => chat({ messages, stream: false, ...opts });

  async function listModels(cfgOverride) {
    const cfg = { ...TT.settings.llm, ...(cfgOverride || {}) };
    if (cfg.type === 'gemini') {
      const res = await TT.net.fetch(geminiBase(cfg.baseUrl) + '/models?pageSize=500', { headers: { 'x-goog-api-key': (cfg.apiKey || '').trim() } });
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      return (j.models || [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort();
    }
    if (cfg.type === 'vertex') {
      if (!/^https?:$/.test(location.protocol)) throw new Error(NEED_BAT);
      const res = await fetch(`vertex/${encodeURIComponent(cfg.location || 'global')}/models`, { cache: 'no-store' });
      if (!/json/.test(res.headers.get('content-type') || '')) throw new Error(OLD_SERVER);
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      const names = (j.publisherModels || []).map((m) => String(m.name || '').split('/').pop()).filter((n) => /gemini/i.test(n));
      return [...new Set(names)].sort();
    }
    const base = normalizeBase(cfg.baseUrl || (cfg.type === 'anthropic' ? 'https://api.anthropic.com/v1' : ''));
    if (!base) throw new Error('請先填寫 API 網址');
    const headers = cfg.type === 'anthropic' ? anthropicHeaders(cfg) : cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey.trim() } : {};
    const res = await TT.net.fetch(base + '/models' + (cfg.type === 'anthropic' ? '?limit=100' : ''), { headers });
    if (!res.ok) throw await httpError(res);
    const j = await res.json();
    const arr = Array.isArray(j) ? j : j.data || j.models || [];
    return arr.map((m) => (typeof m === 'string' ? m : m.id || m.name || '')).map((s) => s.replace(/^models\//, '')).filter(Boolean).sort();
  }

  // 模型清單快取的鍵：同一個服務（網址或 Vertex 地區）共用一份
  const listKey = (cfg) => `${cfg.type}|${cfg.type === 'vertex' ? cfg.location || 'global' : normalizeBase(cfg.baseUrl) || ''}`;

  TT.llm = { PRESETS, normalizeBase, geminiBase, geminiSafety, geminiCall, vertexStatus, chat, complete, listModels, listKey, describeError, ApiError, httpError, readSSE, partText };
})();
