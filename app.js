/**
 * Scouter - Core Application Bundle
 * Implements centralized API routines, pub/sub architecture, 
 * reactive layout rendering, and event synchronization.
 */

const BASE_URL = "https://dragonball-api.com/api";
const STORAGE_KEY = "scouter.saved-fighters";
const FALLBACK_ART = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="#e3d8c3"/><text x="60" y="84" text-anchor="middle" font-family="monospace" font-size="11" fill="#3a2f2a">NO IMAGE</text></svg>`
)}`;

const SCALES = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, quadrillion: 1e15,
  quintillion: 1e18, sextillion: 1e21, septillion: 1e24, octillion: 1e27,
  nonillion: 1e30, decillion: 1e33, googolplex: Number.MAX_VALUE
};

/* ==========================================
   1. State Engine & Local Disk Management
   ========================================== */
const cache = new Map();
let favoriteIds = new Set();

const store = (() => {
  const initial = {
    page: 1, limit: 12, name: "", race: "", gender: "", affiliation: "", sort: "default", favoritesOnly: false,
    status: "idle", items: [], meta: { totalItems: 0, itemsPerPage: 12, totalPages: 1, currentPage: 1 }, error: null,
    archive: [], facets: { races: [], affiliations: [] }, featuredId: null
  };
  let state = { ...initial };
  const listeners = new Set();
  let pending = false;

  return {
    get: () => state,
    update(patch) {
      state = { ...state, ...patch };
      if (!pending) {
        pending = true;
        queueMicrotask(() => { pending = false; listeners.forEach(l => l(state)); });
      }
      return state;
    },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    reset() {
      state = { ...state, ...initial, archive: state.archive, facets: state.facets };
      listeners.forEach(l => l(state));
    }
  };
})();

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) JSON.parse(raw).forEach(id => favoriteIds.add(Number(id)));
  } catch (e) { /* Fallback gracefully if privacy settings block disk storage */ }
}

function toggleFavorite(id) {
  const numId = Number(id);
  if (favoriteIds.has(numId)) favoriteIds.delete(numId);
  else favoriteIds.add(numId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favoriteIds]));
  } catch (e) {}
  return favoriteIds.has(numId);
}

/* ==========================================
   2. API Communication Layers
   ========================================== */
async function apiRequest(path, params = {}, options = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) url.searchParams.set(k, v);
  });
  
  const urlStr = url.toString();
  if (cache.has(urlStr)) return cache.get(urlStr);

  try {
    const response = await fetch(urlStr, { signal: options.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
    const data = await response.json();
    cache.set(urlStr, data);
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Target connection failed. Please check your connection and retry.");
  }
}

function normalizePayload(payload, { page, limit }) {
  if (Array.isArray(payload)) {
    const totalItems = payload.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    return {
      items: payload.slice((safePage - 1) * limit, safePage * limit),
      meta: { totalItems, itemsPerPage: limit, totalPages, currentPage: safePage },
      all: payload
    };
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const meta = payload?.meta ?? {};
  return {
    items,
    meta: {
      totalItems: meta.totalItems ?? items.length,
      itemsPerPage: meta.itemsPerPage ?? limit,
      totalPages: meta.totalPages ?? 1,
      currentPage: meta.currentPage ?? page
    },
    all: null
  };
}

async function fetchSnapshot(options = {}) {
  const first = await apiRequest("/characters", { page: 1, limit: 50 }, options);
  if (Array.isArray(first)) return first;
  const items = first.items ?? [];
  const totalPages = first.meta?.totalPages ?? 1;
  if (totalPages <= 1) return items;

  const promises = Array.from({ length: totalPages - 1 }, (_, i) => 
    apiRequest("/characters", { page: i + 2, limit: 50 }, options)
  );
  const results = await Promise.all(promises);
  return results.reduce((acc, current) => acc.concat(current?.items ?? []), items);
}

/* ==========================================
   3. Math Sorting & Data Handlers
   ========================================== */
function parseKi(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === "unknown") return null;
  const match = text.match(/^([\d.,\s]+)\s*([a-z]+)?$/);
  if (!match) return null;
  const [, numberPart, scaleWord] = match;
  const scale = scaleWord ? SCALES[scaleWord] : 1;
  const cleaned = scaleWord ? numberPart.replace(/[,\s]/g, "") : numberPart.replace(/[.,\s]/g, "");
  const value = Number.parseFloat(cleaned);
  return !Number.isFinite(value) ? null : (scale === Number.MAX_VALUE ? Number.MAX_VALUE : value * scale);
}

function formatKi(raw) {
  const parsed = parseKi(raw);
  if (parsed === null) return (!raw || String(raw).toLowerCase() === "unknown") ? "No reading" : String(raw).trim();
  return parsed >= 1e15 ? String(raw) : parsed.toLocaleString("en-US");
}

function sortList(list, mode) {
  if (mode === "default") return list;
  const copy = [...list];
  const byName = (a, b) => a.name.localeCompare(b.name);
  
  if (mode.startsWith("ki")) {
    return copy.sort((a, b) => {
      const l = parseKi(a.ki), r = parseKi(b.ki);
      if (l === null && r === null) return byName(a, b);
      if (l === null) return 1;
      if (r === null) return -1;
      return mode === "ki-asc" ? l - r : r - l;
    });
  }
  return mode === "name-asc" ? copy.sort(byName) : copy.sort((a, b) => byName(b, a));
}

function localFilter(character, { name, race, gender, affiliation }) {
  if (name && !character.name?.toLowerCase().includes(name.toLowerCase())) return false;
  if (race && character.race !== race) return false;
  if (gender && character.gender !== gender) return false;
  if (affiliation && character.affiliation !== affiliation) return false;
  return true;
}

function localPaginate(list, page, limit) {
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  return {
    items: list.slice((currentPage - 1) * limit, currentPage * limit),
    meta: { totalItems, itemsPerPage: limit, totalPages, currentPage }
  };
}

/* ==========================================
   4. DOM Interaction & Component Views
   ========================================== */
const el = {
  mastheadCount: document.querySelector('[data-role="masthead-count"]'),
  scanName: document.querySelector('[data-role="scan-name"]'),
  scanKi: document.querySelector('[data-role="scan-ki"]'),
  scanRace: document.querySelector('[data-role="scan-race"]'),
  scanAffiliation: document.querySelector('[data-role="scan-affiliation"]'),
  scanBio: document.querySelector('[data-role="scan-bio"]'),
  scanArt: document.querySelector('[data-role="scan-art"]'),
  scanViewport: document.querySelector('[data-role="scan-viewport"]'),
  scanOpen: document.querySelector('[data-role="scan-open"]'),
  scanAgain: document.querySelector('[data-role="scan-again"]'),
  search: document.querySelector('[data-role="search"]'),
  filterRace: document.querySelector('[data-role="filter-race"]'),
  filterAffiliation: document.querySelector('[data-role="filter-affiliation"]'),
  filterGender: document.querySelector('[data-role="filter-gender"]'),
  sort: document.querySelector('[data-role="sort"]'),
  favoritesToggle: document.querySelector('[data-role="favorites-toggle"]'),
  favoritesCount: document.querySelector('[data-role="favorites-count"]'),
  reset: document.querySelector('[data-role="reset"]'),
  status: document.querySelector('[data-role="status"]'),
  grid: document.querySelector('[data-role="grid"]'),
  empty: document.querySelector('[data-role="empty"]'),
  pager: document.querySelector('[data-role="pager"]'),
  dialog: document.querySelector('[data-role="dialog"]'),
  dialogBody: document.querySelector('[data-role="dialog-body"]'),
  dialogClose: document.querySelector('[data-role="dialog-close"]'),
  toast: document.querySelector('[data-role="toast"]')
};

function escapeHtml(str = "") {
  return String(str).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

let stopActiveCounter = () => {};
function runPowerCounter(targetEl, targetKi) {
  stopActiveCounter();
  const num = parseKi(targetKi);
  if (num === null || num >= 1e15 || num === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targetEl.textContent = formatKi(targetKi);
    return;
  }
  let start, frameId;
  const animationStep = (timestamp) => {
    if (!start) start = timestamp;
    const elapsed = Math.min((timestamp - start) / 1100, 1);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    targetEl.textContent = Math.round(num * eased).toLocaleString("en-US");
    if (elapsed < 1) frameId = requestAnimationFrame(animationStep);
  };
  frameId = requestAnimationFrame(animationStep);
  stopActiveCounter = () => cancelAnimationFrame(frameId);
}

function renderGridSkeletons(limit) {
  el.empty.hidden = true; el.pager.hidden = true;
  el.grid.innerHTML = Array.from({ length: limit }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");
}

function updateUIDFacets(selectElement, itemsArray) {
  const fallback = selectElement.querySelector("option");
  selectElement.innerHTML = "";
  selectElement.append(fallback);
  itemsArray.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    selectElement.append(opt);
  });
}

function showToastMessage(msg, callback) {
  el.toast.hidden = false;
  el.toast.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  if (callback) {
    const btn = document.createElement("button"); btn.textContent = "Retry";
    btn.onclick = () => { el.toast.hidden = true; callback(); };
    el.toast.append(btn);
  }
  setTimeout(() => el.toast.hidden = true, 6000);
}

/* ==========================================
   5. Main Operation Lifecycle
   ========================================== */
let activeRequestController = null;

async function executeQuerySearch() {
  const current = store.get();
  if (activeRequestController) activeRequestController.abort();
  activeRequestController = new AbortController();

  store.update({ status: "loading", error: null });
  renderGridSkeletons(current.limit);
  el.status.textContent = "Querying digital core...";

  try {
    let outputPage;
    if (current.favoritesOnly) {
      const matches = current.archive.filter(c => favoriteIds.has(c.id) && localFilter(c, current));
      outputPage = localPaginate(sortList(matches, current.sort), current.page, current.limit);
    } else {
      const isFiltered = Boolean(current.name || current.race || current.gender || current.affiliation);
      const res = await apiRequest("/characters", isFiltered ? { name: current.name, race: current.race, gender: current.gender, affiliation: current.affiliation } : { page: current.page, limit: current.limit }, { signal: activeRequestController.signal });
      const standardized = normalizePayload(res, current);
      
      if (current.sort === "default") {
        outputPage = { items: standardized.items, meta: standardized.meta };
      } else {
        const fullList = standardized.all ?? (current.archive.length ? current.archive.filter(c => localFilter(c, current)) : standardized.items);
        outputPage = localPaginate(sortList(fullList, current.sort), current.page, current.limit);
      }
    }

    store.update({ status: "ready", items: outputPage.items, meta: outputPage.meta, page: outputPage.meta.currentPage });
  } catch (err) {
    if (err.name === "AbortError") return;
    store.update({ status: "error", items: [], error: err.message });
  }
}

async function renderModalView(id) {
  el.dialogBody.innerHTML = '<p class="file__loading">Extracting grid matrix data...</p>';
  if (!el.dialog.open) el.dialog.showModal();
  
  try {
    const c = await apiRequest(`/characters/${id}`);
    const imgPromise = c.image ? new Promise(res => { const img = new Image(); img.onload = img.onerror = res; img.src = c.image; }) : Promise.resolve();
    await Promise.all([imgPromise, new Promise(res => setTimeout(res, 150))]);
    
    const transforms = c.transformations || [];
    el.dialogBody.innerHTML = `
      <div class="file__head">
        <div class="file__portrait"><img src="${escapeHtml(c.image || FALLBACK_ART)}" alt="" /></div>
        <div>
          <h2 class="file__name" id="file-name">${escapeHtml(c.name)}</h2>
          <div class="tags">
            <span class="tag tag--race">${escapeHtml(c.race || "Unknown")}</span>
            <span class="tag">${escapeHtml(c.gender)}</span>
            <span class="tag tag--gold">${escapeHtml(c.affiliation)}</span>
          </div>
          <div class="readouts">
            <div class="readout"><span>Base Ki</span><strong>${escapeHtml(formatKi(c.ki))}</strong></div>
            <div class="readout"><span>Max Ki</span><strong>${escapeHtml(formatKi(c.maxKi))}</strong></div>
          </div>
        </div>
      </div>
      ${c.description ? `<div class="file__section"><h3>History Profile</h3><p>${escapeHtml(c.description)}</p></div>` : ""}
      ${transforms.length ? `<div class="file__section"><h3>Transformations (${transforms.length})</h3><div class="forms">
        ${transforms.map(t => `<div class="form-card"><img src="${escapeHtml(t.image || FALLBACK_ART)}" alt="" /><b>${escapeHtml(t.name)}</b><small>${escapeHtml(formatKi(t.ki))}</small></div>`).join("")}
      </div></div>` : ""}
    `;
  } catch (e) {
    el.dialogBody.innerHTML = `<div class="file__section"><h2>Data stream broken</h2><p>${escapeHtml(e.message)}</p></div>`;
  }
}

function processScanTarget(char) {
  if (!char) return;
  el.scanViewport.classList.remove("is-locked");
  el.scanName.textContent = "Locking target...";
  el.scanOpen.disabled = true;

  const img = new Image();
  img.onload = img.onerror = () => {
    el.scanName.textContent = char.name;
    el.scanRace.textContent = char.race || "Unknown";
    el.scanAffiliation.textContent = char.affiliation || "None";
    el.scanBio.textContent = char.description ? (char.description.length > 200 ? char.description.slice(0, 195) + "..." : char.description) : "No metrics available.";
    el.scanArt.src = char.image || FALLBACK_ART;
    el.scanOpen.disabled = false;
    el.scanViewport.classList.add("is-locked");
    runPowerCounter(el.scanKi, char.ki);
    store.update({ featuredId: char.id });
  };
  img.src = char.image;
}

/* ==========================================
   6. State Pipeline & Binding Wires
   ========================================== */
let renderSignature = "";
store.subscribe((state) => {
  el.favoritesCount.textContent = favoriteIds.size;
  if (state.status === "loading") return;

  const currentSignature = [state.status, state.error, state.meta.currentPage, state.meta.totalItems, state.items.map(i => i.id).join(",")].join("|");
  if (currentSignature === renderSignature) return;
  renderSignature = currentSignature;

  if (state.status === "error") {
    el.grid.innerHTML = ""; el.pager.hidden = true; el.empty.hidden = false;
    el.empty.innerHTML = `<h2>Scan Failed</h2><p>${escapeHtml(state.error)}</p><button class="btn btn--primary" data-role="retry-btn">Retry Connection</button>`;
    showToastMessage(state.error, () => executeQuerySearch());
    return;
  }

  if (!state.items.length) {
    el.grid.innerHTML = ""; el.pager.hidden = true; el.empty.hidden = false;
    el.empty.innerHTML = state.favoritesOnly ? `<h2>Empty Cache</h2><p>Star items to display here.</p>` : `<h2>No Matches</h2><p>Adjust filter parameters.</p>`;
    el.status.textContent = "0 targets found";
    return;
  }

  el.empty.hidden = true;
  el.grid.innerHTML = state.items.map(c => `
    <article class="card" data-id="${c.id}">
      <div class="card__frame">
        <span class="card__race">${escapeHtml(c.race || "Unknown")}</span>
        <img class="card__art" src="${escapeHtml(c.image || FALLBACK_ART)}" alt="" loading="lazy" />
        <button class="card__save" type="button" data-save="${c.id}" aria-pressed="${favoriteIds.has(c.id)}">★</button>
      </div>
      <div class="card__meta">
        <h2 class="card__name"><button class="card__open" type="button">${escapeHtml(c.name)}</button></h2>
        <p class="card__affiliation">${escapeHtml(c.affiliation)}</p>
        <span class="card__ki">KI ${escapeHtml(formatKi(c.ki))}</span>
      </div>
    </article>
  `).join("");

  // Build reactive pager navigation window array
  const { currentPage, totalPages, totalItems } = state.meta;
  el.status.textContent = `${totalItems} metrics found · Page ${currentPage} of ${totalPages}`;
  
  if (totalPages <= 1) { el.pager.hidden = true; } else {
    el.pager.hidden = false;
    let pages = [...new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1])].filter(p => p >= 1 && p <= totalPages).sort((a,b)=>a-b);
    let html = `<button class="btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>Prev</button>`;
    pages.forEach((p, idx) => {
      if (idx > 0 && p - pages[idx - 1] > 1) html += '<span class="pager__gap">…</span>';
      html += `<button class="pager__page" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`;
    });
    html += `<button class="btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
    el.pager.innerHTML = html;
  }
});

/* Bind User IO Controls */
let debounceTimeout;
el.search.addEventListener("input", (e) => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => { store.update({ page: 1, name: e.target.value.trim() }); executeQuerySearch(); }, 350);
});

el.filterRace.addEventListener("change", e => { store.update({ page: 1, race: e.target.value }); executeQuerySearch(); });
el.filterAffiliation.addEventListener("change", e => { store.update({ page: 1, affiliation: e.target.value }); executeQuerySearch(); });
el.filterGender.addEventListener("change", e => { store.update({ page: 1, gender: e.target.value }); executeQuerySearch(); });
el.sort.addEventListener("change", e => { store.update({ page: 1, sort: e.target.value }); executeQuerySearch(); });

el.favoritesToggle.addEventListener("click", () => {
  const next = !store.get().favoritesOnly;
  el.favoritesToggle.setAttribute("aria-pressed", String(next));
  store.update({ page: 1, favoritesOnly: next });
  executeQuerySearch();
});

el.reset.addEventListener("click", () => {
  el.search.value = el.filterRace.value = el.filterAffiliation.value = el.filterGender.value = ""; el.sort.value = "default";
  el.favoritesToggle.setAttribute("aria-pressed", "false");
  store.reset(); executeQuerySearch();
});

el.grid.addEventListener("click", e => {
  const saveBtn = e.target.closest("[data-save]");
  if (saveBtn) {
    const active = toggleFavorite(saveBtn.dataset.save);
    saveBtn.setAttribute("aria-pressed", String(active));
    el.favoritesCount.textContent = favoriteIds.size;
    if (store.get().favoritesOnly) executeQuerySearch();
    return;
  }
  const card = e.target.closest(".card");
  if (card) renderModalView(card.dataset.id);
});

el.empty.addEventListener("click", e => { if (e.target.closest("[data-role='retry-btn']")) executeQuerySearch(); });
el.pager.addEventListener("click", e => {
  const btn = e.target.closest("[data-page]");
  if (!btn || btn.disabled) return;
  store.update({ page: Number(btn.dataset.page) }); executeQuerySearch();
  document.getElementById("results").scrollIntoView();
});

el.scanAgain.addEventListener("click", () => {
  const state = store.get();
  const pool = state.archive.filter(c => c.id !== state.featuredId);
  if (pool.length) processScanTarget(pool[Math.floor(Math.random() * pool.length)]);
});
el.scanOpen.addEventListener("click", () => { if (store.get().featuredId) renderModalView(store.get().featuredId); });
el.dialogClose.addEventListener("click", () => el.dialog.close());
el.dialog.addEventListener("click", e => { if (e.target === el.dialog) el.dialog.close(); });

/* Application Bootstrap initialization */
(async function initializeApplication() {
  loadStorage();
  renderGridSkeletons(store.get().limit);
  
  const [snapshotResult] = await Promise.allSettled([fetchSnapshot(), executeQuerySearch()]);
  
  if (snapshotResult.status === "fulfilled" && snapshotResult.value.length) {
    const list = snapshotResult.value;
    const unique = (k) => [...new Set(list.map(c => c[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const facets = { races: unique("race"), affiliations: unique("affiliation") };
    
    store.update({ archive: list, facets });
    updateUIDFacets(el.filterRace, facets.races);
    updateUIDFacets(el.filterAffiliation, facets.affiliations);
    el.mastheadCount.textContent = `${list.length} fighters cataloged`;
    
    processScanTarget(list[Math.floor(Math.random() * list.length)]);
  } else {
    el.mastheadCount.textContent = "Data node unreachable";
    el.scanName.textContent = "Scouter Offline";
  }
})();