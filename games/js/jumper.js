/* =========================================================
   小菲比跳跳 — 無限跑酷
   Phoebe 自動往前跑，跳過障礙物；點一下小跳、按住跳更高。
   ========================================================= */
(function () {
  "use strict";

  var W = 900;
  var H = 562;
  var GROUND_Y = H - 84;
  var STORAGE_KEY = "phoebe.jumper.best";

  /* 物理與速度參數 */
  var BASE_SPEED = 330;
  var MAX_SPEED = 580;
  var GRAVITY = 2400;
  var HOLD_GRAVITY = 1200; /* 按住跳躍時重力減半，所以能跳更高 */
  var JUMP_V = -700;
  var SCORE_PER_PX = 1 / 30;

  var canvas = document.getElementById("game");
  if (!canvas) return;

  var ctx = canvas.getContext("2d");
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var startBtn = document.getElementById("start");
  var restartBtn = document.getElementById("restart");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");

  var INK = "#4a3a32";
  var BUTTER = "#f8e3a3";
  var PINK = "#f9bccd";
  var SKY = "#8fd0ea";
  var LAV = "#b9a7e8";

  /* ---------- 畫布縮放（寫法同 catch-stars.js） ---------- */
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

  /* ---------- 角色圖（載入失敗就用簡單圖形備援） ---------- */
  var phoebeImg = new Image();
  var spriteReady = false;
  var spriteRatio = 122 / 204;
  var SPRITE_FRAMES = 6;
  var SPRITE_FRAME_MS = 160;
  var spriteFrameW = 0;
  var spriteFrameH = 0;

  phoebeImg.onload = function () {
    if (phoebeImg.naturalWidth && phoebeImg.naturalHeight) {
      spriteFrameW = phoebeImg.naturalWidth / SPRITE_FRAMES;
      spriteFrameH = phoebeImg.naturalHeight;
      spriteRatio = spriteFrameW / spriteFrameH;
    }
    spriteReady = true;
  };
  phoebeImg.onerror = function () {
    spriteReady = false;
  };
  phoebeImg.src = "../assets/img/phoebe/phoebe-run-sheet.png?v=20261018-pjump";

  /* ---------- 狀態 ---------- */
  var best = readBest();
  var state = {
    mode: "idle",
    score: 0,
    distance: 0,
    speed: BASE_SPEED,
    paused: false
  };

  var player = {
    x: 170,
    y: GROUND_Y,
    vy: 0,
    onGround: true,
    held: false
  };

  var obstacles = [];
  var particles = [];
  var clouds = [];
  var sparkles = [];
  var spawnTimer = 1.4;
  var shake = 0;
  var lastTime = 0;

  /* 雲朵（視差背景） */
  for (var c = 0; c < 7; c += 1) {
    clouds.push({
      x: rand(0, W),
      y: rand(48, 230),
      scale: rand(0.65, 1.35),
      depth: rand(0.08, 0.2),
      alpha: rand(0.55, 0.95)
    });
  }

  /* 天空的小亮點 */
  for (var s = 0; s < 34; s += 1) {
    sparkles.push({
      x: rand(0, W),
      y: rand(20, GROUND_Y - 190),
      r: rand(1, 2.6),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.8, 2.2)
    });
  }

  bestEl.textContent = String(best);

  /* ---------- HUD ---------- */
  function syncScore() {
    scoreEl.textContent = String(state.score);
  }

  /* ---------- 粒子 ---------- */
  function burst(x, y, color, amount, shape) {
    for (var n = 0; n < amount; n += 1) {
      var angle = rand(-Math.PI, 0);
      var speed = rand(70, 240);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: rand(0.45, 0.9),
        maxLife: 0.9,
        size: rand(2.5, 5.5),
        color: color,
        shape: shape || "dot",
        spin: rand(-5, 5),
        rot: rand(0, Math.PI * 2)
      });
    }
  }

  function dust() {
    for (var n = 0; n < 7; n += 1) {
      particles.push({
        x: player.x + rand(-24, 24),
        y: GROUND_Y - rand(0, 6),
        vx: rand(-70, -20),
        vy: rand(-90, -20),
        life: rand(0.25, 0.5),
        maxLife: 0.5,
        size: rand(1.5, 3.2),
        color: "#fff4dd",
        shape: "dot",
        spin: 0,
        rot: 0
      });
    }
  }

  /* ---------- 障礙物 ---------- */
  function spawnObstacle() {
    var roll = Math.random();
    var type = roll < 0.42 ? "cactus" : roll < 0.72 ? "bomb" : "star";
    var width = type === "cactus" ? 48 : type === "bomb" ? 46 : 52;
    var height = type === "cactus" ? 68 : type === "bomb" ? 54 : 48;

    obstacles.push({
      type: type,
      x: W + 60,
      w: width,
      h: height,
      phase: rand(0, Math.PI * 2),
      spin: rand(-1.6, 1.6)
    });

    /* 依目前速度調整間隔，速度越快距離越遠，避免跳不過去 */
    var gap = rand(420, 600) + state.speed * 0.72;
    spawnTimer = clamp(gap / state.speed, 0.85, 2.6);
  }

  function hitTest(obstacle) {
    var pLeft = player.x - 23;
    var pRight = player.x + 23;
    var pTop = player.y - 122;
    var pBottom = player.y - 4;

    var oLeft = obstacle.x - obstacle.w * 0.38;
    var oRight = obstacle.x + obstacle.w * 0.38;
    var oTop = GROUND_Y - obstacle.h + 6;
    var oBottom = GROUND_Y;

    return (
      pRight > oLeft &&
      pLeft < oRight &&
      pBottom > oTop &&
      pTop < oBottom
    );
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    state.mode = "playing";
    state.score = 0;
    state.distance = 0;
    state.speed = BASE_SPEED;
    state.paused = false;

    player.y = GROUND_Y;
    player.vy = 0;
    player.onGround = true;
    player.held = false;

    obstacles = [];
    particles = [];
    shake = 0;
    spawnTimer = 1.4;
    lastTime = 0;

    syncScore();
    overlay.hidden = true;
    startBtn.textContent = "再玩一次";
  }

  function endGame() {
    state.mode = "over";
    state.paused = false;
    player.held = false;

    var isNewBest = state.score > best;
    if (isNewBest) {
      best = state.score;
      saveBest(best);
      bestEl.textContent = String(best);
    }

    burst(player.x, player.y - 70, PINK, 26, "heart");
    shake = 16;

    overlayTitle.textContent = isNewBest ? "新紀錄！跑得真遠！" : "哎呀，撞到了！";
    overlayText.textContent =
      "這局跑了 " +
      state.score +
      " 分，最高分是 " +
      best +
      " 分" +
      (isNewBest ? "，刷新紀錄啦！🎉" : "。再試一次一定可以更遠！");
    startBtn.textContent = "再玩一次";
    overlay.hidden = false;
  }

  function jump() {
    if (state.mode !== "playing" || state.paused) return;
    if (!player.onGround) return;
    player.vy = JUMP_V;
    player.onGround = false;
    player.held = true;
    dust();
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    if (state.paused) return;

    state.speed = Math.min(MAX_SPEED, BASE_SPEED + state.distance / 110);
    state.distance += state.speed * dt;

    var nextScore = Math.floor(state.distance * SCORE_PER_PX);
    if (nextScore !== state.score) {
      state.score = nextScore;
      syncScore();
    }

    /* 角色物理：按住且正在上升時，重力減半 */
    if (!player.onGround) {
      var gravity = player.vy < 0 && player.held ? HOLD_GRAVITY : GRAVITY;
      player.vy += gravity * dt;
      player.y += player.vy * dt;

      if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
        player.onGround = true;
        player.held = false;
        dust();
      }
    }

    /* 障礙物 */
    spawnTimer -= dt;
    if (spawnTimer <= 0) spawnObstacle();

    for (var i = obstacles.length - 1; i >= 0; i -= 1) {
      var ob = obstacles[i];
      ob.x -= state.speed * dt;
      ob.phase += dt * 2.4;

      if (ob.x + ob.w < -60) {
        obstacles.splice(i, 1);
        continue;
      }

      if (hitTest(ob)) {
        endGame();
        return;
      }
    }

    /* 雲朵視差 */
    for (var j = 0; j < clouds.length; j += 1) {
      var cloud = clouds[j];
      cloud.x -= state.speed * cloud.depth * dt;
      if (cloud.x < -180) {
        cloud.x = W + rand(20, 240);
        cloud.y = rand(48, 230);
        cloud.scale = rand(0.65, 1.35);
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
      p.rot += p.spin * dt;
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 46);
  }

  /* ---------- 繪圖：背景 ---------- */
  function drawSky(time) {
    var gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#cdeefc");
    gradient.addColorStop(0.42, "#eaf7fb");
    gradient.addColorStop(0.7, "#fff2dc");
    gradient.addColorStop(1, "#ffe6ec");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    /* 暖暖太陽 */
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffe7a3";
    ctx.beginPath();
    ctx.arc(768, 96, 86, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(768, 96, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 閃爍小亮點 */
    for (var i = 0; i < sparkles.length; i += 1) {
      var sp = sparkles[i];
      var alpha = 0.25 + 0.55 * Math.abs(Math.sin(time * 0.001 * sp.speed + sp.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fffdf6";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCloud(x, y, scale, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fffdf8";
    ctx.beginPath();
    ctx.arc(-34, 8, 24, 0, Math.PI * 2);
    ctx.arc(0, -2, 32, 0, Math.PI * 2);
    ctx.arc(38, 10, 22, 0, Math.PI * 2);
    ctx.arc(0, 18, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawClouds() {
    for (var i = 0; i < clouds.length; i += 1) {
      var cloud = clouds[i];
      drawCloud(cloud.x, cloud.y, cloud.scale, cloud.alpha);
    }
  }

  function drawMountains() {
    var spacing = 320;
    var offset = (state.distance * 0.16) % spacing;
    var baseY = GROUND_Y + 8;
    var peakY = baseY - 132;
    var peaks = [];

    ctx.fillStyle = "#d9ccf2";
    ctx.beginPath();
    ctx.moveTo(-spacing, baseY);
    for (var i = -1; i <= 4; i += 1) {
      var x = i * spacing - offset;
      ctx.lineTo(x + spacing * 0.24, baseY - 16);
      ctx.lineTo(x + spacing * 0.5, peakY);
      ctx.lineTo(x + spacing * 0.76, baseY - 16);
      ctx.lineTo(x + spacing, baseY);
      peaks.push({ x: x + spacing * 0.5, y: peakY });
    }
    ctx.lineTo(W + spacing, H);
    ctx.lineTo(-spacing, H);
    ctx.closePath();
    ctx.fill();

    /* 山頂積雪 */
    ctx.fillStyle = "#fffdf8";
    for (var j = 0; j < peaks.length; j += 1) {
      var peak = peaks[j];
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(peak.x - 18, peak.y + 34);
      ctx.quadraticCurveTo(peak.x, peak.y + 24, peak.x + 18, peak.y + 34);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawHills() {
    var offset = (state.distance * 0.36) % 420;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, GROUND_Y);
    for (var x = 0; x <= W; x += 8) {
      var wave =
        Math.sin((x + offset) * 0.011) * 11 +
        Math.cos((x + offset) * 0.023) * 6;
      ctx.lineTo(x, GROUND_Y - 12 + wave);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = "#c8ebd4";
    ctx.fill();
  }

  function drawGround() {
    /* 泥土 / 跑道 */
    var gradient = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    gradient.addColorStop(0, "#fbe8c4");
    gradient.addColorStop(1, "#f5d9a8");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    /* 草皮邊緣 */
    ctx.fillStyle = "#a9dcbd";
    ctx.fillRect(0, GROUND_Y, W, 16);

    var offset = state.distance % 92;
    for (var i = -1; i < W / 92 + 2; i += 1) {
      var x = i * 92 - offset;
      /* 小草叢 */
      ctx.strokeStyle = "#7fbf99";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 8);
      ctx.quadraticCurveTo(x - 6, GROUND_Y - 2, x - 8, GROUND_Y - 10);
      ctx.moveTo(x + 3, GROUND_Y + 8);
      ctx.quadraticCurveTo(x + 8, GROUND_Y - 2, x + 9, GROUND_Y - 12);
      ctx.stroke();

      /* 跑道上的小圓點 */
      ctx.fillStyle = "rgba(74, 58, 50, 0.1)";
      ctx.beginPath();
      ctx.arc(x + 46, GROUND_Y + 44, 5, 0, Math.PI * 2);
      ctx.arc(x + 74, GROUND_Y + 62, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 地面與背景的分界線 */
    ctx.strokeStyle = "rgba(74, 58, 50, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5);
    ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();
  }

  function drawBackground(time) {
    drawSky(time);
    drawMountains();
    drawClouds();
    drawHills();
    drawGround();
  }

  /* ---------- 繪圖：角色與障礙物 ---------- */
  function drawShadow() {
    var air = clamp((GROUND_Y - player.y) / 210, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.24 * (1 - air * 0.6);
    ctx.fillStyle = "#4a3a32";
    ctx.beginPath();
    ctx.ellipse(
      player.x,
      GROUND_Y + 7,
      44 * (1 - air * 0.28),
      9 * (1 - air * 0.28),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  function drawFallbackPhoebe(height) {
    var s = height / 152;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3 * s;

    /* 身體 */
    ctx.fillStyle = "#fffdf8";
    ctx.beginPath();
    ctx.ellipse(0, -50 * s, 34 * s, 46 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    /* 頭與長髮 */
    ctx.fillStyle = "#f6e2b3";
    ctx.beginPath();
    ctx.arc(0, -98 * s, 46 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    /* 臉 */
    ctx.fillStyle = "#ffe9cf";
    ctx.beginPath();
    ctx.arc(0, -96 * s, 34 * s, 0, Math.PI * 2);
    ctx.fill();

    /* 帽子 */
    ctx.fillStyle = "#fffdf8";
    ctx.beginPath();
    ctx.ellipse(0, -128 * s, 52 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -140 * s, 30 * s, 18 * s, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* 眼睛 */
    ctx.fillStyle = "#8b74cd";
    ctx.beginPath();
    ctx.arc(-14 * s, -98 * s, 5.2 * s, 0, Math.PI * 2);
    ctx.arc(14 * s, -98 * s, 5.2 * s, 0, Math.PI * 2);
    ctx.fill();

    /* 腮紅 */
    ctx.fillStyle = "rgba(249, 188, 205, 0.85)";
    ctx.beginPath();
    ctx.arc(-24 * s, -88 * s, 5 * s, 0, Math.PI * 2);
    ctx.arc(24 * s, -88 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();

    /* 藍色小披巾 */
    ctx.fillStyle = SKY;
    ctx.beginPath();
    ctx.moveTo(-16 * s, -60 * s);
    ctx.lineTo(12 * s, -52 * s);
    ctx.lineTo(-4 * s, -38 * s);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawPhoebe() {
    var bob = player.onGround ? Math.sin(state.distance * 0.045) * 2.6 : 0;
    var tilt = player.onGround
      ? Math.sin(state.distance * 0.045) * 0.04
      : clamp(player.vy / 3000, -0.26, 0.26);
    var height = 152;
    var width = height * spriteRatio;
    var frame = 0;

    if (state.mode === "playing") {
      frame = player.onGround
        ? Math.floor(window.performance.now() / SPRITE_FRAME_MS) % SPRITE_FRAMES
        : 3;
    }

    ctx.save();
    ctx.translate(player.x, player.y + bob);
    ctx.rotate(tilt);

    if (spriteReady && spriteFrameW && spriteFrameH) {
      ctx.drawImage(
        phoebeImg,
        frame * spriteFrameW,
        0,
        spriteFrameW,
        spriteFrameH,
        -width / 2,
        -height,
        width,
        height
      );
    } else {
      drawFallbackPhoebe(height);
    }

    ctx.restore();
  }

  function drawCactus(ob) {
    /* 行李箱：菲比旅行時要跳過的障礙物 */
    var x = ob.x;
    var base = GROUND_Y;
    var w = 44;
    var bodyH = ob.h * 0.78;
    ctx.save();
    ctx.translate(x, base);

    /* 影子 */
    ctx.fillStyle = "rgba(74, 58, 50, 0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 2, w * 0.56, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 提把 */
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-12, -bodyH - 4);
    ctx.lineTo(-12, -bodyH - 15);
    ctx.quadraticCurveTo(0, -bodyH - 27, 12, -bodyH - 15);
    ctx.lineTo(12, -bodyH - 4);
    ctx.stroke();

    /* 箱身 */
    roundRect(-w / 2, -bodyH, w, bodyH, 9);
    ctx.fillStyle = "#f2c47c";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 綁帶 */
    ctx.strokeStyle = "rgba(74, 58, 50, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -bodyH + 3);
    ctx.lineTo(-8, -3);
    ctx.moveTo(8, -bodyH + 3);
    ctx.lineTo(8, -3);
    ctx.stroke();

    /* 奶油星貼紙 */
    ctx.save();
    ctx.translate(0, -bodyH * 0.52);
    starPath(11);
    ctx.fillStyle = BUTTER;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    /* 可愛臉 */
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-13, -bodyH * 0.25, 2.5, 0, Math.PI * 2);
    ctx.arc(13, -bodyH * 0.25, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.18, 4.5, 0.25, Math.PI - 0.25);
    ctx.stroke();
    ctx.fillStyle = "rgba(249, 188, 205, 0.8)";
    ctx.beginPath();
    ctx.arc(-19, -bodyH * 0.2, 3.2, 0, Math.PI * 2);
    ctx.arc(19, -bodyH * 0.2, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBomb(ob) {
    var cx = ob.x;
    var cy = GROUND_Y - ob.h / 2;
    var r = 24;
    ctx.save();
    ctx.translate(cx, cy);

    ctx.shadowColor = "rgba(74, 58, 50, 0.25)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#6f6787";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 引線與火花 */
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(12, -17);
    ctx.quadraticCurveTo(22, -30, 16, -38);
    ctx.stroke();
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(16, -41, 5 + Math.sin(ob.phase * 3) * 1.5, 0, Math.PI * 2);
    ctx.fill();

    /* 生氣臉 */
    ctx.strokeStyle = "#f7c9d6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-13, -6);
    ctx.lineTo(-4, 2);
    ctx.moveTo(-4, -6);
    ctx.lineTo(-13, 2);
    ctx.moveTo(4, -6);
    ctx.lineTo(13, 2);
    ctx.moveTo(13, -6);
    ctx.lineTo(4, 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawObstacleStar(ob) {
    var cx = ob.x;
    var cy = GROUND_Y - ob.h / 2 + 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(ob.phase) * 0.12);

    ctx.shadowColor = "rgba(239, 201, 91, 0.75)";
    ctx.shadowBlur = 14;
    starPath(ob.w * 0.56);
    ctx.fillStyle = BUTTER;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 表情 */
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-8, -3, 2.8, 0, Math.PI * 2);
    ctx.arc(8, -3, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 5, 5, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.restore();
  }

  function drawObstacles() {
    for (var i = 0; i < obstacles.length; i += 1) {
      var ob = obstacles[i];
      if (ob.type === "cactus") drawCactus(ob);
      else if (ob.type === "bomb") drawBomb(ob);
      else drawObstacleStar(ob);
    }
  }

  function drawEffects() {
    for (var i = 0; i < particles.length; i += 1) {
      var p = particles[i];
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "heart") {
        heartPath(p.size * 1.5);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function render(time) {
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    drawBackground(time);
    drawObstacles();
    drawShadow();
    drawPhoebe();
    drawEffects();

    ctx.restore();
  }

  /* ---------- 主迴圈 ---------- */
  function loop(now) {
    requestAnimationFrame(loop);

    if (!lastTime) lastTime = now;
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (state.mode === "playing") update(dt);
    updateEffects(dt);
    render(now);
  }

  requestAnimationFrame(loop);

  /* ---------- 輸入 ---------- */
  function isJumpKey(event) {
    return (
      event.key === " " ||
      event.key === "ArrowUp" ||
      event.key === "w" ||
      event.key === "W"
    );
  }

  window.addEventListener("keydown", function (event) {
    if (event.key === " " || event.key.indexOf("Arrow") === 0) {
      if (state.mode === "playing") event.preventDefault();
    }
    if (event.repeat) return;

    if (event.key === " " && state.mode !== "playing") {
      event.preventDefault();
      startGame();
      return;
    }

    if (isJumpKey(event) && state.mode === "playing") {
      event.preventDefault();
      jump();
    }
  });

  window.addEventListener("keyup", function (event) {
    if (isJumpKey(event)) player.held = false;
  });

  canvas.addEventListener("pointerdown", function (event) {
    if (state.mode !== "playing") return;
    event.preventDefault();
    jump();
  });

  window.addEventListener("pointerup", function () {
    player.held = false;
  });

  window.addEventListener("pointercancel", function () {
    player.held = false;
  });

  /* 避免在畫布上按住拖曳時選取文字 / 捲動頁面 */
  canvas.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);

  /* 切到別的頁籤時暫停，回來重置計時，避免一回來就撞死 */
  document.addEventListener("visibilitychange", function () {
    lastTime = 0;
    if (document.hidden) {
      if (state.mode === "playing") state.paused = true;
    } else if (state.mode === "playing") {
      state.paused = false;
    }
  });
})();
