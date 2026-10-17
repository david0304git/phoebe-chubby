/* =========================================================
   菲比拼圖 — 3×3 滑動拼圖
   從完成狀態隨機走 120 步合法移動來打亂，保證可解
   最少步數紀錄存 localStorage
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_KEY = "phoebe.puzzle.best";
  var SIZE = 3;
  var TILE_COUNT = SIZE * SIZE;
  var BLANK_VALUE = TILE_COUNT - 1;
  var SHUFFLE_STEPS = 120;
  var IMAGE_URL = "../assets/img/phoebe/phoebe-square.jpg";
  var FINISH_DELAY_MS = 520;

  var gridEl = document.getElementById("puzzle");
  if (!gridEl) return;

  var overlayEl = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var overlayScore = document.getElementById("result-score");
  var startBtn = document.getElementById("start");
  var restartBtn = document.getElementById("restart");
  var shuffleBtn = document.getElementById("shuffle");
  var previewBtn = document.getElementById("preview-toggle");
  var previewEl = document.getElementById("preview");
  var movesEl = document.getElementById("moves");
  var bestEl = document.getElementById("best");
  var timeEl = document.getElementById("time");

  var best = readBest();
  var tiles = [];
  var board = [];
  var blankIndex = BLANK_VALUE;
  var state = {
    mode: "idle", /* idle / playing / over */
    moves: 0,
    elapsed: 0,
    startedAt: 0
  };
  var timerId = null;
  var finishTimer = null;
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

  function isAdjacent(positionA, positionB) {
    var rowA = Math.floor(positionA / SIZE);
    var columnA = positionA % SIZE;
    var rowB = Math.floor(positionB / SIZE);
    var columnB = positionB % SIZE;
    return Math.abs(rowA - rowB) + Math.abs(columnA - columnB) === 1;
  }

  function neighbors(position) {
    var result = [];
    var row = Math.floor(position / SIZE);
    var column = position % SIZE;
    if (row > 0) result.push(position - SIZE);
    if (row < SIZE - 1) result.push(position + SIZE);
    if (column > 0) result.push(position - 1);
    if (column < SIZE - 1) result.push(position + 1);
    return result;
  }

  function swap(positionA, positionB) {
    var temporary = board[positionA];
    board[positionA] = board[positionB];
    board[positionB] = temporary;
  }

  function isSolved() {
    for (var i = 0; i < TILE_COUNT; i += 1) {
      if (board[i] !== i) return false;
    }
    return true;
  }

  /* ---------- 產生盤面 ---------- */
  function randomStep(previousBlank) {
    var oldBlank = blankIndex;
    var options = neighbors(oldBlank).filter(function (position) {
      return position !== previousBlank;
    });
    var pick = options[Math.floor(Math.random() * options.length)];
    swap(oldBlank, pick);
    blankIndex = pick;
    return oldBlank;
  }

  function shuffleBoard() {
    board = [];
    for (var i = 0; i < TILE_COUNT; i += 1) board.push(i);
    blankIndex = BLANK_VALUE;

    var previous = -1;
    for (var step = 0; step < SHUFFLE_STEPS; step += 1) {
      previous = randomStep(previous);
    }

    /* 極少數情況會剛好走回完成狀態，再多走幾步直到不是完成的盤面 */
    var guard = 0;
    while (isSolved() && guard < 30) {
      previous = randomStep(previous);
      guard += 1;
    }
  }

  /* ---------- 建立與繪製拼圖 ---------- */
  function buildTiles() {
    gridEl.innerHTML = "";
    tiles = [];
    for (var i = 0; i < TILE_COUNT; i += 1) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "puzzle-tile";
      tile.addEventListener("click", onTileClick);
      gridEl.appendChild(tile);
      tiles.push(tile);
    }
  }

  function render() {
    for (var position = 0; position < TILE_COUNT; position += 1) {
      var value = board[position];
      var tile = tiles[position];

      tile.classList.remove("is-blank", "is-movable");

      if (value === BLANK_VALUE) {
        tile.classList.add("is-blank");
        tile.disabled = true;
        tile.style.backgroundImage = "";
        tile.style.backgroundPosition = "";
        tile.setAttribute("aria-label", "空白格，旁邊的拼圖塊可以滑進來");
        continue;
      }

      var column = value % SIZE;
      var row = Math.floor(value / SIZE);
      tile.disabled = false;
      tile.style.backgroundImage = 'url("' + IMAGE_URL + '")';
      tile.style.backgroundPosition = column * 50 + "% " + row * 50 + "%";
      tile.setAttribute("aria-label", "拼圖第 " + (value + 1) + " 塊");
      if (isAdjacent(position, blankIndex)) {
        tile.classList.add("is-movable");
      }
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
    if (finishTimer !== null) {
      window.clearTimeout(finishTimer);
      finishTimer = null;
    }
  }

  /* ---------- 移動 ---------- */
  function onTileClick(event) {
    var tile = event.currentTarget;
    var position = tiles.indexOf(tile);
    if (position < 0) return;
    attemptMove(position);
  }

  function attemptMove(position) {
    if (state.mode !== "playing") return;
    if (!isAdjacent(position, blankIndex)) return;
    makeMove(position);
  }

  function makeMove(position) {
    startTimer();

    var destination = blankIndex;
    board[destination] = board[position];
    board[position] = BLANK_VALUE;
    blankIndex = position;

    state.moves += 1;
    movesEl.textContent = String(state.moves);
    render();

    var movedTile = tiles[destination];
    movedTile.classList.remove("is-pop");
    void movedTile.offsetWidth;
    movedTile.classList.add("is-pop");

    if (isSolved()) finishGame();
  }

  /* ---------- 預覽原圖 ---------- */
  function hidePreview() {
    previewEl.hidden = true;
    previewBtn.setAttribute("aria-pressed", "false");
    previewBtn.textContent = "看原圖";
  }

  function togglePreview() {
    var show = previewEl.hidden;
    previewEl.hidden = !show;
    previewBtn.setAttribute("aria-pressed", show ? "true" : "false");
    previewBtn.textContent = show ? "收起原圖" : "看原圖";
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    clearTimers();
    pausedAt = 0;
    state.mode = "playing";
    state.moves = 0;
    state.elapsed = 0;
    state.startedAt = 0;

    movesEl.textContent = "0";
    timeEl.textContent = "00:00";
    overlayScore.hidden = true;
    hidePreview();

    shuffleBoard();
    render();

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

    finishTimer = window.setTimeout(function () {
      finishTimer = null;
      overlayTitle.textContent = "拼好了！🎉";
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
    }, FINISH_DELAY_MS);
  }

  /* ---------- 鍵盤 ---------- */
  window.addEventListener("keydown", function (event) {
    if (state.mode !== "playing") return;

    var row = Math.floor(blankIndex / SIZE);
    var column = blankIndex % SIZE;
    var target = -1;

    if (event.key === "ArrowUp" && row < SIZE - 1) {
      target = blankIndex + SIZE; /* 把空格下方的方塊往上推 */
    } else if (event.key === "ArrowDown" && row > 0) {
      target = blankIndex - SIZE; /* 把空格上方的方塊往下推 */
    } else if (event.key === "ArrowLeft" && column < SIZE - 1) {
      target = blankIndex + 1; /* 把空格右方的方塊往左推 */
    } else if (event.key === "ArrowRight" && column > 0) {
      target = blankIndex - 1; /* 把空格左方的方塊往右推 */
    } else {
      return;
    }

    event.preventDefault();
    makeMove(target);
  });

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
  buildTiles();
  shuffleBoard();
  render();

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  shuffleBtn.addEventListener("click", function () {
    if (state.mode === "idle") {
      shuffleBoard();
      render();
      return;
    }
    startGame();
  });
  previewBtn.addEventListener("click", togglePreview);
})();
