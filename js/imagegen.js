/* 場景圖生成：多種後端 + 角色外貌一致性 + 生成佇列 */
(function () {
  'use strict';
  const TT = window.TT;

  const STYLES = {
    anime: { label: '動漫條漫', positive: 'anime style, webtoon illustration, cel shading, vibrant colors, detailed background, dramatic lighting, masterpiece, best quality' },
    manhwa: { label: '韓漫唯美', positive: 'manhwa style, korean webtoon art, soft shading, beautiful detailed eyes, glossy hair, romantic lighting, high quality' },
    manga: { label: '黑白漫畫', positive: 'monochrome, greyscale, manga panel, screentone, ink lineart, high contrast, dynamic composition, best quality' },
    cinematic: { label: '電影寫實', positive: 'cinematic film still, photorealistic, 35mm photograph, shallow depth of field, moody lighting, film grain, highly detailed' },
    painterly: { label: '厚塗插畫', positive: 'digital painting, painterly, concept art, rich colors, volumetric lighting, highly detailed' },
    watercolor: { label: '水彩繪本', positive: 'watercolor illustration, storybook art, soft edges, warm palette, paper texture' },
    pixel: { label: '像素風', positive: 'pixel art, 16-bit retro game scene, limited palette, crisp pixels' },
    custom: { label: '自訂', positive: '' },
  };

  const BACKENDS = {
    none: { label: '不生成圖片（使用角色卡圖片）' },
    gemini: { label: 'Google Gemini 圖像（Nano Banana，用參考圖保持長相）', base: 'https://generativelanguage.googleapis.com/v1beta' },
    vertex: { label: 'Google Vertex AI 圖像（Nano Banana，用 Google Cloud 額度）', base: '' },
    pollinations: { label: 'Pollinations（免費、免金鑰，速度不穩定）', base: 'https://image.pollinations.ai' },
    openai: { label: 'OpenAI 相容圖像 API（/images/generations）', base: 'https://api.openai.com/v1' },
    chat: { label: '對話式圖像模型（經 /chat/completions，如 Gemini 圖像模型）', base: '' },
    sdwebui: { label: 'Stable Diffusion WebUI / Forge（本機）', base: 'http://127.0.0.1:7860' },
    comfyui: { label: 'ComfyUI（本機）', base: 'http://127.0.0.1:8188' },
  };

  const DEFAULT_COMFY = {
    3: { class_type: 'KSampler', inputs: { seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%', clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'ToonCard', images: ['8', 0] } },
  };

  function dims(st) {
    const m = String(st.size || '').match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i);
    if (m) return [+m[1], +m[2]];
    const a = st.aspect || 'portrait';
    if (st.backend === 'openai') return a === 'portrait' ? [1024, 1536] : a === 'landscape' ? [1536, 1024] : [1024, 1024];
    if (st.backend === 'pollinations') return a === 'portrait' ? [768, 1152] : a === 'landscape' ? [1152, 768] : [1024, 1024];
    return a === 'portrait' ? [832, 1216] : a === 'landscape' ? [1216, 832] : [1024, 1024];
  }

  function styleText(card) {
    const st = TT.settings.image;
    const key = (card && card.style) || st.style;
    if (key === 'custom') return (st.customStyle || '').trim();
    return (STYLES[key] || STYLES.anime).positive;
  }

  const bgOnly = () => (TT.settings.image.sceneMode || 'background') === 'background';

  // 場景圖：預設只畫背景（人物用立繪另外顯示）；完整模式則把角色名補上外貌標籤並附參考圖
  async function buildRequest(scene, ctx) {
    const st = TT.settings.image;
    const { card, persona, session } = ctx;
    let p = (scene.prompt || scene.text || '').trim();
    if (bgOnly()) {
      const [width, height] = dims(st);
      return {
        positive: [styleText(card), p, 'scenery, no humans, detailed background, establishing shot'].filter(Boolean).join(', '),
        negative: [st.negative, 'people, person, human, character, figure, crowd, girl, boy'].filter(Boolean).join(', '),
        width, height,
        seed: Math.floor(Math.random() * 2147483647),
        refs: [],
      };
    }
    const state = TT.engine.deriveState(session, card, persona);
    const refs = [];
    const names = Object.keys(state.cast).sort((a, b) => b.length - a.length);
    const present = [];
    for (const n of names) {
      if (!n || !p.includes(n)) continue;
      present.push(n);
      const tags = state.cast[n].tags;
      if (tags) p = p.replace(n, `${n} (${tags})`);
    }
    if (st.useRef && (st.backend === 'chat' || st.backend === 'openai')) {
      for (const n of present) {
        if (refs.length >= 3) break;
        const c = state.cast[n];
        let blob = null;
        if (c.kind === 'char' && card.avatar && !card.generatedCover) blob = card.avatar;
        else if (c.kind === 'user' && persona && persona.avatar) blob = persona.avatar;
        else if (c.avatarImageId) { const r = await TT.db.get('images', c.avatarImageId); blob = r && r.blob; }
        if (blob) refs.push(await TT.resizeImageBlob(blob, 768, 'image/png'));
      }
    }
    const style = styleText(card);
    const [width, height] = dims(st);
    return {
      positive: [style, p].filter(Boolean).join(', '),
      negative: st.negative || '',
      width, height,
      seed: Math.floor(Math.random() * 2147483647),
      refs,
    };
  }

  /* ---------- 後端 ---------- */
  function selectedImageModel(st) {
    const model = String(st.model || '').trim();
    if (!model) throw new Error('尚未設定圖像模型名稱');
    return model;
  }

  async function fetchAsBlob(url) {
    if (url.startsWith('data:')) return TT.dataURLToBlob(url);
    try {
      const r = await TT.net.fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob();
      if (b.type && !b.type.startsWith('image/')) throw new Error('回傳的不是圖片');
      return b;
    } catch (e) {
      return { url }; // 跨域無法下載時，直接以網址顯示
    }
  }

  async function failed(res) {
    let t = '';
    try { t = await res.text(); } catch (e) { /* 忽略 */ }
    let msg = t;
    try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.detail || j.message || t; } catch (e) { /* 非 JSON */ }
    return new Error(`HTTP ${res.status}：${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}`);
  }

  async function genOpenAI(req, st, signal) {
    const base = TT.llm.normalizeBase(st.baseUrl || BACKENDS.openai.base);
    const model = selectedImageModel(st);
    const headers = st.apiKey ? { Authorization: 'Bearer ' + st.apiKey.trim() } : {};
    let res;
    if (req.refs.length && /gpt-image|dall-e-2/i.test(model)) {
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', req.positive + '\nKeep the characters consistent with the reference images.');
      fd.append('size', `${req.width}x${req.height}`);
      req.refs.forEach((b, i) => fd.append('image[]', b, `ref${i}.png`));
      res = await TT.net.fetch(base + '/images/edits', { method: 'POST', headers, body: fd, signal });
    } else {
      const body = { model, prompt: req.positive, size: `${req.width}x${req.height}`, n: 1 };
      if (/dall-e/i.test(model)) body.response_format = 'b64_json';
      if (req.transparent && /gpt-image/i.test(model)) body.background = 'transparent';
      res = await TT.net.fetch(base + '/images/generations', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    }
    if (!res.ok) throw await failed(res);
    const j = await res.json();
    const d = j.data && j.data[0];
    if (!d) throw new Error('API 沒有回傳圖片');
    if (d.b64_json) return new Blob([TT.b64ToBytes(d.b64_json)], { type: 'image/png' });
    if (d.url) return fetchAsBlob(d.url);
    throw new Error('無法解析圖片回應');
  }

  function findImageInMessage(msg) {
    if (!msg) return '';
    if (Array.isArray(msg.images) && msg.images.length) {
      const im = msg.images[0];
      return (im.image_url && (im.image_url.url || im.image_url)) || im.url || '';
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part) continue;
        if (part.image_url) return part.image_url.url || part.image_url;
        if (part.inline_data && part.inline_data.data) return `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`;
        if (part.b64_json) return 'data:image/png;base64,' + part.b64_json;
        if (typeof part.text === 'string') { const u = findInText(part.text); if (u) return u; }
      }
    }
    return typeof msg.content === 'string' ? findInText(msg.content) : '';
  }
  function findInText(t) {
    let m = t.match(/!\[[^\]]*\]\(\s*(data:image\/[^)\s]+|https?:\/\/[^)\s]+)\s*\)/);
    if (m) return m[1];
    m = t.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/);
    if (m) return m[0];
    m = t.match(/https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i);
    return m ? m[0] : '';
  }

  async function genChat(req, st, signal) {
    const base = TT.llm.normalizeBase(st.baseUrl || TT.settings.llm.baseUrl);
    const key = st.apiKey || TT.settings.llm.apiKey;
    if (!base) throw new Error('尚未設定圖像 API 網址');
    const model = selectedImageModel(st);
    const ratio = req.width > req.height ? 'landscape (3:2)' : req.width < req.height ? 'portrait (2:3)' : 'square (1:1)';
    const content = [{ type: 'text', text: `Generate one illustration. ${req.positive}\nAspect ratio: ${ratio}. No text, captions, or speech bubbles in the image.${req.refs.length ? '\nUse the attached image(s) only as reference for the characters\' appearance.' : ''}` }];
    for (const b of req.refs) content.push({ type: 'image_url', image_url: { url: await TT.blobToDataURL(b) } });
    const body = { model, messages: [{ role: 'user', content }], stream: false };
    if (/openrouter\.ai/.test(base)) body.modalities = ['image', 'text'];
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key.trim();
    const res = await TT.net.fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw await failed(res);
    const j = await res.json();
    const url = findImageInMessage(j.choices && j.choices[0] && j.choices[0].message);
    if (!url) throw new Error('模型沒有回傳圖片（請確認使用的是能輸出圖片的模型）');
    return fetchAsBlob(url);
  }

  async function genSD(req, st, signal) {
    const base = String(st.baseUrl || BACKENDS.sdwebui.base).replace(/\/+$/, '');
    const body = {
      prompt: req.positive, negative_prompt: req.negative, width: req.width, height: req.height,
      steps: +st.steps || 28, cfg_scale: +st.cfg || 6, sampler_name: st.sampler || 'Euler a', seed: req.seed, batch_size: 1, n_iter: 1,
    };
    const res = await TT.net.fetch(base + '/sdapi/v1/txt2img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) throw await failed(res);
    const j = await res.json();
    if (!j.images || !j.images[0]) throw new Error('WebUI 沒有回傳圖片');
    return new Blob([TT.b64ToBytes(j.images[0].replace(/^data:image\/\w+;base64,/, ''))], { type: 'image/png' });
  }

  function fillWorkflow(node, vals) {
    if (typeof node === 'string') {
      const whole = node.match(/^%(\w+)%$/);
      if (whole && whole[1] in vals) return vals[whole[1]];
      return node.replace(/%(\w+)%/g, (m, k) => (k in vals ? String(vals[k]) : m));
    }
    if (Array.isArray(node)) return node.map((n) => fillWorkflow(n, vals));
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = fillWorkflow(v, vals);
      return out;
    }
    return node;
  }

  async function genComfy(req, st, signal) {
    const base = String(st.baseUrl || BACKENDS.comfyui.base).replace(/\/+$/, '');
    let wf = DEFAULT_COMFY;
    if (st.comfyWorkflow && st.comfyWorkflow.trim()) {
      try { wf = JSON.parse(st.comfyWorkflow); } catch (e) { throw new Error('ComfyUI 工作流程不是有效的 JSON（請用「Save (API Format)」匯出）'); }
    }
    const vals = {
      prompt: req.positive, negative_prompt: req.negative, width: req.width, height: req.height, seed: req.seed,
      steps: +st.steps || 28, scale: +st.cfg || 6, sampler: st.sampler || 'euler_ancestral', model: st.comfyModel || st.model || '',
    };
    const res = await TT.net.fetch(base + '/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fillWorkflow(wf, vals), client_id: 'tavern-toon' }),
      signal,
    });
    if (!res.ok) throw await failed(res);
    const { prompt_id: id } = await res.json();
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60e3) {
      await TT.wait(1200, signal);
      const h = await TT.net.fetch(base + '/history/' + id, { signal });
      if (!h.ok) continue;
      const entry = (await h.json())[id];
      if (!entry) continue;
      if (entry.status && entry.status.status_str === 'error') throw new Error('ComfyUI 執行失敗，請檢查工作流程與模型');
      for (const out of Object.values(entry.outputs || {})) {
        const im = out.images && out.images[0];
        if (im) {
          const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output' });
          const r = await TT.net.fetch(base + '/view?' + q);
          if (!r.ok) throw await failed(r);
          return await r.blob();
        }
      }
    }
    throw new Error('ComfyUI 生成逾時');
  }

  // 免費額度：每個 IP 約 45 秒一張，超過會回 402 並告知要等幾秒，這裡自動等待重試
  async function genPollinations(req, st, signal) {
    const base = String(st.baseUrl || BACKENDS.pollinations.base).replace(/\/+$/, '');
    const q = new URLSearchParams({ width: req.width, height: req.height, seed: req.seed, nologo: 'true' });
    if (st.model) q.set('model', st.model);
    if (st.apiKey) q.set('token', st.apiKey.trim());
    const url = `${base}/prompt/${encodeURIComponent(req.positive.slice(0, 1500))}?${q}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      let res;
      try { res = await TT.net.fetch(url, { signal }); } catch (e) { if (e.name === 'AbortError') throw e; return { url }; }
      if (res.ok) {
        const b = await res.blob();
        if (b.type && !b.type.startsWith('image/')) throw new Error('Pollinations 回傳的不是圖片');
        return b;
      }
      if (res.status === 402 || res.status === 429) {
        let wait = 46;
        try {
          const j = await res.json();
          const m = String((j.error && j.error.message) || j.message || '').match(/after\s+(\d+)\s*s/i);
          if (m) wait = +m[1] + 2;
        } catch (e) { /* 沿用預設等待 */ }
        await TT.wait(Math.min(90, wait) * 1000, signal);
        continue;
      }
      throw await failed(res);
    }
    throw new Error('免費畫圖服務目前太忙，請稍後再試');
  }

  function aspectOf(w, h) {
    const r = w / h;
    const opts = [['1:1', 1], ['2:3', 2 / 3], ['3:2', 1.5], ['3:4', 0.75], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9]];
    return opts.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
  }

  // 這個服務接不接受針對圖片的安全類別（不接受就記住，之後不再送）
  const imageCats = {};

  // 沒畫出圖片的原因（finishReason／blockReason）
  const BLOCK_ZH = {
    IMAGE_SAFETY: '圖片安全審查', SAFETY: '安全審查', PROHIBITED_CONTENT: '禁止內容', IMAGE_PROHIBITED_CONTENT: '禁止內容',
    BLOCKLIST: '封鎖詞', SPII: '個人資料', RECITATION: '疑似重現既有作品', IMAGE_RECITATION: '疑似重現既有作品',
    IMAGE_OTHER: '其他原因', OTHER: '其他原因', NO_IMAGE: '模型沒有附上圖片', MAX_TOKENS: '輸出長度用完',
  };
  // 這些原因可以靠改寫畫法（改成含蓄的描述）再試一次
  const SOFTENABLE = /SAFETY|PROHIBITED|BLOCKLIST|OTHER|NO_IMAGE/;

  // 沒畫出圖片：錯誤上帶著原因與模型的文字回覆，讓使用者知道發生什麼事
  function blockedError(reason, modelText) {
    const zh = BLOCK_ZH[reason] || reason;
    const e = new Error(`沒有畫出圖片：${zh}${zh !== reason ? `（${reason}）` : ''}${modelText ? `。模型回覆：「${TT.truncate(modelText.trim(), 160)}」` : ''}`);
    e.blocked = SOFTENABLE.test(reason);
    e.reason = reason;
    e.modelText = modelText || '';
    return e;
  }

  // Gemini 原生圖像（generateContent + IMAGE 模態）；金鑰留空時沿用文字模型的 Gemini 金鑰。Vertex AI 由 server.js 代簽，不用金鑰。
  // 參考圖在前、文字在後，temperature 0.95，安全過濾依「設定 → 圖像生成」（預設關閉）；report 會填入模型的文字回覆與結束原因
  async function genGemini(req, st, signal, report = {}) {
    const llm = TT.settings.llm;
    const cfg = st.backend === 'vertex'
      ? { type: 'vertex', location: st.location || (llm.type === 'vertex' && llm.location) || 'global' }
      : { type: 'gemini', baseUrl: st.baseUrl || (llm.type === 'gemini' ? llm.baseUrl : ''), apiKey: String(st.apiKey || (llm.type === 'gemini' ? llm.apiKey : '') || '').trim() };
    if (cfg.type === 'gemini' && !cfg.apiKey) throw new Error('尚未設定 Gemini 金鑰（圖像金鑰留空時會沿用文字模型的 Gemini 金鑰）');
    const model = selectedImageModel(st);
    const parts = [];
    for (const b of req.refs || []) parts.push({ inlineData: { mimeType: b.type || 'image/png', data: TT.bytesToB64(new Uint8Array(await b.arrayBuffer())) } });
    parts.push({ text: req.positive + (req.negative ? `\nAvoid: ${req.negative}` : '') });
    const temp = st.temperature !== '' && st.temperature != null && !isNaN(+st.temperature) ? +st.temperature : 0.95;
    const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: temp, responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: aspectOf(req.width, req.height) } } };
    // 圖像有自己的安全過濾設定（預設關閉），連同針對圖片的類別一起送；服務不認得那些類別時自動拿掉
    const level = st.safety || 'OFF';
    const safety = TT.llm.geminiSafety(level, { image: imageCats[cfg.type] !== false });
    if (safety) body.safetySettings = safety;
    // 圖像模型的每分鐘配額很小（尤其是新的 Google Cloud 帳戶），被限流就多等幾輪
    const call = () => TT.llm.geminiCall(cfg, model, 'generateContent', body, { signal, waits: [10, 20, 30, 45, 60, 60], onWait: (sec) => TT.bus.emit('img:wait', { sec }) });
    let res = await call();
    for (let tries = 0; res.status === 400 && tries < 2; tries++) {
      const t = await res.text();
      if (body.safetySettings && /HARM_CATEGORY|safety|category/i.test(t) && imageCats[cfg.type] !== false) {
        imageCats[cfg.type] = false;
        body.safetySettings = TT.llm.geminiSafety(level);
      } else if (body.generationConfig.imageConfig && /imageConfig|aspect/i.test(t)) {
        delete body.generationConfig.imageConfig; // 部分模型不接受畫面比例設定
      } else throw new TT.llm.ApiError(`HTTP 400：${t.slice(0, 300)}`, 400, t);
      res = await call();
    }
    if (!res.ok) throw await TT.llm.httpError(res);
    const j = await res.json();
    const cand = j.candidates && j.candidates[0];
    const allParts = (cand && cand.content && cand.content.parts) || [];
    const imgs = allParts.filter((p) => p.inlineData || p.inline_data);
    const modelText = allParts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim();
    if (j.usageMetadata && TT.usage) TT.usage.record(model, TT.usage.fromGemini(j.usageMetadata, { img: imgs.length ? 1 : 0 }));
    report.text = modelText;
    report.finish = (cand && cand.finishReason) || '';
    // 會思考的圖像模型會先附上草稿圖（thought: true），要取最後一張正式的圖
    const img = imgs.filter((p) => !p.thought).pop() || imgs.pop();
    if (!img) {
      const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason && cand.finishReason !== 'STOP' ? cand.finishReason : 'NO_IMAGE');
      throw blockedError(why, modelText);
    }
    const d = img.inlineData || img.inline_data;
    return new Blob([TT.b64ToBytes(d.data)], { type: d.mimeType || d.mime_type || 'image/png' });
  }

  // 使用者按「改寫成含蓄的畫法」時才用（不會自動重寫、自動重試）：把畫法改成比較容易通過審查的擦邊描述
  async function softenPrompt(prompt, reason = '') {
    const msg = `下面是一段要給圖像模型的畫法${reason ? `，上次被圖像服務的安全審查擋下（${reason}）` : ''}。請改寫成比較容易通過審查、但盡量保留原意的版本：
- 保留角色、構圖、表情、情緒與氛圍。
- 把露骨的性描寫、裸露、性器官、血腥或殘酷的細節，改成含蓄的擦邊描述：例如濕透貼身的衣服、半透明的薄紗、曖昧的姿勢與眼神、浴室的蒸氣、私房攝影般的光影、用布料或陰影遮住關鍵部位；暴力改成充滿動感與氣勢的打鬥姿勢。
- 所有角色都是成年人。
只輸出改寫後的畫法（維持原本的語言），不要任何說明。

【原本的畫法】
${prompt}`;
    const out = await TT.llm.complete([{ role: 'user', content: msg }], { maxTokens: 4000, cfg: { thinking: 'low' } });
    const t = String(out || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/^```\w*\s*$/gm, '').trim();
    if (!t) throw new Error('改寫失敗：文字模型沒有回覆');
    return t;
  }

  // 生成結果回報：讓使用者知道畫好了沒、為什麼沒畫出來、模型回了什麼（最近幾筆留在生成工作列）。
  // 沒畫出來不會自動重試，由使用者決定要不要改畫法再試
  const reports = [];
  function pushReport(r) {
    reports.unshift({ ...r, time: Date.now() });
    reports.length = Math.min(reports.length, 12);
    TT.bus.emit('img:report', r);
  }

  // signal：停止生成時中斷請求（包含限流的重試等待）
  async function generate(req, { signal, report: rep } = {}) {
    const st = TT.settings.image;
    switch (st.backend) {
      case 'gemini':
      case 'vertex': return genGemini(req, st, signal, rep);
      case 'openai': return genOpenAI(req, st, signal);
      case 'chat': return genChat(req, st, signal);
      case 'sdwebui': return genSD(req, st, signal);
      case 'comfyui': return genComfy(req, st, signal);
      case 'pollinations': return genPollinations(req, st, signal);
      default: throw new Error('尚未設定圖像生成服務');
    }
  }

  /* ---------- 佇列 ---------- */
  // 每個工作都有 ctl：paused（暫停：目前這張畫完就停，之後可繼續）、cancelled（停止：中斷請求、放棄剩下的）
  const queue = [];
  const running = new Set();
  const active = new Set();
  const keyOf = (j) => (j.kind === 'portrait' ? `portrait|${j.cardId}|${j.name}` : j.kind === 'task' || j.kind === 'job' ? j.key : `${j.sessionId}|${j.msgId}|${j.swipe}|${j.beat}`);
  const changed = () => TT.bus.emit('tasks:changed');
  const newCtl = () => ({ paused: false, cancelled: false, controller: new AbortController(), waiters: [] });
  const abortErr = () => new DOMException('aborted', 'AbortError');
  // 兩張圖之間檢查：暫停就在這裡等，停止就丟出 AbortError
  async function gate(job) {
    while (job.ctl.paused && !job.ctl.cancelled) {
      job.atGate = true;
      changed();
      await new Promise((r) => job.ctl.waiters.push(r));
    }
    job.atGate = false;
    if (job.ctl.cancelled) throw abortErr();
  }

  /* ---------- 表情 ---------- */
  const EXPRESSIONS = [
    ['平常', 'neutral calm expression'],
    ['微笑', 'gentle smile'],
    ['開心', 'very happy, bright open-mouthed smile'],
    ['生氣', 'angry, furrowed brows, glaring'],
    ['難過', 'sad, downcast teary eyes'],
    ['驚訝', 'surprised, wide eyes, mouth slightly open'],
    ['害羞', 'shy and embarrassed, blushing cheeks, averted gaze'],
    ['認真', 'serious and determined, focused gaze'],
  ];
  // 模型寫的表情（可能不在清單內）對應到最接近的立繪
  const EXPR_RULES = [
    [/開心|高興|大笑|愉快|興奮|雀躍|得意|happy|laugh|joy|excited/i, '開心'],
    [/微笑|笑|莞爾|溫柔|smile|gentle/i, '微笑'],
    [/生氣|憤怒|怒|不悅|惱|不滿|angry|mad|annoyed/i, '生氣'],
    [/難過|悲傷|傷心|哭|淚|沮喪|失落|擔心|不安|害怕|恐|sad|cry|tear|worr|afraid|fear/i, '難過'],
    [/驚|訝|錯愕|愣|surpris|shock/i, '驚訝'],
    [/害羞|臉紅|羞|靦腆|嬌|shy|blush|embarrass/i, '害羞'],
    [/認真|嚴肅|冷|堅定|凝重|沉|serious|stern|determined|cold/i, '認真'],
  ];
  function exprKey(emo) {
    const s = String(emo || '').trim();
    if (!s) return '平常';
    if (EXPRESSIONS.some(([k]) => k === s)) return s;
    const r = EXPR_RULES.find(([re]) => re.test(s));
    return r ? r[1] : '平常';
  }
  // 能附參考圖的服務才做得出長相一致的表情組
  const supportsRef = () => {
    const st = TT.settings.image;
    return st.backend === 'gemini' || st.backend === 'vertex' || st.backend === 'chat' || (st.backend === 'openai' && /gpt-image|dall-e-2/i.test(st.model || ''));
  };
  const exprEnabled = () => enabled() && TT.settings.image.expressions !== false && supportsRef();
  const isCharOf = (card, name) => name === card.name || name === card.nickname;
  // 這個角色的每一種立繪（預設表情＋自己新增的種類）都有圖了
  const hasExprSet = (card, name) => !TT.sprites.missing(card, name).length;

  // 角色立繪：每張角色卡每個角色只畫一次，存在角色卡上重複使用
  // gpt-image 可直接輸出透明背景；其他服務請它畫綠幕，之後再去背
  function portraitRequest(card, tags) {
    const st = TT.settings.image;
    const [width, height] = dims({ ...st, aspect: 'portrait', size: '' });
    const transparent = st.backend === 'openai' && /gpt-image/i.test(st.model || '');
    const style = styleText(card).replace(/,?\s*(detailed background|dramatic lighting|volumetric lighting)/gi, '');
    return {
      positive: [style, tags, 'solo, upper body portrait, facing viewer, standing, centered', transparent ? 'transparent background' : 'solid flat bright green background, green screen, chroma key'].filter(Boolean).join(', '),
      negative: [st.negative, 'multiple people, crowd, text, frame, border, scenery, detailed background'].filter(Boolean).join(', '),
      width, height,
      seed: Math.floor(Math.random() * 2147483647),
      refs: [],
      transparent,
    };
  }

  // 立繪工作：支援參考圖時畫整組表情，否則只畫一張；回傳的工作有 promise 可等待
  // only：只畫某一個表情（「平常」= 重畫基準立繪）；已有匯入或畫好的「平常」時，其他表情以它為參考
  function enqueuePortrait(card, name, tags, { force = false, only = '' } = {}) {
    if (!enabled() || !card || !name) return false;
    const cardRef = isCharOf(card, name) && card.avatar && !card.generatedCover;
    const hasBase = !!(card.spriteRaw && card.spriteRaw[name]);
    const expr = exprEnabled();
    const canBase = !!tags || (expr && cardRef);
    if (only === '平常' ? !canBase : only ? !hasBase || !supportsRef() : !(canBase || (expr && hasBase))) return false;
    if (!force && !only && (expr ? hasExprSet(card, name) : card.sprites && card.sprites[name])) return false;
    const job = { kind: 'portrait', cardId: card.id, name, tags, force, expr: expr || (!!only && only !== '平常'), only, ctl: newCtl(), done: 0 };
    job.total = only ? 1 : job.expr ? TT.sprites.kinds(card, name).length : 1;
    const k = keyOf(job);
    if (active.has(k)) return findJob(k) || true;
    job.promise = new Promise((r) => (job.resolve = r));
    active.add(k);
    queue.push(job);
    pump();
    TT.bus.emit('img:update', { kind: 'portrait', cardId: card.id, name, status: 'pending', done: 0, total: job.total });
    return job;
  }

  // 其他一次性的生成（例如特殊場景圖）也排進同一個佇列：還沒開始前可以暫停，隨時可以停止
  // fn(signal) 回傳結果；完成時 job.promise 解析為 { ok, result, error }
  // retry()：失敗時使用者按「重試」要做的事（例如重新打開生成設定）
  function enqueueTask({ key, label, cardId = '', fn, retry = null }) {
    if (active.has(key)) return findJob(key);
    const job = { kind: 'task', key, label, cardId, fn, retry, ctl: newCtl(), done: 0, total: 1 };
    job.promise = new Promise((r) => (job.resolve = r));
    active.add(key);
    queue.push(job);
    pump();
    TT.bus.emit('img:update', { kind: 'task', key, cardId, status: 'pending' });
    return job;
  }

  // 不用圖像模型的長工作（例如下載作者附的圖）：不佔畫圖的名額、馬上開始，一樣列在生成工作裡，可以暫停／繼續／停止。
  // body(job) 在每一步之間 await TT.img.gate(job)（暫停就停在那裡，停止就丟出 AbortError），
  // 用 job.ctl.controller.signal 中斷請求，並更新 job.done／job.total／job.cur 給工作列顯示進度
  function startJob({ key, label, cardId = '', total = 1, body }) {
    if (active.has(key)) return findJob(key);
    const job = { kind: 'job', key, label, cardId, total, done: 0, ctl: newCtl() };
    job.promise = new Promise((r) => (job.resolve = r));
    active.add(key);
    running.add(job);
    changed();
    Promise.resolve()
      .then(() => body(job))
      .then((result) => { job.outcome = { ok: true, result }; }, (e) => { job.outcome = { ok: false, cancelled: e.name === 'AbortError' || job.ctl.cancelled, error: e.message }; })
      .finally(() => { running.delete(job); active.delete(key); job.resolve(job.outcome); changed(); });
    return job;
  }

  // 去背：綠幕用色鍵，其他純色背景用相近色洪水填充；只保留最大的人物區塊，
  // 邊緣去不乾淨就放棄（回傳 null），改用柔邊顯示原圖
  async function cutout(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await TT.loadImage(url);
      const scale = Math.min(1, 1000 / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const im = g.getImageData(0, 0, w, h);
      const d = im.data;
      const N = w * h;
      const R = (p) => d[p * 4];
      const G = (p) => d[p * 4 + 1];
      const B = (p) => d[p * 4 + 2];
      let clear = 0;
      for (let x = 0; x < w; x++) if (d[x * 4 + 3] < 16) clear++;
      if (clear > w * 0.9) return blob; // 本來就是透明背景

      const sample = [];
      for (let x = 0; x < w; x++) sample.push(x);
      for (let y = 1; y < h * 0.85; y++) sample.push(y * w, y * w + w - 1);
      const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
      const bg = [0, 1, 2].map((ch) => med(sample.map((p) => d[p * 4 + ch])));
      const green = bg[1] > 90 && bg[1] > bg[0] * 1.3 && bg[1] > bg[2] * 1.3;
      // 綠幕只認「接近背景那種亮綠」：深綠色的衣服、眼睛不會被當成背景挖掉
      const ex = (p) => G(p) - Math.max(R(p), B(p));
      const bgEx = Math.max(60, bg[1] - Math.max(bg[0], bg[2]));
      const isGreen = (p) => ex(p) > bgEx * 0.42 && G(p) > bg[1] * 0.45;
      const dist = (p, r, gg, b) => Math.abs(R(p) - r) + Math.abs(G(p) - gg) + Math.abs(B(p) - b);
      const seedOk = green ? isGreen : (p) => dist(p, bg[0], bg[1], bg[2]) < 48;
      const accept = green ? (p, q) => isGreen(q) : (p, q) => dist(q, R(p), G(p), B(p)) < 20 && dist(q, bg[0], bg[1], bg[2]) < 80;

      const mask = new Uint8Array(N); // 1 = 背景
      const stack = [];
      for (const p of sample.concat(Array.from({ length: w }, (_, x) => (h - 1) * w + x))) {
        if (!mask[p] && seedOk(p)) { mask[p] = 1; stack.push(p); }
      }
      while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < N - w ? p + w : -1]) {
          if (q >= 0 && !mask[q] && accept(p, q)) { mask[q] = 1; stack.push(q); }
        }
      }

      // 保留人物：最大的一塊，以及和它差不多大的部分（舉起的武器、分開的髮飾、伸出的手）；零碎的雜點去掉
      const label = new Int32Array(N);
      const sizes = [0];
      let bestSize = 0;
      let next = 0;
      for (let s = 0; s < N; s++) {
        if (mask[s] || label[s]) continue;
        next++;
        let size = 0;
        label[s] = next;
        stack.push(s);
        while (stack.length) {
          const p = stack.pop();
          size++;
          const x = p % w;
          for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < N - w ? p + w : -1]) {
            if (q >= 0 && !mask[q] && !label[q]) { label[q] = next; stack.push(q); }
          }
        }
        sizes.push(size);
        if (size > bestSize) bestSize = size;
      }
      const minKeep = Math.max(bestSize * 0.12, N * 0.004);
      let kept = 0;
      for (let l = 1; l < sizes.length; l++) if (sizes[l] >= minKeep) kept += sizes[l];
      for (let p = 0; p < N; p++) if (!mask[p] && sizes[label[p]] < minKeep) mask[p] = 1;
      // 被頭髮或手臂圍住、沒和外圍連通的綠幕（例如髮絲間的縫）也挖掉
      if (green) for (let p = 0; p < N; p++) if (!mask[p] && ex(p) > bgEx * 0.6 && G(p) > bg[1] * 0.6) mask[p] = 1;

      // 驗證：上緣與兩側上半部應該幾乎都是背景，且人物占比合理
      let topBg = 0;
      for (let x = 0; x < w; x++) topBg += mask[x];
      let sideBg = 0;
      let sideN = 0;
      for (let y = 0; y < h * 0.6; y++) { sideBg += mask[y * w] + mask[y * w + w - 1]; sideN += 2; }
      const fg = kept / N;
      if (topBg / w < 0.8 || sideBg / sideN < 0.75 || fg < 0.1 || fg > 0.85) return null;

      // 透明、邊緣羽化 2 像素；綠幕時去除邊緣溢色
      const near = (p, r) => {
        const x = p % w;
        const y = (p / w) | 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) return true;
        }
        return false;
      };
      for (let p = 0; p < N; p++) {
        if (mask[p]) { d[p * 4 + 3] = 0; continue; }
        const n1 = near(p, 1);
        const n2 = !n1 && near(p, 2);
        if (n1) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * 0.45);
        else if (n2) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * 0.8);
        if (green && (n1 || n2 || near(p, 4))) {
          // 亮綠的溢色壓掉；本來就偏暗的綠色（衣服）只稍微減弱，避免邊緣變灰
          const lim = Math.max(R(p), B(p));
          const e = G(p) - lim;
          if (e > 0) d[p * 4 + 1] = Math.round(lim + e * (e < bgEx * 0.2 ? 0.7 : 0.15));
        }
      }
      g.putImageData(im, 0, 0);
      return await new Promise((r) => c.toBlob(r, 'image/png'));
    } catch (e) {
      console.warn('去背失敗', e);
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 其他立繪的畫法：不限表情，種類說明寫了動作、姿勢、服裝、道具就照著改；角色長相與畫風保持一致
  const kindPrompt = (k) => `Same character as the reference image: keep the identical face, hairstyle, eye color, body proportions and art style, and the same framing (upper body to thighs) and scale. Show the character as: ${k.prompt}. Expression, pose, gesture, props and clothing may change freely to match the description; otherwise keep the same outfit. Keep the solid flat bright green background (#00FF00). No text.`;

  async function runPortrait(job) {
    // 立繪可能存在作品上，也可能存在主角上
    const card = TT.sprites.ownerById(job.cardId);
    if (!card) return;
    const name = job.name;
    const signal = job.ctl.controller.signal;
    let done = 0;
    const emit = (status, extra = {}) => {
      job.done = done;
      if (extra.expr) job.cur = extra.expr;
      TT.bus.emit('img:update', { kind: 'portrait', cardId: card.id, name, status, done, total: job.total, ...extra });
      changed();
    };
    // 畫一張：期間算「進行中」，暫停要等它畫完
    const draw = async (req) => {
      job.inflight = (job.inflight || 0) + 1;
      changed();
      try { return await generate(req, { signal }); } finally { job.inflight--; changed(); }
    };
    // 沒畫出來的種類與原因，最後一起回報
    const failed = [];
    const label = `立繪：${name}${job.only ? `・${job.only}` : ''}`;
    const finish = () => pushReport({ kind: 'portrait', cardId: card.id, name, label, ok: !failed.length,
      error: failed.length ? `${failed.length} 張沒畫出來（${failed.map((f) => f.key).join('、')}）：${failed[0].msg}` : '' });
    const st = TT.settings.image;
    const [width, height] = dims({ ...st, aspect: 'portrait', size: '' });
    const seed = () => Math.floor(Math.random() * 2147483647);
    emit('running');
    try {
      // 1) 基準立繪（平常表情）：主角色用角色卡圖片當參考，其餘依外貌標籤；匯入過的就直接用
      const redoBase = job.only ? job.only === '平常' : job.force;
      let base = !redoBase && card.spriteRaw && card.spriteRaw[name];
      const newBase = !base;
      if (!base) {
        await gate(job);
        const useCard = job.expr && isCharOf(card, name) && card.avatar && !card.generatedCover;
        const style = styleText(card).replace(/,?\s*(detailed background|dramatic lighting|volumetric lighting)/gi, '');
        const req = useCard
          ? {
              positive: `Draw the character from the reference image as a standing visual-novel character sprite: the same face, hairstyle, eye color, outfit and art style. Upper body to thighs, facing the viewer, ${EXPRESSIONS[0][1]}, centered. ${style}. ${job.tags || ''} Solid flat bright green background (#00FF00), no text, no frame.`,
              negative: '', width, height, seed: seed(),
              refs: [await TT.resizeImageBlob(card.avatar, 1024, 'image/png')],
            }
          : portraitRequest(card, job.tags);
        base = await draw(req);
        if (!(base instanceof Blob)) throw new Error('立繪無法下載保存（跨域限制）');
      }
      const fresh = TT.sprites.ownerById(card.id) || card;
      const hasNormal = fresh.expr && fresh.expr[name] && fresh.expr[name]['平常'];
      if (newBase || !(fresh.sprites && fresh.sprites[name]) || (job.expr && !hasNormal)) {
        const cut = await cutout(base);
        fresh.spriteRaw = { ...(fresh.spriteRaw || {}), [name]: base };
        fresh.sprites = { ...(fresh.sprites || {}), [name]: cut || base };
        fresh.spriteCut = { ...(fresh.spriteCut || {}), [name]: !!cut };
        if (job.expr || job.only === '平常') {
          fresh.expr = { ...(fresh.expr || {}), [name]: { ...((fresh.expr || {})[name] || {}), 平常: cut || base } };
          fresh.exprCut = { ...(fresh.exprCut || {}), [name]: { ...((fresh.exprCut || {})[name] || {}), 平常: !!cut } };
        }
        TT.media.invalidate('sprite', fresh.id + '|' + name);
        TT.media.invalidate('sprite', `${fresh.id}|${name}|平常`);
        await TT.sprites.saveOwner(fresh);
      }
      if (!job.only || job.only === '平常') {
        done = 1;
        emit('progress', { expr: '平常' });
      }
      if (!job.expr || job.only === '平常') { emit('done'); finish(); return; }

      // 2) 其他表情與動作：以基準立繪為參考（透明的匯入立繪先補上綠幕再當參考圖）
      const ref = await TT.sprites.flatten(base, '#00ff00', 1024);
      fresh.expr = { ...(fresh.expr || {}), [name]: { ...((fresh.expr || {})[name] || {}) } };
      fresh.exprCut = { ...(fresh.exprCut || {}), [name]: { ...((fresh.exprCut || {})[name] || {}) } };
      const kinds = TT.sprites.kinds(fresh, name);
      const todo = job.only
        ? kinds.filter((k) => k.key === job.only)
        : kinds.slice(1).filter((k) => job.force || !fresh.expr[name][k.key]);
      if (!job.only) job.total = kinds.length;
      done = job.total - todo.length;
      emit('progress');
      let next = 0;
      let lastErr = null;
      // 一開始三條線同時畫；一被限流（429）就只留一條線，免得互相搶配額、白白重試
      let throttled = false;
      const offWait = TT.bus.on('img:wait', () => { throttled = true; });
      const worker = async (lane) => {
        while (next < todo.length) {
          if (lane > 0 && throttled) return;
          await gate(job);
          if (next >= todo.length || (lane > 0 && throttled)) return;
          const k = todo[next++];
          try {
            const out = await draw({ positive: kindPrompt(k), negative: '', width, height, seed: seed(), refs: [ref] });
            if (out instanceof Blob) {
              const c2 = await cutout(out);
              const f2 = TT.sprites.ownerById(card.id) || fresh;
              f2.expr = { ...(f2.expr || {}), [name]: { ...((f2.expr || {})[name] || {}), [k.key]: c2 || out } };
              f2.exprCut = { ...(f2.exprCut || {}), [name]: { ...((f2.exprCut || {})[name] || {}), [k.key]: !!c2 } };
              TT.media.invalidate('sprite', `${f2.id}|${name}|${k.key}`);
              await TT.sprites.saveOwner(f2);
            }
          } catch (e) {
            if (e.name === 'AbortError' || job.ctl.cancelled) throw e;
            console.warn('立繪生成失敗', k.key, e);
            lastErr = e;
            failed.push({ key: k.key, msg: e.blocked ? e.message : TT.llm.describeError(e) });
          }
          done++;
          emit('progress', { expr: k.key });
        }
      };
      try { await Promise.all(Array.from({ length: Math.min(3, todo.length) }, (_, lane) => worker(lane))); } finally { offWait(); }
      if (lastErr && (job.only || !hasExprSet(TT.sprites.ownerById(card.id) || fresh, name))) emit('error', { error: failed[failed.length - 1].msg });
      else emit('done');
      finish();
    } catch (e) {
      if (e.name === 'AbortError' || job.ctl.cancelled) { emit('cancelled'); return; }
      console.warn('立繪生成失敗', e);
      const msg = e.blocked ? e.message : TT.llm.describeError(e);
      failed.push({ key: job.only || '平常', msg });
      emit('error', { error: msg });
      finish();
    }
  }

  function locate(session, job) {
    const m = session.messages.find((x) => x.id === job.msgId);
    const sw = m && m.swipes[job.swipe];
    return sw && sw.beats[job.beat];
  }

  // job: { sessionId, msgId, swipe, beat }
  function enqueue(job) {
    const k = keyOf(job);
    if (active.has(k)) return;
    const j = { sessionId: job.sessionId, msgId: job.msgId, swipe: job.swipe, beat: job.beat, ctl: newCtl(), done: 0, total: 1 };
    active.add(k);
    queue.push(j);
    pump();
  }

  function pump() {
    const limit = Math.max(1, +TT.settings.image.concurrency || 1);
    // 下載這類不用圖像模型的工作不佔畫圖的名額
    const busy = () => [...running].filter((j) => j.kind !== 'job').length;
    while (busy() < limit) {
      const i = queue.findIndex((j) => !j.ctl.paused);
      if (i < 0) break;
      const job = queue.splice(i, 1)[0];
      running.add(job);
      run(job).finally(() => {
        running.delete(job);
        active.delete(keyOf(job));
        if (job.resolve) job.resolve(job.outcome || {});
        pump();
      });
    }
    changed();
  }

  const sceneRef = (job) => ({ sessionId: job.sessionId, msgId: job.msgId, swipe: job.swipe, beat: job.beat });

  async function run(job) {
    if (job.kind === 'portrait') return runPortrait(job);
    if (job.kind === 'task') return runTask(job);
    const session = await TT.store.getSession(job.sessionId);
    if (!session) return;
    const beat = locate(session, job);
    if (!beat) return;
    const card = TT.store.getCard(session.cardId);
    const persona = TT.store.getPersona(session.personaId) || TT.store.defaultPersona();
    beat.status = 'running';
    delete beat.error;
    TT.bus.emit('img:update', { ...sceneRef(job), status: 'running' });
    try {
      const req = await buildRequest(beat, { card, persona, session });
      job.inflight = 1;
      changed();
      const out = await generate(req, { signal: job.ctl.controller.signal });
      const id = TT.uid();
      await TT.db.put('images', { id, sessionId: job.sessionId, blob: out instanceof Blob ? out : null, url: out instanceof Blob ? '' : out.url, prompt: req.positive, createdAt: Date.now() });
      const b = locate(session, job);
      if (!b) { await TT.db.del('images', id); return; }
      b.imageId = id;
      b.status = 'done';
      TT.store.saveSession(session);
      TT.achv && TT.achv.bump('scenes');
      TT.bus.emit('img:update', { ...sceneRef(job), status: 'done', imageId: id });
    } catch (e) {
      const b = locate(session, job);
      if (e.name === 'AbortError' || job.ctl.cancelled) {
        // 停止：回到「可以再生成」的狀態
        if (b) { b.status = 'idle'; TT.store.saveSession(session); }
        TT.bus.emit('img:update', { ...sceneRef(job), status: 'idle' });
        return;
      }
      console.warn('場景圖生成失敗', e);
      const msg = e.blocked ? e.message : TT.llm.describeError(e);
      if (b) { b.status = 'error'; b.error = msg; TT.store.saveSession(session); }
      TT.bus.emit('img:update', { ...sceneRef(job), status: 'error', error: msg });
      pushReport({ kind: 'scene', label: '場景圖', ok: false, error: msg });
    } finally {
      job.inflight = 0;
    }
  }

  // fn(signal, report)：report 由畫圖時填入模型的文字回覆；結束後一律回報結果
  async function runTask(job) {
    TT.bus.emit('img:update', { kind: 'task', key: job.key, cardId: job.cardId, status: 'running' });
    job.inflight = 1;
    changed();
    const rep = {};
    try {
      const result = await job.fn(job.ctl.controller.signal, rep);
      job.done = 1;
      job.outcome = { ok: true, result };
      TT.bus.emit('img:update', { kind: 'task', key: job.key, cardId: job.cardId, status: 'done' });
      pushReport({ kind: 'task', key: job.key, cardId: job.cardId, label: job.label, ok: true, text: rep.text || '', retry: job.retry });
    } catch (e) {
      const cancelled = e.name === 'AbortError' || job.ctl.cancelled;
      if (!cancelled) console.warn('生成失敗', job.key, e);
      const msg = cancelled ? '' : e.blocked ? e.message : TT.llm.describeError(e);
      job.outcome = { ok: false, cancelled, error: msg, reason: e.reason || '' };
      TT.bus.emit('img:update', { kind: 'task', key: job.key, cardId: job.cardId, status: cancelled ? 'cancelled' : 'error', error: msg });
      if (!cancelled) pushReport({ kind: 'task', key: job.key, cardId: job.cardId, label: job.label, ok: false, error: msg, reason: e.reason || '', retry: job.retry });
    } finally {
      job.inflight = 0;
    }
  }

  /* ---------- 暫停／繼續／停止 ---------- */
  const allJobs = () => [...running, ...queue];
  const findJob = (key) => allJobs().find((j) => keyOf(j) === key) || null;
  function pauseJob(job) {
    if (!job || job.ctl.cancelled) return;
    job.ctl.paused = true;
    changed();
  }
  function resumeJob(job) {
    if (!job) return;
    job.ctl.paused = false;
    job.ctl.waiters.splice(0).forEach((r) => r());
    pump();
  }
  function cancelJob(job) {
    if (!job || job.ctl.cancelled) return;
    job.ctl.cancelled = true;
    job.ctl.paused = false;
    job.ctl.controller.abort();
    job.ctl.waiters.splice(0).forEach((r) => r());
    const i = queue.indexOf(job);
    if (i >= 0) {
      // 還沒開始的工作：直接拿掉並通知
      queue.splice(i, 1);
      active.delete(keyOf(job));
      job.outcome = { ok: false, cancelled: true };
      if (job.resolve) job.resolve(job.outcome);
      if (job.kind === 'portrait') TT.bus.emit('img:update', { kind: 'portrait', cardId: job.cardId, name: job.name, status: 'cancelled', done: job.done || 0, total: job.total });
      else if (job.kind === 'task') TT.bus.emit('img:update', { kind: 'task', key: job.key, cardId: job.cardId, status: 'cancelled' });
      else {
        TT.store.getSession(job.sessionId).then((s) => {
          const b = s && locate(s, job);
          if (b && b.status !== 'done') { b.status = 'idle'; TT.store.saveSession(s); }
          TT.bus.emit('img:update', { ...sceneRef(job), status: 'idle' });
        });
      }
    }
    changed();
  }
  const pauseAll = () => allJobs().forEach(pauseJob);
  const resumeAll = () => allJobs().forEach(resumeJob);
  const cancelAll = () => allJobs().forEach(cancelJob);

  // 給生成工作列：每個工作的名稱、進度與狀態（running／queued／pausing／paused／stopping）
  function tasks() {
    return allJobs().map((j) => {
      const status = j.ctl.cancelled ? 'stopping' : j.ctl.paused ? (j.inflight ? 'pausing' : 'paused') : running.has(j) ? 'running' : 'queued';
      const card = j.cardId ? TT.sprites.ownerById(j.cardId) : null;
      const label = j.kind === 'portrait' ? `立繪：${j.name}${j.only ? `・${j.only}` : ''}` : j.kind === 'task' || j.kind === 'job' ? j.label : '場景圖';
      return { key: keyOf(j), kind: j.kind || 'scene', label, sub: card ? card.name : '', status, done: j.done || 0, total: j.total || 1, cur: j.cur || '', job: j };
    });
  }

  const isQueued = (job) => active.has(keyOf(job));
  function enabled() { return !!TT.settings.image.backend && TT.settings.image.backend !== 'none'; }
  // 場景圖可以單獨關掉（只畫立繪）
  const scenesEnabled = () => enabled() && TT.settings.image.scenes !== false;
  const portraitBusy = (cardId, name) => active.has(keyOf({ kind: 'portrait', cardId, name }));
  const portraitJob = (cardId, name) => findJob(keyOf({ kind: 'portrait', cardId, name }));

  TT.img = {
    STYLES, BACKENDS, DEFAULT_COMFY, EXPRESSIONS, EXPR_RULES, dims, buildRequest, portraitRequest, generate, enqueue, enqueuePortrait, enqueueTask,
    portraitBusy, portraitJob, isQueued, enabled, scenesEnabled, exprEnabled, supportsRef, hasExprSet, exprKey, styleText, bgOnly, cutout,
    tasks, findJob, pauseJob, resumeJob, cancelJob, pauseAll, resumeAll, cancelAll, reports, softenPrompt, BLOCK_ZH,
    startJob, gate, report: pushReport,
  };
})();
