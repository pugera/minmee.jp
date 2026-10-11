"use strict";

// 接待テトリス（ブラウザ版）の画面・入力・演出。
// ゲーム本体と接待AIは engine.js（SettaiEngine）にある。

(() => {
  const COLORS = ["#00c8e6", "#f0c800", "#aa46d2", "#46c850", "#e63c46", "#3264eb", "#f58c1e"]; // I O T S Z J L
  // モードの値は engine.js の MODE と同じ（0:接待 1:通常 2:鬼Lv2 3:ナチュラル接待 4:鬼Lv1 5:鬼Lv3）
  const { MODE, MODE_NAMES } = SettaiEngine;
  const MODE_LABELS = ["接待", "通常", "鬼Lv2", "ナチュラル", "鬼Lv1", "鬼Lv3"]; // ボタン用の短い名前
  // ボタンと 1〜6 キーの並び（手厚い順）
  const MODE_ORDER = [MODE.SETTAI, MODE.NATURAL, MODE.NORMAL, MODE.ONI1, MODE.ONI2, MODE.ONI3];
  const MODE_DESC = [
    "盤面を見て、毎回あなたに一番都合の良いミノをお出しします。",
    "普通のテトリスと同じ、7種1巡のランダムです。",
    "あなたが困るミノの下位3種からしか出しません。お情けで NEXT だけは教えてあげます。",
    "普段は普通のランダム。積み上がって危なくなったり穴だらけになってきたら、気づかれないようにこっそり接待します。",
    "あなたが困るミノほど出やすくなっています。良いミノはめったに出ません。NEXT 付き。",
    "あなたが困るミノの下位3種からしか出しません。NEXT も教えません。置き方を見てから、困るミノを選びます。",
  ];
  const CLEAR_TEXT = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS!!"];
  const DAS = 160; // 長押しで連続移動が始まるまで（ms）
  const ARR = 45; // 連続移動の間隔（ms）
  const SOFT_RATE = 40; // ソフトドロップの間隔（ms）
  const DEMO_RATE = 550; // タイトル画面のデモでミノを置く間隔（ms）

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");

  // ---- 設定（ブラウザに保存。使えない環境でも動くようにする） ----

  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem("settai." + key);
        return v === null ? def : JSON.parse(v);
      } catch {
        return def;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("settai." + key, JSON.stringify(value));
      } catch { /* 保存できなくても続行 */ }
    },
  };
  const settings = {
    mode: store.get("mode", 0),
    hint: store.get("hint", true),
    bgm: store.get("bgm", true),
    se: store.get("se", true),
    vol: store.get("vol", 70),
  };
  const save = () => Object.entries(settings).forEach(([k, v]) => store.set(k, v));

  const sound = new SettaiSound();
  sound.volume = settings.vol / 100;
  sound.bgmOn = settings.bgm;
  sound.seOn = settings.se;

  let api = null; // ゲーム本体の窓口（SettaiEngine.createApi）
  let st = null; // 最新のゲーム状態
  let phase = "loading"; // loading → title（デモ） → playing
  let dirty = true;
  let demoTimer = 0;
  let prevHintMatch = false;
  const fx = { flashes: [], particles: [], texts: [], shakeUntil: 0, shakeMag: 0, shakeLen: 1 };

  // ---- エラー表示 ----

  function showError(msg) {
    const el = $("error");
    el.hidden = false;
    el.textContent = msg;
  }
  window.addEventListener("error", (e) => showError("エラー: " + e.message));
  window.addEventListener("unhandledrejection", (e) => showError("エラー: " + (e.reason && e.reason.message || e.reason)));


  // ---- ゲーム操作 ----

  function act(action) {
    if (phase !== "playing" || !api) return false;
    const ok = api.input(action);
    if (ok) dirty = true;
    return ok;
  }

  function startGame() {
    if (!api) return;
    sound.unlock();
    api.newGame(settings.mode);
    phase = "playing";
    $("startOverlay").hidden = true;
    resetFx();
    releaseAll();
    dirty = true;
    prevHintMatch = false;
    sound.se("start");
    sound.startBgm();
  }

  function togglePause() {
    if (phase !== "playing" || !st || st.over) return;
    const paused = api.togglePause();
    dirty = true;
    releaseAll();
    sound.se("pause");
    if (paused) sound.pauseBgm();
    else sound.resumeBgm();
  }

  function setMode(m) {
    if (m === settings.mode && phase !== "playing") return;
    settings.mode = m;
    save();
    syncSettingsUI();
    sound.se("select");
    if (phase === "playing") {
      api.setMode(m);
      dirty = true;
    }
  }

  function setOption(name, value) {
    settings[name] = value;
    save();
    if (name === "bgm") sound.setBgm(value);
    if (name === "se") sound.setSe(value);
    if (name === "vol") sound.setVolume(value / 100);
    syncSettingsUI();
    dirty = true;
  }

  // ---- キー入力（長押しの連続移動は自前で制御する） ----

  const held = { left: null, right: null, down: null };

  function press(dir) {
    if (dir === "down") {
      held.down = { t: 0 };
      act("soft");
      return;
    }
    held[dir === "left" ? "right" : "left"] = null; // 後から押した方向を優先
    held[dir] = { t: 0, done: 0 };
    act(dir);
  }

  function release(dir) { held[dir] = null; }
  function releaseAll() { held.left = held.right = held.down = null; }

  function handleHeld(dt) {
    for (const dir of ["left", "right"]) {
      const h = held[dir];
      if (!h) continue;
      h.t += dt;
      if (h.t < DAS) continue;
      const n = Math.floor((h.t - DAS) / ARR) + 1;
      while (h.done < n) {
        h.done++;
        act(dir);
      }
    }
    if (held.down) {
      held.down.t += dt;
      while (held.down.t >= SOFT_RATE) {
        held.down.t -= SOFT_RATE;
        act("soft");
      }
    }
  }

  const MOVE_KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down" };

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // ブラウザのショートカットは邪魔しない
    const code = e.code;
    const slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5,
      Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5 }[code];
    const modeKey = slot === undefined ? undefined : MODE_ORDER[slot];

    if (phase === "title") {
      if (code === "Enter" || code === "Space") {
        e.preventDefault();
        startGame();
      } else if (modeKey !== undefined) {
        setMode(modeKey);
      }
      return;
    }
    if (phase !== "playing") return;

    const gameKeys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyX", "KeyZ",
      "KeyH", "KeyP", "Escape", "KeyR", "F2", "KeyM", "KeyN"];
    if (!gameKeys.includes(code) && modeKey === undefined) return;
    e.preventDefault();
    if (e.repeat) return; // キーリピートは使わない

    if (MOVE_KEYS[code]) return press(MOVE_KEYS[code]);
    if (modeKey !== undefined) return setMode(modeKey);
    switch (code) {
      case "ArrowUp": case "KeyX": act("cw"); break;
      case "KeyZ": act("ccw"); break;
      case "Space": act("hard"); break;
      case "KeyH": setOption("hint", !settings.hint); break;
      case "KeyP": case "Escape": togglePause(); break;
      case "KeyR": case "F2": startGame(); break;
      case "KeyM": setOption("bgm", !settings.bgm); break;
      case "KeyN": setOption("se", !settings.se); break;
    }
  }, true);

  window.addEventListener("keyup", (e) => {
    if (MOVE_KEYS[e.code]) release(MOVE_KEYS[e.code]);
  });
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    // 別のタブに移ったら自動で一時停止
    if (document.hidden && phase === "playing" && st && !st.over && !st.paused) togglePause();
  });

  // ---- タッチ操作 ----

  for (const btn of document.querySelectorAll("[data-touch]")) {
    const a = btn.dataset.touch;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (phase === "title") return startGame();
      if (a === "left" || a === "right" || a === "down") press(a);
      else act(a);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
      btn.addEventListener(ev, () => {
        if (a === "left" || a === "right" || a === "down") release(a);
      });
    }
  }

  // ---- 設定パネル ----

  // ボタン類がキーボードのフォーカスを持たないようにする（Space でボタンが押されるのを防ぐ）
  function noFocus(el) {
    el.tabIndex = -1;
    el.addEventListener("mousedown", (e) => e.preventDefault());
  }

  for (const group of document.querySelectorAll("[data-modes]")) {
    MODE_ORDER.forEach((m) => {
      const b = document.createElement("button");
      b.textContent = MODE_LABELS[m];
      b.dataset.mode = m;
      noFocus(b);
      b.addEventListener("click", () => setMode(m));
      group.appendChild(b);
    });
  }
  noFocus($("startBtn"));
  $("startBtn").addEventListener("click", startGame);
  noFocus($("btnPause"));
  $("btnPause").addEventListener("click", togglePause);
  noFocus($("btnNew"));
  $("btnNew").addEventListener("click", startGame);

  for (const [id, name] of [["optHint", "hint"], ["optBgm", "bgm"], ["optSe", "se"]]) {
    const el = $(id);
    el.addEventListener("change", () => {
      sound.unlock();
      setOption(name, el.checked);
      el.blur();
    });
  }
  $("optVol").addEventListener("input", (e) => setOption("vol", Number(e.target.value)));
  $("optVol").addEventListener("change", (e) => e.target.blur());

  function syncSettingsUI() {
    for (const b of document.querySelectorAll("[data-modes] button")) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.mode) === settings.mode));
    }
    $("modeDesc").textContent = MODE_DESC[settings.mode];
    $("optHint").checked = settings.hint;
    $("optBgm").checked = settings.bgm;
    $("optSe").checked = settings.se;
    $("optVol").value = settings.vol;
  }

  // ---- ミノ査定（7種類の並べ替えをアニメーションで見せる） ----

  const ROW_H = 28;
  const rankRows = [];

  function buildRanking() {
    const box = $("ranking");
    api.shapes.forEach((cells, kind) => {
      const row = document.createElement("div");
      row.className = "rank-row";
      row.innerHTML = '<span class="rank-no"></span><canvas class="rank-icon"></canvas><div class="rank-bar"><i></i></div>';
      drawIcon(row.querySelector("canvas"), cells, COLORS[kind]);
      row.querySelector("i").style.background = COLORS[kind];
      row.style.top = kind * ROW_H + "px";
      box.appendChild(row);
      rankRows[kind] = row;
    });
  }

  function drawIcon(cv, cells, color) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = 40 * dpr;
    cv.height = 20 * dpr;
    const c = cv.getContext("2d");
    const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
    const s = Math.floor(Math.min(cv.width / 4, cv.height / 2));
    const ox = (cv.width - w * s) / 2, oy = (cv.height - h * s) / 2;
    c.fillStyle = color;
    for (const [x, y] of cells) c.fillRect(ox + (x - minX) * s, oy + (y - minY) * s, s - dpr, s - dpr);
  }

  // ---- パネル更新 ----

  function updatePanel() {
    $("mode").textContent = MODE_NAMES[st.mode] + "モード";
    $("mode").dataset.mode = st.mode;
    $("score").textContent = st.score.toLocaleString();
    $("lines").textContent = st.lines;
    $("level").textContent = st.level;
    $("btnPause").firstChild.textContent = st.paused ? "再開 " : "一時停止 ";

    const comment = $("comment");
    if (comment.textContent !== st.comment) {
      comment.textContent = st.comment;
      comment.classList.remove("pop");
      void comment.offsetWidth; // アニメーションをやり直す
      comment.classList.add("pop");
    }

    // ナチュラル接待では、接待中に出したミノが毎回1位になって気づかれてしまうので査定を隠す
    $("rankingCard").hidden = st.mode === MODE.NATURAL;

    // 鬼モードのお情けの NEXT
    const nextBox = $("nextBox");
    nextBox.hidden = st.next === null || phase !== "playing";
    if (!nextBox.hidden && nextBox.dataset.kind !== String(st.next)) {
      drawNext(st.next);
      nextBox.dataset.kind = st.next;
    }
    nextBox.classList.toggle("faded", st.stack >= 16);
    st.ranking.forEach((r, i) => {
      const row = rankRows[r.kind];
      row.style.top = i * ROW_H + "px";
      row.querySelector(".rank-no").textContent = i + 1 + "位";
      row.querySelector("i").style.width = (6 + 94 * r.frac).toFixed(1) + "%";
      row.classList.toggle("current", r.current);
    });
  }

  // ---- 出来事（効果音・演出） ----

  function handleEvents(evs) {
    if (evs.length) dirty = true; // 何か起きたら次のフレームで必ず画面を更新する
    const playing = phase === "playing";
    const se = (name, arg) => { if (playing) sound.se(name, arg); };
    const hard = evs.some((e) => e.type === "harddrop");
    for (const e of evs) {
      switch (e.type) {
        case "move": se("move"); break;
        case "rotate": se("rotate"); break;
        case "softdrop": se("soft"); break;
        case "harddrop": se("hard"); shake(playing ? 4 : 0, 120); break;
        case "lock": if (!hard) se("lock"); break;
        case "clear":
          se("clear", e.lines);
          lineClearFx(e.rows, e.lines);
          break;
        case "levelup":
          se("levelup");
          popText("LEVEL UP!", "#7ab8ff", .6);
          break;
        case "gameover":
          se("gameover");
          sound.stopBgm();
          break;
      }
    }
  }

  function resetFx() {
    fx.flashes = [];
    fx.particles = [];
    fx.texts = [];
    fx.shakeUntil = 0;
  }

  function shake(mag, ms) {
    if (!mag) return;
    fx.shakeMag = mag;
    fx.shakeLen = ms;
    fx.shakeUntil = performance.now() + ms;
  }

  function popText(text, color, y = .45) {
    fx.texts = fx.texts.filter((t) => t.y !== y); // 同じ位置の古い文字は消して重ならないようにする
    fx.texts.push({ text, color, y, born: performance.now() });
  }

  function lineClearFx(rows, lines) {
    const now = performance.now();
    for (const row of rows) {
      fx.flashes.push({ row, born: now });
      for (let i = 0; i < 6 + lines * 3; i++) {
        fx.particles.push({
          x: Math.random() * 10, y: row + .5,
          vx: (Math.random() - .5) * 8, vy: -Math.random() * 9 - 2,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          born: now, life: 600 + Math.random() * 500,
        });
      }
    }
    popText(CLEAR_TEXT[lines], lines === 4 ? "#ffd23c" : "#ffffff");
    if (lines === 4) shake(9, 300);
  }

  // ---- 描画 ----

  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    return `rgb(${ch(n >> 16)},${ch(n >> 8 & 255)},${ch(n & 255)})`;
  };
  const LIGHT = COLORS.map((c) => shade(c, .45));
  const DARK = COLORS.map((c) => shade(c, -.45));

  // paintBlock は立体感のあるブロックを1マス描く（左上 x, y・大きさ s はピクセル）。
  function paintBlock(c, x, y, s, kind) {
    const b = Math.max(1, Math.round(s / 14));
    c.fillStyle = DARK[kind];
    c.fillRect(x, y, s, s);
    c.fillStyle = LIGHT[kind];
    c.fillRect(x + b, y + b, s - 3 * b, s - 3 * b);
    c.fillStyle = COLORS[kind];
    c.fillRect(x + 3 * b, y + 3 * b, s - 5 * b, s - 5 * b);
    c.fillStyle = "rgba(255,255,255,.14)";
    c.fillRect(x + 3 * b, y + 3 * b, s - 5 * b, Math.round(s * .18));
  }

  // drawNext は鬼モードの NEXT 窓にミノを描く。
  function drawNext(kind) {
    const cv = $("nextCanvas");
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const c = cv.getContext("2d");
    const cells = api.shapes[kind];
    const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
    const s = Math.floor(Math.min(cv.width / 4.4, cv.height / 2.2));
    const ox = Math.round((cv.width - w * s) / 2), oy = Math.round((cv.height - h * s) / 2);
    for (const [x, y] of cells) paintBlock(c, ox + (x - minX) * s, oy + (y - minY) * s, s, kind);
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    delete $("nextBox").dataset.kind; // NEXT 窓も描き直す
    dirty = true;
  }
  new ResizeObserver(resizeCanvas).observe(canvas);

  function render(now) {
    const W = canvas.width, H = canvas.height;
    const cs = Math.floor(Math.min(W / 10, H / 20));
    const ox = Math.floor((W - cs * 10) / 2), oy = Math.floor((H - cs * 20) / 2);
    const px = (x) => ox + x * cs, py = (y) => oy + y * cs;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0e0e14";
    ctx.fillRect(0, 0, W, H);
    if (now < fx.shakeUntil) {
      const k = fx.shakeMag * (fx.shakeUntil - now) / fx.shakeLen * (window.devicePixelRatio || 1);
      ctx.translate((Math.random() - .5) * 2 * k, (Math.random() - .5) * 2 * k);
    }

    // マス目
    ctx.strokeStyle = "#1c1c28";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < 10; x++) { ctx.moveTo(px(x) + .5, py(0)); ctx.lineTo(px(x) + .5, py(20)); }
    for (let y = 1; y < 20; y++) { ctx.moveTo(px(0), py(y) + .5); ctx.lineTo(px(10), py(y) + .5); }
    ctx.stroke();

    const block = (x, y, kind) => {
      if (y >= 0) paintBlock(ctx, px(x), py(y), cs, kind);
    };
    const outline = (x, y, color, inset, width) => {
      if (y < 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(px(x) + inset, py(y) + inset, cs - 2 * inset, cs - 2 * inset);
    };

    if (st) {
      for (let i = 0; i < 200; i++) {
        const v = st.board[i];
        if (v) block(i % 10, Math.floor(i / 10), v - 1);
      }

      if (!st.over) {
        // おすすめ位置（金）。ゴーストがぴったり重なると緑で「そこです！」
        if (settings.hint) {
          const color = st.hintMatch ? "#5aff78" : "#ffd23c";
          const glow = .5 + .5 * Math.sin(now / 180);
          for (const [x, y] of st.hint) {
            if (y < 0) continue;
            ctx.fillStyle = st.hintMatch ? "rgba(90,255,120,.16)" : `rgba(255,210,60,${.1 + .08 * glow})`;
            ctx.fillRect(px(x) + 1, py(y) + 1, cs - 2, cs - 2);
            outline(x, y, color, Math.max(2, cs * .06), Math.max(2, cs * .07));
          }
        }
        for (const [x, y] of st.ghost) outline(x, y, COLORS[st.kind], cs * .16, Math.max(1.5, cs * .06));
        for (const [x, y] of st.cur) block(x, y, st.kind);
      }
    }

    // ライン消去のフラッシュ
    fx.flashes = fx.flashes.filter((f) => now - f.born < 300);
    for (const f of fx.flashes) {
      ctx.fillStyle = `rgba(255,255,255,${.85 * (1 - (now - f.born) / 300)})`;
      ctx.fillRect(px(0), py(f.row), cs * 10, cs);
    }

    // 飛び散るブロック
    fx.particles = fx.particles.filter((p) => now - p.born < p.life);
    for (const p of fx.particles) {
      const t = (now - p.born) / 1000;
      const x = p.x + p.vx * t, y = p.y + p.vy * t + 12 * t * t;
      ctx.globalAlpha = 1 - (now - p.born) / p.life;
      ctx.fillStyle = p.color;
      const s = cs * .28;
      ctx.fillRect(px(x) - s / 2, py(y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // 文字の演出（SINGLE / TETRIS!! / LEVEL UP!）
    fx.texts = fx.texts.filter((t) => now - t.born < 1100);
    for (const t of fx.texts) {
      const age = (now - t.born) / 1100;
      const scale = age < .15 ? .6 + age / .15 * .4 : 1;
      ctx.save();
      ctx.globalAlpha = age < .6 ? 1 : 1 - (age - .6) / .4;
      ctx.translate(W / 2, H * t.y - age * cs * 1.5);
      ctx.scale(scale, scale);
      ctx.font = `900 ${Math.round(cs * .95)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = cs * .18;
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }

    // 一時停止・ゲームオーバー
    if (st && phase === "playing" && (st.paused || st.over)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(10,10,18,.72)";
      ctx.fillRect(0, H / 2 - cs * 2.2, W, cs * 4.4);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = st.over ? "#ff5078" : "#ffffff";
      ctx.font = `800 ${Math.round(cs * 1.1)}px system-ui, sans-serif`;
      ctx.fillText(st.over ? "GAME OVER" : "PAUSE", W / 2, H / 2 - cs * .6);
      ctx.fillStyle = "#c8c8dc";
      ctx.font = `${Math.round(cs * .5)}px system-ui, sans-serif`;
      ctx.fillText(st.over ? "R キーでもう一度" : "P キーで再開", W / 2, H / 2 + cs * .9);
    }
  }

  // ---- メインループ ----

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 100);
    last = now;
    if (api) {
      if (phase === "title") {
        // タイトル画面では接待AIが自分で遊ぶ（おすすめ位置にそのまま置く）
        demoTimer += dt;
        if (demoTimer >= DEMO_RATE) {
          demoTimer = 0;
          if (st && st.over) api.newGame(0);
          api.input("auto");
          dirty = true;
        }
      } else if (phase === "playing") {
        handleHeld(dt);
        if (api.tick(dt)) dirty = true;
      }
      if (dirty) {
        st = api.state();
        dirty = false;
        updatePanel();
        if (phase === "playing" && settings.hint && st.hintMatch && !prevHintMatch && !st.over) sound.se("match");
        prevHintMatch = st.hintMatch;
      }
      handleEvents(api.events());
      if (phase === "playing") sound.follow(st);
    }
    render(now);
    requestAnimationFrame(frame);
  }

  // ---- 起動 ----

  api = SettaiEngine.createApi();
  window.settai = api; // ブラウザの開発者ツールから触れるように
  buildRanking();
  phase = "title";
  syncSettingsUI();
  $("startBtn").disabled = false;
  requestAnimationFrame(frame);
})();
