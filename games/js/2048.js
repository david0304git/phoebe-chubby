/* =========================================================
   數字合合樂 — 4x4 的 2048
   用方向鍵 / 方向按鈕 / 盤面滑動，把相同數字合併成兩倍。
   合併規則：每個方塊每步只能合併一次。
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_KEY = "phoebe.2048.best";
  var SIZE = 4;

  var boardEl = document.getElementById("board");
  if (!boardEl) return;

  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var startBtn = document.getElementById("start");
  var continueBtn = document.getElementById("continue");
  var restartBtn = document.getElementById("restart");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var movesEl = document.getElementById("moves");
  var padButtons = document.querySelectorAll(".n2048-pad__btn");

  var cells = Array.prototype.slice.call(boardEl.querySelectorAll(".num-cell"));
  if (cells.length !== SIZE * SIZE) return;

  /* 奶油星海的收藏圖鑑：數值 → 圖示與名稱 */
  var TILE_ITEMS = {
    2: { icon: "✦", label: "奶油星屑" },
    4: { icon: "⭐", label: "奶油星星" },
    8: { icon: "🎀", label: "藍絲帶" },
    16: { icon: "📷", label: "相機" },
    32: { icon: "🍰", label: "草莓蛋糕" },
    64: { icon: "🖼️", label: "名畫" },
    128: { icon: "🌙", label: "月亮" },
    256: { icon: "🪐", label: "小星球" },
    512: { icon: "🌈", label: "奶油星海" },
    1024: { icon: "👑", label: "星海公主" },
    2048: { icon: "💖", label: "菲比啾比" }
  };

  /* ---------- 小工具 ---------- */
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
  var board = [];
  for (var b = 0; b < SIZE * SIZE; b += 1) board.push(0);

  var state = {
    mode: "idle", /* idle | playing | won | over */
    score: 0,
    moves: 0,
    won: false,
    pendingGameOver: false
  };

  /* ---------- 盤面每條線的索引（由邊往內排） ---------- */
  var lines = { left: [], right: [], up: [], down: [] };

  for (var r = 0; r < SIZE; r += 1) {
    var rowLeft = [];
    var rowRight = [];
    for (var c = 0; c < SIZE; c += 1) {
      rowLeft.push(r * SIZE + c);
      rowRight.push(r * SIZE + (SIZE - 1 - c));
    }
    lines.left.push(rowLeft);
    lines.right.push(rowRight);
  }

  for (var col = 0; col < SIZE; col += 1) {
    var colUp = [];
    var colDown = [];
    for (var row = 0; row < SIZE; row += 1) {
      colUp.push(row * SIZE + col);
      colDown.push((SIZE - 1 - row) * SIZE + col);
    }
    lines.up.push(colUp);
    lines.down.push(colDown);
  }

  /* ---------- 畫面 ---------- */
  function syncHud() {
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(best);
    movesEl.textContent = String(state.moves);
  }

  function render(animation) {
    var i;

    for (i = 0; i < cells.length; i += 1) {
      cells[i].classList.remove("is-new", "is-merged");
      var value = board[i];
      var item = value ? TILE_ITEMS[value] : null;
      cells[i].textContent = item ? item.icon : value ? String(value) : "";
      if (value) cells[i].setAttribute("data-value", String(value));
      else cells[i].removeAttribute("data-value");
      if (item) cells[i].setAttribute("aria-label", item.label + "，數值 " + value);
      else cells[i].removeAttribute("aria-label");
    }

    if (!animation) return;

    var newIndices = animation.newIndices || [];
    var mergedIndices = animation.mergedIndices || [];
    if (!newIndices.length && !mergedIndices.length) return;

    /* 先讀一次 offsetWidth，強制瀏覽器套用「移除 class」後的狀態，動畫才會重播 */
    void boardEl.offsetWidth;

    for (i = 0; i < newIndices.length; i += 1) {
      cells[newIndices[i]].classList.add("is-new");
    }
    for (i = 0; i < mergedIndices.length; i += 1) {
      cells[mergedIndices[i]].classList.add("is-merged");
    }
  }

  /* ---------- 盤面邏輯 ---------- */
  function emptyIndices() {
    var list = [];
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] === 0) list.push(i);
    }
    return list;
  }

  function addRandomTile() {
    var empties = emptyIndices();
    if (!empties.length) return -1;
    var index = empties[Math.floor(Math.random() * empties.length)];
    board[index] = Math.random() < 0.9 ? 2 : 4;
    return index;
  }

  /* 把一個方向的盤面壓縮並合併；merged 回傳合併後方塊的位置 */
  function slide(direction) {
    var groups = lines[direction];
    var next = board.slice();
    var gained = 0;
    var merged = [];

    for (var g = 0; g < groups.length; g += 1) {
      var line = groups[g];
      var values = [];

      for (var k = 0; k < line.length; k += 1) {
        if (board[line[k]] !== 0) values.push(board[line[k]]);
      }

      var out = [];
      var mergedSlots = [];

      for (var v = 0; v < values.length; v += 1) {
        if (v + 1 < values.length && values[v] === values[v + 1]) {
          var mergedValue = values[v] * 2;
          out.push(mergedValue);
          mergedSlots.push(out.length - 1);
          gained += mergedValue;
          v += 1; /* 跳過被合併掉的那顆，保證每顆每步只合併一次 */
        } else {
          out.push(values[v]);
        }
      }

      for (var slot = 0; slot < line.length; slot += 1) {
        next[line[slot]] = slot < out.length ? out[slot] : 0;
      }

      for (var m = 0; m < mergedSlots.length; m += 1) {
        merged.push(line[mergedSlots[m]]);
      }
    }

    var changed = false;
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] !== next[i]) {
        changed = true;
        break;
      }
    }

    if (!changed) return { moved: false, gained: 0, merged: [] };

    board = next;
    return { moved: true, gained: gained, merged: merged };
  }

  function hasValue(value) {
    return board.indexOf(value) !== -1;
  }

  function hasMoves() {
    for (var i = 0; i < board.length; i += 1) {
      if (board[i] === 0) return true;
      var row = Math.floor(i / SIZE);
      var col = i % SIZE;
      if (col + 1 < SIZE && board[i] === board[i + 1]) return true;
      if (row + 1 < SIZE && board[i] === board[i + SIZE]) return true;
    }
    return false;
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame() {
    board = [];
    for (var i = 0; i < SIZE * SIZE; i += 1) board.push(0);

    state.mode = "playing";
    state.score = 0;
    state.moves = 0;
    state.won = false;
    state.pendingGameOver = false;
    startBest = best;

    var first = addRandomTile();
    var second = addRandomTile();

    overlay.hidden = true;
    continueBtn.hidden = true;
    startBtn.textContent = "再玩一次";

    syncHud();
    render({ newIndices: [first, second], mergedIndices: [] });
  }

  function endGame() {
    state.mode = "over";

    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }

    var isNewBest = state.score > startBest;
    syncHud();

    overlayTitle.textContent = "遊戲結束";
    overlayText.textContent =
      "這盤得到 " +
      state.score +
      " 分，走了 " +
      state.moves +
      " 步。最高分是 " +
      best +
      " 分" +
      (isNewBest ? "，是新紀錄！🎉" : "。") +
      "再挑戰一次吧！";
    startBtn.textContent = "再玩一次";
    continueBtn.hidden = true;
    overlay.hidden = false;
  }

  function showWin() {
    state.mode = "won";
    state.pendingGameOver = !hasMoves();

    overlayTitle.textContent = "達標！菲比啾比誕生！";
    overlayText.textContent =
      "你合出了 2048 的菲比啾比，太厲害了！可以繼續挑戰 4096、8192，也可以重新開始。";
    startBtn.textContent = "重新開始";
    continueBtn.hidden = false;
    overlay.hidden = false;
  }

  function continueGame() {
    if (state.mode !== "won") return;
    overlay.hidden = true;
    continueBtn.hidden = true;

    if (state.pendingGameOver) {
      endGame();
      return;
    }
    state.mode = "playing";
  }

  function doMove(direction) {
    if (state.mode !== "playing") return;
    if (!lines[direction]) return;

    var result = slide(direction);
    if (!result.moved) return;

    state.score += result.gained;
    state.moves += 1;

    var newIndex = addRandomTile();
    if (state.score > best) {
      best = state.score;
      saveBest(best);
    }

    syncHud();
    render({
      newIndices: newIndex >= 0 ? [newIndex] : [],
      mergedIndices: result.merged
    });

    if (!state.won && hasValue(2048)) {
      state.won = true;
      showWin();
      return;
    }

    if (!hasMoves()) endGame();
  }

  /* ---------- 輸入 ---------- */
  var keyDirections = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    W: "up",
    A: "left",
    S: "down",
    D: "right"
  };

  window.addEventListener("keydown", function (event) {
    var direction = keyDirections[event.key];

    if (state.mode === "playing" && direction) {
      event.preventDefault();
      doMove(direction);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      if (state.mode === "won") {
        event.preventDefault();
        continueGame();
      } else if (state.mode === "idle" || state.mode === "over") {
        event.preventDefault();
        startGame();
      }
    }
  });

  for (var p = 0; p < padButtons.length; p += 1) {
    (function (button) {
      button.addEventListener("click", function () {
        doMove(button.getAttribute("data-dir"));
      });
    })(padButtons[p]);
  }

  /* 手機 / 滑鼠在盤面上滑動 */
  var swipe = { active: false, x: 0, y: 0 };

  boardEl.addEventListener("pointerdown", function (event) {
    if (state.mode !== "playing") return;
    swipe.active = true;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    if (boardEl.setPointerCapture) {
      try {
        boardEl.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 少數瀏覽器不支援就略過，不影響滑動 */
      }
    }
  });

  boardEl.addEventListener("pointerup", function (event) {
    if (!swipe.active) return;
    swipe.active = false;

    var dx = event.clientX - swipe.x;
    var dy = event.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      doMove(dx > 0 ? "right" : "left");
    } else {
      doMove(dy > 0 ? "down" : "up");
    }
  });

  boardEl.addEventListener("pointercancel", function () {
    swipe.active = false;
  });

  startBtn.addEventListener("click", startGame);
  continueBtn.addEventListener("click", continueGame);
  restartBtn.addEventListener("click", startGame);

  /* ---------- 初始畫面 ---------- */
  bestEl.textContent = String(best);
  syncHud();
  render();
})();
