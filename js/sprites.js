/* 作品設定：角色立繪（表情、動作、姿勢，種類自由新增）、主角立繪、特殊場景圖、背景圖。
 * 匯入（可自動去背）、以立繪／表情／場景圖為參考自由改寫生成、依目前劇情撰寫畫法、
 * 同一角色不同叫法的辨識、從其他作品套用、素材包匯出匯入 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));
  const rand = () => Math.floor(Math.random() * 2147483647);

  // 匯入多張立繪時，依檔名猜表情
  const NAME_RULES = [
    [/平常|普通|通常|neutral|normal|default|base|idle|standard/i, '平常'],
    [/微笑|smile|smiling/i, '微笑'],
    [/開心|高興|大笑|happy|joy|laugh|grin/i, '開心'],
    [/生氣|憤怒|angry|anger|mad|rage/i, '生氣'],
    [/難過|悲傷|哭|sad|cry|tear/i, '難過'],
    [/驚訝|吃驚|surprise|shock/i, '驚訝'],
    [/害羞|臉紅|shy|blush|embarrass/i, '害羞'],
    [/認真|嚴肅|serious|determined|stern/i, '認真'],
  ];

  // 新增種類時的建議：不只表情，動作、姿勢、服裝都可以
  const POSE_PRESETS = [
    ['雙手抱胸', '雙手抱胸，下巴微抬，一臉不服氣'],
    ['托腮思考', '一手托腮，若有所思地看向一旁'],
    ['揮手招呼', '笑著舉起手揮手打招呼'],
    ['掩面哭泣', '用雙手掩面哭泣，肩膀微微顫抖'],
    ['拔劍備戰', '拔出武器擺出戰鬥架勢，眼神銳利'],
    ['受傷', '按著傷口，表情痛苦，衣服有破損'],
    ['生氣叉腰', '雙手叉腰，氣鼓鼓地瞪著對方'],
    ['臉紅別過頭', '臉紅地把頭別到一邊，不敢看對方'],
    ['便服', '換上輕便的日常便服，神情放鬆'],
    ['睡衣', '穿著睡衣，頭髮微亂，睡眼惺忪'],
    ['閉眼熟睡', '閉著眼睛熟睡，表情放鬆'],
  ];

  // 特殊場景圖的常用種類（沒有圖之前只是空格，不會告訴 AI）
  const CG_PRESETS = [
    ['擁抱', '兩人相擁的時候'],
    ['親吻', '接吻的時候'],
    ['牽手', '牽手、並肩同行的時候'],
    ['告白', '告白或表露心意的時候'],
    ['哭泣', '角色落淚、需要安慰的時候'],
    ['受傷', '角色受傷、被救助或包紮的時候'],
    ['打鬥', '戰鬥、交手的時候'],
    ['R18', '成年角色之間的親密場面'],
  ];

  // 背景的建議地點（點了只會先填好名稱，畫法自己寫或交給 AI）
  const BG_PRESETS = ['房間', '街道', '森林', '城鎮廣場', '酒館', '宮殿大殿', '夜空', '雨中街頭', '學校教室', '戰場'];

  const defaultKeys = () => TT.img.EXPRESSIONS.map(([k]) => k);

  /* ---------- 擁有者：作品（角色卡）或主角 ---------- */
  // 角色立繪存在作品上；主角的立繪存在主角（persona）上，所有作品共用
  const isPersona = (o) => !!o && TT.store.personas.includes(o);
  const ownerById = (id) => TT.store.getCard(id) || TT.store.getPersona(id);
  const saveOwner = (o) => (isPersona(o) ? TT.store.savePersona(o) : TT.store.saveCard(o));

  /* ---------- 立繪種類 ---------- */
  // 每個角色的立繪種類：八種預設表情＋自己新增的（名稱＋說明，表情、動作、姿勢、服裝都可以）
  function kinds(owner, name) {
    const base = TT.img.EXPRESSIONS.map(([key, en]) => ({ key, prompt: en, desc: '', custom: false }));
    const isBase = (k) => base.some((b) => b.key === k);
    const own = (((owner && owner.poseKinds) || {})[name] || [])
      .filter((k) => k && k.key && !isBase(k.key))
      .map((k) => ({ key: k.key, prompt: k.desc || k.key, desc: k.desc || '', custom: true }));
    const set = ((owner && owner.expr) || {})[name] || {};
    const extra = Object.keys(set)
      .filter((k) => !isBase(k) && !own.some((o) => o.key === k))
      .map((k) => ({ key: k, prompt: k, desc: '', custom: true }));
    return [...base, ...own, ...extra];
  }
  const missing = (owner, name) => {
    const set = ((owner && owner.expr) || {})[name] || {};
    return kinds(owner, name).filter((k) => !set[k.key]);
  };

  function setKind(owner, name, { key, desc = '' }, oldKey = '') {
    key = String(key || '').trim().slice(0, 16);
    if (!key) return null;
    const list = (((owner.poseKinds || {})[name]) || []).filter((k) => k.key !== (oldKey || key) && k.key !== key);
    list.push({ key, desc: String(desc || '').trim() });
    owner.poseKinds = { ...(owner.poseKinds || {}), [name]: list };
    // 改名：圖片跟著搬到新名稱
    if (oldKey && oldKey !== key) {
      for (const f of ['expr', 'exprCut']) {
        const set = owner[f] && owner[f][name];
        if (set && oldKey in set) { set[key] = set[oldKey]; delete set[oldKey]; }
      }
      TT.media.invalidate('sprite', `${owner.id}|${name}|${oldKey}`);
      TT.media.invalidate('sprite', `${owner.id}|${name}|${key}`);
    }
    return key;
  }

  function removeKind(owner, name, key) {
    if (owner.poseKinds && owner.poseKinds[name]) owner.poseKinds[name] = owner.poseKinds[name].filter((k) => k.key !== key);
    removeSprite(owner, name, key);
  }

  /* ---------- 同一角色的不同叫法 ---------- */
  const hasSprites = (owner, n) => !!(owner && n && ((owner.expr && owner.expr[n] && Object.values(owner.expr[n]).some(Boolean)) || (owner.sprites && owner.sprites[n])));
  const spriteNames = (owner) => [...new Set([...Object.keys((owner && owner.expr) || {}), ...Object.keys((owner && owner.sprites) || {})])].filter((n) => hasSprites(owner, n));

  // 劇情裡同一個角色可能用全名、名字或暱稱稱呼：先查登場人物名單與別名表，再比對名字的包含關係（只有一個符合時才算）
  function resolveName(owner, name) {
    const n = String(name || '').trim();
    if (!n || !owner) return null;
    if (hasSprites(owner, n)) return n;
    const listed = TT.cast && !isPersona(owner) && TT.cast.find(owner, n);
    if (listed && hasSprites(owner, listed.name)) return listed.name;
    const al = (owner.spriteAlias || {})[n];
    if (al && hasSprites(owner, al)) return al;
    const pair = [owner.name, owner.nickname].filter(Boolean);
    if (pair.includes(n)) { const o = pair.find((x) => x !== n && hasSprites(owner, x)); if (o) return o; }
    const clean = n.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').trim();
    if (clean && clean !== n && hasSprites(owner, clean)) return clean;
    const hits = spriteNames(owner).filter((x) => (x.length >= 2 && n.includes(x)) || (n.length >= 2 && x.includes(n)));
    return hits.length === 1 ? hits[0] : null;
  }

  const aliasesOf = (owner, who) => Object.entries(owner.spriteAlias || {}).filter(([, c]) => c === who).map(([a]) => a);
  function setAliases(owner, who, list) {
    const al = { ...(owner.spriteAlias || {}) };
    for (const [a, c] of Object.entries(al)) if (c === who) delete al[a];
    for (const a of list) { const x = String(a).trim(); if (x && x !== who) al[x] = who; }
    owner.spriteAlias = al;
  }

  // 依表情或動作挑一張：名稱完全相同 → 自訂種類裡字詞最接近的 → 預設表情 → 平常
  const grams = (s) => {
    const t = String(s || '').toLowerCase().replace(/[\s、，,。.！!？?（）()「」『』:：;；]/g, '');
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const likeness = (a, b) => {
    if (!a || !b) return 0;
    if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return 10;
    const A = grams(a);
    let n = 0;
    for (const g of grams(b)) if (A.has(g)) n++;
    return n;
  };
  function pick(owner, name, emo) {
    const who = resolveName(owner, name);
    if (!who) return null;
    const set = (owner.expr || {})[who] || {};
    const e = String(emo || '').trim();
    let key = e && set[e] ? e : '';
    if (!key && e) {
      let best = 1;
      for (const k of kinds(owner, who)) {
        if (!set[k.key]) continue;
        const s = Math.max(likeness(e, k.key), k.desc ? likeness(e, k.desc) : 0);
        if (s > best) { best = s; key = k.key; }
      }
      if (!key) { const d = TT.img.exprKey(e); if (set[d]) key = d; }
    }
    if (!key && set['平常']) key = '平常';
    return { name: who, key };
  }

  /* ---------- 圖片處理 ---------- */
  async function drawn(blob, max) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await TT.loadImage(url);
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      return { c, g: c.getContext('2d', { willReadFrequently: true }), img };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 上緣大多透明 → 已經是去背好的立繪
  async function isTransparent(blob) {
    const { c, g, img } = await drawn(blob, 96);
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, 1).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 16) clear++;
    return clear > c.width * 0.6;
  }

  // 透明的地方補上底色（給圖像模型當參考圖用）
  async function flatten(blob, color = '#00ff00', max = 1024) {
    const { c, g, img } = await drawn(blob, max);
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  // 匯入的圖：可選自動去背；透明 PNG 保持透明，一律縮到合理大小
  // raw 是生成其他表情時的參考圖（去背前的原圖）
  async function prepare(file, cut) {
    const transparent = await isTransparent(file);
    if (cut && !transparent) {
      const c = await TT.img.cutout(file);
      if (c) return { blob: c, cut: true, raw: await TT.resizeImageBlob(file, 1600, 'image/png') };
    }
    const blob = await TT.resizeImageBlob(file, 1600, transparent ? 'image/png' : 'image/jpeg', 0.92);
    return { blob, cut: transparent, raw: blob };
  }

  function setSprite(owner, name, key, { blob, cut, raw: rawBlob }) {
    owner.expr = { ...(owner.expr || {}), [name]: { ...((owner.expr || {})[name] || {}), [key]: blob } };
    owner.exprCut = { ...(owner.exprCut || {}), [name]: { ...((owner.exprCut || {})[name] || {}), [key]: !!cut } };
    if (key === '平常') {
      owner.sprites = { ...(owner.sprites || {}), [name]: blob };
      owner.spriteCut = { ...(owner.spriteCut || {}), [name]: !!cut };
      // 生成其他表情時用的參考圖
      owner.spriteRaw = { ...(owner.spriteRaw || {}), [name]: rawBlob || blob };
      TT.media.invalidate('sprite', `${owner.id}|${name}`);
    }
    TT.media.invalidate('sprite', `${owner.id}|${name}|${key}`);
  }

  function removeSprite(owner, name, key) {
    if (owner.expr && owner.expr[name]) delete owner.expr[name][key];
    if (owner.exprCut && owner.exprCut[name]) delete owner.exprCut[name][key];
    if (key === '平常') {
      for (const f of ['sprites', 'spriteCut', 'spriteRaw']) if (owner[f]) delete owner[f][name];
      TT.media.invalidate('sprite', `${owner.id}|${name}`);
    }
    TT.media.invalidate('sprite', `${owner.id}|${name}|${key}`);
  }

  // 指定 slot 就放進那一格；否則依檔名找種類（預設表情或自訂種類），
  // 檔名是中文名稱（例如「揮手招呼.png」）就新增成一個種類，其餘依序補空格（平常優先）
  async function importSprites(owner, name, files, { slot = '', cut = true } = {}) {
    const placed = [];
    const rest = [];
    const used = new Set();
    for (const f of files) {
      const stem = String(f.name || '').replace(/\.[^.]+$/, '').trim();
      // 去掉檔名裡的角色名與編號，剩下的才是種類名稱（例如「白明雲_揮手招呼02」→「揮手招呼」）
      const label = stem.split(name).join('').replace(/立繪|表情|差分|圖片|sprite|expression/gi, '').replace(/^[\s_\-・.]+|[\s_\-・.\d]+$/g, '');
      let key = slot && !placed.length ? slot : '';
      if (!key) {
        const own = kinds(owner, name).find((k) => k.custom && !used.has(k.key) && label && likeness(label, k.key) >= 10);
        // 預設表情只在檔名沒有其他中文描述時才算（「害羞別過頭」是新的種類，不是「害羞」）
        const r = NAME_RULES.find(([re]) => re.test(label || stem) && !/[㐀-鿿]/.test((label || stem).replace(re, '')));
        if (own) key = own.key;
        else if (r && !used.has(r[1])) key = r[1];
        else if (/[㐀-鿿]{2,}/.test(label) && !/^(圖片|圖像|未命名|新增|螢幕|截圖|立繪)/.test(label)) key = setKind(owner, name, { key: label });
      }
      if (key && !used.has(key)) { used.add(key); placed.push([key, f]); } else rest.push(f);
    }
    const have = (owner.expr && owner.expr[name]) || {};
    for (const f of rest) {
      const ks = defaultKeys();
      const key = ks.find((k) => !used.has(k) && !have[k]) || ks.find((k) => !used.has(k));
      if (!key) break;
      used.add(key);
      placed.push([key, f]);
    }
    for (const [key, f] of placed) setSprite(owner, name, key, await prepare(f, cut));
    await saveOwner(owner);
    return placed.map(([k]) => k);
  }

  /* ---------- 重複利用：其他作品的同名角色 ---------- */
  function findElsewhere(card, name) {
    const out = [];
    for (const c of TT.store.cards) {
      if (c.id === card.id) continue;
      const who = resolveName(c, name);
      if (!who) continue;
      const n = Object.values((c.expr || {})[who] || {}).filter(Boolean).length || 1;
      out.push({ card: c, name: who, count: n });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  // 把 from 上 fromName 的立繪（含自訂種類）複製到 to 的 toName
  async function copySprites(from, fromName, to, toName) {
    const pickOf = (f) => (from[f] || {})[fromName];
    to.expr = { ...(to.expr || {}), [toName]: { ...((to.expr || {})[toName] || {}), ...(pickOf('expr') || {}) } };
    to.exprCut = { ...(to.exprCut || {}), [toName]: { ...((to.exprCut || {})[toName] || {}), ...(pickOf('exprCut') || {}) } };
    for (const f of ['sprites', 'spriteCut', 'spriteRaw']) if (pickOf(f) != null) to[f] = { ...(to[f] || {}), [toName]: pickOf(f) };
    const ks = (from.poseKinds || {})[fromName] || [];
    if (ks.length) {
      const mine = ((to.poseKinds || {})[toName] || []).filter((k) => !ks.some((x) => x.key === k.key));
      to.poseKinds = { ...(to.poseKinds || {}), [toName]: [...mine, ...ks.map((k) => ({ ...k }))] };
    }
    TT.media.invalidate('sprite', `${to.id}|${toName}`);
    Object.keys(to.expr[toName] || {}).forEach((k) => TT.media.invalidate('sprite', `${to.id}|${toName}|${k}`));
    await saveOwner(to);
  }

  // 和 copySprites 一樣，但只補上 to 還沒有的種類，已經有的圖不蓋掉（匯入別人的書、別本書的角色用）；不存檔，回傳補了幾張
  function fillSprites(from, fromName, to, toName) {
    const src = (from.expr || {})[fromName] || {};
    const have = (to.expr || {})[toName] || {};
    let n = 0;
    for (const [k, blob] of Object.entries(src)) {
      if (!blob || have[k]) continue;
      setSprite(to, toName, k, { blob, cut: !!(((from.exprCut || {})[fromName] || {})[k]), raw: k === '平常' ? (from.spriteRaw || {})[fromName] || blob : null });
      n++;
    }
    // 舊版只有一張立繪、沒有表情
    if (!Object.keys(src).length && (from.sprites || {})[fromName] && !hasSprites(to, toName)) {
      setSprite(to, toName, '平常', { blob: from.sprites[fromName], cut: !!(from.spriteCut || {})[fromName], raw: (from.spriteRaw || {})[fromName] });
      n++;
    }
    for (const k of (from.poseKinds || {})[fromName] || []) if (!(((to.poseKinds || {})[toName]) || []).some((x) => x.key === k.key)) setKind(to, toName, k);
    return n;
  }

  // 把 from 的立繪（含自訂種類、別名）併到 to：同一個角色在整理名單前用了別的名字時使用；to 已經有的圖保留
  async function mergeName(owner, from, to) {
    if (!from || !to || from === to) return;
    const oldKeys = Object.keys(((owner.expr || {})[from]) || {});
    for (const f of ['expr', 'exprCut', 'sprites', 'spriteCut', 'spriteRaw']) {
      const src = (owner[f] || {})[from];
      if (src == null) continue;
      const cur = (owner[f] || {})[to];
      owner[f] = { ...(owner[f] || {}), [to]: f === 'expr' || f === 'exprCut' ? { ...src, ...(cur || {}) } : cur != null ? cur : src };
      delete owner[f][from];
    }
    const ks = (owner.poseKinds || {})[from];
    if (ks) {
      const mine = owner.poseKinds[to] || [];
      owner.poseKinds = { ...owner.poseKinds, [to]: [...mine, ...ks.filter((k) => !mine.some((m) => m.key === k.key))] };
      delete owner.poseKinds[from];
    }
    const al = { ...(owner.spriteAlias || {}) };
    for (const [a, c] of Object.entries(al)) if (c === from) al[a] = to;
    al[from] = to;
    owner.spriteAlias = al;
    for (const n of [from, to]) {
      TT.media.invalidate('sprite', `${owner.id}|${n}`);
      [...oldKeys, ...Object.keys(((owner.expr || {})[to]) || {})].forEach((k) => TT.media.invalidate('sprite', `${owner.id}|${n}|${k}`));
    }
    await saveOwner(owner);
  }

  // 整理好登場人物名單後，名單外但其實是名單上某個角色（別名、稱謂、名字的一部分）的立繪，併到名單上的名字，避免同一人出現兩次
  async function tidyNames(card) {
    if (!TT.cast.list(card).length) return 0;
    let n = 0;
    for (const name of spriteNames(card)) {
      if (TT.cast.find(card, name) && TT.cast.find(card, name).name === name) continue;
      const to = TT.cast.canon(card, name);
      if (to !== name && TT.cast.find(card, to)) { await mergeName(card, name, to); n++; }
    }
    return n;
  }

  /* ---------- 特殊場景圖與背景圖（各自一份清單：{ id, name, desc, prompt, blob }） ---------- */
  const LISTS = { cg: 'cgs', bg: 'bgs' };
  const entries = (card, type) => (card && card[LISTS[type]]) || [];
  function findIn(card, type, name, { fuzzy = true } = {}) {
    const list = entries(card, type).filter((g) => g.blob);
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const exact = list.find((g) => String(g.id) === String(name).trim())
      || list.find((g) => String(g.name || '').trim().toLowerCase() === n);
    if (exact || !fuzzy) return exact || null;
    return list.find((g) => { const x = String(g.name || '').trim().toLowerCase(); return x && (x.includes(n) || n.includes(x)); }) || null;
  }
  // CG 只能由完整名稱或內部 ID 觸發，避免相似名稱誤顯示另一張圖；背景仍允許模糊配對。
  const findCg = (card, name) => findIn(card, 'cg', name, { fuzzy: false });
  const findBg = (card, name) => findIn(card, 'bg', name);
  // 場景描述沒指定背景名時，挑名稱或說明字詞最接近的背景
  function matchBg(card, text) {
    let best = null;
    let score = 2;
    for (const g of entries(card, 'bg')) {
      if (!g.blob) continue;
      const s = Math.max(likeness(text, g.name), g.desc ? likeness(text, g.desc) : 0);
      if (s > score) { score = s; best = g; }
    }
    return best;
  }

  async function addEntry(card, type, { name, desc = '', blob = null, prompt = '' }) {
    const g = { id: TT.uid(), name: String(name || (type === 'bg' ? '背景' : '特殊場景')).trim(), desc, blob, prompt, createdAt: Date.now() };
    card[LISTS[type]] = [...entries(card, type), g];
    await TT.store.saveCard(card);
    return g;
  }
  async function setEntryImage(card, type, id, blob, prompt) {
    const g = entries(card, type).find((x) => x.id === id);
    if (!g) return null;
    g.blob = blob;
    if (prompt != null) g.prompt = prompt;
    TT.media.invalidate(type, `${card.id}|${id}`);
    await TT.store.saveCard(card);
    return g;
  }
  async function removeEntry(card, type, id) {
    card[LISTS[type]] = entries(card, type).filter((g) => g.id !== id);
    TT.media.invalidate(type, `${card.id}|${id}`);
    await TT.store.saveCard(card);
  }
  const addCg = (card, o) => addEntry(card, 'cg', o);
  const setCgImage = (card, id, blob, prompt) => setEntryImage(card, 'cg', id, blob, prompt);
  const removeCg = (card, id) => removeEntry(card, 'cg', id);

  /* ---------- 生成（全部排進生成佇列，可以暫停或停止） ---------- */
  // 參考圖：{ blob, sprite }（立繪先補上底色再送出）
  async function refBlobs(refs, color) {
    const out = [];
    for (const r of (refs || []).slice(0, 3)) out.push(r.sprite ? await flatten(r.blob, color, 1024) : await TT.resizeImageBlob(r.blob, 1024, 'image/png'));
    return out;
  }
  const spriteStyle = (owner) => TT.img.styleText(isPersona(owner) ? null : owner).replace(/,?\s*(detailed background|dramatic lighting|volumetric lighting)/gi, '');

  // 生成或改寫一張立繪：參考圖＋自由描述（表情、動作、姿勢、服裝、道具都可以），畫好自動去背放進那一格
  // retry：沒畫出來時，使用者按「重試」會重新打開生成設定（不會自動重試）
  function generateSprite(owner, who, key, { prompt, refs = [], keep = true, retry = null }) {
    return TT.img.enqueueTask({
      key: `spr|${owner.id}|${who}|${key}`,
      label: `立繪：${who}・${key}`,
      cardId: owner.id,
      retry,
      fn: async (signal, rep) => {
        const [width, height] = TT.img.dims({ ...TT.settings.image, aspect: 'portrait', size: '' });
        const ref = await refBlobs(refs, '#00ff00');
        const positive = ref.length
          ? `Redraw the character from the first reference image as a standing visual-novel character sprite. ${keep ? 'Keep the identical face, hairstyle, eye color, outfit, body proportions and art style, except what the description changes.' : 'Keep the same character identity (face, hairstyle, eye color) and art style; anything else may change.'} Character now: ${prompt}. Expression, pose, gesture, props and clothing may change freely to match the description. Single character only, upper body to thighs, centered, on a solid flat bright green background (#00FF00). No text.`
          : `${spriteStyle(owner)}. Standing visual-novel character sprite: ${prompt}. Single character only, upper body to thighs, centered, facing the viewer, on a solid flat bright green background (#00FF00). No text.`;
        const out = await TT.img.generate({ positive, negative: '', width, height, seed: rand(), refs: ref }, { signal, report: rep });
        if (!(out instanceof Blob)) throw new Error('圖片無法下載保存（跨域限制）');
        const cut = await TT.img.cutout(out);
        const fresh = ownerById(owner.id) || owner;
        setSprite(fresh, who, key, { blob: cut || out, cut: !!cut, raw: out });
        await saveOwner(fresh);
        return key;
      },
    });
  }

  // 特殊場景圖（直式事件圖）或背景圖（橫式、沒有人物）；replaceId：重畫既有的那一張
  function generateScene(card, type, { name, desc = '', prompt, refs = [], replaceId = '', retry = null }) {
    return TT.img.enqueueTask({
      key: `${type}|${card.id}|${name}`,
      label: `${type === 'bg' ? '背景圖' : '特殊場景圖'}：${name}`,
      cardId: card.id,
      retry,
      fn: async (signal, rep) => {
        const st = TT.settings.image;
        const [width, height] = TT.img.dims({ ...st, aspect: type === 'bg' ? 'landscape' : 'portrait', size: '' });
        const ref = await refBlobs(refs, '#ffffff');
        const style = TT.img.styleText(card);
        const positive = type === 'bg'
          ? `${ref.length ? 'Use the reference image as the base: keep its art style, layout and lighting, and change it as described. ' : ''}Visual novel background art with no people and no characters: ${prompt}. ${style}. Wide establishing shot, detailed environment. No text.`
          : `${ref.length ? `The character${ref.length > 1 ? 's' : ''} from the reference image${ref.length > 1 ? 's' : ''} (keep the same faces, hairstyles, eye colors, outfits and art style). ` : ''}Event illustration, vertical composition: ${prompt}. ${style}. No text, no speech bubbles, no frame.`;
        const out = await TT.img.generate({ positive, negative: type === 'bg' ? [st.negative, 'people, person, character, crowd'].filter(Boolean).join(', ') : st.negative || '', width, height, seed: rand(), refs: ref }, { signal, report: rep });
        if (!(out instanceof Blob)) throw new Error('圖片無法下載保存（跨域限制）');
        const fresh = TT.store.getCard(card.id) || card;
        const same = replaceId && entries(fresh, type).find((g) => g.id === replaceId);
        if (same) { if (desc) same.desc = desc; return setEntryImage(fresh, type, same.id, out, prompt); }
        return addEntry(fresh, type, { name, desc, blob: out, prompt });
      },
    });
  }
  const generateCg = (card, o) => generateScene(card, 'cg', o);
  const generateBg = (card, o) => generateScene(card, 'bg', o);

  // 用 AI 從角色卡整理故事裡的主要地點，先建好背景的空格（名稱、說明、畫法），之後再匯入或生成
  async function suggestBgs(card) {
    const prompt = `下面是一張角色扮演角色卡的資料。請列出故事裡最常出現、最重要的地點（最多 8 個），用來準備背景圖。
只輸出一個 JSON 物件：{"places":[{"name":"2～6 個字的地點名稱","desc":"什麼時候用（一句中文）","prompt":"English background prompt: place, architecture, furniture, time of day, lighting, mood (no people)"}]}

【角色卡名稱】${card.name}
【資料】
${TT.cast.cardText(card)}`;
    const out = await TT.llm.complete([{ role: 'user', content: prompt }], { maxTokens: 12000, json: true, cfg: { thinking: 'low' } });
    const arr = TT.cast.parseJson(out, '[');
    let n = 0;
    for (const x of Array.isArray(arr) ? arr : []) {
      const name = String((x && x.name) || '').trim().slice(0, 16);
      if (!name || entries(card, 'bg').some((g) => g.name === name)) continue;
      card.bgs = [...entries(card, 'bg'), { id: TT.uid(), name, desc: String(x.desc || '').trim(), prompt: String(x.prompt || '').trim(), blob: null, createdAt: Date.now() }];
      n++;
    }
    await TT.store.saveCard(card);
    return n;
  }

  /* ---------- 素材包（保存、搬到別的作品） ---------- */
  async function exportPack(card, only = null) {
    const chars = spriteNames(card).filter((n) => !only || only.includes(n));
    const data = {
      type: 'tavern-toon-assets',
      version: 2,
      cardName: card.name,
      exportedAt: new Date().toISOString(),
      chars: Object.fromEntries(chars.map((n) => [n, {
        expr: (card.expr || {})[n] || {},
        exprCut: (card.exprCut || {})[n] || {},
        sprite: (card.sprites || {})[n] || null,
        spriteCut: !!(card.spriteCut || {})[n],
        spriteRaw: (card.spriteRaw || {})[n] || null,
        kinds: (card.poseKinds || {})[n] || [],
        alias: aliasesOf(card, n),
      }])),
      castList: only ? [] : TT.cast.list(card),
      cgs: only ? [] : entries(card, 'cg').map((g) => ({ name: g.name, desc: g.desc || '', prompt: g.prompt || '', blob: g.blob })),
      bgs: only ? [] : entries(card, 'bg').map((g) => ({ name: g.name, desc: g.desc || '', prompt: g.prompt || '', blob: g.blob })),
    };
    return JSON.stringify(await TT.encodeBlobs(data));
  }

  function parsePack(text) {
    let data;
    try { data = TT.decodeBlobs(JSON.parse(text)); } catch (e) { throw new Error('素材包格式錯誤'); }
    if (!data || data.type !== 'tavern-toon-assets') throw new Error('這不是漫劇卡的素材包');
    return data;
  }

  // rename：{ 素材包裡的角色名: 要放到的角色名 }
  async function importPack(card, data, rename = {}) {
    let chars = 0;
    for (const [src, c] of Object.entries(data.chars || {})) {
      const name = rename[src] || src;
      card.expr = { ...(card.expr || {}), [name]: { ...((card.expr || {})[name] || {}), ...(c.expr || {}) } };
      card.exprCut = { ...(card.exprCut || {}), [name]: { ...((card.exprCut || {})[name] || {}), ...(c.exprCut || {}) } };
      if (c.sprite) {
        card.sprites = { ...(card.sprites || {}), [name]: c.sprite };
        card.spriteCut = { ...(card.spriteCut || {}), [name]: !!c.spriteCut };
      }
      if (c.spriteRaw) card.spriteRaw = { ...(card.spriteRaw || {}), [name]: c.spriteRaw };
      for (const k of c.kinds || []) setKind(card, name, k);
      if ((c.alias || []).length) setAliases(card, name, [...aliasesOf(card, name), ...c.alias]);
      TT.media.invalidate('sprite', `${card.id}|${name}`);
      Object.keys(card.expr[name]).forEach((k) => TT.media.invalidate('sprite', `${card.id}|${name}|${k}`));
      chars++;
    }
    for (const c of data.castList || []) if (!TT.cast.find(card, c.name)) TT.cast.upsert(card, c.name, c);
    let scenes = 0;
    for (const type of ['cg', 'bg']) {
      for (const g of data[LISTS[type]] || []) {
        const same = entries(card, type).find((x) => x.name === g.name);
        if (same) { same.desc = g.desc || same.desc; same.prompt = g.prompt || same.prompt; if (g.blob instanceof Blob) await setEntryImage(card, type, same.id, g.blob); }
        else await addEntry(card, type, { ...g, blob: g.blob instanceof Blob ? g.blob : null });
        scenes++;
      }
    }
    await TT.store.saveCard(card);
    return { chars, cgs: (data.cgs || []).length, bgs: (data.bgs || []).length, scenes };
  }

  /* ---------- 可以當參考圖的圖：所有立繪、表情、特殊場景圖、背景、角色卡圖 ---------- */
  function refChoices(card, persona) {
    const out = [];
    const add = (owner, who) => {
      const set = (owner.expr || {})[who] || {};
      for (const k of kinds(owner, who)) if (set[k.key]) out.push({ id: `s|${owner.id}|${who}|${k.key}`, label: `${who}・${k.key}`, media: `sprite:${owner.id}|${who}|${k.key}`, blob: set[k.key], sprite: true, who, key: k.key });
      if (!Object.keys(set).length && owner.sprites && owner.sprites[who]) out.push({ id: `s|${owner.id}|${who}|`, label: who, media: `sprite:${owner.id}|${who}`, blob: owner.sprites[who], sprite: true, who, key: '' });
    };
    for (const n of spriteNames(card)) add(card, n);
    if (persona) for (const n of spriteNames(persona)) add(persona, n);
    for (const g of entries(card, 'cg')) if (g.blob) out.push({ id: `c|${g.id}`, label: `特殊場景・${g.name}`, media: `cg:${card.id}|${g.id}`, blob: g.blob });
    for (const g of entries(card, 'bg')) if (g.blob) out.push({ id: `b|${g.id}`, label: `背景・${g.name}`, media: `bg:${card.id}|${g.id}`, blob: g.blob });
    if (card.avatar) out.push({ id: 'card', label: '角色卡圖', media: `card:${card.id}`, blob: card.avatar });
    return out;
  }

  // 生成／改寫一張圖的設定：畫法自由填寫，可以選最多三張參考圖（第一張是要改寫的那張）。
  // 不想自己寫時按「AI 構想」；從遊玩畫面打開時可以「依目前劇情撰寫」；上次沒畫出來時顯示原因（notice），
  // 可以按「改寫成含蓄的畫法」再自己決定要不要重試
  // o: { type: sprite|cg|bg, title, name, nameEditable, desc, prompt, refs, selected, ctx, card, persona, who, apply, okText, notice }
  function genForm(o) {
    const choices = o.refs.slice();
    const sel = [...new Set(o.selected || [])].filter((id) => choices.some((c) => c.id === id)).slice(0, 3);
    let ups = 0;
    const labels = {
      sprite: ['說明（AI 演出時用來挑這張立繪）', '例如：笑著舉起手揮手打招呼', '畫法（中英文皆可，自由描述表情、動作、姿勢、服裝、道具；留空就照說明畫）'],
      cg: ['什麼場面用（寫給 AI 看）', '例如：兩人在雨中相擁的時候', '畫面內容（中英文皆可，自由描述）'],
      bg: ['什麼地點、什麼時候用（寫給 AI 看）', '例如：夜行書店的店內，晚上', '畫面內容（中英文皆可；不要寫人物）'],
    }[o.type];
    // 特殊場景圖的縮圖預設模糊（避免提前看到劇情畫面）
    const thumbs = () => choices.map((c) => String(html`<button class="gen-ref ${sel.includes(c.id) ? 'on' : ''} ${c.id.startsWith('c|') ? 'spoiler' : ''}" data-ref="${c.id}" title="${c.label}">
      <img ${c.media ? html`data-media="${c.media}"` : html`src="${c.url || ''}"`} alt=""><small>${c.label}</small>${sel.includes(c.id) ? html`<b>${sel.indexOf(c.id) + 1}</b>` : ''}</button>`)).join('');
    return TT.sheet({
      title: o.title,
      wide: true,
      className: 'gen-sheet',
      body: html`
        ${o.notice ? html`<div class="gen-notice">${icon('alert', 15)}<span>${o.notice}</span></div>` : ''}
        <label class="field"><span>名稱${o.type === 'sprite' ? '（AI 用 [SAY:角色名|名稱] 叫出這張）' : o.type === 'cg' ? '（AI 用 [CG:名稱] 叫出這張）' : '（AI 用 [BG:名稱] 換成這個背景）'}</span><input class="input" data-f="name" value="${o.name || ''}" ${o.nameEditable ? '' : 'readonly'} maxlength="16"></label>
        <label class="field"><span>${labels[0]}</span><input class="input" data-f="desc" value="${o.desc || ''}" placeholder="${labels[1]}"></label>
        <label class="field"><span>${labels[2]}</span><textarea class="input" rows="3" data-f="prompt">${o.prompt || ''}</textarea></label>
        <div class="btn-row wrap">
          ${o.card ? html`<button class="btn small" data-g="conceive">${icon('sparkles', 16)} AI 構想畫法</button>` : ''}
          ${o.ctx ? html`<button class="btn small" data-g="story">${icon('feather', 16)} 依目前劇情撰寫</button>` : ''}
          <button class="btn small" data-g="soften" title="把畫法改成比較容易通過圖像審查的含蓄描述">${icon('wand', 16)} 改寫成含蓄的畫法</button>
        </div>
        <p class="hint" data-g="aimsg"></p>
        <div class="gen-refs">
          <span>參考圖（最多 3 張，第 1 張是要改寫的那張；不選就從頭畫）</span>
          <div class="gen-ref-list" data-g="refs">${raw(thumbs())}</div>
          <button class="btn small" data-g="upload">${icon('upload', 14)} 上傳參考圖</button>
        </div>
        ${o.type === 'sprite' ? html`<label class="check"><input type="checkbox" data-f="keep" checked> 保持角色的長相與服裝（只改畫法裡提到的部分）</label>` : ''}
        ${o.apply ? html`<label class="check"><input type="checkbox" data-f="apply" checked> ${o.apply}</label>` : ''}
        <p class="hint">圖像服務能畫什麼由服務本身的內容規範決定；安全過濾可在「設定 → 圖像生成」關閉。</p>`,
      actions: [{ label: '取消', value: null }, { label: o.okText || '開始生成', primary: true, onClick: (el, close) => {
        const f = (k) => { const x = el.querySelector(`[data-f="${k}"]`); return x ? (x.type === 'checkbox' ? x.checked : x.value.trim()) : ''; };
        const r = { name: f('name'), desc: f('desc'), prompt: f('prompt') || f('desc'), keep: f('keep') !== false, apply: !!f('apply') };
        if (!r.name) { TT.toast('請填寫名稱'); return false; }
        if (!r.prompt) { TT.toast('請填寫說明或畫法'); return false; }
        r.refs = sel.map((id) => choices.find((c) => c.id === id)).filter(Boolean);
        close(r);
        return false;
      } }],
      onMount: (el) => {
        TT.media.hydrate(el);
        const list = el.querySelector('[data-g="refs"]');
        const redraw = () => { list.innerHTML = thumbs(); TT.media.hydrate(list); };
        // 從「依目前劇情生成」打開：一打開就請 AI 依劇情撰寫
        if (o.autoStory && o.ctx) setTimeout(() => { const b = el.querySelector('[data-g="story"]'); if (b) b.click(); }, 60);
        el.addEventListener('click', async (e) => {
          const r = e.target.closest('[data-ref]');
          if (r) {
            const id = r.dataset.ref;
            const i = sel.indexOf(id);
            if (i >= 0) sel.splice(i, 1);
            else { if (sel.length >= 3) sel.shift(); sel.push(id); }
            return redraw();
          }
          const g = e.target.closest('[data-g]');
          if (!g) return;
          if (g.dataset.g === 'upload') {
            const [file] = await TT.pickFiles({ accept: 'image/*' });
            if (!file) return;
            const blob = await TT.resizeImageBlob(file, 1600, 'image/png');
            const id = `u|${++ups}`;
            choices.unshift({ id, label: `上傳：${TT.truncate(file.name || '圖片', 10)}`, url: URL.createObjectURL(blob), blob, sprite: false });
            if (sel.length >= 3) sel.pop();
            sel.unshift(id);
            return redraw();
          }
          // AI 撰寫：依目前劇情、依名稱與角色資料構想，或把畫法改成含蓄的描述
          const kind = g.dataset.g;
          if (kind !== 'story' && kind !== 'conceive' && kind !== 'soften') return;
          const msg = el.querySelector('[data-g="aimsg"]');
          const field = (k) => el.querySelector(`[data-f="${k}"]`);
          if (!(await TT.actions.ensureLLM())) return;
          g.disabled = true;
          msg.textContent = { story: '依劇情撰寫中…', conceive: 'AI 構想中…', soften: '改寫中…' }[kind];
          try {
            if (kind === 'soften') {
              const src = field('prompt').value.trim() || field('desc').value.trim();
              if (!src) throw new Error('先寫好畫法或說明');
              field('prompt').value = await TT.img.softenPrompt(src, o.reason || '');
              msg.textContent = '已改寫成含蓄的畫法，可以再修改後按「開始生成」';
            } else {
              const d = kind === 'story'
                ? await TT.engine.describeForImage(o.ctx, { type: o.type, who: o.who || '', at: o.at || null })
                : await TT.engine.conceive({ type: o.type, card: o.card, persona: o.persona, name: field('name').value.trim(), who: o.who || '', desc: field('desc').value.trim() });
              if (o.nameEditable && d.name && (kind === 'story' || !field('name').value.trim())) field('name').value = String(d.name).slice(0, 16);
              if (d.desc) field('desc').value = d.desc;
              if (d.prompt) field('prompt').value = d.prompt;
              msg.textContent = kind === 'story' ? '已依目前劇情填好，可以再修改' : '已由 AI 構想好，可以再修改';
            }
          } catch (err) {
            msg.textContent = '失敗：' + (err.message && !err.status ? err.message : TT.llm.describeError(err));
          }
          g.disabled = false;
        });
      },
    });
  }

  // 「AI 構想」按鈕的共用處理：把 AI 寫好的欄位填進表單（只填有欄位的）
  async function conceiveInto(el, btn, req, map) {
    if (!(await TT.actions.ensureLLM())) return;
    const msg = el.querySelector('[data-g="aimsg"]');
    btn.disabled = true;
    if (msg) msg.textContent = 'AI 構想中…';
    try {
      const d = await TT.engine.conceive(req);
      for (const [k, sel] of Object.entries(map)) { const x = el.querySelector(sel); if (x && d[k]) x.value = String(d[k]); }
      if (msg) msg.textContent = '已由 AI 構想好，可以再修改';
    } catch (err) {
      if (msg) msg.textContent = '失敗：' + TT.llm.describeError(err);
    }
    btn.disabled = false;
  }

  // 新增或修改立繪種類（只有名稱與說明；圖之後匯入或生成）。ctx：{ card, persona, who } 給「AI 構想」用
  function kindForm(existing, ctx = {}) {
    const isNew = !existing;
    const read = (el) => ({ key: el.querySelector('[data-f="key"]').value.trim(), desc: el.querySelector('[data-f="desc"]').value.trim() });
    const finish = (then) => (el, close) => {
      const r = read(el);
      if (!r.key) { TT.toast('請填寫名稱'); return false; }
      close({ ...r, then });
      return false;
    };
    return TT.sheet({
      title: isNew ? '新增立繪種類' : '修改立繪種類',
      body: html`<p class="hint">不只表情：動作、姿勢、服裝（便服、睡衣、受傷）都可以。AI 演出時會依名稱與說明挑最符合當下的一張。</p>
        <label class="field"><span>名稱（AI 用 [SAY:角色名|名稱] 叫出這張）</span><input class="input" data-f="key" value="${existing ? existing.key : ''}" placeholder="例如：揮手招呼" maxlength="16"></label>
        <label class="field"><span>說明（寫給 AI 與繪圖用，中英文皆可）</span><textarea class="input" rows="2" data-f="desc" placeholder="例如：笑著舉起手揮手打招呼">${existing ? existing.desc : ''}</textarea></label>
        ${ctx.card ? html`<div class="btn-row"><button class="btn small" data-g="conceive">${icon('sparkles', 16)} AI 構想${isNew ? '名稱與' : ''}說明</button></div><p class="hint" data-g="aimsg"></p>` : ''}
        ${isNew ? html`<div class="chip-row">${POSE_PRESETS.map(([k, d]) => html`<button class="chip" data-preset="${k}" data-desc="${d}">${k}</button>`)}</div>` : ''}`,
      actions: isNew
        ? [{ label: '取消', value: null }, { label: '新增並匯入圖片', onClick: finish('import') }, { label: '新增並生成', primary: true, onClick: finish('gen') }]
        : [{ label: '取消', value: null }, { label: '儲存', primary: true, onClick: finish('') }],
      onMount: (el) => {
        el.addEventListener('click', (e) => {
          const c = e.target.closest('[data-g="conceive"]');
          if (c) {
            const name = el.querySelector('[data-f="key"]').value.trim();
            return conceiveInto(el, c, { type: 'sprite', card: ctx.card, persona: ctx.persona, who: ctx.who, name, desc: el.querySelector('[data-f="desc"]').value.trim() },
              { ...(name ? {} : { name: '[data-f="key"]' }), desc: '[data-f="desc"]' });
          }
          const p = e.target.closest('[data-preset]');
          if (!p) return;
          el.querySelector('[data-f="key"]').value = p.dataset.preset;
          el.querySelector('[data-f="desc"]').value = p.dataset.desc;
        });
      },
    });
  }

  // 修改特殊場景圖或背景的名稱與說明
  function entryForm(type, g, card) {
    return TT.sheet({
      title: `修改${type === 'bg' ? '背景' : '特殊場景圖'}`,
      body: html`<label class="field"><span>名稱</span><input class="input" data-f="name" value="${g.name}" maxlength="16"></label>
        <label class="field"><span>${type === 'bg' ? '什麼地點、什麼時候用' : '什麼場面用'}（寫給 AI 看）</span><input class="input" data-f="desc" value="${g.desc || ''}"></label>
        <label class="field"><span>畫法（重畫時用）</span><textarea class="input" rows="3" data-f="prompt">${g.prompt || ''}</textarea></label>
        ${card ? html`<div class="btn-row"><button class="btn small" data-g="conceive">${icon('sparkles', 16)} AI 構想說明與畫法</button></div><p class="hint" data-g="aimsg"></p>` : ''}`,
      actions: [{ label: '取消', value: null }, { label: '儲存', primary: true, onClick: (el, close) => {
        const f = (k) => el.querySelector(`[data-f="${k}"]`).value.trim();
        if (!f('name')) { TT.toast('請填寫名稱'); return false; }
        close({ name: f('name'), desc: f('desc'), prompt: f('prompt') });
        return false;
      } }],
      onMount: (el) => {
        el.addEventListener('click', (e) => {
          const c = e.target.closest('[data-g="conceive"]');
          if (c) conceiveInto(el, c, { type, card, name: el.querySelector('[data-f="name"]').value.trim(), desc: el.querySelector('[data-f="desc"]').value.trim() }, { desc: '[data-f="desc"]', prompt: '[data-f="prompt"]' });
        });
      },
    });
  }

  /* ---------- 作品設定面板 ---------- */
  // opts.name：先顯示哪個角色；opts.names：劇情裡出現過的角色；opts.tagsOf(name)：外貌標籤；opts.back：返回上一步；
  // opts.tab：chars／hero／cgs／bgs／pack；opts.ctx：從遊玩畫面打開時的劇情（可以依目前劇情生成）
  async function manager(card, opts = {}) {
    const ctx = opts.ctx || null;
    let persona = (ctx && ctx.persona) || opts.persona || TT.store.defaultPersona();
    let tab = opts.tab || 'chars';
    const main = card.nickname || card.name;
    const canon = (n) => TT.cast.canon(card, n, persona);
    // 名單整理前用了別的名字的立繪，先併到名單上的名字（同一人不會出現兩次）
    await tidyNames(card);
    // 已經在劇情裡登場的角色池角色，以及劇情裡出現、還不在角色池的角色（遊玩中打開看這個存檔，否則看這個作品的所有存檔）
    const story = await TT.cast.storyNames(card, persona, ctx ? [ctx.session] : null);
    const appeared = story.appeared;
    const others = story.others;
    const listed = () => TT.cast.list(card).map((c) => c.name);
    // 角色卡名稱不一定是角色（例如作品名）：有名單時，只有在名單上或已經有立繪才列出
    const mainIsChar = () => !listed().length || TT.cast.find(card, main) || hasSprites(card, main);
    // 排序：已登場（有立繪的在前）→ 已登場但沒有立繪 → 還沒登場
    const rank = (n) => (appeared.has(n) ? 0 : 2) + (hasSprites(card, n) ? 0 : 1);
    const order = (n) => { const i = listed().indexOf(n); return i < 0 ? 999 : i; };
    const peopleList = () => [...new Set([...(mainIsChar() ? [canon(main)] : []), ...listed(), ...(opts.names || []).map(canon), ...spriteNames(card)])]
      .filter((n) => n && n !== persona.name && !TT.cast.isExtra(card, n))
      .filter((n) => { const r = resolveName(card, n); return !r || r === n; })
      .sort((a, b) => rank(a) - rank(b) || order(a) - order(b));
    let people = peopleList();
    if (opts.name && opts.name === persona.name) tab = 'hero';
    let who = (opts.name && opts.name !== persona.name && canon(opts.name)) || people[0] || '';
    if (who && !people.includes(who)) people.push(who);
    // 特殊場景圖的預覽先模糊，看過提醒後才顯示（避免提前看到劇情畫面）
    const shown = new Set();
    const tagsOf = (n) => (opts.tagsOf && opts.tagsOf(n)) || ((TT.cast.find(card, n) || {}).appearance) || (n === main ? card.appearance : '') || '';
    let off = () => {};
    const res = await TT.sheet({
      title: `作品設定・${card.name}`,
      wide: true,
      back: opts.back,
      className: 'spm-sheet',
      body: html`<div class="spm">
        <div class="spm-tabs" data-spm="tabs">
          <button data-tab="chars">${icon('users', 15)} 角色</button>
          <button data-tab="hero">${icon('user', 15)} 主角</button>
          <button data-tab="cgs">${icon('image', 15)} 特殊場景</button>
          <button data-tab="bgs">${icon('layers', 15)} 背景</button>
          <button data-tab="pack">${icon('save', 15)} 保存</button>
        </div>
        <div class="spm-pane" data-spm="pane"></div>
        <p class="hint spm-status" data-spm="status"></p>
      </div>`,
      actions: [{ label: '完成', primary: true }],
      onMount: (el) => {
        const $ = (k) => el.querySelector(`[data-spm="${k}"]`);
        const pane = $('pane');
        const status = (t) => { $('status').textContent = t || ''; };
        // 目前編輯的是哪一個立繪擁有者：作品上的角色，或主角本身
        const target = () => (tab === 'hero' ? { owner: persona, name: persona.name } : { owner: card, name: who });

        const needImg = () => {
          if (TT.img.enabled()) return true;
          TT.toast('請先在「設定 → 圖像生成」選擇生成服務', { type: 'error' });
          return false;
        };

        /* --- 共用：立繪格子、生成工作列 --- */
        const gridHTML = (owner, name) => {
          const set = (owner.expr && owner.expr[name]) || {};
          return kinds(owner, name).map((k) => String(html`<button class="spm-slot ${set[k.key] ? 'has' : ''} ${k.custom ? 'custom' : ''}" data-slot="${k.key}" title="${k.desc || k.key}">
              ${set[k.key] ? html`<img data-media="sprite:${owner.id}|${name}|${k.key}" alt="">` : html`<span class="spm-plus">${icon('plus', 20)}</span>`}
              ${TT.img.findJob(`spr|${owner.id}|${name}|${k.key}`) ? html`<span class="spinner"></span>` : ''}
              <small>${k.key}</small></button>`)).join('')
            + String(html`<button class="spm-slot add" data-spm="addkind"><span class="spm-plus">${icon('plus', 22)}</span><small>新增種類</small></button>`);
        };
        const jobsFor = (owner, name) => TT.img.tasks().filter((t) => t.key === `portrait|${owner.id}|${name}` || t.key.startsWith(`spr|${owner.id}|${name}|`) || (!name && t.job.cardId === owner.id));
        const jobsHTML = (list) => list.map((t) => String(html`<div class="spm-job" data-job="${t.key}">
            <span class="spinner ${t.status === 'paused' ? 'still' : ''}"></span>
            <span class="spm-job-t">${t.label}・${{ running: '生成中', queued: '排隊中', pausing: '畫完這張後暫停…', paused: '已暫停', stopping: '停止中…' }[t.status] || ''}${t.total > 1 ? ` ${t.done} / ${t.total}` : ''}${t.cur ? `・${t.cur}` : ''}</span>
            <button class="btn small" data-jobact="${t.status === 'paused' || t.status === 'pausing' ? 'resume' : 'pause'}">${icon(t.status === 'paused' || t.status === 'pausing' ? 'play' : 'pause', 14)} ${t.status === 'paused' || t.status === 'pausing' ? '繼續' : '暫停'}</button>
            <button class="btn small danger" data-jobact="stop">${icon('stop', 14)} 停止</button></div>`)).join('');
        const renderJobs = () => {
          const box = pane.querySelector('[data-spm="jobs"]');
          if (!box) return;
          const t = target();
          box.innerHTML = jobsHTML(tab === 'chars' || tab === 'hero' ? jobsFor(t.owner, t.name) : TT.img.tasks().filter((x) => x.key.startsWith(`${tab === 'cgs' ? 'cg' : 'bg'}|${card.id}|`)));
        };

        /* --- 各分頁 --- */
        const renderChars = () => {
          people = peopleList();
          if (who && !people.includes(who)) people.push(who);
          if (!who) who = people[0];
          const entry = TT.cast.find(card, who) || {};
          const other = hasSprites(card, who) ? [] : findElsewhere(card, who);
          const pool = TT.cast.pool(card);
          const tag = (n) => (!pool.includes(n) ? '・不在角色池' : !appeared.has(n) ? '・未登場' : hasSprites(card, n) ? '' : '・無立繪');
          // 劇情裡出現、還不在角色池的人（路人不算）：點一下加入角色池，之後才有資訊欄
          const extra = Object.keys(others).filter((n) => !pool.includes(n) && !TT.cast.isExtra(card, n) && n !== persona.name);
          pane.innerHTML = String(html`
            <p class="hint spm-pool">${icon('users', 13)} 這裡就是角色池：只有角色池裡的角色有資訊欄（關係、資訊、好感度、內心話）。</p>
            <div class="spm-who">${people.map((n) => html`<button class="chip ${n === who ? 'active' : ''} ${appeared.has(n) ? '' : 'later'}" data-who="${n}">${n}${tag(n) ? html`<small class="muted">${tag(n)}</small>` : ''}</button>`)}
              <button class="chip" data-spm="addwho">${icon('plus', 14)} 角色</button>
              <button class="chip" data-spm="castai" title="從角色卡整理所有主要登場人物">${icon('sparkles', 14)} AI 整理登場人物</button>
              <button class="chip" data-spm="charimport" title="把別本書或角色卡裡的角色，連同立繪與設定加進角色池">${icon('upload', 14)} 從其他角色卡匯入</button></div>
            ${extra.length ? html`<div class="spm-others"><small class="muted">劇情裡出現、還不在角色池：</small>${extra.map((n) => html`<button class="chip ghost" data-addpool="${n}" title="加入角色池">${icon('plus', 12)} ${n}</button>`)}</div>` : ''}
            ${who && !pool.includes(who) ? html`<div class="spm-reuse">${icon('info', 14)}<span>「${who}」不在角色池，遊玩時不會有資訊欄。</span><button class="btn small" data-addpool="${who}">加入角色池</button></div>` : ''}
            ${who ? html`<div class="spm-info">
              <div class="grid2">
                <label class="field"><span>關係</span><input class="input small" data-cast="role" value="${entry.role || ''}" placeholder="例如：同門師妹"></label>
                <label class="field"><span>資訊</span><input class="input small" data-cast="info" value="${entry.info || ''}" placeholder="年齡｜身分｜武器｜實力"></label>
              </div>
              <label class="field"><span>別名（劇情裡的其他叫法，用頓號分隔）</span><input class="input small" data-cast="aliases" value="${[...new Set([...(entry.aliases || []), ...aliasesOf(card, who)])].join('、')}" placeholder="例如：明雲、白師兄"></label>
              <label class="field"><span>外貌標籤（英文，畫立繪用）</span><input class="input small" data-cast="appearance" value="${tagsOf(who)}" placeholder="1girl, long black hair, red eyes, …"></label>
              ${entry.profile != null ? html`<label class="field"><span>角色設定（從《${entry.from || '其他角色卡'}》匯入，會提供給 AI）</span><textarea class="input small" rows="4" data-cast="profile">${entry.profile}</textarea></label>` : ''}
              <div class="btn-row wrap">
                <button class="btn small" data-spm="castconceive">${icon('sparkles', 14)} AI 構想關係、資訊與外貌</button>
                <button class="btn small" data-spm="merge">${icon('users', 14)} 改名或合併到其他角色</button>
              </div>
              ${other.length ? html`<div class="spm-reuse">${icon('sparkles', 14)}<span>「${other[0].card.name}」裡已經有「${other[0].name}」的立繪（${other[0].count} 張）</span><button class="btn small" data-spm="reuse" data-from="${other[0].card.id}" data-name="${other[0].name}">套用</button></div>` : ''}
            </div>` : ''}
            <div data-spm="jobs"></div>
            <div class="spm-grid">${raw(gridHTML(card, who))}</div>
            <label class="switch-row"><span><b>匯入時自動去背</b><small>綠幕或單色背景會自動去掉；本來就是透明背景的 PNG 不受影響</small></span><input type="checkbox" class="switch" data-spm="cut" checked></label>
            <div class="btn-row wrap">
              <button class="btn small" data-spm="import">${icon('upload', 16)} 匯入立繪（可多選）</button>
              <button class="btn small" data-spm="genrest">${icon('sparkles', 16)} 用「平常」生成缺少的</button>
              <button class="btn small" data-spm="genbase">${icon('wand', 16)} AI 畫「平常」</button>
              ${TT.cast.find(card, who) ? html`<button class="btn small danger" data-spm="rmcast">${icon('trash', 16)} 從名單移除</button>` : ''}
            </div>
            <p class="hint">點一格可以匯入、依立繪改寫生成、修改或刪除。不只表情，動作、姿勢、服裝都可以新增成種類（例如「揮手招呼」「便服」）。</p>`);
        };
        const renderHero = () => {
          const ps = TT.store.personas;
          pane.innerHTML = String(html`
            <div class="spm-who">${ps.map((p) => html`<button class="chip ${p.id === persona.id ? 'active' : ''}" data-persona="${p.id}">${p.name}${hasSprites(p, p.name) ? '' : html`<small class="muted">・無立繪</small>`}</button>`)}</div>
            <div class="spm-info">
              <label class="field"><span>${persona.name} 的設定（身分、性格、背景，會提供給 AI）</span><textarea class="input small" rows="2" data-hero="description">${persona.description || ''}</textarea></label>
              <label class="field"><span>外貌標籤（英文，畫主角立繪與特殊場景圖用）</span><input class="input small" data-hero="appearance" value="${persona.appearance || ''}" placeholder="1boy, short black hair, …"></label>
              <div class="btn-row wrap"><button class="btn small" data-spm="heroconceive">${icon('sparkles', 14)} AI 構想主角設定與外貌（依這個作品）</button>
                <button class="btn small" data-spm="heroimport">${icon('upload', 14)} 從角色卡匯入主角</button></div>
              <label class="switch-row"><span><b>劇場中主角行動時顯示立繪</b><small>主角有立繪時，輪到你的台詞或行動會站上舞台</small></span><input type="checkbox" class="switch" data-hero="show" ${TT.settings.story.userSprite !== false ? 'checked' : ''}></label>
            </div>
            <div data-spm="jobs"></div>
            <div class="spm-grid">${raw(gridHTML(persona, persona.name))}</div>
            <label class="switch-row"><span><b>匯入時自動去背</b><small>綠幕或單色背景會自動去掉</small></span><input type="checkbox" class="switch" data-spm="cut" checked></label>
            <div class="btn-row wrap">
              <button class="btn small" data-spm="import">${icon('upload', 16)} 匯入立繪（可多選）</button>
              <button class="btn small" data-spm="genrest">${icon('sparkles', 16)} 用「平常」生成缺少的</button>
              <button class="btn small" data-spm="genbase">${icon('wand', 16)} AI 畫「平常」</button>
            </div>
            <p class="hint">主角的立繪存在主角身上，所有作品共用；畫特殊場景圖（例如擁抱）時可以選主角的立繪當參考。</p>`);
        };
        const sceneGrid = (type) => {
          const list = entries(card, type);
          const presets = type === 'cg' ? CG_PRESETS.filter(([n]) => !list.some((g) => g.name === n)) : [];
          const busy = (n) => !!TT.img.findJob(`${type}|${card.id}|${n}`);
          const media = (g) => (g.blob ? html`<img data-media="${type}:${card.id}|${g.id}" alt="">` : html`<span class="spm-plus">${icon('plus', 20)}</span>`);
          // 特殊場景圖預設模糊，點了先提醒（可能會提前看到劇情畫面）
          const hidden = (g) => type === 'cg' && g.blob && !shown.has(g.id);
          return list.map((g) => String(html`<button class="spm-cgslot ${g.blob ? 'has' : ''} ${hidden(g) ? 'spoiler' : ''} ${type === 'bg' ? 'wide' : ''} ${busy(g.name) ? 'busy' : ''}" data-entry="${g.id}" title="${g.desc || g.name}">
              ${media(g)}${hidden(g) ? html`<span class="spoiler-ic">${icon('eyeOff', 18)}</span>` : ''}<small>${g.name}</small>${busy(g.name) ? html`<span class="spinner"></span>` : ''}</button>`)).join('')
            + presets.map(([n, d]) => String(html`<button class="spm-cgslot ${busy(n) ? 'busy' : ''}" data-preset="${n}" data-desc="${d}" title="${d}">
              <span class="spm-plus">${icon('plus', 20)}</span><small>${n}</small>${busy(n) ? html`<span class="spinner"></span>` : ''}</button>`)).join('')
            + String(html`<button class="spm-cgslot add ${type === 'bg' ? 'wide' : ''}" data-spm="addentry"><span class="spm-plus">${icon('plus', 22)}</span><small>新增種類</small></button>`);
        };
        const renderScenes = (type) => {
          pane.innerHTML = String(html`
            <p class="hint">${type === 'cg'
              ? '劇情到相符的場面時，畫面中央換成這張直式插圖（AI 用 [CG:名稱]）。和背景分開：這裡放有角色的事件圖。'
              : '實際的場景背景，沒有人物；換場景時 AI 用 [BG:名稱] 換成這張，沒指定時依場景描述挑最接近的。和特殊場景圖分開。'}</p>
            ${type === 'cg' && entries(card, 'cg').some((g) => g.blob && !shown.has(g.id)) ? html`<p class="hint spoiler-note">${icon('eyeOff', 13)} 預覽先模糊處理，點一張會先提醒：提前看到特殊場景圖可能會影響遊玩體驗。<button class="link-btn" data-spm="showall">全部顯示</button></p>` : ''}
            <div data-spm="jobs"></div>
            <div class="spm-cgrid ${type === 'bg' ? 'wide' : ''}">${raw(sceneGrid(type))}</div>
            <div class="btn-row wrap">
              <button class="btn small" data-spm="entryimport">${icon('upload', 16)} 匯入${type === 'bg' ? '背景' : '特殊場景圖'}（可多選）</button>
              ${ctx ? html`<button class="btn small" data-spm="entrystory">${icon('feather', 16)} 依目前劇情生成</button>` : ''}
              ${type === 'bg' ? html`<button class="btn small" data-spm="bgai">${icon('sparkles', 16)} AI 從角色卡整理場景</button>` : ''}
            </div>`);
        };
        const renderPack = () => {
          pane.innerHTML = String(html`
            <p class="hint">立繪、自訂種類、別名、登場人物名單、特殊場景圖與背景都存在這個作品裡，所有存檔共用。可以匯出成素材包保存，或匯入到別的作品。主角的立繪存在主角身上，不在素材包裡。</p>
            <div class="btn-row wrap">
              <button class="btn small" data-spm="export">${icon('download', 16)} 匯出素材包</button>
              <button class="btn small" data-spm="importpack">${icon('upload', 16)} 匯入素材包</button>
              <a class="btn small" href="#/assets">${icon('box', 16)} 素材庫</a>
            </div>`);
        };
        const render = () => {
          el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
          ({ chars: renderChars, hero: renderHero, cgs: () => renderScenes('cg'), bgs: () => renderScenes('bg'), pack: renderPack })[tab]();
          TT.media.hydrate(pane);
          renderJobs();
        };
        render();

        const offImg = TT.bus.on('img:update', (d) => {
          if (d.kind === 'portrait' || (d.kind === 'task' && /^spr\|/.test(d.key || ''))) {
            const t = target();
            if (d.cardId !== t.owner.id) return;
            if (tab === 'chars' || tab === 'hero') { const g = pane.querySelector('.spm-grid'); if (g) { g.innerHTML = gridHTML(t.owner, t.name); TT.media.hydrate(g); } }
            if (d.status === 'progress') status(`生成中 ${d.done || 0} / ${d.total || 1}${d.expr ? `・${d.expr}` : ''}`);
            if (d.status === 'done') status('立繪完成');
            if (d.status === 'error') status('生成失敗：' + (d.error || ''));
            if (d.status === 'cancelled') status('已停止生成');
          } else if (d.kind === 'task' && d.cardId === card.id && /^(cg|bg)\|/.test(d.key || '')) {
            if (tab === 'cgs' || tab === 'bgs') render();
            if (d.status === 'done') status('圖片完成');
            if (d.status === 'error') status('生成失敗：' + (d.error || ''));
            if (d.status === 'cancelled') status('已停止生成');
          }
        });
        const offTasks = TT.bus.on('tasks:changed', renderJobs);
        // 生成結果回報：畫好了、或為什麼沒畫出來（模型的回覆）；沒畫出來由使用者決定要不要重試
        let lastFail = null;
        const offReport = TT.bus.on('img:report', (r) => {
          if (r.cardId !== card.id && r.cardId !== persona.id) return;
          if (r.ok) return status(`「${r.label}」完成${r.text ? `。模型回覆：「${TT.truncate(r.text, 100)}」` : ''}`);
          lastFail = r;
          $('status').innerHTML = String(html`<span class="spm-fail">${icon('alert', 14)} ${r.label}：${r.error}</span>${r.retry ? html` <button class="btn small" data-spm="retry">${icon('refresh', 14)} 修改後重試</button>` : ''}`);
        });
        off = () => { offImg(); offTasks(); offReport(); };

        /* --- 動作 --- */
        const cutOn = () => { const c = pane.querySelector('[data-spm="cut"]'); return !c || c.checked; };
        const hasBase = (owner, name) => !!((owner.spriteRaw && owner.spriteRaw[name]) || (owner.expr && owner.expr[name] && owner.expr[name]['平常']));
        const askTags = async (owner, name) => {
          let tags = owner === persona ? persona.appearance : tagsOf(name);
          const usable = tags || (owner === card && name === main && card.avatar && !card.generatedCover) || (owner.spriteRaw && owner.spriteRaw[name]);
          if (usable) return tags || '';
          tags = await TT.promptText(`${name} 的外貌標籤（英文）`, '', { placeholder: '1girl, long black hair, red eyes, school uniform, …', hint: '用來畫立繪；也可以先匯入一張「平常」立繪，再讓 AI 依它生成其他表情和動作。' });
          return tags && tags.trim() ? tags.trim() : null;
        };
        const bulk = async (only) => {
          if (!needImg()) return;
          const { owner, name } = target();
          if (!TT.img.supportsRef() && only !== '平常') return TT.toast('目前的圖像服務不能看參考圖，無法依立繪生成', { type: 'error' });
          const tags = await askTags(owner, name);
          if (tags == null) return;
          const job = TT.img.enqueuePortrait(owner, name, tags, { only });
          if (!job) return TT.toast('需要外貌標籤或一張「平常」立繪才能生成', { type: 'error' });
          status('已加入生成佇列，可以暫停或停止');
          renderJobs();
        };
        // 依立繪改寫：選參考圖（預設是這個角色的「平常」或這一格目前的圖）＋自由畫法。
        // prev／fail：上次沒畫出來時，按「修改後重試」帶回上次的設定與原因
        const genSlot = async (k, { story = false, prev = null, fail = null, who: forWho = null } = {}) => {
          if (!needImg()) return;
          const { owner, name } = forWho || target();
          const set = (owner.expr || {})[name] || {};
          const choices = refChoices(card, persona);
          const pref = prev ? prev.refs.map((x) => x.id) : [set[k.key] && `s|${owner.id}|${name}|${k.key}`, set['平常'] && `s|${owner.id}|${name}|平常`, owner.sprites && owner.sprites[name] && `s|${owner.id}|${name}|`, owner === card && name === main && card.avatar && 'card'].filter(Boolean).slice(0, 1);
          const r = await genForm({ type: 'sprite', title: `${name}・${k.key}`, name: k.key, desc: prev ? prev.desc : k.desc || (k.custom ? '' : k.key), prompt: prev ? prev.prompt : k.custom ? '' : k.prompt,
            refs: choices, selected: pref, ctx: story || ctx ? ctx : null, card, persona, who: name, notice: fail && fail.error, reason: fail && fail.reason });
          if (!r) return;
          if (k.custom && r.desc !== k.desc) { setKind(owner, name, { key: k.key, desc: r.desc }, k.key); await saveOwner(owner); }
          generateSprite(owner, name, k.key, { prompt: [r.desc, r.prompt].filter((x, i, a) => x && a.indexOf(x) === i).join('. '), refs: r.refs, keep: r.keep,
            retry: (rep) => genSlot(k, { prev: r, fail: rep, who: { owner, name } }) });
          status(`「${k.key}」已加入生成佇列，可以暫停或停止`);
          const g = pane.querySelector('.spm-grid');
          if (g) { g.innerHTML = gridHTML(owner, name); TT.media.hydrate(g); }
          renderJobs();
        };
        const importInto = async (key) => {
          const { owner, name } = target();
          const files = await TT.pickFiles({ accept: 'image/*' });
          if (!files.length) return;
          status('處理中…');
          await importSprites(owner, name, files.slice(0, 1), { slot: key, cut: cutOn() });
          status(`已放進「${key}」`);
          render();
        };
        const typeOf = () => (tab === 'bgs' ? 'bg' : 'cg');
        const sceneGen = async (type, { g = null, name = '', desc = '', story = false, prev = null, fail = null } = {}) => {
          if (!needImg()) return;
          const choices = refChoices(card, persona);
          // 特殊場景圖預設參考目前角色與主角的「平常」；背景預設不用參考圖（重畫時參考原本那張）
          const pref = prev ? prev.refs.map((x) => x.id) : type === 'cg'
            ? [`s|${card.id}|${who}|平常`, `s|${persona.id}|${persona.name}|平常`]
            : [g && g.blob && `b|${g.id}`].filter(Boolean);
          const r = await genForm({ type, title: g ? `重畫・${g.name}` : `生成${type === 'bg' ? '背景' : '特殊場景圖'}`, name: prev ? prev.name : g ? g.name : name, nameEditable: !g,
            desc: prev ? prev.desc : g ? g.desc : desc, prompt: prev ? prev.prompt : g ? g.prompt : '', refs: choices, selected: pref, ctx: story || ctx ? ctx : null, card, persona, who,
            notice: fail && fail.error, reason: fail && fail.reason });
          if (!r) return;
          generateScene(card, type, { name: r.name, desc: r.desc, prompt: r.prompt, refs: r.refs, replaceId: g ? g.id : '',
            retry: (rep) => sceneGen(type, { g, prev: r, fail: rep }) });
          status(`「${r.name}」已加入生成佇列，可以暫停或停止`);
          render();
        };
        const sceneImport = async (type, g, name, desc) => {
          const files = await TT.pickFiles({ accept: 'image/*', multiple: !g && !name });
          if (!files.length) return;
          for (const f of files) {
            const blob = await TT.resizeImageBlob(f, 2048, f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
            const n = name || (f.name || '').replace(/\.[^.]+$/, '') || (type === 'bg' ? '背景' : '特殊場景');
            const same = g || entries(card, type).find((x) => x.name === n);
            if (same) await setEntryImage(card, type, same.id, blob);
            else await addEntry(card, type, { name: n, desc: desc || (CG_PRESETS.find(([x]) => x === n) || [])[1] || '', blob });
          }
          status(files.length > 1 ? `已加入 ${files.length} 張；點圖片可以修改名稱與說明` : '已放進去');
          render();
        };

        el.addEventListener('click', async (e) => {
          const t = e.target.closest('[data-tab]');
          if (t) { tab = t.dataset.tab; status(''); return render(); }
          const w = e.target.closest('[data-who]');
          if (w) { who = w.dataset.who; return render(); }
          // 加入角色池：劇情裡已經寫過的外貌、關係、資訊一起帶進名單
          const ap = e.target.closest('[data-addpool]');
          if (ap) {
            const n = ap.dataset.addpool;
            const o = others[n] || {};
            TT.cast.upsert(card, n, { appearance: tagsOf(n) || o.tags || '', role: o.關係 || '', info: o.資訊 || '' });
            await TT.store.saveCard(card);
            if (others[n]) appeared.add(n);
            who = n;
            status(`已把「${n}」加入角色池，遊玩時會有資訊欄`);
            return render();
          }
          const p = e.target.closest('[data-persona]');
          if (p) { persona = TT.store.getPersona(p.dataset.persona) || persona; return render(); }
          const ja = e.target.closest('[data-jobact]');
          if (ja) {
            const job = TT.img.findJob(ja.closest('[data-job]').dataset.job);
            if (!job) return renderJobs();
            if (ja.dataset.jobact === 'pause') TT.img.pauseJob(job);
            else if (ja.dataset.jobact === 'resume') TT.img.resumeJob(job);
            else TT.img.cancelJob(job);
            return renderJobs();
          }
          const slot = e.target.closest('[data-slot]');
          if (slot) {
            const { owner, name } = target();
            const k = kinds(owner, name).find((x) => x.key === slot.dataset.slot);
            if (!k) return;
            const has = owner.expr && owner.expr[name] && owner.expr[name][k.key];
            const v = await TT.choose(`${name}・${k.key}`, [
              { label: '匯入圖片', value: 'import', icon: 'upload' },
              { label: '生成／依立繪改寫（自由描述、可選參考圖）', value: 'gen', icon: 'sparkles' },
              ...(ctx ? [{ label: '依目前劇情改寫', value: 'story', icon: 'feather' }] : []),
              ...(k.custom ? [{ label: '修改名稱與說明', value: 'edit', icon: 'edit' }] : []),
              ...(has ? [{ label: '下載這張', value: 'dl', icon: 'download' }, { label: '刪除圖片', value: 'del', icon: 'trash', danger: true }] : []),
              ...(k.custom ? [{ label: '刪除這個種類', value: 'rmkind', icon: 'trash', danger: true }] : []),
            ]);
            if (v === 'import') return importInto(k.key);
            if (v === 'gen' || v === 'story') return genSlot(k, { story: v === 'story' });
            if (v === 'dl') return TT.download(TT.safeFileName(`${name}-${k.key}`) + '.png', owner.expr[name][k.key]);
            if (v === 'edit') {
              const r = await kindForm(k, { card, persona, who: name });
              if (!r) return;
              setKind(owner, name, r, k.key);
              await saveOwner(owner);
              return render();
            }
            if (v === 'del' || v === 'rmkind') {
              if (v === 'rmkind' && !(await TT.confirm(`刪除「${k.key}」這個種類${has ? '和它的圖片' : ''}？`, { danger: true, okText: '刪除' }))) return;
              if (v === 'rmkind') removeKind(owner, name, k.key); else removeSprite(owner, name, k.key);
              await saveOwner(owner);
              return render();
            }
            return;
          }
          const ent = e.target.closest('[data-entry]');
          if (ent) {
            const type = typeOf();
            const g = entries(card, type).find((x) => x.id === ent.dataset.entry);
            if (!g) return;
            const label = type === 'bg' ? '背景' : '特殊場景圖';
            if (type === 'cg' && g.blob && !shown.has(g.id)) {
              if (!(await TT.confirm(`要顯示特殊場景圖「${g.name}」嗎？提前看到劇情裡的畫面，可能會影響遊玩體驗。`, { title: '可能會劇透', okText: '顯示' }))) return;
              shown.add(g.id);
              render();
            }
            const v = await TT.choose(`${label}・${g.name}`, [
              ...(g.blob ? [{ label: '查看大圖', value: 'view', icon: 'image' }] : []),
              { label: g.blob ? '重新匯入圖片' : '匯入圖片', value: 'import', icon: 'upload' },
              { label: g.blob ? '依這張改寫／重畫' : 'AI 生成', value: 'gen', icon: 'sparkles' },
              ...(ctx ? [{ label: '依目前劇情改寫', value: 'story', icon: 'feather' }] : []),
              { label: '修改名稱與說明', value: 'edit', icon: 'edit' },
              ...(g.blob ? [{ label: '下載', value: 'dl', icon: 'download' }] : []),
              { label: '刪除', value: 'del', icon: 'trash', danger: true },
            ]);
            if (v === 'view') {
              const u = await TT.media.url(type, `${card.id}|${g.id}`);
              return TT.sheet({ title: g.name, wide: true, body: html`<img class="viewer-img" src="${u}" alt=""><p class="hint">${g.desc || ''}</p>`, actions: [{ label: '關閉', primary: true }] });
            }
            if (v === 'import') return sceneImport(type, g);
            if (v === 'gen' || v === 'story') return sceneGen(type, { g, story: v === 'story' });
            if (v === 'dl') return TT.download(TT.safeFileName(`${card.name}-${g.name}`) + '.png', g.blob);
            if (v === 'edit') {
              const r = await entryForm(type, g, card);
              if (!r) return;
              Object.assign(g, r);
              await TT.store.saveCard(card);
              return render();
            }
            if (v === 'del') {
              if (!(await TT.confirm(`刪除${label}「${g.name}」？`, { danger: true, okText: '刪除' }))) return;
              await removeEntry(card, type, g.id);
              return render();
            }
            return;
          }
          const pre = e.target.closest('[data-preset]');
          if (pre && tab === 'cgs') {
            const v = await TT.choose(`特殊場景圖・${pre.dataset.preset}`, [
              { label: '匯入圖片', value: 'import', icon: 'upload' },
              { label: 'AI 生成（以立繪為參考）', value: 'gen', icon: 'sparkles' },
              ...(ctx ? [{ label: '依目前劇情生成', value: 'story', icon: 'feather' }] : []),
            ]);
            if (v === 'import') return sceneImport('cg', null, pre.dataset.preset, pre.dataset.desc);
            if (v === 'gen' || v === 'story') return sceneGen('cg', { name: pre.dataset.preset, desc: pre.dataset.desc, story: v === 'story' });
            return;
          }
          const act = e.target.closest('[data-spm]');
          if (!act) return;
          switch (act.dataset.spm) {
            case 'showall': {
              if (!(await TT.confirm('顯示所有特殊場景圖？提前看到劇情裡的畫面，可能會影響遊玩體驗。', { title: '可能會劇透', okText: '全部顯示' }))) return;
              entries(card, 'cg').forEach((g) => shown.add(g.id));
              return render();
            }
            case 'retry': return lastFail && lastFail.retry && lastFail.retry(lastFail);
            case 'castconceive': {
              // AI 依作品資料構想這個角色的關係、資訊與外貌（空著的欄位才填；都填了就全部重寫）
              if (!(await TT.actions.ensureLLM())) return;
              act.disabled = true;
              status('AI 構想中…');
              try {
                const d = await TT.engine.conceive({ type: 'char', card, persona, who });
                const e0 = TT.cast.find(card, who) || {};
                const full = e0.role && e0.info && tagsOf(who);
                const patch = {};
                for (const k of ['role', 'info', 'appearance']) if (d[k] && (full || !(k === 'appearance' ? tagsOf(who) : e0[k]))) patch[k] = String(d[k]);
                TT.cast.upsert(card, who, patch);
                if (patch.appearance && who === main) card.appearance = patch.appearance;
                await TT.store.saveCard(card);
                status('已由 AI 構想好，可以再修改');
              } catch (err) { status('構想失敗：' + TT.llm.describeError(err)); }
              return render();
            }
            case 'heroconceive': {
              if (!(await TT.actions.ensureLLM())) return;
              act.disabled = true;
              status('AI 構想中…');
              try {
                const d = await TT.engine.conceive({ type: 'hero', card, persona });
                if (d.description) persona.description = String(d.description);
                if (d.appearance) persona.appearance = String(d.appearance);
                await TT.store.savePersona(persona);
                status('已由 AI 構想好主角設定與外貌，可以再修改');
              } catch (err) { status('構想失敗：' + TT.llm.describeError(err)); }
              return render();
            }
            case 'merge': {
              // 重名：同一個人在名單和立繪用了不同名字時，改名或併到另一個角色（立繪、種類、別名一起搬）
              const others = people.filter((n) => n !== who);
              const v = await TT.choose(`「${who}」改名或合併`, [
                ...others.map((n) => ({ label: `合併到「${n}」`, value: 'to:' + n, icon: 'users', hint: '立繪搬過去，原本的名字變成別名' })),
                { label: '改成新的名字…', value: 'rename', icon: 'edit' },
              ]);
              if (!v) return;
              let to = v.startsWith('to:') ? v.slice(3) : '';
              if (v === 'rename') {
                const n = await TT.promptText('新的名字', who);
                if (!n || !n.trim() || n.trim() === who) return;
                to = n.trim();
              }
              const from = TT.cast.find(card, who);
              const into = TT.cast.find(card, to);
              await mergeName(card, who, to);
              if (from) {
                TT.cast.remove(card, who);
                const keep = into || { name: to, aliases: [], role: from.role, info: from.info, appearance: from.appearance };
                TT.cast.upsert(card, to, { ...keep, aliases: [...new Set([...(keep.aliases || []), ...(from.aliases || []), who])].filter((a) => a !== to), role: keep.role || from.role, info: keep.info || from.info, appearance: keep.appearance || from.appearance });
              } else if (into) TT.cast.upsert(card, to, { aliases: [...new Set([...(into.aliases || []), who])] });
              await TT.store.saveCard(card);
              status(`已把「${who}」${v === 'rename' ? '改名為' : '合併到'}「${to}」`);
              who = to;
              return render();
            }
            case 'charimport': {
              const n = await TT.charImport.intoBook(card);
              if (!n) return;
              who = n;
              people = peopleList();
              if (!people.includes(who)) people.push(who);
              status(`已把「${n}」加進角色池`);
              return render();
            }
            case 'heroimport': {
              const p = await TT.charImport.newPersona();
              if (!p) return;
              persona = p;
              status(`已建立主角「${p.name}」`);
              return render();
            }
            case 'addwho': {
              const n = await TT.promptText('新增角色', '', { placeholder: '角色名字（和劇情裡的名字相同）', hint: '會加進這個作品的登場人物名單。' });
              if (!n || !n.trim()) return;
              who = canon(n.trim());
              if (!TT.cast.find(card, who)) { TT.cast.upsert(card, who, {}); await TT.store.saveCard(card); }
              if (!people.includes(who)) people.push(who);
              return render();
            }
            case 'castai': {
              if (!(await TT.actions.ensureLLM())) return;
              act.disabled = true;
              status('AI 整理登場人物中…');
              try {
                const l = await TT.cast.extract(card);
                const merged = await tidyNames(card);
                status(`整理出 ${l.length} 個角色：${l.map((c) => c.name).join('、')}${merged ? `（${merged} 組用了別的名字的立繪已併到名單上的名字）` : ''}`);
              } catch (err) { status('整理失敗：' + TT.llm.describeError(err)); }
              people = peopleList();
              return render();
            }
            case 'rmcast': {
              if (!(await TT.confirm(`把「${who}」從登場人物名單移除？立繪會保留。`, { okText: '移除' }))) return;
              TT.cast.remove(card, who);
              await TT.store.saveCard(card);
              people = peopleList();
              who = people[0];
              return render();
            }
            case 'reuse': {
              const from = TT.store.getCard(act.dataset.from);
              if (!from) return;
              await copySprites(from, act.dataset.name, card, who);
              status(`已套用「${from.name}」的立繪`);
              return render();
            }
            case 'addkind': {
              const { owner, name } = target();
              const r = await kindForm(null, { card, persona, who: name });
              if (!r) return;
              const key = setKind(owner, name, r);
              await saveOwner(owner);
              render();
              if (r.then === 'import') return importInto(key);
              if (r.then === 'gen') return genSlot(kinds(owner, name).find((k) => k.key === key));
              return;
            }
            case 'import': {
              const { owner, name } = target();
              const files = await TT.pickFiles({ accept: 'image/*', multiple: true });
              if (!files.length) return;
              status(`處理 ${files.length} 張圖…`);
              const put = await importSprites(owner, name, files, { cut: cutOn() });
              status(put.length ? `已放進：${put.join('、')}` : '沒有空的格子了');
              return render();
            }
            case 'genrest': {
              const { owner, name } = target();
              if (!hasBase(owner, name)) return TT.toast('請先匯入或畫好「平常」立繪', { type: 'error' });
              if (!missing(owner, name).length) return TT.toast('每一種都有圖了；要重畫請點那一格');
              return bulk();
            }
            case 'genbase': return bulk('平常');
            case 'entryimport': return sceneImport(typeOf());
            case 'entrystory': return sceneGen(typeOf(), { story: true });
            case 'addentry': {
              const type = typeOf();
              const n = await TT.promptText(type === 'bg' ? '新增背景' : '新增特殊場景圖', '', { placeholder: type === 'bg' ? '地點名稱，例如：書店內部' : '名稱，例如：雨中相擁', hint: type === 'bg' ? `例如：${BG_PRESETS.join('、')}` : '' });
              if (!n || !n.trim()) return;
              const v = await TT.choose(`「${n.trim()}」`, [
                { label: '匯入圖片', value: 'import', icon: 'upload' },
                { label: 'AI 生成（可選參考圖、自由描述）', value: 'gen', icon: 'sparkles' },
                ...(ctx ? [{ label: '依目前劇情生成', value: 'story', icon: 'feather' }] : []),
              ]);
              if (v === 'import') return sceneImport(type, null, n.trim(), '');
              if (v === 'gen' || v === 'story') return sceneGen(type, { name: n.trim(), story: v === 'story' });
              return;
            }
            case 'bgai': {
              if (!(await TT.actions.ensureLLM())) return;
              act.disabled = true;
              status('AI 整理場景中…');
              try { status(`新增了 ${await suggestBgs(card)} 個背景空格，點一格匯入或生成`); } catch (err) { status('整理失敗：' + TT.llm.describeError(err)); }
              return render();
            }
            case 'export': {
              if (!spriteNames(card).length && !entries(card, 'cg').length && !entries(card, 'bg').length) return TT.toast('這個作品還沒有立繪、特殊場景圖或背景');
              status('打包中…');
              TT.download(TT.safeFileName(`${card.name}-素材包`) + '.json', await exportPack(card), 'application/json');
              return status('已匯出素材包');
            }
            case 'importpack': {
              const [f] = await TT.pickFiles({ accept: '.json,application/json' });
              if (!f) return;
              let data;
              try { data = parsePack(await f.text()); } catch (err) { return TT.toast(err.message, { type: 'error' }); }
              const names = Object.keys(data.chars || {});
              const rename = {};
              // 只有一個角色時，可以放到目前選的角色（例如同一個角色在別的作品叫法不同）
              if (names.length === 1 && names[0] !== who) {
                const v = await TT.choose(`素材包裡的「${names[0]}」要放到哪個角色？`, [
                  { label: `放到「${who}」`, value: who, icon: 'user' },
                  { label: `保持「${names[0]}」`, value: names[0], icon: 'user' },
                ]);
                if (!v) return;
                rename[names[0]] = v;
              }
              const r = await importPack(card, data, rename);
              people = peopleList();
              status(`已匯入 ${r.chars} 個角色的立繪、${r.scenes} 張場景圖`);
              return render();
            }
          }
        });

        // 名單欄位與主角設定：改了就存
        el.addEventListener('change', async (e) => {
          const c = e.target.dataset.cast;
          if (c) {
            const v = e.target.value.trim();
            if (c === 'aliases') {
              const list = v.split(/[、，,\s]+/).filter(Boolean);
              TT.cast.upsert(card, who, { aliases: list });
              setAliases(card, who, list);
            } else TT.cast.upsert(card, who, { [c]: v });
            if (c === 'appearance' && who === main) card.appearance = v;
            await TT.store.saveCard(card);
            return status('已儲存');
          }
          const h = e.target.dataset.hero;
          if (h === 'show') { TT.settings.story.userSprite = e.target.checked; TT.saveSettings(); return; }
          if (h) {
            persona[h] = e.target.value.trim();
            await TT.store.savePersona(persona);
            status('已儲存');
          }
        });
      },
    });
    off();
    TT.bus.emit('sprites:changed', { cardId: card.id });
    return res;
  }

  TT.sprites = {
    NAME_RULES, POSE_PRESETS, CG_PRESETS, BG_PRESETS, kinds, missing, setKind, removeKind, resolveName, pick, aliasesOf, setAliases, spriteNames, hasSprites,
    isPersona, ownerById, saveOwner, isTransparent, flatten, prepare, setSprite, removeSprite, importSprites, findElsewhere, copySprites, fillSprites, mergeName, tidyNames,
    findCg, findBg, matchBg, addCg, setCgImage, removeCg, entries, addEntry, setEntryImage, removeEntry,
    generateSprite, generateCg, generateBg, generateScene, suggestBgs, refChoices, genForm, likeness,
    exportPack, parsePack, importPack, manager,
  };
})();
