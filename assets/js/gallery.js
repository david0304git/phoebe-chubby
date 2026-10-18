/* =========================================================
   Phoebe 小星球 — 古典畫廊
   兩個展區：跟著菲比賞名畫（cosplay）、跟著菲比去旅行（五國 × 四張）
   由 assets/js/gallery-data.js 的資料產生作品、國家列與燈箱
   ========================================================= */
(function () {
  "use strict";

  var data = window.PHOEBE_GALLERY;
  if (!data || !Array.isArray(data.items)) return;

  var paintingsGrid = document.getElementById("gallery-paintings");
  var travelGrid = document.getElementById("gallery-travel");
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxTitle = document.getElementById("lightbox-title");
  var lightboxMeta = document.getElementById("lightbox-meta");
  var lightboxCounter = document.getElementById("lightbox-counter");
  var closeBtn = document.getElementById("lightbox-close");
  var prevBtn = document.getElementById("lightbox-prev");
  var nextBtn = document.getElementById("lightbox-next");

  if (!paintingsGrid || !travelGrid || !lightbox) return;

  var FALLBACK_IMAGE =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#fff4dd"/><stop offset="1" stop-color="#fde7ee"/>' +
        "</linearGradient></defs>" +
        '<rect width="1200" height="900" fill="url(#g)"/>' +
        '<text x="600" y="470" text-anchor="middle" font-family="PingFang TC, Noto Sans TC, sans-serif" ' +
        'font-size="44" font-weight="700" fill="#7a665a">作品準備中 ♡</text></svg>'
    );

  /* 第一展區：名畫 cosplay */
  var paintings = data.items.filter(function (item) {
    return item.category === "cosplay";
  });

  /* 第二展區：五國旅行，每國四張；沒有照片的國家顯示四個準備中位置 */
  var countries = Array.isArray(data.countries) ? data.countries : [];
  var travelItems = [];
  countries.forEach(function (country) {
    (country.photos || []).forEach(function (photo) {
      photo.category = "travel";
      travelItems.push(photo);
    });
  });

  var currentItems = paintings.concat(travelItems);

  var activeIndex = -1;
  var lastFocused = null;

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* ---------- 作品卡 ---------- */
  function buildCard(item, index) {
    var card = document.createElement("article");
    card.className = "photo";
    card.dataset.category = item.category || "";

    var tape = document.createElement("span");
    tape.className = "photo__tape";
    tape.setAttribute("aria-hidden", "true");
    card.appendChild(tape);

    var media = document.createElement("button");
    media.type = "button";
    media.className = "photo__media" + (item.portrait ? " photo__media--portrait" : "");
    media.setAttribute("aria-label", "放大作品：" + item.title);

    var image = document.createElement("img");
    image.alt = item.alt || item.title;
    image.loading = "lazy";
    image.width = item.portrait ? 600 : 1200;
    image.height = item.portrait ? 800 : 900;
    if (item.position) image.style.objectPosition = item.position;
    image.src = item.thumb || item.src;

    var attempts = 0;
    image.addEventListener("error", function () {
      attempts += 1;

      /* 第一次失敗：等一下再試一次（偶發的連線問題） */
      if (attempts === 1) {
        window.setTimeout(function () {
          var retrySrc = image.currentSrc || image.src;
          image.src = retrySrc + (retrySrc.indexOf("?") >= 0 ? "&" : "?") + "retry=1";
        }, 500);
        return;
      }

      /* 縮圖失敗就換大圖 */
      if (attempts === 2 && item.thumb && item.src !== item.thumb) {
        image.src = item.src;
        return;
      }

      if (media.classList.contains("is-missing")) return;
      media.classList.add("is-missing");
      image.remove();
      var fallback = document.createElement("span");
      fallback.className = "photo__missing";
      fallback.textContent = "作品準備中 ♡";
      media.appendChild(fallback);
    });

    media.appendChild(image);
    media.addEventListener("click", function () {
      openLightbox(index);
    });
    card.appendChild(media);

    var body = document.createElement("div");
    body.className = "photo__body";
    body.dataset.category = item.category || "";

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

  function renderSection(items, grid) {
    grid.innerHTML = "";

    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "這一區暫時沒有作品，館長正在準備中。";
      grid.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      var index = currentItems.indexOf(item);
      fragment.appendChild(buildCard(item, index));
    });
    grid.appendChild(fragment);
  }

  /* ---------- 旅行國家列 ---------- */
  function buildCountryPhoto(photo) {
    var index = currentItems.indexOf(photo);
    var card = document.createElement("button");
    card.type = "button";
    card.className = "country-photo";
    card.setAttribute("aria-label", "放大作品：" + photo.title);

    var frame = document.createElement("span");
    frame.className = "country-photo__frame";

    var image = document.createElement("img");
    image.src = photo.src;
    image.alt = photo.alt || photo.title;
    image.loading = "lazy";
    image.width = 1200;
    image.height = 1200;
    image.addEventListener("error", function () {
      card.classList.add("is-missing");
      image.remove();
      var missing = document.createElement("span");
      missing.className = "country-photo__missing";
      missing.textContent = "照片準備中";
      frame.appendChild(missing);
    });
    frame.appendChild(image);
    card.appendChild(frame);

    var caption = document.createElement("span");
    caption.className = "country-photo__caption";
    var title = document.createElement("strong");
    title.textContent = photo.title;
    var meta = document.createElement("small");
    meta.textContent = photo.meta || "";
    caption.appendChild(title);
    caption.appendChild(meta);
    card.appendChild(caption);

    card.addEventListener("click", function () {
      openLightbox(index);
    });
    return card;
  }

  function buildCountrySlot(country) {
    var slot = document.createElement("div");
    slot.className = "country-slot";
    var icon = document.createElement("span");
    icon.className = "country-slot__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = country.icon || "✦";
    var text = document.createElement("span");
    text.className = "country-slot__text";
    text.textContent = "照片準備中";
    var hint = document.createElement("span");
    hint.className = "country-slot__hint";
    hint.textContent = "4 photos";
    slot.appendChild(icon);
    slot.appendChild(text);
    slot.appendChild(hint);
    return slot;
  }

  function buildCountryRow(country, number) {
    var row = document.createElement("section");
    row.className = "country-row country-row--" + country.code;
    row.dataset.country = country.code;

    var head = document.createElement("header");
    head.className = "country-head";

    var flag = document.createElement("span");
    flag.className = "country-flag";
    flag.setAttribute("aria-hidden", "true");
    flag.textContent = country.flag || country.code.toUpperCase();

    var titleWrap = document.createElement("div");
    titleWrap.className = "country-title";

    var kicker = document.createElement("p");
    kicker.className = "country-kicker";
    kicker.textContent = "COUNTRY " + String(number + 1).padStart(2, "0") + " · " + String(country.en || "").toUpperCase();

    var h3 = document.createElement("h3");
    h3.id = "country-title-" + country.code;
    h3.appendChild(document.createTextNode(country.name || ""));

    var tagline = document.createElement("p");
    tagline.className = "country-tagline";
    tagline.textContent = country.tagline || "";

    titleWrap.appendChild(kicker);
    titleWrap.appendChild(h3);
    titleWrap.appendChild(tagline);

    var photos = country.photos || [];
    var progress = document.createElement("span");
    progress.className = "country-progress";
    progress.textContent = photos.length + " / 4";

    head.appendChild(flag);
    head.appendChild(titleWrap);
    head.appendChild(progress);
    row.appendChild(head);
    row.setAttribute("aria-labelledby", h3.id);

    var grid = document.createElement("div");
    grid.className = "country-photos";
    photos.forEach(function (photo) {
      grid.appendChild(buildCountryPhoto(photo));
    });
    for (var i = photos.length; i < 4; i++) {
      grid.appendChild(buildCountrySlot(country));
    }
    row.appendChild(grid);
    return row;
  }

  function renderCountries() {
    travelGrid.innerHTML = "";
    if (!countries.length) {
      var empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "這一區暫時沒有作品，館長正在準備中。";
      travelGrid.appendChild(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    countries.forEach(function (country, index) {
      fragment.appendChild(buildCountryRow(country, index));
    });
    travelGrid.appendChild(fragment);
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
    lightbox.classList.toggle("lightbox--travel", item.category !== "cosplay");
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
    lightboxImg.alt = "這件作品還在準備中";
  });

  /* ---------- 初始化 ---------- */
  setText("paintings-count", String(paintings.length));
  setText("travel-count", String(travelItems.length));
  setText("paintings-total", paintings.length + " 件");
  setText("travel-total", travelItems.length + " 件");
  setText("museum-total", String(paintings.length + travelItems.length));

  renderSection(paintings, paintingsGrid);
  renderCountries();
})();
