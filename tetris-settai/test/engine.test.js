// engine.js のテスト。tetris-settai フォルダで `node --test` を実行する。
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

const { W, H, MODE } = E;
const I = 0, T = 2;

// rows は下から順に盤面を作る。'#' がブロック、'.' が空き。
function rows(...lines) {
  const b = new Uint16Array(H);
  lines.forEach((s, i) => {
    const y = H - lines.length + i;
    [...s].forEach((ch, x) => { if (ch === "#") b[y] |= 1 << x; });
  });
  return b;
}

// 盤面を指定してゲームを作る（ミノは盤面に合わせて選び直す）。
function gameWith(mode, b, seed = 1) {
  const g = new E.Game(mode, E.makeRng(seed));
  g.colors = Array.from({ length: H }, (_, y) => Uint8Array.from({ length: W }, (_, x) => (b[y] >> x) & 1));
  g.history = [];
  g.next = null; // 空の盤面で予告した鬼モードの NEXT は捨てる
  g.spawn("");
  g.takeEvents();
  return g;
}

const tetrisWell = rows(
  "#########.",
  "#########.",
  "#########.",
  "#########.",
);

test("接待モード: テトリスできる縦穴には I ミノを出す", () => {
  const g = gameWith(MODE.SETTAI, tetrisWell);
  assert.equal(g.cur.kind, I);
  assert.equal(g.ratings[I].lines, 4);
});

test("接待モード: T字の穴には T ミノを出す", () => {
  const g = gameWith(MODE.SETTAI, rows(
    "###...####",
    "####.#####",
  ));
  assert.equal(g.cur.kind, T);
});

test("鬼モード: テトリスできる縦穴があっても I ミノは出さない", () => {
  assert.notEqual(gameWith(MODE.ONI, tetrisWell).cur.kind, I);
});

test("T ミノの右向き（SRS の R 状態）は縦棒の右に突起", () => {
  const got = E.SHAPES[T][1].map(String).sort();
  assert.deepEqual(got, [[1, 0], [1, 1], [2, 1], [1, 2]].map(String).sort());
});

test("4ライン消すと clear イベントで消えた行が届く", () => {
  const g = gameWith(MODE.SETTAI, tetrisWell);
  g.cur = g.hint;
  g.hardDrop();
  const clear = g.takeEvents().find((e) => e.type === "clear");
  assert.equal(clear.lines, 4);
  assert.deepEqual([...clear.rows].sort(), [16, 17, 18, 19]);
  assert.equal(g.takeEvents().length, 0);
});

test("接地して一定時間たつと lock イベント", () => {
  const g = new E.Game(MODE.NORMAL, E.makeRng(1));
  g.takeEvents();
  for (let i = 0; i < 1000 && g.events.length === 0; i++) g.tick(50); // 最大50秒ぶん
  assert.equal(g.takeEvents()[0].type, "lock");
});

test("ミノ査定は実際に出したミノが1位、評価は1〜0に正規化", () => {
  const rk = gameWith(MODE.SETTAI, tetrisWell).ranking();
  assert.equal(rk.length, 7);
  assert.ok(rk[0].current);
  assert.equal(rk[0].frac, 1);
  assert.equal(rk[6].frac, 0);
});

test("接待モードで自動プレイ: 穴を一度も作らず、7種類すべてのミノが出る", () => {
  const g = new E.Game(MODE.SETTAI, E.makeRng(42));
  for (let i = 0; i < 300 && !g.over; i++) {
    assert.ok(g.ratings[g.cur.kind].holesAdded <= 0, `piece ${i} adds holes`);
    g.autoPlace();
  }
  assert.equal(g.over, false);
  g.pieces.forEach((n, k) => assert.ok(n > 0, `${E.KIND_NAMES[k]} never appeared: ${g.pieces}`));
});

// ---- ナチュラル接待モード ----

const setBoard = (g, b) => {
  g.colors = Array.from({ length: H }, (_, y) => Uint8Array.from({ length: W }, (_, x) => (b[y] >> x) & 1));
};
const tall = (n, row) => rows(...Array(n).fill(row));

test("ナチュラル接待: 低くてきれいな盤面では接待せず、7種1巡のランダムで出る", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const g = new E.Game(MODE.NATURAL, E.makeRng(seed));
    const kinds = [g.cur.kind];
    for (let i = 0; i < 6; i++) {
      g.autoPlace();
      kinds.push(g.cur.kind);
    }
    assert.equal(g.assisting, false);
    assert.deepEqual([...kinds].sort(), [0, 1, 2, 3, 4, 5, 6], `seed ${seed}: ${kinds}`);
  }
});

test("ナチュラル接待: 危険な高さまで積み上がると、こっそり接待を始める", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const g = gameWith(MODE.NATURAL, tall(E.NATURAL_ASSIST.startHeight, "#########."), seed);
    assert.equal(g.assisting, true);
    assert.equal(g.cur.kind, I, `seed ${seed}: テトリスできる縦穴には I を出すはず`);
  }
});

test("ナチュラル接待: 低くても穴だらけになると、こっそり接待を始める", () => {
  const g = gameWith(MODE.NATURAL, rows(
    ".#########",
    "#.#.#.#.#.",
    ".#.#.#.#.#",
  ));
  assert.equal(g.assisting, true);
});

test("ナチュラル接待: 始める基準とやめる基準の間では、今の状態を続ける", () => {
  const t = E.NATURAL_ASSIST;
  const middle = tall(t.endHeight + 1, "#########."); // 始める高さより低く、やめる高さより高い
  const g = new E.Game(MODE.NATURAL, E.makeRng(1));
  setBoard(g, middle);

  g.updateAssist(g.bits());
  assert.equal(g.assisting, false, "接待していなければ、まだ始めない");
  g.assisting = true;
  g.updateAssist(g.bits());
  assert.equal(g.assisting, true, "接待中なら、十分に下がるまで続ける");

  setBoard(g, tall(t.endHeight, "#########."));
  g.updateAssist(g.bits());
  assert.equal(g.assisting, false, "やめる高さまで下がったらランダムに戻る");
});

test("ナチュラル接待: 接待中もそうでないときも、コメントで接待していることを匂わせない", () => {
  for (const b of [new Uint16Array(H), tall(14, "#########.")]) {
    const g = gameWith(MODE.NATURAL, b);
    assert.doesNotMatch(g.comment, /接待|どうぞ|ご用意|テトリス/, g.comment);
  }
});

// ---- 鬼モードのお情け ----

test("鬼モード: NEXT を予告し、予告どおりのミノが次に出る", () => {
  const g = new E.Game(MODE.ONI, E.makeRng(3));
  for (let i = 0; i < 20 && !g.over; i++) {
    const announced = g.next;
    assert.notEqual(announced, null);
    assert.match(g.comment, new RegExp(`次は${E.KIND_NAMES[announced]}ミノ`));
    g.autoPlace();
    if (!g.over) assert.equal(g.cur.kind, announced, `piece ${i + 1}`);
  }
});

test("鬼モード: 査定の下位3種からランダムに出す（毎回同じにはならない）", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const g = gameWith(MODE.ONI, tetrisWell, seed);
    const bottom3 = g.ratings.slice().sort((a, b) => a.score - b.score).slice(0, 3).map((r) => r.kind);
    assert.ok(bottom3.includes(g.cur.kind), `seed ${seed}: ${g.cur.kind} not in ${bottom3}`);
    seen.add(g.cur.kind);
  }
  assert.ok(seen.size >= 2, `いつも同じミノ: ${[...seen]}`);
});

test("鬼モード以外では NEXT を出さない（切り替えたら消える）", () => {
  const g = new E.Game(MODE.ONI, E.makeRng(1));
  assert.notEqual(g.next, null);
  g.setMode(MODE.NORMAL);
  g.autoPlace();
  assert.equal(g.next, null);
  assert.equal(E.createApi().state().next, null); // 接待モードで始まる
});

test("AI の計算は1手あたり 50ms 未満", () => {
  const b = rows(
    "##.###.###",
    "#.##.#####",
    "####.##.##",
  );
  E.rateAll(b); // ウォームアップ
  const start = performance.now();
  for (let i = 0; i < 10; i++) E.rateAll(b);
  const ms = (performance.now() - start) / 10;
  assert.ok(ms < 50, `rateAll took ${ms.toFixed(1)}ms`);
  console.log(`rateAll: ${ms.toFixed(1)}ms`);
});
