function $(id) { return document.getElementById(id); }

function setStatus(msg) {
  var el = $("status");
  if (!el) return;
  el.textContent = msg || "";
}

function setSysInfo(obj) {
  var el = $("sysInfo");
  if (!el) return;
  el.textContent = obj ? JSON.stringify(obj, null, 2) : "";
}

function setAcaOut(obj) {
  var el = $("acaOut");
  if (!el) return;
  el.textContent = obj ? (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)) : "";
}

async function ensureAuthenticated() {
  try {
    // Use a lightweight endpoint that requires auth.
    var res = await fetch("/api/v1/admin/info", { credentials: "same-origin" });
    if (res.status === 401) {
      window.location.href = "/api/v1/admin/login";
      return false;
    }
    return true;
  } catch (e) {
    // Network errors shouldn't hard-redirect; show a helpful status instead.
    setStatus("Error: Failed to reach admin API");
    return false;
  }
}

async function api(path, opts) {
  opts = opts || {};
  var hasBody = typeof opts.body !== "undefined" && opts.body !== null;

  var res = await fetch(path, {
    method: opts.method || "GET",
    body: opts.body,
    credentials: "same-origin",
    headers: Object.assign({}, (opts.headers || {}), hasBody ? { "Content-Type": "application/json" } : {})
  });

  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Not authenticated. Open /api/v1/admin/login to sign in.");
    }
    var detail = (data && (data.detail || data.message)) || ("Request failed (" + res.status + ")");
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

function tidyUndefined(obj) {
  if (!obj || typeof obj !== "object") return obj;
  Object.keys(obj).forEach(function (k) {
    if (typeof obj[k] === "undefined") delete obj[k];
  });
  return obj;
}

function getFormPayload() {
  var clientId = ($("clientId").value || "").trim();
  var name = ($("clientName").value || "").trim();
  var active = $("clientActive").value === "true";

  var defaults = {
    processing_config: {
      mode: $("mode").value,
      output_width: Number($("outW").value || 0) || undefined,
      output_height: Number($("outH").value || 0) || undefined,
      headroom_mm: Number($("headroom").value || 0) || undefined,
      manual_offset_x: Number($("offX").value || 0) || undefined,
      manual_offset_y: Number($("offY").value || 0) || undefined,
      manual_zoom: Number($("zoom").value || 0) || undefined,
      threads: Number($("threads").value || 0) || undefined
    },
    processing_params: {
      background_color: ($("defBg").value || "").trim() || undefined,
      output_format: $("defFmt").value
    }
  };

  tidyUndefined(defaults.processing_config);
  tidyUndefined(defaults.processing_params);

  var limits = {
    max_file_size: Number($("maxFile").value || 0) || undefined,
    max_batch_files: Number($("maxBatch").value || 0) || undefined,
    rate_limit_requests: Number($("rlReq").value || 0) || undefined,
    rate_limit_window: Number($("rlWin").value || 0) || undefined
  };
  tidyUndefined(limits);

  return {
    clientId: clientId,
    body: {
      name: name,
      active: active,
      profile: {
        defaults: defaults,
        limits: limits
      }
    }
  };
}

function fillForm(client) {
  $("clientId").value = (client && (client.client_id || client.clientId)) || "";
  $("clientName").value = (client && client.name) || "";
  $("clientActive").value = String(!!(client && client.active));

  var defaults = (client && client.profile && client.profile.defaults) || {};
  var cfg = defaults.processing_config || {};
  var params = defaults.processing_params || {};

  $("outW").value = (typeof cfg.output_width !== "undefined" ? cfg.output_width : "");
  $("outH").value = (typeof cfg.output_height !== "undefined" ? cfg.output_height : "");
  $("mode").value = cfg.mode || "auto";
  $("offX").value = (typeof cfg.manual_offset_x !== "undefined" ? cfg.manual_offset_x : "");
  $("offY").value = (typeof cfg.manual_offset_y !== "undefined" ? cfg.manual_offset_y : "");
  $("zoom").value = (typeof cfg.manual_zoom !== "undefined" ? cfg.manual_zoom : "");
  $("headroom").value = (typeof cfg.headroom_mm !== "undefined" ? cfg.headroom_mm : "");
  $("threads").value = (typeof cfg.threads !== "undefined" ? cfg.threads : "");

  $("defBg").value = params.background_color || "";
  $("defFmt").value = params.output_format || "png";

  var limits = (client && client.profile && client.profile.limits) || {};
  $("maxFile").value = (typeof limits.max_file_size !== "undefined" ? limits.max_file_size : "");
  $("maxBatch").value = (typeof limits.max_batch_files !== "undefined" ? limits.max_batch_files : "");
  $("rlReq").value = (typeof limits.rate_limit_requests !== "undefined" ? limits.rate_limit_requests : "");
  $("rlWin").value = (typeof limits.rate_limit_window !== "undefined" ? limits.rate_limit_window : "");

  $("generatedKey").textContent = "";
}

async function loadClients(selectClientId) {
  setStatus("Loading...");
  var data = await api("/api/v1/admin/clients");
  var clients = (data && data.clients) || [];

  var sel = $("clientSelect");
  sel.innerHTML = "";
  clients.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.client_id;
    opt.textContent = c.client_id + (c.active ? "" : " (disabled)");
    sel.appendChild(opt);
  });

  if (selectClientId) sel.value = selectClientId;
  var chosen = clients.find(function (x) { return x.client_id === sel.value; }) || clients[0];
  if (chosen) fillForm(chosen);

  setStatus("Loaded " + clients.length + " clients");

  try {
    var info = await api("/api/v1/admin/info");
    setSysInfo(info);
  } catch (e) {
    // keep UI usable even if info fails
  }

  return clients;
}

async function refreshInfo() {
  try {
    setStatus("Loading system info...");
    var info = await api("/api/v1/admin/info");
    setSysInfo(info);
    setStatus("System info updated");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function refreshAca() {
  try {
    setStatus("Loading Container App settings...");
    var st = await api("/api/v1/admin/aca/status");

    var appSel = $("acaApp");
    if (appSel && st && st.azure && Array.isArray(st.azure.allowed_apps)) {
      appSel.innerHTML = "";
      st.azure.allowed_apps.forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        appSel.appendChild(opt);
      });
    }

    setAcaOut(st);
    setStatus("Container App controls ready");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function acaApplyScale(minOnly) {
  try {
    var appName = $("acaApp").value;
    var minReplicas = Number($("acaMin").value);
    var maxRaw = $("acaMax").value;
    var payload = { appName: appName, minReplicas: minReplicas };
    if (!minOnly && maxRaw !== "") payload.maxReplicas = Number(maxRaw);

    setStatus("Applying scale...");
    var res = await api("/api/v1/admin/aca/scale", { method: "POST", body: JSON.stringify(payload) });
    setAcaOut(res);
    setStatus("Scale updated");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function acaApplyResources() {
  try {
    var appName = $("acaApp").value;
    var cpu = Number($("acaCpu").value);
    var memory = ($("acaMem").value || "").trim();
    var payload = { appName: appName, cpu: cpu, memory: memory };

    setStatus("Applying CPU/RAM...");
    var res = await api("/api/v1/admin/aca/resources", { method: "POST", body: JSON.stringify(payload) });
    setAcaOut(res);
    setStatus("Resources updated");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function acaListRevisions() {
  try {
    var appName = $("acaApp").value;
    setStatus("Listing revisions...");
    var res = await api("/api/v1/admin/aca/revisions?appName=" + encodeURIComponent(appName));
    setAcaOut(res);
    setStatus("Revisions loaded");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function acaCleanupRevisions() {
  try {
    var appName = $("acaApp").value;
    setStatus("Deleting inactive revisions...");
    var res = await api("/api/v1/admin/aca/cleanup-revisions", { method: "POST", body: JSON.stringify({ appName: appName }) });
    setAcaOut(res);
    setStatus("Cleanup completed");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function onSave() {
  try {
    var payload = getFormPayload();
    if (!payload.clientId) {
      setStatus("Client ID is required");
      return;
    }
    setStatus("Saving...");
    await api("/api/v1/admin/clients/" + encodeURIComponent(payload.clientId), {
      method: "PUT",
      body: JSON.stringify(payload.body)
    });
    await loadClients(payload.clientId);
    setStatus("Client saved");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function onGenerateKey() {
  try {
    var clientId = ($("clientId").value || "").trim();
    if (!clientId) {
      setStatus("Client ID is required");
      return;
    }
    setStatus("Generating key...");
    var res = await api("/api/v1/admin/clients/" + encodeURIComponent(clientId) + "/keys", {
      method: "POST",
      body: JSON.stringify({})
    });
    var key = (res && (res.api_key || res.key)) || "";
    $("generatedKey").textContent = key;
    setStatus("Key generated (shown once)");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function onDelete() {
  try {
    var clientId = ($("clientId").value || "").trim();
    if (!clientId) {
      setStatus("Client ID is required");
      return;
    }
    if (!confirm("Delete client '" + clientId + "'?")) return;

    setStatus("Deleting...");
    await api("/api/v1/admin/clients/" + encodeURIComponent(clientId), { method: "DELETE" });
    $("generatedKey").textContent = "";
    await loadClients();
    setStatus("Client deleted");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

async function onLogout() {
  try {
    setStatus("Logging out...");
    await api("/api/v1/admin/logout", { method: "POST" });
    setStatus("Logged out. Open /api/v1/admin/login to sign in again.");
  } catch (e) {
    setStatus("Error: " + (e && e.message ? e.message : e));
  }
}

$("loadBtn").addEventListener("click", function () { loadClients(); });
$("saveBtn").addEventListener("click", onSave);
$("genKeyBtn").addEventListener("click", onGenerateKey);
$("deleteBtn").addEventListener("click", onDelete);

var refreshBtn = $("refreshInfoBtn");
if (refreshBtn) refreshBtn.addEventListener("click", refreshInfo);

var acaRefreshBtn = $("acaRefreshBtn");
if (acaRefreshBtn) acaRefreshBtn.addEventListener("click", refreshAca);

var acaScaleBtn = $("acaScaleBtn");
if (acaScaleBtn) acaScaleBtn.addEventListener("click", function () { acaApplyScale(false); });

var acaScaleZeroBtn = $("acaScaleZeroBtn");
if (acaScaleZeroBtn) acaScaleZeroBtn.addEventListener("click", function () { $("acaMin").value = "0"; $("acaMax").value = ""; acaApplyScale(true); });

var acaResBtn = $("acaResBtn");
if (acaResBtn) acaResBtn.addEventListener("click", acaApplyResources);

var acaListRevsBtn = $("acaListRevsBtn");
if (acaListRevsBtn) acaListRevsBtn.addEventListener("click", acaListRevisions);

var acaCleanupRevsBtn = $("acaCleanupRevsBtn");
if (acaCleanupRevsBtn) acaCleanupRevsBtn.addEventListener("click", acaCleanupRevisions);

var logoutBtn = $("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", onLogout);

$("clientSelect").addEventListener("change", function () {
  var selected = $("clientSelect").value;
  if (!selected) return;
  loadClients(selected);
});

// Try to initialize ACA section on load.
if ($("acaApp")) {
  refreshAca();
}

// If not signed in, redirect to the login page.
(function () {
  ensureAuthenticated();
})();
