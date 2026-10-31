/* 分鏡腳本解析：把模型輸出（可串流）轉成畫面元素 beats
 * beat 類型：scene / narr / say / think / sfx / stat / choice / cast / cg / end / extra
 */
(function () {
  'use strict';
  const TT = window.TT;

  const ALIASES = {
    scene: ['SCENE', 'PANEL', '場景', '场景', '畫面', '画面', '分鏡', '分镜'],
    narr: ['NARR', 'NARRATION', 'NARRATOR', '旁白', '敘述', '叙述', '描寫', '描写'],
    say: ['SAY', 'DIALOG', 'DIALOGUE', 'SPEAK', '對話', '对话', '台詞', '台词', '說', '说'],
    think: ['THINK', 'THOUGHT', '心聲', '心声', '內心', '内心', '獨白', '独白'],
    sfx: ['SFX', 'SOUND', '音效', '擬聲', '拟声'],
    stat: ['STAT', 'STATS', '數值', '数值'],
    choice: ['CHOICE', 'CHOICES', 'OPTION', 'OPTIONS', '選項', '选项', '抉擇', '抉择'],
    cast: ['CAST', '登場', '登场'],
    cg: ['CG', 'EVENTCG', '特殊場景', '特殊场景', '事件圖', '事件图'],
    bg: ['BG', 'BACKGROUND', '背景'],
    bgm: ['BGM', 'MUSIC', '配樂', '音樂', '背景音樂'],
    end: ['END', 'ENDING', '結局', '结局'],
  };
  const LOOKUP = {};
  for (const [t, list] of Object.entries(ALIASES)) list.forEach((a) => (LOOKUP[a.toUpperCase()] = t));

  const LINE_RE = /^\s*[\[【［]([^\]】］\n]{1,80})[\]】］]\s*(.*)$/;
  const INNER_RE = /^\s*([A-Za-z]+|[一-鿿]{1,4})\s*(?:[:：\s]\s*([\s\S]*))?$/;
  const SPLIT_TAGS = /(?=[\[【［](?:SCENE|NARR|SAY|THINK|SFX|STAT|CHOICE|CAST|CG|BGM|BG|END)\b)/i;
  // 這些 XML 外層標籤只是包裝正文，直接忽略標籤本身
  const TRANSPARENT = /^(content|正文|story|reply|response|output|main|text|roleplay|rp|message|body|answer|回覆|回复|劇情|剧情|narrative|novel)$/i;
  const INLINE_HTML = /^(br|hr|img|b|i|u|em|strong|span|p|div|font|small|big|ruby|rt|a)$/i;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const stripQuotes = (s) => {
    s = String(s || '').trim().replace(/^[:：]\s*/, '');
    const m = s.match(/^[「“"『]([\s\S]*)[」”"』]$/);
    return (m ? m[1] : s).trim();
  };

  function splitNameEmo(arg) {
    const [name, emo] = String(arg || '').split(/[|｜]/);
    return [(name || '').trim(), (emo || '').trim()];
  }

  function splitScene(content) {
    for (const sep of ['##', '||', '｜｜', ' | ', '｜']) {
      const i = content.indexOf(sep);
      if (i >= 0) return [content.slice(0, i).trim(), content.slice(i + sep.length).trim()];
    }
    const m = content.match(/^(.*?)[（(]\s*(?:prompt|image prompt|提示詞|提示词)\s*[:：]\s*(.+?)[）)]\s*$/i);
    if (m) return [m[1].trim(), m[2].trim()];
    return [content.trim(), ''];
  }

  function splitChoices(s) {
    return String(s || '')
      .split(/\s*(?:\|\||｜｜|\||｜)\s*/)
      .map((x) => x.replace(/^\s*(?:\d+[.、)）:：]|[①②③④⑤⑥⑦⑧⑨]|[A-Ea-e][.、)）])\s*/, '').trim())
      .map(stripQuotes)
      .filter(Boolean);
  }

  // 「好感度 = +5」這種寫法：等號後面帶正負號的數字當成增減
  const signed = (v) => {
    const m = String(v).match(/^([+\-＋－])\s*(\d+(?:\.\d+)?)$/);
    return m && { op: /[-－]/.test(m[1]) ? '-' : '+', value: +m[2] };
  };

  // [STAT] 好感度 +5／[STAT:好感度] +5／[STAT:角色名] 關係 = 同門長兄（角色專屬狀態）
  function parseStats(arg, content) {
    const c = String(content || '').trim();
    if (arg && c && !/^[+\-＋－=＝:：]/.test(c)) {
      const m = c.match(/^(.+?)\s*(?:[=＝:：]\s*([\s\S]+)|([+\-＋－])\s*(\d+(?:\.\d+)?))\s*$/);
      if (m) {
        const name = m[1].trim();
        if (m[2] != null) {
          const v = m[2].trim();
          const d = signed(v);
          if (d) return [{ t: 'stat', who: arg.trim(), name, ...d }];
          return [{ t: 'stat', who: arg.trim(), name, op: '=', value: /^-?\d+(?:\.\d+)?$/.test(v) ? +v : v }];
        }
        return [{ t: 'stat', who: arg.trim(), name, op: /[-－]/.test(m[3]) ? '-' : '+', value: +m[4] }];
      }
    }
    const src = [arg, content].filter(Boolean).join(' ');
    const out = [];
    for (const part of src.split(/[，,；;]|\s{2,}/)) {
      const p = part.trim();
      if (!p) continue;
      let m = p.match(/^(.+?)\s*[:：=＝]?\s*([+\-＋－])\s*(\d+(?:\.\d+)?)\s*(.*)$/);
      if (m) { out.push({ t: 'stat', name: m[1].trim(), op: /[-－]/.test(m[2]) ? '-' : '+', value: +m[3], note: m[4].replace(/^[（(]|[）)]$/g, '').trim() }); continue; }
      m = p.match(/^(.+?)\s*[:：=＝]\s*(.+)$/);
      if (m) {
        const v = m[2].trim();
        const d = signed(v);
        if (d) { out.push({ t: 'stat', name: m[1].trim(), ...d }); continue; }
        const n = v.match(/^(-?\d+(?:\.\d+)?)/);
        out.push({ t: 'stat', name: m[1].trim(), op: '=', value: n ? +n[1] : v });
      }
    }
    return out;
  }

  // 一般散文（未加標籤）→ 旁白 / 台詞
  function parseProse(line, opts = {}) {
    const out = [];
    const s = String(line || '').trim();
    if (!s) return out;
    const known = opts.knownNames || new Set();
    const def = opts.defaultSpeaker || '';
    let m = s.match(/^([^\s「」“”"『』:：*]{1,16})\s*[:：]\s*[「“"『]([^「」“”"『』]+)[」”"』]\s*$/);
    if (m) return [{ t: 'say', name: m[1], text: m[2].trim() }];
    m = s.match(/^([^\s:：*]{1,12})\s*[:：]\s*(.+)$/);
    if (m && known.has(m[1])) return [{ t: 'say', name: m[1], text: stripQuotes(m[2]) }];
    const re = /「([^」]*)」|“([^”]*)”|"([^"]*)"|『([^』]*)』|\*([^*]+)\*/g;
    let last = 0;
    let mm;
    while ((mm = re.exec(s))) {
      let before = s.slice(last, mm.index).trim();
      let speaker = '';
      const lead = before.match(/^(.*?)([^\s，。！？,.!?:：]{1,12})\s*[:：]$/);
      if (lead) {
        const cand = lead[2];
        if (known.has(cand)) { speaker = cand; before = lead[1].trim(); }
        else if (!lead[1] && cand.length <= 8 && !/[說说道問问喊叫笑答嘆叹吼唸念語语]$/.test(cand)) { speaker = cand; before = ''; }
      }
      before = before.replace(/[:：]\s*$/, '');
      if (before) out.push({ t: 'narr', text: before });
      if (mm[5] != null) {
        const a = mm[5].trim();
        if (a) out.push({ t: 'narr', text: a, action: true });
      } else {
        const q = (mm[1] != null ? mm[1] : mm[2] != null ? mm[2] : mm[3] != null ? mm[3] : mm[4] || '').trim();
        if (q) {
          if (!speaker) {
            for (const n of known) if (n && before.includes(n)) speaker = n;
          }
          out.push({ t: 'say', name: speaker || def, text: q });
        }
      }
      last = re.lastIndex;
    }
    const rest = s.slice(last).trim();
    if (rest) out.push({ t: 'narr', text: rest });
    return out;
  }

  // 串流解析器
  function createStream(opts = {}) {
    const beats = [];
    let buf = '';
    let inThink = false;
    let block = null; // 捕捉中的 <tag> … </tag>
    let awaiting = null; // 標籤後內容在下一行的元素
    let pendingChoice = null;
    let choiceMode = false;

    const emit = (b) => {
      beats.push(b);
      if (opts.onBeat) opts.onBeat(b, beats.length - 1);
    };
    const flushChoice = () => {
      if (pendingChoice && pendingChoice.options.length) emit(pendingChoice);
      pendingChoice = null;
      choiceMode = false;
    };
    const flushBlock = () => {
      if (block) {
        const text = block.lines.join('\n').trim();
        if (text) emit({ t: 'extra', tag: block.tag, text });
      }
      block = null;
    };

    function handleTag(type, arg, content) {
      awaiting = null;
      if (type !== 'choice') flushChoice();
      switch (type) {
        case 'scene': {
          // [SCENE:背景名] 描述：背景名對應作品的背景圖
          const bg = content && arg ? stripQuotes(arg) : '';
          const [text, prompt] = splitScene(content || arg || '');
          if (!text && !prompt) awaiting = { t: 'scene', text: '', prompt: '', ...(bg ? { bg } : {}) };
          else emit({ t: 'scene', text, prompt, ...(bg ? { bg } : {}) });
          break;
        }
        case 'narr':
          if (content) emit({ t: 'narr', text: stripQuotes(content) });
          else awaiting = { t: 'narr', text: '' };
          break;
        case 'say':
        case 'think': {
          const [name, emo] = splitNameEmo(arg);
          const b = { t: type, name: name || opts.defaultSpeaker || '', emo, text: '' };
          if (content) { b.text = stripQuotes(content); emit(b); } else awaiting = b;
          break;
        }
        case 'sfx': {
          // [SFX:音效名] 擬聲詞／[SFX] 擬聲詞：音效名用來從音效庫挑音檔
          const name = content ? stripQuotes(arg || '') : '';
          const t = stripQuotes(content || arg);
          if (t) emit({ t: 'sfx', name, text: t });
          break;
        }
        case 'stat':
          parseStats(arg, content).forEach(emit);
          break;
        case 'choice':
          if (!pendingChoice) pendingChoice = { t: 'choice', options: [] };
          pendingChoice.options.push(...splitChoices(content || arg));
          choiceMode = true;
          break;
        case 'cast': {
          let name = arg;
          let tags = content;
          if (!name) {
            const m = (content || '').match(/^([^:：]{1,24})[:：]\s*(.+)$/);
            if (m) { name = m[1].trim(); tags = m[2].trim(); }
          }
          const [n] = splitNameEmo(name);
          if (n && tags) emit({ t: 'cast', name: n, tags: tags.trim() });
          break;
        }
        case 'cg': {
          // [CG:名稱] 顯示特殊場景圖；[CG:off] 收起
          const n = stripQuotes(arg || content || '');
          emit({ t: 'cg', name: /^(off|none|end|stop|關閉|关闭|結束|结束|無|无)$/i.test(n) ? '' : n });
          break;
        }
        case 'bg': {
          // [BG:背景名] 換成作品的背景圖
          const n = stripQuotes(arg || content || '');
          if (n) emit({ t: 'bg', name: n });
          break;
        }
        case 'bgm': {
          // [BGM:名稱] 換配樂；[BGM:off] 停止
          const n = stripQuotes(arg || content || '');
          emit({ t: 'bgm', name: /^(off|none|stop|end|關閉|关闭|停止|無|无|安靜|安静)$/i.test(n) ? '' : n });
          break;
        }
        case 'end': {
          const title = (content || arg || '').replace(/^(結局|结局|ending)\s*[:：]\s*/i, '').replace(/^[「『]|[」』]$/g, '').trim();
          emit({ t: 'end', title: title || '劇終' });
          break;
        }
      }
    }

    function handleLine(line) {
      // 去除 <think> 推理區塊
      if (inThink) {
        const k = line.search(/<\/think(?:ing)?>/i);
        if (k < 0) return;
        inThink = false;
        line = line.slice(k).replace(/<\/think(?:ing)?>/i, '');
      }
      const t0 = line.search(/<think(?:ing)?>/i);
      if (t0 >= 0) {
        const before = line.slice(0, t0);
        const after = line.slice(t0).replace(/<think(?:ing)?>/i, '');
        const e = after.search(/<\/think(?:ing)?>/i);
        if (e >= 0) line = before + after.slice(e).replace(/<\/think(?:ing)?>/i, '');
        else { inThink = true; line = before; }
      }
      if (/^\s*```/.test(line)) return;
      let s = line.trim();
      if (!s) return;
      if (/^<!--.*-->$/.test(s)) return;

      if (block) {
        const close = new RegExp('</' + escRe(block.tag) + '\\s*>', 'i');
        const ci = s.search(close);
        if (ci < 0) { block.lines.push(s); return; }
        block.lines.push(s.slice(0, ci));
        flushBlock();
        s = s.slice(ci).replace(close, '').trim();
        if (!s) return;
      }
      if (/^<\/[^>]+>$/.test(s)) return;
      const om = s.match(/^<([A-Za-z_一-鿿][\w一-鿿.-]*)(?:\s[^>]*)?>([\s\S]*)$/);
      if (om && !INLINE_HTML.test(om[1])) {
        const tag = om[1];
        let rest = om[2];
        const close = new RegExp('</' + escRe(tag) + '\\s*>', 'i');
        if (TRANSPARENT.test(tag)) {
          rest = rest.replace(close, '').trim();
          if (rest) handleLine(rest);
          return;
        }
        const ci = rest.search(close);
        if (ci >= 0) {
          const text = rest.slice(0, ci).trim();
          if (text) emit({ t: 'extra', tag, text });
          const after = rest.slice(ci).replace(close, '').trim();
          if (after) handleLine(after);
        } else {
          block = { tag, lines: rest.trim() ? [rest.trim()] : [] };
        }
        return;
      }

      const parts = s.split(SPLIT_TAGS).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) { parts.forEach(handleLine); return; }

      const tm = s.match(LINE_RE);
      if (tm) {
        const inner = tm[1].trim();
        const content = tm[2].trim();
        const im = inner.match(INNER_RE);
        const type = im && LOOKUP[im[1].toUpperCase()];
        if (type) { handleTag(type, (im[2] || '').trim(), content); return; }
        // [角色名] 台詞
        if (content && inner.length <= 24 && !/[。，！？.!?…]$/.test(inner)) { handleTag('say', inner, content); return; }
      }

      // 未加標籤的行
      if (awaiting) {
        const b = awaiting;
        awaiting = null;
        if (b.t === 'scene') {
          const [text, prompt] = splitScene(s);
          b.text = text; b.prompt = prompt;
        } else b.text = stripQuotes(s);
        emit(b);
        return;
      }
      if (choiceMode && pendingChoice) {
        const cm = s.match(/^\s*(?:\d+[.、)）:：]|[-*•・]|[①②③④⑤⑥⑦⑧⑨]|[A-Ea-e][.、)）])\s*(.+)$/);
        if (cm) { pendingChoice.options.push(...splitChoices(cm[1])); return; }
        flushChoice();
      }
      const last = beats[beats.length - 1];
      const pm = s.match(/^(?:prompt|image prompt|提示詞|提示词)\s*[:：]\s*(.+)$/i);
      if (pm && last && last.t === 'scene' && !last.prompt) { last.prompt = pm[1].trim(); return; }
      parseProse(s, opts).forEach(emit);
    }

    return {
      beats,
      feed(chunk) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          handleLine(line);
        }
      },
      // dropPartial：暫停時丟掉還沒寫完的最後一行
      finish(dropPartial = false) {
        if (buf && !dropPartial) handleLine(buf);
        buf = '';
        flushBlock();
        if (awaiting && awaiting.t !== 'scene' && awaiting.text) emit(awaiting);
        awaiting = null;
        flushChoice();
        return beats;
      },
      partial: () => (inThink ? '' : buf),
      thinking: () => inThink,
    };
  }

  function parseAll(text, opts) {
    const p = createStream(opts);
    p.feed(String(text || '') + '\n');
    return p.finish();
  }

  // 玩家輸入：沒有引號/星號時整句視為台詞
  function parseUserInput(text, userName) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      if (!/[「“"『*]/.test(s)) { out.push({ t: 'say', name: userName, text: s }); continue; }
      for (const b of parseProse(s, { defaultSpeaker: userName })) {
        if (b.t === 'say') b.name = userName;
        else b.action = true;
        out.push(b);
      }
    }
    return out;
  }

  // beats → 純文字（小說、摘要、匯出用）
  function beatsToProse(beats, { withScene = true } = {}) {
    const lines = [];
    for (const b of beats || []) {
      switch (b.t) {
        case 'scene': if (withScene && b.text) lines.push(`（${b.text}）`); break;
        case 'narr': lines.push(b.action ? `*${b.text}*` : b.text); break;
        case 'say': lines.push(`${b.name}：「${b.text}」`); break;
        case 'think': lines.push(`${b.name}（心想）：${b.text}`); break;
        case 'sfx': lines.push(`【${b.text}】`); break;
        case 'end': lines.push(`【結局：${b.title}】`); break;
      }
    }
    return lines.join('\n');
  }

  TT.parser = { createStream, parseAll, parseProse, parseUserInput, beatsToProse, stripQuotes };
})();
