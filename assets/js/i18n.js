/* Phoebe 小星球 — 全站語言切換
 * 以繁體中文原文為 key，將頁面上的文字節點與無障礙屬性換成目標語言。
 * 語言檔按需載入：assets/js/i18n/<code>.js
 */
(function () {
  "use strict";

  var LANGS = [
    { code: "zh-Hant", label: "繁體中文" },
    { code: "zh-Hans", label: "简体中文" },
    { code: "en", label: "English" },
    { code: "ja", label: "日本語" },
    { code: "ko", label: "한국어" }
  ];
  var DEFAULT = "zh-Hant";
  var STORAGE_KEY = "phoebe.lang";
  var registry = (window.PHOEBE_I18N = window.PHOEBE_I18N || {});
  var current = DEFAULT;
  var dict = null;
  var compositeRegex = null;
  var titleSource = document.title;

  /* gallery.js 的錯誤／空狀態字串不在主要翻譯清單裡，這裡補齊 */
  var EXTRA = {
    "作品準備中 ♡": {
      "zh-Hans": "作品准备中 ♡",
      "en": "Preparing artwork ♡",
      "ja": "作品を準備中 ♡",
      "ko": "작품 준비 중 ♡"
    },
    "示範圖": {
      "zh-Hans": "示例图",
      "en": "Sample image",
      "ja": "サンプル画像",
      "ko": "예시 이미지"
    },
    "這一區暫時沒有作品，館長正在準備中。": {
      "zh-Hans": "这一区暂时没有作品，馆长正在准备中。",
      "en": "No works here yet — the curator is preparing something.",
      "ja": "このエリアにはまだ作品がありません。館長が準備中です。",
      "ko": "이 구역에는 아직 작품이 없어요. 관장님이 준비 중이에요."
    },
    "這件作品還在準備中": {
      "zh-Hans": "这件作品还在准备中",
      "en": "This work is still being prepared.",
      "ja": "この作品はまだ準備中です。",
      "ko": "이 작품은 아직 준비 중이에요."
    },
    "公尺": {
      "zh-Hans": "米",
      "en": "meters",
      "ja": "メートル",
      "ko": "미터"
    }
  };

  var textState = new Map();
  var wholeState = new Map();
  var attrState = new Map();
  var observer = null;
  var applying = false;

  var base = (function () {
    var me = document.currentScript;
    if (me && me.src) return me.src.replace(/[^/]*$/, "");
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (/i18n\.js(?:[?#]|$)/.test(src)) return src.replace(/[^/]*$/, "");
    }
    return "assets/js/";
  })();

  function normalize(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function exact(value) {
    if (!dict) return null;
    var key = normalize(value);
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
  }

  function pattern(value) {
    var match;
    if (current === "zh-Hant") return null;

    if (current === "zh-Hans") {
      if ((match = value.match(/^(\d+) 件$/))) return match[1] + " 件";
      if ((match = value.match(/^最高 (\d+)$/))) return "最高 " + match[1];
      if ((match = value.match(/^最少 (\d+) 步$/))) return "最少 " + match[1] + " 步";
      if ((match = value.match(/^最高 LV\.(\d+)$/))) return "最高 LV." + match[1];
      if ((match = value.match(/^最快 (\d{2}):(\d{2})$/))) return "最快 " + match[1] + ":" + match[2];
      return null;
    }
    if (current === "en") {
      if ((match = value.match(/^(\d+) 件$/))) return match[1] + " works";
      if ((match = value.match(/^最高 (\d+)$/))) return "Best " + match[1];
      if ((match = value.match(/^最少 (\d+) 步$/))) return "Fewest " + match[1] + " moves";
      if ((match = value.match(/^最高 LV\.(\d+)$/))) return "Best LV." + match[1];
      if ((match = value.match(/^最快 (\d{2}):(\d{2})$/))) return "Fastest " + match[1] + ":" + match[2];
      return null;
    }
    if (current === "ja") {
      if ((match = value.match(/^(\d+) 件$/))) return match[1] + " 点";
      if ((match = value.match(/^最高 (\d+)$/))) return "ベスト " + match[1];
      if ((match = value.match(/^最少 (\d+) 步$/))) return "最少 " + match[1] + " 手";
      if ((match = value.match(/^最高 LV\.(\d+)$/))) return "ベスト LV." + match[1];
      if ((match = value.match(/^最快 (\d{2}):(\d{2})$/))) return "最速 " + match[1] + ":" + match[2];
      return null;
    }
    if (current === "ko") {
      if ((match = value.match(/^(\d+) 件$/))) return match[1] + " 점";
      if ((match = value.match(/^最高 (\d+)$/))) return "최고 " + match[1];
      if ((match = value.match(/^最少 (\d+) 步$/))) return "최소 " + match[1] + " 번";
      if ((match = value.match(/^最高 LV\.(\d+)$/))) return "최고 LV." + match[1];
      if ((match = value.match(/^最快 (\d{2}):(\d{2})$/))) return "최고 기록 " + match[1] + ":" + match[2];
      return null;
    }
    return null;
  }

  function normalizePunctuation(text) {
    if (current === "en" || current === "ko") {
      return text
        .replace(/。/g, ".")
        .replace(/，/g, ",")
        .replace(/！/g, "!")
        .replace(/？/g, "?")
        .replace(/：/g, ":")
        .replace(/；/g, ";")
        .replace(/（/g, "(")
        .replace(/）/g, ")")
        .replace(/\s+([.,!?;:])/g, "$1")
        .replace(/([.!?])(?=[A-Za-z])/g, "$1 ")
        .replace(/([,:;])(?=[A-Za-z])/g, "$1 ");
    }
    if (current === "ja") {
      return text
        .replace(/，/g, "、")
        .replace(/\s+([、。！？])/g, "$1")
        .replace(/([、。！？])\s+/g, "$1");
    }
    return text;
  }

  /* 動態遊戲訊息是字串拼接而成；用 DP 片段配對，
     避免靜態數字 key（例如「0 分」）誤吃「50 分」，
     也讓「分、步、第、塊」這類單位可以正確翻。 */
  var COMPOSITE_SINGLE = "分步件第塊個條張洞命秒局盤關次位隻顆枚本抽發題對組輪手球層頁格頭朵片粒杯碗份歲年月日點時";

  function lookup(key) {
    if (dict && dict[key] != null) return dict[key];
    if (EXTRA[key] && EXTRA[key][current]) return EXTRA[key][current];
    return null;
  }

  function buildComposite() {
    compositeRegex = null;
    if (!dict) return;
    var byFirst = Object.create(null);
    var keys = Object.keys(dict);
    Object.keys(EXTRA).forEach(function (key) {
      if (!(key in dict) && EXTRA[key][current]) keys.push(key);
    });
    keys.forEach(function (key) {
      if (!/[\u4e00-\u9fff]/.test(key)) return;
      if (/\d/.test(key)) return;
      if (key.length === 1 && COMPOSITE_SINGLE.indexOf(key) === -1) return;
      var first = key.charAt(0);
      if (!byFirst[first]) byFirst[first] = [];
      byFirst[first].push(key);
    });
    Object.keys(byFirst).forEach(function (first) {
      byFirst[first].sort(function (a, b) {
        return b.length - a.length;
      });
    });
    compositeRegex = byFirst;
  }

  function composite(value) {
    if (!compositeRegex || !/[\u4e00-\u9fff]/.test(value) || !/\d/.test(value)) return null;
    var n = value.length;
    var memo = new Array(n + 1);
    var choice = new Array(n + 1);

    function best(index) {
      if (index >= n) return 0;
      if (memo[index] != null) return memo[index];
      var score = best(index + 1);
      var selected = null;
      var list = compositeRegex[value.charAt(index)];
      if (list) {
        for (var i = 0; i < list.length; i++) {
          var key = list[i];
          if (value.substr(index, key.length) === key) {
            var candidate = key.length * 1000 - 1 + best(index + key.length);
            if (candidate > score) {
              score = candidate;
              selected = key;
            }
          }
        }
      }
      memo[index] = score;
      choice[index] = selected;
      return score;
    }

    best(0);
    if (!memo[0]) return null;

    var output = "";
    var changed = false;
    var position = 0;
    while (position < n) {
      var matched = choice[position];
      if (matched) {
        output += lookup(matched);
        position += matched.length;
        changed = true;
      } else {
        output += value.charAt(position);
        position += 1;
      }
    }
    return changed ? output : null;
  }

  function translate(value) {
    var key = normalize(value);
    var result = exact(key);
    if (result != null) return result;
    var extra = EXTRA[key];
    if (extra && extra[current]) return extra[current];
    result = pattern(key);
    if (result != null) return result;
    return composite(value);
  }

  function skipped(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    return !!el.closest("script, style, noscript, code, pre, .lang-switch, [data-i18n-skip]");
  }

  function translateTextNode(node) {
    if (skipped(node)) return;

    var value = node.nodeValue;
    var state = textState.get(node);
    if (!state) {
      state = { source: value, last: value };
      textState.set(node, state);
    } else if (value !== state.last) {
      /* 遊戲或畫廊動態更新了文字，以新內容作為原文 */
      state.source = value;
      state.last = value;
    }

    var source = state.source;
    var lead = source.match(/^\s*/)[0];
    var trail = source.match(/\s*$/)[0];
    var core = source.slice(lead.length, source.length - trail.length);
    var translated = translate(core);
    if (translated == null) translated = core;
    translated = normalizePunctuation(translated);
    var next = lead + translated + trail;
    if (next !== value) {
      node.nodeValue = next;
      state.last = next;
    }
  }

  function translateWhole(el) {
    var state = wholeState.get(el);
    var currentText = el.textContent;
    if (!state) {
      state = {
        sourceText: normalize(currentText),
        sourceHTML: el.innerHTML,
        last: currentText
      };
      wholeState.set(el, state);
    } else if (currentText !== state.last) {
      state.sourceText = normalize(currentText);
      state.sourceHTML = el.innerHTML;
      state.last = currentText;
    }
    var translated = translate(state.sourceText);
    if (translated == null) return false;
    translated = normalizePunctuation(translated);
    if (currentText !== translated) {
      el.textContent = translated;
      state.last = translated;
    }
    return true;
  }

  function translateAttributes(el) {
    var names = ["alt", "aria-label", "title", "placeholder"];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!el.hasAttribute(name)) continue;
      var map = attrState.get(el);
      if (!map) {
        map = {};
        attrState.set(el, map);
      }
      var state = map[name];
      var value = el.getAttribute(name);
      if (!state) {
        state = map[name] = { source: value, last: value };
      } else if (value !== state.last) {
        state.source = value;
        state.last = value;
      }
      var translated = translate(state.source);
      if (translated == null) translated = state.source;
      translated = normalizePunctuation(translated);
      if (translated !== value) {
        el.setAttribute(name, translated);
        state.last = translated;
      }
    }
  }

  function walk(node) {
    if (node.nodeType === 3) {
      translateTextNode(node);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.classList && node.classList.contains("lang-switch")) return;
    translateAttributes(node);
    if (node.hasAttribute("data-i18n-whole") && translateWhole(node)) return;
    for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  function restore() {
    wholeState.forEach(function (state, el) {
      if (!el.isConnected) return;
      if (el.textContent === state.last) el.innerHTML = state.sourceHTML;
      else {
        state.sourceText = normalize(el.textContent);
        state.sourceHTML = el.innerHTML;
        state.last = el.textContent;
      }
    });
    textState.forEach(function (state, node) {
      if (!node.parentNode) return;
      if (node.nodeValue === state.last) node.nodeValue = state.source;
      else {
        state.source = node.nodeValue;
        state.last = node.nodeValue;
      }
    });
    attrState.forEach(function (map, el) {
      if (!el.isConnected) return;
      Object.keys(map).forEach(function (name) {
        var state = map[name];
        var value = el.getAttribute(name);
        if (value === state.last) el.setAttribute(name, state.source);
        else {
          state.source = value;
          state.last = value;
        }
      });
    });
  }

  function apply() {
    if (!document.body) return;
    if (observer) observer.disconnect();
    applying = true;
    restore();

    if (current === DEFAULT || !dict) {
      document.title = titleSource;
    } else {
      walk(document.body);
      var translatedTitle = translate(titleSource);
      document.title =
        translatedTitle == null ? titleSource : normalizePunctuation(translatedTitle);
    }

    applying = false;
    if (observer) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function onMutations(mutations) {
    if (applying || !observer) return;
    observer.disconnect();
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === "characterData") {
        translateTextNode(mutation.target);
      } else {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType === 1 || node.nodeType === 3) walk(node);
        }
      }
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function loadDict(code, done) {
    if (code === DEFAULT) {
      dict = null;
      compositeRegex = null;
      done();
      return;
    }
    if (registry[code]) {
      dict = registry[code];
      buildComposite();
      done();
      return;
    }
    var script = document.createElement("script");
    script.src = base + "i18n/" + code + ".js?v=20261018-games";
    script.async = false;
    script.onload = function () {
      dict = registry[code] || null;
      buildComposite();
      done();
    };
    script.onerror = function () {
      dict = null;
      done();
    };
    document.head.appendChild(script);
  }

  function setSelect(code) {
    var select = document.getElementById("lang-select");
    if (select && select.value !== code) select.value = code;
  }

  function setLang(code, persist) {
    var valid = false;
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === code) valid = true;
    }
    if (!valid) code = DEFAULT;
    current = code;
    document.documentElement.lang = code;
    document.documentElement.setAttribute("data-lang", code);
    setSelect(code);
    if (persist !== false) {
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch (error) {
        /* 無痕模式等情況下仍可切換，只是不持久 */
      }
    }
    dict = null;
    loadDict(code, apply);
  }

  function addSwitcher() {
    var header = document.querySelector(".header-inner");
    var host = header || document.querySelector(".card") || document.querySelector("main") || document.body;
    if (!host || host.querySelector(".lang-switch")) return;

    var wrap = document.createElement("div");
    wrap.className = "lang-switch";

    var icon = document.createElement("span");
    icon.className = "lang-switch__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🌐";

    var select = document.createElement("select");
    select.id = "lang-select";
    select.className = "lang-select";
    select.setAttribute("aria-label", "Language");
    for (var i = 0; i < LANGS.length; i++) {
      var option = document.createElement("option");
      option.value = LANGS[i].code;
      option.textContent = LANGS[i].label;
      select.appendChild(option);
    }
    select.addEventListener("change", function () {
      setLang(select.value);
    });

    if (!header) {
      wrap.style.cssText =
        "display:flex;justify-content:center;align-items:center;gap:6px;margin-top:18px;flex-wrap:wrap;";
      select.style.cssText =
        "padding:7px 12px;border:2px solid currentColor;border-radius:999px;background:#fffdf8;color:inherit;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer;";
      icon.style.fontSize = "0.9rem";
    }
    wrap.appendChild(icon);
    wrap.appendChild(select);
    host.appendChild(wrap);
    setSelect(current);
  }

  function init() {
    var saved = DEFAULT;
    try {
      saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
    } catch (error) {
      saved = DEFAULT;
    }
    var valid = false;
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === saved) valid = true;
    }
    current = valid ? saved : DEFAULT;
    document.documentElement.lang = current;
    document.documentElement.setAttribute("data-lang", current);
    addSwitcher();
    observer = new MutationObserver(onMutations);
    setLang(current, false);
  }

  window.PhoebeI18n = {
    t: function (value) {
      var result = translate(value);
      return result == null ? value : result;
    },
    setLang: setLang,
    getLang: function () {
      return current;
    },
    formatScore: function (kind, value) {
      if (current === "en") {
        if (kind === "moves") return "Fewest " + value + " moves";
        if (kind === "level") return "Best LV." + value;
        return "Best " + value;
      }
      if (current === "ja") {
        if (kind === "moves") return "最少 " + value + " 手";
        if (kind === "level") return "ベスト LV." + value;
        return "ベスト " + value;
      }
      if (current === "ko") {
        if (kind === "moves") return "최소 " + value + " 수";
        if (kind === "level") return "최고 LV." + value;
        return "최고 " + value;
      }
      if (kind === "moves") return "最少 " + value + " 步";
      if (kind === "level") return "最高 LV." + value;
      return "最高 " + value;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
