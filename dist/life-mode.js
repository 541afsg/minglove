(() => {
  "use strict";

  const KEYS = {
    work: "shiguang.work.v1",
    activities: "shiguang.life-activities.v1",
    todos: "shiguang.life-todos.v1",
    events: "shiguang.important-days.v1",
    pool: "shiguang.activity-pool.v1",
    context: "shiguang.daily-context.v1",
    releases: "shiguang.let-go.v1",
  };
  const POOL_DEFAULTS = {
    安静: ["临帖 / 写字", "听歌", "看小说", "看电影", "咖啡店坐坐", "简单整理"],
    身体活动: ["散步", "快走", "跑步", "健身", "羽毛球", "篮球", "骑车"],
    社交: ["桌游", "找朋友吃饭", "聊天", "同事活动", "临时约人"],
    放松: ["按摩 / 足疗", "洗澡", "慢慢吃顿喜欢的", "躺一会儿"],
    探索: ["去没去过的公园", "城市闲逛", "看展", "Livehouse", "随便出去转转"],
  };
  const GROUPS = Object.keys(POOL_DEFAULTS);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHTML = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const makeId = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "sg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  const todayKey = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const validDateKey = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  };
  const fromDateKey = (key) => {
    if (!validDateKey(key)) return null;
    const p = key.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  const dayDifference = (from, to) => {
    const a = fromDateKey(from);
    const b = fromDateKey(to);
    if (!a || !b) return 0;
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  };
  const shortDate = (key) => {
    const d = fromDateKey(key);
    return d ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(d) : key;
  };
  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : clone(fallback);
    } catch (_) { return clone(fallback); }
  };
  const readList = (key) => {
    const value = readJSON(key, []);
    return Array.isArray(value) ? value : [];
  };
  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      showToast("本机存储空间不足。请先导出完整备份后再继续。");
      return false;
    }
  };
  let workLogs = readList(KEYS.work);
  let activities = readList(KEYS.activities);
  let todos = readList(KEYS.todos);
  let events = readList(KEYS.events);
  let dailyContext = readJSON(KEYS.context, {});
  let letGoRecords = readList(KEYS.releases);
  let activityPool = readJSON(KEYS.pool, POOL_DEFAULTS);
  if (!dailyContext || typeof dailyContext !== "object" || Array.isArray(dailyContext)) dailyContext = {};
  if (!activityPool || typeof activityPool !== "object" || Array.isArray(activityPool)) activityPool = clone(POOL_DEFAULTS);
  GROUPS.forEach((group) => { if (!Array.isArray(activityPool[group])) activityPool[group] = clone(POOL_DEFAULTS[group]); });
  let selectedWorkMood = "";
  let workExpanded = false;
  let editingActivityId = null;
  let editingEventId = null;
  let workSaveTimer = null;
  let toastTimer = null;

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }
  function saveList(key, list) {
    if (!writeJSON(key, list)) return false;
    return true;
  }
  function getWork(date) { return workLogs.find((item) => item.date === date) || null; }
  function getContext(date) {
    return dailyContext[date] || { arrival: "", energy: "medium", wish: "any", unwell: false, intent: "" };
  }
  function setSelectedMood(value) {
    selectedWorkMood = value;
    $$("#work-moods [data-work-mood]").forEach((button) => {
      const active = button.dataset.workMood === value;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function updateWorkPrompt() {
    const prompts = {
      "不错": "今天哪里比较顺？如果没有卡点，记下一件做得不错的事就够了。",
      "一般": "有没有一件让你费心的事？先说清下一步，其他可以留到明天。",
      "稍差": "先不用解决全部问题。现在最烦、最累的地方是什么？",
      "很差": "今天不容易。只要把最卡的一件事和下一步放好，就可以收住了。",
    };
    $("#work-prompt").textContent = prompts[selectedWorkMood] || "今天哪里比较顺？有需要带到明天的事吗？";
  }
  function readWorkForm(closed) {
    const date = $("#work-date").value || todayKey();
    const hasBlocker = $("#work-has-blocker").checked;
    const previous = getWork(date);
    const item = {
      id: previous ? previous.id : makeId(),
      date: date,
      mood: selectedWorkMood,
      good: $("#work-good").value.trim(),
      stress: $("#work-stress").value.trim(),
      hasBlocker: hasBlocker,
      blocker: hasBlocker ? $("#work-blocker").value.trim() : "",
      next: hasBlocker ? $("#work-next").value.trim() : "",
      nextWhen: hasBlocker ? $("#work-next-when").value.trim() : "",
      waiting: hasBlocker ? $("#work-waiting").value : "none",
      tonight: hasBlocker ? $("#work-tonight").value : "no",
      createdAt: previous ? previous.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: closed ? new Date().toISOString() : (previous ? previous.closedAt || "" : ""),
    };
    item.closure = closed ? makeClosure(item) : (previous ? previous.closure || "" : "");
    return item;
  }
  function makeClosure(item) {
    const parts = [];
    if (item.good) parts.push("今天比较顺的是：" + item.good + "。");
    if (item.hasBlocker && item.blocker) parts.push("当前卡点：" + item.blocker + "。");
    if (item.hasBlocker && item.next) parts.push("下一步：" + item.next + (item.nextWhen ? "，" + item.nextWhen + "再处理。" : "。"));
    if (!item.hasBlocker) parts.push("今天没有需要带走的卡点。");
    parts.push(item.tonight === "yes" ? "今晚还需要继续处理。" : "今晚无需继续考虑。");
    return parts.join("\n");
  }
  function persistWork(closed, quiet) {
    const date = $("#work-date").value || todayKey();
    if (!validDateKey(date)) { showToast("请选择有效日期。"); return null; }
    const item = readWorkForm(closed);
    const hasContent = item.mood || item.good || item.stress || item.hasBlocker;
    if (!hasContent) {
      if (!quiet) showToast("先选个状态，或写下一件今天发生的事。");
      return null;
    }
    const next = workLogs.filter((entry) => entry.date !== item.date);
    next.unshift(item);
    if (!saveList(KEYS.work, next)) return null;
    workLogs = next;
    if (!quiet) showToast(closed ? "今天的工作已收好。" : "工作记录已保存。");
    return item;
  }
  function populateWorkForm(item) {
    $("#work-date").value = item ? item.date : todayKey();
    setSelectedMood(item ? item.mood : "");
    $("#work-good").value = item ? item.good || "" : "";
    $("#work-stress").value = item ? item.stress || "" : "";
    $("#work-has-blocker").checked = Boolean(item && item.hasBlocker);
    $("#work-blocker").value = item ? item.blocker || "" : "";
    $("#work-next").value = item ? item.next || "" : "";
    $("#work-next-when").value = item ? item.nextWhen || "" : "";
    $("#work-waiting").value = item ? item.waiting || "none" : "self";
    $("#work-tonight").value = item ? item.tonight || "no" : "no";
    $("#work-blocker-fields").hidden = !$("#work-has-blocker").checked;
    updateWorkPrompt();
  }
  function renderWork() {
    const date = todayKey();
    const item = getWork(date);
    $("#work-date-label").textContent = shortDate(date) + " · 先记住重点，不必把所有事都解决。";
    const closed = Boolean(item && item.closedAt);
    $("#work-closed-card").hidden = !closed || workExpanded;
    $("#work-form").hidden = closed && !workExpanded;
    $("#work-closure-copy").textContent = item && item.closure ? item.closure : "";
    if (workExpanded || !closed) populateWorkForm(item);
  }

  function saveAndCloseWork() {
    if (!selectedWorkMood) { showToast("先选一个今天的工作状态。"); return; }
    if ($("#work-has-blocker").checked && !$("#work-next").value.trim()) {
      $("#work-next").focus();
      showToast("给卡点留一个最小的下一步，方便明天接上。");
      return;
    }
    const item = persistWork(true, false);
    if (!item) return;
    workExpanded = false;
    renderWork();
    const lifeButton = $('[data-nav="today"]');
    if (lifeButton) lifeButton.click();
  }
  function queueWorkSave() {
    clearTimeout(workSaveTimer);
    workSaveTimer = setTimeout(() => {
      const hasContent = selectedWorkMood || $("#work-good").value.trim() || $("#work-stress").value.trim() || $("#work-has-blocker").checked;
      if (hasContent && validDateKey($("#work-date").value)) persistWork(false, true);
    }, 450);
  }
  function defaultScreen() {
    const day = new Date().getDay();
    if (day === 0 || day === 6) return "today";
    const log = getWork(todayKey());
    return log && log.closedAt ? "today" : "work";
  }
  function saveDailyContextFromForm() {
    const date = todayKey();
    const existing = getContext(date);
    dailyContext[date] = {
      arrival: $("#life-arrival").value || "",
      energy: $("#life-energy").value || "medium",
      wish: $("#life-wish").value || "any",
      unwell: $("#life-unwell").checked,
      intent: existing.intent || "",
    };
    writeJSON(KEYS.context, dailyContext);
    renderRecommendations();
  }
  function matchingPool(wish) {
    let groups;
    if (wish === "quiet") groups = ["安静", "放松"];
    else if (wish === "social") groups = ["社交"];
    else if (wish === "active") groups = ["身体活动", "探索"];
    else groups = ["安静", "放松", "身体活动", "探索", "社交"];
    const list = [];
    groups.forEach((group) => (Array.isArray(activityPool[group]) ? activityPool[group] : []).forEach((name) => list.push({ name: name, group: group })));
    return list;
  }
  function recommendationList(context, intent) {
    if (context.unwell) return [
      { name: "慢慢洗个澡", group: "放松" },
      { name: "听一首歌", group: "安静" },
      { name: "早点休息", group: "放松" },
    ];
    const late = context.arrival && context.arrival >= "22:00";
    let wish = context.wish;
    if (intent === "想出去走走" || intent === "想运动") wish = "active";
    if (intent === "想社交") wish = "social";
    if (intent === "安静休息") wish = "quiet";
    let candidates = matchingPool(wish);
    if (wish === "active" && context.energy === "low") {
      candidates = candidates.filter((x) => ["散步", "快走", "去没去过的公园", "城市闲逛", "随便出去转转"].includes(x.name));
      if (!candidates.length) candidates = [{ name: "轻轻走一会儿", group: "身体活动" }];
    }
    if (late && context.energy === "low") candidates = candidates.filter((x) => ["听歌", "看小说", "洗澡", "简单整理", "躺一会儿", "咖啡店坐坐"].includes(x.name));
    if (context.energy === "high" && wish !== "quiet" && !late) candidates = candidates.filter((x) => x.group !== "放松" || wish === "any");
    if (!candidates.length) candidates = matchingPool("quiet");
    const start = new Date().getDate() % Math.max(1, candidates.length);
    const rotated = candidates.slice(start).concat(candidates.slice(0, start));
    return rotated.slice(0, 3);
  }
  function renderRecommendations() {
    const context = getContext(todayKey());
    const weekend = [0, 6].includes(new Date().getDay());
    const intentBox = $("#weekend-intent");
    intentBox.hidden = !weekend;
    const intent = context.intent || "";
    $$("#weekend-intent [data-intent]").forEach((button) => button.classList.toggle("is-selected", button.dataset.intent === intent));
    const slot = $("#life-recommendations");
    if (weekend && intent === "已经有安排") {
      slot.innerHTML = '<p class="recommendation-note">那就按自己的安排过。想记下来时，随手收一条就好。</p>';
      return;
    }
    if (weekend && !intent) {
      slot.innerHTML = '<p class="recommendation-note">选一个今天的心情方向；已经有安排，也可以先不做计划。</p>';
      return;
    }
    const items = recommendationList(context, intent);
    slot.innerHTML = '<div class="recommendation-heading"><span>几个轻松选项</span><small>按精力和偏好整理，你可以挑一个</small></div><div class="recommendation-chips">' +
      items.map((item) => '<button type="button" class="recommendation-chip" data-suggest="' + escapeHTML(item.name) + '"><span>' + escapeHTML(item.name) + '</span><small>' + escapeHTML(item.group) + '</small></button>').join("") +
      "</div>";
  }
  function renderLifeBanner() {
    const closed = getWork(todayKey());
    const weekend = [0, 6].includes(new Date().getDay());
    if (closed && closed.closedAt) {
      $("#life-banner-title").textContent = "今天工作已经收尾，接下来是你的生活时间。";
      $("#life-banner-copy").textContent = "下一步已经放好，今晚先把注意力留给自己。";
    } else if (weekend) {
      $("#life-banner-title").textContent = "今天想怎么过？";
      $("#life-banner-copy").textContent = "留一点自由，不需要把休息也排满。";
    } else {
      $("#life-banner-title").textContent = "给下班后的自己留一点空间。";
      $("#life-banner-copy").textContent = "只提供几个选择，今晚想做什么由你决定。";
    }
  }
  function renderLifeContext() {
    const context = getContext(todayKey());
    $("#life-arrival").value = context.arrival || "";
    $("#life-energy").value = context.energy || "medium";
    $("#life-wish").value = context.wish || "any";
    $("#life-unwell").checked = Boolean(context.unwell);
    renderLifeBanner();
    renderRecommendations();
  }
  function groupForActivity(name) {
    for (const group of GROUPS) if ((activityPool[group] || []).includes(name)) return group;
    const value = name.toLocaleLowerCase("zh-CN");
    if (/跑|步|健身|球|骑|游泳|运动/.test(value)) return "身体活动";
    if (/朋友|同事|聊天|桌游|聚餐/.test(value)) return "社交";
    if (/电影|小说|写字|听歌|临帖|咖啡/.test(value)) return "安静";
    return "探索";
  }
  function openActivity(item, suggestedName) {
    editingActivityId = item ? item.id : null;
    $("#activity-dialog-title").textContent = item ? "修改这项生活记录" : "记录一项生活";
    $("#activity-date").value = item ? item.date : todayKey();
    $("#activity-name").value = item ? item.name : suggestedName || "";
    $("#activity-time").value = item ? item.time || "" : "";
    $("#activity-who").value = item ? item.who || "一个人" : "一个人";
    $("#activity-feeling").value = item ? item.feeling || "普通" : "普通";
    $("#activity-is-sport").checked = Boolean(item && item.isSport);
    $("#sport-metrics").hidden = !$("#activity-is-sport").checked;
    $("#activity-duration").value = item && item.duration ? item.duration : "";
    $("#activity-distance").value = item && item.distance != null ? item.distance : "";
    $("#activity-note").value = item ? item.note || "" : "";
    $("#activity-dialog").showModal();
  }
  function closeDialog(id) {
    const dialog = $(id);
    if (dialog && dialog.open) dialog.close();
  }
  function renderActivities() {
    const today = todayKey();
    const todayActivities = activities.filter((item) => item.date === today).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    $("#activity-count").textContent = String(todayActivities.length);
    if (!todayActivities.length) {
      $("#life-activity-list").innerHTML = '<div class="activity-empty">今天还没有生活活动记录。去散步、看电影，或者和朋友聊天，都可以回来写一句。</div>';
      return;
    }
    $("#life-activity-list").innerHTML = todayActivities.map((item) => {
      const metrics = item.isSport ? '<span class="activity-meta">' + (item.duration ? escapeHTML(item.duration) + " 分钟" : "") + (item.duration && item.distance ? " · " : "") + (item.distance ? escapeHTML(item.distance) + " 公里" : "") + "</span>" : "";
      return '<article class="activity-card"><div class="activity-symbol" aria-hidden="true">' + (item.isSport ? "↗" : "✿") + '</div><div class="activity-body"><div class="activity-title-row"><h3>' + escapeHTML(item.name) + '</h3><span class="activity-group">' + escapeHTML(item.group || "生活") + '</span></div><p>' + escapeHTML(item.note || item.feeling || "留下一点今天的生活。") + '</p><div class="activity-meta-row"><span>' + escapeHTML(item.time || "时间随意") + '</span><span>' + escapeHTML(item.who || "不记录同行者") + '</span><span>' + escapeHTML(item.feeling || "") + '</span>' + metrics + '</div></div><div class="activity-tools"><button type="button" data-activity-action="edit" data-id="' + escapeHTML(item.id) + '" aria-label="修改活动">✎</button><button type="button" data-activity-action="delete" data-id="' + escapeHTML(item.id) + '" aria-label="删除活动">×</button></div></article>';
    }).join("");
  }
  function saveActivity(event) {
    event.preventDefault();
    const name = $("#activity-name").value.trim();
    const date = $("#activity-date").value;
    if (!name || !validDateKey(date)) { showToast("请写下活动名称并选择日期。"); return; }
    const existing = editingActivityId ? activities.find((item) => item.id === editingActivityId) : null;
    const isSport = $("#activity-is-sport").checked;
    const duration = Number($("#activity-duration").value) || 0;
    const distance = Number($("#activity-distance").value) || 0;
    const nextItem = {
      id: existing ? existing.id : makeId(),
      date: date,
      name: name.slice(0, 60),
      group: groupForActivity(name),
      time: $("#activity-time").value || "",
      who: $("#activity-who").value || "不记录",
      feeling: $("#activity-feeling").value || "普通",
      isSport: isSport,
      duration: isSport && duration > 0 ? duration : 0,
      distance: isSport && distance > 0 ? Math.round(distance * 10) / 10 : 0,
      note: $("#activity-note").value.trim().slice(0, 700),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = existing ? activities.map((item) => item.id === existing.id ? nextItem : item) : [nextItem].concat(activities);
    if (!saveList(KEYS.activities, next)) return;
    activities = next;
    closeDialog("#activity-dialog");
    renderActivities();
    renderWeekly();
    showToast(existing ? "这项生活记录已更新。" : "这段生活已经收下。");
  }
  function renderEvents() {
    const now = todayKey();
    if (!events.length) {
      $("#event-list").innerHTML = '<div class="event-empty">还没有重要日期。可以记下未来的一天，也可以写“加入公司”这样的起点。</div>';
      return;
    }
    const ordered = events.slice().sort((a, b) => a.date.localeCompare(b.date));
    $("#event-list").innerHTML = ordered.map((item) => {
      const gap = dayDifference(now, item.date);
      let phrase;
      if (item.kind === "future") phrase = gap > 0 ? "还有 " + gap + " 天" : gap === 0 ? "就是今天" : "原定日已过 " + Math.abs(gap) + " 天";
      else phrase = gap > 0 ? "日期在未来 " + gap + " 天" : gap === 0 ? "就是今天" : "已经过去 " + Math.abs(gap) + " 天";
      const count = gap === 0 ? "今" : String(Math.abs(gap));
      return '<article class="event-card"><div class="event-count"><strong>' + count + '</strong><span>天</span></div><div class="event-copy"><h3>' + escapeHTML(item.name) + '</h3><p>' + escapeHTML(shortDate(item.date)) + ' · ' + escapeHTML(phrase) + '</p></div><div class="event-tools"><button type="button" data-event-action="edit" data-id="' + escapeHTML(item.id) + '" aria-label="修改日期">✎</button><button type="button" data-event-action="delete" data-id="' + escapeHTML(item.id) + '" aria-label="删除日期">×</button></div></article>';
    }).join("");
  }
  function renderTodos() {
    if (!todos.length) {
      $("#todo-list").innerHTML = '<p class="todo-empty">待办只写下一步。今天不用做完所有事。</p>';
      return;
    }
    $("#todo-list").innerHTML = todos.slice().sort((a, b) => Number(a.done) - Number(b.done)).map((item) =>
      '<article class="todo-card ' + (item.done ? "is-done" : "") + '"><label><input type="checkbox" data-todo-done="' + escapeHTML(item.id) + '"' + (item.done ? " checked" : "") + ' /><span class="todo-copy"><strong>' + escapeHTML(item.title) + '</strong><small>下一步：' + escapeHTML(item.next) + '</small></span></label><button type="button" data-todo-delete="' + escapeHTML(item.id) + '" aria-label="删除待办">×</button></article>'
    ).join("");
  }
  function normalizePool() {
    const normalized = {};
    GROUPS.forEach((group) => {
      const value = Array.isArray(activityPool[group]) ? activityPool[group] : POOL_DEFAULTS[group];
      normalized[group] = [...new Set(value.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 60))];
    });
    activityPool = normalized;
  }
  function renderPool() {
    normalizePool();
    $("#pool-list").innerHTML = GROUPS.map((group) => {
      const chips = activityPool[group].map((name) => '<span class="pool-chip">' + escapeHTML(name) + '<button type="button" data-pool-remove="' + escapeHTML(group) + '|' + escapeHTML(name) + '" aria-label="移除' + escapeHTML(name) + '">×</button></span>').join("");
      return '<section class="pool-group"><h3>' + escapeHTML(group) + '</h3><div class="pool-chips">' + (chips || '<span class="pool-empty">暂时没有活动</span>') + '</div></section>';
    }).join("");
    const names = GROUPS.flatMap((group) => activityPool[group]);
    $("#activity-options").innerHTML = names.map((name) => '<option value="' + escapeHTML(name) + '"></option>').join("");
  }
  function renderWeekly() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const startKey = start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
    const endKey = todayKey();
    const within = (item) => item.date >= startKey && item.date <= endKey;
    const weekActivities = activities.filter(within);
    const weekWork = workLogs.filter(within);
    const highlights = weekActivities.filter((item) => ["开心", "放松", "很充实", "有活力", "自由自在"].includes(item.feeling)).slice(0, 3);
    let oldNotes = [];
    try {
      const stored = JSON.parse(localStorage.getItem("shiguang.entries.v1") || "[]");
      if (Array.isArray(stored)) oldNotes = stored.filter((item) => within(item) && ["happy", "calm", "full"].includes(item.mood));
    } catch (_) {}
    oldNotes.slice(0, Math.max(0, 3 - highlights.length)).forEach((item) => highlights.push({ name: item.title || String(item.content || "").slice(0, 45) }));
    const friction = weekWork.map((item) => item.stress).filter(Boolean).slice(0, 2);
    const blockers = weekWork.map((item) => item.blocker).filter(Boolean).slice(0, 2);
    const sports = weekActivities.some((item) => item.isSport);
    const social = weekActivities.some((item) => item.group === "社交" || ["朋友", "家人", "同事"].includes(item.who));
    const quiet = weekActivities.some((item) => ["安静", "放松"].includes(item.group));
    const free = Object.keys(dailyContext).some((key) => key >= startKey && key <= endKey && /随意|自由|不知道/.test((dailyContext[key] || {}).intent || ""));
    $("#weekly-title").textContent = shortDate(startKey) + " — 今天";
    if (!weekActivities.length && !weekWork.length && !highlights.length) {
      $("#weekly-content").innerHTML = '<p class="weekly-empty">这一周还没有工作或生活记录。想记的时候再来，不需要补齐。</p>';
      return;
    }
    const happyText = highlights.length ? highlights.map((x) => escapeHTML(x.name || "一个开心的片刻")).join("、") : "暂时没有特别开心或放松的记录。";
    const frictionText = friction.length ? friction.map(escapeHTML).join("；") : "暂时没有记下明显消耗你的事。";
    const blockerText = blockers.length ? blockers.map(escapeHTML).join("；") : "没有记录到需要反复处理的卡点。";
    const lifeSignals = [sports ? "有运动记录" : "运动还没有记下来", social ? "有与人互动" : "社交还没有记下来", quiet ? "有安静时间" : "安静时间还没有记下来", free ? "有留白" : "留白还没有标记"].join(" · ");
    const experiment = sports ? "下周小实验：留一段时间给本周最想再做的活动。" : "下周小实验：找一个身体舒服的时段，轻轻动一动；不设时长目标。";
    let pattern = "";
    const recent = activities.filter((item) => dayDifference(item.date, endKey) >= 0 && dayDifference(item.date, endKey) <= 30);
    const groupCounts = {};
    recent.forEach((item) => { groupCounts[item.group || "生活"] = (groupCounts[item.group || "生活"] || 0) + 1; });
    const topGroup = Object.keys(groupCounts).sort((a, b) => groupCounts[b] - groupCounts[a])[0];
    if (recent.length >= 3 && topGroup) pattern = '<p class="weekly-pattern"><span>最近的生活线索</span>近一个月记下较多的是“' + escapeHTML(topGroup) + '”活动，共 ' + groupCounts[topGroup] + ' 次。这只是记录里出现的倾向，不代表必须增加或减少。</p>';
    $("#weekly-content").innerHTML =
      '<div class="weekly-grid"><section><h3>让我开心 / 放松</h3><p>' + happyText + '</p></section><section><h3>比较消耗的事</h3><p>' + frictionText + '</p></section><section><h3>工作里出现的卡点</h3><p>' + blockerText + '</p></section><section><h3>生活里出现过</h3><p>' + lifeSignals + '</p></section></div>' +
      pattern + '<div class="weekly-experiment"><span>下周只试一件事</span><p>' + experiment + '</p></div>';
  }
  function renderMy() {
    renderEvents();
    renderTodos();
    renderPool();
  }
  function renderCurrent(screen) {
    const lifeActive = screen === "today";
    $("#nav-add").hidden = !lifeActive;
    $("#floating-add").hidden = !lifeActive;
    if (screen === "work") renderWork();
    if (screen === "today") {
      renderLifeContext();
      renderActivities();
    }
    if (screen === "history") renderWeekly();
    if (screen === "my") renderMy();
  }
  function normalizeWork(item) {
    if (!item || !validDateKey(item.date)) return null;
    return {
      id: typeof item.id === "string" ? item.id : makeId(),
      date: item.date,
      mood: ["不错", "一般", "稍差", "很差"].includes(item.mood) ? item.mood : "",
      good: String(item.good || "").slice(0, 1200),
      stress: String(item.stress || "").slice(0, 1200),
      hasBlocker: Boolean(item.hasBlocker),
      blocker: String(item.blocker || "").slice(0, 1600),
      next: String(item.next || "").slice(0, 220),
      nextWhen: String(item.nextWhen || "").slice(0, 120),
      waiting: ["self", "reply", "leader", "tomorrow", "none"].includes(item.waiting) ? item.waiting : "none",
      tonight: item.tonight === "yes" ? "yes" : "no",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      closedAt: typeof item.closedAt === "string" ? item.closedAt : "",
      closure: String(item.closure || "").slice(0, 4000),
    };
  }
  function normalizeActivity(item) {
    if (!item || !validDateKey(item.date) || typeof item.name !== "string" || !item.name.trim()) return null;
    return {
      id: typeof item.id === "string" ? item.id : makeId(),
      date: item.date,
      name: item.name.trim().slice(0, 60),
      group: GROUPS.includes(item.group) ? item.group : "探索",
      time: /^\d{2}:\d{2}$/.test(item.time || "") ? item.time : "",
      who: String(item.who || "不记录").slice(0, 30),
      feeling: String(item.feeling || "普通").slice(0, 30),
      isSport: Boolean(item.isSport),
      duration: Math.max(0, Math.min(1440, Number(item.duration) || 0)),
      distance: Math.max(0, Math.min(1000, Number(item.distance) || 0)),
      note: String(item.note || "").slice(0, 700),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
    };
  }
  function normalizeTodo(item) {
    if (!item || typeof item.title !== "string" || !item.title.trim() || typeof item.next !== "string" || !item.next.trim()) return null;
    return { id: typeof item.id === "string" ? item.id : makeId(), title: item.title.trim().slice(0, 120), next: item.next.trim().slice(0, 180), done: Boolean(item.done), createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString() };
  }
  function normalizeEvent(item) {
    if (!item || typeof item.name !== "string" || !item.name.trim() || !validDateKey(item.date)) return null;
    return { id: typeof item.id === "string" ? item.id : makeId(), name: item.name.trim().slice(0, 80), date: item.date, kind: item.kind === "future" ? "future" : "past" };
  }
  function mergeById(current, incoming, normalizer) {
    const result = current.slice();
    const ids = new Set(result.map((item) => item.id));
    incoming.slice(0, 3000).map(normalizer).filter(Boolean).forEach((item) => { if (!ids.has(item.id)) { result.push(item); ids.add(item.id); } });
    return result;
  }
  function mergeWorkByDate(current, incoming) {
    const result = current.slice();
    const dates = new Set(result.map((item) => item.date));
    incoming.slice(0, 3000).map(normalizeWork).filter(Boolean).forEach((item) => { if (!dates.has(item.date)) { result.push(item); dates.add(item.date); } });
    return result;
  }
  function backupData() {
    return {
      workLogs: workLogs,
      lifeActivities: activities,
      lifeTodos: todos,
      importantDays: events,
      activityPool: activityPool,
      dailyContext: dailyContext,
      letGoRecords: letGoRecords,
    };
  }
  function importBackup(raw) {
    try {
      if (!raw || typeof raw !== "object") return;
      workLogs = mergeWorkByDate(workLogs, Array.isArray(raw.workLogs) ? raw.workLogs : []);
      activities = mergeById(activities, Array.isArray(raw.lifeActivities) ? raw.lifeActivities : [], normalizeActivity);
      todos = mergeById(todos, Array.isArray(raw.lifeTodos) ? raw.lifeTodos : [], normalizeTodo);
      events = mergeById(events, Array.isArray(raw.importantDays) ? raw.importantDays : [], normalizeEvent);
      letGoRecords = mergeById(letGoRecords, Array.isArray(raw.letGoRecords) ? raw.letGoRecords : [], (x) => {
        if (!x || !validDateKey(x.date) || typeof x.blocker !== "string") return null;
        return { id: typeof x.id === "string" ? x.id : makeId(), date: x.date, blocker: x.blocker.slice(0, 1000), next: String(x.next || "").slice(0, 180), when: String(x.when || "").slice(0, 100), canAct: Boolean(x.canAct), copy: String(x.copy || "").slice(0, 2000), createdAt: String(x.createdAt || new Date().toISOString()) };
      });
      if (raw.dailyContext && typeof raw.dailyContext === "object" && !Array.isArray(raw.dailyContext)) {
        Object.entries(raw.dailyContext).slice(0, 4000).forEach(([date, value]) => {
          if (!validDateKey(date) || !value || typeof value !== "object") return;
          if (!dailyContext[date]) dailyContext[date] = { arrival: String(value.arrival || "").slice(0, 5), energy: ["low", "medium", "high"].includes(value.energy) ? value.energy : "medium", wish: ["any", "quiet", "active", "social"].includes(value.wish) ? value.wish : "any", unwell: Boolean(value.unwell), intent: String(value.intent || "").slice(0, 60) };
        });
      }
      if (raw.activityPool && typeof raw.activityPool === "object") {
        GROUPS.forEach((group) => {
          if (Array.isArray(raw.activityPool[group])) activityPool[group] = [...new Set((activityPool[group] || []).concat(raw.activityPool[group].filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 50)).filter(Boolean)))].slice(0, 60);
        });
      }
      writeJSON(KEYS.work, workLogs);
      writeJSON(KEYS.activities, activities);
      writeJSON(KEYS.todos, todos);
      writeJSON(KEYS.events, events);
      writeJSON(KEYS.releases, letGoRecords);
      writeJSON(KEYS.context, dailyContext);
      writeJSON(KEYS.pool, activityPool);
      renderMy();
      renderWeekly();
    } catch (_) { showToast("部分新记录没有导入，请检查备份文件。"); }
  }
  function renderAllExtended() {
    renderWork();
    renderLifeContext();
    renderActivities();
    renderWeekly();
    renderMy();
  }

  const calendar = $("#screen-calendar");
  const calendarSlot = $("#review-calendar-slot");
  const lifeScreen = $("#screen-today");
  const lifeGrid = $(".today-grid", lifeScreen);
  const lifeContextCard = $(".life-context-card", lifeScreen);
  if (lifeGrid && lifeContextCard) lifeScreen.insertBefore(lifeGrid, lifeContextCard);
  if (calendar && calendarSlot) {
    calendar.classList.remove("screen", "is-active");
    calendar.removeAttribute("data-screen");
    calendar.hidden = false;
    calendarSlot.append(calendar);
  }

  $("#work-moods").addEventListener("click", (event) => {
    const button = event.target.closest("[data-work-mood]");
    if (!button) return;
    setSelectedMood(button.dataset.workMood);
    updateWorkPrompt();
    queueWorkSave();
  });
  $("#work-has-blocker").addEventListener("change", () => {
    $("#work-blocker-fields").hidden = !$("#work-has-blocker").checked;
    queueWorkSave();
  });
  $("#work-form").addEventListener("input", queueWorkSave);
  $("#work-form").addEventListener("change", queueWorkSave);
  $("#work-date").addEventListener("change", () => populateWorkForm(getWork($("#work-date").value)));
  $("#work-save").addEventListener("click", () => persistWork(false, false));
  $("#finish-work").addEventListener("click", saveAndCloseWork);
  $("#work-edit-after-close").addEventListener("click", () => { workExpanded = true; renderWork(); });
  $("#open-let-go").addEventListener("click", () => {
    $("#let-go-form").reset();
    $("#let-go-form").dataset.saved = "false";
    $("#let-go-result").hidden = true;
    $("#let-go-form").querySelector('[type="submit"]').disabled = false;
    $("#let-go-form").querySelector('[type="submit"]').textContent = "整理好，先放下";
    $("#let-go-dialog").showModal();
  });
  $$("[data-close-let-go]").forEach((button) => button.addEventListener("click", () => closeDialog("#let-go-dialog")));
  $("#let-go-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($(event.currentTarget).dataset.saved === "true") return;
    const blocker = $("#let-go-blocker").value.trim();
    const next = $("#let-go-next").value.trim();
    const when = $("#let-go-when").value.trim();
    if (!blocker || !next || !when) return;
    const canAct = $("#let-go-can-act").checked;
    const copy = canAct
      ? "现在还有一个能做的小动作：" + next + "。做完这一小步后，再等到" + when + "处理。"
      : "当前能做的动作已经完成。\n\n下一次处理时间：" + when + "。\n\n现在无需继续考虑。";
    letGoRecords.unshift({ id: makeId(), date: todayKey(), blocker: blocker, next: next, when: when, canAct: canAct, copy: copy, createdAt: new Date().toISOString() });
    if (!saveList(KEYS.releases, letGoRecords)) { letGoRecords.shift(); return; }
    $(event.currentTarget).dataset.saved = "true";
    const submit = $(event.currentTarget).querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = "已收好";
    $("#let-go-result").textContent = copy;
    $("#let-go-result").hidden = false;
    showToast("先把下一步放好了。");
  });
  $("#life-arrival").addEventListener("change", saveDailyContextFromForm);
  $("#life-energy").addEventListener("change", saveDailyContextFromForm);
  $("#life-wish").addEventListener("change", saveDailyContextFromForm);
  $("#life-unwell").addEventListener("change", saveDailyContextFromForm);
  $("#weekend-intent").addEventListener("click", (event) => {
    const button = event.target.closest("[data-intent]");
    if (!button) return;
    const date = todayKey();
    dailyContext[date] = Object.assign({}, getContext(date), { intent: button.dataset.intent });
    writeJSON(KEYS.context, dailyContext);
    renderRecommendations();
  });
  $("#life-recommendations").addEventListener("click", (event) => {
    const button = event.target.closest("[data-suggest]");
    if (button) openActivity(null, button.dataset.suggest);
  });
  $("#open-activity").addEventListener("click", () => openActivity(null, ""));
  $("#activity-is-sport").addEventListener("change", () => { $("#sport-metrics").hidden = !$("#activity-is-sport").checked; });
  $("#activity-form").addEventListener("submit", saveActivity);
  $$("[data-close-activity]").forEach((button) => button.addEventListener("click", () => closeDialog("#activity-dialog")));
  $("#activity-dialog").addEventListener("click", (event) => { if (event.target === $("#activity-dialog")) closeDialog("#activity-dialog"); });
  $("#life-activity-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-activity-action]");
    if (!button) return;
    const item = activities.find((x) => x.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.activityAction === "edit") openActivity(item);
    else if (window.confirm("要删除这条生活记录吗？")) {
      activities = activities.filter((x) => x.id !== item.id);
      saveList(KEYS.activities, activities);
      renderActivities();
      renderWeekly();
      showToast("生活记录已删除。");
    }
  });
  $("#open-event").addEventListener("click", () => {
    editingEventId = null;
    $("#event-form").reset();
    $("#event-date").value = todayKey();
    $("#event-kind").value = "past";
    $("#event-dialog-title").textContent = "记下一个重要日子";
    $("#event-dialog").showModal();
  });
  $("#event-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#event-name").value.trim();
    const date = $("#event-date").value;
    if (!name || !validDateKey(date)) { showToast("请填写名称并选择有效日期。"); return; }
    const previous = editingEventId ? events.find((item) => item.id === editingEventId) : null;
    const item = { id: previous ? previous.id : makeId(), name: name, date: date, kind: $("#event-kind").value === "future" ? "future" : "past" };
    events = previous ? events.map((entry) => entry.id === previous.id ? item : entry) : [item].concat(events);
    if (!saveList(KEYS.events, events)) return;
    editingEventId = null;
    closeDialog("#event-dialog");
    renderEvents();
    showToast("重要日期已记下。");
  });
  $$("[data-close-event]").forEach((button) => button.addEventListener("click", () => closeDialog("#event-dialog")));
  $("#event-dialog").addEventListener("click", (event) => { if (event.target === $("#event-dialog")) closeDialog("#event-dialog"); });
  $("#event-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-action]");
    if (!button) return;
    const item = events.find((x) => x.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.eventAction === "delete") {
      if (!window.confirm("删除这个重要日期？")) return;
      events = events.filter((x) => x.id !== item.id);
      saveList(KEYS.events, events);
      renderEvents();
    } else {
      editingEventId = item.id;
      $("#event-name").value = item.name;
      $("#event-date").value = item.date;
      $("#event-kind").value = item.kind;
      $("#event-dialog-title").textContent = "修改重要日期";
      $("#event-dialog").showModal();
    }
  });
  $("#todo-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#todo-title").value.trim();
    const next = $("#todo-next").value.trim();
    if (!title || !next) return;
    todos.unshift({ id: makeId(), title: title, next: next, done: false, createdAt: new Date().toISOString() });
    if (!saveList(KEYS.todos, todos)) return;
    $("#todo-form").reset();
    renderTodos();
    showToast("待办已收好，下一步也写清楚了。");
  });
  $("#todo-list").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-todo-done]");
    if (!checkbox) return;
    const item = todos.find((x) => x.id === checkbox.dataset.todoDone);
    if (!item) return;
    item.done = checkbox.checked;
    saveList(KEYS.todos, todos);
    renderTodos();
  });
  $("#todo-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-todo-delete]");
    if (!button) return;
    todos = todos.filter((item) => item.id !== button.dataset.todoDelete);
    saveList(KEYS.todos, todos);
    renderTodos();
  });
  $("#pool-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const group = $("#pool-group").value;
    const name = $("#pool-name").value.trim();
    if (!name || !GROUPS.includes(group)) return;
    if (!(activityPool[group] || []).includes(name)) activityPool[group].push(name);
    if (!writeJSON(KEYS.pool, activityPool)) return;
    $("#pool-form").reset();
    renderPool();
    renderRecommendations();
    showToast("活动已放进活动池。");
  });
  $("#pool-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pool-remove]");
    if (!button) return;
    const [group, ...parts] = button.dataset.poolRemove.split("|");
    const name = parts.join("|");
    if (!GROUPS.includes(group)) return;
    activityPool[group] = (activityPool[group] || []).filter((x) => x !== name);
    writeJSON(KEYS.pool, activityPool);
    renderPool();
    renderRecommendations();
  });
  $("#my-export-data").addEventListener("click", () => $("#export-data").click());
  $("#my-import-data").addEventListener("click", () => $("#import-data").click());
  window.addEventListener("shiguang:navigate", (event) => renderCurrent(event.detail && event.detail.screen));
  window.addEventListener("shiguang:entries-updated", () => renderWeekly());
  window.ShiguangExtended = { backupData: backupData, importBackup: importBackup };
  const startingScreen = defaultScreen();
  const startButton = $('[data-nav="' + startingScreen + '"]');
  if (startButton) startButton.click();
  else renderAllExtended();
})();

