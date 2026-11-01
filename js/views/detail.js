/* 故事詳情：簡介、其他版本、作者的設定與規則、選擇序章與主角、存檔、畫風與外觀、遊玩前設定、匯出與分享 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));

  const D = (TT.views.detail = {
    async mount(el, { id }, query) {
      D.el = el;
      const card = TT.store.getCard(id);
      if (!card) {
        el.innerHTML = String(html`<div class="view">${TT.ui.topbar({ title: '找不到故事', back: true })}${TT.ui.empty({ ic: 'alert', title: '這個故事已被刪除' })}</div>`);
        el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) TT.router.back(); });
        return;
      }
      D.card = card;
      D.greeting = 0;
      D.personaId = TT.store.defaultPersona().id;
      D.expanded = false;
      D.sessions = await TT.store.sessionsForCard(card.id);
      D.versions = null;
      TT.app.setBackdrop('card', card.id);
      D.render();
      // chub.ai 上同一個作者的同名書（作者更新時常另外上傳一張）與別人轉載的相同內容：查到再填進「其他版本」
      if (card.chub && !card.chub.copy) {
        TT.chub.versions(card.chub.fullPath).then((v) => {
          if (D.card !== card || !D.el) return;
          D.versions = v;
          D.fillVersions();
        }).catch((e) => console.warn('查詢其他版本失敗', e));
      }
      // 舊版匯入的 chub.ai 卡：PNG 裡可能是作者另外連結的世界書，換成這張卡自己的（每張只檢查一次）
      if (card.chub && !card.chubBookChecked) {
        TT.chub.refreshBook(card).then((r) => {
          if (!r || D.card !== card || !D.el) return;
          D.render();
          TT.toast(`已改用這張卡自己的世界書「${r.to}」（${r.count} 條）`, { icon: 'book', duration: 4000 });
        });
      }
      el.addEventListener('click', D.onClick);
      el.addEventListener('change', D.onChange);
      if (query && query.tab === 'saves') setTimeout(() => { const s = el.querySelector('#sec-saves'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }, 100);
    },

    render() {
      const oldScroller = D.el.querySelector('.detail-scroll');
      const oldScrollTop = oldScroller ? oldScroller.scrollTop : 0;
      const c = D.card;
      const gs = TT.engine.greetings(c);
      const persona = TT.store.getPersona(D.personaId) || TT.store.defaultPersona();
      const mctx = { char: c.nickname || c.name, user: persona.name, card: c, persona, vars: {} };
      const notes = TT.stripHtml(TT.macros.apply(c.creator_notes || '', mctx)).trim();
      const desc = TT.stripHtml(TT.macros.apply(c.description || '', mctx)).trim();
      const intro = notes || desc;
      const regexCount = ((c.extensions && c.extensions.regex_scripts) || []).length;
      const endings = TT.achv.endingsFor(c.id);
      const styleOpts = [['', `跟隨全域設定（${(TT.img.STYLES[TT.settings.image.style] || {}).label || ''}）`], ...Object.entries(TT.img.STYLES).map(([k, v]) => [k, v.label])];
      const sprNames = TT.sprites.spriteNames(c);
      const castNames = TT.cast.list(c).map((x) => x.name);
      // 序章或世界書裡附了作者畫的立繪、插圖
      const art = TT.authorArt.summary(c);
      const artDone = !!art && TT.authorArt.imported(c);
      const sprCount = sprNames.reduce((n, x) => n + Object.values((c.expr || {})[x] || {}).filter(Boolean).length, 0);
      const shelved = c.shelved !== false;
      // 作者寫給 AI 的提示詞（Character Note、系統提示…）與世界書
      const rules = TT.authorNotes.summary(c);

      D.el.innerHTML = String(html`<div class="view detail">
        <button class="icon-btn glass detail-back" data-act="back" aria-label="返回">${icon('back', 22)}</button>
        <div class="detail-scroll">
          <div class="hero">
            <div class="hero-bg" data-bg-media="card:${c.id}"></div>
            <img class="hero-img" data-media="card:${c.id}" alt="">
            <div class="hero-shade"></div>
            <div class="hero-top">
              <div class="spacer"></div>
              <button class="icon-btn glass ${shelved ? 'on' : ''}" data-act="shelf" title="${shelved ? '已在書架（點一下移出）' : '加入書架'}">${icon(shelved ? 'bookmarkFill' : 'bookmark', 22)}</button>
              <button class="icon-btn glass ${c.favorite ? 'on' : ''}" data-act="fav" aria-label="收藏">${icon(c.favorite ? 'heartFill' : 'heart', 22)}</button>
              <button class="icon-btn glass" data-act="more" aria-label="更多">${icon('more', 22)}</button>
            </div>
            <div class="hero-info">
              <h1>${c.name}</h1>
              <div class="hero-meta">${c.chub ? html`<span class="src-badge">chub.ai</span>` : ''}${c.creator ? html`<span>by ${c.creator}</span>` : ''}${c.character_version ? html`<span>v${c.character_version}</span>` : ''}<span>${c.spec === 'chara_card_v3' ? 'V3' : c.spec === 'chara_card_v2' ? 'V2' : 'V1'} 角色卡</span></div>
              ${c.tags.length ? html`<div class="tag-row">${c.tags.slice(0, 8).map((t) => html`<span class="tag">#${t}</span>`)}</div>` : ''}
            </div>
          </div>

          <div class="facts">
            <div><b>${gs.length}</b><span>序章</span></div>
            <div><b>${TT.ui.bookCount(c)}</b><span>世界書條目</span></div>
            <div><b>${D.sessions.length}</b><span>存檔</span></div>
            <div><b>${endings.length}</b><span>已達結局</span></div>
          </div>

          ${intro ? html`<section class="card-sec">
            <h3 class="sec-title">簡介</h3>
            <div class="intro ${D.expanded ? 'open' : ''}">${raw(TT.mdLite(intro))}</div>
            ${intro.length > 160 ? html`<button class="link-btn" data-act="expand">${D.expanded ? '收起' : '展開全部'}</button>` : ''}
          </section>` : ''}

          <div data-versions>${D.versionsHTML()}</div>

          ${rules ? html`<section class="card-sec">
            <h3 class="sec-title">作者的設定與規則 <small>作者寫給 AI 的提示詞與世界書</small></h3>
            <p class="hint">${rules}</p>
            <button class="btn small" data-act="authornotes">${icon('book', 16)} 查看與開關</button>
          </section>` : ''}

          <section class="card-sec">
            <h3 class="sec-title">選擇序章 <small>${gs.length > 1 ? '左右滑動挑選開場' : ''}</small></h3>
            ${gs.length ? html`<div class="hscroll prologues">${gs.map((g, i) => html`
              <button class="prologue ${i === D.greeting ? 'active' : ''}" data-greeting="${i}">
                <span class="prologue-n">序章 ${i + 1}</span>
                <span class="prologue-text">${TT.truncate(TT.stripHtml(TT.macros.apply(g, mctx)).replace(/[*_]/g, ''), 150)}</span>
                <span class="prologue-more" data-act="preview" data-i="${i}">閱讀全文</span>
              </button>`)}</div>` : html`<p class="muted">這張角色卡沒有開場白，AI 會直接從情境開始。</p>`}
          </section>

          <section class="card-sec">
            <h3 class="sec-title">選擇主角 <small>你在故事裡的身分（{{user}}）</small></h3>
            <div class="hscroll personas">
              ${TT.store.personas.map((p) => html`<button class="persona-chip ${p.id === D.personaId ? 'active' : ''}" data-persona="${p.id}">
                ${TT.ui.avatar({ kind: 'persona', id: p.avatar ? p.id : '', name: p.name, size: 52 })}
                <span>${p.name}</span></button>`)}
              <button class="persona-chip add" data-act="newpersona"><span class="avatar add-av">${icon('plus', 22)}</span><span>新主角</span></button>
            </div>
            ${persona.description ? html`<p class="persona-desc">${TT.truncate(persona.description, 120)} <button class="link-btn" data-act="editpersona">編輯</button></p>` : html`<p class="persona-desc muted">尚未填寫主角設定。<button class="link-btn" data-act="editpersona">編輯主角</button></p>`}
          </section>

          <section class="card-sec" id="sec-saves">
            <h3 class="sec-title">存檔</h3>
            ${D.sessions.length ? html`<div class="save-list">${D.sessions.map((s) => {
              const st = TT.engine.deriveState(s, c, null);
              const turns = s.messages.filter((m) => m.role === 'user').length;
              return html`<div class="save-row" data-sid="${s.id}">
                <button class="save-main" data-act="resume">
                  <b>${s.title}</b>
                  <small>${turns} 回合・${TT.fmtTime(s.updatedAt)}${st.ending ? html` ・<span class="gold">${icon('flag', 12)} ${st.ending}</span>` : ''}</small>
                </button>
                <button class="icon-btn" data-act="savemenu" aria-label="存檔選單">${icon('more', 20)}</button>
              </div>`;
            })}</div>` : html`<p class="muted">還沒有存檔，選好序章與主角後就開始吧。</p>`}
            ${endings.length ? html`<div class="endings"><h4>已收錄結局</h4>${endings.map((e) => html`<span class="ending-chip">${icon('flag', 12)} ${e.title}</span>`)}</div>` : ''}
          </section>

          <section class="card-sec">
            <h3 class="sec-title">畫面設定</h3>
            <label class="field"><span>這個故事的畫風</span>
              <select class="input" data-field="style">${styleOpts.map(([k, l]) => html`<option value="${k}" ${c.style === k ? 'selected' : ''}>${l}</option>`)}</select>
            </label>
            <label class="field"><span>${c.name} 的外貌標籤（英文，讓每張圖的角色長相一致）</span>
              <div class="row"><textarea class="input" rows="2" data-field="appearance" placeholder="1girl, long silver hair, amber eyes, …">${c.appearance || ''}</textarea>
              <button class="btn small" data-act="genapp" title="用 AI 從角色描述產生">${icon('wand', 16)} AI</button></div>
            </label>
          </section>

          <section class="card-sec">
            <h3 class="sec-title">遊玩前設定 <small>不用進入故事也能設定</small></h3>
            <p class="hint">優先指示：${TT.priority.summary({ card: c }) || '還沒有（可以寫要記住的事、劇情走向、輸出方式、禁止事項）'}</p>
            <p class="hint">角色池：${castNames.length ? castNames.join('、') : html`還沒整理（第一次開始故事時會自動整理，或按「AI 整理登場人物」）`}。只有角色池裡的角色有資訊欄。</p>
            ${art ? html`<div class="spm-reuse art-note">${icon('image', 14)}<span>${artDone ? `作者附的圖：${art}` : `這張卡附了作者畫的圖：${art}。匯入後角色會用作者的立繪上台，AI 也會在合適的場面放出插圖。`}</span><button class="btn small ${artDone ? '' : 'primary'}" data-act="authorart">${artDone ? '管理' : '匯入'}</button></div>` : ''}
            <p class="hint">${sprNames.length ? `立繪：${sprNames.length} 個角色、${sprCount} 張` : '還沒有立繪，遊玩時會用角色卡圖片'}・特殊場景圖 ${(c.cgs || []).filter((g) => g.blob).length} 張・背景 ${(c.bgs || []).filter((g) => g.blob).length} 張</p>
            <div class="btn-row wrap">
              <button class="btn small" data-act="priority">${icon('flag', 16)} 優先指示</button>
              <button class="btn small" data-act="sprites" data-tab="chars">${icon('users', 16)} 角色池與立繪</button>
              <button class="btn small" data-act="charimport">${icon('upload', 16)} 匯入其他角色卡的角色</button>
              <button class="btn small" data-act="sprites" data-tab="hero">${icon('user', 16)} 主角</button>
              <button class="btn small" data-act="sprites" data-tab="cgs">${icon('image', 16)} 特殊場景</button>
              <button class="btn small" data-act="sprites" data-tab="bgs">${icon('layers', 16)} 背景</button>
              <button class="btn small" data-act="bgmlib">${icon('music', 16)} 配樂</button>
              <a class="btn small" href="#/assets">${icon('box', 16)} 素材庫</a>
            </div>
          </section>

          <section class="card-sec">
            <h3 class="sec-title">世界書與擴充</h3>
            <div class="kv-list">
              ${c.chub ? html`<div><span>來源</span><b><a href="${c.chub.url}" target="_blank" rel="noopener">chub.ai/${c.chub.fullPath}</a></b></div>` : ''}
              <div><span>內嵌世界書</span><b>${c.book ? `${c.book.name}（${c.book.entries.length} 條）` : '無'}</b></div>
              ${(c.extraBooks || []).map((b, i) => html`<div><span>附加世界書</span><b>${b.name}（${b.entries.length} 條）</b><button class="link-btn danger" data-act="rmbook" data-i="${i}">移除</button></div>`)}
              ${regexCount ? html`<div><span>正則腳本</span><b>${regexCount} 個（本程式不執行，僅保留於匯出）</b></div>` : ''}
              ${c.system_prompt ? html`<div><span>系統提示</span><b>已包含</b><button class="link-btn" data-act="authornotes">查看</button></div>` : ''}
              ${c.post_history_instructions ? html`<div><span>後置指示</span><b>已包含</b><button class="link-btn" data-act="authornotes">查看</button></div>` : ''}
              ${c.extensions && c.extensions.depth_prompt && String(c.extensions.depth_prompt.prompt || '').trim() ? html`<div><span>Character Note</span><b>已包含</b><button class="link-btn" data-act="authornotes">查看</button></div>` : ''}
            </div>
            <button class="btn small" data-act="addbook">${icon('book', 16)} 附加世界書（.json）</button>
          </section>

          <section class="card-sec actions-sec">
            <button class="btn" data-act="edit">${icon('edit', 18)} 編輯角色卡</button>
            <button class="btn" data-act="share" title="角色卡、世界書、立繪與圖、配樂，可以連同存檔一起分享">${icon('download', 18)} 匯出書本（分享）</button>
            <button class="btn" data-act="exportpng">${icon('download', 18)} 匯出 PNG</button>
            <button class="btn" data-act="exportjson">${icon('download', 18)} 匯出 JSON</button>
            <button class="btn danger" data-act="delete">${icon('trash', 18)} 刪除</button>
          </section>
          <div class="cta-spacer"></div>
        </div>
        <div class="detail-cta">
          ${shelved ? '' : html`<button class="btn big" data-act="shelf" title="加入書架">${icon('bookmark', 18)} 加入書架</button>`}
          <button class="btn primary big block" data-act="start">${icon('play', 18)} 開始新故事${gs.length > 1 ? `（序章 ${D.greeting + 1}）` : ''}</button>
        </div>
      </div>`);
      TT.media.hydrate(D.el);
      const scroller = D.el.querySelector('.detail-scroll');
      if (scroller && oldScrollTop > 0) requestAnimationFrame(() => { if (D.el && scroller.isConnected) scroller.scrollTop = oldScrollTop; });
    },

    async onClick(e) {
      const c = D.card;
      const g = e.target.closest('[data-greeting]');
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'preview') {
        e.stopPropagation();
        const i = +a.dataset.i;
        const persona = TT.store.getPersona(D.personaId);
        const text = TT.macros.apply(TT.engine.greetings(c)[i], { char: c.nickname || c.name, user: persona.name, card: c, persona, vars: {} });
        const go = await TT.sheet({ title: `序章 ${i + 1}`, body: html`<div class="prologue-full">${raw(TT.mdLite(TT.stripHtml(text)))}</div>`, actions: [{ label: '關閉', value: false }, { label: '從這裡開始', value: true, primary: true }] });
        if (go) { D.greeting = i; D.start(); }
        return;
      }
      if (g) { D.greeting = +g.dataset.greeting; D.el.querySelectorAll('[data-greeting]').forEach((b) => b.classList.toggle('active', b === g)); D.el.querySelector('[data-act="start"]').innerHTML = TT.icon('play', 18) + ` 開始新故事（序章 ${D.greeting + 1}）`; return; }
      const ver = e.target.closest('[data-ver]');
      if (ver) return D.openVersion(ver.dataset.ver);
      const p = e.target.closest('[data-persona]');
      if (p) { D.personaId = p.dataset.persona; return D.render(); }
      if (!a) return;
      const sid = a.closest('[data-sid]') && a.closest('[data-sid]').dataset.sid;
      switch (a.dataset.act) {
        case 'back': return TT.router.back('/library');
        case 'start': return D.start();
        case 'expand': D.expanded = !D.expanded; return D.render();
        case 'fav':
          c.favorite = !c.favorite;
          await TT.store.saveCard(c);
          return D.render();
        case 'shelf': {
          // 從探索點開的故事預設不在書架，要不要加入由玩家決定
          if (c.shelved === false) {
            c.shelved = true;
            await TT.store.saveCard(c);
            TT.toast(`已加入書架：${c.name}`, { icon: 'check', type: 'ok' });
          } else {
            if (!(await TT.confirm(`把「${c.name}」移出書架？存檔、立繪等素材都會保留，可以從「繼續遊玩」或探索再找到它。`, { okText: '移出書架' }))) return;
            c.shelved = false;
            await TT.store.saveCard(c);
            TT.toast('已移出書架');
          }
          return D.render();
        }
        case 'newpersona': {
          const np = await TT.actions.editPersona(null);
          if (np) D.personaId = np.id;
          return D.render();
        }
        case 'editpersona': {
          await TT.actions.editPersona(TT.store.getPersona(D.personaId));
          if (!TT.store.getPersona(D.personaId)) D.personaId = TT.store.defaultPersona().id;
          return D.render();
        }
        case 'resume': {
          // 點存檔：先看遊玩前設定（優先指示、角色池…），可以在那裡關掉直接進入
          const s = D.sessions.find((x) => x.id === sid);
          if (s) await TT.actions.openSave(s);
          return D.el && TT.router.current === 'detail' && D.render();
        }
        case 'priority':
          await TT.priority.sheet({ card: c, persona: TT.store.getPersona(D.personaId) });
          return D.render();
        case 'bgmlib':
          await TT.bgm.manager({ card: c });
          return D.render();
        case 'authorart':
          await TT.authorArt.sheet(c);
          return D.el && D.render();
        case 'authornotes':
          await TT.authorNotes.sheet(c);
          return D.el && D.render();
        case 'charimport':
          if (await TT.charImport.intoBook(c)) D.render();
          return;
        case 'share': return TT.share.exportSheet(c);
        case 'savemenu': return D.saveMenu(sid);
        case 'genapp': {
          if (!(await TT.actions.ensureLLM())) return;
          a.disabled = true;
          a.innerHTML = TT.icon('wand', 16) + ' 生成中…';
          try {
            c.appearance = await TT.engine.generateAppearance(c.name, [c.description, c.personality].join('\n'));
            await TT.store.saveCard(c);
            TT.toast('已產生外貌標籤，可再手動調整');
          } catch (err) { TT.toast(TT.llm.describeError(err), { type: 'error' }); }
          return D.render();
        }
        case 'addbook': {
          const files = await TT.pickFiles({ accept: '.json,application/json', multiple: true });
          if (files.length) { await TT.actions.importFiles(files, { attachTo: c, navigate: false }); D.render(); }
          return;
        }
        case 'rmbook':
          c.extraBooks.splice(+a.dataset.i, 1);
          await TT.store.saveCard(c);
          return D.render();
        case 'sprites':
          await TT.sprites.manager(c, { tab: a.dataset.tab || 'chars', persona: TT.store.getPersona(D.personaId) });
          return D.el && D.render();
        case 'edit': return TT.router.go('/edit/' + c.id);
        case 'exportpng': TT.download(TT.safeFileName(c.name) + '.png', await TT.card.exportPng(c)); return;
        case 'exportjson': TT.download(TT.safeFileName(c.name) + '.json', TT.card.exportJson(c)); return;
        case 'more': {
          const v = await TT.choose(c.name, [
            ...(c.chub ? [{ label: '在 chub.ai 查看', value: 'chub', icon: 'link' }, { label: '從 chub.ai 下載最新版', value: 'chubupdate', icon: 'refresh', hint: '保留存檔與個人設定' }] : []),
            { label: '編輯角色卡', value: 'edit', icon: 'edit' },
            { label: '更換封面圖片', value: 'cover', icon: 'image' },
            { label: '匯出書本（分享給別人或換電腦）', value: 'share', icon: 'download', hint: '角色卡、世界書、立繪與圖、配樂，可以連同存檔' },
            { label: '匯出為角色卡 PNG', value: 'exportpng', icon: 'download' },
            { label: '刪除這個故事', value: 'delete', icon: 'trash', danger: true },
          ]);
          if (v === 'chub') window.open(c.chub.url, '_blank', 'noopener');
          else if (v === 'chubupdate') {
            TT.toast('正在從 chub.ai 下載…', { icon: 'download' });
            try {
              D.card = await TT.chub.importCard({ fullPath: c.chub.fullPath }, { update: true });
              TT.toast('已更新為 chub.ai 上的最新版本', { icon: 'check', type: 'ok' });
              D.render();
            } catch (err) { TT.toast(TT.llm.describeError(err), { type: 'error' }); }
          } else if (v === 'cover') {
            const [f] = await TT.pickFiles({ accept: 'image/*' });
            if (f) { c.avatar = f.type === 'image/png' ? f : await TT.resizeImageBlob(f, 1536, 'image/png'); c.generatedCover = false; await TT.store.saveCard(c); D.render(); }
          } else if (v === 'edit') TT.router.go('/edit/' + c.id);
          else if (v === 'share') TT.share.exportSheet(c);
          else if (v === 'exportpng') TT.download(TT.safeFileName(c.name) + '.png', await TT.card.exportPng(c));
          else if (v === 'delete') D.remove();
          return;
        }
        case 'delete': return D.remove();
      }
    },

    async onChange(e) {
      const f = e.target.dataset.field;
      if (!f) return;
      D.card[f] = e.target.value;
      await TT.store.saveCard(D.card);
      TT.toast('已儲存');
    },

    async start() {
      const c = D.card;
      await TT.actions.startStory(c, { personaId: D.personaId, greetingIndex: D.greeting });
    },

    async saveMenu(sid) {
      const s = D.sessions.find((x) => x.id === sid);
      if (!s) return;
      const v = await TT.choose(s.title, [
        { label: '繼續遊玩', value: 'go', icon: 'play' },
        { label: '遊玩前設定（優先指示、角色池、主角）', value: 'preplay', icon: 'flag' },
        { label: '重新命名', value: 'rename', icon: 'edit' },
        { label: '匯出遊玩檔案（分享給別人或換電腦）', value: 'share', icon: 'download' },
        { label: '刪除存檔', value: 'del', icon: 'trash', danger: true },
      ]);
      if (v === 'go') TT.router.go('/play/' + sid);
      else if (v === 'share') await TT.share.exportSheet(D.card, { sessionIds: [sid] });
      else if (v === 'preplay') {
        if ((await TT.actions.prePlay(D.card, s)) === 'go') TT.router.go('/play/' + sid);
        else if (D.el && TT.router.current === 'detail') D.render();
      }
      else if (v === 'rename') {
        const t = await TT.promptText('存檔名稱', s.title);
        if (t && t.trim()) { s.title = t.trim(); await TT.store.saveSession(s, true); D.render(); }
      } else if (v === 'del') {
        if (!(await TT.confirm(`刪除存檔「${s.title}」？場景圖也會一併刪除。`, { danger: true, okText: '刪除' }))) return;
        await TT.store.deleteSession(sid);
        D.sessions = await TT.store.sessionsForCard(D.card.id);
        D.render();
      }
    },

    // 其他版本：作者的同名書（最新的標出來），別人轉載的相同內容收在後面
    versionsHTML() {
      const v = D.versions;
      if (!v || !v.list.length) return '';
      const day = (t) => (t ? new Date(t).toLocaleDateString() : '');
      const row = (x) => html`<button class="ver-row" data-ver="${x.fullPath}">
          <span class="ver-main"><b>${x.name}</b><small>${x.author ? '' : `by ${x.creator}・`}${day(x.createdAt)} 上架${x.updatedAt && day(x.updatedAt) !== day(x.createdAt) ? `・${day(x.updatedAt)} 更新` : ''}・★${x.stars}${TT.chub.findLocal(x.fullPath) ? '・已下載' : ''}</small></span>
          ${x.newest ? html`<span class="ver-tag">最新</span>` : ''}${icon('forward', 16)}</button>`;
      const mine = v.list.filter((x) => x.author);
      const copies = v.list.filter((x) => !x.author);
      return html`<section class="card-sec versions">
        <h3 class="sec-title">其他版本 <small>同一個作者在 chub.ai 上傳的同名書</small></h3>
        ${v.newer.length
          ? html`<div class="spm-reuse ver-note">${icon('info', 14)}<span>作者有比這本（${day(v.self.createdAt)} 上架）新的版本，內容可能有更新</span></div>`
          : html`<p class="hint">這本是 ${day(v.self.createdAt)} 上架的，已經是作者最新的一本。</p>`}
        ${mine.map(row)}
        ${copies.length ? html`<details class="ver-copies"><summary>其他人上傳的相同內容（${copies.length}）</summary>${copies.map(row)}</details>` : ''}
      </section>`;
    },

    fillVersions() {
      const box = D.el && D.el.querySelector('[data-versions]');
      if (box) box.innerHTML = String(D.versionsHTML());
    },

    async openVersion(fullPath) {
      const local = TT.chub.findLocal(fullPath);
      if (local) return TT.router.go('/card/' + local.id);
      TT.toast('正在從 chub.ai 讀取…', { icon: 'download' });
      try {
        const card = await TT.chub.importCard({ fullPath }, { shelve: false });
        TT.router.go('/card/' + card.id);
      } catch (err) { TT.toast(TT.llm.describeError(err), { type: 'error', duration: 5000 }); }
    },

    async remove() {
      const c = D.card;
      const assets = TT.store.hasAssets(c) ? '、立繪與特殊場景圖（可先到「立繪與特殊場景圖」匯出素材包）' : '';
      if (!(await TT.confirm(`刪除「${c.name}」以及它的 ${D.sessions.length} 個存檔${assets}？此動作無法復原。`, { danger: true, okText: '刪除' }))) return;
      await TT.store.deleteCard(c.id);
      TT.toast('已刪除');
      TT.router.back('/library');
    },
  });
})();
