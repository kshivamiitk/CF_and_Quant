const $ = (id) => document.getElementById(id);

let latestPayload = null;
let noticeStore = new Set();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(seconds) {
  if (!seconds) return "Unknown";
  return new Date(seconds * 1000).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function countdown(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function contestTiming(contest) {
  const now = Math.floor(Date.now() / 1000);
  const startsIn = contest.startTimeSeconds - now;
  const endsIn = contest.endTimeSeconds - now;
  return { startsIn, endsIn, live: startsIn <= 0 && endsIn > 0 };
}

function contestStatus(contest) {
  const timing = contestTiming(contest);
  if (timing.live) return `Live now, ends in ${countdown(timing.endsIn)}`;
  return `Starts in ${countdown(timing.startsIn)} · ${formatTime(contest.startTimeSeconds)}`;
}

function loadNoticeStore() {
  try {
    noticeStore = new Set(JSON.parse(localStorage.getItem("cf2000DesktopNotices") || "[]"));
  } catch {
    noticeStore = new Set();
  }
}

function saveNoticeStore() {
  try {
    localStorage.setItem("cf2000DesktopNotices", JSON.stringify([...noticeStore].slice(-300)));
  } catch {
    // Best effort only.
  }
}

function notificationPermissionText() {
  if (!("Notification" in window)) return "Notifications unavailable";
  if (Notification.permission === "granted") return "Notifications enabled";
  if (Notification.permission === "denied") return "Notifications blocked";
  return "Enable notifications";
}

function maybeNotifyContest(contest, force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const timing = contestTiming(contest);
  const bucket = timing.live ? "live" : timing.startsIn <= 3600 ? "1h" : timing.startsIn <= 6 * 3600 ? "6h" : timing.startsIn <= 24 * 3600 ? "24h" : null;
  if (!bucket && !force) return;
  const key = `${contest.id}:${bucket || "manual"}`;
  if (!force && noticeStore.has(key)) return;
  noticeStore.add(key);
  saveNoticeStore();
  new Notification(`${contest.platform}: ${contest.title}`, {
    body: contestStatus(contest),
    icon: "/alert-icon.svg",
    tag: key
  });
}

function maybeNotifyTargets(payload, force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `targets:${payload.todayDate}`;
  if (!force && noticeStore.has(key)) return;
  noticeStore.add(key);
  saveNoticeStore();
  const names = (payload.targets || []).slice(0, 3).map((target) => target.title).join(" • ");
  new Notification(payload.headline || "Today's CF targets", {
    body: names || "Open the tracker and choose the next unlocked problem.",
    icon: "/alert-icon.svg",
    tag: key
  });
}

function renderTargets(targets) {
  if (!targets.length) return `<div class="empty">No unlocked targets found. Sync CF or open the full tracker.</div>`;
  return targets.map((target, index) => `
    <a class="target-item" href="${escapeHtml(target.url || "/")}" target="_blank" rel="noreferrer">
      <strong>${index + 1}. ${escapeHtml(target.title)}</strong>
      <span>${escapeHtml(target.topicTitle || "Roadmap")} · ${escapeHtml(target.rating || "?")} · ${escapeHtml(target.status)}</span>
      <span>${escapeHtml(target.nextAction || target.focus || "Solve and write one mistake note.")}</span>
    </a>
  `).join("");
}

function renderContests(contests) {
  if (!contests.length) return `<div class="empty">No urgent contests in the next 7 days.</div>`;
  return contests.map((contest) => {
    const timing = contestTiming(contest);
    const cls = timing.live || timing.startsIn <= 6 * 3600 ? "hot" : "gold";
    return `
      <a class="contest-item ${cls}" href="${escapeHtml(contest.url || "#")}" target="_blank" rel="noreferrer">
        <strong>${escapeHtml(contest.platform)} · ${escapeHtml(contest.title)}</strong>
        <span>${escapeHtml(contestStatus(contest))}</span>
      </a>
    `;
  }).join("");
}

function renderNotificationCards(payload) {
  const cards = [];
  const stats = payload.stats || {};
  const firstTarget = (payload.targets || [])[0];
  if (firstTarget) {
    cards.push(`
      <article class="notification-card">
        <strong>Next problem</strong>
        <span>${escapeHtml(firstTarget.title)} · ${escapeHtml(firstTarget.rating || "?")} · ${escapeHtml(firstTarget.topicTitle || "Roadmap")}</span>
      </article>
    `);
  }
  if ((payload.contests || []).length) {
    const contest = payload.contests[0];
    const timing = contestTiming(contest);
    cards.push(`
      <article class="notification-card ${timing.live || timing.startsIn <= 6 * 3600 ? "hot" : "gold"}">
        <strong>Upcoming contest</strong>
        <span>${escapeHtml(contest.platform)} · ${escapeHtml(contest.title)}<br>${escapeHtml(contestStatus(contest))}</span>
      </article>
    `);
  }
  cards.push(`
    <article class="notification-card">
      <strong>Roadmap pace</strong>
      <span>${escapeHtml(stats.remaining ?? 0)} problems left · ${escapeHtml(stats.dailyNeeded ?? 0)} per day · ${escapeHtml(stats.daysLeft ?? 0)} days left</span>
    </article>
  `);
  return cards.join("");
}

function render(payload) {
  latestPayload = payload;
  const stats = payload.stats || {};
  const targets = payload.targets || [];
  const contests = payload.contests || [];
  const urgentCount = contests.length;

  $("heroHeadline").textContent = payload.headline || "Today's CF 2000 sprint";
  $("heroMotivation").textContent = payload.motivation || "Move one step closer to 2000.";
  $("panelTitle").textContent = `${payload.todayDate || "Today"} targets`;
  $("progressChip").textContent = `${stats.progressPercent ?? 0}%`;
  $("targetList").innerHTML = renderTargets(targets);
  $("contestList").innerHTML = renderContests(contests);
  $("notificationCards").innerHTML = renderNotificationCards(payload);
  $("iconBadge").textContent = urgentCount + targets.length;
  $("doneMetric").textContent = stats.done ?? 0;
  $("dailyMetric").textContent = stats.dailyNeeded ?? targets.length;
  $("daysMetric").textContent = stats.daysLeft ?? 0;
  $("contestMetric").textContent = urgentCount;
  $("lastUpdated").textContent = `Synced ${new Date(payload.generatedAt || Date.now()).toLocaleString()} · ${notificationPermissionText()}`;
  $("notifyButton").textContent = notificationPermissionText();

  contests.forEach((contest) => maybeNotifyContest(contest));
}

async function loadToday() {
  try {
    const response = await fetch(`/api/today?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load desktop payload");
    render(payload);
  } catch (error) {
    $("heroHeadline").textContent = "Desktop companion could not sync";
    $("heroMotivation").textContent = error.message;
    $("targetList").innerHTML = `<div class="empty">Start the server again or open the full tracker.</div>`;
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  $("notifyButton").textContent = notificationPermissionText();
  if (latestPayload && Notification.permission === "granted") {
    maybeNotifyTargets(latestPayload, true);
    (latestPayload.contests || []).forEach((contest) => maybeNotifyContest(contest, true));
  }
}

$("notifyButton").addEventListener("click", enableNotifications);
$("refreshButton").addEventListener("click", loadToday);
$("missionIcon").addEventListener("dblclick", () => window.open("/", "_blank"));

loadNoticeStore();
loadToday();
setInterval(loadToday, 10 * 60 * 1000);
setInterval(() => latestPayload && render(latestPayload), 60 * 1000);
