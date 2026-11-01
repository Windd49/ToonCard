const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, TT, extra = {}) {
  const context = vm.createContext({
    window: { TT },
    console,
    URL,
    URLSearchParams,
    Blob,
    FormData,
    Response,
    TextDecoder,
    DOMException,
    setTimeout,
    clearTimeout,
    ...extra,
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return TT;
}

test('chub search uses the selected language and NSFW snapshot', async () => {
  let request = '';
  const TT = {
    settings: { chub: { sort: 'trending', lang: 'en', nsfw: false } },
    net: {
      async fetch(url) {
        request = url;
        return { ok: true, async json() { return { data: { count: 0, nodes: [] } }; } };
      },
    },
  };
  load('js/chub.js', TT);
  await TT.chub.search({ sort: 'created_at', lang: 'ja', nsfw: true });
  const params = new URL(request).searchParams;
  assert.equal(params.get('sort'), 'created_at');
  assert.equal(params.get('language'), 'ja');
  assert.equal(params.get('nsfw'), 'true');
  assert.equal(params.has('excludetopics'), false);
});

test('all text helpers stay on the model selected in settings', async () => {
  let request = null;
  const TT = {
    settings: {
      net: { proxy: 'off' },
      llm: { type: 'openai', baseUrl: 'https://selected.example/v1', apiKey: 'selected-key', model: 'selected-model', stream: false, maxTokens: 100, extraBody: '' },
    },
  };
  const fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  load('js/llm.js', TT, { fetch, location: { protocol: 'https:' } });
  const out = await TT.llm.complete([{ role: 'user', content: 'test' }], {
    cfg: { type: 'gemini', baseUrl: 'https://wrong.example', apiKey: 'wrong-key', model: 'wrong-model', thinking: 'low' },
  });
  assert.equal(out, 'ok');
  assert.equal(request.url, 'https://selected.example/v1/chat/completions');
  assert.equal(request.body.model, 'selected-model');
  assert.equal(request.init.headers.Authorization, 'Bearer selected-key');
});

test('image generation requires and sends the configured image model', async () => {
  let body = null;
  const TT = {
    settings: { image: { backend: 'openai', baseUrl: 'https://images.example/v1', apiKey: 'image-key', model: '' } },
    llm: { normalizeBase: (v) => String(v).replace(/\/+$/, '') },
    net: {
      async fetch(_url, init) {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: [{ b64_json: 'AA==' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
    b64ToBytes: (v) => Uint8Array.from(Buffer.from(v, 'base64')),
    bus: { emit() {} },
  };
  load('js/imagegen.js', TT);
  const req = { positive: 'scene', negative: '', width: 1024, height: 1024, seed: 1, refs: [] };
  await assert.rejects(() => TT.img.generate(req), /尚未設定圖像模型名稱/);
  TT.settings.image.model = 'chosen-image-model';
  await TT.img.generate(req);
  assert.equal(body.model, 'chosen-image-model');
});

test('CG trigger uses only an exact name or internal id', () => {
  const TT = { html: () => '', raw: (v) => v, icon: () => '' };
  load('js/sprites.js', TT);
  const card = { cgs: [{ id: 'cg-1', name: '真相揭曉', blob: new Blob(['x']) }], bgs: [] };
  assert.equal(TT.sprites.findCg(card, '真相'), null);
  assert.equal(TT.sprites.findCg(card, '真相揭曉').id, 'cg-1');
  assert.equal(TT.sprites.findCg(card, 'cg-1').id, 'cg-1');
});

test('CG parser preserves a full name and recognizes an explicit close tag', () => {
  const TT = {};
  load('js/parser.js', TT);
  const beats = TT.parser.parseAll('[CG:真相揭曉]\n[CG:off]').map((b) => ({ t: b.t, name: b.name }));
  assert.equal(JSON.stringify(beats), JSON.stringify([{ t: 'cg', name: '真相揭曉' }, { t: 'cg', name: '' }]));
});

test('feed and detail views keep request and scroll state isolated', () => {
  const feed = fs.readFileSync('js/views/feed.js', 'utf8');
  const detail = fs.readFileSync('js/views/detail.js', 'utf8');
  assert.match(feed, /epoch !== S\.epoch/);
  assert.match(feed, /nsfw: !!st\.nsfw/);
  assert.match(feed, /removeEventListener\('click', F\.onClick\)/);
  assert.match(detail, /const oldScrollTop = oldScroller \? oldScroller\.scrollTop : 0/);
  assert.match(detail, /class="icon-btn glass detail-back"/);
});
