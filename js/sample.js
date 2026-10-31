/* 內建範例故事（原創角色），讓第一次使用時就能試玩 */
(function () {
  'use strict';
  const TT = window.TT;

  const CARD = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '瑟拉',
      tags: ['奇幻', '書店', '冒險', '治癒'],
      creator: 'ToonCard 範例',
      character_version: '1.0',
      creator_notes: '內建範例故事：一間只在雨夜出現的書店，書裡的世界是真的。可以直接遊玩，也可以用來測試文字模型與畫圖設定。',
      description:
        '瑟拉是「夜行書店」的店主，外表約二十出頭，銀白長髮、琥珀色眼睛，戴著細框圓眼鏡，常穿墨綠色針織外套、白襯衫與及踝長裙，頸上繫黑色緞帶。\n\n' +
        '她說話輕柔、有點慢條斯理，喜歡用書裡的句子打比方；表面從容，其實很怕寂寞，獨自守著書店已經很久。她能「讀」出客人心裡缺少的那本書，也能打開書頁，帶人走進書中的世界（書界）。\n\n' +
        '她對 {{user}} 有莫名的好感，因為 {{user}} 是多年來第一個在雨夜裡自己找到書店的人。',
      personality: '溫柔、博學、慢熱、偶爾促狹；害怕被遺忘；遇到危險時意外地果斷。',
      scenario: '城市連日暴雨。只有在午夜的雨聲裡，舊街盡頭才會出現一間亮著暖黃燈光的書店——夜行書店。{{user}} 為了躲雨推開了店門。',
      first_mes:
        '*門上的銅鈴輕輕一響，雨聲被關在門外。暖黃的燈光下，書架一路延伸到看不見的深處，空氣裡有舊紙與紅茶的味道。*\n\n' +
        '*櫃檯後，一位銀髮的女子從書頁間抬起頭，推了推圓框眼鏡，琥珀色的眼睛在燈下微微發亮。*\n\n' +
        '「歡迎光臨夜行書店。」*她闔上書，嘴角浮起一點笑意。*「這麼大的雨，你居然能找到這裡……看來，有一本書在等你。」\n\n' +
        '*她從身後的書架抽出一本沒有書名的深藍色精裝書，輕輕放在櫃檯上。封面上的燙金紋路，像是在呼吸。*\n\n' +
        '「要翻開看看嗎？還是——先喝杯熱茶，等雨停？」',
      alternate_greetings: [
        '*你醒來時，臉頰貼著冰涼的石板。頭頂是灰色的天空，遠方的城堡正冒著黑煙，空氣裡飄著灰燼。*\n\n' +
          '*一張發光的書頁在你眼前翻飛，下一秒化成熟悉的身影——銀髮、圓框眼鏡，只是這次她披著一件綴滿古老文字的斗篷。*\n\n' +
          '「太好了，你醒了。」*瑟拉鬆了一口氣，伸手把你拉起來。*「這裡是《灰燼王國》的第三章……我們好像掉進了故事最糟的那一段。」\n\n' +
          '*城堡方向傳來一聲巨響，一群漆黑的墨獸正從斷牆後湧出。*\n\n' +
          '「聽好，在書界裡，故事的結局還沒被寫死。」*她攤開手中的空白書頁，墨跡開始流動。*「你想怎麼做，故事就會怎麼走——但要快。」',
        '*開學第一天，聖蒂亞學院的圖書館安靜得只剩翻頁聲。你被分配到圖書委員會，推開最深處那扇掛著「禁書區」牌子的門。*\n\n' +
          '*一位銀髮的學姊坐在窗邊的梯子上，膝上攤著一本比她還舊的書。她抬起頭，鏡片後的琥珀色眼睛眨了眨。*\n\n' +
          '「新來的委員？」*她從梯子上輕巧地跳下，把一串黃銅鑰匙放進你手心。*「我是瑟拉，三年級。從今天起，晚上的禁書區由我們兩個負責。」\n\n' +
          '*她壓低聲音，指尖碰了碰書架上一本正在微微顫動的書。*\n\n' +
          '「第一條規則：午夜之後，不管聽見書裡傳出什麼聲音——都不可以回答。」',
      ],
      mes_example:
        '<START>\n{{user}}：這些書都是真的嗎？\n{{char}}：*瑟拉用指尖撫過書脊，像在安撫一隻貓。*「書裡的世界，對住在裡面的人來說，一直都是真的。只是很少有人願意相信罷了。」',
      system_prompt: '',
      post_history_instructions: '',
      extensions: {},
      character_book: {
        name: '夜行書店',
        entries: [
          { id: 0, keys: ['夜行書店', '書店'], content: '夜行書店只在下雨的午夜出現於舊街盡頭。店內書架無限延伸，越往深處的書越古老、越危險。最深處是上鎖的禁書區。', enabled: true, insertion_order: 100, constant: false, comment: '夜行書店' },
          { id: 1, keys: ['書界', '書中', '書裡', '翻開'], content: '翻開夜行書店的書，就能進入書中的世界「書界」。在書界裡，讀者可以改變劇情；但若故事崩壞，書頁會被墨獸吞噬，讀者也可能永遠困在書中。', enabled: true, insertion_order: 100, constant: false, comment: '書界' },
          { id: 2, keys: ['墨獸', '怪物', '黑影'], content: '墨獸是被遺忘的故事化成的漆黑怪物，形如流動的墨汁，懼怕光，以及被大聲念出的真名。', enabled: true, insertion_order: 100, constant: false, comment: '墨獸' },
          { id: 3, keys: ['墨丸', '黑貓', '貓'], content: '墨丸是書店裡的黑貓，金色眼睛，戴著掛黃銅鈴鐺的紅色項圈；說話毒舌但心地善良，自稱活了三百年，負責看守禁書區。', enabled: true, insertion_order: 100, constant: false, comment: '墨丸' },
          { id: 4, keys: ['守書人', '契約', '離開'], content: '瑟拉是第七代「守書人」，與書店締結了契約：只要書店存在，她就不會老去，但也永遠無法離開店門超過一夜。', enabled: true, insertion_order: 100, constant: false, comment: '守書人' },
        ],
      },
    },
  };

  const APPEARANCE = '1girl, young woman, long silver hair, amber eyes, thin round glasses, dark green knit cardigan, white blouse, black ribbon tie, ankle-length skirt, slender, gentle smile';

  // 以程式繪製雨夜書店封面
  async function drawCover() {
    const W = 512, H = 768;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#070b1f'); sky.addColorStop(0.5, '#1a2150'); sky.addColorStop(1, '#2b1d3a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // 遠景建築
    g.fillStyle = '#0d1230';
    for (let x = -20; x < W; x += 60 + rnd() * 40) { const h = 220 + rnd() * 200; g.fillRect(x, H * 0.62 - h, 50 + rnd() * 50, h); }
    g.fillStyle = 'rgba(255,214,140,.35)';
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * W, 120 + rnd() * 260, 4, 6);

    // 書店
    const sx = 96, sy = 300, sw = 320, sh = 300;
    g.fillStyle = '#171332'; g.fillRect(sx - 20, sy - 70, sw + 40, sh + 90);
    g.fillStyle = '#231b40'; g.fillRect(sx - 30, sy - 86, sw + 60, 26);
    const glow = g.createRadialGradient(W / 2, sy + 130, 20, W / 2, sy + 130, 300);
    glow.addColorStop(0, 'rgba(255,190,110,.55)'); glow.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = glow; g.fillRect(0, sy - 120, W, 520);
    // 窗與書架
    const win = (x, y, w, h) => {
      const wg = g.createLinearGradient(0, y, 0, y + h);
      wg.addColorStop(0, '#ffd48a'); wg.addColorStop(1, '#ff9f4d');
      g.fillStyle = wg; g.fillRect(x, y, w, h);
      for (let r = 0; r < 4; r++) {
        let bx = x + 6;
        const by = y + 10 + r * (h - 10) / 4;
        while (bx < x + w - 8) {
          const bw = 5 + rnd() * 8, bh = (h - 10) / 4 - 10 - rnd() * 10;
          g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 45% ${30 + rnd() * 25}%)`;
          g.fillRect(bx, by + ((h - 10) / 4 - 10 - bh), bw, bh);
          bx += bw + 1.5;
        }
        g.fillStyle = 'rgba(80,40,20,.6)'; g.fillRect(x, by + (h - 10) / 4 - 10, w, 3);
      }
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 6; g.strokeRect(x, y, w, h);
    };
    win(sx, sy, 110, 200);
    win(sx + sw - 110, sy, 110, 200);
    // 門
    g.fillStyle = '#ffcf87'; g.fillRect(W / 2 - 42, sy + 30, 84, sh - 30);
    g.fillStyle = 'rgba(60,30,10,.55)'; g.fillRect(W / 2 - 34, sy + 42, 68, 100);
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 6; g.strokeRect(W / 2 - 42, sy + 30, 84, sh - 30);
    // 招牌
    g.font = '700 30px "Noto Serif TC","Microsoft JhengHei",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ffb35c'; g.shadowBlur = 18; g.fillStyle = '#ffe2b0';
    g.fillText('夜 行 書 店', W / 2, sy - 40);
    g.shadowBlur = 0;

    // 地面倒影
    const ground = g.createLinearGradient(0, sy + sh, 0, H);
    ground.addColorStop(0, '#1b1530'); ground.addColorStop(1, '#0a0816');
    g.fillStyle = ground; g.fillRect(0, sy + sh, W, H - sy - sh);
    g.globalAlpha = 0.25;
    g.fillStyle = '#ffb060';
    g.fillRect(sx, sy + sh + 8, 110, 70); g.fillRect(sx + sw - 110, sy + sh + 8, 110, 70); g.fillRect(W / 2 - 42, sy + sh + 8, 84, 110);
    g.globalAlpha = 1;

    // 雨
    g.strokeStyle = 'rgba(190,210,255,.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = rnd() * H, l = 10 + rnd() * 22;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - l * 0.25, y + l); g.stroke();
    }
    // 標題
    const fade = g.createLinearGradient(0, H - 200, 0, H);
    fade.addColorStop(0, 'rgba(5,5,12,0)'); fade.addColorStop(1, 'rgba(5,5,12,.85)');
    g.fillStyle = fade; g.fillRect(0, H - 200, W, 200);
    g.fillStyle = '#fff'; g.font = '700 54px "Noto Serif TC","Microsoft JhengHei",serif';
    g.fillText('瑟拉', W / 2, H - 92);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '400 22px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    g.fillText('— 雨夜裡的夜行書店 —', W / 2, H - 48);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  }

  TT.sample = {
    async install() {
      // 已經裝過就直接用那一本，不重複新增
      const have = TT.store.cards.find((c) => c.source === 'sample');
      if (have) {
        if (have.shelved === false) { have.shelved = true; await TT.store.saveCard(have); }
        return have;
      }
      const card = TT.card.normalizeCard(TT.clone(CARD));
      // 封面是場景圖而不是人物，所以標記為 generatedCover，讓立繪改用外貌標籤生成
      const rec = await TT.card.toRecord(card, { source: 'sample', appearance: APPEARANCE, avatar: await drawCover(), generatedCover: true });
      await TT.store.saveCard(rec);
      return rec;
    },
  };
})();
