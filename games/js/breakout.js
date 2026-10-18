/* =========================================================
   星星打磚塊 — 用緞帶板子接住星星球，打掉粉彩愛心磚
   ========================================================= */
(function () {
  "use strict";

  var W = 900;
  var H = 562;
  var STORAGE_KEY = "phoebe.breakout.best";

  var COLS = 7;
  var ROWS = 5;
  var PADDLE_Y = H - 66;
  var PADDLE_H = 22;
  var PADDLE_W = 140;

  var BASE_BALL_SPEED = 400;
  var SPEED_STEP = 34;
  var MAX_BALL_SPEED = 720;
  var START_LIVES = 3;

  var BRICK_TOP = 78;
  var BRICK_MARGIN_X = 56;
  var BRICK_GAP_X = 9;
  var BRICK_GAP_Y = 10;
  var BRICK_H = 28;
  var BRICK_W = (W - BRICK_MARGIN_X * 2 - BRICK_GAP_X * (COLS - 1)) / COLS;

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
  var livesEl = document.getElementById("lives");

  var INK = "#4a3a32";
  var BUTTER = "#f8e3a3";
  var PINK = "#f9bccd";
  var SKY = "#8fd0ea";
  var ROW_COLORS = ["#f9bccd", "#f8e3a3", "#8fd0ea", "#b9a7e8", "#bde9d3"];

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

  /* ---------- 狀態 ---------- */
  var best = readBest();
  var startBest = best;

  var state = {
    mode: "idle", /* idle | playing | over */
    score: 0,
    lives: START_LIVES,
    level: 1,
    paused: false
  };

  var paddle = { x: W / 2, targetX: W / 2, w: PADDLE_W, h: PADDLE_H };
  var ball = { x: W / 2, y: PADDLE_Y - 13, r: 11, vx: 0, vy: 0, ready: true, rot: 0 };
  var bricks = [];
  var particles = [];
  var floaters = [];
  var trail = [];
  var banner = { text: "", life: 0, maxLife: 1 };
  var keys = { left: false, right: false };
  var shake = 0;
  var lastTime = 0;

  /* 背景裝飾（固定位置，柔和就好） */
  var decor = [];
  for (var d = 0; d < 14; d += 1) {
    decor.push({
      x: rand(20, W - 20),
      y: rand(40, H - 120),
      r: rand(14, 46),
      color: d % 3 === 0 ? "rgba(249, 188, 205, 0.2)" : d % 3 === 1 ? "rgba(143, 208, 234, 0.18)" : "rgba(248, 227, 163, 0.22)"
    });
  }

  var sparkles = [];
  for (var sp = 0; sp < 26; sp += 1) {
    sparkles.push({
      x: rand(0, W),
      y: rand(20, 200),
      r: rand(1, 2.4),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.8, 2)
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
    bestEl.textContent = String(best);
    updateLives();
  }

  function currentBallSpeed() {
    return Math.min(MAX_BALL_SPEED, BASE_BALL_SPEED + (state.level - 1) * SPEED_STEP);
  }

  /* ---------- 磚塊 ---------- */
  function buildBricks() {
    bricks = [];
    for (var row = 0; row < ROWS; row += 1) {
      for (var col = 0; col < COLS; col += 1) {
        bricks.push({
          x: BRICK_MARGIN_X + col * (BRICK_W + BRICK_GAP_X),
          y: BRICK_TOP + row * (BRICK_H + BRICK_GAP_Y),
          w: BRICK_W,
          h: BRICK_H,
          row: row,
          alive: true
        });
      }
    }
  }

  function bricksLeft() {
    var count = 0;
    for (var i = 0; i < bricks.length; i += 1) {
      if (bricks[i].alive) count += 1;
    }
    return count;
  }

  /* ---------- 球與板子 ---------- */
  function resetBall() {
    ball.ready = true;
    ball.x = paddle.x;
    ball.y = PADDLE_Y - ball.r - 2;
    ball.vx = 0;
    ball.vy = 0;
    ball.rot = 0;
    trail = [];
  }

  function launchBall() {
    if (state.mode !== "playing" || !ball.ready) return;
    var speed = currentBallSpeed();
    var angle = rand(-0.42, 0.42); /* 從垂直方向偏一點點，不要太斜 */
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
    ball.ready = false;
    burst(ball.x, ball.y, BUTTER, 8, "dot");
  }

  function pointerX(event) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return W / 2;
    return clamp(((event.clientX - rect.left) / rect.width) * W, 0, W);
  }

  function movePaddleTo(x) {
    paddle.targetX = clamp(x, paddle.w / 2, W - paddle.w / 2);
  }

  function updatePaddle(dt) {
    var direction = 0;
    if (keys.left) direction -= 1;
    if (keys.right) direction += 1;
    if (direction !== 0) {
      paddle.targetX = clamp(
        paddle.targetX + direction * 700 * dt,
        paddle.w / 2,
        W - paddle.w / 2
      );
    }
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 24);
    if (Math.abs(paddle.targetX - paddle.x) < 0.4) paddle.x = paddle.targetX;
  }

  /* ---------- 特效 ---------- */
  function burst(x, y, color, amount, shape) {
    for (var n = 0; n < amount; n += 1) {
      var angle = rand(0, Math.PI * 2);
      var speed = rand(50, 220);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: rand(0.35, 0.75),
        maxLife: 0.75,
        size: rand(2, 4.5),
        color: color,
        shape: shape || "dot",
        rot: rand(0, Math.PI * 2),
        spin: rand(-6, 6)
      });
    }
  }

  function floatText(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color, life: 0.75, maxLife: 0.75 });
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    state.mode = "playing";
    state.score = 0;
    state.lives = START_LIVES;
    state.level = 1;
    state.paused = false;
    startBest = best;

    paddle.x = W / 2;
    paddle.targetX = W / 2;
    keys.left = false;
    keys.right = false;

    buildBricks();
    resetBall();

    particles = [];
    floaters = [];
    banner = { text: "", life: 0, maxLife: 1 };
    shake = 0;
    lastTime = 0;

    syncHud();
    overlay.hidden = true;
    startBtn.textContent = "再玩一次";
  }

  function endGame() {
    state.mode = "over";
    state.paused = false;
    keys.left = false;
    keys.right = false;

    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }

    var isNewBest = state.score > startBest;
    syncHud();

    overlayTitle.textContent = isNewBest ? "新紀錄！太厲害了！" : "遊戲結束";
    overlayText.textContent =
      "這局得到 " +
      state.score +
      " 分，最高分是 " +
      best +
      " 分" +
      (isNewBest ? "，刷新紀錄啦！🎉" : "。再試一次一定可以更高！");
    startBtn.textContent = "再玩一次";
    overlay.hidden = false;
  }

  function loseLife() {
    state.lives -= 1;
    updateLives();
    shake = 14;
    burst(ball.x, H - 24, PINK, 16, "heart");

    if (state.lives <= 0) {
      state.lives = 0;
      syncHud();
      endGame();
      return;
    }

    resetBall();
    banner = {
      text: "還有 " + state.lives + " 條命！",
      life: 1.4,
      maxLife: 1.4
    };
  }

  function nextLevel() {
    var bonus = 100 + state.level * 50;
    state.score += bonus;
    state.level += 1;

    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }
    syncHud();

    buildBricks();
    resetBall();

    banner = {
      text: "第 " + state.level + " 關！+" + bonus,
      life: 1.8,
      maxLife: 1.8
    };
    floatText(W / 2, H / 2 + 70, "+" + bonus, BUTTER);
    burst(W / 2, H / 2, ROW_COLORS[(state.level - 2) % ROW_COLORS.length], 22, "heart");
    shake = Math.max(shake, 8);
  }

  /* ---------- 碰撞 ---------- */
  function checkBricks() {
    var hit = null;
    var hitDistance = Infinity;

    for (var i = 0; i < bricks.length; i += 1) {
      var brick = bricks[i];
      if (!brick.alive) continue;
      if (ball.x + ball.r < brick.x) continue;
      if (ball.x - ball.r > brick.x + brick.w) continue;
      if (ball.y + ball.r < brick.y) continue;
      if (ball.y - ball.r > brick.y + brick.h) continue;

      var centerX = brick.x + brick.w / 2;
      var centerY = brick.y + brick.h / 2;
      var distance = (ball.x - centerX) * (ball.x - centerX) + (ball.y - centerY) * (ball.y - centerY);

      if (distance < hitDistance) {
        hit = brick;
        hitDistance = distance;
      }
    }

    if (!hit) return false;

    /* 用穿透較淺的軸決定要往哪邊反彈，順便把球推出磚塊 */
    var overlapX = Math.min(
      ball.x + ball.r - hit.x,
      hit.x + hit.w - (ball.x - ball.r)
    );
    var overlapY = Math.min(
      ball.y + ball.r - hit.y,
      hit.y + hit.h - (ball.y - ball.r)
    );

    if (overlapX < overlapY) {
      if (ball.x < hit.x + hit.w / 2) {
        ball.x = hit.x - ball.r;
        ball.vx = -Math.abs(ball.vx);
      } else {
        ball.x = hit.x + hit.w + ball.r;
        ball.vx = Math.abs(ball.vx);
      }
    } else if (ball.y < hit.y + hit.h / 2) {
      ball.y = hit.y - ball.r;
      ball.vy = -Math.abs(ball.vy);
    } else {
      ball.y = hit.y + hit.h + ball.r;
      ball.vy = Math.abs(ball.vy);
    }

    hit.alive = false;
    state.score += 10;
    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }
    syncHud();

    var color = ROW_COLORS[(hit.row + state.level - 1) % ROW_COLORS.length];
    burst(ball.x, ball.y, color, 8, "dot");
    floatText(hit.x + hit.w / 2, hit.y + hit.h / 2, "+10", INK);
    shake = Math.max(shake, 2.5);
    return true;
  }

  /* 避免球幾乎水平飛、或在空欄位裡垂直上下無限循環（卡球） */
  function keepBallMoving() {
    var speed = Math.hypot(ball.vx, ball.vy);
    if (speed < 1) {
      ball.vx = 0;
      ball.vy = -currentBallSpeed();
      return;
    }

    /* 垂直分量不能太小：避免球貼著左右牆水平來回彈 */
    var minVy = speed * 0.22;
    if (Math.abs(ball.vy) < minVy) {
      var signY = ball.vy >= 0 ? 1 : -1;
      ball.vy = signY * minVy;
      var vxAbs = Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy));
      ball.vx = (ball.vx >= 0 ? 1 : -1) * vxAbs;
      speed = Math.hypot(ball.vx, ball.vy);
    }

    /* 水平分量也不能太小：避免球在同一欄位直上直下、永遠打不到其他磚塊 */
    var minVx = speed * 0.16;
    if (Math.abs(ball.vx) < minVx) {
      var signX = ball.vx >= 0 ? 1 : -1;
      ball.vx = signX * minVx;
      var signY2 = ball.vy >= 0 ? 1 : -1;
      ball.vy = signY2 * Math.sqrt(Math.max(0, speed * speed - ball.vx * ball.vx));
      speed = Math.hypot(ball.vx, ball.vy);
    }

    if (speed > MAX_BALL_SPEED) {
      ball.vx *= MAX_BALL_SPEED / speed;
      ball.vy *= MAX_BALL_SPEED / speed;
    }
  }

  function updateBall(dt) {
    if (ball.ready) {
      ball.x = paddle.x;
      ball.y = PADDLE_Y - ball.r - 2;
      return;
    }

    var speed = Math.hypot(ball.vx, ball.vy);
    if (!speed) speed = currentBallSpeed();

    /* 每步最多移動 5 像素，避免高速穿過磚塊或板子（卡球 / 漏球） */
    var steps = Math.min(14, Math.max(1, Math.ceil((speed * dt) / 5)));
    var stepDt = dt / steps;

    for (var s = 0; s < steps; s += 1) {
      var prevY = ball.y;

      ball.x += ball.vx * stepDt;
      ball.y += ball.vy * stepDt;
      ball.rot += stepDt * 4;

      /* 左右牆與天花板 */
      if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.vx = Math.abs(ball.vx);
      } else if (ball.x + ball.r > W) {
        ball.x = W - ball.r;
        ball.vx = -Math.abs(ball.vx);
      }
      if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy = Math.abs(ball.vy);
      }

      /* 板子：只有球往下掉、且這一步跨過板子頂端時才算，避免卡在板子裡 */
      if (
        ball.vy > 0 &&
        prevY + ball.r <= PADDLE_Y &&
        ball.y + ball.r >= PADDLE_Y &&
        ball.x > paddle.x - paddle.w / 2 - ball.r &&
        ball.x < paddle.x + paddle.w / 2 + ball.r
      ) {
        ball.y = PADDLE_Y - ball.r;
        var offset = clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1);
        var angle = offset * 1.05;
        var paddleSpeed = clamp(
          Math.hypot(ball.vx, ball.vy),
          currentBallSpeed(),
          MAX_BALL_SPEED
        );
        ball.vx = Math.sin(angle) * paddleSpeed;
        ball.vy = -Math.cos(angle) * paddleSpeed;
        shake = Math.max(shake, 3);
        burst(ball.x, PADDLE_Y, SKY, 5, "dot");
      }

      checkBricks();
      keepBallMoving();

      /* 掉出畫面底部 */
      if (ball.y - ball.r > H) {
        loseLife();
        return;
      }
    }

    trail.push({ x: ball.x, y: ball.y, life: 0.32 });
    if (trail.length > 16) trail.shift();
  }

  /* ---------- 更新主流程 ---------- */
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
      p.vy += 380 * dt;
      p.rot += p.spin * dt;
    }

    for (var j = floaters.length - 1; j >= 0; j -= 1) {
      var f = floaters[j];
      f.life -= dt;
      if (f.life <= 0) {
        floaters.splice(j, 1);
        continue;
      }
      f.y -= 46 * dt;
    }

    for (var t = trail.length - 1; t >= 0; t -= 1) {
      trail[t].life -= dt;
      if (trail[t].life <= 0) trail.splice(t, 1);
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 42);
  }

  function update(dt) {
    if (state.paused) return;

    updatePaddle(dt);
    updateBall(dt);
    if (state.mode !== "playing") return;

    if (banner.life > 0) banner.life = Math.max(0, banner.life - dt);

    if (bricksLeft() === 0) nextLevel();
  }

  /* ---------- 繪圖 ---------- */
  function drawBackground(time) {
    var gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#dff4fd");
    gradient.addColorStop(0.45, "#fdf3e2");
    gradient.addColorStop(1, "#ffe8ef");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    /* 柔和色塊 */
    for (var i = 0; i < decor.length; i += 1) {
      var item = decor[i];
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 閃爍的小星星 */
    for (var s = 0; s < sparkles.length; s += 1) {
      var sp = sparkles[s];
      var alpha = 0.22 + 0.5 * Math.abs(Math.sin(time * 0.001 * sp.speed + sp.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fffdf6";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBrick(brick) {
    var color = ROW_COLORS[(brick.row + state.level - 1) % ROW_COLORS.length];

    ctx.fillStyle = "rgba(74, 58, 50, 0.12)";
    roundRect(brick.x + 2, brick.y + 3, brick.w, brick.h, 9);
    ctx.fill();

    roundRect(brick.x, brick.y, brick.w, brick.h, 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* 上方高光 */
    roundRect(brick.x + 7, brick.y + 4, brick.w - 14, 6, 3);
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fill();

    /* 名畫磚框：內框與小星 */
    ctx.strokeStyle = "rgba(74, 58, 50, 0.38)";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(brick.x + 9, brick.y + 7, brick.w - 18, brick.h - 14);

    /* 中間的小愛心 */
    ctx.save();
    ctx.translate(brick.x + brick.w / 2, brick.y + brick.h / 2 + 2);
    heartPath(7.5);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(74, 58, 50, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawBricks() {
    for (var i = 0; i < bricks.length; i += 1) {
      if (bricks[i].alive) drawBrick(bricks[i]);
    }
  }

  function drawPaddle() {
    var x = paddle.x;
    var y = PADDLE_Y;
    var w = paddle.w;
    var h = paddle.h;

    ctx.save();

    /* 陰影 */
    ctx.fillStyle = "rgba(74, 58, 50, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x, y + h + 7, w * 0.52, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 緞帶板身 */
    roundRect(x - w / 2, y, w, h, h / 2);
    ctx.fillStyle = SKY;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 斜紋 */
    ctx.save();
    roundRect(x - w / 2 + 2, y + 2, w - 4, h - 4, (h - 4) / 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 3;
    for (var stripe = -w; stripe < w; stripe += 18) {
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + stripe, y + h);
      ctx.lineTo(x - w / 2 + stripe + 22, y);
      ctx.stroke();
    }
    ctx.restore();

    /* 中間的蝴蝶結 */
    var bowY = y + h / 2;
    ctx.fillStyle = BUTTER;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x - 13, bowY, 12, 8, -0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + 13, bowY, 12, 8, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffd76e";
    ctx.beginPath();
    ctx.arc(x, bowY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawTrail() {
    for (var i = 0; i < trail.length; i += 1) {
      var t = trail[i];
      ctx.globalAlpha = clamp(t.life / 0.32, 0, 1) * 0.35;
      ctx.fillStyle = BUTTER;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3 + (i / trail.length) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);

    ctx.shadowColor = "rgba(255, 224, 138, 0.95)";
    ctx.shadowBlur = 20;
    starPath(ball.r);
    ctx.fillStyle = "#ffe08a";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* 小臉 */
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-3.4, -1.5, 1.5, 0, Math.PI * 2);
    ctx.arc(3.4, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 1.5, 2.6, 0.25, Math.PI - 0.25);
    ctx.stroke();

    ctx.restore();
  }

  function drawLevelPill() {
    var label = "LEVEL " + state.level;
    ctx.save();
    roundRect(24, 22, 122, 32, 16);
    ctx.fillStyle = "rgba(255, 253, 248, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(74, 58, 50, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "800 15px 'Baloo 2', 'PingFang TC', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 85, 39);
    ctx.restore();
  }

  function drawBanner() {
    if (banner.life <= 0) return;
    var ratio = banner.life / banner.maxLife;
    var alpha = clamp(ratio / 0.35, 0, 1);
    var scale = 1 + (1 - clamp(ratio / 0.2, 0, 1)) * 0.08;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(scale, scale);
    ctx.font = "800 34px 'Baloo 2', 'PingFang TC', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 253, 248, 0.95)";
    ctx.lineWidth = 9;
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillText(banner.text, 0, 0);
    ctx.restore();
  }

  function drawHint(time) {
    if (!ball.ready || state.mode !== "playing") return;
    var alpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 0.004));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "800 19px 'Baloo 2', 'PingFang TC', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 253, 248, 0.95)";
    ctx.lineWidth = 7;
    ctx.strokeText("點擊畫面或按空白鍵發球 ↑", W / 2, PADDLE_Y - 74);
    ctx.fillStyle = INK;
    ctx.fillText("點擊畫面或按空白鍵發球 ↑", W / 2, PADDLE_Y - 74);
    ctx.restore();
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

    for (var j = 0; j < floaters.length; j += 1) {
      var f = floaters[j];
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.font = "800 20px 'Baloo 2', 'PingFang TC', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255, 253, 248, 0.9)";
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
    drawBricks();
    drawTrail();
    drawBall();
    drawPaddle();
    drawLevelPill();
    drawBanner();
    drawHint(time);
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

  /* ---------- 初始化與輸入 ---------- */
  buildBricks();
  resetBall();
  requestAnimationFrame(loop);

  window.addEventListener("keydown", function (event) {
    var isLeft = event.key === "ArrowLeft" || event.key === "a" || event.key === "A";
    var isRight = event.key === "ArrowRight" || event.key === "d" || event.key === "D";

    if (isLeft) {
      keys.left = true;
      if (state.mode === "playing") event.preventDefault();
    } else if (isRight) {
      keys.right = true;
      if (state.mode === "playing") event.preventDefault();
    } else if (event.key === " ") {
      event.preventDefault();
      if (event.repeat) return;
      if (state.mode === "playing") launchBall();
      else startGame();
    } else if (event.key === "Enter" && state.mode !== "playing") {
      event.preventDefault();
      startGame();
    }
  });

  window.addEventListener("keyup", function (event) {
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      keys.left = false;
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      keys.right = false;
    }
  });

  canvas.addEventListener("pointermove", function (event) {
    if (state.mode !== "playing") return;
    movePaddleTo(pointerX(event));
  });

  canvas.addEventListener("pointerdown", function (event) {
    if (state.mode !== "playing") return;
    event.preventDefault();
    movePaddleTo(pointerX(event));
    launchBall();
  });

  canvas.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);

  /* 切到別的頁籤時暫停，回來重置計時 */
  document.addEventListener("visibilitychange", function () {
    lastTime = 0;
    if (document.hidden) {
      if (state.mode === "playing") state.paused = true;
    } else if (state.mode === "playing") {
      state.paused = false;
    }
  });
})();
