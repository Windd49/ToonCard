/* 生成工作列：所有進行中的生成（劇情、立繪、特殊場景圖、背景、場景圖）都可以在這裡暫停、繼續或停止；
 * 下面列出最近的生成結果：畫好了、或為什麼沒畫出來（審查原因與模型的回覆），由使用者決定要不要修改後重試 */
(function () {
  'use strict';
  const TT = window.TT;
  const html = TT.html;
  const raw = TT.raw;
  const icon = (n, s) => raw(TT.icon(n, s));
  const STATUS = { running: '生成中', queued: '排隊中', pausing: '畫完這張後暫停', paused: '已暫停', stopping: '停止中' };

  function list() {
    const out = [];
    const g = TT.engine.gen;
    if (g) out.push({ key: 'text', kind: 'text', label: '劇情生成', sub: g.cardName || '', status: g.paused ? 'stopping' : 'running', sessionId: g.sessionId, done: 0, total: 1 });
    return out.concat(TT.img.tasks());
  }

  // 正在看的那個故事的劇情生成，畫面上已經有暫停鍵，工作列就不重複顯示
  const visible = () => list().filter((t) => !(t.kind === 'text' && TT.router.current === 'play' && TT.views.play.ctx && TT.views.play.ctx.session.id === t.sessionId));
  // 還沒看過的失敗結果
  let unseenFails = 0;

  let btn = null;
  let sheet = null;
  function render() {
    const shown = visible();
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'task-tray';
      btn.addEventListener('click', open);
      document.body.appendChild(btn);
    }
    btn.hidden = !shown.length && !unseenFails;
    btn.classList.toggle('fail', !shown.length && unseenFails > 0);
    if (shown.length) {
      const paused = shown.every((t) => t.status === 'paused');
      btn.innerHTML = `${paused ? TT.icon('pause', 14) : '<span class="spinner"></span>'}<span>${paused ? '已暫停' : '生成中'}・${shown.length}</span>${unseenFails ? `<b class="tray-fail">${unseenFails}</b>` : ''}`;
      btn.title = shown.map((t) => `${t.label}（${STATUS[t.status] || ''}）`).join('\n');
    } else if (unseenFails) {
      btn.innerHTML = `${TT.icon('alert', 14)}<span>${unseenFails} 項沒完成</span>`;
      btn.title = '點開看原因，可以修改後重試';
    }
    if (sheet) renderSheet();
  }

  function rowHTML(t) {
    const prog = t.total > 1 ? ` ${t.done}/${t.total}` : '';
    const paused = t.status === 'paused' || t.status === 'pausing';
    return html`<div class="task-row" data-key="${t.key}">
      <div class="task-main"><b>${t.label}</b><small>${t.sub ? `${t.sub}・` : ''}${STATUS[t.status] || ''}${prog}${t.cur ? `・${t.cur}` : ''}</small></div>
      ${t.kind === 'text'
        ? html`<button class="btn small" data-task="goto">前往</button><button class="btn small" data-task="pause" ${t.status === 'stopping' ? 'disabled' : ''}>${icon('pause', 14)} 暫停</button>`
        : html`${paused ? html`<button class="btn small" data-task="resume">${icon('play', 14)} 繼續</button>` : html`<button class="btn small" data-task="pause" ${t.status === 'stopping' ? 'disabled' : ''}>${icon('pause', 14)} 暫停</button>`}
          <button class="btn small danger" data-task="stop" ${t.status === 'stopping' ? 'disabled' : ''}>${icon('stop', 14)} 停止</button>`}
    </div>`;
  }

  function reportHTML(r, i) {
    return html`<div class="task-report ${r.ok ? 'ok' : 'fail'}">
      <span class="tr-ic">${icon(r.ok ? 'check' : 'alert', 15)}</span>
      <div class="task-main"><b>${r.label}</b><small>${r.ok ? r.okText || `畫好了${r.text ? `。模型回覆：「${TT.truncate(r.text, 120)}」` : ''}` : r.error}</small></div>
      ${!r.ok && r.retry ? html`<button class="btn small" data-retry="${i}">${icon('refresh', 14)} ${r.retryLabel || '修改後重試'}</button>` : ''}
    </div>`;
  }

  function renderSheet() {
    const box = sheet && sheet.el && sheet.el.querySelector('[data-tasks]');
    if (!box) return;
    const items = list();
    box.innerHTML = items.length ? items.map((t) => String(rowHTML(t))).join('') : '<p class="muted center">目前沒有進行中的生成</p>';
    const rep = sheet.el.querySelector('[data-reports]');
    const rs = TT.img.reports;
    rep.innerHTML = rs.length ? rs.map((r, i) => String(reportHTML(r, i))).join('') : '<p class="muted">還沒有生成結果</p>';
  }

  function onClick(e) {
    const rb = e.target.closest('[data-retry]');
    if (rb) {
      const r = TT.img.reports[+rb.dataset.retry];
      if (r && r.retry) { sheet.close(); r.retry(r); }
      return;
    }
    const b = e.target.closest('[data-task]');
    if (!b) return;
    const act = b.dataset.task;
    if (act === 'pauseall') { if (TT.engine.gen) TT.engine.pause(); return TT.img.pauseAll(); }
    if (act === 'resumeall') return TT.img.resumeAll();
    if (act === 'stopall') { if (TT.engine.gen) TT.engine.pause(); return TT.img.cancelAll(); }
    const row = b.closest('[data-key]');
    const t = row && list().find((x) => x.key === row.dataset.key);
    if (!t) return;
    if (t.kind === 'text') {
      if (act === 'pause') TT.engine.pause();
      if (act === 'goto') { sheet.close(); TT.router.go('/play/' + t.sessionId); }
      return;
    }
    if (act === 'pause') TT.img.pauseJob(t.job);
    if (act === 'resume') TT.img.resumeJob(t.job);
    if (act === 'stop') TT.img.cancelJob(t.job);
  }

  function open() {
    unseenFails = 0;
    sheet = TT.sheet({
      title: '生成工作',
      body: html`<div class="task-list" data-tasks></div>
        <div class="btn-row wrap"><button class="btn small" data-task="pauseall">${icon('pause', 14)} 全部暫停</button><button class="btn small" data-task="resumeall">${icon('play', 14)} 全部繼續</button><button class="btn small danger" data-task="stopall">${icon('stop', 14)} 全部停止</button></div>
        <p class="hint">暫停：劇情保留已寫好的部分，之後按「繼續生成」接著寫；圖片畫完目前這張就停下，按「繼續」再往下畫。停止：放棄剩下還沒畫的。</p>
        <h4 class="sec-title">最近的生成結果</h4>
        <div class="task-reports" data-reports></div>
        <p class="hint">沒畫出來時會寫出原因（例如圖片安全審查 IMAGE_SAFETY）與模型的回覆，不會自動重試；可以按「修改後重試」改畫法（或用「改寫成含蓄的畫法」）再畫一次。</p>`,
      actions: [{ label: '關閉', primary: true }],
      onMount: (el) => { el.addEventListener('click', onClick); },
    });
    renderSheet();
    sheet.then(() => { sheet = null; render(); });
    render();
  }

  // 沒畫出來：馬上告訴使用者原因
  TT.bus.on('img:report', (r) => {
    if (!r.ok) {
      unseenFails++;
      TT.toast(r.failText || `沒有畫出「${r.label}」：${TT.truncate(String(r.error || '').replace(/^沒有畫出圖片：/, ''), 90)}（點「生成工作」可以修改後重試）`, { type: 'error', duration: 7000 });
    }
    setTimeout(render, 0);
  });

  const soon = () => setTimeout(render, 0);
  ['tasks:changed', 'gen:start', 'gen:end', 'gen:status', 'img:update'].forEach((evt) => TT.bus.on(evt, soon));
  window.addEventListener('hashchange', () => setTimeout(render, 50));

  TT.tasks = { list, render, open };
})();
