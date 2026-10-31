/* 用量統計：記錄每次呼叫的 token 與圖片數，依單價估算費用（只存在這個瀏覽器） */
(function () {
  'use strict';
  const TT = window.TT;
  const KEY = 'usage-v1';

  // 參考價（美元／每百萬 token）：2026 年 10 月第三方整理的公開價，實際以 Google Cloud 帳單為準。
  // gemini-4-argon 的 $2／$10 是到 11/30 的推廣價（12/1 起約 $4／$20）；gemini-3.8-flash 到 12/31（之後約 $1.5／$7.5）。
  // img = 圖片輸出 token 的單價（Nano Banana 2.1 一張 1K 圖約 1120 token ≈ $0.034）
  const DEFAULT_PRICES = {
    'gemini-4-argon': { in: 2, out: 10, img: 0 },
    'gemini-3.8-flash': { in: 0.75, out: 3.75, img: 0 },
    'gemini-nano-banana-2.1': { in: 1.5, out: 7.5, img: 30 },
  };

  let data = null;
  let loading = null;
  let timer = null;
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const blank = () => ({ req: 0, in: 0, out: 0, think: 0, img: 0, imgTok: 0 });

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = TT.store.kvGet(KEY, null).then((v) => (data = v && v.days ? v : { days: {} }));
    return loading;
  }
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => TT.store.kvSet(KEY, data).catch((e) => console.warn('用量統計儲存失敗', e)), 800);
  }

  // Gemini／Vertex 的 usageMetadata：輸出 token 含圖片；思考 token 另計但一樣按輸出計費
  function fromGemini(um, extra = {}) {
    const imgTok = (um.candidatesTokensDetails || []).filter((d) => d.modality === 'IMAGE').reduce((s, d) => s + (d.tokenCount || 0), 0);
    return { in: um.promptTokenCount || 0, out: um.candidatesTokenCount || 0, think: um.thoughtsTokenCount || 0, imgTok, ...extra };
  }

  async function record(model, u) {
    if (!model || !u) return;
    await load();
    const day = (data.days[dayKey()] = data.days[dayKey()] || {});
    const r = (day[model] = day[model] || blank());
    for (const k of ['in', 'out', 'think', 'img', 'imgTok']) r[k] += +u[k] || 0;
    r.req++;
    save();
    TT.bus.emit('usage:changed');
  }

  const price = (model) => ({ ...(DEFAULT_PRICES[model] || { in: 0, out: 0, img: 0 }), ...((TT.settings.usage && TT.settings.usage.prices) || {})[model] });

  // 輸入 × 輸入價 ＋（文字輸出＋思考）× 輸出價 ＋ 圖片 token × 圖片價
  function cost(model, r) {
    const p = price(model);
    const textOut = Math.max(0, r.out - r.imgTok) + r.think;
    return (r.in * (+p.in || 0) + textOut * (+p.out || 0) + r.imgTok * (+p.img || (+p.out || 0))) / 1e6;
  }

  // range：today／month／all；回傳 { rows: [{ model, ...r, cost }], total }
  async function summary(range = 'month') {
    await load();
    const today = dayKey();
    const month = today.slice(0, 7);
    const per = {};
    for (const [day, models] of Object.entries(data.days)) {
      if (range === 'today' && day !== today) continue;
      if (range === 'month' && day.slice(0, 7) !== month) continue;
      for (const [m, r] of Object.entries(models)) {
        const a = (per[m] = per[m] || blank());
        for (const k of Object.keys(a)) a[k] += r[k] || 0;
      }
    }
    const rows = Object.entries(per).map(([model, r]) => ({ model, ...r, cost: cost(model, r) })).sort((a, b) => b.cost - a.cost || b.req - a.req);
    const total = rows.reduce((s, r) => s + r.cost, 0);
    return { rows, total };
  }

  async function reset() {
    data = { days: {} };
    await TT.store.kvSet(KEY, data);
    TT.bus.emit('usage:changed');
  }

  TT.usage = { DEFAULT_PRICES, fromGemini, record, price, cost, summary, reset, models: async () => { await load(); return [...new Set(Object.values(data.days).flatMap((d) => Object.keys(d)))]; } };
})();
