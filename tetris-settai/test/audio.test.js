// audio.js のテスト（音は鳴らさず、BGM の音の選び方だけを確かめる）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { SettaiSound, buildSong, toMajor } = require("../audio.js");

const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7, 8]); // イ短調（和声的短音階の G# を含む）
const A_MAJOR = new Set([9, 11, 1, 2, 4, 6, 8]); // イ長調
const notes = buildSong().events.filter((e) => e.inst === "lead" || e.inst === "bass").map((e) => e.note);

test("BGM はイ短調で書かれている", () => {
  for (const n of notes) assert.ok(A_MINOR.has(n % 12), `note ${n}`);
});

test("接待中はすべての音がイ長調になる", () => {
  for (const n of notes) assert.ok(A_MAJOR.has(toMajor(n) % 12), `note ${n} -> ${toMajor(n)}`);
});

test("接待しているときだけ長調にする", () => {
  const s = new SettaiSound();
  const base = { level: 1, stack: 0, assisting: false };
  const major = (state) => {
    s.follow({ ...base, ...state });
    return s.major;
  };
  assert.equal(major({ mode: 0 }), true, "接待");
  assert.equal(major({ mode: 1 }), false, "通常");
  assert.equal(major({ mode: 2 }), false, "鬼");
  assert.equal(major({ mode: 3, assisting: false }), false, "ナチュラル接待（ランダム中）");
  assert.equal(major({ mode: 3, assisting: true }), true, "ナチュラル接待（こっそり接待中）");
  assert.equal(s.pitch(72), 73, "長調ではドがド#になる");
});
