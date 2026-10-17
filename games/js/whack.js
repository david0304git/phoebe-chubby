/* =========================================================
   打地鼠 — 30 秒限時，敲地鼠拿分數，小心炸彈
   一般地鼠 +10（連擊倍率最高 ×3）、金色地鼠 +30、
   炸彈 -1 條命並中斷連擊
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_KEY = "phoebe.whack.best";
  var HOLE_COUNT = 9;
  var GAME_SECONDS = 30;
  var MAX_LIVES = 3;
  var BEST_DISPLAY_EMPTY = "—";

  var boardEl = document.getElementById("board");
  if (!boardEl) return;

  var stageEl = document.getElementById("stage");
  var overlayEl = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var overlayScore = document.getElementById("result-score");
  var startBtn = document.getElementById("start");
  var restartBtn = document.getElementById("restart");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var livesEl = document.getElementById("lives");
  var timeEl = document.getElementById("time");
  var timebarEl = document.getElementById("timebar");
  var timeFillEl = document.getElementById("time-fill");
  var comboEl = document.getElementById("combo");

  var best = readBest();
  var state = {
    mode: "idle", /* idle / playing / over */
    score: 0,
    lives: MAX_LIVES,
    combo: 0,
    timeLeft: GAME_SECONDS
  };
  var holes = [];
  var clockId = null;
  var spawnId = null;
  var lastTick = 0;
  var pendingTimers = [];
  var pausedByVisibility = false;

  /* ---------- 小工具 ---------- */
  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function later(callback, milliseconds) {
    var id = window.setTimeout(function () {
      var at = pendingTimers.indexOf(id);
      if (at >= 0) pendingTimers.splice(at, 1);
      callback();
    }, milliseconds);
    pendingTimers.push(id);
    return id;
  }

  function cancelLater(id) {
    if (id === null) return;
    window.clearTimeout(id);
    var at = pendingTimers.indexOf(id);
    if (at >= 0) pendingTimers.splice(at, 1);
  }

  function clearPending() {
    for (var i = 0; i < pendingTimers.length; i += 1) {
      window.clearTimeout(pendingTimers[i]);
    }
    pendingTimers = [];
    spawnId = null;

    if (clockId !== null) {
      window.clearInterval(clockId);
      clockId = null;
    }
  }

  /* ---------- 最高紀錄 ---------- */
  function readBest() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null || raw === "") return null;
      var value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      return null;
    }
  }

  function saveBest(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch (error) {
      /* 無痕模式等情況就略過 */
    }
  }

  function showBest() {
    bestEl.textContent = best === null ? BEST_DISPLAY_EMPTY : String(best);
  }

  /* ---------- 建立 3×3 的洞 ---------- */
  function buildHoles() {
    boardEl.innerHTML = "";
    for (var i = 0; i < HOLE_COUNT; i += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "hole";
      button.setAttribute("aria-label", "第 " + (i + 1) + " 個洞，空的");

      var mound = document.createElement("span");
      mound.className = "hole__mound";
      mound.setAttribute("aria-hidden", "true");

      var mole = document.createElement("span");
      mole.className = "hole__mole";
      mole.setAttribute("aria-hidden", "true");

      button.appendChild(mound);
      button.appendChild(mole);
      boardEl.appendChild(button);

      var slot = {
        index: i,
        el: button,
        mole: mole,
        active: false,
        type: null,
        hideTimer: null
      };
      holes.push(slot);

      button.addEventListener("click", (function (target) {
        return function () {
          onHoleClick(target);
        };
      })(slot));
    }
  }

  function activeCount() {
    var count = 0;
    for (var i = 0; i < holes.length; i += 1) {
      if (holes[i].active) count += 1;
    }
    return count;
  }

  function multiplier() {
    return Math.min(3, 1 + Math.floor(state.combo / 3));
  }

  /* ---------- HUD ---------- */
  function updateScore() {
    scoreEl.textContent = String(state.score);
  }

  function updateLives() {
    var hearts = "";
    for (var i = 0; i < state.lives; i += 1) hearts += "♥";
    livesEl.textContent = hearts || "—";
  }

  function updateTime() {
    var seconds = Math.max(0, Math.ceil(state.timeLeft));
    timeEl.textContent = seconds + "s";
    timeFillEl.style.width = Math.max(0, Math.min(100, (state.timeLeft / GAME_SECONDS) * 100)) + "%";
    timebarEl.setAttribute("aria-valuenow", String(seconds));
  }

  function updateCombo() {
    var rate = multiplier();
    if (rate <= 1) {
      comboEl.hidden = true;
      return;
    }
    comboEl.hidden = false;
    comboEl.textContent = "倍率 ×" + rate;
  }

  function updateHud() {
    updateScore();
    updateLives();
    updateTime();
    updateCombo();
  }

  /* ---------- 冒出與縮回 ---------- */
  function clearMoleVisual(slot) {
    slot.el.classList.remove("is-up", "is-bonk", "is-gold", "is-bomb");
    slot.el.setAttribute("aria-label", "第 " + (slot.index + 1) + " 個洞，空的");
    slot.mole.textContent = "";
  }

  function hideMole(slot) {
    if (!slot.active) return;
    slot.active = false;
    slot.type = null;
    slot.el.classList.remove("is-up", "is-gold", "is-bomb");
    slot.el.setAttribute("aria-label", "第 " + (slot.index + 1) + " 個洞，空的");
    later(function () {
      if (slot.active) return;
      slot.mole.textContent = "";
    }, 180);
  }

  function resetHole(slot) {
    if (slot.hideTimer !== null) {
      cancelLater(slot.hideTimer);
      slot.hideTimer = null;
    }
    slot.active = false;
    slot.type = null;
    clearMoleVisual(slot);
  }

  function resetAllHoles() {
    for (var i = 0; i < holes.length; i += 1) resetHole(holes[i]);
  }

  function spawnOne() {
    if (state.mode !== "playing") return;

    var progress = 1 - state.timeLeft / GAME_SECONDS;
    var maxActive = progress >= 0.35 ? 3 : 2;
    if (activeCount() >= maxActive) return;

    var free = [];
    for (var i = 0; i < holes.length; i += 1) {
      if (!holes[i].active) free.push(holes[i]);
    }
    if (!free.length) return;

    var slot = free[Math.floor(Math.random() * free.length)];
    var roll = Math.random();
    var type = "normal";
    if (roll < 0.12) type = "bomb";
    else if (roll < 0.26) type = "gold";

    var duration = randomBetween(600, 900 - progress * 160);

    slot.active = true;
    slot.type = type;
    slot.el.classList.remove("is-bonk");
    slot.el.classList.add("is-up");
    slot.el.classList.toggle("is-gold", type === "gold");
    slot.el.classList.toggle("is-bomb", type === "bomb");
    slot.mole.textContent = type === "gold" ? "🌟" : type === "bomb" ? "💣" : "🐹";
    slot.el.setAttribute(
      "aria-label",
      "第 " + (slot.index + 1) + " 個洞，" +
        (type === "gold" ? "金色地鼠" : type === "bomb" ? "炸彈" : "地鼠")
    );

    slot.hideTimer = later(function () {
      slot.hideTimer = null;
      hideMole(slot);
    }, duration);
  }

  function queueSpawn(delay) {
    if (spawnId !== null) cancelLater(spawnId);
    spawnId = later(function () {
      spawnId = null;
      if (state.mode !== "playing") return;
      spawnOne();
      var progress = 1 - state.timeLeft / GAME_SECONDS;
      var base = 700 - progress * 300;
      queueSpawn(randomBetween(base * 0.72, base * 1.2));
    }, delay);
  }

  /* ---------- 分數特效 ---------- */
  function popText(holeEl, text, color) {
    var stageRect = stageEl.getBoundingClientRect();
    var holeRect = holeEl.getBoundingClientRect();
    var floater = document.createElement("span");
    floater.className = "floating-score";
    floater.textContent = text;
    floater.style.left = holeRect.left - stageRect.left + holeRect.width / 2 + "px";
    floater.style.top = holeRect.top - stageRect.top + holeRect.height * 0.18 + "px";
    floater.style.color = color;
    stageEl.appendChild(floater);
    window.setTimeout(function () {
      floater.remove();
    }, 820);
  }

  function shakeStage() {
    stageEl.classList.remove("is-shaking");
    void stageEl.offsetWidth;
    stageEl.classList.add("is-shaking");
    later(function () {
      stageEl.classList.remove("is-shaking");
    }, 320);
  }

  function bonk(slot) {
    slot.active = false;
    if (slot.hideTimer !== null) {
      cancelLater(slot.hideTimer);
      slot.hideTimer = null;
    }
    slot.el.classList.add("is-bonk");
    later(function () {
      if (slot.active) return;
      clearMoleVisual(slot);
    }, 190);
  }

  /* ---------- 點擊洞 ---------- */
  function onHoleClick(slot) {
    if (state.mode !== "playing" || !slot.active) return;

    if (slot.type === "bomb") {
      bonk(slot);
      state.lives = Math.max(0, state.lives - 1);
      state.combo = 0;
      updateHud();
      shakeStage();
      popText(slot.el, "-1 ♥", "var(--pink-deep)");
      if (state.lives <= 0) endGame("lives");
      return;
    }

    var gained;
    if (slot.type === "gold") {
      state.combo += 1;
      gained = 30;
      popText(slot.el, "+30", "#b07d12");
    } else {
      var rate = multiplier();
      state.combo += 1;
      gained = 10 * rate;
      popText(slot.el, "+" + gained, "var(--ink)");
    }

    state.score += gained;
    bonk(slot);
    updateHud();
  }

  /* ---------- 計時 ---------- */
  function startClock() {
    lastTick = performance.now();
    clockId = window.setInterval(tick, 100);
  }

  function tick() {
    if (state.mode !== "playing") return;
    var now = performance.now();
    var delta = Math.min(1, (now - lastTick) / 1000);
    lastTick = now;
    state.timeLeft = Math.max(0, state.timeLeft - delta);
    updateTime();
    if (state.timeLeft <= 0) endGame("time");
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    clearPending();
    pausedByVisibility = false;
    state.mode = "playing";
    state.score = 0;
    state.lives = MAX_LIVES;
    state.combo = 0;
    state.timeLeft = GAME_SECONDS;

    resetAllHoles();
    updateHud();
    overlayScore.hidden = true;
    overlayEl.hidden = true;
    startBtn.textContent = "再玩一次";

    startClock();
    queueSpawn(450);
  }

  function endGame(reason) {
    if (state.mode !== "playing") return;
    state.mode = "over";
    pausedByVisibility = false;
    clearPending();
    resetAllHoles();
    updateHud();

    var isNewBest = best === null ? state.score > 0 : state.score > best;
    if (isNewBest) {
      best = state.score;
      saveBest(best);
      showBest();
    }

    overlayTitle.textContent = reason === "lives" ? "哎呀，被炸到了！" : "時間到！";
    overlayScore.textContent = state.score + " 分";
    overlayScore.hidden = false;
    if (isNewBest) {
      overlayText.textContent = "這局得到 " + state.score + " 分，是新紀錄！🎉";
    } else if (best === null) {
      overlayText.textContent = "這局得到 " + state.score + " 分。";
    } else {
      overlayText.textContent = "這局得到 " + state.score + " 分，最高分是 " + best + " 分。";
    }
    startBtn.textContent = "再玩一次";
    overlayEl.hidden = false;
  }

  /* ---------- 分頁切換時暫停 ---------- */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (state.mode !== "playing") return;
      pausedByVisibility = true;
      clearPending();
      resetAllHoles();
      return;
    }

    if (pausedByVisibility && state.mode === "playing") {
      pausedByVisibility = false;
      startClock();
      queueSpawn(350);
    }
  });

  window.addEventListener("pagehide", clearPending);

  /* ---------- 初始化 ---------- */
  showBest();
  updateHud();
  buildHoles();
  if (timeFillEl) timeFillEl.style.width = "100%";

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
})();
