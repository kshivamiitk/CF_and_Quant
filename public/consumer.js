/* Wellframe consumer surface. Every displayed health value comes from saved records. */
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { records: [], tab: "today", trainPage: "overview", query: "", category: "", shown: 30, detailId: null, exerciseRange: "90", selected: new Set(), account: null, pending: [], activeId: null, finishId: null, finishing: false, editCareId: null, waterOpen: false, timer: null, range: 7, trendExerciseId: "", development: false, loading: false, scroll: {}, writeLocks: new Map() };
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const now = () => new Date().toISOString();
  const dateKey = (value) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  const today = () => dateKey(new Date());
  const shortDate = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const profile = () => state.records.find((row) => row.kind === "profile")?.payload || {};
  const rows = (kind) => state.records.filter((row) => row.kind === kind).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const catalog = () => (window.GYM_EXERCISE_LIBRARY || []).concat(rows("custom_exercise").map((row) => ({ id: `custom:${row.record_id}`, name: row.payload.name, category: row.payload.category, mode: row.payload.mode })));
  const exercise = (id) => catalog().find((item) => item.id === id);
  const weightUnit = () => profile().unit === "imperial" ? "lb" : "kg";
  const displayWeight = (kg) => profile().unit === "imperial" ? Math.round(Number(kg || 0) * 2.2046226218 * 10) / 10 : Number(kg || 0);
  const canonicalWeight = (value) => profile().unit === "imperial" ? Math.round(Number(value || 0) / 2.2046226218 * 1000) / 1000 : Number(value || 0);
  const favorites = () => new Set(rows("favorite").map((row) => row.payload.exerciseId));
  function catalogArtwork(item) {
    const palette = [["#d9f4ef", "#086f68"], ["#e4e8ff", "#514ca3"], ["#fff0df", "#a05c21"], ["#e1f0fa", "#28658b"]];
    const seed = [...item.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
    const [background, ink] = palette[seed % palette.length];
    const cardio = item.category === "Cardio";
    const symbol = cardio
      ? `<path d="M45 116h35l16-31 17 54 17-35h45" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"><path d="M53 113h114M64 91v44m13-51v58m66-58v58m13-51v44"/></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="160" viewBox="0 0 220 160" role="img"><rect width="220" height="160" rx="14" fill="${background}"/><circle cx="110" cy="100" r="64" fill="#fff" opacity=".48"/>${symbol}<text x="14" y="28" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="${ink}">${esc(item.id)}</text><text x="14" y="151" font-family="Arial,sans-serif" font-size="11" fill="${ink}">CATALOG ARTWORK</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  const thumb = (id, size = "small") => {
    const media = window.WFMedia?.get(id);
    const item = exercise(id);
    return media?.thumb?.path ? `<img class="wf-exercise-thumb wf-exercise-thumb-${size}" src="${esc(media.thumb.path)}" width="${media.thumb.width}" height="${media.thumb.height}" alt="${esc(media.alt)}" loading="lazy" decoding="async">` : `<img class="wf-exercise-thumb wf-exercise-thumb-${size}" src="${catalogArtwork(item || { id: id || "?", category: "General" })}" width="220" height="160" alt="Decorative catalog artwork for ${esc(item?.name || "exercise")}; no form image available" loading="lazy" decoding="async">`;
  };
  const exerciseName = (set) => set.exerciseId ? exercise(set.exerciseId)?.name || set.exercise || "Unknown exercise" : set.exercise || "Unresolved exercise";
  const setTemplate = (item) => ({ setId: crypto.randomUUID(), exerciseId: item.id, exercise: item.name, reps: 0, weightKg: 0, durationSec: 0, distanceKm: 0, warmup: false, complete: false });
  function restLabel(row) {
    if (!row?.payload.restUntil) return "No timer running";
    const seconds = Math.max(0, Math.ceil((new Date(row.payload.restUntil).getTime() - Date.now()) / 1000));
    return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining` : "Rest complete";
  }
  function tickRest() {
    const node = $("wfRestTime");
    if (node) node.textContent = restLabel(rows("workout").find((row) => row.payload.status === "active"));
  }
  const pendingKey = () => `wf_pending_${state.account.userId}`;
  const snapshotKey = () => `wf_snapshot_${state.account.userId}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function status(message, type = "") {
    const element = $("consumerStatus"); element.textContent = message; element.dataset.type = type;
    clearTimeout(status.timer);
    if (type !== "error" && type !== "pending") status.timer = setTimeout(() => { element.textContent = ""; }, 4000);
  }
  async function api(method, body, path = "/api/consumer") {
    await window.CFAuth.ensureFresh();
    const response = await fetch(path, { method, cache: "no-store", headers: window.CFAuth.headers({ "Content-Type": "application/json" }), body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(result.error || "Please retry."); error.status = response.status; throw error; }
    return result;
  }
  function savePending() {
    const essential = state.records.filter((row) => ["profile", "care_item", "favorite", "custom_exercise", "routine"].includes(row.kind) || (row.kind === "workout" && row.payload.status === "active"));
    const recent = state.records.filter((row) => !essential.includes(row) && row.kind !== "health_sample")
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 200);
    try {
      localStorage.setItem(pendingKey(), JSON.stringify(state.pending));
      localStorage.setItem(snapshotKey(), JSON.stringify(essential.concat(recent)));
      return true;
    } catch {
      status("Browser storage is full. Unsynced changes may not survive a reload; reconnect before leaving.", "error");
      return false;
    }
  }
  function overlayPending() {
    for (const item of state.pending) {
      state.records = state.records.filter((row) => row.record_id !== item.body.recordId);
      if (item.method === "POST") state.records.push({ record_id: item.body.recordId, kind: item.body.kind, payload: clone(item.body.payload), occurred_at: item.body.occurredAt, revision: item.body.expectedRevision || 0 });
    }
  }
  async function flushPending() {
    if (!state.pending.length) return;
    for (const item of [...state.pending]) {
      if (!state.pending.includes(item)) continue;
      try {
        const result = await api(item.method, item.body);
        if (result.record) {
          state.records = state.records.filter((row) => row.record_id !== item.body.recordId && row.record_id !== result.record.record_id).concat(result.record);
        }
        if (item.method === "DELETE") state.records = state.records.filter((row) => row.record_id !== item.body.recordId);
        state.pending = state.pending.filter((entry) => entry !== item);
        savePending();
      } catch (error) { status(error.status === 409 ? "A newer edit exists. This pending change was not replayed; reload to resolve it." : "Changes are pending in this browser. Reconnect to retry.", error.status === 409 ? "error" : "pending"); return; }
    }
    status("Your changes are saved.");
  }
  async function save(kind, payload, recordId = crypto.randomUUID(), occurredAt = now()) {
    const prior = state.writeLocks.get(recordId);
    let unlock;
    const lock = new Promise((resolve) => { unlock = resolve; });
    state.writeLocks.set(recordId, lock);
    if (prior) await prior;
    try {
    const previous = state.records.find((item) => item.record_id === recordId);
    const expectedRevision = previous?.revision || 0;
    const body = { kind, payload: clone(payload), recordId, occurredAt, expectedRevision };
    const row = { record_id: recordId, kind, payload: clone(payload), occurred_at: occurredAt, revision: expectedRevision };
    state.records = state.records.filter((item) => item.record_id !== recordId).concat(row);
    try {
      const result = await api("POST", body);
      state.records = state.records.filter((item) => item.record_id !== recordId && item.record_id !== result.record.record_id).concat(result.record);
      Object.assign(row, result.record);
      state.pending = state.pending.filter((item) => item.body.recordId !== recordId);
      savePending();
      status("Your changes are saved.");
    }
    catch (error) {
      if ([400, 401, 403, 409].includes(error.status)) { state.records = state.records.filter((item) => item.record_id !== recordId); if (previous) state.records.push(previous); status(error.message, "error"); throw error; }
      state.pending = state.pending.filter((item) => item.body.recordId !== recordId).concat({ method: "POST", body });
      if (savePending()) status("Pending in this browser; not yet synced. Export or reconnect before signing out.", "pending");
    }
    return row;
    } finally {
      unlock();
      if (state.writeLocks.get(recordId) === lock) state.writeLocks.delete(recordId);
    }
  }
  async function remove(recordId, rerender = true) {
    const previous = state.records.find((row) => row.record_id === recordId);
    if (!previous) return;
    state.pending = state.pending.filter((item) => item.body.recordId !== recordId);
    const body = previous.revision ? { recordId, expectedRevision: previous.revision } : { recordId };
    state.records = state.records.filter((row) => row.record_id !== recordId);
    try { await api("DELETE", body); status("Entry removed."); }
    catch (error) {
      if ([400, 401, 403, 409].includes(error.status)) { state.records.push(previous); status(error.message, "error"); return; }
      state.pending.push({ method: "DELETE", body });
      status("Removal pending in this browser; not yet synced.", "pending");
    }
    savePending();
    if (rerender) render();
  }
  function select(tab) {
    state.scroll[state.tab] = window.scrollY;
    state.tab = tab;
    document.body.classList.remove("legacy-mode");
    document.body.classList.add("consumer-mode");
    $("consumerShell").hidden = false;
    document.querySelectorAll("[data-consumer-tab]").forEach((button) => button.setAttribute("aria-current", button.dataset.consumerTab === tab ? "page" : "false"));
    render();
    window.scrollTo({ top: state.scroll[tab] || 0, behavior: "instant" });
  }
  function card(title, value, detail, action = "") { return `<article class="wf-card"><small>${esc(title)}</small><strong>${esc(value)}</strong><span>${esc(detail)}</span>${action}</article>`; }
  function todayView() {
    const name = profile().displayName || "there";
    const water = rows("water").filter((item) => dateKey(item.occurred_at) === today()).reduce((total, item) => total + Number(item.payload.amountMl || 0), 0);
    const workouts = rows("workout").filter((item) => item.payload.status === "completed" && dateKey(item.occurred_at) === today());
    const heart = rows("health_sample").filter((item) => item.payload.metricType === "heart_rate" && !item.payload.deleted).sort((a, b) => b.payload.sampleStart.localeCompare(a.payload.sampleStart))[0];
    const active = rows("workout").find((item) => item.payload.status === "active");
    const careItems = rows("care_item").filter((item) => !item.payload.paused);
    const source = rows("health_sample").filter((item) => !item.payload.deleted).sort((a, b) => b.payload.sampleEnd.localeCompare(a.payload.sampleEnd))[0];
    const sourceLabel = source ? `Latest device sample ${shortDate(source.payload.sampleEnd)}` : "No device samples";
    const greeting = `<div class="wf-heading"><div><span class="wf-kicker">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h2>Good to see you, ${esc(name)}.</h2><p>${active ? "Your workout is ready to resume." : `${workouts.length} workout${workouts.length === 1 ? "" : "s"} recorded today.`}</p></div><span class="wf-source">${state.development ? "Local development · " : ""}${state.pending.length ? "Sync pending" : sourceLabel}</span></div>`;
    const week = rows("workout").filter((item) => item.payload.status === "completed" && new Date(item.occurred_at) >= new Date(Date.now() - 7 * 86400000)).length;
    const hero = `<section class="wf-hero"><span class="wf-kicker">YOUR TRAINING WEEK</span><h3>${week} workout${week === 1 ? "" : "s"} in the last 7 days</h3><p>${active ? "Your current session is ready." : "Recorded sessions only; rest days are part of training too."}</p><button class="wf-primary" data-action="${active ? "resume" : "open-library"}">${active ? "Resume workout" : "Explore exercises"}</button></section>`;
    const waterAction = state.waterOpen ? `<form id="wfWaterForm" class="wf-water-form"><label>Amount (ml)<input name="amountMl" type="number" min="1" max="5000" value="250" required inputmode="numeric"></label><button type="submit" class="wf-inline">Save</button><button type="button" data-action="cancel-water" class="wf-inline">Cancel</button></form>` : `<button class="wf-inline" data-action="water">+ Log water</button>`;
    const heartCard = heart ? card("Heart rate · latest", `${heart.payload.value} bpm`, `${shortDate(heart.payload.sampleStart)} · ${heart.payload.sourceName || heart.payload.sourceId}`) : "";
    const metrics = `<div class="wf-metric-grid">${profile().interests?.includes("Strength") ? card("Activity · today", workouts.length ? `${workouts.length} workout${workouts.length === 1 ? "" : "s"}` : "No workout yet", "From your recorded sessions") : ""}${card("Water · today", water ? `${water} ml` : "No entry yet", water ? "Added by you" : "Log a glass when you like", waterAction)}${!profile().interests?.includes("Strength") ? card("Activity · today", workouts.length ? `${workouts.length} workout${workouts.length === 1 ? "" : "s"}` : "No workout yet", "From your recorded sessions") : ""}${heartCard}</div>`;
    const care = `<section class="wf-section"><div class="wf-section-head"><div><span class="wf-kicker">DAILY CARE</span><h3>Your check-ins</h3></div><button class="wf-inline" data-tab="care">Open Care ↗</button></div>${careItems.length ? `<p>${careItems.length} item${careItems.length === 1 ? "" : "s"} in your list. Check the schedule you chose.</p>` : `<p>No care items yet. Add a supplement or medicine only if it is useful to you.</p>`}</section>`;
    return greeting + hero + `<div class="wf-two-col">${metrics}${care}</div>`;
  }
  function workoutForm(row) {
    const sets = row.payload.sets || [];
    const groups = [];
    sets.forEach((set, index) => {
      const key = set.exerciseId || `legacy:${set.exercise || "unnamed"}`;
      let group = groups.find((item) => item.key === key);
      if (!group) { group = { key, set, rows: [] }; groups.push(group); }
      group.rows.push({ set, index });
    });
    const rest = row.payload.status === "active" ? `<div class="wf-rest-timer" role="timer"><div><strong>Rest timer</strong><span id="wfRestTime">${restLabel(row)}</span></div><div class="wf-item-actions"><button data-action="rest-start" class="wf-inline">Start 90 sec</button><button data-action="rest-add" class="wf-inline">+30 sec</button><button data-action="rest-stop" class="wf-inline">Stop</button></div></div>` : "";
    return `<section class="wf-section wf-workout-editor"><span class="wf-kicker">${row.payload.status === "active" ? "ACTIVE WORKOUT" : "COMPLETED WORKOUT"}</span><h3>Record your sets</h3><label>Workout name<input id="wfWorkoutTitle" value="${esc(row.payload.title)}" maxlength="100"></label>${rest}<div id="wfSetRows">${groups.map((group) => {
      const name = exerciseName(group.set);
      const previous = rows("workout").filter((item) => item.record_id !== row.record_id && item.payload.status === "completed").flatMap((item) => item.payload.sets).find((set) => set.exerciseId ? set.exerciseId === group.set.exerciseId : set.exercise === group.set.exercise);
      const mode = exercise(group.set.exerciseId)?.mode || "load_reps";
      return `<div class="wf-set-group"><div class="wf-set-group-head">${thumb(group.set.exerciseId)}<div><strong>${esc(name)}</strong><small>${esc(mode.replaceAll("_", " "))}${previous ? ` · Last: ${esc(previous.reps)} reps / ${esc(displayWeight(previous.weightKg))} ${weightUnit()}` : " · No previous set"}</small></div>${group.set.exerciseId ? `<button data-action="show-form" data-id="${esc(group.set.exerciseId)}" class="wf-inline">Show form</button>` : ""}</div>${group.rows.map(({ set, index }, groupIndex) => `<div class="wf-set-row"><span class="wf-set-number">${groupIndex + 1}</span>${set.exerciseId ? "" : `<label>Exercise <input data-set="${index}" data-field="exercise" value="${esc(set.exercise)}" placeholder="Exercise"></label>`}<label>Reps <input data-set="${index}" data-field="reps" type="number" inputmode="numeric" min="0" max="1000" value="${esc(set.reps)}"></label>${mode === "duration_distance" || mode === "timed_hold" || mode === "reps_duration" ? `<label>Seconds <input data-set="${index}" data-field="durationSec" type="number" min="0" max="86400" value="${esc(set.durationSec || 0)}"></label>` : ""}${mode === "duration_distance" ? `<label>Distance km <input data-set="${index}" data-field="distanceKm" type="number" min="0" max="1000" step="0.01" value="${esc(set.distanceKm || 0)}"></label>` : ""}${mode === "load_reps" ? `<label>Weight ${weightUnit()} <input data-set="${index}" data-field="weightKg" type="number" inputmode="decimal" min="0" max="2200" step="0.1" value="${esc(displayWeight(set.weightKg))}"></label>` : ""}<label class="wf-complete"><input data-set="${index}" data-field="warmup" type="checkbox" ${set.warmup ? "checked" : ""}> Warm-up</label><label class="wf-complete"><input data-set="${index}" data-field="complete" type="checkbox" ${set.complete ? "checked" : ""}> Done</label><button data-action="duplicate-set" data-set="${index}" class="wf-inline">Duplicate</button><button data-action="remove-set" data-set="${index}" class="wf-inline">Remove</button></div>`).join("")}<button data-action="add-set" data-exercise="${esc(group.set.exerciseId || "")}" class="wf-inline">+ Add set</button></div>`;
    }).join("")}</div><div class="wf-actions"><button data-action="open-library" class="wf-secondary">Browse exercises</button><button data-action="save-routine" class="wf-secondary">Save as routine</button>${row.payload.status === "active" ? `<button data-action="finish-workout" class="wf-primary">Finish workout</button>` : `<button data-action="save-completed" class="wf-primary">Save corrections</button>`}</div><p class="wf-note">Online changes sync to your account. Offline changes remain unencrypted in this browser until synced; do not sign out with pending work.</p></section>`;
  }
  function libraryView() {
    const all = catalog();
    const categories = [...new Set(all.map((item) => item.category))].sort();
    const q = state.query.trim().toLowerCase();
    const filtered = all.filter((item) => (!q || `${item.name} ${item.id}`.toLowerCase().includes(q)) && (!state.category || item.category === state.category));
    const ordered = filtered.sort((a, b) => Number(favorites().has(b.id)) - Number(favorites().has(a.id)) || a.name.localeCompare(b.name));
    return `<div class="wf-heading"><div><span class="wf-kicker">EXERCISE LIBRARY</span><h2>Find your movement.</h2><p>All ${all.length} exercises remain searchable. Illustrations identify movements; technique review is pending.</p></div><button data-action="train-overview" class="wf-secondary">Back to Train</button></div><section class="wf-section"><div class="wf-library-controls"><label>Search<input id="wfExerciseSearch" value="${esc(state.query)}" placeholder="Name or ID" autocomplete="off"></label><label>Category<select id="wfCategory"><option value="">All categories</option>${categories.map((category) => `<option value="${esc(category)}" ${state.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label></div><p>${ordered.length} matching exercises · ${Math.min(state.shown, ordered.length)} shown</p><div class="wf-exercise-grid">${ordered.slice(0, state.shown).map((item) => `<article class="wf-exercise-card">${thumb(item.id)}<div><strong>${esc(item.name)}</strong><small>${esc(item.category)} · ${esc(item.mode.replaceAll("_", " "))}</small><div class="wf-item-actions"><button data-action="exercise-detail" data-id="${esc(item.id)}" class="wf-inline">Details</button><button data-action="toggle-favorite" data-id="${esc(item.id)}" class="wf-inline" aria-pressed="${favorites().has(item.id)}">${favorites().has(item.id) ? "★ Saved" : "☆ Save"}</button><label class="wf-select-exercise"><input data-select-exercise="${esc(item.id)}" type="checkbox" ${state.selected.has(item.id) ? "checked" : ""}> Select</label></div></div></article>`).join("")}</div>${state.shown < ordered.length ? `<button data-action="show-more" class="wf-secondary">Show more (${ordered.length - state.shown} remaining)</button>` : ""}<button data-action="add-selected" class="wf-primary">Add selected to workout (${state.selected.size})</button></section><section class="wf-section"><h3>Create a personal exercise</h3><form id="wfCustomExerciseForm" class="wf-form-grid"><label>Name<input name="name" required maxlength="100"></label><label>Mode<select name="mode"><option value="load_reps">Weight and reps</option><option value="bodyweight_reps">Bodyweight reps</option><option value="timed_hold">Timed hold</option><option value="reps_duration">Reps and time</option><option value="duration_distance">Time and distance</option></select></label><button class="wf-secondary" type="submit">Add custom exercise</button></form></section>`;
  }
  function exerciseDetailView() {
    const item = exercise(state.detailId);
    if (!item) return libraryView();
    const media = window.WFMedia?.get(item.id);
    const history = rows("workout").filter((row) => row.payload.sets.some((set) => set.exerciseId === item.id));
    return `<div class="wf-heading"><div><span class="wf-kicker">${esc(item.category)} · ${esc(item.id)}</span><h2>${esc(item.name)}</h2><p>${esc(item.mode.replaceAll("_", " "))}</p></div><button data-action="open-library" class="wf-secondary">Back to library</button></div><section class="wf-section"><div class="wf-detail-media">${media?.start?.path ? `<figure><img src="${esc(media.start.path)}" width="${media.start.width}" height="${media.start.height}" alt="${esc(media.alt)}"><figcaption>Pose A illustration</figcaption></figure>` : `<p class="wf-media-fallback">Demonstration unavailable.</p>`}${media?.end?.path ? `<figure><img src="${esc(media.end.path)}" width="${media.end.width}" height="${media.end.height}" alt="${esc(media.alt)}"><figcaption>Pose B illustration</figcaption></figure>` : ""}</div><p class="wf-note">Visual reference only; technique review pending. These poses are not a motion demonstration.</p>${media ? `<p class="wf-note">${esc(media.requiredCredit)} · <a href="${esc(media.licenseUrl)}" target="_blank" rel="noopener">License</a></p>` : ""}<div class="wf-actions"><button data-action="add-exercise" data-id="${esc(item.id)}" class="wf-primary">Add to workout</button><button data-action="toggle-favorite" data-id="${esc(item.id)}" class="wf-secondary">${favorites().has(item.id) ? "Remove favorite" : "Save favorite"}</button></div></section><section class="wf-section"><h3>Your history</h3>${history.length ? history.slice(0, 10).map((row) => `<p>${shortDate(row.occurred_at)} · ${row.payload.sets.filter((set) => set.exerciseId === item.id && set.complete).length} completed sets</p>`).join("") : `<p class="wf-empty">No sessions yet for this exercise.</p>`}</section>`;
  }
  function exerciseProgressView() {
    const id = state.detailId;
    const item = exercise(id);
    if (!item) return "";
    const cutoff = state.exerciseRange === "all" ? 0 : Date.now() - Number(state.exerciseRange) * 86400000;
    const sessions = rows("workout").filter((row) => row.payload.status === "completed" && new Date(row.occurred_at).getTime() >= cutoff)
      .map((row) => ({ row, sets: row.payload.sets.filter((set) => set.exerciseId === id && set.complete && !set.warmup) }))
      .filter(({ sets }) => sets.length).sort((a, b) => a.row.occurred_at.localeCompare(b.row.occurred_at));
    const values = sessions.map(({ row, sets }) => ({ date: row.payload.legacyOriginalDate || dateKey(row.occurred_at),
      load: Math.max(...sets.map((set) => Number(set.weightKg || 0))),
      reps: Math.max(...sets.map((set) => Number(set.reps || 0))),
      volume: Math.round(sets.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0)),
      sets: sets.length }));
    const hasLoad = values.some((value) => value.load > 0);
    const metric = hasLoad ? "load" : "reps";
    const maximum = Math.max(1, ...values.map((value) => value[metric]));
    const shown = values.slice(-12);
    const bars = shown.map((value) => `<div class="wf-bar-column"><div class="wf-bar-track"><span style="height:${Math.round(value[metric] / maximum * 100)}%" title="${esc(value.date)}: ${esc(hasLoad ? displayWeight(value.load) + " " + weightUnit() : value.reps + " reps")}"></span></div><small>${shortDate(value.date + "T12:00:00")}</small></div>`).join("");
    const best = hasLoad ? `${displayWeight(Math.max(...values.map((value) => value.load)))} ${weightUnit()}` : `${Math.max(0, ...values.map((value) => value.reps))} reps`;
    return `<section class="wf-section"><div class="wf-section-head"><div><span class="wf-kicker">YOUR PROGRESS</span><h3>${esc(item.name)}</h3></div><div class="wf-period" role="group" aria-label="Exercise history range">${["30", "90", "all"].map((range) => `<button data-exercise-range="${range}" aria-pressed="${state.exerciseRange === range}">${range === "all" ? "All" : `${range} days`}</button>`).join("")}</div></div>${values.length ? `<p>Recorded best: <strong>${best}</strong>. Highest ${hasLoad ? "external load" : "reps"} in a completed, non-warm-up set—not an estimated max. ${values.length} sessions in range.</p><div class="wf-bars" role="img" aria-label="Recorded ${hasLoad ? "load" : "repetitions"} by workout date">${bars}</div><details><summary>View exercise values</summary><table><thead><tr><th>Date</th><th>Working sets</th><th>Highest load</th><th>Highest reps</th><th>Load volume</th></tr></thead><tbody>${values.slice().reverse().map((value) => `<tr><td>${esc(value.date)}</td><td>${value.sets}</td><td>${value.load ? `${displayWeight(value.load)} ${weightUnit()}` : "—"}</td><td>${value.reps}</td><td>${value.volume ? `${displayWeight(value.volume)} ${weightUnit()} × reps` : "—"}</td></tr>`).join("")}</tbody></table></details>` : `<p class="wf-empty">No completed working sets in this period. Choose another range or record a session.</p>`}</section>`;
  }
  function finishView(row) {
    if (!row) return `<section class="wf-section"><p>Workout not found.</p><button data-action="train-overview" class="wf-secondary">Back to Train</button></section>`;
    const sets = row.payload.sets.filter((set) => set.complete);
    const exercises = new Set(sets.map((set) => set.exerciseId || set.exercise).filter(Boolean));
    const volume = Math.round(sets.filter((set) => !set.warmup).reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0));
    const minutes = row.payload.endedAt ? Math.max(0, Math.round((new Date(row.payload.endedAt) - new Date(row.occurred_at)) / 60000)) : null;
    return `<div class="wf-heading"><div><span class="wf-kicker">WORKOUT RECORDED</span><h2>${esc(row.payload.title)}</h2><p>${shortDate(row.occurred_at)} · ${esc(row.payload.source || "manual")}</p></div></div><section class="wf-section"><h3>Your session</h3><div class="wf-summary-grid">${card("Completed sets", sets.length, "Only sets marked done")}${card("Exercises", exercises.size, "Distinct logged exercises")}${card("Duration", minutes === null ? "Unknown" : `${minutes} min`, "From start and finish timestamps")}${card("Recorded load volume", `${volume} kg × reps`, "Excludes warm-ups and bodyweight")}</div><p class="wf-note">These are recorded values, not a calorie or strength estimate.</p><div class="wf-actions"><button data-action="view-workout" data-id="${row.record_id}" class="wf-primary">View or correct workout</button><button data-action="undo-finish" data-id="${row.record_id}" class="wf-secondary">Undo finish</button><button data-action="train-overview" class="wf-secondary">Back to Train</button></div></section>`;
  }
  function routineSection() {
    const routines = rows("routine");
    return `<section class="wf-section"><div class="wf-section-head"><h3>My routines</h3><span>${routines.length} saved</span></div>${routines.length ? `<div class="wf-list">${routines.map((routine) => `<article><div><strong>${esc(routine.payload.title)}</strong><small>${routine.payload.exerciseIds.length} exercises · Duration not estimated</small></div><div class="wf-item-actions"><button data-action="start-routine" data-id="${routine.record_id}" class="wf-inline">Start routine</button><button data-action="delete-routine" data-id="${routine.record_id}" class="wf-inline">Remove</button></div></article>`).join("")}</div>` : `<p class="wf-empty">Build a workout from the library, then save its exercises as a routine.</p>`}</section>`;
  }
  function trainView() {
    if (state.trainPage === "library") return libraryView();
    if (state.trainPage === "detail") return exerciseDetailView();
    if (state.trainPage === "finish") return finishView(state.records.find((row) => row.record_id === state.finishId));
    const active = rows("workout").find((item) => item.payload.status === "active");
    const history = rows("workout").filter((item) => item.payload.status === "completed");
    const editing = state.trainPage === "history" ? state.records.find((row) => row.record_id === state.historyId) : null;
    if (editing) return `<button data-action="train-overview" class="wf-secondary">Back to Train</button>${workoutForm(editing)}`;
    return `<div class="wf-heading"><div><span class="wf-kicker">TRAIN</span><h2>Your training, in one place.</h2><p>Explore the library, resume a session, and see what changed over time.</p></div></div><section class="wf-section"><div class="wf-section-head"><h3>Exercise library</h3><span>${catalog().length} movements</span></div><p>Search every movement, save favorites, and add exercises to your workout.</p><button data-action="open-library" class="wf-primary">Browse exercises</button></section>${active ? workoutForm(active) : `<section class="wf-hero wf-hero-small"><span class="wf-kicker">READY WHEN YOU ARE</span><h3>Start with one set.</h3><p>A simple workout is a good workout.</p><button data-action="start-workout" class="wf-primary">Start a workout</button></section>`}<section class="wf-section"><div class="wf-section-head"><h3>Recent workouts</h3><span>${history.length} recorded</span></div>${history.length ? `<div class="wf-list">${history.slice(0, 20).map((row, index) => `<article><div><strong>${esc(row.payload.title)}</strong><small>${shortDate(row.occurred_at)} · ${row.payload.sets.filter((set) => set.complete).length} completed sets · ${esc(row.payload.source || "manual")}${row.payload.endedAt ? ` · ${Math.max(1,Math.round((new Date(row.payload.endedAt) - new Date(row.occurred_at))/60000))} min` : ""}</small></div><div class="wf-item-actions"><button data-action="view-workout" data-id="${row.record_id}" class="wf-inline">View / correct</button><button data-action="reuse" data-id="${row.record_id}" class="wf-inline">Reuse</button>${index === 0 && !active ? `<button data-action="undo-finish" data-id="${row.record_id}" class="wf-inline">Undo finish</button>` : ""}</div></article>`).join("")}</div>` : `<p class="wf-empty">No workouts recorded yet. Your first one will appear here.</p>`}</section>`;
  }
  function trendsView() {
    const days = Array.from({ length: state.range }, (_, offset) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (state.range - 1 - offset)); return dateKey(date); });
    const amounts = days.map((day) => rows("water").filter((item) => dateKey(item.occurred_at) === day).reduce((total, item) => total + Number(item.payload.amountMl || 0), 0));
    const maximum = Math.max(500, ...amounts);
    const bars = days.map((day, index) => `<div class="wf-bar-column"><div class="wf-bar-track"><span style="height:${Math.max(0, Math.round(amounts[index] / maximum * 100))}%" title="${esc(day)}: ${amounts[index]} ml"></span></div><small>${shortDate(day + "T12:00:00")}</small></div>`).join("");
    const total = amounts.reduce((a, b) => a + b, 0);
    const completed = rows("workout").filter((item) => item.payload.status === "completed");
    const ids = [...new Set(completed.flatMap((item) => item.payload.sets.map((set) => set.exerciseId).filter(Boolean)))];
    const selectedId = ids.includes(state.trendExerciseId) ? state.trendExerciseId : "";
    const working = days.map((day) => completed.filter((item) => dateKey(item.occurred_at) === day).flatMap((item) => item.payload.sets)
      .filter((set) => set.complete && !set.warmup && (!selectedId || set.exerciseId === selectedId)));
    const setCounts = working.map((sets) => sets.length);
    const volumes = working.map((sets) => Math.round(sets.reduce((sum, set) => sum + Number(set.weightKg || 0) * Number(set.reps || 0), 0)));
    const chartMax = Math.max(1, ...setCounts);
    const trainBars = days.map((day, index) => `<div class="wf-bar-column"><div class="wf-bar-track"><span style="height:${Math.round(setCounts[index] / chartMax * 100)}%" title="${esc(day)}: ${setCounts[index]} working sets"></span></div><small>${shortDate(day + "T12:00:00")}</small></div>`).join("");
    const trainSection = `<section class="wf-section"><div class="wf-section-head"><div><span class="wf-kicker">TRAINING · MANUAL</span><h3>${setCounts.reduce((a, b) => a + b, 0)} working sets</h3></div><label>Exercise <select id="wfTrendExercise"><option value="">All recorded</option>${ids.map((id) => `<option value="${esc(id)}" ${selectedId === id ? "selected" : ""}>${esc(exercise(id)?.name || id)}</option>`).join("")}</select></label></div><p>Completed non-warm-up sets. Recorded load volume is weight × reps, not total work or a strength estimate. Days without entries are gaps.</p><div class="wf-bars" role="img" aria-label="Completed working sets by day">${trainBars}</div><details><summary>View training values</summary><table><thead><tr><th>Date</th><th>Working sets</th><th>Recorded load volume (kg × reps)</th></tr></thead><tbody>${days.map((day, index) => `<tr><td>${day}</td><td>${setCounts[index] || "No record"}</td><td>${volumes[index] || "—"}</td></tr>`).join("")}</tbody></table></details></section>`;
    const samples = rows("health_sample").filter((item) => !item.payload.deleted);
    const sampleTable = samples.length ? `<div class="wf-list">${samples.slice(0, 20).map((item) => `<article><div><strong>${esc(item.payload.metricType.replaceAll("_", " "))}: ${esc(item.payload.value)} ${esc(item.payload.unit)}</strong><small>${esc(new Date(item.payload.sampleStart).toLocaleString())} · ${esc(item.payload.sourceName || item.payload.sourceId)}</small></div></article>`).join("")}</div><p class="wf-note">Raw source samples are shown individually. Overlapping step or energy samples are not summed.</p>` : `<p class="wf-empty">No device samples yet. This web app cannot read Apple Health or Health Connect directly.</p>`;
    return `<div class="wf-heading"><div><span class="wf-kicker">TRENDS</span><h2>See what you recorded.</h2><p>Clear history, with its source and gaps visible.</p></div></div>${trainSection}<section class="wf-section"><div class="wf-section-head"><div><span class="wf-kicker">HYDRATION · MANUAL</span><h3>${total ? `${total} ml` : "No water records yet"}</h3></div><div class="wf-period" role="group" aria-label="Chart period"><button data-range="7" aria-pressed="${state.range === 7}">7 days</button><button data-range="30" aria-pressed="${state.range === 30}">30 days</button></div></div><p>${total ? `Total across ${state.range} calendar days. Blank days have no records; they are not measured zeroes.` : "Log water from Today to begin this chart."}</p><div class="wf-bars" role="img" aria-label="Water entries by day, ${total} millilitres total">${bars}</div><details><summary>View daily values</summary><table><thead><tr><th>Date</th><th>Recorded water</th></tr></thead><tbody>${days.map((day, index) => `<tr><td>${esc(day)}</td><td>${amounts[index] ? `${amounts[index]} ml` : "No record"}</td></tr>`).join("")}</tbody></table></details></section><section class="wf-section"><h3>Device measurements</h3>${sampleTable}</section>`;
  }
  function careView() {
    const items = rows("care_item");
    const logs = rows("care_log");
    const scheduled = items.filter((item) => !item.payload.paused && item.payload.times?.length);
    const doneToday = scheduled.filter((item) => logs.some((log) => log.payload.itemId === item.record_id && dateKey(log.occurred_at) === today()));
    const due = `<section class="wf-section"><div class="wf-section-head"><div><span class="wf-kicker">TODAY</span><h3>Due today</h3></div><span>${Math.max(0, scheduled.length - doneToday.length)} open · ${doneToday.length} checked in</span></div><p>${scheduled.length ? "These times are your own schedule. Open an item below to record what happened." : "No scheduled items. As-needed items remain available below."}</p></section>`;
    const editing = state.records.find((row) => row.record_id === state.editCareId);
    const form = `<section class="wf-section"><span class="wf-kicker">${editing ? "EDIT ITEM" : "ADD AN ITEM"}</span><h3>${editing ? "Update your item" : "What would you like to track?"}</h3><form id="wfCareForm" class="wf-form-grid"><label>Name<input name="name" required maxlength="100" value="${esc(editing?.payload.name || "")}" placeholder="Your item name"></label><label>Type<select name="type"><option value="supplement" ${editing?.payload.type !== "medicine" ? "selected" : ""}>Supplement</option><option value="medicine" ${editing?.payload.type === "medicine" ? "selected" : ""}>Medicine</option></select></label><label>Daily time (optional)<input name="time" type="time" value="${esc(editing?.payload.times?.[0] || "")}"></label><label class="wf-wide">Your instructions<textarea name="instructions" maxlength="500" placeholder="Only your own directions; no dose suggestions">${esc(editing?.payload.instructions || "")}</textarea></label><button class="wf-primary" type="submit">${editing ? "Save changes" : "Add item"}</button>${editing ? `<button class="wf-secondary" data-action="cancel-care-edit" type="button">Cancel</button>` : ""}</form><p class="wf-note">This is a personal log, not medical advice. Browser reminders are not scheduled here.</p></section>`;
    const list = items.length ? `<div class="wf-list">${items.map((item) => {
      const last = logs.find((log) => log.payload.itemId === item.record_id && dateKey(log.occurred_at) === today());
      return `<article><div><strong>${esc(item.payload.name)}</strong><small>${esc(item.payload.type)} · ${item.payload.times?.length ? `Daily ${esc(item.payload.times.join(", "))}` : "As needed"}${item.payload.paused ? " · Paused" : ""}</small>${item.payload.instructions ? `<p>${esc(item.payload.instructions)}</p>` : ""}${last ? `<small>Today: ${esc(last.payload.status)} at ${new Date(last.occurred_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>` : ""}</div><div class="wf-item-actions"><button data-action="log-care" data-id="${item.record_id}" class="wf-inline">Log taken</button><button data-action="skip-care" data-id="${item.record_id}" class="wf-inline">Skip</button>${last ? `<button data-action="undo-care" data-id="${last.record_id}" class="wf-inline">Undo</button>` : ""}<button data-action="edit-care" data-id="${item.record_id}" class="wf-inline">Edit</button><button data-action="pause-care" data-id="${item.record_id}" class="wf-inline">${item.payload.paused ? "Resume" : "Pause"}</button><button data-action="delete-care" data-id="${item.record_id}" class="wf-inline">Remove</button></div></article>`;
    }).join("")}</div>` : `<p class="wf-empty">No items yet. You can add one above whenever you want.</p>`;
    const history = logs.length ? `<section class="wf-section"><h3>Recent check-ins</h3><div class="wf-list">${logs.slice(0, 20).map((log) => {
      const item = items.find((row) => row.record_id === log.payload.itemId);
      return `<article><div><strong>${esc(item?.payload.name || "Removed item")}</strong><small>${shortDate(log.occurred_at)} · ${new Date(log.occurred_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${esc(log.payload.status)} · User-entered</small></div></article>`;
    }).join("")}</div></section>` : "";
    return `<div class="wf-heading"><div><span class="wf-kicker">CARE</span><h2>A quiet checklist.</h2><p>Your own instructions and check-ins, in one place.</p></div></div>${due}${form}<section class="wf-section"><h3>My items</h3>${list}</section>${history}`;
  }
  function youView() {
    const p = profile();
    const source = rows("health_sample").filter((item) => !item.payload.deleted).sort((a, b) => b.payload.sampleEnd.localeCompare(a.payload.sampleEnd))[0];
    const sourceText = source ? `Most recent uploaded measurement: ${shortDate(source.payload.sampleEnd)} from ${source.payload.sourceName || source.payload.sourceId}. This does not prove a device is currently connected.` : "No uploaded device measurements. Apple Health and Health Connect require native apps.";
    return `<div class="wf-heading"><div><span class="wf-kicker">YOU</span><h2>Make this yours.</h2><p>Only the information you choose to add.</p></div></div><section class="wf-section"><h3>Preferences</h3><form id="wfProfileForm" class="wf-form-grid"><label>Display name<input name="displayName" maxlength="80" value="${esc(p.displayName || "")}" placeholder="Optional"></label><label>Units<select name="unit"><option value="metric" ${p.unit !== "imperial" ? "selected" : ""}>Metric</option><option value="imperial" ${p.unit === "imperial" ? "selected" : ""}>Imperial</option></select></label><label class="wf-wide">Your interests <select name="interest">${["General fitness", "Strength", "Cardio", "Daily wellness"].map((interest) => `<option value="${interest}" ${p.interests?.includes(interest) ? "selected" : ""}>${interest}</option>`).join("")}</select></label><button class="wf-primary" type="submit">Save preferences</button></form><p class="wf-note">Timezone: ${esc(p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}</p></section><section class="wf-section"><h3>Your data</h3><p>Workouts, water and care entries are saved to your account. You can export all records as JSON.</p><button data-action="export" class="wf-secondary">Export my records</button><p class="wf-note">Pending edits are stored unencrypted in this browser. Sign out clears the local copy after you confirm.</p></section>${state.account.legacyOwner ? `<section class="wf-section"><h3>Legacy workspace</h3><p>Your original planner, notes, Codeforces and quant features remain available here.</p><button data-action="legacy" class="wf-secondary">Open private workspace</button></section>` : ""}<section class="wf-section"><h3>Device sources</h3><p>${esc(sourceText)}</p></section><section class="wf-section"><h3>About · Media credits</h3><p>Exercise illustrations are identification references, not reviewed coaching.</p><details><summary>View media credits</summary><p><a href="https://repdb.co/" target="_blank" rel="noopener">Exercise data by RepDB (repdb.co)</a></p>${window.WFMedia?.credits().map((credit) => `<p>${esc(credit.exerciseId)} · ${esc(credit.creator)} · <a href="${esc(credit.sourcePage)}" target="_blank" rel="noopener">Source</a> · <a href="${esc(credit.licenseUrl)}" target="_blank" rel="noopener">License</a> · ${esc(credit.changes)}</p>`).join("") || ""}</details></section>`;
  }
  function render() {
    const views = { today: todayView, train: trainView, trends: trendsView, care: careView, you: youView };
    $("consumerContent").innerHTML = views[state.tab]();
    if (state.tab === "train" && state.trainPage === "overview") $("consumerContent").insertAdjacentHTML("beforeend", routineSection());
    if (state.tab === "train" && state.trainPage === "detail") $("consumerContent").insertAdjacentHTML("beforeend", exerciseProgressView());
    if (state.tab === "train" && state.trainPage === "detail") {
      const missing = $("consumerContent").querySelector(".wf-detail-media .wf-media-fallback");
      const item = exercise(state.detailId);
      if (missing && item) {
        const figure = document.createElement("figure");
        const picture = document.createElement("img");
        picture.src = catalogArtwork(item);
        picture.alt = `Decorative catalog artwork for ${item.name}; no form image available`;
        const caption = document.createElement("figcaption"); caption.textContent = "Catalog artwork — not a form demonstration";
        figure.append(picture, caption);
        missing.replaceWith(figure);
        const note = $("consumerContent").querySelector(".wf-detail-media + .wf-note");
        if (note) note.textContent = "An exact exercise illustration is not available yet. This artwork does not show technique or movement.";
      }
    }
    if (state.tab === "train" && state.trainPage === "library") {
      const intro = $("consumerContent").querySelector(".wf-heading p");
      if (intro) intro.textContent = "All exercises are searchable. Exact illustrations are shown where available; catalog artwork elsewhere is not a form guide.";
    }
    document.querySelectorAll(".wf-set-group").forEach((group) => {
      const setRows = [...group.querySelectorAll(".wf-set-row")];
      if (setRows.length < 2) return;
      setRows.forEach((setRow, position) => {
        const index = setRow.querySelector("[data-set]")?.dataset.set;
        const controls = document.createElement("span"); controls.className = "wf-item-actions";
        if (position > 0) controls.innerHTML += `<button type="button" data-action="move-set-up" data-set="${index}" class="wf-inline" aria-label="Move set ${position + 1} up">↑ Move up</button>`;
        if (position < setRows.length - 1) controls.innerHTML += `<button type="button" data-action="move-set-down" data-set="${index}" class="wf-inline" aria-label="Move set ${position + 1} down">↓ Move down</button>`;
        setRow.appendChild(controls);
      });
    });
    const active = rows("workout").find((item) => item.payload.status === "active");
    const bar = $("consumerActiveBar");
    bar.hidden = !active || (state.tab === "train" && state.trainPage === "overview");
    if (active) bar.innerHTML = `<span><strong>Workout in progress</strong> · ${esc(active.payload.title)} · ${active.payload.sets.filter((set) => set.complete).length} sets done</span><button class="wf-inline" data-action="resume">Resume</button>`;
    tickRest();
    if (state.tab === "you" && !state.account.legacyOwner && !state.development) {
      $("consumerContent").insertAdjacentHTML("beforeend", `<section class="wf-section"><h3>Delete account</h3><p>This permanently deletes your account and the health records stored under it. Export first if you need a copy.</p><form id="wfDeleteForm" class="wf-form-grid"><label class="wf-wide">Type DELETE MY ACCOUNT<input name="confirm" autocomplete="off" required></label><button type="submit" class="wf-secondary">Delete my account</button></form></section>`);
    }
    if (state.tab === "you" && rows("health_sample").length) {
      $("consumerContent").insertAdjacentHTML("beforeend", `<section class="wf-section"><h3>Imported device data</h3><p>Remove uploaded device measurements from this account. This does not change Apple Health or Health Connect on your device.</p><button data-action="delete-imported" class="wf-secondary">Remove imported measurements</button></section>`);
    }
  }
  async function addExercise(id) {
    const item = exercise(id);
    if (!item) throw new Error("Exercise was not found.");
    clearTimeout(state.timer); state.timer = null;
    let active = rows("workout").find((row) => row.payload.status === "active");
    if (!active) active = await save("workout", { title: "My workout", sets: [], status: "active", notes: "" });
    const sets = active.payload.sets.filter((set) => set.exercise || set.exerciseId);
    sets.push(setTemplate(item));
    await save("workout", { ...active.payload, sets }, active.record_id, active.occurred_at);
  }
  async function action(button) {
    const name = button.dataset.action;
    if (name === "open-library") { state.trainPage = "library"; state.scroll.train = 0; select("train"); }
    if (name === "train-overview") { state.trainPage = "overview"; state.scroll.train = 0; select("train"); }
    if (name === "show-more") { state.shown += 30; render(); }
    if (name === "exercise-detail") { state.detailId = button.dataset.id; state.trainPage = "detail"; state.scroll.train = 0; select("train"); }
    if (name === "toggle-favorite") {
      const existing = rows("favorite").find((row) => row.payload.exerciseId === button.dataset.id);
      if (existing) await remove(existing.record_id, false);
      else await save("favorite", { exerciseId: button.dataset.id });
      if (button.isConnected) { button.textContent = existing ? "☆ Save" : "★ Saved"; button.setAttribute("aria-pressed", existing ? "false" : "true"); }
    }
    if (name === "add-selected") {
      for (const id of state.selected) await addExercise(id);
      state.selected.clear(); state.trainPage = "overview"; select("train");
    }
    if (name === "add-exercise") { await addExercise(button.dataset.id); state.trainPage = "overview"; select("train"); }
    if (name === "show-form") {
      state.detailId = button.dataset.id;
      const item = exercise(state.detailId); const media = window.WFMedia?.get(state.detailId);
      const dialog = $("wfFormDialog");
      if (dialog) dialog.remove();
      const node = document.createElement("dialog"); node.id = "wfFormDialog"; node.className = "wf-form-dialog";
      node.innerHTML = `<div class="wf-section-head"><h3>${esc(item?.name || "Form reference")}</h3><button class="wf-secondary" data-close-form>Close</button></div><div class="wf-detail-media">${media?.start?.path ? `<figure><img src="${esc(media.start.path)}" alt="${esc(media.alt)}"><figcaption>Pose A</figcaption></figure>` : ""}${media?.end?.path ? `<figure><img src="${esc(media.end.path)}" alt="${esc(media.alt)}"><figcaption>Pose B</figcaption></figure>` : ""}</div><p>Visual reference only. Technique review pending; no video demonstration available.</p>`;
      document.body.appendChild(node);
      node.querySelector("[data-close-form]").addEventListener("click", () => node.close());
      node.addEventListener("close", () => { node.remove(); button.focus(); });
      node.showModal();
    }
    if (name === "save-routine") {
      const row = state.trainPage === "history" ? state.records.find((item) => item.record_id === state.historyId) : rows("workout").find((item) => item.payload.status === "active");
      const exerciseIds = [...new Set((row?.payload.sets || []).map((set) => set.exerciseId).filter(Boolean))];
      if (!exerciseIds.length) { status("Add a catalog or custom exercise before saving a routine.", "error"); return; }
      const node = document.createElement("dialog"); node.className = "wf-form-dialog";
      node.innerHTML = `<form method="dialog" class="wf-form-grid"><h3 class="wf-wide">Save your routine</h3><label class="wf-wide">Name<input name="title" maxlength="100" value="${esc(row.payload.title)}" required></label><p class="wf-wide">${exerciseIds.length} exercises · sets and past values remain in your session, not the routine.</p><button value="save" class="wf-primary">Save routine</button><button value="cancel" class="wf-secondary">Cancel</button></form>`;
      document.body.appendChild(node);
      node.addEventListener("close", async () => {
        const title = node.querySelector('[name="title"]').value.trim();
        const accepted = node.returnValue === "save";
        node.remove(); button.focus();
        if (accepted && title) { try { await save("routine", { title, exerciseIds }); render(); } catch (error) { status(error.message, "error"); } }
      });
      node.showModal(); node.querySelector('[name="title"]').focus();
    }
    if (name === "start-routine") {
      if (rows("workout").some((item) => item.payload.status === "active")) { status("Finish your active workout before starting another.", "error"); return; }
      const routine = state.records.find((item) => item.record_id === button.dataset.id && item.kind === "routine");
      if (!routine) return;
      const items = routine.payload.exerciseIds.map(exercise);
      if (items.some((item) => !item)) { status("One routine exercise is missing. Edit the routine before starting.", "error"); return; }
      await save("workout", { title: routine.payload.title, sets: items.map(setTemplate), status: "active", notes: "" });
      state.trainPage = "overview"; select("train");
    }
    if (name === "delete-routine" && confirm("Remove this routine? Past workout records will stay.")) await remove(button.dataset.id);
    if (name === "view-workout") { state.historyId = button.dataset.id; state.trainPage = "history"; state.scroll.train = 0; select("train"); }
    if (name === "water") {
      state.waterOpen = true; render(); $("wfWaterForm")?.elements.amountMl.focus();
    }
    if (name === "cancel-water") { state.waterOpen = false; render(); }
    if (name === "start-workout" || name === "reuse") {
      const active = rows("workout").find((item) => item.payload.status === "active");
      if (active) { state.trainPage = "overview"; select("train"); return; }
      const previous = name === "reuse" ? state.records.find((row) => row.record_id === button.dataset.id) : null;
      const template = previous ? previous.payload.sets.map((set) => ({ ...set, setId: crypto.randomUUID(), complete: false })) : [{ setId: crypto.randomUUID(), exercise: "", reps: 0, weightKg: 0, complete: false }];
      const row = await save("workout", { title: previous?.payload.title || "My workout", sets: template, status: "active", notes: "" });
      state.activeId = row.record_id; state.trainPage = "overview"; select("train");
    }
    if (name === "resume") select("train");
    if (name === "add-set") {
      clearTimeout(state.timer); state.timer = null;
      const row = state.trainPage === "history" ? state.records.find((item) => item.record_id === state.historyId) : rows("workout").find((item) => item.payload.status === "active");
      if (!row) return;
      const previous = button.dataset.exercise ? row.payload.sets.find((set) => set.exerciseId === button.dataset.exercise) : row.payload.sets.at(-1);
      row.payload.sets.push({ ...(previous || { exercise: "", reps: 0, weightKg: 0 }), setId: crypto.randomUUID(), complete: false });
      await save("workout", row.payload, row.record_id, row.occurred_at); render();
    }
    if (name === "duplicate-set" || name === "remove-set") {
      clearTimeout(state.timer); state.timer = null;
      const row = rows("workout").find((item) => item.payload.status === "active") || state.records.find((item) => item.record_id === state.historyId);
      const index = Number(button.dataset.set);
      if (name === "duplicate-set") row.payload.sets.splice(index + 1, 0, { ...row.payload.sets[index], setId: crypto.randomUUID(), complete: false });
      else row.payload.sets.splice(index, 1);
      await save("workout", row.payload, row.record_id, row.occurred_at); render();
    }
    if (name === "move-set-up" || name === "move-set-down") {
      clearTimeout(state.timer); state.timer = null;
      const row = state.trainPage === "history" ? state.records.find((item) => item.record_id === state.historyId) : rows("workout").find((item) => item.payload.status === "active");
      if (!row) return;
      const index = Number(button.dataset.set);
      const selected = row.payload.sets[index];
      if (!selected) return;
      const key = selected.exerciseId || `legacy:${selected.exercise || "unnamed"}`;
      const peers = row.payload.sets.map((set, position) => ({ set, position })).filter(({ set }) => (set.exerciseId || `legacy:${set.exercise || "unnamed"}`) === key);
      const current = peers.findIndex((peer) => peer.position === index);
      const other = peers[current + (name === "move-set-up" ? -1 : 1)];
      if (!other) return;
      [row.payload.sets[index], row.payload.sets[other.position]] = [row.payload.sets[other.position], row.payload.sets[index]];
      await save("workout", row.payload, row.record_id, row.occurred_at); render();
    }
    if (["rest-start", "rest-add", "rest-stop"].includes(name)) {
      const row = rows("workout").find((item) => item.payload.status === "active");
      if (!row) return;
      const base = name === "rest-add" && row.payload.restUntil ? Math.max(Date.now(), new Date(row.payload.restUntil).getTime()) : Date.now();
      const restUntil = name === "rest-stop" ? null : new Date(base + (name === "rest-start" ? 90 : 30) * 1000).toISOString();
      await save("workout", { ...row.payload, restUntil }, row.record_id, row.occurred_at);
      render();
    }
    if (name === "finish-workout") {
      if (state.finishing) return;
      state.finishing = true;
      const row = rows("workout").find((item) => item.payload.status === "active");
      try {
        if (!row) return;
        clearTimeout(state.timer); state.timer = null;
        const saved = await save("workout", { ...row.payload, status: "completed", endedAt: now(), restUntil: null }, row.record_id, row.occurred_at);
        state.activeId = null; state.finishId = saved.record_id; state.trainPage = "finish";
        if (!state.pending.some((item) => item.body.recordId === saved.record_id)) status("Workout finished. Review your session below.");
        render();
      } finally { state.finishing = false; }
    }
    if (name === "undo-finish") {
      if (rows("workout").some((item) => item.payload.status === "active")) { status("Finish your active workout before reopening another.", "error"); return; }
      const row = state.records.find((item) => item.record_id === button.dataset.id);
      await save("workout", { ...row.payload, status: "active", endedAt: null }, row.record_id, row.occurred_at); state.trainPage = "overview"; render();
    }
    if (name === "save-completed") {
      clearTimeout(state.timer); state.timer = null;
      const row = state.records.find((item) => item.record_id === state.historyId);
      await save("workout", row.payload, row.record_id, row.occurred_at);
      status("Corrections saved."); render();
    }
    if (name === "log-care" || name === "skip-care") {
      const item = state.records.find((row) => row.record_id === button.dataset.id);
      const occurrenceId = item.payload.times?.[0] ? `${item.record_id}:${today()}:${item.payload.times[0]}` : null;
      const existing = occurrenceId ? rows("care_log").find((row) => row.payload.occurrenceId === occurrenceId) : null;
      await save("care_log", { itemId: button.dataset.id, status: name === "log-care" ? "taken" : "skipped", occurrenceId, source: "user-entered" }, existing?.record_id, existing?.occurred_at);
      render();
    }
    if (name === "undo-care") await remove(button.dataset.id);
    if (name === "edit-care") { state.editCareId = button.dataset.id; render(); $("wfCareForm")?.elements.name.focus(); }
    if (name === "cancel-care-edit") { state.editCareId = null; render(); }
    if (name === "pause-care") {
      const row = state.records.find((item) => item.record_id === button.dataset.id);
      await save("care_item", { ...row.payload, paused: !row.payload.paused }, row.record_id, row.occurred_at); render();
    }
    if (name === "delete-care" && confirm("Remove this item? Your past check-ins will remain in your export.")) await remove(button.dataset.id);
    if (name === "legacy") { document.body.classList.remove("consumer-mode"); document.body.classList.add("legacy-mode"); $("consumerShell").hidden = true; window.scrollTo(0, 0); }
    if (name === "export") {
      const all = [];
      let page = [];
      do {
        page = (await api("GET", null, `/api/consumer?offset=${all.length}`)).records;
        all.push(...page);
      } while (page.length === 300);
      const blob = new Blob([JSON.stringify({ exportedAt: now(), records: all }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `wellframe-export-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (name === "delete-imported" && confirm("Remove every uploaded device measurement from this account? This cannot be undone.")) {
      const result = await api("DELETE", { allImported: true });
      state.records = state.records.filter((row) => row.kind !== "health_sample");
      status(`${result.removed} imported measurements removed.`);
      render();
    }
  }
  async function start(account) {
    state.account = account;
    $("consumerShell").hidden = false;
    $("consumerSignOut").addEventListener("click", () => window.CFAuth.signOut());
    $("backToHealth")?.addEventListener("click", () => select("today"));
    $("consumerNav").addEventListener("click", (event) => { const button = event.target.closest("[data-consumer-tab]"); if (button) select(button.dataset.consumerTab); });
    $("consumerActiveBar").addEventListener("click", (event) => { if (event.target.closest('[data-action="resume"]')) { state.trainPage = "overview"; select("train"); } });
    $("consumerContent").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]"); if (tab) { select(tab.dataset.tab); return; }
      const range = event.target.closest("[data-range]"); if (range) { state.range = Number(range.dataset.range); render(); return; }
      const exerciseRange = event.target.closest("[data-exercise-range]"); if (exerciseRange) { state.exerciseRange = exerciseRange.dataset.exerciseRange; render(); return; }
      const button = event.target.closest("[data-action]"); if (button) action(button).catch((error) => status(error.message, "error"));
    });
    $("consumerContent").addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.target;
      try {
        if (form.id === "wfCareForm") {
          const existing = state.records.find((row) => row.record_id === state.editCareId);
          await save("care_item", { name: form.elements.name.value, type: form.elements.type.value, instructions: form.elements.instructions.value, times: form.elements.time.value ? [form.elements.time.value] : [], timezone: existing?.payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", paused: existing?.payload.paused || false }, existing?.record_id, existing?.occurred_at);
          state.editCareId = null;
        }
        if (form.id === "wfWaterForm") {
          await save("water", { amountMl: Number(form.elements.amountMl.value), source: "manual" });
          state.waterOpen = false;
        }
        if (form.id === "wfProfileForm") {
          const existing = rows("profile")[0];
          await save("profile", { displayName: form.elements.displayName.value, unit: form.elements.unit.value, interests: [form.elements.interest.value], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }, existing?.record_id, existing?.occurred_at);
        }
        if (form.id === "wfCustomExerciseForm") {
          await save("custom_exercise", { name: form.elements.name.value, mode: form.elements.mode.value, category: "Custom" });
          render();
          return;
        }
        if (form.id === "wfDeleteForm") {
          if (form.elements.confirm.value !== "DELETE MY ACCOUNT") { status("Type DELETE MY ACCOUNT exactly.", "error"); return; }
          const response = await fetch("/api/account", { method: "DELETE", headers: window.CFAuth.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }) });
          const result = await response.json();
          if (!response.ok || !result.deleted) throw new Error(result.error || "Deletion did not finish. Try again.");
          await window.CFAuth.signOut();
          return;
        }
        render();
      } catch (error) { status(error.message, "error"); }
    });
    $("consumerContent").addEventListener("input", (event) => {
      const element = event.target;
      if (element.id === "wfExerciseSearch") {
        const selectionStart = element.selectionStart;
        state.query = element.value; state.shown = 30; render();
        $("wfExerciseSearch").focus(); $("wfExerciseSearch").setSelectionRange(selectionStart, selectionStart);
        return;
      }
      if (!element.closest(".wf-workout-editor")) return;
      const row = state.trainPage === "history" ? state.records.find((item) => item.record_id === state.historyId) : rows("workout").find((item) => item.payload.status === "active");
      if (!row) return;
      if (element.id === "wfWorkoutTitle") row.payload.title = element.value;
      else if (element.dataset.set !== undefined) {
        const set = row.payload.sets[Number(element.dataset.set)];
        set[element.dataset.field] = element.dataset.field === "weightKg" ? canonicalWeight(element.value) : element.type === "checkbox" ? element.checked : element.type === "number" ? Number(element.value) : element.value;
      }
      state.pending = state.pending.filter((item) => item.body.recordId !== row.record_id).concat({ method: "POST", body: { recordId: row.record_id, kind: "workout", payload: clone(row.payload), occurredAt: row.occurred_at, expectedRevision: row.revision || 0 } });
      savePending();
      clearTimeout(state.timer);
      state.timer = setTimeout(() => save("workout", row.payload, row.record_id, row.occurred_at).catch((error) => status(error.message, "error")), 500);
    });
    $("consumerContent").addEventListener("change", (event) => {
      const element = event.target;
      if (element.id === "wfCategory") { state.category = element.value; state.shown = 30; render(); }
      if (element.id === "wfTrendExercise") { state.trendExerciseId = element.value; render(); }
      if (element.dataset.selectExercise) { if (element.checked) state.selected.add(element.dataset.selectExercise); else state.selected.delete(element.dataset.selectExercise); const button = $("consumerContent").querySelector('[data-action="add-selected"]'); if (button) button.textContent = `Add selected to workout (${state.selected.size})`; }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tickRest();
      if (document.hidden && state.timer) {
        clearTimeout(state.timer); state.timer = null;
        const row = rows("workout").find((item) => item.payload.status === "active");
        if (row) save("workout", row.payload, row.record_id, row.occurred_at).catch(() => {});
      }
    });
    setInterval(tickRest, 1000);
    window.addEventListener("online", flushPending);
    await window.WFMedia?.load();
    try { state.pending = JSON.parse(localStorage.getItem(pendingKey()) || "[]"); } catch { state.pending = []; }
    try { state.records = JSON.parse(localStorage.getItem(snapshotKey()) || "[]"); } catch { state.records = []; }
    overlayPending();
    select("today");
    try {
      const kinds = ["profile", "favorite", "custom_exercise", "routine", "care_item", "workout", "care_log", "water", "health_sample"];
      const responses = await Promise.all(kinds.map(async (kind) => {
        const collected = [];
        let page;
        do {
          page = (await api("GET", null, `/api/consumer?kind=${kind}&offset=${collected.length}`)).records || [];
          collected.push(...page);
        } while (page.length === 300 && kind !== "health_sample");
        return collected;
      }));
      state.records = responses.flat();
      state.development = Boolean((await api("GET", null, "/api/consumer?kind=profile&offset=0")).development);
      overlayPending();
      savePending();
    } catch (error) { status(`Offline view: ${error.message}`, "pending"); }
    await flushPending();
    select("today");
  }
  function clearLocal() {
    if (!state.account) return;
    localStorage.removeItem(pendingKey());
    localStorage.removeItem(snapshotKey());
  }
  window.CFConsumer = { start, select, clearLocal, hasPending: () => state.pending.length > 0 };
}());
