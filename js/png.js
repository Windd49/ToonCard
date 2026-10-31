/* PNG 區塊讀寫（角色卡的 tEXt chara / ccv3） */
(function () {
  'use strict';
  const TT = window.TT;
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  let table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function isPng(u8) {
    for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return false;
    return true;
  }

  function readChunks(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (!isPng(u8)) throw new Error('不是有效的 PNG 檔案');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const chunks = [];
    let off = 8;
    while (off + 8 <= u8.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      const start = off + 8;
      const end = start + len;
      if (end + 4 > u8.length) break;
      chunks.push({ type, data: u8.subarray(start, end) });
      off = end + 4;
      if (type === 'IEND') break;
    }
    return chunks;
  }

  const latin1 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  };
  const ascii = (s) => {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  };
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const res = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await res.arrayBuffer());
  }

  // 讀出所有文字區塊 { keyword: text }
  async function readText(buf) {
    const out = {};
    for (const c of readChunks(buf)) {
      try {
        if (c.type === 'tEXt') {
          const z = c.data.indexOf(0);
          if (z > 0) out[latin1(c.data.subarray(0, z))] = latin1(c.data.subarray(z + 1));
        } else if (c.type === 'zTXt') {
          const z = c.data.indexOf(0);
          if (z > 0) out[latin1(c.data.subarray(0, z))] = latin1(await inflate(c.data.subarray(z + 2)));
        } else if (c.type === 'iTXt') {
          const z = c.data.indexOf(0);
          if (z <= 0) continue;
          const key = latin1(c.data.subarray(0, z));
          const compressed = c.data[z + 1] === 1;
          let p = z + 3;
          p = c.data.indexOf(0, p) + 1; // language tag
          p = c.data.indexOf(0, p) + 1; // translated keyword
          let bytes = c.data.subarray(p);
          if (compressed) bytes = await inflate(bytes);
          out[key] = new TextDecoder().decode(bytes);
        }
      } catch (e) {
        console.warn('PNG 文字區塊解析失敗', c.type, e);
      }
    }
    return out;
  }

  function makeChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // 移除同名文字區塊後，在 IEND 前寫入新的 tEXt（值需為 ASCII，例如 base64）
  function writeText(buf, entries) {
    const chunks = readChunks(buf);
    const keys = Object.keys(entries).map((k) => k.toLowerCase());
    const parts = [new Uint8Array(SIG)];
    for (const c of chunks) {
      if (c.type === 'tEXt' || c.type === 'iTXt' || c.type === 'zTXt') {
        const z = c.data.indexOf(0);
        if (z > 0 && keys.includes(latin1(c.data.subarray(0, z)).toLowerCase())) continue;
      }
      if (c.type === 'IEND') {
        for (const [k, v] of Object.entries(entries)) {
          const kb = ascii(k);
          const vb = ascii(v);
          const d = new Uint8Array(kb.length + 1 + vb.length);
          d.set(kb, 0);
          d.set(vb, kb.length + 1);
          parts.push(makeChunk('tEXt', d));
        }
      }
      parts.push(makeChunk(c.type, c.data));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  TT.png = { crc32, isPng, readChunks, readText, writeText };
})();
