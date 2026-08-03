/*
 * game.js — 货币图鉴 MVP 原型逻辑（vanilla JS，无框架/无构建）
 * 对齐 GDD：§1 配对核心循环（无失败态/连击得分）、§2 自动收藏（首次配对写入 localStorage）、
 *          §3 图鉴查看、§6.3「四层识别码」占位美术契约。
 *
 * 配对判定键 = iso_code（同 ISO 即配对，与美术无关）。
 * 合规：无真实钞币图 / 无国旗 / 无汇率 / 无真伪措辞。
 */
(function () {
  "use strict";

  var CURRENCIES = window.CURRENCIES;
  var REGION_STYLE = window.REGION_STYLE;
  var REGION_LABELS = window.REGION_LABELS;

  var STORAGE_ENTITIES = "currency-codex-entities-v1";   // 双形态解锁实体键 (iso_form)
  var STORAGE_COLLECTED_LEGACY = "currency-codex-collected-v1";
  var STORAGE_BEST = "currency-codex-best-v1";

  var FORM_FACTORS = window.FORM_FACTORS || ["coin", "note"];
  var FORM_LABELS = window.FORM_LABELS || { coin: "硬币", note: "纸币" };

  var appEl = document.querySelector(".app");
  var selectedForm = "coin";   // Hub 分段开关当前选择

  /* ---------- 安全存储（file:// 下 localStorage 可能受限 → 内存兜底） ---------- */
  var mem = {};
  var store = {
    get: function (k, def) {
      try {
        var v = localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return mem[k] !== undefined ? mem[k] : def;
      }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch (e) { mem[k] = v; }
    }
  };

  // 实体键 = (iso_code, form_factor)
  function entityKey(iso, form) { return iso + "_" + form; }

  // 双形态解锁集合（全局持久化）；首次启动从旧单形态存档迁移 coin 实体
  function loadEntities() {
    var arr = store.get(STORAGE_ENTITIES, null);
    if (arr === null) {
      var legacy = store.get(STORAGE_COLLECTED_LEGACY, []);
      if (Array.isArray(legacy) && legacy.length) {
        arr = legacy.map(function (iso) { return entityKey(iso, "coin"); });
        saveEntities(arr);
      } else {
        arr = [];
      }
    }
    return Array.isArray(arr) ? arr.slice() : [];
  }
  function saveEntities(arr) { store.set(STORAGE_ENTITIES, arr); }
  function isEntityCollected(iso, form) {
    return loadEntities().indexOf(entityKey(iso, form)) !== -1;
  }
  function totalEntityCount() { return CURRENCIES.length * FORM_FACTORS.length; }

  function loadBest() { var n = store.get(STORAGE_BEST, 0); return typeof n === "number" ? n : 0; }
  function saveBest(n) { store.set(STORAGE_BEST, n); }

  /* ---------- 运行时状态 ---------- */
  var state = {
    board: [],          // [{ id, iso, currency, form, state:'down'|'up'|'matched', el }]
    flipped: [],        // 已翻未判定卡（≤2）
    lock: false,        // 输入锁
    combo: 0,           // 当前连续成功数（= 本次配对前的 combo_before）
    score: 0,
    matchedPairs: 0,
    form: "coin",       // 本局物理形态
    sessionUnlocked: [] // 本局首次解锁的实体键 (iso_form)
  };

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 区域形状 → CSS 轮廓（仅外形，用于角落小徽标；填充由调用处单独设置）
  function shapeStyle(region) {
    var s = REGION_STYLE[region];
    if (!s) return {};
    if (s.shape === "rounded_rect") return { borderRadius: "5px" };
    if (s.shape === "hexagon")      return { clipPath: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)" };
    if (s.shape === "diamond")      return { clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" };
    return {};
  }

  // 母题几何（极简占位，非真实钞币；呼应母题类别，强化非颜色通道）
  function motifSVG(category) {
    var g = "";
    if (category === "portrait") {
      g = '<circle cx="18" cy="18" r="13" fill="none" stroke="#fff" stroke-width="2.6"/>' +
          '<circle cx="18" cy="18" r="6" fill="#fff"/>';
    } else if (category === "architecture") {
      g = '<path d="M7 29 L7 15 Q18 5 29 15 L29 29 Z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>' +
          '<line x1="7" y1="29" x2="29" y2="29" stroke="#fff" stroke-width="2.6"/>';
    } else if (category === "animal") {
      g = '<path d="M18 6 C26 6 30 14 26 22 C24 28 22 30 18 30 C14 30 12 28 10 22 C6 14 10 6 18 6 Z" fill="#fff"/>';
    } else { // landscape
      g = '<path d="M4 29 L14 12 L20 20 L26 9 L32 29 Z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>';
    }
    return '<svg viewBox="0 0 36 36" aria-hidden="true">' + g + "</svg>";
  }

  // 构建角落区域徽标（层①，与卡形严格区分）：小标 + 区域形状 + 区域色描边
  function buildRegionBadge(currency) {
    var badge = document.createElement("div");
    badge.className = "region-badge";
    badge.style.setProperty("--region-color", REGION_STYLE[currency.region].color);
    var shape = document.createElement("div");
    shape.className = "badge-shape";
    Object.assign(shape.style, shapeStyle(currency.region));
    badge.appendChild(shape);
    return badge;
  }

  // 构建令牌面（物理形态 + 四层识别码载体）：区域色外框带 + 母题色 + ISO + 面额 + 角落徽标
  function buildTokenFace(currency, form) {
    var face = document.createElement("div");
    face.className = "token-face token-face--" + form;
    face.style.setProperty("--region-color", REGION_STYLE[currency.region].color);
    face.style.background = REGION_STYLE[currency.region].color;  // 区域色「外框带」

    // 层① 区域徽标（中性圆衬底 + 洲形状），coin / note 双形态统一（B1）
    face.appendChild(buildRegionBadge(currency));

    // 中部容器：母题色带 + ISO（coin 竖排居中 / note 横排中，B2）
    var center = document.createElement("div");
    center.className = "token-center";

    var iso = document.createElement("div");
    iso.className = "layer-iso";
    iso.textContent = currency.iso;              // 层③（权威身份）

    var chip = document.createElement("div");
    chip.className = "layer-chip";
    chip.style.background = currency.signature;   // 层②（母题色）
    chip.innerHTML = motifSVG(currency.motif);

    center.appendChild(iso);
    center.appendChild(chip);

    // 层④ 面额：coin 与 ISO/母题同组居中；note 独立居右（B2 横排）
    var denom = document.createElement("div");
    denom.className = "layer-denom";
    denom.textContent = currency.denom + " " + currency.denomSymbol;

    if (form === "coin") {
      center.appendChild(denom);
      face.appendChild(center);
    } else {
      face.appendChild(center);
      face.appendChild(denom);
    }
    return face;
  }

  /* ---------- 卡牌 DOM ---------- */
  function buildCardEl(card) {
    var el = document.createElement("button");
    el.className = "card card--" + card.form;
    el.type = "button";
    el.setAttribute("aria-label", FORM_LABELS[card.form] + " 卡牌");

    var inner = document.createElement("div");
    inner.className = "card-inner";

    var back = document.createElement("div");
    back.className = "card-face card-back";
    back.innerHTML = '<span class="back-emblem">?</span>';

    var front = document.createElement("div");
    front.className = "card-face card-front";
    front.appendChild(buildTokenFace(card.currency, card.form));

    inner.appendChild(back);
    inner.appendChild(front);
    el.appendChild(inner);

    el.addEventListener("click", function () { onCardClick(card); });
    card.el = el;
    return el;
  }

  /* ---------- 棋盘构建 ---------- */
  function buildBoardDom(form) {
    state.form = form;
    var boardEl = $("board");
    boardEl.innerHTML = "";
    boardEl.className = "board board--" + form;

    // 同一 form_factor 下：8 币种各 2 张 → 16 张（4×4），匹配键仅 iso_code
    var deck = [];
    CURRENCIES.forEach(function (c) { deck.push(c); deck.push(c); });
    shuffle(deck);

    state.board = deck.map(function (c, i) {
      return { id: "c" + i, iso: c.iso, currency: c, form: form, state: "down", el: null };
    });
    state.board.forEach(function (card) {
      boardEl.appendChild(buildCardEl(card));
    });
  }

  /* ---------- 翻牌 / 判定 ---------- */
  function flipUp(card) { card.state = "up"; card.el.classList.add("flipped"); }
  function flipDown(card) { card.state = "down"; card.el.classList.remove("flipped"); }

  function onCardClick(card) {
    if (state.lock) return;                 // 输入锁：判定期内忽略
    if (card.state !== "down") return;       // 已翻/已配对忽略（防同卡重复点）
    flipUp(card);
    state.flipped.push(card);
    if (state.flipped.length === 2) {
      state.lock = true;
      judge();
    }
  }

  function judge() {
    var a = state.flipped[0], b = state.flipped[1];

    if (a.iso === b.iso) {
      // 配对成功（matched 常驻）
      a.state = "matched"; b.state = "matched";
      a.el.classList.add("matched"); b.el.classList.add("matched");

      // 连击/得分：combo_before = state.combo；成功后才 +1
      var gained = Math.round(100 * (1 + 0.5 * state.combo));
      state.score += gained;
      state.combo += 1;
      state.matchedPairs += 1;

      unlockIfFirst(a.iso, state.form);

      state.flipped = [];
      state.lock = false;
      updateStats();
      checkWin();
    } else {
      // 错配：抖动反馈 → 800ms 后翻回，连击清零（奖励性，非门槛）
      a.el.classList.add("shake");
      b.el.classList.add("shake");
      state.combo = 0;
      updateStats();
      setTimeout(function () {
        flipDown(a); flipDown(b);
        a.el.classList.remove("shake");
        b.el.classList.remove("shake");
        state.flipped = [];
        state.lock = false;
      }, 800);
    }
  }

  // §2 自动收藏（双形态）：首次成功配对某 (iso, form) → 写入 entities（幂等）
  function unlockIfFirst(iso, form) {
    var entities = loadEntities();
    var key = entityKey(iso, form);
    if (entities.indexOf(key) === -1) {
      entities.push(key);
      saveEntities(entities);
      state.sessionUnlocked.push(key);   // 形如 "USD_coin"
    }
  }

  function checkWin() {
    if (state.matchedPairs === CURRENCIES.length) {
      var best = loadBest();
      if (state.score > best) { best = state.score; saveBest(best); }
      showWin(best);
    }
  }

  /* ---------- 胜利态 ---------- */
  function showWin(best) {
    $("win-score").textContent = state.score;
    $("win-best").textContent = best;
    var ul = $("win-unlocks");
    ul.innerHTML = "";
    if (state.sessionUnlocked.length === 0) {
      var li = document.createElement("li");
      li.textContent = "本局无新解锁（已全收集）";
      ul.appendChild(li);
    } else {
      state.sessionUnlocked.forEach(function (key) {
        var parts = key.split("_");
        var iso = parts[0], form = parts[1];
        var c = CURRENCIES.filter(function (x) { return x.iso === iso; })[0];
        var li = document.createElement("li");
        li.textContent = (c ? c.name : iso) + " · " + (FORM_LABELS[form] || form);
        ul.appendChild(li);
      });
    }
    $("win").hidden = false;
  }
  function hideWin() { $("win").hidden = true; }

  /* ---------- 统计显示 ---------- */
  function updateStats() {
    $("score").textContent = state.score;
    $("combo").textContent = state.combo;
  }

  /* ---------- 新一局 ---------- */
  function newGame(form) {
    form = form || state.form || "coin";
    state.flipped = [];
    state.lock = false;
    state.combo = 0;
    state.score = 0;
    state.matchedPairs = 0;
    state.sessionUnlocked = [];
    buildBoardDom(form);
    hideWin();
    updateStats();
  }

  /* ---------- 视图切换 ---------- */
  function showView(name) {
    if (name !== "pair") clearForceLandscape();
    ["hub", "pair", "codex", "detail"].forEach(function (v) {
      $("view-" + v).hidden = (v !== name);
    });
    if (name === "hub") updateHubProgress();
  }

  function updateHubProgress() {
    var n = loadEntities().length;
    $("hub-progress").textContent = "已解锁 " + n + "/" + totalEntityCount();
    $("hub-best").textContent = "最高分 " + loadBest();
  }

  /* ---------- 图鉴渲染（§3，双形态槽） ---------- */
  function renderCodex() {
    var entities = loadEntities();
    $("codex-progress").textContent = entities.length + "/" + totalEntityCount();

    var codexEl = $("codex");
    codexEl.innerHTML = "";

    // 按 region 分 3 书架；每架进度按「双形态完整收集」口径
    ["amer", "euro", "asia_afr"].forEach(function (region) {
      var list = CURRENCIES.filter(function (c) { return c.region === region; });
      if (list.length === 0) return;

      var shelf = document.createElement("div");
      shelf.className = "shelf";

      var head = document.createElement("div");
      head.className = "shelf-head";
      var complete = list.filter(function (c) {
        return FORM_FACTORS.every(function (f) { return isEntityCollected(c.iso, f); });
      }).length;
      head.innerHTML = "<span>" + REGION_LABELS[region] + "</span>" +
                       '<span class="shelf-count">完整 ' + complete + "/" + list.length + "</span>";
      shelf.appendChild(head);

      var grid = document.createElement("div");
      grid.className = "shelf-grid";

      list.forEach(function (c) {
        grid.appendChild(buildCodexEntry(c));
      });

      shelf.appendChild(grid);
      codexEl.appendChild(shelf);
    });
  }

  // 每币种一条目：coin / note 双形态槽，未解锁槽显灰色剪影 + 「?」
  function buildCodexEntry(currency) {
    var anyUnlocked = FORM_FACTORS.some(function (f) { return isEntityCollected(currency.iso, f); });

    var entry = document.createElement("div");
    entry.className = "codex-entry" + (anyUnlocked ? "" : " locked");

    var slots = document.createElement("div");
    slots.className = "codex-slots";
    FORM_FACTORS.forEach(function (form) {
      slots.appendChild(buildCodexSlot(currency, form, isEntityCollected(currency.iso, form)));
    });

    var meta = document.createElement("div");
    meta.className = "codex-meta";
    var name = document.createElement("div");
    name.className = "codex-name";
    name.textContent = anyUnlocked ? currency.name : "未发现";
    meta.appendChild(name);
    if (anyUnlocked) {
      var anchor = document.createElement("div");
      anchor.className = "codex-anchor";
      anchor.textContent = "现实锚：" + currency.anchor;
      meta.appendChild(anchor);
    }

    entry.appendChild(slots);
    entry.appendChild(meta);

    // B3：已解锁条目可点入 S5 纯阅读详情；未解锁不进 S5
    if (anyUnlocked) {
      entry.classList.add("codex-entry--clickable");
      entry.setAttribute("role", "button");
      entry.setAttribute("tabindex", "0");
      entry.setAttribute("aria-label", currency.name + " 详情");
      entry.addEventListener("click", function () { openDetail(currency); });
      entry.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(currency); }
      });
    } else {
      entry.setAttribute("aria-disabled", "true");
    }
    return entry;
  }

  /* ---------- B3：S5 货币详情（纯阅读态） ---------- */
  function openDetail(currency) {
    renderDetail(currency);
    showView("detail");
  }

  function sectionTitle(text) {
    var t = document.createElement("div");
    t.className = "detail-section-title";
    t.textContent = text;
    return t;
  }
  function dlLabel(text) {
    var l = document.createElement("div");
    l.className = "dl-label";
    l.textContent = text;
    return l;
  }

  function renderDetail(currency) {
    var root = $("detail");
    root.innerHTML = "";

    var card = document.createElement("div");
    card.className = "detail-card";

    // 1. 顶部：中文名 + ISO + 面值 + 符号
    var head = document.createElement("div");
    head.className = "detail-head";
    var hName = document.createElement("div");
    hName.className = "detail-name";
    hName.textContent = currency.name;
    var hId = document.createElement("div");
    hId.className = "detail-id";
    hId.textContent = currency.iso + " · " + currency.denom + " " + currency.denomSymbol;
    head.appendChild(hName);
    head.appendChild(hId);
    card.appendChild(head);

    // 2. 四层识别码展示区（与配对卡视觉一致）
    var layers = document.createElement("div");
    layers.className = "detail-section";
    layers.appendChild(sectionTitle("四层识别码"));
    var grid = document.createElement("div");
    grid.className = "detail-layers";

    // 层① 区域徽标（洲）
    var li1 = document.createElement("div");
    li1.className = "dl-item";
    li1.appendChild(buildRegionBadge(currency));
    li1.appendChild(dlLabel("洲 · " + REGION_LABELS[currency.region]));
    grid.appendChild(li1);

    // 层② 母题色块
    var li2 = document.createElement("div");
    li2.className = "dl-item";
    var chip = document.createElement("div");
    chip.className = "layer-chip";
    chip.style.background = currency.signature;
    chip.innerHTML = motifSVG(currency.motif);
    li2.appendChild(chip);
    li2.appendChild(dlLabel("母题色"));
    grid.appendChild(li2);

    // 层③ ISO
    var li3 = document.createElement("div");
    li3.className = "dl-item";
    var iso = document.createElement("div");
    iso.className = "dl-iso";
    iso.textContent = currency.iso;
    li3.appendChild(iso);
    li3.appendChild(dlLabel("ISO"));
    grid.appendChild(li3);

    // 层④ 面值
    var li4 = document.createElement("div");
    li4.className = "dl-item";
    var denom = document.createElement("div");
    denom.className = "dl-denom";
    denom.textContent = currency.denom + " " + currency.denomSymbol;
    li4.appendChild(denom);
    li4.appendChild(dlLabel("面值"));
    grid.appendChild(li4);

    layers.appendChild(grid);
    card.appendChild(layers);

    // 3. 现实锚小字块（data.js 中该币种的 anchor 字段）
    var anchor = document.createElement("div");
    anchor.className = "detail-section";
    anchor.appendChild(sectionTitle("现实锚"));
    var anchorBox = document.createElement("div");
    anchorBox.className = "detail-anchor";
    var anchorText = document.createElement("div");
    anchorText.className = "detail-anchor-text";
    anchorText.textContent = currency.anchor;
    anchorBox.appendChild(anchorText);
    anchor.appendChild(anchorBox);
    card.appendChild(anchor);

    // 4. 双形态槽（coin / note 各自解锁态，复用图鉴槽逻辑）
    var slots = document.createElement("div");
    slots.className = "detail-section";
    slots.appendChild(sectionTitle("双形态槽"));
    var slotWrap = document.createElement("div");
    slotWrap.className = "codex-slots";
    FORM_FACTORS.forEach(function (form) {
      slotWrap.appendChild(buildCodexSlot(currency, form, isEntityCollected(currency.iso, form)));
    });
    slots.appendChild(slotWrap);
    card.appendChild(slots);

    // 5. 文化/历史占位短文（标注分层文案后续接入）
    var culture = document.createElement("div");
    culture.className = "detail-section";
    culture.appendChild(sectionTitle("文化 / 历史"));
    var cText = document.createElement("p");
    cText.className = "detail-culture-text";
    cText.textContent = "（文化内容待填充：本币设计语言与历史背景）";
    var cNote = document.createElement("p");
    cNote.className = "detail-culture-note";
    cNote.textContent = "儿童/成人分层文案后续接入";
    culture.appendChild(cText);
    culture.appendChild(cNote);
    card.appendChild(culture);

    // 返回图鉴按钮（S5 纯阅读，无「加入收藏」按钮）
    var back = document.createElement("button");
    back.className = "btn btn-secondary detail-back";
    back.type = "button";
    back.id = "btn-detail-back-2";
    back.textContent = "返回图鉴";
    back.addEventListener("click", function () { showView("codex"); });
    card.appendChild(back);

    root.appendChild(card);
  }

  function buildCodexSlot(currency, form, unlocked) {
    var slot = document.createElement("div");
    slot.className = "codex-slot";

    var label = document.createElement("div");
    label.className = "slot-label";
    label.textContent = FORM_LABELS[form];

    var wrap = document.createElement("div");
    wrap.className = "codex-token codex-token--" + form;

    if (unlocked) {
      wrap.appendChild(buildTokenFace(currency, form));   // 实显四层
    } else {
      // 未解锁：灰色令牌剪影 + 「?」，隐藏 ISO / 真实内容
      var s = document.createElement("div");
      s.className = "token-face locked-silhouette token-face--" + form;
      var q = document.createElement("div");
      q.className = "layer-q";
      q.textContent = "?";
      s.appendChild(q);
      wrap.appendChild(s);
    }

    slot.appendChild(label);
    slot.appendChild(wrap);
    return slot;
  }

  /* ---------- note-mode 形态 / 横屏预览管理 ---------- */
  function applyFormMode(form) {
    clearForceLandscape();
    appEl.classList.toggle("mode-note", form === "note");
  }
  function clearFormMode() {
    appEl.classList.remove("mode-note");
    clearForceLandscape();
  }
  function clearForceLandscape() {
    appEl.classList.remove("force-landscape");
    var pb = $("btn-landscape-preview");
    if (pb) pb.textContent = "横屏预览";
  }
  // 设备旋转为横屏后，自动退出预览态（预览仅辅助，逻辑不依赖）
  function onViewportChange() {
    if (appEl.classList.contains("force-landscape") &&
        window.innerWidth > window.innerHeight) {
      clearForceLandscape();
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    // 形态选择（Hub 分段开关）
    var segs = document.querySelectorAll("#form-select .seg");
    Array.prototype.forEach.call(segs, function (seg) {
      seg.addEventListener("click", function () {
        selectedForm = seg.getAttribute("data-form");
        Array.prototype.forEach.call(segs, function (s) {
          s.classList.toggle("seg-active", s === seg);
        });
      });
    });

    $("btn-start").addEventListener("click", function () {
      applyFormMode(selectedForm);
      newGame(selectedForm);
      showView("pair");
    });
    $("btn-codex").addEventListener("click", function () { renderCodex(); showView("codex"); });
    $("btn-pair-back").addEventListener("click", function () { clearFormMode(); showView("hub"); });
    $("btn-pair-restart").addEventListener("click", function () { newGame(state.form); });
    $("btn-codex-back").addEventListener("click", function () { showView("hub"); });
    $("btn-detail-back").addEventListener("click", function () { showView("codex"); });
    $("btn-win-again").addEventListener("click", function () { newGame(state.form); });
    $("btn-win-hub").addEventListener("click", function () { clearFormMode(); showView("hub"); });

    // note-mode 强制横屏预览开关（仅预览，不影响逻辑）
    $("btn-landscape-preview").addEventListener("click", function () {
      var on = appEl.classList.toggle("force-landscape");
      $("btn-landscape-preview").textContent = on ? "退出横屏预览" : "横屏预览";
    });
    window.addEventListener("resize", onViewportChange);
  }

  /* ---------- 启动 ---------- */
  function init() {
    bind();
    updateHubProgress();
    showView("hub");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
