/* 登場人物名單：作品自帶的主要角色（名字、別名、關係、資訊、外貌）。
 * 開演前從角色卡整理一次，AI 一律用名單上的名字，立繪、狀態、外貌就不會因為叫法不同而重複 */
(function () {
  'use strict';
  const TT = window.TT;

  // 比對名字時去掉的稱謂
  const TITLES = /(師兄|師姐|師姊|師妹|師弟|師父|師傅|姑娘|公子|小姐|先生|大人|前輩|老師|同學|殿下|陛下|大哥|大姐|姐姐|哥哥|妹妹|弟弟|閣下)$/;
  const list = (card) => (card && card.castList) || [];
  const clean = (s) => String(s || '').trim();

  function find(card, name) {
    const n = clean(name);
    if (!n) return null;
    return list(card).find((c) => c.name === n || (c.aliases || []).includes(n)) || null;
  }

  // 路人：沒有名字、只用身分稱呼的角色（暴徒、士兵、店員、路人甲、高大的男子、城門守衛、櫃台服務員…）不建立角色卡、不登錄外貌
  const EXTRA_WORDS = '路人|行人|路過的人|暴徒|歹徒|匪徒|士兵|兵士|衛兵|守衛|警衛|門衛|門房|守門人|看守|哨兵|侍衛|護衛|隨從|侍從|官兵|官差|衙役|捕快|差役|獄卒|傭兵|騎兵|弓箭手|店員|店小二|小二|跑堂|夥計|掌櫃|帳房|老闆|老闆娘|店家|攤主|服務生|服務員|接待員|櫃員|櫃台|櫃檯|櫃台人員|櫃檯人員|前台|收銀員|售貨員|職員|員工|秘書|助理|管理員|清潔工|工人|礦工|船員|水手|乘客|旅客|侍者|女侍|侍女|丫鬟|丫頭|婢女|女僕|僕人|僕役|小廝|書童|管家|車夫|馬夫|船夫|農夫|漁夫|獵人|鐵匠|廚師|廚娘|酒保|調酒師|村民|居民|百姓|鎮民|鄉民|商人|小販|攤販|乞丐|醉漢|酒客|客人|流氓|混混|地痞|打手|山賊|強盜|盜賊|土匪|海盜|刺客|殺手|黑衣人|蒙面人|神秘人|陌生人|男子|女子|男人|女人|男孩|女孩|男生|女生|少年|少女|青年|中年人|老人|老者|老頭|老婦|老太太|老婆婆|婆婆|大叔|大嬸|大媽|阿姨|叔叔|伯伯|爺爺|奶奶|大漢|壯漢|孩子|小孩|嬰兒|眾人|群眾|人群|觀眾|旁觀者|學生|同學|老師|教師|教授|醫生|醫師|大夫|郎中|護士|護理師|藥師|警察|警員|警官|刑警|司機|保鑣|保安|保全|記者|主持人|司儀|牧師|神父|修女|祭司|僧人|和尚|道士|尼姑|傳令兵|使者|信使|太監|宮女|嘍囉|小弟|手下|部下|敵人|怪物|魔物|野獸|聲音|廣播|旁人';
  // 前面可以有「一名」「其中一個」這類量詞、「酒館的」這類說明，或 4 個字以內的修飾（城門守衛、年輕女僕、櫃台服務員）
  const EXTRA = new RegExp(`^(?:一名|一位|一個|某位|某個|幾名|幾個|兩名|兩個|三名|另一名|另一位|另一個|其中一名|其中一個|為首的|帶頭的)?(?:[^\\s的]{1,6}的)?[^\\s的]{0,4}?(?:${EXTRA_WORDS})(?:[甲乙丙丁戊己庚辛壬癸]|[A-Za-zＡ-Ｚ0-9０-９一二三四五六七八九十]{1,3}|們|之一|之二|頭目|首領|隊長|的)?$`);
  function isExtra(card, name) {
    const n = clean(name);
    if (!n || find(card, n) || (card && (n === card.name || n === card.nickname)) || (TT.sprites && TT.sprites.hasSprites(card, n))) return false;
    return EXTRA.test(n);
  }

  // 角色池：作品設定裡的登場人物名單，加上角色卡本身的角色（有名單時，要在名單上或有立繪才算，因為角色卡名稱可能是作品名）。
  // 只有角色池裡的角色有資訊欄（關係、資訊、好感度、內心話）、出現在「角色、立繪與狀態」
  function pool(card) {
    if (!card) return [];
    const names = list(card).map((c) => c.name);
    const main = card.nickname || card.name;
    const hit = find(card, main);
    if (hit) return names;
    if (main && (!names.length || (TT.sprites && TT.sprites.hasSprites(card, main)))) names.unshift(main);
    return names;
  }

  // 劇情裡的叫法 → 名單上（或已經有立繪）的角色名；對不到就原樣回傳
  function canon(card, name, persona) {
    const n = clean(name);
    if (!n || !card) return n;
    if (persona && n === persona.name) return n;
    const hit = find(card, n);
    if (hit) return hit.name;
    const al = (card.spriteAlias || {})[n];
    if (al) return al;
    const bare = n.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(TITLES, '').trim();
    if (bare && bare !== n) {
      const h2 = find(card, bare);
      if (h2) return h2.name;
    }
    // 名字互相包含（「明雲」→「白明雲」）而且只有一個符合時才合併
    const hits = list(card).map((c) => c.name).filter((x) => (x.length >= 2 && n.includes(x)) || (bare.length >= 2 && x.includes(bare)));
    if (hits.length === 1) return hits[0];
    return (TT.sprites && TT.sprites.resolveName(card, n)) || n;
  }

  // 從模型回覆裡取出 JSON（容許包在 ``` 裡、前後有說明、結尾多一個逗號）；
  // open = '[' 時，回覆是 {"characters": [...]} 這種物件也取出裡面的陣列
  function parseJson(text, open = '[') {
    const t = String(text || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '').trim();
    if (!t) throw new Error('模型沒有回覆內容（可能是思考用光了字數，或被安全過濾擋下）');
    const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { try { return JSON.parse(s.replace(/,\s*([\]}])/g, '$1')); } catch (e2) { return undefined; } } };
    let v = tryParse(t);
    if (v === undefined) {
      for (const [o, c] of [[open, open === '[' ? ']' : '}'], ['{', '}'], ['[', ']']]) {
        const a = t.indexOf(o);
        const b = t.lastIndexOf(c);
        if (a >= 0 && b > a) { v = tryParse(t.slice(a, b + 1)); if (v !== undefined) break; }
      }
    }
    if (v === undefined) throw new Error('模型回覆的 JSON 不完整：' + TT.truncate(t, 80));
    if (open === '[' && !Array.isArray(v) && v && typeof v === 'object') v = Object.values(v).find(Array.isArray) || [];
    return v;
  }

  function normalize(arr) {
    const out = [];
    for (const x of Array.isArray(arr) ? arr : []) {
      const name = clean(x && x.name).slice(0, 24);
      if (!name || out.some((c) => c.name === name)) continue;
      out.push({
        name,
        aliases: [...new Set((Array.isArray(x.aliases) ? x.aliases : String(x.aliases || '').split(/[、，,]/)).map(clean).filter((a) => a && a !== name))].slice(0, 8),
        role: clean(x.role).slice(0, 40),
        info: clean(x.info).slice(0, 80),
        appearance: clean(x.appearance).slice(0, 400),
      });
    }
    return out;
  }

  // 角色卡的描述、情境、序章與世界書（給 AI 整理用）
  function cardText(card) {
    const p = TT.store.defaultPersona();
    const mctx = { char: card.nickname || card.name, user: '主角', card, persona: p, vars: {} };
    const books = [card.book, ...(card.extraBooks || [])].filter(Boolean);
    const lore = books.flatMap((b) => b.entries || []).filter((e) => e.content && e.enabled !== false).slice(0, 80)
      .map((e) => `【${(e.keys || []).slice(0, 3).join('／') || e.comment || '設定'}】${TT.truncate(e.content, 500)}`).join('\n');
    const parts = [card.description, card.personality, card.scenario, card.first_mes, ...(card.alternate_greetings || []).slice(0, 2), lore];
    return TT.truncate(TT.stripHtml(TT.macros.apply(parts.filter(Boolean).join('\n\n'), mctx)), 14000);
  }

  // 名字比對用：去掉括號裡的說明與稱謂（「白明雲（大師兄）」＝「白明雲」）
  const bareName = (n) => clean(n).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(TITLES, '').trim();
  const sameChar = (a, b) => !!a && !!b && (a.name === b.name || bareName(a.name) === bareName(b.name) || (a.aliases || []).includes(b.name) || (b.aliases || []).includes(a.name));

  // 用 AI 從角色卡整理主要登場人物；已經有的角色保留自己改過的內容，只補空白的欄位
  // （要求只回 JSON、思考程度低，避免思考把字數用完而回傳不完整）
  async function extract(card) {
    const prompt = `下面是一張角色扮演用的角色卡資料。請整理出故事裡所有「主要登場人物」：會出場、有名字的重要角色（不要包含玩家扮演的「主角」，不要包含路人、沒有名字的配角、或只被提到一次的人）。
只輸出一個 JSON 物件：{"characters":[{"name":"最常用的完整名字","aliases":["其他叫法、暱稱、稱謂"],"role":"和主角的關係，簡短（例如：同門師妹）","info":"年齡｜身分或陣營｜武器或專長｜實力（簡短，用｜分隔，不知道的省略）","appearance":"English appearance tags for image generation"}]}
同一個人只列一次（別名寫在 aliases）。除了 JSON 不要輸出任何文字。

【角色卡名稱】${card.name}
【資料】
${cardText(card)}`;
    const out = await TT.llm.complete([{ role: 'user', content: prompt }], { maxTokens: 16000, json: true, cfg: { thinking: 'low' } });
    const found = [];
    const mainName = card.nickname || card.name;
    // 只用職稱稱呼的人（守衛、店員…）不進角色池
    for (const f of normalize(parseJson(out, '[')).filter((x) => x.name === mainName || !EXTRA.test(x.name))) {
      const same = found.find((x) => sameChar(x, f));
      if (same) same.aliases = [...new Set([...same.aliases, f.name, ...f.aliases])].filter((a) => a !== same.name);
      else found.push(f);
    }
    if (!found.length) throw new Error('沒有整理出任何角色');
    const mine = list(card);
    const merged = mine.map((c) => {
      const f = found.find((x) => sameChar(x, c));
      if (!f) return c;
      return { ...c, aliases: [...new Set([...(c.aliases || []), ...f.aliases, ...(f.name !== c.name ? [f.name] : [])])], role: c.role || f.role, info: c.info || f.info, appearance: c.appearance || f.appearance };
    });
    for (const f of found) if (!merged.some((c) => sameChar(c, f))) merged.push(f);
    card.castList = merged;
    card.castListAt = Date.now();
    // 主要角色沒有外貌標籤時，順便填上
    const main = find(card, card.nickname || card.name);
    if (main && main.appearance && !card.appearance) card.appearance = main.appearance;
    await TT.store.saveCard(card);
    TT.bus.emit('cast:changed', { cardId: card.id });
    return card.castList;
  }

  // 開演前確定有名單：沒有就整理一次（失敗不擋開演）
  const pending = new Map();
  function ensure(card) {
    if (!card || card.castListAt || !TT.ui.llmReady()) return Promise.resolve(list(card));
    if (!pending.has(card.id)) {
      pending.set(card.id, extract(card).catch((e) => { console.warn('整理登場人物失敗', e); return list(card); }).finally(() => pending.delete(card.id)));
    }
    return pending.get(card.id);
  }

  function upsert(card, name, patch) {
    const l = list(card).slice();
    const i = l.findIndex((c) => c.name === name);
    if (i >= 0) l[i] = { ...l[i], ...patch };
    else l.push({ name, aliases: [], role: '', info: '', appearance: '', ...patch });
    card.castList = l;
    return l[i >= 0 ? i : l.length - 1];
  }

  function remove(card, name) {
    card.castList = list(card).filter((c) => c.name !== name);
  }

  // 給提示詞：名單與「一律用名單上的名字」的規則；從其他角色卡匯入的角色另外附上他的設定
  function promptBlock(card) {
    const l = list(card);
    if (!l.length) return '';
    const profiles = l.filter((c) => c.profile && c.profile.trim()).map((c) => `【${c.name} 的設定（從《${c.from || '其他角色卡'}》加入這個故事）】\n${c.profile.trim()}`);
    return '【登場人物名單（角色池）】這個故事的主要角色如下。台詞、[STAT:角色名]、[CAST] 的角色名一律使用名單上的名字，不要改用別名或稱謂當角色名；名單上的角色不必再輸出 [CAST]。角色狀態 [STAT:角色名]（關係、資訊、好感度、內心話）只替名單上的角色寫，名單外的人不要寫：\n'
      + l.map((c) => `- ${c.name}${(c.aliases || []).length ? `（也叫：${c.aliases.join('、')}）` : ''}${c.role ? `：${c.role}` : ''}${c.info ? `｜${c.info}` : ''}`).join('\n')
      + (profiles.length ? '\n\n' + profiles.join('\n\n') : '');
  }

  // 這個作品的所有存檔裡登場過的角色（作品設定排序用）
  async function appearedAll(card, persona) {
    return (await storyNames(card, persona)).appeared;
  }

  // 所有存檔合起來：登場過的角色池角色，以及劇情裡出現、還不在角色池的角色（名字 → { tags, 關係, 資訊 }）
  async function storyNames(card, persona, sessions = null) {
    const appeared = new Set();
    const others = {};
    for (const s of sessions || (await TT.store.sessionsForCard(card.id))) {
      const st = TT.engine.deriveState(s, card, persona);
      for (const n of st.appeared) appeared.add(n);
      for (const [n, o] of Object.entries(st.others)) others[n] = { ...o, ...(others[n] || {}) };
    }
    return { appeared, others };
  }

  TT.cast = { list, find, canon, extract, ensure, upsert, remove, promptBlock, parseJson, cardText, isExtra, pool, appearedAll, storyNames, sameChar };
})();
