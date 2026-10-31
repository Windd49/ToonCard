/* SillyTavern 巨集：{{char}}、{{user}}、{{random}}、{{roll}}、{{getvar}} … */
(function () {
  'use strict';
  const TT = window.TT;
  const TRIM = '\u0000TRIM\u0000';
  const pad = (n) => String(n).padStart(2, '0');

  function rollDice(spec) {
    const s = spec.trim().toLowerCase();
    const m = s.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/);
    if (m) {
      const n = Math.min(100, +(m[1] || 1));
      const sides = Math.max(1, +m[2]);
      let total = 0;
      for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * sides);
      return String(total + (m[3] ? +m[3].replace(/\s/g, '') : 0));
    }
    if (/^\d+$/.test(s)) return String(1 + Math.floor(Math.random() * Math.max(1, +s)));
    return '';
  }

  function splitOptions(rest) {
    return (rest.includes('::') ? rest.split('::') : rest.split(/(?<!\\),/)).map((x) => x.replace(/\\,/g, ',').trim());
  }

  function fmtDate(d, f) {
    return f
      .replace(/YYYY/g, d.getFullYear())
      .replace(/MM/g, pad(d.getMonth() + 1))
      .replace(/DD/g, pad(d.getDate()))
      .replace(/HH/g, pad(d.getHours()))
      .replace(/mm/g, pad(d.getMinutes()))
      .replace(/ss/g, pad(d.getSeconds()));
  }

  function varOp(store, op, name, value) {
    name = name.trim();
    const cur = store[name];
    switch (op) {
      case 'get': return cur == null ? '' : String(cur);
      case 'set': store[name] = value; return '';
      case 'add': {
        const a = parseFloat(cur);
        const b = parseFloat(value);
        store[name] = !isNaN(a) && !isNaN(b) && String(+value) === String(value).trim() ? a + b : (cur == null ? '' : String(cur)) + value;
        return '';
      }
      case 'inc': store[name] = (parseFloat(cur) || 0) + 1; return String(store[name]);
      case 'dec': store[name] = (parseFloat(cur) || 0) - 1; return String(store[name]);
    }
    return '';
  }

  function evalMacro(body, ctx) {
    const raw = body.trim();
    const key = raw.toLowerCase();
    const card = ctx.card || {};
    const persona = ctx.persona || {};
    const now = new Date();
    switch (key) {
      case 'char': case 'charifnotgroup': case 'group': case 'bot': case 'groupnotmuted': return ctx.char || '';
      case 'user': return ctx.user || '';
      case 'description': case 'chardescription': return card.description || '';
      case 'personality': case 'charpersonality': return card.personality || '';
      case 'scenario': case 'charscenario': return card.scenario || '';
      case 'persona': return persona.description || '';
      case 'mesexamples': case 'mesexamplesraw': return card.mes_example || '';
      case 'charprompt': return card.system_prompt || '';
      case 'charjailbreak': case 'charinstruction': return card.post_history_instructions || '';
      case 'charversion': case 'char_version': return card.character_version || '';
      case 'charfirstmessage': return card.first_mes || '';
      case 'model': return ctx.model || '';
      case 'original': return ctx.original || '';
      case 'input': return ctx.input || '';
      case 'newline': return '\n';
      case 'trim': return TRIM;
      case 'noop': case '': return '';
      case 'time': return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      case 'date': return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
      case 'weekday': return now.toLocaleDateString('zh-TW', { weekday: 'long' });
      case 'isotime': return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      case 'isodate': return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      case 'idle_duration': return '片刻';
      case 'lastmessage': return ctx.lastMessage || '';
      case 'lastusermessage': return ctx.lastUserMessage || '';
      case 'lastcharmessage': return ctx.lastCharMessage || '';
      case 'lastmessageid': return ctx.lastMessageId != null ? String(ctx.lastMessageId) : '';
      case 'maxprompt': return String((TT.settings.llm || {}).contextSize || '');
    }
    let m;
    if ((m = raw.match(/^random\s*(?:::|:)\s*([\s\S]*)$/i))) {
      const opts = splitOptions(m[1]);
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : '';
    }
    if ((m = raw.match(/^pick\s*(?:::|:)\s*([\s\S]*)$/i))) {
      const opts = splitOptions(m[1]);
      return opts.length ? opts[TT.hashStr((ctx.seed || '') + raw) % opts.length] : '';
    }
    if ((m = raw.match(/^roll\s*(?:::|:|\s)\s*(.+)$/i))) return rollDice(m[1]);
    if ((m = raw.match(/^reverse\s*(?:::|:)\s*([\s\S]*)$/i))) return Array.from(m[1]).reverse().join('');
    if ((m = raw.match(/^datetimeformat\s+(.+)$/i))) return fmtDate(now, m[1]);
    if ((m = raw.match(/^time_utc\s*([+-]\d+)$/i))) {
      const d = new Date(now.getTime() + now.getTimezoneOffset() * 60e3 + +m[1] * 3600e3);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (/^banned\s/i.test(raw)) return '';
    if ((m = raw.match(/^(get|set|add|inc|dec)(global)?var::([^:]+?)(?:::([\s\S]*))?$/i))) {
      const store = m[2] ? (TT.settings.globalVars = TT.settings.globalVars || {}) : ctx.vars || (ctx.vars = {});
      const r = varOp(store, m[1].toLowerCase(), m[3], m[4] == null ? '' : m[4]);
      if (m[2] && m[1].toLowerCase() !== 'get') TT.saveSettings();
      return r;
    }
    return null;
  }

  // ctx: { char, user, card, persona, vars, original, lastMessage, … }
  function apply(text, ctx = {}) {
    if (text == null || text === '') return '';
    let s = String(text);
    s = s.replace(/<USER>/gi, ctx.user || '').replace(/<BOT>|<CHAR>/gi, ctx.char || '');
    s = s.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      s = s.replace(/\{\{([^{}]*)\}\}/g, (all, body) => {
        const r = evalMacro(body, ctx);
        if (r === null) return all;
        changed = true;
        return r;
      });
      if (!changed) break;
    }
    if (s.includes(TRIM)) s = s.replace(new RegExp('\\s*' + TRIM + '\\s*', 'g'), '');
    return s;
  }

  TT.macros = { apply };
})();
