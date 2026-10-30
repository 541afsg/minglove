(() => {
  "use strict";

  const STORAGE_KEY = "shiguang.entries.v1";
  const PHOTO_DB_NAME = "shiguang-note-images-v1";
  const MOODS = {
    happy: { label: "开心", emoji: "☀️" },
    calm: { label: "平静", emoji: "🌿" },
    full: { label: "充实", emoji: "✨" },
    tired: { label: "疲惫", emoji: "☁️" },
    low: { label: "低落", emoji: "🌧️" },
  };
  const CATEGORIES = ["日常", "心情", "灵感", "重要时刻"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let entries = loadEntries();
  let activeScreen = "today";
  let selectedMood = "";
  let selectedDate = todayKey();
  let calendarCursor = startOfMonth(new Date());
  let historyCategory = "all";
  let editingId = null;
  let quickSeed = "";
  let draftPhotos = [];
  let photoDatabasePromise = null;
  let photoViewerUrl = null;
  let timelineCategory = "all";
  let deferredInstallPrompt = null;
  let toastTimer = null;

  const dialog = $("#entry-dialog");
  const entryForm = $("#entry-form");

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
    } catch {
      return [];
    }
  }
  function isValidEntry(entry) {
    return entry && typeof entry.id === "string" && Boolean(dateFromKey(entry.date)) && typeof entry.content === "string";
  }
  function saveEntries(nextEntries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
      entries = nextEntries;
      return true;
    } catch {
      showToast("浏览器存储空间不足，请先导出备份。", 3600);
      return false;
    }
  }
  function openPhotoDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error("此浏览器不支持照片本地保存。"));
    if (!photoDatabasePromise) {
      photoDatabasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PHOTO_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("images")) database.createObjectStore("images", { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("无法打开照片存储。"));
      });
    }
    return photoDatabasePromise;
  }
  async function putPhoto(id, blob) {
    const database = await openPhotoDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("images", "readwrite");
      transaction.objectStore("images").put({ id, blob });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("照片没有保存成功。"));
      transaction.onabort = () => reject(transaction.error || new Error("照片保存已取消。"));
    });
  }
  async function getPhoto(id) {
    try {
      const database = await openPhotoDatabase();
      return await new Promise((resolve, reject) => {
        const request = database.transaction("images", "readonly").objectStore("images").get(id);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => reject(request.error || new Error("无法读取照片。"));
      });
    } catch { return null; }
  }
  async function deletePhoto(id) {
    try {
      const database = await openPhotoDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readwrite");
        transaction.objectStore("images").delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch { /* A missing preview is safer than blocking record deletion. */ }
  }
  function safeImageData(value) {
    return typeof value === "string" && value.length <= 5000000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
  }
  function dataUrlToBlob(value) {
    const safe = safeImageData(value);
    if (!safe) throw new Error("备份中的照片格式不正确。" );
    const [header, encoded] = safe.split(",");
    const mime = header.slice(5, header.indexOf(";"));
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("无法导出照片。"));
      reader.readAsDataURL(blob);
    });
  }
  async function compressPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
    fullCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
    fullCanvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, fullCanvas.width, fullCanvas.height);
    const blob = await new Promise((resolve, reject) => fullCanvas.toBlob((result) => result ? resolve(result) : reject(new Error("照片压缩失败。")), "image/jpeg", .78));
    const thumbScale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = Math.max(1, Math.round(bitmap.width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(bitmap.height * thumbScale));
    thumbCanvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
    bitmap.close?.();
    return { id: makeId(), name: String(file.name || "生活照片").slice(0, 120), blob, thumbnailData: thumbCanvas.toDataURL("image/jpeg", .5) };
  }
  function makeId() {
    return globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function formatLongDate(key) {
    const date = dateFromKey(key);
    return date ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date) : key;
  }
  function formatHeroDate(date = new Date()) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
    return `${month}月${day}日 · ${weekday}`;
  }
  function safeTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  function sortedNewest(list = entries) {
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  function showToast(message, duration = 2400) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), duration);
  }
  function emptyState(title, copy) {
    return `<div class="empty-state"><div class="empty-flower" aria-hidden="true">✳</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(copy)}</p></div>`;
  }

  function entryCard(entry, compact = false) {
    const date = dateFromKey(entry.date);
    const time = safeTime(entry.updatedAt || entry.createdAt);
    const mood = MOODS[entry.mood];
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const title = entry.title?.trim() || "一段生活记录";
    const dateBox = compact ? "" : `<div class="entry-datebox"><strong>${date ? date.getDate() : "—"}</strong><span>${date ? `${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)}<br>${date.getMonth() + 1}月<br>${date.getFullYear()}` : ""}</span></div>`;
    const photoList = (Array.isArray(entry.photos) ? entry.photos : []).filter((photo) => photo && typeof photo.id === "string" && safeImageData(photo.thumbnailData)).slice(0, 6);
    const photoGrid = photoList.length ? `<div class="entry-photos photo-count-${photoList.length}">${photoList.map((photo, index) => `<button class="entry-photo" type="button" data-open-photo="${escapeHTML(photo.id)}" data-thumb="${escapeHTML(safeImageData(photo.thumbnailData))}" aria-label="查看第 ${index + 1} 张照片"><img src="${escapeHTML(safeImageData(photo.thumbnailData))}" loading="lazy" alt="生活记录照片 ${index + 1}" /></button>`).join("")}</div>` : "";
    const metadata = [
      mood ? `<span class="entry-mood">${mood.emoji} ${mood.label}</span>` : "",
      entry.place ? `<span class="entry-place">⌖ ${escapeHTML(entry.place)}</span>` : "",
      entry.weather ? `<span class="entry-weather">${escapeHTML(({ 晴: "☀️", 多云: "⛅", 阴: "☁️", 雨: "🌧️", 雪: "❄️" })[entry.weather] || "")} ${escapeHTML(entry.weather)}</span>` : "",
      time ? `<span class="entry-mood">${entry.updatedAt ? "更新于" : "记录于"} ${escapeHTML(time)}</span>` : "",
      ...tags.map((tag) => `<span class="entry-tag">#${escapeHTML(tag)}</span>`),
    ].filter(Boolean).join("");
    return `<article class="entry-card" data-entry-card="${escapeHTML(entry.id)}">${dateBox}<div class="entry-content"><div class="entry-title-row"><h3 class="entry-title">${escapeHTML(title)}</h3><span class="entry-category">${escapeHTML(CATEGORIES.includes(entry.category) ? entry.category : "日常")}</span></div><p class="entry-copy">${escapeHTML(entry.content)}</p>${photoGrid}<div class="entry-meta">${metadata}</div></div><div class="entry-tools"><button class="mini-action" type="button" data-action="edit" data-id="${escapeHTML(entry.id)}" aria-label="编辑：${escapeHTML(title)}">✎</button><button class="mini-action" type="button" data-action="delete" data-id="${escapeHTML(entry.id)}" aria-label="删除：${escapeHTML(title)}">×</button></div></article>`;
  }

  function renderHeaderDate() {
    const now = new Date();
    $("#top-date").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
    $("#hero-date").textContent = formatHeroDate(now);
  }

  function setMood(mood) {
    selectedMood = mood;
    $$(".mood-option").forEach((button) => {
      const selected = button.dataset.mood === mood;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function renderStats() {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dayKeys = new Set(entries.map((entry) => entry.date));
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!dayKeys.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dayKeys.has(todayKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    $("#stat-total").innerHTML = `${entries.length} <small>篇</small>`;
    $("#stat-month").innerHTML = `${entries.filter((entry) => entry.date.startsWith(monthPrefix)).length} <small>篇</small>`;
    $("#stat-streak").innerHTML = `${streak} <small>天</small>`;
  }

  function renderToday() {
    const today = todayKey();
    const query = $("#timeline-search").value.trim().toLocaleLowerCase("zh-CN");
    const filtered = sortedNewest(entries).filter((entry) => {
      const matchesCategory = timelineCategory === "all" || entry.category === timelineCategory;
      const searchText = [entry.title, entry.content, entry.place, ...(Array.isArray(entry.tags) ? entry.tags : [])].join(" ").toLocaleLowerCase("zh-CN");
      return matchesCategory && (!query || searchText.includes(query));
    });
    $("#today-count").textContent = String(filtered.length);
    $("#today-list").innerHTML = filtered.length ? filtered.map((entry) => entryCard(entry)).join("") : (entries.length ? emptyState("没有找到这段记忆", "换个关键词或分类再看看。") : emptyState("故事从第一笔开始", "点右下角的 ＋，把今天的一件小事或一张照片收好。" ));
    const recentStart = new Date();
    recentStart.setDate(recentStart.getDate() - 6);
    const recentKeys = new Set(entries.filter((entry) => entry.date >= todayKey(recentStart) && entry.date <= today).map((entry) => entry.date));
    const recentCount = entries.filter((entry) => entry.date >= todayKey(recentStart) && entry.date <= today).length;
    $("#recent-recall-text").textContent = recentCount ? `近 7 天 · ${recentKeys.size} 天有记录，收下 ${recentCount} 个片刻` : "近 7 天还没有留下记录，今天可以从一件小事开始。";
    if (!selectedMood) {
      const savedMood = entries.find((entry) => entry.date === today && entry.mood)?.mood;
      if (savedMood) setMood(savedMood);
    }
  }

  function renderCalendar() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    $("#calendar-month").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(calendarCursor);
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const monthLength = new Date(year, month + 1, 0).getDate();
    const previousLength = new Date(year, month, 0).getDate();
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      let date;
      let outside = false;
      if (index < offset) { date = new Date(year, month - 1, previousLength - offset + index + 1); outside = true; }
      else if (index >= offset + monthLength) { date = new Date(year, month + 1, index - offset - monthLength + 1); outside = true; }
      else date = new Date(year, month, index - offset + 1);
      const key = todayKey(date);
      const count = entries.filter((entry) => entry.date === key).length;
      const classes = ["calendar-day", outside ? "is-outside" : "", key === todayKey() ? "is-today" : "", key === selectedDate ? "is-selected" : "", count ? "has-entry" : ""].filter(Boolean).join(" ");
      days.push(`<button class="${classes}" type="button" role="gridcell" data-date="${key}" aria-label="${formatLongDate(key)}${count ? `，${count}篇记录` : ""}"${key === selectedDate ? ' aria-pressed="true"' : ""}>${date.getDate()}</button>`);
    }
    $("#calendar-grid").innerHTML = days.join("");
    $("#selected-date-title").textContent = formatLongDate(selectedDate);
    const daily = sortedNewest(entries.filter((entry) => entry.date === selectedDate));
    $("#calendar-day-list").innerHTML = daily.length ? daily.map((entry) => entryCard(entry, true)).join("") : emptyState("这一天还没有记录", "点击中间的 +，把想留下的片刻收进来。" );
  }

  function renderHistory() {
    const query = $("#history-search").value.trim().toLocaleLowerCase("zh-CN");
    const filtered = sortedNewest(entries).filter((entry) => {
      const matchesCategory = historyCategory === "all" || entry.category === historyCategory;
      const haystack = [entry.title, entry.content, entry.place, entry.weather, ...(Array.isArray(entry.tags) ? entry.tags : [])].join(" ").toLocaleLowerCase("zh-CN");
      return matchesCategory && (!query || haystack.includes(query));
    });
    $("#history-summary").textContent = query || historyCategory !== "all" ? `找到 ${filtered.length} 篇记录` : `共收集了 ${entries.length} 篇记录`;
    if (!filtered.length) {
      $("#history-list").innerHTML = entries.length ? emptyState("没有找到这段记忆", "换个关键词试试，或者查看其他分类。") : emptyState("你的故事，从第一笔开始", "心情、灵感、日常小事，都可以放在这里。" );
      return;
    }
    let lastDate = "";
    const html = [];
    filtered.forEach((entry) => {
      if (entry.date !== lastDate) {
        lastDate = entry.date;
        html.push(`<div class="day-divider">${escapeHTML(formatLongDate(entry.date))}</div>`);
      }
      html.push(entryCard(entry));
    });
    $("#history-list").innerHTML = html.join("");
  }

  function renderAll() {
    renderHeaderDate();
    renderStats();
    renderToday();
    renderCalendar();
    renderHistory();
    window.dispatchEvent(new Event("shiguang:entries-updated"));
  }

  function navigate(screen) {
    activeScreen = screen;
    $$("[data-screen]").forEach((section) => {
      const active = section.dataset.screen === screen;
      section.hidden = !active;
      section.classList.toggle("is-active", active);
    });
    $$(".nav-item[data-nav]").forEach((button) => {
      const active = button.dataset.nav === screen;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (screen === "calendar") renderCalendar();
    if (screen === "history") renderHistory();
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.dispatchEvent(new CustomEvent("shiguang:navigate", { detail: { screen } }));
  }

  function openEditor(entry = null, seed = {}) {
    editingId = entry?.id || null;
    quickSeed = !entry ? String(seed.content || "").trim() : "";
    draftPhotos = (Array.isArray(entry?.photos) ? entry.photos : []).map((photo) => ({ ...photo }));
    $("#dialog-title").textContent = entry ? "编辑这段记忆" : "记下这一刻";
    $("#entry-date").value = entry?.date || seed.date || todayKey();
    $("#entry-title").value = entry?.title || "";
    $("#entry-content").value = entry?.content || seed.content || "";
    $("#entry-category").value = entry?.category || seed.category || (selectedMood ? "心情" : "日常");
    $("#entry-mood").value = entry?.mood || seed.mood || selectedMood;
    $("#entry-tags").value = (entry?.tags || []).join("，");
    $("#entry-place").value = entry?.place || "";
    $("#entry-weather").value = entry?.weather || "";
    $("#entry-photos").value = "";
    renderPhotoPreviews();
    dialog.showModal();
    setTimeout(() => (entry ? $("#entry-title") : $("#entry-content")).focus(), 50);
  }

  function closeEditor() {
    if (dialog.open) dialog.close();
    editingId = null;
    quickSeed = "";
    draftPhotos = [];
    entryForm.reset();
    $("#photo-preview").innerHTML = "";
  }

  function renderPhotoPreviews() {
    $("#photo-preview").innerHTML = draftPhotos.map((photo, index) => {
      const source = safeImageData(photo.thumbnailData);
      if (!source) return "";
      return `<div class="photo-preview-item"><img src="${escapeHTML(source)}" alt="待保存照片 ${index + 1}" /><button type="button" data-remove-photo="${index}" aria-label="移除第 ${index + 1} 张照片">×</button></div>`;
    }).join("");
  }

  async function handlePhotoSelection(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    const remaining = Math.max(0, 6 - draftPhotos.length);
    if (!remaining) { showToast("每段记录最多添加 6 张照片。" ); return; }
    if (files.length > remaining) showToast(`最多还可以添加 ${remaining} 张。` );
    showToast("正在整理照片…", 1800);
    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 25 * 1024 * 1024) { showToast("单张照片请小于 25 MB。", 3600); continue; }
      try { draftPhotos.push(await compressPhoto(file)); }
      catch { showToast("有照片无法读取，请从相册选择 JPG 或 PNG 图片。", 3600); }
    }
    renderPhotoPreviews();
  }

  async function openPhotoViewer(button) {
    const photoViewer = $("#photo-viewer");
    const image = $("#photo-viewer-image");
    if (photoViewerUrl) URL.revokeObjectURL(photoViewerUrl);
    photoViewerUrl = null;
    const blob = await getPhoto(button.dataset.openPhoto);
    if (blob) {
      photoViewerUrl = URL.createObjectURL(blob);
      image.src = photoViewerUrl;
    } else image.src = safeImageData(button.dataset.thumb);
    if (image.src) photoViewer.showModal();
  }

  function createEntry(data, existing = null) {
    const timestamp = new Date().toISOString();
    return {
      id: existing?.id || makeId(),
      date: data.date,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: existing ? timestamp : undefined,
      title: data.title.trim(),
      content: data.content.trim(),
      category: CATEGORIES.includes(data.category) ? data.category : "日常",
      mood: Object.hasOwn(MOODS, data.mood) ? data.mood : "",
      tags: data.tags,
      place: data.place.trim(),
      weather: data.weather,
      photos: data.photos,
    };
  }

  async function handleSave(event) {
    event.preventDefault();
    const submitButton = entryForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    const formData = new FormData(entryForm);
    const content = String(formData.get("content") || "").trim();
    const date = String(formData.get("date") || "");
    if (!content) { $("#entry-content").focus(); showToast("先写下一点内容吧。"); submitButton.disabled = false; return; }
    if (!dateFromKey(date)) { $("#entry-date").focus(); showToast("请选择有效的日期。"); submitButton.disabled = false; return; }
    const existing = editingId ? entries.find((entry) => entry.id === editingId) : null;
    const newlyStoredPhotoIds = [];
    try {
      for (const photo of draftPhotos) {
        if (photo.blob) {
          await putPhoto(photo.id, photo.blob);
          newlyStoredPhotoIds.push(photo.id);
        }
      }
      const nextEntry = createEntry({
        date,
        title: String(formData.get("title") || ""),
        content,
        category: String(formData.get("category") || "日常"),
        mood: String(formData.get("mood") || ""),
        tags: String(formData.get("tags") || "").split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
        place: String(formData.get("place") || "").trim(),
        weather: String(formData.get("weather") || ""),
        photos: draftPhotos.map(({ id, name, thumbnailData }) => ({ id, name: String(name || "照片").slice(0, 120), thumbnailData: safeImageData(thumbnailData) })).filter((photo) => photo.thumbnailData),
      }, existing);
      const nextEntries = existing ? entries.map((entry) => entry.id === existing.id ? nextEntry : entry) : [nextEntry, ...entries];
      if (!saveEntries(nextEntries)) {
        await Promise.all(newlyStoredPhotoIds.map(deletePhoto));
        return;
      }
      if (existing && Array.isArray(existing.photos)) {
        const keptIds = new Set(nextEntry.photos.map((photo) => photo.id));
        await Promise.all(existing.photos.filter((photo) => !keptIds.has(photo.id)).map((photo) => deletePhoto(photo.id)));
      }
      if (!existing && quickSeed && $("#quick-content").value.trim() === quickSeed) $("#quick-content").value = "";
      if (date === todayKey()) setMood(nextEntry.mood);
      selectedDate = date;
      calendarCursor = startOfMonth(dateFromKey(date));
      closeEditor();
      renderAll();
      showToast(existing ? "这段记忆已更新。" : "这一刻，已经好好收下了。" );
    } catch (error) {
      await Promise.all(newlyStoredPhotoIds.map(deletePhoto));
      showToast(error instanceof Error ? error.message : "记录没有保存成功，请再试一次。", 3600);
    } finally {
      submitButton.disabled = false;
    }
  }

  function handleQuickSave() {
    const content = $("#quick-content").value.trim();
    if (!content) { $("#quick-content").focus(); showToast("写下一件小事，再把它收好吧。"); return; }
    const entry = createEntry({ date: todayKey(), title: "", content, category: selectedMood ? "心情" : "日常", mood: selectedMood, tags: [], place: "", weather: "", photos: [] });
    if (!saveEntries([entry, ...entries])) return;
    $("#quick-content").value = "";
    renderAll();
    showToast("这一刻，已经好好收下了。" );
  }

  async function handleEntryAction(event) {
    const photoButton = event.target.closest("[data-open-photo]");
    if (photoButton) { await openPhotoViewer(photoButton); return; }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const entry = entries.find((item) => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.action === "edit") openEditor(entry);
    if (button.dataset.action === "delete") {
      if (!window.confirm("确定删除这段记录吗？删除后无法恢复。")) return;
      if (saveEntries(entries.filter((item) => item.id !== entry.id))) {
        await Promise.all((Array.isArray(entry.photos) ? entry.photos : []).map((photo) => deletePhoto(photo.id)));
        renderAll();
        showToast("这段记录已删除。" );
      }
    }
  }

  async function exportBackup() {
    try {
      const exportedEntries = await Promise.all(sortedNewest().map(async (entry) => ({
        ...entry,
        photos: await Promise.all((Array.isArray(entry.photos) ? entry.photos : []).map(async (photo) => {
          const blob = await getPhoto(photo.id);
          return { ...photo, data: blob ? await blobToDataUrl(blob) : safeImageData(photo.thumbnailData) };
        })),
      })));
      const extendedData = window.ShiguangExtended?.backupData?.() || {};
      const backup = { app: "拾光笔记", version: 2, exportedAt: new Date().toISOString(), entries: exportedEntries, ...extendedData };
      const filename = `拾光笔记备份-${todayKey()}.json`;
      const backupText = JSON.stringify(backup, null, 2);
      if (window.ShiguangBackupTransport?.isAndroidApp()) {
        if (!window.confirm("将打开安卓系统文件保存窗口。建议选择“下载”目录，这样浏览器导入时容易找到。保存完成前不要关闭应用。继续吗？")) return;
        await window.ShiguangBackupTransport.saveFile(filename, backupText);
        showToast(`备份文件已写入所选位置：${filename}`, 6000);
        return;
      }
      const blob = new Blob([backupText], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("已发起备份下载。请在浏览器下载列表中确认 JSON 文件存在。", 5000);
    } catch (error) {
      if (error?.code === "SAVE_CANCELLED" || /cancel|取消/i.test(error?.message || "")) {
        showToast("你取消了保存，备份没有写入。", 4500);
      } else {
        showToast("备份没有保存，请重新选择“下载”目录后重试。", 5000);
      }
    }
  }

  function normalizeBackup(raw) {
    const list = Array.isArray(raw) ? raw : raw?.entries;
    if (!Array.isArray(list)) throw new Error("备份文件格式不正确。");
    return list.filter(isValidEntry).map((entry) => ({
      id: entry.id,
      date: entry.date,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      title: typeof entry.title === "string" ? entry.title.slice(0, 80) : "",
      content: entry.content.slice(0, 5000),
      category: CATEGORIES.includes(entry.category) ? entry.category : "日常",
      mood: Object.hasOwn(MOODS, entry.mood) ? entry.mood : "",
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string").map((tag) => tag.slice(0, 40)).slice(0, 12) : [],
      place: typeof entry.place === "string" ? entry.place.slice(0, 60) : "",
      weather: ["晴", "多云", "阴", "雨", "雪"].includes(entry.weather) ? entry.weather : "",
      photos: Array.isArray(entry.photos) ? entry.photos.slice(0, 6).map((photo) => ({
        id: typeof photo?.id === "string" && photo.id.length < 140 ? photo.id : makeId(),
        name: typeof photo?.name === "string" ? photo.name.slice(0, 120) : "生活照片",
        thumbnailData: safeImageData(photo?.thumbnailData),
        data: safeImageData(photo?.data),
      })).filter((photo) => photo.thumbnailData || photo.data) : [],
    }));
  }

  async function importBackup(file) {
    const addedPhotoIds = [];
    try {
      const raw = JSON.parse(await file.text());
      const imported = normalizeBackup(raw);
      if (!imported.length && (Array.isArray(raw) ? raw.length : raw.entries?.length)) throw new Error("文件中没有可识别的记录。");
      if (!window.confirm(`找到 ${imported.length} 篇记录。导入后会与当前记录合并，相同编号的记录不会重复添加。继续吗？`)) return;
      const existingIds = new Set(entries.map((entry) => entry.id));
      const added = imported.filter((entry) => !existingIds.has(entry.id));
      for (const entry of added) {
        for (const photo of entry.photos) {
          const newPhotoId = makeId();
          let data = photo.data || photo.thumbnailData;
          if (data) {
            let imageBlob = dataUrlToBlob(data);
            if (!photo.thumbnailData) {
              const compressed = await compressPhoto(imageBlob);
              imageBlob = compressed.blob;
              photo.thumbnailData = compressed.thumbnailData;
            }
            await putPhoto(newPhotoId, imageBlob);
            addedPhotoIds.push(newPhotoId);
            photo.id = newPhotoId;
          }
          delete photo.data;
        }
      }
      if (saveEntries([...added, ...entries])) {
        await window.ShiguangExtended?.importBackup?.(raw);
        renderAll();
        showToast(`已导入 ${added.length} 篇新记录。` );
      } else await Promise.all(addedPhotoIds.map(deletePhoto));
    } catch (error) {
      await Promise.all(addedPhotoIds.map(deletePhoto));
      showToast(error instanceof Error ? error.message : "无法读取这个备份文件。", 3600);
    } finally {
      $("#import-file").value = "";
    }
  }

  $$(".mood-option").forEach((button) => button.addEventListener("click", () => setMood(button.dataset.mood)));
  $("#quick-save").addEventListener("click", handleQuickSave);
  $("#open-editor").addEventListener("click", () => openEditor(null, { content: $("#quick-content").value }));
  $("#nav-add").addEventListener("click", () => openEditor());
  $("#floating-add").addEventListener("click", () => openEditor());
  $$('[data-nav="today"]').forEach((button) => button.addEventListener("click", () => navigate("today")));
  $$('[data-nav="calendar"]').forEach((button) => button.addEventListener("click", () => navigate("calendar")));
  $$('[data-nav="history"]').forEach((button) => button.addEventListener("click", () => navigate("history")));
  $$('[data-nav="work"]').forEach((button) => button.addEventListener("click", () => navigate("work")));
  $$('[data-nav="my"]').forEach((button) => button.addEventListener("click", () => navigate("my")));
  entryForm.addEventListener("submit", handleSave);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", closeEditor));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeEditor(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && dialog.open) closeEditor(); });
  $("#today-list").addEventListener("click", handleEntryAction);
  $("#calendar-day-list").addEventListener("click", handleEntryAction);
  $("#history-list").addEventListener("click", handleEntryAction);
  $("#entry-photos").addEventListener("change", handlePhotoSelection);
  $("#photo-preview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-photo]");
    if (!button) return;
    draftPhotos.splice(Number(button.dataset.removePhoto), 1);
    renderPhotoPreviews();
  });
  $("#close-photo-viewer").addEventListener("click", () => $("#photo-viewer").close());
  $("#photo-viewer").addEventListener("click", (event) => { if (event.target === $("#photo-viewer")) $("#photo-viewer").close(); });
  $("#photo-viewer").addEventListener("close", () => {
    $("#photo-viewer-image").removeAttribute("src");
    if (photoViewerUrl) URL.revokeObjectURL(photoViewerUrl);
    photoViewerUrl = null;
  });
  $("#month-prev").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); });
  $("#month-next").addEventListener("click", () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); });
  $("#month-today").addEventListener("click", () => { calendarCursor = startOfMonth(new Date()); selectedDate = todayKey(); renderCalendar(); });
  $("#calendar-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    selectedDate = button.dataset.date;
    const date = dateFromKey(selectedDate);
    if (date.getMonth() !== calendarCursor.getMonth() || date.getFullYear() !== calendarCursor.getFullYear()) calendarCursor = startOfMonth(date);
    renderCalendar();
  });
  $("#history-search").addEventListener("input", renderHistory);
  $("#timeline-category").addEventListener("change", (event) => { timelineCategory = event.target.value; renderToday(); });
  $("#timeline-search").addEventListener("input", renderToday);
  $("#timeline-search-toggle").addEventListener("click", () => {
    const toolbar = $(".timeline-toolbar");
    const searching = !toolbar.classList.contains("is-searching");
    toolbar.classList.toggle("is-searching", searching);
    $("#timeline-search").hidden = !searching;
    $("#timeline-search-toggle").setAttribute("aria-label", searching ? "关闭搜索" : "打开搜索");
    if (searching) $("#timeline-search").focus();
    else { $("#timeline-search").value = ""; renderToday(); }
  });
  $("#dismiss-recall").addEventListener("click", () => { $("#recent-recall").hidden = true; });
  $("#category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    historyCategory = button.dataset.category;
    $$(".filter-chip").forEach((chip) => chip.classList.toggle("is-selected", chip === button));
    renderHistory();
  });
  $("#export-data").addEventListener("click", exportBackup);
  $("#import-data").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (event) => { const [file] = event.target.files || []; if (file) importBackup(file); });
  const installButton = $("#install-app");
  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  installButton.hidden = isNativeApp || !/android/i.test(navigator.userAgent) || isStandalone;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("在 Android Chrome 菜单中选择“安装应用”或“添加到主屏幕”。", 4200);
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    showToast("拾光笔记已添加到主屏幕。" );
  });

  renderAll();
  Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
  if (!isNativeApp && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
