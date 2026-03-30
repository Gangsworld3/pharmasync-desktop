// Legacy fallback UI shell. Keep until React screens are production-stabilized.
const state = {
  dark: false,
  language: "en",
  syncStatus: { syncStatus: "IDLE", pendingOperations: 0, conflicts: 0, lastPulledRevision: 0, lastSyncCompletedAt: null, lastSyncError: null, retryBackoffMs: 0, nextScheduledAt: null },
  summary: { clients: 0, invoices: 0, inventory: 0, appointments: 0, messages: 0, pendingOperations: 0 },
  allClients: [],
  clients: [],
  inventory: [],
  appointments: [],
  conflicts: [],
  settings: { backendUrl: "http://127.0.0.1:8090", syncIntervalMs: 15000 },
  appMeta: { version: "1.0.0", runtimePaths: {} },
  selectedClientId: null,
  selectedConflictId: null,
  inventoryFilter: "all",
  formMode: "create",
  formClientId: null,
  searchQuery: "",
  toast: ""
};

const fallbackContent = {
  priorities: [{ title: "Morning stock receipt", body: "Receive amoxicillin, ORS, and glucose strips with batch and expiry capture.", meta: "Dock closes at 10:30" }],
  paymentMethods: [["Cash", "Fastest at the counter. Works offline immediately."], ["Mobile Money", "Capture provider and reference. Reconcile when network returns."], ["Bank Transfer", "Attach transfer slip and approve after verification."]],
  threads: [["Refill reminders", "12 SMS waiting for noon dispatch"], ["Payment follow-up", "3 debt reminders drafted"], ["Supplier notice", "Bank transfer confirmation required"]],
  facts: [["Mobile money mix", "32% of collections this week"], ["Top category", "Antibiotics and chronic-care medication"], ["Average queue time", "6 minutes at front desk"], ["Missed appointments", "4.2% after SMS reminders"]],
  miniStats: [["Cash in drawer", "SSP 2.1M"], ["Mobile money today", "SSP 1.5M"], ["Customers served", "67"], ["Pending approvals", "5"]],
  messageQueue: [["11:30", "Arabic refill reminders"], ["13:00", "Payment balance prompts"], ["16:00", "Tomorrow appointment confirmations"]],
  analytics: [["Jan", 40], ["Feb", 58], ["Mar", 76], ["Apr", 67], ["May", 88]]
};

let i18n = {};
const el = (id) => document.getElementById(id);
const at = (obj, path) => path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
const tr = (path, params = {}) => {
  const value = at(i18n, path);
  if (typeof value !== "string") return path;
  return value.replace(/\{(\w+)\}/g, (_m, key) => String(params[key] ?? ""));
};
const trArray = (path, fallback) => {
  const value = at(i18n, path);
  return Array.isArray(value) ? value : fallback;
};

async function loadLanguagePack(language) {
  const response = await fetch(`./i18n/${language}.json`);
  if (!response.ok) throw new Error(`Failed to load language pack: ${language}`);
  i18n = await response.json();
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const text = tr(node.dataset.i18n);
    if (text !== node.dataset.i18n) node.textContent = text;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const text = tr(node.dataset.i18nPlaceholder);
    if (text !== node.dataset.i18nPlaceholder) node.setAttribute("placeholder", text);
  });
}

function syncPresentation(syncStatus) {
  if (syncStatus.syncStatus === "ERROR") {
    const retrySeconds = syncStatus.retryBackoffMs ? Math.ceil(syncStatus.retryBackoffMs / 1000) : null;
    return { text: tr("sync.needsAttention"), className: "sync-error", hero: tr("sync.reconnecting"), line: `${syncStatus.lastSyncError ?? tr("sync.networkAttention")}${retrySeconds ? ` ${tr("sync.nextRetryIn", { seconds: retrySeconds })}` : ""}` };
  }
  if (syncStatus.conflicts > 0) return { text: tr("sync.conflictsCount", { count: syncStatus.conflicts }), className: "sync-conflict", hero: tr("sync.needsAttention"), line: tr("sync.fewRecordsNeedDecision") };
  if (syncStatus.syncStatus === "SYNCING") return { text: tr("sync.syncing"), className: "sync-active", hero: tr("sync.syncing"), line: tr("sync.localWorkSafe") };
  if (syncStatus.pendingOperations > 0) return { text: tr("sync.queued"), className: "sync-active", hero: tr("sync.savedLocallySyncing"), line: tr("sync.localChangesWaiting", { count: syncStatus.pendingOperations }) };
  if (syncStatus.remoteBaseUrl && syncStatus.lastPulledRevision > 0) return { text: tr("sync.synced"), className: "sync-ok", hero: tr("sync.revisionSynced", { revision: syncStatus.lastPulledRevision }), line: tr("sync.everythingReconciled") };
  return { text: tr("sync.waiting"), className: "sync-idle", hero: tr("sync.waitingFirst"), line: tr("sync.localReady") };
}

const selectedClient = () => state.clients.find((client) => client.id === state.selectedClientId) ?? state.clients[0] ?? null;
const selectedConflict = () => state.conflicts.find((conflict) => conflict.id === state.selectedConflictId) ?? state.conflicts[0] ?? null;
const selectedInventoryItem = () => state.inventory[0] ?? null;

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const millis = new Date(dateValue).getTime() - Date.now();
  return Math.floor(millis / (1000 * 60 * 60 * 24));
}

function getExpiryBadge(item) {
  const days = daysUntil(item.expiresOn);
  if (days === null) return { level: "ok", label: "No expiry" };
  if (days < 0) return { level: "danger", label: "Expired" };
  if (days < 90) return { level: "warning", label: `Expiring in ${days}d` };
  return { level: "ok", label: `Valid ${days}d` };
}

function passesInventoryFilter(item) {
  const badge = getExpiryBadge(item);
  if (state.inventoryFilter === "expired") return badge.level === "danger";
  if (state.inventoryFilter === "near_expiry") return badge.level === "warning";
  if (state.inventoryFilter === "low_stock") return Number(item.quantityOnHand ?? 0) <= Number(item.reorderLevel ?? 0);
  return true;
}

function setToast(message) {
  state.toast = message;
  renderGlobalSyncState();
  if (message) {
    clearTimeout(setToast.timer);
    setToast.timer = setTimeout(() => {
      state.toast = "";
      renderGlobalSyncState();
    }, 2600);
  }
}

function renderKpis() {
  const kpis = [
    { label: tr("kpi.clients"), value: String(state.summary.clients), delta: tr("kpi.localFirstCrm") },
    { label: tr("kpi.appointments"), value: String(state.summary.appointments), delta: tr("kpi.bookedInstantly") },
    { label: tr("kpi.invoices"), value: String(state.summary.invoices), delta: tr("kpi.capturedOffline") },
    { label: tr("kpi.inventory"), value: String(state.summary.inventory), delta: tr("kpi.localChangesWaiting", { count: state.summary.pendingOperations ?? 0 }) }
  ];
  el("kpiGrid").innerHTML = kpis.map((item) => `<article class="metric-card"><span class="eyebrow">${item.label}</span><strong>${item.value}</strong><span>${item.delta}</span></article>`).join("");
}

function renderPriorities() {
  el("priorityGrid").innerHTML = trArray("content.priorities", fallbackContent.priorities).map((item) => `<article class="priority-item"><strong>${item.title}</strong><p>${item.body}</p><p class="eyebrow">${item.meta}</p></article>`).join("");
}

function renderClients() {
  const current = selectedClient();
  el("clientList").innerHTML = state.clients.length
    ? state.clients.map((client) => `<button class="list-row client-row ${client.id === current?.id ? "selected" : ""}" data-client-id="${client.id}"><strong>${client.fullName}</strong><p>${client.phone ?? tr("common.noPhoneRecorded")}</p><p>${client.dirty ? tr("common.savedLocallySyncing") : tr("common.syncedCheck")}</p></button>`).join("")
    : `<div class="empty-state"><strong>${tr("common.noClientsYet")}</strong><p>${tr("common.createClientHint")}</p></div>`;
  if (!current) return;
  el("clientName").textContent = current.fullName;
  el("clientStats").innerHTML = [current.preferredLanguage?.toUpperCase() ?? "EN", current.city ?? "No city", current.dirty ? tr("common.savedLocallySyncing") : tr("common.syncedCheck")].map((tag) => `<span>${tag}</span>`).join("");
}

function renderSchedule() {
  const clientOptions = state.allClients.map((client) => `<option value="${client.id}">${client.fullName}</option>`).join("");
  el("scheduleTable").innerHTML = `<form id="appointmentForm" class="inline-form-card"><div class="section-header compact"><div><p class="eyebrow">Book instantly</p><h4>New appointment</h4></div><span class="pill">Optimistic save</span></div><select id="appointmentClientId" required><option value="">Select client</option>${clientOptions}</select><div class="inline-grid two"><input id="appointmentStaffName" type="text" placeholder="Staff name" value="Dr. Lemi" required /><input id="appointmentServiceType" type="text" placeholder="Service type" value="Consultation" required /></div><div class="inline-grid two"><input id="appointmentStartsAt" type="datetime-local" required /><input id="appointmentEndsAt" type="datetime-local" required /></div><textarea id="appointmentNotes" placeholder="Notes or visit purpose"></textarea><div class="form-actions"><button type="submit">Book locally</button></div></form>`;
}

function renderBilling() {
  el("invoicePreview").innerHTML = `<p class="eyebrow">Invoice preview</p><h3>Local-first sale</h3><p>Every sale writes to SQLite first, then syncs to the shared backend.</p><div class="receipt-line"><span>Pending operations</span><strong>${state.summary.pendingOperations ?? 0}</strong></div><div class="receipt-line"><span>Conflicts waiting</span><strong>${state.syncStatus.conflicts ?? 0}</strong></div><div class="receipt-line"><span>Last pulled revision</span><strong>${state.syncStatus.lastPulledRevision ?? 0}</strong></div>`;
  el("paymentMethods").innerHTML = trArray("content.paymentMethods", fallbackContent.paymentMethods).map(([name, text]) => `<div class="payment-method"><div><strong>${name}</strong><p>${text}</p></div></div>`).join("");
}

function renderInventory() {
  const defaultItem = selectedInventoryItem();
  const clientOptions = state.allClients.map((client) => `<option value="${client.id}">${client.fullName}</option>`).join("");
  const inventoryOptions = state.inventory.map((item) => `<option value="${item.sku}" ${item.id === defaultItem?.id ? "selected" : ""}>${item.name} · ${item.quantityOnHand} in stock</option>`).join("");
  const rows = state.inventory
    .filter(passesInventoryFilter)
    .map((item) => {
      const badge = getExpiryBadge(item);
      return `<tr>
        <td>${item.name}</td>
        <td>${item.quantityOnHand}</td>
        <td>${item.batchNumber ?? "—"}</td>
        <td>${item.expiresOn ? new Date(item.expiresOn).toLocaleDateString() : "—"}</td>
        <td><span class="pill ${badge.level === "danger" ? "warning" : ""}">${badge.label}</span></td>
        <td>${item.sku}</td>
      </tr>`;
    })
    .join("");

  el("inventoryTable").innerHTML = `
    <form id="quickSaleForm" class="inline-form-card">
      <div class="section-header compact">
        <div><p class="eyebrow">Counter sale</p><h4>Create sale locally</h4></div>
        <span class="pill">Fast checkout</span>
      </div>
      <div class="inline-grid two">
        <select id="saleClientId" required><option value="">Select client</option>${clientOptions}</select>
        <select id="saleInventorySku" required>${inventoryOptions}</select>
      </div>
      <div class="inline-grid three">
        <input id="saleQuantity" type="number" min="1" value="1" required />
        <input id="saleInvoiceNumber" type="text" placeholder="Invoice number" value="INV-${Date.now()}" required />
        <select id="salePaymentMethod"><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile Money</option><option value="BANK_TRANSFER">Bank Transfer</option></select>
      </div>
      <div class="form-actions">
        <button type="submit">Complete sale</button>
      </div>
    </form>
    <div class="form-actions">
      <button type="button" class="ghost-button" data-filter="all">All</button>
      <button type="button" class="ghost-button" data-filter="near_expiry">Near expiry</button>
      <button type="button" class="ghost-button" data-filter="expired">Expired</button>
      <button type="button" class="ghost-button" data-filter="low_stock">Low stock</button>
    </div>
    <table class="inventory-grid-table">
      <thead><tr><th>Medicine</th><th>Stock</th><th>Batch</th><th>Expiry</th><th>Status</th><th>SKU</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='6'>No items for this filter.</td></tr>"}</tbody>
    </table>`;
}

function renderMessages() {
  el("messageThreads").innerHTML = trArray("content.threads", fallbackContent.threads).map(([name, text]) => `<div class="thread-row"><strong>${name}</strong><p>${text}</p></div>`).join("");
  el("messageCompose").innerHTML = `<div class="compose-card"><p class="eyebrow">Compose</p><h3>Instant local send</h3><p>Messages append locally first, then sync silently in the background with no conflict center required.</p></div>`;
}

function renderAnalytics() {
  el("revenueBars").innerHTML = `<p class="eyebrow">Monthly trend</p><h3>Revenue momentum</h3><div class="bar-chart">${trArray("content.analytics", fallbackContent.analytics).map(([month, value]) => `<div class="bar" style="height:${value}%"><span>${month}</span></div>`).join("")}</div>`;
  el("analyticsFacts").innerHTML = trArray("content.facts", fallbackContent.facts).map(([name, value]) => `<div class="list-row"><strong>${name}</strong><p>${value}</p></div>`).join("");
}

function renderSettings() {
  el("settingsForm").innerHTML = `<div class="section-header compact"><div><p class="eyebrow">Runtime settings</p><h4>Desktop configuration</h4></div><span class="pill">v${state.appMeta.version}</span></div><input id="settingsBackendUrl" type="text" value="${state.settings.backendUrl ?? ""}" placeholder="Backend URL" /><input id="settingsSyncInterval" type="number" min="5000" step="1000" value="${state.settings.syncIntervalMs ?? 15000}" placeholder="Sync interval ms" /><input id="settingsAuthEmail" type="email" placeholder="Login email" value="${state.syncStatus.sessionEmail ?? ""}" /><input id="settingsAuthPassword" type="password" placeholder="Password (not stored after login)" /><div class="form-actions"><button type="submit">Save settings</button><button type="button" id="loginButton" class="ghost-button">${state.syncStatus.authenticated ? "Refresh login" : "Sign in"}</button><button type="button" id="logoutButton" class="ghost-button">Sign out</button><button type="button" id="exportBackupButton" class="ghost-button">Export database</button></div>`;
  el("settingsMeta").innerHTML = `<div class="client-hero"><div><p class="eyebrow">Device info</p><h4>${state.syncStatus.deviceId ?? "Unregistered device"}</h4></div><span class="pill">${state.syncStatus.syncStatus}</span></div>`;
}

function renderSyncCenter() {
  const presentation = syncPresentation(state.syncStatus);
  const syncLines = [["Desktop device", state.syncStatus.deviceId ?? "unregistered"], ["Sync state", presentation.text], ["Pending operations", String(state.syncStatus.pendingOperations ?? 0)], ["Conflicts", `${state.syncStatus.conflicts ?? 0} ${tr("sections.conflicts.waiting")}`], ["Last revision", String(state.syncStatus.lastPulledRevision ?? 0)]];
  el("syncGrid").innerHTML = syncLines.map(([title, body]) => `<article class="sync-card"><strong>${title}</strong><p>${body}</p></article>`).join("");
}

function renderConflictCenter() {
  const current = selectedConflict();
  el("conflictBadge").textContent = `${state.conflicts.length} ${tr("sections.conflicts.waiting")}`;
  el("conflictList").innerHTML = state.conflicts.length ? state.conflicts.map((conflict) => `<button class="list-row conflict-row ${conflict.id === current?.id ? "selected" : ""}" data-conflict-id="${conflict.id}"><strong>${conflict.status}</strong><p>${conflict.entityType} · ${conflict.operation}</p></button>`).join("") : `<div class="empty-state"><strong>No conflicts</strong></div>`;
  if (!current) {
    el("conflictDetail").innerHTML = `<div class="empty-state"><strong>Conflict detail</strong></div>`;
  }
}

function renderInspector() {
  el("miniStats").innerHTML = trArray("content.miniStats", fallbackContent.miniStats).map(([label, value]) => `<div class="mini-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  const lowStockItems = state.inventory.slice().sort((left, right) => left.quantityOnHand - right.quantityOnHand).slice(0, 3).map((item) => [item.name, `${item.quantityOnHand} on hand`]);
  el("lowStockList").innerHTML = (lowStockItems.length ? lowStockItems : [["No stock alerts", "Inventory is within safe thresholds"]]).map(([name, value]) => `<div class="signal-row"><strong>${name}</strong><p>${value}</p></div>`).join("");
  el("messageQueue").innerHTML = trArray("content.messageQueue", fallbackContent.messageQueue).map(([time, value]) => `<div class="signal-row"><strong>${time}</strong><p>${value}</p></div>`).join("");
}

function renderGlobalSyncState() {
  const presentation = syncPresentation(state.syncStatus);
  const syncBadge = el("syncStatusBadge");
  syncBadge.textContent = presentation.text;
  syncBadge.className = `sync-badge ${presentation.className}`;
  el("syncHealthLabel").textContent = presentation.hero;
  el("syncPill").textContent = state.syncStatus.conflicts > 0 ? tr("sync.conflictsCount", { count: state.syncStatus.conflicts }) : tr("sections.sync.pill");
  el("offlineCount").textContent = `${state.summary.pendingOperations ?? 0} pending ops`;
  el("headline").textContent = state.toast || tr("app.headline");
}

function render() {
  applyStaticTranslations();
  renderKpis();
  renderPriorities();
  renderClients();
  renderSchedule();
  renderBilling();
  renderInventory();
  renderMessages();
  renderAnalytics();
  renderSyncCenter();
  renderConflictCenter();
  renderSettings();
  renderInspector();
  renderGlobalSyncState();
}

function setSection(section) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
  document.querySelectorAll(".section-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== section));
}

async function setLanguage(language) {
  state.language = language;
  await loadLanguagePack(language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  el("languageToggle").textContent = tr("app.languageToggle");
  render();
}

function setTheme(isDark) {
  state.dark = isDark;
  document.body.classList.toggle("dark", isDark);
  el("themeToggle").textContent = isDark ? tr("app.themeLight") : tr("app.themeDark");
}

function fillClientForm(client = null) {
  state.formMode = client ? "edit" : "create";
  state.formClientId = client?.id ?? null;
  el("clientFormMode").textContent = client ? "Edit" : "Create";
  el("clientSubmitButton").textContent = client ? "Update locally" : "Save locally";
  el("clientFullName").value = client?.fullName ?? "";
  el("clientPhone").value = client?.phone ?? "";
  el("clientEmail").value = client?.email ?? "";
  el("clientCity").value = client?.city ?? "Juba";
  el("clientNotes").value = client?.notes ?? "";
}

function applySearchFilter() {
  const query = state.searchQuery.trim().toLowerCase();
  state.clients = !query ? [...state.allClients] : state.allClients.filter((client) => [client.fullName, client.phone, client.city, client.clientCode].filter(Boolean).some((value) => value.toLowerCase().includes(query)));
}

async function hydrateFromLocalDatabase() {
  try {
    const [summaryResponse, syncResponse, clientsResponse, conflictsResponse, inventoryResponse, appointmentsResponse, settingsResponse, metaResponse] = await Promise.all([fetch("/api/local/summary"), fetch("/api/local/sync/status"), fetch("/api/local/clients"), fetch("/api/local/conflicts"), fetch("/api/local/inventory"), fetch("/api/local/appointments"), fetch("/api/local/settings"), fetch("/api/local/app-meta")]);
    if (![summaryResponse, syncResponse, clientsResponse, conflictsResponse, inventoryResponse, appointmentsResponse, settingsResponse, metaResponse].every((response) => response.ok)) return;
    state.summary = await summaryResponse.json();
    state.syncStatus = await syncResponse.json();
    state.allClients = await clientsResponse.json();
    state.inventory = await inventoryResponse.json();
    state.appointments = await appointmentsResponse.json();
    state.conflicts = await conflictsResponse.json();
    state.settings = await settingsResponse.json();
    state.appMeta = await metaResponse.json();
    applySearchFilter();
    if (!state.selectedClientId && state.clients.length) state.selectedClientId = state.clients[0].id;
    if (!state.selectedConflictId && state.conflicts.length) state.selectedConflictId = state.conflicts[0].id;
    render();
  } catch {
    // Keep shell usable if local API is unavailable.
  }
}

async function handleClientSubmit(event) {
  event.preventDefault();
  const payload = { fullName: el("clientFullName").value.trim(), phone: el("clientPhone").value.trim() || null, email: el("clientEmail").value.trim() || null, city: el("clientCity").value.trim() || "Juba", notes: el("clientNotes").value.trim() || null };
  if (!payload.fullName) return;
  const url = state.formMode === "edit" && state.formClientId ? `/api/local/clients/${state.formClientId}` : "/api/local/clients";
  const method = state.formMode === "edit" && state.formClientId ? "PATCH" : "POST";
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) return setToast(tr("toasts.clientSaveNeedsAttention"));
  const client = await response.json();
  state.selectedClientId = client.id;
  fillClientForm(null);
  setToast(tr("toasts.savedLocallySyncing"));
  await hydrateFromLocalDatabase();
}

async function handleAppointmentSubmit(event) {
  event.preventDefault();
  const payload = {
    clientId: el("appointmentClientId").value,
    staffName: el("appointmentStaffName").value.trim(),
    serviceType: el("appointmentServiceType").value.trim(),
    startsAt: el("appointmentStartsAt").value,
    endsAt: el("appointmentEndsAt").value,
    notes: el("appointmentNotes").value.trim() || null
  };
  if (!payload.clientId || !payload.startsAt || !payload.endsAt) return;

  const response = await fetch("/api/local/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    setToast(tr("toasts.appointmentSaveNeedsAttention"));
    return;
  }
  setToast(tr("toasts.appointmentSavedLocally"));
  await hydrateFromLocalDatabase();
}

async function handleQuickSaleSubmit(event) {
  event.preventDefault();
  const inventorySku = el("saleInventorySku").value;
  const clientId = el("saleClientId").value;
  const quantity = Number(el("saleQuantity").value);
  const invoiceNumber = el("saleInvoiceNumber").value.trim();
  const paymentMethod = el("salePaymentMethod").value;
  const item = state.inventory.find((entry) => entry.sku === inventorySku);
  const expiry = getExpiryBadge(item ?? {});

  if (!inventorySku || !clientId || !quantity || !item) return;
  if (expiry.level === "danger") {
    setToast("Blocked: cannot sell expired medicine");
    return;
  }
  if (expiry.level === "warning") {
    const confirmNearExpiry = window.confirm(`This item is near expiry (${expiry.label}). Continue?`);
    if (!confirmNearExpiry) return;
  }

  const response = await fetch("/api/local/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceNumber,
      clientId,
      inventorySku,
      quantity,
      totalMinor: item.salePriceMinor * quantity,
      paymentMethod
    })
  });
  if (!response.ok) {
    setToast(tr("toasts.saleCouldNotBeSaved"));
    return;
  }
  setToast(tr("toasts.saleSavedLocally"));
  await hydrateFromLocalDatabase();
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const response = await fetch("/api/local/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backendUrl: el("settingsBackendUrl").value.trim(),
      syncIntervalMs: Number(el("settingsSyncInterval").value)
    })
  });
  if (!response.ok) {
    setToast(tr("toasts.settingsSaveFailed"));
    return;
  }
  setToast(tr("toasts.settingsSaved"));
  await hydrateFromLocalDatabase();
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "appointmentForm") handleAppointmentSubmit(event);
  if (event.target.id === "quickSaleForm") handleQuickSaleSubmit(event);
  if (event.target.id === "settingsForm") handleSettingsSubmit(event);
});
el("clientForm").addEventListener("submit", handleClientSubmit);
el("clientResetButton").addEventListener("click", () => fillClientForm(null));
el("syncNowButton").addEventListener("click", () => hydrateFromLocalDatabase());
el("themeToggle").addEventListener("click", () => setTheme(!state.dark));
el("languageToggle").addEventListener("click", async () => setLanguage(state.language === "en" ? "ar" : "en"));
el("searchInput").addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  applySearchFilter();
  render();
});
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setSection(button.dataset.section)));
document.addEventListener("click", (event) => {
  const clientButton = event.target.closest("[data-client-id]");
  const filterButton = event.target.closest("[data-filter]");
  if (clientButton) {
    state.selectedClientId = clientButton.dataset.clientId;
    fillClientForm(selectedClient());
    render();
  }
  if (filterButton) {
    state.inventoryFilter = filterButton.dataset.filter;
    renderInventory();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "F2") {
    event.preventDefault();
    void setLanguage(state.language === "en" ? "ar" : "en");
  }
  if (event.key === "F4") {
    event.preventDefault();
    document.getElementById("quickSaleForm")?.requestSubmit();
  }
  if (event.key === "Escape") {
    const quantity = document.getElementById("saleQuantity");
    const invoice = document.getElementById("saleInvoiceNumber");
    if (quantity) quantity.value = "1";
    if (invoice) invoice.value = `INV-${Date.now()}`;
  }
});

await setLanguage("en");
setTheme(false);
fillClientForm(null);
setSection("overview");
await hydrateFromLocalDatabase();
setInterval(hydrateFromLocalDatabase, 10000);
