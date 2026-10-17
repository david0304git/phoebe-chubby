/* =========================================================
   Phoebe 小星球 — 相簿頁
   由 assets/js/gallery-data.js 的資料產生卡片、篩選與燈箱
   ========================================================= */
(function () {
  "use strict";

  var data = window.PHOEBE_GALLERY;
  if (!data || !Array.isArray(data.items)) return;

  var grid = document.getElementById("gallery-grid");
  var filterBar = document.getElementById("gallery-filters");
  var countEl = document.getElementById("gallery-count");
  var emptyEl = document.getElementById("gallery-empty");
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxTitle = document.getElementById("lightbox-title");
  var lightboxMeta = document.getElementById("lightbox-meta");
  var lightboxCounter = document.getElementById("lightbox-counter");
  var closeBtn = document.getElementById("lightbox-close");
  var prevBtn = document.getElementById("lightbox-prev");
  var nextBtn = document.getElementById("lightbox-next");

  var categories = data.categories || [
    { id: "all", label: "全部", emoji: "✦" },
    { id: "travel", label: "旅行", emoji: "✈️" },
    { id: "cosplay", label: "名畫 cosplay", emoji: "🖼️" },
    { id: "daily", label: "日常", emoji: "☁️" }
  ];

  var FALLBACK_IMAGE =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#fff4dd"/><stop offset="1" stop-color="#fde7ee"/>' +
        "</linearGradient></defs>" +
        '<rect width="1200" height="900" fill="url(#g)"/>' +
        '<text x="600" y="470" text-anchor="middle" font-family="PingFang TC, Noto Sans TC, sans-serif" ' +
        'font-size="44" font-weight="700" fill="#7a665a">照片準備中 ♡</text></svg>'
    );

  var activeFilter = "all";
  var currentItems = data.items.slice();
  var activeIndex = -1;
  var lastFocused = null;

  var categoryLabel = {};
  categories.forEach(function (cat) {
    categoryLabel[cat.id] = cat.label;
  });

  /* ---------- 篩選按鈕 ---------- */
  function countFor(id) {
    if (id === "all") return data.items.length;
    return data.items.filter(function (item) {
      return item.category === id;
    }).length;
  }

  function buildFilters() {
    categories.forEach(function (cat, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.filter = cat.id;
      button.setAttribute("aria-pressed", index === 0 ? "true" : "false");

      var emoji = document.createElement("span");
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = cat.emoji || "";

      button.appendChild(emoji);
      button.appendChild(document.createTextNode(" " + cat.label + " "));

      var count = document.createElement("span");
      count.className = "chip__count";
      count.textContent = String(countFor(cat.id));
      button.appendChild(count);

      button.addEventListener("click", function () {
        setFilter(cat.id);
      });

      filterBar.insertBefore(button, countEl);
    });
  }

  function setFilter(id) {
    activeFilter = id;
    Array.prototype.forEach.call(filterBar.querySelectorAll(".chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.dataset.filter === id ? "true" : "false");
    });

    currentItems = data.items.filter(function (item) {
      return id === "all" || item.category === id;
    });

    renderGrid();
    updateCount();
  }

  function updateCount() {
    var label = activeFilter === "all" ? "全部照片" : categoryLabel[activeFilter] || "照片";
    countEl.textContent = label + "・" + currentItems.length + " 張";
    if (emptyEl) {
      if (currentItems.length === 0) emptyEl.removeAttribute("hidden");
      else emptyEl.setAttribute("hidden", "");
    }
  }

  /* ---------- 卡片 ---------- */
  function buildCard(item, index) {
    var card = document.createElement("article");
    card.className = "photo";

    var tape = document.createElement("span");
    tape.className = "photo__tape";
    tape.setAttribute("aria-hidden", "true");
    card.appendChild(tape);

    var media = document.createElement("button");
    media.type = "button";
    media.className = "photo__media";
    media.setAttribute("aria-label", "放大照片：" + item.title);

    var image = document.createElement("img");
    image.alt = item.alt || item.title;
    image.loading = "lazy";
    image.width = 1200;
    image.height = 900;
    if (item.position) image.style.objectPosition = item.position;
    image.src = item.src;
    image.addEventListener("error", function () {
      if (media.classList.contains("is-missing")) return;
      media.classList.add("is-missing");
      image.remove();
      var fallback = document.createElement("span");
      fallback.className = "photo__missing";
      fallback.textContent = "照片準備中 ♡";
      media.appendChild(fallback);
    });

    media.appendChild(image);
    media.addEventListener("click", function () {
      openLightbox(index);
    });
    card.appendChild(media);

    var body = document.createElement("div");
    body.className = "photo__body";

    var title = document.createElement("h3");
    title.className = "photo__title";
    title.textContent = item.title;
    body.appendChild(title);

    var meta = document.createElement("p");
    meta.className = "photo__meta";
    meta.appendChild(document.createTextNode(item.meta || ""));
    if (item.demo && data.showDemoBadges) {
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = "•";
      meta.appendChild(dot);
      var flag = document.createElement("span");
      flag.className = "demo-flag";
      flag.textContent = "示範圖";
      meta.appendChild(flag);
    }
    body.appendChild(meta);
    card.appendChild(body);

    return card;
  }

  function renderGrid() {
    grid.innerHTML = "";
    if (!currentItems.length) return;

    var fragment = document.createDocumentFragment();
    currentItems.forEach(function (item, index) {
      fragment.appendChild(buildCard(item, index));
    });
    grid.appendChild(fragment);
  }

  /* ---------- 燈箱 ---------- */
  function isOpen() {
    return lightbox.classList.contains("is-open");
  }

  function preload(index) {
    var item = currentItems[index];
    if (!item) return;
    var image = new Image();
    image.src = item.src;
  }

  function updateLightbox() {
    var item = currentItems[activeIndex];
    if (!item) return;
    delete lightboxImg.dataset.fallback;
    lightboxImg.src = item.src;
    lightboxImg.alt = item.alt || item.title;
    lightboxTitle.textContent = item.title;
    lightboxMeta.textContent = item.meta || "";
    lightboxCounter.textContent = activeIndex + 1 + " / " + currentItems.length;
    preload(activeIndex + 1);
    preload(activeIndex - 1);
  }

  function openLightbox(index) {
    activeIndex = index;
    lastFocused = document.activeElement;
    updateLightbox();
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    closeBtn.focus();
  }

  function closeLightbox() {
    if (!isOpen()) return;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-locked");
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
  }

  function step(direction) {
    if (!currentItems.length) return;
    activeIndex = (activeIndex + direction + currentItems.length) % currentItems.length;
    updateLightbox();
    lightboxImg.classList.remove("is-pop");
    void lightboxImg.offsetWidth;
    lightboxImg.classList.add("is-pop");
  }

  closeBtn.addEventListener("click", closeLightbox);
  prevBtn.addEventListener("click", function () {
    step(-1);
  });
  nextBtn.addEventListener("click", function () {
    step(1);
  });

  lightbox.addEventListener("click", function (event) {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", function (event) {
    if (!isOpen()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
      return;
    }

    if (event.key === "Tab") {
      var focusable = lightbox.querySelectorAll("button");
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* 觸控滑動切換 */
  var touchStartX = null;
  lightbox.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    touchStartX = event.clientX;
  });

  lightbox.addEventListener("pointerup", function (event) {
    if (touchStartX === null) return;
    var delta = event.clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(delta) < 48) return;
    step(delta < 0 ? 1 : -1);
  });

  lightboxImg.addEventListener("error", function () {
    if (lightboxImg.dataset.fallback === "1") return;
    lightboxImg.dataset.fallback = "1";
    lightboxImg.src = FALLBACK_IMAGE;
    lightboxImg.alt = "這張照片還在準備中";
  });

  /* ---------- 初始化 ---------- */
  if (filterBar) buildFilters();
  renderGrid();
  updateCount();
})();
