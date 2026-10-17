/* =========================================================
   Phoebe 小星球 — 共用互動
   ========================================================= */
(function () {
  "use strict";

  /* ---------- 1. 手機導覽 ---------- */
  var navToggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");

  if (navToggle && nav) {
    var closeNav = function () {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    };

    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (event) {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(event.target) || navToggle.contains(event.target)) return;
      closeNav();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeNav();
        navToggle.focus();
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 760) closeNav();
    });
  }

  /* ---------- 2. 進場動畫 ---------- */
  var revealItems = document.querySelectorAll("[data-reveal]");

  if ("IntersectionObserver" in window && revealItems.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var delay = Number(el.getAttribute("data-reveal-delay") || 0);
          setTimeout(function () {
            el.classList.add("is-visible");
          }, delay);
          observer.unobserve(el);
        });
      },
      { threshold: 0.01, rootMargin: "0px 0px -40px 0px" }
    );

    revealItems.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    revealItems.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  /* ---------- 3. 最佳成績 ---------- */
  function readBest(game) {
    try {
      var raw = window.localStorage.getItem("phoebe." + game + ".best");
      if (raw === null || raw === "") return null;
      var value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function pad2(number) {
    return String(number).padStart(2, "0");
  }

  function formatBest(value, format) {
    if (format === "time") {
      var total = Math.max(0, Math.round(value));
      var minutes = Math.floor(total / 60);
      var seconds = total % 60;
      return "最快 " + pad2(minutes) + ":" + pad2(seconds);
    }
    if (format === "moves") return "最少 " + value + " 步";
    if (format === "level") return "最高 LV." + value;
    return "最高 " + value;
  }

  document.querySelectorAll("[data-best]").forEach(function (el) {
    var game = el.getAttribute("data-best");
    var value = readBest(game);
    if (value === null) {
      el.textContent = "還沒玩過";
      el.setAttribute("data-empty", "true");
      return;
    }
    el.textContent = formatBest(value, el.getAttribute("data-best-format"));
    el.removeAttribute("data-empty");
  });

  /* ---------- 4. 菲比小幫手 ---------- */
  var buddy = document.querySelector("[data-buddy]");

  if (buddy) {
    var buddyToggle = buddy.querySelector(".buddy__toggle");
    var buddyBubble = buddy.querySelector(".buddy__bubble");
    var lines = [
      "今天想去哪裡拍照呢？📸",
      "拍名畫的時候，記得要擺出神祕的微笑喔。",
      "偷偷跟你說，我最喜歡星星接接樂了 ✦",
      "要不要去玩菲比拼圖？我已經在裡面了！",
      "換照片的方法寫在 README 裡，超簡單的～",
      "發呆的時候，最適合玩一場小遊戲了。",
      "這個小屋是用滿滿的愛心做成的喔 ♡",
      "旅行照片放進 photos/ 資料夾就可以了！",
      "記得把這個網站加到我的最愛 ⭐"
    ];
    var lineIndex = Math.floor(Math.random() * lines.length);

    buddyToggle.addEventListener("click", function () {
      var isOpen = !buddyBubble.hasAttribute("hidden");
      if (isOpen) {
        buddyBubble.setAttribute("hidden", "");
        buddyToggle.setAttribute("aria-expanded", "false");
        return;
      }
      buddyBubble.textContent = lines[lineIndex];
      lineIndex = (lineIndex + 1) % lines.length;
      buddyBubble.removeAttribute("hidden");
      buddyBubble.classList.remove("is-pop");
      void buddyBubble.offsetWidth;
      buddyBubble.classList.add("is-pop");
      buddyToggle.setAttribute("aria-expanded", "true");
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (buddyBubble.hasAttribute("hidden")) return;
      buddyBubble.setAttribute("hidden", "");
      buddyToggle.setAttribute("aria-expanded", "false");
      buddyToggle.focus();
    });
  }

  /* ---------- 5. 年份 ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
