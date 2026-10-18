/* =========================================================
   記憶翻翻牌 — 翻開兩張相同圖案，找出 8 對可愛卡片
   每翻開一張算一步，最高紀錄存「最少步數」
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_KEY = "phoebe.memory.best";
  var PAIR_COUNT = 8;
  var CARD_COUNT = PAIR_COUNT * 2;
  var FLIP_BACK_MS = 650;
  var MATCH_LOCK_MS = 280;
  var SYMBOLS = [
    { icon: "🎀", label: "藍絲帶" },
    { icon: "📷", label: "相機" },
    { icon: "🍰", label: "草莓蛋糕" },
    { icon: "⭐", label: "奶油星星" },
    { icon: "💜", label: "紫色眼睛" },
    { icon: "🖼️", label: "名畫" },
    { icon: "🧢", label: "旅行帽" },
    { icon: "🎮", label: "小遊戲" }
  ];

  var boardEl = document.getElementById("board");
  if (!boardEl) return;

  var overlayEl = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var overlayScore = document.getElementById("result-score");
  var startBtn = document.getElementById("start");
  var restartBtn = document.getElementById("restart");
  var movesEl = document.getElementById("moves");
  var bestEl = document.getElementById("best");
  var pairsEl = document.getElementById("pairs");
  var timeEl = document.getElementById("time");

  /* ---------- 狀態 ---------- */
  var best = readBest();
  var state = {
    mode: "idle", /* idle / playing / over */
    moves: 0,
    pairs: 0,
    first: null,
    second: null,
    lock: false,
    elapsed: 0,
    startedAt: 0
  };
  var timerId = null;
  var flipTimer = null;
  var lockTimer = null;
  var pausedAt = 0;

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
    bestEl.textContent = best === null ? "—" : String(best);
  }

  /* ---------- 小工具 ---------- */
  function pad2(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function formatTime(milliseconds) {
    var total = Math.floor(Math.max(0, milliseconds) / 1000);
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return pad2(minutes) + ":" + pad2(seconds);
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temporary = list[i];
      list[i] = list[j];
      list[j] = temporary;
    }
    return list;
  }

  function cardLabel(card, stateText) {
    var number = Number(card.getAttribute("data-index")) + 1;
    if (stateText === "matched") {
      return "第 " + number + " 張卡片，已配對，圖案 " + card.getAttribute("data-symbol");
    }
    if (stateText === "flipped") {
      return "第 " + number + " 張卡片，已翻開，圖案 " + card.getAttribute("data-symbol");
    }
    return "第 " + number + " 張卡片，未翻開";
  }

  /* ---------- 建立牌面 ---------- */
  function buildDeck() {
    var deck = [];
    for (var i = 0; i < PAIR_COUNT; i += 1) {
      deck.push(SYMBOLS[i]);
      deck.push(SYMBOLS[i]);
    }
    return shuffle(deck);
  }

  function createCard(index, item) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "cell memo";
    card.setAttribute("data-index", String(index));
    card.setAttribute("data-symbol", item.label);
    card.setAttribute("aria-label", cardLabel(card, "back"));

    var inner = document.createElement("span");
    inner.className = "memo__inner";

    var back = document.createElement("span");
    back.className = "memo__face memo__face--back";
    back.setAttribute("aria-hidden", "true");
    back.textContent = "♡";

    var front = document.createElement("span");
    front.className = "memo__face memo__face--front";
    front.setAttribute("aria-hidden", "true");
    front.textContent = item.icon;

    inner.appendChild(back);
    inner.appendChild(front);
    card.appendChild(inner);
    card.addEventListener("click", onCardClick);
    return card;
  }

  function buildBoard() {
    var deck = buildDeck();
    boardEl.innerHTML = "";
    for (var i = 0; i < CARD_COUNT; i += 1) {
      boardEl.appendChild(createCard(i, deck[i]));
    }
  }

  /* ---------- 計時 ---------- */
  function startTimer() {
    if (timerId !== null) return;
    pausedAt = 0;
    state.startedAt = Date.now() - state.elapsed;
    timerId = window.setInterval(updateTimer, 250);
    updateTimer();
  }

  function updateTimer() {
    state.elapsed = Date.now() - state.startedAt;
    timeEl.textContent = formatTime(state.elapsed);
  }

  function stopTimer() {
    if (timerId === null) return;
    window.clearInterval(timerId);
    timerId = null;
  }

  function clearTimers() {
    stopTimer();
    if (flipTimer !== null) {
      window.clearTimeout(flipTimer);
      flipTimer = null;
    }
    if (lockTimer !== null) {
      window.clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  /* ---------- 翻牌流程 ---------- */
  function onCardClick(event) {
    var card = event.currentTarget;
    if (state.mode !== "playing" || state.lock) return;
    if (card.classList.contains("is-flipped") || card.classList.contains("is-matched")) return;

    startTimer();
    state.moves += 1;
    movesEl.textContent = String(state.moves);

    card.classList.add("is-flipped");
    card.setAttribute("aria-label", cardLabel(card, "flipped"));

    if (state.first === null) {
      state.first = card;
      return;
    }

    state.second = card;
    if (state.first.getAttribute("data-symbol") === state.second.getAttribute("data-symbol")) {
      handleMatch();
    } else {
      handleMismatch();
    }
  }

  function handleMatch() {
    state.lock = true;
    var first = state.first;
    var second = state.second;

    first.classList.add("is-matched");
    second.classList.add("is-matched");
    first.setAttribute("aria-label", cardLabel(first, "matched"));
    second.setAttribute("aria-label", cardLabel(second, "matched"));

    state.first = null;
    state.second = null;
    state.pairs += 1;
    pairsEl.textContent = state.pairs + "/" + PAIR_COUNT;

    if (state.pairs >= PAIR_COUNT) {
      finishGame();
      return;
    }

    lockTimer = window.setTimeout(function () {
      lockTimer = null;
      state.lock = false;
    }, MATCH_LOCK_MS);
  }

  function handleMismatch() {
    state.lock = true;
    var first = state.first;
    var second = state.second;

    flipTimer = window.setTimeout(function () {
      flipTimer = null;
      first.classList.remove("is-flipped");
      second.classList.remove("is-flipped");
      first.setAttribute("aria-label", cardLabel(first, "back"));
      second.setAttribute("aria-label", cardLabel(second, "back"));
      state.first = null;
      state.second = null;
      state.lock = false;
    }, FLIP_BACK_MS);
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    clearTimers();
    pausedAt = 0;
    state.mode = "playing";
    state.moves = 0;
    state.pairs = 0;
    state.first = null;
    state.second = null;
    state.lock = false;
    state.elapsed = 0;
    state.startedAt = 0;

    movesEl.textContent = "0";
    pairsEl.textContent = "0/" + PAIR_COUNT;
    timeEl.textContent = "00:00";
    overlayScore.hidden = true;

    buildBoard();
    overlayEl.hidden = true;
    startBtn.textContent = "再玩一次";
  }

  function finishGame() {
    state.mode = "over";
    stopTimer();
    if (state.startedAt) {
      state.elapsed = Date.now() - state.startedAt;
    }
    timeEl.textContent = formatTime(state.elapsed);

    var isNewBest = best === null || state.moves < best;
    if (isNewBest) {
      best = state.moves;
      saveBest(best);
      showBest();
    }

    overlayTitle.textContent = "全部配對成功！🎉";
    overlayScore.textContent = state.moves + " 步";
    overlayScore.hidden = false;
    overlayText.textContent =
      "時間 " +
      formatTime(state.elapsed) +
      (isNewBest
        ? "，這是最少步數的新紀錄！"
        : "，最少步數紀錄是 " + best + " 步。");
    startBtn.textContent = "再玩一次";
    overlayEl.hidden = false;
  }

  /* ---------- 分頁切換時暫停計時 ---------- */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (state.mode === "playing" && timerId !== null) {
        state.elapsed = Date.now() - state.startedAt;
        stopTimer();
        pausedAt = Date.now();
      }
      return;
    }

    if (state.mode === "playing" && pausedAt) {
      pausedAt = 0;
      startTimer();
    }
  });

  window.addEventListener("pagehide", clearTimers);

  /* ---------- 初始化 ---------- */
  showBest();
  buildBoard();
  updateHudClock();

  function updateHudClock() {
    movesEl.textContent = String(state.moves);
    pairsEl.textContent = state.pairs + "/" + PAIR_COUNT;
    timeEl.textContent = formatTime(state.elapsed);
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
})();
