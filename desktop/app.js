const state = {
  dark: false,
  language: "en",
  syncStatus: {
    syncStatus: "IDLE",
    pendingOperations: 0,
    conflicts: 0,
    lastPulledRevision: 0,
    lastSyncCompletedAt: null,
    lastSyncError: null
  },
  summary: {
    clients: 0,
    invoices: 0,
    inventory: 0,
    appointments: 0,
    messages: 0,
    pendingOperations: 0
  },
  allClients: [],
  clients: [],
  inventory: [],
  appointments: [],
  conflicts: [],
  settings: {
    backendUrl: "http://127.0.0.1:8090",
    syncIntervalMs: 15000
  },
  appMeta: {
    version: "1.0.0",
    runtimePaths: {}
  },
  selectedClientId: null,
  selectedConflictId: null,
  formMode: "create",
  formClientId: null,
  searchQuery: "",
  toast: ""
};

const content = {
  priorities: [
    ["Morning stock receipt", "Receive amoxicillin, ORS, and glucose strips with batch and expiry capture.", "Dock closes at 10:30"],
    ["Pending mobile money settlement", "Confirm three MTN money references before issuing end-of-day report.", "SSP 1.16M awaiting verification"],
    ["Care reminders", "Send refill reminders in English and Arabic for chronic care clients.", "36 SMS scheduled"],
    ["Branch sync", "Every local write is immediate. Sync catches up quietly when the connection returns.", "Background sync enabled"]
  ],
  paymentMethods: [
    ["Cash", "Fastest at the counter. Works offline immediately."],
    ["Mobile Money", "Capture provider and reference. Reconcile when network returns."],
    ["Bank Transfer", "Attach transfer slip and approve after verification."]
  ],
  threads: [
    ["Refill reminders", "12 SMS waiting for noon dispatch"],
    ["Payment follow-up", "3 debt reminders drafted"],
    ["Supplier notice", "Bank transfer confirmation required"]
  ],
  facts: [
    ["Mobile money mix", "32% of collections this week"],
    ["Top category", "Antibiotics and chronic-care medication"],
    ["Average queue time", "6 minutes at front desk"],
    ["Missed appointments", "4.2% after SMS reminders"]
  ],
  miniStats: [
    ["Cash in drawer", "SSP 2.1M"],
    ["Mobile money today", "SSP 1.5M"],
    ["Customers served", "67"],
    ["Pending approvals", "5"]
  ],
  messageQueue: [
    ["11:30", "Arabic refill reminders"],
    ["13:00", "Payment balance prompts"],
    ["16:00", "Tomorrow appointment confirmations"]
  ],
  analytics: [
    ["Jan", 40],
    ["Feb", 58],
    ["Mar", 76],
    ["Apr", 67],
    ["May", 88]
  ]
};

const translations = {
  en: { headline: "Operations overview", toggle: "AR" },
  ar: { headline: "نظرة تشغيلية عامة", toggle: "EN" }
};

const el = (id) => document.getElementById(id);

function syncPresentation(syncStatus) {
  if (syncStatus.syncStatus === "ERROR") {
    return { text: "Needs attention", className: "sync-error", hero: "Reconnecting…", line: syncStatus.lastSyncError ?? "Network or server attention needed." };
  }

  if (syncStatus.conflicts > 0) {
    return { text: `Conflicts ${syncStatus.conflicts}`, className: "sync-conflict", hero: "Needs attention", line: "A few records need a quick human decision." };
  }

  if (syncStatus.syncStatus === "SYNCING") {
    return { text: "Syncing changes…", className: "sync-active", hero: "Syncing changes…", line: "Local work is safe. Cloud reconciliation is running." };
  }

  if (syncStatus.pendingOperations > 0) {
    return { text: "Queued locally", className: "sync-active", hero: "Saved locally • syncing…", line: `${syncStatus.pendingOperations} local changes waiting for sync.` };
  }

  if (syncStatus.remoteBaseUrl && syncStatus.lastPulledRevision > 0) {
    return { text: "Synced", className: "sync-ok", hero: `Revision ${syncStatus.lastPulledRevision} • synced`, line: "Everything local has been reconciled to the server." };
  }

  return { text: "Waiting", className: "sync-idle", hero: "Waiting for first sync", line: "The desktop is ready to work locally." };
}

function selectedClient() {
  return state.clients.find((client) => client.id === state.selectedClientId) ?? state.clients[0] ?? null;
}

function selectedConflict() {
  return state.conflicts.find((conflict) => conflict.id === state.selectedConflictId) ?? state.conflicts[0] ?? null;
}

function selectedInventoryItem() {
  return state.inventory[0] ?? null;
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
    { label: "Clients", value: String(state.summary.clients), delta: "Local-first CRM records" },
    { label: "Appointments", value: String(state.summary.appointments), delta: "Booked instantly on-device" },
    { label: "Invoices", value: String(state.summary.invoices), delta: "Captured without waiting for network" },
    { label: "Inventory", value: String(state.summary.inventory), delta: `${state.summary.pendingOperations ?? 0} local changes waiting` }
  ];

  el("kpiGrid").innerHTML = kpis.map((item) => `
    <article class="metric-card">
      <span class="eyebrow">${item.label}</span>
      <strong>${item.value}</strong>
      <span>${item.delta}</span>
    </article>`).join("");
}

function renderPriorities() {
  el("priorityGrid").innerHTML = content.priorities.map(([title, body, meta]) => `
    <article class="priority-item">
      <strong>${title}</strong>
      <p>${body}</p>
      <p class="eyebrow">${meta}</p>
    </article>`).join("");
}

function renderClients() {
  const current = selectedClient();

  el("clientList").innerHTML = state.clients.length
    ? state.clients.map((client) => `
      <button class="list-row client-row ${client.id === current?.id ? "selected" : ""}" data-client-id="${client.id}">
        <strong>${client.fullName}</strong>
        <p>${client.phone ?? "No phone recorded"}</p>
        <p>${client.dirty ? "Saved locally • syncing…" : "Synced ✔"}</p>
      </button>`).join("")
    : `<div class="empty-state"><strong>No clients yet</strong><p>Create a client locally and let the sync engine handle the rest.</p></div>`;

  if (!current) {
    el("clientName").textContent = "No client selected";
    el("clientStats").innerHTML = "";
    el("clientTimeline").innerHTML = `<div class="empty-state"><p>Select a client to inspect sync and contact history.</p></div>`;
    return;
  }

  el("clientName").textContent = current.fullName;
  el("clientStats").innerHTML = [
    current.preferredLanguage?.toUpperCase() ?? "EN",
    current.city ?? "No city",
    current.dirty ? "Saved locally • syncing…" : "Synced ✔"
  ].map((tag) => `<span>${tag}</span>`).join("");

  el("clientTimeline").innerHTML = [
    `Phone: ${current.phone ?? "Not captured"}`,
    `Email: ${current.email ?? "Not captured"}`,
    `Server revision: ${current.serverRevision ?? 0}`,
    `Updated: ${new Date(current.updatedAt).toLocaleString()}`
  ].concat(current.notes ? [`Notes: ${current.notes}`] : []).map((item) => `<div class="list-row"><p>${item}</p></div>`).join("");
}

function renderSchedule() {
  const clientOptions = state.allClients.map((client) => `<option value="${client.id}">${client.fullName}</option>`).join("");

  el("scheduleTable").innerHTML = `
    <form id="appointmentForm" class="inline-form-card">
      <div class="section-header compact">
        <div>
          <p class="eyebrow">Book instantly</p>
          <h4>New appointment</h4>
        </div>
        <span class="pill">Optimistic save</span>
      </div>
      <select id="appointmentClientId" required>
        <option value="">Select client</option>
        ${clientOptions}
      </select>
      <div class="inline-grid two">
        <input id="appointmentStaffName" type="text" placeholder="Staff name" value="Dr. Lemi" required />
        <input id="appointmentServiceType" type="text" placeholder="Service type" value="Consultation" required />
      </div>
      <div class="inline-grid two">
        <input id="appointmentStartsAt" type="datetime-local" required />
        <input id="appointmentEndsAt" type="datetime-local" required />
      </div>
      <textarea id="appointmentNotes" placeholder="Notes or visit purpose"></textarea>
      <div class="form-actions">
        <button type="submit">Book locally</button>
      </div>
    </form>
    ${state.appointments.map((appointment) => `
      <div class="schedule-row">
        <strong>${new Date(appointment.startsAt).toLocaleString()} · ${appointment.serviceType}</strong>
        <p>${appointment.staffName ?? "Unassigned"} · ${appointment.client?.fullName ?? "Client"}</p>
        <p>${appointment.dirty ? "Saved locally • syncing…" : "Synced ✔"}</p>
      </div>`).join("") || `<div class="empty-state"><p>No appointments yet.</p></div>`}`;
}

function renderBilling() {
  el("invoicePreview").innerHTML = `
    <p class="eyebrow">Invoice preview</p>
    <h3>Local-first sale</h3>
    <p>Every sale writes to SQLite first, then syncs to the shared backend.</p>
    <div class="receipt-line"><span>Pending operations</span><strong>${state.summary.pendingOperations ?? 0}</strong></div>
    <div class="receipt-line"><span>Conflicts waiting</span><strong>${state.syncStatus.conflicts ?? 0}</strong></div>
    <div class="receipt-line"><span>Last pulled revision</span><strong>${state.syncStatus.lastPulledRevision ?? 0}</strong></div>`;

  el("paymentMethods").innerHTML = content.paymentMethods.map(([name, text]) => `
    <div class="payment-method">
      <div><strong>${name}</strong><p>${text}</p></div>
    </div>`).join("");
}

function renderInventory() {
  const defaultItem = selectedInventoryItem();
  const clientOptions = state.allClients.map((client) => `<option value="${client.id}">${client.fullName}</option>`).join("");
  const inventoryOptions = state.inventory.map((item) => `<option value="${item.sku}" ${item.id === defaultItem?.id ? "selected" : ""}>${item.name} · ${item.quantityOnHand} in stock</option>`).join("");

  el("inventoryTable").innerHTML = `
    <form id="quickSaleForm" class="inline-form-card">
      <div class="section-header compact">
        <div>
          <p class="eyebrow">Counter sale</p>
          <h4>Create sale locally</h4>
        </div>
        <span class="pill">Fast checkout</span>
      </div>
      <div class="inline-grid two">
        <select id="saleClientId" required>
          <option value="">Select client</option>
          ${clientOptions}
        </select>
        <select id="saleInventorySku" required>
          ${inventoryOptions}
        </select>
      </div>
      <div class="inline-grid three">
        <input id="saleQuantity" type="number" min="1" value="1" required />
        <input id="saleInvoiceNumber" type="text" placeholder="Invoice number" value="INV-${Date.now()}" required />
        <select id="salePaymentMethod">
          <option value="CASH">Cash</option>
          <option value="MOBILE_MONEY">Mobile Money</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="submit">Save sale locally</button>
      </div>
    </form>
    ${state.inventory.map((item) => `
      <div class="inventory-row">
        <strong>${item.name}</strong>
        <p>${item.quantityOnHand} on hand · reorder ${item.reorderLevel}</p>
        <p>${item.sku}</p>
        <p>${item.dirty ? "Saved locally • syncing…" : "Synced ✔"}</p>
      </div>`).join("") || `<div class="empty-state"><p>No inventory loaded.</p></div>`}`;
}

function renderMessages() {
  el("messageThreads").innerHTML = content.threads.map(([name, text]) => `
    <div class="thread-row"><strong>${name}</strong><p>${text}</p></div>`).join("");

  el("messageCompose").innerHTML = `
    <div class="compose-card">
      <p class="eyebrow">Compose</p>
      <h3>Instant local send</h3>
      <p>Messages append locally first, then sync silently in the background with no conflict center required.</p>
    </div>
    <div class="compose-card">
      <p class="eyebrow">Experience</p>
      <p>Reliable enough for low-connectivity field work, fast enough to feel immediate at the front desk.</p>
    </div>`;
}

function renderAnalytics() {
  el("revenueBars").innerHTML = `
    <p class="eyebrow">Monthly trend</p>
    <h3>Revenue momentum</h3>
    <div class="bar-chart">
      ${content.analytics.map(([month, value]) => `<div class="bar" style="height:${value}%"><span>${month}</span></div>`).join("")}
    </div>`;

  el("analyticsFacts").innerHTML = content.facts.map(([name, value]) => `
    <div class="list-row"><strong>${name}</strong><p>${value}</p></div>`).join("");
}

function renderSettings() {
  el("settingsForm").innerHTML = `
    <div class="section-header compact">
      <div>
        <p class="eyebrow">Runtime settings</p>
        <h4>Desktop configuration</h4>
      </div>
      <span class="pill">v${state.appMeta.version}</span>
    </div>
    <input id="settingsBackendUrl" type="text" value="${state.settings.backendUrl ?? ""}" placeholder="Backend URL" />
    <input id="settingsSyncInterval" type="number" min="5000" step="1000" value="${state.settings.syncIntervalMs ?? 15000}" placeholder="Sync interval ms" />
    <input id="settingsAuthEmail" type="email" placeholder="Login email" value="${state.syncStatus.sessionEmail ?? ""}" />
    <input id="settingsAuthPassword" type="password" placeholder="Password (not stored after login)" />
    <div class="form-actions">
      <button type="submit">Save settings</button>
      <button type="button" id="loginButton" class="ghost-button">${state.syncStatus.authenticated ? "Refresh login" : "Sign in"}</button>
      <button type="button" id="logoutButton" class="ghost-button">Sign out</button>
      <button type="button" id="exportBackupButton" class="ghost-button">Export database</button>
    </div>`;

  el("settingsMeta").innerHTML = `
    <div class="client-hero">
      <div>
        <p class="eyebrow">Device info</p>
        <h4>${state.syncStatus.deviceId ?? "Unregistered device"}</h4>
      </div>
      <span class="pill">${state.syncStatus.syncStatus}</span>
    </div>
    <div class="timeline">
      <div class="list-row"><p>App version: ${state.appMeta.version}</p></div>
      <div class="list-row"><p>Backend URL: ${state.settings.backendUrl}</p></div>
      <div class="list-row"><p>Sync interval: ${state.settings.syncIntervalMs} ms</p></div>
      <div class="list-row"><p>Session: ${state.syncStatus.authenticated ? `Signed in as ${state.syncStatus.sessionEmail}` : "Not signed in"}</p></div>
      <div class="list-row"><p>Data directory: ${state.appMeta.runtimePaths?.baseDir ?? "runtime/"}</p></div>
      <div class="list-row"><p>Backups: ${state.appMeta.runtimePaths?.backupsDir ?? "runtime/backups"}</p></div>
      <div class="list-row"><p>Logs: ${state.appMeta.runtimePaths?.logsDir ?? "runtime/logs"}</p></div>
    </div>`;
}

function renderSyncCenter() {
  const presentation = syncPresentation(state.syncStatus);
  const syncLines = [
    ["Desktop device", state.syncStatus.deviceId ?? "unregistered"],
    ["Sync state", presentation.text],
    ["Pending operations", String(state.syncStatus.pendingOperations ?? 0)],
    ["Conflicts", `${state.syncStatus.conflicts ?? 0} waiting`],
    ["Last revision", String(state.syncStatus.lastPulledRevision ?? 0)],
    ["Last sync", state.syncStatus.lastSyncCompletedAt ? new Date(state.syncStatus.lastSyncCompletedAt).toLocaleTimeString() : "Not synced yet"]
  ];

  el("syncGrid").innerHTML = syncLines.map(([title, body]) => `
    <article class="sync-card"><strong>${title}</strong><p>${body}</p></article>`).join("");
}

function renderConflictCenter() {
  const current = selectedConflict();
  el("conflictBadge").textContent = `${state.conflicts.length} waiting`;

  el("conflictList").innerHTML = state.conflicts.length
    ? state.conflicts.map((conflict) => {
        const payload = conflict.conflictPayloadJson ? JSON.parse(conflict.conflictPayloadJson) : null;
        const type = payload?.type ?? conflict.status;
        return `
          <button class="list-row conflict-row ${conflict.id === current?.id ? "selected" : ""}" data-conflict-id="${conflict.id}">
            <strong>${type}</strong>
            <p>${conflict.entityType} · ${conflict.operation}</p>
            <p>${payload?.resolution ?? conflict.errorDetail ?? "Needs review"}</p>
          </button>`;
      }).join("")
    : `<div class="empty-state"><strong>No conflicts</strong><p>Scheduling and inventory issues will land here without blocking the operator.</p></div>`;

  if (!current) {
    el("conflictDetail").innerHTML = `<div class="empty-state"><strong>Conflict detail</strong><p>Select a conflict to inspect the server response and next action.</p></div>`;
    return;
  }

  const payload = current.conflictPayloadJson ? JSON.parse(current.conflictPayloadJson) : null;
  const suggestions = payload?.suggestions ?? [];
  const currentStock = payload?.server?.quantity_on_hand ?? payload?.server?.quantityOnHand ?? "n/a";
  const attempted = payload?.local?.data?.quantity_on_hand ?? payload?.local?.data?.items?.[0]?.qty ?? "n/a";

  el("conflictDetail").innerHTML = `
    <div class="client-hero">
      <div>
        <p class="eyebrow">Needs review</p>
        <h4>${payload?.type ?? current.status}</h4>
      </div>
      <span class="pill warning">${current.entityType}</span>
    </div>
    <div class="timeline">
      <div class="list-row"><p>Operation: ${current.operation}</p></div>
      <div class="list-row"><p>Entity: ${current.entityId}</p></div>
      <div class="list-row"><p>Status: ${current.status}</p></div>
      <div class="list-row"><p>Reason: ${payload?.resolution ?? current.errorDetail ?? "Server requested user review."}</p></div>
      ${payload?.type === "INSUFFICIENT_STOCK" ? `<div class="list-row"><p>Current stock: ${currentStock} · attempted quantity: ${attempted}</p></div>` : ""}
      ${suggestions.length ? `<div class="list-row"><p>Suggested times: ${suggestions.join(", ")}</p></div>` : ""}
    </div>
    <div class="action-stack">
      ${suggestions.map((slot) => `<button class="action-button" data-conflict-action="reschedule" data-conflict-id="${current.id}" data-suggested-start="${slot}">Reschedule to ${slot}</button>`).join("")}
      ${payload?.type === "APPOINTMENT_OVERLAP" ? `<button class="ghost-button action-button" data-conflict-action="dismiss" data-conflict-id="${current.id}">Keep for later</button>` : ""}
      ${payload?.type !== "APPOINTMENT_OVERLAP" ? `<button class="ghost-button action-button" data-conflict-action="dismiss" data-conflict-id="${current.id}">Mark reviewed</button>` : ""}
    </div>`;
}

function renderInspector() {
  el("miniStats").innerHTML = content.miniStats.map(([label, value]) => `
    <div class="mini-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");

  const lowStockItems = state.inventory
    .slice()
    .sort((left, right) => left.quantityOnHand - right.quantityOnHand)
    .slice(0, 3)
    .map((item) => [item.name, `${item.quantityOnHand} on hand`]);

  el("lowStockList").innerHTML = (lowStockItems.length ? lowStockItems : [["No stock alerts", "Inventory is within safe thresholds"]]).map(([name, value]) => `
    <div class="signal-row"><strong>${name}</strong><p>${value}</p></div>`).join("");

  el("messageQueue").innerHTML = content.messageQueue.map(([time, value]) => `
    <div class="signal-row"><strong>${time}</strong><p>${value}</p></div>`).join("");
}

function renderGlobalSyncState() {
  const presentation = syncPresentation(state.syncStatus);
  const syncBadge = el("syncStatusBadge");
  syncBadge.textContent = presentation.text;
  syncBadge.className = `sync-badge ${presentation.className}`;

  el("syncHealthLabel").textContent = presentation.hero;
  el("syncPill").textContent = state.syncStatus.conflicts > 0 ? `${state.syncStatus.conflicts} conflicts` : "Auto retry enabled";
  el("offlineCount").textContent = `${state.summary.pendingOperations ?? 0} pending ops`;
  el("headline").textContent = state.toast || translations[state.language].headline;
}

function render() {
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

function setLanguage(language) {
  state.language = language;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  el("languageToggle").textContent = translations[language].toggle;
  renderGlobalSyncState();
}

function setTheme(isDark) {
  state.dark = isDark;
  document.body.classList.toggle("dark", isDark);
  el("themeToggle").textContent = isDark ? "Light" : "Dark";
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
  state.clients = !query
    ? [...state.allClients]
    : state.allClients.filter((client) =>
        [client.fullName, client.phone, client.city, client.clientCode]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query))
      );
}

async function hydrateFromLocalDatabase() {
  try {
    const [summaryResponse, syncResponse, clientsResponse, conflictsResponse, inventoryResponse, appointmentsResponse, settingsResponse, metaResponse] = await Promise.all([
      fetch("/api/local/summary"),
      fetch("/api/local/sync/status"),
      fetch("/api/local/clients"),
      fetch("/api/local/conflicts"),
      fetch("/api/local/inventory"),
      fetch("/api/local/appointments"),
      fetch("/api/local/settings"),
      fetch("/api/local/app-meta")
    ]);

    if (![summaryResponse, syncResponse, clientsResponse, conflictsResponse, inventoryResponse, appointmentsResponse, settingsResponse, metaResponse].every((response) => response.ok)) {
      return;
    }

    state.summary = await summaryResponse.json();
    state.syncStatus = await syncResponse.json();
    state.allClients = await clientsResponse.json();
    state.inventory = await inventoryResponse.json();
    state.appointments = await appointmentsResponse.json();
    state.conflicts = await conflictsResponse.json();
    state.settings = await settingsResponse.json();
    state.appMeta = await metaResponse.json();

    applySearchFilter();

    if (!state.selectedClientId && state.clients.length) {
      state.selectedClientId = state.clients[0].id;
    }

    if (state.selectedClientId && !state.clients.some((client) => client.id === state.selectedClientId)) {
      state.selectedClientId = state.clients[0]?.id ?? null;
    }

    if (!state.selectedConflictId && state.conflicts.length) {
      state.selectedConflictId = state.conflicts[0].id;
    }

    if (state.selectedConflictId && !state.conflicts.some((conflict) => conflict.id === state.selectedConflictId)) {
      state.selectedConflictId = state.conflicts[0]?.id ?? null;
    }

    render();
  } catch {
    // Keep the shell usable if the local API is unavailable.
  }
}

async function handleClientSubmit(event) {
  event.preventDefault();

  const payload = {
    fullName: el("clientFullName").value.trim(),
    phone: el("clientPhone").value.trim() || null,
    email: el("clientEmail").value.trim() || null,
    city: el("clientCity").value.trim() || "Juba",
    notes: el("clientNotes").value.trim() || null
  };

  if (!payload.fullName) {
    return;
  }

  const url = state.formMode === "edit" && state.formClientId
    ? `/api/local/clients/${state.formClientId}`
    : "/api/local/clients";
  const method = state.formMode === "edit" && state.formClientId ? "PATCH" : "POST";

  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    setToast("Client save needs attention");
    return;
  }

  const client = await response.json();
  state.selectedClientId = client.id;
  fillClientForm(null);
  setToast("Saved locally • syncing…");
  await hydrateFromLocalDatabase();
  setSection("crm");
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

  if (!payload.clientId || !payload.startsAt || !payload.endsAt) {
    return;
  }

  const response = await fetch("/api/local/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    setToast("Appointment save needs attention");
    return;
  }

  setToast("Appointment saved locally • syncing…");
  await hydrateFromLocalDatabase();
  setSection("calendar");
}

async function handleQuickSaleSubmit(event) {
  event.preventDefault();
  const inventorySku = el("saleInventorySku").value;
  const clientId = el("saleClientId").value;
  const quantity = Number(el("saleQuantity").value);
  const invoiceNumber = el("saleInvoiceNumber").value.trim();
  const paymentMethod = el("salePaymentMethod").value;
  const item = state.inventory.find((entry) => entry.sku === inventorySku);

  if (!inventorySku || !clientId || !quantity || !item) {
    return;
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
    setToast("Sale could not be saved locally");
    return;
  }

  setToast("Sale saved locally • syncing…");
  await hydrateFromLocalDatabase();
  setSection("inventory");
}

async function resolveConflictAction(action, conflictId, suggestedStart = null) {
  const response = await fetch(`/api/local/conflicts/${conflictId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: action === "reschedule" ? "RESCHEDULE" : "DISMISS", suggestedStart })
  });

  if (!response.ok) {
    setToast("Conflict action failed");
    return;
  }

  setToast(action === "reschedule" ? "Appointment rescheduled locally • syncing…" : "Conflict marked reviewed");
  await hydrateFromLocalDatabase();
  if (action === "reschedule") {
    setSection("calendar");
  }
}

async function runManualSync() {
  const response = await fetch("/api/local/sync/run", { method: "POST" });
  if (response.ok) {
    setToast("Sync completed");
    await hydrateFromLocalDatabase();
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const payload = {
    backendUrl: el("settingsBackendUrl").value.trim(),
    syncIntervalMs: Number(el("settingsSyncInterval").value)
  };

  const response = await fetch("/api/local/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    setToast("Settings save failed");
    return;
  }

  setToast("Settings saved");
  await hydrateFromLocalDatabase();
  setSection("settings");
}

async function exportBackup() {
  const response = await fetch("/api/local/backup/export", { method: "POST" });
  if (!response.ok) {
    setToast("Backup export failed");
    return;
  }

  const payload = await response.json();
  setToast(`Backup exported to ${payload.targetPath}`);
  await hydrateFromLocalDatabase();
}

async function loginDesktop() {
  const email = el("settingsAuthEmail").value.trim();
  const password = el("settingsAuthPassword").value;

  if (!email || !password) {
    setToast("Enter email and password");
    return;
  }

  const response = await fetch("/api/local/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    setToast("Desktop sign-in failed");
    return;
  }

  el("settingsAuthPassword").value = "";
  setToast("Signed in");
  await hydrateFromLocalDatabase();
}

async function logoutDesktop() {
  const response = await fetch("/api/local/auth/logout", { method: "POST" });
  if (!response.ok) {
    setToast("Sign out failed");
    return;
  }

  setToast("Signed out");
  await hydrateFromLocalDatabase();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setSection(button.dataset.section));
});

document.addEventListener("click", (event) => {
  const clientButton = event.target.closest("[data-client-id]");
  if (clientButton) {
    state.selectedClientId = clientButton.dataset.clientId;
    fillClientForm(selectedClient());
    render();
    return;
  }

  const conflictButton = event.target.closest("[data-conflict-id]");
  if (conflictButton && !event.target.closest("[data-conflict-action]")) {
    state.selectedConflictId = conflictButton.dataset.conflictId;
    renderConflictCenter();
    return;
  }

  const conflictAction = event.target.closest("[data-conflict-action]");
  if (conflictAction) {
    resolveConflictAction(
      conflictAction.dataset.conflictAction,
      conflictAction.dataset.conflictId,
      conflictAction.dataset.suggestedStart ?? null
    );
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "appointmentForm") {
    handleAppointmentSubmit(event);
  }

  if (event.target.id === "quickSaleForm") {
    handleQuickSaleSubmit(event);
  }

  if (event.target.id === "settingsForm") {
    handleSettingsSubmit(event);
  }
});

el("clientForm").addEventListener("submit", handleClientSubmit);
el("clientResetButton").addEventListener("click", () => fillClientForm(null));
el("syncNowButton").addEventListener("click", runManualSync);
el("themeToggle").addEventListener("click", () => setTheme(!state.dark));
el("languageToggle").addEventListener("click", () => setLanguage(state.language === "en" ? "ar" : "en"));
el("searchInput").addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  applySearchFilter();
  render();
});
document.addEventListener("click", (event) => {
  if (event.target.id === "exportBackupButton") {
    exportBackup();
  }
  if (event.target.id === "loginButton") {
    loginDesktop();
  }
  if (event.target.id === "logoutButton") {
    logoutDesktop();
  }
});

render();
setSection("overview");
setLanguage("en");
setTheme(false);
fillClientForm(null);
hydrateFromLocalDatabase();
setInterval(hydrateFromLocalDatabase, 10000);
