const state = {
  roadmap: null,
  progress: null,
  flat: [],
  byId: new Map(),
  selectedId: null,
  activeTopic: "all",
  activeView: "today",
  saveTimer: null,
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
  quantSearch: "",
  quantSource: "all",
  quantStatus: "all"
};

const $ = (id) => document.getElementById(id);

const initialToken = new URLSearchParams(window.location.search).get("token");
if (initialToken) {
  localStorage.setItem("kumarQuantToken", initialToken);
  window.history.replaceState({}, document.title, window.location.pathname);
}

function authHeaders(extra = {}) {
  const token = localStorage.getItem("kumarQuantToken");
  return token ? { ...extra, "X-Tracker-Token": token } : extra;
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
  if (response.status === 401) throw new Error("Private token required");
  if (!response.ok) throw new Error(`GET ${url} failed`);
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (response.status === 401) throw new Error("Private token required");
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
  ["today", "quant", "planner", "notes", "tree", "contests", "sheet", "stats"].forEach((name) => {
    $(`${name}View`).classList.toggle("active", name === viewName);
    $(`${name}Tab`).classList.toggle("active", name === viewName);
  });
  if (viewName === "today") renderToday();
  if (viewName === "quant") renderQuant();
  if (viewName === "planner") renderSchedule();
  if (viewName === "notes") renderNotes();
  if (viewName === "contests") renderContestsView();
  if (viewName === "sheet") renderSheet();
  if (viewName === "stats") renderStats();
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
  progress[field] = value;
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
        <a class="secondary-button" href="${escapeHtml(contest.calendarUrl)}" target="_blank" rel="noreferrer">Calendar</a>
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

  if (next && !primaryContestAlert()) {
    $("contestEmergencyBanner").classList.add("hidden");
  }
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
            <label>Your solution</label>
            <textarea id="quantUserSolutionInput">${escapeHtml(current.userSolution || "")}</textarea>
          </div>
          <div class="field-group">
            <label>Notes</label>
            <textarea id="quantNotesInput">${escapeHtml(current.notes || "")}</textarea>
          </div>
        </div>
      `}
      <div class="quant-actions">${actions}</div>
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
    .filter((event) => String(event.start || "").slice(0, 10) === todayIsoDate())
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .slice(0, 4);
  const nextCf = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done");

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
        <h3>Quant Pace</h3>
        <div class="stats-grid compact-stats">
          <div class="stat-box"><strong>${stats.done || 0}</strong><span>Solved</span></div>
          <div class="stat-box"><strong>${stats.remaining || 0}</strong><span>Left</span></div>
        </div>
      </div>
    </aside>
  `;
  $("todayRefreshButton")?.addEventListener("click", loadQuant);
  wireQuantCurrent();
  document.querySelectorAll("[data-open-planner]").forEach((button) => button.addEventListener("click", () => setView("planner")));
  document.querySelectorAll("[data-open-cf]").forEach((button) => {
    button.addEventListener("click", () => {
      setView("tree");
      selectProblem(button.dataset.openCf);
    });
  });
  document.querySelectorAll("[data-open-cf-home]").forEach((button) => button.addEventListener("click", () => setView("tree")));
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
  const rows = visibleQuantQuestions().slice(0, 400).map((question) => `
    <tr class="quant-row-${escapeHtml(question.status || "todo")}">
      <td><strong>Q${escapeHtml(question.number)}</strong> ${escapeHtml(question.title)}</td>
      <td>${escapeHtml(sourceLabel(question.sourceId))}</td>
      <td>${escapeHtml(question.topic || "")}</td>
      <td>${escapeHtml(difficultyLabel(question.difficulty))}</td>
      <td><span class="table-status ${escapeHtml(question.status || "todo")}">${escapeHtml(question.status || "todo")}</span></td>
    </tr>
  `).join("");
  $("quantRows").innerHTML = rows || `<tr><td colspan="5">No matching quant questions.</td></tr>`;
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
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    const result = await postJson("/api/quant/progress", { id: current.id, ...fields });
    if (result.question) state.quantToday.current = result.question;
    state.quant = await getJson(`/api/quant?ts=${Date.now()}`);
    renderToday();
    renderQuant();
  }, debounced ? 450 : 0);
}

async function loadPersonal() {
  state.personal = await getJson(`/api/personal?ts=${Date.now()}`);
  renderSchedule();
  renderNotes();
}

function savePersonal(debounced = true) {
  const saveState = $("personalSaveState");
  const notesState = $("notesSaveState");
  if (saveState) saveState.textContent = "Saving...";
  if (notesState) notesState.textContent = "Saving...";
  clearTimeout(state.personalSaveTimer);
  state.personalSaveTimer = setTimeout(async () => {
    const result = await postJson("/api/personal", state.personal);
    if (result.personal) state.personal = result.personal;
    if (saveState) saveState.textContent = "Saved";
    if (notesState) notesState.textContent = "Saved";
    renderToday();
    renderSchedule();
    renderNotes();
  }, debounced ? 350 : 0);
}

function addScheduleEvent() {
  const title = $("scheduleTitleInput").value.trim();
  if (!title) return;
  state.personal.schedule.push({
    id: `event-${Date.now()}`,
    title,
    start: $("scheduleStartInput").value,
    end: $("scheduleEndInput").value,
    notes: $("scheduleNotesInput").value.trim(),
    createdAt: new Date().toISOString()
  });
  $("scheduleTitleInput").value = "";
  $("scheduleStartInput").value = "";
  $("scheduleEndInput").value = "";
  $("scheduleNotesInput").value = "";
  savePersonal(false);
}

function renderSchedule() {
  if (!$("scheduleList") || !state.personal) return;
  const events = [...(state.personal.schedule || [])]
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  $("scheduleList").innerHTML = events.length ? events.map((event) => `
    <article class="personal-item">
      <div>
        <h3>${escapeHtml(event.title || "Untitled event")}</h3>
        <p>${escapeHtml(formatLocalDateTime(event.start))}${event.end ? ` to ${escapeHtml(formatLocalDateTime(event.end))}` : ""}</p>
        ${event.notes ? `<pre>${escapeHtml(event.notes)}</pre>` : ""}
      </div>
      <button class="secondary-button" type="button" data-delete-event="${escapeHtml(event.id)}">Delete</button>
    </article>
  `).join("") : `<div class="empty-state">No schedule events yet.</div>`;
  document.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", () => {
      state.personal.schedule = state.personal.schedule.filter((event) => event.id !== button.dataset.deleteEvent);
      savePersonal(false);
    });
  });
}

function addNote() {
  const title = $("noteTitleInput").value.trim();
  const body = $("noteBodyInput").value.trim();
  if (!title && !body) return;
  state.personal.notes.unshift({
    id: `note-${Date.now()}`,
    title: title || "Untitled note",
    body,
    createdAt: new Date().toISOString()
  });
  $("noteTitleInput").value = "";
  $("noteBodyInput").value = "";
  savePersonal(false);
}

function renderNotes() {
  if (!$("notesList") || !state.personal) return;
  $("notesList").innerHTML = (state.personal.notes || []).length ? state.personal.notes.map((note) => `
    <article class="personal-item">
      <div>
        <h3>${escapeHtml(note.title || "Untitled note")}</h3>
        <p>${escapeHtml(formatLocalDateTime(note.createdAt))}</p>
        ${note.body ? `<pre>${escapeHtml(note.body)}</pre>` : ""}
      </div>
      <button class="secondary-button" type="button" data-delete-note="${escapeHtml(note.id)}">Delete</button>
    </article>
  `).join("") : `<div class="empty-state">No notes yet.</div>`;
  document.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", () => {
      state.personal.notes = state.personal.notes.filter((note) => note.id !== button.dataset.deleteNote);
      savePersonal(false);
    });
  });
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

function renderAll() {
  renderGoal();
  renderTopicFilters();
  renderContestAlerts();
  renderTree();
  renderDetail();
  if (state.activeView === "today") renderToday();
  if (state.activeView === "quant") renderQuant();
  if (state.activeView === "planner") renderSchedule();
  if (state.activeView === "notes") renderNotes();
  if (state.activeView === "contests") renderContestsView();
  if (state.activeView === "sheet") renderSheet();
  if (state.activeView === "stats") renderStats();
}

function wireEvents() {
  $("todayTab").addEventListener("click", () => setView("today"));
  $("quantTab").addEventListener("click", () => setView("quant"));
  $("plannerTab").addEventListener("click", () => setView("planner"));
  $("notesTab").addEventListener("click", () => setView("notes"));
  $("contestsTab").addEventListener("click", () => setView("contests"));
  $("treeTab").addEventListener("click", () => setView("tree"));
  $("sheetTab").addEventListener("click", () => setView("sheet"));
  $("statsTab").addEventListener("click", () => setView("stats"));
  $("syncButton").addEventListener("click", syncCodeforces);
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
  $("addScheduleButton").addEventListener("click", addScheduleEvent);
  $("addNoteButton").addEventListener("click", addNote);
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
  state.personal = await getJson("/api/personal");
  flattenRoadmap(state.roadmap);
  state.selectedId = state.flat.find((item) => isUnlocked(item.id) && displayStatus(item.id) !== "done")?.id || state.flat[0]?.id || null;
  renderAll();
  await loadContests(false);
  startContestTimers();
}

init().catch((error) => {
  console.error(error);
  const message = error.message === "Private token required"
    ? "Private token required. Open the app once with ?token=YOUR_PRIVATE_TOKEN."
    : "Failed to load tracker data.";
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
