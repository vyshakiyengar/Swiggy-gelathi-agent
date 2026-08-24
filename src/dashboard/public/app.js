"use strict";

const API_ROOT = "/api/dashboard";
const VALID_REPLY_MODES = new Set([
  "english",
  "kannada",
  "kanglish-kannada",
  "match-user",
]);
const VALID_SPICE = new Set(["mild", "medium", "hot", "ask"]);
const VALID_SUBSTITUTIONS = new Set([
  "ask-first",
  "allow-similar",
  "no-substitutions",
]);
const VALID_PACK_SIZES = new Set(["smallest", "regular", "value", "ask"]);

const state = {
  authenticated: false,
  profiles: [],
  activeId: null,
  original: null,
  draft: null,
  addresses: [],
  diagnostics: null,
  diagnosticChecks: [],
  readinessMode: "local",
  readinessOverall: "warning",
  dirty: false,
  activationVersion: 0,
  diagnosticRunVersion: 0,
  awaitingSwiggy: false,
  busy: new Set(),
  lastRetry: null,
  eventsBound: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  loginOverlay: $("#login-overlay"),
  loginForm: $("#login-form"),
  loginButton: $("#login-button"),
  loginError: $("#login-error"),
  password: $("#dashboard-password"),
  passwordVisibility: $("#password-visibility"),
  dashboard: $("#dashboard"),
  profileSelect: $("#profile-select"),
  profileInitial: $("#profile-initial"),
  profileContext: $("#profile-context"),
  logoutButton: $("#logout-button"),
  headerSave: $("#header-save"),
  saveState: $("#save-state"),
  globalError: $("#global-error"),
  globalErrorMessage: $("#global-error-message"),
  globalRetry: $("#global-retry"),
  readinessName: $("#readiness-name"),
  readinessSummary: $("#readiness-summary"),
  readinessStamp: $("#readiness-stamp"),
  readinessItems: $$("[data-readiness]"),
  profileForm: $("#profile-form"),
  displayName: $("#display-name"),
  relationship: $("#relationship"),
  whatsappNumber: $("#whatsapp-number"),
  assistantName: $("#assistant-name"),
  agentEnabled: $("#agent-enabled"),
  voiceReplies: $("#voice-replies"),
  instamart: $("#capability-instamart"),
  food: $("#capability-food"),
  spice: $("#spice-level"),
  substitutionPolicy: $("#substitution-policy"),
  packSize: $("#default-pack-size"),
  maxOrderValue: $("#max-order-value"),
  customInstructions: $("#custom-instructions"),
  instructionCount: $("#instruction-count"),
  previewBubble: $("#preview-bubble"),
  previewCaption: $("#preview-caption"),
  swiggyCard: $("#swiggy-card"),
  swiggyStatusLabel: $("#swiggy-status-label"),
  swiggyStatusTitle: $("#swiggy-status-title"),
  swiggyStatusDetail: $("#swiggy-status-detail"),
  swiggyLinkedAt: $("#swiggy-linked-at"),
  swiggyExpiresAt: $("#swiggy-expires-at"),
  swiggyConnect: $("#swiggy-connect"),
  swiggyDisconnect: $("#swiggy-disconnect"),
  syncAddresses: $("#sync-addresses"),
  addressState: $("#address-state"),
  addressList: $("#address-list"),
  addressEmpty: $("#address-empty"),
  addressTemplate: $("#address-template"),
  chipTemplate: $("#chip-template"),
  triagePanel: $("#triage-panel"),
  diagnosticState: $("#diagnostic-state"),
  triageSummary: $("#triage-summary"),
  runDiagnostics: $("#run-diagnostics"),
  diagnosticUpdated: $("#diagnostic-updated"),
  diagnosticLoading: $("#diagnostic-loading"),
  diagnosticList: $("#diagnostic-list"),
  diagnosticEmpty: $("#diagnostic-empty"),
  diagnosticTechnical: $("#diagnostic-technical"),
  diagnosticTemplate: $("#diagnostic-template"),
  copyDiagnostics: $("#copy-diagnostics"),
  sendTestPing: $("#send-test-ping"),
  resetConversation: $("#reset-conversation"),
  dirtyBar: $("#dirty-bar"),
  dirtyTitle: $("#dirty-title"),
  dirtyDetail: $("#dirty-detail"),
  discardButton: $("#discard-button"),
  saveButton: $("#save-button"),
  pageLoading: $("#page-loading"),
  loadingMessage: $("#loading-message"),
  confirmDialog: $("#confirm-dialog"),
  confirmTitle: $("#confirm-title"),
  confirmMessage: $("#confirm-message"),
  confirmCancel: $("#confirm-cancel"),
  confirmSecondary: $("#confirm-secondary"),
  confirmAccept: $("#confirm-accept"),
  toastRegion: $("#toast-region"),
};

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function bool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function authReasonMessage(reason, retryAfterSeconds) {
  switch (reason) {
    case "not_configured":
      return "Dashboard access is not configured. Set DASHBOARD_PASSWORD on the server first.";
    case "invalid_credentials":
      return "That password did not match.";
    case "rate_limited":
      return retryAfterSeconds
        ? `Too many attempts. Try again in about ${retryAfterSeconds} seconds.`
        : "Too many attempts. Wait a few minutes, then try again.";
    case "expired":
      return "Your dashboard session expired. Sign in again to continue.";
    case "invalid":
      return "Your dashboard session is no longer valid. Sign in again.";
    default:
      return "";
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    const clean = text(String(item ?? ""));
    if (clean && !unique.has(clean.toLocaleLowerCase("en-IN"))) {
      unique.set(clean.toLocaleLowerCase("en-IN"), clean);
    }
  }
  return [...unique.values()];
}

function normalizeReplyMode(value) {
  const candidate = text(String(value ?? "")).toLowerCase();
  if (VALID_REPLY_MODES.has(candidate)) return candidate;
  if (["bilingual", "both", "kanglish_kannada", "kanglish+kannada", "kanglish-kannada"].includes(candidate)) {
    return "kanglish-kannada";
  }
  if (["kn", "kannada-only"].includes(candidate)) return "kannada";
  return "english";
}

function normalizeSubstitution(value) {
  const candidate = text(String(value ?? "")).toLowerCase();
  if (VALID_SUBSTITUTIONS.has(candidate)) return candidate;
  if (["ask", "ask_before_replacing"].includes(candidate)) return "ask-first";
  if (["closest", "similar", "allow"].includes(candidate)) return "allow-similar";
  if (["never", "none"].includes(candidate)) return "no-substitutions";
  return "ask-first";
}

function normalizePackSize(value) {
  const candidate = text(String(value ?? "")).toLowerCase();
  if (VALID_PACK_SIZES.has(candidate)) return candidate;
  if (["best-value", "best_value"].includes(candidate)) return "value";
  return "smallest";
}

function normalizeSpice(value) {
  const candidate = text(String(value ?? "")).toLowerCase();
  return VALID_SPICE.has(candidate) ? candidate : "ask";
}

function normalizeAddress(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = text(String(firstDefined(raw.id, raw.swiggyAddressId, raw.addressId, "")));
  if (!id) return null;
  const formattedAddress = text(
    firstDefined(raw.formattedAddress, raw.address, raw.displayAddress, raw.fullAddress),
  );

  return {
    id,
    label: text(firstDefined(raw.label, raw.name, raw.type), "Saved address"),
    formattedAddress: formattedAddress || null,
    latitude: numberOrNull(firstDefined(raw.latitude, raw.lat)),
    longitude: numberOrNull(firstDefined(raw.longitude, raw.lng, raw.lon)),
  };
}

function normalizeProfile(raw) {
  const language = raw?.language && typeof raw.language === "object" ? raw.language : {};
  const capabilities =
    raw?.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {};
  const preferences =
    raw?.preferences && typeof raw.preferences === "object" ? raw.preferences : {};
  const swiggy = raw?.swiggy && typeof raw.swiggy === "object" ? raw.swiggy : {};
  const id = text(String(firstDefined(raw?.id, raw?.profileId, raw?.whatsappNumber, "")));

  return {
    id,
    label: text(firstDefined(raw?.label, raw?.relationship, raw?.displayName), "Profile"),
    relationship: text(
      firstDefined(raw?.relationship, raw?.label),
      id === "mother" ? "Mother" : id === "self" ? "You" : "Household profile",
    ),
    displayName: text(firstDefined(raw?.displayName, raw?.name), "Household member"),
    whatsappNumber:
      text(
        String(
          firstDefined(raw?.whatsappNumber, raw?.phoneE164, raw?.phone, raw?.number, ""),
        ),
      ) || null,
    assistantName: text(firstDefined(raw?.assistantName, raw?.agentName), "Sahayaka"),
    enabled: bool(raw?.enabled, true),
    language: {
      replyMode: normalizeReplyMode(
        firstDefined(language.replyMode, raw?.replyMode, raw?.replyLanguage, raw?.language),
      ),
      voiceReplies: bool(
        firstDefined(language.voiceReplies, raw?.voiceReplies, raw?.voiceEnabled),
        false,
      ),
    },
    capabilities: {
      instamart: bool(firstDefined(capabilities.instamart, raw?.instamartEnabled), true),
      food: bool(firstDefined(capabilities.food, raw?.foodEnabled), true),
    },
    address: normalizeAddress(firstDefined(raw?.address, raw?.deliveryAddress)),
    preferences: {
      dietary: stringArray(firstDefined(preferences.dietary, raw?.dietary)),
      preferredBrands: stringArray(
        firstDefined(preferences.preferredBrands, raw?.preferredBrands),
      ),
      avoidItems: stringArray(firstDefined(preferences.avoidItems, raw?.avoidItems)),
      substitutionPolicy: normalizeSubstitution(
        firstDefined(preferences.substitutionPolicy, raw?.substitutionPolicy),
      ),
      packSize: normalizePackSize(
        firstDefined(preferences.packSize, preferences.defaultPackSize, raw?.packSize),
      ),
      spice: normalizeSpice(
        firstDefined(preferences.spice, preferences.spiceLevel, raw?.spice),
      ),
      maxOrderValueInr: numberOrNull(
        firstDefined(
          preferences.maxOrderValueInr,
          preferences.maxOrderValue,
          raw?.maxOrderValueInr,
        ),
      ),
    },
    customInstructions: text(
      firstDefined(raw?.customInstructions, preferences.customInstructions, raw?.instructions),
      "",
    ),
    swiggy: {
      connected: bool(firstDefined(swiggy.connected, raw?.swiggyConnected), false),
      expiresAt: firstDefined(swiggy.expiresAt, raw?.swiggyExpiresAt) || null,
    },
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
  };
}

function editablePayload(profile) {
  return {
    displayName: text(profile.displayName),
    whatsappNumber: text(profile.whatsappNumber || "") || null,
    assistantName: text(profile.assistantName, "Sahayaka"),
    enabled: Boolean(profile.enabled),
    language: {
      replyMode: normalizeReplyMode(profile.language?.replyMode),
      voiceReplies: Boolean(profile.language?.voiceReplies),
    },
    capabilities: {
      instamart: Boolean(profile.capabilities?.instamart),
      food: Boolean(profile.capabilities?.food),
    },
    address: profile.address
      ? {
          id: String(profile.address.id),
          label: text(profile.address.label, "Saved address"),
          formattedAddress: text(profile.address.formattedAddress) || null,
          latitude: numberOrNull(profile.address.latitude),
          longitude: numberOrNull(profile.address.longitude),
        }
      : null,
    preferences: {
      dietary: stringArray(profile.preferences?.dietary),
      preferredBrands: stringArray(profile.preferences?.preferredBrands),
      avoidItems: stringArray(profile.preferences?.avoidItems),
      substitutionPolicy: normalizeSubstitution(
        profile.preferences?.substitutionPolicy,
      ),
      packSize: normalizePackSize(profile.preferences?.packSize),
      spice: normalizeSpice(profile.preferences?.spice),
      maxOrderValueInr: numberOrNull(profile.preferences?.maxOrderValueInr),
    },
    customInstructions: String(profile.customInstructions || "").trim(),
  };
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const requestOptions = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers,
  };

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestOptions.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, requestOptions);
  } catch (error) {
    throw new ApiError(
      "Could not reach the household service. Check the connection and try again.",
      0,
      error,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let data = null;
  if (response.status !== 204) {
    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      const body = await response.text();
      data = body ? { message: body } : null;
    }
  }

  if (!response.ok) {
    const message =
      text(data?.error) ||
      text(data?.message) ||
      authReasonMessage(data?.reason, data?.retryAfterSeconds) ||
      (response.status === 401
        ? "Your dashboard session has expired."
        : `Request failed (${response.status}).`);

    if (response.status === 401 && !options.allowUnauthorized) {
      showLogin("Your dashboard session expired. Sign in again to continue.");
    }
    throw new ApiError(message, response.status, data);
  }

  return data;
}

function isAuthenticatedSession(data) {
  if (!data || typeof data !== "object") return false;
  if (data.authenticated === false || data.loggedIn === false) return false;
  return data.authenticated === true || data.loggedIn === true || data.ok === true;
}

function setPageLoading(loading, message = "Opening the household desk…") {
  dom.pageLoading.hidden = !loading;
  dom.loadingMessage.textContent = message;
  document.body.classList.toggle("is-loading", loading);
}

function openDisclosurePath(target) {
  const disclosures = [];
  let current = target;
  while (current) {
    if (current.matches?.("details")) disclosures.push(current);
    current = current.parentElement;
  }
  for (const disclosure of disclosures.reverse()) disclosure.open = true;
}

function revealSection(target, focusTarget = null) {
  if (!target) return;
  openDisclosurePath(target);
  if (focusTarget) openDisclosurePath(focusTarget);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 350);
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (busyLabel) button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function showLogin(message = "") {
  state.authenticated = false;
  state.dirty = false;
  dom.dashboard.hidden = true;
  dom.dirtyBar.hidden = true;
  dom.loginOverlay.hidden = false;
  dom.loginError.hidden = !message;
  dom.loginError.textContent = message;
  setPageLoading(false);
  window.setTimeout(() => dom.password.focus(), 0);
}

function showDashboard() {
  state.authenticated = true;
  dom.loginOverlay.hidden = true;
  dom.dashboard.hidden = false;
  dom.loginError.hidden = true;
  dom.password.value = "";
}

function showGlobalError(message, { empty = false, retry = null } = {}) {
  dom.globalError.hidden = false;
  dom.globalError.classList.toggle("is-empty", empty);
  dom.globalErrorMessage.textContent = message;
  dom.globalRetry.hidden = typeof retry !== "function";
  state.lastRetry = retry;
}

function clearGlobalError() {
  dom.globalError.hidden = true;
  dom.globalError.classList.remove("is-empty");
  state.lastRetry = null;
}

function toast(message, tone = "success") {
  const item = document.createElement("div");
  item.className = `toast${tone === "error" ? " is-error" : ""}`;
  item.textContent = message;
  dom.toastRegion.append(item);
  window.setTimeout(() => {
    item.classList.add("is-leaving");
    window.setTimeout(() => item.remove(), 220);
  }, 3400);
}

function displayError(error, fallback = "Something went wrong. Please try again.") {
  const message = error instanceof Error ? error.message : fallback;
  toast(message || fallback, "error");
}

function maskPhone(value) {
  if (!value) return "No WhatsApp number";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 7) return value;
  const countryLength = digits.length > 10 ? digits.length - 10 : 0;
  const country = countryLength ? `+${digits.slice(0, countryLength)} ` : "";
  return `${country}•••••• ${digits.slice(-4)}`;
}

function profileOptionLabel(profile) {
  const name = text(profile.displayName, profile.label);
  return `${name} · ${maskPhone(profile.whatsappNumber)}`;
}

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function relativeExpiry(value) {
  if (!value) return { label: "Expiry unknown", tone: "warning", remainingMs: null };
  const expiresAt = new Date(value).valueOf();
  if (!Number.isFinite(expiresAt)) {
    return { label: "Expiry unknown", tone: "warning", remainingMs: null };
  }
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return { label: "Session expired", tone: "bad", remainingMs };
  const hours = Math.max(1, Math.round(remainingMs / 3_600_000));
  if (hours < 48) return { label: `${hours}h remaining`, tone: "warning", remainingMs };
  const days = Math.max(1, Math.round(hours / 24));
  return { label: `${days} days remaining`, tone: "good", remainingMs };
}

async function loadProfiles({ preferredId } = {}) {
  clearGlobalError();
  const data = await request("/profiles");
  const source = Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [];
  state.profiles = source.map(normalizeProfile).filter((profile) => profile.id);
  renderProfileOptions();

  if (state.profiles.length === 0) {
    renderNoProfiles();
    return;
  }

  const queryId = new URLSearchParams(window.location.search).get("profile");
  const rememberedId = window.localStorage.getItem("sahayaka.activeProfile");
  const wanted = preferredId || queryId || rememberedId;
  const selected = state.profiles.find((profile) => profile.id === wanted) || state.profiles[0];
  await activateProfile(selected.id);
}

function renderProfileOptions() {
  dom.profileSelect.replaceChildren();
  if (state.profiles.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No profiles configured";
    dom.profileSelect.append(option);
    dom.profileSelect.disabled = true;
    return;
  }

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profileOptionLabel(profile);
    dom.profileSelect.append(option);
  }
  dom.profileSelect.disabled = false;
}

function renderNoProfiles() {
  state.activeId = null;
  state.original = null;
  state.draft = null;
  dom.profileForm.inert = true;
  dom.profileContext.textContent = "No household profiles";
  dom.profileInitial.textContent = "—";
  dom.readinessName.textContent = "No profiles";
  dom.readinessSummary.textContent = "have been configured yet.";
  showGlobalError(
    "There are no household profiles to configure yet. Seed the first profile on the server, then reload this desk.",
    { empty: true, retry: () => loadProfiles() },
  );
  renderReadiness([]);
  renderDiagnostics([], null);
  setDirty(false);
}

async function activateProfile(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return;

  state.activationVersion += 1;
  const version = state.activationVersion;
  state.activeId = profile.id;
  state.original = clone(profile);
  state.draft = clone(profile);
  state.addresses = profile.address ? [clone(profile.address)] : [];
  state.diagnostics = null;
  state.diagnosticChecks = [];
  state.readinessMode = "local";
  state.readinessOverall = "warning";
  state.dirty = false;
  dom.profileForm.inert = false;
  dom.profileSelect.value = profile.id;
  window.localStorage.setItem("sahayaka.activeProfile", profile.id);
  const url = new URL(window.location.href);
  url.searchParams.set("profile", profile.id);
  window.history.replaceState({}, "", url);

  renderProfile(profile);
  renderDiagnostics([], null);
  renderReadiness(fallbackChecks(profile));
  clearGlobalError();

  const work = [runDiagnostics({ quiet: true, version })];
  if (profile.swiggy.connected) work.push(loadAddresses({ quiet: true, version }));
  void Promise.allSettled(work);
}

function renderProfile(profile) {
  dom.profileInitial.textContent = text(profile.displayName, "?").slice(0, 1).toUpperCase();
  dom.profileContext.textContent = `${text(profile.relationship, profile.label)} · ${maskPhone(profile.whatsappNumber)}`;
  dom.readinessName.textContent = text(profile.displayName, profile.label);

  dom.displayName.value = profile.displayName;
  dom.relationship.value = profile.relationship;
  dom.whatsappNumber.value = profile.whatsappNumber || "";
  dom.whatsappNumber.placeholder = "Not assigned";
  dom.assistantName.value = profile.assistantName;
  dom.agentEnabled.checked = profile.enabled;
  dom.voiceReplies.checked = profile.language.voiceReplies;
  dom.instamart.checked = profile.capabilities.instamart;
  dom.food.checked = profile.capabilities.food;
  dom.spice.value = normalizeSpice(profile.preferences.spice);
  dom.substitutionPolicy.value = normalizeSubstitution(
    profile.preferences.substitutionPolicy,
  );
  dom.packSize.value = normalizePackSize(profile.preferences.packSize);
  dom.maxOrderValue.value = profile.preferences.maxOrderValueInr ?? "";
  dom.customInstructions.value = profile.customInstructions;

  const reply = $(
    `input[name="replyMode"][value="${normalizeReplyMode(profile.language.replyMode)}"]`,
  );
  if (reply) reply.checked = true;

  updateSwitchLabels();
  renderAllChips();
  renderSwiggy(profile.swiggy);
  renderAddressList();
  updatePreview();
  updateInstructionCount();
  updateSaveUi();
}

function syncDraftFromForm() {
  if (!state.draft) return;
  state.draft.displayName = dom.displayName.value;
  state.draft.whatsappNumber = text(dom.whatsappNumber.value) || null;
  state.draft.assistantName = dom.assistantName.value;
  state.draft.enabled = dom.agentEnabled.checked;
  state.draft.language.replyMode =
    $("input[name='replyMode']:checked")?.value || "english";
  state.draft.language.voiceReplies = dom.voiceReplies.checked;
  state.draft.capabilities.instamart = dom.instamart.checked;
  state.draft.capabilities.food = dom.food.checked;
  state.draft.preferences.spice = dom.spice.value;
  state.draft.preferences.substitutionPolicy = dom.substitutionPolicy.value;
  state.draft.preferences.packSize = dom.packSize.value;
  state.draft.preferences.maxOrderValueInr = numberOrNull(dom.maxOrderValue.value);
  state.draft.customInstructions = dom.customInstructions.value;
}

function calculateDirty() {
  if (!state.original || !state.draft) return false;
  return JSON.stringify(editablePayload(state.original)) !== JSON.stringify(editablePayload(state.draft));
}

function setDirty(dirty = calculateDirty()) {
  state.dirty = Boolean(dirty);
  updateSaveUi();
  renderReadiness(currentReadinessChecks());
}

function currentReadinessChecks() {
  if (
    !state.dirty &&
    state.readinessMode === "verified" &&
    state.diagnosticChecks.length > 0
  ) {
    return state.diagnosticChecks;
  }
  return fallbackChecks(state.dirty ? state.draft : state.original || state.draft);
}

function updateSaveUi() {
  const hasProfile = Boolean(state.draft);
  const saving = state.busy.has("save");
  dom.dirtyBar.hidden = !state.dirty || !hasProfile;
  dom.headerSave.disabled = !state.dirty || saving || !hasProfile;
  dom.saveButton.disabled = !state.dirty || saving || !hasProfile;
  dom.discardButton.disabled = saving;

  if (!hasProfile) {
    dom.saveState.textContent = "No active profile";
    return;
  }

  const name = text(state.draft.displayName, state.draft.label);
  dom.dirtyTitle.textContent = `Unsaved changes for ${name}`;
  dom.dirtyDetail.textContent = "Save before leaving this profile.";
  dom.saveButton.textContent = saving ? "Saving…" : `Save ${name}`;
  dom.headerSave.textContent = saving ? "Saving…" : "Save changes";
  dom.saveState.textContent = state.dirty ? "Changes not saved" : "All changes saved";
}

function validateDraft() {
  if (!dom.profileForm.reportValidity()) return false;
  if (!dom.instamart.checked && !dom.food.checked && dom.agentEnabled.checked) {
    toast("Enable Instamart or Food delivery before turning this agent on.", "error");
    revealSection($("#language-section"), dom.instamart);
    return false;
  }
  const max = numberOrNull(dom.maxOrderValue.value);
  if (max !== null && (max < 1 || max > 1000000)) {
    toast("Preferred maximum must be between ₹1 and ₹10,00,000, or left empty.", "error");
    revealSection($("#preferences-section"), dom.maxOrderValue);
    return false;
  }
  return true;
}

async function saveActiveProfile({ quiet = false } = {}) {
  if (!state.draft || !state.activeId) return false;
  syncDraftFromForm();
  if (!validateDraft()) return false;
  if (!calculateDirty()) {
    setDirty(false);
    return true;
  }

  state.busy.add("save");
  updateSaveUi();
  try {
    const payload = editablePayload(state.draft);
    const data = await request(`/profiles/${encodeURIComponent(state.activeId)}`, {
      method: "PUT",
      body: payload,
    });
    const returned = data?.profile || (data?.id ? data : null);
    const saved = normalizeProfile({
      ...state.original,
      ...payload,
      ...(returned || {}),
      id: state.activeId,
      swiggy: returned?.swiggy || state.draft.swiggy,
    });
    state.original = clone(saved);
    state.draft = clone(saved);
    state.diagnostics = null;
    state.diagnosticChecks = [];
    state.readinessMode = "local";
    const index = state.profiles.findIndex((profile) => profile.id === state.activeId);
    if (index >= 0) state.profiles[index] = clone(saved);
    renderProfileOptions();
    dom.profileSelect.value = state.activeId;
    renderProfile(state.draft);
    setDirty(false);
    if (!quiet) toast(`${saved.displayName}’s agent settings are saved.`);
    void runDiagnostics({ quiet: true });
    return true;
  } catch (error) {
    displayError(error, "Could not save this profile.");
    return false;
  } finally {
    state.busy.delete("save");
    updateSaveUi();
  }
}

function discardChanges() {
  if (!state.original) return;
  state.draft = clone(state.original);
  state.addresses = state.draft.address ? [clone(state.draft.address), ...state.addresses.filter((address) => address.id !== state.draft.address.id)] : state.addresses;
  renderProfile(state.draft);
  setDirty(false);
  toast("Unsaved changes were discarded.");
}

async function requestProfileSwitch(nextId) {
  if (!nextId || nextId === state.activeId) return;
  dom.profileSelect.value = state.activeId || "";

  if (state.dirty) {
    const next = state.profiles.find((profile) => profile.id === nextId);
    const choice = await askConfirmation({
      title: `Switch to ${next?.displayName || "another profile"}?`,
      message: `You have unsaved changes for ${state.draft?.displayName || "this profile"}. Save them, discard them, or stay here.`,
      confirmLabel: "Save & switch",
      secondaryLabel: "Discard & switch",
      cancelLabel: "Stay here",
    });
    if (choice === "cancel") return;
    if (choice === "confirm") {
      const saved = await saveActiveProfile({ quiet: true });
      if (!saved) return;
    }
  }

  await activateProfile(nextId);
}

function updateSwitchLabels() {
  const enabledLabel = dom.agentEnabled.closest(".switch-control")?.querySelector(".switch-label");
  const voiceLabel = dom.voiceReplies.closest(".switch-control")?.querySelector(".switch-label");
  if (enabledLabel) enabledLabel.textContent = dom.agentEnabled.checked ? "Enabled" : "Paused";
  if (voiceLabel) voiceLabel.textContent = dom.voiceReplies.checked ? "Voice on" : "Voice off";
}

function updateInstructionCount() {
  dom.instructionCount.textContent = String(dom.customInstructions.value.length);
}

function updatePreview() {
  if (!state.draft) return;
  const name = text(dom.displayName.value, "GeLathi");
  const mode = $("input[name='replyMode']:checked")?.value || "english";
  const preview = {
    english: `${name}, your cart is ready. Please review the full bill. Would you like me to place the order?`,
    kannada: `${name}, ನಿಮ್ಮ ಕಾರ್ಟ್ ಸಿದ್ಧವಾಗಿದೆ. ದಯವಿಟ್ಟು ಸಂಪೂರ್ಣ ಬಿಲ್ ನೋಡಿ. ಆರ್ಡರ್ ಮಾಡಬೇಕೇ?`,
    "kanglish-kannada": `${name}, cart ready ide. Poorthi bill nodi, order maadbekaa?\n\n${name}, ಕಾರ್ಟ್ ಸಿದ್ಧವಾಗಿದೆ. ಪೂರ್ಣ ಬಿಲ್ ನೋಡಿ, ಆರ್ಡರ್ ಮಾಡಬೇಕೇ?`,
    "match-user": `${name}, I’ll reply in the language and script you use, while keeping order details clear.`,
  };
  dom.previewBubble.textContent = preview[mode] || preview.english;
  dom.previewCaption.textContent = dom.voiceReplies.checked
    ? "This text is sent first; voice is added for voice-note turns."
    : "A live example of the selected reply style.";
}

function renderAllChips() {
  for (const editor of $$("[data-chip-editor]")) {
    renderChips(editor.dataset.chipEditor);
  }
}

function renderChips(key) {
  const editor = $(`[data-chip-editor="${key}"]`);
  if (!editor || !state.draft) return;
  const list = $("[data-chip-list]", editor);
  list.replaceChildren();
  const values = state.draft.preferences[key] || [];

  for (const value of values) {
    const chip = dom.chipTemplate.content.firstElementChild.cloneNode(true);
    $("[data-chip-text]", chip).textContent = value;
    const remove = $("[data-chip-remove]", chip);
    remove.setAttribute("aria-label", `Remove ${value}`);
    remove.addEventListener("click", () => {
      state.draft.preferences[key] = state.draft.preferences[key].filter(
        (item) => item !== value,
      );
      renderChips(key);
      setDirty();
    });
    list.append(chip);
  }
}

function addChip(editor) {
  if (!state.draft) return;
  const key = editor.dataset.chipEditor;
  const input = $("[data-chip-input]", editor);
  const value = text(input.value);
  if (!value) return;
  const values = state.draft.preferences[key] || [];
  if (values.length >= 20) {
    toast("Keep each preference list to 20 items or fewer.", "error");
    return;
  }
  if (values.some((item) => item.toLocaleLowerCase("en-IN") === value.toLocaleLowerCase("en-IN"))) {
    toast(`“${value}” is already in this list.`, "error");
    return;
  }
  state.draft.preferences[key] = [...values, value];
  input.value = "";
  renderChips(key);
  setDirty();
  input.focus();
}

function renderSwiggy(swiggy) {
  const connected = Boolean(swiggy?.connected);
  const expiry = relativeExpiry(swiggy?.expiresAt);
  const expired = connected && expiry.remainingMs !== null && expiry.remainingMs <= 0;
  const expiring = connected && expiry.tone === "warning";

  dom.swiggyCard.className = "connection-card";
  dom.swiggyStatusLabel.className = "status-pill";

  if (!connected || expired) {
    dom.swiggyCard.classList.add("is-disconnected");
    dom.swiggyStatusLabel.classList.add("is-bad");
    dom.swiggyStatusLabel.textContent = expired ? "Expired" : "Not connected";
    dom.swiggyStatusTitle.textContent = expired
      ? "This Swiggy session needs a fresh login."
      : "Connect this profile’s Swiggy account.";
    dom.swiggyStatusDetail.textContent =
      "Login opens in a separate secure window. No password is stored in this desk.";
    dom.swiggyConnect.textContent = expired ? "Reconnect Swiggy" : "Connect Swiggy";
    dom.swiggyDisconnect.hidden = !connected;
  } else if (expiring) {
    dom.swiggyCard.classList.add("is-expiring");
    dom.swiggyStatusLabel.classList.add("is-warning");
    dom.swiggyStatusLabel.textContent = "Relink soon";
    dom.swiggyStatusTitle.textContent = "The saved Swiggy session is nearing its recorded expiry.";
    dom.swiggyStatusDetail.textContent =
      "Reconnect before expiry to keep groceries and food ordering uninterrupted.";
    dom.swiggyConnect.textContent = "Reconnect now";
    dom.swiggyDisconnect.hidden = false;
  } else {
    dom.swiggyCard.classList.add("is-connected");
    dom.swiggyStatusLabel.classList.add("is-good");
    dom.swiggyStatusLabel.textContent = "Session saved";
    dom.swiggyStatusTitle.textContent = "A Swiggy session is saved for this profile.";
    dom.swiggyStatusDetail.textContent =
      "Run the live check to confirm that Swiggy currently accepts it.";
    dom.swiggyConnect.textContent = "Reconnect Swiggy";
    dom.swiggyDisconnect.hidden = false;
  }

  dom.swiggyLinkedAt.textContent = connected ? "Account linked" : "Not linked";
  dom.swiggyExpiresAt.textContent = connected ? expiry.label : "—";
  dom.swiggyExpiresAt.title = swiggy?.expiresAt ? formatDate(swiggy.expiresAt) : "";
  dom.syncAddresses.disabled = !connected || expired || state.busy.has("addresses");
}

function setAddressState(message, { loading = false, error = false } = {}) {
  dom.addressState.hidden = false;
  dom.addressList.hidden = true;
  dom.addressEmpty.hidden = true;
  dom.addressState.classList.toggle("is-error", error);
  const spinner = $(".mini-spinner", dom.addressState);
  if (spinner) spinner.hidden = !loading;
  const copy = $("p", dom.addressState);
  if (copy) copy.textContent = message;
}

function renderAddressList() {
  if (!state.draft) return;
  if (!state.draft.swiggy.connected) {
    setAddressState("Connect Swiggy to load this account’s saved addresses.");
    dom.syncAddresses.disabled = true;
    return;
  }

  const addresses = [...state.addresses];
  if (state.draft.address && !addresses.some((address) => address.id === state.draft.address.id)) {
    addresses.unshift(clone(state.draft.address));
  }

  const legend = $("legend", dom.addressList);
  dom.addressList.replaceChildren(...(legend ? [legend] : []));
  dom.addressState.hidden = true;
  dom.addressEmpty.hidden = addresses.length > 0;
  dom.addressList.hidden = addresses.length === 0;
  dom.syncAddresses.disabled = state.busy.has("addresses");

  for (const address of addresses) {
    const card = dom.addressTemplate.content.firstElementChild.cloneNode(true);
    const input = $("input", card);
    input.value = address.id;
    input.checked = state.draft.address?.id === address.id;
    $("[data-address-label]", card).textContent = address.label;
    $("[data-address-text]", card).textContent =
      address.formattedAddress || "Address details unavailable";
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.draft.address = clone(address);
      renderAddressList();
      setDirty();
    });
    dom.addressList.append(card);
  }
}

async function loadAddresses({ quiet = false, version = state.activationVersion } = {}) {
  if (!state.activeId || !state.draft?.swiggy.connected) {
    renderAddressList();
    return;
  }
  const profileId = state.activeId;
  state.busy.add("addresses");
  dom.syncAddresses.disabled = true;
  setButtonBusy(dom.syncAddresses, true, "Refreshing…");
  setAddressState("Loading saved addresses from Swiggy…", { loading: true });

  try {
    const data = await request(`/profiles/${encodeURIComponent(profileId)}/swiggy/addresses`);
    if (version !== state.activationVersion || profileId !== state.activeId) return;
    const source = Array.isArray(data) ? data : Array.isArray(data?.addresses) ? data.addresses : [];
    state.addresses = source.map(normalizeAddress).filter(Boolean);
    if (state.draft.address) {
      const refreshedSelection = state.addresses.find(
        (address) => address.id === state.draft.address.id,
      );
      if (refreshedSelection) state.draft.address = clone(refreshedSelection);
    }
    renderAddressList();
    setDirty();
    if (!quiet) {
      toast(
        state.addresses.length
          ? `${state.addresses.length} saved address${state.addresses.length === 1 ? "" : "es"} refreshed.`
          : "Swiggy returned no saved addresses.",
      );
    }
  } catch (error) {
    if (version !== state.activationVersion || profileId !== state.activeId) return;
    setAddressState(error.message || "Could not load saved addresses.", { error: true });
    if (!quiet) displayError(error, "Could not refresh addresses.");
  } finally {
    state.busy.delete("addresses");
    setButtonBusy(dom.syncAddresses, false);
    if (state.draft) renderSwiggy(state.draft.swiggy);
  }
}

async function startSwiggyLogin() {
  if (!state.activeId) return;
  setButtonBusy(dom.swiggyConnect, true, "Preparing login…");
  try {
    const data = await request(`/profiles/${encodeURIComponent(state.activeId)}/swiggy/login`, {
      method: "POST",
      body: {},
    });
    const url = text(data?.url);
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error("The server did not return a valid Swiggy login link.");
    }
    const popup = window.open(url, "_blank", "popup,width=520,height=760");
    if (!popup) {
      throw new Error("The login window was blocked. Allow pop-ups for this page and try again.");
    }
    popup.opener = null;
    state.awaitingSwiggy = true;
    toast("Complete the Swiggy login in the new window, then return here.");
  } catch (error) {
    displayError(error, "Could not start the Swiggy login.");
  } finally {
    setButtonBusy(dom.swiggyConnect, false);
    if (state.draft) renderSwiggy(state.draft.swiggy);
  }
}

async function disconnectSwiggy() {
  if (!state.activeId || !state.draft?.swiggy.connected) return;
  const choice = await askConfirmation({
    title: "Disconnect this Swiggy account?",
    message:
      "This profile will not be able to search, manage carts, or place orders until it is connected again. Existing profile preferences stay saved.",
    confirmLabel: "Disconnect",
    cancelLabel: "Keep connected",
  });
  if (choice !== "confirm") return;

  setButtonBusy(dom.swiggyDisconnect, true, "Disconnecting…");
  try {
    const data = await request(`/profiles/${encodeURIComponent(state.activeId)}/swiggy/session`, {
      method: "DELETE",
    });
    const returned = data?.profile ? normalizeProfile(data.profile) : null;
    const disconnected = returned || {
      ...state.original,
      address: null,
      swiggy: { connected: false, expiresAt: null },
    };
    state.original = clone(disconnected);
    state.draft.swiggy = clone(disconnected.swiggy);
    state.draft.address = null;
    state.addresses = [];
    state.diagnostics = null;
    state.diagnosticChecks = [];
    state.readinessMode = "local";
    const index = state.profiles.findIndex((profile) => profile.id === state.activeId);
    if (index >= 0) state.profiles[index] = clone(disconnected);
    renderSwiggy(state.draft.swiggy);
    renderAddressList();
    setDirty();
    toast("Swiggy was disconnected from this profile.");
    void runDiagnostics({ quiet: true });
  } catch (error) {
    displayError(error, "Could not disconnect Swiggy.");
  } finally {
    setButtonBusy(dom.swiggyDisconnect, false);
  }
}

async function refreshProfilesAfterSwiggy() {
  if (!state.awaitingSwiggy || !state.activeId) return;
  const activeId = state.activeId;
  try {
    const data = await request("/profiles");
    const source = Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [];
    const profiles = source.map(normalizeProfile).filter((profile) => profile.id);
    const fresh = profiles.find((profile) => profile.id === activeId);
    if (!fresh) return;
    state.profiles = profiles;
    state.original.swiggy = clone(fresh.swiggy);
    state.original.address = clone(fresh.address);
    state.draft.swiggy = clone(fresh.swiggy);
    if (!state.dirty || !state.draft.address) state.draft.address = clone(fresh.address);
    state.diagnostics = null;
    state.diagnosticChecks = [];
    state.readinessMode = "local";
    renderProfileOptions();
    dom.profileSelect.value = activeId;
    renderSwiggy(state.draft.swiggy);
    renderAddressList();
    if (fresh.swiggy.connected) {
      state.awaitingSwiggy = false;
      toast("A Swiggy session was saved. Running a live check now.");
      void loadAddresses({ quiet: true });
    } else {
      state.awaitingSwiggy = true;
      toast("Swiggy is not connected yet. Complete the login and run checks again.", "error");
    }
    void runDiagnostics({ quiet: true });
  } catch (error) {
    displayError(error, "Could not refresh the Swiggy connection status.");
  }
}

function statusTone(value, okValue) {
  if (okValue === true) return "good";
  if (okValue === false) return "error";
  const candidate = text(String(value ?? "")).toLowerCase();
  if (["ok", "pass", "passed", "ready", "healthy", "connected", "valid", "success", "good"].includes(candidate)) {
    return "good";
  }
  if (["warning", "warn", "degraded", "expiring", "attention", "partial", "paused"].includes(candidate)) {
    return "warning";
  }
  if (["error", "failed", "fail", "blocked", "missing", "invalid", "expired", "disconnected", "bad"].includes(candidate)) {
    return "error";
  }
  return "warning";
}

function checkLabel(key) {
  const labels = {
    whatsapp: "WhatsApp channel",
    meta: "WhatsApp channel",
    swiggy: "Swiggy session",
    address: "Delivery address",
    delivery: "Delivery address",
    agent: "Agent configuration",
    gemini: "Gemini agent",
    voice: "Voice replies",
    gnani: "Voice replies",
    storage: "Profile storage",
  };
  return labels[key.toLowerCase()] || key.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function normalizeCheck(raw, fallbackKey, index) {
  if (typeof raw === "boolean") {
    return {
      key: fallbackKey || `check-${index}`,
      name: checkLabel(fallbackKey || `Check ${index + 1}`),
      tone: raw ? "good" : "error",
      state: raw ? "Ready" : "Needs attention",
      message: raw ? "This check passed." : "This check did not pass.",
      action: null,
    };
  }
  if (typeof raw === "string") {
    const tone = statusTone(raw);
    return {
      key: fallbackKey || `check-${index}`,
      name: checkLabel(fallbackKey || `Check ${index + 1}`),
      tone,
      state: tone === "good" ? "Ready" : tone === "warning" ? "Review" : "Blocked",
      message: raw,
      action: null,
    };
  }

  const item = raw && typeof raw === "object" ? raw : {};
  const key = text(String(firstDefined(item.key, item.id, item.name, fallbackKey, `check-${index}`)));
  const rawStatus = firstDefined(item.status, item.state, item.result, item.level);
  const tone = statusTone(rawStatus, typeof item.ok === "boolean" ? item.ok : undefined);
  const actionRaw = firstDefined(item.action, item.cta, item.fix);
  const action =
    typeof actionRaw === "string"
      ? { id: actionRaw, label: text(item.actionLabel, "Fix this") }
      : actionRaw && typeof actionRaw === "object"
        ? {
            id: text(String(firstDefined(actionRaw.id, actionRaw.action, actionRaw.type, ""))),
            label: text(firstDefined(actionRaw.label, actionRaw.title), "Fix this"),
          }
        : null;

  return {
    key,
    name: text(firstDefined(item.label, item.name), checkLabel(key)),
    tone,
    state: text(
      String(rawStatus ?? ""),
      tone === "good" ? "Ready" : tone === "warning" ? "Review" : "Blocked",
    ),
    message: text(firstDefined(item.message, item.summary, item.detail, item.description),
      tone === "good" ? "This check passed." : "This needs attention."),
    action: action?.id ? action : null,
  };
}

function normalizeDiagnostics(raw) {
  let entries = [];
  const source = firstDefined(raw?.checks, raw?.diagnostics, raw?.results);
  if (Array.isArray(source)) {
    entries = source.map((item, index) => normalizeCheck(item, "", index));
  } else if (source && typeof source === "object") {
    entries = Object.entries(source).map(([key, item], index) => normalizeCheck(item, key, index));
  }

  if (entries.length === 0 && raw && typeof raw === "object") {
    const knownKeys = ["whatsapp", "meta", "swiggy", "address", "delivery", "agent", "gemini", "voice", "gnani", "storage"];
    entries = knownKeys
      .filter((key) => raw[key] !== undefined)
      .map((key, index) => normalizeCheck(raw[key], key, index));
  }

  return {
    checks: entries,
    checkedAt: firstDefined(raw?.checkedAt, raw?.timestamp, raw?.updatedAt) || new Date().toISOString(),
    summary: text(firstDefined(raw?.summary, raw?.message), ""),
    overallStatus: firstDefined(raw?.overallStatus, raw?.status),
  };
}

function fallbackChecks(profile = state.draft) {
  if (!profile) return [];
  const expiry = relativeExpiry(profile.swiggy?.expiresAt);
  const hasCapability = profile.capabilities?.instamart || profile.capabilities?.food;
  return [
    {
      key: "whatsapp",
      name: "WhatsApp channel",
      tone: profile.whatsappNumber ? "good" : "error",
      state: profile.whatsappNumber ? "Configured" : "Missing",
      message: profile.whatsappNumber
        ? `Messages are assigned to ${maskPhone(profile.whatsappNumber)}.`
        : "No WhatsApp number is assigned to this profile.",
      action: profile.whatsappNumber ? null : null,
    },
    {
      key: "swiggy",
      name: "Swiggy session",
      tone: !profile.swiggy?.connected
        ? "error"
        : expiry.tone === "bad"
          ? "error"
          : expiry.tone,
      state: profile.swiggy?.connected ? expiry.label : "Not connected",
      message: profile.swiggy?.connected
        ? "A Swiggy session is saved for this profile. Run a live check to confirm it still works."
        : "Connect a Swiggy account before ordering.",
      action: profile.swiggy?.connected ? null : { id: "connect-swiggy", label: "Connect Swiggy" },
    },
    {
      key: "address",
      name: "Delivery address",
      tone: profile.address ? "good" : "error",
      state: profile.address ? "Selected" : "Missing",
      message: profile.address
        ? `${profile.address.label}: ${profile.address.formattedAddress || "address details unavailable"}`
        : "Choose one saved Swiggy address for delivery.",
      action: profile.address ? null : { id: "choose-address", label: "Choose address" },
    },
    {
      key: "agent",
      name: "Agent configuration",
      tone: !profile.enabled ? "warning" : hasCapability ? "good" : "error",
      state: !profile.enabled ? "Paused" : hasCapability ? "Enabled" : "No errands enabled",
      message: !profile.enabled
        ? "This profile is intentionally paused."
        : hasCapability
          ? "At least one ordering capability is enabled."
          : "Enable Instamart or Food delivery.",
      action: !profile.enabled ? { id: "enable-agent", label: "Enable agent" } : null,
    },
  ];
}

function mergeChecks(primary, fallback) {
  const checks = [...primary];
  const hasCategory = (category) =>
    checks.some((check) => readinessCategory(check.key) === category);
  for (const check of fallback) {
    const category = readinessCategory(check.key);
    if (!category || !hasCategory(category)) checks.push(check);
  }
  return checks;
}

function readinessCategory(key) {
  const normalized = String(key || "").toLowerCase();
  if (/whatsapp|meta|channel/.test(normalized)) return "whatsapp";
  if (/swiggy|mcp|session/.test(normalized)) return "swiggy";
  if (/address|delivery/.test(normalized)) return "address";
  if (/agent|gemini|config|capabilit|enabled/.test(normalized)) return "agent";
  return null;
}

function compactReadinessMessage(category, check, profile) {
  const tone = check?.tone || "warning";
  const hasPhone = Boolean(profile?.whatsappNumber);
  const hasSwiggy = Boolean(profile?.swiggy?.connected);
  const hasAddress = Boolean(profile?.address);
  const instamart = Boolean(profile?.capabilities?.instamart);
  const food = Boolean(profile?.capabilities?.food);

  if (category === "whatsapp") {
    if (!hasPhone) return "Add this person’s WhatsApp number.";
    if (tone === "error") return "WhatsApp setup needs attention.";
    return `${maskPhone(profile.whatsappNumber)} · ${profile.enabled ? "Active" : "Paused"}`;
  }

  if (category === "swiggy") {
    if (!hasSwiggy) return "Connect this person’s Swiggy account.";
    if (tone === "error") return "Saved session could not be verified.";
    if (tone === "warning") return "Saved session needs review.";
    return state.readinessMode === "verified" ? "Session verified" : "Session saved";
  }

  if (category === "address") {
    if (!hasAddress) return "Choose a delivery address.";
    if (tone === "error") return "Delivery address needs attention.";
    return `${text(profile.address.label, "Selected")}: ${text(profile.address.formattedAddress, "saved address")}`;
  }

  if (category === "agent") {
    if (!profile?.enabled) return "Paused on WhatsApp.";
    if (!instamart && !food) return "Choose Instamart or Food delivery.";
    if (tone === "error") return "Agent setup needs attention.";
    if (tone === "warning") return "Agent settings need review.";
    if (instamart && food) return "Instamart + Food enabled";
    return instamart ? "Instamart enabled" : "Food delivery enabled";
  }

  return check?.message || "Status unavailable";
}

function renderReadiness(checks) {
  const fallbackProfile = state.dirty ? state.draft : state.original || state.draft;
  const fallback = fallbackChecks(fallbackProfile);
  const effective = state.dirty ? fallback : mergeChecks(checks || [], fallback);
  const statuses = {};
  for (const category of ["whatsapp", "swiggy", "address", "agent"]) {
    const matching = effective.filter((check) => readinessCategory(check.key) === category);
    const priority = { error: 0, warning: 1, good: 2 };
    statuses[category] = matching.length
      ? matching.sort((a, b) => priority[a.tone] - priority[b.tone])[0]
      : { tone: "warning", message: "No status available", state: "Unknown" };
  }

  for (const item of dom.readinessItems) {
    const category = item.dataset.readiness;
    const check = statuses[category];
    const summary = compactReadinessMessage(category, check, fallbackProfile);
    item.className = `readiness-item is-${check.tone}`;
    $("small", item).textContent = summary;
    $(".readiness-symbol", item).textContent = check.tone === "good" ? "✓" : check.tone === "error" ? "×" : "!";
    item.title = `${check.state}: ${summary}`;
  }

  const tones = Object.values(statuses).map((check) => check.tone);
  const isPaused = state.draft && !state.draft.enabled;
  const overall = tones.includes("error") ? "error" : tones.includes("warning") ? "warning" : "ready";
  state.readinessOverall = overall;
  renderPrimaryReadiness(overall, isPaused);
}

function renderPrimaryReadiness(overall = state.readinessOverall, isPaused = state.draft && !state.draft.enabled) {
  const stampTitle = $("strong", dom.readinessStamp);
  const stampDetail = $("small", dom.readinessStamp);

  if (!state.draft) {
    dom.readinessStamp.className = "readiness-stamp is-checking";
    stampTitle.textContent = "Not configured";
    stampDetail.textContent = "No active profile";
    dom.readinessSummary.textContent = "have not been configured yet.";
    return;
  }

  if (state.dirty) {
    dom.readinessStamp.className = "readiness-stamp is-warning";
    stampTitle.textContent = "Unsaved changes";
    stampDetail.textContent = "Edits not active on WhatsApp";
    dom.readinessSummary.textContent = "has unsaved edits that are not active on WhatsApp.";
    return;
  }

  if (state.readinessMode === "failed") {
    dom.readinessStamp.className = "readiness-stamp is-error";
    stampTitle.textContent = "Couldn’t verify";
    stampDetail.textContent = "Live check unavailable";
    dom.readinessSummary.textContent = "couldn’t verify its saved configuration.";
    return;
  }

  if (state.readinessMode === "checking") {
    dom.readinessStamp.className = "readiness-stamp is-checking";
    stampTitle.textContent = "Checking";
    stampDetail.textContent = "Read-only connection check";
    dom.readinessSummary.textContent = "is checking its saved configuration.";
    return;
  }

  if (state.readinessMode !== "verified") {
    dom.readinessStamp.className = "readiness-stamp is-checking";
    stampTitle.textContent = "Pending check";
    stampDetail.textContent = "Saved settings only";
    dom.readinessSummary.textContent = "is waiting for a live configuration check.";
    return;
  }

  if (isPaused) {
    dom.readinessStamp.className = "readiness-stamp is-warning";
    stampTitle.textContent = "Paused";
    stampDetail.textContent = "Not active on WhatsApp";
    dom.readinessSummary.textContent = "is paused on WhatsApp.";
    return;
  }

  dom.readinessStamp.className = `readiness-stamp is-${overall}`;
  stampTitle.textContent =
    overall === "ready"
      ? "Configuration verified"
      : overall === "warning"
        ? "Review configuration"
        : "Needs attention";
  stampDetail.textContent =
    overall === "ready" ? "Ready for requests · read-only check" : "Open quick triage";
  dom.readinessSummary.textContent =
    overall === "ready"
      ? "is ready for requests."
      : overall === "warning"
        ? "has configuration notes to review."
        : "has a configuration blocker.";
}

function renderDiagnostics(checks, raw) {
  state.diagnosticChecks = checks || [];
  dom.diagnosticList.replaceChildren();
  dom.diagnosticEmpty.hidden = checks.length > 0;

  for (const check of checks) {
    const item = dom.diagnosticTemplate.content.firstElementChild.cloneNode(true);
    item.classList.add(`is-${check.tone}`);
    $("[data-diagnostic-name]", item).textContent = check.name;
    $("[data-diagnostic-state]", item).textContent = check.state;
    $("[data-diagnostic-message]", item).textContent = check.message;
    const actionButton = $("[data-diagnostic-action]", item);
    if (check.action?.id) {
      actionButton.hidden = false;
      actionButton.textContent = `${check.action.label} →`;
      actionButton.addEventListener("click", () => handleDiagnosticAction(check.action.id));
    }
    dom.diagnosticList.append(item);
  }

  dom.diagnosticTechnical.textContent = raw
    ? safeDiagnosticJson(raw)
    : "No diagnostic payload yet.";
}

function safeDiagnosticJson(value) {
  const sensitive = /token|secret|password|authorization|bridgeurl|cookie/i;
  let output;
  try {
    output = JSON.stringify(
      value,
      (key, item) => (sensitive.test(key) ? "[redacted]" : item),
      2,
    );
  } catch {
    output = "Diagnostic payload could not be serialized.";
  }
  return output.length > 12_000 ? `${output.slice(0, 12_000)}\n…truncated` : output;
}

async function runDiagnostics({ quiet = false, version = state.activationVersion } = {}) {
  if (!state.activeId) return;
  const profileId = state.activeId;
  state.diagnosticRunVersion += 1;
  const runVersion = state.diagnosticRunVersion;
  state.readinessMode = "checking";
  renderReadiness(currentReadinessChecks());
  state.busy.add("diagnostics");
  dom.runDiagnostics.disabled = true;
  dom.runDiagnostics.classList.add("is-running");
  dom.diagnosticLoading.hidden = false;
  dom.diagnosticEmpty.hidden = true;
  dom.diagnosticState.className = "status-pill is-neutral";
  dom.diagnosticState.textContent = "Checking";
  if (!quiet) dom.triageSummary.textContent = "Checking connections without touching carts, payments, or orders…";

  try {
    const data = await request(
      `/profiles/${encodeURIComponent(profileId)}/diagnostics?live=1`,
    );
    if (
      version !== state.activationVersion ||
      profileId !== state.activeId ||
      runVersion !== state.diagnosticRunVersion
    ) return;
    const normalized = normalizeDiagnostics(data || {});
    const checks = mergeChecks(normalized.checks, fallbackChecks(state.original || state.draft));
    state.diagnostics = data;
    renderDiagnostics(checks, data);
    state.readinessMode = "verified";
    renderReadiness(checks);
    const tones = checks.map((check) => check.tone);
    const overall = tones.includes("error") ? "bad" : tones.includes("warning") ? "warning" : "good";
    dom.diagnosticState.className = `status-pill is-${overall}`;
    dom.diagnosticState.textContent = overall === "good" ? "Verified" : overall === "warning" ? "Review" : "Attention";
    dom.triageSummary.textContent =
      overall === "good"
        ? "Configuration checks passed. This read-only probe did not test a cart, payment, or order."
        : overall === "warning"
          ? "Configuration checks completed with notes. No cart, payment, or order was tested."
          : "Configuration checks found a blocker. No cart, payment, or order was tested.";
    dom.diagnosticUpdated.textContent = `Checked ${formatDate(normalized.checkedAt)}`;
    if (!quiet) toast("Live household checks are complete.");
  } catch (error) {
    if (
      version !== state.activationVersion ||
      profileId !== state.activeId ||
      runVersion !== state.diagnosticRunVersion
    ) return;
    const fallback = fallbackChecks(state.original || state.draft);
    state.diagnostics = null;
    state.readinessMode = "failed";
    renderDiagnostics(
      [
        {
          key: "diagnostic-service",
          name: "Live diagnostic",
          tone: "error",
          state: "Could not run",
          message: error.message || "The live diagnostic endpoint did not respond.",
          action: null,
        },
        ...fallback,
      ],
      { error: error.message || String(error) },
    );
    renderReadiness(fallback);
    dom.diagnosticState.className = "status-pill is-bad";
    dom.diagnosticState.textContent = "Check failed";
    dom.triageSummary.textContent =
      "The live probe could not finish, so readiness could not be verified. No cart, payment, or order was tested.";
    dom.diagnosticUpdated.textContent = "Live check unavailable";
    if (!quiet) displayError(error, "Could not run live checks.");
  } finally {
    if (runVersion !== state.diagnosticRunVersion) return;
    state.busy.delete("diagnostics");
    dom.runDiagnostics.disabled = false;
    dom.runDiagnostics.classList.remove("is-running");
    dom.diagnosticLoading.hidden = true;
  }
}

function handleDiagnosticAction(action) {
  const normalized = String(action).toLowerCase();
  if (/swiggy|connect|relink|login/.test(normalized)) {
    void startSwiggyLogin();
    return;
  }
  if (/address|delivery/.test(normalized)) {
    revealSection($("#address-section"));
    if (state.draft?.swiggy.connected) void loadAddresses();
    return;
  }
  if (/person/.test(normalized)) {
    revealSection(
      $("#person-section"),
      !state.draft?.whatsappNumber ? dom.whatsappNumber : null,
    );
    return;
  }
  if (/language|voice/.test(normalized)) {
    revealSection($("#language-section"));
    return;
  }
  if (/triage|diagnostic/.test(normalized)) {
    revealSection(dom.triagePanel);
    return;
  }
  if (/whatsapp|ping|message/.test(normalized)) {
    void sendTestPing();
    return;
  }
  if (/enable|agent/.test(normalized)) {
    dom.agentEnabled.checked = true;
    syncDraftFromForm();
    updateSwitchLabels();
    setDirty();
    revealSection($("#person-section"));
    return;
  }
  toast("This finding does not have an automatic fix. Review its details.", "error");
}

async function sendTestPing() {
  if (!state.activeId || !state.draft) return;
  syncDraftFromForm();
  if (!state.draft.whatsappNumber) {
    toast("This profile does not have a WhatsApp number yet.", "error");
    return;
  }
  if (state.draft.whatsappNumber !== state.original?.whatsappNumber) {
    const saveChoice = await askConfirmation({
      title: "Save this WhatsApp number first?",
      message:
        "The test endpoint uses the profile’s saved number. Save the current profile, then send the connectivity message.",
      confirmLabel: "Save & continue",
      cancelLabel: "Not yet",
    });
    if (saveChoice !== "confirm" || !(await saveActiveProfile({ quiet: true }))) return;
  }
  const choice = await askConfirmation({
    title: "Send one test WhatsApp?",
    message: `A harmless connectivity message will be sent to ${maskPhone(state.draft.whatsappNumber)}. It will not search, change a cart, or place an order.`,
    confirmLabel: "Send test",
    cancelLabel: "Cancel",
  });
  if (choice !== "confirm") return;

  setButtonBusy(dom.sendTestPing, true, "Sending test…");
  try {
    const data = await request(`/profiles/${encodeURIComponent(state.activeId)}/whatsapp-test`, {
      method: "POST",
      body: {},
    });
    toast(
      data?.simulated
        ? "Test simulated locally; no WhatsApp message was delivered."
        : `Test WhatsApp sent to ${maskPhone(state.draft.whatsappNumber)}.`,
    );
    void runDiagnostics({ quiet: true });
  } catch (error) {
    displayError(error, "Could not send the test WhatsApp.");
  } finally {
    setButtonBusy(dom.sendTestPing, false);
  }
}

async function resetConversation() {
  if (!state.activeId || !state.draft) return;
  const choice = await askConfirmation({
    title: `Reset ${state.draft.displayName}’s conversation?`,
    message:
      "This clears only the agent’s remembered chat context. It does not cancel an order, clear a real Swiggy cart, or change saved preferences.",
    confirmLabel: "Reset memory",
    cancelLabel: "Keep context",
  });
  if (choice !== "confirm") return;

  setButtonBusy(dom.resetConversation, true, "Resetting…");
  try {
    await request(`/profiles/${encodeURIComponent(state.activeId)}/conversation/reset`, {
      method: "POST",
      body: {},
    });
    toast(`${state.draft.displayName}’s conversation memory was reset.`);
  } catch (error) {
    displayError(error, "Could not reset the conversation.");
  } finally {
    setButtonBusy(dom.resetConversation, false);
  }
}

async function copyDiagnostics() {
  const value = dom.diagnosticTechnical.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("Sanitized diagnostic copied.");
  } catch {
    toast("Could not copy the diagnostic.", "error");
  }
}

function askConfirmation({
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  secondaryLabel = "",
}) {
  if (typeof dom.confirmDialog.showModal !== "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`) ? "confirm" : "cancel");
  }

  dom.confirmTitle.textContent = title;
  dom.confirmMessage.textContent = message;
  dom.confirmAccept.textContent = confirmLabel;
  dom.confirmCancel.textContent = cancelLabel;
  dom.confirmSecondary.hidden = !secondaryLabel;
  dom.confirmSecondary.textContent = secondaryLabel || "Discard";
  dom.confirmDialog.returnValue = "cancel";
  document.body.classList.add("has-dialog");
  dom.confirmDialog.showModal();

  return new Promise((resolve) => {
    dom.confirmDialog.addEventListener(
      "close",
      () => {
        document.body.classList.remove("has-dialog");
        const value = ["confirm", "secondary"].includes(dom.confirmDialog.returnValue)
          ? dom.confirmDialog.returnValue
          : "cancel";
        resolve(value);
      },
      { once: true },
    );
  });
}

async function logOut() {
  if (state.dirty) {
    const choice = await askConfirmation({
      title: "Sign out with unsaved changes?",
      message: `Changes for ${state.draft?.displayName || "this profile"} have not been saved.`,
      confirmLabel: "Save & sign out",
      secondaryLabel: "Discard & sign out",
      cancelLabel: "Stay signed in",
    });
    if (choice === "cancel") return;
    if (choice === "confirm") {
      const saved = await saveActiveProfile({ quiet: true });
      if (!saved) return;
    }
  }

  setButtonBusy(dom.logoutButton, true, "Signing out…");
  try {
    await request("/session", { method: "DELETE" });
  } catch (error) {
    if (error.status !== 401) displayError(error, "Could not sign out cleanly.");
  } finally {
    setButtonBusy(dom.logoutButton, false);
    state.profiles = [];
    state.activeId = null;
    state.original = null;
    state.draft = null;
    showLogin();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const password = dom.password.value;
  if (!password) {
    dom.loginError.textContent = "Enter the dashboard password.";
    dom.loginError.hidden = false;
    return;
  }

  setButtonBusy(dom.loginButton, true, "Opening desk…");
  dom.loginError.hidden = true;
  try {
    const data = await request("/session", {
      method: "POST",
      body: { password },
      allowUnauthorized: true,
    });
    if (data?.authenticated === false) throw new Error("That password did not match.");
    showDashboard();
    setPageLoading(true, "Loading the household profiles…");
    await loadProfiles();
    setPageLoading(false);
  } catch (error) {
    setPageLoading(false);
    dom.loginError.textContent = error.message || "Could not sign in.";
    dom.loginError.hidden = false;
    dom.password.select();
  } finally {
    setButtonBusy(dom.loginButton, false);
  }
}

function bindEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.passwordVisibility.addEventListener("click", () => {
    const showing = dom.password.type === "text";
    dom.password.type = showing ? "password" : "text";
    dom.passwordVisibility.textContent = showing ? "Show" : "Hide";
    dom.passwordVisibility.setAttribute("aria-pressed", String(!showing));
    dom.passwordVisibility.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    dom.password.focus();
  });

  dom.profileSelect.addEventListener("change", () => {
    const nextId = dom.profileSelect.value;
    void requestProfileSwitch(nextId);
  });

  dom.profileForm.addEventListener("invalid", (event) => {
    openDisclosurePath(event.target);
  }, true);

  dom.profileForm.addEventListener("input", (event) => {
    if (event.target.matches("[data-chip-input]") || event.target.readOnly) return;
    syncDraftFromForm();
    updateSwitchLabels();
    updatePreview();
    updateInstructionCount();
    dom.readinessName.textContent = text(dom.displayName.value, state.draft?.label || "This agent");
    setDirty();
  });

  dom.profileForm.addEventListener("change", (event) => {
    if (event.target.name === "selectedAddress") return;
    syncDraftFromForm();
    updateSwitchLabels();
    updatePreview();
    setDirty();
  });

  for (const editor of $$("[data-chip-editor]")) {
    $("[data-chip-add]", editor).addEventListener("click", () => addChip(editor));
    $("[data-chip-input]", editor).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addChip(editor);
      }
    });
  }

  dom.headerSave.addEventListener("click", () => void saveActiveProfile());
  dom.saveButton.addEventListener("click", () => void saveActiveProfile());
  dom.discardButton.addEventListener("click", discardChanges);
  dom.logoutButton.addEventListener("click", () => void logOut());
  dom.swiggyConnect.addEventListener("click", () => void startSwiggyLogin());
  dom.swiggyDisconnect.addEventListener("click", () => void disconnectSwiggy());
  dom.syncAddresses.addEventListener("click", () => void loadAddresses());
  $("[data-address-retry]").addEventListener("click", () => void loadAddresses());
  dom.runDiagnostics.addEventListener("click", () => void runDiagnostics());
  dom.sendTestPing.addEventListener("click", () => void sendTestPing());
  dom.resetConversation.addEventListener("click", () => void resetConversation());
  dom.copyDiagnostics.addEventListener("click", () => void copyDiagnostics());
  dom.globalRetry.addEventListener("click", () => {
    if (state.lastRetry) void state.lastRetry();
  });

  for (const item of dom.readinessItems) {
    item.addEventListener("click", () => {
      const target = document.getElementById(item.dataset.jump);
      revealSection(target);
    });
  }

  window.addEventListener("focus", () => {
    if (state.awaitingSwiggy) {
      window.setTimeout(() => void refreshProfilesAfterSwiggy(), 650);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function boot() {
  bindEvents();
  setPageLoading(true);
  try {
    const session = await request("/session", { allowUnauthorized: true });
    if (!isAuthenticatedSession(session)) {
      showLogin(authReasonMessage(session?.reason));
      return;
    }
    showDashboard();
    setPageLoading(true, "Loading the household profiles…");
    await loadProfiles();
    setPageLoading(false);
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    showDashboard();
    setPageLoading(false);
    showGlobalError(error.message || "The household desk could not start.", {
      retry: () => boot(),
    });
  }
}

void boot();
