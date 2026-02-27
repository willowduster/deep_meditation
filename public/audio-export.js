/* audio-export.js – WAV, FLAC (verbatim), and MP3 (via lamejs) encoders
   All encoding runs on the main thread; large sessions may take a few seconds. */
'use strict';

const AudioExport = (() => {

  // ── Bit-stream writer ────────────────────────────────────────────────────
  class BitWriter {
    constructor() { this._buf = []; this._cur = 0; this._bits = 0; }
    write(value, n) {
      for (let i = n - 1; i >= 0; i--) {
        this._cur = (this._cur << 1) | ((value >>> i) & 1);
        if (++this._bits === 8) {
          this._buf.push(this._cur & 0xFF);
          this._cur = 0; this._bits = 0;
        }
      }
    }
    align() {
      if (this._bits > 0) {
        this._buf.push((this._cur << (8 - this._bits)) & 0xFF);
        this._cur = 0; this._bits = 0;
      }
    }
    get bytes() { return new Uint8Array(this._buf); }
  }

  // ── CRC-8  (poly 0x07, init 0) ──────────────────────────────────────────
  const _c8 = (() => {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let v = i;
      for (let j = 0; j < 8; j++) v = (v & 0x80) ? ((v << 1) ^ 7) & 0xFF : (v << 1) & 0xFF;
      t[i] = v;
    }
    return t;
  })();
  function crc8(data) { let c = 0; for (const b of data) c = _c8[c ^ b]; return c; }

  // ── CRC-16 (poly 0x8005, init 0) ────────────────────────────────────────
  const _c16 = (() => {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      let v = i << 8;
      for (let j = 0; j < 8; j++) v = (v & 0x8000) ? ((v << 1) ^ 0x8005) & 0xFFFF : (v << 1) & 0xFFFF;
      t[i] = v;
    }
    return t;
  })();
  function crc16(data) {
    let c = 0;
    for (const b of data) c = ((c << 8) ^ _c16[((c >> 8) ^ b) & 0xFF]) & 0xFFFF;
    return c;
  }

  // ── UTF-8-style integer (FLAC frame-number encoding) ────────────────────
  function writeUtf8Int(bw, v) {
    if      (v < 0x80)     { bw.write(v, 8); }
    else if (v < 0x800)    { bw.write(0xC0 | (v >> 6), 8);  bw.write(0x80 | (v & 0x3F), 8); }
    else if (v < 0x10000)  { bw.write(0xE0 | (v >> 12), 8); bw.write(0x80 | ((v >> 6) & 0x3F), 8); bw.write(0x80 | (v & 0x3F), 8); }
    else                   { bw.write(0xF0 | (v >> 18), 8); bw.write(0x80 | ((v >> 12) & 0x3F), 8); bw.write(0x80 | ((v >> 6) & 0x3F), 8); bw.write(0x80 | (v & 0x3F), 8); }
  }

  // ── Block-size → 4-bit FLAC code ────────────────────────────────────────
  const _bsMap = { 192: 1, 576: 2, 1152: 3, 2304: 4, 4608: 5, 256: 8, 512: 9, 1024: 10, 2048: 11, 4096: 12, 8192: 13, 16384: 14, 32768: 15 };
  function bsCode(n) { return _bsMap[n] !== undefined ? _bsMap[n] : n <= 256 ? 6 : 7; }

  // ── Float32 → Int16 conversion ───────────────────────────────────────────
  function toInt16(ch) {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++)
      out[i] = Math.round(Math.max(-1, Math.min(1 - 1 / 32768, ch[i])) * 32767);
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WAV encoder  (16-bit PCM, little-endian)
  // ══════════════════════════════════════════════════════════════════════════
  function encodeWAV(channels, sampleRate) {
    const numCh = channels.length;
    const n     = channels[0].length;
    const align = numCh * 2;
    const data  = n * align;
    const buf   = new ArrayBuffer(44 + data);
    const v     = new DataView(buf);
    let o = 0;
    const w32b = x => { v.setUint32(o, x, false); o += 4; };
    const w32l = x => { v.setUint32(o, x, true);  o += 4; };
    const w16l = x => { v.setUint16(o, x, true);  o += 2; };
    w32b(0x52494646); w32l(36 + data); w32b(0x57415645);   // RIFF…WAVE
    w32b(0x666D7420); w32l(16);                              // fmt
    w16l(1); w16l(numCh); w32l(sampleRate);
    w32l(sampleRate * align); w16l(align); w16l(16);
    w32b(0x64617461); w32l(data);                            // data
    for (let i = 0; i < n; i++)
      for (let ch = 0; ch < numCh; ch++) {
        v.setInt16(o, toInt16([channels[ch][i]])[0], true); o += 2;
      }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  FLAC encoder  (verbatim subframes, 16-bit, ~same size as WAV)
  // ══════════════════════════════════════════════════════════════════════════
  function encodeFLAC(channels, sampleRate) {
    const numCh      = channels.length;
    const numSamples = channels[0].length;
    const BPS        = 16;
    const BLOCK      = 4096;
    const numFrames  = Math.ceil(numSamples / BLOCK);
    const srCode     = { 44100: 0x9, 48000: 0xA, 96000: 0xB }[sampleRate] || 0x0;

    // One-shot float→int16 conversion per channel
    const pcm = channels.map(toInt16);

    const parts = [];

    // ── fLaC stream marker ──────────────────────────────────────────────
    parts.push(new Uint8Array([0x66, 0x4C, 0x61, 0x43]));

    // ── STREAMINFO metadata block (last=1, type=0, length=34) ──────────
    const si = new BitWriter();
    si.write(BLOCK, 16);  si.write(BLOCK, 16);          // min / max block size
    si.write(0, 24);       si.write(0, 24);              // min / max frame size (unknown)
    si.write(sampleRate, 20); si.write(numCh - 1, 3);   // sample rate, channels-1
    si.write(BPS - 1, 5);                                // bits per sample - 1
    si.write(0, 4); si.write(numSamples, 32);            // total samples (36-bit; assume < 2^32)
    for (let i = 0; i < 16; i++) si.write(0, 8);        // MD5 (zeroed)
    const siData = si.bytes; // 34 bytes
    const siBlock = new Uint8Array(4 + siData.length);
    siBlock.set(new Uint8Array([0x80, 0x00, 0x00, 0x22])); // header: last=1, len=34
    siBlock.set(siData, 4);
    parts.push(siBlock);

    // ── Audio frames ─────────────────────────────────────────────────────
    for (let fn = 0; fn < numFrames; fn++) {
      const fs    = fn * BLOCK;
      const bSize = Math.min(BLOCK, numSamples - fs);
      const bsc   = bsCode(bSize);

      // Frame header — fields are always byte-aligned at CRC-8 point
      const fh = new BitWriter();
      fh.write(0x3FFE, 14); fh.write(0, 1); fh.write(0, 1);      // sync + 2 flags
      fh.write(bsc, 4); fh.write(srCode, 4);                       // blocksize, samplerate
      fh.write(numCh === 2 ? 0x1 : 0x0, 4); fh.write(0x4, 3); fh.write(0, 1); // ch, bps=16, rsvd
      writeUtf8Int(fh, fn);                                         // frame number
      if (bsc === 6) fh.write(bSize - 1, 8);                       // optional blocksize ext
      else if (bsc === 7) fh.write(bSize - 1, 16);
      const preHdr = fh.bytes;
      fh.write(crc8(preHdr), 8);                                    // CRC-8
      const hdrBytes = fh.bytes;

      // Pre-allocate the complete frame buffer
      // layout: [header][per-channel: 1-byte subframe header + bSize*2 sample bytes][2-byte CRC-16]
      const frameLen = hdrBytes.length + numCh * (1 + bSize * 2) + 2;
      const frame    = new Uint8Array(frameLen);
      frame.set(hdrBytes);
      let p = hdrBytes.length;

      for (let ch = 0; ch < numCh; ch++) {
        frame[p++] = 0x02; // verbatim subframe header (type=1, no wasted bits)
        for (let s = fs; s < fs + bSize; s++) {
          const smp = pcm[ch][s]; // Int16 — JS `>>` does arithmetic shift, `&` masks to byte
          frame[p++] = (smp >> 8) & 0xFF;  // high byte
          frame[p++] =  smp       & 0xFF;  // low  byte
        }
      }
      // (16-bit × any blocksize is always byte-aligned, no padding needed)

      const c = crc16(frame.subarray(0, p));
      frame[p++] = (c >> 8) & 0xFF;
      frame[p++] =  c       & 0xFF;
      parts.push(frame);
    }

    // Concatenate all parts into one Uint8Array
    const total  = parts.reduce((s, a) => s + a.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const part of parts) { result.set(part, off); off += part.length; }
    return new Blob([result], { type: 'audio/flac' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MP3 encoder  (256 kbps, via lamejs — loaded lazily from CDN)
  // ══════════════════════════════════════════════════════════════════════════
  async function loadLamejs() {
    if (window.lamejs) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load MP3 encoder library. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  async function encodeMP3(channels, sampleRate) {
    await loadLamejs();
    const numCh = channels.length;
    const enc   = new lamejs.Mp3Encoder(numCh, sampleRate, 256);
    const CHUNK = 1152; // lamejs optimal chunk size
    const parts = [];
    const left  = toInt16(channels[0]);
    const right = numCh > 1 ? toInt16(channels[1]) : left;

    for (let i = 0; i < left.length; i += CHUNK) {
      const chunk = numCh > 1
        ? enc.encodeBuffer(left.subarray(i, i + CHUNK), right.subarray(i, i + CHUNK))
        : enc.encodeBuffer(left.subarray(i, i + CHUNK));
      if (chunk.length) parts.push(chunk);
    }
    const tail = enc.flush();
    if (tail.length) parts.push(tail);
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════════════════
  return {
    /**
     * Decode a recorded Blob (WebM/Opus from MediaRecorder) then re-encode
     * it as the requested format and trigger a browser download.
     * @param {Blob}         recordedBlob  – raw MediaRecorder output
     * @param {'wav'|'flac'|'mp3'} format
     * @param {string}       filename      – base filename without extension
     * @param {AudioContext} ctx           – any running AudioContext for decoding
     */
    async exportBlob(recordedBlob, format, filename, ctx) {
      const ab       = await recordedBlob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(ab);
      const channels = Array.from({ length: audioBuf.numberOfChannels }, (_, i) =>
        audioBuf.getChannelData(i));
      const sr = audioBuf.sampleRate;

      let blob;
      if      (format === 'wav')  blob = encodeWAV (channels, sr);
      else if (format === 'flac') blob = encodeFLAC(channels, sr);
      else                        blob = await encodeMP3(channels, sr);

      const ext = { wav: 'wav', flac: 'flac', mp3: 'mp3' }[format];
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `${filename}.${ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };
})();
