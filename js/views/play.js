/* 劇情遊玩畫面
 * 劇場：視覺小說式演出（背景 + 角色立繪 + 字幕 + 上方狀態欄 + 回合結束選擇行動）
 * 漫畫：條漫捲動；小說：純文字回顧
 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s, c) => raw(TT.icon(n, s, c));
  const cur = (m) => m && m.swipes[m.sw || 0];
  // 一格 = 一句看得到的內容；場景、背景、配樂、數值、特殊場景圖、音效不佔格，掛在前後的句子上
  const LINE_TYPES = new Set(['narr', 'say', 'think', 'end']);
  const FX_TYPES = new Set(['scene', 'bg', 'bgm', 'stat', 'cg', 'sfx']);
  // 存檔 id → 離開時看到的那一句（打開設定、詳情等再返回時接著看）
  const lastPos = new Map();

  // 狀態欄依名稱挑圖示
  const HUD_ICONS = [
    [/時間|日期|時辰|時刻|季節|天數|time|date|day/i, 'clock'],
    [/地點|位置|場景|地區|所在|location|place|area/i, 'pin'],
    [/境界|等級|修為|實力|段位|階級|level|rank/i, 'sparkles'],
    [/行程|任務|目標|目的|進度|計畫|quest|task|goal|objective/i, 'calendar'],
    [/好感|愛|親密|戀|信任|關係|羈絆|favor|affection|trust|love/i, 'heart'],
    [/體力|血|生命|HP|健康|傷|精力|health|stamina/i, 'bolt'],
    [/金|錢|銀|幣|財|money|gold|coin/i, 'coin'],
    [/理智|SAN|心情|情緒|壓力|mood|sanity/i, 'brain'],
  ];
  const hudIcon = (name) => (HUD_ICONS.find(([re]) => re.test(name)) || [0, 'gauge'])[1];
  // 角色卡片上每一列的圖示與排序：關係、資訊在前，內心話最後
  const INNER = /內心|心裡話|心聲|inner/i;
  // 好感度這類數值屬於角色（沒寫角色名時算作品主要角色的）
  const AFFECT = /好感|親密|信任|羈絆|愛意|愛情/;
  const rowStyle = (k) => {
    if (INNER.test(k)) return { ic: 'chat', cls: 'k-inner', rank: 9, inner: true };
    if (/關係|身分|身份/.test(k)) return { ic: 'heart', cls: 'k-rel', rank: 0 };
    if (/資訊|資料|情報|簡介|基本/.test(k)) return { ic: 'info', cls: 'k-info', rank: 1 };
    if (/好感|愛|親密|信任|羈絆/.test(k)) return { ic: 'heart', cls: 'k-rel', rank: 2 };
    return { ic: hudIcon(k), cls: 'k-other', rank: 3 };
  };

  const V = (TT.views.play = {
    el: null,
    ctx: null,
    mode: 'theater',
    limit: 60,
    unsubs: [],
    th: null,
    uiHidden: false,
    options: [],

    async mount(el, { sid }) {
      V.el = el;
      V.unsubs = [];
      V.uiHidden = false;
      V.hudOpen = false;
      V.options = [];
      const ctx = await TT.engine.loadContext(sid);
      if (!ctx) {
        el.innerHTML = String(html`<div class="view">${TT.ui.topbar({ title: '找不到存檔', back: true })}${TT.ui.empty({ ic: 'alert', title: '這個存檔不存在或角色卡已刪除' })}</div>`);
        el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) TT.router.back(); });
        return;
      }
      V.ctx = ctx;
      V.mode = ctx.session.mode || TT.settings.story.viewMode || 'theater';
      V.th = {
        steps: [], pos: -1, cur: null, typing: false, typeTimer: null, typeDone: null, typeResolve: null, autoTimer: null, token: 0,
        waiting: false, bgKey: '', cgKey: null, endShown: '', jumpToEnd: false, seen: new Set(), flashed: new WeakSet(),
      };
      V.decide = null;
      TT.app.setBackdrop('card', ctx.card.id);
      V.renderShell();
      V.bind();
      V.subscribe();
      V.preloadSprites();
      V.refreshAll(true, true);
      // 舊作品還沒有登場人物名單：在背景整理一次，之後角色名、立繪與狀態都用同一份名單
      const castJob = !ctx.card.castListAt && TT.ui.llmReady() ? TT.cast.ensure(ctx.card) : null;
      if (castJob) castJob.then(() => { if (V.ctx === ctx) { V.renderHud(); V.refreshSprites(); } });

      const g = ctx.session.messages.find((m) => m.kind === 'greeting');
      if (g && !g.adaptTried && ctx.session.messages.length === 1 && TT.settings.story.adaptGreeting && TT.ui.llmReady()) {
        V.adaptAfter(ctx, g, castJob);
      } else if (!TT.ui.llmReady()) {
        setTimeout(async () => {
          if (V.ctx && (await TT.actions.ensureLLM()) && V.ctx && g && !g.adaptTried && TT.settings.story.adaptGreeting) {
            g.adaptTried = true;
            TT.engine.adaptGreeting(V.ctx);
          }
        }, 400);
      }
    },

    // 改編序章：登場人物名單還在整理時（開演前按了「略過」）先等它整理完再送出。
    // 同一個模型不同時送兩個大請求（容易被限流 429），改編出來的序章也會用名單上的名字
    async adaptAfter(ctx, g, castJob) {
      const WAIT = '整理登場人物中…';
      if (castJob) {
        TT.engine.status = WAIT;
        TT.bus.emit('gen:status', { sessionId: ctx.session.id, text: WAIT });
        await castJob;
        if (TT.engine.status === WAIT) {
          TT.engine.status = '';
          TT.bus.emit('gen:status', { sessionId: ctx.session.id, text: '' });
        }
      }
      // 等待期間離開了或已經開始下一回合：不改編，下次進來再改編
      if (V.ctx !== ctx || g.adaptTried || ctx.session.messages.length !== 1) return;
      g.adaptTried = true;
      TT.store.saveSession(ctx.session);
      TT.engine.adaptGreeting(ctx);
    },

    unmount() {
      V.unsubs.forEach((f) => f());
      V.unsubs = [];
      // 記住看到哪一句，返回時從這裡接著看（重新開啟程式時則從最新回合開始）
      if (V.ctx && V.th && V.th.cur && V.mode === 'theater') lastPos.set(V.ctx.session.id, V.th.cur);
      if (V.th) { V.stopTyping(); clearTimeout(V.th.autoTimer); }
      if (V.ro) V.ro.disconnect();
      document.removeEventListener('keydown', V.onKey);
      delete document.body.dataset.pmode;
      TT.tts.stop();
      TT.stt.stop();
      TT.sfx.stopAll();
      TT.bgm.stop(400);
      V.ctx = null;
    },

    /* ---------- 版面 ---------- */
    renderShell() {
      const { card, session, persona } = V.ctx;
      const [w, h] = TT.img.dims(TT.settings.image);
      V.el.innerHTML = String(html`
        <div class="view play mode-${V.mode}" style="--panel-ar:${w} / ${h}">
          <div class="stage">
            <div class="stage-bg"><img class="bg-img" alt=""><img class="bg-img" alt=""></div>
            <div class="stage-chars"></div>
            <div class="stage-cg"></div>
            <div class="stage-shade"></div>
            <div class="stage-tap tap-l" data-act="prev" title="上一句（←）"></div>
            <div class="stage-tap tap-r" data-act="advance"></div>
            <div class="stage-text">
              <div class="stage-sfx" hidden></div>
              <div class="st-name" hidden><span></span></div>
              <div class="st-line"></div>
              <div class="st-wait" hidden><i></i><i></i><i></i><span></span></div>
              <span class="st-next">${icon('play', 11)}</span>
            </div>
            <div class="stage-top">
              <div class="st-bar">
                <button class="st-icon" data-act="back" aria-label="返回">${icon('back', 22)}</button>
                <b class="st-title">${card.name}</b>
                <div class="st-icons">
                  <button class="st-icon st-auto" data-act="auto" title="自動播放">AUTO</button>
                  <button class="st-icon st-bgm" data-act="bgm" title="配樂（開／關）">${icon('music', 20)}</button>
                  <button class="st-icon" data-act="tts" title="朗讀" ${TT.tts.supported ? '' : 'hidden'}>${icon('volume', 21)}</button>
                  <button class="st-icon" data-act="framecg" title="只依目前這一個分鏡生成特殊場景圖">${icon('image', 20)}</button>
                  <button class="st-icon" data-act="hideui" title="隱藏介面">${icon('eyeOff', 21)}</button>
                  <button class="st-icon" data-act="log" title="劇情回顧">${icon('clock', 21)}</button>
                  <button class="st-icon" data-act="menu" title="選單（Esc）">${icon('gear', 21)}</button>
                </div>
              </div>
              <div class="stage-hud" data-act="hud" role="button" title="角色、立繪與狀態"></div>
              <div class="stage-hud-more" hidden></div>
              <div class="stage-toast" hidden></div>
            </div>
            <div class="stage-action" hidden>
              <div class="sa-text"></div>
              <div class="sa-err" hidden></div>
              <div class="sa-note" hidden>${icon('pause', 13)} 已暫停：可以繼續生成，或重新選擇、重新生成</div>
              <div class="sa-bar">
                <button class="st-btn" data-act="regen" title="重新生成這段">${icon('refresh', 18)}</button>
                <button class="sa-pill" data-act="rechoose" title="回到這個回合之前的選擇點，改選另一個選項">重新選擇 ${icon('down', 14)}</button>
                <button class="sa-pill" data-act="pausegen" title="暫停生成（保留已寫好的部分）">${icon('pause', 13)} 暫停</button>
                <button class="sa-pill gold" data-act="resumegen" title="從暫停的地方接著寫">${icon('play', 12)} 繼續生成</button>
              </div>
              <div class="sa-menu" hidden></div>
            </div>
            <button class="stage-badge" data-act="bgretry" hidden></button>
            <div class="stage-nav">
              <button class="st-btn" data-act="prevchoice" title="上一個選擇點（Shift＋←）">${icon('rewind', 20)}</button>
              <button class="st-btn" data-act="nextchoice" title="下一個選擇點／最新（Shift＋→）">${icon('ffwd', 20)}</button>
            </div>
            <div class="stage-decide" hidden>
              <div class="sd-top">
                <div class="sd-head" hidden></div>
                <div class="sd-options"></div>
                <div class="sd-row"><button class="sd-prev" data-act="prevchoice">${icon('rewind', 12)} 上一個選擇點</button><button class="sd-auto" data-act="continue">${icon('play', 12)} 自動進行</button></div>
              </div>
              <div class="sd-bottom">
                <div class="sd-input">
                  <button class="icon-btn mic-btn" data-act="mic" title="語音輸入" ${TT.stt.supported ? '' : 'hidden'}>${icon('mic', 20)}</button>
                  <textarea rows="1" class="composer-input" data-input="theater" placeholder="請輸入下一句台詞或行動（${persona.name}）"></textarea>
                  <button class="send-btn" data-act="send" title="送出">${icon('send', 18)}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="reader"></div>
          <header class="play-top">
            <button class="icon-btn glass" data-act="back" aria-label="返回">${icon('back', 22)}</button>
            <div class="play-title"><b>${card.name}</b><small class="play-sub">${session.title}</small></div>
            <div class="seg" role="tablist">
              <button data-mode="theater" title="劇場模式">${icon('film', 17)}<span>劇場</span></button>
              <button data-mode="comic" title="漫畫模式">${icon('comic', 17)}<span>漫畫</span></button>
              <button data-mode="novel" title="小說模式">${icon('text', 17)}<span>小說</span></button>
            </div>
            <button class="icon-btn glass" data-act="menu" aria-label="選單">${icon('more', 22)}</button>
          </header>
          <div class="hud reader-hud"></div>
          <div class="play-bottom">
            <div class="gen-line" hidden></div>
            <div class="choices"></div>
            <div class="composer">
              <button class="icon-btn mic-btn" data-act="mic" title="語音輸入" ${TT.stt.supported ? '' : 'hidden'}>${icon('mic', 22)}</button>
              <textarea rows="1" class="composer-input" data-input="reader" placeholder="以「${persona.name}」的身分說話或行動…"></textarea>
              <button class="send-btn" data-act="send" title="送出">${icon('send', 20)}</button>
            </div>
            <div class="quickbar">
              <button data-act="continue">${icon('play', 13)}<span>繼續劇情</span></button>
              <button data-act="regen">${icon('refresh', 13)}<span>重新生成</span></button>
              <button data-act="tts" ${TT.tts.supported ? '' : 'hidden'}>${icon('volume', 13)}<span>朗讀</span></button>
            </div>
          </div>
        </div>`);
      V.root = V.el.querySelector('.play');
      const pb = V.el.querySelector('.play-bottom');
      const sdb = V.el.querySelector('.sd-bottom');
      const top = V.el.querySelector('.stage-top');
      // 在下一個畫面更新時才改 CSS 變數，避免 ResizeObserver 在同一輪裡互相觸發
      V.ro = new ResizeObserver(() => requestAnimationFrame(() => {
        if (!V.root) return;
        V.root.style.setProperty('--pb-h', pb.offsetHeight + 'px');
        V.root.style.setProperty('--sd-h', sdb.offsetHeight + 'px');
        V.root.style.setProperty('--top-h', top.offsetHeight + 'px');
      }));
      V.ro.observe(pb);
      V.ro.observe(sdb);
      V.ro.observe(top);
    },

    inputEl() {
      return V.root.querySelector(V.mode === 'theater' ? '[data-input="theater"]' : '[data-input="reader"]');
    },

    bind() {
      V.root.addEventListener('click', V.onClick);
      // 狀態欄展開的面板就是「角色、立繪與狀態」：齒輪、外貌、聲音、立繪按鈕
      V.bindStateView(V.root.querySelector('.stage-hud-more'), () => V.panelView);
      V.root.addEventListener('input', (e) => { if (e.target.matches('.composer-input')) V.autosize(e.target); });
      V.root.addEventListener('keydown', (e) => {
        if (!e.target.matches('.composer-input')) return;
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          V.submit();
        }
      });
      // ←／→ 或點畫面左右側：上一句／下一句；Shift＋←／→（或 PageUp／PageDown）：上一個／下一個選擇點
      V.onKey = (e) => {
        if (V.mode !== 'theater' || e.target.closest('textarea,input,select') || document.querySelector('.sheet-overlay')) return;
        if ((e.key === 'ArrowLeft' && e.shiftKey) || e.key === 'PageUp') { e.preventDefault(); V.prevChoice(); }
        else if ((e.key === 'ArrowRight' && e.shiftKey) || e.key === 'PageDown') { e.preventDefault(); V.nextChoice(); }
        else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); V.advance(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); V.prev(); }
        else if (e.key === 'Escape') { e.preventDefault(); V.menu(); }
      };
      document.addEventListener('keydown', V.onKey);
    },

    subscribe() {
      const sid = V.ctx.session.id;
      const on = (evt, fn) => V.unsubs.push(TT.bus.on(evt, (d) => { if (V.ctx && (!d || !d.sessionId || d.sessionId === sid)) fn(d || {}); }));
      on('gen:start', (d) => {
        V.thoughtTitle = '';
        V.waitLabel = '';
        V.updateGenUI();
        if (V.mode === 'theater') { V.rebuildSteps(); V.updateTheaterChrome(); } else V.rerenderMsg(d.msgId);
        V.renderChoices();
      });
      on('gen:beat', (d) => V.onBeat(d));
      on('gen:text', (d) => V.onText(d));
      on('gen:status', () => V.updateGenUI());
      on('gen:end', (d) => {
        V.updateGenUI();
        V.renderHud();
        if (V.mode === 'theater') {
          V.rebuildSteps();
          if (V.th.waiting) V.advance(true);
          V.applyLateFx();
          V.markSeen();
          V.updateTheaterChrome();
        } else V.rerenderMsg(d.msgId);
        V.renderChoices();
        // 自己按停止（例如重新選擇）不必再提示
        if (d.error && !V.stopping) TT.toast(d.error, { type: 'error', duration: 5000 });
      });
      on('img:update', (d) => V.onImage(d));
      on('session:changed', () => V.refreshAll());
      // 配樂開關或音量改了：關掉就停，打開就接著放目前這段的配樂
      V.unsubs.push(TT.bus.on('audio:settings', () => { if (!V.ctx) return; TT.bgm.setVolume(); V.th.bgmKey = null; V.syncBgm(); V.updateBgmIcon(); }));
      // 配樂庫加了新音樂：目前這段指定的配樂可能現在才有音檔
      V.unsubs.push(TT.bus.on('sfx:changed', (d) => { if (!V.ctx || !d || d.type !== 'bgm') return; V.th.bgmKey = null; V.syncBgm(); V.updateBgmIcon(); }));
      on('story:ending', (d) => { if (V.mode !== 'theater') V.showEnding(d.title, d.msgId); });
    },

    // restore：剛進入畫面時，回到上次離開時看到的那一句
    refreshAll(first = false, restore = false) {
      V.root.className = `view play mode-${V.mode}${V.uiHidden ? ' ui-off' : ''}`;
      document.body.dataset.pmode = V.mode;
      V.root.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === V.mode));
      V.root.querySelectorAll('[data-act="tts"]').forEach((b) => b.classList.toggle('on', !!TT.settings.audio.tts));
      V.root.querySelector('.play-sub').textContent = V.ctx.session.title;
      V.renderHud();
      if (V.mode === 'theater') {
        V.rebuildSteps();
        const back = restore ? V.restoreIndex() : null;
        if (V.th.jumpToEnd && !first) {
          // 玩家剛行動：跳到最新一格，新內容出現時自動接續
          V.th.jumpToEnd = false;
          V.showStep(V.th.steps.length - 1, { keepWaiting: true });
        } else if (back != null) V.showStep(back, { silentTts: true, keepWaiting: V.followLive(back) });
        else if (first || V.th.pos < 0) V.showStep(V.startIndex(), { silentTts: first });
        else V.showStep(Math.min(V.th.pos, V.th.steps.length - 1), { silentTts: true });
      } else { V.renderReader(true); V.syncBgm(); }
      V.renderChoices();
      V.updateGenUI();
      V.updateBgmIcon();
    },

    // 這次開啟程式後，上次離開這個存檔時看到的那一句
    restoreIndex() {
      const p = lastPos.get(V.ctx.session.id);
      if (!p) return null;
      const steps = V.th.steps;
      let i = p.b ? steps.findIndex((x) => x.b === p.b) : -1;
      if (i < 0) i = steps.findIndex((x) => x.mid === p.mid && x.bi === p.bi);
      return i >= 0 ? i : null;
    },

    setMode(mode) {
      if (mode === V.mode) return;
      V.stopTyping();
      TT.tts.stop();
      V.mode = mode;
      V.ctx.session.mode = mode;
      TT.store.saveSession(V.ctx.session);
      V.th.pos = -1;
      V.th.cur = null;
      V.th.bgKey = '';
      V.refreshAll(true);
    },

    /* ==========================================================
       劇場模式
       ========================================================== */
    // 每一格是一句看得到的內容（旁白、台詞、心聲、擬聲、結局、主角行動）。
    // 場景、數值、特殊場景圖不佔格：掛在下一句前面（pre）；段落最後的掛在最後一句後面（post）
    rebuildSteps() {
      const steps = [];
      let pending = [];
      V.ctx.session.messages.forEach((m, mi) => {
        if (m.hidden) return;
        const sw = cur(m);
        if (!sw) return;
        let last = null;
        (sw.beats || []).forEach((b, bi) => {
          if (FX_TYPES.has(b.t)) { pending.push({ b, bi, mid: m.id, swi: m.sw || 0 }); return; }
          if (!LINE_TYPES.has(b.t)) return;
          // 結局只在整段寫完、而且這段沒有選項時才算（同一段還有選項的 [END] 是模型拿來表示「寫完了」）
          if (b.t === 'end' && (m.pending || !TT.engine.endingOf(sw))) return;
          last = { mi, mid: m.id, swi: m.sw || 0, bi, b, role: m.role, pre: pending, post: [] };
          pending = [];
          steps.push(last);
        });
        if (last && pending.length) { last.post = pending; pending = []; }
      });
      V.th.steps = steps;
      // 以 beat 物件本身辨識目前位置；被重新生成或刪除時視為「目前沒有顯示」
      if (V.th.cur) V.th.pos = steps.findIndex((s) => s.b === V.th.cur.b);
      else if (V.th.pos >= steps.length) V.th.pos = steps.length - 1;
    },

    // 選擇點：每則 AI 訊息的最後一句（正在生成、或暫停還沒寫完的那則不算）
    choicePoints() {
      const steps = V.th.steps;
      const msgs = V.ctx.session.messages;
      const genMid = TT.engine.isGenerating(V.ctx.session.id) && TT.engine.gen.msgId;
      const out = [];
      steps.forEach((s, i) => {
        if (s.role !== 'assistant' || s.mid === genMid || (steps[i + 1] && steps[i + 1].mid === s.mid)) return;
        const sw = cur(msgs[s.mi]);
        if (!(sw && sw.paused)) out.push(i);
      });
      return out;
    },

    // 由第 i 句往回逐一走訪掛著的場景／數值／特殊場景圖（越新越先）；fn 回傳 true 就停
    eachFxBack(i, fn) {
      const steps = V.th.steps;
      for (let k = Math.min(i, steps.length - 1); k >= 0; k--) {
        const s = steps[k];
        for (let j = s.post.length - 1; j >= 0; j--) if (fn(s.post[j], k, 'post')) return;
        for (let j = s.pre.length - 1; j >= 0; j--) if (fn(s.pre[j], k, 'pre')) return;
      }
    },

    startIndex() {
      const steps = V.th.steps;
      if (!steps.length) return -1;
      const lastAi = [...V.ctx.session.messages].reverse().find((m) => m.role === 'assistant' && !m.hidden);
      if (!lastAi) return steps.length - 1;
      const i = steps.findIndex((s) => s.mid === lastAi.id);
      return i >= 0 ? i : steps.length - 1;
    },

    // forward：照順序往下讀時才讓數值跳提示；往回看、跳到選擇點時安靜切換
    showStep(i, { silentTts = false, keepWaiting = false, forward = false } = {}) {
      const th = V.th;
      const R = V.root;
      const st = th.steps[i];
      clearTimeout(th.autoTimer);
      V.stopTyping();
      th.waiting = keepWaiting;
      const box = R.querySelector('.stage-text');
      const nameEl = R.querySelector('.st-name');
      const line = R.querySelector('.st-line');
      const sfx = R.querySelector('.stage-sfx');
      if (!st) {
        th.pos = -1;
        th.cur = null;
        nameEl.hidden = true;
        line.textContent = '';
        sfx.hidden = true;
        V.updateBackground(-1);
        V.updateCg(-1);
        V.renderSprites({});
        V.updateTheaterChrome();
        return;
      }
      th.pos = i;
      th.cur = { b: st.b, mid: st.mid, bi: st.bi };
      const token = ++th.token;
      const b = st.b;
      V.updateBackground(i);
      V.updateCg(i);
      V.updateBgm(i);
      // 已經跳過提示、播過音效的（例如生成中先掛在上一句後面）不再重複
      if (forward) st.pre.forEach((f) => { if (!th.flashed.has(f.b)) V.applyFx(f); });
      V.renderSprites(V.stageState(i));
      // 說話的角色換了：狀態欄換成這個角色
      if (V.currentChar(V.hudAppeared) !== V.hudWho) V.renderHud();
      box.className = 'stage-text';
      let el = null;
      let text = '';
      if (st.role === 'user') {
        // 玩家的行動：以主角名字當說話者；可設定縮小顯示
        nameEl.hidden = false;
        nameEl.querySelector('span').textContent = V.ctx.persona.name;
        box.classList.add('is-user');
        if (TT.settings.story.minimizeUser) box.classList.add('is-mini');
        el = line;
        text = b.t === 'say' ? `「${b.text}」` : b.text;
      } else if (b.t === 'say' || b.t === 'think') {
        nameEl.hidden = false;
        nameEl.querySelector('span').textContent = b.name + (b.t === 'think' ? '（心聲）' : '');
        box.classList.add('is-' + b.t);
        el = line;
        text = b.t === 'say' ? `“${b.text}”` : b.text;
      } else if (b.t === 'end') {
        nameEl.hidden = true;
        line.textContent = `— 結局：${b.title} —`;
        V.showEnding(b.title, st.mid);
      } else {
        nameEl.hidden = true;
        box.classList.add('is-narr');
        if (b.action) box.classList.add('is-action');
        el = line;
        text = b.text;
      }
      V.updateTheaterChrome();
      const speakP = TT.settings.audio.tts && !silentTts && text && st.role !== 'user' ? TT.tts.speak(text, TT.tts.voiceFor(b, V.ctx)) : Promise.resolve();
      const typeP = el ? new Promise((res) => V.type(el, text, res)) : Promise.resolve();
      Promise.all([speakP, typeP]).then(() => {
        if (token !== th.token || V.mode !== 'theater' || !V.ctx) return;
        if (forward) st.post.forEach((f) => { if (!th.flashed.has(f.b)) V.applyFx(f); });
        V.markSeen();
        V.updateTheaterChrome();
        if (th.waiting) {
          if (th.pos + 1 < th.steps.length) V.showStep(th.pos + 1, { forward: true });
          return;
        }
        if (!TT.settings.story.autoPlay) return;
        const speed = +TT.settings.story.autoSpeed || 1;
        const wait = TT.settings.audio.tts ? 500 : Math.min(6000, 900 + Array.from(text || '').length * 45) / speed;
        th.autoTimer = setTimeout(() => { if (token === th.token) V.advance(true); }, wait);
      });
    },

    // 舞台：左右兩個固定位置。新角色補進空位，滿了就換掉最久沒說話的；
    // 說話中的角色亮起，其餘變暗；每個角色記住自己最近的表情
    stageState(i) {
      const steps = V.th.steps;
      if (!steps[i]) return {};
      // 這一幕從最近一次換場景開始算
      let start = Math.max(0, i - 60);
      let sceneAt = -1;
      V.eachFxBack(i, (f, k, where) => {
        if (f.b.t !== 'scene') return false;
        sceneAt = where === 'pre' ? k : k + 1;
        start = Math.max(start, sceneAt);
        return true;
      });
      const slots = [null, null];
      const spoke = {};
      const emo = {};
      let last = null;
      const me = V.ctx.persona && V.ctx.persona.name;
      for (let j = start; j <= i; j++) {
        const s = steps[j];
        // 主角的台詞與行動：主角有立繪時也站上舞台
        const mine = s.role === 'user';
        if (!mine && s.b.t !== 'say' && s.b.t !== 'think') continue;
        // 同一個角色的不同叫法（全名、名字、別名）算同一個人、用同一組立繪
        const n = mine ? me : V.canon(s.b.name);
        if (!V.spriteRef(n)) continue;
        spoke[n] = j;
        last = n;
        if (s.b.emo) emo[n] = s.b.emo;
        if (slots.includes(n)) continue;
        const empty = slots.indexOf(null);
        if (empty >= 0) slots[empty] = n;
        else slots[(spoke[slots[0]] || -1) <= (spoke[slots[1]] || -1) ? 0 : 1] = n;
      }
      const c = steps[i];
      const speaking = c.role === 'user' ? me : c.b.t === 'say' || c.b.t === 'think' ? V.canon(c.b.name) : null;
      return { slots, focus: speaking && slots.includes(speaking) ? speaking : last, emo, scene: sceneAt };
    },

    canon(name) {
      if (!V.ctx) return name;
      const n = TT.cast.canon(V.ctx.card, name, V.ctx.persona);
      return TT.sprites.resolveName(V.ctx.card, n) || n;
    },

    // 立繪來源：表情或動作的立繪（依名稱與說明挑最接近的）→ 基準立繪 → 舊版頭像 → 主角色的卡面；
    // 主角的立繪存在主角身上（可以在作品設定的「主角」關掉）
    spriteRef(name, emo) {
      const { card, session, persona } = V.ctx;
      if (!name) return null;
      if (persona && name === persona.name) {
        if (TT.settings.story.userSprite === false) return null;
        const p = TT.sprites.pick(persona, name, emo);
        if (!p) return null;
        const set = (persona.expr || {})[p.name] || {};
        if (p.key && set[p.key]) return { kind: 'sprite', id: `${persona.id}|${p.name}|${p.key}`, cut: !!(persona.exprCut && persona.exprCut[p.name] && persona.exprCut[p.name][p.key]) };
        return persona.sprites && persona.sprites[p.name] ? { kind: 'sprite', id: `${persona.id}|${p.name}`, cut: !!(persona.spriteCut && persona.spriteCut[p.name]) } : null;
      }
      const p = TT.sprites.pick(card, name, emo);
      if (p) {
        const set = (card.expr || {})[p.name] || {};
        if (p.key && set[p.key]) return { kind: 'sprite', id: `${card.id}|${p.name}|${p.key}`, cut: !!(card.exprCut && card.exprCut[p.name] && card.exprCut[p.name][p.key]) };
        if (card.sprites && card.sprites[p.name]) return { kind: 'sprite', id: card.id + '|' + p.name, cut: !!(card.spriteCut && card.spriteCut[p.name]) };
      }
      const ov = session.castOverrides && session.castOverrides[name];
      if (ov && ov.avatarImageId) return { kind: 'img', id: ov.avatarImageId };
      if ((name === card.name || name === card.nickname) && !card.generatedCover) return { kind: 'card', id: card.id };
      return null;
    },

    renderSprites({ slots = [null, null], focus = null, emo = {}, scene = -1 } = {}) {
      const box = V.root.querySelector('.stage-chars');
      const present = slots.filter(Boolean);
      // 離場的角色很快淡出並移除；換了場景就直接拿掉，不留殘影
      const newScene = scene !== V.th.sceneAt;
      V.th.sceneAt = scene;
      [...box.children].forEach((el) => {
        if (present.includes(el.dataset.name) && !el.classList.contains('out')) return;
        if (newScene) { el.remove(); return; }
        if (el.classList.contains('out')) return;
        el.classList.add('out');
        el.classList.remove('in');
        el.dataset.ref = '';
        setTimeout(() => el.remove(), 200);
      });
      slots.forEach((name, slot) => {
        if (!name) return;
        const ref = V.spriteRef(name, emo[name]);
        if (!ref) return;
        const key = ref.kind + ':' + ref.id;
        let el = [...box.children].find((x) => x.dataset.name === name && !x.classList.contains('out'));
        if (!el) {
          el = document.createElement('div');
          el.className = 'sprite';
          el.dataset.name = name;
          box.appendChild(el);
        }
        if (el.dataset.ref !== key) {
          // 換表情：預先載入好的圖直接換上（同一格就換好，不會慢一拍），新圖淡入、舊圖淡出
          el.dataset.ref = key;
          el.dataset.emo = emo[name] || '';
          el.classList.toggle('is-card', ref.kind === 'card');
          el.classList.toggle('cutout', !!ref.cut);
          const put = (u) => {
            if (!u || el.dataset.ref !== key) return;
            const img = new Image();
            img.alt = '';
            const swap = () => {
              // 圖晚到時角色已經離場：不要再把它顯示回來
              if (el.dataset.ref !== key || el.classList.contains('out') || !el.isConnected) return;
              el.appendChild(img);
              void img.offsetWidth;
              el.classList.add('in');
              img.classList.add('on');
              [...el.querySelectorAll('img')].forEach((old) => { if (old !== img) { old.classList.remove('on'); setTimeout(() => old.remove(), 220); } });
            };
            img.src = u;
            if (img.complete && img.naturalWidth) swap();
            else img.onload = swap;
          };
          const u = TT.media.peek(ref.kind, ref.id);
          if (u) put(u);
          else TT.media.url(ref.kind, ref.id).then(put);
        }
        el.classList.toggle('pos-c', present.length === 1);
        el.classList.toggle('pos-l', present.length > 1 && slot === 0);
        el.classList.toggle('pos-r', present.length > 1 && slot === 1);
        el.classList.toggle('dim', present.length > 1 && name !== focus);
        el.classList.toggle('focus', name === focus);
      });
      V.root.querySelector('.stage-bg').classList.toggle('blur', present.length > 0);
    },

    // 先把這個故事的立繪、表情、特殊場景圖與背景解碼好，換表情、換場景時不用再等讀檔
    preloadSprites() {
      const { card, persona } = V.ctx;
      const refs = [];
      for (const o of [card, persona].filter(Boolean)) {
        for (const [name, set] of Object.entries(o.expr || {})) for (const k of Object.keys(set || {})) refs.push(['sprite', `${o.id}|${name}|${k}`]);
        for (const name of Object.keys(o.sprites || {})) refs.push(['sprite', `${o.id}|${name}`]);
      }
      for (const g of card.cgs || []) refs.push(['cg', `${card.id}|${g.id}`]);
      for (const g of card.bgs || []) if (g.blob) refs.push(['bg', `${card.id}|${g.id}`]);
      V.preloaded = V.preloaded || new Map();
      refs.forEach(([kind, id]) => TT.media.url(kind, id).then((u) => {
        if (!u || !V.ctx || V.preloaded.get(id) === u) return;
        const im = new Image();
        im.src = u;
        if (im.decode) im.decode().catch(() => {});
        V.preloaded.set(id, u);
        V.preloaded.set(id + '#img', im);
      }));
    },

    // 特殊場景圖：最近的 [CG:名稱] 一直顯示到 [CG:off] 或換場景，置中蓋過立繪
    updateCg(i) {
      let hit = null;
      // 同一個分鏡裡即使模型把 [CG] 寫在 [SCENE] 前面，也視為該分鏡的 CG；
      // 只有往前一格仍找不到 CG 時，場景切換才會終止舊 CG。
      for (let k = Math.min(i, V.th.steps.length - 1); k >= 0 && !hit; k--) {
        const step = V.th.steps[k];
        const effects = [...step.pre, ...step.post];
        for (let j = effects.length - 1; j >= 0; j--) if (effects[j].b.t === 'cg') { hit = effects[j]; break; }
        if (!hit && effects.some((f) => f.b.t === 'scene')) break;
      }
      const card = V.ctx.card;
      const cg = hit && hit.b.t === 'cg' && hit.b.name ? TT.sprites.findCg(card, hit.b.name) : null;
      const key = cg ? cg.id : '';
      V.root.classList.toggle('cg-on', !!cg);
      if (key === V.th.cgKey) return;
      V.th.cgKey = key;
      const box = V.root.querySelector('.stage-cg');
      const old = [...box.children];
      const fade = () => old.forEach((o) => { o.classList.remove('on'); setTimeout(() => o.remove(), 500); });
      if (!cg) return fade();
      const put = (u) => {
        if (!u || V.th.cgKey !== key) return;
        const img = new Image();
        img.alt = cg.name;
        const show = () => {
          if (V.th.cgKey !== key) return;
          box.appendChild(img);
          void img.offsetWidth;
          img.classList.add('on');
          fade();
        };
        img.src = u;
        if (img.complete && img.naturalWidth) show();
        else img.onload = show;
      };
      const ref = `${card.id}|${cg.id}`;
      const u = TT.media.peek('cg', ref);
      if (u) put(u);
      else TT.media.url('cg', ref).then(put);
    },

    // 配樂：最近的 [BGM:名稱] 一直播到換曲或 [BGM:off]；往回看歷史時也跟著那時候的配樂
    updateBgm(i) {
      let name = '';
      if (i >= 0) V.eachFxBack(i, (f) => { if (f.b.t !== 'bgm') return false; name = f.b.name || ''; return true; });
      if (name === V.th.bgmKey) return;
      V.th.bgmKey = name;
      TT.bgm.setTrack(name, V.ctx.card.id);
    },
    // 漫畫／小說模式：放這個存檔最後一次指定的配樂
    syncBgm() {
      if (V.mode === 'theater') return V.th.pos >= 0 && V.updateBgm(V.th.pos);
      let name = '';
      for (const m of V.ctx.session.messages) for (const b of (cur(m) || {}).beats || []) if (b.t === 'bgm') name = b.name || '';
      if (name === V.th.bgmKey) return;
      V.th.bgmKey = name;
      TT.bgm.setTrack(name, V.ctx.card.id);
    },
    updateBgmIcon() {
      const b = V.root && V.root.querySelector('.st-bgm');
      if (b) b.classList.toggle('on', TT.settings.audio.bgm !== false && !!TT.bgm.names(V.ctx.card.id).length);
    },

    applyFx(f) {
      V.th.flashed.add(f.b);
      if (f.b.t === 'stat') V.flashStat(f.b);
      else if (f.b.t === 'sfx') V.playSfx(f.b);
    },

    // 音效：播放音效庫裡對應的音檔；擬聲詞只在畫面上方淡淡顯示一下（不再是置中的大字）
    playSfx(b) {
      if (V.mode === 'theater') {
        const el = V.root.querySelector('.stage-sfx');
        el.textContent = '♪ ' + b.text;
        el.hidden = false;
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
        clearTimeout(V.sfxTimer);
        V.sfxTimer = setTimeout(() => { el.hidden = true; }, 1800);
      }
      TT.sfx.play(b);
    },

    // 生成中，目前這句後面才補上的數值也要跳提示
    applyLateFx() {
      const st = V.th.steps[V.th.pos];
      if (st) st.post.forEach((f) => { if (!V.th.flashed.has(f.b)) V.applyFx(f); });
    },

    // 讀到一則（已生成完）AI 訊息的最後一句：之後往回看這回合時也保留選項
    markSeen() {
      const th = V.th;
      const st = th.steps[th.pos];
      if (!st || st.role !== 'assistant') return;
      const nx = th.steps[th.pos + 1];
      const gen = TT.engine.isGenerating(V.ctx.session.id) && TT.engine.gen.msgId === st.mid;
      if (!gen && (!nx || nx.mid !== st.mid)) th.seen.add(st.mid + '|' + st.swi);
    },

    type(el, text, done) {
      V.stopTyping();
      const th = V.th;
      const chars = Array.from(String(text || ''));
      const speed = +TT.settings.story.typeSpeed;
      th.typeDone = () => { el.innerHTML = TT.mdLite(text); };
      th.typeResolve = done;
      // 預設整句淡入；設定為打字機時才逐字出現
      if (TT.settings.story.textEffect !== 'type' || !speed || speed <= 0 || !chars.length) {
        th.typeDone();
        el.classList.remove('line-in');
        void el.offsetWidth;
        el.classList.add('line-in');
        done();
        return;
      }
      let i = 0;
      th.typing = true;
      el.textContent = '';
      th.typeTimer = setInterval(() => {
        i = Math.min(chars.length, i + (speed < 15 ? 2 : 1));
        el.textContent = chars.slice(0, i).join('');
        if (i >= chars.length) { V.stopTyping(); th.typeDone(); done(); }
      }, Math.max(10, speed));
    },
    stopTyping() {
      const th = V.th;
      if (!th) return;
      clearInterval(th.typeTimer);
      th.typeTimer = null;
      th.typing = false;
    },
    finishTyping() {
      const th = V.th;
      if (!th.typing) return;
      V.stopTyping();
      th.typeDone && th.typeDone();
      th.typeResolve && th.typeResolve();
    },

    advance(fromAuto = false) {
      if (V.mode !== 'theater') return;
      const th = V.th;
      if (V.uiHidden && !fromAuto) return V.toggleUi(false);
      if (th.typing) { V.finishTyping(); return; }
      if (!fromAuto) { clearTimeout(th.autoTimer); TT.tts.stop(); }
      const n = th.pos + 1;
      if (n < th.steps.length) return V.showStep(n, { forward: true });
      if (TT.engine.isGenerating(V.ctx.session.id)) { th.waiting = true; V.updateTheaterChrome(); return; }
      th.waiting = false;
      V.updateTheaterChrome();
      V.pulseDecide(fromAuto);
    },

    pulseDecide(fromAuto) {
      const dec = V.root.querySelector('.stage-decide');
      if (!dec.hidden && !fromAuto) { dec.classList.remove('pulse'); void dec.offsetWidth; dec.classList.add('pulse'); }
    },

    halt() {
      const th = V.th;
      if (th.typing) V.finishTyping();
      clearTimeout(th.autoTimer);
      TT.tts.stop();
    },

    // 上一句（點畫面左側、←）：生成中或停在選項時也可以往回看
    // 往回看之後再往下讀，數值提示與音效會重新出現
    prev() {
      V.halt();
      V.th.flashed = new WeakSet();
      if (V.th.pos > 0) V.showStep(V.th.pos - 1, { silentTts: true });
    },

    // 上一個選擇點（左下 « 鍵）：可以一路回到過去的選項，看當時選了什麼、改走別條路
    prevChoice() {
      V.halt();
      V.th.flashed = new WeakSet();
      const th = V.th;
      const pts = V.choicePoints().filter((p) => p < th.pos);
      if (pts.length) V.showStep(pts[pts.length - 1], { silentTts: true });
      else if (th.pos > 0) V.showStep(0, { silentTts: true });
      else TT.toast('已經是故事開頭');
    },

    // 下一個選擇點（右下 » 鍵）；後面沒有就回到最新
    nextChoice() {
      V.halt();
      const th = V.th;
      const p = V.choicePoints().find((x) => x > th.pos);
      const target = p != null ? p : th.steps.length - 1;
      if (target !== th.pos && target >= 0) V.showStep(target, { silentTts: true, keepWaiting: V.followLive(target) });
      else V.pulseDecide(false);
    },

    toLatest() {
      V.halt();
      const last = V.th.steps.length - 1;
      if (last >= 0) V.showStep(last, { silentTts: true, keepWaiting: V.followLive(last) });
    },

    // 跳到最新一句時，若還在生成，新的句子出來就自動接上
    followLive: (i) => i === V.th.steps.length - 1 && TT.engine.isGenerating(V.ctx.session.id),

    toggleUi(force) {
      V.uiHidden = force != null ? force : !V.uiHidden;
      V.root.classList.toggle('ui-off', V.uiHidden);
    },

    // 依目前位置與生成狀態，切換行動框、選擇面板、等待提示
    updateTheaterChrome() {
      if (V.mode !== 'theater' || !V.ctx) return;
      const th = V.th;
      const R = V.root;
      const s = V.ctx.session;
      const msgs = s.messages;
      const gen = TT.engine.isGenerating(s.id);
      const busy = gen || !!TT.engine.status;
      const atEnd = th.pos >= th.steps.length - 1;
      const last = msgs[msgs.length - 1];
      const failed = !!(last && last.role === 'assistant' && cur(last).error && !(cur(last).beats || []).length);
      const paused = !!(last && last.role === 'assistant' && cur(last).paused && !gen);
      const lastAi = last && last.role === 'assistant' && !busy && !failed && !paused ? last : null;
      const curStep = th.steps[th.pos];
      // 最新回合：讀完最後一句就出現選項；之後往回看這回合的句子也保留，可以邊看邊選
      // 過去的選擇點：顯示當時的選項與當時的選擇，可以改走另一條路
      let mode = '';
      let forMsg = null;
      const liveHere = curStep && lastAi && curStep.mid === lastAi.id;
      if (lastAi && (liveHere ? th.seen.has(lastAi.id + '|' + (lastAi.sw || 0)) || (atEnd && !th.typing) : atEnd && !th.typing)) {
        mode = 'live';
        forMsg = lastAi;
      } else if (curStep && curStep.role === 'assistant' && !liveHere && V.choicePoints().includes(th.pos)) {
        mode = 'history';
        forMsg = msgs[curStep.mi];
      }
      V.decide = mode ? { mode, mid: forMsg.id } : null;
      R.classList.toggle('deciding', !!mode);
      R.classList.toggle('reviewing', mode === 'history');
      const dec = R.querySelector('.stage-decide');
      if (mode) {
        // 選項屬於哪一則訊息的哪個版本；換了就重畫
        const forKey = `${mode}|${forMsg.id}|${forMsg.sw || 0}`;
        if (dec.hidden || dec.dataset.for !== forKey) { dec.dataset.for = forKey; V.renderDecide(mode, forMsg); }
        dec.hidden = false;
      } else {
        dec.hidden = true;
        dec.dataset.for = '';
      }

      // 行動框：這一格所屬回合玩家做了什麼行動。每個回合都能按「重新選擇」回到之前的選擇點改選；
      // 最新回合生成中可以暫停，暫停後可以繼續生成
      let ui = -1;
      for (let k = msgs.length - 1; k >= 0; k--) if (msgs[k].role === 'user') { ui = k; break; }
      const genMid = TT.engine.gen && TT.engine.gen.msgId;
      const atLive = !curStep || curStep.mi >= ui || atEnd;
      const tu = curStep ? V.turnOf(curStep.mi) : atLive ? ui : -1;
      const latest = tu >= 0 && tu === ui && ui >= msgs.length - 2;
      const full = latest && atLive && ((gen && (atEnd || !curStep || curStep.mid !== genMid)) || failed || paused);
      const showAction = !mode && tu >= 0 && (full || !!curStep);
      const act = R.querySelector('.stage-action');
      act.hidden = !showAction;
      R.classList.toggle('has-action', showAction);
      if (showAction) {
        const um = msgs[tu];
        act.dataset.turn = tu;
        act.classList.toggle('compact', !full);
        act.querySelector('.sa-text').textContent = um.hidden ? '自動進行' : TT.macros.apply(cur(um).raw, TT.prompt.macroCtx(V.ctx));
        const err = act.querySelector('.sa-err');
        err.hidden = !(full && failed);
        if (full && failed) err.textContent = cur(last).error;
        act.querySelector('.sa-note').hidden = !(full && paused);
        act.querySelector('[data-act="regen"]').hidden = !(latest && !gen);
        act.querySelector('[data-act="pausegen"]').hidden = !(latest && gen);
        act.querySelector('[data-act="resumegen"]').hidden = !(latest && paused);
        if (V.saMenu && V.saMenu.tu !== tu) V.closeSaMenu();
      } else V.closeSaMenu();

      const wait = R.querySelector('.st-wait');
      const waiting = busy && atEnd && !th.typing;
      wait.hidden = !waiting;
      if (waiting) wait.querySelector('span').textContent = TT.engine.status || (gen && V.waitLabel) || `${V.ctx.card.name} 正在構思…`;
      R.querySelector('.stage-text').classList.toggle('ready', !th.typing && !atEnd);
      R.querySelector('.st-auto').classList.toggle('on', !!TT.settings.story.autoPlay);
    },

    // 第 mi 則訊息屬於哪個回合：往前找最近一次玩家行動（找不到是序章，回傳 -1）
    turnOf(mi) {
      const msgs = V.ctx.session.messages;
      for (let k = Math.min(mi, msgs.length - 1); k >= 0; k--) if (msgs[k].role === 'user') return k;
      return -1;
    },

    // 「重新選擇」：生成中直接停止並回到選擇點；其他時候展開那個選擇點當時的選項，改選另一個
    rechooseMenu() {
      const act = V.root.querySelector('.stage-action');
      const msgs = V.ctx.session.messages;
      const tu = +act.dataset.turn;
      const um = msgs[tu];
      if (!um) return;
      let ui = -1;
      for (let k = msgs.length - 1; k >= 0; k--) if (msgs[k].role === 'user') { ui = k; break; }
      // 最新回合還在生成、或回覆失敗是空的：沒有東西會遺失，直接回到選擇點（打的字放回輸入框）
      if (tu === ui && (TT.engine.isGenerating(V.ctx.session.id) || TT.engine.emptyReply(msgs[msgs.length - 1]))) return V.rechoose();
      if (V.saMenu) return V.closeSaMenu();
      const prevAi = msgs[tu - 1];
      const ch = prevAi && prevAi.role === 'assistant' && (cur(prevAi).beats || []).find((b) => b.t === 'choice');
      const opts = ch ? ch.options.slice(0, 5) : [];
      const was = um.hidden ? null : String(cur(um).raw || '').trim();
      const menu = act.querySelector('.sa-menu');
      menu.innerHTML = String(html`${opts.map((o, i) => html`<button class="sa-opt ${o === was ? 'picked' : ''}" data-reopt="${i}">${o}${o === was ? html`<small>當時的選擇</small>` : ''}</button>`)}
        <button class="sa-opt ${um.hidden ? 'picked' : ''}" data-reauto>${icon('play', 11)} 自動進行${um.hidden ? html`<small>當時的選擇</small>` : ''}</button>
        <button class="sa-opt go" data-rego>${icon('rewind', 13)} 回到這個選擇點，自己輸入</button>`);
      menu.hidden = false;
      V.saMenu = { tu, opts };
    },

    closeSaMenu() {
      if (!V.saMenu || !V.root) return;
      V.saMenu = null;
      const menu = V.root.querySelector('.sa-menu');
      menu.hidden = true;
      menu.innerHTML = '';
    },

    async onSaMenu(el) {
      const m = V.saMenu;
      if (!m) return;
      V.closeSaMenu();
      const mi = m.tu - 1;
      if (el.matches('[data-rego]')) {
        // 跳到那個選擇點（那則 AI 訊息的最後一句），在選擇面板輸入新的行動
        const i = V.th.steps.map((s) => s.mi).lastIndexOf(mi);
        if (i < 0) return TT.toast('這是故事的第一個行動，前面沒有選擇點');
        V.halt();
        return V.showStep(i, { silentTts: true });
      }
      if (el.matches('[data-reauto]')) return V.redoFrom(mi, null, { auto: true });
      const o = m.opts[+el.dataset.reopt];
      if (o) return V.redoFrom(mi, o);
    },

    renderDecide(mode, m) {
      const R = V.root;
      const msgs = V.ctx.session.messages;
      const sw = cur(m);
      const ch = sw && (sw.beats || []).find((b) => b.t === 'choice');
      V.options = ch ? ch.options.slice(0, 5) : [];
      const ended = !!TT.engine.endingOf(sw);
      // 過去的選擇點：找出當時做的選擇
      let picked = null;
      if (mode === 'history') {
        const nx = msgs[msgs.indexOf(m) + 1];
        if (nx && nx.role === 'user') picked = nx.hidden ? { auto: true } : { text: String(cur(nx).raw || '').trim() };
      }
      const pi = picked && picked.text != null ? V.options.indexOf(picked.text) : -1;
      const head = R.querySelector('.sd-head');
      head.hidden = mode !== 'history';
      head.innerHTML = mode === 'history'
        ? String(html`${icon('clock', 14)}<span>回顧過去的選擇點${picked && picked.auto ? '・當時選了「自動進行」' : picked && pi < 0 ? `・當時輸入：「${TT.truncate(picked.text, 36)}」` : ''}</span><button class="sd-latest" data-act="latest">回到最新 ${icon('ffwd', 12)}</button>`)
        : '';
      R.querySelector('.sd-options').innerHTML =
        V.options.map((o, i) => String(html`<button class="sd-opt ${i === pi ? 'picked' : ''}" data-choice="${i}">${o}${i === pi ? html`<small>當時的選擇</small>` : ''}</button>`)).join('') +
        (ended ? String(html`<div class="sd-ended">${icon('flag', 14)} 故事已走到結局。可以繼續寫後日談，或回書架開始新的故事。</div>`) : '');
      R.querySelector('.sd-auto').classList.toggle('picked', !!(picked && picked.auto));
      R.querySelector('[data-input="theater"]').placeholder = mode === 'history'
        ? '從這裡重來：輸入台詞或行動'
        : `請輸入下一句台詞或行動（${V.ctx.persona.name}）`;
    },

    // 背景：最近的 [BG:名稱]、場景圖，或場景描述對得上的作品背景圖（[SCENE:名稱] 或名稱、說明最接近的）；都沒有就用角色卡圖
    updateBackground(i) {
      const card = V.ctx.card;
      let scene = null;
      let imgId = null;
      let lib = null;
      if (i >= 0) V.eachFxBack(i, (f) => {
        if (f.b.t === 'bg') { lib = TT.sprites.findBg(card, f.b.name); return !!lib; }
        if (f.b.t !== 'scene') return false;
        if (!scene) scene = f;
        if (f.b.imageId) { imgId = f.b.imageId; return true; }
        lib = (f.b.bg && TT.sprites.findBg(card, f.b.bg)) || TT.sprites.matchBg(card, `${f.b.text || ''} ${f.b.prompt || ''}`);
        return !!lib;
      });
      const badge = V.root.querySelector('.stage-badge');
      badge.hidden = true;
      if (scene && !scene.b.imageId && !lib) {
        const job = { sessionId: V.ctx.session.id, msgId: scene.mid, swipe: scene.swi, beat: scene.bi };
        const s = scene.b.status;
        if ((s === 'pending' || s === 'running') && !TT.img.isQueued(job) && TT.img.scenesEnabled()) TT.img.enqueue(job);
        if (s === 'pending' || s === 'running') { badge.hidden = false; badge.className = 'stage-badge busy'; badge.innerHTML = '<span class="spinner"></span>場景繪製中…'; }
        else if (s === 'error') { badge.hidden = false; badge.className = 'stage-badge err'; badge.innerHTML = TT.icon('refresh', 14) + ' 場景圖失敗，點此重試'; badge.dataset.job = JSON.stringify(job); }
        else if (s === 'idle') { badge.hidden = false; badge.className = 'stage-badge'; badge.innerHTML = TT.icon('image', 14) + ' 生成這一幕'; badge.dataset.job = JSON.stringify(job); }
      }
      const [kind, id] = imgId ? ['img', imgId] : lib ? ['bg', `${card.id}|${lib.id}`] : ['card', card.id];
      const key = kind + ':' + id;
      if (key === V.th.bgKey) return;
      V.th.bgKey = key;
      V.setBg(kind, id);
    },

    async setBg(kind, id) {
      const url = await TT.media.url(kind, id);
      if (!url || !V.root) return;
      const imgs = [...V.root.querySelectorAll('.bg-img')];
      const front = imgs.find((x) => x.classList.contains('show'));
      const back = imgs.find((x) => x !== front) || imgs[0];
      back.onload = () => {
        back.classList.add('show', 'kb');
        if (front) { front.classList.remove('show'); setTimeout(() => front.classList.remove('kb'), 900); }
      };
      back.classList.toggle('portrait-fit', kind === 'card');
      back.src = url;
    },

    // 狀態改變時在狀態欄下方跳出提示；
    // 角色的狀態只提示目前角色的（角色池外的人不提示）
    flashStat(b) {
      // 寫給主角的狀態算主角狀態
      let who = b.who ? TT.cast.canon(V.ctx.card, b.who, V.ctx.persona) : '';
      if (who === V.ctx.persona.name) who = '';
      if (who && who !== V.currentChar(V.hudAppeared)) return;
      const key = who ? `${who}・${b.name}` : b.name;
      const toast = V.root.querySelector('.stage-toast');
      if (toast && V.mode === 'theater') {
        const value = b.op === '=' ? b.value : `${b.op}${b.value}`;
        toast.innerHTML = String(html`${who ? TT.ui.speakerAvatar(who, V.ctx, 22) : icon(hudIcon(b.name), 14)}<span>${who ? who + '・' : ''}${b.name}</span><b>${TT.truncate(String(value), 40)}</b>`);
        TT.media.hydrate(toast);
        toast.hidden = false;
        toast.classList.remove('pop');
        void toast.offsetWidth;
        toast.classList.add('pop');
        clearTimeout(V.toastTimer);
        V.toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
      }
      V.renderHud(key);
    },

    /* ==========================================================
       漫畫／小說模式
       ========================================================== */
    renderReader(scrollBottom = false) {
      const r = V.root.querySelector('.reader');
      const msgs = V.ctx.session.messages;
      const start = Math.max(0, msgs.length - V.limit);
      const parts = [];
      if (start > 0) parts.push(String(html`<button class="load-more" data-act="more">載入更早的 ${start} 則</button>`));
      for (let i = start; i < msgs.length; i++) parts.push(V.msgHTML(msgs[i], i));
      parts.push('<div class="reader-end"></div>');
      const keepBottom = scrollBottom || r.scrollHeight - r.scrollTop - r.clientHeight < 160;
      r.innerHTML = parts.join('');
      TT.media.hydrate(r);
      if (keepBottom) requestAnimationFrame(() => (r.scrollTop = r.scrollHeight));
    },

    msgHTML(m, i) {
      const msgs = V.ctx.session.messages;
      if (m.hidden) return String(html`<div class="msg-sep" data-mid="${m.id}" data-idx="${i}"><span>自動進行</span></div>`);
      const sw = cur(m);
      const beats = (sw.beats || []).map((b, bi) => V.beatHTML(b, m, bi)).join('');
      const last = i === msgs.length - 1;
      return String(html`<article class="msg ${m.role} ${m.kind || ''}" data-mid="${m.id}" data-idx="${i}">
        <div class="beats">${raw(beats)}</div>
        ${m.pending ? raw('<div class="typing-ind"><i></i><i></i><i></i><span class="partial"></span></div>') : ''}
        ${sw.error ? html`<div class="msg-error">${icon('alert', 16)}<span>${sw.error}</span>${last ? html`<button class="btn small" data-act="regen">重試</button>` : ''}</div>` : ''}
        ${sw.paused && last && !m.pending ? html`<div class="msg-paused">${icon('pause', 14)}<span>已暫停</span><button class="btn small" data-act="resumegen">${icon('play', 12)} 繼續生成</button></div>` : ''}
        <div class="msg-foot">
          ${m.role === 'assistant' && m.swipes.length > 1 ? html`<span class="swipes"><button data-act="swipe" data-dir="-1" aria-label="上一個版本">${icon('back', 16)}</button><span>${(m.sw || 0) + 1}/${m.swipes.length}</span><button data-act="swipe" data-dir="1" aria-label="下一個版本">${icon('forward', 16)}</button></span>` : ''}
          <button class="msg-more" data-act="msgmenu" aria-label="訊息選單">${icon('more', 18)}</button>
        </div>
      </article>`);
    },

    beatHTML(b, m, bi) {
      const ctx = V.ctx;
      const key = `${m.id}|${m.sw || 0}|${bi}`;
      const right = m.role === 'user' || b.name === ctx.persona.name;
      const beats = (cur(m) || {}).beats || [];
      const frameCg = m.role === 'assistant' ? html`<button class="beat-cg" data-act="framecg" data-frame="${key}" title="只依這一個分鏡生成特殊場景圖">${icon('image', 12)} 生成這一幕 CG</button>` : '';
      switch (b.t) {
        case 'scene': {
          // 場景後面緊接著 [BG:名稱]、[SCENE:名稱] 或描述對得上作品背景時，分鏡格直接用那張背景
          const nx = beats[bi + 1];
          const lib = !b.imageId && ((nx && nx.t === 'bg' && TT.sprites.findBg(ctx.card, nx.name)) || (b.bg && TT.sprites.findBg(ctx.card, b.bg)) || TT.sprites.matchBg(ctx.card, `${b.text || ''} ${b.prompt || ''}`));
          if (lib) return String(html`<figure class="panel has-img bg-panel"><img data-media="bg:${ctx.card.id}|${lib.id}" alt="${lib.name}"><figcaption>${b.text || lib.name}</figcaption></figure>`);
          return V.sceneHTML(b, key);
        }
        case 'bg': {
          const prev = beats[bi - 1];
          const g = !(prev && prev.t === 'scene') && TT.sprites.findBg(ctx.card, b.name);
          return g ? String(html`<figure class="panel has-img bg-panel"><img data-media="bg:${ctx.card.id}|${g.id}" alt="${g.name}"><figcaption>場景・${g.name}</figcaption></figure>`) : '';
        }
        case 'narr': return String(html`<div class="b-narr ${b.action ? 'action' : ''} ${m.role === 'user' ? 'by-user' : ''}" data-frame="${key}">${raw(TT.mdLite(b.text))}${frameCg}</div>`);
        case 'say':
        case 'think':
          return String(html`<div class="b-${b.t} ${right ? 'right' : 'left'}" data-frame="${key}">${TT.ui.speakerAvatar(b.name, ctx, 38)}<div class="bubble"><div class="who" style="--nc:${TT.hashColor(b.name, 70, 70)}">${b.name}${b.t === 'think' ? '（心聲）' : ''}${b.emo ? html`<em>${b.emo}</em>` : ''}</div><div class="txt">${raw(TT.mdLite(b.text))}</div>${frameCg}</div></div>`);
        case 'sfx': return String(html`<div class="b-sfx"><button data-act="sfxplay" data-sfx-name="${b.name || ''}" data-sfx-text="${b.text}" title="播放音效">${icon('volume', 12)} ${b.text}</button></div>`);
        case 'bgm': return String(html`<div class="b-bgm">${icon('music', 12)} ${b.name ? `配樂・${b.name}` : '配樂停止'}</div>`);
        case 'stat': {
          // 角色的狀態只顯示角色池裡的角色
          const who = b.who ? TT.cast.canon(ctx.card, b.who, ctx.persona) : '';
          const other = who && who !== ctx.persona.name;
          if (other && !TT.cast.pool(ctx.card).includes(who)) return '';
          return String(html`<div class="b-stat">${icon(hudIcon(b.name), 14)}<span>${other ? `${who}・` : ''}${b.name}</span><b>${b.op === '=' ? b.value : b.op + b.value}</b></div>`);
        }
        case 'end':
          // 同一段還有選項的 [END] 不是結局（模型拿來表示「寫完了」）
          if (m.pending || !TT.engine.endingOf(cur(m))) return '';
          return String(html`<div class="b-end"><small>ENDING</small><b>${b.title}</b></div>`);
        case 'cg': {
          const g = b.name && TT.sprites.findCg(ctx.card, b.name);
          return g ? String(html`<figure class="panel has-img cg-panel"><img data-media="cg:${ctx.card.id}|${g.id}" alt="${g.name}"><figcaption>特殊場景・${g.name}</figcaption></figure>`) : '';
        }
        case 'extra': return String(html`<details class="b-extra"><summary>${icon('list', 14)} ${b.tag}</summary><pre>${b.text}</pre></details>`);
        default: return '';
      }
    },

    sceneStatus(b, key) {
      if (b.imageId) return 'done';
      const [mid, swi, bi] = key.split('|');
      const job = { sessionId: V.ctx.session.id, msgId: mid, swipe: +swi, beat: +bi };
      if ((b.status === 'pending' || b.status === 'running') && !TT.img.isQueued(job)) return TT.img.scenesEnabled() ? 'idle' : 'none';
      if (!TT.img.scenesEnabled() && b.status !== 'error') return 'none';
      return b.status || 'none';
    },

    sceneHTML(b, key) {
      const status = V.sceneStatus(b, key);
      let media;
      if (b.imageId) media = html`<img data-media="img:${b.imageId}" alt="${b.text}" data-act="viewimg">`;
      else if (status === 'pending' || status === 'running') media = html`<div class="panel-ph loading"><span class="spinner"></span><span>${status === 'running' ? '畫面繪製中…' : '排隊中…'}</span></div>`;
      else if (status === 'error') media = html`<div class="panel-ph error">${icon('alert', 20)}<span>畫面生成失敗</span><small>${TT.truncate(b.error || '', 90)}</small><button class="btn small" data-act="imggen">${icon('refresh', 14)} 重試</button></div>`;
      else if (status === 'idle') media = html`<div class="panel-ph idle"><span>${b.text}</span><button class="btn small" data-act="imggen">${icon('image', 14)} 生成畫面</button></div>`;
      else media = html`<div class="panel-ph text"><span>${b.text}</span></div>`;
      const showCap = b.text && (b.imageId || status === 'pending' || status === 'running' || status === 'error');
      return String(html`<figure class="panel ${b.imageId ? 'has-img' : 'no-img'}" data-beat="${key}">${media}${showCap ? html`<figcaption>${b.text}</figcaption>` : ''}</figure>`);
    },

    rerenderMsg(msgId) {
      if (V.mode === 'theater') return;
      const r = V.root.querySelector('.reader');
      const art = r.querySelector(`[data-mid="${msgId}"]`);
      const i = V.ctx.session.messages.findIndex((m) => m.id === msgId);
      if (i < 0) { if (art) art.remove(); return; }
      if (!art) return V.renderReader();
      const nearBottom = r.scrollHeight - r.scrollTop - r.clientHeight < 160;
      const tmp = document.createElement('div');
      tmp.innerHTML = V.msgHTML(V.ctx.session.messages[i], i);
      const fresh = tmp.firstElementChild;
      art.replaceWith(fresh);
      TT.media.hydrate(fresh);
      if (nearBottom) r.scrollTop = r.scrollHeight;
    },

    onBeat(d) {
      if (V.mode === 'theater') {
        const wasEnd = V.th.pos >= V.th.steps.length - 1;
        V.rebuildSteps();
        if (V.th.pos < 0) { if (V.th.steps.length) V.showStep(V.startIndex()); }
        else if (wasEnd && V.th.waiting && !V.th.typing && V.th.pos + 1 < V.th.steps.length) V.showStep(V.th.pos + 1, { forward: true });
        else V.applyLateFx();
        V.updateTheaterChrome();
        return;
      }
      if (d.beat && d.beat.t === 'sfx') TT.sfx.play(d.beat);
      if (d.beat && d.beat.t === 'bgm') V.syncBgm();
      const r = V.root.querySelector('.reader');
      const art = r.querySelector(`[data-mid="${d.msgId}"] .beats`);
      if (!art) return V.rerenderMsg(d.msgId);
      const m = V.ctx.session.messages.find((x) => x.id === d.msgId);
      if (!m) return;
      const nearBottom = r.scrollHeight - r.scrollTop - r.clientHeight < 200;
      const tmp = document.createElement('div');
      tmp.innerHTML = V.beatHTML(d.beat, m, d.index);
      const node = tmp.firstElementChild;
      if (node) {
        node.classList.add('appear');
        art.appendChild(node);
        TT.media.hydrate(node);
      }
      const p = r.querySelector(`[data-mid="${d.msgId}"] .partial`);
      if (p) p.textContent = '';
      if (nearBottom) r.scrollTop = r.scrollHeight;
    },

    onText(d) {
      const partial = (d.partial || '').replace(/^\s*[\[【［][^\]】］]*[\]】］]\s*/, '').trim();
      // 開啟「顯示思考摘要」時，Gemini 的思考摘要以 **標題** 開頭，顯示目前在想的標題
      const m = d.thought && d.thought.match(/\*\*([^*\n]{2,80})\*\*/);
      if (m) V.thoughtTitle = m[1].trim();
      const label = d.thinking ? (TT.settings.llm.showThoughts && V.thoughtTitle ? `思考中：${V.thoughtTitle}` : '思考中…') : TT.engine.status || `${V.ctx.card.name} 正在構思…`;
      V.waitLabel = label;
      if (V.mode === 'theater') {
        const span = V.root.querySelector('.st-wait span');
        if (span) span.textContent = label;
        return;
      }
      const p = V.root.querySelector(`[data-mid="${d.msgId}"] .partial`);
      if (p) p.textContent = d.thinking ? '思考中…' : TT.truncate(partial, 80);
      const line = V.root.querySelector('.gen-line');
      line.hidden = false;
      line.innerHTML = String(html`<span class="spinner"></span><span>${label}</span>`);
    },

    onImage(d) {
      if (d.kind === 'task') {
        // 立繪、特殊場景圖或背景畫好了（主角的立繪存在主角身上）
        if (d.status === 'done' && (d.cardId === V.ctx.card.id || d.cardId === V.ctx.persona.id)) {
          V.refreshSprites();
          if (V.mode === 'theater' && /^bg\|/.test(d.key || '')) { V.th.bgKey = ''; if (V.th.pos >= 0) V.updateBackground(V.th.pos); }
        }
        return;
      }
      if (d.kind === 'portrait') {
        if ((d.cardId !== V.ctx.card.id && d.cardId !== V.ctx.persona.id) || (d.status !== 'done' && d.status !== 'progress')) return;
        V.preloadSprites();
        if (V.mode === 'theater') {
          V.root.querySelectorAll('.stage-chars .sprite').forEach((el) => { if (el.dataset.name === d.name) el.dataset.ref = ''; });
          if (V.th.pos >= 0) V.renderSprites(V.stageState(V.th.pos));
        } else V.renderReader();
        return;
      }
      if (V.mode === 'theater') {
        V.rebuildSteps();
        if (V.th.pos >= 0) V.updateBackground(V.th.pos);
        return;
      }
      const fig = V.root.querySelector(`.reader [data-beat="${d.msgId}|${d.swipe}|${d.beat}"]`);
      if (!fig) return;
      const m = V.ctx.session.messages.find((x) => x.id === d.msgId);
      const b = m && m.swipes[d.swipe] && m.swipes[d.swipe].beats[d.beat];
      if (!b) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = V.sceneHTML(b, `${d.msgId}|${d.swipe}|${d.beat}`);
      const node = tmp.firstElementChild;
      fig.replaceWith(node);
      TT.media.hydrate(node);
    },

    /* ---------- 共用 ---------- */
    // 狀態欄收起時只有目前角色（說話中、或最近說話的角色池角色）的頭像、名字與好感度，有新的內心話時亮紅點。
    // 點一下展開下面的面板，就是完整的「角色、立繪與狀態」（目前角色排最前面）；再點狀態欄或面板上的收合鍵收起
    renderHud(flash) {
      const st = TT.engine.deriveState(V.ctx.session, V.ctx.card, V.ctx.persona);
      const { mine, who, vals } = V.hudData(st);
      V.hudWho = who;
      V.hudAppeared = st.appeared;
      const aff = Object.entries(vals).find(([k]) => AFFECT.test(k));
      const unseen = !!who && V.unseenInner({ [who]: vals }).length > 0;
      const hud = V.root.querySelector('.stage-hud');
      hud.innerHTML = String(html`${who
        ? html`<span class="hud-who ${flash && flash.startsWith(who + '・') ? 'flash' : ''}">${TT.ui.speakerAvatar(who, V.ctx, 24)}<b>${who}</b>${aff ? html`<span class="hw-aff">${icon('heart', 11)}${aff[1]}</span>` : ''}${unseen ? html`<i class="cc-dot"></i>` : ''}</span>`
        : html`<span class="hud-who">${icon('users', 15)}<b>角色與狀態</b></span>`}
        <span class="hud-caret">${icon(V.hudOpen ? 'up' : 'down', 14)}</span>`);
      hud.hidden = !mine.length && !who;
      TT.media.hydrate(hud);
      const more = V.root.querySelector('.stage-hud-more');
      more.hidden = !V.hudOpen || hud.hidden;
      if (!more.hidden) V.renderHudPanel(flash);
      else { more.innerHTML = ''; V.panelView = null; }
      V.root.querySelector('.reader-hud').innerHTML = mine
        .slice(0, 4)
        .map(([n, v]) => String(html`<button class="hud-chip ${n === flash ? 'flash' : ''}" data-act="state"><span>${n}</span><b>${v}</b></button>`))
        .join('');
    },

    // 狀態欄展開的面板：「角色、立繪與狀態」，目前角色排最前面。正在改外貌或聲音時不重畫，免得打到一半被清掉
    renderHudPanel(flash) {
      const more = V.root.querySelector('.stage-hud-more');
      if (V.panelView && (more.querySelector('.cc-editbox:not([hidden])') || more.contains(document.activeElement))) return;
      const fresh = !V.panelView;
      const view = V.stateView({ first: V.hudWho, flash, size: 56 });
      V.panelView = view;
      more.innerHTML = String(html`<div class="hud-panel-head"><b>角色、立繪與狀態</b><button class="icon-btn" data-act="hud" title="收合">${icon('up', 18)}</button></div>${view.body}`);
      // 每次打開都從最上面（目前角色）開始看
      if (fresh) more.scrollTop = 0;
      TT.media.hydrate(more);
      V.markInnerSeen(view.chars);
    },

    // 狀態欄的內容：主角狀態（好感度這類屬於角色的數值不算），以及目前角色的狀態（名單上寫的關係、資訊當預設）
    hudData(st) {
      const { stats, chars, appeared } = st;
      const card = V.ctx.card;
      const charKeys = new Set();
      for (const [w, vs] of Object.entries(chars)) for (const n of Object.keys(vs)) charKeys.add(`${w}・${n}`);
      const own = Object.keys(stats).filter((k) => !charKeys.has(k));
      const mine = own.filter((k) => !AFFECT.test(k)).map((k) => [k, stats[k]]);
      const who = V.currentChar(appeared);
      if (!who) return { mine, who: '', vals: {} };
      const e = TT.cast.find(card, who) || {};
      const main = TT.cast.canon(card, card.nickname || card.name, V.ctx.persona);
      // 沒寫角色名的好感度（舊存檔，或模型沒照規定寫）算作品主要角色的
      const loose = who === main ? Object.fromEntries(own.filter((k) => AFFECT.test(k)).map((k) => [k, stats[k]])) : {};
      return { mine, who, vals: { ...(e.role ? { 關係: e.role } : {}), ...(e.info ? { 資訊: e.info } : {}), ...loose, ...(chars[who] || {}) } };
    },

    // 目前角色：這一句的說話者；旁白、主角或路人說話時，往前找最近說話的角色池角色；都沒有就用角色池裡第一個已經登場的
    currentChar(appeared) {
      const { card, persona } = V.ctx;
      const me = persona && persona.name;
      const pool = TT.cast.pool(card);
      const steps = (V.th && V.th.steps) || [];
      const i = V.th && V.th.pos >= 0 ? V.th.pos : steps.length - 1;
      for (let j = Math.min(i, steps.length - 1); j >= 0 && j > i - 80; j--) {
        const s = steps[j];
        if (s.role === 'user' || (s.b.t !== 'say' && s.b.t !== 'think') || !s.b.name) continue;
        const n = TT.cast.canon(card, s.b.name, persona);
        if (n !== me && pool.includes(n)) return n;
      }
      return pool.find((n) => n !== me && appeared && appeared.has(n)) || '';
    },

    // 角色卡片：方形頭像＋名字，下面一列一列是關係、資訊、內心話等角色狀態
    charCard(who, vals, { size = 64, edit = false, flash = '' } = {}) {
      const seen = V.ctx.session.innerSeen || {};
      const rows = Object.entries(vals || {}).sort(([a], [b]) => rowStyle(a).rank - rowStyle(b).rank);
      return html`<div class="ccard" data-who="${who}">
        <div class="cc-head">${V.charAvatar(who, size)}<b class="cc-name">${who}</b>${edit ? html`<button class="icon-btn cc-edit" data-cc-edit title="外貌、聲音與立繪">${icon('gear', 18)}</button>` : ''}</div>
        ${rows.length ? rows.map(([k, v]) => {
          const r = rowStyle(k);
          const hot = flash === `${who}・${k}`;
          return html`<div class="cc-row ${hot ? 'flash' : ''}"><span class="cc-k ${r.cls}">${icon(r.ic, 15)}<span>${k}</span>${r.inner && seen[who] !== String(v) ? html`<i class="cc-dot"></i>` : ''}</span><span class="cc-v">${v}</span></div>`;
        }) : html`<div class="cc-row"><span class="cc-v muted">還沒有狀態</span></div>`}
      </div>`;
    },

    // 角色頭像：有立繪就放大臉部（主角的立繪存在主角身上），否則用角色卡圖、主角頭像或名字縮寫
    charAvatar(who, size) {
      const { card, session, persona } = V.ctx;
      const owner = persona && who === persona.name ? persona : card;
      const p = TT.sprites.pick(owner, who, '');
      let media = '';
      let face = false;
      if (p) {
        const set = (owner.expr || {})[p.name] || {};
        media = p.key && set[p.key] ? `sprite:${owner.id}|${p.name}|${p.key}` : owner.sprites && owner.sprites[p.name] ? `sprite:${owner.id}|${p.name}` : '';
        face = !!media;
      }
      if (!media && (who === card.name || who === card.nickname)) media = `card:${card.id}`;
      if (!media && persona && who === persona.name && persona.avatar) media = `persona:${persona.id}`;
      const ov = session.castOverrides && session.castOverrides[who];
      if (!media && ov && ov.avatarImageId) media = `img:${ov.avatarImageId}`;
      return html`<span class="avatar cc-av ${face ? 'face' : ''}" style="width:${size}px;height:${size}px">${TT.ui.nameAvatar(who, size, 'fallback')}${media ? html`<img data-media="${media}" alt="">` : ''}</span>`;
    },

    // 還沒看過的內心話（角色名清單）
    unseenInner(chars) {
      const seen = V.ctx.session.innerSeen || {};
      return Object.keys(chars).filter((who) => Object.entries(chars[who]).some(([n, v]) => INNER.test(n) && seen[who] !== String(v)));
    },
    markInnerSeen(chars) {
      const s = V.ctx.session;
      const seen = { ...(s.innerSeen || {}) };
      let changed = false;
      for (const [who, vals] of Object.entries(chars)) {
        const e = Object.entries(vals).find(([n]) => INNER.test(n));
        if (e && seen[who] !== String(e[1])) { seen[who] = String(e[1]); changed = true; }
      }
      if (!changed) return;
      // 紅點等下一次重畫才消失，讓這一次還看得到哪幾句是新的
      s.innerSeen = seen;
      TT.store.saveSession(s);
    },

    renderChoices() {
      const box = V.root.querySelector('.choices');
      if (V.mode === 'theater') { box.innerHTML = ''; return; }
      const { session } = V.ctx;
      let opts = [];
      if (!TT.engine.isGenerating(session.id)) {
        const last = session.messages[session.messages.length - 1];
        if (last && last.role === 'assistant') {
          const c = (cur(last).beats || []).find((b) => b.t === 'choice');
          if (c) opts = c.options.slice(0, 5);
        }
      }
      V.options = opts;
      box.innerHTML = opts.map((o, i) => String(html`<button class="choice" data-choice="${i}"><span class="choice-n">${i + 1}</span>${o}</button>`)).join('');
      V.root.classList.toggle('has-choices', opts.length > 0);
    },

    updateGenUI() {
      const gen = TT.engine.isGenerating(V.ctx.session.id);
      const line = V.root.querySelector('.gen-line');
      const status = TT.engine.status;
      if (gen || status) {
        line.hidden = false;
        // 狀態（例如「模型忙線中…」）結束時也要換掉，不留在畫面上
        if (!line.textContent || status || line.dataset.status) line.innerHTML = String(html`<span class="spinner"></span><span>${status || `${V.ctx.card.name} 正在構思…`}</span>`);
        line.dataset.status = status || '';
      } else {
        line.hidden = true;
        line.innerHTML = '';
      }
      // 劇場的暫停鍵在行動框裡；漫畫／小說模式的送出鍵在生成時變成暫停鍵
      V.root.querySelectorAll('.play-bottom .send-btn').forEach((send) => {
        send.classList.toggle('stop', gen);
        send.innerHTML = TT.icon(gen ? 'pause' : 'send', 18);
        send.title = gen ? '暫停生成（保留已寫好的部分）' : '送出';
      });
      V.root.querySelectorAll('.quickbar [data-act="continue"], .quickbar [data-act="regen"]').forEach((b) => (b.disabled = gen));
      V.root.classList.toggle('generating', gen);
      V.updateTheaterChrome();
    },

    autosize(t) {
      t = t || V.inputEl();
      if (!t) return;
      t.style.height = 'auto';
      t.style.height = Math.min(t.scrollHeight, 140) + 'px';
    },

    async sendInput(text) {
      if (TT.engine.isGenerating()) return;
      const inp = V.inputEl();
      const value = text != null ? text : inp.value.trim();
      if (!value) { inp.focus(); return; }
      if (!(await TT.actions.ensureLLM())) return;
      if (text == null) { inp.value = ''; V.autosize(inp); }
      TT.tts.stop();
      V.th.jumpToEnd = V.mode === 'theater';
      const ok = await TT.engine.send(V.ctx, value);
      if (!ok && text == null && V.ctx && !inp.value) inp.value = value;
    },

    // 輸入框送出（Enter 或送出鍵）：劇場在過去的選擇點時改走「從這裡重來」
    submit() {
      if (V.mode === 'theater' && V.decide && V.decide.mode === 'history') {
        const inp = V.inputEl();
        const value = inp.value.trim();
        if (!value) { inp.focus(); return; }
        return V.choose(value).then((ok) => { if (ok && V.ctx) { inp.value = ''; V.autosize(inp); } });
      }
      return V.sendInput();
    },

    // 在選擇點做出行動。最新的選擇點直接送出；過去的選擇點要先回到那裡，之後的劇情可以另存成分支
    async choose(value, { auto = false } = {}) {
      if (!V.decide || V.decide.mode !== 'history') {
        if (auto) return V.continueStory();
        return V.sendInput(value);
      }
      const mi = V.ctx.session.messages.findIndex((m) => m.id === V.decide.mid);
      if (mi < 0) return false;
      return V.redoFrom(mi, value, { auto });
    },

    // 從第 mi 則（選擇點那則 AI 訊息）改走另一個選擇：之後的劇情被取代，可以先另存成分支
    async redoFrom(mi, value, { auto = false } = {}) {
      const ctx = V.ctx;
      const s = ctx.session;
      if (mi < 0 || !s.messages[mi]) return false;
      const later = s.messages.length - 1 - mi;
      const what = auto ? '「自動進行」' : `「${TT.truncate(value, 40)}」`;
      const v = await TT.sheet({
        title: '從這個選擇點重來',
        body: html`<p class="sheet-msg">回到這個選擇點，改成 ${what}。之後的 ${later} 則劇情會被新的發展取代。</p>
          <p class="hint">選「另存分支後重來」會把現在的進度保留成另一個存檔，之後可以從「存檔列表」回去。</p>`,
        actions: [{ label: '取消', value: '' }, { label: '直接重來', value: 'drop' }, { label: '另存分支後重來', value: 'keep', primary: true }],
      });
      if (!v || !V.ctx) return false;
      if (!(await TT.actions.ensureLLM())) return false;
      await V.stopGeneration();
      if (v === 'keep') {
        await TT.engine.branch(ctx, s.messages.length - 1);
        TT.toast('原本的進度已另存成分支存檔', { icon: 'branch' });
      }
      await TT.engine.rewind(ctx, mi);
      if (auto) await V.continueStory();
      else await V.sendInput(value);
      return true;
    },

    async continueStory() {
      if (!(await TT.actions.ensureLLM())) return;
      TT.tts.stop();
      V.th.jumpToEnd = V.mode === 'theater';
      return TT.engine.continueStory(V.ctx);
    },

    // 暫停後繼續生成：從中斷的地方接著寫
    async resumeGen() {
      if (!(await TT.actions.ensureLLM())) return;
      TT.tts.stop();
      if (V.mode === 'theater') V.th.waiting = V.th.pos >= V.th.steps.length - 1;
      return TT.engine.resume(V.ctx);
    },

    // 停止生成並等它收尾（存檔、發出 gen:end）
    async stopGeneration() {
      if (!TT.engine.isGenerating(V.ctx.session.id)) return;
      V.stopping = true;
      TT.engine.stop();
      for (let k = 0; k < 100 && TT.engine.isGenerating(); k++) await TT.sleep(50);
      await TT.sleep(30);
      V.stopping = false;
    },

    // 重新選擇：撤回最後一次的行動與 AI 回覆（生成中就先停止），回到那個選擇點重選
    async rechoose() {
      const ctx = V.ctx;
      const s = ctx.session;
      await V.stopGeneration();
      let ui = -1;
      for (let k = s.messages.length - 1; k >= 0; k--) if (s.messages[k].role === 'user') { ui = k; break; }
      if (ui < 0) return;
      const um = s.messages[ui];
      const text = um.hidden ? '' : cur(um).raw;
      V.th.jumpToEnd = true;
      await TT.engine.rewind(ctx, ui - 1);
      const last = s.messages[s.messages.length - 1];
      const ch = last && last.role === 'assistant' && (cur(last).beats || []).find((b) => b.t === 'choice');
      if (text && !(ch && ch.options.includes(text))) {
        const inp = V.inputEl();
        inp.value = text;
        V.autosize(inp);
      }
    },

    async regenerate() {
      const ctx = V.ctx;
      if (!(await TT.actions.ensureLLM())) return;
      if (TT.engine.isGenerating(ctx.session.id)) {
        TT.engine.stop();
        for (let k = 0; k < 80 && TT.engine.isGenerating(); k++) await TT.sleep(50);
      }
      TT.tts.stop();
      V.th.jumpToEnd = V.mode === 'theater';
      return TT.engine.regenerate(ctx);
    },

    // 結局畫面每個結局只自動跳出一次（記在存檔裡）；之後再看到那一句只顯示「結局：名稱」
    showEnding(title, mid) {
      const key = (mid || '') + title;
      const s = V.ctx.session;
      if (V.th.endShown === key || V.root.querySelector('.ending-ov') || (mid && (s.endSeen || {})[mid])) return;
      V.th.endShown = key;
      if (mid) { s.endSeen = { ...(s.endSeen || {}), [mid]: Date.now() }; TT.store.saveSession(s); }
      const n = TT.achv.endingsFor(V.ctx.card.id).length;
      const ov = document.createElement('div');
      ov.className = 'ending-ov';
      ov.innerHTML = String(html`<div class="ending-card">
        <small>ENDING</small><h2>${title}</h2>
        <p>已收錄「${V.ctx.card.name}」的 ${n} 個結局</p>
        <div class="ending-actions">
          <button class="btn" data-end="close">繼續故事</button>
          <button class="btn" data-end="restart">重新開始</button>
          <button class="btn primary" data-end="home">返回書架</button>
        </div></div>`);
      V.root.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('show'));
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('[data-end]');
        if (!b) return;
        const a = b.dataset.end;
        ov.remove();
        if (a === 'home') TT.router.go('/library');
        if (a === 'restart') TT.router.go('/card/' + V.ctx.card.id);
      });
    },

    toggleAuto() {
      TT.settings.story.autoPlay = !TT.settings.story.autoPlay;
      TT.saveSettings();
      TT.toast(TT.settings.story.autoPlay ? '自動播放：開' : '自動播放：關');
      V.updateTheaterChrome();
      if (TT.settings.story.autoPlay) V.advance(true);
    },

    toggleTts() {
      TT.settings.audio.tts = !TT.settings.audio.tts;
      TT.saveSettings();
      V.root.querySelectorAll('[data-act="tts"]').forEach((b) => b.classList.toggle('on', TT.settings.audio.tts));
      if (!TT.settings.audio.tts) TT.tts.stop();
      TT.toast(TT.settings.audio.tts ? '朗讀：開' : '朗讀：關');
    },

    /* ---------- 事件 ---------- */
    async onClick(e) {
      const ctx = V.ctx;
      const re = e.target.closest('[data-reopt],[data-reauto],[data-rego]');
      if (re) return V.onSaMenu(re);
      // 點選單以外的地方就收起「重新選擇」的選項
      if (V.saMenu && !e.target.closest('.stage-action')) V.closeSaMenu();
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn) return V.setMode(modeBtn.dataset.mode);
      const ch = e.target.closest('[data-choice]');
      if (ch) {
        const o = V.options[+ch.dataset.choice];
        if (o) { if (V.mode === 'theater') V.choose(o); else V.sendInput(o); }
        return;
      }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      const art = a.closest('[data-mid]');
      const idx = art ? +art.dataset.idx : -1;
      switch (act) {
        case 'back': return TT.router.back('/card/' + ctx.card.id);
        case 'advance': return V.advance();
        case 'prev': return V.uiHidden ? V.toggleUi(false) : V.prev();
        case 'prevchoice': return V.prevChoice();
        case 'nextchoice': return V.nextChoice();
        case 'latest': return V.toLatest();
        case 'hideui': return V.toggleUi();
        case 'menu': return V.menu();
        case 'send':
          // 生成中，送出鍵變成暫停鍵：保留已寫好的部分，之後可以繼續生成
          if (V.mode !== 'theater' && TT.engine.isGenerating(ctx.session.id)) return TT.engine.pause();
          return V.submit();
        case 'continue':
          if (V.mode === 'theater' && a.closest('.stage-decide')) return V.choose(null, { auto: true });
          return V.continueStory();
        case 'regen': return V.regenerate();
        case 'rechoose': return V.rechooseMenu();
        case 'pausegen': return TT.engine.pause();
        case 'resumegen': return V.resumeGen();
        case 'bgm': {
          // 配樂開關；這本書的配樂庫還是空的就打開它
          if (!TT.bgm.names(ctx.card.id).length) return TT.bgm.manager({ card: ctx.card });
          TT.settings.audio.bgm = TT.settings.audio.bgm === false;
          TT.saveSettings();
          TT.toast(TT.settings.audio.bgm ? '配樂：開' : '配樂：關');
          return TT.bus.emit('audio:settings');
        }
        case 'sfxplay': return TT.sfx.play({ name: a.dataset.sfxName || '', text: a.dataset.sfxText || '' }).then((n) => { if (!n) TT.toast('音效庫裡沒有對應的音效，可以到「音效庫」匯入'); });
        case 'log': return V.setMode('novel');
        case 'auto': return V.toggleAuto();
        case 'tts': return V.toggleTts();
        case 'mic': return V.toggleMic(a);
        case 'more': V.limit += 60; return V.renderReader();
        case 'swipe': return TT.engine.setSwipe(ctx, art.dataset.mid, +a.dataset.dir);
        case 'msgmenu': return V.msgMenu(idx);
        case 'imggen': {
          const [mid, swi, bi] = a.closest('[data-beat]').dataset.beat.split('|');
          return TT.engine.regenerateImage(ctx, mid, +swi, +bi);
        }
        case 'framecg': {
          let at;
          if (a.dataset.frame) {
            const [mid, swi, bi] = a.dataset.frame.split('|');
            at = { mid, swi: +swi, bi: +bi };
          } else {
            const step = V.th.steps[V.th.pos];
            if (step) at = { mid: step.mid, swi: step.swi, bi: step.bi };
          }
          if (!at) return TT.toast('目前沒有可生成的分鏡', { type: 'error' });
          return V.storyImage({ back: true, forceType: 'cg', frameAt: at });
        }
        case 'viewimg': return V.viewImage(a.closest('[data-beat]').dataset.beat);
        case 'bgretry': {
          if (!a.dataset.job) return;
          const j = JSON.parse(a.dataset.job);
          return TT.engine.regenerateImage(ctx, j.msgId, j.swipe, j.beat);
        }
        case 'state': return V.stateSheet();
        case 'hud':
          V.hudOpen = !V.hudOpen;
          return V.renderHud();
      }
    },

    toggleMic(btn) {
      if (TT.stt.listening) { TT.stt.stop(); return; }
      const inp = V.inputEl();
      const base = inp.value ? inp.value.replace(/\s*$/, ' ') : '';
      try {
        TT.stt.start({
          onText: (t) => { inp.value = base + t; V.autosize(inp); },
          onEnd: (t) => { btn.classList.remove('active'); if (t) TT.achv.unlock('voice'); inp.focus(); },
        });
        btn.classList.add('active');
      } catch (err) { TT.toast(err.message, { type: 'error' }); }
    },

    async menu() {
      const ctx = V.ctx;
      const modes = V.mode === 'theater'
        ? [{ label: '漫畫模式（條漫捲動）', value: 'mode:comic', icon: 'comic' }, { label: '小說模式（回顧全文）', value: 'mode:novel', icon: 'text' }]
        : [{ label: '劇場模式', value: 'mode:theater', icon: 'film' }];
      const v = await TT.choose('劇情選單', [
        ...modes,
        { label: `自動播放：${TT.settings.story.autoPlay ? '開' : '關'}`, value: 'auto', icon: 'fast' },
        ...(TT.tts.supported ? [{ label: `朗讀：${TT.settings.audio.tts ? '開' : '關'}`, value: 'tts', icon: 'volume' }] : []),
        { label: '角色與狀態', value: 'state', icon: 'users' },
        { label: '優先指示（要記住的事、劇情走向、輸出方式、禁止事項）', value: 'priority', icon: 'flag' },
        { label: '作品設定（角色池、立繪、主角、特殊場景、背景）', value: 'sprites', icon: 'image' },
        { label: '作者的設定與規則（提示詞、世界書開關）', value: 'notes', icon: 'book' },
        { label: '依目前劇情生成圖片', value: 'storyimg', icon: 'feather' },
        { label: '這本書的配樂庫（BGM）', value: 'bgmlib', icon: 'music' },
        { label: '音效庫', value: 'sfx', icon: 'volume' },
        { label: '生成工作（暫停／停止）', value: 'tasks', icon: 'pause' },
        { label: '前情提要（長期記憶）', value: 'summary', icon: 'book' },
        { label: '存檔列表', value: 'saves', icon: 'save' },
        { label: '從目前進度建立分支', value: 'branch', icon: 'branch' },
        { label: '重新命名存檔', value: 'rename', icon: 'edit' },
        { label: '匯出劇情', value: 'export', icon: 'download' },
        { label: '故事詳情', value: 'detail', icon: 'info' },
        { label: '設定', value: 'settings', icon: 'settings' },
      ]);
      if (!v || !V.ctx) return;
      if (v.startsWith('mode:')) return V.setMode(v.slice(5));
      // 從選單打開的面板左上角有返回鍵，按了回到這個選單（返回上一步）
      const sub = { state: () => V.stateSheet({ back: true }), priority: () => TT.priority.sheet({ card: ctx.card, session: ctx.session, persona: ctx.persona, back: true }), sprites: () => V.spriteSheet(null, { back: true }), notes: () => TT.authorNotes.sheet(ctx.card, { back: true }), storyimg: () => V.storyImage({ back: true }), bgmlib: () => TT.bgm.manager({ back: true, card: ctx.card }), sfx: () => TT.sfx.manager({ back: true }), summary: () => V.summarySheet({ back: true }), saves: () => V.savesSheet({ back: true }), export: () => V.exportSheet({ back: true }) }[v];
      if (sub) {
        const r = await sub();
        if (r === '__back' && V.ctx) V.menu();
        return;
      }
      switch (v) {
        case 'auto': return V.toggleAuto();
        case 'tts': return V.toggleTts();
        case 'tasks': return TT.tasks.open();
        case 'branch': {
          const s = await TT.engine.branch(ctx, ctx.session.messages.length - 1);
          TT.toast('已建立分支存檔', { icon: 'branch' });
          return TT.router.go('/play/' + s.id);
        }
        case 'rename': {
          const t = await TT.promptText('存檔名稱', ctx.session.title);
          if (t && t.trim()) { ctx.session.title = t.trim(); TT.store.saveSession(ctx.session); V.root.querySelector('.play-sub').textContent = ctx.session.title; }
          return;
        }
        case 'detail': return TT.router.go('/card/' + ctx.card.id);
        case 'settings': return TT.router.go('/settings');
      }
    },

    async msgMenu(i) {
      const ctx = V.ctx;
      const msgs = ctx.session.messages;
      const m = msgs[i];
      if (!m) return;
      const last = i === msgs.length - 1;
      const opts = [];
      if (m.role === 'assistant' && last) opts.push({ label: m.kind === 'greeting' ? 'AI 改編序章' : '重新生成這段', value: 'regen', icon: 'refresh' });
      opts.push({ label: '編輯內容', value: 'edit', icon: 'edit' });
      opts.push({ label: '複製文字', value: 'copy', icon: 'copy' });
      opts.push({ label: '從這裡建立分支', value: 'branch', icon: 'branch' });
      if (m.role === 'user') opts.push({ label: '從這句重新來過', value: 'redo', icon: 'back' });
      if (i > 0) opts.push({ label: '刪除這則與之後的內容', value: 'delete', icon: 'trash', danger: true });
      const v = await TT.choose('訊息', opts);
      if (!v || !V.ctx) return;
      const sw = cur(m);
      switch (v) {
        case 'regen': return V.regenerate();
        case 'edit': {
          const t = await TT.promptText('編輯內容', sw.raw, { multiline: true, hint: m.role === 'assistant' ? '可使用 [SCENE] [NARR] [SAY:名字] 等分鏡標籤' : '' });
          if (t != null) await TT.engine.editMessage(ctx, i, t);
          return;
        }
        case 'copy': {
          const text = m.role === 'user' ? sw.raw : TT.parser.beatsToProse(sw.beats);
          try { await navigator.clipboard.writeText(text); TT.toast('已複製'); } catch (e) { TT.toast('無法存取剪貼簿', { type: 'error' }); }
          return;
        }
        case 'branch': {
          const s = await TT.engine.branch(ctx, i);
          TT.toast('已建立分支存檔', { icon: 'branch' });
          return TT.router.go('/play/' + s.id);
        }
        case 'redo': {
          if (!(await TT.confirm('會刪除這句與之後的所有內容，並把這句放回輸入框。', { okText: '重新來過' }))) return;
          await TT.engine.rewind(ctx, i - 1);
          const inp = V.inputEl();
          inp.value = sw.raw;
          V.autosize(inp);
          inp.focus();
          return;
        }
        case 'delete':
          if (!(await TT.confirm('刪除這則與之後的所有內容？此動作無法復原。', { danger: true, okText: '刪除' }))) return;
          return TT.engine.rewind(ctx, i - 1);
      }
    },

    async viewImage(key) {
      const ctx = V.ctx;
      const [mid, swi, bi] = key.split('|');
      const m = ctx.session.messages.find((x) => x.id === mid);
      const b = m && m.swipes[+swi] && m.swipes[+swi].beats[+bi];
      if (!b || !b.imageId) return;
      const url = await TT.media.url('img', b.imageId);
      const rec = await TT.db.get('images', b.imageId);
      const v = await TT.sheet({
        title: '場景',
        wide: true,
        body: html`<img class="viewer-img" src="${url}" alt=""><p class="hint">${b.text}</p><details class="prompt-box"><summary>繪圖提示詞</summary><pre>${(rec && rec.prompt) || b.prompt}</pre></details>`,
        actions: [{ label: '下載', value: 'dl' }, { label: '修改提示詞', value: 'edit' }, { label: '重新生成', value: 'regen', primary: true }],
      });
      if (v === 'dl') {
        if (rec && rec.blob) TT.download(`${TT.safeFileName(ctx.card.name)}-${b.imageId}.png`, rec.blob);
        else window.open(url, '_blank');
      } else if (v === 'regen') TT.engine.regenerateImage(ctx, mid, +swi, +bi);
      else if (v === 'edit') {
        const p = await TT.promptText('繪圖提示詞（英文）', b.prompt || '', { multiline: true, hint: '畫風在設定中調整。' });
        if (p != null) TT.engine.regenerateImage(ctx, mid, +swi, +bi, p.trim());
      }
    },

    // 角色、立繪與狀態的內容（選單打開的面板、狀態欄展開的面板共用）：上面是主角狀態（時間、地點…），
    // 下面每個角色一張卡片，卡片右上角的齒輪展開外貌標籤、聲音與立繪。first：排在最前面的角色
    stateView({ first = '', flash = '', size = 72 } = {}) {
      const ctx = V.ctx;
      const { stats, chars, cast, appeared } = TT.engine.deriveState(ctx.session, ctx.card, ctx.persona);
      const voices = TT.tts.supported ? TT.tts.voices() : [];
      const ov = ctx.session.castOverrides || (ctx.session.castOverrides = {});
      const charKeys = new Set();
      for (const [who, vs] of Object.entries(chars)) for (const n of Object.keys(vs)) charKeys.add(`${who}・${n}`);
      const mine = Object.keys(stats).filter((k) => !charKeys.has(k));
      // 只列出已經在劇情裡登場的角色（名單上還沒出場的人，到作品設定才看得到）；
      // 有狀態的角色在前（依出場順序），主角（你）放最後
      const names = [...appeared].filter((n) => cast[n] || chars[n]);
      names.sort((a, b) => ((cast[a] && cast[a].kind === 'user') - (cast[b] && cast[b].kind === 'user')) || (!chars[a] - !chars[b]));
      if (first && names.includes(first)) names.unshift(...names.splice(names.indexOf(first), 1));
      const kindLabel = { char: '主要角色', user: '主角（你）', npc: '配角' };
      // 作品自帶的登場人物：劇情還沒寫到的關係、資訊先用名單上的
      const vals = (n) => {
        const e = TT.cast.find(ctx.card, n) || {};
        return { ...(e.role ? { 關係: e.role } : {}), ...(e.info ? { 資訊: e.info } : {}), ...(chars[n] || {}) };
      };
      const body = html`
        ${mine.length ? html`<h4 class="sec-title">主角狀態</h4><div class="ccard mine">${mine.map((n) => html`<div class="cc-row ${n === flash ? 'flash' : ''}"><span class="cc-k k-other">${icon(hudIcon(n), 15)}<span>${n}</span></span><span class="cc-v">${stats[n]}</span></div>`)}</div>` : ''}
        <h4 class="sec-title">角色 <small>角色池裡已經登場的角色；還沒出場的、或劇情裡新出現的人，到「作品設定」管理角色池</small></h4>
        <div class="ccards">${names.map((n, i) => html`<div class="ccard-wrap ${n === first ? 'current' : ''}" data-i="${i}">
          ${V.charCard(n, vals(n), { size, edit: true, flash })}
          <div class="cc-editbox" hidden>
            <small class="muted">${kindLabel[(cast[n] || {}).kind] || '配角'}${TT.sprites.hasSprites(ctx.card, TT.sprites.resolveName(ctx.card, n) || n) ? '・有立繪' : ''}</small>
            <label class="field"><span>外貌標籤（英文，畫立繪用）</span><input class="input small" data-cast-tags placeholder="1girl, long black hair, …" value="${(ov[n] && ov[n].tags) || (cast[n] && cast[n].tags) || ''}"></label>
            ${voices.length ? html`<label class="field"><span>朗讀聲音</span><select class="input small" data-cast-voice><option value="">預設聲音</option>${voices.map((v) => html`<option value="${v.voiceURI}" ${ov[n] && ov[n].voice === v.voiceURI ? 'selected' : ''}>${v.name}</option>`)}</select></label>` : ''}
            <button class="btn small" data-cast-portrait>${icon('image', 14)} ${cast[n] && cast[n].kind === 'user' ? '主角立繪' : '立繪與作品設定'}</button>
          </div>
        </div>`)}</div>
        <p class="hint">「內心話」旁的紅點表示有新的心裡話。立繪存在故事裡，這個故事的所有存檔都會沿用。</p>`;
      return { body, names, chars, cast, ov };
    },

    // 卡片上的齒輪、外貌標籤、朗讀聲音、立繪按鈕；view() 回傳目前畫出來的那一份內容
    bindStateView(el, view) {
      const save = (row) => {
        const v = view();
        const ctx = V.ctx;
        if (!v || !ctx) return;
        const { names, cast, ov } = v;
        const n = names[+row.dataset.i];
        const tags = row.querySelector('[data-cast-tags]').value.trim();
        const vs = row.querySelector('[data-cast-voice]');
        const kind = cast[n] && cast[n].kind;
        const base = kind === 'char' ? ctx.card.appearance : kind === 'user' ? ctx.persona.appearance : '';
        const o = { ...(ov[n] || {}) };
        // 名單上的角色：外貌記在作品上（所有存檔共用）；其他角色記在這個存檔
        const listed = TT.cast.find(ctx.card, n);
        if (listed && tags !== listed.appearance) { TT.cast.upsert(ctx.card, listed.name, { appearance: tags }); TT.store.saveCard(ctx.card); }
        if (tags && tags !== base && !listed) o.tags = tags; else delete o.tags;
        if (vs && vs.value) o.voice = vs.value; else delete o.voice;
        if (Object.keys(o).length) ov[n] = o; else delete ov[n];
        TT.store.saveSession(ctx.session);
      };
      el.addEventListener('change', (e) => { const row = e.target.closest('.ccard-wrap'); if (row) save(row); });
      el.addEventListener('click', (e) => {
        const row = e.target.closest('.ccard-wrap');
        const v = view();
        if (!row || !v || !V.ctx) return;
        if (e.target.closest('[data-cc-edit]')) {
          const box = row.querySelector('.cc-editbox');
          box.hidden = !box.hidden;
          return;
        }
        if (!e.target.closest('[data-cast-portrait]')) return;
        const { names, cast } = v;
        const n = names[+row.dataset.i];
        const tags = row.querySelector('[data-cast-tags]').value.trim();
        const others = names.filter((x) => !cast[x] || cast[x].kind !== 'user');
        TT.sprites.manager(V.ctx.card, { name: n, names: others, ctx: V.ctx, tagsOf: (x) => (x === n ? tags : (cast[x] && cast[x].tags) || '') }).then(() => { V.refreshSprites(); V.panelView = null; V.renderHud(); });
      });
    },

    async stateSheet({ back = false } = {}) {
      const view = V.stateView();
      const res = await TT.sheet({
        title: '角色、立繪與狀態',
        className: 'state-sheet',
        back,
        body: view.body,
        actions: [{ label: '完成', primary: true }],
        onMount: (el) => {
          TT.media.hydrate(el);
          V.markInnerSeen(view.chars);
          V.bindStateView(el, () => view);
        },
      });
      if (V.ctx) { V.panelView = null; V.renderHud(); if (V.mode !== 'theater') V.renderReader(); }
      return res;
    },

    // 作品設定（角色立繪、主角、特殊場景圖、背景）；從遊玩畫面打開時可以依目前劇情生成
    async spriteSheet(name, { back = false, tab = '' } = {}) {
      const ctx = V.ctx;
      const { cast, appeared } = TT.engine.deriveState(ctx.session, ctx.card, ctx.persona);
      const names = [...appeared].filter((n) => cast[n] && cast[n].kind !== 'user');
      const res = await TT.sprites.manager(ctx.card, { name, names, back, tab, ctx, tagsOf: (n) => (cast[n] && cast[n].tags) || '' });
      V.refreshSprites();
      return res;
    },

    // 依目前劇情生成：這個角色的新表情或動作、這一刻的特殊場景圖、這個地點的背景。
    // 說明由 AI 依最近的劇情撰寫，參考目前的立繪或背景改寫；畫好可以直接套用到目前這一句
    async storyImage({ back = false, forceType = '', frameAt = null } = {}) {
      const ctx = V.ctx;
      const { card, persona } = ctx;
      if (!TT.img.enabled()) { TT.toast('請先在「設定 → 圖像生成」選擇生成服務', { type: 'error' }); return null; }
      if (V.mode !== 'theater') V.rebuildSteps();
      const st = frameAt
        ? V.th.steps.find((step) => step.mid === frameAt.mid && step.swi === frameAt.swi && step.bi === frameAt.bi)
        : V.th.steps[V.th.pos] || V.th.steps[V.th.steps.length - 1];
      if (!st) { TT.toast('這段劇情沒有可用畫面', { type: 'error' }); return null; }
      const stepIndex = V.th.steps.indexOf(st);
      const speaker = st && (st.role === 'user' ? persona.name : st.b.t === 'say' || st.b.t === 'think' ? V.canon(st.b.name) : '');
      const state = V.stageState(stepIndex);
      const who = speaker || state.focus || (card.nickname || card.name);
      const v = forceType || await TT.choose('依目前劇情生成圖片', [
        { label: `${who} 此刻的表情或動作（新的立繪種類）`, value: 'sprite', icon: 'user' },
        { label: '這一刻的特殊場景圖', value: 'cg', icon: 'image' },
        { label: '目前地點的背景', value: 'bg', icon: 'layers' },
      ], { back });
      if (!v || v === '__back') return v;
      const owner = who === persona.name ? persona : card;
      const name = owner === persona ? persona.name : who;
      const choices = TT.sprites.refChoices(card, persona);
      const cur0 = st && V.spriteRef(who, state.emo[who]);
      const pref = v === 'sprite'
        ? [cur0 && cur0.kind === 'sprite' && `s|${cur0.id.split('|').slice(0, 2).join('|')}|${cur0.id.split('|')[2] || ''}`, `s|${owner.id}|${name}|平常`]
        : v === 'cg' ? [...state.slots.filter(Boolean).map((n) => (n === persona.name ? `s|${persona.id}|${n}|平常` : `s|${card.id}|${n}|平常`))]
          : [V.th.bgKey && V.th.bgKey.startsWith('bg:') && `b|${V.th.bgKey.split('|')[1]}`];
      const r = await TT.sprites.genForm({
        type: v, title: v === 'sprite' ? `${name}・依劇情生成` : v === 'cg' ? '依劇情生成特殊場景圖' : '依劇情生成背景',
        name: '', nameEditable: true, refs: choices, selected: pref.filter(Boolean), ctx, card, persona, who: v === 'bg' ? '' : name,
        at: frameAt ? { ...frameAt, singleBeat: true } : null,
        apply: v === 'sprite' ? '畫好後讓目前這句換成這張立繪' : v === 'cg' ? '畫好後從目前這句開始顯示' : '畫好後從目前這句開始換成這個背景',
        autoStory: true,
      });
      if (!r) return null;
      // 沒畫出來不會自動重試：按「修改後重試」時重新打開這張的生成設定（帶著上次的畫法與沒畫出來的原因）
      const retry = async (rep) => {
        const r2 = await TT.sprites.genForm({
          type: v, title: `重試・${r.name}`, name: r.name, nameEditable: v !== 'sprite', desc: r.desc, prompt: r.prompt,
          refs: TT.sprites.refChoices(card, persona), selected: r.refs.map((x) => x.id), ctx: V.ctx === ctx ? ctx : null, card, persona,
          at: frameAt ? { ...frameAt, singleBeat: true } : null,
          who: v === 'bg' ? '' : name, notice: rep && rep.error, reason: rep && rep.reason,
        });
        if (!r2) return;
        if (v === 'sprite') TT.sprites.generateSprite(owner, name, r.name, { prompt: [r2.desc, r2.prompt].filter(Boolean).join('. '), refs: r2.refs, keep: r2.keep, retry });
        else TT.sprites.generateScene(card, v, { name: r2.name, desc: r2.desc, prompt: r2.prompt, refs: r2.refs, retry });
      };
      let job;
      if (v === 'sprite') {
        const key = TT.sprites.setKind(owner, name, { key: r.name, desc: r.desc });
        await TT.sprites.saveOwner(owner);
        job = TT.sprites.generateSprite(owner, name, key, { prompt: [r.desc, r.prompt].filter(Boolean).join('. '), refs: r.refs, keep: r.keep, retry });
        r.name = key;
      } else job = TT.sprites.generateScene(card, v, { name: r.name, desc: r.desc, prompt: r.prompt, refs: r.refs, retry });
      TT.toast('已加入生成佇列，可以在選單「生成工作」暫停或停止');
      if (!r.apply) return 'queued';
      const at = st && { b: st.b, mid: st.mid };
      job.promise.then((out) => { if (out && out.ok && V.ctx === ctx && at) V.applyGenerated(v, r.name, who, at, out.result && out.result.id); });
      return 'queued';
    },

    // 把依劇情畫好的圖套用到當時那一句：立繪換成新的種類；特殊場景圖、背景從那一句開始顯示
    async applyGenerated(type, name, who, at, assetId = '') {
      const s = V.ctx.session;
      const m = s.messages.find((x) => x.id === at.mid);
      const sw = m && cur(m);
      const i = sw ? sw.beats.indexOf(at.b) : -1;
      if (i < 0) return;
      if (type === 'sprite') {
        // 這個角色在這一句（或之前最近一次說話）換成新的立繪，直到他下次換表情
        const me = V.ctx.persona.name;
        const steps = V.th.steps;
        let k = steps.findIndex((x) => x.b === at.b);
        for (; k >= 0; k--) {
          const x = steps[k];
          const n = x.role === 'user' ? me : x.b.t === 'say' || x.b.t === 'think' ? V.canon(x.b.name) : '';
          if (n === who) { x.b.emo = name; break; }
        }
        if (k < 0) return TT.toast(`「${who}」在這之前還沒說過話，新立繪會在 AI 用到「${name}」時出現`);
      } else sw.beats.splice(i, 0, { t: type, name: assetId || name });
      await TT.store.saveSession(s, true);
      V.th.cur = { b: at.b, mid: at.mid };
      V.refreshSprites();
      if (V.mode === 'theater') { V.rebuildSteps(); V.th.cgKey = null; V.th.bgKey = ''; V.showStep(V.th.pos, { silentTts: true }); } else V.renderReader();
      TT.toast(type === 'sprite' ? `「${who}」換上了新的立繪` : '已套用到目前這一句', { icon: 'check', type: 'ok' });
    },

    // 立繪或特殊場景圖換了：重新預載並重畫目前這一格
    refreshSprites() {
      if (!V.ctx) return;
      V.preloadSprites();
      if (V.mode !== 'theater') return V.renderReader();
      V.root.querySelectorAll('.stage-chars .sprite').forEach((el) => { el.dataset.ref = ''; });
      V.th.cgKey = null;
      V.th.bgKey = '';
      if (V.th.pos >= 0) { V.renderSprites(V.stageState(V.th.pos)); V.updateCg(V.th.pos); V.updateBackground(V.th.pos); }
    },

    async summarySheet({ back = false } = {}) {
      const ctx = V.ctx;
      const s = ctx.session;
      const res = await TT.sheet({
        title: '前情提要',
        back,
        body: html`<p class="hint">對話太長、超出模型上下文時，較舊的劇情會被濃縮在這裡，讓角色記得發生過的事。${s.summaryUpTo >= 0 ? `目前已整理到第 ${s.summaryUpTo + 1} 則訊息。` : '目前尚未整理。'}</p>
          <textarea class="input" rows="10" data-summary placeholder="（尚無前情提要，可自行填寫重要設定與事件）">${s.summary || ''}</textarea>`,
        actions: [{ label: '立即整理', value: 'now' }, { label: '儲存', value: 'save', primary: true, onClick: (el) => { s.summary = el.querySelector('[data-summary]').value; TT.store.saveSession(s); } }],
      });
      if (res === 'now') {
        if (!(await TT.actions.ensureLLM())) return res;
        if (s.messages.length < 8) { TT.toast('劇情還很短，暫時不需要整理'); return res; }
        TT.toast('整理中…');
        await TT.engine.maybeSummarize(ctx, null, true);
        if (V.ctx) return V.summarySheet({ back });
      }
      return res;
    },

    async savesSheet({ back = false } = {}) {
      const ctx = V.ctx;
      const list = await TT.store.sessionsForCard(ctx.card.id);
      const id = await TT.choose('存檔列表', list.map((s) => ({
        label: (s.id === ctx.session.id ? '▶ ' : '') + s.title,
        hint: `${s.messages.length} 則・${TT.fmtTime(s.updatedAt)}`,
        value: s.id,
        icon: 'save',
      })).concat([{ label: '開始新的故事…', value: '__new', icon: 'plus' }]), { back });
      if (!id || id === '__back') return id;
      if (id === '__new') return TT.router.go('/card/' + ctx.card.id);
      if (id !== ctx.session.id) TT.router.go('/play/' + id);
      return id;
    },

    async exportSheet({ back = false } = {}) {
      const { session, card, persona } = V.ctx;
      const v = await TT.choose('匯出劇情', [
        { label: '純文字（.txt）', value: 'txt', icon: 'text' },
        { label: 'SillyTavern 聊天紀錄（.jsonl）', value: 'jsonl', icon: 'chat' },
        { label: '遊玩檔案（含角色卡、立繪與圖，可以分享、可以匯入）', value: 'share', icon: 'save' },
      ], { back, wrap: true });
      if (!v || v === '__back') return v;
      if (v === 'share') return TT.share.exportSheet(card, { sessionIds: [session.id], back: true });
      const base = TT.safeFileName(`${card.name}-${session.title}`);
      const msgs = session.messages.filter((m) => !m.hidden && cur(m));
      if (v === 'txt') {
        const text = msgs.map((m) => (m.role === 'user' ? `【${persona.name}】${cur(m).raw}` : TT.parser.beatsToProse(cur(m).beats))).join('\n\n');
        TT.download(base + '.txt', `${card.name}｜${session.title}\n\n${text}\n`, 'text/plain;charset=utf-8');
      } else if (v === 'jsonl') {
        const lines = [JSON.stringify({ user_name: persona.name, character_name: card.name, create_date: new Date(session.createdAt).toISOString(), chat_metadata: {} })];
        for (const m of msgs) {
          const isUser = m.role === 'user';
          lines.push(JSON.stringify({ name: isUser ? persona.name : card.name, is_user: isUser, is_system: false, send_date: new Date(m.time || session.createdAt).toISOString(), mes: isUser ? cur(m).raw : TT.parser.beatsToProse(cur(m).beats), extra: {} }));
        }
        TT.download(base + '.jsonl', lines.join('\n'), 'application/jsonl');
      }
    },
  });
})();
