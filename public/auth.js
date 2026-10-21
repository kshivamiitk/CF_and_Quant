/* Supabase email authentication. Session tokens live in this tab's sessionStorage. */
(function () {
  const storageKey = "wellframe_auth_session";
  let session = null;
  let config = null;
  let recovery = false;
  const $ = (id) => document.getElementById(id);
  const read = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { return null; } };
  function write(value) {
    session = value;
    if (value) {
      if (!value.expires_at && value.expires_in) value.expires_at = Math.floor(Date.now() / 1000) + Number(value.expires_in);
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } else sessionStorage.removeItem(storageKey);
    updateControls();
  }
  async function loadConfig() {
    if (config) return config;
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    config = response.ok ? await response.json() : {};
    return config;
  }
  async function supabase(path, body, redirect = false) {
    const settings = await loadConfig();
    if (!settings.url || !settings.publishableKey) throw new Error("Sign-in is unavailable. Check the app setup.");
    const suffix = redirect ? `${path}${path.includes("?") ? "&" : "?"}redirect_to=${encodeURIComponent(location.origin + "/")}` : path;
    const response = await fetch(`${settings.url}/auth/v1/${suffix}`, {
      method: path === "user" ? "PUT" : "POST", headers: { apikey: settings.publishableKey, "Content-Type": "application/json", ...((path === "logout" || path === "user") && session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.error_description || result.message || "Please check your details and try again.");
    return result;
  }
  async function refresh() {
    const current = read();
    if (!current?.refresh_token) return null;
    try { const next = await supabase("token?grant_type=refresh_token", { refresh_token: current.refresh_token }); write(next); return next; }
    catch { write(null); return null; }
  }
  async function restore() {
    await consumeRedirect();
    session = read();
    if (session?.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60) await refresh();
    if (recovery) showLogin("Choose your new password.");
    else if (session?.access_token) hideLogin(); else showLogin();
    updateControls();
    return session;
  }
  async function ensureFresh() {
    if (session?.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60) await refresh();
    return session;
  }
  function headers(extra = {}) { return session?.access_token ? { ...extra, Authorization: `Bearer ${session.access_token}` } : { ...extra }; }
  function updateControls() { if ($("signOutButton")) $("signOutButton").hidden = !session?.access_token; }
  function showLogin(message = "Your effort. Clearly seen.") {
    if ($("authGate")) $("authGate").hidden = false;
    document.body.classList.remove("booting");
    document.body.classList.add("signed-out");
    if ($("authStatus")) $("authStatus").textContent = message;
  }
  function hideLogin() { if ($("authGate")) $("authGate").hidden = true; document.body.classList.remove("signed-out"); }
  function mode(value) {
    $("authForm").dataset.mode = value;
    $("authPasswordRow").hidden = value === "reset";
    $("authEmailRow").hidden = value === "newpassword";
    $("authForm").elements.email.required = value !== "newpassword";
    $("authForm").elements.password.required = value !== "reset";
    $("authSubmit").textContent = value === "signup" ? "Create account" : value === "reset" ? "Send reset link" : value === "newpassword" ? "Set new password" : "Sign in";
    $("authStatus").textContent = value === "signup" ? "Create an account with your email." : value === "reset" ? "We’ll send a reset link to your email." : value === "newpassword" ? "Choose a new password." : "Sign in to continue.";
    $("authResend").hidden = true;
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.setAttribute("aria-current", button.dataset.authMode === value ? "page" : "false"));
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = form.dataset.mode || "signin";
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const button = $("authSubmit");
    button.disabled = true;
    $("authStatus").textContent = "Working…";
    try {
      if (selected === "reset") {
        await supabase("recover", { email }, true);
        $("authStatus").textContent = "If this address has an account, check your email for a reset link.";
      } else if (selected === "newpassword") {
        await supabase("user", { password });
        recovery = false;
        hideLogin();
        location.reload();
      } else if (selected === "signup") {
        const result = await supabase("signup", { email, password }, true);
        if (result.access_token) { write(result); hideLogin(); location.reload(); }
        else { $("authStatus").textContent = "Check your email to confirm your account, then sign in."; $("authResend").hidden = false; }
      } else {
        const result = await supabase("token?grant_type=password", { email, password });
        write(result); hideLogin(); location.reload();
      }
    } catch (error) { $("authStatus").textContent = error.message; }
    finally { button.disabled = false; }
  }
  async function consumeRedirect() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.get("access_token") && fragment.get("refresh_token")) {
      write({ access_token: fragment.get("access_token"), refresh_token: fragment.get("refresh_token"),
              expires_in: Number(fragment.get("expires_in") || 3600) });
      if (fragment.get("type") === "recovery") { recovery = true; showLogin("Choose your new password."); mode("newpassword"); }
      history.replaceState({}, "", location.pathname + location.search);
    }
  }
  async function signOut() {
    if (window.CFConsumer?.hasPending?.() && !confirm("Some changes are not synced. Signing out will discard them from this browser. Continue?")) return;
    await window.CFConsumer?.disableReminders?.().catch(() => {});
    if (session?.access_token) supabase("logout", {}).catch(() => {});
    window.CFConsumer?.clearLocal?.();
    Object.keys(sessionStorage).filter((key) => key.startsWith("wf_pending_")).forEach((key) => sessionStorage.removeItem(key));
    write(null);
    location.reload();
  }
  window.CFAuth = { loadConfig, restore, ensureFresh, headers, showLogin, hideLogin, signOut, isAuthenticated: () => Boolean(session?.access_token), isRecovering: () => recovery };
  document.addEventListener("DOMContentLoaded", () => {
    $("authForm")?.addEventListener("submit", submit);
    $("authResend")?.addEventListener("click", async () => {
      const button = $("authResend"); button.disabled = true;
      try { await supabase("resend", { type: "signup", email: $("authForm").elements.email.value.trim() }, true); $("authStatus").textContent = "Confirmation email sent if this account is awaiting verification."; }
      catch (error) { $("authStatus").textContent = error.message; }
      setTimeout(() => { button.disabled = false; }, 60000);
    });
    $("signOutButton")?.addEventListener("click", signOut);
    $("authPasswordToggle")?.addEventListener("click", () => { const field = $("authForm").elements.password; field.type = field.type === "password" ? "text" : "password"; });
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => mode(button.dataset.authMode)));
    updateControls();
  });
}());
