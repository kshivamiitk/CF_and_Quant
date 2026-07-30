const state = {
  roadmap: null,
  progress: null,
  flat: [],
  byId: new Map(),
  selectedId: null,
  activeTopic: "all",
  activeView: "today",
  saveTimer: null,
  quantSaveTimer: null,
  drawerOpen: false,
  contestPayload: null,
  contests: [],
  contestTickTimer: null,
  contestPollTimer: null,
  contestNotices: new Set(),
  quant: null,
  quantToday: null,
  personal: null,
  personalSaveTimer: null,
  personalSaveGeneration: 0,
  personalSavedGeneration: 0,
  personalSavesInFlight: 0,
  noteSaveTimer: null,
  noteSaveGeneration: 0,
  noteSavedGeneration: 0,
  noteSavesInFlight: 0,
  notesDirtyGeneration: 0,
  notesOfflineSavePending: false,
  notesRefreshGeneration: 0,
  quantSearch: "",
  quantSource: "all",
  quantStatus: "all",
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedScheduleDate: null,
  editingEventId: null,
  selectedNoteId: null,
  reminderConfig: null,
  notesSearch: "",
  selectedNoteFolderId: "all",
  noteEditorMode: "rich",
  noteSelectionRange: null,
  activeLifePanel: "tasks",
  spendMonth: localStorage.getItem("kumarSpendMonth") || "",
  focusMinutes: 25,
  focusRemainingSeconds: 25 * 60,
  focusRunning: false,
  focusStartedAt: null,
  focusTimer: null,
  brainXp: Number(localStorage.getItem("kumarBrainXp") || 0),
  memoryCards: [],
  memoryOpen: [],
  memoryMatched: new Set(),
  memoryMoves: 0,
  memoryLocked: false,
  mathRound: 0,
  mathScore: 0,
  mathAnswer: null,
  mathPlaying: false,
  activeTradingGame: "market",
  tradingScenario: null,
  tradingScenarios: {},
  tradingRounds: { market: 0, risk: 0, calibration: 0, stopping: 0 },
  riskSession: null,
  calibrationSession: null,
  sequenceAnswer: null,
  sequenceStreak: Number(localStorage.getItem("kumarSequenceStreak") || 0),
  editingSkinRoutineId: null,
  editingGymPlanId: null,
  activeGymMode: "today",
  offlineSavePending: false,
  gymDraftExercises: []
};

const $ = (id) => document.getElementById(id);
const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
document.body.classList.toggle("standalone-app", isInstalledApp);

const initialParams = new URLSearchParams(window.location.search);
const initialView = initialParams.get("view");
const initialDate = initialParams.get("date");
const initialNewNote = initialParams.get("new") === "1";
if (["today", "play", "quant", "planner", "gym", "wellness", "focus", "notes", "tree", "contests", "sheet", "stats"].includes(initialView)) {
  state.activeView = initialView;
}
if (/^\d{4}-\d{2}-\d{2}$/.test(initialDate || "")) state.selectedScheduleDate = initialDate;
localStorage.removeItem("kumarQuantToken");
if (initialParams.has("token") || initialView || initialNewNote) window.history.replaceState({}, document.title, window.location.pathname);

function authHeaders(extra = {}) {
  return extra;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!response.ok) throw new Error(`GET ${url} failed`);
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`POST ${url} failed`);
  return response.json();
}

function flattenRoadmap(roadmap) {
  const flat = [];
  const byId = new Map();

  function visit(node, topic, parentId, depth) {
    const item = {
      ...node,
      topicId: topic.id,
      topicTitle: topic.title,
      parentId,
      depth,
      childrenIds: (node.children || []).map((child) => child.id)
    };
    delete item.children;
    flat.push(item);
    byId.set(item.id, item);
    (node.children || []).forEach((child) => visit(child, topic, item.id, depth + 1));
  }

  roadmap.topics.forEach((topic) => {
    (topic.nodes || []).forEach((node) => visit(node, topic, null, 0));
  });

  state.flat = flat;
  state.byId = byId;
}

function itemProgress(id) {
  if (!state.progress.items[id]) {
    state.progress.items[id] = {
      status: "todo",
      comments: "",
      learnings: "",
      mistakes: "",
      nextAction: "",
      attempts: 0,
      lastUpdated: null
    };
  }
  return state.progress.items[id];
}

function formatUnixTime(seconds) {
  if (!seconds) return "None";
  return new Date(seconds * 1000).toLocaleString();
}

function formatContestTime(seconds) {
  if (!seconds) return "Unknown";
  return new Date(seconds * 1000).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatCountdown(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function formatLocalDateTime(value) {
  if (!value) return "No time set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysRemainingInYear(date = new Date()) {
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1);
  return Math.max(0, Math.ceil((yearEnd.getTime() - date.getTime()) / 86400000));
}

function updateYearRunway() {
  const days = daysRemainingInYear();
  const mark = $("yearAppMark");
  if (mark) mark.innerHTML = `<strong>${days}</strong><small>days</small>`;
  document.title = `${days} days left · CF 2000`;
  const card = $("yearCountdownCard");
  if (card) {
    const year = new Date().getFullYear();
    const total = Math.round((new Date(year + 1, 0, 1) - new Date(year, 0, 1)) / 86400000);
    const elapsed = Math.max(0, total - days);
    const pct = Math.min(100, Math.round((elapsed / total) * 100));
    card.innerHTML = `
      <div><strong>${days}</strong><span>days left in ${year}</span></div>
      <div class="year-progress"><span style="width:${pct}%"></span></div>
      <small>${pct}% of the year complete · icon badge shows ${days}</small>
    `;
  }
  if ("setAppBadge" in navigator) {
    navigator.setAppBadge(days).catch(() => {});
  }
  const favicon = document.querySelector("link[rel='icon']");
  if (favicon) {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f5b800"/><text x="32" y="38" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="25" font-weight="800" fill="#241a00">${days}</text><text x="32" y="51" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="7" font-weight="800" fill="#6b4d00">DAYS</text></svg>`;
    favicon.href = `data:image/svg+xml,${encodeURIComponent(iconSvg)}`;
  }
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const personalCollectionFields = [
  "schedule", "notes", "notesFolders", "noteTombstones", "noteFolderTombstones", "skinRoutines", "skinStepLogs", "gymPlans", "gymSessions", "customExercises", "contestCalendar", "skinProducts", "dailyReflections", "quantAttemptHistory", "expenses", "incomes", "focusSessions", "arcadeSessions", "tasks", "goals",
  "habits", "weeklyReviews", "healthLogs", "careerItems", "documents", "accounts", "budgets",
  "bills", "savingsGoals", "debts"
];

function ensurePersonalCollections() {
  if (!state.personal) return;
  personalCollectionFields.forEach((field) => {
    if (!Array.isArray(state.personal[field])) state.personal[field] = [];
  });
  state.personal.settings ||= { humourStyle: "playful", flexibleStreaks: true };
  const syncedBrainXp=(state.personal.arcadeSessions||[]).reduce((sum,session)=>sum+Number(session.xp||0),0);
  state.brainXp=Math.max(state.brainXp,syncedBrainXp);
}

function daysBetweenDates(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = dateFromIsoDate(fromIso);
  const to = dateFromIsoDate(toIso);
  return Math.round((to - from) / 86400000);
}

function formatShortDate(value) {
  if (!value) return "No date";
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

function dateFromIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateTimeInputValue(date) {
  const value = new Date(date);
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function todayHeading() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${greeting}, Kumar`;
}

function todayLabel() {
  return new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function contestTiming(contest) {
  const now = Math.floor(Date.now() / 1000);
  const startsIn = contest.startTimeSeconds - now;
  const endsIn = contest.endTimeSeconds - now;
  const live = startsIn <= 0 && endsIn > 0;
  let urgency = "later";
  if (live) urgency = "live";
  else if (startsIn <= 6 * 3600) urgency = "critical";
  else if (startsIn <= 24 * 3600) urgency = "soon";
  else if (startsIn <= 7 * 24 * 3600) urgency = "week";
  return { startsIn, endsIn, live, urgency };
}

function contestStatusText(contest) {
  const timing = contestTiming(contest);
  if (timing.live) return `Live, ends in ${formatCountdown(timing.endsIn)}`;
  if (timing.startsIn <= 0) return "Finished";
  return `Starts in ${formatCountdown(timing.startsIn)}`;
}

function visibleContests() {
  const now = Math.floor(Date.now() / 1000);
  return state.contests
    .filter((contest) => contest.endTimeSeconds > now)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.platform.localeCompare(b.platform));
}

function urgentContests() {
  return visibleContests().filter((contest) => {
    const timing = contestTiming(contest);
    return timing.live || timing.startsIn <= 24 * 3600;
  });
}

function primaryContestAlert() {
  const contests = urgentContests();
  return contests.find((contest) => contestTiming(contest).live)
    || contests.find((contest) => contestTiming(contest).startsIn <= 6 * 3600)
    || contests[0]
    || null;
}

function notificationStateText() {
  if (!("Notification" in window)) return "Unavailable";
  if (Notification.permission === "granted") return "Enabled";
  if (Notification.permission === "denied") return "Blocked";
  return "Off";
}

function loadContestNoticeStore() {
  try {
    const raw = localStorage.getItem("cf2000ContestNotices");
    state.contestNotices = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    state.contestNotices = new Set();
  }
}

function saveContestNoticeStore() {
  try {
    localStorage.setItem("cf2000ContestNotices", JSON.stringify([...state.contestNotices].slice(-500)));
  } catch {
    // Notification deduplication is best effort only.
  }
}

function statusOf(id) {
  return itemProgress(id).status || "todo";
}

function isDone(id) {
  return statusOf(id) === "done";
}

function displayStatus(id) {
  if (isDone(id)) return "done";
  if (!isUnlocked(id)) return "locked";
  return statusOf(id);
}

function isUnlocked(id) {
  const item = state.byId.get(id);
  if (!item || !item.parentId) return true;
  return isDone(item.parentId);
}

function prerequisiteText(item) {
  if (!item.parentId) return "None";
  const parent = state.byId.get(item.parentId);
  return parent ? parent.title : item.parentId;
}

function visibleItems() {
  const query = $("searchInput").value.trim().toLowerCase();
  return state.flat.filter((item) => {
    const topicOk = state.activeTopic === "all" || item.topicId === state.activeTopic;
    if (!topicOk) return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.topicTitle,
      item.rating,
      item.focus,
      ...(item.tags || [])
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function setView(viewName) {
  state.activeView = viewName;
  document.body.dataset.view = viewName;
  document.body.classList.toggle("code-view", ["tree", "sheet", "stats"].includes(viewName));
  ["today", "play", "quant", "planner", "gym", "wellness", "focus", "notes", "tree", "contests", "sheet", "stats"].forEach((name) => {
    $(`${name}View`)?.classList.toggle("active", name === viewName);
    $(`${name}Tab`)?.classList.toggle("active", name === viewName);
  });
  if (viewName === "today") renderToday();
  if (viewName === "play") renderArcade();
  if (viewName === "quant") renderQuant();
  if (viewName === "planner") renderSchedule();
  if (viewName === "gym") renderGymHub();
  if (viewName === "wellness") renderWellness();
  if (viewName === "focus") renderFocusHub();
  if (viewName === "notes") renderNotes();
  if (viewName === "life") renderLife();
  if (viewName === "insights") renderInsights();
  if (viewName === "contests") renderContestsView();
  if (viewName === "sheet") renderSheet();
  if (viewName === "stats") renderStats();
  if (window.matchMedia("(max-width: 480px)").matches) {
    const centerActiveTab=() => {
      const tab=$(`${viewName}Tab`);
      const navigation=tab?.closest(".top-actions");
      if(!tab||!navigation)return;
      const targetLeft=tab.offsetLeft-(navigation.clientWidth-tab.offsetWidth)/2;
      navigation.scrollTo({left:Math.max(0,targetLeft),behavior:"auto"});
    };
    requestAnimationFrame(centerActiveTab);
    setTimeout(centerActiveTab,120);
  }
}

function renderGoal() {
  const goal = state.progress.goal || {};
  $("goalText").textContent = `${goal.currentRating || 1700} -> ${goal.targetRating || 2000} by ${goal.deadline || "2026-12-31"}`;
  $("cfHandleInput").value = state.progress.profile?.codeforcesHandle || "";
}

function renderTopicFilters() {
  const topics = state.roadmap.topics || [];
  const buttons = [
    `<button class="topic-pill ${state.activeTopic === "all" ? "active" : ""}" data-topic="all" type="button">All</button>`
  ];
  topics.forEach((topic) => {
    buttons.push(
      `<button class="topic-pill ${state.activeTopic === topic.id ? "active" : ""}" data-topic="${escapeHtml(topic.id)}" type="button">${escapeHtml(topic.title)}</button>`
    );
  });
  $("topicFilters").innerHTML = buttons.join("");
  document.querySelectorAll(".topic-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTopic = button.dataset.topic;
      renderAll();
    });
  });
}

function renderTree() {
  renderTopicCards();
  renderGraph();
}

function renderTopicCards() {
  const cards = (state.roadmap.topics || []).map((topic) => {
    const items = state.flat.filter((item) => item.topicId === topic.id);
    const done = items.filter((item) => displayStatus(item.id) === "done").length;
    const pct = items.length ? Math.round((done * 100) / items.length) : 0;
    return `
      <button class="topic-card ${state.activeTopic === topic.id ? "active" : ""}" data-topic-card="${escapeHtml(topic.id)}" type="button">
        <h3>${escapeHtml(topic.title)}</h3>
        <div class="mini-progress"><span style="width:${pct}%"></span></div>
        <p>${done}/${items.length} solved</p>
      </button>
    `;
  }).join("");
  $("treePanel").innerHTML = cards;
  document.querySelectorAll("[data-topic-card]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTopic = button.dataset.topicCard;
      const first = state.flat.find((item) => item.topicId === state.activeTopic && isUnlocked(item.id) && displayStatus(item.id) !== "done")
        || state.flat.find((item) => item.topicId === state.activeTopic);
      if (first) state.selectedId = first.id;
      renderAll();
    });
  });
}

function topicItems(topicId) {
  const query = $("searchInput").value.trim().toLowerCase();
  let items = state.flat.filter((item) => topicId === "all" || item.topicId === topicId);
  if (!query) return items;

  const matched = new Set();
  items.forEach((item) => {
    const haystack = [
      item.title,
      item.topicTitle,
      item.rating,
      item.focus,
      item.contestName,
      item.date,
      ...(item.tags || [])
    ].join(" ").toLowerCase();
    if (haystack.includes(query)) {
      let current = item;
      while (current) {
        matched.add(current.id);
        current = current.parentId ? state.byId.get(current.parentId) : null;
      }
      item.childrenIds.forEach((childId) => matched.add(childId));
    }
  });
  return items.filter((item) => matched.has(item.id));
}

function buildLayout(items, offsetY, topicTitle) {
  const itemSet = new Set(items.map((item) => item.id));
  const roots = items.filter((item) => !item.parentId || !itemSet.has(item.parentId));
  const children = new Map();
  items.forEach((item) => {
    const visibleChildren = item.childrenIds.filter((id) => itemSet.has(id));
    children.set(item.id, visibleChildren);
  });

  let leafCursor = 0;
  const positions = new Map();
  const depthGap = 150;
  const leafGap = 150;
  const leftPad = 130;
  const topPad = offsetY + 96;

  function place(id, depth) {
    const childIds = children.get(id) || [];
    let x;
    if (!childIds.length) {
      x = leftPad + leafCursor * leafGap;
      leafCursor += 1;
    } else {
      const xs = childIds.map((childId) => place(childId, depth + 1));
      x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    }
    positions.set(id, { x, y: topPad + depth * depthGap, depth });
    return x;
  }

  roots.forEach((root) => place(root.id, 0));
  const maxDepth = Math.max(0, ...Array.from(positions.values()).map((pos) => pos.depth));
  const width = Math.max(980, leftPad * 2 + Math.max(1, leafCursor) * leafGap);
  const height = topPad + maxDepth * depthGap + 150 - offsetY;
  return { positions, width, height, topicTitle, offsetY };
}

function renderGraph() {
  const selectedTopic = state.activeTopic === "all"
    ? null
    : (state.roadmap.topics || []).find((topic) => topic.id === state.activeTopic);
  const topicsToRender = selectedTopic ? [selectedTopic] : (state.roadmap.topics || []);
  const layouts = [];
  let offsetY = 0;
  let maxWidth = 980;

  topicsToRender.forEach((topic) => {
    const items = topicItems(topic.id);
    if (!items.length) return;
    const layout = buildLayout(items, offsetY, topic.title);
    layouts.push({ ...layout, items, topic });
    offsetY += layout.height + 54;
    maxWidth = Math.max(maxWidth, layout.width);
  });

  const canvasHeight = Math.max(680, offsetY + 20);
  const canvas = $("graphCanvas");
  canvas.style.width = `${maxWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  $("edgeLayer").setAttribute("width", maxWidth);
  $("edgeLayer").setAttribute("height", canvasHeight);
  $("edgeLayer").setAttribute("viewBox", `0 0 ${maxWidth} ${canvasHeight}`);

  const edges = [];
  const nodes = [];
  let ordinal = 1;

  layouts.forEach((layout) => {
    nodes.push(`<div class="graph-topic-title" style="top:${layout.offsetY + 18}px">${escapeHtml(layout.topicTitle)}</div>`);
    const itemSet = new Set(layout.items.map((item) => item.id));
    layout.items.forEach((item) => {
      const pos = layout.positions.get(item.id);
      if (!pos) return;
      if (item.parentId && itemSet.has(item.parentId)) {
        const parent = layout.positions.get(item.parentId);
        if (parent) {
          edges.push(`<line class="edge-line ${isDone(item.id) ? "done" : ""}" x1="${parent.x}" y1="${parent.y}" x2="${pos.x}" y2="${pos.y}"></line>`);
        }
      }
      const unlocked = isUnlocked(item.id);
      const status = displayStatus(item.id);
      const selected = state.selectedId === item.id ? "selected" : "";
      const lockText = unlocked ? "" : "Locked. Finish prerequisite first.";
      nodes.push(`
        <div class="graph-node-wrap" style="left:${pos.x}px;top:${pos.y}px">
          <button class="graph-node ${escapeHtml(status)} ${selected}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.title)} ${lockText}" type="button">
            <span>
              <span class="graph-number">${ordinal}</span>
              <span class="graph-rating">${escapeHtml(item.rating)}</span>
            </span>
          </button>
          <div class="graph-label">${escapeHtml(item.title)}</div>
        </div>
      `);
      ordinal += 1;
    });
  });

  $("roadmapTitle").textContent = selectedTopic ? selectedTopic.title : "All Topic Trees";
  $("roadmapSubtitle").textContent = selectedTopic
    ? `${selectedTopic.goal} Yellow nodes are pending; green nodes are solved.`
    : `All ${state.flat.length} Codeforces practice problems, grouped into topic trees.`;
  $("edgeLayer").innerHTML = edges.join("");
  $("graphNodes").innerHTML = nodes.join("") || `<div class="empty-state">No matching problems.</div>`;

  document.querySelectorAll(".graph-node").forEach((button) => {
    button.addEventListener("click", () => selectProblem(button.dataset.id));
  });
}

function selectProblem(id) {
  state.selectedId = id;
  renderTree();
  renderDetail();
  openProblemDrawer();
}

function statusBadge(status, unlocked) {
  if (!unlocked) return `<span class="status-badge">Locked</span>`;
  const label = status === "done" ? "Done" : status === "doing" ? "Doing" : "Todo";
  return `<span class="status-badge">${label}</span>`;
}

function renderDetail() {
  if (!state.selectedId && state.flat.length) {
    state.selectedId = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done")?.id || state.flat[0].id;
  }

  const item = state.byId.get(state.selectedId);
  if (!item) {
    $("problemDetail").innerHTML = `<div class="empty-state">Select a problem.</div>`;
    return;
  }

  const progress = itemProgress(item.id);
  const unlocked = isUnlocked(item.id);
  const tags = (item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const childCount = item.childrenIds.length;
  const childrenDone = item.childrenIds.filter((id) => isDone(id)).length;
  const lockedReason = unlocked || progress.status === "done" ? "" : `<div class="lock-banner">Locked until: ${escapeHtml(prerequisiteText(item))}</div>`;
  const problemLinkClass = "primary-link";

  $("problemDetail").innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="detail-meta">
          <span class="rating-badge">${escapeHtml(item.rating)}</span>
          ${statusBadge(displayStatus(item.id), unlocked || progress.status === "done")}
          <span class="status-badge">${escapeHtml(item.topicTitle)}</span>
          <span class="status-badge">${escapeHtml(item.date || "")}</span>
        </div>
        ${lockedReason}
      </div>
      <div class="detail-actions">
        <a class="${problemLinkClass}" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open Problem</a>
        <button id="nextButton" class="secondary-button" type="button">Next</button>
      </div>
    </div>
    <div class="detail-body">
      <aside>
        <div class="field-group">
          <label>Status</label>
          <select id="statusSelect" ${unlocked ? "" : "disabled"}>
            <option value="todo" ${progress.status === "todo" ? "selected" : ""}>Todo</option>
            <option value="doing" ${progress.status === "doing" ? "selected" : ""}>Doing</option>
            <option value="done" ${progress.status === "done" ? "selected" : ""}>Done</option>
          </select>
        </div>
        <div class="field-group">
          <label>Attempts</label>
          <select id="attemptSelect" ${unlocked ? "" : "disabled"}>
            ${[0, 1, 2, 3, 4, 5].map((num) => `<option value="${num}" ${Number(progress.attempts || 0) === num ? "selected" : ""}>${num}</option>`).join("")}
          </select>
        </div>
        <div class="field-group">
          <label>Prerequisite</label>
          <div class="readonly-box">${escapeHtml(prerequisiteText(item))}</div>
        </div>
        <div class="field-group">
          <label>Unlocks</label>
          <div class="readonly-box">${childCount ? `${childrenDone}/${childCount} completed below` : "No child problems"}</div>
        </div>
        <div class="field-group">
          <label>Focus</label>
          <div class="readonly-box">${escapeHtml(item.focus || "")}</div>
        </div>
        <div class="field-group">
          <label>Contest</label>
          <div class="readonly-box">${escapeHtml(item.contestName || "")}</div>
        </div>
        <div class="field-group">
          <label>Tags</label>
          <div class="tag-list">${tags}</div>
        </div>
        <div id="saveState" class="save-state"></div>
      </aside>
      <section class="note-grid">
        <div class="field-group">
          <label>Comments</label>
          <textarea id="commentsInput">${escapeHtml(progress.comments || "")}</textarea>
        </div>
        <div class="field-group">
          <label>Learnings</label>
          <textarea id="learningsInput">${escapeHtml(progress.learnings || "")}</textarea>
        </div>
        <div class="field-group">
          <label>Mistakes</label>
          <textarea id="mistakesInput">${escapeHtml(progress.mistakes || "")}</textarea>
        </div>
        <div class="field-group">
          <label>Next action</label>
          <textarea id="nextActionInput">${escapeHtml(progress.nextAction || "")}</textarea>
        </div>
      </section>
    </div>
  `;

  $("nextButton").addEventListener("click", selectNextUnlocked);
  if (unlocked) {
    $("statusSelect").addEventListener("change", () => updateCurrent("status", $("statusSelect").value));
    $("attemptSelect").addEventListener("change", () => updateCurrent("attempts", Number($("attemptSelect").value)));
  }
  ["comments", "learnings", "mistakes", "nextAction"].forEach((field) => {
    $(`${field}Input`).addEventListener("input", () => updateCurrent(field, $(`${field}Input`).value, true));
  });
}

function updateCurrent(field, value, debounced = false) {
  if (!state.selectedId) return;
  const noteField = ["comments", "learnings", "mistakes", "nextAction"].includes(field);
  if (!noteField && !isUnlocked(state.selectedId)) return;
  const progress = itemProgress(state.selectedId);
  const previousValue = progress[field];
  progress[field] = value;
  if (state.personal && ["status", "attempts"].includes(field) && previousValue !== value) {
    state.personal.quantAttemptHistory ||= [];
    state.personal.quantAttemptHistory.unshift({
      id: `quant-attempt-${Date.now()}`,
      questionId: state.selectedId,
      title: state.byId.get(state.selectedId)?.title || state.selectedId,
      field,
      from: previousValue ?? "",
      to: value,
      occurredAt: new Date().toISOString()
    });
    savePersonal(true, false);
  }
  if (field === "status") {
    progress.statusSource = "manual";
  }
  progress.lastUpdated = new Date().toISOString();
  if (field === "status") {
    renderTree();
    renderSheet();
    if (state.drawerOpen) renderDrawer();
  }
  scheduleSave(debounced);
}

function quantAttemptTimeline(questionId) {
  const entries=(state.personal?.quantAttemptHistory||[]).filter(item=>item.questionId===questionId).slice(0,6);
  return entries.length?`<div class="quant-attempt-timeline"><strong>Attempt history</strong>${entries.map(item=>`<span>${escapeHtml(formatLocalDateTime(item.occurredAt))} · ${escapeHtml(item.field)}: ${escapeHtml(item.from)} → ${escapeHtml(item.to)}</span>`).join("")}</div>`:"";
}

function openProblemDrawer() {
  state.drawerOpen = true;
  renderDrawer();
  $("drawerBackdrop").classList.remove("hidden");
  $("problemDrawer").classList.remove("hidden");
  $("problemDrawer").setAttribute("aria-hidden", "false");
}

function closeProblemDrawer() {
  state.drawerOpen = false;
  $("drawerBackdrop").classList.add("hidden");
  $("problemDrawer").classList.add("hidden");
  $("problemDrawer").setAttribute("aria-hidden", "true");
}

function renderDrawer() {
  const item = state.byId.get(state.selectedId);
  if (!item) return;

  const progress = itemProgress(item.id);
  const unlocked = isUnlocked(item.id);
  const status = progress.status || "todo";
  const tags = (item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const lockedReason = unlocked ? "" : `<div class="lock-banner">Manual status is locked until: ${escapeHtml(prerequisiteText(item))}. Notes and the Codeforces link are still available.</div>`;
  const cfInfo = progress.statusSource === "codeforces"
    ? `Synced from Codeforces. Attempts: ${progress.cfAttempts || progress.attempts || 0}. Last submission: ${formatUnixTime(progress.lastCfSubmissionAt)}.`
    : "Not synced from Codeforces yet.";

  $("drawerContent").innerHTML = `
    <div class="drawer-header">
      <div class="drawer-title-row">
        <div>
          <h2>${escapeHtml(item.title)}</h2>
          <div class="detail-meta">
            <span class="rating-badge">${escapeHtml(item.rating)}</span>
            ${statusBadge(status, unlocked || status === "done")}
            <span class="status-badge">${escapeHtml(item.topicTitle)}</span>
            <span class="status-badge">${escapeHtml(item.date || "")}</span>
          </div>
          ${lockedReason}
        </div>
        <button id="drawerClose" class="drawer-close" type="button" aria-label="Close">x</button>
      </div>
      <div class="drawer-action-row">
        <a class="primary-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open Codeforces</a>
        <button id="drawerNextButton" class="secondary-button" type="button">Next unlocked</button>
      </div>
    </div>
    <div class="drawer-body">
      <div class="drawer-grid">
        <aside>
          <div class="field-group">
            <label>Status</label>
            <select id="drawerStatusSelect" ${unlocked ? "" : "disabled"}>
              <option value="todo" ${status === "todo" ? "selected" : ""}>Todo</option>
              <option value="doing" ${status === "doing" ? "selected" : ""}>Doing</option>
              <option value="done" ${status === "done" ? "selected" : ""}>Done</option>
            </select>
          </div>
          <div class="field-group">
            <label>Attempts</label>
            <select id="drawerAttemptSelect" ${unlocked ? "" : "disabled"}>
              ${[0, 1, 2, 3, 4, 5].map((num) => `<option value="${num}" ${Number(progress.attempts || 0) === num ? "selected" : ""}>${num}</option>`).join("")}
            </select>
          </div>
          <div class="field-group">
            <label>Prerequisite</label>
            <div class="readonly-box">${escapeHtml(prerequisiteText(item))}</div>
          </div>
          <div class="field-group">
            <label>Codeforces sync</label>
            <div class="readonly-box cf-sync-note">${escapeHtml(cfInfo)}</div>
          </div>
          <div class="field-group">
            <label>Contest</label>
            <div class="readonly-box">${escapeHtml(item.contestName || "")}</div>
          </div>
          <div class="field-group">
            <label>Focus</label>
            <div class="readonly-box">${escapeHtml(item.focus || "")}</div>
          </div>
          <div class="field-group">
            <label>Tags</label>
            <div class="tag-list">${tags}</div>
          </div>
          <div id="drawerSaveState" class="save-state"></div>
        </aside>
        <section class="note-grid">
          <div class="field-group">
            <label>Comments</label>
            <textarea id="drawerCommentsInput">${escapeHtml(progress.comments || "")}</textarea>
          </div>
          <div class="field-group">
            <label>Learnings</label>
            <textarea id="drawerLearningsInput">${escapeHtml(progress.learnings || "")}</textarea>
          </div>
          <div class="field-group">
            <label>Mistakes</label>
            <textarea id="drawerMistakesInput">${escapeHtml(progress.mistakes || "")}</textarea>
          </div>
          <div class="field-group">
            <label>Next action</label>
            <textarea id="drawerNextActionInput">${escapeHtml(progress.nextAction || "")}</textarea>
          </div>
        </section>
      </div>
    </div>
  `;

  $("drawerClose").addEventListener("click", closeProblemDrawer);
  $("drawerNextButton").addEventListener("click", selectNextUnlocked);
  if (unlocked) {
    $("drawerStatusSelect").addEventListener("change", () => updateCurrent("status", $("drawerStatusSelect").value));
    $("drawerAttemptSelect").addEventListener("change", () => updateCurrent("attempts", Number($("drawerAttemptSelect").value)));
  }
  [
    ["comments", "drawerCommentsInput"],
    ["learnings", "drawerLearningsInput"],
    ["mistakes", "drawerMistakesInput"],
    ["nextAction", "drawerNextActionInput"]
  ].forEach(([field, inputId]) => {
    $(inputId).addEventListener("input", () => updateCurrent(field, $(inputId).value, true));
  });
}

function scheduleSave(debounced) {
  const saveState = $("saveState");
  if (saveState) saveState.textContent = "Saving...";
  const drawerSaveState = $("drawerSaveState");
  if (drawerSaveState) drawerSaveState.textContent = "Saving...";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveProgress, debounced ? 450 : 0);
}

async function saveProgress() {
  try {
    const result = await postJson("/api/progress", state.progress);
    if (result.progress) state.progress = result.progress;
    const saveState = $("saveState");
    if (saveState) saveState.textContent = "Saved";
    const drawerSaveState = $("drawerSaveState");
    if (drawerSaveState) drawerSaveState.textContent = "Saved";
    if (state.activeView === "stats") renderStats();
  } catch (error) {
    const saveState = $("saveState");
    if (saveState) saveState.textContent = "Save failed";
    const drawerSaveState = $("drawerSaveState");
    if (drawerSaveState) drawerSaveState.textContent = "Save failed";
    console.error(error);
  }
}

async function syncCodeforces() {
  const handle = $("cfHandleInput").value.trim();
  if (!handle) {
    $("syncStatus").textContent = "Enter handle";
    return;
  }
  $("syncButton").disabled = true;
  $("syncStatus").textContent = "Syncing...";
  try {
    const result = await postJson("/api/sync-codeforces", { handle });
    state.progress = await getJson(`/api/progress?ts=${Date.now()}`);
    $("syncStatus").textContent = `${result.acceptedProblems} AC, ${result.attemptedWithoutAccepted} trying`;
    state.selectedId = state.flat.find((item) => displayStatus(item.id) !== "done" && isUnlocked(item.id))?.id || state.selectedId;
    renderAll();
    if (state.drawerOpen) renderDrawer();
  } catch (error) {
    $("syncStatus").textContent = "Sync failed";
    console.error(error);
  } finally {
    $("syncButton").disabled = false;
  }
}

function selectNextUnlocked() {
  const next = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done");
  if (next) {
    setView("tree");
    selectProblem(next.id);
  }
}

function contestNoticeBucket(contest) {
  const timing = contestTiming(contest);
  if (timing.live) return "live";
  if (timing.startsIn <= 15 * 60) return "15m";
  if (timing.startsIn <= 60 * 60) return "1h";
  if (timing.startsIn <= 6 * 3600) return "6h";
  if (timing.startsIn <= 24 * 3600) return "24h";
  return null;
}

function maybeNotifyContest(contest, force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const bucket = contestNoticeBucket(contest);
  if (!bucket) return;
  const key = `${contest.id}:${bucket}`;
  if (!force && state.contestNotices.has(key)) return;

  const timing = contestTiming(contest);
  const title = timing.live
    ? `${contest.platform} contest is live`
    : `${contest.platform} contest starts in ${formatCountdown(timing.startsIn)}`;
  const body = `${contest.title} | ${formatContestTime(contest.startTimeSeconds)}`;
  try {
    new Notification(title, {
      body,
      tag: key,
      icon: "/alert-icon.svg",
      requireInteraction: timing.live || timing.startsIn <= 15 * 60
    });
    state.contestNotices.add(key);
    saveContestNoticeStore();
  } catch (error) {
    console.error(error);
  }
}

function maybeNotifyUrgentContests(force = false) {
  urgentContests().forEach((contest) => maybeNotifyContest(contest, force));
}

async function enableContestNotifications() {
  if (!("Notification" in window)) {
    renderContestAlerts();
    renderContestsView();
    return;
  }
  if ("serviceWorker" in navigator && "PushManager" in window) {
    try {
      await enableReminders();
    } catch (error) {
      console.error(error);
    }
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission === "granted") {
    maybeNotifyUrgentContests(true);
  }
  renderContestAlerts();
  renderContestsView();
}

async function loadContests(force = false) {
  const query = new URLSearchParams({ ts: Date.now().toString() });
  if (force) query.set("refresh", "1");
  try {
    state.contestPayload = await getJson(`/api/contests?${query.toString()}`);
    state.contests = state.contestPayload.contests || [];
    renderContestAlerts();
    renderContestsView();
    maybeNotifyUrgentContests();
  } catch (error) {
    console.error(error);
    state.contestPayload = { ok: false, error: error.message, contests: [] };
    state.contests = [];
    renderContestAlerts();
    renderContestsView();
  }
}

function contestPlatformCounts(contests) {
  return contests.reduce((counts, contest) => {
    counts[contest.platform] = (counts[contest.platform] || 0) + 1;
    return counts;
  }, {});
}

function renderContestAlerts() {
  const badge = $("contestAlertBadge");
  const tab = $("contestsTab");
  const banner = $("contestEmergencyBanner");
  if (!badge || !tab || !banner) return;

  const upcoming = visibleContests();
  const urgent = urgentContests();
  const primary = primaryContestAlert();
  const strongest = primary ? contestTiming(primary).urgency : "calm";

  tab.classList.remove("live", "critical", "soon", "calm");
  tab.classList.add(strongest);
  badge.classList.toggle("hidden", upcoming.length === 0);
  badge.textContent = urgent.length ? String(urgent.length) : String(upcoming.length);

  if (!primary) {
    banner.classList.add("hidden");
    return;
  }

  const timing = contestTiming(primary);
  banner.classList.remove("hidden", "live", "critical", "soon");
  banner.classList.add(timing.urgency === "live" ? "live" : timing.urgency === "critical" ? "critical" : "soon");
  $("contestEmergencyTitle").textContent = timing.live
    ? `${primary.platform} is live: ${primary.title}`
    : `${primary.platform} starts in ${formatCountdown(timing.startsIn)}: ${primary.title}`;
  $("contestEmergencyMeta").textContent = `${formatContestTime(primary.startTimeSeconds)} | duration ${formatDuration(primary.durationSeconds)} | notifications ${notificationStateText()}`;
}

function contestCard(contest) {
  const timing = contestTiming(contest);
  const urgency = timing.urgency;
  const added = (state.personal?.contestCalendar || []).some((item) => item.platform === contest.platform && Number(item.startTimeSeconds) === Number(contest.startTimeSeconds));
  return `
    <article class="contest-card ${escapeHtml(urgency)}">
      <div class="contest-card-main">
        <div class="contest-platform">${escapeHtml(contest.platform)}</div>
        <h3>${escapeHtml(contest.title)}</h3>
        <div class="contest-meta">
          <span>${escapeHtml(contestStatusText(contest))}</span>
          <span>${escapeHtml(formatContestTime(contest.startTimeSeconds))}</span>
          <span>${escapeHtml(formatDuration(contest.durationSeconds))}</span>
        </div>
      </div>
      <div class="contest-card-actions">
        <a class="primary-link" href="${escapeHtml(contest.url)}" target="_blank" rel="noreferrer">Open</a>
        <button class="secondary-button ${added ? "added" : ""}" data-add-contest-calendar="${escapeHtml(contest.platform)}:${escapeHtml(contest.startTimeSeconds)}" type="button">${added ? "Added ✓" : "Add to my calendar"}</button>
      </div>
    </article>
  `;
}

function renderContestsView() {
  const list = $("contestList");
  if (!list) return;

  const contests = visibleContests();
  const counts = contestPlatformCounts(contests);
  const next = contests[0];
  const sourceErrors = state.contestPayload?.sourceErrors || [];
  const statusParts = [];
  if (state.contestPayload?.cached) statusParts.push(state.contestPayload.stale ? "using stale cache" : "cached");
  if (sourceErrors.length) statusParts.push(sourceErrors.map((entry) => `${entry.platform} failed`).join(", "));
  $("contestFeedStatus").textContent = statusParts.length
    ? statusParts.join(" | ")
    : `Tracking ${contests.length} upcoming contests across Codeforces and CodeChef.`;

  $("contestSummaryCards").innerHTML = `
    <div class="contest-summary-card">
      <strong>${counts.Codeforces || 0}</strong>
      <span>Codeforces</span>
    </div>
    <div class="contest-summary-card">
      <strong>${counts.CodeChef || 0}</strong>
      <span>CodeChef</span>
    </div>
    <div class="contest-summary-card ${primaryContestAlert() ? "urgent" : ""}">
      <strong>${urgentContests().length}</strong>
      <span>within 24h/live</span>
    </div>
    <div class="contest-summary-card">
      <strong>${notificationStateText()}</strong>
      <span>notifications</span>
    </div>
  `;

  list.innerHTML = contests.length
    ? contests.map(contestCard).join("")
    : `<div class="empty-state">No upcoming contests found in the next 45 days.</div>`;
  document.querySelectorAll("[data-add-contest-calendar]").forEach((button) => button.addEventListener("click", () => {
    const [platform, start] = button.dataset.addContestCalendar.split(":");
    addContestToInternalCalendar(platform, Number(start));
  }));

  if (next && !primaryContestAlert()) {
    $("contestEmergencyBanner").classList.add("hidden");
  }
}

function addContestToInternalCalendar(platform, startTimeSeconds) {
  const contest = (state.contests || []).find((item) => item.platform === platform && Number(item.startTimeSeconds) === startTimeSeconds);
  if (!contest) return;
  state.personal.contestCalendar ||= [];
  const existing = state.personal.contestCalendar.find((item) => item.platform === platform && Number(item.startTimeSeconds) === startTimeSeconds);
  if (existing) {
    state.personal.contestCalendar = state.personal.contestCalendar.filter((item) => item !== existing);
    state.personal.schedule = state.personal.schedule.filter((event) => event.contestKey !== existing.id);
  } else {
    const id = `contest-${platform}-${startTimeSeconds}`;
    state.personal.contestCalendar.push({ id, platform, title: contest.title, url: contest.url, startTimeSeconds, durationSeconds: contest.durationSeconds, status: "interested", addedAt: new Date().toISOString() });
    const start = new Date(startTimeSeconds * 1000);
    const end = new Date((startTimeSeconds + Number(contest.durationSeconds || 7200)) * 1000);
    state.personal.schedule.push({
      id: `event-${id}`, contestKey: id, kind: "contest", title: `${platform}: ${contest.title}`,
      start: dateTimeInputValue(start), startUtc: start.toISOString(), end: dateTimeInputValue(end), endUtc: end.toISOString(),
      notes: contest.url, notify: true, completed: false, reminderMinutes: 60,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
  }
  savePersonal(false);
  renderContestsView();
  renderSchedule();
}

function startContestTimers() {
  clearInterval(state.contestTickTimer);
  clearInterval(state.contestPollTimer);
  state.contestTickTimer = setInterval(() => {
    renderContestAlerts();
    if (state.activeView === "contests") renderContestsView();
    maybeNotifyUrgentContests();
  }, 60 * 1000);
  state.contestPollTimer = setInterval(() => loadContests(false), 10 * 60 * 1000);
}

async function loadQuant() {
  state.quantToday = await getJson(`/api/quant/today?ts=${Date.now()}`);
  state.quant = await getJson(`/api/quant?ts=${Date.now()}`);
  renderToday();
  renderQuant();
}

function quantProgressText() {
  const stats = state.quant?.stats || state.quantToday?.stats;
  if (!stats) return "Loading quant bank.";
  return `${stats.done}/${stats.total} solved | ${stats.remaining} remaining | ${stats.progressPercent}% complete`;
}

function sourceLabel(sourceId) {
  return sourceId === "green-book" ? "Green Book" : "Quant Guide";
}

function difficultyLabel(value) {
  const raw = String(value || "unknown");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function currentQuantCard(compact = false) {
  const current = state.quantToday?.current;
  if (!current) {
    return `
      <div class="quant-current empty-current">
        <h3>Quant bank complete</h3>
        <p>All imported quant questions are marked done.</p>
      </div>
    `;
  }
  const stats = state.quantToday?.stats || state.quant?.stats || {};
  const solutionImages = current.solutionImages || [];
  const solution = solutionImages.length
    ? `<div class="solution-panel solution-images">${solutionImages.map((image, index) => `
        <img src="${escapeHtml(image)}" alt="Solution to question ${escapeHtml(current.number)}, page ${index + 1}" loading="lazy">
      `).join("")}</div>`
    : `<div class="solution-lock">Solution unlocks after you mark this problem solved.</div>`;
  const actions = current.status === "done"
    ? `<button id="quantNextButton" class="primary-link" type="button">Load Next Problem</button>`
    : `
        <button id="quantWorkingButton" class="secondary-button" type="button">Still Working</button>
        <button id="quantSolvedButton" class="primary-link" type="button">Solved, Show Solution</button>
      `;
  return `
    <article class="quant-current">
      <div class="quant-current-header">
        <div class="question-kicker">
          <span>${escapeHtml(sourceLabel(current.sourceId))}</span>
          <span>${escapeHtml(current.topic || "general")}</span>
          <span>${escapeHtml(difficultyLabel(current.difficulty))}</span>
        </div>
        <strong class="status-pill ${escapeHtml(current.status)}">${escapeHtml(current.status)}</strong>
      </div>
      <div class="question-title-row">
        <span class="question-number">Q${escapeHtml(current.number)}</span>
        <h3>${escapeHtml(current.title)}</h3>
      </div>
      ${compact ? `
        <div class="daily-meter" aria-label="Quant progress">
          <div><strong>${stats.done || 0}</strong><span>Solved</span></div>
          <div><strong>${stats.remaining || 0}</strong><span>Remaining</span></div>
          <div><strong>${stats.progressPercent || 0}%</strong><span>Complete</span></div>
        </div>
      ` : ""}
      <pre class="question-prompt">${escapeHtml(current.prompt || "")}</pre>
      ${compact ? "" : `
        <div class="quant-work-grid">
          <div class="field-group">
            <label>Your solution <span id="quantAnswerSaveState" class="inline-save-state">Saved</span></label>
            <textarea id="quantUserSolutionInput">${escapeHtml(current.userSolution || "")}</textarea>
          </div>
          <div class="field-group">
            <label>Notes</label>
            <textarea id="quantNotesInput">${escapeHtml(current.notes || "")}</textarea>
          </div>
        </div>
      `}
      <div class="quant-actions">${actions}</div>
      ${compact ? "" : quantAttemptTimeline(current.id)}
      ${solution}
    </article>
  `;
}

function renderToday() {
  const panel = $("todayPanel");
  if (!panel) return;
  const stats = state.quantToday?.stats || {};
  const total = stats.total || 0;
  const done = stats.done || 0;
  const progressWidth = total ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
  const todaysEvents = (state.personal?.schedule || [])
    .filter((event) => String(event.start || "").slice(0, 10) === localIsoDate())
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .slice(0, 4);
  const nextCf = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done");
  const nextContest = visibleContests()[0];
  const todaySkinRoutines = (state.personal?.skinRoutines || []).filter((item) => routineRunsToday(item, "skin"));
  const todayGymPlans = (state.personal?.gymPlans || []).filter((item) => routineRunsToday(item, "gym"));
  const todayFocusSessions = (state.personal?.focusSessions || []).filter((item) => sessionDate(item) === localIsoDate());
  const todayFocusMinutes = todayFocusSessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const humour=state.personal?.settings?.humourStyle||"playful";
  const coachMessage=todaysEvents.some(item=>!item.completed)
    ? (humour==="direct"?"Finish the next calendar item before adding more.":humour==="gentle"?"One unfinished calendar item is enough for your next small win.":"Your calendar has unfinished business. It has hired me as collection agent.")
    : todayFocusMinutes<25
      ? (humour==="direct"?"Log one focused session today.":humour==="gentle"?"A short focus session would be a kind next step.":"Your focus timer is looking suspiciously well-rested.")
      : "Today has evidence of progress. Keep the landing clean.";

  panel.innerHTML = `
    <section class="today-main">
      <div class="today-header">
        <div>
          <span class="section-eyebrow">${escapeHtml(todayLabel())}</span>
          <h2>${escapeHtml(todayHeading())}</h2>
          <p>Your focused practice desk. Finish the active problem before moving forward.</p>
        </div>
        <button id="todayRefreshButton" class="secondary-button" type="button">Refresh</button>
      </div>
      <div class="focus-strip">
        <div>
          <span>Quant bank</span>
          <strong>${done}/${total}</strong>
        </div>
        <div class="focus-progress"><span style="width:${progressWidth}%"></span></div>
      </div>
      ${currentQuantCard(true)}
    </section>
    <aside class="today-side">
      <div class="today-widget">
        <div class="widget-header">
          <h3>Schedule</h3>
          <button type="button" data-open-planner="1">Open</button>
        </div>
        ${todaysEvents.length ? todaysEvents.map((event) => `
          <button class="today-event" type="button" data-open-planner="1">
            <strong>${escapeHtml(event.title || "Untitled event")}</strong>
            <span>${escapeHtml(formatLocalDateTime(event.start))}</span>
          </button>
        `).join("") : `<p class="muted-copy">No events scheduled today.</p>`}
      </div>
      <div class="today-widget wellness-today-widget skin-today-widget">
        <div class="widget-header">
          <h3>✨ Skin care</h3>
          <button type="button" data-open-wellness="1">Edit</button>
        </div>
        ${todaySkinRoutines.length ? todaySkinRoutines.map((routine) => `
          <div class="today-routine ${completedToday(routine) ? "complete" : ""}">
            <button type="button" data-today-skin-complete="${escapeHtml(routine.id)}" aria-label="${completedToday(routine) ? "Mark incomplete" : "Mark complete"}">${completedToday(routine) ? "✓" : ""}</button>
            <div>
              <strong>${escapeHtml(routine.name)}</strong>
              <span>${escapeHtml(routine.time || "Any time")} · ${(routine.steps || []).length} steps</span>
            </div>
          </div>
        `).join("") : `<p class="muted-copy">No skin routine today. Your face has a day off.</p>`}
      </div>
      <div class="today-widget wellness-today-widget gym-today-widget">
        <div class="widget-header">
          <h3>💪 Gym plan</h3>
          <button type="button" data-open-gym="1">Open workout</button>
        </div>
        ${todayGymPlans.length ? todayGymPlans.map((plan) => `
          ${(() => { const session=gymSessionFor(plan.id); const progress=session?gymSessionProgress(session):{done:0,total:(plan.exercises||[]).reduce((sum,e)=>sum+(Number.parseInt(e.sets,10)||1),0)}; return `<div class="today-routine ${session?.status === "completed" ? "complete" : ""}">
            <button type="button" data-open-gym="1" aria-label="Open workout">${session?.status === "completed" ? "✓" : "›"}</button>
            <div>
              <strong>${escapeHtml(plan.name)}</strong>
              <span>${escapeHtml(plan.time || "Any time")} · ${progress.done}/${progress.total} sets · ${session?.status || "planned"}</span>
            </div>
          </div>`; })()}
        `).join("") : `<p class="muted-copy">No workout today. Even dumbbells need space.</p>`}
      </div>
      <div class="today-widget focus-today-widget">
        <div class="widget-header"><h3>◎ Focus</h3><button type="button" data-open-focus="1">Start</button></div>
        <div class="today-focus-summary"><strong>${todayFocusMinutes}</strong><span>focused minutes · ${todayFocusSessions.length} sessions</span></div>
        <p class="muted-copy">${todayFocusMinutes ? "Evidence that you showed up." : "Start small. Twenty-five honest minutes counts."}</p>
      </div>
      <div class="today-widget contextual-widget">
        <div class="widget-header"><h3>🧭 Right now</h3><button type="button" data-open-gym-coach="1">Coach</button></div>
        <p>${escapeHtml(coachMessage)}</p>
        <small>${state.offlineSavePending?"Working offline · changes will sync automatically":"Synced across your devices"}</small>
      </div>
      <div class="today-widget">
        <div class="widget-header">
          <h3>Codeforces</h3>
          <button type="button" data-open-cf-home="1">Tree</button>
        </div>
        ${nextCf ? `
          <button class="today-event" type="button" data-open-cf="${escapeHtml(nextCf.id)}">
            <strong>${escapeHtml(nextCf.title)}</strong>
            <span>${escapeHtml(nextCf.topicTitle)} | ${escapeHtml(nextCf.rating)}</span>
          </button>
        ` : `<p class="muted-copy">No unlocked Codeforces problem left.</p>`}
      </div>
      <div class="today-widget">
        <div class="widget-header">
          <h3>Next contest</h3>
          <button type="button" data-open-contests="1">Radar</button>
        </div>
        ${nextContest ? `
          <button class="today-event" type="button" data-open-contests="1">
            <strong>${escapeHtml(nextContest.title)}</strong>
            <span>${escapeHtml(contestStatusText(nextContest))} · ${escapeHtml(nextContest.platform)}</span>
          </button>
        ` : `<p class="muted-copy">No upcoming contest found.</p>`}
      </div>
    </aside>
  `;
  $("todayRefreshButton")?.addEventListener("click", loadQuant);
  wireQuantCurrent();
  document.querySelectorAll("[data-open-planner]").forEach((button) => button.addEventListener("click", () => setView("planner")));
  document.querySelectorAll("[data-open-wellness]").forEach((button) => button.addEventListener("click", () => setView("wellness")));
  document.querySelectorAll("[data-open-gym]").forEach((button) => button.addEventListener("click", () => setView("gym")));
  document.querySelectorAll("[data-open-focus]").forEach((button) => button.addEventListener("click", () => setView("focus")));
  document.querySelectorAll("[data-open-gym-coach]").forEach((button)=>button.addEventListener("click",()=>{state.activeGymMode="coach";setView("gym");}));
  document.querySelectorAll("[data-today-skin-complete]").forEach((button) => button.addEventListener("click", () => {
    toggleWellnessCompletion("skinRoutines", button.dataset.todaySkinComplete);
    renderToday();
  }));
  document.querySelectorAll("[data-open-cf]").forEach((button) => {
    button.addEventListener("click", () => {
      setView("tree");
      selectProblem(button.dataset.openCf);
    });
  });
  document.querySelectorAll("[data-open-cf-home]").forEach((button) => button.addEventListener("click", () => setView("tree")));
  document.querySelectorAll("[data-open-contests]").forEach((button) => button.addEventListener("click", () => setView("contests")));
}

function visibleQuantQuestions() {
  const query = state.quantSearch.trim().toLowerCase();
  const source = state.quantSource;
  const status = state.quantStatus;
  return (state.quant?.questions || []).filter((question) => {
    if (source !== "all" && question.sourceId !== source) return false;
    if (status !== "all" && question.status !== status) return false;
    if (!query) return true;
    const haystack = [
      question.title,
      question.sourceTitle,
      question.topic,
      question.difficulty,
      question.prompt,
      ...(question.tags || [])
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderQuant() {
  if (!$("quantCurrentPanel")) return;
  $("quantStatsText").textContent = quantProgressText();
  $("quantCurrentPanel").innerHTML = currentQuantCard(false);
  wireQuantCurrent();
  const visibleQuestions = visibleQuantQuestions();
  const rows = visibleQuestions.map((question) => `
    <tr class="quant-row-${escapeHtml(question.status || "todo")} ${state.quantToday?.activeQuestionId===question.id?"quant-active-row":""}">
      <td><button class="quant-question-picker" type="button" data-choose-quant="${escapeHtml(question.id)}"><strong>Q${escapeHtml(question.number)}</strong> ${escapeHtml(question.title)}<small>${state.quantToday?.activeQuestionId===question.id?"Solving now":"Open and solve"}</small></button></td>
      <td>${escapeHtml(sourceLabel(question.sourceId))}</td>
      <td>${escapeHtml(question.topic || "")}</td>
      <td>${escapeHtml(difficultyLabel(question.difficulty))}</td>
      <td>
        <select class="quant-status-editor ${escapeHtml(question.status || "todo")}" data-quant-status-id="${escapeHtml(question.id)}" aria-label="Status for question ${escapeHtml(question.number)}">
          <option value="todo" ${question.status === "todo" ? "selected" : ""}>Todo</option>
          <option value="doing" ${question.status === "doing" ? "selected" : ""}>Doing</option>
          <option value="done" ${question.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </td>
    </tr>
  `).join("");
  $("quantRows").innerHTML = rows || `<tr><td colspan="5">No matching quant questions.</td></tr>`;
  document.querySelectorAll("[data-quant-status-id]").forEach((select) => {
    select.addEventListener("change", () => updateQuantStatus(select.dataset.quantStatusId, select.value, select));
  });
  document.querySelectorAll("[data-choose-quant]").forEach((button)=>button.addEventListener("click",()=>chooseQuantQuestion(button.dataset.chooseQuant)));
}

async function chooseQuantQuestion(questionId) {
  const result=await postJson("/api/quant/progress",{id:questionId,status:"doing",activate:true});
  if(result.today) state.quantToday=result.today;
  state.quant=await getJson(`/api/quant?ts=${Date.now()}`);
  renderQuant();
  $("quantCurrentPanel")?.scrollIntoView({behavior:"smooth",block:"start"});
}

async function updateQuantStatus(questionId, status, control) {
  const question = (state.quant?.questions || []).find((item) => item.id === questionId);
  const previousStatus = question?.status || "todo";
  if (control) {
    control.disabled = true;
    control.classList.add("saving");
  }
  try {
    const result = await postJson("/api/quant/progress", { id: questionId, status });
    if (question && result.question) Object.assign(question, result.question);
    if (result.today) state.quantToday = result.today;
    state.quant = await getJson(`/api/quant?ts=${Date.now()}`);
    renderToday();
    renderQuant();
  } catch (error) {
    if (question) question.status = previousStatus;
    if (control) control.value = previousStatus;
    console.error(error);
  } finally {
    if (control?.isConnected) {
      control.disabled = false;
      control.classList.remove("saving");
    }
  }
}

function wireQuantCurrent() {
  const current = state.quantToday?.current;
  if (!current) return;
  $("quantUserSolutionInput")?.addEventListener("input", () => updateQuantCurrent({ userSolution: $("quantUserSolutionInput").value }, true));
  $("quantNotesInput")?.addEventListener("input", () => updateQuantCurrent({ notes: $("quantNotesInput").value }, true));
  $("quantWorkingButton")?.addEventListener("click", () => updateQuantCurrent({ status: "doing" }));
  $("quantSolvedButton")?.addEventListener("click", async () => {
    await updateQuantCurrent({ status: "done" });
    setView("quant");
  });
  $("quantNextButton")?.addEventListener("click", loadQuant);
}

async function updateQuantCurrent(fields, debounced = false) {
  const current = state.quantToday?.current;
  if (!current) return;
  Object.assign(current, fields);
  const listQuestion=(state.quant?.questions||[]).find(item=>item.id===current.id);
  if(listQuestion) Object.assign(listQuestion,fields);
  const saveState=$("quantAnswerSaveState");
  if(saveState) saveState.textContent="Saving…";
  clearTimeout(state.quantSaveTimer);
  state.quantSaveTimer = setTimeout(async () => {
    try {
      const result = await postJson("/api/quant/progress", { id: current.id, ...fields });
      if (result.question) {
        Object.assign(current,result.question);
        if(listQuestion) Object.assign(listQuestion,result.question);
      }
      if(result.today) state.quantToday=result.today;
      if(saveState?.isConnected) saveState.textContent="Saved";
      if(fields.status) {
        state.quant=await getJson(`/api/quant?ts=${Date.now()}`);
        renderToday();
        renderQuant();
      }
    } catch(error) {
      if(saveState?.isConnected) saveState.textContent="Save failed";
      console.error(error);
    }
  }, debounced ? 450 : 0);
}

async function loadPersonal() {
  const cached = localStorage.getItem("kumarPersonalOffline");
  const pendingNotes = localStorage.getItem("kumarNotesPending") === "1";
  try {
    state.personal = await getJson(`/api/personal?ts=${Date.now()}`);
    if (pendingNotes && cached) {
      const localPersonal = JSON.parse(cached);
      ["notes", "notesFolders", "noteTombstones", "noteFolderTombstones"].forEach((field) => {
        if (Array.isArray(localPersonal[field])) state.personal[field] = localPersonal[field];
      });
      state.notesOfflineSavePending = true;
    }
    localStorage.setItem("kumarPersonalOffline", JSON.stringify(state.personal));
  } catch (error) {
    if (!cached) throw error;
    state.personal = JSON.parse(cached);
    state.offlineSavePending = true;
    state.notesOfflineSavePending = pendingNotes;
  }
  ensurePersonalCollections();
  state.selectedScheduleDate ||= localIsoDate();
  state.selectedNoteId ||= state.personal.notes?.[0]?.id || null;
  renderSchedule();
  renderWellness();
  renderNotes();
  renderInsights();
  renderLife();
  if (state.notesOfflineSavePending && navigator.onLine) saveNotes(false, false);
  await loadReminderStatus();
}

function savePersonal(debounced = true, rerender = true) {
  const generation = ++state.personalSaveGeneration;
  localStorage.setItem("kumarPersonalOffline", JSON.stringify(state.personal));
  const saveState = $("personalSaveState");
  const wellnessState = $("wellnessSaveState");
  if (saveState) saveState.textContent = "Saving...";
  if (wellnessState) wellnessState.textContent = "Saving...";
  clearTimeout(state.personalSaveTimer);
  state.personalSaveTimer = setTimeout(async () => {
    state.personalSaveTimer = null;
    state.personalSavesInFlight += 1;
    const snapshot = JSON.parse(JSON.stringify(state.personal));
    delete snapshot.notes;
    delete snapshot.notesFolders;
    delete snapshot.noteTombstones;
    delete snapshot.noteFolderTombstones;
    try {
      const result = await postJson("/api/personal", snapshot);
      if (generation !== state.personalSaveGeneration) return;
      if (result.personal) {
        const noteCollections = Object.fromEntries(
          ["notes", "notesFolders", "noteTombstones", "noteFolderTombstones"]
            .map((field) => [field, state.personal[field] || []])
        );
        state.personal = result.personal;
        Object.assign(state.personal, noteCollections);
      }
      state.personalSavedGeneration = generation;
      state.offlineSavePending = false;
      localStorage.setItem("kumarPersonalOffline", JSON.stringify(state.personal));
      if (saveState) saveState.textContent = "Saved";
      if (wellnessState) wellnessState.textContent = "Saved";
      const insightsState = $("insightsSaveState");
      if (insightsState) insightsState.textContent = "Saved";
      if (rerender) {
        renderToday();
        renderSchedule();
        renderGymHub();
        renderWellness();
        renderFocusHub();
        renderInsights();
        renderLife();
      }
    } catch (error) {
      if (generation !== state.personalSaveGeneration) return;
      state.offlineSavePending = true;
      if (saveState) saveState.textContent = "Save failed";
      if (wellnessState) wellnessState.textContent = "Save failed";
      const insightsState = $("insightsSaveState");
      if (insightsState) insightsState.textContent = "Save failed";
      console.error(error);
    } finally {
      state.personalSavesInFlight = Math.max(0, state.personalSavesInFlight - 1);
    }
  }, debounced ? 350 : 0);
  return generation;
}

function saveNotes(debounced = true, rerender = false) {
  const generation = ++state.noteSaveGeneration;
  state.notesDirtyGeneration = generation;
  localStorage.setItem("kumarPersonalOffline", JSON.stringify(state.personal));
  localStorage.setItem("kumarNotesPending", "1");
  const notesState = $("notesSaveState");
  if (notesState) notesState.textContent = "Saving...";
  clearTimeout(state.noteSaveTimer);
  state.noteSaveTimer = setTimeout(async () => {
    state.noteSaveTimer = null;
    state.noteSavesInFlight += 1;
    const snapshot = {
      notes: JSON.parse(JSON.stringify(state.personal.notes || [])),
      notesFolders: JSON.parse(JSON.stringify(state.personal.notesFolders || [])),
      noteTombstones: JSON.parse(JSON.stringify(state.personal.noteTombstones || [])),
      noteFolderTombstones: JSON.parse(JSON.stringify(state.personal.noteFolderTombstones || []))
    };
    try {
      const result = await postJson("/api/notes", snapshot);
      if (generation !== state.noteSaveGeneration) return;
      ["notes", "notesFolders", "noteTombstones", "noteFolderTombstones"].forEach((field) => {
        if (Array.isArray(result[field])) state.personal[field] = result[field];
      });
      state.noteSavedGeneration = generation;
      state.notesDirtyGeneration = 0;
      state.notesOfflineSavePending = false;
      localStorage.removeItem("kumarNotesPending");
      localStorage.setItem("kumarPersonalOffline", JSON.stringify(state.personal));
      if (notesState) notesState.textContent = "Saved";
      if (rerender && state.activeView === "notes") renderNotes();
    } catch (error) {
      if (generation !== state.noteSaveGeneration) return;
      state.notesOfflineSavePending = true;
      if (notesState) notesState.textContent = "Save failed";
      console.error(error);
    } finally {
      state.noteSavesInFlight = Math.max(0, state.noteSavesInFlight - 1);
    }
  }, debounced ? 350 : 0);
  return generation;
}

function eventDate(event) {
  return String(event.start || "").slice(0, 10);
}

function openScheduleEditor(event = null) {
  state.editingEventId = event?.id || null;
  $("scheduleEditor").classList.remove("hidden");
  $("scheduleEditorTitle").textContent = event ? "Edit event" : "New event";
  $("deleteScheduleButton").classList.toggle("hidden", !event);
  $("scheduleTitleInput").value = event?.title || "";
  $("scheduleNotesInput").value = event?.notes || "";
  $("scheduleReminderInput").value = String(event?.reminderMinutes ?? 15);
  $("scheduleNotifyInput").checked = event?.notify !== false;

  if (event) {
    $("scheduleStartInput").value = event.start || "";
    $("scheduleEndInput").value = event.end || "";
  } else {
    const selected = dateFromIsoDate(state.selectedScheduleDate || localIsoDate());
    const now = new Date();
    selected.setHours(
      state.selectedScheduleDate === localIsoDate() ? Math.min(23, now.getHours() + 1) : 9,
      0,
      0,
      0
    );
    const end = new Date(selected.getTime() + 60 * 60000);
    $("scheduleStartInput").value = dateTimeInputValue(selected);
    $("scheduleEndInput").value = dateTimeInputValue(end);
  }
  $("scheduleTitleInput").focus();
}

function closeScheduleEditor() {
  state.editingEventId = null;
  $("scheduleEditor").classList.add("hidden");
}

function saveScheduleEvent() {
  const title = $("scheduleTitleInput").value.trim();
  if (!title) return;
  const start = $("scheduleStartInput").value;
  const existing = state.personal.schedule.find((event) => event.id === state.editingEventId);
  const event = {
    ...(existing || {}),
    id: existing?.id || `event-${Date.now()}`,
    title,
    start,
    startUtc: start ? new Date(start).toISOString() : null,
    end: $("scheduleEndInput").value,
    endUtc: $("scheduleEndInput").value ? new Date($("scheduleEndInput").value).toISOString() : null,
    notes: $("scheduleNotesInput").value.trim(),
    notify: $("scheduleNotifyInput").checked,
    completed: existing?.completed === true,
    reminderMinutes: Number($("scheduleReminderInput").value || 0),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existing) {
    state.personal.schedule = state.personal.schedule.map((item) => item.id === event.id ? event : item);
  } else {
    state.personal.schedule.push(event);
  }
  state.selectedScheduleDate = eventDate(event) || state.selectedScheduleDate;
  closeScheduleEditor();
  savePersonal(false);
}

function renderSchedule() {
  if (!$("calendarGrid") || !state.personal) return;
  state.selectedScheduleDate ||= localIsoDate();
  const month = state.calendarMonth;
  $("calendarMonthLabel").textContent = month.toLocaleDateString([], { month: "long", year: "numeric" });

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - firstDay.getDay());
  const eventCounts = new Map();
  (state.personal.schedule || []).forEach((event) => {
    const date = eventDate(event);
    eventCounts.set(date, (eventCounts.get(date) || 0) + 1);
  });
  $("calendarGrid").innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = localIsoDate(date);
    const count = eventCounts.get(iso) || 0;
    const classes = [
      "calendar-day",
      date.getMonth() !== month.getMonth() ? "outside-month" : "",
      iso === localIsoDate() ? "today" : "",
      iso === state.selectedScheduleDate ? "selected" : ""
    ].filter(Boolean).join(" ");
    return `
      <button class="${classes}" type="button" data-calendar-date="${iso}">
        <span>${date.getDate()}</span>
        ${count ? `<i>${count}</i>` : ""}
      </button>
    `;
  }).join("");

  const selectedDate = dateFromIsoDate(state.selectedScheduleDate);
  const weekday = selectedDate.toLocaleDateString([], { weekday: "long" });
  const monthName = selectedDate.toLocaleDateString([], { month: "short" });
  $("agendaDayName").textContent = `${weekday}, ${monthName}`;
  $("agendaDateNumber").textContent = selectedDate.getDate();
  const events = [...(state.personal.schedule || [])]
    .filter((event) => eventDate(event) === state.selectedScheduleDate)
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  $("scheduleList").innerHTML = events.length ? events.map((event) => `
    <article class="agenda-event">
      <div class="agenda-time">${event.start ? escapeHtml(new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "Any time"}</div>
      <div class="agenda-event-copy">
        <h3>${escapeHtml(event.title || "Untitled event")}</h3>
        <p>${event.completed ? "Completed" : (event.notify === false ? "No reminder" : `${escapeHtml(String(event.reminderMinutes || 0))} min reminder`)}</p>
      </div>
      <button class="event-complete-button ${event.completed ? "completed" : ""}" type="button" data-complete-event="${escapeHtml(event.id)}" aria-label="${event.completed ? "Mark event incomplete" : "Mark event complete"}">${event.completed ? "✓" : "Done"}</button>
      <button class="icon-control" type="button" data-edit-event="${escapeHtml(event.id)}" aria-label="Edit event">›</button>
    </article>
  `).join("") : `<div class="agenda-empty">Nothing planned for this day.</div>`;

  document.querySelectorAll("[data-calendar-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedScheduleDate = button.dataset.calendarDate;
      renderSchedule();
    });
  });
  document.querySelectorAll("[data-edit-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = state.personal.schedule.find((item) => item.id === button.dataset.editEvent);
      if (event) openScheduleEditor(event);
    });
  });
  document.querySelectorAll("[data-complete-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = state.personal.schedule.find((item) => item.id === button.dataset.completeEvent);
      if (!event) return;
      event.completed = !event.completed;
      savePersonal(false);
      renderSchedule();
      renderToday();
    });
  });
  renderDailyHistory();
}

function renderDailyHistory() {
  const panel = $("dailyHistoryPanel");
  if (!panel || !state.personal) return;
  const date = state.selectedScheduleDate;
  const events = (state.personal.schedule || []).filter((event) => eventDate(event) === date);
  const selectedDay = wellnessDayIndex(dateFromIsoDate(date));
  const skin = (state.personal.skinRoutines || []).filter((routine) => !(routine.days || []).length || (routine.days || []).map(Number).includes(selectedDay));
  const gym = (state.personal.gymSessions || []).filter((session) => session.date === date);
  const focus = (state.personal.focusSessions || []).filter((session) => sessionDate(session) === date);
  const quant = (state.quant?.questions || []).filter((question) => String(question.solvedAt || "").slice(0, 10) === date);
  const items = [
    ...events.filter((event)=>event.kind!=="contest").map((item)=>({icon:item.completed?"✓":"□",title:item.title,meta:item.completed?"Schedule completed":date<localIsoDate()?"Schedule missed/incomplete":"Scheduled activity",tone:item.completed?"gym":"focus"})),
    ...skin.map((item) => { const done=(item.completions||[]).includes(date); return { icon: "✨", title: item.name, meta: done ? `${(item.steps || []).length} skincare steps completed` : (date < localIsoDate() ? "Skincare routine missed" : "Skincare routine planned"), tone: done ? "skin" : "missed" }; }),
    ...gym.map((item) => { const p=gymSessionProgress(item); return { icon:"💪", title:item.planName, meta:`${item.status} · ${p.done}/${p.total} sets`,tone:item.status==="absent"?"missed":"gym" }; }),
    ...focus.map((item) => ({ icon:"◎",title:item.label||"Focus session",meta:`${item.minutes} focused minutes`,tone:"focus" })),
    ...quant.map((item) => ({ icon:"Q",title:item.title,meta:"Quant question solved",tone:"quant" })),
    ...events.filter((event)=>event.kind==="contest").map((item)=>({icon:"🏆",title:item.title,meta:item.completed?"Participated/completed":"Contest on calendar",tone:"contest"}))
  ];
  const reflection = (state.personal.dailyReflections || []).find((item)=>item.date===date);
  const missed = items.filter((item)=>item.tone==="missed").length;
  panel.innerHTML = `<div class="daily-history-heading"><div><span class="section-eyebrow">Life record</span><h3>What happened on ${escapeHtml(formatShortDate(date))}</h3></div><strong>${items.length} records</strong></div>
    <div class="daily-history-grid">${items.map((item)=>`<article class="daily-history-item ${item.tone}"><i>${item.icon}</i><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.meta)}</span></div></article>`).join("") || `<div class="agenda-empty">Nothing recorded for this day yet. You can still add or correct it.</div>`}</div>
    <form id="dailyReflectionForm" class="daily-reflection-card">
      <div><span class="section-eyebrow">Close the loop</span><h3>${missed ? `${missed} missed item${missed===1?"":"s"}—reconcile without guilt` : "Daily reflection"}</h3></div>
      <label>Mood <select id="reflectionMood"><option ${reflection?.mood==="great"?"selected":""}>great</option><option ${reflection?.mood==="okay"?"selected":""}>okay</option><option ${reflection?.mood==="rough"?"selected":""}>rough</option></select></label>
      <textarea id="reflectionText" placeholder="What worked? What should tomorrow inherit?">${escapeHtml(reflection?.text||"")}</textarea>
      <input id="reflectionReconcile" value="${escapeHtml(reflection?.reconciliation||"")}" placeholder="Move, forgive, or reschedule missed work">
      <button class="primary-link" type="submit">${reflection ? "Update reflection" : "Save reflection"}</button>
    </form>`;
  $("dailyReflectionForm").addEventListener("submit",(event)=>{event.preventDefault();const value={id:reflection?.id||`reflection-${date}`,date,mood:$("reflectionMood").value,text:$("reflectionText").value.trim(),reconciliation:$("reflectionReconcile").value.trim(),updatedAt:new Date().toISOString()};state.personal.dailyReflections=state.personal.dailyReflections.filter(item=>item.date!==date);state.personal.dailyReflections.push(value);savePersonal(false);});
}

function deleteEditingEvent() {
  if (!state.editingEventId) return;
  state.personal.schedule = state.personal.schedule.filter((event) => event.id !== state.editingEventId);
  closeScheduleEditor();
  savePersonal(false);
}

function wellnessDayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

function routineRunsToday(item, kind) {
  const day = wellnessDayIndex();
  if (kind === "gym") return item.day === "daily" || Number(item.day) === day;
  return !item.days?.length || item.days.map(Number).includes(day);
}

function completedToday(item) {
  return (item.completions || []).includes(localIsoDate());
}

function skinStepDone(routineId, stepIndex, date=localIsoDate()) {
  return (state.personal.skinStepLogs||[]).some(log=>log.routineId===routineId&&Number(log.stepIndex)===Number(stepIndex)&&log.date===date);
}

function toggleSkinStep(routineId, stepIndex) {
  const date=localIsoDate();
  const exists=skinStepDone(routineId,stepIndex,date);
  state.personal.skinStepLogs=state.personal.skinStepLogs.filter(log=>!(log.routineId===routineId&&Number(log.stepIndex)===Number(stepIndex)&&log.date===date));
  if(!exists) state.personal.skinStepLogs.push({id:`skin-log-${routineId}-${stepIndex}-${date}`,routineId,stepIndex:Number(stepIndex),date,completedAt:new Date().toISOString()});
  const routine=state.personal.skinRoutines.find(item=>item.id===routineId);
  if(routine) {
    routine.completions ||= [];
    const allDone=(routine.steps||[]).every((_,index)=>skinStepDone(routineId,index,date));
    routine.completions=routine.completions.filter(item=>item!==date);
    if(allDone) routine.completions.push(date);
  }
  savePersonal(false);
}

function parseExerciseLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, sets, reps, weightKg, durationSeconds, restSeconds, notes] = line.split("|").map((part) => part?.trim() || "");
    return {
      name, sets, reps,
      weightKg: Number(weightKg || 0),
      durationSeconds: Number(durationSeconds || 0),
      restSeconds: Number(restSeconds || 0),
      notes: notes || ""
    };
  });
}

function parseSkinStepLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, product, durationSeconds, notes] = line.split("|").map((part) => part?.trim() || "");
    return { name, product, durationSeconds: Number(durationSeconds || 0), notes };
  });
}

function addSkinRoutine(event) {
  event.preventDefault();
  const days = [...document.querySelectorAll("input[name='skinDay']:checked")].map((input) => Number(input.value));
  const steps = parseSkinStepLines($("skinRoutineStepsInput").value);
  if (!days.length || !steps.length) return;
  const existing = state.personal.skinRoutines.find((item) => item.id === state.editingSkinRoutineId);
  const routine = {
    id: existing?.id || `skin-${Date.now()}`,
    name: $("skinRoutineNameInput").value.trim(),
    period: $("skinRoutinePeriodInput").value,
    time: $("skinRoutineTimeInput").value,
    days,
    steps,
    completions: existing?.completions || [],
    completionHistory: existing?.completionHistory || [],
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  if (existing) state.personal.skinRoutines = state.personal.skinRoutines.map((item) => item.id === existing.id ? routine : item);
  else state.personal.skinRoutines.push(routine);
  state.editingSkinRoutineId = null;
  event.currentTarget.reset();
  $("skinRoutineTimeInput").value = "08:00";
  document.querySelectorAll("input[name='skinDay']").forEach((input) => { input.checked = true; });
  $("skinRoutineSubmitButton").innerHTML = `Add skin routine <span>＋</span>`;
  savePersonal(false);
  renderWellness();
}

function addGymPlan(event) {
  event.preventDefault();
  const exercises = parseExerciseLines($("gymPlanExercisesInput").value);
  if (!exercises.length) return;
  const existing = state.personal.gymPlans.find((item) => item.id === state.editingGymPlanId);
  const plan = {
    id: existing?.id || `gym-${Date.now()}`,
    name: $("gymPlanNameInput").value.trim(),
    day: $("gymPlanDayInput").value,
    time: $("gymPlanTimeInput").value,
    durationMinutes: Number($("gymPlanDurationInput").value || 0),
    exercises,
    completions: existing?.completions || [],
    completionHistory: existing?.completionHistory || [],
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  if (existing) state.personal.gymPlans = state.personal.gymPlans.map((item) => item.id === existing.id ? plan : item);
  else state.personal.gymPlans.push(plan);
  state.editingGymPlanId = null;
  event.currentTarget.reset();
  $("gymPlanTimeInput").value = "18:00";
  $("gymPlanDurationInput").value = "60";
  $("gymPlanSubmitButton").innerHTML = `Add workout plan <span>＋</span>`;
  savePersonal(false);
  renderWellness();
}

function toggleWellnessCompletion(collection, id) {
  const item = (state.personal[collection] || []).find((entry) => entry.id === id);
  if (!item) return;
  item.completions ||= [];
  const today = localIsoDate();
  item.completionHistory ||= [];
  if (item.completions.includes(today)) {
    item.completions = item.completions.filter((date) => date !== today);
    item.completionHistory = item.completionHistory.filter((entry) => entry.date !== today);
  } else {
    item.completions = [...item.completions, today];
    item.completionHistory.push({
      date: today,
      completedAt: new Date().toISOString(),
      durationMinutes: Number(item.durationMinutes || 0),
      snapshot: JSON.parse(JSON.stringify(collection === "gymPlans" ? (item.exercises || []) : (item.steps || [])))
    });
  }
  savePersonal(false);
  renderWellness();
}

function removeWellnessItem(collection, id) {
  state.personal[collection] = (state.personal[collection] || []).filter((item) => item.id !== id);
  savePersonal(false);
  renderWellness();
}

function editSkinRoutine(id) {
  const item = state.personal.skinRoutines.find((routine) => routine.id === id);
  if (!item) return;
  state.editingSkinRoutineId = id;
  $("skinRoutineNameInput").value = item.name || "";
  $("skinRoutinePeriodInput").value = item.period || "custom";
  $("skinRoutineTimeInput").value = item.time || "08:00";
  document.querySelectorAll("input[name='skinDay']").forEach((input) => {
    input.checked = (item.days || []).map(Number).includes(Number(input.value));
  });
  $("skinRoutineStepsInput").value = (item.steps || []).map((step) => {
    const value = typeof step === "string" ? { name: step } : step;
    return [value.name, value.product, value.durationSeconds, value.notes].filter((part, index) => index === 0 || part).join(" | ");
  }).join("\n");
  $("skinRoutineSubmitButton").innerHTML = `Save changes <span>✓</span>`;
  $("skinRoutineNameInput").focus();
}

function editGymPlan(id) {
  const item = state.personal.gymPlans.find((plan) => plan.id === id);
  if (!item) return;
  state.editingGymPlanId = id;
  $("gymPlanNameInput").value = item.name || "";
  $("gymPlanDayInput").value = item.day ?? "daily";
  $("gymPlanTimeInput").value = item.time || "18:00";
  $("gymPlanDurationInput").value = item.durationMinutes || 60;
  $("gymPlanExercisesInput").value = (item.exercises || []).map((exercise) => [
    exercise.name, exercise.sets, exercise.reps, exercise.weightKg,
    exercise.durationSeconds, exercise.restSeconds, exercise.notes
  ].map((part) => part ?? "").join(" | ")).join("\n");
  $("gymPlanSubmitButton").innerHTML = `Save changes <span>✓</span>`;
  $("gymPlanNameInput").focus();
}

function renderWellness() {
  if (!$("wellnessSummary") || !state.personal) return;
  const skins = state.personal.skinRoutines || [];
  const gyms = state.personal.gymPlans || [];
  const todaySkin = skins.filter((item) => routineRunsToday(item, "skin"));
  const todayGym = gyms.filter((item) => routineRunsToday(item, "gym"));
  const due = [...todaySkin, ...todayGym];
  const completed = due.filter(completedToday).length;
  const percentage = due.length ? Math.round((completed / due.length) * 100) : 0;
  $("wellnessSummary").innerHTML = `
    <div class="wellness-progress-ring" style="--progress:${percentage * 3.6}deg"><span>${percentage}%</span></div>
    <div><span class="section-eyebrow">Today’s consistency</span><strong>${completed} of ${due.length} routines complete</strong><p>${due.length ? (completed === due.length ? "Everything done. Beautiful work." : "Small routines, repeated well, create the change.") : "Add a routine to begin your streak."}</p></div>
    <div class="wellness-mini-stat"><strong>${todaySkin.length}</strong><span>skin routines</span></div>
    <div class="wellness-mini-stat"><strong>${todayGym.length}</strong><span>workouts</span></div>
  `;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  $("skinRoutineList").innerHTML = skins.length ? skins.map((item) => `
    <article class="routine-card ${completedToday(item) ? "complete" : ""} ${routineRunsToday(item, "skin") ? "due-today" : ""}">
      <div class="routine-card-head"><div><span>${escapeHtml(item.period || "routine")} · ${escapeHtml(item.time || "")}</span><h4>${escapeHtml(item.name)}</h4></div><div class="routine-card-tools"><button data-edit-skin="${escapeHtml(item.id)}" aria-label="Edit routine">✎</button><button data-remove-wellness="skinRoutines:${escapeHtml(item.id)}" aria-label="Delete routine">×</button></div></div>
      <div class="routine-days">${(item.days || []).map((day) => `<span class="${day === wellnessDayIndex() ? "today" : ""}">${dayNames[day]}</span>`).join("")}</div>
      <ol class="skin-steps">${(item.steps || []).map((step,index) => { const value = typeof step === "string" ? { name: step } : step; const done=skinStepDone(item.id,index); return `<li class="${done?"done":""}"><button type="button" data-skin-step="${escapeHtml(item.id)}:${index}">${done?"✓":""}</button><span><strong>${escapeHtml(value.name)}</strong>${value.product ? ` · ${escapeHtml(value.product)}` : ""}${value.durationSeconds ? ` · ${escapeHtml(value.durationSeconds)} sec` : ""}${value.notes ? `<small>${escapeHtml(value.notes)}</small>` : ""}</span></li>`; }).join("")}</ol>
      ${routineRunsToday(item, "skin") ? `<button class="routine-complete ${completedToday(item) ? "done" : ""}" data-toggle-wellness="skinRoutines:${escapeHtml(item.id)}">${completedToday(item) ? "✓ Completed today" : "Mark routine complete"}</button>` : ""}
    </article>
  `).join("") : `<div class="wellness-empty">Your skin routine will appear here.</div>`;
  $("gymPlanList").innerHTML = gyms.length ? gyms.map((item) => `
    <article class="routine-card ${completedToday(item) ? "complete" : ""} ${routineRunsToday(item, "gym") ? "due-today" : ""}">
      <div class="routine-card-head"><div><span>${item.day === "daily" ? "Every day" : dayNames[Number(item.day)]} · ${escapeHtml(item.time || "")}</span><h4>${escapeHtml(item.name)}</h4></div><div class="routine-card-tools"><button data-edit-gym="${escapeHtml(item.id)}" aria-label="Edit workout">✎</button><button data-remove-wellness="gymPlans:${escapeHtml(item.id)}" aria-label="Delete workout">×</button></div></div>
      <div class="workout-duration"><strong>${Number(item.durationMinutes || 0)}</strong><span>minutes</span><b>${(item.exercises || []).length} exercises</b></div>
      <div class="exercise-list">${(item.exercises || []).map((exercise, index) => `<div><i>${index + 1}</i><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(exercise.sets || "—")} sets</span><span>${escapeHtml(exercise.reps || "—")} reps</span><span>${exercise.weightKg ? `${escapeHtml(exercise.weightKg)} kg` : "bodyweight"}</span><small>${exercise.durationSeconds ? `${escapeHtml(exercise.durationSeconds)}s work` : ""}${exercise.restSeconds ? ` · ${escapeHtml(exercise.restSeconds)}s rest` : ""}</small></div>`).join("")}</div>
      ${routineRunsToday(item, "gym") ? `<button class="routine-complete ${completedToday(item) ? "done" : ""}" data-toggle-wellness="gymPlans:${escapeHtml(item.id)}">${completedToday(item) ? "✓ Workout completed" : "Finish today’s workout"}</button>` : ""}
    </article>
  `).join("") : `<div class="wellness-empty">Your training plan will appear here.</div>`;
  document.querySelectorAll("[data-toggle-wellness]").forEach((button) => button.addEventListener("click", () => {
    const [collection, id] = button.dataset.toggleWellness.split(":");
    toggleWellnessCompletion(collection, id);
  }));
  document.querySelectorAll("[data-remove-wellness]").forEach((button) => button.addEventListener("click", () => {
    const [collection, id] = button.dataset.removeWellness.split(":");
    removeWellnessItem(collection, id);
  }));
  document.querySelectorAll("[data-edit-skin]").forEach((button) => button.addEventListener("click", () => editSkinRoutine(button.dataset.editSkin)));
  document.querySelectorAll("[data-edit-gym]").forEach((button) => button.addEventListener("click", () => editGymPlan(button.dataset.editGym)));
  document.querySelectorAll("[data-skin-step]").forEach((button)=>button.addEventListener("click",()=>{const [id,index]=button.dataset.skinStep.split(":");toggleSkinStep(id,Number(index));}));
  renderSkinProducts();
}

function addSkinProduct(event) {
  event.preventDefault();
  state.personal.skinProducts.unshift({
    id: `product-${Date.now()}`,
    name: $("skinProductNameInput").value.trim(),
    type: $("skinProductTypeInput").value.trim(),
    openedOn: $("skinProductOpenedInput").value,
    expiresOn: $("skinProductExpiryInput").value,
    notes: $("skinProductNotesInput").value.trim()
  });
  event.currentTarget.reset();
  savePersonal(false);
}

function renderSkinProducts() {
  if (!$("skinProductList")) return;
  const today = localIsoDate();
  $("skinProductList").innerHTML = (state.personal.skinProducts || []).map((product) => {
    const expiring = product.expiresOn && product.expiresOn <= today;
    return `<article class="${expiring?"expired":""}"><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.type)}${product.openedOn?` · opened ${escapeHtml(formatShortDate(product.openedOn))}`:""}${product.expiresOn?` · ${expiring?"expired":"expires"} ${escapeHtml(formatShortDate(product.expiresOn))}`:""}</span><small>${escapeHtml(product.notes||"")}</small></div><button data-remove-product="${escapeHtml(product.id)}" aria-label="Delete product">×</button></article>`;
  }).join("") || `<p class="muted-copy">Add products to remember what worked—and what made your face file a complaint.</p>`;
  document.querySelectorAll("[data-remove-product]").forEach((button)=>button.addEventListener("click",()=>{state.personal.skinProducts=state.personal.skinProducts.filter(item=>item.id!==button.dataset.removeProduct);savePersonal(false);}));
}

function gymPlansForDate(dateIso) {
  const day = wellnessDayIndex(dateFromIsoDate(dateIso));
  return (state.personal?.gymPlans || []).filter((plan) => plan.day === "daily" || Number(plan.day) === day);
}

function gymSessionFor(planId, dateIso = localIsoDate()) {
  return (state.personal?.gymSessions || []).find((session) => session.planId === planId && session.date === dateIso);
}

function buildGymSession(plan, dateIso = localIsoDate()) {
  return {
    id: `session-${plan.id}-${dateIso}`,
    planId: plan.id,
    planName: plan.name,
    date: dateIso,
    status: "planned",
    plannedMinutes: Number(plan.durationMinutes || 0),
    startedAt: null,
    completedAt: null,
    notes: "",
    exercises: (plan.exercises || []).map((exercise, exerciseIndex) => ({
      id: `${plan.id}-exercise-${exerciseIndex}`,
      name: exercise.name,
      notes: exercise.notes || "",
      sets: Array.from({ length: Math.max(1, Number.parseInt(exercise.sets, 10) || 1) }, (_, setIndex) => ({
        number: setIndex + 1,
        plannedWeightKg: Number(exercise.weightKg || 0),
        actualWeightKg: Number(exercise.weightKg || 0),
        targetReps: String(exercise.reps || ""),
        actualReps: "",
        durationSeconds: Number(exercise.durationSeconds || 0),
        restSeconds: Number(exercise.restSeconds || 0),
        completed: false
      }))
    }))
  };
}

function ensureGymSession(plan) {
  let session = gymSessionFor(plan.id);
  if (!session) {
    session = buildGymSession(plan);
    state.personal.gymSessions.push(session);
  }
  return session;
}

function gymSessionProgress(session) {
  const sets = (session.exercises || []).flatMap((exercise) => exercise.sets || []);
  const done = sets.filter((set) => set.completed).length;
  return { done, total: sets.length, percent: sets.length ? Math.round(done * 100 / sets.length) : 0 };
}

function setGymAttendance(planId, status) {
  const plan = state.personal.gymPlans.find((item) => item.id === planId);
  if (!plan) return;
  const session = ensureGymSession(plan);
  session.status = status;
  session.startedAt ||= status === "in_progress" ? new Date().toISOString() : null;
  session.completedAt = ["completed", "absent", "rest"].includes(status) ? new Date().toISOString() : null;
  savePersonal(false);
  renderGymHub();
  renderToday();
}

function updateGymSet(sessionId, exerciseIndex, setIndex, field, value) {
  const session = state.personal.gymSessions.find((item) => item.id === sessionId);
  const set = session?.exercises?.[exerciseIndex]?.sets?.[setIndex];
  if (!set) return;
  set[field] = field === "completed" ? Boolean(value) : (field === "actualReps" ? String(value) : Number(value || 0));
  session.status = "in_progress";
  session.startedAt ||= new Date().toISOString();
  const progress = gymSessionProgress(session);
  if (progress.total && progress.done === progress.total) {
    session.status = "completed";
    session.completedAt = new Date().toISOString();
  }
  savePersonal(true, false);
  renderGymHub();
  renderToday();
}

const gymExerciseCatalogue = {
  Chest:["Barbell Flat Bench Press","Dumbbell Flat Bench Press","Barbell Incline Bench Press","Dumbbell Incline Bench Press","Decline Bench Press","Machine Chest Press","Smith Machine Bench Press","Cable Fly","Incline Cable Fly","Pec Deck Fly","Dumbbell Pullover","Push-Up","Incline Push-Up","Decline Push-Up","Chest Dip"],
  Back:["Conventional Deadlift","Romanian Deadlift","Barbell Bent-Over Row","Pendlay Row","T-Bar Row","One-Arm Dumbbell Row","Chest-Supported Row","Seated Cable Row","Lat Pulldown","Close-Grip Lat Pulldown","Pull-Up","Chin-Up","Machine Row","Straight-Arm Pulldown","Rack Pull","Back Extension"],
  Shoulders:["Barbell Overhead Press","Dumbbell Shoulder Press","Arnold Press","Machine Shoulder Press","Dumbbell Lateral Raise","Cable Lateral Raise","Front Raise","Reverse Pec Deck","Rear Delt Fly","Face Pull","Upright Row","Barbell Shrug","Dumbbell Shrug"],
  Biceps:["Barbell Curl","EZ-Bar Curl","Dumbbell Curl","Alternating Dumbbell Curl","Hammer Curl","Incline Dumbbell Curl","Preacher Curl","Cable Curl","Concentration Curl","Spider Curl","Reverse Curl"],
  Triceps:["Cable Triceps Pushdown","Rope Pushdown","Overhead Cable Extension","Dumbbell Overhead Extension","Skull Crusher","Close-Grip Bench Press","Triceps Dip","Diamond Push-Up","Kickback"],
  Legs:["Back Squat","Front Squat","Goblet Squat","Hack Squat","Leg Press","Bulgarian Split Squat","Walking Lunge","Reverse Lunge","Leg Extension","Lying Leg Curl","Seated Leg Curl","Romanian Deadlift","Hip Thrust","Glute Bridge","Cable Kickback","Standing Calf Raise","Seated Calf Raise","Adductor Machine","Abductor Machine"],
  Core:["Plank","Side Plank","Hanging Leg Raise","Captain's Chair Knee Raise","Cable Crunch","Ab Wheel Rollout","Russian Twist","Bicycle Crunch","Dead Bug","Bird Dog","Pallof Press","Mountain Climber"],
  Cardio:["Treadmill Run","Incline Treadmill Walk","Outdoor Run","Cycling","Stationary Bike","Elliptical","Rowing Machine","Stair Climber","Jump Rope","Swimming","Battle Ropes","Sled Push"],
  Mobility:["Full-Body Mobility","Shoulder Mobility","Hip Mobility","Ankle Mobility","Thoracic Rotation","Foam Rolling","Dynamic Warm-Up","Yoga Flow"]
};

function exerciseCatalogueOptions() {
  const custom=(state.personal.customExercises||[]).map(item=>item.name);
  return Object.entries({...gymExerciseCatalogue,...(custom.length?{Custom:custom}:{})}).map(([group,names])=>`<optgroup label="${escapeHtml(group)}">${names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</optgroup>`).join("");
}

function addDraftExercise() {
  const name=$("gymExerciseSelect").value;
  if(!name)return;
  state.gymDraftExercises.push({name,sets:Number($("gymExerciseSets").value||3),reps:$("gymExerciseReps").value.trim()||"8-12",weightKg:Number($("gymExerciseWeight").value||0),durationSeconds:Number($("gymExerciseDuration").value||0),restSeconds:Number($("gymExerciseRest").value||60),notes:""});
  renderGymDraftList();
}

function addCustomExercise() {
  const name=$("gymCustomExerciseName").value.trim(); if(!name)return;
  if(!(state.personal.customExercises||[]).some(item=>item.name.toLowerCase()===name.toLowerCase())) state.personal.customExercises.push({id:`custom-exercise-${Date.now()}`,name});
  savePersonal(false,false);
  renderGymHub();
}

function renderGymDraftList() {
  if(!$("gymDraftExerciseList"))return;
  $("gymDraftExerciseList").innerHTML=state.gymDraftExercises.map((exercise,index)=>`<article><b>${index+1}</b><div><strong>${escapeHtml(exercise.name)}</strong><span>${exercise.sets} sets × ${escapeHtml(exercise.reps)}${exercise.weightKg?` · ${exercise.weightKg} kg`:" · bodyweight"}${exercise.durationSeconds?` · ${exercise.durationSeconds}s`:""} · ${exercise.restSeconds}s rest</span></div><div><button type="button" data-move-draft="${index}:-1" ${index===0?"disabled":""}>↑</button><button type="button" data-move-draft="${index}:1" ${index===state.gymDraftExercises.length-1?"disabled":""}>↓</button><button type="button" data-remove-draft="${index}">×</button></div></article>`).join("")||`<p class="muted-copy">Choose an exercise above, set its numbers, then tap Add exercise.</p>`;
  document.querySelectorAll("[data-remove-draft]").forEach(button=>button.addEventListener("click",()=>{state.gymDraftExercises.splice(Number(button.dataset.removeDraft),1);renderGymDraftList();}));
  document.querySelectorAll("[data-move-draft]").forEach(button=>button.addEventListener("click",()=>{const [from,delta]=button.dataset.moveDraft.split(":").map(Number);const to=from+delta;[state.gymDraftExercises[from],state.gymDraftExercises[to]]=[state.gymDraftExercises[to],state.gymDraftExercises[from]];renderGymDraftList();}));
}

function addGymPlanFromHub(event) {
  event.preventDefault();
  const exercises = state.gymDraftExercises;
  if (!exercises.length) return;
  const existing=state.personal.gymPlans.find(item=>item.id===state.editingGymPlanId);
  const value={
    id: existing?.id || `gym-${Date.now()}`,
    name: $("gymHubPlanName").value.trim(),
    day: $("gymHubDay").value,
    time: $("gymHubTime").value,
    durationMinutes: Number($("gymHubDuration").value || 60),
    exercises,
    completions: existing?.completions||[],
    completionHistory: existing?.completionHistory||[],
    createdAt: existing?.createdAt||new Date().toISOString()
  };
  if(existing) state.personal.gymPlans=state.personal.gymPlans.map(item=>item.id===existing.id?value:item);
  else state.personal.gymPlans.push(value);
  state.editingGymPlanId=null;
  state.gymDraftExercises=[];
  savePersonal(false);
  renderGymHub();
}

function editGymPlanFromHub(id) {
  const plan=state.personal.gymPlans.find(item=>item.id===id); if(!plan)return;
  state.editingGymPlanId=id;
  $("gymHubPlanName").value=plan.name||"";
  $("gymHubDay").value=plan.day??"daily";
  $("gymHubTime").value=plan.time||"18:00";
  $("gymHubDuration").value=plan.durationMinutes||60;
  state.gymDraftExercises=(plan.exercises||[]).map(exercise=>({...exercise}));
  renderGymDraftList();
  $("gymHubPlanForm").querySelector("button[type='submit']").textContent="Save changes";
}

function renderGymToday() {
  const plans = gymPlansForDate(localIsoDate());
  if (!plans.length) return `<div class="gym-empty-day"><span>🛌</span><h3>No workout planned today</h3><p>Recovery is training too—or add a plan for this weekday.</p><button type="button" data-gym-switch="plan" class="primary-link">Build a plan</button></div>`;
  return plans.map((plan) => {
    const existing = gymSessionFor(plan.id);
    const session = existing || buildGymSession(plan);
    if (!existing) state.personal.gymSessions.push(session);
    const progress = gymSessionProgress(session);
    return `<article class="gym-session-card status-${session.status}">
      <header><div><span>${escapeHtml(plan.time || "Flexible")} · ${Number(plan.durationMinutes || 0)} min</span><h3>${escapeHtml(plan.name)}</h3></div><div class="gym-session-progress"><strong>${progress.done}/${progress.total}</strong><span>sets</span></div></header>
      <div class="gym-progress-track"><i style="width:${progress.percent}%"></i></div>
      <div class="gym-attendance-actions">
        <button data-gym-attendance="${escapeHtml(plan.id)}:in_progress">Start / Present</button>
        <button data-gym-attendance="${escapeHtml(plan.id)}:absent">Absent</button>
        <button data-gym-attendance="${escapeHtml(plan.id)}:rest">Rest day</button>
      </div>
      ${["absent", "rest"].includes(session.status) ? `<div class="gym-status-message">${session.status === "absent" ? "Absent recorded. No courtroom drama—tomorrow remains available." : "Recovery day recorded. Your muscles approve."}</div>` : `
      <div class="gym-execution-list">${(session.exercises || []).map((exercise, exerciseIndex) => `
        <section class="gym-execution-exercise"><div class="gym-exercise-heading"><strong>${escapeHtml(exercise.name)}</strong><span>${exercise.sets.filter((set) => set.completed).length}/${exercise.sets.length} sets</span></div>
          <div class="gym-set-table"><div class="gym-set-head"><span>Set</span><span>Weight</span><span>Reps</span><span>Seconds</span><span>Done</span></div>
          ${exercise.sets.map((set, setIndex) => `<div class="gym-set-row ${set.completed ? "complete" : ""}">
            <b>${set.number}</b>
            <input data-gym-set="${session.id}:${exerciseIndex}:${setIndex}:actualWeightKg" type="number" step="0.5" value="${set.actualWeightKg}" aria-label="Weight for set ${set.number}">
            <input data-gym-set="${session.id}:${exerciseIndex}:${setIndex}:actualReps" inputmode="numeric" value="${escapeHtml(set.actualReps)}" placeholder="${escapeHtml(set.targetReps)}" aria-label="Reps for set ${set.number}">
            <input data-gym-set="${session.id}:${exerciseIndex}:${setIndex}:durationSeconds" type="number" value="${set.durationSeconds}" aria-label="Duration for set ${set.number}">
            <button data-gym-check="${session.id}:${exerciseIndex}:${setIndex}" type="button" aria-label="Complete set ${set.number}">${set.completed ? "✓" : ""}</button>
          </div>`).join("")}</div>
        </section>`).join("")}</div>`}
    </article>`;
  }).join("");
}

function renderGymPlan() {
  return `<div class="gym-plan-layout"><form id="gymHubPlanForm" class="gym-plan-form">
    <span class="section-eyebrow">Weekly template</span><h3>Add a workout day</h3>
    <input id="gymHubPlanName" required placeholder="Push day, legs, full body…">
    <div><select id="gymHubDay"><option value="daily">Every day</option>${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day,index)=>`<option value="${index}">${day}</option>`).join("")}</select><input id="gymHubTime" type="time" value="18:00"><input id="gymHubDuration" type="number" min="5" value="60" placeholder="Minutes"></div>
    <section class="exercise-picker"><label>Exercise<select id="gymExerciseSelect">${exerciseCatalogueOptions()}</select></label><label>Sets<input id="gymExerciseSets" type="number" min="1" max="20" value="3"></label><label>Reps<input id="gymExerciseReps" value="8-12"></label><label>Weight kg<input id="gymExerciseWeight" type="number" min="0" step="0.5" value="0"></label><label>Work seconds<input id="gymExerciseDuration" type="number" min="0" value="0"></label><label>Rest seconds<input id="gymExerciseRest" type="number" min="0" value="60"></label><button id="gymAddExerciseButton" class="secondary-button" type="button">＋ Add exercise</button></section>
    <div id="gymDraftExerciseList" class="gym-draft-exercises"></div>
    <details class="custom-exercise-box"><summary>Exercise missing? Add it to my catalogue</summary><div><input id="gymCustomExerciseName" placeholder="Your exercise name"><button id="gymAddCustomExerciseButton" type="button">Add to dropdown</button></div></details>
    <button class="primary-link" type="submit">Save workout plan</button>
  </form><div class="gym-plan-list">${(state.personal.gymPlans || []).map((plan) => `<article><div><strong>${escapeHtml(plan.name)}</strong><span>${plan.day === "daily" ? "Every day" : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][Number(plan.day)]} · ${escapeHtml(plan.time)} · ${(plan.exercises || []).length} exercises</span></div><div><button data-edit-gym-from-hub="${escapeHtml(plan.id)}">Edit</button><button data-delete-gym-from-hub="${escapeHtml(plan.id)}">Delete</button></div></article>`).join("") || `<p class="muted-copy">No workout templates yet.</p>`}</div></div>`;
}

function renderGymHistory() {
  const sessions = [...(state.personal.gymSessions || [])].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<div class="gym-history-list">${sessions.map((session) => { const progress=gymSessionProgress(session); const volume=(session.exercises||[]).flatMap(e=>e.sets||[]).filter(s=>s.completed).reduce((sum,set)=>sum+Number(set.actualWeightKg||0)*Number(set.actualReps||0),0); return `<article class="gym-history-row status-${session.status}"><time>${escapeHtml(formatShortDate(session.date))}</time><div><strong>${escapeHtml(session.planName)}</strong><span>${escapeHtml(session.status.replace("_"," "))} · ${progress.done}/${progress.total} sets · ${volume.toLocaleString("en-IN")} kg volume</span></div></article>`; }).join("") || `<div class="gym-empty-day"><h3>Your workout history begins when you show up.</h3></div>`}</div>`;
}

function gymExerciseRecords() {
  const records = new Map();
  (state.personal.gymSessions || []).forEach((session)=>(session.exercises||[]).forEach((exercise)=>(exercise.sets||[]).filter(set=>set.completed).forEach((set)=>{
    const key=String(exercise.name||"Exercise").toLowerCase();
    const score=Number(set.actualWeightKg||0)*Number(set.actualReps||0);
    const current=records.get(key);
    if(!current||score>current.score) records.set(key,{name:exercise.name,weight:Number(set.actualWeightKg||0),reps:set.actualReps||0,score,date:session.date});
  })));
  return [...records.values()].sort((a,b)=>b.score-a.score);
}

function renderGymCoach() {
  const sessions=[...(state.personal.gymSessions||[])].filter(item=>item.status==="completed").sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const records=gymExerciseRecords();
  const recent=sessions.slice(-4);
  const volumes=recent.map(session=>(session.exercises||[]).flatMap(e=>e.sets||[]).filter(s=>s.completed).reduce((sum,s)=>sum+Number(s.actualWeightKg||0)*Number(s.actualReps||0),0));
  const trend=volumes.length>1?Math.round((volumes.at(-1)-volumes[0])/Math.max(1,volumes[0])*100):0;
  const attendance=(state.personal.gymSessions||[]).filter(s=>["completed","absent"].includes(s.status));
  const rate=attendance.length?Math.round(attendance.filter(s=>s.status==="completed").length/attendance.length*100):0;
  const observation=!sessions.length?"Complete a workout and I’ll start spotting patterns.":trend>5?"Your training volume is climbing. Keep form strict while the numbers get louder.":trend< -10?"Volume dipped recently. Recovery, sleep, and a gentler return may beat forcing it.":"Your workload is steady. Add a rep or a small weight increase when the last set feels clean.";
  return `<div class="gym-coach-grid">
    <section class="gym-coach-hero"><span class="section-eyebrow">Pattern observation</span><h3>${escapeHtml(observation)}</h3><div><strong>${rate}%</strong><span>attendance</span><strong>${trend>0?"+":""}${trend}%</strong><span>volume trend</span><strong>${records.length}</strong><span>personal records</span></div></section>
    <section class="gym-pr-card"><h3>Personal records</h3>${records.slice(0,10).map(item=>`<article><div><strong>${escapeHtml(item.name)}</strong><span>${item.weight} kg × ${escapeHtml(item.reps)} · ${escapeHtml(formatShortDate(item.date))}</span></div><b>🏆</b></article>`).join("")||`<p class="muted-copy">Completed sets will build your record board.</p>`}</section>
    <section class="gym-tools-card"><h3>Your app, your voice</h3><label>Coach humour<select id="humourStyleSelect"><option value="playful">Playful</option><option value="gentle">Gentle</option><option value="direct">Direct</option></select></label><label class="toggle-label"><input id="flexibleStreaksInput" type="checkbox"> Flexible streaks allow one recovery day</label><button id="exportDataButton" class="primary-link" type="button">Export all my data</button><small>${state.offlineSavePending?"Offline changes waiting to sync":"All changes synced"} · JSON export includes every tracker.</small></section>
  </div>`;
}

function exportPersonalData() {
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),personal:state.personal,quantProgress:state.progress},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`life-tracker-${localIsoDate()}.json`;link.click();URL.revokeObjectURL(url);
}

function renderGymHub() {
  if (!$("gymHubContent") || !state.personal) return;
  const now = new Date();
  $("gymTodayWeekday").textContent = now.toLocaleDateString([], { weekday: "long" });
  $("gymTodayDate").textContent = now.toLocaleDateString([], { day: "numeric", month: "short" });
  document.querySelectorAll("[data-gym-mode]").forEach((button)=>button.classList.toggle("active",button.dataset.gymMode===state.activeGymMode));
  $("gymHubContent").innerHTML = state.activeGymMode === "today" ? renderGymToday() : state.activeGymMode === "plan" ? renderGymPlan() : state.activeGymMode === "history" ? renderGymHistory() : renderGymCoach();
  document.querySelectorAll("[data-gym-switch]").forEach((button)=>button.addEventListener("click",()=>{state.activeGymMode=button.dataset.gymSwitch;renderGymHub();}));
  document.querySelectorAll("[data-gym-attendance]").forEach((button)=>button.addEventListener("click",()=>{const [id,status]=button.dataset.gymAttendance.split(":");setGymAttendance(id,status);}));
  document.querySelectorAll("[data-gym-check]").forEach((button)=>button.addEventListener("click",()=>{const [id,e,s]=button.dataset.gymCheck.split(":");const session=state.personal.gymSessions.find(x=>x.id===id)||ensureGymSession(state.personal.gymPlans.find(x=>id.includes(x.id)));const current=session.exercises[Number(e)].sets[Number(s)].completed;updateGymSet(session.id,Number(e),Number(s),"completed",!current);}));
  document.querySelectorAll("[data-gym-set]").forEach((input)=>input.addEventListener("change",()=>{const [id,e,s,field]=input.dataset.gymSet.split(":");updateGymSet(id,Number(e),Number(s),field,input.value);}));
  $("gymHubPlanForm")?.addEventListener("submit",addGymPlanFromHub);
  $("gymAddExerciseButton")?.addEventListener("click",addDraftExercise);
  $("gymAddCustomExerciseButton")?.addEventListener("click",addCustomExercise);
  renderGymDraftList();
  document.querySelectorAll("[data-edit-gym-from-hub]").forEach((button)=>button.addEventListener("click",()=>editGymPlanFromHub(button.dataset.editGymFromHub)));
  document.querySelectorAll("[data-delete-gym-from-hub]").forEach((button)=>button.addEventListener("click",()=>{state.personal.gymPlans=state.personal.gymPlans.filter(item=>item.id!==button.dataset.deleteGymFromHub);savePersonal(false);}));
  if ($("humourStyleSelect")) { $("humourStyleSelect").value=state.personal.settings.humourStyle||"playful"; $("flexibleStreaksInput").checked=state.personal.settings.flexibleStreaks!==false; $("humourStyleSelect").addEventListener("change",()=>{state.personal.settings.humourStyle=$("humourStyleSelect").value;savePersonal(false,false);}); $("flexibleStreaksInput").addEventListener("change",()=>{state.personal.settings.flexibleStreaks=$("flexibleStreaksInput").checked;savePersonal(false,false);}); $("exportDataButton").addEventListener("click",exportPersonalData); }
}

function newNote() {
  ensureNoteFolders();
  const selectedFolderExists=activeNoteFolders().some(folder=>folder.id===state.selectedNoteFolderId);
  const folderId=state.selectedNoteFolderId==="all"||!selectedFolderExists ? "notes-default" : state.selectedNoteFolderId;
  const note = {
    id: `note-${Date.now()}`,
    title: "",
    body: "",
    contentHtml: "",
    markdownBody: "",
    format: "markdown",
    editorMode: "markdown",
    folderId,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.personal.notes.unshift(note);
  state.selectedNoteId = note.id;
  state.noteSelectionRange = null;
  renderNotes();
  $("notesBoard").classList.add("editing-note");
  state.noteEditorMode="markdown";
  $("noteMarkdownInput").focus();
  saveNotes(true, false);
}

function noteCanonicalFormat(note) {
  if (note?.format === "rich" || note?.format === "markdown") return note.format;
  if (note?.editorMode === "markdown" || note?.editorMode === "preview") return "markdown";
  if (note?.editorMode === "rich") return "rich";
  if (note?.markdownBody) return "markdown";
  return "rich";
}

function notePlainTextFromHtml(value) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeNoteHtml(value);
  return (container.innerText || container.textContent || "").replace(/\u00a0/g, " ").trim();
}

function markdownToPlainText(value) {
  return notePlainTextFromHtml(markdownToHtml(value));
}

function normalizeNote(note) {
  const format = noteCanonicalFormat(note);
  note.format = format;
  note.editorMode = format;
  if (format === "markdown") {
    if (typeof note.markdownBody !== "string") {
      note.markdownBody = note.contentHtml ? richHtmlToMarkdown(note.contentHtml) : String(note.body || "");
    }
    note.body = markdownToPlainText(note.markdownBody);
  } else {
    const fallbackHtml = escapeHtml(note.body || "").replaceAll("\n", "<br>");
    note.contentHtml = sanitizeNoteHtml(note.contentHtml || fallbackHtml);
    note.body = notePlainTextFromHtml(note.contentHtml);
  }
  return note;
}

function syncCurrentNoteEditor(note) {
  note.title = $("noteTitleInput").value.trim();
  const format = noteCanonicalFormat(note);
  if(format==="rich" && state.noteEditorMode==="rich") {
    note.body = $("noteBodyInput").innerText;
    note.contentHtml = sanitizeNoteHtml($("noteBodyInput").innerHTML);
  } else if(format==="markdown" && state.noteEditorMode==="markdown") {
    note.markdownBody=$("noteMarkdownInput").value;
    note.body=markdownToPlainText(note.markdownBody);
  }
  note.format=format;
  note.editorMode=format;
}

function saveCurrentNote() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  syncCurrentNoteEditor(note);
  note.updatedAt = new Date().toISOString();
  saveNotes(false, true);
  $("notesBoard").classList.remove("editing-note");
}

function updateCurrentNoteDraft() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  note.title = $("noteTitleInput").value;
  const format=noteCanonicalFormat(note);
  if(format==="rich" && state.noteEditorMode==="rich") {
    note.body = $("noteBodyInput").innerText;
    note.contentHtml = sanitizeNoteHtml($("noteBodyInput").innerHTML);
  } else if(format==="markdown" && state.noteEditorMode==="markdown") {
    note.markdownBody=$("noteMarkdownInput").value;
    note.body=markdownToPlainText(note.markdownBody);
  }
  note.format=format;
  note.editorMode=format;
  note.updatedAt = new Date().toISOString();
  $("noteEditedMeta").textContent = `Edited ${formatNoteDate(note.updatedAt)}`;
  saveNotes(true, false);
}

function deleteCurrentNote() {
  if (!state.selectedNoteId) return;
  const note=state.personal.notes.find(item=>item.id===state.selectedNoteId);
  if(!note)return;
  const deletedAt=new Date().toISOString();
  state.personal.noteTombstones=(state.personal.noteTombstones||[]).filter(item=>item.id!==note.id);
  state.personal.noteTombstones.push({id:note.id,folderId:note.folderId||"notes-default",deletedAt,updatedAt:deletedAt});
  state.personal.notes = state.personal.notes.filter((item) => item.id !== note.id);
  state.selectedNoteId = state.personal.notes[0]?.id || null;
  $("notesBoard").classList.remove("editing-note");
  renderNotes();
  saveNotes(false, true);
}

function formatNoteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function sanitizeNoteHtml(value) {
  const container = document.createElement("div");
  container.innerHTML = String(value || "");
  container.querySelectorAll("script, style, iframe, object, embed, form, svg, math, template, link, meta, base").forEach((element) => element.remove());
  const allowedTags = new Set([
    "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
    "HR", "I", "LI", "OL", "P", "PRE", "S", "SPAN", "STRIKE", "STRONG", "TABLE", "TBODY", "TD",
    "TH", "THEAD", "TR", "U", "UL"
  ]);
  const allowedClasses = new Set([
    "checked", "markdown-task-list", "note-check-circle", "note-check-item",
    "markdown-align-left", "markdown-align-center", "markdown-align-right"
  ]);
  [...container.querySelectorAll("*")].forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    const href = element.tagName === "A" ? safeNoteHref(element.getAttribute("href")) : "";
    const classes = [...element.classList].filter((name) => allowedClasses.has(name));
    const nonEditable = element.tagName === "SPAN" && element.getAttribute("contenteditable") === "false";
    [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
    if (classes.length) element.className = classes.join(" ");
    if (nonEditable) element.setAttribute("contenteditable", "false");
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  });
  return container.innerHTML;
}

function safeNoteHref(value) {
  const href=String(value||"").trim();
  if(!href)return "";
  if(href.startsWith("#"))return href;
  try {
    const parsed=new URL(href,window.location.origin);
    return ["http:","https:","mailto:"].includes(parsed.protocol) ? href : "";
  } catch {
    return "";
  }
}

function markdownInline(value) {
  const tokens=[];
  const token=(html)=>{const index=tokens.push(html)-1;return `\uE000${index}\uE001`;};
  let source=String(value||"");
  source=source.replace(/(`+)([\s\S]*?)\1/g,(_,ticks,code)=>token(`<code>${escapeHtml(code)}</code>`));
  source=source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(match,label,href)=>{
    const safeHref=safeNoteHref(href);
    return safeHref ? token(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${markdownInline(label)}</a>`) : match;
  });
  source=source.replace(/\\([\\`*_[\]{}()#+\-.!|>~])/g,(_,character)=>token(escapeHtml(character)));
  let text=escapeHtml(source);
  text=text.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  text=text.replace(/__([^_]+)__/g,"<strong>$1</strong>");
  text=text.replace(/~~([^~]+)~~/g,"<s>$1</s>");
  text=text.replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>");
  text=text.replace(/(^|[^_])_([^_]+)_/g,"$1<em>$2</em>");
  return text.replace(/\uE000(\d+)\uE001/g,(_,index)=>tokens[Number(index)]||"");
}

function splitMarkdownTableRow(line) {
  let value=String(line||"").trim();
  if(value.startsWith("|"))value=value.slice(1);
  if(value.endsWith("|")&&!value.endsWith("\\|"))value=value.slice(0,-1);
  const cells=[];let cell="",ticks=0,escaped=false;
  for(const character of value) {
    if(escaped){cell+=`\\${character}`;escaped=false;continue;}
    if(character==="\\"){escaped=true;continue;}
    if(character==="`"){ticks=ticks?0:1;cell+=character;continue;}
    if(character==="|"&&!ticks){cells.push(cell.trim());cell="";continue;}
    cell+=character;
  }
  if(escaped)cell+="\\";
  cells.push(cell.trim());
  return cells;
}

function markdownTableDelimiter(line) {
  const cells=splitMarkdownTableRow(line);
  if(!cells.length||!cells.every(cell=>/^:?-{3,}:?$/.test(cell.trim())))return null;
  return cells.map(cell=>cell.startsWith(":")&&cell.endsWith(":")?"center":cell.endsWith(":")?"right":"left");
}

function markdownLineStartsBlock(lines,index) {
  const line=lines[index]||"";
  if(!line.trim())return true;
  if(/^```/.test(line)||/^(#{1,6})\s+/.test(line)||/^>\s?/.test(line)||/^([-*+]\s+|\d+[.)]\s+)/.test(line)||/^---+$/.test(line.trim()))return true;
  return index+1<lines.length && line.includes("|") && Boolean(markdownTableDelimiter(lines[index+1]));
}

function markdownToHtml(markdown) {
  const lines=String(markdown||"").replace(/\r/g,"").split("\n");
  let html="";
  for(let index=0;index<lines.length;) {
    const line=lines[index];
    if(!line.trim()){index+=1;continue;}
    if(/^```/.test(line)) {
      const code=[];index+=1;
      while(index<lines.length&&!/^```/.test(lines[index]))code.push(lines[index++]);
      if(index<lines.length)index+=1;
      html+=`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
      continue;
    }
    if(index+1<lines.length&&line.includes("|")) {
      const alignments=markdownTableDelimiter(lines[index+1]);
      if(alignments) {
        const headers=splitMarkdownTableRow(line);index+=2;const rows=[];
        while(index<lines.length&&lines[index].trim()&&lines[index].includes("|"))rows.push(splitMarkdownTableRow(lines[index++]));
        const cells=(values,tag)=>headers.map((_,cellIndex)=>`<${tag} class="markdown-align-${alignments[cellIndex]||"left"}">${markdownInline(values[cellIndex]||"")}</${tag}>`).join("");
        html+=`<table><thead><tr>${cells(headers,"th")}</tr></thead><tbody>${rows.map(row=>`<tr>${cells(row,"td")}</tr>`).join("")}</tbody></table>`;
        continue;
      }
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){const level=heading[1].length;html+=`<h${level}>${markdownInline(heading[2])}</h${level}>`;index+=1;continue;}
    if(/^---+$/.test(line.trim())){html+="<hr>";index+=1;continue;}
    if(/^>\s?/.test(line)) {
      const quote=[];
      while(index<lines.length&&/^>\s?/.test(lines[index]))quote.push(lines[index++].replace(/^>\s?/,""));
      html+=`<blockquote>${quote.map(markdownInline).join("<br>")}</blockquote>`;
      continue;
    }
    const task=line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    const bullet=line.match(/^[-*+]\s+(.+)$/);
    const ordered=line.match(/^\d+[.)]\s+(.+)$/);
    if(task||bullet||ordered) {
      const orderedList=Boolean(ordered),tag=orderedList?"ol":"ul",items=[];
      while(index<lines.length) {
        const current=lines[index];
        const currentTask=current.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
        const currentBullet=current.match(/^[-*+]\s+(.+)$/);
        const currentOrdered=current.match(/^\d+[.)]\s+(.+)$/);
        if(orderedList&&!currentOrdered)break;
        if(!orderedList&&!currentTask&&!currentBullet)break;
        if(currentTask)items.push(`<li class="${currentTask[1].trim()?"checked":""}"><span>${currentTask[1].trim()?"☑":"☐"}</span>${markdownInline(currentTask[2])}</li>`);
        else items.push(`<li>${markdownInline((currentOrdered||currentBullet)[1])}</li>`);
        index+=1;
      }
      html+=`<${tag}${!orderedList&&items.some(item=>item.includes("<span>☐")||item.includes("<span>☑"))?' class="markdown-task-list"':""}>${items.join("")}</${tag}>`;
      continue;
    }
    const paragraph=[line];index+=1;
    while(index<lines.length&&!markdownLineStartsBlock(lines,index))paragraph.push(lines[index++]);
    html+=`<p>${paragraph.map(markdownInline).join(" ")}</p>`;
  }
  return sanitizeNoteHtml(html);
}

function richHtmlToMarkdown(value) {
  const container=document.createElement("div");
  container.innerHTML=sanitizeNoteHtml(value);
  const render=(node,depth=0)=>{
    if(node.nodeType===Node.TEXT_NODE)return String(node.nodeValue||"").replace(/\u00a0/g," ");
    if(node.nodeType!==Node.ELEMENT_NODE)return "";
    const tag=node.tagName;
    const children=()=>[...node.childNodes].map(child=>render(child,depth)).join("");
    if(tag==="BR")return "\n";
    if(["B","STRONG"].includes(tag))return `**${children()}**`;
    if(["I","EM"].includes(tag))return `*${children()}*`;
    if(["S","STRIKE","DEL"].includes(tag))return `~~${children()}~~`;
    if(tag==="CODE"&&node.parentElement?.tagName!=="PRE")return `\`${children().replaceAll("`","\\`")}\``;
    if(tag==="PRE")return `\n\`\`\`\n${node.textContent||""}\n\`\`\`\n\n`;
    if(/^H[1-6]$/.test(tag))return `${"#".repeat(Number(tag.slice(1)))} ${children().trim()}\n\n`;
    if(tag==="P")return `${children().trim()}\n\n`;
    if(tag==="BLOCKQUOTE")return `${children().trim().split("\n").map(line=>`> ${line}`).join("\n")}\n\n`;
    if(tag==="HR")return "---\n\n";
    if(tag==="A") {
      const href=safeNoteHref(node.getAttribute("href"));
      return href?`[${children()}](${href})`:children();
    }
    if(tag==="DIV"&&node.classList.contains("note-check-item")) {
      const checked=node.querySelector(".note-check-circle")?.textContent==="●";
      const text=[...node.childNodes].filter(child=>!(child.nodeType===Node.ELEMENT_NODE&&child.classList?.contains("note-check-circle"))).map(child=>render(child,depth)).join("").trim();
      return `- [${checked?"x":" "}] ${text}\n`;
    }
    if(tag==="UL"||tag==="OL") {
      const ordered=tag==="OL";
      return [...node.children].filter(child=>child.tagName==="LI").map((item,itemIndex)=>{
        const prefix=ordered?`${itemIndex+1}. `:"- ";
        return `${"  ".repeat(depth)}${prefix}${[...item.childNodes].map(child=>render(child,depth+1)).join("").trim()}`;
      }).join("\n")+"\n\n";
    }
    if(tag==="LI")return children();
    if(tag==="TABLE") {
      const rows=[...node.querySelectorAll("tr")].map(row=>[...row.children].filter(cell=>["TH","TD"].includes(cell.tagName)).map(cell=>(cell.textContent||"").trim().replaceAll("|","\\|")));
      if(!rows.length)return "";
      const width=Math.max(...rows.map(row=>row.length));
      const normalized=rows.map(row=>Array.from({length:width},(_,index)=>row[index]||""));
      return `| ${normalized[0].join(" | ")} |\n| ${Array(width).fill("---").join(" | ")} |\n${normalized.slice(1).map(row=>`| ${row.join(" | ")} |`).join("\n")}\n\n`;
    }
    if(tag==="DIV")return `${children().trim()}\n`;
    return children();
  };
  return [...container.childNodes].map(node=>render(node)).join("").replace(/\n{3,}/g,"\n\n").trim();
}

function ensureNoteFolders() {
  state.personal.notesFolders ||= [];
  state.personal.noteTombstones ||= [];
  state.personal.noteFolderTombstones ||= [];
  if(!state.personal.notesFolders.some(folder=>folder.id==="notes-default")) {
    const createdAt=new Date().toISOString();
    state.personal.notesFolders.unshift({id:"notes-default",name:"Notes",createdAt,updatedAt:createdAt});
  }
  (state.personal.notes||[]).forEach(note=>{note.folderId ||= "notes-default";normalizeNote(note);});
}

function activeNoteFolders() {
  const deletedIds=new Set((state.personal.noteFolderTombstones||[]).map(item=>item.id));
  return (state.personal.notesFolders||[]).filter(folder=>!folder.deletedAt&&!deletedIds.has(folder.id));
}

function selectedNotesFolderName() {
  if(state.selectedNoteFolderId==="all") return "All iCloud";
  return activeNoteFolders().find(folder=>folder.id===state.selectedNoteFolderId)?.name||"Notes";
}

function createNotesFolder() {
  const name=window.prompt("New folder name"); if(!name?.trim())return;
  const createdAt=new Date().toISOString();
  const folder={id:`notes-folder-${Date.now()}`,name:name.trim(),createdAt,updatedAt:createdAt};
  state.personal.notesFolders.push(folder);state.selectedNoteFolderId=folder.id;saveNotes(false,true);renderNotes();
}

function deleteNotesFolder(id) {
  if(id==="notes-default")return;
  const folder=state.personal.notesFolders.find(item=>item.id===id);if(!folder)return;
  const deletedAt=new Date().toISOString();
  state.personal.notes.forEach(note=>{if(note.folderId===id){note.folderId="notes-default";note.updatedAt=deletedAt;}});
  state.personal.noteFolderTombstones=(state.personal.noteFolderTombstones||[]).filter(item=>item.id!==id);
  state.personal.noteFolderTombstones.push({id,name:folder.name||"",deletedAt,updatedAt:deletedAt});
  state.personal.notesFolders=state.personal.notesFolders.filter(folder=>folder.id!==id);
  if(state.selectedNoteFolderId===id)state.selectedNoteFolderId="all";
  saveNotes(false,true);renderNotes();
}

function renameNotesFolder(id) {
  const folder=state.personal.notesFolders.find(item=>item.id===id);if(!folder)return;
  const name=window.prompt("Rename folder",folder.name);if(!name?.trim())return;
  folder.name=name.trim();folder.updatedAt=new Date().toISOString();saveNotes(false,true);renderNotes();
}

function setNoteEditorMode(mode) {
  const note=state.personal.notes.find(item=>item.id===state.selectedNoteId);if(!note)return;
  const currentFormat=noteCanonicalFormat(note);
  if(mode==="preview") {
    state.noteEditorMode="preview";
    renderNoteEditorMode(note);
    return;
  }
  if(mode!==currentFormat) {
    syncCurrentNoteEditor(note);
    if(mode==="markdown") {
      note.markdownBody=richHtmlToMarkdown(note.contentHtml||escapeHtml(note.body||"").replaceAll("\n","<br>"));
      note.contentHtml="";
      note.body=markdownToPlainText(note.markdownBody);
    } else {
      note.contentHtml=markdownToHtml(note.markdownBody||"");
      note.markdownBody="";
      note.body=notePlainTextFromHtml(note.contentHtml);
    }
    note.format=mode;
    note.editorMode=mode;
    note.updatedAt=new Date().toISOString();
    state.noteEditorMode=mode;
    renderNoteEditorMode(note);
    saveNotes(false,false);
    return;
  }
  state.noteEditorMode=mode;
  renderNoteEditorMode(note);
}

function renderNoteEditorMode(note) {
  const format=noteCanonicalFormat(note);
  const mode=state.noteEditorMode==="preview"?"preview":format;
  $("noteRichModeButton").classList.toggle("active",mode==="rich");
  $("noteMarkdownModeButton").classList.toggle("active",mode==="markdown");
  $("notePreviewModeButton").classList.toggle("active",mode==="preview");
  $("noteBodyInput").classList.toggle("hidden",mode!=="rich");
  $("noteMarkdownInput").classList.toggle("hidden",mode!=="markdown");
  $("noteMarkdownPreview").classList.toggle("hidden",mode!=="preview");
  document.querySelector(".notes-format-toolbar")?.classList.toggle("hidden",mode!=="rich");
  $("noteMarkdownInput").value=note.markdownBody||"";
  if(mode==="rich")$("noteBodyInput").innerHTML=sanitizeNoteHtml(note.contentHtml||escapeHtml(note.body||"").replaceAll("\n","<br>"));
  if(mode==="preview")$("noteMarkdownPreview").innerHTML=format==="markdown"?markdownToHtml(note.markdownBody||""):sanitizeNoteHtml(note.contentHtml||"");
}

function toggleCurrentNotePin() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  saveNotes(false, true);
}

function rememberNoteSelection() {
  const selection = window.getSelection();
  const editor = $("noteBodyInput");
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
  state.noteSelectionRange = selection.getRangeAt(0).cloneRange();
}

function restoreNoteSelection() {
  if (!state.noteSelectionRange) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(state.noteSelectionRange);
}

function runNoteCommand(command, value = null) {
  $("noteBodyInput").focus();
  restoreNoteSelection();
  document.execCommand(command, false, value);
  updateCurrentNoteDraft();
  rememberNoteSelection();
}

function insertNoteChecklist() {
  $("noteBodyInput").focus();
  document.execCommand(
    "insertHTML",
    false,
    `<div class="note-check-item"><span class="note-check-circle" contenteditable="false">○</span><span>&nbsp;</span></div>`
  );
  updateCurrentNoteDraft();
}

function addNoteLink() {
  rememberNoteSelection();
  const url = window.prompt("Enter a link");
  if (!url) return;
  const safeUrl = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
  runNoteCommand("createLink", safeUrl);
}

function renderNotes() {
  if (!$("notesList") || !state.personal) return;
  ensureNoteFolders();
  const deletedNoteIds=new Set((state.personal.noteTombstones||[]).map(item=>item.id));
  const allNotes = (state.personal.notes || []).filter(note=>!note.deletedAt&&!deletedNoteIds.has(note.id));
  const query = state.notesSearch.trim().toLowerCase();
  const notes = [...allNotes]
    .filter(note=>state.selectedNoteFolderId==="all"||note.folderId===state.selectedNoteFolderId)
    .filter((note) => !query || `${note.title || ""} ${note.body || ""}`.toLowerCase().includes(query))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (state.selectedNoteId && !notes.some((note) => note.id === state.selectedNoteId)) {
    state.selectedNoteId = notes[0]?.id || null;
  }
  $("notesList").innerHTML = notes.length ? notes.map((note) => `
    <button class="note-list-item ${note.id === state.selectedNoteId ? "active" : ""}" type="button" data-note-id="${escapeHtml(note.id)}">
      <strong>${note.pinned ? `<span class="note-pin" aria-label="Pinned">●</span>` : ""}${escapeHtml(note.title || "New Note")}</strong>
      <span>${escapeHtml(new Date(note.updatedAt || note.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }))}</span>
      <p>${escapeHtml((note.body || "No additional text").replace(/\s+/g, " ").slice(0, 110))}</p>
    </button>
  `).join("") : `<div class="notes-empty">${query ? "No matching notes." : "No notes yet."}</div>`;
  $("notesCurrentFolderTitle").textContent=selectedNotesFolderName();
  const folderRows=[{id:"all",name:"All iCloud",system:true},...activeNoteFolders()];
  $("notesFolderList").innerHTML=folderRows.map(folder=>{const count=folder.id==="all"?allNotes.length:allNotes.filter(note=>note.folderId===folder.id).length;return `<article class="${state.selectedNoteFolderId===folder.id?"active":""}"><button type="button" data-select-notes-folder="${escapeHtml(folder.id)}"><span>📁</span><strong>${escapeHtml(folder.name)}</strong><b>${count}</b></button>${folder.id!=="all"&&folder.id!=="notes-default"?`<div><button data-rename-notes-folder="${escapeHtml(folder.id)}" aria-label="Rename folder">✎</button><button data-delete-notes-folder="${escapeHtml(folder.id)}" aria-label="Delete folder">×</button></div>`:""}</article>`;}).join("");

  const selected = allNotes.find((note) => note.id === state.selectedNoteId);
  $("noteEmptyState").classList.toggle("hidden", Boolean(selected));
  $("noteEditorFields").classList.toggle("hidden", !selected);
  $("saveNoteButton").disabled = !selected;
  $("deleteNoteButton").disabled = !selected;
  $("pinNoteButton").disabled = !selected;
  $("pinNoteButton").classList.toggle("active", Boolean(selected?.pinned));
  $("pinNoteButton").title = selected?.pinned ? "Unpin note" : "Pin note";
  if (selected) {
    $("noteTitleInput").value = selected.title || "";
    $("noteEditedMeta").textContent = `Edited ${formatNoteDate(selected.updatedAt || selected.createdAt)}`;
    state.noteEditorMode=noteCanonicalFormat(selected);
    renderNoteEditorMode(selected);
    $("noteFolderSelect").innerHTML=activeNoteFolders().map(folder=>`<option value="${escapeHtml(folder.id)}" ${selected.folderId===folder.id?"selected":""}>${escapeHtml(folder.name)}</option>`).join("");
  }
  document.querySelectorAll("[data-select-notes-folder]").forEach(button=>button.addEventListener("click",()=>{state.selectedNoteFolderId=button.dataset.selectNotesFolder;state.selectedNoteId=null;$("notesBoard").classList.remove("show-folders");renderNotes();}));
  document.querySelectorAll("[data-rename-notes-folder]").forEach(button=>button.addEventListener("click",()=>renameNotesFolder(button.dataset.renameNotesFolder)));
  document.querySelectorAll("[data-delete-notes-folder]").forEach(button=>button.addEventListener("click",()=>deleteNotesFolder(button.dataset.deleteNotesFolder)));
  document.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNoteId = button.dataset.noteId;
      state.noteSelectionRange = null;
      renderNotes();
      $("notesBoard").classList.add("editing-note");
    });
  });
}

async function refreshNotesAcrossDevices() {
  if(
    !state.personal
    || state.notesOfflineSavePending
    || state.notesDirtyGeneration
    || state.noteSaveTimer
    || state.noteSavesInFlight
  )return;
  const active=document.activeElement;
  if(active===$("noteTitleInput")||active===$("noteBodyInput")||active===$("noteMarkdownInput"))return;
  const refreshGeneration=++state.notesRefreshGeneration;
  const saveGeneration=state.noteSaveGeneration;
  try {
    const remote=await getJson(`/api/notes?notesSync=${Date.now()}`);
    if(
      refreshGeneration!==state.notesRefreshGeneration
      || saveGeneration!==state.noteSaveGeneration
      || state.notesDirtyGeneration
      || state.noteSaveTimer
      || state.noteSavesInFlight
    )return;
    ["notes","notesFolders","noteTombstones","noteFolderTombstones"].forEach(field=>{
      if(Array.isArray(remote[field]))state.personal[field]=remote[field];
    });
    localStorage.setItem("kumarPersonalOffline",JSON.stringify(state.personal));
    if(state.activeView==="notes")renderNotes();
  } catch {}
}

function nextRecurringValue(value, recurrence) {
  if (!value || recurrence === "none") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (recurrence === "daily") date.setDate(date.getDate() + 1);
  if (recurrence === "weekly") date.setDate(date.getDate() + 7);
  if (recurrence === "monthly") date.setMonth(date.getMonth() + 1);
  if (recurrence === "yearly") date.setFullYear(date.getFullYear() + 1);
  return String(value).length === 10 ? localIsoDate(date) : dateTimeInputValue(date);
}

function removePersonalItem(collection, id) {
  state.personal[collection] = (state.personal[collection] || []).filter((item) => item.id !== id);
  savePersonal(false);
}

function addTask(event) {
  event.preventDefault();
  const title = $("taskTitleInput").value.trim();
  if (!title) return;
  state.personal.tasks.unshift({
    id: `task-${Date.now()}`,
    title,
    due: $("taskDueInput").value,
    dueUtc: $("taskDueInput").value ? new Date($("taskDueInput").value).toISOString() : null,
    priority: $("taskPriorityInput").value,
    recurrence: $("taskRecurrenceInput").value,
    reminderMinutes: Number($("taskReminderInput").value || 0),
    project: $("taskProjectInput").value.trim(),
    notes: $("taskNotesInput").value.trim(),
    completed: false,
    createdAt: new Date().toISOString()
  });
  $("taskForm").reset();
  $("taskPriorityInput").value = "normal";
  $("taskRecurrenceInput").value = "none";
  savePersonal(false);
}

function toggleTask(id) {
  const task = state.personal.tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  if (task.completed && task.recurrence && task.recurrence !== "none" && task.due) {
    const nextDue = nextRecurringValue(task.due, task.recurrence);
    state.personal.tasks.unshift({
      ...task,
      id: `task-${Date.now()}`,
      due: nextDue,
      dueUtc: nextDue ? new Date(nextDue).toISOString() : null,
      completed: false,
      completedAt: null,
      lastNotifiedFor: null,
      createdAt: new Date().toISOString()
    });
  }
  savePersonal(false);
}

function updateTaskPriority(id, priority) {
  const task = state.personal.tasks.find((item) => item.id === id);
  if (!task) return;
  task.priority = priority;
  task.updatedAt = new Date().toISOString();
  savePersonal(false);
}

function addGoal(event) {
  event.preventDefault();
  const title = $("goalTitleInput").value.trim();
  if (!title) return;
  state.personal.goals.unshift({
    id: `goal-${Date.now()}`,
    title,
    horizon: $("goalHorizonInput").value,
    targetDate: $("goalTargetDateInput").value,
    why: $("goalWhyInput").value.trim(),
    progress: 0,
    createdAt: new Date().toISOString()
  });
  $("goalForm").reset();
  savePersonal(false);
}

function updateGoalProgress(id, value) {
  const goal = state.personal.goals.find((item) => item.id === id);
  if (!goal) return;
  goal.progress = Math.min(100, Math.max(0, Number(value || 0)));
  goal.completedAt = goal.progress >= 100 ? (goal.completedAt || new Date().toISOString()) : null;
  savePersonal(true, false);
  renderLife();
}

function addHabit(event) {
  event.preventDefault();
  const title = $("habitTitleInput").value.trim();
  if (!title) return;
  state.personal.habits.unshift({
    id: `habit-${Date.now()}`,
    title,
    frequency: $("habitFrequencyInput").value,
    reminderTime: $("habitReminderTimeInput").value,
    completions: [],
    createdAt: new Date().toISOString()
  });
  $("habitForm").reset();
  savePersonal(false);
}

function toggleHabit(id, date = localIsoDate()) {
  const habit = state.personal.habits.find((item) => item.id === id);
  if (!habit) return;
  habit.completions ||= [];
  habit.completions = habit.completions.includes(date)
    ? habit.completions.filter((item) => item !== date)
    : [...habit.completions, date].slice(-730);
  savePersonal(false);
}

function saveWeeklyReview(event) {
  event.preventDefault();
  const end = localIsoDate();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 6);
  const start = localIsoDate(startDate);
  const review = {
    id: `review-${Date.now()}`,
    weekStart: start,
    weekEnd: end,
    text: $("weeklyReviewTextInput").value.trim(),
    rating: Number($("weeklyReviewRatingInput").value || 3),
    createdAt: new Date().toISOString()
  };
  state.personal.weeklyReviews.unshift(review);
  $("weeklyReviewForm").reset();
  $("weeklyReviewRatingInput").value = "3";
  savePersonal(false);
}

function habitStreak(habit) {
  const completed = new Set(habit.completions || []);
  let cursor = new Date();
  if (!completed.has(localIsoDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (completed.has(localIsoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function habitScheduledToday(habit, date = new Date()) {
  if (habit.frequency === "weekdays" && [0, 6].includes(date.getDay())) return false;
  if (habit.frequency === "weekly3") {
    const weekStart = new Date(date);
    const dayOffset = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - dayOffset);
    const completionsThisWeek = (habit.completions || []).filter((value) => value >= localIsoDate(weekStart) && value <= localIsoDate(date)).length;
    return completionsThisWeek < 3;
  }
  return true;
}

function saveHealthLog(event) {
  event.preventDefault();
  const date = $("healthDateInput").value || localIsoDate();
  const existing = state.personal.healthLogs.find((item) => item.date === date);
  const log = {
    ...(existing || {}),
    id: existing?.id || `health-${Date.now()}`,
    date,
    sleep: Number($("healthSleepInput").value || 0),
    steps: Number($("healthStepsInput").value || 0),
    water: Number($("healthWaterInput").value || 0),
    weight: Number($("healthWeightInput").value || 0),
    mood: Number($("healthMoodInput").value || 0),
    energy: Number($("healthEnergyInput").value || 0),
    workout: $("healthWorkoutInput").value.trim(),
    meals: $("healthMealsInput").value.trim(),
    screenTime: Number($("healthScreenTimeInput").value || 0),
    medication: $("healthMedicationInput").value.trim(),
    updatedAt: new Date().toISOString()
  };
  state.personal.healthLogs = existing
    ? state.personal.healthLogs.map((item) => item.id === existing.id ? log : item)
    : [log, ...state.personal.healthLogs];
  $("healthForm").reset();
  $("healthDateInput").value = localIsoDate();
  savePersonal(false);
}

function addCareerItem(event) {
  event.preventDefault();
  const title = $("careerTitleInput").value.trim();
  if (!title) return;
  state.personal.careerItems.unshift({
    id: `career-${Date.now()}`,
    type: $("careerTypeInput").value,
    title,
    status: $("careerStatusInput").value,
    dueDate: $("careerDueInput").value,
    link: $("careerLinkInput").value.trim(),
    notes: $("careerNotesInput").value.trim(),
    createdAt: new Date().toISOString()
  });
  $("careerForm").reset();
  savePersonal(false);
}

function updateCareerStatus(id, status) {
  const item = state.personal.careerItems.find((entry) => entry.id === id);
  if (!item) return;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  savePersonal(false);
}

function addDocumentRecord(event) {
  event.preventDefault();
  const title = $("documentTitleInput").value.trim();
  if (!title) return;
  state.personal.documents.unshift({
    id: `document-${Date.now()}`,
    type: $("documentTypeInput").value,
    title,
    expiryDate: $("documentExpiryInput").value,
    link: $("documentLinkInput").value.trim(),
    notes: $("documentNotesInput").value.trim(),
    createdAt: new Date().toISOString()
  });
  $("documentForm").reset();
  savePersonal(false);
}

function setLifePanel(panel) {
  state.activeLifePanel = panel;
  document.querySelectorAll("[data-life-panel]").forEach((button) => button.classList.toggle("active", button.dataset.lifePanel === panel));
  ["tasks", "goals", "health", "career", "vault"].forEach((name) => {
    $(`life${name.charAt(0).toUpperCase()}${name.slice(1)}Panel`).classList.toggle("active", name === panel);
  });
}

function renderLife() {
  if (!$("lifeSummary") || !state.personal) return;
  ensurePersonalCollections();
  const today = localIsoDate();
  const openTasks = state.personal.tasks.filter((task) => !task.completed);
  const urgentTasks = openTasks.filter((task) => task.priority === "urgent");
  const overdueTasks = openTasks.filter((task) => task.due && String(task.due).slice(0, 10) < today);
  const habitsDueToday = state.personal.habits.filter((habit) => habitScheduledToday(habit));
  const habitsDone = habitsDueToday.filter((habit) => (habit.completions || []).includes(today)).length;
  const expiringDocuments = state.personal.documents.filter((document) => {
    const days = daysBetweenDates(today, document.expiryDate);
    return days !== null && days >= 0 && days <= 30;
  });
  $("lifeSummary").innerHTML = `
    <button type="button" data-summary-panel="tasks"><strong>${openTasks.length}</strong><span>Open tasks</span></button>
    <button type="button" data-summary-panel="tasks" class="${urgentTasks.length ? "urgent" : ""}"><strong>${urgentTasks.length}</strong><span>Urgent</span></button>
    <button type="button" data-summary-panel="tasks" class="${overdueTasks.length ? "warning" : ""}"><strong>${overdueTasks.length}</strong><span>Overdue</span></button>
    <button type="button" data-summary-panel="goals"><strong>${habitsDone}/${habitsDueToday.length}</strong><span>Habits today</span></button>
    <button type="button" data-summary-panel="vault"><strong>${expiringDocuments.length}</strong><span>Expiring soon</span></button>
  `;
  document.querySelectorAll("[data-summary-panel]").forEach((button) => button.addEventListener("click", () => setLifePanel(button.dataset.summaryPanel)));

  const filter = $("taskFilterInput").value;
  const filteredTasks = openTasks.concat(filter === "all" ? state.personal.tasks.filter((task) => task.completed) : [])
    .filter((task) => filter !== "today" || String(task.due || "").slice(0, 10) === today)
    .filter((task) => filter !== "urgent" || task.priority === "urgent")
    .sort((a, b) => Number(a.completed) - Number(b.completed)
      || ({ urgent: 0, high: 1, normal: 2 }[a.priority] ?? 2) - ({ urgent: 0, high: 1, normal: 2 }[b.priority] ?? 2)
      || String(a.due || "9999").localeCompare(String(b.due || "9999")));
  $("taskList").innerHTML = filteredTasks.length ? filteredTasks.map((task) => {
    const overdue = !task.completed && task.due && String(task.due).slice(0, 10) < today;
    return `
      <article class="task-row priority-${escapeHtml(task.priority || "normal")} ${task.completed ? "completed" : ""} ${overdue ? "overdue" : ""}">
        <button type="button" class="task-check" data-toggle-task="${escapeHtml(task.id)}">${task.completed ? "✓" : ""}</button>
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${task.due ? escapeHtml(formatLocalDateTime(task.due)) : "No due date"}${task.project ? ` · ${escapeHtml(task.project)}` : ""}</span>
          ${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ""}
        </div>
        <select class="task-priority-select" data-task-priority="${escapeHtml(task.id)}">
          ${["normal", "high", "urgent"].map((priority) => `<option value="${priority}" ${task.priority === priority ? "selected" : ""}>${priority}</option>`).join("")}
        </select>
        <button type="button" class="record-delete" data-remove-task="${escapeHtml(task.id)}">×</button>
      </article>
    `;
  }).join("") : `<p class="muted-copy">Nothing here. Your attention is clear.</p>`;

  $("goalList").innerHTML = state.personal.goals.length ? state.personal.goals.map((goal) => `
    <div class="progress-record">
      <div><strong>${escapeHtml(goal.title)}</strong><span>${escapeHtml(goal.horizon)} · ${escapeHtml(formatShortDate(goal.targetDate))}</span></div>
      <b>${Number(goal.progress || 0)}%</b>
      <input type="range" min="0" max="100" value="${Number(goal.progress || 0)}" data-goal-progress="${escapeHtml(goal.id)}">
      <button type="button" class="record-delete" data-remove-goal="${escapeHtml(goal.id)}">×</button>
    </div>
  `).join("") : `<p class="muted-copy">Add the outcomes you are working toward.</p>`;
  $("habitList").innerHTML = state.personal.habits.length ? state.personal.habits.map((habit) => {
    const done = (habit.completions || []).includes(today);
    return `
      <div class="habit-row ${done ? "done" : ""}">
        <button type="button" data-toggle-habit="${escapeHtml(habit.id)}">${done ? "✓" : ""}</button>
        <div><strong>${escapeHtml(habit.title)}</strong><span>${escapeHtml(habit.frequency)}${habit.reminderTime ? ` · ${escapeHtml(habit.reminderTime)}` : ""}</span></div>
        <b>${habitStreak(habit)} day streak</b>
        <button type="button" class="record-delete" data-remove-habit="${escapeHtml(habit.id)}">×</button>
      </div>
    `;
  }).join("") : `<p class="muted-copy">Add a small behavior worth repeating.</p>`;

  const weekStartDate = new Date();
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = localIsoDate(weekStartDate);
  const completedThisWeek = state.personal.tasks.filter((task) => task.completedAt && localIsoDate(new Date(task.completedAt)) >= weekStart).length;
  const focusThisWeek = focusMinutesBetween(weekStart, today);
  const spendThisWeek = state.personal.expenses.filter((expense) => expense.date >= weekStart && expense.date <= today).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const habitChecksThisWeek = state.personal.habits.reduce((sum, habit) => sum + (habit.completions || []).filter((date) => date >= weekStart && date <= today).length, 0);
  $("weeklyReviewSummary").innerHTML = `
    <span><strong>${completedThisWeek}</strong> tasks completed</span>
    <span><strong>${focusThisWeek}</strong> focus min</span>
    <span><strong>${habitChecksThisWeek}</strong> habit checks</span>
    <span><strong>${escapeHtml(formatMoney(spendThisWeek))}</strong> spent</span>
  `;
  $("weeklyReviewList").innerHTML = state.personal.weeklyReviews.slice(0, 4).map((review) => `
    <div class="compact-record"><div><strong>${review.rating}/5 · ${escapeHtml(formatShortDate(review.weekEnd))}</strong><span>${escapeHtml(review.text || "No written reflection")}</span></div><button class="record-delete" type="button" data-remove-review="${escapeHtml(review.id)}">×</button></div>
  `).join("");

  const healthLogs = [...state.personal.healthLogs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latestHealth = healthLogs[0];
  const lastSevenHealth = healthLogs.filter((log) => daysBetweenDates(log.date, today) >= 0 && daysBetweenDates(log.date, today) <= 6);
  const avgSleep = lastSevenHealth.length ? lastSevenHealth.reduce((sum, log) => sum + Number(log.sleep || 0), 0) / lastSevenHealth.length : 0;
  const avgSteps = lastSevenHealth.length ? Math.round(lastSevenHealth.reduce((sum, log) => sum + Number(log.steps || 0), 0) / lastSevenHealth.length) : 0;
  $("healthSummary").innerHTML = `
    <div><strong>${avgSleep.toFixed(1)}</strong><span>Avg sleep · 7 logs</span></div>
    <div><strong>${avgSteps.toLocaleString("en-IN")}</strong><span>Avg steps</span></div>
    <div><strong>${latestHealth?.water || 0}L</strong><span>Latest water</span></div>
    <div><strong>${latestHealth?.mood || "—"}/5</strong><span>Latest mood</span></div>
  `;
  $("healthLogList").innerHTML = healthLogs.slice(0, 10).map((log) => `
    <div class="compact-record">
      <div><strong>${escapeHtml(formatShortDate(log.date))}</strong><span>${log.sleep || 0}h sleep · ${Number(log.steps || 0).toLocaleString("en-IN")} steps${log.screenTime ? ` · ${log.screenTime}h screen` : ""}${log.workout ? ` · ${escapeHtml(log.workout)}` : ""}${log.meals ? ` · ${escapeHtml(log.meals)}` : ""}</span></div>
      <button type="button" class="record-delete" data-remove-health="${escapeHtml(log.id)}">×</button>
    </div>
  `).join("") || `<p class="muted-copy">Your check-ins will appear here.</p>`;

  const careerItems = [...state.personal.careerItems].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
  $("careerList").innerHTML = careerItems.length ? careerItems.map((item) => `
    <article class="career-row">
      <span>${escapeHtml(item.type)}</span>
      <div><strong>${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</strong><p>${escapeHtml(item.notes || formatShortDate(item.dueDate))}</p></div>
      <select data-career-status="${escapeHtml(item.id)}">${["Planned", "In progress", "Waiting", "Done"].map((status) => `<option ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
      <button type="button" class="record-delete" data-remove-career="${escapeHtml(item.id)}">×</button>
    </article>
  `).join("") : `<p class="muted-copy">Track applications, interviews, courses and reading here.</p>`;

  const documents = [...state.personal.documents].sort((a, b) => String(a.expiryDate || "9999").localeCompare(String(b.expiryDate || "9999")));
  $("documentList").innerHTML = documents.length ? documents.map((document) => {
    const days = daysBetweenDates(today, document.expiryDate);
    const urgent = days !== null && days <= 30;
    return `
      <article class="document-row ${urgent ? "expiring" : ""}">
        <span>${escapeHtml(document.type)}</span>
        <div><strong>${document.link ? `<a href="${escapeHtml(document.link)}" target="_blank" rel="noreferrer">${escapeHtml(document.title)}</a>` : escapeHtml(document.title)}</strong><p>${document.expiryDate ? `${days < 0 ? "Expired" : `Expires in ${days} days`} · ${escapeHtml(formatShortDate(document.expiryDate))}` : escapeHtml(document.notes || "No expiry")}</p></div>
        <button type="button" class="record-delete" data-remove-document="${escapeHtml(document.id)}">×</button>
      </article>
    `;
  }).join("") : `<p class="muted-copy">Store safe references and expiry dates here.</p>`;

  document.querySelectorAll("[data-toggle-task]").forEach((button) => button.addEventListener("click", () => toggleTask(button.dataset.toggleTask)));
  document.querySelectorAll("[data-task-priority]").forEach((select) => select.addEventListener("change", () => updateTaskPriority(select.dataset.taskPriority, select.value)));
  document.querySelectorAll("[data-toggle-habit]").forEach((button) => button.addEventListener("click", () => toggleHabit(button.dataset.toggleHabit)));
  document.querySelectorAll("[data-goal-progress]").forEach((input) => input.addEventListener("change", () => updateGoalProgress(input.dataset.goalProgress, input.value)));
  document.querySelectorAll("[data-career-status]").forEach((select) => select.addEventListener("change", () => updateCareerStatus(select.dataset.careerStatus, select.value)));
  [["task", "tasks"], ["goal", "goals"], ["habit", "habits"], ["review", "weeklyReviews"], ["health", "healthLogs"], ["career", "careerItems"], ["document", "documents"]].forEach(([name, collection]) => {
    document.querySelectorAll(`[data-remove-${name}]`).forEach((button) => button.addEventListener("click", () => removePersonalItem(collection, button.dataset[`remove${name.charAt(0).toUpperCase()}${name.slice(1)}`])));
  });
  setLifePanel(state.activeLifePanel);
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function loadReminderStatus() {
  if (!$("reminderStatus")) return;
  try {
    state.reminderConfig = await getJson("/api/push/config");
  } catch {
    state.reminderConfig = { configured: false };
  }
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const ready = state.reminderConfig.configured && permission === "granted";
  let diagnostics=null;
  if(ready){try{diagnostics=await getJson("/api/push/diagnostics");}catch{}}
  $("enableRemindersButton").textContent = ready ? "Send test" : "Enable reminders";
  $("reminderStatus").className = `reminder-status ${ready ? "ready" : ""}`;
  const nextReminder=diagnostics?.nextCalendarReminders?.[0];
  $("reminderStatus").innerHTML = ready
    ? `<strong>${diagnostics?.subscriptionCount ? "Reminders are on" : "Reconnect this device"}</strong><span>${nextReminder?`Next: ${escapeHtml(nextReminder.title)} · ${escapeHtml(formatLocalDateTime(nextReminder.reminderAt))}`:"Calendar work, quant practice, skin care, workouts, and contests can reach this device while the app is closed."}${diagnostics?.scheduler&&!diagnostics.scheduler.ok?` · Scheduler error: ${escapeHtml(diagnostics.scheduler.error||"unknown")}`:""}</span>`
    : `<strong>${installed ? "Turn on notifications" : "Install on your Home Screen first"}</strong><span>${escapeHtml(state.reminderConfig.message || "Tap Enable reminders after opening the installed app.")}</span>`;
}

async function enableReminders() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    $("reminderStatus").innerHTML = `<strong>Notifications unavailable</strong><span>Use the Home Screen app on iOS 16.4 or later.</span>`;
    return;
  }
  const config = state.reminderConfig || await getJson("/api/push/config");
  if (!config.configured || !config.publicKey) {
    $("reminderStatus").innerHTML = `<strong>Server setup needed</strong><span>${escapeHtml(config.message || "Push credentials are not configured.")}</span>`;
    return;
  }
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    await loadReminderStatus();
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
  }
  // Always refresh the server copy and recreate the minute schedule. Browser
  // subscriptions can outlive a deployment or server-side storage reset.
  await postJson("/api/push/subscribe", { subscription: subscription.toJSON() });
  await postJson("/api/push/test", {});
  await loadReminderStatus();
}

function formatFocusClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function selectedSpendMonth() {
  return state.spendMonth || localIsoDate().slice(0, 7);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number(value) % 1 ? 2 : 0
  }).format(Number(value || 0));
}

function sessionDate(session) {
  const value = session.completedAt || session.startedAt;
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : localIsoDate(date);
}

function focusMinutesBetween(startDate, endDate) {
  return (state.personal?.focusSessions || [])
    .filter((session) => {
      const date = sessionDate(session);
      return date >= startDate && date <= endDate;
    })
    .reduce((sum, session) => sum + Number(session.minutes || 0), 0);
}

function renderFocusTimer() {
  const display = $("focusTimerDisplay");
  if (display) {
    display.textContent = formatFocusClock(state.focusRemainingSeconds);
    display.classList.toggle("running", state.focusRunning);
    $("focusStartButton").textContent = state.focusRunning ? "Pause" : (state.focusRemainingSeconds < state.focusMinutes * 60 ? "Resume" : "Start focus");
  }
  if ($("focusHubClock")) {
    $("focusHubClock").textContent = formatFocusClock(state.focusRemainingSeconds);
    $("focusHubClock").classList.toggle("running", state.focusRunning);
    $("focusHubStartButton").textContent = state.focusRunning ? "Pause" : (state.focusRemainingSeconds < state.focusMinutes * 60 ? "Resume" : "Start focus");
  }
  document.querySelectorAll("[data-focus-minutes]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.focusMinutes) === state.focusMinutes);
    button.disabled = state.focusRunning;
  });
  document.querySelectorAll("[data-focus-hub-minutes]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.focusHubMinutes) === state.focusMinutes);
    button.disabled = state.focusRunning;
  });
}

function saveFocusTimerState() {
  localStorage.setItem("kumarFocusTimer", JSON.stringify({
    minutes: state.focusMinutes,
    remainingSeconds: state.focusRemainingSeconds,
    running: state.focusRunning,
    startedAt: state.focusStartedAt,
    label: $("focusHubLabelInput")?.value || $("focusLabelInput")?.value || ""
  }));
}

function restoreFocusTimerState() {
  try {
    const saved = JSON.parse(localStorage.getItem("kumarFocusTimer") || "null");
    if (!saved) return;
    state.focusMinutes = Number(saved.minutes || 25);
    state.focusRemainingSeconds = Number(saved.remainingSeconds || state.focusMinutes * 60);
    state.focusRunning = Boolean(saved.running);
    state.focusStartedAt = Number(saved.startedAt) || null;
    if ($("focusLabelInput")) $("focusLabelInput").value = saved.label || "";
    if ($("focusHubLabelInput")) $("focusHubLabelInput").value = saved.label || "";
    if (state.focusRunning) {
      tickFocusTimer();
      if (state.focusRunning) state.focusTimer = setInterval(tickFocusTimer, 1000);
    }
  } catch {
    localStorage.removeItem("kumarFocusTimer");
  }
}

function tickFocusTimer() {
  if (!state.focusRunning || !state.focusStartedAt) return;
  const elapsed = Math.floor((Date.now() - state.focusStartedAt) / 1000);
  state.focusRemainingSeconds = Math.max(0, state.focusRemainingSeconds - elapsed);
  state.focusStartedAt = Date.now();
  if (state.focusRemainingSeconds <= 0) completeFocusSession();
  renderFocusTimer();
}

function toggleFocusTimer() {
  if (state.focusRunning) {
    tickFocusTimer();
    state.focusRunning = false;
    clearInterval(state.focusTimer);
    state.focusTimer = null;
    saveFocusTimerState();
  } else {
    state.focusRunning = true;
    state.focusStartedAt = Date.now();
    clearInterval(state.focusTimer);
    state.focusTimer = setInterval(tickFocusTimer, 1000);
    saveFocusTimerState();
  }
  renderFocusTimer();
}

function resetFocusTimer() {
  state.focusRunning = false;
  clearInterval(state.focusTimer);
  state.focusTimer = null;
  state.focusStartedAt = null;
  state.focusRemainingSeconds = state.focusMinutes * 60;
  localStorage.removeItem("kumarFocusTimer");
  renderFocusTimer();
}

function completeFocusSession(minutesOverride = null) {
  state.focusRunning = false;
  clearInterval(state.focusTimer);
  state.focusTimer = null;
  const completedAt = new Date().toISOString();
  state.personal.focusSessions ||= [];
  const loggedMinutes = minutesOverride === null ? state.focusMinutes : Math.max(1, Math.round(minutesOverride));
  state.personal.focusSessions.push({
    id: `focus-${Date.now()}`,
    label: $("focusHubLabelInput")?.value.trim() || $("focusLabelInput")?.value.trim() || "Focus session",
    minutes: loggedMinutes,
    startedAt: new Date(Date.now() - loggedMinutes * 60000).toISOString(),
    completedAt
  });
  state.focusRemainingSeconds = state.focusMinutes * 60;
  state.focusStartedAt = null;
  localStorage.removeItem("kumarFocusTimer");
  savePersonal(false);
  if ("serviceWorker" in navigator && "Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker.ready.then((registration) => registration.showNotification("Focus session complete", {
      body: `${loggedMinutes} focused minutes logged.`,
      icon: "/cf2000_tracker_icon_1024.png",
      badge: "/alert-icon.svg",
      tag: "focus-complete",
      data: { url: "/?view=focus" }
    })).catch(() => {});
  }
  renderFocusHub();
}

function focusDayStreak() {
  const dates = new Set((state.personal?.focusSessions || []).map(sessionDate));
  let streak = 0;
  const cursor = new Date();
  let recoveryDays=state.personal?.settings?.flexibleStreaks===false?0:1;
  while (true) {
    if(dates.has(localIsoDate(cursor))) streak += 1;
    else if(recoveryDays>0&&streak>0) recoveryDays -= 1;
    else break;
    cursor.setDate(cursor.getDate()-1);
  }
  return streak;
}

function renderFocusHub() {
  if (!$("focusHubStats") || !state.personal) return;
  renderFocusTimer();
  const today = localIsoDate();
  const sessions = [...(state.personal.focusSessions || [])].sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)));
  const todaySessions = sessions.filter((session)=>sessionDate(session)===today);
  const todayMinutes = todaySessions.reduce((sum,item)=>sum+Number(item.minutes||0),0);
  const week = Array.from({length:7},(_,index)=>{const date=new Date();date.setDate(date.getDate()-(6-index));const iso=localIsoDate(date);return {iso,label:date.toLocaleDateString([],{weekday:"short"}).slice(0,1),minutes:focusMinutesBetween(iso,iso)};});
  const weekMinutes = week.reduce((sum,item)=>sum+item.minutes,0);
  $("focusHubTodayTotal").innerHTML = `<strong>${todayMinutes}</strong><span>focused minutes today</span><small>${todaySessions.length} session${todaySessions.length===1?"":"s"}</small>`;
  $("focusHubStats").innerHTML = `<div><strong>${todayMinutes}</strong><span>today</span></div><div><strong>${weekMinutes}</strong><span>this week</span></div><div><strong>${focusDayStreak()}</strong><span>day rhythm</span></div>`;
  const max=Math.max(25,...week.map(item=>item.minutes));
  $("focusHubWeekChart").innerHTML=week.map(item=>`<div><i style="height:${Math.max(4,Math.round(item.minutes/max*100))}%"></i><span>${item.label}</span><b>${item.minutes}</b></div>`).join("");
  $("focusHubStreak").textContent=`${focusDayStreak()} day focus rhythm`;
  $("focusHubHistory").innerHTML=sessions.slice(0,12).map(item=>`<article><div><strong>${escapeHtml(item.label||"Focus session")}</strong><span>${escapeHtml(formatShortDate(sessionDate(item)))} · ${item.minutes} minutes</span></div><button data-remove-focus="${escapeHtml(item.id)}">×</button></article>`).join("")||`<p class="muted-copy">Finish your first session. Momentum loves evidence.</p>`;
  document.querySelectorAll("[data-remove-focus]").forEach(button=>button.addEventListener("click",()=>{state.personal.focusSessions=state.personal.focusSessions.filter(item=>item.id!==button.dataset.removeFocus);savePersonal(false);renderFocusHub();}));
}

function addExpense(event) {
  event.preventDefault();
  const amount = Number($("expenseAmountInput").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    $("expenseAmountInput").focus();
    return;
  }
  state.personal.expenses ||= [];
  const accountId = $("expenseAccountInput").value;
  state.personal.expenses.unshift({
    id: `expense-${Date.now()}`,
    amount,
    category: $("expenseCategoryInput").value,
    date: $("expenseDateInput").value || localIsoDate(),
    note: $("expenseNoteInput").value.trim(),
    accountId,
    createdAt: new Date().toISOString()
  });
  const account = state.personal.accounts.find((item) => item.id === accountId);
  if (account) account.balance = Number(account.balance || 0) - amount;
  $("expenseAmountInput").value = "";
  $("expenseNoteInput").value = "";
  savePersonal(false);
}

function deleteExpense(id) {
  const expense = state.personal.expenses.find((item) => item.id === id);
  if (expense?.accountId) {
    const account = state.personal.accounts.find((item) => item.id === expense.accountId);
    if (account) account.balance = Number(account.balance || 0) + Number(expense.amount || 0);
  }
  state.personal.expenses = (state.personal.expenses || []).filter((item) => item.id !== id);
  savePersonal(false);
}

function addAccount(event) {
  event.preventDefault();
  state.personal.accounts.unshift({
    id: `account-${Date.now()}`,
    name: $("accountNameInput").value.trim(),
    type: $("accountTypeInput").value,
    balance: Number($("accountBalanceInput").value || 0),
    updatedAt: new Date().toISOString()
  });
  $("accountForm").reset();
  savePersonal(false);
}

function addIncome(event) {
  event.preventDefault();
  const accountId = $("incomeAccountInput").value;
  const amount = Number($("incomeAmountInput").value || 0);
  state.personal.incomes.unshift({
    id: `income-${Date.now()}`,
    source: $("incomeSourceInput").value.trim(),
    amount,
    date: $("incomeDateInput").value || localIsoDate(),
    recurring: $("incomeRecurringInput").value,
    accountId,
    createdAt: new Date().toISOString()
  });
  const account = state.personal.accounts.find((item) => item.id === accountId);
  if (account) account.balance = Number(account.balance || 0) + amount;
  $("incomeForm").reset();
  $("incomeDateInput").value = localIsoDate();
  savePersonal(false);
}

function deleteIncome(id) {
  const income = state.personal.incomes.find((item) => item.id === id);
  if (income?.accountId) {
    const account = state.personal.accounts.find((item) => item.id === income.accountId);
    if (account) account.balance = Number(account.balance || 0) - Number(income.amount || 0);
  }
  state.personal.incomes = state.personal.incomes.filter((item) => item.id !== id);
  savePersonal(false);
}

function setBudget(event) {
  event.preventDefault();
  const category = $("budgetCategoryInput").value;
  const limit = Number($("budgetLimitInput").value || 0);
  const existing = state.personal.budgets.find((budget) => budget.category === category);
  if (existing) existing.limit = limit;
  else state.personal.budgets.push({ id: `budget-${Date.now()}`, category, limit });
  $("budgetLimitInput").value = "";
  savePersonal(false);
}

function addBill(event) {
  event.preventDefault();
  state.personal.bills.unshift({
    id: `bill-${Date.now()}`,
    title: $("billTitleInput").value.trim(),
    amount: Number($("billAmountInput").value || 0),
    dueDate: $("billDueInput").value,
    recurrence: $("billRecurrenceInput").value,
    kind: $("billKindInput").value,
    autopay: $("billAutopayInput").checked,
    paid: false,
    createdAt: new Date().toISOString()
  });
  $("billForm").reset();
  savePersonal(false);
}

function markBillPaid(id) {
  const bill = state.personal.bills.find((item) => item.id === id);
  if (!bill) return;
  const paidDate = localIsoDate();
  bill.lastPaidDate = paidDate;
  const paymentKey = `${bill.id}:${bill.dueDate || paidDate}`;
  if (!state.personal.expenses.some((expense) => expense.billPaymentKey === paymentKey)) {
    state.personal.expenses.unshift({
      id: `expense-bill-${Date.now()}`,
      amount: Number(bill.amount || 0),
      category: "Bills",
      date: paidDate,
      note: bill.title,
      billPaymentKey: paymentKey,
      createdAt: new Date().toISOString()
    });
  }
  if (bill.recurrence && bill.recurrence !== "none") {
    bill.dueDate = nextRecurringValue(bill.dueDate, bill.recurrence);
    bill.paid = false;
    bill.lastNotifiedFor = null;
  } else {
    bill.paid = true;
  }
  savePersonal(false);
}

function addSavingsGoal(event) {
  event.preventDefault();
  state.personal.savingsGoals.unshift({
    id: `saving-${Date.now()}`,
    title: $("savingsTitleInput").value.trim(),
    target: Number($("savingsTargetInput").value || 0),
    current: Number($("savingsCurrentInput").value || 0),
    targetDate: $("savingsDateInput").value,
    createdAt: new Date().toISOString()
  });
  $("savingsGoalForm").reset();
  savePersonal(false);
}

function contributeSavings(id) {
  const goal = state.personal.savingsGoals.find((item) => item.id === id);
  if (!goal) return;
  const amount = Number(window.prompt(`Add to ${goal.title}`, "0"));
  if (!Number.isFinite(amount) || amount === 0) return;
  goal.current = Math.max(0, Number(goal.current || 0) + amount);
  savePersonal(false);
}

function addDebt(event) {
  event.preventDefault();
  state.personal.debts.unshift({
    id: `debt-${Date.now()}`,
    name: $("debtNameInput").value.trim(),
    balance: Number($("debtBalanceInput").value || 0),
    apr: Number($("debtAprInput").value || 0),
    emi: Number($("debtEmiInput").value || 0),
    createdAt: new Date().toISOString()
  });
  $("debtForm").reset();
  savePersonal(false);
}

function payDebt(id) {
  const debt = state.personal.debts.find((item) => item.id === id);
  if (!debt) return;
  const amount = Number(window.prompt(`Payment toward ${debt.name}`, String(debt.emi || 0)));
  if (!Number.isFinite(amount) || amount <= 0) return;
  debt.balance = Math.max(0, Number(debt.balance || 0) - amount);
  savePersonal(false);
}

function parseCsvRow(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

async function importStatementCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvRow(lines.shift() || "").map((header) => header.toLowerCase().replace(/\s+/g, ""));
    const column = (names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
    const dateIndex = column(["date", "transactiondate", "valuedate"]);
    const descriptionIndex = column(["description", "narration", "details", "merchant"]);
    const amountIndex = column(["amount", "transactionamount", "debit", "withdrawal"]);
    const categoryIndex = column(["category"]);
    const typeIndex = column(["type", "transactiontype"]);
    if (dateIndex === undefined || amountIndex === undefined) throw new Error("Date and Amount columns are required");
    let imported = 0;
    lines.forEach((line, lineIndex) => {
      const values = parseCsvRow(line);
      const rawAmount = String(values[amountIndex] || "").replace(/[₹,\s]/g, "");
      const negativeParentheses = /^\(.*\)$/.test(rawAmount);
      const amount = Number(rawAmount.replace(/[()]/g, ""));
      if (!Number.isFinite(amount) || amount === 0) return;
      const rawDate = values[dateIndex] || localIsoDate();
      const parsedDate = new Date(rawDate);
      const date = Number.isNaN(parsedDate.getTime()) ? String(rawDate).slice(0, 10) : localIsoDate(parsedDate);
      const description = values[descriptionIndex] || `Imported row ${lineIndex + 2}`;
      const type = String(values[typeIndex] || "").toLowerCase();
      const importedKey = `${date}|${description}|${amount}`;
      const isIncome = type.includes("income") || type.includes("credit") || (!negativeParentheses && amount > 0 && type && !type.includes("debit"));
      if (isIncome) {
        if (state.personal.incomes.some((item) => item.importedKey === importedKey)) return;
        state.personal.incomes.unshift({ id: `income-import-${Date.now()}-${lineIndex}`, source: description, amount: Math.abs(amount), date, recurring: "none", importedKey });
      } else {
        if (state.personal.expenses.some((item) => item.importedKey === importedKey)) return;
        state.personal.expenses.unshift({ id: `expense-import-${Date.now()}-${lineIndex}`, note: description, amount: Math.abs(amount), date, category: values[categoryIndex] || "Other", importedKey });
      }
      imported += 1;
    });
    $("csvImportStatus").textContent = `Imported ${imported} new transaction${imported === 1 ? "" : "s"} from ${file.name}.`;
    savePersonal(false);
  } catch (error) {
    $("csvImportStatus").textContent = `Import failed: ${error.message}`;
  } finally {
    event.target.value = "";
  }
}

function renderFinancialPlanning(month, expenses, expenseTotal) {
  const accountOptions = `<option value="">Unassigned account</option>${state.personal.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join("")}`;
  $("expenseAccountInput").innerHTML = accountOptions;
  $("incomeAccountInput").innerHTML = accountOptions;
  const incomes = state.personal.incomes.filter((income) => String(income.date || "").startsWith(month)
    || (income.recurring === "monthly" && String(income.date || "").slice(0, 7) < month));
  const incomeTotal = incomes.reduce((sum, income) => sum + Number(income.amount || 0), 0);
  const accountTotal = state.personal.accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const debtTotal = state.personal.debts.reduce((sum, debt) => sum + Number(debt.balance || 0), 0);
  const dueBills = state.personal.bills.filter((bill) => !bill.paid && String(bill.dueDate || "").startsWith(month));
  const billTotal = dueBills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const safeToSpend = incomeTotal ? incomeTotal - expenseTotal - billTotal : accountTotal - billTotal;
  $("financialSummary").innerHTML = `
    <div class="insight-summary-card money"><span>Net worth</span><strong>${escapeHtml(formatMoney(accountTotal - debtTotal))}</strong><p>Accounts minus debt</p></div>
    <div class="insight-summary-card money"><span>Income this month</span><strong>${escapeHtml(formatMoney(incomeTotal))}</strong><p>${incomes.length} entries</p></div>
    <div class="insight-summary-card money ${safeToSpend < 0 ? "negative" : ""}"><span>Safe to spend</span><strong>${escapeHtml(formatMoney(safeToSpend))}</strong><p>After spending and due bills</p></div>
    <div class="insight-summary-card money"><span>Upcoming commitments</span><strong>${escapeHtml(formatMoney(billTotal))}</strong><p>${dueBills.length} bills/subscriptions</p></div>
  `;
  $("accountList").innerHTML = state.personal.accounts.map((account) => `
    <div class="compact-record"><div><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.type)}</span></div><b>${escapeHtml(formatMoney(account.balance))}</b><button class="record-delete" type="button" data-remove-account="${escapeHtml(account.id)}">×</button></div>
  `).join("") || `<p class="muted-copy">Add cash, bank and investment balances.</p>`;
  $("incomeList").innerHTML = [...state.personal.incomes].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map((income) => `
    <div class="compact-record"><div><strong>${escapeHtml(income.source)}</strong><span>${escapeHtml(formatShortDate(income.date))}${income.recurring === "monthly" ? " · monthly" : ""}</span></div><b class="positive-money">+${escapeHtml(formatMoney(income.amount))}</b><button class="record-delete" type="button" data-remove-income="${escapeHtml(income.id)}">×</button></div>
  `).join("") || `<p class="muted-copy">Record salary and other inflows.</p>`;
  const categorySpent = expenses.reduce((map, expense) => {
    map[expense.category || "Other"] = (map[expense.category || "Other"] || 0) + Number(expense.amount || 0);
    return map;
  }, {});
  $("budgetList").innerHTML = state.personal.budgets.map((budget) => {
    const spent = categorySpent[budget.category] || 0;
    const pct = budget.limit ? Math.min(100, (spent / budget.limit) * 100) : 0;
    return `
      <div class="budget-record ${spent > budget.limit ? "over" : ""}">
        <div><strong>${escapeHtml(budget.category)}</strong><span>${escapeHtml(formatMoney(spent))} of ${escapeHtml(formatMoney(budget.limit))}</span></div>
        <div><i style="width:${pct}%"></i></div>
        <button class="record-delete" type="button" data-remove-budget="${escapeHtml(budget.id)}">×</button>
      </div>
    `;
  }).join("") || `<p class="muted-copy">Set limits for the categories that matter.</p>`;
  $("billList").innerHTML = [...state.personal.bills].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"))).map((bill) => {
    const days = daysBetweenDates(localIsoDate(), bill.dueDate);
    return `
      <div class="compact-record ${days !== null && days <= 3 && !bill.paid ? "due-soon" : ""}">
        <div><strong>${escapeHtml(bill.title)}</strong><span>${escapeHtml(bill.kind)} · ${escapeHtml(formatShortDate(bill.dueDate))}${bill.autopay ? " · autopay" : ""}</span></div>
        <b>${escapeHtml(formatMoney(bill.amount))}</b>
        ${!bill.paid ? `<button type="button" class="record-action" data-pay-bill="${escapeHtml(bill.id)}">Paid</button>` : `<span class="paid-label">Paid</span>`}
        <button class="record-delete" type="button" data-remove-bill="${escapeHtml(bill.id)}">×</button>
      </div>
    `;
  }).join("") || `<p class="muted-copy">Add recurring bills and renewals.</p>`;
  $("savingsGoalList").innerHTML = state.personal.savingsGoals.map((goal) => {
    const pct = goal.target ? Math.min(100, (Number(goal.current || 0) / goal.target) * 100) : 0;
    return `
      <div class="progress-record">
        <div><strong>${escapeHtml(goal.title)}</strong><span>${escapeHtml(formatMoney(goal.current))} of ${escapeHtml(formatMoney(goal.target))}</span></div>
        <b>${Math.round(pct)}%</b><div class="record-progress"><i style="width:${pct}%"></i></div>
        <button type="button" class="record-action" data-contribute-saving="${escapeHtml(goal.id)}">Add</button>
        <button class="record-delete" type="button" data-remove-saving="${escapeHtml(goal.id)}">×</button>
      </div>
    `;
  }).join("") || `<p class="muted-copy">Turn large goals into visible progress.</p>`;
  $("debtList").innerHTML = state.personal.debts.map((debt) => {
    const months = debt.emi ? Math.ceil(Number(debt.balance || 0) / debt.emi) : null;
    return `
      <div class="compact-record">
        <div><strong>${escapeHtml(debt.name)}</strong><span>${debt.apr || 0}% APR${months ? ` · ~${months} payments` : ""}</span></div>
        <b>${escapeHtml(formatMoney(debt.balance))}</b>
        <button type="button" class="record-action" data-pay-debt="${escapeHtml(debt.id)}">Pay</button>
        <button class="record-delete" type="button" data-remove-debt="${escapeHtml(debt.id)}">×</button>
      </div>
    `;
  }).join("") || `<p class="muted-copy">Track balances without connecting credentials.</p>`;

  [["account", "accounts"], ["budget", "budgets"], ["bill", "bills"], ["saving", "savingsGoals"], ["debt", "debts"]].forEach(([name, collection]) => {
    document.querySelectorAll(`[data-remove-${name}]`).forEach((button) => {
      const dataKey = `remove${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      button.addEventListener("click", () => removePersonalItem(collection, button.dataset[dataKey]));
    });
  });
  document.querySelectorAll("[data-remove-income]").forEach((button) => button.addEventListener("click", () => deleteIncome(button.dataset.removeIncome)));
  document.querySelectorAll("[data-pay-bill]").forEach((button) => button.addEventListener("click", () => markBillPaid(button.dataset.payBill)));
  document.querySelectorAll("[data-contribute-saving]").forEach((button) => button.addEventListener("click", () => contributeSavings(button.dataset.contributeSaving)));
  document.querySelectorAll("[data-pay-debt]").forEach((button) => button.addEventListener("click", () => payDebt(button.dataset.payDebt)));
}

function renderInsights() {
  if (!$("productivitySummary") || !state.personal) return;
  updateYearRunway();
  const today = localIsoDate();
  const weekStartDate = new Date();
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = localIsoDate(weekStartDate);
  const todayMinutes = focusMinutesBetween(today, today);
  const weekMinutes = focusMinutesBetween(weekStart, today);
  const sessions = state.personal.focusSessions || [];
  const todayEvents = (state.personal.schedule || []).filter((item) => eventDate(item) === today).length;
  const completedProblems = state.flat.filter((item) => displayStatus(item.id) === "done").length;
  $("productivitySummary").innerHTML = `
    <div class="insight-summary-card"><span>Today</span><strong>${todayMinutes}<small> min</small></strong><p>Focused time</p></div>
    <div class="insight-summary-card"><span>7 days</span><strong>${weekMinutes}<small> min</small></strong><p>${sessions.filter((session) => sessionDate(session) >= weekStart).length} completed sessions</p></div>
    <div class="insight-summary-card"><span>Today’s plan</span><strong>${todayEvents}</strong><p>Calendar tasks</p></div>
    <div class="insight-summary-card"><span>Roadmap</span><strong>${completedProblems}</strong><p>Problems completed</p></div>
  `;

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + index);
    const iso = localIsoDate(date);
    return {
      iso,
      label: date.toLocaleDateString([], { weekday: "narrow" }),
      minutes: focusMinutesBetween(iso, iso)
    };
  });
  const peak = Math.max(1, ...days.map((day) => day.minutes));
  $("weeklyFocusTotal").textContent = `${weekMinutes} min`;
  $("weeklyFocusChart").innerHTML = days.map((day) => `
    <div class="focus-bar-column" title="${escapeHtml(day.iso)}: ${day.minutes} minutes">
      <span>${day.minutes || ""}</span>
      <div><i style="height:${Math.max(day.minutes ? 8 : 2, (day.minutes / peak) * 100)}%"></i></div>
      <small>${escapeHtml(day.label)}</small>
    </div>
  `).join("");
  renderFocusTimer();

  const month = selectedSpendMonth();
  $("spendMonthInput").value = month;
  const expenses = (state.personal.expenses || [])
    .filter((expense) => String(expense.date || "").startsWith(month))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const categoryTotals = expenses.reduce((totals, expense) => {
    totals[expense.category || "Other"] = (totals[expense.category || "Other"] || 0) + Number(expense.amount || 0);
    return totals;
  }, {});
  const categories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const topCategory = categories[0];
  $("spendSummary").innerHTML = `
    <div class="insight-summary-card spend"><span>Total spent</span><strong>${escapeHtml(formatMoney(total))}</strong><p>${expenses.length} transactions</p></div>
    <div class="insight-summary-card spend"><span>Daily average</span><strong>${escapeHtml(formatMoney(total / Math.max(1, daysInMonth)))}</strong><p>Across ${daysInMonth} days</p></div>
    <div class="insight-summary-card spend"><span>Largest category</span><strong>${escapeHtml(topCategory?.[0] || "—")}</strong><p>${topCategory ? escapeHtml(formatMoney(topCategory[1])) : "No spending yet"}</p></div>
    <div class="insight-summary-card spend"><span>Largest expense</span><strong>${escapeHtml(formatMoney(Math.max(0, ...expenses.map((item) => Number(item.amount || 0)))))}</strong><p>Single transaction</p></div>
  `;
  $("spendCategoryChart").innerHTML = categories.length ? categories.map(([category, value]) => `
    <div class="spend-category-row">
      <div><strong>${escapeHtml(category)}</strong><span>${escapeHtml(formatMoney(value))}</span></div>
      <div class="spend-category-track"><i style="width:${total ? (value / total) * 100 : 0}%"></i></div>
      <small>${total ? Math.round((value / total) * 100) : 0}%</small>
    </div>
  `).join("") : `<p class="muted-copy">Add an expense to see the breakdown.</p>`;
  $("expenseList").innerHTML = expenses.length ? expenses.slice(0, 12).map((expense) => `
    <div class="expense-row">
      <span class="expense-category-dot category-${escapeHtml(String(expense.category || "other").toLowerCase())}"></span>
      <div><strong>${escapeHtml(expense.note || expense.category || "Expense")}</strong><span>${escapeHtml(expense.category || "Other")} · ${escapeHtml(new Date(`${expense.date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }))}</span></div>
      <b>${escapeHtml(formatMoney(expense.amount))}</b>
      <button type="button" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete expense">×</button>
    </div>
  `).join("") : `<p class="muted-copy">No expenses in this month.</p>`;
  document.querySelectorAll("[data-delete-expense]").forEach((button) => {
    button.addEventListener("click", () => deleteExpense(button.dataset.deleteExpense));
  });
  renderFinancialPlanning(month, expenses, total);
}

function renderSheet() {
  const statusFilter = $("statusFilter").value;
  const ratingFilter = $("ratingFilter").value;
  const rows = visibleItems().filter((item) => {
    const status = displayStatus(item.id);
    const statusOk = statusFilter === "all" || statusFilter === status;
    const ratingOk = ratingFilter === "all" || (ratingFilter === "2000plus" ? item.rating >= 2000 : String(item.rating) === ratingFilter);
    return statusOk && ratingOk;
  }).map((item) => {
    const unlocked = isUnlocked(item.id);
    const status = displayStatus(item.id);
    return `
      <tr class="${unlocked ? "" : "locked"}" data-id="${escapeHtml(item.id)}">
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.topicTitle)}</td>
        <td>${escapeHtml(item.rating)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(prerequisiteText(item))}</td>
      </tr>
    `;
  }).join("");

  $("sheetRows").innerHTML = rows || `<tr><td colspan="5">No matching rows.</td></tr>`;
  document.querySelectorAll("#sheetRows tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      setView("tree");
      selectProblem(row.dataset.id);
    });
  });
}

function renderStats() {
  const total = state.flat.length;
  const done = state.flat.filter((item) => displayStatus(item.id) === "done").length;
  const doing = state.flat.filter((item) => displayStatus(item.id) === "doing").length;
  const unlocked = state.flat.filter((item) => isUnlocked(item.id)).length;
  const deadline = new Date(state.progress.goal?.deadline || "2026-12-31");
  const today = new Date();
  const daysLeft = Math.max(0, Math.ceil((deadline - today) / 86400000));
  const pct = total ? Math.round((done * 100) / total) : 0;

  $("statsPanel").innerHTML = `
    <div class="stat-box"><strong>${done}/${total}</strong><span>Completed</span></div>
    <div class="stat-box"><strong>${pct}%</strong><span>Roadmap progress</span></div>
    <div class="stat-box"><strong>${doing}</strong><span>In progress</span></div>
    <div class="stat-box"><strong>${unlocked}</strong><span>Unlocked</span></div>
    <div class="stat-box"><strong>${daysLeft}</strong><span>Days left</span></div>
    <div class="stat-box"><strong>${state.flat.filter((item) => item.rating >= 1900 && displayStatus(item.id) === "done").length}</strong><span>1900+ solved</span></div>
    <div class="stat-box"><strong>${state.flat.filter((item) => item.rating >= 2000 && displayStatus(item.id) === "done").length}</strong><span>2000+ solved</span></div>
    <div class="stat-box"><strong>${state.flat.filter((item) => itemProgress(item.id).comments || itemProgress(item.id).learnings).length}</strong><span>With notes</span></div>
  `;

  $("topicStats").innerHTML = (state.roadmap.topics || []).map((topic) => {
    const items = state.flat.filter((item) => item.topicId === topic.id);
    const topicDone = items.filter((item) => displayStatus(item.id) === "done").length;
    const topicPct = items.length ? Math.round((topicDone * 100) / items.length) : 0;
    return `
      <div class="topic-stat">
        <h3>${escapeHtml(topic.title)}</h3>
        <div class="progress-bar"><div class="progress-fill" style="width:${topicPct}%"></div></div>
        <p>${topicDone}/${items.length} done</p>
      </div>
    `;
  }).join("");
}

function addBrainXp(amount) {
  state.brainXp += amount;
  localStorage.setItem("kumarBrainXp", String(state.brainXp));
  renderBrainEnergy();
}

function renderBrainEnergy() {
  if (!$("brainEnergyScore")) return;
  $("brainEnergyScore").textContent = `${state.brainXp} XP`;
  $("brainEnergyBar").style.width = `${Math.min(100, state.brainXp % 101)}%`;
}

function shuffle(values) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function resetMemoryGame() {
  const faces = ["🦖", "👽", "🦄", "🐙", "🤖", "🍕"];
  state.memoryCards = shuffle([...faces, ...faces]).map((face, index) => ({ id: `card-${Date.now()}-${index}`, face }));
  state.memoryOpen = [];
  state.memoryMatched = new Set();
  state.memoryMoves = 0;
  state.memoryLocked = false;
  if ($("memoryMessage")) $("memoryMessage").textContent = "Match the tiny weirdos.";
  renderMemoryGame();
}

function flipMemoryCard(cardId) {
  if (state.memoryLocked || state.memoryOpen.includes(cardId) || state.memoryMatched.has(cardId)) return;
  state.memoryOpen.push(cardId);
  renderMemoryGame();
  if (state.memoryOpen.length < 2) return;
  state.memoryMoves += 1;
  const [firstId, secondId] = state.memoryOpen;
  const first = state.memoryCards.find((card) => card.id === firstId);
  const second = state.memoryCards.find((card) => card.id === secondId);
  if (first?.face === second?.face) {
    state.memoryMatched.add(firstId);
    state.memoryMatched.add(secondId);
    state.memoryOpen = [];
    addBrainXp(5);
    $("memoryMessage").textContent = state.memoryMatched.size === state.memoryCards.length
      ? `You found them all in ${state.memoryMoves} moves. Brain = enormous.`
      : "A match! Your neurons are doing jazz hands.";
    if (state.memoryMatched.size === state.memoryCards.length) addBrainXp(Math.max(10, 40 - state.memoryMoves));
    renderMemoryGame();
    return;
  }
  state.memoryLocked = true;
  $("memoryMessage").textContent = "Nope. The weirdos fooled you.";
  setTimeout(() => {
    state.memoryOpen = [];
    state.memoryLocked = false;
    renderMemoryGame();
  }, 720);
}

function renderMemoryGame() {
  if (!$("memoryGrid")) return;
  if (!state.memoryCards.length) {
    resetMemoryGame();
    return;
  }
  $("memoryMoves").textContent = state.memoryMoves;
  $("memoryGrid").innerHTML = state.memoryCards.map((card) => {
    const revealed = state.memoryOpen.includes(card.id) || state.memoryMatched.has(card.id);
    return `<button class="memory-card ${revealed ? "revealed" : ""} ${state.memoryMatched.has(card.id) ? "matched" : ""}" data-memory-card="${card.id}" type="button" aria-label="${revealed ? card.face : "Hidden card"}"><span class="card-back">?</span><span class="card-face">${card.face}</span></button>`;
  }).join("");
  document.querySelectorAll("[data-memory-card]").forEach((button) => {
    button.addEventListener("click", () => flipMemoryCard(button.dataset.memoryCard));
  });
}

function nextMathQuestion() {
  state.mathRound += 1;
  if (state.mathRound > 10) {
    state.mathPlaying = false;
    $("mathQuestion").textContent = `${state.mathScore}/10`;
    $("mathProgress").textContent = "Sprint complete";
    $("mathMessage").textContent = state.mathScore >= 8 ? "Certified number wizard. Very suspicious." : state.mathScore >= 5 ? "Solid! The numbers respect you now." : "A brave battle. Demand a rematch.";
    $("mathStartButton").textContent = "Play again ↻";
    $("mathStartButton").classList.remove("hidden");
    $("mathAnswerInput").disabled = true;
    addBrainXp(state.mathScore * 3);
    return;
  }
  const mode = Math.floor(Math.random() * 4);
  let left = 0;
  let right = 0;
  let symbol = "+";
  if (mode === 0) {
    left = 10 + Math.floor(Math.random() * 90); right = 5 + Math.floor(Math.random() * 50); state.mathAnswer = left + right;
  } else if (mode === 1) {
    left = 30 + Math.floor(Math.random() * 120); right = 5 + Math.floor(Math.random() * Math.min(60, left)); symbol = "−"; state.mathAnswer = left - right;
  } else if (mode === 2) {
    left = 2 + Math.floor(Math.random() * 18); right = 2 + Math.floor(Math.random() * 12); symbol = "×"; state.mathAnswer = left * right;
  } else {
    right = 2 + Math.floor(Math.random() * 10); state.mathAnswer = 2 + Math.floor(Math.random() * 15); left = right * state.mathAnswer; symbol = "÷";
  }
  $("mathQuestion").textContent = `${left} ${symbol} ${right}`;
  $("mathProgress").textContent = `Question ${state.mathRound} of 10`;
  $("mathAnswerInput").value = "";
  $("mathAnswerInput").focus();
}

function startMathGame() {
  state.mathRound = 0;
  state.mathScore = 0;
  state.mathPlaying = true;
  $("mathScore").textContent = "0";
  $("mathMessage").textContent = "Go go go! Tiny arithmetic thunder!";
  $("mathStartButton").classList.add("hidden");
  $("mathAnswerInput").disabled = false;
  nextMathQuestion();
}

function submitMathAnswer(event) {
  event.preventDefault();
  if (!state.mathPlaying) return;
  const answer = Number($("mathAnswerInput").value);
  if (!Number.isFinite(answer) || $("mathAnswerInput").value === "") return;
  if (answer === state.mathAnswer) {
    state.mathScore += 1;
    $("mathScore").textContent = state.mathScore;
    $("mathMessage").textContent = shuffle(["Correct. Delicious.", "Boom! Number defeated.", "Yes! Big brain behavior.", "Math surrendered."])[0];
  } else {
    $("mathMessage").textContent = `Almost! It was ${state.mathAnswer}. We pretend nobody saw.`;
  }
  setTimeout(nextMathQuestion, 380);
}

function newSequencePuzzle() {
  const kind = Math.floor(Math.random() * 4);
  const length = 5;
  let values = [];
  if (kind === 0) {
    const start = 2 + Math.floor(Math.random() * 15);
    const step = 2 + Math.floor(Math.random() * 8);
    values = Array.from({ length }, (_, index) => start + index * step);
  } else if (kind === 1) {
    const start = 2 + Math.floor(Math.random() * 5);
    const factor = 2 + Math.floor(Math.random() * 2);
    values = Array.from({ length }, (_, index) => start * factor ** index);
  } else if (kind === 2) {
    const start = 1 + Math.floor(Math.random() * 6);
    values = Array.from({ length }, (_, index) => start + index * index);
  } else {
    const first = 1 + Math.floor(Math.random() * 8);
    const second = first + 1 + Math.floor(Math.random() * 5);
    values = [first, second];
    while (values.length < length) values.push(values.at(-1) + values.at(-2));
  }
  state.sequenceAnswer = values.at(-1);
  const shown = [...values.slice(0, -1), "?"];
  const offsets = shuffle([-5, -3, -2, 2, 3, 5]);
  const choices = shuffle([state.sequenceAnswer, state.sequenceAnswer + offsets[0], Math.max(0, state.sequenceAnswer + offsets[1]), state.sequenceAnswer + offsets[2]]);
  $("sequenceNumbers").innerHTML = shown.map((value) => `<span>${value}</span>`).join("");
  $("sequenceChoices").innerHTML = choices.map((value) => `<button type="button" data-sequence-choice="${value}">${value}</button>`).join("");
  $("sequenceMessage").textContent = "Choose the missing number.";
  document.querySelectorAll("[data-sequence-choice]").forEach((button) => {
    button.addEventListener("click", () => answerSequence(Number(button.dataset.sequenceChoice), button));
  });
}

function answerSequence(value, button) {
  document.querySelectorAll("[data-sequence-choice]").forEach((choice) => { choice.disabled = true; });
  if (value === state.sequenceAnswer) {
    state.sequenceStreak += 1;
    localStorage.setItem("kumarSequenceStreak", String(state.sequenceStreak));
    button.classList.add("correct");
    $("sequenceMessage").textContent = "Pattern obliterated. Nice.";
    addBrainXp(8);
  } else {
    state.sequenceStreak = 0;
    localStorage.setItem("kumarSequenceStreak", "0");
    button.classList.add("wrong");
    document.querySelector(`[data-sequence-choice="${state.sequenceAnswer}"]`)?.classList.add("correct");
    $("sequenceMessage").textContent = `Sneaky one. The answer was ${state.sequenceAnswer}.`;
  }
  $("sequenceScore").textContent = state.sequenceStreak;
  setTimeout(newSequencePuzzle, 900);
}

function randomBetween(min,max) { return min+Math.floor(Math.random()*(max-min+1)); }

function tradingId(type) {
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `arcade-${type}-${suffix}`;
}

function clampScore(value) {
  return Math.max(0,Math.min(100,Number.isFinite(value)?value:0));
}

function recordArcadeSession(gameType,score,metrics={},options={}) {
  state.personal.arcadeSessions ||= [];
  const id=options.sessionId||tradingId(gameType);
  if(state.personal.arcadeSessions.some(session=>session.id===id)) return false;
  const safeScore=clampScore(score),xp=Math.max(2,Math.round(safeScore/10));
  state.personal.arcadeSessions.unshift({
    id,
    gameType,
    score:Math.round(safeScore),
    xp,
    rounds:Math.max(1,Number(options.rounds)||1),
    startedAt:options.startedAt||new Date().toISOString(),
    completedAt:new Date().toISOString(),
    metrics
  });
  state.personal.arcadeSessions=state.personal.arcadeSessions.slice(0,250);
  addBrainXp(xp);
  savePersonal(true,false);
  return true;
}

function optimalContinuationValue(remaining,cost) {
  let value=50.5;
  for(let step=1;step<remaining;step+=1) value=Array.from({length:100},(_,i)=>Math.max(i+1,value-cost)).reduce((a,b)=>a+b,0)/100;
  return value-cost;
}

function createRiskSession() {
  return {
    id:tradingId("risk-session"),
    startedAt:new Date().toISOString(),
    totalDeals:12,
    bankroll:1000,
    peakBankroll:1000,
    maxDrawdown:0,
    maxDrawdownPct:0,
    deals:[],
    completed:false
  };
}

function createCalibrationSession() {
  return {
    id:tradingId("calibration-session"),
    startedAt:new Date().toISOString(),
    totalEvents:10,
    forecasts:[],
    completed:false
  };
}

function newTradingScenario(type=state.activeTradingGame) {
  const startedAt=new Date().toISOString();
  let scenario;
  if(type==="risk") {
    if(!state.riskSession||state.riskSession.completed) state.riskSession=createRiskSession();
    const session=state.riskSession;
    const p=randomBetween(25,78)/100,multiple=randomBetween(7,35)/10;
    scenario={
      id:tradingId(type),
      type,
      startedAt,
      answered:false,
      round:session.deals.length+1,
      p,
      multiple,
      ev:p*multiple-(1-p),
      kelly:Math.max(0,(p*multiple-(1-p))/multiple)
    };
  } else if(type==="calibration") {
    if(!state.calibrationSession||state.calibrationSession.completed) state.calibrationSession=createCalibrationSession();
    const session=state.calibrationSession,dice=randomBetween(1,6),target=randomBetween(1,6);
    scenario={
      id:tradingId(type),
      type,
      startedAt,
      answered:false,
      round:session.forecasts.length+1,
      dice,
      target,
      probability:1-Math.pow(5/6,dice)
    };
  } else {
    state.tradingRounds[type]=(state.tradingRounds[type]||0)+1;
    if(type==="market") {
      const dice=randomBetween(2,4),sides=[6,8,10][randomBetween(0,2)],multiplier=[5,10][randomBetween(0,1)];
      scenario={
        id:tradingId(type),
        type,
        startedAt,
        answered:false,
        round:state.tradingRounds[type],
        dice,
        sides,
        multiplier,
        fair:dice*(sides+1)/2*multiplier
      };
    } else {
      const current=randomBetween(1,100),remaining=randomBetween(1,3),cost=randomBetween(2,8);
      scenario={
        id:tradingId(type),
        type,
        startedAt,
        answered:false,
        round:state.tradingRounds[type],
        current,
        remaining,
        initialRedraws:remaining,
        cost,
        totalCost:0,
        decisions:[],
        continuation:optimalContinuationValue(remaining,cost)
      };
    }
  }
  state.tradingScenarios[type]=scenario;
  state.tradingScenario=scenario;
  renderTradingGame();
}

function lockedAttribute(s) {
  return s.answered?" disabled":"";
}

function marketGameMarkup(s) {
  const locked=lockedAttribute(s);
  return `<div class="trading-scenario"><span class="lab-kicker">MARKET MAKING · ROUND ${s.round}</span><h3>Quote this contract</h3><p>Settlement equals <strong>${s.multiplier} × the sum of ${s.dice} independent d${s.sides} dice</strong>. Prices trade in 0.5-point ticks and the spread must be at least 0.5.</p><div class="quote-entry"><label>Bid<input id="marketBidInput" type="number" step=".5" inputmode="decimal" required${locked}></label><span>—</span><label>Ask<input id="marketAskInput" type="number" step=".5" inputmode="decimal" required${locked}></label></div><button id="submitMarketQuote" class="lab-action" type="button"${locked}>Send two-sided market</button><div id="tradingFeedback" aria-live="polite">${s.feedbackHtml||""}</div></div><aside class="lab-principle"><strong>What this trains</strong><p>Fair-value estimation, spread discipline, adverse selection, and making a tradable market under uncertainty.</p></aside>`;
}

function riskGameMarkup(s) {
  const session=state.riskSession,locked=lockedAttribute(s);
  const drawdown=(session?.maxDrawdownPct||0)*100;
  return `<div class="trading-scenario"><span class="lab-kicker">POSITION SIZING · DEAL ${s.round} OF ${session.totalDeals}</span><h3>Size the risk, not the excitement</h3><p>A bet wins <strong>${s.multiple.toFixed(1)}× profit</strong> with probability <strong>${Math.round(s.p*100)}%</strong>; otherwise the stake is lost.</p><div class="lab-session-stats"><span><strong>₹${Math.round(session.bankroll)}</strong> bankroll</span><span><strong>${drawdown.toFixed(1)}%</strong> max drawdown</span></div><label class="risk-slider">Stake <strong id="riskStakeValue">0%</strong><input id="riskStakeInput" type="range" min="0" max="25" value="0"${locked}></label><button id="submitRiskStake" class="lab-action" type="button"${locked}>Lock decision</button><div id="tradingFeedback" aria-live="polite">${s.feedbackHtml||""}</div></div><aside class="lab-principle"><strong>Scoring</strong><p>Decision quality is scored against capped Kelly sizing. Bankroll and drawdown track luck separately across all 12 deals.</p></aside>`;
}

function calibrationGameMarkup(s) {
  const session=state.calibrationSession,locked=lockedAttribute(s);
  return `<div class="trading-scenario"><span class="lab-kicker">PROBABILITY CALIBRATION · EVENT ${s.round} OF ${session.totalEvents}</span><h3>Forecast before reality answers</h3><p>What is the probability of seeing <strong>at least one ${s.target}</strong> when rolling ${s.dice} fair six-sided ${s.dice===1?"die":"dice"}?</p><div class="probability-entry"><input id="calibrationInput" type="number" min="0" max="100" step=".1" inputmode="decimal" placeholder="Probability" required${locked}><span>%</span></div><button id="submitCalibration" class="lab-action" type="button"${locked}>Submit forecast</button><div id="tradingFeedback" aria-live="polite">${s.feedbackHtml||""}</div></div><aside class="lab-principle"><strong>Interview habit</strong><p>Ten resolved forecasts produce both probability-estimation accuracy and a proper Brier score.</p></aside>`;
}

function stoppingGameMarkup(s) {
  const locked=lockedAttribute(s),decision=s.decisions.length+1;
  return `<div class="trading-scenario"><span class="lab-kicker">OPTIMAL STOPPING · ROUND ${s.round} · DECISION ${decision}</span><h3>Take ${s.current}, or pay ${s.cost} to redraw?</h3><p>You have <strong>${s.remaining} redraw${s.remaining===1?"":"s"}</strong> remaining. Every new offer is uniformly drawn from 1–100. You have spent ${s.totalCost} so far.</p><div class="stop-actions"><button data-stop-choice="take" data-stop-step="${s.decisions.length}" type="button"${locked}>Take ${s.current}</button><button data-stop-choice="redraw" data-stop-step="${s.decisions.length}" type="button"${locked}>Pay ${s.cost} & redraw</button></div><div id="tradingFeedback" aria-live="polite">${s.feedbackHtml||""}</div></div><aside class="lab-principle"><strong>What matters</strong><p>Compare the offer to continuation value. Redraws continue until you take an offer or exhaust the available draws.</p></aside>`;
}

function showTradingFeedback(html) {
  if(!state.tradingScenario) return;
  state.tradingScenario.feedbackHtml=html;
  if($("tradingFeedback")) $("tradingFeedback").innerHTML=html;
  wireTradingFeedback();
}

function disableTradingControls() {
  document.querySelectorAll("#tradingGameStage input, #tradingGameStage .lab-action, #tradingGameStage [data-stop-choice]").forEach(control=>{control.disabled=true;});
}

function halfTick(value) {
  return Math.abs(value*2-Math.round(value*2))<1e-8;
}

function answerMarketGame() {
  const s=state.tradingScenario;
  if(!s||s.type!=="market"||s.answered) return;
  const bidRaw=$("marketBidInput")?.value.trim()||"",askRaw=$("marketAskInput")?.value.trim()||"";
  const bid=Number(bidRaw),ask=Number(askRaw),width=ask-bid;
  if(!bidRaw||!askRaw||!Number.isFinite(bid)||!Number.isFinite(ask)) {
    showTradingFeedback(`<p class="lab-error">Enter both a numeric bid and ask.</p>`);
    return;
  }
  if(!halfTick(bid)||!halfTick(ask)) {
    showTradingFeedback(`<p class="lab-error">Bid and ask must use 0.5-point ticks.</p>`);
    return;
  }
  if(bid>=ask||width<.5) {
    showTradingFeedback(`<p class="lab-error">A valid market needs bid &lt; ask and a spread of at least 0.5.</p>`);
    return;
  }
  s.answered=true;
  disableTradingControls();
  const rolls=Array.from({length:s.dice},()=>randomBetween(1,s.sides));
  const settlement=rolls.reduce((sum,value)=>sum+value,0)*s.multiplier;
  const clientValue=s.fair+(settlement-s.fair)*.65+randomBetween(-10,10);
  const mid=(bid+ask)/2,midError=Math.abs(mid-s.fair);
  let trade="No trade",pnl=0;
  if(clientValue>ask) {
    trade=`Client bought at ${ask}`;
    pnl=ask-settlement;
  } else if(clientValue<bid) {
    trade=`Client sold at ${bid}`;
    pnl=settlement-bid;
  }
  const score=clampScore(100-midError*2.2-width*.8);
  recordArcadeSession("market",score,{fair:s.fair,bid,ask,spread:width,midError,rolls,settlement,trade,pnl},{sessionId:s.id,startedAt:s.startedAt});
  showTradingFeedback(`<div class="lab-result"><strong>Settlement: ${settlement.toFixed(1)}</strong><span>Rolls ${rolls.join(" + ")} · fair value ${s.fair.toFixed(1)}</span><span>${trade} · realized P&amp;L ${pnl>=0?"+":""}${pnl.toFixed(1)}</span><p>Mid error ${midError.toFixed(1)}; spread ${width.toFixed(1)}. Decision score ${Math.round(score)}/100.</p><button data-next-trading type="button">Next market →</button></div>`);
}

function answerRiskGame() {
  const s=state.tradingScenario,session=state.riskSession;
  if(!s||s.type!=="risk"||s.answered||!session||session.completed) return;
  const stake=Number($("riskStakeInput")?.value)/100;
  if(!Number.isFinite(stake)||stake<0||stake>.25) {
    showTradingFeedback(`<p class="lab-error">Choose a stake between 0% and 25%.</p>`);
    return;
  }
  s.answered=true;
  disableTradingControls();
  const opt=Math.min(.25,s.kelly),won=Math.random()<s.p;
  const score=clampScore(100-Math.abs(stake-opt)*400);
  const bankrollBefore=session.bankroll;
  const amount=bankrollBefore*stake;
  const outcome=won?amount*s.multiple:-amount;
  session.bankroll=Math.max(0,bankrollBefore+outcome);
  session.peakBankroll=Math.max(session.peakBankroll,session.bankroll);
  const currentDrawdown=session.peakBankroll-session.bankroll;
  const currentDrawdownPct=session.peakBankroll?currentDrawdown/session.peakBankroll:0;
  session.maxDrawdown=Math.max(session.maxDrawdown,currentDrawdown);
  session.maxDrawdownPct=Math.max(session.maxDrawdownPct,currentDrawdownPct);
  session.deals.push({
    probability:s.p,
    multiple:s.multiple,
    ev:s.ev,
    stake,
    optimal:opt,
    score,
    won,
    outcome,
    bankrollBefore,
    bankrollAfter:session.bankroll
  });
  const complete=session.deals.length>=session.totalDeals;
  session.completed=complete;
  if(complete) {
    const decisionScore=session.deals.reduce((sum,deal)=>sum+deal.score,0)/session.deals.length;
    const returnPct=(session.bankroll/1000-1)*100;
    const drawdownPct=session.maxDrawdownPct*100;
    recordArcadeSession("risk",decisionScore,{
      startingBankroll:1000,
      endingBankroll:session.bankroll,
      peakBankroll:session.peakBankroll,
      returnPct,
      maxDrawdown:session.maxDrawdown,
      maxDrawdownPct:drawdownPct,
      decisionScore,
      deals:session.deals
    },{sessionId:session.id,startedAt:session.startedAt,rounds:session.deals.length});
    showTradingFeedback(`<div class="lab-result"><strong>12-deal session complete · ₹${Math.round(session.bankroll)}</strong><span>Return ${returnPct>=0?"+":""}${returnPct.toFixed(1)}% · max drawdown ${drawdownPct.toFixed(1)}%</span><p>Decision score ${Math.round(decisionScore)}/100. This score measures sizing quality; bankroll shows the luck you experienced.</p><button data-next-trading type="button">Start another session →</button></div>`);
    return;
  }
  showTradingFeedback(`<div class="lab-result"><strong>EV per ₹1: ${s.ev>=0?"+":""}${s.ev.toFixed(2)}</strong><span>Capped Kelly ${Math.round(opt*100)}% · outcome ${outcome>=0?"+":""}₹${Math.round(outcome)} · bankroll ₹${Math.round(session.bankroll)}</span><p>Decision score ${Math.round(score)}/100. ${s.ev<0?"Passing was the disciplined trade.":"Size follows edge; it does not create edge."}</p><button data-next-trading type="button">Next deal →</button></div>`);
}

function answerCalibrationGame() {
  const s=state.tradingScenario,session=state.calibrationSession;
  if(!s||s.type!=="calibration"||s.answered||!session||session.completed) return;
  const raw=$("calibrationInput")?.value.trim()||"",forecast=Number(raw)/100;
  if(!raw||!Number.isFinite(forecast)||forecast<0||forecast>1) {
    showTradingFeedback(`<p class="lab-error">Enter a probability from 0% to 100%.</p>`);
    return;
  }
  s.answered=true;
  disableTradingControls();
  const rolls=Array.from({length:s.dice},()=>randomBetween(1,6));
  const outcome=rolls.includes(s.target)?1:0;
  const error=Math.abs(forecast-s.probability);
  const brier=(forecast-outcome)**2;
  const score=clampScore(100-error*200);
  session.forecasts.push({forecast,trueProbability:s.probability,outcome,brier,error,rolls,target:s.target,score});
  const complete=session.forecasts.length>=session.totalEvents;
  session.completed=complete;
  if(complete) {
    const meanError=session.forecasts.reduce((sum,item)=>sum+item.error,0)/session.forecasts.length;
    const meanBrier=session.forecasts.reduce((sum,item)=>sum+item.brier,0)/session.forecasts.length;
    const decisionScore=session.forecasts.reduce((sum,item)=>sum+item.score,0)/session.forecasts.length;
    recordArcadeSession("calibration",decisionScore,{
      meanAbsoluteError:meanError,
      brierScore:meanBrier,
      forecasts:session.forecasts
    },{sessionId:session.id,startedAt:session.startedAt,rounds:session.forecasts.length});
    showTradingFeedback(`<div class="lab-result"><strong>Calibration set complete · Brier ${meanBrier.toFixed(3)}</strong><span>Mean probability error ${(meanError*100).toFixed(1)} points</span><p>Estimation score ${Math.round(decisionScore)}/100. Lower Brier scores are better and reward probabilities that match resolved outcomes.</p><button data-next-trading type="button">Start another set →</button></div>`);
    return;
  }
  showTradingFeedback(`<div class="lab-result"><strong>Exact probability: ${(s.probability*100).toFixed(1)}%</strong><span>Rolls ${rolls.join(", ")} · event ${outcome?"occurred":"did not occur"} · Brier ${brier.toFixed(3)}</span><p>Use 1 − (5/6)<sup>${s.dice}</sup>. Absolute error ${(error*100).toFixed(1)} points · score ${Math.round(score)}/100.</p><button data-next-trading type="button">Next forecast →</button></div>`);
}

function stoppingDecisionScore(current,continuation,choice) {
  const optimal=current>=continuation?"take":"redraw";
  return {optimal,score:choice===optimal?100:clampScore(100-Math.abs(current-continuation)*6)};
}

function finishStoppingGame(s,reason) {
  s.answered=true;
  disableTradingControls();
  const score=s.decisions.length?s.decisions.reduce((sum,item)=>sum+item.score,0)/s.decisions.length:100;
  const realized=s.current-s.totalCost;
  recordArcadeSession("stopping",score,{
    initialRedraws:s.initialRedraws,
    costPerRedraw:s.cost,
    totalCost:s.totalCost,
    acceptedOffer:s.current,
    realized,
    decisions:s.decisions,
    finishReason:reason
  },{sessionId:s.id,startedAt:s.startedAt,rounds:Math.max(1,s.decisions.length)});
  showTradingFeedback(`<div class="lab-result"><strong>${reason==="take"?"Offer accepted":"No redraws left"} · net ${realized}</strong><span>Offer ${s.current} − costs ${s.totalCost}</span><p>Decision score ${Math.round(score)}/100 across ${s.decisions.length} choice${s.decisions.length===1?"":"s"}. Outcome luck does not change the decision score.</p><button data-next-trading type="button">New stopping round →</button></div>`);
}

function answerStoppingGame(choice,expectedStep) {
  const s=state.tradingScenario;
  if(!s||s.type!=="stopping"||s.answered||!["take","redraw"].includes(choice)||Number(expectedStep)!==s.decisions.length) return;
  const {optimal,score}=stoppingDecisionScore(s.current,s.continuation,choice);
  s.decisions.push({
    choice,
    optimal,
    score,
    offer:s.current,
    continuation:s.continuation,
    remainingBefore:s.remaining
  });
  if(choice==="take") {
    finishStoppingGame(s,"take");
    return;
  }
  s.totalCost+=s.cost;
  s.remaining-=1;
  s.current=randomBetween(1,100);
  if(s.remaining<=0) {
    finishStoppingGame(s,"exhausted");
    return;
  }
  s.continuation=optimalContinuationValue(s.remaining,s.cost);
  s.feedbackHtml="";
  state.tradingScenarios.stopping=s;
  renderTradingGame();
}

function wireTradingFeedback() {
  const button=document.querySelector("[data-next-trading]");
  const scenarioId=state.tradingScenario?.id;
  button?.addEventListener("click",()=>{
    const current=state.tradingScenarios[state.activeTradingGame];
    if(!current?.answered||current.id!==scenarioId) return;
    button.disabled=true;
    newTradingScenario(state.activeTradingGame);
  });
}

function renderTradingGame() {
  if(!$("tradingGameStage"))return;
  const sessions=state.personal?.arcadeSessions||[],recent=sessions.slice(0,20);
  $("tradingLabScore").innerHTML=`<strong>${recent.length?Math.round(recent.reduce((sum,x)=>sum+Number(x.score||0),0)/recent.length):"—"}</strong><span>decision rating</span>`;
  document.querySelectorAll("[data-trading-game]").forEach(button=>button.classList.toggle("active",button.dataset.tradingGame===state.activeTradingGame));
  state.tradingScenario=state.tradingScenarios[state.activeTradingGame]||null;
  if(!state.tradingScenario) {
    newTradingScenario(state.activeTradingGame);
    return;
  }
  const s=state.tradingScenario;
  $("tradingGameStage").innerHTML=s.type==="market"?marketGameMarkup(s):s.type==="risk"?riskGameMarkup(s):s.type==="calibration"?calibrationGameMarkup(s):stoppingGameMarkup(s);
  $("submitMarketQuote")?.addEventListener("click",answerMarketGame);
  $("submitRiskStake")?.addEventListener("click",answerRiskGame);
  $("submitCalibration")?.addEventListener("click",answerCalibrationGame);
  $("riskStakeInput")?.addEventListener("input",()=>{$("riskStakeValue").textContent=`${$("riskStakeInput").value}%`;});
  document.querySelectorAll("[data-stop-choice]").forEach(button=>button.addEventListener("click",()=>answerStoppingGame(button.dataset.stopChoice,button.dataset.stopStep)));
  wireTradingFeedback();
}

function renderArcade() {
  if (!$("memoryGrid")) return;
  renderBrainEnergy();
  renderMemoryGame();
  $("mathScore").textContent = state.mathScore;
  $("sequenceScore").textContent = state.sequenceStreak;
  if (state.sequenceAnswer === null) newSequencePuzzle();
  renderTradingGame();
}

function renderAll() {
  renderGoal();
  renderTopicFilters();
  renderContestAlerts();
  renderTree();
  renderDetail();
  if (state.activeView === "today") renderToday();
  if (state.activeView === "play") renderArcade();
  if (state.activeView === "quant") renderQuant();
  if (state.activeView === "planner") renderSchedule();
  if (state.activeView === "gym") renderGymHub();
  if (state.activeView === "wellness") renderWellness();
  if (state.activeView === "focus") renderFocusHub();
  if (state.activeView === "notes") renderNotes();
  if (state.activeView === "life") renderLife();
  if (state.activeView === "insights") renderInsights();
  if (state.activeView === "contests") renderContestsView();
  if (state.activeView === "sheet") renderSheet();
  if (state.activeView === "stats") renderStats();
}

function wireEvents() {
  $("todayTab").addEventListener("click", () => setView("today"));
  $("playTab").addEventListener("click", () => setView("play"));
  $("quantTab").addEventListener("click", () => setView("quant"));
  $("plannerTab").addEventListener("click", () => setView("planner"));
  $("gymTab").addEventListener("click", () => setView("gym"));
  $("wellnessTab").addEventListener("click", () => setView("wellness"));
  $("focusTab").addEventListener("click", () => setView("focus"));
  $("notesTab").addEventListener("click", () => setView("notes"));
  $("contestsTab").addEventListener("click", () => setView("contests"));
  $("treeTab").addEventListener("click", () => setView("tree"));
  $("sheetTab").addEventListener("click", () => setView("sheet"));
  $("statsTab").addEventListener("click", () => setView("stats"));
  $("syncButton").addEventListener("click", syncCodeforces);
  $("memoryResetButton").addEventListener("click", resetMemoryGame);
  $("mathStartButton").addEventListener("click", startMathGame);
  $("mathAnswerForm").addEventListener("submit", submitMathAnswer);
  $("sequenceNewButton").addEventListener("click", newSequencePuzzle);
  document.querySelectorAll("[data-trading-game]").forEach(button=>button.addEventListener("click",()=>{state.activeTradingGame=button.dataset.tradingGame;state.tradingScenario=state.tradingScenarios[state.activeTradingGame]||null;renderTradingGame();}));
  document.querySelectorAll("[data-gym-mode]").forEach((button) => button.addEventListener("click", () => {
    state.activeGymMode = button.dataset.gymMode;
    renderGymHub();
  }));
  document.querySelectorAll("[data-focus-hub-minutes]").forEach((button) => button.addEventListener("click", () => {
    if (state.focusRunning) return;
    state.focusMinutes = Number(button.dataset.focusHubMinutes);
    state.focusRemainingSeconds = state.focusMinutes * 60;
    saveFocusTimerState();
    renderFocusHub();
  }));
  $("focusHubStartButton").addEventListener("click", toggleFocusTimer);
  $("focusHubResetButton").addEventListener("click", resetFocusTimer);
  $("focusHubFinishButton").addEventListener("click", () => {
    const elapsed = state.focusMinutes - state.focusRemainingSeconds / 60;
    if (elapsed >= 1) completeFocusSession(elapsed);
  });
  $("focusHubLabelInput").addEventListener("input", saveFocusTimerState);
  $("cfHandleInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") syncCodeforces();
  });
  $("cfHandleInput").addEventListener("input", () => {
    const saved = state.progress.profile?.codeforcesHandle || "";
    const current = $("cfHandleInput").value.trim();
    $("syncStatus").textContent = current && current !== saved ? "Press Sync to update" : "";
  });
  $("drawerBackdrop").addEventListener("click", closeProblemDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) closeProblemDrawer();
  });
  $("searchInput").addEventListener("input", () => {
    renderTree();
    renderSheet();
  });
  $("fitGraphButton").addEventListener("click", () => {
    $("roadmapStage").scrollTo({ top: 0, left: 0, behavior: "smooth" });
  });
  $("contestNotifyButton").addEventListener("click", enableContestNotifications);
  $("contestNotifyPanelButton").addEventListener("click", enableContestNotifications);
  $("contestRefreshButton").addEventListener("click", () => loadContests(true));
  $("contestRefreshPanelButton").addEventListener("click", () => loadContests(true));
  $("statusFilter").addEventListener("change", renderSheet);
  $("ratingFilter").addEventListener("change", renderSheet);
  $("quantRefreshButton").addEventListener("click", loadQuant);
  $("quantSearchInput").addEventListener("input", () => {
    state.quantSearch = $("quantSearchInput").value;
    renderQuant();
  });
  $("quantSourceFilter").addEventListener("change", () => {
    state.quantSource = $("quantSourceFilter").value;
    renderQuant();
  });
  $("quantStatusFilter").addEventListener("change", () => {
    state.quantStatus = $("quantStatusFilter").value;
    renderQuant();
  });
  $("addScheduleButton").addEventListener("click", saveScheduleEvent);
  $("newScheduleButton").addEventListener("click", () => openScheduleEditor());
  $("closeScheduleEditorButton").addEventListener("click", closeScheduleEditor);
  $("cancelScheduleButton").addEventListener("click", closeScheduleEditor);
  $("deleteScheduleButton").addEventListener("click", deleteEditingEvent);
  $("previousMonthButton").addEventListener("click", () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    renderSchedule();
  });
  $("nextMonthButton").addEventListener("click", () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    renderSchedule();
  });
  $("calendarTodayButton").addEventListener("click", () => {
    state.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    state.selectedScheduleDate = localIsoDate();
    renderSchedule();
  });
  $("enableRemindersButton").addEventListener("click", enableReminders);
  $("wellnessEnableRemindersButton").addEventListener("click", enableReminders);
  $("skinRoutineForm").addEventListener("submit", addSkinRoutine);
  $("skinProductForm").addEventListener("submit", addSkinProduct);
  $("gymPlanForm").addEventListener("submit", addGymPlan);
  $("newNoteButton").addEventListener("click", newNote);
  $("saveNoteButton").addEventListener("click", saveCurrentNote);
  $("deleteNoteButton").addEventListener("click", deleteCurrentNote);
  $("pinNoteButton").addEventListener("click", toggleCurrentNotePin);
  $("notesBackButton").addEventListener("click", () => $("notesBoard").classList.remove("editing-note"));
  $("notesFolderButton").addEventListener("click", () => {
    $("notesBoard").classList.add("show-folders");
  });
  $("closeFoldersButton").addEventListener("click",()=>$("notesBoard").classList.remove("show-folders"));
  $("newNotesFolderButton").addEventListener("click",createNotesFolder);
  $("noteRichModeButton").addEventListener("click",()=>setNoteEditorMode("rich"));
  $("noteMarkdownModeButton").addEventListener("click",()=>setNoteEditorMode("markdown"));
  $("notePreviewModeButton").addEventListener("click",()=>setNoteEditorMode("preview"));
  $("noteMarkdownInput").addEventListener("input",updateCurrentNoteDraft);
  $("noteFolderSelect").addEventListener("change",()=>{
    const note=state.personal.notes.find(item=>item.id===state.selectedNoteId);if(!note)return;
    note.folderId=$("noteFolderSelect").value;
    note.updatedAt=new Date().toISOString();
    saveNotes(false,true);
  });
  $("notesSearchInput").addEventListener("input", () => {
    state.notesSearch = $("notesSearchInput").value;
    renderNotes();
  });
  $("noteTitleInput").addEventListener("input", updateCurrentNoteDraft);
  $("noteBodyInput").addEventListener("input", updateCurrentNoteDraft);
  ["keyup", "mouseup", "focus"].forEach((eventName) => {
    $("noteBodyInput").addEventListener(eventName, rememberNoteSelection);
  });
  $("noteBlockFormat").addEventListener("change", () => runNoteCommand("formatBlock", `<${$("noteBlockFormat").value}>`));
  document.querySelectorAll("[data-note-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => runNoteCommand(button.dataset.noteCommand));
  });
  document.querySelectorAll("[data-note-action]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
  });
  document.querySelector("[data-note-action='checklist']").addEventListener("click", insertNoteChecklist);
  document.querySelector("[data-note-action='link']").addEventListener("click", addNoteLink);
  $("noteBodyInput").addEventListener("click", (event) => {
    if (!event.target.classList.contains("note-check-circle")) return;
    event.target.textContent = event.target.textContent === "●" ? "○" : "●";
    event.target.parentElement.classList.toggle("checked", event.target.textContent === "●");
    updateCurrentNoteDraft();
  });
  document.querySelectorAll("[data-focus-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.focusRunning) return;
      state.focusMinutes = Number(button.dataset.focusMinutes);
      state.focusRemainingSeconds = state.focusMinutes * 60;
      saveFocusTimerState();
      renderFocusTimer();
    });
  });
  $("focusStartButton").addEventListener("click", toggleFocusTimer);
  $("focusResetButton").addEventListener("click", resetFocusTimer);
  $("focusLabelInput").addEventListener("input", saveFocusTimerState);
  $("expenseForm").addEventListener("submit", addExpense);
  $("accountForm").addEventListener("submit", addAccount);
  $("incomeForm").addEventListener("submit", addIncome);
  $("budgetForm").addEventListener("submit", setBudget);
  $("billForm").addEventListener("submit", addBill);
  $("savingsGoalForm").addEventListener("submit", addSavingsGoal);
  $("debtForm").addEventListener("submit", addDebt);
  $("statementCsvInput").addEventListener("change", importStatementCsv);
  $("taskForm").addEventListener("submit", addTask);
  $("goalForm").addEventListener("submit", addGoal);
  $("habitForm").addEventListener("submit", addHabit);
  $("weeklyReviewForm").addEventListener("submit", saveWeeklyReview);
  $("healthForm").addEventListener("submit", saveHealthLog);
  $("careerForm").addEventListener("submit", addCareerItem);
  $("documentForm").addEventListener("submit", addDocumentRecord);
  $("taskFilterInput").addEventListener("change", renderLife);
  $("lifeEnableRemindersButton")?.addEventListener("click", enableReminders);
  document.querySelectorAll("[data-life-panel]").forEach((button) => {
    button.addEventListener("click", () => setLifePanel(button.dataset.lifePanel));
  });
  $("spendMonthInput").addEventListener("change", () => {
    state.spendMonth = $("spendMonthInput").value;
    localStorage.setItem("kumarSpendMonth", state.spendMonth);
    renderInsights();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { tickFocusTimer(); refreshNotesAcrossDevices(); }
  });
  window.addEventListener("focus",refreshNotesAcrossDevices);
  window.addEventListener("online",()=>{
    if(state.offlineSavePending&&state.personal)savePersonal(false,false);
    if(state.notesOfflineSavePending&&state.personal)saveNotes(false,false);
  });
}

async function init() {
  loadContestNoticeStore();
  wireEvents();
  document.body.dataset.view = state.activeView;
  document.body.classList.toggle("code-view", ["tree", "sheet", "stats"].includes(state.activeView));
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => console.error(error));
  }
  state.roadmap = await getJson("/api/roadmap");
  state.progress = await getJson("/api/progress");
  state.quantToday = await getJson("/api/quant/today");
  state.quant = await getJson("/api/quant");
  const cachedPersonal = localStorage.getItem("kumarPersonalOffline");
  const pendingNotes = localStorage.getItem("kumarNotesPending") === "1";
  try {
    state.personal = await getJson("/api/personal");
    if (pendingNotes && cachedPersonal) {
      const localPersonal = JSON.parse(cachedPersonal);
      ["notes", "notesFolders", "noteTombstones", "noteFolderTombstones"].forEach((field) => {
        if (Array.isArray(localPersonal[field])) state.personal[field] = localPersonal[field];
      });
      state.notesOfflineSavePending = true;
    }
    localStorage.setItem("kumarPersonalOffline",JSON.stringify(state.personal));
  } catch (error) {
    if(!cachedPersonal) throw error;
    state.personal=JSON.parse(cachedPersonal);
    state.offlineSavePending=true;
    state.notesOfflineSavePending=pendingNotes;
  }
  ensurePersonalCollections();
  state.selectedNoteId = state.personal.notes?.[0]?.id || null;
  state.spendMonth ||= localIsoDate().slice(0, 7);
  $("expenseDateInput").value = localIsoDate();
  $("incomeDateInput").value = localIsoDate();
  $("healthDateInput").value = localIsoDate();
  restoreFocusTimerState();
  flattenRoadmap(state.roadmap);
  state.selectedId = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done")?.id || state.flat[0]?.id || null;
  renderAll();
  updateYearRunway();
  setView(state.activeView);
  if (initialNewNote && state.activeView === "notes") newNote();
  if (state.notesOfflineSavePending && navigator.onLine) saveNotes(false, false);
  await loadReminderStatus();
  await loadContests(false);
  startContestTimers();
}

init().catch((error) => {
  console.error(error);
  const message = "Failed to load tracker data.";
  const todayPanel = $("todayPanel");
  if (todayPanel) {
    todayPanel.innerHTML = `
      <section class="today-main">
        <div class="empty-state">${escapeHtml(message)}</div>
      </section>
    `;
  }
  $("problemDetail").innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
});
