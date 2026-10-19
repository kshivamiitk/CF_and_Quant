const state = {
  activeView: "today",
  personal: null,
  personalSaveTimer: null,
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedScheduleDate: null,
  editingEventId: null,
  selectedNoteId: null,
  reminderConfig: null,
  notesSearch: "",
  noteSelectionRange: null,
  activeLifePanel: "tasks",
  spendMonth: localStorage.getItem("kumarSpendMonth") || "",
  focusMinutes: 25,
  focusRemainingSeconds: 25 * 60,
  focusRunning: false,
  focusStartedAt: null,
  focusTimer: null,
  editingSkinRoutineId: null,
  editingGymPlanId: null,
  activeGymMode: "today",
  offlineSavePending: false,
  gymDraftExercises: [],
  exerciseSearch: "",
  exerciseCategory: "all",
  exerciseMode: "all",
  exerciseFavoritesOnly: false,
  activeExerciseId: null,
  exercisePanel: "library",
  exerciseDraftSessionId: null,
  exerciseDraftSets: [],
  exerciseRange: "30",
  exerciseStartDate: "",
  exerciseEndDate: "",
  exerciseIncludeWarmups: false,
  exerciseLoadAggregation: "highest",
  exerciseDurationAggregation: "best"
};

const $ = (id) => document.getElementById(id);
const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
document.body.classList.toggle("standalone-app", isInstalledApp);

const initialParams = new URLSearchParams(window.location.search);
const initialView = initialParams.get("view");
const initialDate = initialParams.get("date");
const initialNewNote = initialParams.get("new") === "1";
if (["today", "planner", "gym", "wellness", "focus", "notes"].includes(initialView)) {
  state.activeView = initialView;
}
if (/^\d{4}-\d{2}-\d{2}$/.test(initialDate || "")) state.selectedScheduleDate = initialDate;
if (initialParams.has("token") || initialView || initialNewNote) window.history.replaceState({}, document.title, window.location.pathname);

function authHeaders(extra = {}) {
  return window.CFAuth?.headers(extra) || extra;
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
  if (!response.ok) { const error = new Error(`GET ${url} failed`); error.status = response.status; throw error; }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) { const error = new Error(`POST ${url} failed`); error.status = response.status; throw error; }
  return response.json();
}


function formatUnixTime(seconds) {
  if (!seconds) return "None";
  return new Date(seconds * 1000).toLocaleString();
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
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
  if (!document.body.classList.contains("consumer-mode")) document.title = `${days} days left`;
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
  if (favicon && !document.body.classList.contains("consumer-mode")) {
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
  "schedule", "notes", "skinRoutines", "skinStepLogs", "gymPlans", "gymSessions", "customExercises", "contestCalendar", "skinProducts", "dailyReflections", "expenses", "incomes", "focusSessions", "tasks", "goals",
  "habits", "weeklyReviews", "healthLogs", "careerItems", "documents", "accounts", "budgets",
  "bills", "savingsGoals", "debts", "gymExerciseSessions", "gymExerciseFavorites"
];

function ensurePersonalCollections() {
  if (!state.personal) return;
  personalCollectionFields.forEach((field) => {
    if (!Array.isArray(state.personal[field])) state.personal[field] = [];
  });
  state.personal.settings ||= { humourStyle: "playful", flexibleStreaks: true };
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

function notificationStateText() {
  if (!("Notification" in window)) return "Unavailable";
  if (Notification.permission === "granted") return "Enabled";
  if (Notification.permission === "denied") return "Blocked";
  return "Off";
}

function setView(viewName) {
  state.activeView = viewName;
  document.body.dataset.view = viewName;
  ["today", "planner", "gym", "wellness", "focus", "notes"].forEach((name) => {
    $(`${name}View`)?.classList.toggle("active", name === viewName);
    $(`${name}Tab`)?.classList.toggle("active", name === viewName);
  });
  if (viewName === "today") renderToday();
  if (viewName === "planner") renderSchedule();
  if (viewName === "gym") renderGymHub();
  if (viewName === "wellness") renderWellness();
  if (viewName === "focus") renderFocusHub();
  if (viewName === "notes") renderNotes();
  if (viewName === "life") renderLife();
  if (viewName === "insights") renderInsights();
  if (window.matchMedia("(max-width: 480px)").matches) {
    requestAnimationFrame(() => $(`${viewName}Tab`)?.scrollIntoView({
      behavior: "smooth",
      inline: isInstalledApp ? "nearest" : "center",
      block: isInstalledApp ? "center" : "nearest"
    }));
  }
}


function renderToday() {
  const panel = $("todayPanel");
  if (!panel) return;
  const todaysEvents = (state.personal?.schedule || [])
    .filter((event) => String(event.start || "").slice(0, 10) === localIsoDate())
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .slice(0, 4);
  const todaySkinRoutines = (state.personal?.skinRoutines || []).filter((item) => routineRunsToday(item, "skin"));
  const todayGymPlans = (state.personal?.gymPlans || []).filter((item) => routineRunsToday(item, "gym"));
  const todayFocusSessions = (state.personal?.focusSessions || []).filter((item) => sessionDate(item) === localIsoDate());
  const todayFocusMinutes = todayFocusSessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const humour = state.personal?.settings?.humourStyle || "playful";
  const coachMessage = todaysEvents.some(item => !item.completed)
    ? (humour === "direct" ? "Finish the next calendar item before adding more." : humour === "gentle" ? "One unfinished calendar item is enough for your next small win." : "Your calendar has unfinished business. It has hired me as collection agent.")
    : todayFocusMinutes < 25
      ? (humour === "direct" ? "Log one focused session today." : humour === "gentle" ? "A short focus session would be a kind next step." : "Your focus timer is looking suspiciously well-rested.")
      : "Today has evidence of progress. Keep the landing clean.";

  panel.innerHTML = `
    <section class="today-main">
      <div class="today-header">
        <div>
          <span class="section-eyebrow">${escapeHtml(todayLabel())}</span>
          <h2>${escapeHtml(todayHeading())}</h2>
        </div>
        <button id="todayRefreshButton" class="secondary-button" type="button">Refresh</button>
      </div>
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
          <h3>Skin care</h3>
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
        `).join("") : `<p class="muted-copy">No skin routine today.</p>`}
      </div>
      <div class="today-widget wellness-today-widget gym-today-widget">
        <div class="widget-header">
          <h3>Gym plan</h3>
          <button type="button" data-open-gym="1">Open workout</button>
        </div>
        ${todayGymPlans.length ? todayGymPlans.map((plan) => `
          ${(() => { const session = gymSessionFor(plan.id); const progress = session ? gymSessionProgress(session) : { done: 0, total: (plan.exercises || []).reduce((sum, e) => sum + (Number.parseInt(e.sets, 10) || 1), 0) }; return `<div class="today-routine ${session?.status === "completed" ? "complete" : ""}">
            <button type="button" data-open-gym="1" aria-label="Open workout">${session?.status === "completed" ? "✓" : "›"}</button>
            <div>
              <strong>${escapeHtml(plan.name)}</strong>
              <span>${escapeHtml(plan.time || "Any time")} · ${progress.done}/${progress.total} sets · ${session?.status || "planned"}</span>
            </div>
          </div>`; })()}
        `).join("") : `<p class="muted-copy">No workout today.</p>`}
      </div>
      <div class="today-widget focus-today-widget">
        <div class="widget-header"><h3>Focus</h3><button type="button" data-open-focus="1">Start</button></div>
        <div class="today-focus-summary"><strong>${todayFocusMinutes}</strong><span>focused minutes · ${todayFocusSessions.length} sessions</span></div>
        <p class="muted-copy">${todayFocusMinutes ? "Evidence that you showed up." : "Start small. Twenty-five honest minutes counts."}</p>
      </div>
      <div class="today-widget contextual-widget">
        <div class="widget-header"><h3>Right now</h3><button type="button" data-open-gym-coach="1">Coach</button></div>
        <p>${escapeHtml(coachMessage)}</p>
        <small>${state.offlineSavePending ? "Working offline · changes will sync automatically" : "Synced across your devices"}</small>
      </div>
    </aside>
  `;
  $("todayRefreshButton")?.addEventListener("click", renderToday);
  document.querySelectorAll("[data-open-planner]").forEach((button) => button.addEventListener("click", () => setView("planner")));
  document.querySelectorAll("[data-open-wellness]").forEach((button) => button.addEventListener("click", () => setView("wellness")));
  document.querySelectorAll("[data-open-gym]").forEach((button) => button.addEventListener("click", () => setView("gym")));
  document.querySelectorAll("[data-open-focus]").forEach((button) => button.addEventListener("click", () => setView("focus")));
  document.querySelectorAll("[data-open-gym-coach]").forEach((button) => button.addEventListener("click", () => { state.activeGymMode = "coach"; setView("gym"); }));
  document.querySelectorAll("[data-today-skin-complete]").forEach((button) => button.addEventListener("click", () => {
    toggleWellnessCompletion("skinRoutines", button.dataset.todaySkinComplete);
    renderToday();
  }));
}

async function loadPersonal() {
  try {
    state.personal = await getJson(`/api/personal?ts=${Date.now()}`);
  } catch (error) {
    throw error;
  }
  ensurePersonalCollections();
  state.selectedScheduleDate ||= localIsoDate();
  state.selectedNoteId ||= state.personal.notes?.[0]?.id || null;
  renderSchedule();
  renderWellness();
  renderNotes();
  renderInsights();
  renderLife();
  await loadReminderStatus();
}

function savePersonal(debounced = true, rerender = true) {
  const saveState = $("personalSaveState");
  const notesState = $("notesSaveState");
  const wellnessState = $("wellnessSaveState");
  if (saveState) saveState.textContent = "Saving...";
  if (notesState) notesState.textContent = "Saving...";
  if (wellnessState) wellnessState.textContent = "Saving...";
  clearTimeout(state.personalSaveTimer);
  state.personalSaveTimer = setTimeout(async () => {
    try {
      const result = await postJson("/api/personal", state.personal);
      if (result.personal) state.personal = result.personal;
      state.offlineSavePending = false;
      if (saveState) saveState.textContent = "Saved";
      if (notesState) notesState.textContent = "Saved";
      if (wellnessState) wellnessState.textContent = "Saved";
      const insightsState = $("insightsSaveState");
      if (insightsState) insightsState.textContent = "Saved";
      if (rerender) {
        renderToday();
        renderSchedule();
        renderGymHub();
        renderWellness();
        renderFocusHub();
        renderNotes();
        renderInsights();
        renderLife();
      }
    } catch (error) {
      state.offlineSavePending = true;
      if (saveState) saveState.textContent = "Save failed";
      if (notesState) notesState.textContent = "Save failed";
      if (wellnessState) wellnessState.textContent = "Save failed";
      const insightsState = $("insightsSaveState");
      if (insightsState) insightsState.textContent = "Save failed";
      console.error(error);
    }
  }, debounced ? 350 : 0);
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
  const items = [
    ...events.filter((event)=>event.kind!=="contest").map((item)=>({icon:item.completed?"✓":"□",title:item.title,meta:item.completed?"Schedule completed":date<localIsoDate()?"Schedule missed/incomplete":"Scheduled activity",tone:item.completed?"gym":"focus"})),
    ...skin.map((item) => { const done=(item.completions||[]).includes(date); return { icon: "✨", title: item.name, meta: done ? `${(item.steps || []).length} skincare steps completed` : (date < localIsoDate() ? "Skincare routine missed" : "Skincare routine planned"), tone: done ? "skin" : "missed" }; }),
    ...gym.map((item) => { const p=gymSessionProgress(item); return { icon:"💪", title:item.planName, meta:`${item.status} · ${p.done}/${p.total} sets`,tone:item.status==="absent"?"missed":"gym" }; }),
    ...focus.map((item) => ({ icon:"◎",title:item.label||"Focus session",meta:`${item.minutes} focused minutes`,tone:"focus" })),
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

function renderWatchHealth() {
  const panel = $("watchHealthPanel");
  if (!panel) return;
  const imports = state.personal?.healthImports || [];
  if (!imports.length) {
    panel.innerHTML = `
      <div class="watch-health-empty">
        <div class="watch-health-empty-icon">⌚</div>
        <div>
          <strong>Connect your Apple Watch</strong>
          <p>Use the iOS Shortcut below to send your Health data here. Rings, steps, sleep, heart rate — all in one place.</p>
          <details class="watch-setup-details">
            <summary>How to set up</summary>
            <ol>
              <li>On iPhone, open the <strong>Shortcuts</strong> app</li>
              <li>Create a new shortcut with these actions:
                <ul>
                  <li>Get Health Sample (Steps, Active Energy, Heart Rate, Stand Hours, Sleep Analysis, Workout Minutes)</li>
                  <li>Get Device Details → Device Name</li>
                  <li>Get Contents of URL → POST to <code>${location.origin}/api/health-import</code></li>
                  <li>Set body: JSON with keys <code>steps, activeCalories, heartRate, standHours, sleepHours, workoutMinutes, date, source</code></li>
                </ul>
              </li>
              <li>Add to Automation → run at 9 PM daily</li>
            </ol>
          </details>
        </div>
      </div>`;
    return;
  }
  const latest = imports[imports.length - 1];
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localIsoDate(d); })();
  const age = latest.date === localIsoDate() ? "Today" : latest.date === yesterday ? "Yesterday" : latest.date;
  const rings = [
    { label: "Steps", value: latest.steps?.toLocaleString() ?? "—", unit: "steps", icon: "⬡", pct: Math.min(100, ((latest.steps || 0) / 10000) * 100) },
    { label: "Active", value: latest.activeCalories ?? "—", unit: "cal", icon: "◉", pct: Math.min(100, ((latest.activeCalories || 0) / 600) * 100) },
    { label: "Heart", value: latest.heartRate ?? "—", unit: "bpm", icon: "♡", pct: null },
    { label: "Stand", value: latest.standHours ?? "—", unit: "hrs", icon: "↑", pct: Math.min(100, ((latest.standHours || 0) / 12) * 100) },
    { label: "Sleep", value: latest.sleepHours ?? "—", unit: "hrs", icon: "◑", pct: Math.min(100, ((latest.sleepHours || 0) / 8) * 100) },
    { label: "Workout", value: latest.workoutMinutes ?? "—", unit: "min", icon: "⚡", pct: Math.min(100, ((latest.workoutMinutes || 0) / 30) * 100) },
  ];
  panel.innerHTML = `
    <div class="watch-health-panel-inner">
      <div class="watch-health-header">
        <div><span class="section-eyebrow">Apple Watch · ${escapeHtml(age)}</span><h3>Health rings</h3></div>
        <span class="watch-sync-time">${escapeHtml(latest.source || "Watch")}</span>
      </div>
      <div class="watch-rings">
        ${rings.map((ring) => `
          <div class="watch-ring-card">
            <div class="ring-icon">${ring.icon}</div>
            ${ring.pct !== null ? `<div class="ring-progress"><div class="ring-fill" style="width:${ring.pct.toFixed(0)}%"></div></div>` : ""}
            <strong>${escapeHtml(String(ring.value))}</strong>
            <span>${ring.unit}</span>
            <small>${ring.label}</small>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function renderWellness() {
  if (!$("wellnessSummary") || !state.personal) return;
  renderWatchHealth();
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
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),personal:state.personal},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`life-tracker-${localIsoDate()}.json`;link.click();URL.revokeObjectURL(url);
}

function renderGymHub() {
  if (!$("gymHubContent") || !state.personal) return;
  window.wireExerciseTracker?.();
  window.renderExerciseTracker?.();
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
  const note = {
    id: `note-${Date.now()}`,
    title: "",
    body: "",
    contentHtml: "",
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.personal.notes.unshift(note);
  state.selectedNoteId = note.id;
  state.noteSelectionRange = null;
  renderNotes();
  $("notesBoard").classList.add("editing-note");
  $("noteTitleInput").focus();
}

function saveCurrentNote() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  note.title = $("noteTitleInput").value.trim();
  note.body = $("noteBodyInput").innerText;
  note.contentHtml = sanitizeNoteHtml($("noteBodyInput").innerHTML);
  note.updatedAt = new Date().toISOString();
  savePersonal(false);
  $("notesBoard").classList.remove("editing-note");
}

function updateCurrentNoteDraft() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  note.title = $("noteTitleInput").value;
  note.body = $("noteBodyInput").innerText;
  note.contentHtml = sanitizeNoteHtml($("noteBodyInput").innerHTML);
  note.updatedAt = new Date().toISOString();
  $("noteEditedMeta").textContent = `Edited ${formatNoteDate(note.updatedAt)}`;
  savePersonal(true, false);
}

function deleteCurrentNote() {
  if (!state.selectedNoteId) return;
  state.personal.notes = state.personal.notes.filter((note) => note.id !== state.selectedNoteId);
  state.selectedNoteId = state.personal.notes[0]?.id || null;
  $("notesBoard").classList.remove("editing-note");
  savePersonal(false);
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
  container.querySelectorAll("script, style, iframe, object, embed, form").forEach((element) => element.remove());
  container.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const unsafeLink = ["href", "src"].includes(name) && /^\s*javascript:/i.test(attribute.value);
      if (name.startsWith("on") || unsafeLink) element.removeAttribute(attribute.name);
    });
  });
  return container.innerHTML;
}

function toggleCurrentNotePin() {
  const note = state.personal.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  savePersonal(false);
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
  const allNotes = state.personal.notes || [];
  const query = state.notesSearch.trim().toLowerCase();
  const notes = [...allNotes]
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
    const fallbackHtml = escapeHtml(selected.body || "").replaceAll("\n", "<br>");
    $("noteBodyInput").innerHTML = sanitizeNoteHtml(selected.contentHtml || fallbackHtml);
  }
  document.querySelectorAll("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNoteId = button.dataset.noteId;
      state.noteSelectionRange = null;
      renderNotes();
      $("notesBoard").classList.add("editing-note");
    });
  });
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
  $("enableRemindersButton").textContent = ready ? "Send test" : "Enable reminders";
  $("reminderStatus").className = `reminder-status ${ready ? "ready" : ""}`;
  $("reminderStatus").innerHTML = ready
    ? `<strong>Reminders are on</strong><span>Calendar work, quant practice, skin care, workouts, and contests can reach this iPhone while the app is closed.</span>`
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
  $("productivitySummary").innerHTML = `
    <div class="insight-summary-card"><span>Today</span><strong>${todayMinutes}<small> min</small></strong><p>Focused time</p></div>
    <div class="insight-summary-card"><span>7 days</span><strong>${weekMinutes}<small> min</small></strong><p>${sessions.filter((session) => sessionDate(session) >= weekStart).length} completed sessions</p></div>
    <div class="insight-summary-card"><span>Today’s plan</span><strong>${todayEvents}</strong><p>Calendar tasks</p></div>
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


function shuffle(values) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function renderAll() {
  if (state.activeView === "today") renderToday();
  if (state.activeView === "planner") renderSchedule();
  if (state.activeView === "gym") renderGymHub();
  if (state.activeView === "wellness") renderWellness();
  if (state.activeView === "focus") renderFocusHub();
  if (state.activeView === "notes") renderNotes();
  if (state.activeView === "life") renderLife();
  if (state.activeView === "insights") renderInsights();
}

function wireEvents() {
  $("todayTab").addEventListener("click", () => setView("today"));
  $("plannerTab").addEventListener("click", () => setView("planner"));
  $("gymTab").addEventListener("click", () => setView("gym"));
  $("wellnessTab").addEventListener("click", () => setView("wellness"));
  $("focusTab").addEventListener("click", () => setView("focus"));
  $("notesTab").addEventListener("click", () => setView("notes"));
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
    state.notesSearch = "";
    $("notesSearchInput").value = "";
    renderNotes();
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
    if (!document.hidden) tickFocusTimer();
  });
  window.addEventListener("online",()=>{if(state.offlineSavePending&&state.personal)savePersonal(false,false);});
}

async function init() {
  document.body.dataset.view = state.activeView;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => console.error(error));
  }
  try {
    await window.CFAuth?.restore();
    if (window.CFAuth?.isRecovering()) return;
    const account = await getJson("/api/auth/me");
    window.CFAuth?.hideLogin();
    document.body.classList.remove("booting");
    document.body.classList.add("consumer-mode");
    await window.CFConsumer.start(account);
    if (!account.legacyOwner) return;
    wireEvents();
    state.personal = await getJson("/api/personal");
  } catch (error) {
    if (error.status === 401) { window.CFAuth?.showLogin(); return; }
    throw error;
  }
  ensurePersonalCollections();
  state.selectedNoteId = state.personal.notes?.[0]?.id || null;
  state.spendMonth ||= localIsoDate().slice(0, 7);
  $("expenseDateInput").value = localIsoDate();
  $("incomeDateInput").value = localIsoDate();
  $("healthDateInput").value = localIsoDate();
  restoreFocusTimerState();
  renderAll();
  updateYearRunway();
  setView(state.activeView);
  if (initialNewNote && state.activeView === "notes") newNote();
  await loadReminderStatus();
}

init().catch((error) => {
  console.error(error);
  const todayPanel = $("todayPanel");
  if (todayPanel) {
    todayPanel.innerHTML = `<section class="today-main"><div class="empty-state">Failed to load data.</div></section>`;
  }
});
