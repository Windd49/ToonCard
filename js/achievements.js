/* 成就、統計與結局收藏 */
(function () {
  'use strict';
  const TT = window.TT;

  const LIST = [
    { id: 'first_import', icon: 'upload', title: '初來乍到', desc: '匯入第一張角色卡' },
    { id: 'collector', icon: 'library', title: '收藏家', desc: '書架上有 10 個故事' },
    { id: 'first_story', icon: 'film', title: '開麥拉！', desc: '開始第一個故事' },
    { id: 'persona', icon: 'user', title: '我就是主角', desc: '建立自己的主角' },
    { id: 'turns_10', icon: 'chat', title: '漸入佳境', desc: '累計進行 10 回合' },
    { id: 'turns_100', icon: 'star', title: '劇場常客', desc: '累計進行 100 回合' },
    { id: 'turns_500', icon: 'trophy', title: '傳奇主角', desc: '累計進行 500 回合' },
    { id: 'first_scene', icon: 'image', title: '第一格分鏡', desc: '生成第一張場景圖' },
    { id: 'scenes_50', icon: 'layers', title: '分鏡大師', desc: '累計生成 50 張場景圖' },
    { id: 'first_ending', icon: 'flag', title: '劇終', desc: '達成第一個結局' },
    { id: 'endings_5', icon: 'sparkles', title: '多重結局', desc: '累計達成 5 個不同結局' },
    { id: 'branch', icon: 'branch', title: '平行世界', desc: '從某個時間點建立分支存檔' },
    { id: 'voice', icon: 'mic', title: '開口說話', desc: '用語音輸入台詞' },
    { id: 'night_owl', icon: 'moon', title: '夜貓子', desc: '在凌晨 0～4 點推進劇情' },
  ];
  const THRESHOLDS = { turns: [[10, 'turns_10'], [100, 'turns_100'], [500, 'turns_500']], scenes: [[1, 'first_scene'], [50, 'scenes_50']] };

  let state = { unlocked: {}, counters: {}, endings: {} };
  const persist = TT.debounce(() => TT.store.kvSet('achv', state).catch(console.error), 400);

  TT.achv = {
    LIST,
    get state() { return state; },
    async init() {
      const s = await TT.store.kvGet('achv');
      if (s) state = { unlocked: s.unlocked || {}, counters: s.counters || {}, endings: s.endings || {} };
    },
    unlock(id) {
      if (state.unlocked[id]) return;
      const a = LIST.find((x) => x.id === id);
      if (!a) return;
      state.unlocked[id] = Date.now();
      persist();
      TT.toast('解鎖成就：' + a.title, { icon: 'trophy', type: 'gold', duration: 3600 });
    },
    bump(counter, n = 1) {
      state.counters[counter] = (state.counters[counter] || 0) + n;
      persist();
      for (const [need, id] of THRESHOLDS[counter] || []) if (state.counters[counter] >= need) TT.achv.unlock(id);
    },
    count: (counter) => state.counters[counter] || 0,
    recordEnding(card, session, title) {
      const list = (state.endings[card.id] = state.endings[card.id] || []);
      if (!list.some((e) => e.title === title)) list.push({ title, at: Date.now(), sessionId: session.id });
      persist();
      TT.achv.unlock('first_ending');
      if (TT.achv.totalEndings() >= 5) TT.achv.unlock('endings_5');
    },
    endingsFor: (cardId) => state.endings[cardId] || [],
    totalEndings: () => Object.values(state.endings).reduce((n, l) => n + l.length, 0),
  };
})();
