/*
 * 接待テトリスのゲーム本体と接待AI。画面や音には依存しない。
 * ブラウザでは <script src="engine.js"> で window.SettaiEngine に、Node では require() で使える。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SettaiEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 10;
  const H = 22; // 上2行は画面外の出現エリア
  const HIDDEN = 2;
  const VISIBLE = H - HIDDEN;
  const FULL_ROW = (1 << W) - 1;
  const LOCK_DELAY = 500; // 接地してから固定されるまで（ms）
  const MAX_LOCK_RESETS = 15;

  const KIND_NAMES = ["I", "O", "T", "S", "Z", "J", "L"];
  const NUM_KINDS = 7;
  // 接待 / 通常（7種1巡） / 鬼 / ナチュラル接待（普段は通常、ピンチになったらこっそり接待）
  const MODE = { SETTAI: 0, NORMAL: 1, ONI: 2, NATURAL: 3 };
  const MODE_NAMES = ["接待", "通常", "鬼", "ナチュラル接待"];

  // ナチュラル接待モードで接待を始める・やめる基準。高さは見えている範囲の段数（20段中）、
  // 穴は上がふさがった空きマスの数。始める基準とやめる基準に差をつけて、
  // 境目で接待のオン・オフがパタパタ切り替わらないようにしている。
  // 自動プレイで計測した目安：上手い人には発動せず、ふつうの腕前だと全体の3割ほど接待する。
  const NATURAL_ASSIST = {
    startHeight: 12, // この高さまで積み上がったら接待を始める
    startHoles: 8, // 穴がこれだけ増えたら接待を始める
    endHeight: 8, // 高さがこれ以下 かつ
    endHoles: 4, // 穴がこれ以下まで立て直したら、ランダムに戻る
  };

  // SHAPES[kind][rot] = 4つのブロックの [x, y]（SRS準拠のボックス内座標、yは下向き）
  const SHAPES = [
    [4, [[0, 1], [1, 1], [2, 1], [3, 1]]], // I
    [0, [[1, 0], [2, 0], [1, 1], [2, 1]]], // O（回転しない）
    [3, [[1, 0], [0, 1], [1, 1], [2, 1]]], // T
    [3, [[1, 0], [2, 0], [0, 1], [1, 1]]], // S
    [3, [[0, 0], [1, 0], [1, 1], [2, 1]]], // Z
    [3, [[0, 0], [0, 1], [1, 1], [2, 1]]], // J
    [3, [[2, 0], [0, 1], [1, 1], [2, 1]]], // L
  ].map(([size, cells]) => {
    const rots = [];
    for (let r = 0; r < 4; r++) {
      rots.push(cells);
      if (size) cells = cells.map(([x, y]) => [size - 1 - y, x]); // 時計回りに90度
    }
    return rots;
  });

  // SRS の壁蹴りテーブル（yは下向きに変換済み）。キーは "回転前,回転後"。
  const KICKS_JLSTZ = {
    "0,1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "1,0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "1,2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "2,1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "2,3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "3,2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "3,0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "0,3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  };
  const KICKS_I = {
    "0,1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "1,0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "1,2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    "2,1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "2,3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "3,2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "3,0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "0,3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  };

  // ---- ミノと盤面 ----
  // ミノは { kind, rot, x, y }（x, y はボックス左上の位置）。
  // AI 用の盤面（bitboard）は1行を10ビットで表した長さ22の Uint16Array。

  const piece = (kind, rot, x, y) => ({ kind, rot, x, y });

  function cells(p) {
    return SHAPES[p.kind][p.rot].map(([x, y]) => [x + p.x, y + p.y]);
  }

  function spawnPiece(kind) {
    return piece(kind, 0, 3, kind === 0 ? HIDDEN - 1 : HIDDEN); // I はボックスの2行目なので1つ上げて揃える
  }

  function fits(b, p) {
    const s = SHAPES[p.kind][p.rot];
    for (let i = 0; i < 4; i++) {
      const x = p.x + s[i][0], y = p.y + s[i][1];
      if (x < 0 || x >= W || y < 0 || y >= H || b[y] & (1 << x)) return false;
    }
    return true;
  }

  // placementKey は置いた4マスの位置を1つの数にする（回転が違っても同じ形なら同じ値）。
  // AI の探索で何万回も呼ぶので、配列を作らず4つの値を直接並べ替える。
  function placementKey(p) {
    const s = SHAPES[p.kind][p.rot];
    let a = (s[0][1] + p.y) * W + s[0][0] + p.x;
    let b = (s[1][1] + p.y) * W + s[1][0] + p.x;
    let c = (s[2][1] + p.y) * W + s[2][0] + p.x;
    let d = (s[3][1] + p.y) * W + s[3][0] + p.x;
    let t;
    if (a > b) { t = a; a = b; b = t; }
    if (c > d) { t = c; c = d; d = t; }
    if (a > c) { t = a; a = c; c = t; }
    if (b > d) { t = b; b = d; d = t; }
    if (b > c) { t = b; b = c; c = t; }
    return a + b * 256 + c * 65536 + d * 16777216;
  }

  // ---- 接待AI ----
  // 盤面評価の重み（Pierre Dellacherie の評価関数をベースにしたもの）。
  const W_LANDING = -4.500158825082766;
  const W_ERODED = 3.4181268101392694;
  const W_ROWT = -3.2178882868487753;
  const W_COLT = -9.348695305445199;
  const W_HOLES = -7.899265427351652;
  const W_WELLS = -3.3855972247263626;
  const TOP_OUT_PENALTY = -1e6; // 置き場所がない（ゲームオーバー）
  const DANGER_PENALTY = -500; // 画面外の出現エリアまで積み上がる
  const PICK_TOLERANCE = 1.0; // 最高評価との差がこれ以内なら「同じくらい良い」とみなしてランダムに選ぶ
  // 評価だけで選ぶと I と O ばかり（テトリス量産）になるので、直近 VARIETY_WINDOW 個の中に
  // 出てきた回数ごとに VARIETY_PENALTY だけ評価を下げる。自動プレイで計測し、
  // 穴を作るミノを出さないまま7種がまんべんなく出る値にしてある。
  const VARIETY_WINDOW = 10;
  const VARIETY_PENALTY = 12.0;

  function popcnt(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  const ctz = (m) => 31 - Math.clz32(m & -m);

  // AI の探索は1手で何万回も盤面を評価するので、作業用の配列は使い回す。
  // （入れ子で呼ばれる関数では使わないこと）
  const depthScratch = new Int32Array(W);
  const F = new Int32Array(4); // computeFeatures の結果
  const nbScratch = new Uint16Array(H);
  const followScratch = new Uint16Array(H);
  let simLines = 0; // simulateInto で消えたライン数

  // computeFeatures は盤面の特徴量を数えて F = [rowT, colT, holes, wells] に入れる（1行ずつビット演算でまとめて処理）。
  //   rowT: 横方向の空白⇔ブロックの切り替わり（左右の壁はブロック扱い）
  //   colT: 縦方向の切り替わり（天井は空、床はブロック扱い）
  //   holes: 上にブロックがある空きマス
  //   wells: 両隣が埋まった縦穴の深さの累積（深さ d の井戸は 1+2+…+d）
  function computeFeatures(b) {
    let rowT = 0, colT = 0, holes = 0, wells = 0;
    let roof = 0, prev = 0, prevWell = 0; // roof: ここより上のどこかにブロックがある列
    const depth = depthScratch.fill(0);
    for (let y = 0; y < H; y++) {
      const row = b[y];
      if (row === 0 && roof === 0) continue; // まだ何も積まれていない上空
      if (row !== 0) {
        const v = (row << 1) | 1 | (1 << (W + 1));
        rowT += popcnt((v ^ (v >> 1)) & ((1 << (W + 1)) - 1));
      }
      colT += popcnt(row ^ prev);
      prev = row;
      holes += popcnt(roof & ~row);

      const left = ((row << 1) | 1) & FULL_ROW; // 左隣が埋まっている（左端は壁）
      const right = (row >> 1) | (1 << (W - 1)); // 右隣が埋まっている（右端は壁）
      const well = ~row & ~roof & left & right & FULL_ROW;
      for (let m = prevWell & ~well; m !== 0; m &= m - 1) depth[ctz(m)] = 0;
      for (let m = well; m !== 0; m &= m - 1) {
        const x = ctz(m);
        depth[x]++;
        wells += depth[x];
      }
      prevWell = well;
      roof |= row;
    }
    colT += popcnt(~prev & FULL_ROW); // 床は埋まっている
    F[0] = rowT;
    F[1] = colT;
    F[2] = holes;
    F[3] = wells;
  }

  function features(b) {
    computeFeatures(b);
    return Array.from(F);
  }

  function countHoles(b) {
    computeFeatures(b);
    return F[2];
  }

  // simulateInto はミノ p を置いてライン消去した盤面を out に書き、その手の評価値を返す。
  // 消えたライン数は simLines に入る。
  function simulateInto(b, p, out) {
    const nb = nbScratch;
    nb.set(b);
    const s = SHAPES[p.kind][p.rot];
    let minY = H, maxY = -1;
    for (let i = 0; i < 4; i++) {
      const y = p.y + s[i][1];
      nb[y] |= 1 << (p.x + s[i][0]);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    let lines = 0, eroded = 0, dst = H - 1;
    for (let y = H - 1; y >= 0; y--) {
      if (nb[y] === FULL_ROW) {
        lines++;
        for (let i = 0; i < 4; i++) if (p.y + s[i][1] === y) eroded++;
        continue;
      }
      out[dst--] = nb[y];
    }
    for (; dst >= 0; dst--) out[dst] = 0;

    const landing = (H - 1 - maxY) + (maxY - minY) / 2;
    computeFeatures(out);
    let score = W_LANDING * landing +
      W_ERODED * (lines * eroded) +
      W_ROWT * F[0] +
      W_COLT * F[1] +
      W_HOLES * F[2] +
      W_WELLS * F[3];
    for (let y = 0; y < HIDDEN; y++) {
      if (out[y] !== 0) {
        score += DANGER_PENALTY;
        break;
      }
    }
    simLines = lines;
    return score;
  }

  // simulate は simulateInto の結果を新しいオブジェクトで返す（テスト・確認用）。
  function simulate(b, p) {
    const board = new Uint16Array(H);
    const score = simulateInto(b, p, board);
    return { board, score, lines: simLines };
  }

  // 着地位置を素早く求めるための、ミノの形の下準備（各列の一番下のブロック）。
  const SHAPE_INFO = SHAPES.map((rots) => rots.map((cs) => {
    const xs = cs.map((c) => c[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const bottoms = [];
    for (let x = minX; x <= maxX; x++) {
      bottoms.push([x, Math.max(...cs.filter((c) => c[0] === x).map((c) => c[1]))]);
    }
    return { minX, maxX, bottoms };
  }));

  // dropSlow は一番上（y=0）から1マスずつ落として着地位置を求める。置けなければ null。
  function dropSlow(b, p) {
    if (!fits(b, p)) return null;
    for (;;) {
      const q = piece(p.kind, p.rot, p.x, p.y + 1);
      if (!fits(b, q)) return p;
      p = q;
    }
  }

  // forEachPlacement は「回転して横に動かして真下に落とす」で置ける場所をすべて列挙する。
  function forEachPlacement(b, kind, fn) {
    // fn の中から入れ子で呼ばれる（2手先読み）ので、作業用の配列は呼び出しごとに作る
    const tops = new Int32Array(W).fill(H);
    let highest = H;
    let rest = FULL_ROW;
    for (let y = 0; y < H && rest !== 0; y++) {
      for (let m = b[y] & rest; m !== 0; m &= m - 1) {
        tops[ctz(m)] = y;
        if (y < highest) highest = y;
      }
      rest &= ~b[y];
    }
    // 一番上の4段にブロックがあると「列の一番上」だけでは着地位置が決まらないので、1マスずつ落とす
    const slow = highest < 4;

    const seen = [];
    for (const rot of [0, 1, 3, 2]) { // 回転回数が少ない順
      const si = SHAPE_INFO[kind][rot];
      for (let x = -si.minX; x + si.maxX < W; x++) {
        let p;
        if (slow) {
          p = dropSlow(b, piece(kind, rot, x, 0));
          if (!p) continue;
        } else {
          let y = H;
          for (const [bx, by] of si.bottoms) y = Math.min(y, tops[x + bx] - 1 - by);
          p = piece(kind, rot, x, y);
        }
        // I・S・Z などは回転が違っても同じ形になるので重複を除く
        const key = placementKey(p);
        if (seen.includes(key)) continue;
        seen.push(key);
        fn(p);
      }
    }
  }

  // bestFollowUp は次に「一番都合の良いミノ」を出したときの最高評価値。
  // 接待モードでは次のミノもこちらで選べるので、全種類の最大値を使ってよい。
  function bestFollowUp(b) {
    let best = TOP_OUT_PENALTY;
    for (let k = 0; k < NUM_KINDS; k++) {
      forEachPlacement(b, k, (p) => {
        const s = simulateInto(b, p, followScratch);
        if (s > best) best = s;
      });
    }
    return best;
  }

  // rateAll は全7種のミノについて、今出したらどれだけ都合が良いかを2手先まで読んで査定する。
  // 結果は { kind, score, best（最善の置き場所）, lines（最善手で消えるライン数）, holesAdded } の配列。
  function rateAll(b) {
    const holesBefore = countHoles(b);
    const rs = [];
    for (let k = 0; k < NUM_KINDS; k++) {
      const r = { kind: k, score: -Infinity, best: spawnPiece(k), lines: 0, holesAdded: 0 };
      const after = new Uint16Array(H); // 1手目を置いた後の盤面（2手目を読む間は書き換えない）
      forEachPlacement(b, k, (p) => {
        const score = simulateInto(b, p, after);
        const lines = simLines; // bestFollowUp で上書きされる前に取っておく
        const s = score + bestFollowUp(after);
        if (s > r.score) {
          r.score = s;
          r.best = p;
          r.lines = lines;
          r.holesAdded = countHoles(after) - holesBefore;
        }
      });
      if (r.score === -Infinity) r.score = 2 * TOP_OUT_PENALTY;
      rs.push(r);
    }
    return rs;
  }

  // withVariety は最近出したミノの評価を少し下げたコピーを返す（接待モード用）。
  function withVariety(rs, recent) {
    const last = recent.slice(-VARIETY_WINDOW);
    return rs.map((r) => ({ ...r, score: r.score - VARIETY_PENALTY * last.filter((k) => k === r.kind).length }));
  }

  // pick は sign=1 なら最高評価、sign=-1 なら最低評価のミノを選ぶ（僅差ならランダム）。
  function pick(rs, rng, sign) {
    const best = Math.max(...rs.map((r) => sign * r.score));
    const cands = rs.filter((r) => sign * r.score >= best - PICK_TOLERANCE);
    return cands[rng.int(cands.length)].kind;
  }
  const pickBest = (rs, rng) => pick(rs, rng, 1);
  const pickWorst = (rs, rng) => pick(rs, rng, -1);

  // 鬼モードのお情け。毎回最悪のミノだと攻略不可能なので手加減する。
  //   choices: 評価の低い方から何種類の中からランダムに選ぶか（1 なら常に最悪）
  //   next: 次のミノまで先に決めて NEXT に表示するか
  const ONI_MERCY = { choices: 3, next: true };

  // pickOni は評価の低い方から choices 種類の中からランダムに1つ選ぶ。
  function pickOni(rs, rng) {
    if (ONI_MERCY.choices <= 1) return pickWorst(rs, rng);
    const worst = rs.slice().sort((a, b) => a.score - b.score).slice(0, ONI_MERCY.choices);
    return worst[rng.int(worst.length)].kind;
  }

  // ---- 乱数（テストで再現できるようにシード付き） ----

  function makeRng(seed = Math.floor(Math.random() * 2 ** 32)) {
    let a = seed >>> 0;
    const next = () => { // mulberry32
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      int: (n) => Math.floor(next() * n),
      perm(n) {
        const a = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
    };
  }

  // ---- ゲーム本体 ----

  const LINE_SCORES = [0, 100, 300, 500, 800];
  const PRAISE = ["", "ナイス！1ライン消去！", "お見事！2ライン消去！", "すごい！3ライン消去！", "テトリス！！最高です！"];

  class Game {
    constructor(mode = MODE.SETTAI, rng = makeRng()) {
      this.colors = Array.from({ length: H }, () => new Uint8Array(W)); // 0 は空、それ以外は kind+1
      this.mode = mode;
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.over = false;
      this.paused = false;
      this.cur = null;
      this.hint = null; // AI のおすすめ置き場所
      this.ratings = []; // 直近のミノ査定
      this.comment = ""; // 接待AIのひとこと
      this.pieces = new Array(NUM_KINDS).fill(0); // 出現したミノの数
      this.assisting = false; // ナチュラル接待モードで、今こっそり接待しているか
      this.next = null; // 鬼モードで先に決めた次のミノ（それ以外のモードは null）
      this.events = []; // 効果音・演出のための出来事
      this.fallTimer = 0;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.history = []; // 最近出したミノ
      this.bag = [];
      this.rng = rng;
      this.spawn("");
    }

    takeEvents() {
      const evs = this.events;
      this.events = [];
      return evs;
    }

    emit(type, extra) { this.events.push({ type, lines: 0, rows: [], ...extra }); }

    bits() {
      const b = new Uint16Array(H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) if (this.colors[y][x]) b[y] |= 1 << x;
      }
      return b;
    }

    // 積み上がっている高さ（見えている範囲で、0〜20）
    stackHeight() {
      for (let y = 0; y < H; y++) if (this.colors[y].some((v) => v)) return H - y;
      return 0;
    }

    // 1マス落下するまでの時間（ms、ガイドラインの式）
    gravity() {
      const base = 0.8 - (this.level - 1) * 0.007;
      return Math.max(1000 * base ** (this.level - 1), 20);
    }

    active() { return !this.over && !this.paused; }

    onGround() {
      return !fits(this.bits(), piece(this.cur.kind, this.cur.rot, this.cur.x, this.cur.y + 1));
    }

    tryMove(dx, dy) {
      const p = piece(this.cur.kind, this.cur.rot, this.cur.x + dx, this.cur.y + dy);
      if (!fits(this.bits(), p)) return false;
      this.cur = p;
      return true;
    }

    // 接地中に動かしたら固定までの猶予を延ばす（回数制限あり）
    resetLock() {
      if (this.lockResets < MAX_LOCK_RESETS && this.lockTimer > 0) {
        this.lockTimer = 0;
        this.lockResets++;
      }
    }

    move(dx) {
      if (!this.active() || !this.tryMove(dx, 0)) return false;
      this.resetLock();
      this.emit("move");
      return true;
    }

    // dir=1 で時計回り、dir=-1 で反時計回り
    rotate(dir) {
      if (!this.active() || this.cur.kind === 1) return false;
      const from = this.cur.rot;
      const to = (from + dir + 4) % 4;
      const table = this.cur.kind === 0 ? KICKS_I : KICKS_JLSTZ;
      const b = this.bits();
      for (const [kx, ky] of table[from + "," + to]) {
        const p = piece(this.cur.kind, to, this.cur.x + kx, this.cur.y + ky);
        if (fits(b, p)) {
          this.cur = p;
          this.resetLock();
          this.emit("rotate");
          return true;
        }
      }
      return false;
    }

    softDrop() {
      if (!this.active() || !this.tryMove(0, 1)) return false;
      this.score++;
      this.fallTimer = 0;
      this.lockTimer = 0;
      this.emit("softdrop");
      return true;
    }

    hardDrop() {
      if (!this.active()) return false;
      while (this.tryMove(0, 1)) this.score += 2;
      this.emit("harddrop");
      this.lock();
      return true;
    }

    // AI のおすすめ位置にそのまま置く（タイトル画面のデモ用）
    autoPlace() {
      if (!this.active()) return false;
      this.cur = this.hint;
      return this.hardDrop();
    }

    // ハードドロップした場合の着地位置
    ghost() {
      const b = this.bits();
      let p = this.cur;
      for (;;) {
        const q = piece(p.kind, p.rot, p.x, p.y + 1);
        if (!fits(b, q)) return p;
        p = q;
      }
    }

    ghostMatchesHint() { return placementKey(this.ghost()) === placementKey(this.hint); }

    togglePause() {
      if (!this.over) this.paused = !this.paused;
    }

    // 次に出てくるミノから新しいモードを適用する
    setMode(m) {
      this.mode = m;
      this.assisting = false;
      this.next = null;
      if (!this.over) this.comment = `次のミノから${MODE_NAMES[m]}モードです。`;
    }

    // ナチュラル接待: ピンチ（高く積み上がった・穴だらけ）になったら接待を始め、十分に立て直したらやめる
    updateAssist(b) {
      const height = this.stackHeight();
      const holes = countHoles(b);
      const t = NATURAL_ASSIST;
      if (this.assisting) {
        if (height <= t.endHeight && holes <= t.endHoles) this.assisting = false;
      } else if (height >= t.startHeight || holes >= t.startHoles) {
        this.assisting = true;
      }
    }

    // 時間（ms）を進める。画面の更新が必要なら true
    tick(dt) {
      if (!this.active()) return false;
      if (this.onGround()) {
        this.lockTimer += dt;
        if (this.lockTimer >= LOCK_DELAY) {
          this.emit("lock");
          this.lock();
          return true;
        }
        return false;
      }
      let changed = false;
      this.fallTimer += dt;
      while (this.fallTimer >= this.gravity()) {
        this.fallTimer -= this.gravity();
        if (!this.tryMove(0, 1)) {
          this.fallTimer = 0;
          break;
        }
        this.lockTimer = 0;
        changed = true;
      }
      return changed;
    }

    lock() {
      for (const [x, y] of cells(this.cur)) this.colors[y][x] = this.cur.kind + 1;

      const rows = [];
      let dst = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        if (this.colors[y].every((v) => v)) {
          rows.push(y - HIDDEN);
          continue;
        }
        this.colors[dst--] = this.colors[y];
      }
      for (; dst >= 0; dst--) this.colors[dst] = new Uint8Array(W);

      let praise = "";
      if (rows.length > 0) {
        const level = this.level;
        this.score += LINE_SCORES[rows.length] * this.level;
        this.lines += rows.length;
        this.level = Math.floor(this.lines / 10) + 1;
        this.emit("clear", { lines: rows.length, rows });
        if (this.level > level) this.emit("levelup");
        if (this.mode !== MODE.ONI) praise = PRAISE[rows.length] + "\n";
      }
      this.spawn(praise);
    }

    nextFromBag() {
      if (this.bag.length === 0) this.bag = this.rng.perm(NUM_KINDS);
      return this.bag.shift();
    }

    spawn(praise) {
      const b = this.bits();
      this.ratings = rateAll(b);

      let k;
      if (this.mode === MODE.NATURAL) this.updateAssist(b);
      if (this.mode === MODE.SETTAI || (this.mode === MODE.NATURAL && this.assisting)) {
        // 査定表示も実際の判断と一致するよう、補正後の評価を保存する
        this.ratings = withVariety(this.ratings, this.history);
        k = pickBest(this.ratings, this.rng);
      } else if (this.mode === MODE.ONI) {
        // NEXT を出しているなら、前回予告したミノを出す
        k = this.next !== null ? this.next : pickOni(this.ratings, this.rng);
        this.next = null;
      } else {
        k = this.nextFromBag();
      }
      this.history.push(k);
      if (this.history.length > 16) this.history.shift();

      this.cur = spawnPiece(k);
      this.hint = this.ratings[k].best;
      this.pieces[k]++;
      this.fallTimer = this.lockTimer = this.lockResets = 0;

      // 積み上がっていたら出現エリア内で少し上にずらして粘る
      for (let i = 0; !fits(b, this.cur); i++) {
        if (i === HIDDEN || this.cur.y === 0) {
          this.over = true;
          this.comment = "ゲームオーバー…\nR キーでもう一度遊べます。";
          this.emit("gameover");
          return;
        }
        this.cur = piece(this.cur.kind, this.cur.rot, this.cur.x, this.cur.y - 1);
      }
      if (this.mode === MODE.ONI && ONI_MERCY.next) {
        // 次のミノは「今のミノを一番良い場所に置いた後の盤面」で困るものを先に決めて予告する。
        // 違う場所に置けば鬼の読みを外せる、というのがお情け。
        this.next = pickOni(rateAll(simulate(b, this.hint).board), this.rng);
      }
      this.comment = praise + this.commentFor(this.ratings[k]);
    }

    commentFor(r) {
      const name = KIND_NAMES[r.kind] + "ミノ";
      if (this.mode === MODE.NORMAL) {
        return `${name}が来ました（通常モード）。\n接待AIなら ${KIND_NAMES[pickBest(this.ratings, this.rng)]}ミノを出していました。`;
      }
      if (this.mode === MODE.ONI) {
        if (this.next !== null) return `${name}です。次は${KIND_NAMES[this.next]}ミノ。\n…お情けで教えてあげます。`;
        return `${name}です。\n…どこに置くか、せいぜい悩んでください。`;
      }
      // こっそり接待中だと気づかれないよう、どちらのときも同じ中立的なひとことにする
      if (this.mode === MODE.NATURAL) return `${name}が来ました。`;
      if (r.lines === 4) return `${name}をご用意しました！\n縦に差し込めばテトリスです！`;
      if (r.lines > 0) return `${name}をどうぞ！\n${r.lines}ライン消せる場所があります。`;
      if (r.holesAdded === 0) return `${name}をどうぞ！\n穴を作らずにピッタリはまります。`;
      return `${name}が一番マシでした…\n至らずすみません。`;
    }

    // 7種類のミノを「都合の良さ」順に並べる。僅差なら実際に出したミノを上にする。
    // 結果は { kind, frac（最良1〜最悪0）, current } の配列。
    ranking() {
      const isCur = (k) => !this.over && k === this.cur.kind;
      const rank = (r) => (isCur(r.kind) ? r.score + PICK_TOLERANCE : r.score);
      const sorted = this.ratings.slice().sort((a, b) => rank(b) - rank(a)); // 同点は種類順のまま（安定ソート）
      const scores = this.ratings.map((r) => r.score);
      const best = Math.max(...scores), worst = Math.min(...scores);
      return sorted.map((r) => ({
        kind: r.kind,
        frac: best > worst ? (r.score - worst) / (best - worst) : 1,
        current: isCur(r.kind),
      }));
    }
  }

  // ---- 画面側（app.js）から使う窓口 ----

  function createApi(rng = makeRng()) {
    let game = new Game(MODE.SETTAI, rng);
    const visible = (p) => cells(p).map(([x, y]) => [x, y - HIDDEN]);
    return {
      width: W,
      height: VISIBLE,
      shapes: SHAPES.map((rots) => rots[0]),
      get game() { return game; },
      newGame(mode) { game = new Game(mode, rng); },
      tick(ms) { return game.tick(ms); },
      input(action) {
        switch (action) {
          case "left": return game.move(-1);
          case "right": return game.move(1);
          case "soft": return game.softDrop();
          case "hard": return game.hardDrop();
          case "cw": return game.rotate(1);
          case "ccw": return game.rotate(-1);
          case "auto": return game.autoPlace();
        }
        return false;
      },
      setMode(m) { game.setMode(m); },
      togglePause() {
        game.togglePause();
        return game.paused;
      },
      events() { return game.takeEvents(); },
      state() {
        const board = new Uint8Array(VISIBLE * W); // 0=空、1〜7=ミノの種類+1
        for (let y = 0; y < VISIBLE; y++) board.set(game.colors[y + HIDDEN], y * W);
        return {
          board,
          kind: game.cur.kind,
          cur: visible(game.cur),
          ghost: visible(game.ghost()),
          hint: visible(game.hint),
          hintMatch: game.ghostMatchesHint(),
          score: game.score,
          lines: game.lines,
          level: game.level,
          over: game.over,
          paused: game.paused,
          mode: game.mode,
          assisting: game.assisting, // こっそり接待中か（画面には出さない。開発者ツールでの確認用）
          next: game.over ? null : game.next, // 鬼モードの NEXT（ミノの種類。ないときは null）
          comment: game.comment,
          stack: game.stackHeight(),
          ranking: game.ranking(),
        };
      },
    };
  }

  return {
    W, H, HIDDEN, VISIBLE, MODE, MODE_NAMES, KIND_NAMES, SHAPES, NATURAL_ASSIST, ONI_MERCY,
    piece, cells, fits, placementKey, features, simulate, forEachPlacement, dropSlow, rateAll,
    withVariety, pickBest, pickWorst, makeRng, Game, createApi,
  };
});
