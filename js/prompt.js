/* 提示詞組裝：角色卡 + 世界書 + 主角 + 前情提要 + 歷史 + 導演指示（分鏡格式） */
(function () {
  'use strict';
  const TT = window.TT;

  const DEFAULT_MAIN = `你是一部「可遊玩的互動漫劇」的導演兼編劇。玩家扮演主角 {{user}}；你負責演出 {{char}}、所有配角與旁白，推動劇情並描繪每一格畫面。

核心原則：
- 忠於下方的角色設定、世界觀與前文，保持人物性格、說話口吻與彼此關係一致，並記住已發生的事。
- 只描寫 {{user}} 以外的角色言行；絕不替 {{user}} 說話、做決定或描寫其內心感受。
- 每次回覆是一段分鏡：以畫面開場，用旁白、對話與音效推進，在懸念、衝突或抉擇處停下，把主導權交還給玩家。
- 讓劇情有張力與節奏：配角有自己的目的，會主動行動、製造事件；避免重複前文的句子與空泛描寫。
- 具體回應玩家的每個行動與台詞，讓角色對情境做出真實的反應。`;

  const DEFAULT_FORMAT = `【分鏡輸出格式｜必須遵守】
每行開頭放一個標籤，一行一個元素，不要輸出標籤以外的任何文字或說明：
[SCENE] 中文畫面描述 ## English image prompt
[NARR] 旁白：環境、動作、氛圍
[SAY:角色名|表情或動作] 台詞（不加引號）
[THINK:角色名] 內心獨白
[SFX:音效名] 擬聲詞（沒有音效清單時寫 [SFX] 擬聲詞）
[CAST:角色名] English appearance tags
[STAT] 狀態名稱 = 內容（數值可寫 +N／-N）
[STAT:角色名] 狀態名稱 = 內容
[CHOICE] 選項一 || 選項二 || 選項三
[END] 結局名稱（只在整個故事結束時使用）

規則：
1. 第一行必須是 [SCENE]；只有地點或情境明顯轉換時才再加一個 [SCENE]（每次最多 2 個）。
2. {{sceneRule}}
3. 有名字的重要新角色第一次登場時，先輸出一行 [CAST:角色名]，用英文標籤描述外貌（性別、年齡感、髮型髮色、瞳色、服裝、體型），會用來繪製角色立繪。只用職稱或身分稱呼的路人（例如守衛、士兵、店員、櫃台服務員、侍者、暴徒）不要輸出 [CAST] 或 [STAT:角色名]。{{castList}}
4. 像影片字幕一樣一行一行推進：每則 [NARR] 1～2 句、文字細膩；每則 [SAY] 只放一個角色的一句簡短台詞；{{exprRule}}；整段{{length}}。
5. 只演出 {{user}} 以外的角色，不替 {{user}} 發言或行動。
6. {{statsRule}}
7. {{endingRule}}
8. 最後一行輸出 [CHOICE]，提供 {{choiceCount}} 個 {{user}} 接下來的台詞（用「」括起）或行動，簡短具體、方向各不相同。
9. 除了 [SCENE]、[CAST] 的英文提示詞，其餘一律使用{{language}}。`;

  // 成人內容（使用者在設定中開啟才會加入）；未成年保護不可省略
  const MATURE_RULE = `【成人內容】本作品僅供成年讀者閱讀。劇情自然發展到成年角色之間的親密場景時，不要淡出、跳過或含糊帶過，以精確的身體細節與生動的感官描寫呈現，同時維持角色的性格、情感與節奏。
所有性相關描寫只限於明確已成年（18 歲以上）的角色；角色未成年或年齡不明時，絕不描寫任何性相關內容。`;

  const LANGS = { 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', en: 'English', ja: '日本語', auto: '與角色卡相同的語言' };
  const LENGTHS = { short: '約 8～12 行（150～250 字）', medium: '約 12～18 行（300～500 字）', long: '約 18～26 行（600～900 字）' };
  const CONTINUE_TEXT = '（{{user}} 沒有行動，靜觀其變。請自然地推進劇情。）';
  // 暫停後「繼續生成」：接著上一段中斷的地方寫
  const RESUME_TEXT = '（系統提示：上一段回覆在中途被暫停了。請從中斷的地方直接接著寫下去，不要重複已經寫過的內容，維持相同的分鏡標籤格式，最後照常輸出 [CHOICE]。）';
  const BASE_EXPR = '平常、微笑、開心、生氣、難過、驚訝、害羞、認真';

  function macroCtx(ctx, extra = {}) {
    const { card, persona, session } = ctx;
    const msgs = (session && session.messages) || [];
    const cur = (m) => (m && m.swipes && m.swipes[m.sw || 0]) || {};
    const lastOf = (role) => { for (let i = msgs.length - 1; i >= 0; i--) if (!role || msgs[i].role === role) return cur(msgs[i]).raw || ''; return ''; };
    if (session && !session.vars) session.vars = {};
    return {
      char: (card && (card.nickname || card.name)) || '',
      user: (persona && persona.name) || '你',
      card, persona,
      vars: session ? session.vars : {},
      seed: session ? session.id : '',
      model: TT.settings.llm.model,
      lastMessage: lastOf(),
      lastUserMessage: lastOf('user'),
      lastCharMessage: lastOf('assistant'),
      lastMessageId: msgs.length - 1,
      ...extra,
    };
  }

  const M = (text, mctx) => TT.macros.apply(text, mctx);

  // 系統提示（靜態部分）
  function systemPrompt(ctx, mctx, wi, { withSummary = true } = {}) {
    const { card, persona, session } = ctx;
    const st = TT.settings.story;
    const parts = [M(st.mainPrompt && st.mainPrompt.trim() ? st.mainPrompt : DEFAULT_MAIN, mctx)];
    if (st.useCardSystem && card.system_prompt && card.system_prompt.trim()) {
      parts.push('【角色卡附帶的系統指示】\n' + M(card.system_prompt, { ...mctx, original: '' }));
    }
    if (wi.before.length) parts.push('【世界設定】\n' + wi.before.join('\n\n'));
    parts.push(`【角色：${mctx.char}】\n` + (M(card.description, mctx).trim() || '（無描述）'));
    if (card.personality && card.personality.trim()) parts.push(`【${mctx.char} 的性格】\n` + M(card.personality, mctx));
    const castBlock = TT.cast.promptBlock(card);
    // 匯入角色的設定裡可能有 {{user}}
    if (castBlock) parts.push(M(castBlock, mctx));
    if (card.scenario && card.scenario.trim()) parts.push('【情境】\n' + M(card.scenario, mctx));
    if (wi.after.length) parts.push('【補充設定】\n' + wi.after.join('\n\n'));
    const pDesc = persona ? M(persona.description || '', mctx).trim() : '';
    parts.push(`【主角：${mctx.user}（由玩家扮演）】\n` + (pDesc || '（玩家未提供設定）') + (persona && persona.appearance ? `\n外貌：${persona.appearance}` : ''));
    if (card.mes_example && card.mes_example.trim()) {
      const ex = M(card.mes_example, mctx).replace(/<START>/gi, '———').trim();
      parts.push(`【對話範例】（僅供參考 ${mctx.char} 的語氣與說話方式，不必沿用其格式）\n` + ex);
    }
    if (withSummary && session && session.summary && session.summary.trim()) parts.push('【前情提要】\n' + session.summary.trim());
    return parts.join('\n\n');
  }

  function statsLine(stats) {
    const names = Object.keys(stats);
    if (!names.length) return '目前尚無數值，可依故事需要建立（最多 3 種）。';
    return '目前數值：' + names.map((n) => `${n} ${stats[n]}`).join('、') + '。';
  }

  // 導演指示（放在最後一則使用者訊息尾端）
  function directorBlock(ctx, mctx, wi) {
    const { card, session } = ctx;
    const st = TT.settings.story;
    const state = TT.engine.deriveState(session, card, ctx.persona);
    const castNames = Object.keys(state.cast).filter((n) => state.cast[n].tags);
    const sprites = spriteList(card);
    const vars = {
      castList: castNames.length ? `目前已登錄外貌的角色：${castNames.join('、')}（不需重複）。` : '',
      exprRule: sprites
        ? `[SAY] 的表情或動作：下方【角色立繪】列出的角色，從他的清單挑最符合當下表情與動作的一個；其他角色從「${BASE_EXPR}」中選一個`
        : `表情只能從「${BASE_EXPR}」中選一個`,
      length: LENGTHS[st.length] || LENGTHS.medium,
      sceneRule: TT.img.bgOnly()
        ? '[SCENE] 的英文提示詞只描述環境：地點、建築與陳設、天氣、時段、光線與氣氛，以逗號分隔；不要描寫任何人物（人物會以立繪另外顯示），也不要寫畫風。'
        : '[SCENE] 的英文提示詞以逗號分隔，描述：畫面中的角色（直接寫角色名）、動作與表情、鏡頭（close-up、medium shot、wide shot 等）、場景、光線與氣氛；不要寫畫風。',
      statsRule: st.stats
        ? '畫面上方有狀態欄。主角狀態用 [STAT] 名稱 = 內容（最多 3 種，例如：時間、地點、目前行程，故事開始時就建立）；角色狀態用 [STAT:角色名] 名稱 = 內容，只替主要角色寫（有【登場人物名單】時只限名單上的角色）：重要角色第一次登場時建立「關係」（與主角的關係，例如：同門師妹）與「資訊」（年齡｜身分或陣營｜武器或專長｜實力，用「｜」分隔，簡短），之後有變化才更新。好感度屬於角色，寫成 [STAT:角色名] 好感度 +N，不要寫成主角狀態。每段結尾替在場的主要角色各寫一行 [STAT:角色名] 內心話 = (顏文字) 此刻的一句心裡話。數值的增減寫成「名稱 +N」或「名稱 -N」、不加等號，狀態名稱保持一致，只在改變時輸出。' + statsLine(state.stats)
        : '不要輸出 [STAT]。',
      endingRule: st.endings ? '當故事自然走到結局（圓滿、悲劇或隱藏結局）時，最後一行改為 [END] 結局名稱，不輸出 [CHOICE]；不要過早結束故事。[END] 只代表整個故事結束，不是「這段回覆寫完了」的記號：故事還要繼續時絕對不要輸出 [END]。' : '不要輸出 [END]，故事持續進行。',
      choiceCount: String(st.choices || 3),
      language: LANGS[st.language] || LANGS['zh-Hant'],
    };
    let fmt = st.formatPrompt && st.formatPrompt.trim() ? st.formatPrompt : DEFAULT_FORMAT;
    fmt = fmt.replace(/\{\{(castList|exprRule|length|sceneRule|statsRule|endingRule|choiceCount|language)\}\}/g, (m, k) => vars[k]);
    const parts = [];
    const depth = wi.depth.slice();
    const dp = card.extensions && card.extensions.depth_prompt;
    if (dp && dp.prompt && dp.prompt.trim()) depth.push({ depth: dp.depth || 4, content: M(dp.prompt, mctx) });
    if (depth.length) parts.push('【補充指示】\n' + depth.map((d) => d.content).join('\n\n'));
    if (st.useCardPHI && card.post_history_instructions && card.post_history_instructions.trim()) {
      parts.push('【角色卡附帶的指示】\n' + M(card.post_history_instructions, { ...mctx, original: '' }));
    }
    if (st.mature) parts.push(MATURE_RULE);
    parts.push(M(fmt, mctx));
    if (sprites) parts.push('【角色立繪】這些角色準備了下列表情與動作的立繪，[SAY:角色名|名稱] 的名稱要從他的清單挑最符合當下的一個（不限臉部表情，動作、姿勢也算）：\n' + sprites);
    const cgs = (card.cgs || []).filter((g) => g.name && g.blob);
    if (cgs.length) {
      parts.push('【特殊場景圖】這個故事準備了下列特殊場景圖。劇情進行到明顯符合的場面時，在那個場面的第一句之前單獨輸出一行 [CG:名稱]，畫面會換成那張圖；場面結束、換場或回到日常時輸出一行 [CG:off]。只能用清單裡的名稱，同一個場面不要重複輸出：\n'
        + cgs.map((g) => `- ${g.name}${g.desc ? `：${g.desc}` : ''}`).join('\n'));
    }
    const bgs = (card.bgs || []).filter((g) => g.name && g.blob);
    if (bgs.length) {
      parts.push('【背景圖】這個故事準備了下列場景背景。每次輸出 [SCENE] 時，在它的下一行單獨輸出一行 [BG:背景名]，從清單挑最符合目前地點的一個；清單沒有適合的地點就不要寫：\n'
        + bgs.map((g) => `- ${g.name}${g.desc ? `：${g.desc}` : ''}`).join('\n'));
    }
    // 配樂每本書分開：只告訴 AI 這本書有音檔的種類
    const music = TT.bgm ? TT.bgm.names(card.id) : [];
    if (music.length) {
      parts.push(`【配樂】故事開始、換場景或氣氛明顯改變時，單獨一行 [BGM:配樂名] 換配樂，只能從下列挑選；需要安靜時 [BGM:off]。同一種氣氛不要重複輸出：\n${music.join('、')}`);
    }
    const sounds = TT.sfx ? TT.sfx.names() : [];
    if (sounds.length) {
      parts.push(`【音效】需要音效時單獨一行 [SFX:音效名] 擬聲詞，畫面會播放那個音效；音效名只能從下列挑選，沒有適合的就寫 [SFX] 擬聲詞。不要每句都加，只在關鍵的聲響使用：\n${sounds.join('、')}`);
    }
    // 玩家的優先指示放最後：最靠近要寫的內容，效果最強
    const pri = TT.priority ? TT.priority.promptBlock(ctx, mctx) : '';
    if (pri) parts.push(pri);
    return '━━━━ 導演指示（玩家看不到）━━━━\n' + parts.join('\n\n');
  }

  // 有立繪的角色與他們能用的表情、動作（只列出有圖的；自訂種類附上說明）
  function spriteList(card) {
    if (!TT.sprites) return '';
    const lines = [];
    for (const n of TT.sprites.spriteNames(card)) {
      const set = (card.expr || {})[n] || {};
      const ks = TT.sprites.kinds(card, n).filter((k) => set[k.key]);
      if (!ks.length) continue;
      const alias = TT.sprites.aliasesOf(card, n);
      lines.push(`- ${n}${alias.length ? `（也叫：${alias.join('、')}）` : ''}：${ks.map((k) => (k.desc ? `${k.key}（${k.desc}）` : k.key)).join('、')}`);
    }
    return lines.join('\n');
  }

  function books(card) {
    return [card.book, ...(card.extraBooks || [])].filter(Boolean);
  }

  const cur = (m) => m.swipes[m.sw || 0];

  // 一般回合；targetId = 正在生成的助理訊息
  function build(ctx, { targetId } = {}) {
    const { session, card } = ctx;
    const s = TT.settings;
    const mctx = macroCtx(ctx);
    const idx = session.messages.findIndex((m) => m.id === targetId);
    const upto = idx >= 0 ? session.messages.slice(0, idx) : session.messages.slice();
    const history = upto
      .filter((m) => cur(m) && (cur(m).raw || '').trim())
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.role === 'user' ? M(cur(m).raw, mctx) : cur(m).raw, ref: m }));

    let input = '（請繼續）';
    if (history.length && history[history.length - 1].role === 'user') input = history.pop().content;

    const budgetAll = (+s.llm.contextSize || 32000) - (+s.llm.maxTokens || 2048);
    const wi = TT.wi.activate({
      books: books(card),
      texts: history.map((h) => h.content).concat(input),
      mctx,
      scanDepth: +s.story.scanDepth || 2,
      budgetTokens: Math.max(400, Math.floor(budgetAll * 0.25)),
    });
    const system = systemPrompt(ctx, mctx, wi);
    const director = directorBlock(ctx, mctx, wi);
    const finalUser = input + '\n\n' + director;

    let remain = budgetAll - TT.estimateTokens(system) - TT.estimateTokens(finalUser) - 64;
    let cut = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      const t = TT.estimateTokens(history[i].content) + 4;
      if (t > remain) break;
      remain -= t;
      cut = i;
    }
    const kept = history.slice(cut);
    const messages = [{ role: 'system', content: system }];
    if (kept.length && kept[0].role === 'assistant') messages.push({ role: 'user', content: '[故事開始]' });
    for (const h of kept) {
      const last = messages[messages.length - 1];
      if (last.role === h.role && last.role !== 'system') last.content += '\n\n' + h.content;
      else messages.push({ role: h.role, content: h.content });
    }
    const last = messages[messages.length - 1];
    if (last.role === 'user') last.content += '\n\n' + finalUser;
    else messages.push({ role: 'user', content: finalUser });

    // 被裁掉、但尚未寫入前情提要的訊息
    const dropped = history.slice(0, cut).map((h) => h.ref);
    const lastDroppedIndex = dropped.length ? session.messages.indexOf(dropped[dropped.length - 1]) : -1;
    return { messages, info: { wiCount: wi.count, dropped: dropped.length, lastDroppedIndex, systemTokens: TT.estimateTokens(system) } };
  }

  // 序章改編
  function buildGreeting(ctx, greetingText) {
    const mctx = macroCtx(ctx);
    const wi = TT.wi.activate({ books: books(ctx.card), texts: [greetingText], mctx, scanDepth: 1, budgetTokens: 3000 });
    const system = systemPrompt(ctx, mctx, wi, { withSummary: false });
    const user =
      '【序章原文】\n' + greetingText.trim() +
      '\n\n請把上面的序章原文改編成分鏡腳本：保留原文的情節、台詞與氛圍（冗長處可精簡、畫面不足處可補足），不要推進到序章之後的劇情，也不要替 {{user}} 行動。\n\n' +
      directorBlock(ctx, mctx, wi);
    return [{ role: 'system', content: system }, { role: 'user', content: M(user, mctx) }];
  }

  function buildSummary(ctx, msgs) {
    const st = TT.settings.story;
    const lang = LANGS[st.language] || LANGS['zh-Hant'];
    const mctx = macroCtx(ctx);
    const transcript = msgs
      .map((m) => {
        const c = cur(m);
        if (m.role === 'user') return `${mctx.user}：${M(c.raw, mctx)}`;
        return TT.parser.beatsToProse(c.beats, { withScene: false });
      })
      .filter(Boolean)
      .join('\n');
    return [
      { role: 'system', content: '你是互動故事的記錄員，負責維護「前情提要」，讓作者在長篇故事中不會遺忘重要細節。' },
      {
        role: 'user',
        content:
          `【故事】${mctx.char} 與 ${mctx.user}\n\n【既有前情提要】\n${(ctx.session.summary || '').trim() || '（無）'}\n\n【新增劇情】\n${transcript}\n\n` +
          `請整合成新的前情提要：條列重要事件、人物關係與情感變化、承諾與約定、伏筆、目前所在地點與狀態。保留專有名詞，刪除無關細節，控制在 500 字以內，使用${lang}。只輸出前情提要本身。`,
      },
    ];
  }

  function buildAppearance(name, description) {
    return [
      {
        role: 'user',
        content:
          '根據以下角色資料，寫出適合 AI 繪圖的英文外貌標籤，以逗號分隔，只描述外觀：性別與年齡感、髮型與髮色、瞳色、臉部特徵、常穿的服裝、體型、配件。不要描述個性、背景或畫風，不要任何說明，只輸出一行標籤。\n\n' +
          `【角色名】${name}\n【資料】\n${TT.truncate(TT.stripHtml(description || ''), 4000)}`,
      },
    ];
  }

  TT.prompt = { DEFAULT_MAIN, DEFAULT_FORMAT, LANGS, LENGTHS, CONTINUE_TEXT, RESUME_TEXT, macroCtx, build, buildGreeting, buildSummary, buildAppearance, systemPrompt, directorBlock };
})();
