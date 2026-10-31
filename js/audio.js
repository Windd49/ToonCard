/* 聲音：文字轉語音（瀏覽器內建）與語音輸入 */
(function () {
  'use strict';
  const TT = window.TT;
  const synth = window.speechSynthesis;
  let voicesCache = [];

  function loadVoices() {
    if (!synth) return [];
    voicesCache = synth.getVoices();
    return voicesCache;
  }
  if (synth) {
    loadVoices();
    synth.addEventListener && synth.addEventListener('voiceschanged', loadVoices);
  }

  const langCode = () => ({ 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN', en: 'en-US', ja: 'ja-JP' }[TT.settings.story.language] || 'zh-TW');

  function pickVoice(uri) {
    const vs = voicesCache.length ? voicesCache : loadVoices();
    if (uri) { const v = vs.find((x) => x.voiceURI === uri); if (v) return v; }
    const lang = langCode().toLowerCase();
    return vs.find((v) => v.lang.toLowerCase() === lang) || vs.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || null;
  }

  let current = null;
  const tts = {
    supported: !!synth,
    voices: () => (voicesCache.length ? voicesCache : loadVoices()),
    // 依說話者決定聲音；配角未指定時以音高區分
    voiceFor(beat, ctx) {
      const a = TT.settings.audio;
      if (beat.t === 'narr' || beat.t === 'scene' || beat.t === 'sfx') return { uri: a.narratorVoice, pitch: 1 };
      const ov = (ctx.session.castOverrides || {})[beat.name] || {};
      if (ov.voice) return { uri: ov.voice, pitch: ov.pitch || 1 };
      const isUser = ctx.persona && beat.name === ctx.persona.name;
      const isChar = ctx.card && (beat.name === ctx.card.name || beat.name === ctx.card.nickname);
      const pitch = isChar || isUser ? 1 : 0.85 + (TT.hashStr(beat.name) % 40) / 100;
      return { uri: a.charVoice, pitch };
    },
    speak(text, { uri, pitch = 1, rate } = {}) {
      return new Promise((resolve) => {
        if (!synth || !text) return resolve();
        synth.cancel();
        const u = new SpeechSynthesisUtterance(String(text).replace(/[*「」『』“”]/g, ''));
        const v = pickVoice(uri);
        if (v) u.voice = v;
        u.lang = v ? v.lang : langCode();
        u.pitch = pitch;
        u.rate = rate || +TT.settings.audio.rate || 1;
        let settled = false;
        const end = () => { if (!settled) { settled = true; if (current === u) current = null; resolve(); } };
        u.onend = end;
        u.onerror = end;
        current = u;
        synth.speak(u);
        // 保險：部分瀏覽器不會觸發 onend
        setTimeout(end, 4000 + String(text).length * 260);
      });
    },
    stop() { if (synth) synth.cancel(); current = null; },
    speaking: () => !!current,
  };

  /* 語音輸入 */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  const stt = {
    supported: !!SR,
    listening: false,
    start({ onText, onEnd } = {}) {
      if (!SR) throw new Error('此瀏覽器不支援語音輸入（建議使用 Chrome 或 Edge）');
      stt.stop();
      rec = new SR();
      rec.lang = langCode();
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        onText && onText(finalText + interim, !interim);
      };
      rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') TT.toast('語音輸入錯誤：' + e.error, { type: 'error' }); };
      rec.onend = () => { stt.listening = false; rec = null; onEnd && onEnd(finalText); };
      rec.start();
      stt.listening = true;
    },
    stop() { if (rec) { try { rec.stop(); } catch (e) { /* 忽略 */ } } },
  };

  TT.tts = tts;
  TT.stt = stt;
})();
