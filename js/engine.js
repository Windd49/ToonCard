/* 劇情引擎：建立存檔、送出回合、重新生成、分支、前情提要、狀態推導 */
(function () {
  'use strict';
  const TT = window.TT;
  const cur = (m) => m && m.swipes[m.sw || 0];
  const now = () => Date.now();

  const stripThink = (t) =>
    String(t || '')
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<think(?:ing)?>[\s\S]*$/i, '')
      .replace(/^\s*```[a-z]*\s*$/gim, '')
      .trim();

  // 由訊息推導目前的數值、登場角色外貌與結局
  // chars：角色專屬狀態 { 角色名: { 關係, 資訊, 內心話, … } }（stats 裡則以「角色名・狀態名」為鍵）
  // appeared：角色池（作品設定的登場人物名單）裡已經在劇情登場的角色，加上主角；只有他們有資訊欄
  // others：劇情裡出現、有狀態或登錄了外貌，但不在角色池的角色（名字 → { tags, 關係, 資訊 }），作品設定可以一鍵加入
  // 路人（暴徒、士兵、守衛、櫃台服務員…）完全不算角色
  function deriveState(session, card, persona) {
    const stats = {};
    const chars = {};
    const cast = {};
    const appeared = new Set();
    const others = {};
    const extra = (n) => !!(card && TT.cast && TT.cast.isExtra(card, n));
    const pool = new Set(card && TT.cast ? TT.cast.pool(card) : []);
    const me = persona && persona.name;
    if (card) cast[card.nickname || card.name] = { kind: 'char', tags: card.appearance || '' };
    // 作品自帶的主要登場人物
    for (const c of (card && card.castList) || []) if (!cast[c.name]) cast[c.name] = { kind: 'char', tags: c.appearance || '' };
    if (persona) cast[persona.name] = { kind: 'user', tags: persona.appearance || '' };
    // 同一個角色的不同叫法算同一人（舊存檔裡的名字也一起合併）
    const canon = (n) => (card && TT.cast ? TT.cast.canon(card, n, persona) : n);
    let ending = '';
    const msgs = (session && session.messages) || [];
    let lastAssistant = null;
    for (const m of msgs) {
      if (m.role !== 'assistant') continue;
      const sw = cur(m);
      if (!sw) continue;
      lastAssistant = sw;
      for (const b of sw.beats || []) {
        if (b.t === 'stat') {
          // 角色專屬狀態以「角色名・狀態名」為鍵；寫給主角的算主角狀態
          let who = b.who ? canon(b.who) : '';
          if (who === me) who = '';
          if (who && extra(who)) continue;
          // 不在角色池的角色：不顯示、不累計，只記下關係與資訊（加入角色池時當預設值）
          if (who && !pool.has(who)) {
            const o = (others[who] = others[who] || {});
            if (b.name === '關係' || b.name === '資訊') o[b.name] = b.value;
            continue;
          }
          const key = who ? `${who}・${b.name}` : b.name;
          const old = stats[key];
          if (b.op === '=') stats[key] = b.value;
          else {
            const base = typeof old === 'number' ? old : parseFloat(old) || 0;
            stats[key] = Math.round((base + (b.op === '-' ? -b.value : b.value)) * 100) / 100;
          }
          if (who) { (chars[who] = chars[who] || {})[b.name] = stats[key]; appeared.add(who); }
        } else if (b.t === 'cast') {
          const n = canon(b.name);
          if (extra(n)) continue;
          if (!cast[n]) cast[n] = { kind: 'npc', tags: b.tags };
          else if (!cast[n].tags) cast[n].tags = b.tags;
          if (pool.has(n)) appeared.add(n);
          else if (n !== me) (others[n] = others[n] || {}).tags = b.tags;
        } else if ((b.t === 'say' || b.t === 'think') && b.name) {
          const n = canon(b.name);
          if (extra(n)) continue;
          if (!cast[n]) cast[n] = { kind: 'npc', tags: '' };
          if (pool.has(n)) appeared.add(n);
        }
      }
    }
    const e = endingOf(lastAssistant);
    if (e) ending = e.title;
    for (const [n, o] of Object.entries((session && session.castOverrides) || {})) {
      const base = cast[n] || { kind: 'npc', tags: '' };
      cast[n] = { ...base, ...o, tags: o.tags || base.tags };
    }
    // 主角一開始就在場
    if (persona) appeared.add(persona.name);
    return { stats, chars, cast, ending, appeared, others };
  }

  // 這段回覆真的是結局嗎：有 [END] 而且沒有 [CHOICE]。
  // 模型常把 [END] 當成「這段寫完了」的記號、後面又給了選項，那種不算結局，不然每回合都會跳出結局畫面
  function endingOf(sw) {
    const beats = (sw && sw.beats) || [];
    if (!beats.length || beats.some((b) => b.t === 'choice')) return null;
    return beats.find((b) => b.t === 'end') || null;
  }

  // 回覆是空的（失敗或在寫出任何一句前就暫停）
  const emptyReply = (m) => !!(m && m.role === 'assistant' && cur(m) && (cur(m).error || cur(m).paused) && !(cur(m).beats || []).length);

  function knownNames(ctx) {
    return new Set(Object.keys(deriveState(ctx.session, ctx.card, ctx.persona).cast));
  }

  function greetings(card) {
    return [card.first_mes, ...(card.alternate_greetings || [])].filter((g) => g && g.trim());
  }

  const engine = {
    gen: null, // { sessionId, msgId, controller }
    status: '',
    deriveState,
    greetings,
    cur,
    emptyReply,
    endingOf,

    isGenerating: (sessionId) => !!engine.gen && (!sessionId || engine.gen.sessionId === sessionId),

    async loadContext(sessionId) {
      const session = await TT.store.getSession(sessionId);
      if (!session) return null;
      const card = TT.store.getCard(session.cardId);
      if (!card) return null;
      const persona = TT.store.getPersona(session.personaId) || TT.store.defaultPersona();
      return { session, card, persona };
    },

    async createSession(card, persona, greetingIndex = 0) {
      const gs = greetings(card);
      const g = gs[greetingIndex] != null ? gs[greetingIndex] : gs[0] || '';
      const d = new Date();
      const s = {
        id: TT.uid(), cardId: card.id, personaId: persona.id,
        title: `序章 ${greetingIndex + 1}・${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        createdAt: now(), updatedAt: now(), greetingIndex,
        messages: [], summary: '', summaryUpTo: -1, castOverrides: {}, vars: {}, version: 1,
      };
      const ctx = { session: s, card, persona };
      if (g) {
        const text = TT.macros.apply(g, TT.prompt.macroCtx(ctx));
        const beats = TT.parser.parseAll(text, { defaultSpeaker: card.nickname || card.name, knownNames: knownNames(ctx) });
        beats.forEach((b) => { if (b.t === 'scene') b.status = b.prompt && TT.img.scenesEnabled() ? 'pending' : 'none'; });
        s.messages.push({ id: TT.uid(), role: 'assistant', kind: 'greeting', swipes: [{ raw: text, beats, time: now(), orig: text }], sw: 0, time: now() });
      }
      card.lastPlayed = now();
      await TT.store.saveCard(card);
      await TT.store.saveSession(s, true);
      // 主角色的立繪（與表情）還沒準備好時，在背景補畫
      if (TT.settings.image.portraits) TT.img.enqueuePortrait(card, card.nickname || card.name, card.appearance);
      TT.achv.unlock('first_story');
      TT.bus.emit('sessions:changed');
      return s;
    },

    // 共用的生成流程：把串流輸出解析成 beats，寫入 msg.swipes[swipeIdx]
    // append：暫停後繼續生成，接在已經寫好的內容後面
    // prepare(signal)：送出前的準備（整理前情提要再組提示詞），回傳 messages；這段時間也算生成中，可以暫停或停止
    async _run(ctx, msg, swipeIdx, messages, { append = false, prepare = null } = {}) {
      const { session, card } = ctx;
      const sw = msg.swipes[swipeIdx];
      const prefix = append ? (sw.raw || '').trim() : '';
      if (!append) { sw.raw = ''; sw.beats = []; }
      sw.time = now();
      delete sw.error;
      delete sw.paused;
      msg.pending = true;
      const controller = new AbortController();
      engine.gen = { sessionId: session.id, msgId: msg.id, controller, cardName: card.name, paused: false };
      const joined = (t) => (prefix ? `${prefix}\n${t}` : t);
      TT.bus.emit('gen:start', { sessionId: session.id, msgId: msg.id });
      const auto = TT.img.scenesEnabled() && TT.settings.image.auto;
      const names = knownNames(ctx);
      let acc = '';
      // 角色名統一成名單上的名字（原本的叫法留在 alias），立繪、狀態、外貌才不會分成好幾個人
      const canon = (n) => TT.cast.canon(card, n, ctx.persona);
      const parser = TT.parser.createStream({
        defaultSpeaker: card.nickname || card.name,
        knownNames: names,
        onBeat: (b) => {
          if (b.t === 'scene') b.status = TT.img.scenesEnabled() ? (auto ? 'pending' : 'idle') : 'none';
          if ((b.t === 'say' || b.t === 'think' || b.t === 'cast') && b.name) {
            const n = canon(b.name);
            if (n !== b.name) { b.alias = b.name; b.name = n; }
          }
          if (b.t === 'stat' && b.who) b.who = canon(b.who);
          if (b.t === 'cast') {
            // 名單上、已經登錄過外貌的角色，以及路人（暴徒、士兵…）都不登錄、不畫立繪
            const known = names.has(b.name) || TT.cast.find(card, b.name) || TT.cast.isExtra(card, b.name);
            names.add(b.name);
            if (!known && TT.settings.image.portraits && b.name !== (ctx.persona && ctx.persona.name)) TT.img.enqueuePortrait(card, b.name, b.tags);
          }
          sw.beats.push(b);
          const index = sw.beats.length - 1;
          if (b.t === 'scene' && auto) TT.img.enqueue({ sessionId: session.id, msgId: msg.id, swipe: swipeIdx, beat: index });
          TT.bus.emit('gen:beat', { sessionId: session.id, msgId: msg.id, swipe: swipeIdx, index, beat: b });
        },
      });
      let error = null;
      let reasoned = false;
      // 模型忙線（429／503）時會自動等一下再重試：狀態列顯示倒數，回覆開始後換回原本的狀態
      let base = '';
      let busyNote = false;
      const note = (text) => { engine.status = text; TT.bus.emit('gen:status', { sessionId: session.id, text }); };
      const clearNote = () => { if (busyNote) { busyNote = false; note(base); } };
      try {
        if (prepare) messages = await prepare(controller.signal);
        base = engine.status;
        await TT.llm.chat({
          messages,
          signal: controller.signal,
          onWait: (sec, n, total, code) => {
            busyNote = true;
            note(n ? `模型忙線中${code ? `（HTTP ${code}）` : ''}，約 ${sec} 秒後自動重試（第 ${n}/${total} 次）…` : `模型忙線中，約 ${sec} 秒後送出…`);
          },
          onText: (t) => { clearNote(); acc += t; parser.feed(t); TT.bus.emit('gen:text', { sessionId: session.id, msgId: msg.id, partial: parser.partial(), thinking: parser.thinking() }); },
          onReasoning: (t) => { clearNote(); reasoned = true; TT.bus.emit('gen:text', { sessionId: session.id, msgId: msg.id, partial: '', thinking: true, thought: t || '' }); },
        });
        parser.finish();
        sw.raw = joined(stripThink(acc));
        if (!sw.beats.length) {
          throw new Error(reasoned && !acc.trim()
            ? '模型把字數都花在思考上，沒有寫出劇情。請提高「單次回覆上限」，或在「額外請求參數」加上 {"reasoning_effort": "low"}。'
            : '模型沒有回傳可用的內容');
        }
      } catch (e) {
        const paused = e.name === 'AbortError' && engine.gen && engine.gen.paused;
        // 暫停時寫到一半的那一行先丟掉，「繼續生成」時從完整的一行接著寫
        const tail = paused ? parser.partial() : '';
        parser.finish(paused);
        if (paused) {
          sw.raw = joined(stripThink(tail ? acc.slice(0, acc.length - tail.length) : acc));
          sw.paused = true;
        } else if (e.name === 'AbortError' && sw.beats.length) {
          sw.raw = joined(stripThink(acc));
        } else {
          error = e;
          sw.error = TT.llm.describeError(e);
        }
      } finally {
        clearNote();
        delete msg.pending;
        engine.gen = null;
        await TT.store.saveSession(session, true);
        TT.bus.emit('gen:end', { sessionId: session.id, msgId: msg.id, error: error ? sw.error : null });
      }
      return !error;
    },

    async adaptGreeting(ctx) {
      const msg = ctx.session.messages.find((m) => m.kind === 'greeting');
      if (!msg || engine.gen) return false;
      const orig = cur(msg).orig || cur(msg).raw;
      const backup = TT.clone(cur(msg));
      engine.status = '改編序章中…';
      const ok = await engine._run(ctx, msg, msg.sw || 0, TT.prompt.buildGreeting(ctx, orig));
      engine.status = '';
      TT.bus.emit('gen:status', { sessionId: ctx.session.id, text: '' });
      const sw = cur(msg);
      sw.orig = orig;
      if (!ok) {
        // 改編失敗時保留原本的序章
        msg.swipes[msg.sw || 0] = { ...backup, error: sw.error };
        await TT.store.saveSession(ctx.session, true);
        TT.bus.emit('session:changed', { sessionId: ctx.session.id });
      }
      return ok;
    },

    async send(ctx, text, { hidden = false } = {}) {
      if (engine.gen) return false;
      const { session, persona } = ctx;
      // 移除上一次失敗或暫停、沒有內容的回覆
      const last = session.messages[session.messages.length - 1];
      if (emptyReply(last) && last.swipes.length === 1 && last.kind !== 'greeting') session.messages.pop();
      if (text != null && String(text).trim()) {
        const raw = String(text).trim();
        const shown = TT.macros.apply(raw, TT.prompt.macroCtx(ctx));
        session.messages.push({ id: TT.uid(), role: 'user', hidden, swipes: [{ raw, beats: hidden ? [] : TT.parser.parseUserInput(shown, persona.name), time: now() }], sw: 0, time: now() });
      }
      const msg = { id: TT.uid(), role: 'assistant', swipes: [{ raw: '', beats: [], time: now() }], sw: 0, time: now() };
      session.messages.push(msg);
      TT.bus.emit('session:changed', { sessionId: session.id });
      // 先把被擠出上下文的舊訊息寫進前情提要，再組提示詞。整理的這段時間也算生成中：
      // 以前這段空檔可以再按一次選項或送出鍵，同時送出兩個回合（兩份摘要＋兩段劇情），也停不下來
      const ok = await engine._run(ctx, msg, 0, null, {
        prepare: async (signal) => {
          await engine.maybeSummarize(ctx, msg.id, false, signal);
          return TT.prompt.build(ctx, { targetId: msg.id }).messages;
        },
      });
      if (ok) engine._afterTurn(ctx, msg);
      return ok;
    },

    continueStory: (ctx) => engine.send(ctx, TT.prompt.CONTINUE_TEXT, { hidden: true }),

    async regenerate(ctx) {
      if (engine.gen) return false;
      const { session } = ctx;
      const last = session.messages[session.messages.length - 1];
      if (!last || last.role !== 'assistant') return engine.send(ctx, null);
      if (last.kind === 'greeting') return engine.adaptGreeting(ctx);
      let idx = last.sw || 0;
      if (!emptyReply(last)) {
        last.swipes.push({ raw: '', beats: [], time: now() });
        idx = last.swipes.length - 1;
        last.sw = idx;
      }
      TT.bus.emit('session:changed', { sessionId: session.id });
      const { messages } = TT.prompt.build(ctx, { targetId: last.id });
      const ok = await engine._run(ctx, last, idx, messages);
      if (ok) engine._afterTurn(ctx, last);
      return ok;
    },

    _afterTurn(ctx, msg) {
      TT.achv.bump('turns');
      const h = new Date().getHours();
      if (h >= 0 && h < 4) TT.achv.unlock('night_owl');
      const end = endingOf(cur(msg));
      if (end) {
        TT.achv.recordEnding(ctx.card, ctx.session, end.title);
        TT.bus.emit('story:ending', { sessionId: ctx.session.id, msgId: msg.id, title: end.title });
      }
      ctx.card.lastPlayed = now();
      TT.store.saveCard(ctx.card);
    },

    stop() {
      if (engine.gen) engine.gen.controller.abort();
    },

    // 暫停：中斷串流但保留已經寫好的部分（標記 paused），之後可以 resume 接著寫
    pause() {
      if (!engine.gen) return;
      engine.gen.paused = true;
      engine.gen.controller.abort();
      TT.bus.emit('tasks:changed');
    },

    // 最後一則回覆是暫停的：還沒寫出任何一句就重新生成，否則請模型從中斷處接著寫
    async resume(ctx) {
      if (engine.gen) return false;
      const msg = ctx.session.messages[ctx.session.messages.length - 1];
      const sw = cur(msg);
      if (!msg || msg.role !== 'assistant' || !sw || !sw.paused) return false;
      const idx = msg.sw || 0;
      const greeting = msg.kind === 'greeting';
      const base = greeting ? TT.prompt.buildGreeting(ctx, sw.orig || sw.raw) : TT.prompt.build(ctx, { targetId: msg.id }).messages;
      if (greeting) engine.status = '改編序章中…';
      const has = (sw.beats || []).length > 0;
      const messages = has ? base.concat([{ role: 'assistant', content: sw.raw }, { role: 'user', content: TT.prompt.RESUME_TEXT }]) : base;
      const ok = await engine._run(ctx, msg, idx, messages, { append: has });
      if (greeting) { engine.status = ''; TT.bus.emit('gen:status', { sessionId: ctx.session.id, text: '' }); }
      if (ok && !cur(msg).paused && !greeting) engine._afterTurn(ctx, msg);
      return ok;
    },

    setSwipe(ctx, msgId, dir) {
      const m = ctx.session.messages.find((x) => x.id === msgId);
      if (!m || engine.gen) return;
      const n = TT.clamp((m.sw || 0) + dir, 0, m.swipes.length - 1);
      if (n === (m.sw || 0)) return;
      m.sw = n;
      TT.store.saveSession(ctx.session);
      TT.bus.emit('session:changed', { sessionId: ctx.session.id });
    },

    // 保留 0..index（含）的訊息，其餘刪除
    async rewind(ctx, index) {
      const { session } = ctx;
      const removed = session.messages.slice(index + 1);
      session.messages = session.messages.slice(0, index + 1);
      const ids = [];
      removed.forEach((m) => m.swipes.forEach((sw) => (sw.beats || []).forEach((b) => b.imageId && ids.push(b.imageId))));
      if (ids.length) { await TT.db.delMany('images', ids); ids.forEach((id) => TT.media.invalidate('img', id)); }
      if (session.summaryUpTo > index) { session.summary = ''; session.summaryUpTo = -1; }
      await TT.store.saveSession(session, true);
      TT.bus.emit('session:changed', { sessionId: session.id });
    },

    async editMessage(ctx, index, text) {
      const m = ctx.session.messages[index];
      if (!m) return;
      const sw = cur(m);
      if (m.role === 'user') {
        sw.raw = text;
        sw.beats = TT.parser.parseUserInput(TT.macros.apply(text, TT.prompt.macroCtx(ctx)), ctx.persona.name);
      } else {
        const oldScenes = (sw.beats || []).filter((b) => b.t === 'scene');
        sw.raw = text;
        sw.beats = TT.parser.parseAll(text, { defaultSpeaker: ctx.card.nickname || ctx.card.name, knownNames: knownNames(ctx) });
        let k = 0;
        for (const b of sw.beats) {
          if (b.t !== 'scene') continue;
          const o = oldScenes[k++];
          if (o && o.imageId) { b.imageId = o.imageId; b.status = 'done'; } else b.status = TT.img.scenesEnabled() ? 'idle' : 'none';
        }
      }
      await TT.store.saveSession(ctx.session, true);
      TT.bus.emit('session:changed', { sessionId: ctx.session.id });
    },

    async branch(ctx, index) {
      const src = ctx.session;
      const s = TT.clone({ ...src, messages: src.messages.slice(0, index + 1) });
      s.id = TT.uid();
      s.title = src.title.replace(/（分支\d*）$/, '') + '（分支）';
      s.createdAt = now();
      if (s.summaryUpTo > index) { s.summary = ''; s.summaryUpTo = -1; }
      // 複製圖片紀錄，讓分支不受原存檔刪除影響
      for (const m of s.messages) {
        for (const sw of m.swipes) {
          for (const b of sw.beats || []) {
            if (!b.imageId) continue;
            const rec = await TT.db.get('images', b.imageId);
            if (!rec) { delete b.imageId; continue; }
            const id = TT.uid();
            await TT.db.put('images', { ...rec, id, sessionId: s.id });
            b.imageId = id;
          }
        }
      }
      await TT.store.saveSession(s, true);
      TT.achv.unlock('branch');
      TT.bus.emit('sessions:changed');
      return s;
    },

    // 被擠出上下文的舊訊息寫進前情提要（signal：這一回合被暫停或停止時一起中斷）
    async maybeSummarize(ctx, targetId, force = false, signal = null) {
      const { session } = ctx;
      if (!TT.settings.story.summary && !force) return;
      let to;
      if (force) to = session.messages.length - 7;
      else {
        const { info } = TT.prompt.build(ctx, { targetId });
        to = info.lastDroppedIndex;
      }
      const from = (session.summaryUpTo == null ? -1 : session.summaryUpTo) + 1;
      if (to < from) return;
      const msgs = session.messages.slice(from, to + 1).filter((m) => cur(m) && !m.pending && !cur(m).error);
      if (msgs.length < (force ? 1 : 2)) return;
      engine.status = '整理前情提要中…';
      TT.bus.emit('gen:status', { sessionId: session.id, text: engine.status });
      try {
        // 摘要不需要深思：Gemini／Vertex 用低思考，回得快，也少佔模型的輸出額度（這一步做完劇情才開始寫）
        const cfg = /^(gemini|vertex)$/.test(TT.settings.llm.type) ? { thinking: 'low' } : undefined;
        const text = await TT.llm.complete(TT.prompt.buildSummary(ctx, msgs), { maxTokens: 3000, signal, cfg });
        const clean = stripThink(text);
        if (clean) {
          session.summary = clean;
          session.summaryUpTo = to;
          await TT.store.saveSession(session, true);
        }
      } catch (e) {
        // 暫停或停止：交給這一回合的生成流程處理
        if (e.name === 'AbortError') throw e;
        console.warn('前情提要更新失敗', e);
        TT.toast('前情提要更新失敗：' + TT.llm.describeError(e), { type: 'error' });
      } finally {
        engine.status = '';
        TT.bus.emit('gen:status', { sessionId: session.id, text: '' });
      }
    },

    regenerateImage(ctx, msgId, swipe, beat, prompt) {
      const m = ctx.session.messages.find((x) => x.id === msgId);
      const b = m && m.swipes[swipe] && m.swipes[swipe].beats[beat];
      if (!b) return;
      if (!TT.img.enabled()) { TT.toast('請先在設定中選擇圖像生成服務'); return; }
      if (prompt != null) b.prompt = prompt;
      b.status = 'pending';
      delete b.error;
      TT.img.enqueue({ sessionId: ctx.session.id, msgId, swipe, beat });
      TT.bus.emit('img:update', { sessionId: ctx.session.id, msgId, swipe, beat, status: 'pending' });
    },

    // 交由 AI 構想：使用者不想自己寫時，依名稱、角色資料與作品內容寫出
    // 立繪／特殊場景圖／背景的說明與畫法（sprite／cg／bg）、角色的關係與資訊與外貌（char）、主角設定與外貌（hero）
    async conceive({ type, card, persona = null, name = '', who = '', desc = '' }) {
      const entry = card && who ? TT.cast.find(card, who) : null;
      const look = (entry && entry.appearance) || (persona && who === persona.name ? persona.appearance : '') || (card && who && (who === card.name || who === card.nickname) ? card.appearance : '');
      const what = name ? `「${name}」${desc ? `（${desc}）` : ''}` : desc ? `（${desc}）` : '';
      const tasks = {
        sprite: `替角色「${who}」構想一張立繪${what}：此刻的表情、動作、姿勢、服裝或道具（單人立繪）。只輸出 JSON：{"name":"4～8 個字的中文名稱","desc":"一句中文說明（AI 演出時用來挑這張）","prompt":"English image prompt: expression, pose, gesture, outfit, props"}`,
        cg: `構想一張特殊場景圖${what}：有角色的事件插圖，符合這個作品的人物與氣氛。只輸出 JSON：{"name":"4～8 個字的中文名稱","desc":"什麼場面用（一句中文）","prompt":"English image prompt: characters, action, composition, lighting, mood"}`,
        bg: `構想一張背景圖${what}：這個作品裡的地點，沒有人物。只輸出 JSON：{"name":"2～6 個字的地點名稱","desc":"什麼地點、什麼時候用（一句中文）","prompt":"English background prompt: place, architecture, furniture, time of day, lighting, mood, no people"}`,
        char: `依作品資料，整理角色「${who}」的資料（資料沒寫的就依作品風格合理構想）。只輸出 JSON：{"role":"和主角的關係（簡短）","info":"年齡｜身分或陣營｜武器或專長｜實力（用｜分隔）","appearance":"English appearance tags for image generation"}`,
        hero: `替這個作品構想玩家扮演的主角「${persona ? persona.name : '主角'}」，要適合這個故事。只輸出 JSON：{"description":"主角的身分、性格與背景（2～3 句中文）","appearance":"English appearance tags for image generation"}`,
      };
      const prompt = `${tasks[type]}
${who && type !== 'char' && type !== 'hero' ? `角色：${who}${entry && entry.role ? `（${entry.role}）` : ''}${look ? `，外貌：${look}` : ''}\n` : ''}${persona && type === 'hero' && persona.description ? `目前的主角設定：${persona.description}\n` : ''}
【作品】${card ? card.name : ''}
【作品資料（節錄）】
${card ? TT.truncate(TT.cast.cardText(card), 6000) : ''}`;
      const out = await TT.llm.complete([{ role: 'user', content: prompt }], { maxTokens: 4000, json: true, cfg: { thinking: 'low' } });
      return TT.cast.parseJson(out, '{');
    },

    // 依目前劇情替一張圖寫說明（立繪的新表情或動作、特殊場景圖、背景圖），回傳 { name, desc, prompt }
    async describeForImage(ctx, { type, who = '', hint = '' }) {
      const { session, card, persona } = ctx;
      const recent = session.messages.slice(-4)
        .map((m) => (m.role === 'user' ? (m.hidden ? '' : `${persona.name}：${cur(m).raw}`) : TT.parser.beatsToProse(cur(m).beats)))
        .filter(Boolean).join('\n').slice(-3500);
      const entry = TT.cast.find(card, who);
      const look = (entry && entry.appearance) || (who && (who === card.name || who === card.nickname) ? card.appearance : '') || (persona && who === persona.name ? persona.appearance : '');
      const what = {
        sprite: `角色「${who}」此刻的表情、動作、姿勢與服裝狀態（單人立繪，不畫背景與其他人）`,
        cg: '這一刻最有畫面感的場面（事件插圖，可以有好幾個角色）',
        bg: '目前所在地點的背景（只有場景，不要有任何人物）',
      }[type];
      const prompt = `根據下面的劇情，替一張圖寫說明。要畫的是：${what}。
${who ? `角色：${who}${entry && entry.role ? `（${entry.role}）` : ''}${look ? `，外貌：${look}` : ''}\n` : ''}${hint ? `補充要求：${hint}\n` : ''}只輸出 JSON：{"name":"4～8 個字的中文名稱","desc":"一句中文說明","prompt":"English image prompt, comma separated, describing only what to draw"}

【最近的劇情】
${recent}`;
      const out = await TT.llm.complete([{ role: 'user', content: prompt }], { maxTokens: 4000, json: true, cfg: { thinking: 'low' } });
      const j = TT.cast.parseJson(out, '{');
      return { name: String(j.name || '').trim().slice(0, 16), desc: String(j.desc || '').trim(), prompt: String(j.prompt || '').trim() };
    },

    // 用 AI 依角色描述產生外貌標籤
    async generateAppearance(name, description) {
      const text = await TT.llm.complete(TT.prompt.buildAppearance(name, description), { maxTokens: 400 });
      return stripThink(text).split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    },
  };

  TT.engine = engine;
})();
