"use strict";

// 接待テトリスの音（BGM・効果音）。音声ファイルは使わず、すべて Web Audio で合成する。
// BGM はロシア民謡「コロブチカ」（パブリックドメイン）をこのゲーム用に編曲したもの。

const midiToFreq = (n) => 440 * 2 ** ((n - 69) / 12);

// "G#4" → MIDI ノート番号
function midi(name) {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return base + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
}

// toMajor はイ短調の音をイ長調の音にする（ド・ファ・ソを半音上げる）。
// 接待中は同じ BGM をこれで明るい長調にして鳴らす。
function toMajor(n) {
  const pc = n % 12;
  return pc === 0 || pc === 5 || pc === 7 ? n + 1 : n;
}

// メロディ [音, 拍]（null は休符）。A パート8小節・B パート8小節。
const MELODY_A = [
  ["E5", 1], ["B4", .5], ["C5", .5], ["D5", 1], ["C5", .5], ["B4", .5],
  ["A4", 1], ["A4", .5], ["C5", .5], ["E5", 1], ["D5", .5], ["C5", .5],
  ["B4", 1.5], ["C5", .5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 1], ["A4", 1], [null, 1],
  [null, .5], ["D5", 1], ["F5", .5], ["A5", 1], ["G5", .5], ["F5", .5],
  ["E5", 1.5], ["C5", .5], ["E5", 1], ["D5", .5], ["C5", .5],
  ["B4", 1], ["B4", .5], ["C5", .5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 1], ["A4", 1], [null, 1],
];
const MELODY_B = [
  ["E5", 2], ["C5", 2], ["D5", 2], ["B4", 2], ["C5", 2], ["A4", 2], ["G#4", 2], ["B4", 1], [null, 1],
  ["E5", 2], ["C5", 2], ["D5", 2], ["B4", 2], ["C5", 1], ["E5", 1], ["A5", 2], ["G#5", 3], [null, 1],
];
// ベースの根音（2拍ごと）。8分音符でオクターブを行き来する。
const BASS_A = ["E", "E", "A", "A", "G#", "E", "A", "A", "D", "D", "C", "C", "G#", "E", "A", "A"];
const BASS_B = ["A", "A", "G#", "G#", "A", "A", "G#", "G#", "A", "A", "G#", "G#", "A", "A", "G#", "G#"];
const BASS_LOW = { E: midi("E2"), A: midi("A2"), "G#": midi("G#2"), D: midi("D2"), C: midi("C3") };

function buildSong() {
  const ev = [];
  let beat = 0;
  for (const part of [MELODY_A, MELODY_A, MELODY_B]) {
    for (const [n, d] of part) {
      if (n) ev.push({ beat, dur: d, inst: "lead", note: midi(n) });
      beat += d;
    }
  }
  const length = beat; // 96拍
  [...BASS_A, ...BASS_A, ...BASS_B].forEach((root, i) => {
    for (let j = 0; j < 4; j++) {
      const low = BASS_LOW[root];
      ev.push({ beat: i * 2 + j * .5, dur: .5, inst: "bass", note: j % 2 ? low + 12 : low });
    }
  });
  // ドラム。B パートはゆったり（キック1拍目・スネア3拍目）
  for (let b = 0; b < length; b += .5) {
    const inBar = b % 4;
    const calm = b >= 64;
    if (calm ? inBar === 0 : inBar === 0 || inBar === 2) ev.push({ beat: b, inst: "kick" });
    if (calm ? inBar === 2 : inBar === 1 || inBar === 3) ev.push({ beat: b, inst: "snare" });
    if (!calm || b % 1 === 0) ev.push({ beat: b, inst: "hat" });
  }
  ev.sort((a, b) => a.beat - b.beat);
  return { events: ev, length };
}

class SettaiSound {
  constructor() {
    this.ctx = null;
    this.volume = .7;
    this.bgmOn = true;
    this.seOn = true;
    this.song = buildSong();
    this.timer = null;
    this.leadType = "square";
    this.bpm = 140;
    this.major = false; // 接待中は長調で鳴らす
  }

  // ユーザー操作（クリック・キー）の中で呼ぶ。ブラウザは操作なしでは音を鳴らせない。
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.bgmBus = ctx.createGain();
      this.bgmBus.connect(this.master);
      this.seBus = ctx.createGain();
      this.seBus.connect(this.master);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.applyLevels();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volume * this.volume, t, .02);
    this.bgmBus.gain.setTargetAtTime(this.bgmOn ? .55 : 0, t, .05);
    this.seBus.gain.setTargetAtTime(this.seOn ? .9 : 0, t, .02);
  }

  setVolume(v) { this.volume = v; this.applyLevels(); }
  setBgm(on) { this.bgmOn = on; this.applyLevels(); }
  setSe(on) { this.seOn = on; this.applyLevels(); }

  // ---- 部品 ----

  tone(t, { f0, f1 = f0, dur, vol, type = "square", dest = this.seBus }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .005);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + .02);
  }

  noise(t, { dur, vol, type = "lowpass", freq = 1000, freqEnd = freq, q = 1, dest = this.seBus }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * .5);
    src.stop(t + dur + .02);
  }

  arpeggio(t, notes, { step = .055, dur = .12, vol = .08, type = "square" } = {}) {
    notes.forEach((n, i) => this.tone(t + i * step, { f0: midiToFreq(n), dur, vol, type }));
  }

  // ---- 効果音 ----

  se(name, arg) {
    if (!this.ctx || !this.seOn) return;
    const t = this.ctx.currentTime + .005;
    switch (name) {
      case "move":
        this.tone(t, { f0: 230, dur: .03, vol: .05 });
        break;
      case "rotate":
        this.tone(t, { f0: 520, f1: 780, dur: .05, vol: .05 });
        break;
      case "soft":
        this.tone(t, { f0: 160, dur: .02, vol: .03, type: "triangle" });
        break;
      case "hard":
        this.noise(t, { dur: .12, vol: .35, freq: 900 });
        this.tone(t, { f0: 140, f1: 40, dur: .18, vol: .5, type: "sine" });
        break;
      case "lock":
        this.tone(t, { f0: 200, f1: 110, dur: .07, vol: .18, type: "triangle" });
        break;
      case "clear": {
        const lines = arg;
        const notes = { 1: [72, 79], 2: [72, 76, 79], 3: [72, 76, 79, 84], 4: [72, 76, 79, 84, 88, 91] }[lines];
        this.arpeggio(t, notes);
        this.noise(t, { dur: .25 + lines * .08, vol: .08 + lines * .03, type: "bandpass", freq: 600, freqEnd: 5000, q: 2 });
        if (lines === 4) { // テトリスはファンファーレ付き
          const end = t + notes.length * .055;
          [84, 88, 91, 96].forEach((n) => this.tone(end, { f0: midiToFreq(n), dur: .6, vol: .05 }));
          this.arpeggio(end + .1, [96, 100, 103, 108], { step: .04, vol: .04, type: "triangle" });
        }
        break;
      }
      case "levelup":
        this.arpeggio(t, [79, 83, 86, 91], { step: .07, dur: .15, vol: .12, type: "triangle" });
        break;
      case "match": // ゴーストがおすすめ位置に重なった
        this.tone(t, { f0: 1319, dur: .1, vol: .06, type: "sine" });
        this.tone(t + .07, { f0: 1760, dur: .16, vol: .05, type: "sine" });
        break;
      case "pause":
        this.tone(t, { f0: 660, dur: .06, vol: .05 });
        this.tone(t + .07, { f0: 440, dur: .08, vol: .05 });
        break;
      case "select":
        this.tone(t, { f0: 880, dur: .04, vol: .04 });
        break;
      case "start":
        this.arpeggio(t, [60, 64, 67, 72], { step: .06, vol: .07 });
        break;
      case "gameover":
        this.arpeggio(t, [72, 67, 63, 60, 55], { step: .2, dur: .28, vol: .14, type: "triangle" });
        break;
    }
  }

  // ---- BGM ----
  // 拍の位置で管理し、テンポが変わっても各パートがずれないようにする。

  startBgm() {
    if (!this.ctx) return;
    this.stopBgm();
    this.evIndex = 0;
    this.loopOffset = 0;
    this.spb = 60 / this.bpm;
    this.anchorBeat = 0;
    this.anchorTime = this.ctx.currentTime + .1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopBgm() {
    clearInterval(this.timer);
    this.timer = null;
  }

  pauseBgm() {
    if (!this.timer) return;
    this.pausedBeat = this.beatAt(this.ctx.currentTime);
    this.stopBgm();
  }

  resumeBgm() {
    if (this.timer || this.pausedBeat === undefined || !this.ctx) return;
    this.anchorBeat = this.pausedBeat;
    this.anchorTime = this.ctx.currentTime + .05;
    this.pausedBeat = undefined;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  beatAt(time) {
    return this.anchorBeat + (time - this.anchorTime) / this.spb;
  }

  setTempo(bpm) {
    if (Math.abs(bpm - this.bpm) < .5) return;
    this.bpm = bpm;
    if (!this.ctx || !this.timer) return;
    const now = this.ctx.currentTime;
    this.anchorBeat = this.beatAt(now);
    this.anchorTime = now;
    this.spb = 60 / bpm;
  }

  schedule() {
    const ahead = this.ctx.currentTime + .12;
    const { events, length } = this.song;
    for (;;) {
      const ev = events[this.evIndex];
      const beat = this.loopOffset + ev.beat;
      const time = this.anchorTime + (beat - this.anchorBeat) * this.spb;
      if (time > ahead) break;
      if (time >= this.ctx.currentTime - .05) this.playEvent(ev, time);
      if (++this.evIndex >= events.length) {
        this.evIndex = 0;
        this.loopOffset += length;
      }
    }
  }

  playEvent(ev, t) {
    const ctx = this.ctx;
    const dest = this.bgmBus;
    switch (ev.inst) {
      case "lead": {
        const dur = ev.dur * this.spb;
        const o = ctx.createOscillator();
        o.type = this.leadType;
        o.frequency.value = midiToFreq(this.pitch(ev.note));
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = this.leadType === "sawtooth" ? 2200 : 3800;
        const g = ctx.createGain();
        const v = this.leadType === "sawtooth" ? .07 : .08;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + .01);
        g.gain.linearRampToValueAtTime(v * .7, t + Math.min(.1, dur * .5));
        g.gain.linearRampToValueAtTime(0, t + dur * .95);
        o.connect(f).connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur);
        break;
      }
      case "bass": {
        const dur = ev.dur * this.spb * .85;
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = midiToFreq(this.pitch(ev.note));
        const g = ctx.createGain();
        g.gain.setValueAtTime(.22, t);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur);
        break;
      }
      case "kick":
        this.tone(t, { f0: 150, f1: 45, dur: .12, vol: .45, type: "sine", dest });
        break;
      case "snare":
        this.noise(t, { dur: .1, vol: .14, type: "bandpass", freq: 1800, q: .8, dest });
        break;
      case "hat":
        this.noise(t, { dur: .03, vol: .05, type: "highpass", freq: 7000, dest });
        break;
    }
  }

  // 曲の音を、今の調（短調 / 接待中の長調）の音にする。
  pitch(note) {
    return this.major ? toMajor(note) : note;
  }

  // ゲームの状況に合わせて BGM を変える。
  //   レベルでテンポアップ、ピンチでさらに速く、鬼モードは荒い音色。
  //   接待しているとき（接待モード、ナチュラル接待のこっそり接待中）は長調。
  //   途中で変わっても、次に鳴らす音から切り替わるので曲は途切れない。
  follow(state) {
    if (!state) return;
    let bpm = Math.min(132 + (state.level - 1) * 6, 200);
    if (state.stack >= 14) bpm *= 1.15;
    this.setTempo(bpm);
    this.leadType = state.mode === 2 ? "sawtooth" : "square";
    this.major = state.mode === 0 || (state.mode === 3 && state.assisting);
  }
}

if (typeof window !== "undefined") window.SettaiSound = SettaiSound;
if (typeof module === "object" && module.exports) module.exports = { SettaiSound, buildSong, toMajor, midi }; // テスト用
