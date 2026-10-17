/* =========================================================
   星星接接樂 — 接住星星，避開炸彈
   ========================================================= */
(function () {
  "use strict";

  var W = 900;
  var H = 562;
  var GAME_SECONDS = 45;
  var STORAGE_KEY = "phoebe.catch-stars.best";

  var canvas = document.getElementById("game");
  if (!canvas) return;

  var ctx = canvas.getContext("2d");
  var stage = document.getElementById("stage");
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var startBtn = document.getElementById("start");
  var restartBtn = document.getElementById("restart");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var livesEl = document.getElementById("lives");

  var INK = "#4a3a32";
  var BUTTER = "#f8e3a3";
  var PINK = "#f9bccd";
  var SKY = "#8fd0ea";

  var scaleX = 1;
  var scaleY = 1;

  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    scaleX = canvas.width / W;
    scaleY = canvas.height / H;
  }

  window.addEventListener("resize", fitCanvas);
  if ("ResizeObserver" in window) {
    new ResizeObserver(fitCanvas).observe(canvas);
  }
  fitCanvas();

  /* ---------- 小工具 ---------- */
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundRect(x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function readBest() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var value = raw === null ? 0 : Number(raw);
      return Number.isFinite(value) ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch (error) {
      /* 無痕模式等情況就略過 */
    }
  }

  /* ---------- 狀態 ---------- */
  var best = readBest();
  var basket = { x: W / 2, target: W / 2, width: 132, y: H - 96, tilt: 0 };
  var state = {
    mode: "idle",
    score: 0,
    lives: 3,
    combo: 0,
    timeLeft: GAME_SECONDS,
    elapsed: 0
  };
  var items = [];
  var particles = [];
  var floaters = [];
  var shake = 0;
  var lastTime = 0;
  var spawnTimer = 0;
  var keys = { left: false, right: false };

  var stars = [];
  for (var i = 0; i < 72; i += 1) {
    stars.push({
      x: rand(0, W),
      y: rand(0, H * 0.72),
      r: rand(0.7, 2.3),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.6, 1.8)
    });
  }

  bestEl.textContent = String(best);
  updateLives();

  /* ---------- HUD ---------- */
  function updateLives() {
    var hearts = "";
    for (var n = 0; n < Math.max(0, state.lives); n += 1) hearts += "♥";
    livesEl.textContent = hearts || "—";
  }

  function syncHud() {
    scoreEl.textContent = String(state.score);
    updateLives();
  }

  /* ---------- 生成物品 ---------- */
  function spawnItem() {
    var roll = Math.random();
    var type = "star";
    if (roll > 0.86) type = "bomb";
    else if (roll > 0.74) type = "heart";

    var difficulty = state.elapsed / GAME_SECONDS;
    var speed = rand(165, 225) + difficulty * 150;

    items.push({
      type: type,
      x: rand(70, W - 70),
      y: -50,
      vy: speed,
      r: type === "star" ? rand(20, 27) : type === "heart" ? rand(20, 25) : 24,
      rot: rand(-0.4, 0.4),
      spin: rand(-1.4, 1.4),
      phase: rand(0, Math.PI * 2),
      sway: rand(8, 26)
    });
  }

  /* ---------- 粒子與飄分 ---------- */
  function burst(x, y, color, amount) {
    for (var n = 0; n < amount; n += 1) {
      var angle = rand(0, Math.PI * 2);
      var speed = rand(60, 220);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: rand(0.4, 0.8),
        maxLife: 0.8,
        size: rand(2, 5),
        color: color
      });
    }
  }

  function floatText(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color, life: 0.9, maxLife: 0.9 });
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    state.mode = "playing";
    state.score = 0;
    state.lives = 3;
    state.combo = 0;
    state.timeLeft = GAME_SECONDS;
    state.elapsed = 0;
    items = [];
    particles = [];
    floaters = [];
    shake = 0;
    spawnTimer = 0.4;
    basket.x = W / 2;
    basket.target = W / 2;
    overlay.hidden = true;
    startBtn.textContent = "再玩一次";
    syncHud();
    lastTime = 0;
  }

  function endGame() {
    state.mode = "over";
    var isNewBest = state.score > best;
    if (isNewBest) {
      best = state.score;
      saveBest(best);
      bestEl.textContent = String(best);
    }

    overlayTitle.textContent =
      state.lives <= 0 && state.timeLeft > 0 ? "哎呀，被炸到了！" : "時間到！";
    overlayText.textContent =
      "這局得到 " +
      state.score +
      " 分" +
      (isNewBest ? "，是新紀錄！🎉" : "。最高分是 " + best + " 分。");
    startBtn.textContent = "再玩一次";
    overlay.hidden = false;
  }

  function catchItem(item) {
    if (item.type === "bomb") {
      state.lives -= 1;
      state.combo = 0;
      shake = 12;
      burst(item.x, item.y, "#f09b8f", 18);
      floatText(item.x, item.y - 30, "-1 ♥", "#fff1f3");
      updateLives();
      if (state.lives <= 0) {
        state.lives = 0;
        updateLives();
        endGame();
      }
      return;
    }

    var gained;
    if (item.type === "heart") {
      gained = 25;
      state.lives = Math.min(5, state.lives + 1);
      updateLives();
      floatText(item.x, item.y - 30, "+1 ♥", PINK);
      burst(item.x, item.y, PINK, 12);
    } else {
      gained = 10 + Math.min(state.combo, 10) * 2;
      floatText(item.x, item.y - 30, "+" + gained, "#fff3c9");
      burst(item.x, item.y, BUTTER, 9);
      state.combo += 1;
    }

    state.score += gained;
    scoreEl.textContent = String(state.score);
  }

  function update(dt) {
    state.timeLeft -= dt;
    state.elapsed += dt;

    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      endGame();
      return;
    }

    if (keys.left) basket.target -= 560 * dt;
    if (keys.right) basket.target += 560 * dt;
    basket.target = clamp(basket.target, basket.width / 2 + 10, W - basket.width / 2 - 10);

    var previousX = basket.x;
    basket.x += (basket.target - basket.x) * Math.min(1, dt * 14);
    basket.tilt = clamp((basket.x - previousX) * 0.006, -0.22, 0.22);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnItem();
      var difficulty = state.elapsed / GAME_SECONDS;
      spawnTimer = Math.max(0.26, 0.78 - difficulty * 0.42) * rand(0.8, 1.2);
    }

    for (var i = items.length - 1; i >= 0; i -= 1) {
      var item = items[i];
      item.y += item.vy * dt;
      item.rot += item.spin * dt;
      item.x += Math.sin(item.phase + item.y * 0.02) * item.sway * dt;

      var catchTop = basket.y - 26;
      var catchBottom = basket.y + 34;
      if (
        item.y > catchTop &&
        item.y < catchBottom &&
        Math.abs(item.x - basket.x) < basket.width / 2 + item.r * 0.4
      ) {
        catchItem(item);
        items.splice(i, 1);
        if (state.mode !== "playing") return;
        continue;
      }

      if (item.y > H + 60) {
        if (item.type === "star") state.combo = 0;
        items.splice(i, 1);
      }
    }
  }

  function updateEffects(dt) {
    for (var i = particles.length - 1; i >= 0; i -= 1) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
    }

    for (var j = floaters.length - 1; j >= 0; j -= 1) {
      var f = floaters[j];
      f.life -= dt;
      if (f.life <= 0) {
        floaters.splice(j, 1);
        continue;
      }
      f.y -= 42 * dt;
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 40);
  }

  /* ---------- 繪圖 ---------- */
  function drawBackground(time) {
    var gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#2f3b63");
    gradient.addColorStop(0.5, "#655a9c");
    gradient.addColorStop(0.8, "#c39fc4");
    gradient.addColorStop(1, "#f4d3a2");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    /* 月亮 */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#fff3c9";
    ctx.beginPath();
    ctx.arc(772, 96, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(772, 96, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7e6b8";
    ctx.beginPath();
    ctx.arc(756, 82, 7, 0, Math.PI * 2);
    ctx.arc(788, 112, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 閃爍星星 */
    for (var i = 0; i < stars.length; i += 1) {
      var star = stars[i];
      var alpha = 0.35 + 0.45 * Math.abs(Math.sin(time * 0.001 * star.speed + star.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fff6d6";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 遠山 */
    ctx.fillStyle = "#5b4c85";
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - 92);
    for (var x = 0; x <= W; x += 24) {
      var y = H - 92 + Math.sin((x / W) * Math.PI * 2.2 + 0.6) * 20;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    /* 近處草地 */
    ctx.fillStyle = "#4a3d70";
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - 54);
    for (var x2 = 0; x2 <= W; x2 += 20) {
      var y2 = H - 54 + Math.sin((x2 / W) * Math.PI * 3.4) * 8;
      ctx.lineTo(x2, y2);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    /* 小灌木 */
    ctx.fillStyle = "#3d3260";
    for (var b = 0; b < 7; b += 1) {
      var bx = 60 + b * 132;
      var by = H - 40 + Math.sin(b * 1.7) * 8;
      var br = 26 + (b % 3) * 6;
      ctx.beginPath();
      ctx.arc(bx, by, br, Math.PI, 0);
      ctx.fill();
    }
  }

  function starPath(radius) {
    ctx.beginPath();
    for (var i = 0; i < 10; i += 1) {
      var r = i % 2 === 0 ? radius : radius * 0.46;
      var angle = -Math.PI / 2 + (i * Math.PI) / 5;
      var px = Math.cos(angle) * r;
      var py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function heartPath(size) {
    ctx.beginPath();
    ctx.moveTo(0, size * 0.36);
    ctx.bezierCurveTo(-size * 0.62, -size * 0.12, -size * 0.5, -size * 0.66, 0, -size * 0.3);
    ctx.bezierCurveTo(size * 0.5, -size * 0.66, size * 0.62, -size * 0.12, 0, size * 0.36);
    ctx.closePath();
  }

  function drawFace(size, eyeColor) {
    if (size < 18) return;
    ctx.fillStyle = eyeColor || INK;
    var eyeX = size * 0.28;
    var eyeY = -size * 0.02;
    ctx.beginPath();
    ctx.arc(-eyeX, eyeY, Math.max(1.4, size * 0.075), 0, Math.PI * 2);
    ctx.arc(eyeX, eyeY, Math.max(1.4, size * 0.075), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = eyeColor || INK;
    ctx.lineWidth = Math.max(1.2, size * 0.06);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, eyeY + size * 0.1, size * 0.16, 0.3, Math.PI - 0.3);
    ctx.stroke();
    ctx.fillStyle = "rgba(249, 188, 205, 0.75)";
    ctx.beginPath();
    ctx.arc(-size * 0.42, size * 0.16, size * 0.09, 0, Math.PI * 2);
    ctx.arc(size * 0.42, size * 0.16, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawItem(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rot);

    if (item.type === "star") {
      ctx.shadowColor = "rgba(255, 226, 140, 0.9)";
      ctx.shadowBlur = 22;
      starPath(item.r);
      ctx.fillStyle = "#ffe08a";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
      drawFace(item.r, INK);
    } else if (item.type === "heart") {
      ctx.shadowColor = "rgba(249, 188, 205, 0.9)";
      ctx.shadowBlur = 18;
      heartPath(item.r);
      ctx.fillStyle = PINK;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
      drawFace(item.r, INK);
    } else {
      ctx.shadowColor = "rgba(30, 22, 40, 0.5)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#5a5470";
      ctx.beginPath();
      ctx.arc(0, 0, item.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#2f2a3f";
      ctx.lineWidth = 3;
      ctx.stroke();

      /* 引線 */
      ctx.strokeStyle = "#2f2a3f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(item.r * 0.5, -item.r * 0.75);
      ctx.quadraticCurveTo(item.r * 0.9, -item.r * 1.2, item.r * 0.6, -item.r * 1.6);
      ctx.stroke();
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath();
      ctx.arc(item.r * 0.6, -item.r * 1.65, 3.5, 0, Math.PI * 2);
      ctx.fill();

      /* 生氣臉 */
      ctx.strokeStyle = "#f7c9d6";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-item.r * 0.45, -item.r * 0.18);
      ctx.lineTo(-item.r * 0.15, item.r * 0.12);
      ctx.moveTo(-item.r * 0.15, -item.r * 0.18);
      ctx.lineTo(-item.r * 0.45, item.r * 0.12);
      ctx.moveTo(item.r * 0.15, -item.r * 0.18);
      ctx.lineTo(item.r * 0.45, item.r * 0.12);
      ctx.moveTo(item.r * 0.45, -item.r * 0.18);
      ctx.lineTo(item.r * 0.15, item.r * 0.12);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawBasket() {
    ctx.save();
    ctx.translate(basket.x, basket.y);
    ctx.rotate(basket.tilt);

    var w = basket.width;
    var h = 56;

    /* 陰影 */
    ctx.fillStyle = "rgba(30, 22, 42, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.72, w * 0.58, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 提把 */
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, -6, w * 0.3, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.strokeStyle = "#ffe9ae";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -6, w * 0.3, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    /* 籃身 */
    roundRect(-w / 2, -8, w, h, 20);
    ctx.fillStyle = "#f2c47c";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();

    /* 編織紋 */
    ctx.save();
    roundRect(-w / 2, -8, w, h, 20);
    ctx.clip();
    ctx.strokeStyle = "rgba(74, 58, 50, 0.22)";
    ctx.lineWidth = 3;
    for (var x = -w / 2 + 14; x < w / 2; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, -8);
      ctx.lineTo(x + 10, h - 8);
      ctx.stroke();
    }
    ctx.restore();

    /* 白色籃緣 */
    roundRect(-w / 2 - 7, -22, w + 14, 24, 12);
    ctx.fillStyle = "#fffdf6";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();

    /* 藍色緞帶 */
    ctx.fillStyle = SKY;
    roundRect(-w * 0.16, -20, w * 0.32, 18, 6);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* 船錨小徽章 */
    ctx.fillStyle = BUTTER;
    ctx.beginPath();
    ctx.arc(0, 10, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✦", 0, 11);

    ctx.restore();
  }

  function drawTimer() {
    var width = 250;
    var height = 36;
    var x = W / 2 - width / 2;
    var y = 22;
    roundRect(x, y, width, height, height / 2);
    ctx.fillStyle = "rgba(255, 253, 248, 0.85)";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    var ratio = clamp(state.timeLeft / GAME_SECONDS, 0, 1);
    if (ratio > 0) {
      roundRect(x + 5, y + 5, Math.max(12, (width - 10) * ratio), height - 10, (height - 10) / 2);
      var bar = ctx.createLinearGradient(x, 0, x + width, 0);
      bar.addColorStop(0, "#ffe08a");
      bar.addColorStop(1, "#f9bccd");
      ctx.fillStyle = bar;
      ctx.fill();
    }

    ctx.fillStyle = INK;
    ctx.font = "800 16px 'Baloo 2', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TIME  " + Math.ceil(state.timeLeft) + "s", W / 2, y + height / 2 + 1);
  }

  function drawCombo() {
    if (state.combo < 3 || state.mode !== "playing") return;
    ctx.save();
    ctx.translate(W / 2, H - 150);
    ctx.rotate(-0.03);
    ctx.font = "800 26px 'Baloo 2', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 246, 214, 0.95)";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.strokeText("COMBO ×" + state.combo, 0, 0);
    ctx.fillText("COMBO ×" + state.combo, 0, 0);
    ctx.restore();
  }

  function drawEffects() {
    for (var i = 0; i < particles.length; i += 1) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (var j = 0; j < floaters.length; j += 1) {
      var f = floaters[j];
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.font = "800 22px 'Baloo 2', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(45, 33, 55, 0.45)";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function render(time) {
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    drawBackground(time);

    if (state.mode !== "idle") {
      drawTimer();
    }

    for (var i = 0; i < items.length; i += 1) {
      drawItem(items[i]);
    }

    drawBasket();
    drawCombo();
    drawEffects();

    ctx.restore();
  }

  /* ---------- 主迴圈 ---------- */
  function loop(now) {
    requestAnimationFrame(loop);

    if (!lastTime) lastTime = now;
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (state.mode === "playing") {
      update(dt);
      updateEffects(dt);
    } else {
      updateEffects(dt);
    }

    render(now);
  }

  requestAnimationFrame(loop);

  /* ---------- 輸入 ---------- */
  function handlePointer(event) {
    var rect = canvas.getBoundingClientRect();
    var x = ((event.clientX - rect.left) / rect.width) * W;
    basket.target = clamp(x, basket.width / 2 + 10, W - basket.width / 2 - 10);
    if (state.mode === "idle") {
      /* 讓人可以先摸一下再按開始 */
      basket.x = basket.target;
    }
  }

  canvas.addEventListener("pointermove", handlePointer);
  canvas.addEventListener("pointerdown", handlePointer);

  window.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = true;
      if (state.mode === "playing") event.preventDefault();
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      keys.right = true;
      if (state.mode === "playing") event.preventDefault();
    } else if (event.key === " " || event.key === "Enter") {
      if (state.mode !== "playing") {
        event.preventDefault();
        startGame();
      }
    }
  });

  window.addEventListener("keyup", function (event) {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = false;
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      keys.right = false;
    }
  });

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", function () {
    if (state.mode === "playing") {
      startGame();
    } else {
      startGame();
    }
  });

  document.addEventListener("visibilitychange", function () {
    lastTime = 0;
  });

  /* 遊戲進行中不要讓方向鍵 / 空白鍵捲動頁面 */
  window.addEventListener(
    "keydown",
    function (event) {
      if (state.mode !== "playing") return;
      if (event.key === " " || event.key.startsWith("Arrow")) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  if (stage) {
    stage.addEventListener("pointerdown", function (event) {
      if (event.target === stage && state.mode === "playing") event.preventDefault();
    });
  }
})();
