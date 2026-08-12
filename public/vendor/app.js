const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;
const APP_VERSION = "2.35.0";
const STORAGE_STATE_KEY = "renewals_dashboard_state_v2";
const STORAGE_THEME_KEY = "csmcc:dark";
const LEGACY_THEME_KEYS = ["renewals_dashboard_theme_v2", "cc_intel_dashboard_theme_v1"];
const STORAGE_NOTES_BACKUP_KEY = "renewals_dashboard_notes_backup_v1";
const STORAGE_NOTES_DELETED_KEY = "renewals_dashboard_notes_deleted_v1";
const STORAGE_TARGETS_KEY = "renewals_targets_v1";
const STORAGE_RATE_TARGETS_KEY = "renewals_rate_targets_v1";
const STORAGE_BG_THEME_KEY = "renewals_bg_theme_v1";
const BG_THEMES = [
  {
    id: "lavender",
    label: "Lavender",
    swatch: "linear-gradient(135deg, #c7d2fe, #ddd6fe, #fce7f3, #bae6fd)",
    light: "linear-gradient(135deg, #c7d2fe 0%, #ddd6fe 25%, #fce7f3 50%, #bae6fd 75%, #c7d2fe 100%)",
    dark: "radial-gradient(ellipse at 20% 10%, rgba(30,27,75,0.8), transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(12,74,110,0.4), transparent 50%), linear-gradient(135deg, #0f172a 0%, #020617 100%)"
  },
  {
    id: "slate",
    label: "Slate",
    swatch: "linear-gradient(135deg, #e2e8f0, #cbd5e1, #e2e8f0)",
    light: "linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 40%, #e2e8f0 100%)",
    dark: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)"
  },
  {
    id: "ocean",
    label: "Ocean",
    swatch: "linear-gradient(135deg, #dbeafe, #cffafe, #e0e7ff)",
    light: "linear-gradient(135deg, #dbeafe 0%, #cffafe 35%, #e0e7ff 70%, #dbeafe 100%)",
    dark: "radial-gradient(ellipse at 30% 20%, rgba(12,74,110,0.7), transparent 55%), radial-gradient(ellipse at 70% 70%, rgba(30,27,75,0.5), transparent 50%), linear-gradient(135deg, #020617 0%, #0c1222 100%)"
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "linear-gradient(135deg, #fed7aa, #fecaca, #fde68a)",
    light: "linear-gradient(135deg, #fef3c7 0%, #fed7aa 30%, #fecaca 60%, #fde68a 100%)",
    dark: "radial-gradient(ellipse at 25% 15%, rgba(120,53,15,0.5), transparent 50%), radial-gradient(ellipse at 75% 75%, rgba(127,29,29,0.3), transparent 50%), linear-gradient(135deg, #0f0906 0%, #1a0a0a 100%)"
  },
  {
    id: "forest",
    label: "Forest",
    swatch: "linear-gradient(135deg, #d1fae5, #a7f3d0, #bae6fd)",
    light: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 35%, #bae6fd 70%, #d1fae5 100%)",
    dark: "radial-gradient(ellipse at 25% 20%, rgba(6,78,59,0.6), transparent 55%), radial-gradient(ellipse at 75% 75%, rgba(12,74,110,0.35), transparent 50%), linear-gradient(135deg, #020617 0%, #04120b 100%)"
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "linear-gradient(135deg, #fecdd3, #fce7f3, #e9d5ff)",
    light: "linear-gradient(135deg, #fecdd3 0%, #fce7f3 35%, #e9d5ff 70%, #fecdd3 100%)",
    dark: "radial-gradient(ellipse at 25% 15%, rgba(136,19,55,0.5), transparent 50%), radial-gradient(ellipse at 75% 80%, rgba(88,28,135,0.35), transparent 50%), linear-gradient(135deg, #0f0510 0%, #0c0a14 100%)"
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: "linear-gradient(135deg, #1e1b4b, #172554, #0f172a)",
    light: "linear-gradient(135deg, #c7d2fe 0%, #bfdbfe 35%, #c7d2fe 70%, #ddd6fe 100%)",
    dark: "linear-gradient(135deg, #0f0a2e 0%, #0c1836 50%, #0f172a 100%)"
  }
];
const STORAGE_CC_DATA_KEY = "renewals_cc_data_v1";
const STORAGE_EXPANSION_TARGETS_KEY = "renewals_expansion_targets_v1";
const STORAGE_HISTORICAL_KEY = "renewals_historical_v1";
const STORAGE_ACTIVE_DATA_KEY = "renewals_active_data_v1";
const STORAGE_ACTIVE_HM_KEY = "renewals_active_hm_v1";
const STORAGE_ACTIVE_HEADERS_KEY = "renewals_active_headers_v1";
const NOTES_REPORT_EVENT = "renewals:notes-report";
const NOTES_EXPORT_REVIEW_EVENT = "renewals:notes-export-review";
const PRIOR_YEAR_DATA = {
  FY26Q1: { all: { cc: 95e5, atr: 553e5 }, over: { cc: 56e5, atr: 2e7 }, under: { cc: 39e5, atr: 354e5 } },
  FY26Q2: { all: { cc: 104e5, atr: 605e5 }, over: { cc: 63e5, atr: 226e5 }, under: { cc: 41e5, atr: 379e5 } },
  FY26Q3: { all: { cc: 69e5, atr: 512e5 }, over: { cc: 29e5, atr: 179e5 }, under: { cc: 4e6, atr: 333e5 } },
  FY26Q4: { all: { cc: 88e5, atr: 523e5 }, over: { cc: 47e5, atr: 18e6 }, under: { cc: 41e5, atr: 343e5 } }
};
function getPriorYearQuarter(q) {
  const p = parseFiscalLabel(q);
  if (!p.fy || !p.fq) return null;
  return `FY${p.fy - 1}Q${p.fq}`;
}
const IDB_NAME = "renewals_studio";
const IDB_VERSION = 1;
const IDB_STORE = "blobs";
let _idbPromise = null;
function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        _idbPromise = null;
      };
      db.onerror = () => {
        try {
          db.close();
        } catch {
        }
        _idbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      _idbPromise = null;
      reject(req.error);
    };
  });
  return _idbPromise;
}
function idbGet(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function idbSet(key, value) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbRemove(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbClear() {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
const IDB_KEY_DATA = "active_data";
const IDB_KEY_HM = "active_hm";
const IDB_KEY_HEADERS = "active_headers";
const IDB_KEY_HIST = "historical_data";
const IDB_KEY_HIST_HM = "historical_hm";
const IDB_KEY_META = "active_meta";
const IDB_KEY_HIST_META = "historical_meta";
const MAX_NOTE_HISTORY = 20;
const normalizeThemeValue = (value) => {
  if (value === "true" || value === "dark") return "dark";
  if (value === "false" || value === "light") return "light";
  return null;
};
function persistNotesBackup(notesObj) {
  try {
    localStorage.setItem(STORAGE_NOTES_BACKUP_KEY, JSON.stringify(notesObj || {}));
  } catch {
  }
}
function persistNotesDeleted(deletesObj) {
  try {
    localStorage.setItem(STORAGE_NOTES_DELETED_KEY, JSON.stringify(deletesObj || {}));
  } catch {
  }
}
const FIELD_KEYS = {
  YEAR_QUARTER: ["YEAR_QUARTER", "YEAR_QUARTER_YYYYQQ", "YEAR-QUARTER", "YR_QTR", "QTR", "YEARQTR"],
  FISCAL_QUARTER: ["FISCAL_QUARTER", "FISCAL QUARTER", "FQ"],
  FISCAL_YEAR: ["FISCAL_YEAR", "FISCAL YEAR", "FY"],
  ACCOUNT_NAME: ["CRM_ACCOUNT_NAME", "ACCOUNT_NAME", "CUSTOMER", "NAME"],
  ACCOUNT_ID: ["CRM_ACCOUNT_ID", "ACCOUNT_ID", "ID"],
  ATR_STARTING: ["ATR_ARR_USD_STARTING", "ATR_ARR_STARTING", "ATR_STARTING", "ARR_STARTING"],
  ATR_LTG: ["ATR_ARR_USD_LTG", "ATR_ARR_LTG", "ATR_LTG", "ARR_LTG"],
  FC_REMAINING: ["FC_REMAINING", "FC REMAINING", "FORECAST_REMAINING", "REMAINING_FC", "FC_REMAIN"],
  NET_ARR_PRIOR: ["NET_ARR_USD_PRIOR_QTR_END", "NET_ARR_PRIOR_QTR_END", "NET_ARR_PRIOR"],
  BU_FC: ["BU_FC", "BU-FC", "BUFC", "BUSINESS_UNIT_FC", "FC_BU", "FC_TOTAL", "FC"],
  REGION: ["REGION", "GEO", "AREA"],
  COUNTRY: ["COUNTRY", "BILLING_COUNTRY", "BILLING COUNTRY", "CUSTOMER_COUNTRY", "SALES_COUNTRY"],
  SEGMENT: ["PRO_FORMA_MARKET_SEGMENT", "MARKET_SEGMENT", "SEGMENT"],
  SUBREGION: ["PRO_FORMA_SUBREGION", "SUBREGION", "SUB_REGION"],
  HEALTH: ["CRM_HEALTH_STATUS", "HEALTH", "ACCOUNT_HEALTH"],
  NEXT_RENEWAL_DATE: ["NEXT_RENEWAL_DATE", "RENEWAL_DATE", "RENEW_DATE"],
  LARGEST_RENEWAL_DATE: ["LARGEST_RENEWAL_DATE", "LARGEST RENEWAL DATE"],
  FORECAST_SUMMARY: ["FORECAST_SUMMARY", "FORECAST", "FC_SUMMARY"],
  DICTATED_BY: ["DICTATED_BY", "RENEWAL_DICTATED_BY", "DICTATED BY"],
  OWNER: ["CRM_SUCCESS_OWNER_NAME", "SUCCESS_OWNER", "OWNER", "CSM"],
  PARTNER: ["PARTNER"],
  PARTNER_TYPE: ["PARTNER_TYPE_C", "PARTNER_TYPE__C", "PARTNER_TYPE"],
  PRODUCT_LINES: ["PRODUCT_LINES", "PRODUCTS", "PRODUCT LINE", "PRODUCT_LINE"],
  FLAG_TOP3K: ["FLAG_3K", "FLAG_TOP3K", "TOP_3000", "TOP 3000", "ACCOUNT_TOP_3000", "ACCOUNT TOP 3000", "TOP3K", "T3K"],
  CC: ["CC", "CHURN_CONTRACTION", "C_C"],
  CC_OFFCYCLE: ["CC_OFFCYCLE_ARR", "CC_OFFCYCLE", "OFFCYCLE_CC"],
  EXPANSION: ["EXPANSION", "EXPANSION_ARR"],
  DONE_DEAL: ["DONE_DEAL", "DONE"],
  UPSIDE: ["UPSIDE", "UPSIDE_ARR", "UPSIDE_USD"],
  DOWNSIDE: ["DOWNSIDE", "DOWNSIDE_ARR", "DOWNSIDE_USD"],
  PARTNER_NAME: ["PARTNER_NAME", "PARTNER"],
  MANAGER_SUCCESS: ["MANAGER_SUCCESS", "CS_MANAGER", "SUCCESS_MANAGER", "MANAGER"],
  BAND: ["BAND", "ATR_BAND", "ACCOUNT_BAND"]
};
function normalizeHeader(h) {
  if (!h) return "";
  return String(h).trim().replace(/\s+/g, "_").replace(/[^\w_]/g, "").toUpperCase();
}
const DROPPED_COLUMNS = /* @__PURE__ */ new Set([
  "QTD_CC",
  "FC_ONCYCLE",
  "FC_OFFCYCLE",
  "TERM_GROUPED",
  "CRM_OWNER_NAME",
  "CRM_RENEWAL_OWNER_NAME",
  "MANAGER_RENEWAL",
  "RAMP_DEAL",
  "AUTO_RENEW"
]);
function trimRow(row) {
  for (const k of DROPPED_COLUMNS) {
    if (k in row) delete row[k];
  }
  return row;
}
function trimHeaders(headers) {
  return (headers || []).filter((h) => !DROPPED_COLUMNS.has(String(h || "").toUpperCase()));
}
const PROGRESS_EVERY = 1e3;
function streamParseCSV(input, { onComplete, onError, onProgress } = {}) {
  const rows = [];
  let headers = null;
  let count = 0;
  const cfg = {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h,
    step: (res) => {
      if (!headers && res.meta?.fields) headers = res.meta.fields;
      const row = res.data;
      if (row && typeof row === "object") {
        // Preserve realized churn under CC BEFORE trimRow drops QTD_CC.
        // The unified/historical source carries churn in QTD_CC (a DROPPED
        // column); the historical split + views read it as CC, so promote it
        // here or historical C/C would always be undefined -> 0.
        if ((row.CC == null || row.CC === "") && row.QTD_CC != null) row.CC = row.QTD_CC;
        trimRow(row);
        rows.push(row);
        count++;
        if (onProgress && count % PROGRESS_EVERY === 0) onProgress(count);
      }
    },
    complete: () => {
      if (!headers) headers = Object.keys(rows[0] || {});
      else headers = trimHeaders(headers);
      // QTD_CC is trimmed from headers, but we promoted its value onto CC per
      // row above — make sure CC is a real header so header-based consumers
      // (importHistoricalCSV hm.CC, HistoricalTab ccKey) can resolve it.
      if (!headers.some((h) => String(h || "").trim().toUpperCase() === "CC") && rows.some((r) => r && r.CC != null && r.CC !== "")) {
        headers.push("CC");
      }
      if (onProgress) onProgress(count);
      onComplete && onComplete(rows, headers);
    },
    error: (err) => {
      onError && onError(err);
    }
  };
  Papa.parse(input, cfg);
}
function MultiSelect({ label, options = [], selected = [], onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  useEffect(() => {
    const handler = (event) => {
      if (!containerRef.current || containerRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, query]);
  const summary = useMemo(() => {
    if (!selected || selected.length === 0) return "All";
    const labels = selected.map((val) => options.find((opt) => opt.value === val)?.label || (val || "(Blank)"));
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels.join(", ");
    return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
  }, [selected, options]);
  const handleToggle = (value) => {
    onToggle?.(value);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "relative", ref: containerRef }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "filter-trigger", onClick: () => setOpen((o) => !o) }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold" }, label), /* @__PURE__ */ React.createElement("small", null, summary)), /* @__PURE__ */ React.createElement("span", { className: "text-sm opacity-60" }, open ? "\u25B2" : "\u25BC")), open && /* @__PURE__ */ React.createElement("div", { className: "filter-menu" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold" }, "Select ", label), onClear && selected.length > 0 && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "smallbtn smallbtn-slate",
      onClick: (e) => {
        e.stopPropagation();
        onClear();
        setQuery("");
      }
    },
    "Clear"
  )), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "filter-input",
      placeholder: "Search...",
      value: query,
      onChange: (e) => setQuery(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "mt-2 space-y-1" }, filtered.map((opt) => {
    const active = selected.includes(opt.value);
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        key: `${opt.label}-${opt.value}`,
        className: `filter-option ${active ? "active" : ""}`,
        onClick: () => handleToggle(opt.value)
      },
      /* @__PURE__ */ React.createElement("span", null, opt.label),
      /* @__PURE__ */ React.createElement("span", { className: "text-xs opacity-60" }, active ? "\u2713" : opt.count ?? "")
    );
  }), filtered.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 dark:text-gray-400 px-1 py-2" }, "No matches"))));
}
function buildHeaderMap(headers) {
  const norm = headers.map((h) => String(h || "")).map((h) => h.trim().toUpperCase());
  const exactMap = /* @__PURE__ */ new Map();
  norm.forEach((n, i) => {
    if (!exactMap.has(n)) exactMap.set(n, i);
  });
  const map = {};
  const find = (cands) => {
    for (const c of cands) {
      const cn = String(c).trim().toUpperCase();
      const eIdx = exactMap.get(cn);
      if (eIdx !== void 0) return headers[eIdx];
      const sIdx = norm.findIndex((h) => h.includes(cn));
      if (sIdx !== -1) return headers[sIdx];
    }
    return null;
  };
  map.YEAR_QUARTER = find(FIELD_KEYS.YEAR_QUARTER);
  map.FISCAL_QUARTER = "FISCAL_QUARTER";
  map.FISCAL_YEAR = "FISCAL_YEAR";
  map.ACCOUNT_NAME = find(FIELD_KEYS.ACCOUNT_NAME);
  map.ACCOUNT_ID = find(FIELD_KEYS.ACCOUNT_ID);
  map.ATR_STARTING = find(FIELD_KEYS.ATR_STARTING);
  map.ATR_LTG = find(FIELD_KEYS.ATR_LTG);
  map.FC_REMAINING = find(FIELD_KEYS.FC_REMAINING);
  map.BU_FC = find(FIELD_KEYS.BU_FC);
  map.REGION = find(FIELD_KEYS.REGION);
  map.COUNTRY = find(FIELD_KEYS.COUNTRY) || find(FIELD_KEYS.SUBREGION) || "PRO_FORMA_SUBREGION";
  map.SEGMENT = find(FIELD_KEYS.SEGMENT);
  map.SUBREGION = find(FIELD_KEYS.SUBREGION);
  map.HEALTH = find(FIELD_KEYS.HEALTH);
  map.NEXT_RENEWAL_DATE = find(FIELD_KEYS.NEXT_RENEWAL_DATE);
  map.LARGEST_RENEWAL_DATE = find(FIELD_KEYS.LARGEST_RENEWAL_DATE);
  map.FORECAST_SUMMARY = find(FIELD_KEYS.FORECAST_SUMMARY);
  map.OWNER = find(FIELD_KEYS.OWNER) || "CRM_SUCCESS_OWNER_NAME";
  map.DICTATED_BY = find(FIELD_KEYS.DICTATED_BY) || "DICTATED_BY";
  map.PARTNER = find(FIELD_KEYS.PARTNER);
  map.PARTNER_TYPE = find(FIELD_KEYS.PARTNER_TYPE);
  map.PRODUCT_LINES = find(FIELD_KEYS.PRODUCT_LINES) || "PRODUCT_LINES";
  map.NET_ARR_PRIOR = find(FIELD_KEYS.NET_ARR_PRIOR) || "NET_ARR_USD_PRIOR_QTR_END";
  map.FLAG_TOP3K = find(FIELD_KEYS.FLAG_TOP3K) || "FLAG_3K";
  map.MANAGER_SUCCESS = find(FIELD_KEYS.MANAGER_SUCCESS) || "MANAGER_SUCCESS";
  map.BAND = find(FIELD_KEYS.BAND) || "BAND";
  map.UPSIDE = find(FIELD_KEYS.UPSIDE) || "UPSIDE";
  map.DOWNSIDE = find(FIELD_KEYS.DOWNSIDE) || "DOWNSIDE";
  return map;
}
function toNumber(x) {
  if (x == null) return 0;
  if (typeof x === "number") return isFinite(x) ? x : 0;
  const cleaned = String(x).replace(/[\$,()%\s]/g, "").replace(/--/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
function safeNumber(x) {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}
function safeString(x) {
  if (x == null) return "";
  return String(x).trim();
}
function parseDate(x) {
  if (!x) return null;
  const t = Date.parse(x);
  return isNaN(t) ? null : new Date(t);
}
const EFFECTIVE_ATR_KEY = "__ATR_EFFECTIVE";
const EFFECTIVE_BU_KEY = "__BU_EFFECTIVE";
function getAtrKey(hm, settings) {
  const baseKey = hm.ATR_STARTING || "ATR_ARR_USD_STARTING";
  return settings?.useRemainingArr ? EFFECTIVE_ATR_KEY : baseKey;
}
function getBuKey(hm, settings) {
  const baseKey = hm.BU_FC || "BU_FC";
  return settings?.useRemainingArr ? EFFECTIVE_BU_KEY : baseKey;
}
function getAtrValue(row, hm, settings) {
  return toNumber(row?.[getAtrKey(hm, settings)]);
}
function getBuValue(row, hm, settings) {
  return toNumber(row?.[getBuKey(hm, settings)]);
}
function ensureEffectiveFields(rows, hm) {
  const atrKey = hm.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const buKey = hm.BU_FC || "BU_FC";
  const ltgKey = hm.ATR_LTG || "ATR_ARR_USD_LTG";
  let changed = false;
  const next = (rows || []).map((row) => {
    if (row && row[EFFECTIVE_ATR_KEY] != null && row[EFFECTIVE_BU_KEY] != null) return row;
    const atrStarting = toNumber(row?.[atrKey]);
    const buStarting = toNumber(row?.[buKey]);
    const ltgVal = toNumber(row?.[ltgKey]);
    const effectiveAtr = ltgVal > 0 ? ltgVal : atrStarting;
    const effectiveBu = effectiveAtr > 0 ? Math.min(buStarting, effectiveAtr) : 0;
    changed = true;
    return { ...row, [EFFECTIVE_ATR_KEY]: effectiveAtr, [EFFECTIVE_BU_KEY]: effectiveBu };
  });
  return changed ? next : rows || [];
}
function quarterSortValue(label) {
  const raw = safeString(label).toUpperCase();
  const fyMatch = /FY(\d{2})Q(\d)/.exec(raw);
  if (fyMatch) return (Number(fyMatch[1]) || 0) * 10 + (Number(fyMatch[2]) || 0);
  const qMatch = /Q(\d)(\d{2})/.exec(raw);
  if (qMatch) return (Number(qMatch[2]) || 0) * 10 + (Number(qMatch[1]) || 0);
  return 0;
}
function dedupeLatestRows(rows, hm) {
  const quarterKey = hm.YEAR_QUARTER || hm.FISCAL_QUARTER || "YEAR_QUARTER";
  const atrStartingKey = hm.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const m = /* @__PURE__ */ new Map();
  const sourceRows = ensureEffectiveFields(rows, hm);
  sourceRows.forEach((row) => {
    const acct = accountKeyFromRow(row, hm) || safeString(row[hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME"]) || "__NO_ACCOUNT__";
    const quarter = safeString(row[quarterKey] || row.FISCAL_QUARTER) || "__NO_QUARTER__";
    const key = `${acct}::${quarter}`;
    const existing = m.get(key);
    if (!existing) {
      m.set(key, row);
      return;
    }
    const existingVal = toNumber(existing?.[atrStartingKey]);
    const nextVal = toNumber(row?.[atrStartingKey]);
    const existingIdx = Number(existing?.__importIndex) || 0;
    const nextIdx = Number(row?.__importIndex) || 0;
    if (nextVal > existingVal || nextVal === existingVal && nextIdx >= existingIdx) {
      m.set(key, row);
    }
  });
  return Array.from(m.values());
}
function mapFiscal(dt) {
  if (!(dt instanceof Date) || isNaN(dt)) return { fy: null, fq: null };
  const y = dt.getFullYear();
  const m = dt.getMonth();
  const legacyCutoff = /* @__PURE__ */ new Date("2026-02-01T00:00:00Z");
  const iso = dt.toISOString();
  if (dt < legacyCutoff) {
    const fy2 = `FY${String(y).slice(-2)}`;
    const fqNum2 = Math.floor(m / 3) + 1;
    return { fy: fy2, fq: `${fy2}Q${fqNum2}` };
  }
  if (y === 2026 && m === 0) {
    return { fy: "FY26", fq: "FY26Q1" };
  }
  const fyNum = m === 0 ? y : y + 1;
  const offset = (m + 11) % 12;
  const fqNum = Math.floor(offset / 3) + 1;
  const fy = `FY${String(fyNum).slice(-2)}`;
  return { fy, fq: `${fy}Q${fqNum}` };
}
function normalizeAccountName(name) {
  return safeString(name).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function normalizeQuarterLabel(raw) {
  const s = safeString(raw);
  if (!s) return "";
  const derived = deriveFiscalFromQuarterLabel(s);
  return derived && derived.fq ? derived.fq : s;
}
function buildNoteKey(row, hm) {
  if (!row || !hm) return null;
  const acctId = safeString(row[hm.ACCOUNT_ID]);
  const acctName = safeString(row[hm.ACCOUNT_NAME] || row.CRM_ACCOUNT_NAME || row.ACCOUNT_NAME);
  const acctBase = acctId || normalizeAccountName(acctName);
  if (!acctBase) return null;
  // Normalize the quarter to the canonical FYxxQx spelling so a note keyed
  // with a different spelling of the same quarter (e.g. "Q3`27") still lines
  // up with the row it belongs to (rows may carry the raw "Q3`27" YEAR_QUARTER
  // when enrichment has not run). Both sides go through this normalizer.
  const fqRaw = safeString(row.FISCAL_QUARTER || row[hm.FISCAL_QUARTER] || row[hm.YEAR_QUARTER]);
  const fq = normalizeQuarterLabel(fqRaw);
  const dateRaw = safeString(row[hm.NEXT_RENEWAL_DATE] || row.NEXT_RENEWAL_DATE);
  const dateBucket = (() => {
    const dt = parseDate(dateRaw);
    return dt ? dt.toISOString().slice(0, 7) : dateRaw;
  })();
  const period = fq || dateBucket || "na";
  return `${acctBase}::${period}`;
}
function canonicalNoteKey(key) {
  const s = safeString(key);
  if (!s) return s;
  const idx = s.indexOf("::");
  if (idx < 0) return s;
  const base = s.slice(0, idx);
  const rest = s.slice(idx + 2);
  const norm = normalizeQuarterLabel(rest);
  return `${base}::${norm || rest}`;
}
function migrateNoteKey(key) {
  if (!key) return key;
  const parts = String(key).split("::");
  if (parts.length <= 2) return key;
  return `${parts[0]}::${parts[1]}`;
}
function migrateNotesObject(notes) {
  const out = {};
  Object.entries(notes || {}).forEach(([k, v]) => {
    const nk = migrateNoteKey(k);
    const existing = out[nk];
    const incomingTs = Number(v?.updatedAt) || 0;
    const existingTs = Number(existing?.updatedAt) || 0;
    if (!existing || incomingTs >= existingTs) out[nk] = v;
  });
  return out;
}
function migrateDeletesObject(deletes, notes) {
  const out = { ...deletes || {} };
  Object.entries(deletes || {}).forEach(([k, ts]) => {
    const nk = migrateNoteKey(k);
    if (nk === k) return;
    const cur = Number(out[nk]) || 0;
    const t = Number(ts) || 0;
    if (t > cur) out[nk] = t;
    delete out[k];
  });
  Object.keys(out).forEach((k) => {
    if (notes && notes[k] && Number(notes[k]?.updatedAt) > Number(out[k])) delete out[k];
  });
  return out;
}
function formatCurrencyUSD(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (val, suffix) => `${sign}$${val.toFixed(1)}${suffix}`;
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}
function formatNoteDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function formatNoteDateShort(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 6e4);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
function accountKeyFromRow(row, hm) {
  const id = safeString(row[hm.ACCOUNT_ID || "CRM_ACCOUNT_ID"]);
  const name = safeString(row[hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME"]);
  return id || name || null;
}
function deriveFiscalFromQuarterLabel(label) {
  const raw = safeString(label).toUpperCase().replace(/['']/g, "'");
  const m1 = /FY(\d{2})Q([1-4])/.exec(raw);
  if (m1) return { fy: `FY${m1[1]}`, fq: `FY${m1[1]}Q${m1[2]}` };
  const m3 = /^(\d{4})Q([1-4])$/.exec(raw.trim());
  if (m3) {
    const yy = String(Number(m3[1]) % 100).padStart(2, "0");
    return { fy: `FY${yy}`, fq: `FY${yy}Q${m3[2]}` };
  }
  const m2 = /Q([1-4])[`' -]?(\d{2})(?:\b|$)/.exec(raw);
  if (m2) return { fy: `FY${m2[2]}`, fq: `FY${m2[2]}Q${m2[1]}` };
  return { fy: null, fq: null };
}
function mergeAccountQuarterContext(rows, hm) {
  const accountNameKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const productKey = hm.PRODUCT_LINES || "PRODUCT_LINES";
  const forecastKey = hm.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const partnerKey = hm.PARTNER || "PARTNER";
  const partnerTypeKey = hm.PARTNER_TYPE || "PARTNER_TYPE_C";
  const pushUnique = (arr, value) => {
    const next = safeString(value);
    if (!next || arr.includes(next)) return;
    arr.push(next);
  };
  const groups = /* @__PURE__ */ new Map();
  (rows || []).forEach((row) => {
    const account = accountKeyFromRow(row, hm) || safeString(row[accountNameKey]) || "__NO_ACCOUNT__";
    const entry = groups.get(account) || { products: [], forecasts: [], partners: [], partnerTypes: [] };
    parseProducts(row?.[productKey]).forEach((val) => pushUnique(entry.products, val));
    pushUnique(entry.forecasts, row?.[forecastKey]);
    pushUnique(entry.partners, row?.[partnerKey]);
    pushUnique(entry.partnerTypes, row?.[partnerTypeKey]);
    groups.set(account, entry);
  });
  return (rows || []).map((row) => {
    const account = accountKeyFromRow(row, hm) || safeString(row[accountNameKey]) || "__NO_ACCOUNT__";
    const entry = groups.get(account);
    if (!entry) return row;
    const mergedProducts = entry.products.join(" | ");
    const mergedForecasts = entry.forecasts.join(" | ");
    const mergedPartners = entry.partners.join(" | ");
    const mergedPartnerTypes = entry.partnerTypes.join(" | ");
    return {
      ...row,
      [productKey]: mergedProducts || row?.[productKey] || "",
      [forecastKey]: mergedForecasts || row?.[forecastKey] || "",
      [partnerKey]: mergedPartners || row?.[partnerKey] || "",
      [partnerTypeKey]: mergedPartnerTypes || row?.[partnerTypeKey] || "",
      __products: entry.products.length ? entry.products : row?.__products || []
    };
  });
}
function buildAccountRollups(data, hm, settings) {
  const m = /* @__PURE__ */ new Map();
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const netKey = hm.NET_ARR_PRIOR || "NET_ARR_USD_PRIOR_QTR_END";
  const nextKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const largestKey = hm.LARGEST_RENEWAL_DATE || "LARGEST_RENEWAL_DATE";
  (data || []).forEach((row) => {
    const key = accountKeyFromRow(row, hm);
    if (!key) return;
    const entry = m.get(key) || { accountId: safeString(row[hm.ACCOUNT_ID || "CRM_ACCOUNT_ID"]), accountName: safeString(row[hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME"]), maxNetArr: null, next: null, largest: null };
    const net = toNumber(row[netKey]);
    if (isFinite(net)) {
      entry.maxNetArr = entry.maxNetArr == null ? net : Math.max(entry.maxNetArr, net);
    }
    const rowAtr = toNumber(row[atrKey]);
    const rowBu = toNumber(row[buKey]);
    const nextDate = parseDate(row[nextKey]);
    const largestRaw = safeString(row[largestKey]);
    const nextRaw = safeString(row[nextKey]);
    const isLargestMatch = largestRaw && nextRaw && largestRaw === nextRaw;
    if (nextDate && (!entry.next || entry.next.date && nextDate < entry.next.date)) {
      entry.next = { date: nextDate, dateLabel: nextRaw, atr: rowAtr, bu: rowBu };
    }
    if (isLargestMatch) {
      if (!entry.largest || rowAtr > entry.largest.atr) {
        entry.largest = { date: largestRaw, atr: rowAtr, bu: rowBu, matched: true };
      }
    } else {
      if (!entry.largest || !entry.largest.matched && rowAtr > entry.largest.atr) {
        entry.largest = { date: largestRaw || nextRaw, atr: rowAtr, bu: rowBu, matched: false };
      }
    }
    m.set(key, entry);
  });
  return m;
}
function formatPercent(v, digits = 1) {
  if (!isFinite(v)) return "\u2014";
  return `${(v * 100).toFixed(digits)}%`;
}
function formatCurrencyInput(val) {
  const n = toNumber(val);
  if (!isFinite(n)) return "";
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtCompact(v) {
  const n = Number(v) || 0;
  const s = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a).toLocaleString()}`;
}
function fmtCompactDash(v) {
  const n = Number(v) || 0;
  if (!n) return "\u2014";
  const s = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a)}`;
}
function fmtPctValue(v) {
  return v != null && isFinite(v) ? `${v.toFixed(1)}%` : "\u2014";
}
function fmtPctRatio(v) {
  return isFinite(v) ? `${(v * 100).toFixed(1)}%` : "\u2014";
}
function normalizeDj(raw) {
  if (raw == null) return "";
  return String(raw).replace(/[^\d\.\-]/g, "");
}
function escapeCsvField(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function parseProducts(raw) {
  if (!raw) return [];
  return String(raw).split(/[,;|]/).map((s) => safeString(s)).filter(Boolean);
}
function matchesBand(r, band, atrKey, segKey, flag3kKey, bandKey) {
  const atrVal = toNumber(r[atrKey]);
  const seg = safeString(r[segKey]).toLowerCase();
  const flag3k = String(r[flag3kKey] || "").toLowerCase();
  if (band === "100k_official" && bandKey) {
    const bandCol = safeString(r[bandKey]).toUpperCase().replace(/[\s$,]/g, "");
    return bandCol.includes("100K+") || bandCol.includes(">100K") || bandCol.includes("100KANDABOVE") || bandCol === "100K+";
  }
  switch (band) {
    case "gt100k":
      return atrVal > 1e5;
    case "gt75k":
      return atrVal > 75e3;
    case "gt12k":
      return atrVal > 12e3;
    case "range0_12k":
      return atrVal > 0 && atrVal <= 12e3;
    case "range12_75k":
      return atrVal > 12e3 && atrVal <= 75e3;
    case "range75_100k":
      return atrVal > 75e3 && atrVal <= 1e5;
    case "lt100k":
      return atrVal > 0 && atrVal < 1e5;
    case "top3k":
      return ["1", "true", "yes", "y"].includes(flag3k);
    case "smb":
      return seg.includes("smb");
    case "digital":
      return seg.includes("digital");
    case "commercial":
      return seg.includes("commercial");
    case "enterprise":
      return seg.includes("enterprise");
    case "comm_ent":
      return seg.includes("commercial") || seg.includes("enterprise");
    default:
      return true;
  }
}
function classifyHealth(h) {
  const l = (h || "").toLowerCase();
  if (/green|healthy|good/.test(l)) return "green";
  if (/yellow|neutral|orange|amber|concerning/.test(l)) return "amber";
  if (/red|churning/.test(l)) return "red";
  return "neutral";
}
function formatDateShort(dt) {
  if (!dt) return "No date";
  return dt.toLocaleDateString(void 0, { month: "short", day: "numeric" });
}
function median(values) {
  if (!values.length) return null;
  const arr = [...values].filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function isValidRenewal(row, headerMap, settings) {
  const atrStartingKey = headerMap?.ATR_STARTING || "ATR_ARR_USD_STARTING";
  return toNumber(row?.[atrStartingKey]) > 0;
}
function sumBy(arr, fn) {
  return arr.reduce((a, x) => a + (fn(x) || 0), 0);
}
function groupSum(arr, keyFn, valFn) {
  const m = /* @__PURE__ */ new Map();
  for (const it of arr) {
    const k = keyFn(it);
    const v = valFn(it) || 0;
    m.set(k, (m.get(k) || 0) + v);
  }
  return m;
}
function uniqueValues(arr, keyFn) {
  return Array.from(new Set(arr.map(keyFn))).filter(Boolean).sort();
}
function valueCounts(arr, keyFn) {
  const map = /* @__PURE__ */ new Map();
  for (const item of arr) {
    const raw = keyFn(item);
    const value = safeString(raw);
    const label = value || "(Blank)";
    if (!map.has(value)) map.set(value, { value, label, count: 0 });
    map.get(value).count += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}
// Shared row-matching predicate used by BOTH the main filtered-rows hook and
// the Filters dropdown facet counts. Returns a closure (r, skipKey) => bool.
// `skipKey` (a filter key like "owners") temporarily ignores that one
// dimension so a dropdown can preview how many accounts WOULD match each of
// its own options while still honoring every OTHER active filter.
function makeRowMatcher(headerMap, filters, settings, notes, opts) {
  opts = opts || {};
  const ignoreQuarters = !!opts.ignoreQuarters;
  const ignoreBand = !!opts.ignoreBand;
  const get = (k) => headerMap[k] || "";
  const regionKey = get("REGION");
  const countryKey = get("BILLING_COUNTRY") || get("COUNTRY");
  const segmentKey = get("SEGMENT");
  const industryKey = get("INDUSTRY_TERRITORY") || get("INDUSTRY");
  const healthKey = get("HEALTH");
  const quarterKey = get("FISCAL_QUARTER") || get("YEAR_QUARTER");
  const accountKey = get("ACCOUNT_NAME");
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const partnerKey = get("PARTNER");
  const partnerTypeKey = get("PARTNER_TYPE");
  const dateKey = get("NEXT_RENEWAL_DATE");
  const flagTopKey = headerMap.FLAG_TOP3K || "FLAG_3K";
  const atrStartingKey = headerMap.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const search = (filters.search || "").toLowerCase().trim();
  const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
  const to = filters.dateTo ? new Date(filters.dateTo) : null;
  return (r, skipKey) => {
    if (settings?.useRemainingArr && toNumber(r?.[atrStartingKey]) <= 0) return false;
    const region = safeString(r[regionKey]);
    const country = safeString(r[countryKey]);
    const segment = safeString(r[segmentKey]);
    const industry = safeString(r[industryKey]);
    const health = safeString(r[healthKey]);
    const quarter = safeString(r[quarterKey]);
    const owner = safeString(r[ownerKey]);
    const partner = safeString(r[partnerKey]);
    const partnerType = safeString(r[partnerTypeKey]);
    const dt = parseDate(r[dateKey]);
    if (skipKey !== "regions" && filters.regions.length && !filters.regions.includes(region)) return false;
    if (skipKey !== "countries" && filters.countries.length && !filters.countries.includes(country)) return false;
    if (skipKey !== "segments" && filters.segments.length && !filters.segments.includes(segment)) return false;
    if (skipKey !== "industries" && filters.industries && filters.industries.length && !filters.industries.includes(industry)) return false;
    if (skipKey !== "healths" && filters.healths.length && !filters.healths.includes(health)) return false;
    if (skipKey !== "quarters" && !ignoreQuarters && filters.quarters.length && !filters.quarters.includes(quarter)) return false;
    if (skipKey !== "owners" && filters.owners.length && !filters.owners.includes(owner)) return false;
    if (skipKey !== "partners" && filters.partners.length && !filters.partners.includes(partner)) return false;
    if (skipKey !== "partnerTypes" && filters.partnerTypes.length && !filters.partnerTypes.includes(partnerType)) return false;
    if (from && (!dt || dt < from)) return false;
    if (to && (!dt || dt > to)) return false;
    const atrVal = getAtrValue(r, headerMap, settings);
    const band = ignoreBand ? "all" : filters.band || "all";
    if (band === "100k_official") {
      const bandCol = safeString(r[headerMap.BAND || "BAND"]).toUpperCase().replace(/[\s$,]/g, "");
      if (!(bandCol.includes("100K+") || bandCol.includes(">100K") || bandCol.includes("100KANDABOVE") || bandCol === "100K+")) return false;
    }
    if (band === "gt100k" && !(atrVal > 1e5)) return false;
    if (band === "gt75k" && !(atrVal > 75e3)) return false;
    if (band === "gt12k" && !(atrVal > 12e3)) return false;
    if (band === "range0_12k" && !(atrVal > 0 && atrVal <= 12e3)) return false;
    if (band === "range12_75k" && !(atrVal > 12e3 && atrVal <= 75e3)) return false;
    if (band === "range75_100k" && !(atrVal > 75e3 && atrVal <= 1e5)) return false;
    if (band === "lt100k" && !(atrVal > 0 && atrVal < 1e5)) return false;
    const segLower = segment.toLowerCase();
    if (band === "top3k" && !["1", "true", "yes", "y"].includes(String(r[flagTopKey] || "").toLowerCase())) return false;
    if (band === "smb" && !segLower.includes("smb")) return false;
    if (band === "digital" && !segLower.includes("digital")) return false;
    if (band === "commercial" && !segLower.includes("commercial")) return false;
    if (band === "enterprise" && !segLower.includes("enterprise")) return false;
    if (band === "comm_ent" && !(segLower.includes("commercial") || segLower.includes("enterprise"))) return false;
    const arrRanges = Array.isArray(filters.arrRanges) ? filters.arrRanges : [];
    if (arrRanges.length > 0) {
      const inAny = arrRanges.some((rg) => {
        const lo = rg.min != null && rg.min !== "" ? Number(rg.min) : null;
        const hi = rg.max != null && rg.max !== "" ? Number(rg.max) : null;
        if (lo != null && isFinite(lo) && !(atrVal >= lo)) return false;
        if (hi != null && isFinite(hi) && !(atrVal <= hi)) return false;
        return true;
      });
      if (!inAny) return false;
    } else {
      const arrMin = filters.arrMin != null && filters.arrMin !== "" ? Number(filters.arrMin) : null;
      const arrMax = filters.arrMax != null && filters.arrMax !== "" ? Number(filters.arrMax) : null;
      if (arrMin != null && isFinite(arrMin) && !(atrVal >= arrMin)) return false;
      if (arrMax != null && isFinite(arrMax) && !(atrVal <= arrMax)) return false;
    }
    if (search) {
      const nk = r.__noteKey;
      const nt = nk && notes?.[nk] ? safeString(notes[nk].note) : "";
      const hay = [accountKey && r[accountKey], owner, partner, partnerType, region, country, segment, health, quarter, nt].map(safeString).join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (filters.hasNotes) {
      const noteKey = r.__noteKey;
      const noteObj = noteKey ? notes?.[noteKey] : null;
      const hasNote = noteObj && (safeString(noteObj.note) || noteObj.djForecast != null && isFinite(toNumber(noteObj.djForecast)));
      if (!hasNote) return false;
    }
    return true;
  };
}
// Faceted DISTINCT-ACCOUNT counts for a filter dimension. For each option
// value of `valueKey` it counts the unique accounts that would match if that
// dimension were selected, honoring every other active filter (skipKey).
function facetAccountCounts(rows, headerMap, match, valueKey, skipKey) {
  const idKey = headerMap.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const nameKey = headerMap.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const value = safeString(r[valueKey]);
    let entry = map.get(value);
    if (!entry) {
      entry = { value, label: value || "(Blank)", set: /* @__PURE__ */ new Set() };
      map.set(value, entry);
    }
    if (match(r, skipKey)) {
      const acct = safeString(r[idKey]) || safeString(r[nameKey]);
      if (acct) entry.set.add(acct);
    }
  }
  return Array.from(map.values())
    .map((o) => ({ value: o.value, label: o.label, count: o.set.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement(
        "div",
        { style: { padding: "2rem", textAlign: "center", fontFamily: "system-ui" } },
        React.createElement("h2", { style: { color: "#dc2626", marginBottom: "0.5rem" } }, "Something went wrong"),
        React.createElement("p", { style: { color: "#6b7280", marginBottom: "1rem" } }, String(this.state.error?.message || "Unexpected error")),
        React.createElement("button", { onClick: () => this.setState({ hasError: false, error: null }), style: { padding: "0.5rem 1rem", background: "#4f46e5", color: "#fff", border: "none", borderRadius: "0.375rem", cursor: "pointer" } }, "Try Again")
      );
    }
    return this.props.children;
  }
}
const AppContext = createContext();
const useApp = () => useContext(AppContext);
// Volatile sync/autoload status lives in its OWN context so that its frequent
// churn (idle -> pending -> synced on every note save, and the CSV auto-load
// status transitions on reload) does NOT re-render the many components that
// consume the main AppContext (notably the Notes import/export panel, whose
// Import button previously flickered on every sync tick).
const AppStatusContext = createContext();
const useAppStatus = () => useContext(AppStatusContext);
function parseFiscalLabel(label) {
  const m = /FY(\d{2})Q(\d)/i.exec(label || "");
  if (!m) return { fy: 0, fq: 0 };
  return { fy: Number(m[1]) || 0, fq: Number(m[2]) || 0 };
}
function getCurrentFiscal() {
  const now = /* @__PURE__ */ new Date();
  const m = now.getMonth();
  const fq = m >= 1 && m <= 3 ? 1 : m >= 4 && m <= 6 ? 2 : m >= 7 && m <= 9 ? 3 : 4;
  const fy = m === 0 ? now.getFullYear() % 100 : (now.getFullYear() + 1) % 100;
  return { fy, fq };
}
function isCurrentOrPastQuarter(label) {
  const p = parseFiscalLabel(label);
  if (p.fy === 0) return false;
  const cf = getCurrentFiscal();
  return p.fy < cf.fy || p.fy === cf.fy && p.fq <= cf.fq;
}
function detectInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_THEME_KEY);
    const normalized = normalizeThemeValue(stored);
    if (normalized) return normalized;
    for (const key of LEGACY_THEME_KEYS) {
      const legacy = localStorage.getItem(key);
      const legacyNormalized = normalizeThemeValue(legacy);
      if (legacyNormalized) {
        localStorage.setItem(STORAGE_THEME_KEY, JSON.stringify(legacyNormalized === "dark"));
        return legacyNormalized;
      }
    }
  } catch {
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}
const BAND_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "100k_official", label: "100K+ Official" },
  { value: "comm_ent", label: "Commercial + Enterprise" },
  { value: "commercial", label: "Commercial accounts only" },
  { value: "enterprise", label: "Enterprise accounts only" },
  { value: "gt100k", label: ">$100K ATR" },
  { value: "gt75k", label: ">$75K ATR" },
  { value: "gt12k", label: ">$12K ATR" },
  { value: "range0_12k", label: "$0 - $12K" },
  { value: "range12_75k", label: "$12K - $75K" },
  { value: "range75_100k", label: "$75K - $100K" },
  { value: "lt100k", label: "<$100K" },
  { value: "top3k", label: "Top 3K" },
  { value: "smb", label: "SMB accounts only" },
  { value: "digital", label: "Digital accounts only" }
];
const VALID_TABS = ["region", "partner", "accounts", "notes", "historical", "targets", "weekly"];
const DEFAULT_QUARTERS = ["FY25Q4", "FY26Q1", "FY27Q1", "FY27Q2", "FY27Q3", "FY27Q4"];
const initialState = {
  data: [],
  headers: [],
  headerMap: {},
  filters: {
    regions: [],
    countries: [],
    segments: [],
    industries: [],
    healths: [],
    quarters: [...DEFAULT_QUARTERS],
    owners: [],
    partners: [],
    partnerTypes: [],
    search: "",
    dateFrom: "",
    dateTo: "",
    band: "all",
    hasNotes: false
  },
  settings: { sortBy: "NEXT_RENEWAL_DATE", sortDir: "asc", pageSize: 50, useRemainingArr: false },
  ui: { activeTab: "region", showExplain: false, showColumns: false },
  meta: { uploadedAt: null },
  notes: {},
  noteDeletes: {},
  targets: {},
  rateTargets: {},
  ccData: {},
  historicalData: [],
  historicalHeaderMap: {},
  visibleCols: {
    notes: true,
    priorArr: false,
    quarter: true,
    account: true,
    region: true,
    country: false,
    segment: true,
    health: true,
    atr: true,
    bufc: true,
    nextRenewal: true,
    owner: true,
    dictatedBy: true,
    partner: false,
    partnerType: false,
    summary: false,
    industry: false,
    daysSinceTouch: false,
    largestDate: false,
    largestAtr: false,
    csCall: true,
    renewalsCall: true,
    eltCall: true,
    adjCc: true,
    bestCase: false,
    worstCase: false
  }
};
function AppProvider({ children }) {
  const [theme, setTheme] = useState(detectInitialTheme());
  const [idbReady, setIdbReady] = useState(false);
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const savedTab = VALID_TABS.includes(parsed?.ui?.activeTab) ? parsed.ui.activeTab : initialState.ui.activeTab;
        const parsedFilters = parsed.filters || {};
        const mergedFilters = { ...initialState.filters, ...parsedFilters };
        if (!Array.isArray(parsedFilters.quarters) || parsedFilters.quarters.length === 0) {
          mergedFilters.quarters = initialState.filters.quarters;
        }
        let parsedNotes = parsed.notes || {};
        let parsedDeletes = parsed.noteDeletes || {};
        try {
          const backupRaw = localStorage.getItem(STORAGE_NOTES_BACKUP_KEY);
          if (Object.keys(parsedNotes || {}).length === 0 && backupRaw) {
            parsedNotes = JSON.parse(backupRaw) || {};
          }
        } catch {
        }
        try {
          const deletesRaw = localStorage.getItem(STORAGE_NOTES_DELETED_KEY);
          if (Object.keys(parsedDeletes || {}).length === 0 && deletesRaw) {
            parsedDeletes = JSON.parse(deletesRaw) || {};
          }
        } catch {
        }
        const activeData = Array.isArray(parsed.data) ? parsed.data : [];
        const activeHM = parsed.headerMap || {};
        const activeHeaders = Array.isArray(parsed.headers) ? parsed.headers : [];
        return {
          ...initialState,
          ...parsed,
          data: activeData,
          headers: activeHeaders,
          headerMap: activeHM,
          filters: mergedFilters,
          settings: { ...initialState.settings, ...parsed.settings || {}, useRemainingArr: false },
          visibleCols: { ...initialState.visibleCols, ...parsed.visibleCols || {} },
          meta: { ...initialState.meta, ...parsed.meta || {} },
          notes: migrateNotesObject({ ...initialState.notes, ...parsedNotes || {} }),
          noteDeletes: migrateDeletesObject(
            { ...initialState.noteDeletes, ...parsedDeletes || {} },
            migrateNotesObject({ ...initialState.notes, ...parsedNotes || {} })
          ),
          targets: (() => {
            try {
              return JSON.parse(localStorage.getItem(STORAGE_TARGETS_KEY)) || {};
            } catch {
              return {};
            }
          })(),
          rateTargets: (() => {
            try {
              return JSON.parse(localStorage.getItem(STORAGE_RATE_TARGETS_KEY)) || {};
            } catch {
              return {};
            }
          })(),
          ccData: (() => {
            try {
              return JSON.parse(localStorage.getItem(STORAGE_CC_DATA_KEY)) || {};
            } catch {
              return {};
            }
          })(),
          expansionTargets: (() => {
            try {
              return JSON.parse(localStorage.getItem(STORAGE_EXPANSION_TARGETS_KEY)) || {};
            } catch {
              return {};
            }
          })(),
          historicalData: [],
          historicalHeaderMap: {},
          ui: { ...initialState.ui, ...parsed.ui || {}, activeTab: savedTab }
        };
      }
    } catch {
    }
    const savedTargets = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_TARGETS_KEY)) || {};
      } catch {
        return {};
      }
    })();
    const savedRateTargets = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_RATE_TARGETS_KEY)) || {};
      } catch {
        return {};
      }
    })();
    const savedCcData = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_CC_DATA_KEY)) || {};
      } catch {
        return {};
      }
    })();
    const savedExpansionTargets = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_EXPANSION_TARGETS_KEY)) || {};
      } catch {
        return {};
      }
    })();
    return { ...initialState, data: [], headers: [], headerMap: {}, targets: savedTargets, rateTargets: savedRateTargets, ccData: savedCcData, expansionTargets: savedExpansionTargets, historicalData: [], historicalHeaderMap: {} };
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_THEME_KEY, JSON.stringify(theme === "dark"));
    } catch {
    }
  }, [theme]);
  const [bgTheme, setBgTheme] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_BG_THEME_KEY) || "ocean";
    } catch {
      return "ocean";
    }
  });
  useEffect(() => {
    const preset = BG_THEMES.find((t) => t.id === bgTheme) || BG_THEMES[0];
    const root = document.documentElement;
    root.style.setProperty("--bg-gradient", theme === "dark" ? preset.dark : preset.light);
    root.style.setProperty("--bg-gradient-dark", preset.dark);
    try {
      localStorage.setItem(STORAGE_BG_THEME_KEY, bgTheme);
    } catch {
    }
  }, [bgTheme, theme]);
  const _persistTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(_persistTimerRef.current);
    _persistTimerRef.current = setTimeout(() => {
      try {
        const {
          data,
          headers,
          headerMap,
          historicalData,
          historicalHeaderMap,
          notes,
          noteDeletes,
          ...lightweight
        } = state;
        localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(lightweight));
      } catch {
      }
    }, 500);
    return () => clearTimeout(_persistTimerRef.current);
  }, [state.filters, state.settings, state.visibleCols, state.ui, state.meta]);
  useEffect(() => {
    persistNotesBackup(state.notes || {});
  }, [state.notes]);
  useEffect(() => {
    persistNotesDeleted(state.noteDeletes || {});
  }, [state.noteDeletes]);
  useEffect(() => {
    let cancelled = false;
    const hasActiveData = Array.isArray(state.data) && state.data.length > 0;
    const hasHistData = Array.isArray(state.historicalData) && state.historicalData.length > 0;
    if (hasActiveData && hasHistData) {
      setIdbReady(true);
      return;
    }
    (async () => {
      try {
        const updates = {};
        let activeMeta = null;
        let histMeta = null;
        if (!hasActiveData) {
          const [d, hm, h, m] = await Promise.all([
            idbGet(IDB_KEY_DATA).catch(() => null),
            idbGet(IDB_KEY_HM).catch(() => null),
            idbGet(IDB_KEY_HEADERS).catch(() => null),
            idbGet(IDB_KEY_META).catch(() => null)
          ]);
          if (Array.isArray(d) && d.length) {
            updates.data = d;
            if (hm) updates.headerMap = hm;
            if (Array.isArray(h)) updates.headers = h;
            if (m && typeof m === "object") activeMeta = m;
          }
        }
        if (!hasHistData) {
          const [hd, hhm, hm] = await Promise.all([
            idbGet(IDB_KEY_HIST).catch(() => null),
            idbGet(IDB_KEY_HIST_HM).catch(() => null),
            idbGet(IDB_KEY_HIST_META).catch(() => null)
          ]);
          if (Array.isArray(hd) && hd.length) {
            updates.historicalData = hd;
            if (hhm) updates.historicalHeaderMap = hhm;
            if (hm && typeof hm === "object") histMeta = hm;
          }
        }
        if (!cancelled && Object.keys(updates).length > 0) {
          setState((prev) => {
            const next = { ...prev, ...updates };
            // When we restore the cached rows from IDB, also make sure the
            // cache IDENTITY (uploadedAt + content signature) is present in
            // meta. localStorage.meta normally already carries these, but if
            // localStorage was evicted while IDB survived, the identity would
            // otherwise be lost (cachedMs/cachedSig = 0/null) and the app
            // would needlessly re-download despite having the data. Prefer any
            // existing localStorage value and only fall back to the IDB-copy,
            // so a locally-newer identity is never downgraded.
            if ((activeMeta || histMeta)) {
              const meta = { ...prev.meta };
              if (activeMeta && updates.data) {
                if (meta.uploadedAt == null && activeMeta.uploadedAt != null) meta.uploadedAt = activeMeta.uploadedAt;
                if (meta.sourceSig == null && activeMeta.sourceSig != null) meta.sourceSig = activeMeta.sourceSig;
              }
              if (histMeta && updates.historicalData) {
                if (meta.historicalUploadedAt == null && histMeta.uploadedAt != null) meta.historicalUploadedAt = histMeta.uploadedAt;
                if (meta.historicalSourceSig == null && histMeta.sourceSig != null) meta.historicalSourceSig = histMeta.sourceSig;
              }
              next.meta = meta;
            }
            return next;
          });
        }
      } catch {
      }
      if (!cancelled) setIdbReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [serverInfo, setServerInfo] = useState(null);
  const [serverNotesLoaded, setServerNotesLoaded] = useState(false);
  const [serverSyncStatus, setServerSyncStatus] = useState("idle");
  const [csvAutoLoadStatus, setCsvAutoLoadStatus] = useState("idle");
  const [refreshState, setRefreshState] = useState(null);
  const _notesPutTimer = useRef(null);
  const _notesLastPut = useRef(null);
  const _autoLoadClaimed = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") return;
    const protocol = window.location?.protocol;
    if (protocol !== "file:") {
      (async () => {
        try {
          const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
          const timer = ctl ? setTimeout(() => ctl.abort(), 1500) : null;
          const res = await fetch("/api/health", { signal: ctl?.signal, cache: "no-store" });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error("health " + res.status);
          const info = await res.json();
          if (!cancelled) setServerInfo({ ...info, mode: "server" });
        } catch (err) {
          if (!cancelled) setServerInfo({ ok: false, mode: "file" });
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    const skipRedirect = (() => {
      try {
        return new URLSearchParams(window.location.search).has("nofallback");
      } catch {
        return false;
      }
    })();
    if (skipRedirect) {
      setServerInfo({ ok: false, mode: "file" });
      return;
    }
    (async () => {
      const ports = [4774];
      const probeOne = async (port) => {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 700) : null;
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: ctl?.signal,
            cache: "no-store",
            mode: "cors"
          });
          if (!res.ok) throw new Error("status " + res.status);
          const info = await res.json();
          if (!info?.ok) throw new Error("bad payload");
          return port;
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      let foundPort = null;
      try {
        foundPort = await Promise.any(ports.map(probeOne));
      } catch {
      }
      if (cancelled) return;
      if (foundPort != null) {
        try {
          console.info(`Renewals: server detected on :${foundPort} \u2014 redirecting for live data.`);
        } catch {
        }
        window.location.replace(`http://127.0.0.1:${foundPort}/apps/renewals/Renewals%20Intelligence%20Studio.html`);
        return;
      }
      setServerInfo({ ok: false, mode: "file" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!serverInfo?.ok || serverNotesLoaded || !idbReady) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/renewals/notes", { cache: "no-store" });
        if (!res.ok) throw new Error("notes " + res.status);
        const payload = await res.json();
        const remoteNotes = migrateNotesObject(payload?.notes || {});
        const remoteDeletes = payload?.noteDeletes || {};
        if (cancelled) return;
        setState((prev) => {
          const localNotes = { ...prev.notes || {} };
          const localDeletes = { ...prev.noteDeletes || {} };
          for (const [k, incoming] of Object.entries(remoteNotes)) {
            // The server STILL holds this note (it is present in the server's
            // notes map, not its tombstone map). A committed delete would have
            // removed it from the server's notes map, so any LOCAL tombstone
            // for this key is stale/spurious (e.g. an unmatched-cleanup
            // misclassification, or a delete whose PUT never reached the
            // server). Prefer the server-present note and drop that stale
            // tombstone so a client-side misclassification can never wipe a
            // note that still exists on the server. In-session deletes are
            // unaffected — this merge only runs once, at initial load.
            if (localDeletes[k]) delete localDeletes[k];
            const existing = localNotes[k];
            const incomingTs = Number(incoming?.updatedAt) || 0;
            const existingTs = Number(existing?.updatedAt) || 0;
            if (!existing || incomingTs >= existingTs) localNotes[k] = incoming;
          }
          for (const [k, ts] of Object.entries(remoteDeletes)) {
            const t = Number(ts) || 0;
            const cur = Number(localDeletes[k]) || 0;
            if (t > cur) localDeletes[k] = t;
            if (localNotes[k] && Number(localNotes[k]?.updatedAt) <= t) delete localNotes[k];
          }
          const mergedNotes = migrateNotesObject(localNotes);
          const mergedDeletes = migrateDeletesObject(localDeletes, mergedNotes);
          try {
            _notesLastPut.current = JSON.stringify({ notes: mergedNotes, noteDeletes: mergedDeletes });
          } catch {
          }
          return { ...prev, notes: mergedNotes, noteDeletes: mergedDeletes };
        });
        setServerNotesLoaded(true);
        setServerSyncStatus("synced");
      } catch (err) {
        setServerNotesLoaded(true);
        setServerSyncStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverInfo, serverNotesLoaded, idbReady]);
  useEffect(() => {
    if (!serverInfo?.ok || !serverNotesLoaded) return;
    const payload = { notes: state.notes || {}, noteDeletes: state.noteDeletes || {} };
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return;
    }
    if (serialized === _notesLastPut.current) return;
    clearTimeout(_notesPutTimer.current);
    setServerSyncStatus("pending");
    _notesPutTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/renewals/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: serialized
        });
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined" && window.RenewalsSessionLock && typeof window.RenewalsSessionLock.showLock === "function") {
            window.RenewalsSessionLock.showLock("Your secure sign-in session expired, so your latest note was NOT saved to the server. Refresh the page to sign in again, then re-enter your note.");
          }
          throw new Error("PUT " + res.status);
        }
        _notesLastPut.current = serialized;
        setServerSyncStatus("synced");
      } catch (err) {
        setServerSyncStatus("error");
      }
    }, 600);
    return () => clearTimeout(_notesPutTimer.current);
  }, [serverInfo, serverNotesLoaded, state.notes, state.noteDeletes]);
  useEffect(() => {
    if (!serverInfo?.ok || !idbReady) return;
    if (_autoLoadClaimed.current) return;
    _autoLoadClaimed.current = true;
    let cancelled = false;
    // Set when a unified single-file source (carrying a QUARTER_DIFF column)
    // is fanned into BOTH stores from the ACTIVE slot, so the separate
    // historical-slot fetch below is skipped and can't clobber it.
    let unifiedHistFromActive = false;
    setCsvAutoLoadStatus("pending");
    const processSlot = (config) => new Promise((resolve) => {
      const { slot, label, matchSubstring, fallbackToCsvList, getCachedMs, getCachedSig, hasData, importFnName, suppressActiveError } = config;
      // Only flips the visible status (and thus the splash) to "error" when we
      // are NOT going to retry. During retry attempts suppressActiveError is
      // true, so the status stays "pending" and the gate keeps showing the
      // loading spinner rather than the load-CSV splash.
      const failActiveStatus = () => {
        if (slot === "active" && !suppressActiveError) setCsvAutoLoadStatus("error");
      };
      (async () => {
        let info = null;
        try {
          const url = matchSubstring ? `/api/renewals/data-source/info?match=${encodeURIComponent(matchSubstring)}` : "/api/renewals/data-source/info";
          const dsInfoRes = await fetch(url, { cache: "no-store" });
          if (dsInfoRes.ok) {
            const dsInfo = await dsInfoRes.json();
            if (dsInfo?.found) {
              const ms = new Date(dsInfo.mtime).getTime();
              info = {
                fetchUrl: matchSubstring ? `/api/renewals/data-source/file?match=${encodeURIComponent(matchSubstring)}` : "/api/renewals/data-source/file",
                filename: dsInfo.filename,
                mtimeMs: Number.isFinite(ms) ? ms : 0,
                // Stable content identity: sha256 of the CSV bytes. Unlike
                // mtime/id, it does NOT change when the same snapshot is
                // re-materialized/re-uploaded, so an unchanged snapshot keeps
                // hitting the cache.
                sig: dsInfo.sha256 || null,
                origin: "data-source"
              };
            }
          }
        } catch {
        }
        if (!info && fallbackToCsvList) {
          try {
            const list = await fetch("/api/renewals/csv-list", { cache: "no-store" }).then((r) => r.json());
            const newest = (list?.files || [])[0];
            if (newest) {
              info = {
                fetchUrl: "/apps/renewals/" + encodeURIComponent(newest.name),
                filename: newest.name,
                mtimeMs: Number(newest.mtime) || 0,
                origin: "csv-list"
              };
            }
          } catch {
          }
        }
        if (cancelled) return resolve(false);
        if (!info) {
          if (slot === "active") setCsvAutoLoadStatus("empty");
          return resolve(true);
        }
        const cur = stateRef.current || {};
        const cachedMs = getCachedMs(cur);
        const cachedSig = getCachedSig(cur);
        const haveData = hasData(cur);
        // Cache fast-path: skip the (9.7MB / ~50k-row) download+parse when the
        // cached snapshot is unchanged.
        //   1) Primary — content signature (sha256). If BOTH the server and the
        //      cache expose a signature, they are authoritative: equal => the
        //      bytes are identical => use the cache (even if `uploaded_at`/id
        //      moved because the snapshot was re-materialized). Different => the
        //      snapshot genuinely changed => fall through and re-download.
        //   2) Fallback — mtime tolerance, used ONLY when a signature is
        //      unavailable on either side (older server without sha256, or a
        //      cache written before signatures existed / a local file import).
        //      Preserves the previous behavior for those paths.
        if (haveData) {
          if (info.sig && cachedSig) {
            if (info.sig === cachedSig) {
              if (slot === "active") setCsvAutoLoadStatus("loaded");
              return resolve(true);
            }
            // signatures differ => changed snapshot => re-download below.
          } else if (info.mtimeMs && cachedMs && info.mtimeMs <= cachedMs) {
            if (slot === "active") setCsvAutoLoadStatus("loaded");
            return resolve(true);
          }
        }
        const activeCur = stateRef.current || {};
        const dashboardUp = Array.isArray(activeCur.data) && activeCur.data.length > 0;
        const isRefresh = dashboardUp;
        const startedAt = Date.now();
        if (isRefresh) {
          setRefreshState({
            phase: "fetching",
            slot,
            label,
            filename: info.filename,
            origin: info.origin,
            mtimeMs: info.mtimeMs,
            rowCount: 0,
            startedAt
          });
        }
        try {
          const csvRes = await fetch(info.fetchUrl, { cache: "no-store" });
          if (!csvRes.ok) {
            if (!cancelled) {
              failActiveStatus();
              if (isRefresh) setRefreshState({ phase: "error", slot, label, filename: info.filename, error: "HTTP " + csvRes.status, startedAt });
            }
            return resolve(false);
          }
          const text = await csvRes.text();
          if (cancelled) return resolve(false);
          if (isRefresh) {
            setRefreshState((prev) => prev ? { ...prev, phase: "parsing" } : prev);
          }
          let importFailed = false;
          await new Promise((finishParse) => {
            streamParseCSV(text, {
              onProgress: (count) => {
                if (cancelled || !isRefresh) return;
                setRefreshState((prev) => prev ? { ...prev, rowCount: count } : prev);
              },
              onComplete: (rows, headers) => {
                if (cancelled) return finishParse();
                if (isRefresh) {
                  setRefreshState((prev) => prev ? { ...prev, phase: "importing", rowCount: rows.length } : prev);
                }
                setTimeout(() => {
                  try {
                    const acts = window.__renewalsActions || {};
                    // Unified single-file source: one CSV carries EVERY quarter
                    // plus a QUARTER_DIFF column (<0 = closed/historical, >=0 =
                    // current + future). When we see it on the ACTIVE slot, fan
                    // it into BOTH in-memory stores so the whole app — including
                    // the Historical/Report tabs — runs off one pull:
                    //   active     <- quarter_diff >= 0
                    //   historical <- quarter_diff <  0, with realized churn
                    //                 exposed under CC (:= QTD_CC), the key the
                    //                 historical views read.
                    // Falls back to the classic single-slot import when the
                    // file has no QUARTER_DIFF column (legacy two-file source).
                    const qdKey = Array.isArray(headers)
                      ? headers.find((h) => String(h || "").trim().toUpperCase() === "QUARTER_DIFF")
                      : null;
                    if (slot === "active" && qdKey && typeof acts.importCSV === "function") {
                      const qNum = (v) => {
                        const n = Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, ""));
                        return isFinite(n) ? n : null;
                      };
                      const activeRows = [];
                      const histRows = [];
                      for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        const d = qNum(r[qdKey]);
                        // The CURRENT quarter (quarter_diff === 0) belongs to
                        // BOTH stores, exactly like the old two-file split:
                        //   active     -> its BU_FC (remaining forecast)
                        //   historical -> its QTD_CC (booked-so-far churn)
                        // so the Region "Booked C/C"/"Expected C/C" KPIs and the
                        // Full-Year blended rows are unchanged. Future (>0) is
                        // active-only; closed (<0) is historical-only; a missing
                        // quarter_diff falls back to active.
                        if (d == null || d >= 0) activeRows.push(r);
                        if (d != null && d <= 0) {
                          const ccVal = r.CC != null && r.CC !== "" ? r.CC : (r.QTD_CC != null ? r.QTD_CC : r.qtd_cc);
                          histRows.push({ ...r, CC: ccVal });
                        }
                      }
                      acts.importCSV(activeRows, headers, info.mtimeMs || Date.now(), info.sig || null);
                      if (typeof acts.importHistoricalCSV === "function") {
                        const histHeaders = headers.indexOf("CC") >= 0 ? headers : [...headers, "CC"];
                        acts.importHistoricalCSV(histRows, histHeaders, info.mtimeMs || Date.now(), info.sig || null);
                        unifiedHistFromActive = true;
                      }
                      setCsvAutoLoadStatus("loaded");
                      if (isRefresh) {
                        setRefreshState((prev) => prev ? { ...prev, phase: "done", rowCount: rows.length } : prev);
                        setTimeout(() => {
                          setRefreshState((prev) => prev && prev.phase === "done" && prev.startedAt === startedAt ? null : prev);
                        }, 2500);
                      }
                      return;
                    }
                    const fn = acts[importFnName];
                    if (fn) {
                      fn(rows, headers, info.mtimeMs || Date.now(), info.sig || null);
                      if (slot === "active") setCsvAutoLoadStatus("loaded");
                      if (isRefresh) {
                        setRefreshState((prev) => prev ? { ...prev, phase: "done", rowCount: rows.length } : prev);
                        setTimeout(() => {
                          setRefreshState((prev) => prev && prev.phase === "done" && prev.startedAt === startedAt ? null : prev);
                        }, 2500);
                      }
                    } else {
                      importFailed = true;
                      failActiveStatus();
                      if (isRefresh) setRefreshState((prev) => prev ? { ...prev, phase: "error", error: "import handle missing" } : prev);
                    }
                  } catch (err) {
                    importFailed = true;
                    failActiveStatus();
                    if (isRefresh) setRefreshState((prev) => prev ? { ...prev, phase: "error", error: err?.message || "import failed" } : prev);
                  } finally {
                    finishParse();
                  }
                }, 0);
              },
              onError: (err) => {
                console.warn(`auto-load CSV (${slot}) parse error:`, err?.message || err);
                if (!cancelled) {
                  importFailed = true;
                  failActiveStatus();
                  if (isRefresh) setRefreshState((prev) => prev ? { ...prev, phase: "error", error: err?.message || "parse failed" } : prev);
                }
                finishParse();
              }
            });
          });
          resolve(!importFailed);
        } catch (err) {
          console.warn(`auto-load CSV (${slot}) failed:`, err?.message || err);
          if (!cancelled) {
            failActiveStatus();
            if (isRefresh) setRefreshState((prev) => prev ? { ...prev, phase: "error", error: err?.message || "fetch failed" } : prev);
          }
          resolve(false);
        }
      })();
    });
    (async () => {
      const activeConfig = {
        slot: "active",
        label: "Active",
        matchSubstring: "2026 data",
        fallbackToCsvList: true,
        getCachedMs: (cur) => Number(cur.meta?.uploadedAt) || 0,
        getCachedSig: (cur) => cur.meta?.sourceSig || null,
        hasData: (cur) => Array.isArray(cur.data) && cur.data.length > 0,
        importFnName: "importCSV"
      };
      // Retry the active-slot auto-load on transient fetch/parse/import
      // failures so a cache-less first-time user isn't stranded on the
      // load-CSV splash after a single hiccup (e.g. a slow DB round-trip on a
      // cold container). processSlot resolves false ONLY on a genuine error;
      // the "empty"/no-source-configured case resolves true and is never
      // retried. suppressActiveError keeps the status at "pending" (loading
      // spinner) until the final attempt, so the splash appears at most once,
      // only after retries are exhausted. This loop runs sequentially inside
      // the single _autoLoadClaimed effect run, so it never stacks concurrent
      // loads and never re-triggers reload storms.
      const activeRetryBackoffsMs = [400, 800];
      for (let attempt = 0; !cancelled; attempt++) {
        const lastAttempt = attempt >= activeRetryBackoffsMs.length;
        const ok = await processSlot({ ...activeConfig, suppressActiveError: !lastAttempt });
        if (cancelled || ok || lastAttempt) break;
        await new Promise((r) => setTimeout(r, activeRetryBackoffsMs[attempt]));
      }
      if (cancelled) return;
      // Skip the dedicated historical-slot fetch when a unified active file
      // already produced the historical store (otherwise an old historical
      // upload would clobber the split-derived closed quarters).
      if (unifiedHistFromActive) return;
      await processSlot({
        slot: "historical",
        label: "Historical",
        matchSubstring: "historical fy27",
        fallbackToCsvList: false,
        getCachedMs: (cur) => Number(cur.meta?.historicalUploadedAt) || 0,
        getCachedSig: (cur) => cur.meta?.historicalSourceSig || null,
        hasData: (cur) => Array.isArray(cur.historicalData) && cur.historicalData.length > 0,
        importFnName: "importHistoricalCSV"
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [serverInfo, idbReady]);
  const actions = useMemo(() => ({
    setTheme,
    setBgTheme,
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_STATE_KEY);
        localStorage.removeItem(STORAGE_NOTES_BACKUP_KEY);
        localStorage.removeItem(STORAGE_NOTES_DELETED_KEY);
        localStorage.removeItem(STORAGE_ACTIVE_DATA_KEY);
        localStorage.removeItem(STORAGE_ACTIVE_HM_KEY);
        localStorage.removeItem(STORAGE_ACTIVE_HEADERS_KEY);
        localStorage.removeItem(STORAGE_HISTORICAL_KEY);
        localStorage.removeItem(STORAGE_HISTORICAL_KEY + "_hm");
        localStorage.removeItem(STORAGE_EXPANSION_TARGETS_KEY);
      } catch {
      }
      idbClear().catch(() => {
      });
      persistNotesBackup({});
      persistNotesDeleted({});
      setState({ ...initialState, notes: {}, noteDeletes: {} });
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
        }
      }, 50);
    },
    setTab: (tab) => setState((s) => ({ ...s, ui: { ...s.ui, activeTab: VALID_TABS.includes(tab) ? tab : initialState.ui.activeTab } })),
    toggleExplain: () => setState((s) => ({ ...s, ui: { ...s.ui, showExplain: !s.ui.showExplain } })),
    toggleColumns: () => setState((s) => ({ ...s, ui: { ...s.ui, showColumns: !s.ui.showColumns } })),
    setVisibleCol: (key, val) => setState((s) => ({ ...s, visibleCols: { ...s.visibleCols, [key]: val } })),
    revealInFinder: async (path) => {
      try {
        if (!path || typeof window === "undefined" || window.location?.protocol === "file:") return false;
        const res = await fetch("/api/renewals/reveal?path=" + encodeURIComponent(path), { method: "POST" });
        return res.ok;
      } catch {
        return false;
      }
    },
    importCSV: (rows, headers, uploadedAtMs, sourceSig) => {
      headers = trimHeaders(headers);
      for (let i = 0; i < (rows || []).length; i++) trimRow(rows[i]);
      const headerMap = buildHeaderMap(headers);
      const top3kHeader = headerMap.FLAG_TOP3K || headerMap.FLAG_3K || "FLAG_3K";
      headerMap.FLAG_TOP3K = top3kHeader;
      headerMap.INDUSTRY_TERRITORY = headerMap.TERRITORY_INDUSTRY_C || headerMap.INDUSTRY_TERRITORY || "TERRITORY_INDUSTRY_C";
      headerMap.BILLING_COUNTRY = headerMap.BILLING_COUNTRY || headerMap.COUNTRY || "BILLING_COUNTRY";
      headerMap.DAYS_SINCE_TOUCH = headerMap.DAYS_SINCE_LAST_CS_TOUCH || headerMap.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
      headerMap.PRODUCT_LINES = headerMap.PRODUCT_LINES || "PRODUCT_LINES";
      headerMap.YEAR_QUARTER = headerMap.YEAR_QUARTER || "YEAR_QUARTER";
      const dateKey = headerMap.NEXT_RENEWAL_DATE;
      const quarterKey = headerMap.YEAR_QUARTER || "YEAR_QUARTER";
      const productKey = headerMap.PRODUCT_LINES;
      const atrKey = headerMap.ATR_STARTING || "ATR_ARR_USD_STARTING";
      const buKey = headerMap.BU_FC || "BU_FC";
      const ltgKey = headerMap.ATR_LTG || "ATR_ARR_USD_LTG";
      const enriched = (rows || []).map((row, idx) => {
        const quarterRaw = safeString(row[quarterKey]);
        let { fy, fq } = deriveFiscalFromQuarterLabel(quarterRaw);
        if (!fy || !fq) {
          const dt = parseDate(dateKey ? row[dateKey] : null);
          const mapped = mapFiscal(dt);
          fy = mapped.fy;
          fq = mapped.fq;
        }
        const products = productKey ? parseProducts(row[productKey]) : [];
        const baseRow = {
          ...row,
          YEAR_QUARTER: quarterRaw || row.YEAR_QUARTER || fq || "",
          FISCAL_YEAR: fy,
          FISCAL_QUARTER: fq || quarterRaw || row.FISCAL_QUARTER || "",
          __uid: row.__uid || `row_${Date.now()}_${idx}`,
          __products: products,
          __importIndex: idx
        };
        const atrStarting = toNumber(baseRow[atrKey]);
        const buStarting = toNumber(baseRow[buKey]);
        const ltgVal = toNumber(baseRow[ltgKey]);
        const effectiveAtr = ltgVal > 0 ? ltgVal : atrStarting;
        const effectiveBu = effectiveAtr > 0 ? Math.min(buStarting, effectiveAtr) : 0;
        const noteKey = buildNoteKey(baseRow, headerMap);
        return { ...baseRow, __noteKey: noteKey, [EFFECTIVE_ATR_KEY]: effectiveAtr, [EFFECTIVE_BU_KEY]: effectiveBu };
      });
      const enrichedMerged = mergeAccountQuarterContext(enriched, headerMap);
      const finalHM = {
        ...headerMap,
        FISCAL_YEAR: headerMap.FISCAL_YEAR || "FISCAL_YEAR",
        FISCAL_QUARTER: headerMap.FISCAL_QUARTER || "FISCAL_QUARTER"
      };
      const activeStamp = uploadedAtMs || Date.now();
      const activeSig = sourceSig || null;
      setState((s) => ({
        ...s,
        data: enrichedMerged,
        headers,
        headerMap: finalHM,
        meta: { ...s.meta, uploadedAt: activeStamp, sourceSig: activeSig }
      }));
      idbSet(IDB_KEY_DATA, enrichedMerged).catch(() => {
      });
      idbSet(IDB_KEY_HM, finalHM).catch(() => {
      });
      idbSet(IDB_KEY_HEADERS, headers).catch(() => {
      });
      // Co-locate the cache identity (stamp + content signature) with the
      // cached rows in IDB so it can NEVER diverge from the data even if
      // localStorage (which also holds meta) is evicted independently.
      idbSet(IDB_KEY_META, { uploadedAt: activeStamp, sourceSig: activeSig }).catch(() => {
      });
    },
    updateRow: (id, updates) => setState((s) => ({
      ...s,
      data: (s.data || []).map((r) => r.__uid === id ? { ...r, ...updates } : r)
    })),
    setFilters: (updater) => setState((s) => {
      const next = typeof updater === "function" ? updater(s.filters) : updater;
      return { ...s, filters: next };
    }),
    setSettings: (updater) => setState((s) => {
      const next = typeof updater === "function" ? updater(s.settings) : updater;
      return { ...s, settings: next };
    }),
    setTargets: (targets) => {
      setState((s) => ({ ...s, targets: targets || {} }));
      try {
        localStorage.setItem(STORAGE_TARGETS_KEY, JSON.stringify(targets || {}));
      } catch {
      }
    },
    setRateTargets: (rateTargets) => {
      setState((s) => ({ ...s, rateTargets: rateTargets || {} }));
      try {
        localStorage.setItem(STORAGE_RATE_TARGETS_KEY, JSON.stringify(rateTargets || {}));
      } catch {
      }
    },
    setCcData: (ccData) => {
      setState((s) => ({ ...s, ccData: ccData || {} }));
      try {
        localStorage.setItem(STORAGE_CC_DATA_KEY, JSON.stringify(ccData || {}));
      } catch {
      }
    },
    setExpansionTargets: (expansionTargets) => {
      setState((s) => ({ ...s, expansionTargets: expansionTargets || {} }));
      try {
        localStorage.setItem(STORAGE_EXPANSION_TARGETS_KEY, JSON.stringify(expansionTargets || {}));
      } catch {
      }
    },
    importHistoricalCSV: (rows, headers, uploadedAtMs, sourceSig) => {
      headers = trimHeaders(headers);
      for (let i = 0; i < (rows || []).length; i++) trimRow(rows[i]);
      const hm = buildHeaderMap(headers);
      hm.CC = hm.CC || headers.find((h) => h === "CC") || "CC";
      hm.CC_OFFCYCLE = hm.CC_OFFCYCLE || headers.find((h) => h === "CC_OFFCYCLE_ARR") || "CC_OFFCYCLE_ARR";
      hm.EXPANSION = hm.EXPANSION || headers.find((h) => h === "EXPANSION") || "EXPANSION";
      hm.DONE_DEAL = hm.DONE_DEAL || headers.find((h) => h === "DONE_DEAL") || "DONE_DEAL";
      hm.PARTNER = hm.PARTNER || hm.PARTNER_NAME || headers.find((h) => h === "PARTNER_NAME") || "PARTNER_NAME";
      hm.FLAG_TOP3K = hm.FLAG_TOP3K || hm.FLAG_3K || "FLAG_3K";
      hm.INDUSTRY_TERRITORY = hm.TERRITORY_INDUSTRY_C || hm.INDUSTRY_TERRITORY || "TERRITORY_INDUSTRY_C";
      hm.BILLING_COUNTRY = hm.BILLING_COUNTRY || "BILLING_COUNTRY";
      hm.DAYS_SINCE_TOUCH = hm.DAYS_SINCE_LAST_CS_TOUCH || hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
      hm.YEAR_QUARTER = hm.YEAR_QUARTER || "YEAR_QUARTER";
      hm.FISCAL_QUARTER = hm.FISCAL_QUARTER || "FISCAL_QUARTER";
      hm.FISCAL_YEAR = hm.FISCAL_YEAR || "FISCAL_YEAR";
      const qKey = hm.YEAR_QUARTER;
      const enriched = (rows || []).map((row, idx) => {
        const quarterRaw = safeString(row[qKey]);
        let { fy, fq } = deriveFiscalFromQuarterLabel(quarterRaw);
        if (!fy || !fq) {
          const dt = parseDate(row[hm.NEXT_RENEWAL_DATE]);
          const m = mapFiscal(dt);
          fy = m.fy;
          fq = m.fq;
        }
        return {
          ...row,
          YEAR_QUARTER: quarterRaw || row.YEAR_QUARTER || fq || "",
          FISCAL_YEAR: fy,
          FISCAL_QUARTER: fq || quarterRaw || row.FISCAL_QUARTER || "",
          __uid: `hist_${Date.now()}_${idx}`,
          __importIndex: idx
        };
      });
      const stamp = Number(uploadedAtMs) || Date.now();
      const histSig = sourceSig || null;
      setState((s) => ({
        ...s,
        historicalData: enriched,
        historicalHeaderMap: hm,
        meta: { ...s.meta, historicalUploadedAt: stamp, historicalSourceSig: histSig }
      }));
      idbSet(IDB_KEY_HIST, enriched).catch(() => {
      });
      idbSet(IDB_KEY_HIST_HM, hm).catch(() => {
      });
      idbSet(IDB_KEY_HIST_META, { uploadedAt: stamp, sourceSig: histSig }).catch(() => {
      });
    },
    clearHistoricalData: () => {
      setState((s) => ({
        ...s,
        historicalData: [],
        historicalHeaderMap: {},
        meta: { ...s.meta, historicalUploadedAt: null }
      }));
      try {
        localStorage.removeItem(STORAGE_HISTORICAL_KEY);
        localStorage.removeItem(STORAGE_HISTORICAL_KEY + "_hm");
      } catch {
      }
      idbRemove(IDB_KEY_HIST).catch(() => {
      });
      idbRemove(IDB_KEY_HIST_HM).catch(() => {
      });
    },
    setNote: (noteKey, notePayload) => setState((s) => {
      if (!noteKey) return s;
      const existing = s.notes || {};
      const deletes = s.noteDeletes || {};
      const current = existing[noteKey];
      const incomingTs = Number(notePayload?.updatedAt) || Date.now();
      if (!notePayload) {
        const next = { ...existing };
        delete next[noteKey];
        const nextDeletes2 = { ...deletes, [noteKey]: Date.now() };
        return { ...s, notes: next, noteDeletes: nextDeletes2 };
      }
      const { preserveEmpty, ...payload } = notePayload || {};
      const noteText = safeString(payload.note);
      const djForecastNum = payload.djForecast != null && isFinite(toNumber(payload.djForecast)) ? toNumber(payload.djForecast) : null;
      const hasContent = noteText !== "" || djForecastNum !== null;
      if (!hasContent && !preserveEmpty) {
        const next = { ...existing };
        delete next[noteKey];
        const nextDeletes2 = { ...deletes, [noteKey]: Date.now() };
        return { ...s, notes: next, noteDeletes: nextDeletes2 };
      }
      if (current) {
        const currentTs = Number(current.updatedAt) || 0;
        if (incomingTs < currentTs) return s;
      }
      let updatedHistory = Array.isArray(payload.history) ? payload.history : current ? Array.isArray(current.history) ? current.history : [] : [];
      if (current && (safeString(current.note) !== noteText || (current.djForecast ?? null) !== (djForecastNum ?? null))) {
        const entry = { note: safeString(current.note), djForecast: current.djForecast ?? null, timestamp: Number(current.updatedAt) || incomingTs };
        updatedHistory = [entry, ...updatedHistory].slice(0, MAX_NOTE_HISTORY);
      }
      const nextNotes = {
        ...existing,
        [noteKey]: { ...payload, note: noteText, djForecast: djForecastNum, updatedAt: incomingTs, history: updatedHistory }
      };
      const nextDeletes = { ...deletes };
      if (nextDeletes[noteKey]) delete nextDeletes[noteKey];
      return {
        ...s,
        notes: nextNotes,
        noteDeletes: nextDeletes
      };
    }),
    importNotes: (notesObj) => setState((s) => {
      const next = { ...s.notes || {} };
      const nextDeletes = { ...s.noteDeletes || {} };
      const now = Date.now();
      Object.entries(notesObj || {}).forEach(([k, v]) => {
        if (!k || typeof v !== "object") return;
        const rawTs = Number(v.updatedAt);
        const incomingTs = isFinite(rawTs) && rawTs > 0 ? rawTs : 0;
        const deleteTs = Number(nextDeletes[k]) || 0;
        const hasTomb = deleteTs > 0;
        const currentTs = Number(next[k]?.updatedAt) || 0;
        // A deliberate file-import is AUTHORITATIVE: it always restores a note
        // that was previously deleted (tombstoned), regardless of the note's
        // original (older) updatedAt. Previously the tombstone-skip guard
        // (`if (deleteTs && incomingTs <= deleteTs) return`) dropped every
        // re-imported note when the user had bulk-deleted first, so the notes
        // stayed deleted and re-synced as deletes. We only apply newer-wins
        // when there is NO tombstone, so we never downgrade a locally-newer
        // edit for a key the user did not delete.
        if (!hasTomb && next[k] && incomingTs < currentTs) return;
        const incomingHist = Array.isArray(v.history) ? v.history : [];
        const existingHist = next[k] ? Array.isArray(next[k].history) ? next[k].history : [] : [];
        const seen = /* @__PURE__ */ new Set();
        const mergedHistory = [...incomingHist, ...existingHist].filter((h) => {
          const key = String(h.timestamp);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, MAX_NOTE_HISTORY);
        // When restoring over a tombstone, the note must beat BOTH the local
        // tombstone AND any lingering SERVER tombstone through the sync/merge:
        // the server keeps tombstones forever and re-sends them on GET, and the
        // client merge (and migrateDeletesObject) only lets a note survive /
        // prune the tombstone when its updatedAt STRICTLY exceeds the delete
        // time. So bump updatedAt to max(incomingTs, deleteTs + 1, now).
        // Otherwise preserve the note's own timestamp (history is always kept).
        const effectiveTs = hasTomb ? Math.max(incomingTs, deleteTs + 1, now) : (incomingTs || now);
        next[k] = { ...v, updatedAt: effectiveTs, history: mergedHistory };
        if (nextDeletes[k]) delete nextDeletes[k];
      });
      return { ...s, notes: next, noteDeletes: nextDeletes };
    }),
    moveNote: (fromKey, toKey, payload) => setState((s) => {
      if (!fromKey || !toKey || !payload) return s;
      const next = { ...s.notes || {} };
      const deletes = { ...s.noteDeletes || {} };
      next[toKey] = payload;
      if (fromKey !== toKey) {
        delete next[fromKey];
        deletes[fromKey] = Date.now();
      }
      if (deletes[toKey]) delete deletes[toKey];
      return { ...s, notes: next, noteDeletes: deletes };
    }),
    deleteNotes: (noteKeys) => setState((s) => {
      const keys = Array.isArray(noteKeys) ? noteKeys.filter(Boolean) : [];
      if (!keys.length) return s;
      const next = { ...s.notes || {} };
      const nextDeletes = { ...s.noteDeletes || {} };
      const now = Date.now();
      keys.forEach((k) => {
        delete next[k];
        nextDeletes[k] = now;
      });
      return { ...s, notes: next, noteDeletes: nextDeletes };
    })
  }), [setTheme, setState]);
  useEffect(() => {
    if (typeof window !== "undefined") window.__renewalsActions = actions;
  }, [actions]);
  useEffect(() => {
    if (typeof window !== "undefined") window.__renewalsPeekState = () => state;
  }, [state]);
  const accountMeta = useMemo(() => {
    const hm = state.headerMap || {};
    const settings = state.settings || {};
    const rows = state.data || [];
    const rollupRows = settings.useRemainingArr ? dedupeLatestRows(rows, hm) : rows;
    const accountRollups = buildAccountRollups(rollupRows, hm, settings);
    const touchKey = hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
    const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
    const touchByAccount = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const acct = safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const v = toNumber(r[touchKey]);
      if (!isFinite(v)) continue;
      const cur = touchByAccount.get(acct);
      if (cur === void 0 || v > cur) touchByAccount.set(acct, v);
    }
    return { rollupRows, accountRollups, touchByAccount };
  }, [state.data, state.headerMap, state.settings]);
  const dismissRefreshState = useCallback(() => setRefreshState(null), []);
  const value = useMemo(() => ({ theme, bgTheme, state, actions, idbReady, serverInfo, refreshState, dismissRefreshState, accountMeta }), [theme, bgTheme, state, actions, idbReady, serverInfo, refreshState, dismissRefreshState, accountMeta]);
  const statusValue = useMemo(() => ({ serverSyncStatus, csvAutoLoadStatus }), [serverSyncStatus, csvAutoLoadStatus]);
  return /* @__PURE__ */ React.createElement(AppContext.Provider, { value }, /* @__PURE__ */ React.createElement(AppStatusContext.Provider, { value: statusValue }, children));
}
function CSVImporter() {
  const { actions } = useApp();
  const inputRef = useRef();
  const onChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploadedAtMs = file.lastModified || Date.now();
    streamParseCSV(file, {
      onComplete: (rows, headers) => actions.importCSV(rows, headers, uploadedAtMs),
      onError: (err) => alert("Error parsing CSV: " + err?.message)
    });
    e.target.value = "";
  };
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("input", { ref: inputRef, id: "csvFile", type: "file", accept: ".csv", onChange, className: "hidden" }), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo", onClick: () => inputRef.current?.click(), title: "Import CSV report" }, "Import CSV"), /* @__PURE__ */ React.createElement(ExportButton, null));
}
function NotesIO({ headless = false }) {
  const { state, actions } = useApp();
  const { byAccount: fcByAccount } = useAccountForecasts();
  const inputRef = useRef(null);
  const notes = state.notes || {};
  const noteDeletes = state.noteDeletes || {};
  // Count ALL notes present in state (matched + orphan/imported), excluding
  // only tombstoned keys — mirrors the orphan-aware logic in NotesHub/noteRows
  // so the "Export Notes (N)" badge shows the real total (and export includes
  // orphan notes) instead of dropping to 0 when no rows are loaded.
  const totalNotes = Object.keys(notes).filter((k) => !noteDeletes[k]).length;
  const [exportMode, setExportMode] = useState("all");
  const [showExportReview, setShowExportReview] = useState(false);
  const [exportSearch, setExportSearch] = useState("");
  const hm = state.headerMap || {};
  const accountKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const accountIdKey = hm.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const atrKey = getAtrKey(hm, state.settings);
  const buKey = getBuKey(hm, state.settings);
  const rowsSource = useMemo(
    () => state.settings?.useRemainingArr ? ensureEffectiveFields(state.data || [], hm) : state.data || [],
    [state.data, hm, state.settings]
  );
  const rowsByNoteKey = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    rowsSource.forEach((r) => {
      if (!r.__noteKey) return;
      m.set(r.__noteKey, r);
      // Also index by the canonical (quarter-normalized) key so a note whose
      // key uses a different quarter spelling still resolves to its row.
      const canon = canonicalNoteKey(r.__noteKey);
      if (canon !== r.__noteKey && !m.has(canon)) m.set(canon, r);
    });
    return m;
  }, [rowsSource]);
  const matchRowForKey = (k) => rowsByNoteKey.get(k) || rowsByNoteKey.get(canonicalNoteKey(k));
  const [noteReportState, setNoteReportState] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [autoMatchState, setAutoMatchState] = useState(null);
  const [showAutoMatchLog, setShowAutoMatchLog] = useState(false);
  const [showAutoMatchModal, setShowAutoMatchModal] = useState(false);
  useEffect(() => {
    setNoteReportState(null);
    setAutoMatchState(null);
    setShowAutoMatchLog(false);
    setShowAutoMatchModal(false);
    const handler = (event) => {
      if (event?.persisted) setNoteReportState(null);
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, []);
  useEffect(() => {
    if (!headless) return;
    const handler = (event) => {
      if (event?.detail === "open") {
        setNoteReportState({ type: "import" });
        setAutoMatchState(null);
        setShowAutoMatchLog(false);
        setShowAutoMatchModal(false);
      }
    };
    window.addEventListener(NOTES_REPORT_EVENT, handler);
    return () => window.removeEventListener(NOTES_REPORT_EVENT, handler);
  }, [headless]);
  useEffect(() => {
    if (!headless) return;
    const handler = () => {
      if (Object.keys(notes).length > 0) {
        setExportSearch("");
        setShowExportReview(true);
      }
    };
    window.addEventListener(NOTES_EXPORT_REVIEW_EVENT, handler);
    return () => window.removeEventListener(NOTES_EXPORT_REVIEW_EVENT, handler);
  }, [notes, headless]);
  const accountOptions = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    rowsSource.forEach((r) => {
      if (!r.__noteKey) return;
      if (m.has(r.__noteKey)) return;
      const account = safeString(r[accountKey]) || "(Unnamed account)";
      const accountId = safeString(r[accountIdKey]);
      const owner = safeString(r[ownerKey]);
      const atr = toNumber(r[atrKey]);
      const fq = safeString(r.FISCAL_QUARTER || r[hm.FISCAL_QUARTER] || r[hm.YEAR_QUARTER]);
      const renewalDate = safeString(r[hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE"]);
      const labelParts = [account, fq].filter(Boolean);
      const label = `${labelParts.join(" \xB7 ")}${isFinite(atr) ? ` \xB7 ${formatCurrencyUSD(atr)}` : ""}`;
      const hasNote = !!notes[r.__noteKey];
      m.set(r.__noteKey, { noteKey: r.__noteKey, account, accountId, owner, atr, fq, renewalDate, label, hasNote });
    });
    return Array.from(m.values()).sort((a, b) => {
      const nameComp = a.account.localeCompare(b.account);
      if (nameComp !== 0) return nameComp;
      const atrA = isFinite(a.atr) ? a.atr : 0;
      const atrB = isFinite(b.atr) ? b.atr : 0;
      if (atrA !== atrB) return atrB - atrA;
      return safeString(a.fq).localeCompare(safeString(b.fq));
    });
  }, [rowsSource, accountKey, accountIdKey, ownerKey, atrKey, hm, notes]);
  const accountMatchCatalog = useMemo(() => {
    const byNormalizedName = /* @__PURE__ */ new Map();
    const byAccountId = /* @__PURE__ */ new Map();
    accountOptions.forEach((opt) => {
      const normalized = normalizeAccountName(opt.account);
      if (normalized) {
        const list = byNormalizedName.get(normalized) || [];
        list.push(opt);
        byNormalizedName.set(normalized, list);
      }
      const id = safeString(opt.accountId);
      if (id) {
        const list = byAccountId.get(id) || [];
        list.push(opt);
        byAccountId.set(id, list);
      }
    });
    const pickBest = (list = []) => {
      if (!list.length) return null;
      return list.slice().sort((a, b) => {
        const aHas = a.hasNote ? 1 : 0;
        const bHas = b.hasNote ? 1 : 0;
        if (aHas !== bHas) return aHas - bHas;
        const atrA = isFinite(a.atr) ? a.atr : 0;
        const atrB = isFinite(b.atr) ? b.atr : 0;
        if (atrA !== atrB) return atrB - atrA;
        return safeString(a.fq).localeCompare(safeString(b.fq));
      })[0];
    };
    return { byNormalizedName, byAccountId, pickBest };
  }, [accountOptions]);
  const buildEntry = (key, payload) => {
    const row = matchRowForKey(key);
    const safePayload = payload || {};
    const accountLabel = safeString(safePayload.accountLabel);
    const accountName = safeString(safePayload.accountName);
    const accountId = safeString(safePayload.accountId);
    let account = row ? safeString(row[accountKey]) || "(Unnamed account)" : "";
    let accountSource = row ? "row" : "key";
    if (!row) {
      if (accountLabel) {
        account = accountLabel;
        accountSource = "label";
      } else if (accountName) {
        account = accountName;
        accountSource = "note";
      } else if (accountId) {
        account = accountId;
        accountSource = "id";
      } else {
        const keyBase = safeString(key).split("::")[0];
        if (keyBase) {
          account = keyBase;
          accountSource = "key";
        } else {
          account = "";
          accountSource = "unknown";
        }
      }
    }
    const owner = row ? safeString(row[ownerKey]) : safeString(safePayload.owner);
    const rawAtr = row ? row[atrKey] : safePayload.atr;
    const hasAtr = rawAtr != null && String(rawAtr).trim() !== "";
    const atr = hasAtr ? toNumber(rawAtr) : null;
    const notePreview = safeString(safePayload.note || "").slice(0, 90);
    return {
      key,
      account,
      owner,
      atr,
      notePreview,
      matched: !!row,
      archived: !!safePayload.archived,
      accountLabel,
      accountSource
    };
  };
  const summarizeNotes = (notesObj, type, options = {}) => {
    const { includeArchived = true, storeNotes = null } = options;
    const matched = [];
    const unmatched = [];
    let archivedCount = 0;
    Object.entries(notesObj || {}).forEach(([k, v]) => {
      const payload = storeNotes && storeNotes[k] ? storeNotes[k] : v;
      const entry = buildEntry(k, payload);
      if (entry.archived) {
        archivedCount += 1;
        if (!includeArchived) return;
      }
      (entry.matched ? matched : unmatched).push(entry);
    });
    matched.sort((a, b) => safeString(a.account).localeCompare(safeString(b.account)));
    unmatched.sort((a, b) => a.key.localeCompare(b.key));
    const total = matched.length + unmatched.length;
    return {
      type,
      total,
      sourceTotal: Object.keys(notesObj || {}).length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      matched,
      unmatched,
      archivedCount,
      hiddenArchivedCount: includeArchived ? 0 : archivedCount
    };
  };
  const updateNoteMeta = (key, updates) => {
    if (!key) return;
    const current = notes[key] || {};
    actions.setNote(key, {
      ...current,
      ...updates,
      updatedAt: Date.now(),
      preserveEmpty: true
    });
  };
  const handleArchiveNote = (key, archived) => {
    updateNoteMeta(key, { archived: !!archived });
  };
  const handleMatchAccount = (sourceKey, targetKey, mode = "replace") => {
    try {
      if (!sourceKey || !targetKey) return { ok: false, message: "Missing source or target key." };
      if (sourceKey === targetKey) {
        updateNoteMeta(sourceKey, { archived: false });
        return { ok: true, message: "Already linked to this account." };
      }
      const sourceNote = notes[sourceKey];
      if (!sourceNote) return { ok: false, message: "Source note not found." };
      const targetExisting = notes[targetKey] || null;
      if (targetExisting && mode === "replace") {
        const ok = window.confirm("A note already exists for that account. Replace it?");
        if (!ok) return { ok: false, message: "Replace cancelled." };
      }
      const sourceText = safeString(sourceNote.note);
      const targetText = safeString(targetExisting?.note);
      const sourceDj = sourceNote.djForecast != null && isFinite(toNumber(sourceNote.djForecast)) ? toNumber(sourceNote.djForecast) : null;
      const targetDjRaw = targetExisting?.djForecast;
      const targetDj = targetDjRaw != null && isFinite(toNumber(targetDjRaw)) ? toNumber(targetDjRaw) : null;
      const targetRow = rowsByNoteKey.get(targetKey);
      let base = { ...sourceNote };
      let nextNote = sourceText;
      let nextDj = sourceDj;
      if (mode === "merge" && targetExisting) {
        base = { ...sourceNote, ...targetExisting };
        if (targetText && sourceText) {
          nextNote = targetText.includes(sourceText) ? targetText : `${targetText}

${sourceText}`;
        } else {
          nextNote = targetText || sourceText;
        }
        nextDj = targetDj != null ? targetDj : sourceDj;
      } else if (targetExisting && mode !== "replace") {
        base = { ...sourceNote, ...targetExisting };
      }
      const merged = {
        ...base,
        note: nextNote,
        djForecast: nextDj,
        archived: false,
        accountLabel: null,
        preserveEmpty: true,
        updatedAt: Date.now()
      };
      if (targetRow) {
        merged.accountId = safeString(targetRow[hm.ACCOUNT_ID || "CRM_ACCOUNT_ID"]);
        merged.accountName = safeString(targetRow[accountKey]);
        merged.owner = safeString(targetRow[ownerKey]);
        merged.renewalDate = safeString(targetRow[hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE"]);
        merged.fq = safeString(targetRow.FISCAL_QUARTER || targetRow[hm.FISCAL_QUARTER] || targetRow[hm.YEAR_QUARTER]);
        merged.atr = toNumber(targetRow[atrKey]);
      }
      if (typeof actions.moveNote === "function") {
        actions.moveNote(sourceKey, targetKey, merged);
      } else {
        actions.setNote(targetKey, merged);
        setTimeout(() => actions.setNote(sourceKey, null), 0);
      }
      const label = targetRow ? safeString(targetRow[accountKey]) || safeString(targetRow[hm.ACCOUNT_ID || "CRM_ACCOUNT_ID"]) : targetKey;
      return { ok: true, message: `Linked to ${label || "account"}.` };
    } catch (err) {
      return { ok: false, message: `Link failed: ${err?.message || err}` };
    }
  };
  const autoMatchPreview = useMemo(() => {
    const summary = { candidates: 0, ambiguous: 0, noMatch: 0, total: 0 };
    const unmatchedAll = summarizeNotes(notes, "import", { includeArchived: true }).unmatched.filter((entry) => !entry.archived);
    unmatchedAll.forEach((entry) => {
      summary.total += 1;
      const payload = notes[entry.key] || {};
      const accountId = safeString(payload.accountId);
      const accountName = entry.account || safeString(payload.accountName) || safeString(payload.accountLabel);
      let candidates = [];
      if (accountId && accountMatchCatalog.byAccountId.has(accountId)) {
        candidates = accountMatchCatalog.byAccountId.get(accountId) || [];
      } else {
        const normalized = normalizeAccountName(accountName);
        if (normalized && accountMatchCatalog.byNormalizedName.has(normalized)) {
          candidates = accountMatchCatalog.byNormalizedName.get(normalized) || [];
        }
      }
      if (candidates.length === 1) summary.candidates += 1;
      else if (candidates.length > 1) summary.ambiguous += 1;
      else summary.noMatch += 1;
    });
    return summary;
  }, [notes, accountMatchCatalog]);
  const runAutoMatch = async () => {
    const unmatchedAll = summarizeNotes(notes, "import", { includeArchived: true }).unmatched.filter((entry) => !entry.archived);
    const plans = unmatchedAll.map((entry) => {
      const payload = notes[entry.key] || {};
      const accountId = safeString(payload.accountId);
      const accountName = entry.account || safeString(payload.accountName) || safeString(payload.accountLabel);
      let candidates = [];
      if (accountId && accountMatchCatalog.byAccountId.has(accountId)) {
        candidates = accountMatchCatalog.byAccountId.get(accountId) || [];
      } else {
        const normalized = normalizeAccountName(accountName);
        if (normalized && accountMatchCatalog.byNormalizedName.has(normalized)) {
          candidates = accountMatchCatalog.byNormalizedName.get(normalized) || [];
        }
      }
      const target = candidates.length === 1 ? accountMatchCatalog.pickBest(candidates) : null;
      return { entry, accountName, candidates, target };
    });
    const targetCounts = /* @__PURE__ */ new Map();
    plans.forEach((plan) => {
      const key = plan?.target?.noteKey;
      if (!key) return;
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    });
    const initial = {
      running: true,
      total: plans.length,
      processed: 0,
      merged: 0,
      ambiguous: 0,
      noMatch: 0,
      failed: 0,
      details: []
    };
    setAutoMatchState(initial);
    for (const plan of plans) {
      const { entry, accountName, candidates, target } = plan;
      let status = "no-match";
      let message = "No account match found";
      if (candidates.length === 1 && target) {
        if ((targetCounts.get(target.noteKey) || 0) > 1) {
          status = "ambiguous";
          message = `Ambiguous (shared target ${target.account || target.noteKey})`;
        } else {
          const result = handleMatchAccount(entry.key, target?.noteKey, "merge");
          if (result?.ok) {
            status = "matched";
            message = result.message || `Matched to ${target?.account || "account"}`;
          } else {
            status = "failed";
            message = result?.message || "Match failed";
          }
        }
      } else if (candidates.length > 1) {
        status = "ambiguous";
        message = `Ambiguous (${candidates.length} candidates)`;
      }
      setAutoMatchState((prev) => {
        const next = prev || initial;
        const updated = {
          ...next,
          processed: Math.min(next.total, next.processed + 1),
          merged: next.merged + (status === "matched" ? 1 : 0),
          ambiguous: next.ambiguous + (status === "ambiguous" ? 1 : 0),
          noMatch: next.noMatch + (status === "no-match" ? 1 : 0),
          failed: next.failed + (status === "failed" ? 1 : 0),
          details: [
            ...next.details,
            {
              sourceKey: entry.key,
              account: accountName || "(Unknown)",
              status,
              message
            }
          ]
        };
        return updated;
      });
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    setAutoMatchState((prev) => ({ ...prev || initial, running: false }));
  };
  const handleArchiveAllUnmatched = () => {
    const unmatchedAll = summarizeNotes(notes, "import", { includeArchived: true }).unmatched;
    unmatchedAll.forEach((entry) => updateNoteMeta(entry.key, { archived: true }));
  };
  // NOTE: A bulk "delete all unmatched" action was intentionally removed.
  // "Unmatched" only means a note does not line up with the CURRENTLY loaded
  // CSV slice (e.g. a different quarter/dataset) — the note is still valid and
  // must be KEPT. Mass-tombstoning unmatched notes previously wiped real data
  // and could sync those deletes to the server. Unmatched notes can still be
  // archived in bulk (non-destructive) or deleted one-by-one with a per-note
  // confirmation (an explicit, deliberate user action).
  const onImportClick = () => inputRef.current?.click();
  const restoreCallsFromImport = (notesObj) => {
    const entries = Object.entries(notesObj || {}).filter(([, v]) => v && (v.csCall != null || v.renewalsCall != null));
    if (!entries.length) return;
    const importSettings = state.settings || {};
    Promise.all(entries.map(([k, v]) => {
      const cs = v.csCall != null && isFinite(toNumber(v.csCall)) ? toNumber(v.csCall) : null;
      const rn = v.renewalsCall != null && isFinite(toNumber(v.renewalsCall)) ? toNumber(v.renewalsCall) : null;
      if (cs == null && rn == null) return Promise.resolve();
      // Note keys are 2-part (accountBase::period); call_keys are 3-part
      // (accountBase::period::roundedATR). Rebuild the call_key from the
      // matched row using the SAME helpers the inline editor and account card
      // use, so an imported call lands on the record the row resolves to
      // (otherwise it is stored under an orphan key and cannot be edited).
      const row = rowsByNoteKey.get(k);
      let callKey = null, yq = "", roundedAtr = 0, accountName = safeString(v.accountName), acctBase = "";
      if (row && typeof RenewalsCallKeys !== "undefined") {
        callKey = RenewalsCallKeys.buildCallKey(row, hm, importSettings);
        yq = RenewalsCallKeys.yearQuarterFromRow(row, hm);
        roundedAtr = RenewalsCallKeys.effectiveAtrFromRow(row, hm, importSettings);
        accountName = safeString(row[accountKey]) || accountName;
      }
      if (callKey) {
        acctBase = String(callKey).split("::")[0];
      } else {
        // Unmatched note: fall back to the exported metadata.
        const parts = String(k).split("::");
        acctBase = safeString(v.accountId) || parts[0] || "";
        yq = parts[1] || safeString(v.fq) || "";
        const atrNum = Math.round(toNumber(v.atr));
        roundedAtr = isFinite(atrNum) ? atrNum : 0;
        callKey = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKeyFromParts(acctBase, accountName, yq, roundedAtr) : null;
      }
      if (!acctBase || !callKey) return Promise.resolve();
      return fetch("/api/renewals/account-forecasts/" + encodeURIComponent(acctBase), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_key: callKey,
          account_name: accountName,
          year_quarter: yq,
          rounded_atr: roundedAtr,
          cs_forecast: cs,
          renewals_forecast: rn,
          source: "import"
        })
      }).catch(() => {
      });
    })).then(() => {
      try {
        window.dispatchEvent(new CustomEvent("renewals-acctfc-changed"));
      } catch (_) {
      }
    });
  };
  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result || "{}");
        if (parsed.version !== 1 && parsed.version !== 2) throw new Error("Unsupported version (expected 1 or 2)");
        if (!parsed.notes || typeof parsed.notes !== "object") throw new Error("Missing notes object");
      } catch (err) {
        alert("Failed to import notes JSON: " + (err?.message || err));
        e.target.value = "";
        return;
      }
      // Update local state immediately so the UI reflects the import.
      actions.importNotes(parsed.notes);
      setNoteReportState({ type: "import", notesSource: parsed.notes });
      restoreCallsFromImport(parsed.notes);
      // Then persist to the server EXPLICITLY and report the outcome. The old
      // path relied only on the debounced background sync PUT, whose 401 /
      // network errors could pass unnoticed — the notes lived in the browser
      // until a refresh dropped them behind older server tombstones (silent
      // data loss). This awaited PUT surfaces failures (alert + session lock)
      // and stamps each note's updatedAt to STRICTLY BEAT any server tombstone
      // so a re-import always wins server-side and survives the load-merge.
      (async () => {
        const keys = Object.keys(parsed.notes || {});
        if (!keys.length) return;
        try {
          let serverDeletes = {};
          try {
            const gres = await fetch("/api/renewals/notes", { cache: "no-store" });
            if (gres.ok) {
              const gj = await gres.json();
              serverDeletes = gj && gj.noteDeletes || {};
            }
          } catch (_) {
          }
          const now = Date.now();
          const outNotes = {};
          keys.forEach((k, i) => {
            const v = parsed.notes[k];
            if (!v || typeof v !== "object") return;
            const fileTs = Number(v.updatedAt) || 0;
            const tomb = Number(serverDeletes[k]) || 0;
            // max(file ts, tombstone+1, now) + i  => unique and always newer
            // than the key's tombstone, so the server note-write wins and the
            // client load-merge keeps it.
            outNotes[k] = { ...v, updatedAt: Math.max(fileTs, tomb ? tomb + 1 : 0, now) + i };
          });
          const res = await fetch("/api/renewals/notes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: outNotes, noteDeletes: {} })
          });
          if (!res.ok) {
            if (res.status === 401 && typeof window !== "undefined" && window.RenewalsSessionLock && typeof window.RenewalsSessionLock.showLock === "function") {
              window.RenewalsSessionLock.showLock("Your secure sign-in session expired, so your imported notes were NOT saved to the server. Refresh the page to sign in again, then re-import.");
            }
            alert("Imported into this browser, but the server rejected the save (HTTP " + res.status + "). Your notes are NOT on the server yet.\n\n" + (res.status === 401 ? "Your secure session expired \u2014 refresh the page to sign in again, then re-import." : "Please try the import again."));
            return;
          }
          let body = null;
          try {
            body = await res.json();
          } catch (_) {
          }
          alert("Imported and saved " + keys.length + " note" + (keys.length === 1 ? "" : "s") + " to the server" + (body && body.noteCount != null ? " \u2014 the server now holds " + body.noteCount + " note" + (body.noteCount === 1 ? "" : "s") + "." : "."));
        } catch (err) {
          alert("Imported into this browser, but could not reach the server: " + (err?.message || err) + "\n\nYour notes are NOT saved to the server yet \u2014 check your connection and re-import.");
        }
      })();
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const onExport = () => {
    if (!totalNotes) {
      alert("No notes to export");
      return;
    }
    setExportSearch("");
    setShowExportReview(true);
  };
  const exportNotesMemo = useMemo(() => {
    if (exportMode === "matched_active") {
      const next = {};
      Object.entries(notes).forEach(([k, v]) => {
        if (!matchRowForKey(k)) return;
        if (v?.archived) return;
        next[k] = v;
      });
      return next;
    }
    return { ...notes };
  }, [notes, exportMode, rowsByNoteKey]);
  const getExportNotes = () => exportNotesMemo;
  const exportReviewItems = useMemo(() => {
    if (!showExportReview) return [];
    const exportNotes = getExportNotes();
    const q = exportSearch.trim().toLowerCase();
    return Object.entries(exportNotes).map(([k, v]) => {
      const row = rowsByNoteKey.get(k);
      const account = row ? safeString(row[accountKey]) : safeString(v.accountName) || safeString(v.accountLabel) || k.split("::")[0] || "(Unknown)";
      const fq = row ? safeString(row.FISCAL_QUARTER || row[hm.FISCAL_QUARTER] || row[hm.YEAR_QUARTER]) : safeString(v.fq);
      const noteText = safeString(v.note);
      const dj = v.djForecast != null && isFinite(toNumber(v.djForecast)) ? toNumber(v.djForecast) : null;
      const atr = row ? toNumber(row[atrKey]) : isFinite(toNumber(v.atr)) ? toNumber(v.atr) : null;
      const bu = row ? toNumber(row[buKey]) : null;
      const owner = row ? safeString(row[ownerKey]) : safeString(v.owner);
      const matched = !!row;
      const archived = !!v.archived;
      return { key: k, account, fq, noteText, dj, atr, bu, owner, matched, archived };
    }).filter((item) => {
      if (!q) return true;
      return `${item.account} ${item.fq} ${item.noteText} ${item.owner}`.toLowerCase().includes(q);
    }).sort((a, b) => a.account.localeCompare(b.account));
  }, [showExportReview, notes, exportMode, rowsByNoteKey, accountKey, hm, atrKey, buKey, ownerKey, exportSearch]);
  const confirmExport = () => {
    const exportNotes = getExportNotes();
    const exportedTotal = Object.keys(exportNotes).length;
    if (!exportedTotal) {
      alert("No notes to export");
      return;
    }
    const exportSettings = state.settings || {};
    const notesWithCalls = {};
    Object.entries(exportNotes).forEach(([k, v]) => {
      // Calls live in fcByAccount keyed by the 3-part call_key
      // (accountBase::period::roundedATR), NOT the 2-part note key
      // (accountBase::period). Looking up by the bare note key `k` always
      // missed, which is why every csCall/renewalsCall exported as null.
      // Rebuild the 3-part call_key exactly like the inline editor / account
      // card do (from the matched row, or from the note's own metadata when
      // the note doesn't match the current dataset) before looking it up.
      let callKey = null;
      const row = rowsByNoteKey.get(k);
      if (row && typeof RenewalsCallKeys !== "undefined") {
        callKey = RenewalsCallKeys.buildCallKey(row, hm, exportSettings);
      } else if (typeof RenewalsCallKeys !== "undefined") {
        const parts = String(k).split("::");
        const acctBase = safeString(v.accountId) || parts[0] || "";
        const yq = parts[1] || safeString(v.fq) || "";
        const atrNum = Math.round(toNumber(v.atr));
        callKey = RenewalsCallKeys.buildCallKeyFromParts(acctBase, safeString(v.accountName), yq, isFinite(atrNum) ? atrNum : 0);
      }
      const fc = callKey && fcByAccount && fcByAccount.get ? fcByAccount.get(callKey) : null;
      const cs = fc && fc.cs_forecast != null && isFinite(toNumber(fc.cs_forecast)) ? toNumber(fc.cs_forecast) : null;
      const rn = fc && fc.renewals_forecast != null && isFinite(toNumber(fc.renewals_forecast)) ? toNumber(fc.renewals_forecast) : null;
      // Legacy ELT override (single djForecast, no CS/Renewals split): reflect
      // it into eltCall for reference when there is no live split. csCall /
      // renewalsCall stay null (there is genuinely no split), and djForecast is
      // still carried on the note verbatim for back-compat.
      const legacyDj = v.djForecast != null && isFinite(toNumber(v.djForecast)) ? toNumber(v.djForecast) : null;
      const out = { ...v };
      out.csCall = cs;
      out.renewalsCall = rn;
      out.eltCall = cs != null || rn != null ? (cs || 0) + (rn || 0) : legacyDj;
      notesWithCalls[k] = out;
    });
    const payload = {
      version: 2,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      totalNotes: exportedTotal,
      exportMode,
      eltCallNote: "eltCall is derived (csCall + renewalsCall) and recomputed by the app on import; it is reference-only. When a note has no live CS/Renewals split, eltCall falls back to the legacy djForecast ELT override (csCall/renewalsCall stay null and djForecast is preserved verbatim).",
      notes: notesWithCalls
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const suffix = exportMode === "matched_active" ? "matched_active" : "all";
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewal_notes_${suffix}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportReview(false);
  };
  const handleDeleteNote = (key) => {
    if (!key) return;
    actions.setNote(key, null);
  };
  const noteReport = useMemo(() => {
    if (!noteReportState) return null;
    return summarizeNotes(notes, noteReportState.type, { includeArchived: showArchived });
  }, [noteReportState, notes, showArchived, rowsByNoteKey]);
  const closeNoteReport = () => {
    setNoteReportState(null);
    setAutoMatchState(null);
    setShowAutoMatchLog(false);
    setShowAutoMatchModal(false);
    try {
      window.dispatchEvent(new CustomEvent(NOTES_REPORT_EVENT, { detail: "closed" }));
    } catch {
    }
  };
  const closeAutoMatchModal = () => setShowAutoMatchModal(false);
  const reportModal = noteReport ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "modal-overlay",
      onClick: (e) => {
        if (e.target === e.currentTarget) closeNoteReport();
      }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "modal-card max-w-4xl flex flex-col",
        style: { maxHeight: "80vh" },
        onClick: (e) => e.stopPropagation()
      },
      /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400" }, noteReport.type === "import" ? "Import report" : "Export report"), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] font-semibold text-gray-800 dark:text-gray-100" }, noteReport.total.toLocaleString(), " notes \xB7 ", noteReport.matchedCount.toLocaleString(), " matched \xB7 ", noteReport.unmatchedCount.toLocaleString(), " unmatched"), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400" }, "Matched = note keys that align to rows in the current file; unmatched are kept but do not map to this dataset."), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          className: "form-checkbox",
          checked: showArchived,
          onChange: (e) => setShowArchived(e.target.checked)
        }
      ), /* @__PURE__ */ React.createElement("span", null, "Show archived")), noteReport.archivedCount ? /* @__PURE__ */ React.createElement("span", null, showArchived ? `${noteReport.archivedCount.toLocaleString()} archived` : `${noteReport.hiddenArchivedCount.toLocaleString()} archived hidden`) : null, noteReport.type === "export" && /* @__PURE__ */ React.createElement("span", null, exportMode === "matched_active" ? "Exporting matched active notes only" : "Exporting all notes"), noteReport.type === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "text-emerald-700 dark:text-emerald-300" }, autoMatchPreview.candidates.toLocaleString(), " ready"), /* @__PURE__ */ React.createElement("span", { className: "text-amber-700 dark:text-amber-300" }, autoMatchPreview.ambiguous.toLocaleString(), " ambiguous"), /* @__PURE__ */ React.createElement("span", null, autoMatchPreview.noMatch.toLocaleString(), " no match"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo", onClick: () => setShowAutoMatchModal(true) }, "Auto-match tools")))), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: closeNoteReport }, "Close")),
      /* @__PURE__ */ React.createElement("div", { className: "grid md:grid-cols-2 gap-3 p-3 min-h-0 flex-1 overflow-hidden" }, /* @__PURE__ */ React.createElement(NoteReportList, { title: "Matched to this file", items: noteReport.matched, onDelete: handleDeleteNote }), /* @__PURE__ */ React.createElement(
        NoteReportList,
        {
          title: "Unmatched (kept)",
          items: noteReport.unmatched,
          onDelete: handleDeleteNote,
          onArchive: handleArchiveNote,
          onMatch: handleMatchAccount,
          accountOptions,
          allowAssign: true
        }
      ))
    )
  ) : null;
  const autoMatchModal = noteReport && noteReport.type === "import" && showAutoMatchModal ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "modal-overlay",
      style: { zIndex: 10001 },
      onClick: (e) => {
        if (e.target === e.currentTarget) closeAutoMatchModal();
      }
    },
    /* @__PURE__ */ React.createElement("div", { className: "modal-card max-w-2xl", style: { maxHeight: "78vh", overflow: "auto" }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400" }, "Auto-match tools"), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-700 dark:text-gray-200" }, "Run account-based matching and clean up unmatched notes.")), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: closeAutoMatchModal }, "Close")), /* @__PURE__ */ React.createElement("div", { className: "p-3 space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2 text-[10px]" }, /* @__PURE__ */ React.createElement("span", { className: `pill-chip ${autoMatchState?.running ? "pill-chip-soft" : autoMatchState ? "pill-health-green" : "pill-chip-muted"}` }, autoMatchState?.running ? "Running" : autoMatchState ? "Completed" : "Ready"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-health-green" }, autoMatchPreview.candidates.toLocaleString(), " ready"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-health-amber" }, autoMatchPreview.ambiguous.toLocaleString(), " ambiguous"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-chip-muted" }, autoMatchPreview.noMatch.toLocaleString(), " no match")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: runAutoMatch, disabled: !!autoMatchState?.running || autoMatchPreview.total === 0 }, autoMatchState?.running ? "Auto-matching..." : `Auto-match unmatched (${autoMatchPreview.total.toLocaleString()})`), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-amber", onClick: handleArchiveAllUnmatched, disabled: noteReport.unmatchedCount === 0 || !!autoMatchState?.running }, "Archive all unmatched")), autoMatchState && /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "h-2 rounded-full glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `h-full transition-all ${autoMatchState?.running ? "bg-indigo-500" : "bg-emerald-500"}`,
        style: { width: `${autoMatchState.total ? Math.round(autoMatchState.processed / autoMatchState.total * 100) : 0}%` }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("span", null, autoMatchState.processed.toLocaleString(), " / ", autoMatchState.total.toLocaleString(), " processed"), /* @__PURE__ */ React.createElement("span", { className: "text-emerald-700 dark:text-emerald-300" }, autoMatchState.merged.toLocaleString(), " matched"), /* @__PURE__ */ React.createElement("span", { className: "text-amber-700 dark:text-amber-300" }, autoMatchState.ambiguous.toLocaleString(), " ambiguous"), /* @__PURE__ */ React.createElement("span", null, autoMatchState.noMatch.toLocaleString(), " no match"), /* @__PURE__ */ React.createElement("span", { className: "text-rose-700 dark:text-rose-300" }, autoMatchState.failed.toLocaleString(), " failed")), autoMatchState.details.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "smallbtn smallbtn-xs smallbtn-slate",
        onClick: () => setShowAutoMatchLog((v) => !v)
      },
      showAutoMatchLog ? "Hide run log" : `Show run log (${autoMatchState.details.length.toLocaleString()})`
    ), showAutoMatchLog && /* @__PURE__ */ React.createElement("div", { className: "max-h-40 overflow-auto rounded-lg glass-card-surface p-2 space-y-1" }, autoMatchState.details.slice(-20).map((d, idx) => /* @__PURE__ */ React.createElement("div", { key: `${d.sourceKey}-${idx}`, className: "text-[10px] text-gray-600 dark:text-gray-300 flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: `inline-block w-1.5 h-1.5 rounded-full ${d.status === "matched" ? "bg-emerald-500" : d.status === "ambiguous" ? "bg-amber-500" : d.status === "failed" ? "bg-rose-500" : "bg-slate-400"}` }), /* @__PURE__ */ React.createElement("span", { className: "truncate font-medium" }, d.account), /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 dark:text-gray-500 truncate" }, d.message))))))))
  ) : null;
  const exportReviewModal = showExportReview ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "modal-overlay",
      onClick: (e) => {
        if (e.target === e.currentTarget) setShowExportReview(false);
      }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "modal-card export-review-modal max-w-6xl flex flex-col",
        style: { maxHeight: "88vh" },
        onClick: (e) => e.stopPropagation()
      },
      /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "csm-title", style: { marginBottom: 4 } }, "Export review"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--ink)" } }, exportReviewItems.length.toLocaleString(), " notes to export", exportSearch && ` (filtered from ${Object.keys(getExportNotes()).length.toLocaleString()})`)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "filter-input",
          style: { maxWidth: 220, fontSize: 12 },
          placeholder: "Search notes...",
          value: exportSearch,
          onChange: (e) => setExportSearch(e.target.value)
        }
      ), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: () => setShowExportReview(false) }, "Cancel"))),
      /* @__PURE__ */ React.createElement("div", { style: { overflow: "auto", flex: 1, minHeight: 0 } }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", fontSize: 11, borderCollapse: "collapse", tableLayout: "fixed" } }, /* @__PURE__ */ React.createElement("colgroup", null, /* @__PURE__ */ React.createElement("col", { style: { width: "22%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "7%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "29%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "9%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "9%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "9%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "8%" } }), /* @__PURE__ */ React.createElement("col", { style: { width: "7%" } })), /* @__PURE__ */ React.createElement("thead", { className: "export-tbl-head" }, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "left" } }, "Account"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "left" } }, "Quarter"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "left" } }, "Note"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "right" } }, "ATR"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "right" } }, "BU FC"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "right" } }, "ELT Call"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "center" } }, "Status"), /* @__PURE__ */ React.createElement("th", { style: { padding: "8px 10px", textAlign: "center" } }))), /* @__PURE__ */ React.createElement("tbody", { className: "export-tbl-body" }, exportReviewItems.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 8, className: "export-tbl-muted", style: { padding: "16px 10px", textAlign: "center", fontSize: 12 } }, "No notes match the current filter")), exportReviewItems.map((item, idx) => {
        const djDiff = item.dj !== null && item.bu !== null && Math.round(item.dj) !== Math.round(item.bu);
        const djCls = djDiff ? item.dj < item.bu ? "export-dj-neg" : "export-dj-pos" : "export-dj-neutral";
        return /* @__PURE__ */ React.createElement("tr", { key: item.key, className: idx % 2 ? "export-row-alt" : "" }, /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400 }, title: item.account }, item.account), /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", whiteSpace: "nowrap", fontWeight: 600 } }, item.fq || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "export-tbl-muted", style: { padding: "7px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: item.noteText }, item.noteText || "\u2014"), /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, item.atr !== null ? formatCurrencyUSD(item.atr) : "\u2014"), /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, item.bu !== null ? formatCurrencyUSD(item.bu) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: djCls, style: { padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, item.dj !== null ? formatCurrencyUSD(item.dj) : "\u2014"), /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", textAlign: "center" } }, item.archived ? /* @__PURE__ */ React.createElement("span", { className: "export-badge export-badge-archived" }, "Archived") : item.matched ? /* @__PURE__ */ React.createElement("span", { className: "export-badge export-badge-matched" }, "Matched") : /* @__PURE__ */ React.createElement("span", { className: "export-badge export-badge-unmatched" }, "Unmatched")), /* @__PURE__ */ React.createElement("td", { style: { padding: "7px 10px", textAlign: "center" } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            className: "export-delete-btn",
            onClick: () => {
              if (window.confirm(`Delete note for "${item.account}"?`)) actions.setNote(item.key, null);
            },
            title: "Delete this note"
          },
          "Delete"
        )));
      })))),
      /* @__PURE__ */ React.createElement("div", { className: "modal-footer", style: { justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "filter-input",
          style: { fontSize: 11 },
          value: exportMode,
          onChange: (e) => setExportMode(e.target.value),
          title: "Switch export mode"
        },
        /* @__PURE__ */ React.createElement("option", { value: "all" }, "All notes"),
        /* @__PURE__ */ React.createElement("option", { value: "matched_active" }, "Matched active only")
      ), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-medium", style: { color: "var(--ink-muted)" } }, Object.keys(getExportNotes()).length.toLocaleString(), " notes")), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: confirmExport }, "Export JSON (", Object.keys(getExportNotes()).length.toLocaleString(), ")"))
    )
  ) : null;
  if (headless) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, exportReviewModal && ReactDOM.createPortal(exportReviewModal, document.body), reportModal && ReactDOM.createPortal(reportModal, document.body), autoMatchModal && ReactDOM.createPortal(autoMatchModal, document.body));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("input", { ref: inputRef, type: "file", accept: ".json,application/json", className: "hidden", onChange: onImportFile }), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-violet", onClick: onImportClick, title: "Import personal notes JSON" }, "Import Notes"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-amber", onClick: onExport, title: "Review and export notes JSON" }, `Export Notes (${totalNotes.toLocaleString()})`), exportReviewModal && ReactDOM.createPortal(exportReviewModal, document.body), reportModal && ReactDOM.createPortal(reportModal, document.body), autoMatchModal && ReactDOM.createPortal(autoMatchModal, document.body));
}
function NoteReportItem({ entry, onDelete, onArchive, onMatch, accountOptions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.accountLabel || entry.account || "");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const selectedMatchRef = useRef(null);
  const [linkStatus, setLinkStatus] = useState("");
  const noteLabel = entry.notePreview || "(No note text)";
  const account = entry.account || "No matching account in this file";
  const sourceLabel = !entry.matched && entry.accountSource && entry.accountSource !== "row" ? {
    label: "Manual label",
    note: "Saved account",
    id: "Account ID",
    key: "Key",
    unknown: "Unassigned"
  }[entry.accountSource] || "" : "";
  const canAssign = !!onMatch && !entry.matched;
  const canArchive = !!onArchive && !entry.matched;
  useEffect(() => {
    if (!editing) {
      setDraft(entry.accountLabel || entry.account || "");
      setSelectedMatch(null);
      selectedMatchRef.current = null;
      setLinkStatus("");
    }
  }, [entry.accountLabel, entry.account, editing]);
  const matches = useMemo(() => {
    if (!editing || !accountOptions?.length) return [];
    const q = safeString(draft).toLowerCase();
    const filtered = q ? accountOptions.filter((opt) => {
      const hay = [
        opt.account,
        opt.owner,
        opt.fq,
        opt.renewalDate,
        opt.label
      ].map(safeString).join(" ").toLowerCase();
      return hay.includes(q);
    }) : accountOptions;
    return filtered.slice(0, 8);
  }, [editing, draft, accountOptions]);
  const selectedHasNote = !!selectedMatch?.hasNote;
  const resolvedMatch = selectedMatch || selectedMatchRef.current || (matches.length === 1 ? matches[0] : null);
  const resolvedHasNote = !!resolvedMatch?.hasNote;
  const cancelEdit = () => {
    setDraft(entry.accountLabel || entry.account || "");
    setSelectedMatch(null);
    selectedMatchRef.current = null;
    setLinkStatus("");
    setEditing(false);
  };
  const linkMatch = (mode = "replace") => {
    const target = resolvedMatch;
    if (!target) {
      setLinkStatus("Select an account from the list first.");
      return;
    }
    if (!onMatch) {
      setLinkStatus("Linking is unavailable.");
      return;
    }
    setLinkStatus("Linking...");
    try {
      const result = onMatch(entry.key, target.noteKey, mode);
      if (result?.ok) {
        setLinkStatus(result.message || "Linked.");
        setTimeout(() => setLinkStatus(""), 2e3);
        setEditing(false);
      } else {
        setLinkStatus(result?.message || "Link failed.");
      }
    } catch (err) {
      setLinkStatus(`Link failed: ${err?.message || err}`);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "rounded-xl p-2", style: { background: "var(--card-bg)", border: "1px solid var(--border)" } }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm font-semibold truncate", style: { color: "var(--ink)" } }, account), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 dark:text-gray-400 truncate" }, entry.owner ? `${entry.owner} \xB7 ` : "", entry.atr != null ? formatCurrencyUSD(entry.atr) : "No ATR", sourceLabel ? ` \xB7 ${sourceLabel}` : ""), /* @__PURE__ */ React.createElement("div", { className: "text-xs mt-1 text-gray-600 dark:text-gray-300 truncate" }, noteLabel), entry.archived && /* @__PURE__ */ React.createElement("div", { className: "text-[10px] mt-1 text-amber-600 dark:text-amber-300" }, "Archived"), editing && canAssign && /* @__PURE__ */ React.createElement("div", { className: "note-match mt-2 space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "note-match-label text-gray-400 dark:text-gray-500" }, "Match to account"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "note-match-input w-full rounded-md glass-card-surface px-2 py-1",
      placeholder: "Start typing an account name...",
      value: draft,
      onChange: (e) => {
        setDraft(e.target.value);
        setSelectedMatch(null);
      }
    }
  ), matches.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "rounded-md glass-card-surface max-h-36 overflow-auto" }, matches.map((opt) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: opt.noteKey,
      className: `note-match-item w-full text-left px-2 py-1 glass-row ${selectedMatch?.noteKey === opt.noteKey ? "bg-emerald-50 dark:bg-emerald-900/40" : ""}`,
      onClick: () => {
        selectedMatchRef.current = opt;
        setSelectedMatch(opt);
        setDraft(opt.account);
      }
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "note-match-title" }, opt.account), opt.hasNote && /* @__PURE__ */ React.createElement("span", { className: "note-match-badge text-amber-600 dark:text-amber-300" }, "Has note")),
    /* @__PURE__ */ React.createElement("div", { className: "note-match-meta text-gray-500 dark:text-gray-400 truncate" }, opt.owner ? `${opt.owner} \xB7 ` : "", opt.fq ? `${opt.fq} \xB7 ` : "", isFinite(opt.atr) ? formatCurrencyUSD(opt.atr) : "", opt.renewalDate ? ` \xB7 ${opt.renewalDate}` : "")
  ))), resolvedMatch && /* @__PURE__ */ React.createElement("div", { className: "note-match-selected text-gray-500 dark:text-gray-400" }, "Selected: ", resolvedMatch.label), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, resolvedMatch && resolvedHasNote ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-emerald", onClick: () => linkMatch("merge") }, "Merge notes"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-amber", onClick: () => linkMatch("replace") }, "Replace note")) : /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-emerald", disabled: !resolvedMatch, onClick: () => linkMatch("replace") }, "Link account"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-slate", onClick: cancelEdit }, "Cancel")), linkStatus && /* @__PURE__ */ React.createElement("div", { className: "note-match-meta text-gray-500 dark:text-gray-400" }, linkStatus)), /* @__PURE__ */ React.createElement("div", { className: "text-gray-400 mt-1 break-all", style: { fontSize: "10px" } }, "Key: ", entry.key)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1 items-end", style: { minWidth: 72 } }, canAssign && !editing && /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-slate w-full", onClick: () => setEditing(true) }, "Assign"), canArchive && !editing && (entry.archived ? /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-cyan w-full", onClick: () => onArchive?.(entry.key, false) }, "Restore") : /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-amber w-full", onClick: () => onArchive?.(entry.key, true) }, "Archive")), onDelete && /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-rose w-full", onClick: () => onDelete(entry.key), title: "Delete this note from local cache" }, "Delete"))));
}
function NoteReportList({ title, items = [], onDelete, onArchive, onMatch, accountOptions, allowAssign }) {
  const view = items;
  return /* @__PURE__ */ React.createElement("div", { className: "card overflow-hidden flex flex-col min-h-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-slate-800 shrink-0" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold text-sm" }, title), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-500 dark:text-gray-400" }, items.length.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "p-2 overflow-auto min-h-0" }, view.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 dark:text-gray-400 px-1 py-2" }, "None"), view.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5 pb-1" }, view.map((entry) => /* @__PURE__ */ React.createElement(
    NoteReportItem,
    {
      key: entry.key,
      entry,
      onDelete,
      onArchive: allowAssign ? onArchive : null,
      onMatch: allowAssign ? onMatch : null,
      accountOptions: allowAssign ? accountOptions : null
    }
  )))));
}
function ExportButton() {
  const rows = useFilteredRows();
  const { state } = useApp();
  const rowCount = rows.length;
  const onExport = () => {
    if (!rowCount) return;
    const headers = state.headers;
    const csv = [headers.join(",")].concat(rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "renewals_filtered.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: onExport, title: "Export filtered rows to CSV" }, `Export CSV (${rowCount.toLocaleString()})`);
}
function TargetsEditor() {
  const { state, actions } = useApp();
  const hm = state.headerMap;
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const quarters = useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    (state.data || []).forEach((r) => {
      const fq = safeString(r[qKey]);
      if (fq && parseFiscalLabel(fq).fy > 0) set.add(fq);
    });
    return Array.from(set).sort((a, b) => {
      const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [state.data, qKey]);
  const targets = state.targets || {};
  const [drafts, setDrafts] = useState({});
  useEffect(() => {
    const init = {};
    quarters.forEach((q) => {
      const val = targets[q];
      init[q] = val != null && isFinite(val) ? formatCurrencyInput(val) : "";
    });
    setDrafts(init);
  }, [quarters]);
  const handleChange = (q, raw) => setDrafts((prev) => ({ ...prev, [q]: raw }));
  const handleBlur = (q) => {
    const n = toNumber(drafts[q]);
    setDrafts((prev) => ({ ...prev, [q]: isFinite(n) && n > 0 ? formatCurrencyInput(n) : "" }));
    const next = { ...targets };
    if (isFinite(n) && n > 0) {
      next[q] = n;
    } else {
      delete next[q];
    }
    actions.setTargets(next);
  };
  if (!quarters.length) return null;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2" }, "Quarterly Targets (ATR)"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-2" }, quarters.map((q) => /* @__PURE__ */ React.createElement("div", { key: q, className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-medium w-16 shrink-0" }, q), /* @__PURE__ */ React.createElement("div", { className: "relative flex-1" }, /* @__PURE__ */ React.createElement("span", { className: "absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400" }, "$"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "filter-input !py-1 !pl-5 !pr-2 text-xs w-full tabular-nums",
      value: drafts[q] || "",
      onChange: (e) => handleChange(q, e.target.value),
      onBlur: () => handleBlur(q),
      onFocus: () => setDrafts((prev) => ({ ...prev, [q]: String(toNumber(prev[q]) || "").replace(/[^\d.-]/g, "") })),
      placeholder: "0"
    }
  ))))));
}
const PAYOUT_SCHEDULE = [
  { label: "\u2264 80%", lo: 0, hi: 80, payout: 0 },
  { label: ">80% \u2013 85%", lo: 80, hi: 85, payout: 15 },
  { label: ">85% \u2013 90%", lo: 85, hi: 90, payout: 30 },
  { label: ">90% \u2013 92%", lo: 90, hi: 92, payout: 50 },
  { label: ">92% \u2013 94%", lo: 92, hi: 94, payout: 60 },
  { label: ">94% \u2013 95%", lo: 94, hi: 95, payout: 70 },
  { label: ">95% \u2013 98%", lo: 95, hi: 98, payout: 75 },
  { label: ">98% \u2013 99%", lo: 98, hi: 99, payout: 85 },
  { label: ">99% \u2013 <100%", lo: 99, hi: 100, payout: 95 },
  { label: "100%", lo: 100, hi: 100, payout: 100 },
  { label: ">100% \u2013 101%", lo: 100, hi: 101, payout: 110 },
  { label: ">101% \u2013 102%", lo: 101, hi: 102, payout: 115 },
  { label: ">102% \u2013 105%", lo: 102, hi: 105, payout: 120 },
  { label: ">105% \u2013 110%", lo: 105, hi: 110, payout: 125 },
  { label: ">110% \u2013 115%", lo: 110, hi: 115, payout: 130 },
  { label: ">115% \u2013 120%", lo: 115, hi: 120, payout: 135 },
  { label: ">120% \u2013 125%", lo: 120, hi: 125, payout: 140 },
  { label: "> 125%", lo: 125, hi: Infinity, payout: 150 }
];
function getPayoutPct(attain) {
  if (attain == null || !isFinite(attain)) return null;
  if (attain <= 80) return 0;
  if (attain <= 85) return 15;
  if (attain <= 90) return 30;
  if (attain <= 92) return 50;
  if (attain <= 94) return 60;
  if (attain <= 95) return 70;
  if (attain <= 98) return 75;
  if (attain <= 99) return 85;
  if (attain < 100) return 95;
  if (attain <= 100) return 100;
  if (attain <= 101) return 110;
  if (attain <= 102) return 115;
  if (attain <= 105) return 120;
  if (attain <= 110) return 125;
  if (attain <= 115) return 130;
  if (attain <= 120) return 135;
  if (attain <= 125) return 140;
  return 150;
}
function payoutColor(payout) {
  if (payout == null) return "";
  if (payout === 0) return "text-red-500 dark:text-red-400";
  if (payout < 75) return "text-orange-500 dark:text-orange-400";
  if (payout < 100) return "text-amber-600 dark:text-amber-400";
  if (payout === 100) return "text-emerald-600 dark:text-emerald-400";
  return "text-blue-600 dark:text-blue-400";
}
function PayoutDisclosure({ overallAttain }) {
  const [open, setOpen] = useState(false);
  return /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setOpen((p) => !p),
      className: "w-full px-4 py-2.5 border-b flex items-center justify-between hover:bg-white/[0.12] transition-colors cursor-pointer"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "Payout Schedule"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "CSMs & Managers")),
    /* @__PURE__ */ React.createElement("svg", { className: `w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }))
  ), open && /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-1.5 text-left font-semibold" }, "Attainment"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-1.5 text-right font-semibold" }, "Payout"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, PAYOUT_SCHEDULE.map((row, i) => {
    const isActive = overallAttain != null && overallAttain > row.lo && (row.hi === Infinity ? true : overallAttain <= row.hi) && !(row.lo === 99 && overallAttain >= 100) && !(row.lo === 100 && row.hi === 100 && overallAttain !== 100) && !(row.lo === 100 && row.hi !== 100 && overallAttain <= 100);
    return /* @__PURE__ */ React.createElement("tr", { key: i, className: `${isActive ? "bg-indigo-100/70 dark:bg-indigo-900/30 ring-1 ring-inset ring-indigo-300/50 dark:ring-indigo-700/50" : "glass-row"} transition-colors` }, /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1 tabular-nums ${isActive ? "font-bold text-indigo-700 dark:text-indigo-300" : ""}` }, row.label), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1 text-right tabular-nums font-semibold ${isActive ? "text-indigo-700 dark:text-indigo-300" : payoutColor(row.payout)}` }, row.payout, "%"));
  })))));
}
function TargetsTab() {
  const { state, actions } = useApp();
  const rows = useFilteredRows();
  const hm = state.headerMap;
  const atrKey = getAtrKey(hm, state.settings);
  const buKey = getBuKey(hm, state.settings);
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const rateTargets = state.rateTargets || {};
  const HARDCODED_EXPANSION_TARGETS = { "FY27Q1": 5883870, "FY27Q2": 7477756, "FY27Q3": 7277845, "FY27Q4": 6375543 };
  const expansionTargets = { ...state.expansionTargets || {}, ...HARDCODED_EXPANSION_TARGETS };
  const ccData = state.ccData || {};
  const notes = state.notes || {};
  const histData = state.historicalData || [];
  const histHM = state.historicalHeaderMap || {};
  const activeExpKey = hm.EXPANSION || "EXPANSION";
  const histQKey = histHM.FISCAL_QUARTER || histHM.YEAR_QUARTER || "FISCAL_QUARTER";
  const histAtrKey = histHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histCcKey = histHM.CC || "CC";
  const histExpKey = histHM.EXPANSION || "EXPANSION";
  const allQuarters = useMemo(() => {
    const qs = new Set((state.data || []).map((r) => safeString(r[qKey])).filter((q) => q && parseFiscalLabel(q).fy > 0));
    return [...qs].sort((a, b) => {
      const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [state.data, qKey]);
  const bandKey = hm.BAND || "BAND";
  const histBandKey = histHM.BAND || histHM.ATR_BAND || "BAND";
  const isBandOver100K = (r, bk) => {
    const band = safeString(r[bk]).toUpperCase().replace(/[\s$,]/g, "");
    return band.includes("100K+") || band.includes(">100K") || band.includes("100K AND ABOVE") || band === "100K+";
  };
  const buildSegmentedForecast = (filterFn) => {
    const m = /* @__PURE__ */ new Map();
    rows.forEach((r) => {
      if (!isValidRenewal(r, hm, state.settings)) return;
      const q = safeString(r[qKey]);
      if (!q || parseFiscalLabel(q).fy === 0) return;
      const atr = toNumber(r[atrKey]);
      if (atr <= 0) return;
      if (!filterFn(r)) return;
      const bu = toNumber(r[buKey]);
      const exp = toNumber(r[activeExpKey]);
      if (!m.has(q)) m.set(q, { bu: 0, atr: 0, exp: 0, count: 0 });
      const cur = m.get(q);
      cur.bu += bu;
      cur.atr += atr;
      cur.exp += exp;
      cur.count++;
    });
    return m;
  };
  const buildSegmentedDjBlended = (filterFn) => {
    const m = /* @__PURE__ */ new Map();
    rows.forEach((r) => {
      if (!isValidRenewal(r, hm, state.settings)) return;
      const q = safeString(r[qKey]);
      if (!q || parseFiscalLabel(q).fy === 0) return;
      const atr = toNumber(r[atrKey]);
      if (atr <= 0) return;
      if (!filterFn(r)) return;
      const bu = toNumber(r[buKey]);
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const djVal = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
      const useVal = djVal !== null ? djVal : bu;
      if (!m.has(q)) m.set(q, { total: 0, djCount: 0, buCount: 0, count: 0 });
      const cur = m.get(q);
      cur.total += useVal;
      cur.count++;
      if (djVal !== null) cur.djCount++;
      else cur.buCount++;
    });
    return m;
  };
  const buildSegmentedActuals = (filterFn) => {
    if (!histData.length) return /* @__PURE__ */ new Map();
    const m = /* @__PURE__ */ new Map();
    histData.forEach((r) => {
      const q = safeString(r[histQKey]);
      if (!q || !isCurrentOrPastQuarter(q)) return;
      const atr = toNumber(r[histAtrKey]);
      const cc = toNumber(r[histCcKey]);
      const exp = toNumber(r[histExpKey]);
      if (atr <= 0 && cc <= 0 && exp <= 0) return;
      if (!filterFn(r)) return;
      if (!m.has(q)) m.set(q, { cc: 0, atr: 0, exp: 0, count: 0 });
      const cur = m.get(q);
      cur.cc += cc;
      cur.atr += atr;
      cur.exp += exp;
      cur.count++;
    });
    return m;
  };
  const filterOver100K = (r) => isBandOver100K(r, bandKey);
  const filterUnder100K = (r) => !isBandOver100K(r, bandKey);
  const filterAllAccounts = () => true;
  const histFilterOver100K = (r) => isBandOver100K(r, histBandKey);
  const histFilterUnder100K = (r) => !isBandOver100K(r, histBandKey);
  const histFilterAll = () => true;
  const fcOver = useMemo(() => buildSegmentedForecast(filterOver100K), [rows, qKey, atrKey, buKey, activeExpKey, hm, state.settings, bandKey]);
  const fcUnder = useMemo(() => buildSegmentedForecast(filterUnder100K), [rows, qKey, atrKey, buKey, activeExpKey, hm, state.settings, bandKey]);
  const fcAll = useMemo(() => buildSegmentedForecast(filterAllAccounts), [rows, qKey, atrKey, buKey, activeExpKey, hm, state.settings]);
  const djOver = useMemo(() => buildSegmentedDjBlended(filterOver100K), [rows, qKey, atrKey, buKey, hm, state.settings, notes, bandKey]);
  const djUnder = useMemo(() => buildSegmentedDjBlended(filterUnder100K), [rows, qKey, atrKey, buKey, hm, state.settings, notes, bandKey]);
  const djAll = useMemo(() => buildSegmentedDjBlended(filterAllAccounts), [rows, qKey, atrKey, buKey, hm, state.settings, notes]);
  const actOver = useMemo(() => buildSegmentedActuals(histFilterOver100K), [histData, histQKey, histAtrKey, histCcKey, histExpKey, histBandKey]);
  const actUnder = useMemo(() => buildSegmentedActuals(histFilterUnder100K), [histData, histQKey, histAtrKey, histCcKey, histExpKey, histBandKey]);
  const actAll = useMemo(() => buildSegmentedActuals(histFilterAll), [histData, histQKey, histAtrKey, histCcKey, histExpKey]);
  const fmtC = fmtCompactDash;
  const fmtPct = fmtPctValue;
  const actuals = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    rows.forEach((r) => {
      if (!isValidRenewal(r, hm, state.settings)) return;
      const q = safeString(r[qKey]);
      if (!q) return;
      if (!m.has(q)) m.set(q, { atr: 0, bu: 0, count: 0 });
      const cur = m.get(q);
      cur.atr += toNumber(r[atrKey]);
      cur.bu += toNumber(r[buKey]);
      cur.count++;
    });
    return m;
  }, [rows, qKey, atrKey, buKey, hm, state.settings]);
  const histQtrCC = useMemo(() => {
    if (!histData.length) return /* @__PURE__ */ new Map();
    const hqKey = histHM.FISCAL_QUARTER || histHM.YEAR_QUARTER || "FISCAL_QUARTER";
    const hAtrKey = histHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
    const hCcKey = histHM.CC || "CC";
    const m = /* @__PURE__ */ new Map();
    histData.forEach((r) => {
      const q = safeString(r[hqKey]);
      if (!q || !isCurrentOrPastQuarter(q)) return;
      const atr = toNumber(r[hAtrKey]);
      const cc = toNumber(r[hCcKey]);
      if (atr <= 0 && cc <= 0) return;
      if (!m.has(q)) m.set(q, { atr: 0, cc: 0 });
      const cur = m.get(q);
      cur.atr += atr;
      cur.cc += cc;
    });
    return m;
  }, [histData, histHM]);
  const tableRows = useMemo(() => {
    return allQuarters.map((q) => {
      const a = actuals.get(q);
      const h = histQtrCC.get(q);
      const target = rateTargets[q];
      const hasHist = !!h;
      const histCC = h?.cc || 0;
      const buFC = a?.bu || 0;
      const activeAtr = a?.atr || 0;
      const histAtr = h?.atr || 0;
      const atr = histAtr > 0 ? histAtr : activeAtr;
      const expectedCC = histCC + buFC;
      const rate = atr > 0 ? (atr - expectedCC) / atr * 100 : null;
      const gap = rate != null && target != null ? rate - target : null;
      const attain = rate != null && target != null && target > 0 ? rate / target * 100 : null;
      const payout = getPayoutPct(attain);
      const status = gap == null ? target != null && !a ? "no-data" : "pending" : gap >= 0 ? "above" : gap >= -2 ? "near" : "below";
      return { q, target, histCC, buFC, expectedCC, rate, hasHist, gap, attain, payout, status, atr, activeAtr, histAtr, count: a?.count || 0 };
    });
  }, [allQuarters, actuals, histQtrCC, rateTargets]);
  const summary = useMemo(() => {
    const totalAtr = tableRows.reduce((s, r) => s + r.atr, 0);
    const totalBu = tableRows.reduce((s, r) => s + r.buFC, 0);
    const totalHistCC = tableRows.reduce((s, r) => s + r.histCC, 0);
    const totalExpected = tableRows.reduce((s, r) => s + r.expectedCC, 0);
    const overallRate = totalAtr > 0 ? (totalAtr - totalExpected) / totalAtr * 100 : null;
    let wAtr = 0, wTgt = 0;
    tableRows.forEach((r) => {
      const t = rateTargets[r.q];
      if (r.atr > 0 && t != null) {
        wAtr += r.atr;
        wTgt += t * r.atr;
      }
    });
    const wtdTarget = wAtr > 0 ? wTgt / wAtr : null;
    const summaryGap = overallRate != null && wtdTarget != null ? overallRate - wtdTarget : null;
    const overallAttain = overallRate != null && wtdTarget != null && wtdTarget > 0 ? overallRate / wtdTarget * 100 : null;
    const overallPayout = getPayoutPct(overallAttain);
    let totalExp = 0, totalExpTgt = 0;
    allQuarters.forEach((q) => {
      const hist = actAll.get(q);
      const fc = fcAll.get(q);
      totalExp += hist ? hist.exp || 0 : fc?.exp || 0;
      const et = expansionTargets[q];
      if (et != null) totalExpTgt += et;
    });
    const expAttain = totalExpTgt > 0 && totalExp > 0 ? totalExp / totalExpTgt * 100 : null;
    return { totalAtr, totalBu, totalHistCC, totalExpected, overallRate, wtdTarget, summaryGap, overallAttain, overallPayout, totalExp, totalExpTgt, expAttain };
  }, [rateTargets, tableRows, allQuarters, actAll, fcAll, expansionTargets]);
  const hasAnyTarget = Object.keys(rateTargets).length > 0;
  const zeroAtrNotice = useMemo(() => {
    let count = 0, buSum = 0;
    rows.forEach((r) => {
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      if (atr <= 0 && bu !== 0) {
        count++;
        buSum += Math.abs(bu);
      }
    });
    return count > 0 ? { count, buSum } : null;
  }, [rows, atrKey, buKey]);
  const statusBadge = (status) => {
    if (status === "above") return /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-ok" }, "\u2713 Above");
    if (status === "near") return /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-soon" }, "\u2248 Near");
    if (status === "below") return /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-risk" }, "\u2193 Below");
    if (status === "no-data") return /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 text-[9px]" }, "No data");
    return /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 text-[9px]" }, "Pending");
  };
  const exportReportPDF = () => {
    const esc = escapeHtml;
    const fD = fmtCompact;
    const pF = (v, d = 1) => v != null && isFinite(v) ? v.toFixed(d) + "%" : "\u2014";
    const genDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const buildBCRows = (forecast, act, djBl, expTargets) => {
      return allQuarters.map((q) => {
        const fc = forecast.get(q), hist = act.get(q), bl = djBl.get(q), d = ccData[q] || {};
        const actualCC = hist?.cc || 0, buFC = fc?.bu || 0, expCC = actualCC + buFC;
        const qtrAtr = hist ? hist.atr : fc?.atr || 0;
        const expVal = hist ? hist.exp || 0 : fc?.exp || 0;
        const djCallVal = d.dj != null ? d.dj : bl?.total || 0;
        const target = d.regional || 0;
        const vTarget = target > 0 && expCC > 0 ? expCC - target : null;
        const rate = qtrAtr > 0 ? (qtrAtr - expCC) / qtrAtr * 100 : null;
        const rt = rateTargets[q];
        const vRateTarget = rate != null && rt != null ? rate - rt : null;
        const et = expTargets[q];
        const vExpTarget = et != null && expVal > 0 ? expVal - et : null;
        const attain = rate != null && rt != null && rt > 0 ? rate / rt * 100 : null;
        const payout = getPayoutPct(attain);
        return { q, qtrAtr, actualCC, buFC, expCC, djCallVal, target, vTarget, rate, vRateTarget, expVal, vExpTarget, attain, payout };
      });
    };
    const bcTotals = (rows2) => {
      let atr = 0, cc = 0, bu = 0, exp = 0, dj = 0, tgt = 0;
      rows2.forEach((r) => {
        atr += r.qtrAtr;
        cc += r.actualCC;
        bu += r.buFC;
        exp += r.expVal;
        dj += r.djCallVal;
        tgt += r.target;
      });
      const expCC = cc + bu, rate = atr > 0 ? (atr - expCC) / atr * 100 : null;
      let wA = 0, wT = 0;
      rows2.forEach((r) => {
        const t = rateTargets[r.q];
        if (t != null && r.qtrAtr > 0) {
          wA += r.qtrAtr;
          wT += t * r.qtrAtr;
        }
      });
      const wtd = wA > 0 ? wT / wA : null, vR = rate != null && wtd != null ? rate - wtd : null, vT = tgt > 0 && expCC > 0 ? expCC - tgt : null;
      const attain = rate != null && wtd != null && wtd > 0 ? rate / wtd * 100 : null, payout = getPayoutPct(attain);
      return { atr, cc, bu, expCC, exp, dj, tgt, rate, vR, vT, attain, payout };
    };
    const fmtVar = (v, isCurrency) => {
      if (v == null) return "\u2014";
      if (isCurrency) {
        const abs = Math.abs(v);
        const s = abs >= 1e6 ? "$" + (abs / 1e6).toFixed(1) + "M" : abs >= 1e3 ? "$" + Math.round(abs / 1e3) + "K" : "$" + Math.round(abs);
        return (v >= 0 ? "+" : "-") + s.replace(/^[-]?\$/, "$");
      }
      return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    };
    const varColor = (v, invert) => {
      if (v == null) return "#9ca3af";
      const good = invert ? v <= 0 : v >= 0;
      return good ? "#059669" : "#ef4444";
    };
    const rateColor = (v) => v == null ? "#9ca3af" : v >= 90 ? "#059669" : v >= 85 ? "#d97706" : "#ef4444";
    const renderBCTable = (title, subtitle, rows2, tots, showTargets) => {
      showTargets = showTargets !== false;
      let h = '<div class="section"><div class="section-header"><span class="section-title">' + esc(title) + "</span>" + (subtitle ? '<span class="section-sub">' + esc(subtitle) + "</span>" : "") + "</div>";
      h += '<table><thead><tr><th class="l">Quarter</th><th>ATR</th><th>C/C</th><th>BUFC</th><th>Exp C/C</th><th>ELT Call</th><th>Target</th>' + (showTargets ? "<th>v Target</th>" : "") + "<th>RR%</th>" + (showTargets ? "<th>v Target</th>" : "") + "<th>Expansion</th>" + (showTargets ? "<th>v Target</th><th>Attainment</th><th>Payout</th>" : "") + "</tr></thead><tbody>";
      rows2.forEach((r) => {
        h += '<tr><td class="l bold">' + esc(r.q) + "</td>";
        h += "<td>" + (r.qtrAtr > 0 ? fD(r.qtrAtr) : "\u2014") + "</td>";
        h += '<td style="color:' + (r.actualCC > 0 ? "#047857" : "#9ca3af") + '">' + (r.actualCC > 0 ? fD(r.actualCC) : "\u2014") + "</td>";
        h += '<td style="color:' + (r.buFC > 0 ? "#d97706" : "#9ca3af") + '">' + (r.buFC > 0 ? fD(r.buFC) : "\u2014") + "</td>";
        h += '<td class="bold">' + (r.expCC > 0 ? fD(r.expCC) : "\u2014") + "</td>";
        h += '<td style="color:#4f46e5" class="bold">' + fD(r.djCallVal) + "</td>";
        h += '<td style="color:#6b7280">' + (r.target > 0 ? fD(r.target) : "\u2014") + "</td>";
        if (showTargets) h += '<td class="bold" style="color:' + varColor(r.vTarget, true) + '">' + fmtVar(r.vTarget, true) + "</td>";
        h += '<td class="bold" style="color:' + rateColor(r.rate) + '">' + pF(r.rate) + "</td>";
        if (showTargets) h += '<td class="bold" style="color:' + varColor(r.vRateTarget, false) + '">' + fmtVar(r.vRateTarget, false) + "</td>";
        h += '<td style="color:' + (r.expVal > 0 ? "#2563eb" : "#9ca3af") + '">' + (r.expVal > 0 ? fD(r.expVal) : "\u2014") + "</td>";
        if (showTargets) {
          h += '<td class="bold" style="color:' + varColor(r.vExpTarget, false) + '">' + fmtVar(r.vExpTarget, true) + "</td>";
          h += '<td class="bold" style="color:' + rateColor(r.attain) + '">' + (r.attain != null ? r.attain.toFixed(1) + "%" : "\u2014") + "</td>";
          h += '<td class="bold" style="color:' + (r.payout != null ? r.payout >= 100 ? "#059669" : r.payout > 0 ? "#d97706" : "#ef4444" : "#9ca3af") + '">' + (r.payout != null ? r.payout + "%" : "\u2014") + "</td>";
        }
        h += "</tr>";
      });
      h += '<tr class="total-row"><td class="l bold">Total</td>';
      h += '<td class="bold" style="color:#4338ca">' + fD(tots.atr) + "</td>";
      h += '<td class="bold" style="color:#047857">' + (tots.cc > 0 ? fD(tots.cc) : "\u2014") + "</td>";
      h += '<td class="bold" style="color:#d97706">' + fD(tots.bu) + "</td>";
      h += '<td class="bold" style="color:#4338ca">' + fD(tots.expCC) + "</td>";
      h += '<td class="bold" style="color:#4338ca">' + fD(tots.dj) + "</td>";
      h += '<td style="color:#6b7280">' + (tots.tgt > 0 ? fD(tots.tgt) : "\u2014") + "</td>";
      if (showTargets) h += '<td class="bold" style="color:' + varColor(tots.vT, true) + '">' + fmtVar(tots.vT, true) + "</td>";
      h += '<td class="bold" style="color:#4338ca">' + pF(tots.rate) + "</td>";
      if (showTargets) h += '<td class="bold" style="color:' + varColor(tots.vR, false) + '">' + fmtVar(tots.vR, false) + "</td>";
      h += '<td class="bold" style="color:#2563eb">' + (tots.exp > 0 ? fD(tots.exp) : "\u2014") + "</td>";
      if (showTargets) {
        h += '<td class="bold" style="color:#9ca3af">\u2014</td>';
        h += '<td class="bold" style="color:' + rateColor(tots.attain) + '">' + (tots.attain != null ? tots.attain.toFixed(1) + "%" : "\u2014") + "</td>";
        h += '<td class="bold" style="color:' + (tots.payout != null ? tots.payout >= 100 ? "#059669" : "#d97706" : "#9ca3af") + '">' + (tots.payout != null ? tots.payout + "%" : "\u2014") + "</td>";
      }
      h += "</tr>";
      h += "</tbody></table></div>";
      return h;
    };
    const overRows = buildBCRows(fcOver, actOver, djOver, {}), overTots = bcTotals(overRows);
    const underRows = buildBCRows(fcUnder, actUnder, djUnder, {}), underTots = bcTotals(underRows);
    const allRows2 = buildBCRows(fcAll, actAll, djAll, expansionTargets), allTots = bcTotals(allRows2);
    const pyQuarters = ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"];
    const yoySegs = [
      { label: "All Accounts", pyKey: "all", fc: fcAll, act: actAll },
      { label: ">100K Accounts", pyKey: "over", fc: fcOver, act: actOver },
      { label: "<100K Accounts", pyKey: "under", fc: fcUnder, act: actUnder }
    ];
    let yoyHtml = '<div class="section"><div class="section-header"><span class="section-title">YoY Comparison</span><span class="section-sub">FY27 vs FY26 \u2014 C/C and Renewal Rate</span></div>';
    yoySegs.forEach((seg) => {
      const yoyRows = allQuarters.map((q) => {
        const pyQ = getPriorYearQuarter(q);
        const py = pyQ && PRIOR_YEAR_DATA[pyQ] ? PRIOR_YEAR_DATA[pyQ][seg.pyKey] : null;
        const hist = seg.act.get(q);
        const fc = seg.fc.get(q);
        const cyActualCC = hist?.cc || 0, cyBuFC = fc?.bu || 0, cyExpCC = cyActualCC + cyBuFC;
        const cyAtr = hist ? hist.atr : fc?.atr || 0;
        const cyRate = cyAtr > 0 ? (cyAtr - cyExpCC) / cyAtr * 100 : null;
        const pyCC = py?.cc || 0, pyAtr = py?.atr || 0;
        const pyRate = pyAtr > 0 ? (pyAtr - pyCC) / pyAtr * 100 : null;
        const atrDelta = py && cyAtr > 0 ? cyAtr - pyAtr : null;
        const atrDeltaPct = py && pyAtr > 0 && cyAtr > 0 ? (cyAtr - pyAtr) / pyAtr * 100 : null;
        const ccDelta = py && cyExpCC > 0 ? cyExpCC - pyCC : null;
        const rrDelta = cyRate != null && pyRate != null ? cyRate - pyRate : null;
        return { q, pyCC, pyAtr, pyRate, cyExpCC, cyAtr, cyRate, atrDelta, atrDeltaPct, ccDelta, rrDelta };
      });
      const pyTotCC = pyQuarters.reduce((s, q) => s + ((PRIOR_YEAR_DATA[q] || {})[seg.pyKey]?.cc || 0), 0);
      const pyTotAtr = pyQuarters.reduce((s, q) => s + ((PRIOR_YEAR_DATA[q] || {})[seg.pyKey]?.atr || 0), 0);
      const pyTotRate = pyTotAtr > 0 ? (pyTotAtr - pyTotCC) / pyTotAtr * 100 : null;
      const cyTotExpCC = yoyRows.reduce((s, r) => s + r.cyExpCC, 0);
      const cyTotAtr = yoyRows.reduce((s, r) => s + r.cyAtr, 0);
      const cyTotRate = cyTotAtr > 0 ? (cyTotAtr - cyTotExpCC) / cyTotAtr * 100 : null;
      const totAtrDelta = cyTotAtr > 0 ? cyTotAtr - pyTotAtr : null;
      const totAtrDeltaPct = pyTotAtr > 0 && cyTotAtr > 0 ? (cyTotAtr - pyTotAtr) / pyTotAtr * 100 : null;
      const totCCDelta = cyTotExpCC > 0 ? cyTotExpCC - pyTotCC : null;
      const totRRDelta = cyTotRate != null && pyTotRate != null ? cyTotRate - pyTotRate : null;
      const fmtDelta = (v, isCur) => {
        if (v == null) return "\u2014";
        if (isCur) {
          const abs = Math.abs(v);
          const s = abs >= 1e6 ? "$" + (abs / 1e6).toFixed(1) + "M" : abs >= 1e3 ? "$" + Math.round(abs / 1e3) + "K" : "$" + Math.round(abs);
          return (v >= 0 ? "+" : "-") + s.replace(/^[-]?\$/, "$");
        }
        return (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";
      };
      const yVarColor = (v, higher) => v == null ? "#9ca3af" : higher ? "#059669" : "#ef4444";
      yoyHtml += '<div class="sub-header">' + esc(seg.label) + "</div>";
      yoyHtml += '<table><thead><tr><th class="l">Quarter</th><th>PY ATR</th><th>PY C/C</th><th>PY RR%</th><th>CY ATR</th><th>ATR YoY</th><th>ATR YoY%</th><th>CY Exp C/C</th><th>CY RR%</th><th>C/C YoY</th><th>RR YoY</th></tr></thead><tbody>';
      yoyRows.forEach((r) => {
        yoyHtml += '<tr><td class="l bold">' + esc(r.q) + "</td>";
        yoyHtml += '<td style="color:#6b7280">' + (r.pyAtr > 0 ? fD(r.pyAtr) : "\u2014") + "</td>";
        yoyHtml += '<td style="color:#6b7280">' + (r.pyCC > 0 ? fD(r.pyCC) : "\u2014") + "</td>";
        yoyHtml += '<td style="color:#6b7280">' + pF(r.pyRate) + "</td>";
        yoyHtml += "<td>" + (r.cyAtr > 0 ? fD(r.cyAtr) : "\u2014") + "</td>";
        yoyHtml += '<td class="bold" style="color:' + yVarColor(r.atrDelta, r.atrDelta != null && r.atrDelta >= 0) + '">' + fmtDelta(r.atrDelta, true) + "</td>";
        yoyHtml += '<td class="bold" style="color:' + yVarColor(r.atrDeltaPct, r.atrDeltaPct != null && r.atrDeltaPct >= 0) + '">' + (r.atrDeltaPct != null ? (r.atrDeltaPct >= 0 ? "+" : "") + r.atrDeltaPct.toFixed(1) + "%" : "\u2014") + "</td>";
        yoyHtml += "<td>" + (r.cyExpCC > 0 ? fD(r.cyExpCC) : "\u2014") + "</td>";
        yoyHtml += '<td class="bold" style="color:' + rateColor(r.cyRate) + '">' + pF(r.cyRate) + "</td>";
        yoyHtml += '<td class="bold" style="color:' + yVarColor(r.ccDelta, r.ccDelta != null && r.ccDelta <= 0) + '">' + fmtDelta(r.ccDelta, true) + "</td>";
        yoyHtml += '<td class="bold" style="color:' + yVarColor(r.rrDelta, r.rrDelta != null && r.rrDelta >= 0) + '">' + fmtDelta(r.rrDelta, false) + "</td></tr>";
      });
      yoyHtml += '<tr class="total-row"><td class="l bold">Total</td>';
      yoyHtml += '<td class="bold" style="color:#6b7280">' + fD(pyTotAtr) + "</td>";
      yoyHtml += '<td class="bold" style="color:#6b7280">' + fD(pyTotCC) + "</td>";
      yoyHtml += '<td class="bold" style="color:#6b7280">' + pF(pyTotRate) + "</td>";
      yoyHtml += '<td class="bold" style="color:#4338ca">' + fD(cyTotAtr) + "</td>";
      yoyHtml += '<td class="bold" style="color:' + yVarColor(totAtrDelta, totAtrDelta != null && totAtrDelta >= 0) + '">' + fmtDelta(totAtrDelta, true) + "</td>";
      yoyHtml += '<td class="bold" style="color:' + yVarColor(totAtrDeltaPct, totAtrDeltaPct != null && totAtrDeltaPct >= 0) + '">' + (totAtrDeltaPct != null ? (totAtrDeltaPct >= 0 ? "+" : "") + totAtrDeltaPct.toFixed(1) + "%" : "\u2014") + "</td>";
      yoyHtml += '<td class="bold" style="color:#4338ca">' + fD(cyTotExpCC) + "</td>";
      yoyHtml += '<td class="bold" style="color:#4338ca">' + pF(cyTotRate) + "</td>";
      yoyHtml += '<td class="bold" style="color:' + yVarColor(totCCDelta, totCCDelta != null && totCCDelta <= 0) + '">' + fmtDelta(totCCDelta, true) + "</td>";
      yoyHtml += '<td class="bold" style="color:' + yVarColor(totRRDelta, totRRDelta != null && totRRDelta >= 0) + '">' + fmtDelta(totRRDelta, false) + "</td></tr>";
      yoyHtml += "</tbody></table>";
    });
    yoyHtml += "</div>";
    const kpis = [
      { label: "Total ATR", value: fD(summary.totalAtr) },
      { label: "Expected C/C", value: fD(summary.totalExpected) },
      { label: "Renewal Rate", value: pF(summary.overallRate) },
      { label: "vs Target", value: summary.summaryGap != null ? (summary.summaryGap >= 0 ? "+" : "") + summary.summaryGap.toFixed(1) + "%" : "\u2014" },
      { label: "Expansion", value: summary.totalExp > 0 ? fD(summary.totalExp) : "\u2014" }
    ];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Renewals Report</title><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:10px;color:#1e293b;padding:24px 28px;max-width:1200px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:16px;font-weight:700;color:#312e81;margin-bottom:2px}.sub{font-size:9px;color:#64748b;margin-bottom:16px}.kpi-strip{display:flex;gap:12px;margin-bottom:16px}.kpi{flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;background:#f8fafc}.kpi .label{font-size:8px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:600}.kpi .val{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:1px}.section{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:12px}.section-header{padding:8px 12px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#f8fafc}.section-title{font-size:11px;font-weight:600;color:#1e293b}.section-sub{font-size:9px;color:#94a3b8}.sub-header{padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:9px;font-weight:600;color:#475569;background:#fafbfc}table{width:100%;border-collapse:collapse}th{padding:5px 8px;text-align:right;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;background:#f8fafc}td{padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #f1f5f9}th.l,td.l{text-align:left}.bold{font-weight:600}.total-row{background:#eef2ff;border-top:2px solid #c7d2fe}.total-row td{font-weight:700;color:#4338ca}@media print{body{padding:12px 16px}.section{break-inside:avoid}@page{size:landscape;margin:10mm}}</style></head><body><h1>Renewals Report</h1><p class="sub">Generated ` + esc(genDate) + '</p><div class="kpi-strip">' + kpis.map(function(k) {
      return '<div class="kpi"><div class="label">' + esc(k.label) + '</div><div class="val">' + esc(k.value) + "</div></div>";
    }).join("") + "</div>" + renderBCTable(">100K Budget and Calls", "Accounts with ATR > $100K", overRows, overTots, false) + renderBCTable("<100K Budget and Calls", "Accounts with ATR \u2264 $100K", underRows, underTots, false) + renderBCTable("All Accounts Budget and Calls", "", allRows2, allTots, true) + yoyHtml + "</body></html>";
    try {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "Renewals_Report_" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".html";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(function() {
        URL.revokeObjectURL(url);
      }, 1e4);
    } catch (e) {
      alert("Could not generate report: " + e.message);
    }
  };
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [priorYearOpen, setPriorYearOpen] = useState(false);
  const [yoyOpen, setYoyOpen] = useState(true);
  const [ccDrafts, setCcDrafts] = useState({});
  useEffect(() => {
    const init = {};
    allQuarters.forEach((q) => {
      const d = ccData[q] || {};
      const bl = djOver.get(q);
      const fmt = (v) => v != null && isFinite(v) && v > 0 ? (v / 1e6).toFixed(2) : "";
      const djComputed = bl?.total;
      const djEffective = d.dj != null ? d.dj : djComputed;
      init[q] = {
        regional: fmt(d.regional),
        global: fmt(d.global),
        cco: fmt(d.cco),
        rvp: fmt(d.rvp),
        dj: fmt(djEffective)
      };
    });
    setCcDrafts(init);
  }, [allQuarters, djOver]);
  const parseBudgetVal = (raw) => {
    if (!raw || !raw.trim()) return null;
    const s = raw.trim().toUpperCase().replace(/\$|,/g, "");
    const mM = /^([\d.]+)M$/.exec(s);
    if (mM) return Math.round(parseFloat(mM[1]) * 1e6);
    const mK = /^([\d.]+)K$/.exec(s);
    if (mK) return Math.round(parseFloat(mK[1]) * 1e3);
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? Math.round(n * 1e6) : null;
  };
  const saveCcField = (q, field) => {
    const val = parseBudgetVal((ccDrafts[q] || {})[field]);
    const next = { ...ccData, [q]: { ...ccData[q] || {}, [field]: val } };
    if (val === null) delete next[q][field];
    actions.setCcData(next);
  };
  const setCcDraft = (q, field, val) => setCcDrafts((prev) => ({ ...prev, [q]: { ...prev[q] || {}, [field]: val } }));
  const ccFieldConfig = [
    { key: "regional", label: "Regional Budget", hint: "Your region's C/C budget" },
    { key: "cco", label: "CCO Call", hint: "CCO prediction" },
    { key: "rvp", label: "RVP Call", hint: "RVP prediction" },
    { key: "dj", label: "ELT Call", hint: "ELT prediction" }
  ];
  const [rateDrafts, setRateDrafts] = useState({});
  useEffect(() => {
    const init = {};
    allQuarters.forEach((q) => {
      const v = rateTargets[q];
      init[q] = v != null ? String(v) : "";
    });
    setRateDrafts(init);
  }, [allQuarters]);
  const saveRateDraft = (q) => {
    const n = parseFloat(rateDrafts[q]);
    const next = { ...rateTargets };
    if (isFinite(n) && n > 0 && n <= 100) next[q] = Math.round(n * 100) / 100;
    else delete next[q];
    actions.setRateTargets(next);
  };
  const [expDrafts, setExpDrafts] = useState({});
  useEffect(() => {
    const init = {};
    allQuarters.forEach((q) => {
      const v = expansionTargets[q];
      init[q] = v != null ? String(v) : "";
    });
    setExpDrafts(init);
  }, [allQuarters]);
  const saveExpDraft = (q) => {
    const raw = expDrafts[q];
    if (!raw || !raw.trim()) {
      const next2 = { ...expansionTargets };
      delete next2[q];
      actions.setExpansionTargets(next2);
      return;
    }
    const s = raw.trim().toUpperCase().replace(/\$|,/g, "");
    const mM = /^([\d.]+)M$/.exec(s);
    let n;
    if (mM) n = Math.round(parseFloat(mM[1]) * 1e6);
    else {
      const mK = /^([\d.]+)K$/.exec(s);
      if (mK) n = Math.round(parseFloat(mK[1]) * 1e3);
      else n = parseFloat(s);
    }
    const next = { ...expansionTargets };
    if (isFinite(n) && n > 0) next[q] = Math.round(n);
    else delete next[q];
    actions.setExpansionTargets(next);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("div", null), /* @__PURE__ */ React.createElement("button", { onClick: exportReportPDF, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer", title: "Export report as printable HTML (save as PDF)" }, /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), /* @__PURE__ */ React.createElement("polyline", { points: "14 2 14 8 20 8" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "13", x2: "8", y2: "13" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "17", x2: "8", y2: "17" }), /* @__PURE__ */ React.createElement("polyline", { points: "10 9 9 9 8 9" })), "Export Report")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-2" }, [
    { label: "Total ATR", value: fmtC(summary.totalAtr), sub: tableRows.some((r) => r.histAtr > 0) ? `${allQuarters.length} qtr${allQuarters.length !== 1 ? "s" : ""} \xB7 hist. base` : `${allQuarters.length} quarter${allQuarters.length !== 1 ? "s" : ""}` },
    { label: "Expected C/C", value: fmtC(summary.totalExpected), sub: summary.totalHistCC > 0 ? `Actual ${fmtC(summary.totalHistCC)} + FC ${fmtC(summary.totalBu)}` : `BU FC ${fmtC(summary.totalBu)}` },
    { label: "Renewal Rate", value: fmtPct(summary.overallRate), sub: summary.wtdTarget != null ? `Target ${fmtPct(summary.wtdTarget)}` : hasAnyTarget ? void 0 : "Set targets below" },
    summary.summaryGap != null ? { label: "vs Target (gap)", value: (summary.summaryGap >= 0 ? "+" : "") + summary.summaryGap.toFixed(1) + "%", sub: summary.summaryGap >= 0 ? "On track" : "Behind target", accent: summary.summaryGap >= 0 ? "emerald" : "red" } : { label: "vs Target (gap)", value: "\u2014", sub: "Set targets to see gap" },
    summary.totalExp > 0 ? { label: "Expansion", value: fmtC(summary.totalExp), sub: summary.totalExpTgt > 0 ? `Target ${fmtC(summary.totalExpTgt)}` : void 0, accent: summary.expAttain != null && summary.expAttain >= 100 ? "blue" : "amber" } : { label: "Expansion", value: "\u2014", sub: "No expansion data" }
  ].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold leading-tight" }, c.label), /* @__PURE__ */ React.createElement("div", { className: `text-lg font-bold tabular-nums mt-0.5 ${c.accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : c.accent === "red" ? "text-red-500 dark:text-red-400" : c.accent === "blue" ? "text-blue-600 dark:text-blue-400" : c.accent === "amber" ? "text-amber-600 dark:text-amber-400" : ""}` }, c.value), c.sub && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-500 dark:text-gray-400 mt-0.5" }, c.sub)))), zeroAtrNotice && /* @__PURE__ */ React.createElement("div", { className: "rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200/80 dark:ring-amber-800/40 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, zeroAtrNotice.count, " account", zeroAtrNotice.count !== 1 ? "s" : ""), " with ATR = $0 but BU FC totalling ", fmtC(zeroAtrNotice.buSum), " \u2014 excluded from renewal rate calculations."), /* @__PURE__ */ React.createElement(BudgetCallsTable, { title: ">100K Budget and Calls", subtitle: "Accounts with ATR > $100K", forecast: fcOver, actuals: actOver, djBlended: djOver, ccData, rateTargets, expansionTargets: {}, allQuarters, bandFilter: filterOver100K, histBandFilter: histFilterOver100K, segmentLabel: ">100K", showTargets: false }), /* @__PURE__ */ React.createElement(BudgetCallsTable, { title: "<100K Budget and Calls", subtitle: "Accounts with ATR <= $100K", forecast: fcUnder, actuals: actUnder, djBlended: djUnder, ccData, rateTargets, expansionTargets: {}, allQuarters, bandFilter: filterUnder100K, histBandFilter: histFilterUnder100K, segmentLabel: "<100K", showTargets: false }), /* @__PURE__ */ React.createElement(BudgetCallsTable, { title: "All Accounts Budget and Calls", forecast: fcAll, actuals: actAll, djBlended: djAll, ccData, rateTargets, expansionTargets, allQuarters, bandFilter: filterAllAccounts, histBandFilter: histFilterAll, segmentLabel: "All Accounts" }), (() => {
    const pyQuarters = ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"];
    const segments = [
      { label: "All Accounts", pyKey: "all", fc: fcAll, act: actAll },
      { label: ">100K Accounts", pyKey: "over", fc: fcOver, act: actOver },
      { label: "<100K Accounts", pyKey: "under", fc: fcUnder, act: actUnder }
    ];
    const varCls = (v, higher) => {
      if (v == null) return "text-gray-400";
      return higher ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";
    };
    const fmtDelta = (v, isCurrency) => {
      if (v == null) return "\u2014";
      if (isCurrency) {
        const abs = Math.abs(v);
        const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(1)}M` : abs >= 1e3 ? `$${Math.round(abs / 1e3)}K` : `$${Math.round(abs)}`;
        return (v >= 0 ? "+" : "-") + s.replace(/^[-]?\$/, "$");
      }
      return (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";
    };
    return /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setYoyOpen((o) => !o), className: "w-full px-4 py-2.5 border-b flex items-center justify-between hover:bg-white/[0.12] transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "YoY Comparison"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "FY27 vs FY26 \u2014 C/C and Renewal Rate")), /* @__PURE__ */ React.createElement("svg", { className: `w-4 h-4 text-gray-400 transition-transform ${yoyOpen ? "rotate-180" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }))), yoyOpen && /* @__PURE__ */ React.createElement("div", { className: "divide-y divide-white/10" }, segments.map((seg) => {
      const yoyRows = allQuarters.map((q) => {
        const pyQ = getPriorYearQuarter(q);
        const py = pyQ && PRIOR_YEAR_DATA[pyQ] ? PRIOR_YEAR_DATA[pyQ][seg.pyKey] : null;
        const hist = seg.act.get(q);
        const fc = seg.fc.get(q);
        const cyActualCC = hist?.cc || 0;
        const cyBuFC = fc?.bu || 0;
        const cyExpCC = cyActualCC + cyBuFC;
        const cyAtr = hist ? hist.atr : fc?.atr || 0;
        const cyRate = cyAtr > 0 ? (cyAtr - cyExpCC) / cyAtr * 100 : null;
        const pyCC = py?.cc || 0;
        const pyAtr = py?.atr || 0;
        const pyRate = pyAtr > 0 ? (pyAtr - pyCC) / pyAtr * 100 : null;
        const atrDelta = py && cyAtr > 0 ? cyAtr - pyAtr : null;
        const atrDeltaPct = py && pyAtr > 0 && cyAtr > 0 ? (cyAtr - pyAtr) / pyAtr * 100 : null;
        const ccDelta = py && cyExpCC > 0 ? cyExpCC - pyCC : null;
        const rrDelta = cyRate != null && pyRate != null ? cyRate - pyRate : null;
        return { q, pyQ, pyCC, pyAtr, pyRate, cyExpCC, cyAtr, cyRate, atrDelta, atrDeltaPct, ccDelta, rrDelta };
      });
      const pyTotCC = pyQuarters.reduce((s, q) => s + ((PRIOR_YEAR_DATA[q] || {})[seg.pyKey]?.cc || 0), 0);
      const pyTotAtr = pyQuarters.reduce((s, q) => s + ((PRIOR_YEAR_DATA[q] || {})[seg.pyKey]?.atr || 0), 0);
      const pyTotRate = pyTotAtr > 0 ? (pyTotAtr - pyTotCC) / pyTotAtr * 100 : null;
      const cyTotExpCC = yoyRows.reduce((s, r) => s + r.cyExpCC, 0);
      const cyTotAtr = yoyRows.reduce((s, r) => s + r.cyAtr, 0);
      const cyTotRate = cyTotAtr > 0 ? (cyTotAtr - cyTotExpCC) / cyTotAtr * 100 : null;
      const totAtrDelta = cyTotAtr > 0 ? cyTotAtr - pyTotAtr : null;
      const totAtrDeltaPct = pyTotAtr > 0 && cyTotAtr > 0 ? (cyTotAtr - pyTotAtr) / pyTotAtr * 100 : null;
      const totCCDelta = cyTotExpCC > 0 ? cyTotExpCC - pyTotCC : null;
      const totRRDelta = cyTotRate != null && pyTotRate != null ? cyTotRate - pyTotRate : null;
      return /* @__PURE__ */ React.createElement("div", { key: seg.label }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-semibold text-gray-600 dark:text-gray-300" }, seg.label)), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "PY ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "PY C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "PY RR%"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "CY ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR YoY"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR YoY%"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "CY Exp C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "CY RR%"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "C/C YoY"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "RR YoY"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, yoyRows.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.q, className: "glass-row-accent" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200" }, r.q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, r.pyAtr > 0 ? fmtC(r.pyAtr) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, r.pyCC > 0 ? fmtC(r.pyCC) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, fmtPct(r.pyRate)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, r.cyAtr > 0 ? fmtC(r.cyAtr) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.atrDelta, r.atrDelta != null && r.atrDelta >= 0)}` }, fmtDelta(r.atrDelta, true)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.atrDeltaPct, r.atrDeltaPct != null && r.atrDeltaPct >= 0)}` }, r.atrDeltaPct != null ? (r.atrDeltaPct >= 0 ? "+" : "") + r.atrDeltaPct.toFixed(1) + "%" : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, r.cyExpCC > 0 ? fmtC(r.cyExpCC) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.cyRate != null ? r.cyRate >= 90 ? "text-emerald-600 dark:text-emerald-400" : r.cyRate >= 85 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400" : "text-gray-400"}` }, fmtPct(r.cyRate)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.ccDelta, r.ccDelta != null && r.ccDelta <= 0)}` }, fmtDelta(r.ccDelta, true)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.rrDelta, r.rrDelta != null && r.rrDelta >= 0)}` }, fmtDelta(r.rrDelta, false)))), /* @__PURE__ */ React.createElement("tr", { className: "bg-indigo-50/60 dark:bg-indigo-900/15 border-t-2 border-indigo-200/60 dark:border-indigo-700/40" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-bold text-indigo-700 dark:text-indigo-300" }, "Total"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-gray-500" }, fmtC(pyTotAtr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-gray-500" }, fmtC(pyTotCC)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-gray-500" }, fmtPct(pyTotRate)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(cyTotAtr)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totAtrDelta, totAtrDelta != null && totAtrDelta >= 0)}` }, fmtDelta(totAtrDelta, true)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totAtrDeltaPct, totAtrDeltaPct != null && totAtrDeltaPct >= 0)}` }, totAtrDeltaPct != null ? (totAtrDeltaPct >= 0 ? "+" : "") + totAtrDeltaPct.toFixed(1) + "%" : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(cyTotExpCC)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtPct(cyTotRate)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totCCDelta, totCCDelta != null && totCCDelta <= 0)}` }, fmtDelta(totCCDelta, true)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totRRDelta, totRRDelta != null && totRRDelta >= 0)}` }, fmtDelta(totRRDelta, false)))))));
    })));
  })(), /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setTargetsOpen((o) => !o),
      className: "w-full px-4 py-2.5 border-b flex items-center justify-between hover:bg-white/[0.12] transition-colors cursor-pointer"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "Targets"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "Budgets, calls, renewal rate targets, expansion targets")),
    /* @__PURE__ */ React.createElement("svg", { className: `w-4 h-4 text-gray-400 transition-transform ${targetsOpen ? "rotate-180" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }))
  ), targetsOpen && /* @__PURE__ */ React.createElement("div", { className: "divide-y divide-white/10" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-semibold text-gray-600 dark:text-gray-300" }, "Budgets & Calls"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "Values in $M (e.g. 4.7 = $4.7M) \xB7 press Enter or click away to save")), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold w-24" }, "Quarter"), ccFieldConfig.map((f) => /* @__PURE__ */ React.createElement("th", { key: f.key, className: "px-3 py-2 text-left font-semibold", title: f.hint }, f.label)))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, allQuarters.map((q, i) => /* @__PURE__ */ React.createElement("tr", { key: q, className: "" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400" }, q), ccFieldConfig.map((f) => /* @__PURE__ */ React.createElement("td", { key: f.key, className: "px-3 py-1 min-w-[7.5rem]" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      className: "filter-input w-full text-xs tabular-nums",
      value: (ccDrafts[q] || {})[f.key] || "",
      placeholder: "e.g. 4.7",
      onChange: (e) => setCcDraft(q, f.key, e.target.value),
      onBlur: () => saveCcField(q, f.key),
      onKeyDown: (e) => {
        if (e.key === "Enter") saveCcField(q, f.key);
      }
    }
  ))))))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-semibold text-gray-600 dark:text-gray-300" }, "Renewal Rate Targets"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "Enter % target per quarter \xB7 Renewal rate = (ATR - Expected C/C) / ATR")), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold w-24" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Target %"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, allQuarters.map((q, i) => /* @__PURE__ */ React.createElement("tr", { key: q, className: "" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400" }, q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1 min-w-[7.5rem]" }, /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      className: "filter-input w-full pr-6 text-xs tabular-nums",
      value: rateDrafts[q] || "",
      placeholder: "e.g. 82.06",
      onChange: (e) => setRateDrafts((prev) => ({ ...prev, [q]: e.target.value })),
      onBlur: () => saveRateDraft(q),
      onKeyDown: (e) => {
        if (e.key === "Enter") saveRateDraft(q);
      }
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400" }, "%"))))))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-semibold text-gray-600 dark:text-gray-300" }, "Expansion Targets"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "Enter exact dollar amount per quarter (e.g. 50000 or 1.2M)")), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold w-24" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Expansion Target"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, allQuarters.map((q, i) => /* @__PURE__ */ React.createElement("tr", { key: q, className: "" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400" }, q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1 min-w-[7.5rem]" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "decimal",
      className: "filter-input w-full text-xs tabular-nums",
      value: expDrafts[q] || "",
      placeholder: "e.g. 50000",
      onChange: (e) => setExpDrafts((prev) => ({ ...prev, [q]: e.target.value })),
      onBlur: () => saveExpDraft(q),
      onKeyDown: (e) => {
        if (e.key === "Enter") saveExpDraft(q);
      }
    }
  )))))))))), /* @__PURE__ */ React.createElement(PayoutDisclosure, { overallAttain: summary.overallAttain }), (() => {
    const pyQuarters = ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"];
    const segments = [
      { label: "All Accounts", key: "all" },
      { label: ">100K Accounts", key: "over" },
      { label: "<100K Accounts", key: "under" }
    ];
    return /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPriorYearOpen((o) => !o), className: "w-full px-4 py-2.5 border-b flex items-center justify-between hover:bg-white/[0.12] transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "Prior Year Results (FY26)"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "Hard-coded actuals for reference")), /* @__PURE__ */ React.createElement("svg", { className: `w-4 h-4 text-gray-400 transition-transform ${priorYearOpen ? "rotate-180" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }))), priorYearOpen && /* @__PURE__ */ React.createElement("div", { className: "divide-y divide-white/10" }, segments.map((seg) => {
      const segRows = pyQuarters.map((q) => {
        const d = PRIOR_YEAR_DATA[q]?.[seg.key];
        const atr = d?.atr || 0;
        const cc = d?.cc || 0;
        const rate = atr > 0 ? (atr - cc) / atr * 100 : null;
        return { q, atr, cc, rate };
      });
      const totAtr = segRows.reduce((s, r) => s + r.atr, 0);
      const totCC = segRows.reduce((s, r) => s + r.cc, 0);
      const totRate = totAtr > 0 ? (totAtr - totCC) / totAtr * 100 : null;
      return /* @__PURE__ */ React.createElement("div", { key: seg.label }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-semibold text-gray-600 dark:text-gray-300" }, seg.label)), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Renewal Rate"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, segRows.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.q, className: "glass-row-accent" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400" }, r.q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, fmtC(r.atr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, fmtC(r.cc)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.rate != null ? r.rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : r.rate >= 85 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400" : "text-gray-400"}` }, fmtPct(r.rate)))), /* @__PURE__ */ React.createElement("tr", { className: "bg-indigo-50/60 dark:bg-indigo-900/15 border-t-2 border-indigo-200/60 dark:border-indigo-700/40" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-bold text-indigo-700 dark:text-indigo-300" }, "Total"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totAtr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totCC)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtPct(totRate)))))));
    })));
  })());
}
function BudgetCallsTable({ title, subtitle, forecast, actuals, djBlended, ccData, rateTargets, expansionTargets, allQuarters, bandFilter, histBandFilter, segmentLabel, showTargets = true }) {
  const { state } = useApp();
  const fmtC = fmtCompactDash;
  const fmtPct = fmtPctValue;
  const bodyTextCls = showTargets ? "text-[10px]" : "text-[11px]";
  const headTextCls = showTargets ? "text-[9px]" : "text-[10px]";
  const qtrRows = useMemo(() => {
    return allQuarters.map((q) => {
      const fc = forecast.get(q);
      const hist = actuals.get(q);
      const bl = djBlended.get(q);
      const d = ccData[q] || {};
      const actualCC = hist?.cc || 0;
      const buFC = fc?.bu || 0;
      const expCC = actualCC + buFC;
      const qtrAtr = hist ? hist.atr : fc?.atr || 0;
      const expVal = hist ? hist.exp || 0 : fc?.exp || 0;
      const djCallVal = d.dj != null ? d.dj : bl?.total || 0;
      const target = d.regional || 0;
      const vTarget = target > 0 && expCC > 0 ? expCC - target : null;
      const rate = qtrAtr > 0 ? (qtrAtr - expCC) / qtrAtr * 100 : null;
      const rateTarget = rateTargets[q];
      const vRateTarget = rate != null && rateTarget != null ? rate - rateTarget : null;
      const expTarget = expansionTargets[q];
      const vExpTarget = expTarget != null && expVal > 0 ? expVal - expTarget : null;
      const attain = rate != null && rateTarget != null && rateTarget > 0 ? rate / rateTarget * 100 : null;
      const payout = getPayoutPct(attain);
      const expAttain = expTarget != null && expTarget > 0 && expVal > 0 ? expVal / expTarget * 100 : null;
      const expPayout = expAttain != null ? expAttain >= 100 ? "1.5X" : "1X" : null;
      return { q, qtrAtr, actualCC, buFC, expCC, djCallVal, target, vTarget, rate, rateTarget, vRateTarget, expVal, expTarget, vExpTarget, attain, payout, expAttain, expPayout };
    });
  }, [allQuarters, forecast, actuals, djBlended, ccData, rateTargets, expansionTargets]);
  const totals = useMemo(() => {
    let atr = 0, cc = 0, bu = 0, exp = 0, dj = 0, tgt = 0, expTgt = 0;
    qtrRows.forEach((r) => {
      atr += r.qtrAtr;
      cc += r.actualCC;
      bu += r.buFC;
      exp += r.expVal;
      dj += r.djCallVal;
      tgt += r.target;
      expTgt += r.expTarget || 0;
    });
    const expCC = cc + bu;
    const rate = atr > 0 ? (atr - expCC) / atr * 100 : null;
    let wAtr = 0, wTgt = 0;
    qtrRows.forEach((r) => {
      if (r.rateTarget != null && r.qtrAtr > 0) {
        wAtr += r.qtrAtr;
        wTgt += r.rateTarget * r.qtrAtr;
      }
    });
    const wtdRateTarget = wAtr > 0 ? wTgt / wAtr : null;
    const vRateTarget = rate != null && wtdRateTarget != null ? rate - wtdRateTarget : null;
    const vTarget = tgt > 0 && expCC > 0 ? expCC - tgt : null;
    const totalExpTarget = expTgt > 0 ? expTgt : null;
    const vExpTarget = totalExpTarget != null && exp > 0 ? exp - totalExpTarget : null;
    const attain = rate != null && wtdRateTarget != null && wtdRateTarget > 0 ? rate / wtdRateTarget * 100 : null;
    const payout = getPayoutPct(attain);
    const expAttain = totalExpTarget != null && totalExpTarget > 0 && exp > 0 ? exp / totalExpTarget * 100 : null;
    const expPayout = expAttain != null ? expAttain >= 100 ? "1.5X" : "1X" : null;
    return { atr, cc, bu, expCC, exp, dj, tgt, rate, wtdRateTarget, vRateTarget, vTarget, totalExpTarget, vExpTarget, attain, payout, expAttain, expPayout };
  }, [qtrRows]);
  if (allQuarters.length === 0) return null;
  const varCls = (v, invert) => {
    if (v == null) return "text-gray-400";
    const good = invert ? v <= 0 : v >= 0;
    return good ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";
  };
  const fmtVar = (v, isCurrency) => {
    if (v == null) return "\u2014";
    if (isCurrency) {
      const abs = Math.abs(v);
      const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(1)}M` : abs >= 1e3 ? `$${Math.round(abs / 1e3)}K` : `$${Math.round(abs)}`;
      return v >= 0 ? "+" + s : "-" + s.replace("$", "$");
    }
    return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  };
  return /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2.5 border-b flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, title), subtitle && /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, subtitle)), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: `min-w-full ${bodyTextCls}` }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: `glass-thead ${headTextCls} uppercase tracking-wider text-gray-500` }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "BUFC"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Exp C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ELT Call"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Target"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "v Target"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "RR%"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "v Target"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Expansion"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "v Target"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Attainment"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Payout"), showTargets && /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-center font-semibold" }, "Payout Exp"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-center font-semibold" }))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, qtrRows.map((r, i) => {
    const openSummary = () => generateQuarterExecSummary(r.q, state, bandFilter, histBandFilter, segmentLabel);
    return /* @__PURE__ */ React.createElement(
      "tr",
      {
        key: r.q,
        onClick: openSummary,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openSummary();
          }
        },
        tabIndex: 0,
        role: "button",
        "aria-label": `${r.q} executive summary`,
        title: `${r.q} Executive Summary \u2014 click to open`,
        className: "glass-row-accent cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20 focus:outline-none focus:bg-indigo-50/80 dark:focus:bg-indigo-900/30 transition-colors"
      },
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200" }, r.q),
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, r.qtrAtr > 0 ? fmtC(r.qtrAtr) : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums ${r.actualCC > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-gray-400"}` }, r.actualCC > 0 ? fmtC(r.actualCC) : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums ${r.buFC > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}` }, r.buFC > 0 ? fmtC(r.buFC) : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-semibold" }, r.expCC > 0 ? fmtC(r.expCC) : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-indigo-600 dark:text-indigo-400 font-semibold" }, fmtC(r.djCallVal)),
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, r.target > 0 ? fmtC(r.target) : "\u2014"),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.vTarget, true)}` }, fmtVar(r.vTarget, true)),
      /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.rate != null ? r.rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : r.rate >= 85 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400" : "text-gray-400"}` }, fmtPct(r.rate)),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.vRateTarget, false)}` }, fmtVar(r.vRateTarget, false)),
      /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums ${r.expVal > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}` }, r.expVal > 0 ? fmtC(r.expVal) : "\u2014"),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${varCls(r.vExpTarget, false)}` }, fmtVar(r.vExpTarget, true)),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.attain != null ? r.attain >= 100 ? "text-emerald-600 dark:text-emerald-400" : r.attain >= 95 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400" : "text-gray-400"}` }, r.attain != null ? r.attain.toFixed(1) + "%" : "\u2014"),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${payoutColor(r.payout)}` }, r.payout != null ? r.payout + "%" : "\u2014"),
      showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-center tabular-nums font-semibold ${r.expPayout === "1.5X" ? "text-blue-600 dark:text-blue-400" : r.expPayout === "1X" ? "text-gray-600 dark:text-gray-400" : "text-gray-400"}` }, r.expPayout || "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-center" }, /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
        e.stopPropagation();
        openSummary();
      }, className: "p-1 rounded hover:bg-indigo-50/60 dark:hover:bg-indigo-900/30 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors", title: `${r.q} Executive Summary` }, /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), /* @__PURE__ */ React.createElement("polyline", { points: "14 2 14 8 20 8" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "13", x2: "8", y2: "13" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "17", x2: "8", y2: "17" }), /* @__PURE__ */ React.createElement("polyline", { points: "10 9 9 9 8 9" }))))
    );
  }), /* @__PURE__ */ React.createElement("tr", { className: "bg-indigo-50/60 dark:bg-indigo-900/15 border-t-2 border-indigo-200/60 dark:border-indigo-700/40" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-bold text-indigo-700 dark:text-indigo-300" }, "Total"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totals.atr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400" }, totals.cc > 0 ? fmtC(totals.cc) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-amber-600 dark:text-amber-400" }, fmtC(totals.bu)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totals.expCC)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totals.dj)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, totals.tgt > 0 ? fmtC(totals.tgt) : "\u2014"), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totals.vTarget, true)}` }, fmtVar(totals.vTarget, true)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300` }, fmtPct(totals.rate)), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totals.vRateTarget, false)}` }, fmtVar(totals.vRateTarget, false)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-blue-600 dark:text-blue-400" }, totals.exp > 0 ? fmtC(totals.exp) : "\u2014"), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${varCls(totals.vExpTarget, false)}` }, fmtVar(totals.vExpTarget, true)), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${totals.attain != null ? totals.attain >= 100 ? "text-emerald-600 dark:text-emerald-400" : totals.attain >= 95 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400" : "text-gray-400"}` }, totals.attain != null ? totals.attain.toFixed(1) + "%" : "\u2014"), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${payoutColor(totals.payout)}` }, totals.payout != null ? totals.payout + "%" : "\u2014"), showTargets && /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-center tabular-nums font-bold ${totals.expPayout === "1.5X" ? "text-blue-600 dark:text-blue-400" : totals.expPayout === "1X" ? "text-gray-600 dark:text-gray-400" : "text-gray-400"}` }, totals.expPayout || "\u2014"), /* @__PURE__ */ React.createElement("td", null))))));
}
function FullPictureSection({ activeRows, activeQuarters, activeAtrKey, activeBuKey, activeQKey }) {
  const { state } = useApp();
  const histData = state.historicalData || [];
  const histHM = state.historicalHeaderMap || {};
  const rateTargets = state.rateTargets || {};
  const hasHist = histData.length > 0;
  const histQKey = histHM.FISCAL_QUARTER || histHM.YEAR_QUARTER || "FISCAL_QUARTER";
  const histAtrKey = histHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histCcKey = histHM.CC || "CC";
  const histBuKey = histHM.BU_FC || "BU_FC";
  const hm = state.headerMap;
  const histQtrStats = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    histData.forEach((r) => {
      const q = safeString(r[histQKey]);
      if (!q || !isCurrentOrPastQuarter(q)) return;
      const atr = toNumber(r[histAtrKey]);
      const cc = toNumber(r[histCcKey]);
      if (atr <= 0 && cc <= 0) return;
      if (!m.has(q)) m.set(q, { atr: 0, cc: 0, bu: 0, count: 0 });
      const s = m.get(q);
      s.atr += atr;
      s.cc += cc;
      s.bu += toNumber(r[histBuKey]);
      s.count++;
    });
    return m;
  }, [histData, histQKey, histAtrKey, histCcKey, histBuKey]);
  const activeQtrStats = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    activeRows.forEach((r) => {
      if (!isValidRenewal(r, hm, state.settings)) return;
      const q = safeString(r[activeQKey]);
      if (!q || parseFiscalLabel(q).fy === 0) return;
      if (!m.has(q)) m.set(q, { atr: 0, bu: 0, count: 0 });
      const s = m.get(q);
      s.atr += toNumber(r[activeAtrKey]);
      s.bu += toNumber(r[activeBuKey]);
      s.count++;
    });
    return m;
  }, [activeRows, activeQKey, activeAtrKey, activeBuKey, hm, state.settings]);
  const allQtrs = useMemo(() => {
    const set = /* @__PURE__ */ new Set([...histQtrStats.keys(), ...activeQtrStats.keys()]);
    return [...set].sort((a, b) => {
      const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [histQtrStats, activeQtrStats]);
  const combinedRows = useMemo(() => {
    return allQtrs.map((q) => {
      const h = histQtrStats.get(q);
      const a = activeQtrStats.get(q);
      const hasH = !!h;
      const hasA = !!a;
      const atr = hasH ? h.atr : a?.atr || 0;
      const cc = hasH ? h.cc : 0;
      const bu = hasA ? a.bu : 0;
      const loss = hasH ? cc + bu : bu;
      const count = hasH ? h.count : a?.count || 0;
      const rate = atr > 0 ? (atr - loss) / atr * 100 : null;
      const source = hasH && hasA ? "blended" : hasH ? "historical" : "projected";
      const target = rateTargets[q];
      const attain = rate != null && target != null && target > 0 ? rate / target * 100 : null;
      const payout = getPayoutPct(attain);
      const gap = rate != null && target != null ? rate - target : null;
      return { q, source, atr, cc, bu, loss, count, rate, target, attain, payout, gap };
    });
  }, [allQtrs, histQtrStats, activeQtrStats, rateTargets]);
  const totals = useMemo(() => {
    let atr = 0, totalLoss = 0, histCount = 0, projCount = 0, blendedCount = 0;
    combinedRows.forEach((r) => {
      atr += r.atr;
      totalLoss += r.loss;
      if (r.source === "historical") histCount++;
      else if (r.source === "blended") blendedCount++;
      else projCount++;
    });
    const rate = atr > 0 ? (atr - totalLoss) / atr * 100 : null;
    let wAtr = 0, wTgt = 0;
    combinedRows.forEach((r) => {
      const t = rateTargets[r.q];
      if (t != null && r.atr > 0) {
        wAtr += r.atr;
        wTgt += t * r.atr;
      }
    });
    const wtdTarget = wAtr > 0 ? wTgt / wAtr : null;
    const overallAttain = rate != null && wtdTarget != null && wtdTarget > 0 ? rate / wtdTarget * 100 : null;
    const overallPayout = getPayoutPct(overallAttain);
    const overallGap = rate != null && wtdTarget != null ? rate - wtdTarget : null;
    return { atr, rate, wtdTarget, overallAttain, overallPayout, overallGap, histCount, projCount, blendedCount, totalLoss };
  }, [combinedRows, rateTargets]);
  const fmtC = fmtCompactDash;
  const fmtPct = fmtPctValue;
  if (!hasHist && allQtrs.length <= activeQuarters.length) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 pt-2" }, /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-gray-200 dark:bg-gray-700" }), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-2" }, "Full Year Picture"), /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-gray-200 dark:bg-gray-700" })), !hasHist ? /* @__PURE__ */ React.createElement("div", { className: "card p-4 text-center" }, /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Upload historical data during import to see the full-year combined view here.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-2" }, [
    { label: "Total ATR", value: fmtC(totals.atr), sub: [totals.histCount && `${totals.histCount} actual`, totals.blendedCount && `${totals.blendedCount} blended`, totals.projCount && `${totals.projCount} projected`].filter(Boolean).join(" + ") },
    { label: "Blended Renewal Rate", value: fmtPct(totals.rate), sub: totals.wtdTarget != null ? `Target ${fmtPct(totals.wtdTarget)}` : void 0, accent: totals.rate != null ? totals.rate >= 90 ? "emerald" : "amber" : void 0 },
    totals.overallGap != null ? { label: "vs Target", value: (totals.overallGap >= 0 ? "+" : "") + totals.overallGap.toFixed(1) + "%", sub: totals.overallGap >= 0 ? "On track" : "Behind", accent: totals.overallGap >= 0 ? "emerald" : "red" } : { label: "vs Target", value: "\u2014", sub: "Set targets to see" },
    { label: "Attainment", value: fmtPct(totals.overallAttain), accent: totals.overallAttain != null ? totals.overallAttain >= 100 ? "emerald" : totals.overallAttain >= 90 ? "amber" : "red" : void 0 },
    { label: "Payout", value: totals.overallPayout != null ? totals.overallPayout + "%" : "\u2014", accent: totals.overallPayout != null ? totals.overallPayout >= 100 ? "blue" : totals.overallPayout > 0 ? "amber" : "red" : void 0 }
  ].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi px-3 py-2" }, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold" }, c.label), /* @__PURE__ */ React.createElement("div", { className: `text-lg font-bold tabular-nums mt-0.5 ${c.accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : c.accent === "red" ? "text-red-500 dark:text-red-400" : c.accent === "blue" ? "text-blue-600 dark:text-blue-400" : c.accent === "amber" ? "text-amber-600 dark:text-amber-400" : ""}` }, c.value), c.sub && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-500 dark:text-gray-400 mt-0.5" }, c.sub)))), /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2.5 border-b border-gray-100 dark:border-gray-800" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "Combined Quarter Performance"), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400 ml-2" }, "Blended = hist. CC + active BU FC \xB7 Historical = CC only \xB7 Projected = BU FC only")), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-gray-500" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Source"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Actual CC"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "BU FC"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Expected C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Renewal Rate"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Target"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Attainment"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Payout"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-gray-100 dark:divide-gray-800/60" }, combinedRows.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: r.q, className: "glass-row-accent" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200" }, r.q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5" }, r.source === "historical" ? /* @__PURE__ */ React.createElement("span", { className: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }, "Actual") : r.source === "blended" ? /* @__PURE__ */ React.createElement("span", { className: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" }, "Blended") : /* @__PURE__ */ React.createElement("span", { className: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }, "Projected")), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, fmtC(r.atr)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums ${r.cc > 0 ? "text-red-500" : "text-gray-400"}` }, r.cc > 0 ? fmtC(r.cc) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums ${r.bu > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}` }, r.bu > 0 ? fmtC(r.bu) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-semibold" }, r.loss > 0 ? fmtC(r.loss) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.rate != null ? r.rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" : "text-gray-400"}` }, r.rate != null ? (r.source !== "historical" ? "~" : "") + fmtPct(r.rate) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, fmtPct(r.target)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${r.attain == null ? "text-gray-400" : r.attain >= 100 ? "text-emerald-600 dark:text-emerald-400" : r.attain >= 90 ? "text-amber-600" : "text-red-500"}` }, r.attain != null ? r.attain.toFixed(1) + "%" : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${payoutColor(r.payout)}` }, r.payout != null ? r.payout + "%" : "\u2014"))), /* @__PURE__ */ React.createElement("tr", { className: "bg-indigo-50/60 dark:bg-indigo-900/15 border-t-2 border-indigo-200/60 dark:border-indigo-700/40" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-bold text-indigo-700 dark:text-indigo-300" }, "Overall"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5" }, /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-indigo-500" }, [totals.histCount && `${totals.histCount}A`, totals.blendedCount && `${totals.blendedCount}B`, totals.projCount && `${totals.projCount}P`].filter(Boolean).join("+"))), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300" }, fmtC(totals.atr)), /* @__PURE__ */ React.createElement("td", { colSpan: "3", className: "px-3 py-1.5 text-right tabular-nums font-bold text-indigo-500" }, fmtC(totals.totalLoss), " expected"), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${totals.rate != null ? totals.rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600" : "text-gray-400"}` }, fmtPct(totals.rate)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-indigo-500" }, fmtPct(totals.wtdTarget)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${totals.overallAttain == null ? "text-gray-400" : totals.overallAttain >= 100 ? "text-emerald-600" : "text-amber-600"}` }, fmtPct(totals.overallAttain)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${payoutColor(totals.overallPayout)}` }, totals.overallPayout != null ? totals.overallPayout + "%" : "\u2014"))))))));
}
function HistoricalTab() {
  const { state } = useApp();
  const histData = state.historicalData || [];
  const hm = state.historicalHeaderMap || {};
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "FISCAL_QUARTER";
  const atrKey = hm.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const buKey = hm.BU_FC || "BU_FC";
  const ccKey = hm.CC || "CC";
  const ccOffKey = hm.CC_OFFCYCLE || "CC_OFFCYCLE_ARR";
  const expKey = hm.EXPANSION || "EXPANSION";
  const doneKey = hm.DONE_DEAL || "DONE_DEAL";
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const acctIdKey = hm.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const csManagerKey = hm.MANAGER_SUCCESS || "MANAGER_SUCCESS";
  const segKey = hm.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const partnerKey = hm.PARTNER || "PARTNER_NAME";
  const subregionKey = hm.SUBREGION || "PRO_FORMA_SUBREGION";
  const [selectedFQ, setSelectedFQ] = useState(null);
  const [selectedBand, setSelectedBand] = useState("all");
  const [selectedSubregion, setSelectedSubregion] = useState("__ALL_SUB__");
  const [selectedCsManager, setSelectedCsManager] = useState("__ALL_CSM__");
  const [detailSort, setDetailSort] = useState({ key: "atr", dir: "desc" });
  const [detailLimit, setDetailLimit] = useState(50);
  const [bandOpen, setBandOpen] = useState(false);
  const [subregionOpen, setSubregionOpen] = useState(false);
  const [csManagerOpen, setCsManagerOpen] = useState(false);
  const currentFiscal = useMemo(() => getCurrentFiscal(), []);
  const isHistoricalQuarter = isCurrentOrPastQuarter;
  const bandKey = hm.BAND || "BAND";
  const flag3kKey = hm.FLAG_TOP3K || "FLAG_3K";
  const matchesBandHist = (r, band) => matchesBand(r, band, atrKey, segKey, flag3kKey, bandKey);
  const allQuarters = useMemo(() => {
    const qs = new Set(histData.map((r) => safeString(r[qKey])).filter((q) => q && parseFiscalLabel(q).fy > 0 && isHistoricalQuarter(q)));
    return [...qs].sort((a, b) => {
      const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [histData, qKey]);
  const qtrStats = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    histData.forEach((r) => {
      const q = safeString(r[qKey]);
      if (!q || parseFiscalLabel(q).fy === 0 || !isHistoricalQuarter(q)) return;
      const atr = toNumber(r[atrKey]);
      const cc = toNumber(r[ccKey]);
      const exp = toNumber(r[expKey]);
      if (atr <= 0 && cc <= 0 && exp <= 0) return;
      if (selectedBand && selectedBand !== "all" && !matchesBandHist(r, selectedBand)) return;
      if (selectedSubregion && selectedSubregion !== "__ALL_SUB__" && safeString(r[subregionKey]) !== selectedSubregion) return;
      if (selectedCsManager && selectedCsManager !== "__ALL_CSM__" && safeString(r[csManagerKey]) !== selectedCsManager) return;
      if (!m.has(q)) m.set(q, { fq: q, atr: 0, bu: 0, cc: 0, ccOff: 0, exp: 0, count: 0, done: 0, open: 0 });
      const s = m.get(q);
      s.atr += atr;
      s.bu += toNumber(r[buKey]);
      s.cc += cc;
      s.ccOff += toNumber(r[ccOffKey]);
      s.exp += exp;
      s.count++;
      const d = safeString(r[doneKey]).toUpperCase();
      if (d === "TRUE") s.done++;
      else s.open++;
    });
    return m;
  }, [histData, qKey, atrKey, buKey, ccKey, ccOffKey, expKey, doneKey, selectedBand, selectedSubregion, subregionKey, selectedCsManager, csManagerKey]);
  const rowsView = useMemo(
    () => allQuarters.map((q) => qtrStats.get(q)).filter(Boolean),
    [allQuarters, qtrStats]
  );
  useEffect(() => {
    if (!selectedFQ && rowsView.length) {
      setSelectedFQ(rowsView[rowsView.length - 1].fq);
    }
    setDetailLimit(50);
  }, [rowsView.length, selectedFQ]);
  const focusRows = useMemo(() => {
    let pool = histData.filter((r) => {
      const q = safeString(r[qKey]);
      if (!q || parseFiscalLabel(q).fy === 0 || !isHistoricalQuarter(q)) return false;
      if (toNumber(r[atrKey]) <= 0 && toNumber(r[ccKey]) <= 0 && toNumber(r[expKey]) <= 0) return false;
      if (selectedFQ && selectedFQ !== "__ALL__" && q !== selectedFQ) return false;
      return true;
    });
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBandHist(r, selectedBand));
    if (selectedSubregion && selectedSubregion !== "__ALL_SUB__") pool = pool.filter((r) => safeString(r[subregionKey]) === selectedSubregion);
    if (selectedCsManager && selectedCsManager !== "__ALL_CSM__") pool = pool.filter((r) => safeString(r[csManagerKey]) === selectedCsManager);
    return pool;
  }, [histData, qKey, atrKey, selectedFQ, selectedBand, selectedSubregion, subregionKey, segKey, selectedCsManager, csManagerKey]);
  const quarterPool = useMemo(() => {
    if (!selectedFQ) return [];
    return histData.filter((r) => {
      const fq = safeString(r[qKey]);
      if (selectedFQ !== "__ALL__" && fq !== selectedFQ) return false;
      if (toNumber(r[atrKey]) <= 0 && toNumber(r[ccKey]) <= 0 && toNumber(r[expKey]) <= 0 || parseFiscalLabel(fq).fy === 0 || !isHistoricalQuarter(fq)) return false;
      if (selectedSubregion && selectedSubregion !== "__ALL_SUB__" && safeString(r[subregionKey]) !== selectedSubregion) return false;
      if (selectedCsManager && selectedCsManager !== "__ALL_CSM__" && safeString(r[csManagerKey]) !== selectedCsManager) return false;
      return true;
    });
  }, [histData, selectedFQ, qKey, atrKey, selectedSubregion, subregionKey, selectedCsManager, csManagerKey]);
  const bandRows = useMemo(() => {
    return BAND_OPTIONS.map((opt) => {
      const filtered = quarterPool.filter((r) => matchesBandHist(r, opt.value));
      const atr = filtered.reduce((s, r) => s + toNumber(r[atrKey]), 0);
      return { ...opt, accounts: filtered.length, atr };
    });
  }, [quarterPool, atrKey]);
  const subregionRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const sub = safeString(r[subregionKey]) || "(Unknown)";
      const atr = toNumber(r[atrKey]);
      const acct = safeString(r[acctIdKey]) || safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const entry = map.get(sub) || { sub, atr: 0, accountSet: /* @__PURE__ */ new Set() };
      entry.atr += atr;
      entry.accountSet.add(acct);
      map.set(sub, entry);
    });
    return Array.from(map.values()).map((x) => ({ sub: x.sub, label: x.sub, atr: x.atr, count: x.accountSet.size })).sort((a, b) => b.atr - a.atr);
  }, [focusRows, subregionKey, atrKey, acctIdKey, acctKey]);
  const csManagerPool = useMemo(() => {
    let pool = histData.filter((r) => {
      const q = safeString(r[qKey]);
      if (!q || parseFiscalLabel(q).fy === 0 || !isHistoricalQuarter(q)) return false;
      if (toNumber(r[atrKey]) <= 0 && toNumber(r[ccKey]) <= 0 && toNumber(r[expKey]) <= 0) return false;
      if (selectedFQ && selectedFQ !== "__ALL__" && q !== selectedFQ) return false;
      return true;
    });
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBandHist(r, selectedBand));
    if (selectedSubregion && selectedSubregion !== "__ALL_SUB__") pool = pool.filter((r) => safeString(r[subregionKey]) === selectedSubregion);
    return pool;
  }, [histData, qKey, atrKey, ccKey, expKey, selectedFQ, selectedBand, selectedSubregion, subregionKey, segKey]);
  const csManagerRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    csManagerPool.forEach((r) => {
      const mgr = safeString(r[csManagerKey]) || "(Unknown)";
      const atr = toNumber(r[atrKey]);
      const acct = safeString(r[acctIdKey]) || safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const entry = map.get(mgr) || { owner: mgr, atr: 0, accountSet: /* @__PURE__ */ new Set() };
      entry.atr += atr;
      entry.accountSet.add(acct);
      map.set(mgr, entry);
    });
    return Array.from(map.values()).map((x) => ({ owner: x.owner, atr: x.atr, count: x.accountSet.size })).sort((a, b) => b.atr - a.atr);
  }, [csManagerPool, csManagerKey, atrKey, acctIdKey, acctKey]);
  const healthDist = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const h = safeString(r[healthKey]).toLowerCase() || "unknown";
      map.set(h, (map.get(h) || 0) + 1);
    });
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: HEALTH_COLORS[k] || "#94a3b8" })).sort((a, b) => b.value - a.value);
  }, [focusRows, healthKey]);
  const segDist = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const s = safeString(r[segKey]) || "(Blank)";
      map.set(s, (map.get(s) || 0) + 1);
    });
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, label: k, value: v, color: SEGMENT_COLORS[k.toLowerCase()] || "#94a3b8" })).sort((a, b) => b.value - a.value);
  }, [focusRows, segKey]);
  const sortedRows = useMemo(() => {
    const mapped = focusRows.map((r) => ({
      r,
      account: safeString(r[acctKey]) || "(Unnamed)",
      owner: safeString(r[ownerKey]),
      partner: safeString(r[partnerKey]),
      date: safeString(r[dateKey]),
      atr: toNumber(r[atrKey]),
      cc: toNumber(r[ccKey]),
      exp: toNumber(r[expKey]),
      buFc: toNumber(r[buKey]),
      health: safeString(r[healthKey]),
      done: safeString(r[doneKey]),
      segment: safeString(r[segKey])
    }));
    const dir = detailSort.dir === "asc" ? 1 : -1;
    return [...mapped].sort((a, b) => {
      switch (detailSort.key) {
        case "account":
          return dir * a.account.localeCompare(b.account);
        case "date":
          return dir * ((Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
        case "owner":
          return dir * a.owner.localeCompare(b.owner);
        case "atr":
          return dir * (a.atr - b.atr);
        case "cc":
          return dir * (a.cc - b.cc);
        case "exp":
          return dir * (a.exp - b.exp);
        case "health":
          return dir * a.health.localeCompare(b.health);
        case "partner":
          return dir * a.partner.localeCompare(b.partner);
        default:
          return 0;
      }
    });
  }, [focusRows, detailSort, atrKey, buKey, ccKey, expKey, acctKey, ownerKey, partnerKey, dateKey, healthKey, segKey]);
  const totalStats = useMemo(() => {
    let atr = 0, cc = 0, exp = 0, ccOff = 0, bu = 0, count = 0;
    const src = selectedFQ && selectedFQ !== "__ALL__" ? qtrStats.has(selectedFQ) ? [qtrStats.get(selectedFQ)] : [] : Array.from(qtrStats.values());
    src.forEach((s) => {
      atr += s.atr;
      cc += s.cc;
      exp += s.exp;
      ccOff += s.ccOff;
      bu += s.bu;
      count += s.count;
    });
    const rate = atr > 0 ? (atr - cc) / atr * 100 : null;
    return { atr, cc, exp, ccOff, bu, count, rate };
  }, [qtrStats, selectedFQ]);
  const fmtC = fmtCompactDash;
  const fmtPct = fmtPctValue;
  const hBadge = (h) => {
    const sev = classifyHealth(h);
    const c = sev === "green" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : sev === "amber" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : sev === "red" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    return /* @__PURE__ */ React.createElement("span", { className: `inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${c}` }, h || "\u2014");
  };
  const doneBadge = (v) => {
    const d = safeString(v).toUpperCase();
    if (d === "TRUE") return /* @__PURE__ */ React.createElement("span", { className: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }, "Done");
    if (d === "FALSE") return /* @__PURE__ */ React.createElement("span", { className: "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }, "Open");
    return /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-400" }, "\u2014");
  };
  const toggleSort = (key) => setDetailSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  const sortIcon = (key) => detailSort.key === key ? detailSort.dir === "desc" ? "\u2193" : "\u2191" : "";
  if (!histData.length) return /* @__PURE__ */ React.createElement("div", { className: "text-center py-20" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm text-gray-500 dark:text-gray-400" }, "No historical data loaded."), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1" }, "Upload a historical CSV during the import flow to see closed quarter outcomes here."));
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3 -mx-4 -mt-2 px-4 pt-2 pb-4 rounded-lg min-h-[80vh]" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-2" }, [
    { label: "Total ATR", value: fmtC(totalStats.atr), sub: `${totalStats.count.toLocaleString()} renewals` },
    { label: "Actual C/C", value: fmtC(totalStats.cc), sub: totalStats.atr > 0 ? `${(totalStats.cc / totalStats.atr * 100).toFixed(1)}% of ATR` : void 0, accent: "red" },
    { label: "Renewal Rate", value: fmtPct(totalStats.rate), sub: "(ATR \u2212 CC) \xF7 ATR", accent: totalStats.rate != null ? totalStats.rate >= 90 ? "emerald" : "amber" : void 0 },
    { label: "Expansion", value: fmtC(totalStats.exp), sub: totalStats.atr > 0 ? `${(totalStats.exp / totalStats.atr * 100).toFixed(1)}% of ATR` : void 0, accent: "blue" },
    { label: "BU Forecast", value: fmtC(totalStats.bu), sub: totalStats.atr > 0 ? `C/C ${(totalStats.bu / totalStats.atr * 100).toFixed(1)}%` : void 0 }
  ].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-blue-400 dark:text-blue-300/60 font-semibold" }, c.label), /* @__PURE__ */ React.createElement("div", { className: `text-lg font-bold tabular-nums mt-0.5 ${c.accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : c.accent === "red" ? "text-red-500 dark:text-red-400" : c.accent === "blue" ? "text-blue-600 dark:text-blue-400" : c.accent === "amber" ? "text-amber-600 dark:text-amber-400" : ""}` }, c.value), c.sub && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-500 dark:text-gray-400 mt-0.5" }, c.sub)))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "w-56 shrink-0 hidden xl:block" }, /* @__PURE__ */ React.createElement("div", { className: "sticky top-4" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-3 max-h-[calc(100vh-180px)] overflow-auto py-0.5" }, /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider mb-1" }, "Historical Quarters"), rowsView.map((r) => {
    const active = r.fq === selectedFQ;
    const rate = r.atr > 0 ? (r.atr - r.cc) / r.atr * 100 : null;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: r.fq,
        onClick: () => React.startTransition(() => {
          setSelectedFQ(active ? null : r.fq);
          setSelectedBand("all");
          setSelectedSubregion("__ALL_SUB__");
          setSelectedCsManager("__ALL_CSM__");
          setDetailLimit(50);
        }),
        className: [
          "w-full text-left rounded-lg px-2.5 py-1.5 transition border",
          active ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30" : "border-transparent bg-white/[0.15]"
        ].join(" ")
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-xs truncate" }, r.fq), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, r.count.toLocaleString())),
      /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, fmtC(r.atr), " \xB7 ", fmtC(r.cc), " CC"),
      rate != null && /* @__PURE__ */ React.createElement("div", { className: "mt-1" }, /* @__PURE__ */ React.createElement("div", { className: "h-1.5 rounded-full glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: `h-full rounded-full transition-all duration-300 ${rate >= 95 ? "bg-emerald-400" : rate >= 90 ? "bg-amber-400" : "bg-red-400"}`, style: { width: `${Math.min(rate, 100).toFixed(0)}%` } })), /* @__PURE__ */ React.createElement("div", { className: `text-[9px] mt-0.5 tabular-nums ${rate >= 95 ? "text-emerald-600 dark:text-emerald-400" : rate >= 90 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400"}` }, fmtPct(rate), " renewal rate")),
      !active && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-blue-400 mt-0.5" }, "Click to drill in \u2192")
    );
  }), rowsView.length > 1 && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => {
        setSelectedFQ("__ALL__");
        setSelectedBand("all");
        setSelectedSubregion("__ALL_SUB__");
        setSelectedCsManager("__ALL_CSM__");
      }),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs font-semibold",
        selectedFQ === "__ALL__" ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" : "border-transparent bg-white/[0.15] text-gray-600 dark:text-gray-400"
      ].join(" ")
    },
    "All Quarters"
  )), selectedFQ && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5 space-y-1" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setBandOpen((p) => !p), className: "flex items-center gap-1 text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider mb-1 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300 transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: `inline-block transition-transform duration-150 ${bandOpen ? "rotate-0" : "-rotate-90"}` }, "\u25BC"), "Bands", selectedBand !== "all" && /* @__PURE__ */ React.createElement("span", { className: "normal-case tracking-normal text-emerald-600 dark:text-emerald-400 ml-1" }, "(", BAND_OPTIONS.find((b) => b.value === selectedBand)?.label, ")")), bandOpen && /* @__PURE__ */ React.createElement("div", { className: "max-h-40 overflow-auto space-y-1 py-0.5 mt-1" }, bandRows.filter((b) => b.accounts > 0 || b.value === "all").map((opt) => {
    const active = selectedBand === opt.value;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: opt.value,
        onClick: () => React.startTransition(() => {
          setSelectedBand(opt.value);
          setSelectedSubregion("__ALL_SUB__");
        }),
        className: [
          "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
          active ? "border-2 border-emerald-400 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
        ].join(" ")
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, opt.label), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, opt.accounts.toLocaleString())),
      opt.value !== "all" && opt.atr > 0 && /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, fmtC(opt.atr))
    );
  }))), selectedFQ && subregionRows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5 space-y-1" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setSubregionOpen((p) => !p), className: "flex items-center gap-1 text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider mb-1 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300 transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: `inline-block transition-transform duration-150 ${subregionOpen ? "rotate-0" : "-rotate-90"}` }, "\u25BC"), "Sub-Regions", selectedSubregion !== "__ALL_SUB__" && /* @__PURE__ */ React.createElement("span", { className: "normal-case tracking-normal text-blue-600 dark:text-blue-300 ml-1" }, "(", selectedSubregion, ")")), subregionOpen && /* @__PURE__ */ React.createElement("div", { className: "max-h-40 overflow-auto space-y-1 py-0.5 mt-1" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => setSelectedSubregion("__ALL_SUB__")),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedSubregion === "__ALL_SUB__" ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    "All subregions"
  ), subregionRows.map((sr) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: sr.sub,
      onClick: () => React.startTransition(() => setSelectedSubregion(sr.sub)),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedSubregion === sr.sub ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, sr.sub), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, sr.count.toLocaleString())),
    /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, fmtC(sr.atr))
  )))), selectedFQ && csManagerRows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5 space-y-1" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setCsManagerOpen((p) => !p), className: "flex items-center gap-1 text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider mb-1 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300 transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: `inline-block transition-transform duration-150 ${csManagerOpen ? "rotate-0" : "-rotate-90"}` }, "\u25BC"), "CS Manager", selectedCsManager !== "__ALL_CSM__" && /* @__PURE__ */ React.createElement("span", { className: "normal-case tracking-normal text-blue-600 dark:text-blue-300 ml-1" }, "(", selectedCsManager, ")")), csManagerOpen && /* @__PURE__ */ React.createElement("div", { className: "max-h-48 overflow-auto space-y-1 py-0.5 mt-1" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => setSelectedCsManager("__ALL_CSM__")),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedCsManager === "__ALL_CSM__" ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    "All managers"
  ), csManagerRows.map((cm) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: cm.owner,
      onClick: () => React.startTransition(() => setSelectedCsManager(cm.owner)),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedCsManager === cm.owner ? "border-2 border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/30 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, cm.owner), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, cm.count.toLocaleString())),
    /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, fmtC(cm.atr))
  ))))))), /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-w-0 space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2.5 border-b flex items-center justify-between", style: { borderColor: "var(--border)" } }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, "Quarter Summary"), (selectedBand !== "all" || selectedSubregion !== "__ALL_SUB__" || selectedCsManager !== "__ALL_CSM__") && /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-blue-500 dark:text-blue-400 font-medium" }, "Filtered: ", [selectedBand !== "all" && BAND_OPTIONS.find((b) => b.value === selectedBand)?.label, selectedSubregion !== "__ALL_SUB__" && selectedSubregion, selectedCsManager !== "__ALL_CSM__" && selectedCsManager].filter(Boolean).join(" \xB7 "))), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead text-[9px] uppercase tracking-wider text-blue-500 dark:text-blue-400" }, /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-left font-semibold" }, "Quarter"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "ATR"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Actual CC"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Expansion"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "CC Offcycle"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Renewal Rate"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Accounts"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Done"), /* @__PURE__ */ React.createElement("th", { className: "px-3 py-2 text-right font-semibold" }, "Open"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-blue-100/50 dark:divide-slate-800/60" }, allQuarters.filter((q) => qtrStats.has(q)).map((q, i) => {
    const s = qtrStats.get(q);
    const rate = s.atr > 0 ? (s.atr - s.cc) / s.atr * 100 : null;
    return /* @__PURE__ */ React.createElement("tr", { key: q, className: `glass-row-accent ${selectedFQ === q ? "ring-1 ring-inset ring-blue-300 dark:ring-blue-700" : ""}`, onClick: () => React.startTransition(() => setSelectedFQ(q)) }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400" }, q), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, fmtC(s.atr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-red-500" }, fmtC(s.cc)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-blue-600 dark:text-blue-400" }, fmtC(s.exp)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, fmtC(s.ccOff)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-semibold ${rate != null ? rate >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" : "text-gray-400"}` }, fmtPct(rate)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums" }, s.count.toLocaleString()), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-emerald-600" }, s.done), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-amber-600" }, s.open));
  }), /* @__PURE__ */ React.createElement("tr", { className: "bg-blue-100/40 dark:bg-blue-900/15 border-t-2 border-blue-200/60 dark:border-blue-700/40" }, /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 font-bold text-blue-700 dark:text-blue-300" }, "Total"), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300" }, fmtC(totalStats.atr)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-red-500" }, fmtC(totalStats.cc)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-blue-600" }, fmtC(totalStats.exp)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums text-gray-500" }, fmtC(totalStats.ccOff)), /* @__PURE__ */ React.createElement("td", { className: `px-3 py-1.5 text-right tabular-nums font-bold ${totalStats.rate != null ? totalStats.rate >= 90 ? "text-emerald-600" : "text-amber-600" : "text-gray-400"}` }, fmtPct(totalStats.rate)), /* @__PURE__ */ React.createElement("td", { className: "px-3 py-1.5 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300" }, totalStats.count.toLocaleString()), /* @__PURE__ */ React.createElement("td", { colSpan: "2" })))))), selectedFQ && /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5 text-blue-700 dark:text-blue-300" }, "Health Mix"), /* @__PURE__ */ React.createElement(HBar, { items: healthDist })), /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5 text-blue-700 dark:text-blue-300" }, "Segment Mix"), /* @__PURE__ */ React.createElement(HBar, { items: segDist })), /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5 text-blue-700 dark:text-blue-300" }, "ATR Distribution"), (() => {
    const bands = [
      { label: "$0 \u2013 $12K", test: (r) => toNumber(r[atrKey]) > 0 && toNumber(r[atrKey]) <= 12e3 },
      { label: "$12K \u2013 $100K", test: (r) => toNumber(r[atrKey]) > 12e3 && toNumber(r[atrKey]) <= 1e5 },
      { label: "$100K+", test: (r) => toNumber(r[atrKey]) > 1e5 }
    ];
    const data = bands.map((b) => {
      const m = focusRows.filter(b.test);
      return { ...b, ct: m.length, sum: m.reduce((s, r) => s + toNumber(r[atrKey]), 0) };
    });
    const maxCt = Math.max(...data.map((d) => d.ct)) || 1;
    return data.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.label, className: "flex items-center gap-2 mb-1" }, /* @__PURE__ */ React.createElement("div", { className: "w-20 text-[10px] truncate shrink-0 text-gray-600 dark:text-gray-400" }, b.label), /* @__PURE__ */ React.createElement("div", { className: "flex-1 h-3 rounded bg-blue-100/60 dark:bg-slate-700 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "h-full rounded bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-300", style: { width: `${(b.ct / maxCt * 100).toFixed(0)}%` } })), /* @__PURE__ */ React.createElement("div", { className: "w-8 text-right text-[10px] tabular-nums font-medium text-gray-700 dark:text-gray-300 shrink-0" }, b.ct), /* @__PURE__ */ React.createElement("div", { className: "w-12 text-right text-[9px] tabular-nums text-gray-500 dark:text-gray-400 shrink-0" }, fmtC(b.sum))));
  })())), /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2.5 border-b flex items-center justify-between", style: { borderColor: "var(--border)" } }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-gray-700 dark:text-gray-200" }, selectedFQ && selectedFQ !== "__ALL__" ? selectedFQ : "All Quarters", " \u2014 ", sortedRows.length.toLocaleString(), " accounts", selectedBand !== "all" && ` \xB7 ${BAND_OPTIONS.find((b) => b.value === selectedBand)?.label || selectedBand}`, selectedSubregion !== "__ALL_SUB__" && ` \xB7 ${selectedSubregion}`)), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto", style: { maxHeight: "60vh", overflowY: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full table-fixed text-[10px]" }, /* @__PURE__ */ React.createElement("thead", { className: "sticky top-0 z-10 glass-thead" }, /* @__PURE__ */ React.createElement("tr", { className: "text-[9px] uppercase tracking-wider text-blue-500 dark:text-blue-400" }, /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold cursor-pointer hover:text-blue-700", onClick: () => toggleSort("account") }, "Account ", sortIcon("account")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold w-[5rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("date") }, "Renewal ", sortIcon("date")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-right font-semibold w-[5rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("atr") }, "ATR ", sortIcon("atr")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-right font-semibold w-[5rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("cc") }, "CC ", sortIcon("cc")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-right font-semibold w-[4.5rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("exp") }, "Expansion ", sortIcon("exp")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-right font-semibold w-[4rem]" }, "BU FC"), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold w-[4.5rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("health") }, "Health ", sortIcon("health")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold w-[3.5rem]" }, "Done"), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold w-[6rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("owner") }, "Owner ", sortIcon("owner")), /* @__PURE__ */ React.createElement("th", { className: "px-2 py-1.5 text-left font-semibold w-[7rem] cursor-pointer hover:text-blue-700", onClick: () => toggleSort("partner") }, "Partner ", sortIcon("partner")))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-blue-100/40 dark:divide-slate-800/40" }, sortedRows.slice(0, detailLimit).map((row, i) => /* @__PURE__ */ React.createElement("tr", { key: row.r.__uid || i, className: `glass-row-accent` }, /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate overflow-hidden", title: row.account }, row.account || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 whitespace-nowrap" }, row.date || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, fmtC(row.atr)), /* @__PURE__ */ React.createElement("td", { className: `px-1 py-1 text-right tabular-nums whitespace-nowrap ${row.cc > 0 ? "text-red-500" : ""}` }, row.cc > 0 ? fmtC(row.cc) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: `px-1 py-1 text-right tabular-nums whitespace-nowrap ${row.exp > 0 ? "text-blue-600 dark:text-blue-400" : ""}` }, row.exp > 0 ? fmtC(row.exp) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, row.buFc > 0 ? fmtC(row.buFc) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1" }, hBadge(row.health)), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1" }, doneBadge(row.done)), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate overflow-hidden", title: row.owner }, row.owner || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate overflow-hidden", title: row.partner }, row.partner || "\u2014")))))), sortedRows.length > detailLimit && /* @__PURE__ */ React.createElement("div", { className: "px-4 py-2 border-t border-blue-100 dark:border-slate-700/60 text-center" }, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-slate", onClick: () => setDetailLimit((l) => l + 100) }, "Show more (", sortedRows.length - detailLimit, " remaining)"))))));
}
function ServerStatusPill({ serverInfo, status }) {
  const [showLan, setShowLan] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!serverInfo || !serverInfo.ok) return null;
  const labels = {
    idle: { dot: "#10b981", text: "Server connected", title: "notes.json is the source of truth" },
    synced: { dot: "#10b981", text: "Notes synced", title: "last save reached notes.json on disk" },
    pending: { dot: "#f59e0b", text: "Saving notes...", title: "PUT /api/renewals/notes in flight" },
    error: { dot: "#ef4444", text: "Sync error", title: "check the server logs" }
  };
  const cfg = labels[status] || labels.idle;
  const lanUrl = serverInfo.lanUrl || null;
  const localUrl = serverInfo.localUrl || null;
  const clickable = Boolean(lanUrl || localUrl);
  const copy = async (url) => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
    }
  };
  const modal = showLan ? ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement("div", { className: "modal-overlay", onClick: (e) => {
      if (e.target === e.currentTarget) setShowLan(false);
    } }, /* @__PURE__ */ React.createElement("div", { className: "modal-card max-w-md", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("svg", { className: "w-4 h-4", style: { color: "var(--ink-muted)" }, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8 }, /* @__PURE__ */ React.createElement("rect", { x: "7", y: "2", width: "10", height: "20", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "11", y1: "18", x2: "13", y2: "18" })), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold", style: { color: "var(--ink)" } }, "Open on iPhone or iPad")), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowLan(false), className: "smallbtn smallbtn-slate smallbtn-xs" }, "Close")), /* @__PURE__ */ React.createElement("div", { style: { padding: "0.85rem 1rem" }, className: "space-y-3" }, lanUrl ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, "Make sure your phone is on the same Wi-Fi as this laptop, then open Safari and go to:"), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "text-xs font-mono break-all p-2 rounded",
        style: { background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.25)", color: "var(--ink)" }
      },
      lanUrl
    ), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5" }, /* @__PURE__ */ React.createElement("button", { onClick: () => copy(lanUrl), className: "smallbtn smallbtn-indigo" }, copied ? "Copied" : "Copy URL"), /* @__PURE__ */ React.createElement("a", { href: lanUrl, target: "_blank", rel: "noopener noreferrer", className: "smallbtn smallbtn-slate", style: { textDecoration: "none" } }, "Open in new tab")), /* @__PURE__ */ React.createElement("div", { className: "text-[10px] space-y-1", style: { color: "var(--ink-muted)" } }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold", style: { color: "var(--ink)" } }, "Tip \u2014 install as a home-screen app:"), /* @__PURE__ */ React.createElement("div", null, "1. Open the URL in Safari on your phone."), /* @__PURE__ */ React.createElement("div", null, '2. Tap the Share icon, then "Add to Home Screen".'), /* @__PURE__ */ React.createElement("div", null, "3. Launch from the icon \u2014 runs full-screen, no browser chrome."))) : /* @__PURE__ */ React.createElement("div", { className: "text-[11px]", style: { color: "var(--ink-muted)" } }, "No LAN address detected \u2014 the server can't reach the network. Try connecting the laptop to Wi-Fi and reload the page."), localUrl && (() => {
      const host = typeof window !== "undefined" && window.location?.hostname || "";
      const isLaptop = host === "127.0.0.1" || host === "localhost";
      if (!isLaptop) return null;
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "h-px", style: { background: "var(--border)" } }), /* @__PURE__ */ React.createElement("div", { className: "text-[9px] font-semibold uppercase tracking-wider", style: { color: "var(--ink-muted)" } }, "This machine only"), /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-mono break-all", style: { color: "var(--ink-muted)" } }, localUrl));
    })(), /* @__PURE__ */ React.createElement("div", { className: "h-px", style: { background: "var(--border)" } }), /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, "Notes you make on the phone save back to ", /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, "notes.json"), " on this laptop. CSVs auto-load \u2014 no need to re-import on the phone.")))),
    document.body
  ) : null;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, clickable ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setShowLan(true),
      className: "pill text-[10px]",
      title: lanUrl ? "Click to view the iPhone URL" : cfg.title,
      style: { display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: cfg.dot, display: "inline-block" } }),
    cfg.text
  ) : /* @__PURE__ */ React.createElement("span", { className: "pill text-[10px]", title: cfg.title, style: { display: "inline-flex", alignItems: "center", gap: "0.35rem" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: cfg.dot, display: "inline-block" } }), cfg.text), modal);
}
function Header() {
  const { theme, bgTheme, actions, state, serverInfo } = useApp();
  const { serverSyncStatus } = useAppStatus();
  // Stable element references for the Notes import/export panel and its
  // headless portal host: because these are memoized once, a Header re-render
  // (e.g. when the sync-status pill updates) will NOT re-render or remount the
  // Import/Export buttons. The panel still updates on note changes via its own
  // AppContext subscription. This is the fix for the "Import button flash".
  const notesPanelEl = React.useMemo(() => /* @__PURE__ */ React.createElement(NotesIO, null), []);
  const notesHeadlessEl = React.useMemo(() => /* @__PURE__ */ React.createElement(NotesIO, { headless: true }), []);
  const hasData = state?.data?.length > 0;
  const filters = state.filters;
  const activeFilters = (() => {
    const keys = ["regions", "countries", "segments", "industries", "healths", "quarters", "owners", "partners", "partnerTypes"];
    let total = keys.reduce((acc, k) => acc + (filters[k]?.length || 0), 0);
    if (filters.search) total += 1;
    if (filters.dateFrom || filters.dateTo) total += 1;
    if (filters.band && filters.band !== "all") total += 1;
    if (filters.hasNotes) total += 1;
    return total;
  })();
  const toggleTheme = () => actions.setTheme(theme === "dark" ? "light" : "dark");
  const [showActions, setShowActions] = useState(false);
  const actionsModal = showActions ? ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "modal-overlay",
        onClick: (e) => {
          if (e.target === e.currentTarget) setShowActions(false);
        }
      },
      /* @__PURE__ */ React.createElement("div", { className: "modal-card max-w-md", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("svg", { className: "w-4 h-4", style: { color: "var(--ink-muted)" }, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8 }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" })), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold", style: { color: "var(--ink)" } }, "Settings")), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowActions(false), className: "smallbtn smallbtn-slate smallbtn-xs" }, "Close")), /* @__PURE__ */ React.createElement("div", { style: { padding: "0.85rem 1rem" }, className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] font-semibold uppercase tracking-wider mb-2", style: { color: "var(--ink-muted)" } }, "Data"), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5" }, /* @__PURE__ */ React.createElement(CSVImporter, null))), /* @__PURE__ */ React.createElement("div", { className: "h-px", style: { background: "var(--border)" } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] font-semibold uppercase tracking-wider mb-2", style: { color: "var(--ink-muted)" } }, "Notes"), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5" }, notesPanelEl)), /* @__PURE__ */ React.createElement("div", { className: "h-px", style: { background: "var(--border)" } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] font-semibold uppercase tracking-wider mb-2", style: { color: "var(--ink-muted)" } }, "Preferences"), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5 mb-3" }, /* @__PURE__ */ React.createElement("button", { onClick: () => actions.reset(), className: "smallbtn smallbtn-slate", title: "Reset all filters and settings" }, "Reset view"), /* @__PURE__ */ React.createElement("button", { onClick: toggleTheme, className: "smallbtn smallbtn-slate", title: "Toggle theme" }, theme === "dark" ? "Light mode" : "Dark mode")), /* @__PURE__ */ React.createElement("div", { className: "text-[9px] font-semibold uppercase tracking-wider mb-2", style: { color: "var(--ink-muted)" } }, "Background"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-7 gap-2" }, BG_THEMES.map((t) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: t.id,
          onClick: () => actions.setBgTheme(t.id),
          title: t.label,
          className: "group flex flex-col items-center gap-1"
        },
        /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "w-8 h-8 rounded-lg transition-all duration-150",
            style: {
              background: t.swatch,
              border: bgTheme === t.id ? "2px solid rgba(99,102,241,0.8)" : "1px solid rgba(255,255,255,0.25)",
              boxShadow: bgTheme === t.id ? "0 0 0 2px rgba(99,102,241,0.25)" : "0 2px 6px rgba(0,0,0,0.1)",
              transform: bgTheme === t.id ? "scale(1.1)" : "scale(1)"
            }
          }
        ),
        /* @__PURE__ */ React.createElement("span", { className: "text-[8px] font-medium", style: { color: bgTheme === t.id ? "var(--accent)" : "var(--ink-muted)" } }, t.label)
      ))))))
    ),
    document.body
  ) : null;
  return /* @__PURE__ */ React.createElement("header", { className: "header-shell" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4" }, /* @__PURE__ */ React.createElement("div", { className: "header-row flex items-center gap-4 h-11" }, /* @__PURE__ */ React.createElement("div", { className: "header-title-block flex items-center gap-3 shrink-0 min-w-[380px]" }, /* @__PURE__ */ React.createElement("span", { className: "header-title-logo inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0", style: { background: "linear-gradient(135deg,#6366f1,#06b6d4,#10b981)", boxShadow: "0 2px 8px rgba(99,102,241,0.25)" } }, /* @__PURE__ */ React.createElement("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M21.5 2v6h-6" }), /* @__PURE__ */ React.createElement("path", { d: "M2.5 22v-6h6" }), /* @__PURE__ */ React.createElement("path", { d: "M21.34 8A10 10 0 0 0 3.8 5.4L2.5 8" }), /* @__PURE__ */ React.createElement("path", { d: "M2.66 16A10 10 0 0 0 20.2 18.6l1.3-2.6" }))), /* @__PURE__ */ React.createElement("span", { className: "header-title-text text-3xl font-extrabold tracking-tight whitespace-nowrap", style: { background: "linear-gradient(135deg,#6366f1,#06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" } }, "Renewals Intelligence Studio")), /* @__PURE__ */ React.createElement("div", { className: "header-tabs-block flex-1 flex items-center justify-center" }, /* @__PURE__ */ React.createElement(Tabs, null)), /* @__PURE__ */ React.createElement("div", { className: "header-right-block flex items-center gap-1.5 shrink-0 min-w-[240px] justify-end" }, /* @__PURE__ */ React.createElement(ServerStatusPill, { serverInfo, status: serverSyncStatus }), hasData && /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "iconbtn",
      onClick: () => window.dispatchEvent(new CustomEvent(NOTES_EXPORT_REVIEW_EVENT)),
      title: "Export Notes"
    },
    /* @__PURE__ */ React.createElement("svg", { className: "w-3.5 h-3.5", style: { color: "var(--ink-muted)" }, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8 }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" }))
  ), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowActions(true), className: "iconbtn", title: "Settings & actions" }, /* @__PURE__ */ React.createElement("svg", { className: "w-3.5 h-3.5", style: { color: "var(--ink-muted)" }, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.8 }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" })))))), hasData && /* @__PURE__ */ React.createElement("div", { className: "border-t border-gray-200/40 dark:border-slate-700/40 glass-card-surface" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto" }, /* @__PURE__ */ React.createElement(Filters, null))), actionsModal, notesHeadlessEl);
}
function Tabs() {
  const { state, actions } = useApp();
  const hasHist = state.historicalData?.length > 0;
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    const bump = () => setAccessTick((n) => n + 1);
    window.addEventListener("renewals-tab-access-loaded", bump);
    return () => window.removeEventListener("renewals-tab-access-loaded", bump);
  }, []);
  const allowed = typeof window !== "undefined" && typeof window.__renewalsAllowedTabs === "function" ? new Set(window.__renewalsAllowedTabs()) : null;
  const items = [
    { id: "region", label: "Region" },
    { id: "partner", label: "Partner" },
    { id: "accounts", label: "Accounts" },
    { id: "notes", label: "Notes" },
    ...hasHist ? [{ id: "historical", label: "Historical" }] : [],
    { id: "targets", label: "Report" },
    { id: "weekly", label: "Weekly Brief" }
  ].filter((t) => !allowed || allowed.has(t.id));
  void accessTick;
  return /* @__PURE__ */ React.createElement("div", { className: "tabs" }, items.map((t) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: t.id,
      className: `tab ${state.ui.activeTab === t.id ? "active" : ""}`,
      onClick: () => actions.setTab(t.id),
      "aria-pressed": state.ui.activeTab === t.id
    },
    t.label
  )));
}
function Filters() {
  const { state, actions } = useApp();
  const { data, headerMap, filters, settings, notes } = state;
  const [filterOpen, setFilterOpen] = useState(false);
  const get = (k) => headerMap[k] || "";
  const regionKey = get("REGION");
  const countryKey = get("BILLING_COUNTRY") || get("COUNTRY");
  const segmentKey = get("SEGMENT");
  const industryKey = get("INDUSTRY_TERRITORY") || get("INDUSTRY");
  const healthKey = get("HEALTH");
  const quarterKey = get("FISCAL_QUARTER") || get("YEAR_QUARTER");
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const partnerKey = get("PARTNER");
  const partnerTypeKey = get("PARTNER_TYPE");
  const bandOptions = BAND_OPTIONS;
  const buildOptions = (key) => key ? valueCounts(data, (row) => row[key]) : [];
  // Rows the counts are drawn from (dedupe to latest renewal when the app is
  // in "remaining ATR" mode, mirroring useFilteredRows).
  const sourceRows = useMemo(
    () => settings?.useRemainingArr ? dedupeLatestRows(data, headerMap) : data,
    [data, headerMap, settings?.useRemainingArr]
  );
  // Shared predicate so dropdown facet counts stay in lock-step with the
  // actual filtered result set.
  const match = useMemo(
    () => makeRowMatcher(headerMap, filters, settings, notes, {}),
    [headerMap, filters, settings, notes]
  );
  // Each dropdown shows a DISTINCT-ACCOUNT count per option, honoring every
  // OTHER active filter (skip its own dimension). Only computed while the
  // panel is open so rapid quick-filter toggles don't pay the faceting cost.
  const facet = (valueKey, skipKey) => !valueKey ? [] : filterOpen ? facetAccountCounts(sourceRows, headerMap, match, valueKey, skipKey) : buildOptions(valueKey);
  const regionOptions = useMemo(() => facet(regionKey, "regions"), [filterOpen, sourceRows, headerMap, match, regionKey, data]);
  const countryOptions = useMemo(() => facet(countryKey, "countries"), [filterOpen, sourceRows, headerMap, match, countryKey, data]);
  const segmentOptions = useMemo(() => facet(segmentKey, "segments"), [filterOpen, sourceRows, headerMap, match, segmentKey, data]);
  const industryOptions = useMemo(() => facet(industryKey, "industries"), [filterOpen, sourceRows, headerMap, match, industryKey, data]);
  const healthOptions = useMemo(() => facet(healthKey, "healths"), [filterOpen, sourceRows, headerMap, match, healthKey, data]);
  const quarterOptions = useMemo(() => facet(quarterKey, "quarters").filter((o) => o.value && parseFiscalLabel(o.value).fy > 0), [filterOpen, sourceRows, headerMap, match, quarterKey, data]);
  const ownerOptions = useMemo(() => facet(ownerKey, "owners"), [filterOpen, sourceRows, headerMap, match, ownerKey, data]);
  const partnerOptions = useMemo(() => facet(partnerKey, "partners"), [filterOpen, sourceRows, headerMap, match, partnerKey, data]);
  const partnerTypeOptions = useMemo(() => facet(partnerTypeKey, "partnerTypes"), [filterOpen, sourceRows, headerMap, match, partnerTypeKey, data]);
  const activeCount = useMemo(() => {
    const keys = ["regions", "countries", "segments", "industries", "healths", "quarters", "owners", "partners", "partnerTypes"];
    let total = keys.reduce((acc, k) => acc + (filters[k]?.length || 0), 0);
    if (filters.search) total += 1;
    if (filters.dateFrom || filters.dateTo) total += 1;
    if (filters.band && filters.band !== "all") total += 1;
    if (filters.hasNotes) total += 1;
    return total;
  }, [filters]);
  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (event) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);
  const toggleValue = (type, val) => {
    const nextVal = safeString(val);
    actions.setFilters((prev) => {
      const set = new Set(prev[type] || []);
      set.has(nextVal) ? set.delete(nextVal) : set.add(nextVal);
      return { ...prev, [type]: Array.from(set) };
    });
  };
  const clearType = (type) => actions.setFilters((prev) => ({ ...prev, [type]: [] }));
  const clearAll = () => actions.setFilters({
    regions: [],
    countries: [],
    segments: [],
    industries: [],
    healths: [],
    quarters: [],
    owners: [],
    partners: [],
    partnerTypes: [],
    search: "",
    dateFrom: "",
    dateTo: "",
    band: "all",
    hasNotes: false
  });
  return /* @__PURE__ */ React.createElement("div", { className: "filter-panel" }, /* @__PURE__ */ React.createElement("div", { className: "filter-inline" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: `chip gap-2 ${activeCount ? "chip-active" : ""}`,
      onClick: () => setFilterOpen(true),
      style: { position: "relative" }
    },
    /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { fill: "currentColor", d: "M3 5h18l-7 8v5l-4 2v-7z" })),
    /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold" }, "Filters"),
    /* @__PURE__ */ React.createElement("span", { className: `text-[10px] font-semibold ${activeCount ? "" : "text-gray-500 dark:text-gray-400"}` }, activeCount ? `${activeCount} active` : "All"),
    activeCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: "-3px", right: "-3px", width: "8px", height: "8px", borderRadius: "50%", background: "#6366f1", border: "2px solid rgba(255,255,255,0.85)", boxShadow: "0 0 0 1px rgba(99,102,241,0.3)" } })
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "filter-input filter-main-search",
      placeholder: "Search account / owner / partner / notes",
      "aria-label": "Search accounts",
      value: filters.search || "",
      onChange: (e) => actions.setFilters((p) => ({ ...p, search: e.target.value }))
    }
  ), activeCount > 0 && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "smallbtn smallbtn-slate smallbtn-xs",
      onClick: clearAll,
      title: "Clear all filters",
      style: { marginLeft: "auto" }
    },
    "Clear filters"
  )), filterOpen && ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement("div", { className: "filter-modal", onClick: () => setFilterOpen(false) }, /* @__PURE__ */ React.createElement("div", { className: "card filter-sheet", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-title" }, "Filters"), /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-sub" }, activeCount ? `${activeCount} active` : "All data visible")), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: () => setFilterOpen(false) }, "Close")), /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-grid" }, /* @__PURE__ */ React.createElement(MultiSelect, { label: "Region", options: regionOptions, selected: filters.regions, onToggle: (v) => toggleValue("regions", v), onClear: () => clearType("regions") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Country", options: countryOptions, selected: filters.countries, onToggle: (v) => toggleValue("countries", v), onClear: () => clearType("countries") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Segment", options: segmentOptions, selected: filters.segments, onToggle: (v) => toggleValue("segments", v), onClear: () => clearType("segments") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Industry", options: industryOptions, selected: filters.industries, onToggle: (v) => toggleValue("industries", v), onClear: () => clearType("industries") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Health", options: healthOptions, selected: filters.healths, onToggle: (v) => toggleValue("healths", v), onClear: () => clearType("healths") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Quarter", options: quarterOptions, selected: filters.quarters, onToggle: (v) => toggleValue("quarters", v), onClear: () => clearType("quarters") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Owner", options: ownerOptions, selected: filters.owners, onToggle: (v) => toggleValue("owners", v), onClear: () => clearType("owners") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Partner", options: partnerOptions, selected: filters.partners, onToggle: (v) => toggleValue("partners", v), onClear: () => clearType("partners") }), /* @__PURE__ */ React.createElement(MultiSelect, { label: "Partner Type", options: partnerTypeOptions, selected: filters.partnerTypes, onToggle: (v) => toggleValue("partnerTypes", v), onClear: () => clearType("partnerTypes") })), /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-fields" }, /* @__PURE__ */ React.createElement("label", { className: "filter-field" }, /* @__PURE__ */ React.createElement("span", { className: "filter-label" }, "Renewal date from"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        className: "filter-input w-full",
        value: filters.dateFrom || "",
        onChange: (e) => actions.setFilters((p) => ({ ...p, dateFrom: e.target.value }))
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "filter-field" }, /* @__PURE__ */ React.createElement("span", { className: "filter-label" }, "Renewal date to"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        className: "filter-input w-full",
        value: filters.dateTo || "",
        onChange: (e) => actions.setFilters((p) => ({ ...p, dateTo: e.target.value }))
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "filter-field" }, /* @__PURE__ */ React.createElement("span", { className: "filter-label" }, "Band"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "filter-input w-full",
        value: filters.band || "all",
        onChange: (e) => actions.setFilters((p) => ({ ...p, band: e.target.value }))
      },
      bandOptions.map((opt) => /* @__PURE__ */ React.createElement("option", { key: opt.value, value: opt.value }, opt.label))
    ))), /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-toggles" }, /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        className: "form-checkbox",
        checked: !!filters.hasNotes,
        onChange: (e) => actions.setFilters((p) => ({ ...p, hasNotes: e.target.checked }))
      }
    ), /* @__PURE__ */ React.createElement("span", null, "Has notes only")), /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        className: "form-checkbox",
        checked: !!settings?.useRemainingArr,
        onChange: (e) => actions.setSettings((p) => ({ ...p, useRemainingArr: e.target.checked }))
      }
    ), /* @__PURE__ */ React.createElement("span", null, "Use ATR LTG"))), /* @__PURE__ */ React.createElement("div", { className: "filter-sheet-actions" }, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: clearAll }, "Clear filters"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: () => setFilterOpen(false) }, "Done")))),
    document.body
  ));
}
function useScopedAccountIds(rows, idKey, nameKey) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = [...new Set(rows.map((r) => {
      const id = safeString(r[idKey]);
      return id || safeString(r[nameKey]) || null;
    }).filter(Boolean))];
    window.__renewalsScopedAccountIds = () => ids;
    try {
      window.dispatchEvent(new CustomEvent("renewals-scope-changed"));
    } catch (_) {
    }
    return () => {
      delete window.__renewalsScopedAccountIds;
    };
  }, [rows, idKey, nameKey]);
}
function useScopedCallKeys(rows, hm, settings) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof RenewalsCallKeys === "undefined") return;
    const keys = [...new Set(rows.map((r) => RenewalsCallKeys.buildCallKey(r, hm, settings)).filter(Boolean))];
    window.__renewalsScopedCallKeys = () => keys;
    try {
      window.dispatchEvent(new CustomEvent("renewals-scope-changed"));
    } catch (_) {
    }
    return () => {
      delete window.__renewalsScopedCallKeys;
    };
  }, [rows, hm, settings]);
}

function useScopedCallRollup(rows, hm, settings, notes, fcByAccount) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cs = 0, rn = 0, elt = 0, csCount = 0, rnCount = 0, djCount = 0;
    const buKey = getBuKey(hm, settings);
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0, len = rows.length; i < len; i++) {
      const r = rows[i];
      const ck = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKey(r, hm, settings) : null;
      if (!ck || seen.has(ck)) continue;
      seen.add(ck);
      const bu = toNumber(r[buKey]);
      const fc = fcByAccount && fcByAccount.get ? fcByAccount.get(ck) : null;
      const rowCs = fc?.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
      const rowRn = fc?.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
      let rowElt = null;
      if (rowCs != null || rowRn != null) {
        if (rowCs != null) { cs += rowCs; csCount++; }
        if (rowRn != null) { rn += rowRn; rnCount++; }
        rowElt = (rowCs || 0) + (rowRn || 0);
      } else {
        const nk = r.__noteKey;
        const note = nk && notes ? notes[nk] : null;
        const djRaw = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
        if (djRaw !== null && Math.round(djRaw) !== Math.round(bu)) {
          rowElt = djRaw;
          djCount++;
        }
      }
      if (rowElt != null) elt += rowElt;
    }
    const payload = { cs_total: cs, renewals_total: rn, elt_total: elt, cs_count: csCount, renewals_count: rnCount, dj_override_count: djCount };
    window.__renewalsScopedCallRollup = () => payload;
    try {
      window.dispatchEvent(new CustomEvent("renewals-call-rollup-changed"));
    } catch (_) {
    }
    return () => {
      delete window.__renewalsScopedCallRollup;
    };
  }, [rows, hm, settings, notes, fcByAccount]);
}
function useFilteredRows(opts) {
  const ignoreQuarters = !!(opts && opts.ignoreQuarters);
  const ignoreBand = !!(opts && opts.ignoreBand);
  const { state } = useApp();
  const { data, headerMap, filters, notes, settings } = state;
  const get = (k) => headerMap[k] || "";
  const regionKey = get("REGION");
  const countryKey = get("BILLING_COUNTRY") || get("COUNTRY");
  const segmentKey = get("SEGMENT");
  const industryKey = get("INDUSTRY_TERRITORY") || get("INDUSTRY");
  const healthKey = get("HEALTH");
  const quarterKey = get("FISCAL_QUARTER") || get("YEAR_QUARTER");
  const accountKey = get("ACCOUNT_NAME");
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const partnerKey = get("PARTNER");
  const partnerTypeKey = get("PARTNER_TYPE");
  const dateKey = get("NEXT_RENEWAL_DATE");
  const flagTopKey = headerMap.FLAG_TOP3K || "FLAG_3K";
  const atrStartingKey = headerMap.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const filtered = useMemo(() => {
    const match = makeRowMatcher(headerMap, filters, settings, notes, { ignoreQuarters, ignoreBand });
    const sourceRows = settings?.useRemainingArr ? dedupeLatestRows(data, headerMap) : data;
    return sourceRows.filter((r) => match(r, null));
  }, [data, headerMap, filters, notes, settings?.useRemainingArr, ignoreQuarters, ignoreBand]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const acctKey = headerMap.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
    const idKey = headerMap.ACCOUNT_ID || "CRM_ACCOUNT_ID";
    window.__renewalsFilteredAccountNames = () => [...new Set(filtered.map((r) => safeString(r[acctKey])).filter(Boolean))];
    window.__renewalsFilteredAccountIds = () => {
      const ids = filtered.map((r) => {
        const id = safeString(r[idKey]);
        if (id) return id;
        return safeString(r[acctKey]) || null;
      }).filter(Boolean);
      return [...new Set(ids)];
    };
  }, [filtered, headerMap]);
  return filtered;
}
function useAccountMeta() {
  return useApp().accountMeta;
}
const FC_SORT_CS = "__CS_CALL__";
const FC_SORT_RN = "__RN_CALL__";
const FC_SORT_ELT = "__ELT_CALL__";
function accountIdFromRow(row, hm) {
  const id = safeString(row[hm.ACCOUNT_ID || "CRM_ACCOUNT_ID"]);
  if (id) return id;
  return accountKeyFromRow(row, hm);
}
let _acctFcLastSignature = null;
function useAccountForecasts() {
  const [byAccount, setByAccount] = useState(() => /* @__PURE__ */ new Map());
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/renewals/account-forecasts", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const m = /* @__PURE__ */ new Map();
      (data.items || []).forEach((item) => {
        const ck = safeString(item.call_key);
        if (!ck) return;
        // Calls are keyed strictly by account + quarter + rounded ATR
        // (the call_key). Indexing by bare account id/name previously let a
        // call in one quarter bleed onto every other quarter of the account
        // and made deletes look like no-ops. A fully-cleared call (both
        // forecasts null) is skipped so it disappears everywhere.
        const hasValue = item.cs_forecast != null || item.renewals_forecast != null;
        if (!hasValue) return;
        m.set(ck, item);
      });
      setByAccount(m);
      // Only broadcast when the data actually changed. reload() runs in
      // response to renewals-acctfc-changed, so an unconditional dispatch here
      // re-triggered every listener's reload() forever — an unbounded fetch
      // storm that saturated the DB pool and made unrelated requests (like the
      // account card's single-call lookup) fail ~99% of the time. The shared
      // signature lets a real change notify once, then settles.
      const sig = JSON.stringify(
        Array.from(m.entries()).map(([k, v]) => [k, v.cs_forecast, v.renewals_forecast]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      );
      if (sig !== _acctFcLastSignature) {
        _acctFcLastSignature = sig;
        try {
          window.dispatchEvent(new CustomEvent("renewals-acctfc-changed"));
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }, []);
  useEffect(() => {
    reload();
    const onChange = () => reload();
    window.addEventListener("renewals-acctfc-changed", onChange);
    return () => window.removeEventListener("renewals-acctfc-changed", onChange);
  }, [reload]);
  return { byAccount, reload };
}
function PanelCard({ label, title, meta, children }) {
  return /* @__PURE__ */ React.createElement("div", { className: "card panel-card" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "panel-label" }, label), /* @__PURE__ */ React.createElement("div", { className: "panel-title" }, title)), meta && /* @__PURE__ */ React.createElement("div", { className: "panel-meta" }, meta)), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, children));
}
function Partner() {
  const { state, actions } = useApp();
  const rows = useFilteredRows();
  const { byAccount: fcByAccount } = useAccountForecasts();
  const { filters, settings } = state;
  const hm = state.headerMap;
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const accountKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const acctIdKey = hm.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const partnerKey = hm.PARTNER || "PARTNER";
  const partnerTypeKey = hm.PARTNER_TYPE || "PARTNER_TYPE_C";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const regionKey = hm.REGION || "REGION";
  const countryKey = hm.BILLING_COUNTRY || hm.COUNTRY || "COUNTRY";
  const subregionKey = hm.SUBREGION || "PRO_FORMA_SUBREGION";
  const segmentKey = hm.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const notes = state.notes || {};
  const atrLabel = settings.useRemainingArr ? "ATR LTG" : "Starting ARR";
  const valid = rows.filter((r) => isValidRenewal(r, hm, settings));
  const partnerRows = useMemo(() => valid.filter((r) => safeString(r[partnerKey])), [valid, partnerKey]);
  const nonPartnerRows = useMemo(() => valid.filter((r) => !safeString(r[partnerKey])), [valid, partnerKey]);
  const { accountRollups, touchByAccount: _globalTouch } = useAccountMeta();
  const touchKey = hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
  const touchByAccount = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    partnerRows.forEach((r) => {
      const acct = safeString(r[accountKey]) || "__NO_ACCOUNT__";
      const v = toNumber(r[touchKey]);
      if (!isFinite(v)) return;
      if (!m.has(acct) || v > m.get(acct)) m.set(acct, v);
    });
    return m;
  }, [partnerRows, accountKey, touchKey]);
  const partnerOptions = useMemo(() => valueCounts(partnerRows, (r) => r[partnerKey]), [partnerRows, partnerKey]);
  const partnerTotals = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    partnerRows.forEach((r) => {
      const value = safeString(r[partnerKey]);
      const label = value || "(Blank)";
      const atr = toNumber(r[atrKey]);
      const acct = normalizeAccountName(r[accountKey]) || "__NO_ACCOUNT__";
      const entry = map.get(value) || { value, label, arr: 0, renewals: 0, accountSet: /* @__PURE__ */ new Set(), next90: 0 };
      const dt = parseDate(r[dateKey]);
      const diff = dt ? Math.round((dt - /* @__PURE__ */ new Date()) / (1e3 * 60 * 60 * 24)) : null;
      entry.arr += atr;
      entry.renewals += 1;
      entry.accountSet.add(acct);
      if (diff != null && diff >= 0 && diff <= 90) entry.next90 += 1;
      map.set(value, entry);
    });
    return Array.from(map.values()).map((item) => ({
      ...item,
      accounts: item.accountSet.size,
      avgArrPerAccount: item.accountSet.size ? item.arr / item.accountSet.size : 0
    })).sort((a, b) => b.arr - a.arr);
  }, [partnerRows, partnerKey, atrKey, accountKey, dateKey]);
  const overallArr = sumBy(valid, (r) => toNumber(r[atrKey]));
  const partnerArr = sumBy(partnerRows, (r) => toNumber(r[atrKey]));
  const nonPartnerArr = Math.max(0, overallArr - partnerArr);
  const partnerShareCount = valid.length ? partnerRows.length / valid.length : 0;
  const partnerShareArr = overallArr ? partnerArr / overallArr : 0;
  const hasPartnerFilter = filters.partners.length === 1;
  const multiPartner = filters.partners.length > 1;
  const selectedPartnerValue = hasPartnerFilter ? filters.partners[0] : null;
  const selectedPartnerLabel = hasPartnerFilter ? selectedPartnerValue || "(Blank)" : multiPartner ? `${filters.partners.length} partners` : "All partners";
  const focusRows = partnerRows;
  useScopedAccountIds(focusRows, acctIdKey, accountKey);
  useScopedCallKeys(focusRows, hm, settings);
  useScopedCallRollup(focusRows, hm, settings, notes, fcByAccount);
  const summary = useMemo(() => {
    const accountSet = /* @__PURE__ */ new Set();
    const ownerSet = /* @__PURE__ */ new Set();
    const renewalDays = [];
    let totalAtr2 = 0;
    let totalBu2 = 0;
    let atRiskArr = 0;
    let next90Arr = 0;
    let next90Count = 0;
    let overdueArr = 0;
    const now = /* @__PURE__ */ new Date();
    focusRows.forEach((r) => {
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      totalAtr2 += atr;
      totalBu2 += bu;
      const acct = normalizeAccountName(r[accountKey]);
      if (acct) accountSet.add(acct);
      const owner = safeString(r[ownerKey]) || "Unassigned";
      ownerSet.add(owner);
      const health = safeString(r[healthKey]).toLowerCase();
      if (health.includes("red") || health.includes("amber") || health.includes("yellow")) atRiskArr += atr;
      const dt = parseDate(r[dateKey]);
      if (dt) {
        const diff = Math.round((dt - now) / (1e3 * 60 * 60 * 24));
        renewalDays.push(diff);
        if (diff < 0) overdueArr += atr;
        if (diff >= 0 && diff <= 90) {
          next90Arr += atr;
          next90Count += 1;
        }
      }
    });
    const medianDays = median(renewalDays);
    return {
      accountCount: accountSet.size,
      ownerCount: ownerSet.size,
      totalAtr: totalAtr2,
      totalBu: totalBu2,
      atRiskArr,
      next90Arr,
      next90Count,
      overdueArr,
      medianDays
    };
  }, [focusRows, atrKey, buKey, dateKey, healthKey, ownerKey, accountKey]);
  const totalAtr = summary.totalAtr;
  const totalBu = summary.totalBu;
  const ccRate = totalAtr ? totalBu / totalAtr : 0;
  const grr = totalAtr ? (totalAtr - totalBu) / totalAtr : 1;
  const riskShare = totalAtr ? summary.atRiskArr / totalAtr : 0;
  const horizonMeta = summary.medianDays != null ? `Median ${summary.medianDays} days \xB7 Overdue ${formatCurrencyUSD(summary.overdueArr)}` : `Overdue ${formatCurrencyUSD(summary.overdueArr)}`;
  const healthRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const raw = safeString(r[healthKey]).trim().toUpperCase();
      let label = raw || "(Unknown)";
      if (raw.includes("GREEN")) label = "Green";
      else if (raw.includes("YELLOW") || raw.includes("AMBER")) label = "Amber";
      else if (raw.includes("RED")) label = "Red";
      else if (raw.includes("CHURN")) label = "Churn";
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const entry = map.get(label) || { label, accounts: 0, atr: 0, bu: 0 };
      entry.accounts += 1;
      entry.atr += atr;
      entry.bu += bu;
      map.set(label, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.atr - a.atr);
  }, [focusRows, healthKey, atrKey, buKey]);
  const riskAccounts = useMemo(() => {
    return focusRows.map((r) => {
      const health = safeString(r[healthKey]).toLowerCase();
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const isRisk = health.includes("red") || health.includes("amber") || health.includes("yellow") || bu > 0;
      if (!isRisk || atr <= 0) return null;
      return {
        account: safeString(r[accountKey]) || "(Unnamed)",
        owner: safeString(r[ownerKey]) || "Unassigned",
        health: safeString(r[healthKey]) || "Unknown",
        arr: atr,
        bu,
        date: parseDate(r[dateKey])
      };
    }).filter(Boolean).sort((a, b) => b.arr - a.arr).slice(0, 5);
  }, [focusRows, healthKey, atrKey, buKey, accountKey, ownerKey, dateKey]);
  const horizon = useMemo(() => {
    const buckets = [
      { id: "overdue", label: "Overdue", from: -99999, to: -1, accounts: 0, arr: 0 },
      { id: "d0_30", label: "0-30 days", from: 0, to: 30, accounts: 0, arr: 0 },
      { id: "d31_60", label: "31-60 days", from: 31, to: 60, accounts: 0, arr: 0 },
      { id: "d61_90", label: "61-90 days", from: 61, to: 90, accounts: 0, arr: 0 },
      { id: "d91_180", label: "91-180 days", from: 91, to: 180, accounts: 0, arr: 0 },
      { id: "d180_plus", label: "180+ days", from: 181, to: 99999, accounts: 0, arr: 0 }
    ];
    const upcoming = [];
    const now = /* @__PURE__ */ new Date();
    focusRows.forEach((r) => {
      const dt = parseDate(r[dateKey]);
      if (!dt) return;
      const diff = Math.round((dt - now) / (1e3 * 60 * 60 * 24));
      const atr = toNumber(r[atrKey]);
      const bucket = buckets.find((b) => diff >= b.from && diff <= b.to);
      if (bucket) {
        bucket.accounts += 1;
        bucket.arr += atr;
      }
      upcoming.push({
        account: safeString(r[accountKey]) || "(Unnamed)",
        arr: atr,
        date: dt,
        diff
      });
    });
    const nextRenewals = upcoming.sort((a, b) => a.date - b.date).slice(0, 5);
    const maxArr = buckets.reduce((s, b) => Math.max(s, b.arr), 0);
    return { buckets, nextRenewals, maxArr };
  }, [focusRows, dateKey, atrKey, accountKey]);
  const buildBucketRows = (keyFn) => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const label = safeString(keyFn(r)) || "(Unknown)";
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const entry = map.get(label) || { label, accounts: 0, atr: 0, bu: 0 };
      entry.accounts += 1;
      entry.atr += atr;
      entry.bu += bu;
      map.set(label, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.atr - a.atr);
  };
  const regionRows = useMemo(() => buildBucketRows((r) => r[regionKey]), [focusRows, regionKey, atrKey, buKey]);
  const countryRows = useMemo(() => buildBucketRows((r) => r[countryKey]), [focusRows, countryKey, atrKey, buKey]);
  const subregionRows = useMemo(() => buildBucketRows((r) => r[subregionKey]), [focusRows, subregionKey, atrKey, buKey]);
  const ownerRows = useMemo(() => buildBucketRows((r) => r[ownerKey]), [focusRows, ownerKey, atrKey, buKey]);
  const segmentRows = useMemo(() => buildBucketRows((r) => r[segmentKey]), [focusRows, segmentKey, atrKey, buKey]);
  const partnerTypeRows = useMemo(() => buildBucketRows((r) => r[partnerTypeKey]), [focusRows, partnerTypeKey, atrKey, buKey]);
  const productRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const list = Array.isArray(r.__products) ? r.__products : [];
      const products = list.length ? list : ["(Unspecified)"];
      products.forEach((prod) => {
        const label = safeString(prod) || "(Unspecified)";
        const atr = toNumber(r[atrKey]);
        const bu = toNumber(r[buKey]);
        const entry = map.get(label) || { label, accounts: 0, atr: 0, bu: 0 };
        entry.accounts += 1;
        entry.atr += atr;
        entry.bu += bu;
        map.set(label, entry);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.atr - a.atr);
  }, [focusRows, atrKey, buKey]);
  const topOwner = ownerRows[0]?.label;
  const topPartnerType = partnerTypeRows[0]?.label;
  const topRegion = regionRows[0]?.label;
  const topCountry = countryRows[0]?.label;
  const topSubregion = subregionRows[0]?.label;
  const topSegment = segmentRows[0]?.label;
  const summaryMetrics = [
    { label: atrLabel, value: formatCurrencyUSD(totalAtr), hint: `${summary.accountCount.toLocaleString()} accounts` },
    { label: "BU_FC", value: formatCurrencyUSD(totalBu), hint: `C/C ${formatPercent(ccRate)}` },
    { label: "GRR", value: formatPercent(grr), hint: "Retention on focus" },
    { label: "At-risk ARR", value: formatCurrencyUSD(summary.atRiskArr), hint: `${formatPercent(riskShare)} of ARR` },
    { label: "Renewing next 90d", value: formatCurrencyUSD(summary.next90Arr), hint: `${summary.next90Count.toLocaleString()} renewals` },
    { label: "Active CSMs", value: summary.ownerCount.toLocaleString(), hint: topOwner ? `Top: ${topOwner}` : "No owner data" }
  ];
  const [selectedAccountRow, setSelectedAccountRow] = useState(null);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerListSort, setPartnerListSort] = useState("arr");
  const [acctLimit, setAcctLimit] = useState("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountSort, setAccountSort] = useState({ key: "atr", dir: "desc" });
  const [selectedGeoCountry, setSelectedGeoCountry] = useState("__ALL__");
  const [selectedGeoSubregion, setSelectedGeoSubregion] = useState("__ALL__");
  const partnerDirectoryRows = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    const filtered = partnerTotals.filter((p) => !q || safeString(p.label).toLowerCase().includes(q));
    const sorted = [...filtered];
    if (partnerListSort === "name") sorted.sort((a, b) => safeString(a.label).localeCompare(safeString(b.label)));
    else if (partnerListSort === "accounts") sorted.sort((a, b) => b.accounts - a.accounts || b.arr - a.arr);
    else sorted.sort((a, b) => b.arr - a.arr || safeString(a.label).localeCompare(safeString(b.label)));
    return sorted;
  }, [partnerTotals, partnerSearch, partnerListSort]);
  const accountRowsDetailed = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    const mapped = focusRows.map((r) => {
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      return {
        row: r,
        account: safeString(r[accountKey]) || "(Unnamed)",
        partner: safeString(r[partnerKey]) || "\u2014",
        owner: safeString(r[ownerKey]) || "Unassigned",
        region: safeString(r[regionKey]) || "\u2014",
        country: safeString(r[countryKey]) || "\u2014",
        subregion: safeString(r[subregionKey]) || "\u2014",
        health: safeString(r[healthKey]) || "\u2014",
        renewal: safeString(r[dateKey]) || "",
        atr,
        bu,
        cc: atr > 0 ? bu / atr : 0
      };
    }).filter((item) => {
      if (selectedGeoCountry !== "__ALL__" && item.country !== selectedGeoCountry) return false;
      if (selectedGeoSubregion !== "__ALL__" && item.subregion !== selectedGeoSubregion) return false;
      if (!q) return true;
      return `${item.account} ${item.partner} ${item.owner} ${item.region} ${item.country} ${item.subregion} ${item.health} ${item.renewal}`.toLowerCase().includes(q);
    });
    const mul = accountSort.dir === "asc" ? 1 : -1;
    const sorted = mapped.sort((a, b) => {
      const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
      switch (accountSort.key) {
        case "account":
          return cmp(a.account.toLowerCase(), b.account.toLowerCase()) * mul;
        case "renewal":
          return cmp(Date.parse(a.renewal) || 0, Date.parse(b.renewal) || 0) * mul;
        case "owner":
          return cmp(a.owner.toLowerCase(), b.owner.toLowerCase()) * mul;
        case "region":
          return cmp(a.region.toLowerCase(), b.region.toLowerCase()) * mul;
        case "country":
          return cmp(a.country.toLowerCase(), b.country.toLowerCase()) * mul;
        case "subregion":
          return cmp(a.subregion.toLowerCase(), b.subregion.toLowerCase()) * mul;
        case "health":
          return cmp(a.health.toLowerCase(), b.health.toLowerCase()) * mul;
        case "bu":
          return cmp(a.bu, b.bu) * mul;
        case "cc":
          return cmp(a.cc, b.cc) * mul;
        case "atr":
        default:
          return cmp(a.atr, b.atr) * mul;
      }
    });
    return sorted;
  }, [focusRows, accountSearch, accountSort, selectedGeoCountry, selectedGeoSubregion, atrKey, buKey, accountKey, partnerKey, ownerKey, regionKey, countryKey, subregionKey, healthKey, dateKey]);
  const topAccounts = acctLimit === "all" ? accountRowsDetailed : accountRowsDetailed.slice(0, Number(acctLimit));
  const ALL_PARTNERS_VALUE = "__ALL_PARTNERS__";
  const partnerSelectValue = hasPartnerFilter ? selectedPartnerValue : ALL_PARTNERS_VALUE;
  const accountSubtitle = hasPartnerFilter ? `Renewals attached to ${selectedPartnerLabel}` : multiPartner ? `Renewals for ${filters.partners.length} partners` : "All partner renewals";
  const handlePartnerSelect = (event) => {
    const value = event.target.value;
    actions.setFilters((prev) => ({
      ...prev,
      partners: value === ALL_PARTNERS_VALUE ? [] : [value]
    }));
  };
  const clearPartner = () => actions.setFilters((prev) => ({ ...prev, partners: [] }));
  const setAccountSortKey = (key) => setAccountSort((prev) => ({
    key,
    dir: prev.key === key ? prev.dir === "asc" ? "desc" : "asc" : key === "account" || key === "owner" || key === "region" || key === "country" || key === "subregion" ? "asc" : "desc"
  }));
  const uniqueNonPartnerAccounts = new Set(nonPartnerRows.map((r) => normalizeAccountName(r[accountKey]) || "__NO_ACCOUNT__")).size;
  const withPartnerSummary = {
    arr: totalAtr,
    renewals: focusRows.length,
    accounts: summary.accountCount,
    avgArr: summary.accountCount ? totalAtr / Math.max(1, summary.accountCount) : 0
  };
  const withoutPartnerSummary = {
    arr: nonPartnerArr,
    renewals: nonPartnerRows.length,
    accounts: uniqueNonPartnerAccounts,
    avgArr: uniqueNonPartnerAccounts ? nonPartnerArr / Math.max(1, uniqueNonPartnerAccounts) : 0
  };
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-4 items-start" }, /* @__PURE__ */ React.createElement("div", { className: "w-64 shrink-0 card p-3 sticky top-4 self-start", style: { maxHeight: "calc(100vh - 120px)", display: "flex", flexDirection: "column", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { className: "space-y-3 shrink-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold" }, "Partners"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip", style: { fontSize: "0.58rem" } }, partnerDirectoryRows.length.toLocaleString())), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "filter-input w-full",
      placeholder: "Search partners",
      value: partnerSearch,
      onChange: (e) => setPartnerSearch(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "seg-ctrl", style: { alignSelf: "flex-start" } }, /* @__PURE__ */ React.createElement("button", { className: `seg-ctrl-btn ${partnerListSort === "name" ? "active" : ""}`, onClick: () => setPartnerListSort("name") }, "Name"), /* @__PURE__ */ React.createElement("button", { className: `seg-ctrl-btn ${partnerListSort === "arr" ? "active" : ""}`, onClick: () => setPartnerListSort("arr") }, "ARR"), /* @__PURE__ */ React.createElement("button", { className: `seg-ctrl-btn ${partnerListSort === "accounts" ? "active" : ""}`, onClick: () => setPartnerListSort("accounts") }, "Accts"))), /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5 pr-1 mt-3 flex-1 min-h-0 overflow-auto" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: `glass-sidebar-item ${!hasPartnerFilter ? "active" : ""}`,
      onClick: clearPartner
    },
    /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold", style: { color: "var(--ink)" } }, "All partners"),
    /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, partnerRows.length.toLocaleString(), " renewals \xB7 ", formatCurrencyUSD(partnerArr))
  ), partnerDirectoryRows.map((p) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: `dir-${p.label}`,
      className: `glass-sidebar-item ${hasPartnerFilter && selectedPartnerValue === p.value ? "active" : ""}`,
      onClick: () => actions.setFilters((prev) => ({ ...prev, partners: [p.value] }))
    },
    /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold truncate", style: { color: "var(--ink)" } }, p.label),
    /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, formatCurrencyUSD(p.arr), " \xB7 ", p.accounts.toLocaleString(), " accts \xB7 ", p.renewals.toLocaleString(), " renewals")
  )), partnerDirectoryRows.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-xs", style: { color: "var(--ink-muted)" } }, "No partners found."))), /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-w-0 space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "card p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-2 mb-3" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label", style: { marginBottom: "0.15rem" } }, "Selected partner"), /* @__PURE__ */ React.createElement("div", { className: "text-base font-semibold", style: { color: "var(--ink)" } }, selectedPartnerLabel)), /* @__PURE__ */ React.createElement("span", { className: "pill-chip", style: { fontSize: "0.58rem" } }, focusRows.length.toLocaleString(), " renewals \xB7 ", summary.accountCount.toLocaleString(), " accounts")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" }, summaryMetrics.map((metric) => /* @__PURE__ */ React.createElement("div", { key: metric.label, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, metric.label), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value" }, metric.value), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, metric.hint)))), /* @__PURE__ */ React.createElement("div", { className: "glass-comparison mt-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-[11px] font-semibold mb-2", style: { color: "var(--ink)" } }, "Partner managed comparison"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3 text-xs" }, /* @__PURE__ */ React.createElement("div", { className: "glass-comparison glass-comparison-emerald" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-emerald-700 dark:text-emerald-300 mb-1" }, "With partner"), /* @__PURE__ */ React.createElement("div", null, formatCurrencyUSD(withPartnerSummary.arr), " ARR \xB7 ", withPartnerSummary.accounts.toLocaleString(), " accounts \xB7 ", withPartnerSummary.renewals.toLocaleString(), " renewals"), /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Avg ARR per unique account ", formatCurrencyUSD(withPartnerSummary.avgArr))), /* @__PURE__ */ React.createElement("div", { className: "glass-comparison glass-comparison-violet" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-violet-700 dark:text-violet-300 mb-1" }, "Without partner"), /* @__PURE__ */ React.createElement("div", null, formatCurrencyUSD(withoutPartnerSummary.arr), " ARR \xB7 ", withoutPartnerSummary.accounts.toLocaleString(), " accounts \xB7 ", withoutPartnerSummary.renewals.toLocaleString(), " renewals"), /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Avg ARR per unique account ", formatCurrencyUSD(withoutPartnerSummary.avgArr)))))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 xl:grid-cols-2 gap-4" }, /* @__PURE__ */ React.createElement(PanelCard, { label: "Renewal Horizon", title: "Upcoming partner renewals", meta: horizonMeta }, horizon.buckets.map((bucket) => /* @__PURE__ */ React.createElement("div", { key: bucket.id, className: "panel-row" }, /* @__PURE__ */ React.createElement("div", { className: "panel-row-header" }, /* @__PURE__ */ React.createElement("span", null, bucket.label), /* @__PURE__ */ React.createElement("span", { className: "text-xs tabular-nums" }, bucket.accounts.toLocaleString(), " \xB7 ", formatCurrencyUSD(bucket.arr))), /* @__PURE__ */ React.createElement("div", { className: "progress-track" }, /* @__PURE__ */ React.createElement("div", { className: "progress-bar", style: { width: `${horizon.maxArr ? Math.min(100, bucket.arr / horizon.maxArr * 100) : 0}%` } }))))), /* @__PURE__ */ React.createElement(PanelCard, { label: "Partner Facts", title: "Facts and insights", meta: `ARR share: ${formatPercent(partnerShareArr)} with partners` }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-2 text-xs" }, /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Partner renewals %"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, formatPercent(partnerShareCount))), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Partner ARR %"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, formatPercent(partnerShareArr))), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Top type"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, topPartnerType || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Top region"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, topRegion || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Top country"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, topCountry || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Top subregion"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, topSubregion || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "Top segment"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, topSegment || "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-fact" }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-muted)" } }, "At-risk ARR"), /* @__PURE__ */ React.createElement("div", { className: "font-semibold" }, formatCurrencyUSD(summary.atRiskArr)))))), /* @__PURE__ */ React.createElement("div", { className: "card p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold" }, "Country and subregion mix"), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-500 dark:text-gray-400" }, "Selected partner scope")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 xl:grid-cols-2 gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "table-container compact-table", style: { maxHeight: "220px" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", { className: "text-[10px] uppercase text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-left" }, "Country"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "Accounts"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "ARR"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "BU_FC"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-gray-100 dark:divide-gray-800" }, countryRows.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "px-1.5 py-2 text-center text-xs text-gray-500" }, "No country data")), countryRows.slice(0, 12).map((row) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      key: `partner-country-${row.label}`,
      className: `${selectedGeoCountry === row.label ? "bg-emerald-50 dark:bg-emerald-900/20" : "glass-row"}`,
      onClick: () => setSelectedGeoCountry((prev) => prev === row.label ? "__ALL__" : row.label)
    },
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1" }, row.label),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, row.accounts.toLocaleString()),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, formatCurrencyUSD(row.atr)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, formatCurrencyUSD(row.bu))
  ))))), /* @__PURE__ */ React.createElement("div", { className: "table-container compact-table", style: { maxHeight: "220px" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", { className: "text-[10px] uppercase text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-left" }, "Subregion"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "Accounts"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "ARR"), /* @__PURE__ */ React.createElement("th", { className: "px-1.5 py-1 text-right" }, "BU_FC"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-gray-100 dark:divide-gray-800" }, subregionRows.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "px-1.5 py-2 text-center text-xs text-gray-500" }, "No subregion data")), subregionRows.slice(0, 12).map((row) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      key: `partner-subregion-${row.label}`,
      className: `${selectedGeoSubregion === row.label ? "bg-emerald-50 dark:bg-emerald-900/20" : "glass-row"}`,
      onClick: () => setSelectedGeoSubregion((prev) => prev === row.label ? "__ALL__" : row.label)
    },
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1" }, row.label),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, row.accounts.toLocaleString()),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, formatCurrencyUSD(row.atr)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 text-right tabular-nums" }, formatCurrencyUSD(row.bu))
  ))))))), /* @__PURE__ */ React.createElement("div", { className: "card p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between mb-3 gap-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold", style: { color: "var(--ink)" } }, "Customer renewals"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip", style: { fontSize: "0.58rem" } }, topAccounts.length.toLocaleString(), acctLimit !== "all" && accountRowsDetailed.length > Number(acctLimit) ? ` of ${accountRowsDetailed.length.toLocaleString()}` : "")), /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, "Sortable account table for current partner context."), (selectedGeoCountry !== "__ALL__" || selectedGeoSubregion !== "__ALL__") && /* @__PURE__ */ React.createElement("div", { className: "mt-1 text-[11px] text-emerald-700 dark:text-emerald-300" }, "Geo filter: ", selectedGeoCountry !== "__ALL__" ? selectedGeoCountry : "All countries", " \xB7 ", selectedGeoSubregion !== "__ALL__" ? selectedGeoSubregion : "All subregions")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 flex-wrap" }, /* @__PURE__ */ React.createElement("input", { className: "filter-input max-w-xs", placeholder: "Search account / owner / region...", value: accountSearch, onChange: (e) => setAccountSearch(e.target.value) }), (selectedGeoCountry !== "__ALL__" || selectedGeoSubregion !== "__ALL__") && /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: () => {
    setSelectedGeoCountry("__ALL__");
    setSelectedGeoSubregion("__ALL__");
  } }, "Clear geo"), /* @__PURE__ */ React.createElement("div", { className: "seg-ctrl" }, ["all", 25, 50, 100, 200].map((n) => /* @__PURE__ */ React.createElement("button", { key: n, className: `seg-ctrl-btn ${String(acctLimit) === String(n) ? "active" : ""}`, onClick: () => setAcctLimit(n === "all" ? "all" : Number(n)) }, n === "all" ? "All" : `Top ${n}`))), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: () => {
    const hdr = ["Account", "Renewal", "ATR", "BU_FC", "C/C", "Health", "Owner", "Region", "Country", "Subregion"];
    const csvRows = [hdr.join(",")];
    topAccounts.forEach((r) => {
      const esc = escapeCsvField;
      csvRows.push([esc(r.account), esc(r.renewal), r.atr, r.bu, isFinite(r.cc) ? (r.cc * 100).toFixed(1) + "%" : "", esc(r.health), esc(r.owner), esc(r.region), esc(r.country), esc(r.subregion)].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewals_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } }, "Export CSV"))), /* @__PURE__ */ React.createElement("div", { className: "table-container compact-table", style: { maxHeight: "420px" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full w-full table-fixed text-[10px]" }, /* @__PURE__ */ React.createElement("thead", { className: "text-[10px] uppercase text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", style: { width: "30%" }, onClick: () => setAccountSortKey("account") }, "Account"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", style: { width: "72px" }, onClick: () => setAccountSortKey("renewal") }, "Renewal"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer", style: { width: "68px" }, onClick: () => setAccountSortKey("atr") }, atrLabel), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer", style: { width: "68px" }, onClick: () => setAccountSortKey("bu") }, "BU_FC"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer", style: { width: "42px" }, onClick: () => setAccountSortKey("cc") }, "C/C"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", style: { width: "62px" }, onClick: () => setAccountSortKey("health") }, "Health"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", style: { width: "90px" }, onClick: () => setAccountSortKey("owner") }, "Owner"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", onClick: () => setAccountSortKey("region") }, "Region"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-gray-100 dark:divide-gray-800" }, topAccounts.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 8, className: "px-1 py-2 text-center text-xs text-gray-500" }, "No customer renewals found")), topAccounts.map(({ row, account, renewal, atr, bu, cc, health, owner, region, country, subregion }, idx) => /* @__PURE__ */ React.createElement("tr", { key: `${row.__uid || account || idx}`, className: `glass-row-accent`, onClick: () => setSelectedAccountRow(row) }, /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 font-semibold truncate", title: account || "" }, account), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 whitespace-nowrap" }, renewal || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, formatCurrencyUSD(atr)), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, formatCurrencyUSD(bu)), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, formatPercent(cc)), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1" }, health), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate", title: owner || "" }, owner), /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate" }, region, " \xB7 ", country, " \xB7 ", subregion))))))))), selectedAccountRow && /* @__PURE__ */ React.createElement(
    AccountNoteModal,
    {
      row: selectedAccountRow,
      notes,
      headerMap: hm,
      settings,
      touchByAccount,
      rollups: accountRollups,
      formatCurrencyInputFn: formatCurrencyInput,
      onSave: (nk, payload) => {
        const prior = notes[nk] || {};
        actions.setNote(nk, { ...prior, ...payload });
        setSelectedAccountRow(null);
      },
      onClose: () => setSelectedAccountRow(null),
      onArchiveNote: (key) => {
        const prior = notes[key] || {};
        actions.setNote(key, { ...prior, archived: true, updatedAt: Date.now() });
      },
      onDeleteNote: (key) => {
        actions.setNote(key, null);
      }
    }
  ));
}
function NotesHub() {
  const { state, actions } = useApp();
  const rows = useFilteredRows();
  const { notes, noteDeletes, headerMap, settings } = state;
  const accountKey = headerMap.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const accountIdKey = headerMap.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const subregionKey = headerMap.SUBREGION || "PRO_FORMA_SUBREGION";
  const dateKey = headerMap.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const summaryKey = headerMap.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const atrKey = getAtrKey(headerMap, settings);
  const buKey = getBuKey(headerMap, settings);
  const atrLabel = settings.useRemainingArr ? "ATR LTG" : "Starting ARR";
  const { accountRollups, touchByAccount } = useAccountMeta();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "renewal", dir: "asc" });
  const [showArchived, setShowArchived] = useState(false);
  const [selectedAccountRow, setSelectedAccountRow] = useState(null);
  const noteRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = rows.map((r) => {
      const noteKey = r.__noteKey;
      const note = noteKey ? notes?.[noteKey] : null;
      if (!note) return null;
      const hasNoteText = safeString(note.note) !== "";
      const hasForecast = note.djForecast != null && isFinite(toNumber(note.djForecast));
      if (!hasNoteText && !hasForecast) return null;
      if (!showArchived && note.archived) return null;
      if (q) {
        const hay = [
          r[accountKey],
          r[ownerKey],
          r[subregionKey],
          r[dateKey],
          r[summaryKey],
          note.note,
          note.accountName,
          note.owner,
          note.accountId
        ].map(safeString).join(" ").toLowerCase();
        if (!hay.includes(q)) return null;
      }
      return {
        row: r,
        note,
        noteKey,
        account: safeString(r[accountKey]) || "(Unnamed)",
        renewal: safeString(r[dateKey]) || "\u2014",
        subregion: safeString(r[subregionKey]) || "\u2014",
        atr: toNumber(r[atrKey]),
        bu: toNumber(r[buKey]),
        summary: safeString(r[summaryKey]) || "\u2014",
        noteText: safeString(note.note) || "\u2014",
        updatedAt: Number(note.updatedAt) || 0
      };
    }).filter(Boolean);
    const datasetKeys = /* @__PURE__ */ new Set();
    const allData = Array.isArray(state.data) ? state.data : [];
    for (const r of allData) {
      if (!r.__noteKey) continue;
      datasetKeys.add(r.__noteKey);
      datasetKeys.add(canonicalNoteKey(r.__noteKey));
    }
    const deletes = noteDeletes || {};
    for (const [nk, note] of Object.entries(notes || {})) {
      if (!note) continue;
      if (datasetKeys.has(nk) || datasetKeys.has(canonicalNoteKey(nk))) continue;
      if (deletes[nk]) continue;
      const hasNoteText = safeString(note.note) !== "";
      const hasForecast = note.djForecast != null && isFinite(toNumber(note.djForecast));
      if (!hasNoteText && !hasForecast) continue;
      if (!showArchived && note.archived) continue;
      const acctName = safeString(note.accountName);
      const acctId = safeString(note.accountId);
      const owner = safeString(note.owner);
      const renewalDate = safeString(note.renewalDate);
      const fq = safeString(note.fq);
      if (q) {
        const hay = [acctName, owner, acctId, renewalDate, fq, note.note].map(safeString).join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const synthRow = {
        [accountKey]: acctName,
        [accountIdKey]: acctId,
        [ownerKey]: owner,
        [subregionKey]: "",
        [dateKey]: renewalDate,
        [summaryKey]: "",
        [atrKey]: note.atr != null ? toNumber(note.atr) : 0,
        [buKey]: 0,
        FISCAL_QUARTER: fq,
        YEAR_QUARTER: fq,
        NEXT_RENEWAL_DATE: renewalDate,
        __noteKey: nk,
        __uid: `note_${nk}`,
        __orphanNote: true
      };
      items.push({
        row: synthRow,
        note,
        noteKey: nk,
        account: acctName || "(Unnamed)",
        renewal: renewalDate || "\u2014",
        subregion: "\u2014",
        atr: toNumber(note.atr),
        bu: 0,
        summary: "\u2014",
        noteText: safeString(note.note) || "\u2014",
        updatedAt: Number(note.updatedAt) || 0
      });
    }
    const mul = sort.dir === "desc" ? -1 : 1;
    const cmpText = (a, b, va, vb) => va.localeCompare(vb) * mul;
    const cmpNum = (a, b, va, vb) => ((va || 0) - (vb || 0)) * mul;
    return items.sort((a, b) => {
      switch (sort.key) {
        case "account":
          return cmpText(a, b, a.account.toLowerCase(), b.account.toLowerCase());
        case "renewal":
          return cmpNum(a, b, Date.parse(a.renewal) || 0, Date.parse(b.renewal) || 0);
        case "subregion":
          return cmpText(a, b, a.subregion.toLowerCase(), b.subregion.toLowerCase());
        case "atr":
          return cmpNum(a, b, a.atr, b.atr);
        case "bu":
          return cmpNum(a, b, a.bu, b.bu);
        case "summary":
          return cmpText(a, b, a.summary.toLowerCase(), b.summary.toLowerCase());
        case "note":
          return cmpText(a, b, a.noteText.toLowerCase(), b.noteText.toLowerCase());
        case "updated":
        default:
          return cmpNum(a, b, a.updatedAt, b.updatedAt);
      }
    });
  }, [rows, state.data, notes, noteDeletes, search, showArchived, sort, accountKey, accountIdKey, ownerKey, subregionKey, dateKey, summaryKey, atrKey, buKey]);
  const totalNotes = noteRows.length;
  const archivedHidden = useMemo(() => {
    if (showArchived) return 0;
    return rows.reduce((count, r) => {
      const noteKey = r.__noteKey;
      const note = noteKey ? notes?.[noteKey] : null;
      if (note?.archived) return count + 1;
      return count;
    }, 0);
  }, [rows, notes, showArchived]);
  const setSortKey = (key) => setSort((s) => ({ key, dir: s.key === key ? s.dir === "asc" ? "desc" : "asc" : key === "renewal" ? "asc" : "desc" }));
  const exportNotesCsv = () => {
    if (!noteRows.length) {
      alert("No notes to export");
      return;
    }
    const headers = ["Account", "Renewal Date", "Subregion", atrLabel, "BU_FC", "ELT Forecast", "Forecast Summary", "Notes"];
    const formatNum = (v) => isFinite(v) ? Math.round(v) : "";
    const escapeCsv = escapeCsvField;
    const csvRows = noteRows.map((n) => {
      const djVal = n.note && n.note.djForecast != null && isFinite(toNumber(n.note.djForecast)) ? Math.round(toNumber(n.note.djForecast)) : "";
      return [n.account, n.renewal, n.subregion, formatNum(n.atr), formatNum(n.bu), djVal, n.summary, n.noteText];
    });
    const csv = [headers.map(escapeCsv).join(",")].concat(csvRows.map((r) => r.map(escapeCsv).join(","))).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewals_notes_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const noteAtrTotal = useMemo(() => noteRows.reduce((s, n) => s + n.atr, 0), [noteRows]);
  const djOverrideCount = useMemo(() => noteRows.filter((n) => n.note?.djForecast != null && isFinite(toNumber(n.note.djForecast))).length, [noteRows]);
  const [selectedKeys, setSelectedKeys] = useState(() => /* @__PURE__ */ new Set());
  const visibleKeys = useMemo(() => noteRows.map((n) => n.noteKey), [noteRows]);
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleKeys);
      let changed = false;
      const next = /* @__PURE__ */ new Set();
      prev.forEach((k) => {
        if (visible.has(k)) next.add(k);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [visibleKeys]);
  const selectedCount = selectedKeys.size;
  const allSelected = visibleKeys.length > 0 && selectedCount === visibleKeys.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const toggleRowSelect = (key) => setSelectedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleSelectAll = () => setSelectedKeys((prev) => {
    if (visibleKeys.length > 0 && prev.size === visibleKeys.length) return /* @__PURE__ */ new Set();
    return new Set(visibleKeys);
  });
  const bulkDeleteSelected = () => {
    if (selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} note${selectedCount === 1 ? "" : "s"}? This can't be undone.`)) return;
    actions.deleteNotes(Array.from(selectedKeys));
    setSelectedKeys(/* @__PURE__ */ new Set());
  };
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "glass-strip", style: { padding: "0.75rem 1rem", flexDirection: "column", alignItems: "stretch", gap: "0.75rem", borderRadius: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 flex-wrap flex-1", style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi", style: { minWidth: 90 } }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Notes"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#4f46e5" } }, totalNotes.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi", style: { minWidth: 90 } }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "ATR Coverage"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#0891b2" } }, fmtCompact(noteAtrTotal))), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi", style: { minWidth: 90 } }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "ELT Overrides"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#d97706" } }, djOverrideCount)), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi", style: { minWidth: 90 } }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Archived"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#64748b" } }, archivedHidden))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "filter-input max-w-xs",
      placeholder: "Search notes, accounts, owners...",
      value: search,
      onChange: (e) => setSearch(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement("button", { className: `smallbtn ${showArchived ? "smallbtn-indigo" : "smallbtn-slate"}`, onClick: () => setShowArchived(!showArchived) }, showArchived ? "Hide archived" : "Show archived"))), /* @__PURE__ */ React.createElement("div", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, rows.length.toLocaleString(), " rows in current filters")), noteRows.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "card p-6 text-sm text-gray-500 dark:text-gray-400" }, "No notes found in the current filters. Clear filters or add a note from the Accounts table.") : /* @__PURE__ */ React.createElement("div", { className: "card p-0" }, /* @__PURE__ */ React.createElement("div", { className: "glass-strip", style: { borderRadius: "14px 14px 0 0", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold", style: { color: "var(--ink)" } }, "Notes table"), /* @__PURE__ */ React.createElement("span", { className: "pill-chip", style: { fontSize: "0.58rem" } }, noteRows.length.toLocaleString(), " rows")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 flex-wrap" }, selectedCount > 0 && /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-rose", onClick: bulkDeleteSelected, title: "Delete selected notes" }, "Delete selected (", selectedCount.toLocaleString(), ")"), /* @__PURE__ */ React.createElement(NotesSummaryExport, { rows }), /* @__PURE__ */ React.createElement(ExecSummaryExport, { rows }), /* @__PURE__ */ React.createElement(WeeklyUpdateExport, { rows }), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo", onClick: exportNotesCsv }, "Export CSV"))), /* @__PURE__ */ React.createElement("div", { className: "table-container compact-table", style: { maxHeight: "calc(100vh - 320px)" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, /* @__PURE__ */ React.createElement("th", { key: "__select", style: { borderColor: "var(--border)", width: "2rem" }, className: "sticky top-0 glass-thead px-1.5 py-1.5 text-center border-b z-10" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", className: "cursor-pointer align-middle", checked: allSelected, ref: (el) => {
    if (el) el.indeterminate = someSelected;
  }, onChange: toggleSelectAll, title: "Select all visible notes", "aria-label": "Select all visible notes" })), [
    { key: "account", label: "Account", left: true },
    { key: "renewal", label: "Renewal", left: true },
    { key: "subregion", label: "Subregion", left: true },
    { key: "atr", label: atrLabel, right: true },
    { key: "bu", label: "BU FC", right: true },
    { key: "summary", label: "Forecast", left: true },
    { key: "note", label: "Notes", left: true },
    { key: "updated", label: "Updated", left: true, w: "4.5rem" }
  ].map((c) => /* @__PURE__ */ React.createElement("th", { key: c.key, style: { ...c.w ? { width: c.w } : {}, borderColor: "var(--border)" }, className: `sticky top-0 glass-thead px-1.5 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap border-b z-10 ${c.right ? "text-right" : "text-left"}` }, /* @__PURE__ */ React.createElement("button", { className: `transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 ${sort.key === c.key ? "text-indigo-600 dark:text-indigo-400" : ""}`, onClick: () => setSortKey(c.key) }, c.label, sort.key === c.key ? sort.dir === "asc" ? " \u2191" : " \u2193" : ""))))), /* @__PURE__ */ React.createElement("tbody", null, noteRows.map(({ row, noteKey, account, renewal, subregion, atr, bu, summary, noteText, updatedAt }) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      key: noteKey,
      className: "cursor-pointer glass-row-accent transition-colors",
      onClick: () => setSelectedAccountRow(row)
    },
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b text-center", style: { borderColor: "var(--border)" }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", className: "cursor-pointer align-middle", checked: selectedKeys.has(noteKey), onChange: () => toggleRowSelect(noteKey), "aria-label": "Select note" })),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b whitespace-nowrap", style: { borderColor: "var(--border)" } }, account),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b whitespace-nowrap", style: { borderColor: "var(--border)" } }, renewal || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b whitespace-nowrap", style: { borderColor: "var(--border)" } }, subregion || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b text-right tabular-nums whitespace-nowrap", style: { borderColor: "var(--border)" } }, formatCurrencyUSD(atr)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b text-right tabular-nums whitespace-nowrap", style: { borderColor: "var(--border)" } }, formatCurrencyUSD(bu)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b whitespace-nowrap", style: { borderColor: "var(--border)" } }, summary || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b max-w-md truncate", style: { borderColor: "var(--border)" }, title: noteText || "" }, noteText || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1.5 py-1 border-b text-[9px] whitespace-nowrap", style: { borderColor: "var(--border)", color: "var(--ink-muted)" }, title: updatedAt ? formatNoteDate(updatedAt) : "" }, updatedAt ? relativeTime(updatedAt) : "\u2014")
  )))))), selectedAccountRow && /* @__PURE__ */ React.createElement(
    AccountNoteModal,
    {
      row: selectedAccountRow,
      notes,
      headerMap,
      settings,
      touchByAccount,
      rollups: accountRollups,
      formatCurrencyInputFn: formatCurrencyInput,
      onSave: (nk, payload) => {
        const prior = notes[nk] || {};
        actions.setNote(nk, { ...prior, ...payload });
        setSelectedAccountRow(null);
      },
      onClose: () => setSelectedAccountRow(null),
      onArchiveNote: (key) => {
        const prior = notes[key] || {};
        actions.setNote(key, { ...prior, archived: true, updatedAt: Date.now() });
      },
      onDeleteNote: (key) => {
        actions.setNote(key, null);
      }
    }
  ));
}
function generateNotesSummary(rows, notes, hm, settings, options = {}) {
  const { sortBy = "date" } = options;
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const summaryKey = hm.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const noted = rows.filter((r) => {
    const nk = r.__noteKey;
    if (!nk || !notes[nk]) return false;
    if (notes[nk].archived) return false;
    const noteText = safeString(notes[nk].note);
    const dj = notes[nk].djForecast;
    return noteText !== "" || isFinite(dj) && dj != null;
  });
  const byQtr = /* @__PURE__ */ new Map();
  noted.forEach((r) => {
    const fq = safeString(r[qKey]) || "(Unknown)";
    if (!byQtr.has(fq)) byQtr.set(fq, []);
    byQtr.get(fq).push(r);
  });
  const quarters = Array.from(byQtr.keys()).sort((a, b) => {
    const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
    return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
  });
  const fmtDollar = (v) => {
    const n = Number(v) || 0;
    return `$${Math.round(n).toLocaleString()}`;
  };
  const lines = [];
  lines.push("RENEWALS NOTES SUMMARY");
  lines.push(`Generated: ${(/* @__PURE__ */ new Date()).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" })}`);
  lines.push("");
  let totalNoted = 0, totalAtr = 0;
  quarters.forEach((fq) => {
    const accts = byQtr.get(fq);
    const qtrAtr = accts.reduce((s, r) => s + toNumber(r[atrKey]), 0);
    if (sortBy === "atr") {
      accts.sort((a, b) => toNumber(b[atrKey]) - toNumber(a[atrKey]));
    } else {
      accts.sort((a, b) => {
        const da = parseDate(a[dateKey]), db = parseDate(b[dateKey]);
        if (da && db) return da - db;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });
    }
    lines.push(`--- ${fq} (ATR: ${formatCurrencyUSD(qtrAtr)} | ${accts.length} account${accts.length !== 1 ? "s" : ""} with notes) ---`);
    lines.push("");
    accts.forEach((r) => {
      const nk = r.__noteKey;
      const note = notes[nk];
      const acctName = safeString(r[acctKey]) || "(Unnamed)";
      const owner = safeString(r[ownerKey]);
      const date = safeString(r[dateKey]);
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const summary = safeString(r[summaryKey]);
      const noteText = safeString(note?.note);
      const dj = note?.djForecast;
      lines.push(`  ${acctName}`);
      const meta = [`Owner: ${owner || "\u2014"}`, `Renewal: ${date || "\u2014"}`, `ATR: ${fmtDollar(atr)}`];
      lines.push(`  ${meta.join(" | ")}`);
      const meta2 = [`C/C FC: ${fmtDollar(bu)}`];
      if (isFinite(dj) && dj != null) meta2.push(`ELT Forecast: ${fmtDollar(dj)}`);
      if (summary) meta2.push(`Summary: ${summary}`);
      lines.push(`  ${meta2.join(" | ")}`);
      if (noteText) lines.push(`  Notes: ${noteText}`);
      lines.push("");
      totalNoted++;
      totalAtr += atr;
    });
  });
  lines.push(`TOTALS: ${totalNoted} account${totalNoted !== 1 ? "s" : ""} with notes | ${formatCurrencyUSD(totalAtr)} ATR covered`);
  return lines.join("\n");
}
function NotesSummaryExport({ rows }) {
  const { state } = useApp();
  const hm = state.headerMap;
  const settings = state.settings;
  const notes = state.notes || {};
  const [sortBy, setSortBy] = useState("date");
  const [copied, setCopied] = useState(false);
  const hasNotes = useMemo(() => {
    return rows.some((r) => {
      const nk = r.__noteKey;
      if (!nk || !notes[nk] || notes[nk].archived) return false;
      return safeString(notes[nk].note) !== "" || isFinite(notes[nk].djForecast) && notes[nk].djForecast != null;
    });
  }, [rows, notes]);
  if (!hasNotes) return null;
  const onCopy = () => {
    const text = generateNotesSummary(rows, notes, hm, settings, { sortBy });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }).catch(() => alert("Clipboard not available. Use the download option."));
  };
  const onDownload = () => {
    const text = generateNotesSummary(rows, notes, hm, settings, { sortBy });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewals_notes_summary_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "seg-ctrl" }, /* @__PURE__ */ React.createElement("button", { className: `seg-ctrl-btn ${sortBy === "date" ? "active" : ""}`, onClick: () => setSortBy("date") }, "Date"), /* @__PURE__ */ React.createElement("button", { className: `seg-ctrl-btn ${sortBy === "atr" ? "active" : ""}`, onClick: () => setSortBy("atr") }, "ATR")), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-cyan", onClick: onCopy }, copied ? "Copied" : "Copy Summary"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: onDownload }, "Download .txt"));
}
function generateExecSummary(rows, notes, hm, settings, histData, histHM) {
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const hHM = histHM || {};
  const histQKey = hHM.FISCAL_QUARTER || hHM.YEAR_QUARTER || "FISCAL_QUARTER";
  const histAtrKey = hHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histCcKey = hHM.CC || "CC";
  const histAcctKey = hHM.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const histOwnerKey = hHM.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const histHealthKey = hHM.HEALTH || "CRM_HEALTH_STATUS";
  const histDoneKey = hHM.DONE_DEAL || "DONE_DEAL";
  const big = rows.filter((r) => toNumber(r[atrKey]) > 1e5);
  const byQtr = /* @__PURE__ */ new Map();
  big.forEach((r) => {
    const fq = safeString(r[qKey]) || "(Unknown)";
    if (!byQtr.has(fq)) byQtr.set(fq, []);
    byQtr.get(fq).push(r);
  });
  const histByQtr = /* @__PURE__ */ new Map();
  (histData || []).forEach((r) => {
    const atrV = toNumber(r[histAtrKey]);
    const ccV = toNumber(r[histCcKey]);
    if (atrV <= 1e5 && ccV <= 1e5) return;
    if (atrV <= 0 && ccV <= 0) return;
    const fq = safeString(r[histQKey]) || "(Unknown)";
    if (!histByQtr.has(fq)) histByQtr.set(fq, []);
    histByQtr.get(fq).push(r);
  });
  const quarters = Array.from(/* @__PURE__ */ new Set([...byQtr.keys(), ...histByQtr.keys()])).sort((a, b) => {
    const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
    return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
  });
  const fmtD = fmtCompact;
  const lines = [];
  lines.push("# Renewal Executive Summary");
  lines.push(`Generated: ${(/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} | Quarters: ${quarters.join(", ")}`);
  lines.push("");
  quarters.forEach((fq) => {
    const accts = (byQtr.get(fq) || []).sort((a, b) => toNumber(b[atrKey]) - toNumber(a[atrKey]));
    const histAccts = (histByQtr.get(fq) || []).sort((a, b) => toNumber(b[histCcKey]) - toNumber(a[histCcKey]));
    const totalAtr = accts.reduce((s, r) => s + toNumber(r[atrKey]), 0);
    const totalBu = accts.reduce((s, r) => s + toNumber(r[buKey]), 0);
    const histAtr = histAccts.reduce((s, r) => s + toNumber(r[histAtrKey]), 0);
    const histCC = histAccts.reduce((s, r) => s + toNumber(r[histCcKey]), 0);
    const fullAtr = totalAtr + histAtr;
    const expCC = histCC + totalBu;
    const hasHist = histAccts.length > 0;
    let djTotal = 0, djOverrides = 0, atRiskAtr = 0;
    accts.forEach((r) => {
      const bu = toNumber(r[buKey]);
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const djVal = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
      if (djVal !== null) {
        djTotal += djVal;
        djOverrides++;
      } else {
        djTotal += bu;
      }
      const h = safeString(r[healthKey]).toLowerCase();
      if (h === "red" || h === "churning") atRiskAtr += toNumber(r[atrKey]);
    });
    const acctCount = accts.length + histAccts.length;
    lines.push(`## ${fq} (ATR: ${fmtD(fullAtr)} | ${acctCount} accounts >$100K)`);
    lines.push("");
    lines.push("### Key Metrics");
    if (hasHist) {
      lines.push(`- Total ATR >$100K: ${fmtD(fullAtr)} (Pending ${fmtD(totalAtr)} \xB7 Closed ${fmtD(histAtr)})`);
      lines.push(`- Realized C/C (closed): ${fmtD(histCC)} (${histAccts.length} closed)`);
      lines.push(`- BU Forecast C/C (pending): ${fmtD(totalBu)}`);
      lines.push(`- Expected C/C Total: ${fmtD(expCC)}`);
      if (fullAtr > 0) lines.push(`- Expected Renewal Rate: ${((fullAtr - expCC) / fullAtr * 100).toFixed(1)}%`);
    } else {
      lines.push(`- Total ATR >$100K: ${fmtD(totalAtr)}`);
      lines.push(`- BU Forecast (C/C): ${fmtD(totalBu)}`);
    }
    lines.push(`- ELT Forecast (pending): ${fmtD(djTotal)} (${djOverrides} override${djOverrides !== 1 ? "s" : ""})`);
    const atRiskBase = totalAtr > 0 ? totalAtr : fullAtr;
    lines.push(`- At Risk (pending): ${fmtD(atRiskAtr)} (${atRiskBase > 0 ? (atRiskAtr / atRiskBase * 100).toFixed(1) : "0"}% of ${totalAtr > 0 ? "pending" : "total"} ATR)`);
    const pyQ = getPriorYearQuarter(fq);
    const pyData = pyQ && PRIOR_YEAR_DATA[pyQ] ? PRIOR_YEAR_DATA[pyQ].over : null;
    if (pyData) {
      const pyRate = pyData.atr > 0 ? (pyData.atr - pyData.cc) / pyData.atr * 100 : null;
      const cyRate = fullAtr > 0 ? (fullAtr - expCC) / fullAtr * 100 : null;
      lines.push(`- Prior Year C/C (${pyQ}): ${fmtD(pyData.cc)}`);
      const ccDelta = expCC - pyData.cc;
      lines.push(`- YoY C/C Change: ${ccDelta >= 0 ? "+" : "-"}${fmtD(Math.abs(ccDelta))}${ccDelta < 0 ? " (improvement)" : " (increase)"}`);
      if (pyRate != null) lines.push(`- Prior Year Renewal Rate: ${pyRate.toFixed(1)}%`);
      if (cyRate != null && pyRate != null) {
        const rrDelta = cyRate - pyRate;
        lines.push(`- YoY RR Change: ${rrDelta >= 0 ? "+" : ""}${rrDelta.toFixed(1)}pp`);
      }
    }
    lines.push("");
    if (accts.length > 0) {
      lines.push(hasHist ? "### Pending Renewals" : "### Account Detail");
      lines.push("| Account | Owner | ATR | BU FC | ELT FC | Health | Updated | Note |");
      lines.push("|---------|-------|-----|-------|-------|--------|---------|------|");
      accts.forEach((r) => {
        const nk = r.__noteKey;
        const note = nk ? notes[nk] : null;
        const djVal = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? fmtD(note.djForecast) : "--";
        const noteText = note && !note.archived ? safeString(note.note) : "";
        const truncNote = noteText.length > 100 ? noteText.slice(0, 100) + "..." : noteText || "--";
        const updated = note && note.updatedAt ? formatNoteDateShort(note.updatedAt) : "--";
        lines.push(`| ${safeString(r[acctKey]) || "(Unnamed)"} | ${safeString(r[ownerKey]) || "--"} | ${fmtD(toNumber(r[atrKey]))} | ${fmtD(toNumber(r[buKey]))} | ${djVal} | ${safeString(r[healthKey]) || "--"} | ${updated} | ${truncNote.replace(/\|/g, "/")} |`);
      });
      lines.push("");
    }
    if (hasHist) {
      lines.push("### Closed (Realized C/C)");
      lines.push("| Account | Owner | ATR | C/C | Health | Done |");
      lines.push("|---------|-------|-----|-----|--------|------|");
      histAccts.forEach((r) => {
        const done = safeString(r[histDoneKey]).toUpperCase() === "TRUE" ? "Yes" : "--";
        lines.push(`| ${safeString(r[histAcctKey]) || "(Unnamed)"} | ${safeString(r[histOwnerKey]) || "--"} | ${fmtD(toNumber(r[histAtrKey]))} | ${fmtD(toNumber(r[histCcKey]))} | ${safeString(r[histHealthKey]) || "--"} | ${done} |`);
      });
      lines.push("");
    }
  });
  return lines.join("\n");
}
function ExecSummaryExport({ rows }) {
  const { state } = useApp();
  const notes = state.notes || {};
  const hm = state.headerMap;
  const settings = state.settings;
  const histData = state.historicalData || [];
  const histHM = state.historicalHeaderMap || {};
  const atrKey = getAtrKey(hm, settings);
  const histAtrKeyLocal = histHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histCcKeyLocal = histHM.CC || "CC";
  const [copied, setCopied] = useState(false);
  const hasBig = useMemo(() => {
    if (rows.some((r) => toNumber(r[atrKey]) > 1e5)) return true;
    return histData.some((r) => toNumber(r[histAtrKeyLocal]) > 1e5 || toNumber(r[histCcKeyLocal]) > 1e5);
  }, [rows, atrKey, histData, histAtrKeyLocal, histCcKeyLocal]);
  if (!hasBig) return null;
  const onCopy = () => {
    const text = generateExecSummary(rows, notes, hm, settings, histData, histHM);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }).catch(() => alert("Clipboard not available."));
  };
  const onDownload = () => {
    const text = generateExecSummary(rows, notes, hm, settings, histData, histHM);
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `exec_summary_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo", onClick: onCopy }, copied ? "Copied" : "Exec Summary"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate text-[8px]", onClick: onDownload, title: "Download executive summary as markdown" }, ".md"));
}
function generateWeeklyUpdate(rows, notes, hm, settings, options = {}) {
  const { days = 7 } = options;
  const cutoff = Date.now() - days * 864e5;
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const fmtD = fmtCompact;
  const updatedRows = rows.filter((r) => {
    const nk = r.__noteKey;
    const note = nk ? notes[nk] : null;
    return note && !note.archived && note.updatedAt >= cutoff;
  });
  let newDjCount = 0, changedDjCount = 0, totalAtrCovered = 0;
  const byQtr = /* @__PURE__ */ new Map();
  updatedRows.forEach((r) => {
    const fq = safeString(r[qKey]) || "(Unknown)";
    if (!byQtr.has(fq)) byQtr.set(fq, []);
    byQtr.get(fq).push(r);
    totalAtrCovered += toNumber(r[atrKey]);
    const nk = r.__noteKey;
    const note = notes[nk];
    const hist = Array.isArray(note.history) ? note.history : [];
    if (note.djForecast != null && isFinite(note.djForecast)) {
      if (!hist.length || hist.every((h) => h.djForecast == null)) newDjCount++;
      else if (hist.length && hist[0].djForecast != null && hist[0].djForecast !== note.djForecast) changedDjCount++;
    }
  });
  const quarters = Array.from(byQtr.keys()).sort((a, b) => {
    const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
    return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
  });
  const startDate = new Date(cutoff);
  const endDate = /* @__PURE__ */ new Date();
  const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const lines = [];
  lines.push("# Weekly Renewals Update");
  lines.push(`Week of ${fmtDate(startDate)} - ${fmtDate(endDate)} ${endDate.getFullYear()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Notes updated: ${updatedRows.length} account${updatedRows.length !== 1 ? "s" : ""}`);
  lines.push(`- New ELT overrides set: ${newDjCount}`);
  lines.push(`- ELT overrides changed: ${changedDjCount}`);
  lines.push(`- Total ATR with notes updated: ${fmtD(totalAtrCovered)}`);
  lines.push("");
  if (quarters.length) {
    lines.push("## Changes This Week");
    lines.push("");
    quarters.forEach((fq) => {
      const accts = byQtr.get(fq).sort((a, b) => toNumber(b[atrKey]) - toNumber(a[atrKey]));
      lines.push(`### ${fq}`);
      accts.forEach((r) => {
        const nk = r.__noteKey;
        const note = notes[nk];
        const hist = Array.isArray(note.history) ? note.history : [];
        const health = safeString(r[healthKey]);
        const atr = fmtD(toNumber(r[atrKey]));
        const acctName = safeString(r[acctKey]) || "(Unnamed)";
        let djLine = "";
        if (note.djForecast != null && isFinite(note.djForecast)) {
          djLine = ` -- ELT: ${fmtD(note.djForecast)}`;
          if (hist.length && hist[0].djForecast != null && hist[0].djForecast !== note.djForecast) {
            djLine += ` (was ${fmtD(hist[0].djForecast)})`;
          }
          if (!hist.length) djLine += " [NEW]";
        }
        let tag = "";
        if (!hist.length) tag = " [NEW NOTE]";
        else if (hist.length && hist[0].djForecast != null && note.djForecast != null && hist[0].djForecast !== note.djForecast) tag = " [ELT CHANGED]";
        else tag = " [UPDATED]";
        lines.push(`- **${acctName}** (${atr}, ${health || "--"})${djLine}${tag}`);
        const noteText = safeString(note.note);
        if (noteText) {
          const truncated = noteText.length > 120 ? noteText.slice(0, 120) + "..." : noteText;
          lines.push(`  ${formatNoteDateShort(note.updatedAt)}: ${truncated}`);
        }
      });
      lines.push("");
    });
  }
  const riskRows = rows.filter((r) => {
    const atr = toNumber(r[atrKey]);
    if (atr <= 1e5) return false;
    const h = safeString(r[healthKey]).toLowerCase();
    return h === "red" || h === "churning";
  }).sort((a, b) => toNumber(b[atrKey]) - toNumber(a[atrKey]));
  if (riskRows.length) {
    lines.push("## At-Risk Watch (>$100K, Red/Churning)");
    lines.push("| Account | ATR | ELT FC | Note |");
    lines.push("|---------|-----|-------|------|");
    riskRows.forEach((r) => {
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const djVal = note && note.djForecast != null && isFinite(note.djForecast) ? fmtD(note.djForecast) : "--";
      const noteText = note ? safeString(note.note) : "";
      const truncNote = noteText.length > 80 ? noteText.slice(0, 80) + "..." : noteText || "--";
      lines.push(`| ${safeString(r[acctKey]) || "(Unnamed)"} | ${fmtD(toNumber(r[atrKey]))} | ${djVal} | ${truncNote.replace(/\|/g, "/")} |`);
    });
    lines.push("");
  }
  return lines.join("\n");
}
function WeeklyUpdateExport({ rows }) {
  const { state } = useApp();
  const notes = state.notes || {};
  const hm = state.headerMap;
  const settings = state.settings;
  const [days, setDays] = useState(7);
  const [copied, setCopied] = useState(false);
  const cutoff = Date.now() - days * 864e5;
  const hasUpdates = useMemo(() => rows.some((r) => {
    const nk = r.__noteKey;
    const note = nk ? notes[nk] : null;
    return note && !note.archived && note.updatedAt >= cutoff;
  }), [rows, notes, cutoff]);
  const onCopy = () => {
    const text = generateWeeklyUpdate(rows, notes, hm, settings, { days });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }).catch(() => alert("Clipboard not available."));
  };
  const onDownload = () => {
    const text = generateWeeklyUpdate(rows, notes, hm, settings, { days });
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly_update_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "seg-ctrl" }, [3, 7, 14].map((d) => /* @__PURE__ */ React.createElement("button", { key: d, className: `seg-ctrl-btn ${days === d ? "active" : ""}`, onClick: () => setDays(d) }, d, "d"))), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-amber", onClick: onCopy, disabled: !hasUpdates, title: hasUpdates ? "Copy weekly update to clipboard" : "No notes updated in this period" }, copied ? "Copied" : "Weekly Update"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate text-[8px]", onClick: onDownload, disabled: !hasUpdates, title: "Download weekly update as markdown" }, ".md"));
}
const HEALTH_COLORS = { good: "#22c55e", green: "#4ade80", healthy: "#4ade80", yellow: "#facc15", orange: "#f97316", amber: "#f97316", neutral: "#facc15", concerning: "#f97316", red: "#ef4444", churning: "#a855f7", unknown: "#94a3b8" };
const SEGMENT_COLORS = { digital: "#818cf8", smb: "#38bdf8", commercial: "#f59e0b", enterprise: "#10b981" };
const BAND_DEFS = [
  { key: "0-12k", label: "$0 \u2013 $12K", test: (v) => v > 0 && v <= 12e3, color: "#4ade80" },
  { key: "12-100k", label: "$12K \u2013 $100K", test: (v) => v > 12e3 && v <= 1e5, color: "#facc15" },
  { key: "100k+", label: "$100K+", test: (v) => v > 1e5, color: "#818cf8" }
];
function HBar({ items, colorMap, showCounts }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex h-4 rounded-full overflow-hidden mb-2" }, items.filter((i) => i.value > 0).map((i) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: i.key,
      title: `${i.label}: ${i.value.toLocaleString()}`,
      style: { width: `${(i.value / total * 100).toFixed(1)}%`, background: i.color, minWidth: i.value > 0 ? 2 : 0 }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400" }, items.filter((i) => i.value > 0).map((i) => /* @__PURE__ */ React.createElement("span", { key: i.key, className: "flex items-center gap-1" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block w-2 h-2 rounded-full", style: { background: i.color } }), i.label, " ", showCounts !== false && /* @__PURE__ */ React.createElement("span", { className: "tabular-nums font-medium text-gray-700 dark:text-gray-200" }, i.value.toLocaleString())))));
}
function TopList({ items, maxItems = 5 }) {
  const show = items.slice(0, maxItems);
  const best = show[0]?.value || 1;
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, show.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: it.key || i, className: "flex items-center gap-2 text-xs" }, /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-w-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between mb-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "truncate text-gray-700 dark:text-gray-200" }, it.label), /* @__PURE__ */ React.createElement("span", { className: "tabular-nums font-medium shrink-0 ml-2 text-gray-500 dark:text-gray-400" }, it.value.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "h-1.5 rounded-full glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "h-full rounded-full bg-indigo-400 dark:bg-indigo-500", style: { width: `${(it.value / best * 100).toFixed(0)}%` } }))))));
}
function generateQuarterExecSummary(quarter, state, bandFilter, histBandFilter, segmentLabel) {
  const _bandFilter = typeof bandFilter === "function" ? bandFilter : () => true;
  const _histBandFilter = typeof histBandFilter === "function" ? histBandFilter : () => true;
  const _segLabel = segmentLabel || "All Accounts";
  const esc = escapeHtml;
  const fmtD = fmtCompact;
  const pctF = (v, d = 1) => v != null && isFinite(v) ? `${v.toFixed(d)}%` : "\u2014";
  const genDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const hm = state.headerMap, settings = state.settings;
  const atrKey = getAtrKey(hm, settings), buKey = getBuKey(hm, settings);
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME", healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME", dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const fcSummaryKey = hm.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const subregionKey = hm.SUBREGION || "PRO_FORMA_SUBREGION";
  const hHM = state.historicalHeaderMap || {};
  const ccKeyH = hHM.CC || "CC", histAtrKey = hHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histQKey = hHM.FISCAL_QUARTER || hHM.YEAR_QUARTER || "FISCAL_QUARTER";
  const histAcctKey = hHM.ACCOUNT_NAME || "CRM_ACCOUNT_NAME", histHealthKey = hHM.HEALTH || "CRM_HEALTH_STATUS";
  const histDoneKey = hHM.DONE_DEAL || "DONE_DEAL", histExpKey = hHM.EXPANSION || "EXPANSION";
  const histOwnerKey = hHM.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const notes = state.notes || {}, histData = state.historicalData || [], ccData = state.ccData || {};
  const rateTarget = state.rateTargets?.[quarter];
  const act = (state.data || []).filter((r) => safeString(r[qKey]) === quarter && toNumber(r[atrKey]) > 0 && _bandFilter(r));
  const hist = histData.filter((r) => {
    const q = safeString(r[histQKey]);
    return q === quarter && (toNumber(r[histAtrKey]) > 0 || toNumber(r[ccKeyH]) > 0 || toNumber(r[histExpKey]) > 0) && _histBandFilter(r);
  });
  const atr = act.reduce((s, r) => s + toNumber(r[atrKey]), 0), buFC = act.reduce((s, r) => s + toNumber(r[buKey]), 0);
  const hAtr = hist.reduce((s, r) => s + toNumber(r[histAtrKey]), 0), hCC = hist.reduce((s, r) => s + toNumber(r[ccKeyH]), 0);
  const hExp = hist.reduce((s, r) => s + toNumber(r[histExpKey]), 0);
  const hDone = hist.filter((r) => safeString(r[histDoneKey]).toUpperCase() === "TRUE").length;
  const base = hAtr > 0 ? hAtr : atr, expCC = hCC + buFC;
  const rate = base > 0 ? (base - expCC) / base * 100 : null;
  const attain = rate != null && rateTarget > 0 ? rate / rateTarget * 100 : null;
  const payout = getPayoutPct(attain);
  const pyQ = getPriorYearQuarter(quarter);
  const pyAll = pyQ && PRIOR_YEAR_DATA[pyQ] ? PRIOR_YEAR_DATA[pyQ].all : null;
  const pyOver = pyQ && PRIOR_YEAR_DATA[pyQ] ? PRIOR_YEAR_DATA[pyQ].over : null;
  const pyRateAll = pyAll && pyAll.atr > 0 ? (pyAll.atr - pyAll.cc) / pyAll.atr * 100 : null;
  const pyRateOver = pyOver && pyOver.atr > 0 ? (pyOver.atr - pyOver.cc) / pyOver.atr * 100 : null;
  const cyRateForYoY = rate;
  const yoyCCDelta = pyAll ? expCC - pyAll.cc : null;
  const yoyRRDelta = cyRateForYoY != null && pyRateAll != null ? cyRateForYoY - pyRateAll : null;
  const RISK_KW = /risk|churn|cancel|downsell|downgrade|at.risk|lost|leaving/i;
  const accts = act.sort((a, b) => toNumber(b[atrKey]) - toNumber(a[atrKey])).map((r) => {
    const nk = r.__noteKey;
    const n = nk && notes[nk] ? notes[nk] : {};
    const djRaw = n.djForecast;
    const djNum = djRaw != null && isFinite(toNumber(djRaw)) ? toNumber(djRaw) : null;
    const h = safeString(r[healthKey]);
    return { name: safeString(r[acctKey]), atr: toNumber(r[atrKey]), bu: toNumber(r[buKey]), h, own: safeString(r[ownerKey]), sub: safeString(r[subregionKey]), dt: safeString(r[dateKey]), fc: safeString(r[fcSummaryKey]), noteText: safeString(n.note), dj: djNum, updatedAt: n.updatedAt || null, archived: !!n.archived };
  });
  const riskAccts = accts.filter((a) => {
    const hl = a.h.toLowerCase();
    if (hl === "red" || hl === "churning") return true;
    if (a.atr > 1e5 && a.bu > 0 && a.bu / a.atr > 0.05) return true;
    if (RISK_KW.test(a.fc)) return true;
    return false;
  });
  const riskATR = riskAccts.reduce((s, a) => s + a.atr, 0);
  const churningAccts = accts.filter((a) => a.h.toLowerCase() === "churning").sort((a, b) => b.bu - a.bu);
  const redAccts = accts.filter((a) => a.h.toLowerCase() === "red").sort((a, b) => b.bu - a.bu);
  const churnHist = hist.filter((r) => toNumber(r[ccKeyH]) > 0).sort((a, b) => toNumber(b[ccKeyH]) - toNumber(a[ccKeyH])).map((r) => ({
    name: safeString(r[histAcctKey]),
    atr: toNumber(r[histAtrKey]),
    cc: toNumber(r[ccKeyH]),
    h: safeString(r[histHealthKey]),
    own: safeString(r[histOwnerKey]),
    done: safeString(r[histDoneKey]).toUpperCase() === "TRUE"
  }));
  const expA = hist.filter((r) => toNumber(r[histExpKey]) > 0).sort((a, b) => toNumber(b[histExpKey]) - toNumber(a[histExpKey])).map((r) => ({
    name: safeString(r[histAcctKey]),
    exp: toNumber(r[histExpKey]),
    h: safeString(r[histHealthKey]),
    done: safeString(r[histDoneKey]).toUpperCase() === "TRUE"
  }));
  let djTotal = 0, djOverrides = 0;
  accts.forEach((a) => {
    if (a.dj != null && !a.archived) {
      djTotal += a.dj;
      djOverrides++;
    } else {
      djTotal += a.bu;
    }
  });
  const histSubregionKey = hHM.SUBREGION || "PRO_FORMA_SUBREGION";
  const subregionMap = {};
  const ensureSub = (s) => {
    if (!subregionMap[s]) subregionMap[s] = { name: s, atr: 0, bu: 0, dj: 0, bookedCC: 0, bookedCount: 0, count: 0, redCount: 0, redAtr: 0, histAtr: 0, exp: 0, expCount: 0 };
  };
  accts.forEach((a) => {
    const s = a.sub || "Unknown";
    ensureSub(s);
    subregionMap[s].atr += a.atr;
    subregionMap[s].bu += a.bu;
    subregionMap[s].count++;
    subregionMap[s].dj += a.dj != null && !a.archived ? a.dj : a.bu;
    if (a.h.toLowerCase() === "red") {
      subregionMap[s].redCount++;
      subregionMap[s].redAtr += a.atr;
    }
  });
  hist.forEach((r) => {
    const s = safeString(r[histSubregionKey]) || "Unknown";
    ensureSub(s);
    const cc = toNumber(r[ccKeyH]), hAtrVal = toNumber(r[histAtrKey]), expVal = toNumber(r[histExpKey]);
    if (hAtrVal > 0) subregionMap[s].histAtr += hAtrVal;
    if (cc > 0) {
      subregionMap[s].bookedCC += cc;
      subregionMap[s].bookedCount++;
      subregionMap[s].dj += cc;
    }
    if (expVal > 0) {
      subregionMap[s].exp += expVal;
      subregionMap[s].expCount++;
    }
  });
  Object.values(subregionMap).forEach((o) => {
    const totalCC = (o.bookedCC || 0) + o.bu;
    o.fullAtr = o.atr + (o.histAtr || 0);
    o.totalCC = totalCC;
    o.rr = o.fullAtr > 0 ? (o.fullAtr - totalCC) / o.fullAtr * 100 : null;
    o.avgCC = o.count + (o.bookedCount || 0) > 0 ? totalCC / (o.count + (o.bookedCount || 0)) : 0;
    o.avgExp = o.expCount > 0 ? o.exp / o.expCount : 0;
  });
  const subregions = Object.values(subregionMap).sort((a, b) => b.fullAtr - a.fullAtr);
  const healthAtr = {};
  accts.forEach((a) => {
    const h = a.h.toLowerCase() || "unknown";
    healthAtr[h] = (healthAtr[h] || 0) + a.atr;
  });
  const hColors = { good: "#22c55e", green: "#4ade80", healthy: "#4ade80", yellow: "#facc15", orange: "#f97316", neutral: "#facc15", concerning: "#f97316", red: "#ef4444", churning: "#a855f7", unknown: "#94a3b8" };
  const healthItems = Object.entries(healthAtr).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: hColors[k] || "#94a3b8" }));
  const healthTotal = healthItems.reduce((s, i) => s + i.value, 0) || 1;
  const gap = rate != null && rateTarget != null ? rate - rateTarget : null;
  const gapDir = gap != null ? gap >= 0 ? "above" : "below" : null;
  const qCC = ccData[quarter] || {};
  const calls = { regional: qCC.regional || null, cco: qCC.cco || null, rvp: qCC.rvp || null, dj: qCC.dj || null };
  const buildInlineGroup = (rows, label, valFn) => {
    if (!rows.length) return "";
    const total = rows.reduce((s, a) => s + valFn(a), 0);
    const top5 = rows.slice(0, 5), rest = rows.slice(5);
    let line = `${label} [${rows.length} | ${fmtD(total)} Total]:  `;
    line += top5.map((a) => `${a.name} [${fmtD(valFn(a))}]`).join(",  ");
    if (rest.length > 0) {
      const t = rest.reduce((s, a) => s + valFn(a), 0);
      line += `  + ${rest.length} other (${fmtD(t)} total | Avg ${fmtD(t / rest.length)})`;
    }
    return line;
  };
  const budgetTarget = calls.regional;
  const sfPlain = [];
  const sfHtml = [];
  {
    const segShort = _segLabel === ">100K" ? "100K+" : _segLabel;
    let headBold = `${esc(quarter)} ${esc(segShort)} C/C FC is ${esc(fmtD(expCC))}`;
    let headPlain = `${quarter} ${segShort} C/C FC is ${fmtD(expCC)}`;
    const headParts = [];
    if (budgetTarget != null) headParts.push(`TGT ${fmtD(budgetTarget)}`);
    if (pyAll && pyAll.cc > 0) {
      const ccYoy = (expCC - pyAll.cc) / pyAll.cc * 100;
      headParts.push(`${ccYoy >= 0 ? "+" : ""}${ccYoy.toFixed(0)}% YoY`);
      headParts.push(`LY ${fmtD(pyAll.cc)}`);
    }
    const restStr = headParts.length > 0 ? " | " + headParts.join(" | ") : "";
    let tail = restStr + ".";
    if (rate != null) {
      tail += `  RR = ${pctF(rate)}`;
      if (rateTarget != null) {
        const vTgt = rate - rateTarget;
        tail += ` | TGT ${pctF(rateTarget)} [${vTgt >= 0 ? "+" : ""}${vTgt.toFixed(1)}pp]`;
      }
      if (pyRateAll != null) {
        const rrYoy = rate - pyRateAll;
        tail += ` | ${rrYoy >= 0 ? "+" : ""}${rrYoy.toFixed(1)}pp YoY | LY ${pctF(pyRateAll)}`;
      }
      tail += ".";
    }
    const closedPct = expCC > 0 ? Math.round(hCC / expCC * 100) : 0;
    tail += `  Closed C/C: ${fmtD(hCC)} (${closedPct}% of total ${fmtD(expCC)}) with FC Remaining ${fmtD(buFC)}.`;
    const djLanding = calls.dj != null && isFinite(calls.dj) ? calls.dj : hCC + djTotal;
    if (isFinite(djLanding)) tail += `  Expecting to land ${fmtD(djLanding)}.`;
    if (hExp > 0) {
      const avgExp = expA.length > 0 ? hExp / expA.length : 0;
      tail += `  Expansion ${fmtD(hExp)} (${expA.length} deal${expA.length !== 1 ? "s" : ""} | Avg ${fmtD(avgExp)})`;
      if (pyAll && pyAll.exp != null && pyAll.exp > 0) {
        const expYoy = (hExp - pyAll.exp) / pyAll.exp * 100;
        tail += ` | ${expYoy >= 0 ? "+" : ""}${expYoy.toFixed(0)}% YoY | LY ${fmtD(pyAll.exp)}`;
      }
      tail += ".";
    }
    sfPlain.push(headPlain + tail);
    sfHtml.push(`<b>${headBold}</b>${esc(tail)}`);
  }
  const buildInlineGroupHtml = (rows, label, valFn) => {
    if (!rows.length) return null;
    const total = rows.reduce((s, a) => s + valFn(a), 0);
    const top5 = rows.slice(0, 5), rest = rows.slice(5);
    const labelPart = `${label} [${rows.length} | ${fmtD(total)} Total]:`;
    const acctPart = "  " + top5.map((a) => `${a.name} [${fmtD(valFn(a))}]`).join(",  ");
    let restPart = "";
    if (rest.length > 0) {
      const t = rest.reduce((s, a) => s + valFn(a), 0);
      restPart = `  + ${rest.length} other (${fmtD(t)} total | Avg ${fmtD(t / rest.length)})`;
    }
    return { plain: labelPart + acctPart + restPart, html: `<b>${esc(labelPart)}</b>${esc(acctPart + restPart)}` };
  };
  {
    const churnG = buildInlineGroupHtml(churningAccts, "Churning", (a) => a.bu);
    const redG = buildInlineGroupHtml(redAccts, "At-Risk (Red)", (a) => a.bu);
    if (churnG || redG) {
      let plainParts = [], htmlParts = [];
      if (churnG) {
        plainParts.push(churnG.plain);
        htmlParts.push(churnG.html);
      }
      if (redG) {
        plainParts.push(redG.plain);
        htmlParts.push(redG.html);
      }
      sfPlain.push(plainParts.join("  "));
      sfHtml.push(htmlParts.join("&nbsp;&nbsp;"));
    }
  }
  if (expA.length > 0) {
    const expG = buildInlineGroupHtml(expA, "Expansion", (a) => a.exp);
    if (expG) {
      sfPlain.push(expG.plain);
      sfHtml.push(expG.html);
    }
  }
  {
    const redNotChurning = accts.filter((a) => {
      const hl = a.h.toLowerCase();
      return hl === "red" && a.bu > 0;
    }).sort((a, b) => b.bu - a.bu).slice(0, 5);
    if (redNotChurning.length > 0) {
      const noteParts = redNotChurning.map((a) => {
        const entries = parseNoteEntries(a.noteText);
        const latest = entries.length > 0 ? entries[0] : null;
        const noteSnippet = latest ? latest.text.replace(/\n/g, " ").slice(0, 150) : "(no note)";
        const datePart = latest && latest.date ? " (" + latest.date + ")" : "";
        const ellipsis = noteSnippet.length >= 150 ? "..." : "";
        return {
          plain: a.name + " [" + fmtD(a.bu) + " BUFC]:  " + noteSnippet + ellipsis + datePart,
          html: "<b>" + esc(a.name) + " [" + esc(fmtD(a.bu)) + " BUFC]:</b>&nbsp;&nbsp;" + esc(noteSnippet + ellipsis) + esc(datePart)
        };
      });
      sfPlain.push("Red Health - Latest Notes:  " + noteParts.map((p) => p.plain).join("  "));
      sfHtml.push("<b>Red Health - Latest Notes:</b>&nbsp;&nbsp;" + noteParts.map((p) => p.html).join("&nbsp;&nbsp;"));
    }
  }
  const salesFcText = sfPlain.join("\n");
  const salesFcHtmlBody = sfHtml.join("\n");
  const slackHtml = `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px;position:relative">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#92400e">Exec Summary</span>
          <button onclick="navigator.clipboard.writeText(document.getElementById('sales-fc-plain').dataset.text).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})" style="font-size:10px;font-weight:600;padding:3px 10px;background:#d97706;color:#fff;border:none;border-radius:4px;cursor:pointer">Copy</button>
        </div>
        <div id="sales-fc-plain" data-text="${esc(salesFcText)}" style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#451a03;margin:0">${salesFcHtmlBody}</div>
      </div>`;
  const kpiCards = [];
  kpiCards.push({ label: "Renewal Rate", val: pctF(rate), detail: gap != null ? (gap >= 0 ? "+" : "") + gap.toFixed(1) + "pp vs " + pctF(rateTarget) : void 0, color: rate != null && rateTarget != null ? rate >= rateTarget ? "#22c55e" : "#ef4444" : "#4f46e5" });
  kpiCards.push({ label: "Expected C/C", val: fmtD(expCC), detail: `${fmtD(hCC)} closed + ${fmtD(buFC)} FC`, color: "#ef4444" });
  kpiCards.push({ label: "ELT Forecast", val: fmtD(djTotal), detail: djOverrides > 0 ? `${djOverrides} override${djOverrides !== 1 ? "s" : ""}` : void 0, color: "#8b5cf6" });
  kpiCards.push({ label: "Attainment", val: pctF(attain), detail: payout != null ? `${payout}% payout` : void 0, color: attain != null && attain >= 100 ? "#22c55e" : "#f59e0b" });
  kpiCards.push({ label: "Active Book", val: fmtD(atr), detail: `${accts.length} accounts${hExp > 0 ? ", " + fmtD(hExp) + " exp" : ""}`, color: "#4f46e5" });
  kpiCards.push({ label: "At Risk", val: fmtD(riskATR), detail: `${riskAccts.length} accounts (${atr > 0 ? (riskATR / atr * 100).toFixed(1) : "0"}%)`, color: "#ef4444" });
  if (pyAll) kpiCards.push({ label: `YoY vs ${pyQ}`, val: yoyRRDelta != null ? (yoyRRDelta >= 0 ? "+" : "") + yoyRRDelta.toFixed(1) + "pp" : "\u2014", detail: `PY RR: ${pctF(pyRateAll)} \xB7 PY C/C: ${fmtD(pyAll.cc)}`, color: yoyRRDelta != null && yoyRRDelta >= 0 ? "#22c55e" : "#ef4444" });
  const badgeHtml = (h) => {
    const col = hColors[(h || "").toLowerCase()] || "#94a3b8";
    return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;color:#fff;background:${col}">${esc(h || "\u2014")}</span>`;
  };
  const acctRow = (a) => {
    const noteDisp = a.noteText && !a.archived ? a.noteText.length > 150 ? a.noteText.slice(0, 150) + "..." : a.noteText : "\u2014";
    const updated = a.updatedAt ? new Date(a.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "\u2014";
    return `<tr><td style="font-weight:500">${esc(a.name)}</td><td class="r">${fmtD(a.atr)}</td><td class="r">${fmtD(a.bu)}</td><td class="r">${a.dj != null ? fmtD(a.dj) : "\u2014"}</td><td>${badgeHtml(a.h)}</td><td>${esc(a.own || "\u2014")}</td><td style="white-space:nowrap;font-size:10px;color:#9ca3af">${updated}</td><td class="note-cell" title="${esc(a.noteText || "")}">${esc(noteDisp)}</td></tr>`;
  };
  const waterfallHtml = (() => {
    const closedNames = new Set(churnHist.map((a) => a.name));
    const combined = [];
    churnHist.forEach((a) => {
      combined.push({ label: a.name, value: a.cc, src: "closed", dj: null });
    });
    accts.filter((a) => a.bu > 0 && !closedNames.has(a.name)).forEach((a) => {
      const dj = a.dj != null && !a.archived && Math.round(a.dj) !== Math.round(a.bu) ? a.dj : null;
      combined.push({ label: a.name, value: a.bu, src: "forecast", dj });
    });
    combined.sort((a, b) => b.value - a.value);
    const top = combined.slice(0, 10), rest = combined.slice(10);
    const restSum = rest.reduce((s, a) => s + a.value, 0);
    const restDjSum = rest.reduce((s, a) => s + (a.dj != null ? a.dj : a.value), 0);
    const restHasDj = rest.some((a) => a.dj != null);
    const totalCC = combined.reduce((s, a) => s + a.value, 0);
    const totalDjAggregate = combined.reduce((s, a) => s + (a.dj != null ? a.dj : a.value), 0);
    const djCallSet = calls && calls.dj != null && isFinite(calls.dj);
    const totalDj = djCallSet ? calls.dj : totalDjAggregate;
    const totalHasDj = djCallSet || combined.some((a) => a.dj != null);
    const bars = [{ label: "Total C/C", value: totalCC, deduct: 0, isTotal: true, dj: totalHasDj ? totalDj : null, djSource: djCallSet ? "call" : "agg" }];
    let consumed = 0;
    top.forEach((a) => {
      const lbl = a.label.length > 18 ? a.label.slice(0, 16) + "\u2026" : a.label;
      bars.push({ label: lbl + (a.src === "closed" ? " \u2713" : ""), value: a.value, deduct: consumed, src: a.src, dj: a.dj });
      consumed += a.value;
    });
    if (restSum > 0) {
      const allOthersDj = restHasDj && Math.round(restDjSum) !== Math.round(restSum) ? restDjSum : null;
      bars.push({ label: "All Others (" + rest.length + ")", value: restSum, deduct: consumed, src: "others", dj: allOthersDj });
      consumed += restSum;
    }
    const djAccountCount = combined.filter((a) => a.dj != null).length;
    const n = bars.length;
    const chartW = Math.max(900, n * 80 + 100), chartH = 360, padL = 65, padR = 20, padT = 35, padB = 100;
    const plotW = chartW - padL - padR, plotH = chartH - padT - padB;
    const barW = Math.min(55, Math.floor(plotW / n * 0.6));
    const stepW = plotW / n;
    const maxVal = Math.max(totalCC, totalDj) * 1.08 || 1;
    const sc = (v) => v / maxVal * plotH;
    const fV = (v) => {
      if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
      if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
      return "$" + Math.round(v);
    };
    const fillTotal = "#4f46e5";
    const fillBu = "#ef4444";
    const fillClosed = "#6366f1";
    const fillOthers = "#94a3b8";
    const djColor = "#8b5cf6";
    const fillFor = (b) => b.src === "closed" ? fillClosed : b.src === "others" ? fillOthers : fillBu;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + chartW + " " + chartH + '" style="width:100%;max-width:' + chartW + 'px;height:auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">';
    const gridN = 5;
    for (let i = 0; i <= gridN; i++) {
      const y = padT + plotH / gridN * i;
      const val = maxVal - maxVal / gridN * i;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (chartW - padR) + '" y2="' + y + '" stroke="#f1f5f9" stroke-width="1"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="#94a3b8" font-size="9">' + fV(val) + "</text>";
    }
    bars.forEach((b, i) => {
      const cx = padL + i * stepW + stepW / 2;
      const x = cx - barW / 2;
      if (b.isTotal) {
        const barH = sc(b.value);
        if (b.dj != null) {
          const subW = Math.max((barW - 2) / 2, 4);
          const xBu = cx - subW - 1;
          const xDj = cx + 1;
          const djH = sc(b.dj);
          svg += '<rect x="' + xBu + '" y="' + padT + '" width="' + subW + '" height="' + Math.max(barH, 1) + '" rx="2" fill="' + fillTotal + '" opacity="0.9"/>';
          svg += '<rect x="' + xDj + '" y="' + padT + '" width="' + subW + '" height="' + Math.max(djH, 1) + '" rx="2" fill="' + djColor + '" opacity="0.9"/>';
          const bottomY = padT + Math.max(barH, djH);
          const djLabel = b.djSource === "call" ? "ELT Call" : "ELT";
          svg += '<text x="' + cx + '" y="' + (bottomY + 12) + '" text-anchor="middle" fill="' + fillTotal + '" font-size="9" font-weight="700">' + fV(b.value) + "</text>";
          svg += '<text x="' + cx + '" y="' + (bottomY + 22) + '" text-anchor="middle" fill="' + djColor + '" font-size="9" font-weight="700">' + djLabel + " " + fV(b.dj) + "</text>";
        } else {
          svg += '<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + Math.max(barH, 1) + '" rx="2" fill="' + fillTotal + '" opacity="0.85"/>';
          svg += '<text x="' + cx + '" y="' + (padT + barH + 14) + '" text-anchor="middle" fill="' + fillTotal + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
        }
      } else {
        const remaining = totalCC - b.deduct;
        const remAfter = remaining - b.value;
        const barH = sc(remaining);
        const colorH = sc(b.value);
        const grayH = sc(remAfter);
        const fill = fillFor(b);
        svg += '<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + Math.max(grayH, 0) + '" rx="2" fill="#e2e8f0" opacity="0.5"/>';
        if (b.dj != null) {
          const subW = Math.max((barW - 2) / 2, 4);
          const xBu = cx - subW - 1;
          const xDj = cx + 1;
          const djH = sc(b.dj);
          svg += '<rect x="' + xBu + '" y="' + (padT + grayH) + '" width="' + subW + '" height="' + Math.max(colorH, 1) + '" rx="2" fill="' + fill + '" opacity="0.9"/>';
          svg += '<rect x="' + xDj + '" y="' + (padT + grayH) + '" width="' + subW + '" height="' + Math.max(djH, 1) + '" rx="2" fill="' + djColor + '" opacity="0.9"/>';
          const bottomY = padT + grayH + Math.max(colorH, djH);
          svg += '<text x="' + cx + '" y="' + (bottomY + 12) + '" text-anchor="middle" fill="' + fill + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
          svg += '<text x="' + cx + '" y="' + (bottomY + 22) + '" text-anchor="middle" fill="' + djColor + '" font-size="9" font-weight="600">ELT ' + fV(b.dj) + "</text>";
        } else {
          svg += '<rect x="' + x + '" y="' + (padT + grayH) + '" width="' + barW + '" height="' + Math.max(colorH, 1) + '" rx="2" fill="' + fill + '" opacity="0.9"/>';
          svg += '<text x="' + cx + '" y="' + (padT + barH + 14) + '" text-anchor="middle" fill="' + fill + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
        }
        if (i > 0) {
          const prevCx = padL + (i - 1) * stepW + stepW / 2;
          const prevBar = bars[i - 1];
          const connY = prevBar.isTotal ? padT + sc(prevBar.value) : padT + sc(totalCC - prevBar.deduct);
          svg += '<line x1="' + (prevCx + barW / 2) + '" y1="' + connY + '" x2="' + (cx - barW / 2) + '" y2="' + connY + '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,2"/>';
        }
      }
      svg += '<text x="' + cx + '" y="' + (padT + plotH + 30) + '" text-anchor="middle" fill="#475569" font-size="8" font-weight="500" transform="rotate(-30,' + cx + "," + (padT + plotH + 30) + ')">' + esc(b.label) + "</text>";
    });
    svg += "</svg>";
    const closedCount = combined.filter((a) => a.src === "closed").length;
    const fcCount = combined.filter((a) => a.src === "forecast").length;
    const swatch = (c) => '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + c + ';vertical-align:middle;margin-right:4px"></span>';
    const djLegendLabel = djCallSet ? "ELT Call total (" + fV(calls.dj) + (djAccountCount > 0 ? " \xB7 " + djAccountCount + " override" + (djAccountCount !== 1 ? "s" : "") : "") + ")" : djAccountCount > 0 ? "ELT Forecast (" + djAccountCount + ")" : null;
    const legendHtml = '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:6px;font-size:10px;color:#64748b">' + (closedCount > 0 ? "<span>" + swatch(fillClosed) + "Closed/Booked (" + closedCount + ")</span>" : "") + "<span>" + swatch(fillBu) + "BU Forecast (" + fcCount + ")</span>" + (djLegendLabel ? "<span>" + swatch(djColor) + djLegendLabel + "</span>" : "") + "<span>" + swatch(fillOthers) + 'All Others</span><span style="color:#94a3b8">\u2713 = booked</span></div>';
    return '<div style="margin:20px 0 24px;border:1px solid #e5e7eb;border-radius:8px;padding:16px 12px 8px;background:#fafbfc"><div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">C/C Breakdown \u2014 Booked + Forecast</div>' + svg + legendHtml + "</div>";
  })();
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Exec Summary - ${esc(quarter)} ${esc(_segLabel)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1f2937;padding:40px;max-width:1200px;margin:0 auto;font-size:13px;line-height:1.5}
h1{font-size:20px;font-weight:700;margin-bottom:4px}
h2{font-size:14px;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
.sub{font-size:11px;color:#6b7280;margin-bottom:24px}
.kpi-row{display:grid;grid-template-columns:repeat(${kpiCards.length},1fr);gap:12px;margin-bottom:24px}
.kpi{border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
.kpi .label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;font-weight:600}
.kpi .val{font-size:22px;font-weight:700}
.kpi .detail{font-size:10px;color:#9ca3af;margin-top:2px}
.cards{display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:8px}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:14px}
.card h3{font-size:12px;font-weight:700;margin-bottom:8px}
.bar-track{height:10px;border-radius:5px;background:#f3f4f6;overflow:hidden;display:flex;margin-bottom:8px}
.legend{display:flex;flex-wrap:wrap;gap:8px;font-size:10px}
.legend-item{display:flex;align-items:center;gap:4px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
th{background:#f9fafb;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb}
td{padding:6px 10px;border-bottom:1px solid #f3f4f6}
.r{text-align:right}
tr:hover{background:#f9fafb}
.note-cell{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#64748b}
.headline{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:13px;line-height:1.6}
.headline.risk{background:#fef2f2;border-color:#fecaca}
@media print{body{padding:20px;font-size:11px}.kpi .val{font-size:16px}h2{break-before:auto}}
</style></head><body>
<h1>Renewals Executive Summary \u2014 ${esc(_segLabel)}</h1>
<p class="sub">${esc(quarter)} &middot; ${esc(_segLabel)} &middot; ${genDate}</p>

${slackHtml}

${waterfallHtml}

<div class="headline${riskAccts.length > 0 ? " risk" : ""}">
${rate != null && rateTarget != null ? `<strong>${esc(quarter)}</strong> is tracking <strong>${Math.abs(gap).toFixed(1)}pp ${gapDir}</strong> target at <strong>${pctF(rate)}</strong> renewal rate on a ${fmtD(base)} ATR base.${riskAccts.length > 0 ? ' <span style="color:#ef4444">' + riskAccts.length + " accounts (" + fmtD(riskATR) + " ATR) flagged at risk.</span>" : " No accounts flagged at risk."}` : rate != null ? `<strong>${esc(quarter)}</strong> renewal rate: <strong>${pctF(rate)}</strong> on ${fmtD(base)} ATR base.` : `<strong>${esc(quarter)}</strong>: No rate data available yet.`}
</div>

<div class="kpi-row">
${kpiCards.map((c) => `<div class="kpi">
  <div class="label" style="color:${c.color}">${c.label}</div>
  <div class="val">${c.val}</div>
  ${c.detail ? `<div class="detail">${esc(c.detail)}</div>` : ""}
</div>`).join("\n")}
</div>

<div class="cards">
  <div class="card">
    <h3>Health Mix (by ATR)</h3>
    <div class="bar-track">${healthItems.map((h) => `<div style="width:${(h.value / healthTotal * 100).toFixed(1)}%;background:${h.color}" title="${esc(h.label)}: ${fmtD(h.value)}"></div>`).join("")}</div>
    <div class="legend">${healthItems.map((h) => `<span class="legend-item"><span class="dot" style="background:${h.color}"></span>${esc(h.label)} <span style="color:#9ca3af">${fmtD(h.value)}</span></span>`).join("")}</div>
  </div>
</div>

<h2>By Sub Region</h2>
<table>
<tr><th>Sub Region</th><th class="r">#</th><th class="r">ATR</th><th class="r">Booked C/C</th><th class="r">BU FC</th><th class="r">ELT Call</th><th class="r">Total C/C</th><th class="r">Avg C/C</th><th class="r">RR%</th><th class="r">Expansion</th><th class="r">Avg Exp</th><th class="r">Red #</th><th class="r">Red ATR</th></tr>
${subregions.slice(0, 15).map((o) => `<tr><td style="font-weight:500">${esc(o.name)}</td><td class="r">${o.count + (o.bookedCount || 0)}</td><td class="r">${fmtD(o.fullAtr)}</td><td class="r" style="color:#6366f1;font-weight:500">${o.bookedCC > 0 ? fmtD(o.bookedCC) : "\u2014"}</td><td class="r" style="color:#d97706">${o.bu > 0 ? fmtD(o.bu) : "\u2014"}</td><td class="r" style="color:#8b5cf6">${o.dj > 0 ? fmtD(o.dj) : "\u2014"}</td><td class="r" style="font-weight:600">${fmtD(o.totalCC)}</td><td class="r">${o.avgCC > 0 ? fmtD(o.avgCC) : "\u2014"}</td><td class="r" style="color:${o.rr != null && o.rr < 80 ? "#ef4444" : o.rr != null && o.rr < 90 ? "#f59e0b" : "#22c55e"};font-weight:600">${o.rr != null ? o.rr.toFixed(1) + "%" : "\u2014"}</td><td class="r" style="color:#2563eb">${o.exp > 0 ? fmtD(o.exp) : "\u2014"}</td><td class="r" style="color:#2563eb">${o.avgExp > 0 ? fmtD(o.avgExp) : "\u2014"}</td><td class="r"${o.redCount > 0 ? ' style="color:#ef4444;font-weight:600"' : ""}>${o.redCount}</td><td class="r"${o.redAtr > 0 ? ' style="color:#ef4444;font-weight:600"' : ""}>${o.redAtr > 0 ? fmtD(o.redAtr) : "\u2014"}</td></tr>`).join("\n")}
<tr style="font-weight:700;border-top:2px solid #e5e7eb"><td>Total</td><td class="r">${subregions.reduce((s, o) => s + o.count + (o.bookedCount || 0), 0)}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.fullAtr, 0))}</td><td class="r" style="color:#6366f1">${fmtD(subregions.reduce((s, o) => s + (o.bookedCC || 0), 0))}</td><td class="r" style="color:#d97706">${fmtD(subregions.reduce((s, o) => s + o.bu, 0))}</td><td class="r" style="color:#8b5cf6">${fmtD(subregions.reduce((s, o) => s + o.dj, 0))}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.totalCC, 0))}</td><td class="r">${(() => {
    const t = subregions.reduce((s, o) => s + o.totalCC, 0), n = subregions.reduce((s, o) => s + o.count + (o.bookedCount || 0), 0);
    return n > 0 ? fmtD(t / n) : "\u2014";
  })()}</td><td class="r" style="font-weight:600;color:${rate != null && rate < 80 ? "#ef4444" : rate != null && rate < 90 ? "#f59e0b" : "#22c55e"}">${rate != null ? rate.toFixed(1) + "%" : "\u2014"}</td><td class="r" style="color:#2563eb">${fmtD(subregions.reduce((s, o) => s + o.exp, 0))}</td><td class="r" style="color:#2563eb">${(() => {
    const t = subregions.reduce((s, o) => s + o.exp, 0), n = subregions.reduce((s, o) => s + o.expCount, 0);
    return n > 0 ? fmtD(t / n) : "\u2014";
  })()}</td><td class="r">${subregions.reduce((s, o) => s + o.redCount, 0)}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.redAtr, 0))}</td></tr>
</table>
${calls.regional || calls.cco || calls.rvp || calls.dj ? `
<h2>Forecast Calls</h2>
<table>
<tr><th>Source</th><th class="r">C/C Call</th><th class="r">vs Expected</th></tr>
${calls.regional ? `<tr><td>Regional Budget</td><td class="r">${fmtD(calls.regional)}</td><td class="r" style="color:${calls.regional >= expCC ? "#ef4444" : "#22c55e"}">${expCC ? (calls.regional >= expCC ? "+" : "") + fmtD(Math.abs(calls.regional - expCC)) : "\u2014"}</td></tr>` : ""}
<tr style="background:#f9fafb;font-weight:600"><td>Expected (Actual+FC)</td><td class="r">${fmtD(expCC)}</td><td class="r" style="color:#9ca3af">baseline</td></tr>
${calls.cco ? `<tr><td>CCO Call</td><td class="r" style="color:#4f46e5;font-weight:500">${fmtD(calls.cco)}</td><td class="r" style="color:${calls.cco >= expCC ? "#ef4444" : "#22c55e"}">${expCC ? (calls.cco >= expCC ? "+" : "") + fmtD(Math.abs(calls.cco - expCC)) : "\u2014"}</td></tr>` : ""}
${calls.rvp ? `<tr><td>RVP Call</td><td class="r" style="color:#4f46e5;font-weight:500">${fmtD(calls.rvp)}</td><td class="r" style="color:${calls.rvp >= expCC ? "#ef4444" : "#22c55e"}">${expCC ? (calls.rvp >= expCC ? "+" : "") + fmtD(Math.abs(calls.rvp - expCC)) : "\u2014"}</td></tr>` : ""}
${calls.dj ? `<tr><td>ELT Call</td><td class="r" style="color:#4f46e5;font-weight:600">${fmtD(calls.dj)}</td><td class="r" style="color:${calls.dj >= expCC ? "#ef4444" : "#22c55e"}">${expCC ? (calls.dj >= expCC ? "+" : "") + fmtD(Math.abs(calls.dj - expCC)) : "\u2014"}</td></tr>` : ""}
</table>` : ""}

${pyAll ? `
<h2>Prior Year Comparison (${pyQ})</h2>
<table>
<tr><th>Segment</th><th class="r">PY ATR</th><th class="r">PY C/C</th><th class="r">PY RR%</th><th class="r">CY ATR</th><th class="r">CY Exp C/C</th><th class="r">CY RR%</th><th class="r">C/C YoY</th><th class="r">RR YoY</th></tr>
${(() => {
    const segs = [
      { label: "All Accounts", py: pyAll, cyAtr: base, cyCC: expCC, cyRate: rate },
      { label: ">100K", py: pyOver, cyAtr: act.filter((r) => toNumber(r[atrKey]) > 1e5).reduce((s, r) => s + toNumber(r[atrKey]), 0), cyCC: act.filter((r) => toNumber(r[atrKey]) > 1e5).reduce((s, r) => s + toNumber(r[buKey]), 0) + hist.filter((r) => toNumber(r[histAtrKey]) > 1e5).reduce((s, r) => s + toNumber(r[ccKeyH]), 0), cyRate: null }
    ];
    segs[1].cyRate = segs[1].cyAtr > 0 ? (segs[1].cyAtr - segs[1].cyCC) / segs[1].cyAtr * 100 : null;
    return segs.filter((s) => s.py).map((s) => {
      const pyR = s.py.atr > 0 ? (s.py.atr - s.py.cc) / s.py.atr * 100 : null;
      const ccD = s.cyCC - s.py.cc;
      const rrD = s.cyRate != null && pyR != null ? s.cyRate - pyR : null;
      return `<tr><td style="font-weight:500">${esc(s.label)}</td><td class="r">${fmtD(s.py.atr)}</td><td class="r">${fmtD(s.py.cc)}</td><td class="r">${pctF(pyR)}</td><td class="r">${fmtD(s.cyAtr)}</td><td class="r">${fmtD(s.cyCC)}</td><td class="r">${pctF(s.cyRate)}</td><td class="r" style="color:${ccD <= 0 ? "#22c55e" : "#ef4444"};font-weight:600">${ccD >= 0 ? "+" : "-"}${fmtD(Math.abs(ccD))}</td><td class="r" style="color:${rrD != null && rrD >= 0 ? "#22c55e" : "#ef4444"};font-weight:600">${rrD != null ? (rrD >= 0 ? "+" : "") + rrD.toFixed(1) + "pp" : "\u2014"}</td></tr>`;
    }).join("\n");
  })()}
</table>` : ""}

${churningAccts.length > 0 ? `
<h2>Churning Accounts (${churningAccts.length})</h2>
<p style="margin:8px 0 12px;font-size:12px;line-height:1.6;color:#374151">${churningAccts.map((a) => `<strong>${esc(a.name)}</strong> [${fmtD(a.bu)}]`).join(", ")}.</p>
<table>
<tr><th>Account</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT</th><th>Health</th><th>Owner</th><th>Note</th></tr>
${churningAccts.map((a) => {
    const nd = a.noteText && !a.archived ? a.noteText.length > 120 ? a.noteText.slice(0, 120) + "..." : a.noteText : "\u2014";
    return `<tr><td style="font-weight:500">${esc(a.name)}</td><td class="r">${fmtD(a.atr)}</td><td class="r">${fmtD(a.bu)}</td><td class="r">${a.dj != null ? fmtD(a.dj) : "\u2014"}</td><td>${badgeHtml(a.h)}</td><td>${esc(a.own || "\u2014")}</td><td class="note-cell" title="${esc(a.noteText || "")}">${esc(nd)}</td></tr>`;
  }).join("\n")}
</table>` : ""}

${redAccts.length > 0 ? `
<h2>Red Health Accounts (${redAccts.length})</h2>
<p style="margin:8px 0 12px;font-size:12px;line-height:1.6;color:#374151">${redAccts.map((a) => `<strong>${esc(a.name)}</strong> [${fmtD(a.bu)}]`).join(", ")}.</p>
<table>
<tr><th>Account</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT</th><th>Health</th><th>Owner</th><th>Note</th></tr>
${redAccts.map((a) => {
    const nd = a.noteText && !a.archived ? a.noteText.length > 120 ? a.noteText.slice(0, 120) + "..." : a.noteText : "\u2014";
    return `<tr><td style="font-weight:500">${esc(a.name)}</td><td class="r">${fmtD(a.atr)}</td><td class="r">${fmtD(a.bu)}</td><td class="r">${a.dj != null ? fmtD(a.dj) : "\u2014"}</td><td>${badgeHtml(a.h)}</td><td>${esc(a.own || "\u2014")}</td><td class="note-cell" title="${esc(a.noteText || "")}">${esc(nd)}</td></tr>`;
  }).join("\n")}
</table>` : ""}

${churnHist.length > 0 ? `
<h2>Closed C/C (${churnHist.length})</h2>
<table>
<tr><th>Account</th><th class="r">ATR</th><th class="r">C/C</th><th>Health</th><th>Owner</th><th>Status</th></tr>
${churnHist.map((c) => `<tr><td style="font-weight:500">${esc(c.name)}</td><td class="r">${fmtD(c.atr)}</td><td class="r" style="color:#ef4444;font-weight:600">${fmtD(c.cc)}</td><td>${badgeHtml(c.h)}</td><td>${esc(c.own || "\u2014")}</td><td>${c.done ? "Closed" : "Open"}</td></tr>`).join("\n")}
</table>` : ""}

${expA.length > 0 ? `
<h2>Expansion (${expA.length})</h2>
<table>
<tr><th>Account</th><th class="r">Expansion</th><th>Health</th><th>Status</th></tr>
${expA.map((a) => `<tr><td style="font-weight:500">${esc(a.name)}</td><td class="r" style="color:#3b82f6;font-weight:600">${fmtD(a.exp)}</td><td>${badgeHtml(a.h)}</td><td>${a.done ? "Closed" : "Open"}</td></tr>`).join("\n")}
</table>` : ""}

<h2>All Accounts (${accts.length})</h2>
<table>
<tr><th>Account</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT</th><th>Health</th><th>Owner</th><th>Updated</th><th>Note</th></tr>
${accts.map((a) => acctRow(a)).join("\n")}
</table>

<p style="font-size:9px;color:#9ca3af;margin-top:24px;text-align:center">Generated ${genDate} &middot; Renewals Intelligence Studio</p>
</body></html>`;
  try {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quarter.replace(/[^a-zA-Z0-9]/g, "_")}_Exec_Summary.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  } catch (e) {
    alert("Could not generate report: " + e.message);
  }
}
const _regionTabCache = { selectedFQ: null, selectedSubregions: /* @__PURE__ */ new Set(), selectedBand: "all", selectedCsManager: "__ALL_CSM__", detailSort: { key: "atr", dir: "desc" } };
function generateRegionExecSummary({ focusRows, kpis, healthDist, segDist, detailRowsSorted, notes, selectedFQ, selectedBand, selectedSubregions, atrKey, buKey, acctKey, ownerKey, healthKey, segKey, subregionKey, dateKey }) {
  const esc = escapeHtml;
  const fmtD = fmtCompact;
  const pctF = (v, d = 1) => isFinite(v) ? `${(v * 100).toFixed(d)}%` : "\u2014";
  const genDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const bandLabel = (BAND_OPTIONS.find((b) => b.value === selectedBand) || {}).label || "All accounts";
  const subLabel = selectedSubregions.size === 0 ? "All Sub-Regions" : Array.from(selectedSubregions).join(", ");
  const qLabel = selectedFQ === "__ALL_FQ__" ? "All Quarters" : selectedFQ || "\u2014";
  const scopeLine = `${kpis.acctCount.toLocaleString()} accounts | ${fmtD(kpis.totalAtr)} ATR | Band: ${bandLabel} | ${subLabel}`;
  const subregionMap = {};
  focusRows.forEach((r) => {
    const s = safeString(r[subregionKey]) || "Unknown";
    const atr = toNumber(r[atrKey]), bu = toNumber(r[buKey]);
    const nk = r.__noteKey;
    const note = nk ? notes[nk] : null;
    const djRaw = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
    const djVal = djRaw !== null ? djRaw : bu;
    const hl = (safeString(r[healthKey]) || "").toLowerCase();
    if (!subregionMap[s]) subregionMap[s] = { name: s, atr: 0, bu: 0, dj: 0, count: 0, redCount: 0, redAtr: 0 };
    subregionMap[s].atr += atr;
    subregionMap[s].bu += bu;
    subregionMap[s].dj += djVal;
    subregionMap[s].count++;
    if (hl === "red") {
      subregionMap[s].redCount++;
      subregionMap[s].redAtr += atr;
    }
  });
  Object.values(subregionMap).forEach((o) => {
    o.rr = o.atr > 0 ? (o.atr - o.bu) / o.atr * 100 : null;
    o.avgCC = o.count > 0 ? o.bu / o.count : 0;
  });
  const subregions = Object.values(subregionMap).sort((a, b) => b.atr - a.atr);
  const churningRows = detailRowsSorted.filter((d) => (d.health || "").toLowerCase() === "churning").sort((a, b) => b.atr - a.atr);
  const redRows = detailRowsSorted.filter((d) => (d.health || "").toLowerCase() === "red").sort((a, b) => b.atr - a.atr);
  const buildSlackGroup = (rows, label) => {
    if (!rows.length) return "";
    const lines = [];
    const top5 = rows.slice(0, 5);
    const rest = rows.slice(5);
    lines.push(`${label} (${rows.length}):`);
    top5.forEach((a) => lines.push(`  ${a.account} [${fmtD(a.bu)}]`));
    if (rest.length > 0) {
      const totalBu = rest.reduce((s, a) => s + a.bu, 0);
      const avgBu = totalBu / rest.length;
      lines.push(`  + ${rest.length} other (${fmtD(avgBu)} avg, ${fmtD(totalBu)} total BU FC)`);
    }
    return lines.join("\n");
  };
  const slackLines = [];
  slackLines.push(`Renewals Executive Summary - ${qLabel} (${genDate})`);
  slackLines.push("");
  slackLines.push(`Scope: ${scopeLine}`);
  slackLines.push(`Total ATR: ${fmtD(kpis.totalAtr)} | BU Forecast: ${fmtD(kpis.buTotal)} (${pctF(kpis.ccRate)} C/C) | ELT Forecast: ${fmtD(kpis.djTotal)}${kpis.djOverrideCount > 0 ? " (" + kpis.djOverrideCount + " overrides)" : ""}`);
  slackLines.push(`At Risk: ${fmtD(kpis.atRisk)} (${(kpis.totalAtr ? kpis.atRisk / kpis.totalAtr * 100 : 0).toFixed(1)}% of ATR)`);
  if (kpis.target > 0) slackLines.push(`Target: ${fmtD(kpis.target)} | Attainment: ${pctF(kpis.attain)} | Gap: ${(kpis.gap >= 0 ? "+" : "") + fmtD(kpis.gap)}`);
  const slackChurn = buildSlackGroup(churningRows, "Churning");
  const slackRed = buildSlackGroup(redRows, "At-Risk (Red)");
  if (slackChurn) {
    slackLines.push("");
    slackLines.push(slackChurn);
  }
  if (slackRed) {
    slackLines.push("");
    slackLines.push(slackRed);
  }
  const slackText = slackLines.join("\n");
  const slackHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;position:relative">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b">Slack-Ready Summary</span>
          <button onclick="navigator.clipboard.writeText(document.getElementById('exec-plain').dataset.text).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})" style="font-size:10px;font-weight:600;padding:3px 10px;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer">Copy</button>
        </div>
        <pre id="exec-plain" data-text="${esc(slackText)}" style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.6;color:#334155;margin:0">${esc(slackText)}</pre>
      </div>`;
  const kpiCards = [
    { label: "Total ATR", val: fmtD(kpis.totalAtr), detail: `${kpis.acctCount.toLocaleString()} accounts`, color: "#4f46e5" },
    { label: "BU Forecast", val: fmtD(kpis.buTotal), detail: `${pctF(kpis.ccRate)} C/C rate`, color: "#0ea5e9" },
    { label: "ELT Forecast", val: fmtD(kpis.djTotal), detail: kpis.djOverrideCount > 0 ? `${kpis.djOverrideCount} override${kpis.djOverrideCount !== 1 ? "s" : ""}` : void 0, color: "#8b5cf6" },
    { label: "At Risk", val: fmtD(kpis.atRisk), detail: `${(kpis.totalAtr ? kpis.atRisk / kpis.totalAtr * 100 : 0).toFixed(1)}% of ATR`, color: "#ef4444" }
  ];
  if (kpis.target > 0) kpiCards.push({ label: "Target", val: fmtD(kpis.target), detail: kpis.attain != null ? `${pctF(kpis.attain)} attainment` : void 0, color: "#10b981" });
  const hColors = { good: "#22c55e", green: "#4ade80", healthy: "#4ade80", yellow: "#facc15", orange: "#f97316", neutral: "#facc15", concerning: "#f97316", red: "#ef4444", churning: "#a855f7", unknown: "#94a3b8" };
  const sColors = { digital: "#818cf8", smb: "#38bdf8", commercial: "#f59e0b", enterprise: "#10b981" };
  const healthAtr = {};
  focusRows.forEach((r) => {
    const h = safeString(r[healthKey]).toLowerCase() || "unknown";
    healthAtr[h] = (healthAtr[h] || 0) + toNumber(r[atrKey]);
  });
  const segAtr = {};
  focusRows.forEach((r) => {
    const s = safeString(r[segKey]) || "(Blank)";
    segAtr[s] = (segAtr[s] || 0) + toNumber(r[atrKey]);
  });
  const waterfallHtml = (() => {
    const allCC = detailRowsSorted.filter((a) => a.bu > 0).sort((a, b) => b.bu - a.bu);
    const top = allCC.slice(0, 10), rest = allCC.slice(10);
    const restSum = rest.reduce((s, a) => s + a.bu, 0);
    const restDjSum = rest.reduce((s, a) => s + (a.dj != null ? a.dj : a.bu), 0);
    const restHasDj = rest.some((a) => a.dj != null);
    const totalCC = allCC.reduce((s, a) => s + a.bu, 0);
    const bars = [{ label: "Total C/C", value: totalCC, deduct: 0, isTotal: true }];
    let consumed = 0;
    top.forEach((a) => {
      const lbl = a.account || "?";
      bars.push({ label: lbl.length > 18 ? lbl.slice(0, 16) + "\u2026" : lbl, value: a.bu, deduct: consumed, src: "forecast", dj: a.dj != null ? a.dj : null });
      consumed += a.bu;
    });
    if (restSum > 0) {
      const allOthersDj = restHasDj && Math.round(restDjSum) !== Math.round(restSum) ? restDjSum : null;
      bars.push({ label: "All Others (" + rest.length + ")", value: restSum, deduct: consumed, src: "others", dj: allOthersDj });
      consumed += restSum;
    }
    const djAccountCount = allCC.filter((a) => a.dj != null).length;
    const n = bars.length;
    const chartW = Math.max(900, n * 80 + 100), chartH = 360, padL = 65, padR = 20, padT = 35, padB = 100;
    const plotW = chartW - padL - padR, plotH = chartH - padT - padB;
    const barW = Math.min(55, Math.floor(plotW / n * 0.6));
    const stepW = plotW / n;
    const maxVal = totalCC * 1.08 || 1;
    const sc = (v) => v / maxVal * plotH;
    const fV = (v) => {
      if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
      if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
      return "$" + Math.round(v);
    };
    const fillTotal = "#4f46e5";
    const fillBu = "#ef4444";
    const fillOthers = "#94a3b8";
    const djColor = "#8b5cf6";
    const fillFor = (b) => b.src === "others" ? fillOthers : fillBu;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + chartW + " " + chartH + '" style="width:100%;max-width:' + chartW + 'px;height:auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">';
    const gridN = 5;
    for (let i = 0; i <= gridN; i++) {
      const y = padT + plotH / gridN * i;
      const val = maxVal - maxVal / gridN * i;
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (chartW - padR) + '" y2="' + y + '" stroke="#f1f5f9" stroke-width="1"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="#94a3b8" font-size="9">' + fV(val) + "</text>";
    }
    bars.forEach((b, i) => {
      const cx = padL + i * stepW + stepW / 2;
      const x = cx - barW / 2;
      if (b.isTotal) {
        const barH = sc(b.value);
        svg += '<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + Math.max(barH, 1) + '" rx="2" fill="' + fillTotal + '" opacity="0.85"/>';
        svg += '<text x="' + cx + '" y="' + (padT + barH + 14) + '" text-anchor="middle" fill="' + fillTotal + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
      } else {
        const remaining = totalCC - b.deduct;
        const remAfter = remaining - b.value;
        const barH = sc(remaining);
        const colorH = sc(b.value);
        const grayH = sc(remAfter);
        const fill = fillFor(b);
        svg += '<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + Math.max(grayH, 0) + '" rx="2" fill="#e2e8f0" opacity="0.5"/>';
        if (b.dj != null) {
          const subW = Math.max((barW - 2) / 2, 4);
          const xBu = cx - subW - 1;
          const xDj = cx + 1;
          const djH = sc(b.dj);
          svg += '<rect x="' + xBu + '" y="' + (padT + grayH) + '" width="' + subW + '" height="' + Math.max(colorH, 1) + '" rx="2" fill="' + fill + '" opacity="0.9"/>';
          svg += '<rect x="' + xDj + '" y="' + (padT + grayH) + '" width="' + subW + '" height="' + Math.max(djH, 1) + '" rx="2" fill="' + djColor + '" opacity="0.9"/>';
          const bottomY = padT + grayH + Math.max(colorH, djH);
          svg += '<text x="' + cx + '" y="' + (bottomY + 12) + '" text-anchor="middle" fill="' + fill + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
          svg += '<text x="' + cx + '" y="' + (bottomY + 22) + '" text-anchor="middle" fill="' + djColor + '" font-size="9" font-weight="600">ELT ' + fV(b.dj) + "</text>";
        } else {
          svg += '<rect x="' + x + '" y="' + (padT + grayH) + '" width="' + barW + '" height="' + Math.max(colorH, 1) + '" rx="2" fill="' + fill + '" opacity="0.9"/>';
          svg += '<text x="' + cx + '" y="' + (padT + barH + 14) + '" text-anchor="middle" fill="' + fill + '" font-size="9" font-weight="600">' + fV(b.value) + "</text>";
        }
        if (i > 0) {
          const prevCx = padL + (i - 1) * stepW + stepW / 2;
          const prevBar = bars[i - 1];
          const connY = prevBar.isTotal ? padT + sc(prevBar.value) : padT + sc(totalCC - prevBar.deduct);
          svg += '<line x1="' + (prevCx + barW / 2) + '" y1="' + connY + '" x2="' + (cx - barW / 2) + '" y2="' + connY + '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,2"/>';
        }
      }
      svg += '<text x="' + cx + '" y="' + (padT + plotH + 30) + '" text-anchor="middle" fill="#475569" font-size="8" font-weight="500" transform="rotate(-30,' + cx + "," + (padT + plotH + 30) + ')">' + esc(b.label) + "</text>";
    });
    svg += "</svg>";
    const swatch = (c) => '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + c + ';vertical-align:middle;margin-right:4px"></span>';
    const legendHtml2 = '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:6px;font-size:10px;color:#64748b"><span>' + swatch(fillTotal) + "Total C/C</span><span>" + swatch(fillBu) + "BU Forecast</span>" + (djAccountCount > 0 ? "<span>" + swatch(djColor) + "ELT Forecast (" + djAccountCount + ")</span>" : "") + "<span>" + swatch(fillOthers) + "All Others</span></div>";
    return '<div style="margin:20px 0 24px;border:1px solid #e5e7eb;border-radius:8px;padding:16px 12px 8px;background:#fafbfc"><div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">C/C Breakdown \u2014 Top Accounts by BU Forecast</div>' + svg + legendHtml2 + "</div>";
  })();
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Exec Summary - ${esc(qLabel)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1f2937;padding:40px;max-width:1200px;margin:0 auto;font-size:13px;line-height:1.5}
h1{font-size:20px;font-weight:700;margin-bottom:4px}
h2{font-size:14px;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
.sub{font-size:11px;color:#6b7280;margin-bottom:24px}
.kpi-row{display:grid;grid-template-columns:repeat(${kpiCards.length},1fr);gap:12px;margin-bottom:24px}
.kpi{border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
.kpi .label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;font-weight:600}
.kpi .val{font-size:22px;font-weight:700}
.kpi .detail{font-size:10px;color:#9ca3af;margin-top:2px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:8px}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:14px}
.card h3{font-size:12px;font-weight:700;margin-bottom:8px}
.bar-track{height:10px;border-radius:5px;background:#f3f4f6;overflow:hidden;display:flex;margin-bottom:8px}
.legend{display:flex;flex-wrap:wrap;gap:8px;font-size:10px}
.legend-item{display:flex;align-items:center;gap:4px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
th{background:#f9fafb;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb}
td{padding:6px 10px;border-bottom:1px solid #f3f4f6}
.r{text-align:right}
tr:hover{background:#f9fafb}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;color:#fff}
.note-cell{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#64748b}
@media print{body{padding:20px;font-size:11px}.kpi .val{font-size:16px}h2{break-before:auto}}
</style></head><body>
<h1>Renewals Executive Summary</h1>
<p class="sub">${esc(qLabel)} &middot; ${esc(bandLabel)} &middot; ${esc(subLabel)} &middot; ${genDate}</p>

${slackHtml}

${waterfallHtml}

<div class="kpi-row">
${kpiCards.map((c) => `<div class="kpi">
  <div class="label" style="color:${c.color}">${c.label}</div>
  <div class="val">${c.val}</div>
  ${c.detail ? `<div class="detail">${esc(c.detail)}</div>` : ""}
</div>`).join("\n")}
</div>

<div class="cards">
  <div class="card">
    <h3>Health Mix</h3>
    <div class="bar-track">${healthDist.map((h) => {
    const total = healthDist.reduce((s, x) => s + x.value, 0) || 1;
    return `<div style="width:${(h.value / total * 100).toFixed(1)}%;background:${h.color}" title="${esc(h.label)}: ${h.value}"></div>`;
  }).join("")}</div>
    <div class="legend">${healthDist.map((h) => `<span class="legend-item"><span class="dot" style="background:${h.color}"></span>${esc(h.label)} <span style="color:#9ca3af">${h.value} (${fmtD(healthAtr[h.key] || 0)})</span></span>`).join("")}</div>
  </div>
  <div class="card">
    <h3>Market Segment</h3>
    <div class="bar-track">${segDist.map((s) => {
    const total = segDist.reduce((sum, x) => sum + x.value, 0) || 1;
    return `<div style="width:${(s.value / total * 100).toFixed(1)}%;background:${s.color}" title="${esc(s.label)}: ${s.value}"></div>`;
  }).join("")}</div>
    <div class="legend">${segDist.map((s) => `<span class="legend-item"><span class="dot" style="background:${s.color}"></span>${esc(s.label)} <span style="color:#9ca3af">${s.value} (${fmtD(segAtr[s.key] || 0)})</span></span>`).join("")}</div>
  </div>
</div>

<h2>By Sub Region</h2>
<table>
<tr><th>Sub Region</th><th class="r">#</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">Avg C/C</th><th class="r">ELT FC</th><th class="r">RR%</th><th class="r">Red #</th><th class="r">Red ATR</th></tr>
${subregions.slice(0, 15).map((o) => `<tr><td style="font-weight:500">${esc(o.name)}</td><td class="r">${o.count}</td><td class="r">${fmtD(o.atr)}</td><td class="r" style="color:#d97706">${o.bu > 0 ? fmtD(o.bu) : "\u2014"}</td><td class="r">${o.avgCC > 0 ? fmtD(o.avgCC) : "\u2014"}</td><td class="r">${fmtD(o.dj)}</td><td class="r" style="color:${o.rr != null && o.rr < 80 ? "#ef4444" : o.rr != null && o.rr < 90 ? "#f59e0b" : "#22c55e"};font-weight:600">${o.rr != null ? o.rr.toFixed(1) + "%" : "\u2014"}</td><td class="r"${o.redCount > 0 ? ' style="color:#ef4444;font-weight:600"' : ""}>${o.redCount}</td><td class="r"${o.redAtr > 0 ? ' style="color:#ef4444;font-weight:600"' : ""}>${o.redAtr > 0 ? fmtD(o.redAtr) : "\u2014"}</td></tr>`).join("\n")}
<tr style="font-weight:700;border-top:2px solid #e5e7eb"><td>Total</td><td class="r">${subregions.reduce((s, o) => s + o.count, 0)}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.atr, 0))}</td><td class="r" style="color:#d97706">${fmtD(subregions.reduce((s, o) => s + o.bu, 0))}</td><td class="r">${(() => {
    const t = subregions.reduce((s, o) => s + o.bu, 0), n = subregions.reduce((s, o) => s + o.count, 0);
    return n > 0 ? fmtD(t / n) : "\u2014";
  })()}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.dj, 0))}</td><td class="r" style="font-weight:600;color:${(() => {
    const a = subregions.reduce((s, o) => s + o.atr, 0), b = subregions.reduce((s, o) => s + o.bu, 0), r = a > 0 ? (a - b) / a * 100 : null;
    return r != null && r < 80 ? "#ef4444" : r != null && r < 90 ? "#f59e0b" : "#22c55e";
  })()}">${(() => {
    const a = subregions.reduce((s, o) => s + o.atr, 0), b = subregions.reduce((s, o) => s + o.bu, 0);
    return a > 0 ? ((a - b) / a * 100).toFixed(1) + "%" : "\u2014";
  })()}</td><td class="r">${subregions.reduce((s, o) => s + o.redCount, 0)}</td><td class="r">${fmtD(subregions.reduce((s, o) => s + o.redAtr, 0))}</td></tr>
</table>

${churningRows.length > 0 ? `
<h2>Churning Accounts (${churningRows.length})</h2>
<p style="margin:8px 0 12px;font-size:12px;line-height:1.6;color:#374151">Confirmed churning are ${churningRows.map((d) => `<strong>${esc(d.account)}</strong> [${fmtD(d.bu)}]`).join(", ")}.</p>
<table>
<tr><th>Account</th><th>Sub-Region</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT Call</th><th>Owner</th><th>Note</th></tr>
${churningRows.map((d) => {
    const nk = d.r.__noteKey;
    const note = nk ? notes[nk] : null;
    const noteText = note && !note.archived ? safeString(note.note) : "";
    const truncNote = noteText.length > 120 ? noteText.slice(0, 120) + "..." : noteText || "\u2014";
    return `<tr><td style="font-weight:500">${esc(d.account)}</td><td>${esc(safeString(d.r[subregionKey]))}</td><td class="r">${fmtD(d.atr)}</td><td class="r">${fmtD(d.bu)}</td><td class="r">${d.dj != null ? fmtD(d.dj) : "\u2014"}</td><td>${esc(d.owner)}</td><td class="note-cell" title="${esc(noteText)}">${esc(truncNote)}</td></tr>`;
  }).join("\n")}
</table>` : ""}

${redRows.length > 0 ? `
<h2>Red Health Accounts (${redRows.length})</h2>
<p style="margin:8px 0 12px;font-size:12px;line-height:1.6;color:#374151">Red health accounts are ${redRows.map((d) => `<strong>${esc(d.account)}</strong> [${fmtD(d.bu)}]`).join(", ")}.</p>
<table>
<tr><th>Account</th><th>Sub-Region</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT Call</th><th>Owner</th><th>Note</th></tr>
${redRows.map((d) => {
    const nk = d.r.__noteKey;
    const note = nk ? notes[nk] : null;
    const noteText = note && !note.archived ? safeString(note.note) : "";
    const truncNote = noteText.length > 120 ? noteText.slice(0, 120) + "..." : noteText || "\u2014";
    return `<tr><td style="font-weight:500">${esc(d.account)}</td><td>${esc(safeString(d.r[subregionKey]))}</td><td class="r">${fmtD(d.atr)}</td><td class="r">${fmtD(d.bu)}</td><td class="r">${d.dj != null ? fmtD(d.dj) : "\u2014"}</td><td>${esc(d.owner)}</td><td class="note-cell" title="${esc(noteText)}">${esc(truncNote)}</td></tr>`;
  }).join("\n")}
</table>` : ""}

<h2>All Accounts (${detailRowsSorted.length})</h2>
<table>
<tr><th>Account</th><th>Sub-Region</th><th>Renewal</th><th class="r">ATR</th><th class="r">BU FC</th><th class="r">ELT Call</th><th class="r">CC%</th><th>Health</th><th>Owner</th><th>Updated</th><th>Latest Note</th></tr>
${detailRowsSorted.map((d) => {
    const nk = d.r.__noteKey;
    const note = nk ? notes[nk] : null;
    const noteText = note && !note.archived ? safeString(note.note) : "";
    const truncNote = noteText.length > 150 ? noteText.slice(0, 150) + "..." : noteText || "\u2014";
    const updated = note && note.updatedAt ? new Date(note.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "\u2014";
    const hCol = hColors[(d.health || "").toLowerCase()] || "#94a3b8";
    return `<tr><td style="font-weight:500">${esc(d.account)}</td><td>${esc(safeString(d.r[subregionKey]))}</td><td>${esc(d.date)}</td><td class="r">${fmtD(d.atr)}</td><td class="r">${fmtD(d.bu)}</td><td class="r">${d.dj != null ? fmtD(d.dj) : "\u2014"}</td><td class="r">${isFinite(d.cc) ? pctF(d.cc) : "\u2014"}</td><td><span class="badge" style="background:${hCol}">${esc(d.health || "\u2014")}</span></td><td>${esc(d.owner)}</td><td style="white-space:nowrap;font-size:10px;color:#9ca3af">${updated}</td><td class="note-cell" title="${esc(noteText)}">${esc(truncNote)}</td></tr>`;
  }).join("\n")}
</table>

<p style="font-size:9px;color:#9ca3af;margin-top:24px;text-align:center">Generated ${genDate} &middot; Renewals Intelligence Studio</p>
</body></html>`;
  try {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `Region_Exec_Summary_${(selectedFQ || "all").replace(/[^a-zA-Z0-9]/g, "_")}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  } catch (e) {
    alert("Could not generate report: " + e.message);
  }
}
function RegionQuarterTable() {
  const rows = useFilteredRows({ ignoreQuarters: true, ignoreBand: true });
  const { state, actions } = useApp();
  const hm = state.headerMap;
  const notes = state.notes || {};
  const settings = state.settings || {};
  const { byAccount: fcByAccount } = useAccountForecasts();
  const { accountRollups } = useAccountMeta();
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const atrKey = getAtrKey(hm, state.settings);
  const buKey = getBuKey(hm, state.settings);
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const acctIdKey = hm.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const csManagerKey = hm.MANAGER_SUCCESS || "MANAGER_SUCCESS";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const segKey = hm.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const partnerKey = hm.PARTNER || "PARTNER";
  const partnerTypeKey = hm.PARTNER_TYPE || "PARTNER_TYPE_C";
  const subregionKey = hm.SUBREGION || "PRO_FORMA_SUBREGION";
  const touchKey = hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
  const upsideKey = hm.UPSIDE || "UPSIDE";
  const downsideKey = hm.DOWNSIDE || "DOWNSIDE";
  const histData = state.historicalData || [];
  const histHM = state.historicalHeaderMap || {};
  const histAtrKey = histHM.ATR_STARTING || "ATR_ARR_USD_STARTING";
  const histCcKey = histHM.CC || "CC";
  const histQKey = histHM.FISCAL_QUARTER || histHM.YEAR_QUARTER || "FISCAL_QUARTER";
  const histBandKey = histHM.BAND || histHM.ATR_BAND || "BAND";
  const histSegKey = histHM.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const histFlag3kKey = histHM.FLAG_TOP3K || "FLAG_3K";
  const histSubregionKey = histHM.SUBREGION || "PRO_FORMA_SUBREGION";
  const histCsManagerKey = histHM.MANAGER_SUCCESS || "MANAGER_SUCCESS";
  const [selectedFQ, _setSelectedFQ] = useState(_regionTabCache.selectedFQ);
  const [selectedSubregions, _setSelectedSubregions] = useState(_regionTabCache.selectedSubregions);
  const [selectedBand, _setSelectedBand] = useState(_regionTabCache.selectedBand);
  const [selectedCsManager, _setSelectedCsManager] = useState(_regionTabCache.selectedCsManager);
  const [detailSort, _setDetailSort] = useState(_regionTabCache.detailSort);
  const _setSelectedFQRaw = (v) => {
    _setSelectedFQ(v);
    _regionTabCache.selectedFQ = v;
  };
  const _setSelectedBandRaw = (v) => {
    _setSelectedBand(v);
    _regionTabCache.selectedBand = v;
  };
  const _syncFQToGlobal = (v) => {
    const desired = !v || v === "__ALL_FQ__" ? [...DEFAULT_QUARTERS] : [v];
    actions.setFilters((prev) => {
      const cur = Array.isArray(prev.quarters) ? prev.quarters : [];
      if (cur.length === desired.length && cur.every((q, i) => q === desired[i])) return prev;
      return { ...prev, quarters: desired };
    });
  };
  const _syncBandToGlobal = (v) => {
    const desired = v || "all";
    actions.setFilters((prev) => {
      if ((prev.band || "all") === desired) return prev;
      return { ...prev, band: desired };
    });
  };
  const setSelectedFQ = (v) => {
    _setSelectedFQRaw(v);
    _syncFQToGlobal(v);
  };
  const setSelectedSubregions = (v) => {
    const val = typeof v === "function" ? v(_regionTabCache.selectedSubregions) : v;
    _setSelectedSubregions(val);
    _regionTabCache.selectedSubregions = val;
  };
  const setSelectedBand = (v) => {
    _setSelectedBandRaw(v);
    _syncBandToGlobal(v);
  };
  const setSelectedCsManager = (v) => {
    _setSelectedCsManager(v);
    _regionTabCache.selectedCsManager = v;
  };
  const setDetailSort = (v) => {
    const val = typeof v === "function" ? v(_regionTabCache.detailSort) : v;
    _setDetailSort(val);
    _regionTabCache.detailSort = val;
  };
  const [detailLimit, setDetailLimit] = useState(50);
  const [selectedAccountRow, setSelectedAccountRow] = useState(null);
  const [bandOpen, setBandOpen] = useState(false);
  const [subregionOpen, setSubregionOpen] = useState(false);
  const [csManagerOpen, setCsManagerOpen] = useState(false);
  const [fqOpen, setFqOpen] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const toggleSubregion = (sub) => {
    setSelectedSubregions((prev) => {
      const next = new Set(prev);
      if (next.has(sub)) next.delete(sub);
      else next.add(sub);
      return next;
    });
  };
  const validRows = useMemo(() => rows.filter((r) => isValidRenewal(r, hm, state.settings)), [rows, hm, state.settings]);
  const rowsView = useMemo(() => {
    const sm = /* @__PURE__ */ new Map();
    validRows.forEach((r) => {
      const fq = safeString(r[qKey]);
      if (!fq || parseFiscalLabel(fq).fy === 0) return;
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const entry = sm.get(fq) || { fq, accounts: 0, atr: 0, bu: 0 };
      entry.accounts += 1;
      entry.atr += atr;
      entry.bu += bu;
      sm.set(fq, entry);
    });
    return Array.from(sm.values()).sort((a, b) => {
      const pa = parseFiscalLabel(a.fq), pb = parseFiscalLabel(b.fq);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [validRows, qKey, atrKey, buKey]);
  useEffect(() => {
    const gq = Array.isArray(state.filters?.quarters) ? state.filters.quarters : [];
    const desiredFQ = gq.length === 0 ? "__ALL_FQ__" : gq.length === 1 ? gq[0] : "__ALL_FQ__";
    if (desiredFQ !== selectedFQ) _setSelectedFQRaw(desiredFQ);
    const gb = state.filters?.band || "all";
    if (gb !== selectedBand) _setSelectedBandRaw(gb);
  }, [state.filters?.quarters, state.filters?.band, selectedFQ, selectedBand]);
  useEffect(() => {
    setSelectedAccountRow(null);
  }, [rowsView.length, selectedFQ, selectedSubregions, selectedBand]);
  const _bandKey = hm.BAND || "BAND";
  const _flag3kKey = hm.FLAG_TOP3K || "FLAG_3K";
  const matchesBand_ = (r, band) => matchesBand(r, band, atrKey, segKey, _flag3kKey, _bandKey);
  const qtrBandPool = useMemo(() => {
    let pool = validRows;
    if (selectedFQ && selectedFQ !== "__ALL_FQ__") pool = pool.filter((r) => safeString(r[qKey]) === selectedFQ);
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBand_(r, selectedBand));
    if (selectedCsManager && selectedCsManager !== "__ALL_CSM__") pool = pool.filter((r) => safeString(r[csManagerKey]) === selectedCsManager);
    return pool;
  }, [validRows, selectedFQ, selectedBand, qKey, atrKey, segKey, selectedCsManager, csManagerKey]);
  const focusRows = useMemo(() => {
    if (selectedSubregions.size === 0) return qtrBandPool;
    return qtrBandPool.filter((r) => selectedSubregions.has(safeString(r[subregionKey])));
  }, [qtrBandPool, selectedSubregions, subregionKey]);
  useScopedAccountIds(focusRows, acctIdKey, acctKey);
  useScopedCallKeys(focusRows, hm, state.settings);
  useScopedCallRollup(focusRows, hm, state.settings, notes, fcByAccount);
  const histRowsFiltered = useMemo(() => {
    if (!histData || !histData.length) return [];
    let pool = histData.filter((r) => toNumber(r[histAtrKey]) > 0 || toNumber(r[histCcKey]) > 0);
    if (selectedFQ && selectedFQ !== "__ALL_FQ__") {
      pool = pool.filter((r) => safeString(r[histQKey]) === selectedFQ);
    } else if (selectedFQ === "__ALL_FQ__") {
      const validQs = new Set(rowsView.map((r) => r.fq));
      pool = pool.filter((r) => validQs.has(safeString(r[histQKey])));
    } else {
      return [];
    }
    if (selectedBand && selectedBand !== "all") {
      pool = pool.filter((r) => matchesBand(r, selectedBand, histAtrKey, histSegKey, histFlag3kKey, histBandKey));
    }
    if (selectedSubregions.size > 0) {
      pool = pool.filter((r) => selectedSubregions.has(safeString(r[histSubregionKey])));
    }
    if (selectedCsManager && selectedCsManager !== "__ALL_CSM__") {
      pool = pool.filter((r) => safeString(r[histCsManagerKey]) === selectedCsManager);
    }
    return pool;
  }, [histData, histAtrKey, histCcKey, histQKey, histBandKey, histSegKey, histFlag3kKey, histSubregionKey, histCsManagerKey, selectedFQ, selectedBand, selectedSubregions, selectedCsManager, rowsView]);
  const chartActiveRows = useMemo(() => {
    let pool = validRows;
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBand_(r, selectedBand));
    if (selectedCsManager && selectedCsManager !== "__ALL_CSM__") pool = pool.filter((r) => safeString(r[csManagerKey]) === selectedCsManager);
    if (selectedSubregions.size > 0) pool = pool.filter((r) => selectedSubregions.has(safeString(r[subregionKey])));
    return pool;
  }, [validRows, selectedBand, atrKey, segKey, selectedCsManager, csManagerKey, selectedSubregions, subregionKey]);
  const chartHistRows = useMemo(() => {
    if (!histData || !histData.length) return [];
    let pool = histData.filter((r) => toNumber(r[histAtrKey]) > 0 || toNumber(r[histCcKey]) > 0);
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBand(r, selectedBand, histAtrKey, histSegKey, histFlag3kKey, histBandKey));
    if (selectedSubregions.size > 0) pool = pool.filter((r) => selectedSubregions.has(safeString(r[histSubregionKey])));
    if (selectedCsManager && selectedCsManager !== "__ALL_CSM__") pool = pool.filter((r) => safeString(r[histCsManagerKey]) === selectedCsManager);
    return pool;
  }, [histData, histAtrKey, histCcKey, histBandKey, histSegKey, histFlag3kKey, histSubregionKey, histCsManagerKey, selectedBand, selectedSubregions, selectedCsManager]);
  const forecastByQuarter = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    rowsView.forEach((r) => {
      map.set(r.fq, { fq: r.fq, booked: 0, buFC: 0, djFC: 0, pendingAtr: 0, closedAtr: 0, pendingCount: 0, closedCount: 0, djOverrides: 0 });
    });
    chartActiveRows.forEach((r) => {
      const fq = safeString(r[qKey]);
      const entry = map.get(fq);
      if (!entry) return;
      const bu = toNumber(r[buKey]);
      const atr = toNumber(r[atrKey]);
      entry.buFC += bu;
      entry.pendingAtr += atr;
      entry.pendingCount += 1;
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const dj = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
      if (dj !== null) {
        entry.djFC += dj;
        entry.djOverrides += 1;
      } else {
        entry.djFC += bu;
      }
    });
    chartHistRows.forEach((r) => {
      const fq = safeString(r[histQKey]);
      const entry = map.get(fq);
      if (!entry) return;
      entry.booked += toNumber(r[histCcKey]);
      entry.closedAtr += toNumber(r[histAtrKey]);
      entry.closedCount += 1;
    });
    return Array.from(map.values()).sort((a, b) => {
      const pa = parseFiscalLabel(a.fq), pb = parseFiscalLabel(b.fq);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [rowsView, chartActiveRows, chartHistRows, qKey, atrKey, buKey, histQKey, histAtrKey, histCcKey, notes]);
  const quarterPool = useMemo(() => {
    if (!selectedFQ) return [];
    if (selectedFQ === "__ALL_FQ__") return validRows;
    return validRows.filter((r) => safeString(r[qKey]) === selectedFQ);
  }, [validRows, selectedFQ, qKey]);
  const bandRows = useMemo(() => {
    return BAND_OPTIONS.map((opt) => {
      const filtered = quarterPool.filter((r) => matchesBand_(r, opt.value));
      const atr = filtered.reduce((s, r) => s + toNumber(r[atrKey]), 0);
      return { ...opt, accounts: filtered.length, atr };
    });
  }, [quarterPool, atrKey]);
  const subregionRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    qtrBandPool.forEach((r) => {
      const sub = safeString(r[subregionKey]) || "(Unknown)";
      const atr = toNumber(r[atrKey]);
      const acct = safeString(r[acctIdKey]) || safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const entry = map.get(sub) || { sub, atr: 0, accountSet: /* @__PURE__ */ new Set() };
      entry.atr += atr;
      entry.accountSet.add(acct);
      map.set(sub, entry);
    });
    return Array.from(map.values()).map((x) => ({ sub: x.sub, label: x.sub, atr: x.atr, count: x.accountSet.size })).sort((a, b) => b.atr - a.atr);
  }, [qtrBandPool, subregionKey, atrKey, acctIdKey, acctKey]);
  const csManagerPool = useMemo(() => {
    let pool = validRows;
    if (selectedFQ && selectedFQ !== "__ALL_FQ__") pool = pool.filter((r) => safeString(r[qKey]) === selectedFQ);
    if (selectedBand && selectedBand !== "all") pool = pool.filter((r) => matchesBand_(r, selectedBand));
    if (selectedSubregions.size > 0) pool = pool.filter((r) => selectedSubregions.has(safeString(r[subregionKey])));
    return pool;
  }, [validRows, selectedFQ, selectedBand, qKey, atrKey, segKey, selectedSubregions, subregionKey]);
  const csManagerRows = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    csManagerPool.forEach((r) => {
      const mgr = safeString(r[csManagerKey]) || "(Unknown)";
      const atr = toNumber(r[atrKey]);
      const acct = safeString(r[acctIdKey]) || safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const entry = map.get(mgr) || { owner: mgr, atr: 0, accountSet: /* @__PURE__ */ new Set() };
      entry.atr += atr;
      entry.accountSet.add(acct);
      map.set(mgr, entry);
    });
    return Array.from(map.values()).map((x) => ({ owner: x.owner, atr: x.atr, count: x.accountSet.size })).sort((a, b) => b.atr - a.atr);
  }, [csManagerPool, csManagerKey, atrKey, acctIdKey, acctKey]);
  const { healthDist, segDist, healthAtrDist } = useMemo(() => {
    const hMap = /* @__PURE__ */ new Map(), hAtr = /* @__PURE__ */ new Map(), sMap = /* @__PURE__ */ new Map();
    for (let i = 0, len = focusRows.length; i < len; i++) {
      const r = focusRows[i];
      const h = safeString(r[healthKey]).toLowerCase() || "unknown";
      hMap.set(h, (hMap.get(h) || 0) + 1);
      hAtr.set(h, (hAtr.get(h) || 0) + toNumber(r[atrKey]));
      const s = safeString(r[segKey]) || "(Blank)";
      sMap.set(s, (sMap.get(s) || 0) + 1);
    }
    const healthDist2 = Array.from(hMap.entries()).map(([k, v]) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: HEALTH_COLORS[k] || "#94a3b8" })).sort((a, b) => b.value - a.value);
    return {
      healthDist: healthDist2,
      healthAtrDist: healthDist2.map((h) => ({ ...h, atr: hAtr.get(h.key) || 0 })).sort((a, b) => b.atr - a.atr),
      segDist: Array.from(sMap.entries()).map(([k, v]) => ({ key: k, label: k, value: v, color: SEGMENT_COLORS[k.toLowerCase()] || "#94a3b8" })).sort((a, b) => b.value - a.value)
    };
  }, [focusRows, healthKey, segKey, atrKey]);
  const touchByAccount = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    focusRows.forEach((r) => {
      const acct = safeString(r[acctKey]) || "__NO_ACCOUNT__";
      const v = toNumber(r[touchKey]);
      if (!isFinite(v)) return;
      if (!m.has(acct) || v > m.get(acct)) m.set(acct, v);
    });
    return m;
  }, [focusRows, acctKey, touchKey]);
  const detailRowsSorted = useMemo(() => {
    const mapped = focusRows.map((r) => {
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      const cc = atr > 0 ? bu / atr : 0;
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      let dj = null;
      let callFc = null;
      if (typeof RenewalsCallKeys !== "undefined") {
        const ck = RenewalsCallKeys.buildCallKey(r, hm, settings);
        const fc = ck ? fcByAccount.get(ck) : null;
        const cs = fc?.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
        const rn = fc?.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
        if (cs != null || rn != null) {
          dj = (cs || 0) + (rn || 0);
          callFc = dj;
        }
      }
      if (dj == null) {
        const djRaw = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
        dj = djRaw !== null && Math.round(djRaw) !== Math.round(bu) ? djRaw : null;
      }
      const effFc = callFc != null ? callFc : bu;
      const adjCc = atr > 0 ? effFc / atr : 0;
      const hasUpside = safeString(r[upsideKey]) !== "";
      const hasDownside = safeString(r[downsideKey]) !== "";
      const bestCase = hasUpside ? bu + toNumber(r[upsideKey]) : null;
      const worstCase = hasDownside ? bu + toNumber(r[downsideKey]) : null;
      return { r, account: safeString(r[acctKey]) || "(Unnamed)", owner: safeString(r[ownerKey]), partner: safeString(r[partnerKey]), partnerType: safeString(r[partnerTypeKey]), date: safeString(r[dateKey]), atr, bu, cc, adjCc, bestCase, worstCase, health: safeString(r[healthKey]), dj };
    });
    const dir = detailSort.dir === "asc" ? 1 : -1;
    return [...mapped].sort((a, b) => {
      switch (detailSort.key) {
        case "account":
          return dir * (a.account || "").localeCompare(b.account || "");
        case "date":
          return dir * ((Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
        case "owner":
          return dir * (a.owner || "").localeCompare(b.owner || "");
        case "atr":
          return dir * (a.atr - b.atr);
        case "bu":
          return dir * (a.bu - b.bu);
        case "cc":
          return dir * (a.cc - b.cc);
        case "adjCc":
          return dir * (a.adjCc - b.adjCc);
        case "bestCase":
          return dir * ((a.bestCase ?? -Infinity) - (b.bestCase ?? -Infinity));
        case "worstCase":
          return dir * ((a.worstCase ?? -Infinity) - (b.worstCase ?? -Infinity));
        case "dj":
          return dir * ((a.dj ?? -Infinity) - (b.dj ?? -Infinity));
        case "health":
          return dir * (a.health || "").localeCompare(b.health || "");
        default:
          return 0;
      }
    });
  }, [focusRows, detailSort, atrKey, buKey, acctKey, ownerKey, partnerKey, partnerTypeKey, dateKey, healthKey, notes, hm, settings, fcByAccount]);
  const toggleSort = (key) => setDetailSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  const sortIcon = (key) => detailSort.key === key ? detailSort.dir === "desc" ? "\u2193" : "\u2191" : "";
  const healthBadge = (h) => {
    const sev = classifyHealth(h);
    const cls = sev === "green" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : sev === "amber" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" : sev === "red" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-white/10 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300";
    return /* @__PURE__ */ React.createElement("span", { className: `px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}` }, h || "\u2014");
  };
  const kpis = useMemo(() => {
    let totalAtr = 0, buTotal = 0, djTotal = 0, djOverrideCount = 0, atRisk = 0, churnAtr = 0;
    const accts = /* @__PURE__ */ new Set();
    const reviewedAccts = /* @__PURE__ */ new Set();
    for (let i = 0, len = focusRows.length; i < len; i++) {
      const r = focusRows[i];
      const atr = toNumber(r[atrKey]);
      const bu = toNumber(r[buKey]);
      totalAtr += atr;
      buTotal += bu;
      const acctId = safeString(r[acctIdKey]) || safeString(r[acctKey]);
      accts.add(acctId);
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const _ck = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKey(r, hm, settings) : null;
      const _fc = _ck && fcByAccount ? fcByAccount.get(_ck) : null;
      const _cs = _fc && _fc.cs_forecast != null ? toNumber(_fc.cs_forecast) : null;
      const _rn = _fc && _fc.renewals_forecast != null ? toNumber(_fc.renewals_forecast) : null;
      const djRaw = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
      if (_cs !== null || _rn !== null) {
        djTotal += (_cs || 0) + (_rn || 0);
        djOverrideCount++;
      } else if (djRaw !== null) {
        djTotal += djRaw;
        djOverrideCount++;
      } else {
        djTotal += bu;
      }
      if (_cs !== null || _rn !== null || note && !note.archived && (safeString(note.note) || djRaw !== null)) reviewedAccts.add(acctId);
      const h = safeString(r[healthKey]).toLowerCase();
      if (h === "red" || h === "churning") atRisk += atr;
      if (h === "churning") churnAtr += atr;
    }
    let bookedCC = 0, histAtr = 0, histCount = 0;
    for (let i = 0, len = histRowsFiltered.length; i < len; i++) {
      const r = histRowsFiltered[i];
      histAtr += toNumber(r[histAtrKey]);
      bookedCC += toNumber(r[histCcKey]);
      histCount++;
    }
    const remainingCC = buTotal;
    const expectedCC = bookedCC + remainingCC;
    const expectedDj = bookedCC + djTotal;
    const fullAtr = totalAtr + histAtr;
    const acctCount = accts.size;
    const reviewedCount = reviewedAccts.size;
    const ccRate = totalAtr > 0 ? buTotal / totalAtr : 0;
    const expectedCcRate = fullAtr > 0 ? expectedCC / fullAtr : 0;
    const expectedDjRate = fullAtr > 0 ? expectedDj / fullAtr : 0;
    const targets = state.targets || {};
    const target = selectedFQ && selectedFQ !== "__ALL_FQ__" ? targets[selectedFQ] || 0 : rowsView.reduce((s, r) => s + (targets[r.fq] || 0), 0);
    const gap = target > 0 ? totalAtr - target : null;
    const attain = target > 0 ? totalAtr / target : null;
    return { totalAtr, fullAtr, histAtr, histCount, bookedCC, remainingCC, expectedCC, expectedCcRate, expectedDj, expectedDjRate, acctCount, buTotal, ccRate, djTotal, djOverrideCount, atRisk, churnAtr, target, gap, attain, reviewedCount };
  }, [focusRows, histRowsFiltered, atrKey, buKey, acctKey, acctIdKey, healthKey, histAtrKey, histCcKey, state.targets, selectedFQ, rowsView, notes, fcByAccount, hm, settings]);
  const gapColor = (g) => g >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";
  const attainColor = (a) => a >= 1 ? "text-emerald-600 dark:text-emerald-400" : a >= 0.9 ? "text-amber-600 dark:text-amber-400" : "text-red-500 dark:text-red-400";
  const _mobileBandLabel = selectedBand && selectedBand !== "all" ? BAND_OPTIONS.find((b) => b.value === selectedBand)?.label || selectedBand : "All accounts";
  const _mobileFqLabel = !selectedFQ ? "Pick a quarter" : selectedFQ === "__ALL_FQ__" ? "All quarters" : selectedFQ;
  const _filters = state.filters || {};
  const _arrRanges = Array.isArray(_filters.arrRanges) ? _filters.arrRanges : [];
  const _arrMinActive = _filters.arrMin != null && _filters.arrMin !== "";
  const _arrMaxActive = _filters.arrMax != null && _filters.arrMax !== "";
  const _arrActive = _arrRanges.length > 0 || _arrMinActive || _arrMaxActive;
  const _arrLabel = (() => {
    const money = (v) => v != null && v !== "" ? formatCurrencyUSD(Number(v)) : "Any";
    if (_arrRanges.length === 1) return money(_arrRanges[0].min) + " \u2013 " + money(_arrRanges[0].max);
    if (_arrRanges.length > 1) return _arrRanges.length + " ARR ranges";
    if (_arrMinActive || _arrMaxActive) return money(_filters.arrMin) + " \u2013 " + money(_filters.arrMax);
    return "";
  })();
  const clearArrFilter = () => {
    if (typeof window !== "undefined" && typeof window.__renewalsResetArrFilter === "function") {
      window.__renewalsResetArrFilter();
    } else {
      actions.setFilters((p) => ({ ...p, arrRanges: [], arrMin: null, arrMax: null }));
    }
  };
  const _fqActive = selectedFQ && selectedFQ !== "__ALL_FQ__";
  const _bandActive = selectedBand && selectedBand !== "all";
  const _subActive = selectedSubregions.size > 0;
  const _csmActive = selectedCsManager && selectedCsManager !== "__ALL_CSM__";
  const _anyFilterActive = _fqActive || _bandActive || _subActive || _csmActive || _arrActive;
  const resetAllRegionFilters = () => {
    React.startTransition(() => {
      setSelectedFQ("__ALL_FQ__");
      setSelectedBand("all");
      setSelectedSubregions(/* @__PURE__ */ new Set());
      setSelectedCsManager("__ALL_CSM__");
    });
    clearArrFilter();
  };
  const _mkChip = (key, label, onRemove, extraClass) => /* @__PURE__ */ React.createElement(
    "span",
    { key, className: "region-filter-chip region-filter-chip-removable" + (extraClass ? " " + extraClass : "") },
    /* @__PURE__ */ React.createElement("span", { className: "region-filter-chip-label" }, label),
    /* @__PURE__ */ React.createElement("button", { type: "button", className: "region-filter-chip-x", "aria-label": "Clear " + label, onClick: (e) => {
      e.stopPropagation();
      onRemove();
    } }, "\u00D7")
  );
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "region-filter-bar" }, /* @__PURE__ */ React.createElement("div", { className: "region-filter-bar-head glass-card-surface" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "region-filter-bar-toggle", onClick: () => setFiltersCollapsed((p) => !p), "aria-expanded": !filtersCollapsed }, /* @__PURE__ */ React.createElement("span", { className: `region-filter-chevron ${filtersCollapsed ? "" : "is-open"}` }, "\u25BC"), /* @__PURE__ */ React.createElement("svg", { className: "region-filter-bar-icon", width: "13", height: "13", viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { fill: "currentColor", d: "M3 5h18l-7 8v5l-4 2v-7z" })), /* @__PURE__ */ React.createElement("span", { className: "region-filter-bar-title" }, "Quick Filters")), /* @__PURE__ */ React.createElement("div", { className: "region-filter-summary" }, _fqActive ? _mkChip("fq", selectedFQ, () => React.startTransition(() => setSelectedFQ("__ALL_FQ__"))) : /* @__PURE__ */ React.createElement("span", { key: "fq", className: "region-filter-chip region-filter-chip-muted" }, _mobileFqLabel), _bandActive && _mkChip("band", BAND_OPTIONS.find((b) => b.value === selectedBand)?.label || selectedBand, () => React.startTransition(() => {
    setSelectedBand("all");
    setSelectedSubregions(/* @__PURE__ */ new Set());
  }), "region-filter-chip-emerald"), _subActive && _mkChip("sub", selectedSubregions.size === 1 ? Array.from(selectedSubregions)[0] : selectedSubregions.size + " sub-regions", () => React.startTransition(() => setSelectedSubregions(/* @__PURE__ */ new Set()))), _csmActive && _mkChip("csm", selectedCsManager, () => React.startTransition(() => setSelectedCsManager("__ALL_CSM__"))), _arrActive && _mkChip("arr", _arrLabel, clearArrFilter), focusRows.length > 0 && /* @__PURE__ */ React.createElement("span", { key: "cnt", className: "region-filter-chip region-filter-chip-muted" }, focusRows.length.toLocaleString(), " accounts"), _anyFilterActive && /* @__PURE__ */ React.createElement("button", { key: "reset", type: "button", className: "region-filter-reset", onClick: (e) => {
    e.stopPropagation();
    resetAllRegionFilters();
  } }, "Reset filters"))), !filtersCollapsed && /* @__PURE__ */ React.createElement("div", { className: "region-filter-sections" }, /* @__PURE__ */ React.createElement("div", { className: "region-filter-section region-filter-section-primary glass-card-surface" }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setFqOpen((p) => !p), className: "region-filter-section-head" }, /* @__PURE__ */ React.createElement("span", { className: `region-filter-chevron ${fqOpen ? "is-open" : ""}` }, "\u25BC"), /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-title" }, "Fiscal Quarters"), selectedFQ && /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-badge" }, selectedFQ === "__ALL_FQ__" ? "All quarters" : selectedFQ)), fqOpen && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section-body" }, /* @__PURE__ */ React.createElement("div", { className: "region-fq-scroll" }, (() => {
    const COLOR_BOOKED = "#6366f1";
    const COLOR_BU = "#d97706";
    const COLOR_DJ = "#8b5cf6";
    const forecastByFQ = new Map(forecastByQuarter.map((q) => [q.fq, q]));
    const fqMaxTotal = Math.max(1, ...forecastByQuarter.map((q) => Math.max(q.booked + q.buFC, q.booked + q.djFC)));
    return rowsView.map((r, idx) => {
      const active = r.fq === selectedFQ;
      const target = (state.targets || {})[r.fq];
      const fc = forecastByFQ.get(r.fq);
      const booked = fc ? fc.booked : 0;
      const buFC = fc ? fc.buFC : 0;
      const djFC = fc ? fc.djFC : 0;
      const totalBu = booked + buFC;
      const totalDj = booked + djFC;
      const widthPct = totalBu / fqMaxTotal * 100;
      const bookedPct = totalBu > 0 ? booked / totalBu * 100 : 0;
      const buPct = totalBu > 0 ? buFC / totalBu * 100 : 0;
      const djTickPct = totalDj / fqMaxTotal * 100;
      const showDjTick = totalDj > 0 && Math.abs(totalDj - totalBu) > 1;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: r.fq,
          onClick: () => React.startTransition(() => {
            setSelectedFQ(active ? null : r.fq);
          }),
          className: [
            "region-fq-card text-left rounded-lg px-2.5 py-1.5 transition border shrink-0",
            active ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20" : "border-transparent bg-white/[0.15]"
          ].join(" "),
          title: `${r.fq}: Booked ${formatCurrencyUSD(booked)} + BU FC ${formatCurrencyUSD(buFC)} = ${formatCurrencyUSD(totalBu)} | ELT total ${formatCurrencyUSD(totalDj)}`
        },
        /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-xs truncate" }, r.fq), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, r.accounts.toLocaleString())),
        /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, formatCurrencyUSD(r.atr), " \xB7 ", formatCurrencyUSD(r.bu), " BU"),
        totalBu > 0 && /* @__PURE__ */ React.createElement("div", { className: "mt-1" }, /* @__PURE__ */ React.createElement("div", { className: "h-2 rounded-full glass-track overflow-hidden relative" }, /* @__PURE__ */ React.createElement("div", { className: "flex h-full", style: { width: `${widthPct.toFixed(2)}%` } }, booked > 0 && /* @__PURE__ */ React.createElement("div", { className: "h-full transition-all duration-300", style: { width: `${bookedPct.toFixed(2)}%`, backgroundColor: COLOR_BOOKED } }), buFC > 0 && /* @__PURE__ */ React.createElement("div", { className: "h-full transition-all duration-300", style: { width: `${buPct.toFixed(2)}%`, backgroundColor: COLOR_BU } })), showDjTick && /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "absolute top-0 bottom-0 pointer-events-none transition-all duration-300",
            style: { left: `calc(${Math.min(djTickPct, 100).toFixed(2)}% - 1px)`, width: "2px", backgroundColor: COLOR_DJ, boxShadow: "0 0 0 1px rgba(255,255,255,0.55)" }
          }
        )), /* @__PURE__ */ React.createElement("div", { className: "text-[9px] mt-0.5 tabular-nums text-gray-500 dark:text-gray-400" }, formatCurrencyUSD(totalBu), showDjTick && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement("span", { style: { color: COLOR_DJ } }, "ELT ", formatCurrencyUSD(totalDj))))),
        target > 0 && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] mt-0.5 tabular-nums text-gray-400 dark:text-gray-500" }, formatPercent(r.atr / target), " of ", formatCurrencyUSD(target), " target"),
        !active && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-indigo-400 mt-0.5" }, "Click to drill in \u2192")
      );
    });
  })(), rowsView.length > 1 && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => {
        setSelectedFQ("__ALL_FQ__");
      }),
      className: [
        "region-fq-card text-left rounded-lg px-2.5 py-1.5 transition border text-xs font-semibold shrink-0",
        selectedFQ === "__ALL_FQ__" ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300" : "border-transparent bg-white/[0.15] text-gray-600 dark:text-gray-400"
      ].join(" ")
    },
    "All Quarters"
  )))), selectedFQ && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section glass-card-surface" }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setBandOpen((p) => !p), className: "region-filter-section-head" }, /* @__PURE__ */ React.createElement("span", { className: `region-filter-chevron ${bandOpen ? "is-open" : ""}` }, "\u25BC"), /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-title" }, "Bands"), selectedBand !== "all" && /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-badge region-filter-section-badge-emerald" }, BAND_OPTIONS.find((b) => b.value === selectedBand)?.label || selectedBand)), bandOpen && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section-body max-h-40" }, bandRows.filter((b) => b.accounts > 0 || b.value === "all").map((opt) => {
    const active = selectedBand === opt.value;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: opt.value,
        onClick: () => React.startTransition(() => {
          setSelectedBand(opt.value);
          setSelectedSubregions(/* @__PURE__ */ new Set());
        }),
        className: [
          "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
          active ? "border-2 border-emerald-400 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
        ].join(" ")
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, opt.label), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, opt.accounts.toLocaleString())),
      opt.value !== "all" && opt.atr > 0 && /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, formatCurrencyUSD(opt.atr))
    );
  }))), selectedFQ && subregionRows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section glass-card-surface" }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setSubregionOpen((p) => !p), className: "region-filter-section-head" }, /* @__PURE__ */ React.createElement("span", { className: `region-filter-chevron ${subregionOpen ? "is-open" : ""}` }, "\u25BC"), /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-title" }, "Sub-Regions"), selectedSubregions.size > 0 && /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-badge" }, selectedSubregions.size === 1 ? Array.from(selectedSubregions)[0] : selectedSubregions.size + " selected")), subregionOpen && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section-body max-h-40" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => setSelectedSubregions(/* @__PURE__ */ new Set())),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedSubregions.size === 0 ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    "All subregions"
  ), subregionRows.map((sr) => {
    const active = selectedSubregions.has(sr.sub);
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: sr.sub,
        onClick: () => React.startTransition(() => toggleSubregion(sr.sub)),
        className: [
          "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
          active ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
        ].join(" ")
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, sr.sub), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, sr.count.toLocaleString())),
      /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, formatCurrencyUSD(sr.atr))
    );
  }))), selectedFQ && csManagerRows.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section glass-card-surface" }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setCsManagerOpen((p) => !p), className: "region-filter-section-head" }, /* @__PURE__ */ React.createElement("span", { className: `region-filter-chevron ${csManagerOpen ? "is-open" : ""}` }, "\u25BC"), /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-title" }, "CS Manager"), selectedCsManager !== "__ALL_CSM__" && /* @__PURE__ */ React.createElement("span", { className: "region-filter-section-badge" }, selectedCsManager)), csManagerOpen && /* @__PURE__ */ React.createElement("div", { className: "region-filter-section-body max-h-48" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => React.startTransition(() => setSelectedCsManager("__ALL_CSM__")),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedCsManager === "__ALL_CSM__" ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    "All managers"
  ), csManagerRows.map((cm) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: cm.owner,
      onClick: () => React.startTransition(() => setSelectedCsManager(cm.owner)),
      className: [
        "w-full text-left rounded-lg px-2.5 py-1.5 transition border text-xs",
        selectedCsManager === cm.owner ? "border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-900/20 font-semibold" : "border-transparent bg-white/[0.15]"
      ].join(" ")
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, cm.owner), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400 pill-chip" }, cm.count.toLocaleString())),
    /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-500 dark:text-gray-400 mt-px tabular-nums" }, formatCurrencyUSD(cm.atr))
  )))))), /* @__PURE__ */ React.createElement("div", { className: "region-main-panel" }, /* @__PURE__ */ React.createElement("div", { id: "region-top-stack", className: "region-top-stack" }, /* @__PURE__ */ React.createElement("div", { id: "region-kpi-grid", className: "region-kpi-strip" }, [
    { label: "Total ATR", info: "Sum of ATR (Annual Target Revenue) across renewals in the current view \u2014 pending plus already-closed. Respects all active filters.", value: formatCurrencyUSD(kpis.fullAtr), sub: kpis.histCount > 0 ? `${kpis.acctCount.toLocaleString()} pending \xB7 ${kpis.histCount.toLocaleString()} closed` : `${kpis.acctCount.toLocaleString()} accounts` },
    { label: "Churn Health ATR", info: "Total ATR of accounts with a Churning health status, within the current filters.", value: formatCurrencyUSD(kpis.churnAtr), sub: `Churning health \xB7 ${formatPercent(kpis.totalAtr > 0 ? kpis.churnAtr / kpis.totalAtr : 0)} of pending` },
    { label: "Reviewed", info: "Share of pending accounts that have a note or an ELT Forecast override \u2014 i.e. an account has been actively reviewed.", value: kpis.acctCount > 0 ? `${Math.round(kpis.reviewedCount / kpis.acctCount * 100)}%` : "\u2014", sub: `${kpis.reviewedCount} of ${kpis.acctCount} accounts` },
    { label: "Booked C/C", info: "Churn & Contraction (C/C) already booked on renewals that have closed in the historical data for the current view.", value: kpis.bookedCC > 0 ? formatCurrencyUSD(kpis.bookedCC) : "\u2014", sub: kpis.histCount > 0 ? `${kpis.histCount.toLocaleString()} closed` : "No closed renewals" },
    { label: "Remaining C/C", info: "Bottoms-Up (BU) forecast of Churn & Contraction across pending renewals in view. The sub-line shows it as a % of pending ATR.", value: formatCurrencyUSD(kpis.remainingCC), sub: kpis.totalAtr > 0 ? `${formatPercent(kpis.ccRate)} of pending` : `${kpis.acctCount.toLocaleString()} pending` },
    { label: "Expected C/C", info: "Booked C/C + Remaining C/C \u2014 total expected Churn & Contraction (already-closed plus the Bottoms-Up forecast for pending renewals).", value: formatCurrencyUSD(kpis.expectedCC), sub: kpis.fullAtr > 0 ? `Booked + BU FC \xB7 ${formatPercent(kpis.expectedCcRate)}` : "Booked + BU FC" },
    { label: "ELT FC", info: "Booked C/C + ELT Forecast. Uses the per-renewal ELT Call override where one is set, otherwise falls back to the Bottoms-Up (BU) forecast.", value: formatCurrencyUSD(kpis.expectedDj), sub: kpis.djOverrideCount > 0 ? `Booked + ELT \xB7 ${kpis.djOverrideCount} override${kpis.djOverrideCount !== 1 ? "s" : ""}` : "Booked + ELT \xB7 no overrides" }
  ].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-labelrow" }, /* @__PURE__ */ React.createElement("span", { className: "glass-kpi-label" }, c.label), c.info && /* @__PURE__ */ React.createElement("span", { className: "kpi-info", tabIndex: 0, role: "note", "aria-label": c.label + ": " + c.info, "data-tip": c.info }, "\u24D8")), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value" }, c.value), c.sub && /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, c.sub)))), selectedFQ && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-2" }, "ATR Distribution"), /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, (() => {
    const bands = [
      { label: "$0 to <$12K", test: (r) => toNumber(r[atrKey]) > 0 && toNumber(r[atrKey]) <= 12e3 },
      { label: "$12K to $100K", test: (r) => toNumber(r[atrKey]) > 12e3 && toNumber(r[atrKey]) <= 1e5 },
      { label: "$100K+", test: (r) => toNumber(r[atrKey]) > 1e5 }
    ];
    const data = bands.map((b) => {
      const m = focusRows.filter(b.test);
      return { ...b, ct: m.length, sum: m.reduce((s, r) => s + toNumber(r[atrKey]), 0) };
    });
    const maxCt = Math.max(...data.map((d) => d.ct)) || 1;
    return data.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.label, className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "w-28 text-[11px] truncate shrink-0 text-gray-600 dark:text-gray-400" }, b.label), /* @__PURE__ */ React.createElement("div", { className: "flex-1 h-4 rounded glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "h-full rounded bg-gradient-to-r from-indigo-400 to-indigo-600 transition-all duration-300", style: { width: `${(b.ct / maxCt * 100).toFixed(0)}%` } })), /* @__PURE__ */ React.createElement("div", { className: "w-14 text-right text-[11px] tabular-nums font-medium text-gray-700 dark:text-gray-300 shrink-0" }, b.ct.toLocaleString()), /* @__PURE__ */ React.createElement("div", { className: "w-14 text-right text-[10px] tabular-nums text-gray-500 dark:text-gray-400 shrink-0" }, formatCurrencyUSD(b.sum))));
  })())), selectedFQ && /* @__PURE__ */ React.createElement(
    "div",
    { className: "region-viz-grid" },
    /* @__PURE__ */ React.createElement(
      "div",
      { className: "glass-kpi p-2.5" },
      /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5" }, "Health Mix"),
      (() => {
        const total = healthDist.reduce((s, h) => s + h.value, 0) || 1;
        return /* @__PURE__ */ React.createElement(
          React.Fragment,
          null,
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "flex h-2 rounded-full overflow-hidden mb-1.5" },
            healthDist.map((h) => /* @__PURE__ */ React.createElement("div", { key: h.key, style: { width: `${(h.value / total * 100).toFixed(1)}%`, backgroundColor: h.color }, title: `${h.label}: ${h.value}` }))
          ),
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "flex flex-wrap gap-1.5 text-[10px]" },
            healthDist.map((h) => /* @__PURE__ */ React.createElement("span", { key: h.key, className: "inline-flex items-center gap-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full", style: { backgroundColor: h.color } }), h.label, " ", /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, h.value)))
          )
        );
      })()
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      { className: "glass-card-surface p-2.5" },
      /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5" }, "Market Segment"),
      (() => {
        const total = segDist.reduce((s, h) => s + h.value, 0) || 1;
        return /* @__PURE__ */ React.createElement(
          React.Fragment,
          null,
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "flex h-2 rounded-full overflow-hidden mb-1.5" },
            segDist.map((s) => /* @__PURE__ */ React.createElement("div", { key: s.key, style: { width: `${(s.value / total * 100).toFixed(1)}%`, backgroundColor: s.color }, title: `${s.label}: ${s.value}` }))
          ),
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "flex flex-wrap gap-1.5 text-[10px]" },
            segDist.map((s) => /* @__PURE__ */ React.createElement("span", { key: s.key, className: "inline-flex items-center gap-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full", style: { backgroundColor: s.color } }), s.label, " ", /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, s.value)))
          )
        );
      })()
    )
  ), selectedFQ && healthAtrDist.length > 0 && /* @__PURE__ */ React.createElement(
    "div",
    { className: "glass-card-surface p-2.5 region-span-full" },
    /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-1.5" }, "ATR ($) by Health"),
    (() => {
      const maxAtr = Math.max(...healthAtrDist.map((h) => h.atr)) || 1;
      const totalAtr = healthAtrDist.reduce((s, h) => s + h.atr, 0) || 1;
      return /* @__PURE__ */ React.createElement(
        "div",
        { className: "space-y-1.5" },
        healthAtrDist.map((h) => /* @__PURE__ */ React.createElement(
          "div",
          { key: h.key, className: "flex items-center gap-2" },
          /* @__PURE__ */ React.createElement("div", { className: "w-24 text-[11px] truncate shrink-0 text-gray-600 dark:text-gray-400 flex items-center gap-1" }, /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full shrink-0", style: { backgroundColor: h.color } }), h.label),
          /* @__PURE__ */ React.createElement("div", { className: "flex-1 h-4 rounded glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "h-full rounded transition-all duration-300", style: { width: `${(h.atr / maxAtr * 100).toFixed(1)}%`, backgroundColor: h.color, opacity: 0.85 } })),
          /* @__PURE__ */ React.createElement("div", { className: "w-16 text-right text-[11px] tabular-nums font-medium text-gray-700 dark:text-gray-300 shrink-0" }, formatCurrencyUSD(h.atr)),
          /* @__PURE__ */ React.createElement("div", { className: "w-10 text-right text-[10px] tabular-nums text-gray-500 dark:text-gray-400 shrink-0" }, `${(h.atr / totalAtr * 100).toFixed(0)}%`)
        ))
      );
    })()
  ), kpis.target > 0 && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-2.5 region-span-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold" }, "Target Gap"), /* @__PURE__ */ React.createElement("div", { className: `text-lg font-bold tabular-nums ${gapColor(kpis.gap)}` }, (kpis.gap >= 0 ? "+" : "") + formatCurrencyUSD(kpis.gap)), /* @__PURE__ */ React.createElement("div", { className: "text-[10px] text-gray-500 dark:text-gray-400" }, formatPercent(kpis.attain || 0), " attained"), /* @__PURE__ */ React.createElement("div", { className: "flex-1 h-2 rounded-full glass-track overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: `h-full rounded-full transition-all duration-300 ${(kpis.attain || 0) >= 1 ? "bg-emerald-400" : (kpis.attain || 0) >= 0.9 ? "bg-amber-400" : "bg-red-400"}`, style: { width: `${Math.min((kpis.attain || 0) * 100, 100).toFixed(0)}%` } })))), selectedFQ && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-4 region-accounts-panel" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold" }, "Accounts"), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tabular-nums text-gray-500 dark:text-gray-400" }, detailRowsSorted.length.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement("select", { value: detailLimit, onChange: (e) => setDetailLimit(e.target.value === "all" ? "all" : Number(e.target.value)), className: "px-2 py-1.5 rounded-md filter-input text-xs" }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All"), [25, 50, 100, 200].map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n }, "Top ", n))), /* @__PURE__ */ React.createElement("button", { type: "button", title: "Open Executive Summary in new tab", className: "px-2.5 py-1.5 rounded-md border border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold transition-colors", onClick: () => {
    generateRegionExecSummary({ focusRows, kpis, healthDist, segDist, detailRowsSorted, notes, selectedFQ, selectedBand, selectedSubregions, atrKey, buKey, acctKey, ownerKey, healthKey, segKey, subregionKey, dateKey });
  } }, "Exec Summary"), /* @__PURE__ */ React.createElement("button", { type: "button", title: "Export table as CSV", className: "p-1.5 rounded-md border border-transparent bg-white/[0.15] hover:bg-white/[0.25] transition-colors", onClick: () => {
    const vis = detailLimit === "all" ? detailRowsSorted : detailRowsSorted.slice(0, Number(detailLimit));
    if (!vis.length) {
      alert("No rows to export");
      return;
    }
    const hdr = ["Account", "Renewal", "ATR", "C/C FC", "ELT Call", "CC%", "Adj CC%", "Best Case", "Worst Case", "Health", "Owner", "Partner", "Renewal Dictated By"];
    const csvRows = [hdr.join(",")];
    vis.forEach((row) => {
      const esc = escapeCsvField;
      csvRows.push([esc(row.account), esc(row.date), row.atr, row.bu, row.dj != null ? row.dj : "", isFinite(row.cc) ? (row.cc * 100).toFixed(1) + "%" : "", isFinite(row.adjCc) ? (row.adjCc * 100).toFixed(1) + "%" : "", row.bestCase != null ? row.bestCase : "", row.worstCase != null ? row.worstCase : "", esc(row.health), esc(row.owner), esc(row.partner), esc(safeString(row.r && row.r[hm.DICTATED_BY]))].join(","));
    });
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewals_region_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } }, /* @__PURE__ */ React.createElement("svg", { className: "w-3.5 h-3.5 text-gray-500 dark:text-gray-400", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2 }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" }))))), /* @__PURE__ */ React.createElement("div", { className: "table-container compact-table", style: { maxHeight: "420px" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full w-full table-fixed text-[10px]" }, /* @__PURE__ */ React.createElement("thead", { className: "text-[10px] uppercase text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", onClick: () => toggleSort("account") }, "Account ", sortIcon("account")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer hidden sm:table-cell", style: { width: "72px" }, onClick: () => toggleSort("date") }, "Renewal ", sortIcon("date")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer", style: { width: "68px" }, onClick: () => toggleSort("atr") }, "ATR ", sortIcon("atr")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer hidden sm:table-cell", style: { width: "68px" }, onClick: () => toggleSort("bu") }, "C/C FC ", sortIcon("bu")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer", style: { width: "68px" }, onClick: () => toggleSort("dj") }, "ELT Call ", sortIcon("dj")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer hidden sm:table-cell", style: { width: "42px" }, onClick: () => toggleSort("cc") }, "CC% ", sortIcon("cc")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer hidden sm:table-cell", style: { width: "52px" }, title: "Effective forecast (ELT call if set, else BU FC) \u00F7 ATR", onClick: () => toggleSort("adjCc") }, "Adj CC% ", sortIcon("adjCc")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer hidden sm:table-cell", style: { width: "68px" }, title: "BU FC + Upside", onClick: () => toggleSort("bestCase") }, "Best ", sortIcon("bestCase")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-right cursor-pointer hidden sm:table-cell", style: { width: "68px" }, title: "BU FC + Downside", onClick: () => toggleSort("worstCase") }, "Worst ", sortIcon("worstCase")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer", style: { width: "62px" }, onClick: () => toggleSort("health") }, "Health ", sortIcon("health")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left cursor-pointer hidden sm:table-cell", style: { width: "90px" }, onClick: () => toggleSort("owner") }, "Owner ", sortIcon("owner")), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left hidden sm:table-cell", style: { width: "90px" } }, "Partner"), /* @__PURE__ */ React.createElement("th", { className: "px-1 py-1 text-left hidden sm:table-cell", style: { width: "110px" }, title: "Renewal Dictated By" }, "Dictated By"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-gray-100 dark:divide-gray-800" }, detailRowsSorted.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3, className: "px-1.5 py-2 text-center text-xs text-gray-500 sm:hidden" }, "No accounts for this selection"), /* @__PURE__ */ React.createElement("td", { colSpan: 13, className: "px-1.5 py-2 text-center text-xs text-gray-500 hidden sm:table-cell" }, "No accounts for this selection")), (detailLimit === "all" ? detailRowsSorted : detailRowsSorted.slice(0, Number(detailLimit))).map(({ r, account, owner, partner, partnerType, date, atr, bu, cc, adjCc, bestCase, worstCase, health, dj }, idx) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      key: r.__uid || account + date,
      className: `glass-row-accent`,
      onClick: () => setSelectedAccountRow(r)
    },
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate", title: account || "" }, account || "(Unnamed)", notes[r.__noteKey] && /* @__PURE__ */ React.createElement("span", { className: "ml-1 text-amber-500", title: "Has notes" }, "\u25CF")),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 whitespace-nowrap hidden sm:table-cell" }, date || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap" }, formatCurrencyUSD(atr)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap hidden sm:table-cell" }, formatCurrencyUSD(bu)),
    /* @__PURE__ */ React.createElement("td", { className: `px-1 py-1 text-right tabular-nums whitespace-nowrap ${dj !== null ? dj < bu ? "text-red-500 dark:text-red-400 font-medium" : "text-emerald-600 dark:text-emerald-400 font-medium" : "text-gray-300 dark:text-gray-600"}` }, dj !== null ? formatCurrencyUSD(dj) : "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap hidden sm:table-cell" }, formatPercent(cc)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap hidden sm:table-cell" }, formatPercent(adjCc)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap hidden sm:table-cell" }, bestCase !== null ? formatCurrencyUSD(bestCase) : "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 text-right tabular-nums whitespace-nowrap hidden sm:table-cell" }, worstCase !== null ? formatCurrencyUSD(worstCase) : "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1" }, healthBadge(health)),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate hidden sm:table-cell", title: owner || "" }, owner || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate hidden sm:table-cell", title: partner || "" }, partner || "\u2014"),
    /* @__PURE__ */ React.createElement("td", { className: "px-1 py-1 truncate hidden sm:table-cell", title: safeString(r[hm.DICTATED_BY]) || "" }, safeString(r[hm.DICTATED_BY]) || "\u2014")
  ))))))), selectedAccountRow && /* @__PURE__ */ React.createElement(
    AccountNoteModal,
    {
      row: selectedAccountRow,
      notes,
      headerMap: hm,
      settings: state.settings,
      touchByAccount,
      rollups: accountRollups,
      formatCurrencyInputFn: formatCurrencyInput,
      onSave: (nk, payload) => {
        const prior = notes[nk] || {};
        actions.setNote(nk, { ...prior, ...payload });
        setSelectedAccountRow(null);
      },
      onClose: () => setSelectedAccountRow(null),
      onArchiveNote: (key) => {
        const prior = notes[key] || {};
        actions.setNote(key, { ...prior, archived: true, updatedAt: Date.now() });
      },
      onDeleteNote: (key) => {
        actions.setNote(key, null);
      }
    }
  )));
}
function NoteHistoryPanel({ history }) {
  const [open, setOpen] = React.useState(false);
  const items = Array.isArray(history) ? history : [];
  if (!items.length) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "mt-2" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex items-center gap-1 text-[9px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors", onClick: () => setOpen(!open) }, /* @__PURE__ */ React.createElement("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" })), "Edit History (", items.length, ")"), open && /* @__PURE__ */ React.createElement("div", { className: "mt-1.5 ml-1 border-l-2 border-indigo-200 dark:border-indigo-800 pl-3 space-y-2 max-h-48 overflow-y-auto" }, items.map((h, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "text-[9px] text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-gray-600 dark:text-gray-300" }, formatNoteDate(h.timestamp), h.editedByDisplay && /* @__PURE__ */ React.createElement("span", { className: "ml-1 font-normal text-gray-500 dark:text-gray-400" }, "\xB7 ", h.editedByDisplay), h.djForecast != null && isFinite(h.djForecast) && /* @__PURE__ */ React.createElement("span", { className: "ml-2 text-indigo-500 dark:text-indigo-400" }, "ELT: ", fmtCompact(h.djForecast))), h.note && /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 leading-snug", style: { wordBreak: "break-word" } }, h.note.length > 120 ? h.note.slice(0, 120) + "..." : h.note)))));
}
function RelatedRenewalsPanel({ noteKey, notes, accountName, onCopyFrom, onCopyAndArchive, onConsolidateAll, onDeleteRelated }) {
  const related = React.useMemo(() => {
    if (!noteKey || !notes) return [];
    const prefix = noteKey.split("::")[0];
    if (!prefix) return [];
    return Object.entries(notes).filter(([k, v]) => k !== noteKey && k.startsWith(prefix + "::") && !v.archived).map(([k, v]) => {
      const parts = k.split("::");
      return { key: k, period: parts[1] || "?", atr: Number(parts[2]) || 0, note: v, noteText: safeString(v.note), dj: v.djForecast, updatedAt: v.updatedAt };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [noteKey, notes]);
  const [open, setOpen] = React.useState(false);
  if (!related.length) return null;
  const handleConsolidateAll = (e) => {
    e.stopPropagation();
    if (!window.confirm(`Merge ${related.length} note${related.length === 1 ? "" : "s"} into this entry and archive the originals?`)) return;
    onConsolidateAll(related);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "mt-3 pt-3 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest hover:text-gray-700 dark:hover:text-gray-300 transition-colors", onClick: () => setOpen(!open) }, /* @__PURE__ */ React.createElement("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" })), "Other Renewals for ", accountName || "this account", " (", related.length, ")"), open && onConsolidateAll && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ml-auto text-[9px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 transition-colors", onClick: handleConsolidateAll }, "Consolidate All")), open && /* @__PURE__ */ React.createElement("div", { className: "mt-2 ml-1 border-l-2 border-gray-200 dark:border-gray-700 pl-3 space-y-2.5 max-h-56 overflow-y-auto" }, related.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.key, className: "text-[10px] text-gray-500 dark:text-gray-400" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 font-medium text-gray-600 dark:text-gray-300" }, /* @__PURE__ */ React.createElement("span", { className: "pill-chip text-[9px] font-semibold" }, r.period), /* @__PURE__ */ React.createElement("span", null, "ATR: ", fmtCompact(r.atr)), r.dj != null && isFinite(r.dj) && /* @__PURE__ */ React.createElement("span", { className: "text-indigo-500 dark:text-indigo-400" }, "ELT: ", fmtCompact(r.dj)), /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, relativeTime(r.updatedAt)), /* @__PURE__ */ React.createElement("span", { className: "ml-auto flex items-center gap-2.5" }, onCopyFrom && /* @__PURE__ */ React.createElement("button", { type: "button", className: "text-[9px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors", onClick: (e) => {
    e.stopPropagation();
    onCopyFrom(r.note);
  } }, "Copy"), onCopyAndArchive && /* @__PURE__ */ React.createElement("button", { type: "button", className: "text-[9px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 transition-colors", onClick: (e) => {
    e.stopPropagation();
    onCopyAndArchive(r.note, r.key);
  } }, "Copy & Archive"), onDeleteRelated && /* @__PURE__ */ React.createElement("button", { type: "button", className: "text-[9px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors", onClick: (e) => {
    e.stopPropagation();
    if (window.confirm("Delete this note? This cannot be undone.")) onDeleteRelated(r.key);
  } }, "Delete"))), r.noteText && /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 text-[10px] leading-snug", style: { wordBreak: "break-word" } }, r.noteText.length > 120 ? r.noteText.slice(0, 120) + "..." : r.noteText)))));
}
function parseNoteEntries(text) {
  if (!text) return [];
  const parts = text.split(/^---\s*(.+?)\s*---$/m);
  if (parts.length <= 1) return text.trim() ? [{ date: null, text: text.trim() }] : [];
  const entries = [];
  if (parts[0].trim()) entries.push({ date: null, text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i] || "";
    const body = (parts[i + 1] || "").trim();
    if (body) entries.push({ date, text: body });
  }
  return entries;
}
function parseNoteEntryMeta(header) {
  if (!header) return { when: null, author: null };
  const sep = header.indexOf(" \xB7 ");
  if (sep >= 0) return { when: header.slice(0, sep).trim(), author: header.slice(sep + 3).trim() };
  return { when: header.trim(), author: null };
}
function renewalsCurrentAuthor() {
  const u = typeof window !== "undefined" && window.__renewalsCurrentUser;
  if (!u) return "";
  return safeString(u.displayName) || safeString(u.email);
}
function parseEntryDate(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d) ? 0 : d.getTime();
}
function mergeNoteEntries(existingText, newEntries) {
  const existing = parseNoteEntries(existingText);
  const combined = [...existing, ...newEntries];
  combined.sort((a, b) => parseEntryDate(b.date) - parseEntryDate(a.date));
  return combined.map((e) => e.date ? `--- ${e.date} ---
${e.text}` : e.text).join("\n\n");
}
function prependNoteEntry(existing, newText) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const author = renewalsCurrentAuthor();
  const header = author ? `${dateStr}, ${timeStr} \xB7 ${author}` : `${dateStr}, ${timeStr}`;
  const entry = `--- ${header} ---
${newText.trim()}`;
  if (!existing || !existing.trim()) return entry;
  return entry + "\n\n" + existing;
}
function AccountNoteModal({ row, notes, headerMap, settings, touchByAccount, rollups, onSave, onClose, formatCurrencyInputFn, onArchiveNote, onDeleteNote }) {
  const normDj = (raw) => {
    if (raw == null) return "";
    return String(raw).replace(/[^\d\.\-]/g, "");
  };
  const fmtCurr = formatCurrencyInputFn || ((v) => fmtCompact(v));
  const atrKey = getAtrKey(headerMap, settings);
  const buKey = getBuKey(headerMap, settings);
  const dateKey = headerMap.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const healthKey = headerMap.HEALTH || "CRM_HEALTH_STATUS";
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const acctKey = headerMap.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const acctIdKey = headerMap.ACCOUNT_ID || "CRM_ACCOUNT_ID";
  const qKey = headerMap.FISCAL_QUARTER || headerMap.YEAR_QUARTER || "YEAR_QUARTER";
  const partnerKey = headerMap.PARTNER || "PARTNER";
  const regionKey = headerMap.REGION || "REGION";
  const countryKey = headerMap.BILLING_COUNTRY || headerMap.COUNTRY || "COUNTRY";
  const segmentKey = headerMap.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const summaryKey = headerMap.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const touchKey = headerMap.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
  const upsideKey = headerMap.UPSIDE || "UPSIDE";
  const downsideKey = headerMap.DOWNSIDE || "DOWNSIDE";
  const products = Array.isArray(row.__products) ? row.__products : (safeString(row[headerMap.PRODUCT_LINES]) || "").split(/[,;|]/).map((s) => safeString(s)).filter(Boolean);
  const nk = row.__noteKey;
  const existing = nk ? notes[nk] : null;
  const [noteDraft, setNoteDraft] = React.useState(existing ? safeString(existing.note) : "");
  const [djDraft, setDjDraft] = React.useState(() => {
    if (existing && existing.djForecast != null && isFinite(existing.djForecast)) return fmtCurr(existing.djForecast);
    return "";
  });
  const [csDraft, setCsDraft] = React.useState("");
  const [rnDraft, setRnDraft] = React.useState("");
  const [callHistory, setCallHistory] = React.useState([]);
  const _callKey = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKey(row, headerMap, settings) : null;
  const _callAccountId = safeString(row[acctIdKey]);
  React.useEffect(() => {
    if (!_callKey || !_callAccountId) return;
    let cancelled = false;
    const url = "/api/renewals/account-forecasts/" + encodeURIComponent(_callAccountId) + "?call_key=" + encodeURIComponent(_callKey);
    const load = (attempt) => {
      fetch(url, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then((d) => {
        if (cancelled || !d) return;
        if (d.cs_forecast != null && isFinite(toNumber(d.cs_forecast))) setCsDraft(fmtCurr(toNumber(d.cs_forecast)));
        if (d.renewals_forecast != null && isFinite(toNumber(d.renewals_forecast))) setRnDraft(fmtCurr(toNumber(d.renewals_forecast)));
        if (Array.isArray(d.history)) setCallHistory(d.history);
      }).catch(() => {
        // Retry transient failures (e.g. a briefly-busy pool) so the saved
        // call still loads on first open rather than leaving the fields blank.
        if (cancelled || attempt >= 2) return;
        setTimeout(() => {
          if (!cancelled) load(attempt + 1);
        }, 300 * (attempt + 1));
      });
    };
    load(0);
    return () => {
      cancelled = true;
    };
  }, [_callKey, _callAccountId]);
  const _csVal = normDj(csDraft) === "" ? null : toNumber(normDj(csDraft));
  const _rnVal = normDj(rnDraft) === "" ? null : toNumber(normDj(rnDraft));
  const _hasCall = _csVal != null && isFinite(_csVal) || _rnVal != null && isFinite(_rnVal);
  const _eltComputed = _hasCall ? (isFinite(_csVal) ? _csVal : 0) + (isFinite(_rnVal) ? _rnVal : 0) : null;
  const [newEntry, setNewEntry] = React.useState("");
  const [showRaw, setShowRaw] = React.useState(false);
  const [showForecast, setShowForecast] = React.useState(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);
  const saveRef = React.useRef(null);
  const atr = toNumber(row[atrKey]);
  const bu = toNumber(row[buKey]);
  const grr = atr > 0 ? (atr - bu) / atr : 1;
  const cc = atr > 0 ? bu / atr : 0;
  const _effFc = _hasCall ? _eltComputed || 0 : bu;
  const adjCc = atr > 0 ? _effFc / atr : 0;
  const _hasUpside = safeString(row[upsideKey]) !== "";
  const _hasDownside = safeString(row[downsideKey]) !== "";
  const bestCase = bu + toNumber(row[upsideKey]);
  const worstCase = bu + toNumber(row[downsideKey]);
  const renewalDt = parseDate(row[dateKey]);
  const daysToRenew = renewalDt ? Math.round((renewalDt - /* @__PURE__ */ new Date()) / 864e5) : null;
  const touchVal = toNumber(row[touchKey]);
  const healthRaw = safeString(row[healthKey]).toLowerCase();
  const healthLabel = safeString(row[healthKey]) || "--";
  const acctKeyVal = accountKeyFromRow(row, headerMap);
  const roll = rollups ? rollups.get(acctKeyVal) : null;
  const accountArr = roll?.maxNetArr != null ? roll.maxNetArr : toNumber(row[headerMap.NET_ARR_PRIOR || "NET_ARR_USD_PRIOR_QTR_END"]);
  const largest = roll?.largest || null;
  const summaryText = safeString(row[summaryKey]);
  const healthColor = /green/.test(healthRaw) ? "text-emerald-600 dark:text-emerald-400" : /red/.test(healthRaw) ? "text-red-500 dark:text-red-400" : /amber|yellow|orange/.test(healthRaw) ? "text-amber-600 dark:text-amber-400" : "text-gray-500";
  const entries = React.useMemo(() => parseNoteEntries(noteDraft), [noteDraft]);
  const callUpdates = React.useMemo(() => {
    const hist = Array.isArray(callHistory) ? callHistory : [];
    const out = [];
    for (let i = 0; i < hist.length; i++) {
      const cur = hist[i];
      const older = hist[i + 1] || null;
      const ts = cur.effective_date ? new Date(cur.effective_date).getTime() : null;
      const who = safeString(cur.edited_by_display) || safeString(cur.edited_by_email) || "";
      const curCs = cur.cs_forecast != null && isFinite(toNumber(cur.cs_forecast)) ? toNumber(cur.cs_forecast) : null;
      const curRn = cur.renewals_forecast != null && isFinite(toNumber(cur.renewals_forecast)) ? toNumber(cur.renewals_forecast) : null;
      const oldCs = older && older.cs_forecast != null && isFinite(toNumber(older.cs_forecast)) ? toNumber(older.cs_forecast) : null;
      const oldRn = older && older.renewals_forecast != null && isFinite(toNumber(older.renewals_forecast)) ? toNumber(older.renewals_forecast) : null;
      const changes = [];
      if (cur.source === "clear" || curCs == null && curRn == null && older && (oldCs != null || oldRn != null)) {
        changes.push("Calls cleared");
      } else {
        if (!older || curCs !== oldCs) changes.push(curCs == null ? "CS Forecast cleared" : `CS Forecast set to ${fmtCurr(curCs)}`);
        if (!older || curRn !== oldRn) changes.push(curRn == null ? "Renewals Forecast cleared" : `Renewals Forecast set to ${fmtCurr(curRn)}`);
      }
      if (!changes.length) continue;
      out.push({ ts, who, changes, key: `call-${ts || i}-${i}` });
    }
    return out;
  }, [callHistory]);
  const handleAddEntry = () => {
    const text = newEntry.trim();
    if (!text) return;
    setNoteDraft((prev) => prependNoteEntry(prev, text));
    setNewEntry("");
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddEntry();
    }
  };
  const handleSave = () => {
    if (!nk) {
      alert("Missing stable key");
      return;
    }
    const djRaw = normDj(djDraft);
    const djVal = djRaw === "" ? null : toNumber(djRaw);
    onSave(nk, {
      accountId: safeString(row[acctIdKey]),
      accountName: safeString(row[acctKey]),
      owner: safeString(row[ownerKey]),
      renewalDate: safeString(row[dateKey]),
      fq: safeString(row[qKey]),
      atr,
      note: noteDraft,
      djForecast: _hasCall ? null : djVal !== null && isFinite(djVal) ? djVal : null,
      archived: false,
      updatedAt: Date.now()
    });
    if (_callKey && _callAccountId && _hasCall) {
      const yq = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.yearQuarterFromRow(row, headerMap) : "";
      const ratr = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.effectiveAtrFromRow(row, headerMap, settings) : 0;
      fetch("/api/renewals/account-forecasts/" + encodeURIComponent(_callAccountId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_key: _callKey,
          account_name: safeString(row[acctKey]),
          year_quarter: yq,
          rounded_atr: ratr,
          cs_forecast: _csVal != null && isFinite(_csVal) ? _csVal : null,
          renewals_forecast: _rnVal != null && isFinite(_rnVal) ? _rnVal : null,
          source: "modal_done"
        })
      }).then((r) => {
        if (r.ok) {
          try {
            window.dispatchEvent(new CustomEvent("renewals-acctfc-changed"));
          } catch (_) {
          }
        }
      }).catch(() => {
      });
    }
  };
  saveRef.current = handleSave;
  React.useEffect(() => {
    if (typeof window !== "undefined") window.__renewalsActiveModalRow = row;
    return () => {
      if (typeof window !== "undefined") delete window.__renewalsActiveModalRow;
    };
  }, [row]);
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveRef.current?.();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const copyFromRelated = (src) => {
    const srcText = safeString(src.note);
    if (srcText) {
      const srcEntries = parseNoteEntries(srcText);
      if (srcEntries.length) {
        const fallbackDate = src.updatedAt ? new Date(src.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const dated = srcEntries.map((e) => ({ ...e, date: e.date || fallbackDate }));
        setNoteDraft((prev) => mergeNoteEntries(prev, dated));
      }
    }
    if (!djDraft && src.djForecast != null && isFinite(src.djForecast)) setDjDraft(fmtCurr(src.djForecast));
  };
  const copyAndArchiveFromRelated = (noteObj, noteKey) => {
    copyFromRelated(noteObj);
    if (onArchiveNote) onArchiveNote(noteKey);
  };
  const consolidateAllRelated = (entries2) => {
    const sorted = [...entries2].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    let allNewEntries = [];
    let latestDj = null;
    sorted.forEach((r) => {
      const srcText = safeString(r.note?.note || r.noteText);
      if (srcText) {
        const srcEntries = parseNoteEntries(srcText);
        const fallbackDate = r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        srcEntries.forEach((e) => allNewEntries.push({ ...e, date: e.date || fallbackDate }));
      }
      if (r.dj != null && isFinite(r.dj)) latestDj = r.dj;
    });
    if (allNewEntries.length) setNoteDraft((prev) => mergeNoteEntries(prev, allNewEntries));
    if (!djDraft && latestDj != null) setDjDraft(fmtCurr(latestDj));
    if (onArchiveNote) sorted.forEach((r) => onArchiveNote(r.key));
  };
  return /* @__PURE__ */ React.createElement("div", { className: "modal-overlay", onClick: (e) => {
    if (e.target === e.currentTarget) {
      handleSave();
    }
  } }, /* @__PURE__ */ React.createElement("div", { className: "acct-modal-panel" }, /* @__PURE__ */ React.createElement("div", { className: "acct-modal-hdr" }, /* @__PURE__ */ React.createElement("div", { className: "acct-modal-hdr-name", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, safeString(row[acctKey]) || "(Unnamed)"), /* @__PURE__ */ React.createElement("div", { className: "acct-modal-hdr-pills" }, /* @__PURE__ */ React.createElement("span", { className: "acct-hdr-pill acct-hdr-pill-atr" }, fmtCompact(atr), " ATR"), (() => {
    const ht = healthLabel.toLowerCase();
    const cls = ht === "green" ? "acct-hdr-pill-health-green" : ht === "red" ? "acct-hdr-pill-health-red" : /amber|yellow|orange/.test(ht) ? "acct-hdr-pill-health-yellow" : "";
    return /* @__PURE__ */ React.createElement("span", { className: `acct-hdr-pill ${cls}` }, healthLabel);
  })(), safeString(row[regionKey]) && /* @__PURE__ */ React.createElement("span", { className: "acct-hdr-pill" }, safeString(row[regionKey])), safeString(row[segmentKey]) && /* @__PURE__ */ React.createElement("span", { className: "acct-hdr-pill" }, safeString(row[segmentKey])), safeString(row[ownerKey]) && /* @__PURE__ */ React.createElement("span", { className: "acct-hdr-pill" }, safeString(row[ownerKey])))), /* @__PURE__ */ React.createElement("div", { className: "acct-modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "acct-modal-cols" }, /* @__PURE__ */ React.createElement("div", { className: "acct-modal-sidebar space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400" }, "Metrics"), [
    ["ATR", fmtCompact(atr)],
    ["BU FC", `${fmtCompact(bu)} (${formatPercent(cc)} C/C)`],
    ["Adj. C/C %", formatPercent(adjCc)],
    ["GRR", formatPercent(grr)],
    isFinite(accountArr) ? ["Acct ARR", fmtCompact(accountArr)] : null
  ].filter(Boolean).map(([label, val]) => /* @__PURE__ */ React.createElement("div", { key: label, className: "flex justify-between items-baseline" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400" }, label), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-bold text-gray-800 dark:text-gray-100 tabular-nums" }, val)))), (() => {
    const isRisk = /red|amber|yellow|orange/.test(healthRaw);
    const isSoon = daysToRenew != null && daysToRenew <= 60;
    const isStale = isFinite(touchVal) && touchVal >= 60;
    if (!isRisk && !isSoon && !isStale) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1 pt-2 border-t border-gray-100 dark:border-gray-700" }, isRisk && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-risk text-[9px]" }, "At risk"), isSoon && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-soon text-[9px]" }, daysToRenew, "d to renewal"), isStale && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-touch text-[9px]" }, "Touch stale ", touchVal, "d"));
  })(), /* @__PURE__ */ React.createElement("div", { className: "space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400" }, "Renewal"), [
    ["Date", safeString(row[dateKey]) || "--"],
    daysToRenew != null ? ["Days to renew", `${daysToRenew}d`] : null,
    isFinite(touchVal) && touchVal > 0 ? ["Days since touch", `${touchVal}d`] : null,
    largest ? ["Largest", `${largest.date || "--"} \xB7 ${fmtCompact(largest.atr || 0)}`] : null,
    _hasUpside ? ["Best case", fmtCompact(bestCase)] : null,
    _hasDownside ? ["Worst case", fmtCompact(worstCase)] : null,
    safeString(row[headerMap.DICTATED_BY]) ? ["Dictated by", safeString(row[headerMap.DICTATED_BY])] : null
  ].filter(Boolean).map(([label, val]) => /* @__PURE__ */ React.createElement("div", { key: label, className: "flex justify-between items-baseline" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400" }, label), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-medium text-gray-800 dark:text-gray-100" }, val)))), safeString(row[partnerKey]) && /* @__PURE__ */ React.createElement("div", { className: "space-y-1 pt-2 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400" }, "Partner"), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-700 dark:text-gray-200" }, safeString(row[partnerKey]))), products.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-1 pt-2 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400" }, "Products"), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1" }, products.map((p, i) => /* @__PURE__ */ React.createElement("span", { key: `${p}-${i}`, className: "pill-chip pill-chip-muted" }, p)))), summaryText && /* @__PURE__ */ React.createElement("div", { className: "pt-2 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex items-center gap-1 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest hover:text-gray-700 dark:hover:text-gray-300 transition-colors", onClick: () => setShowForecast(!showForecast) }, /* @__PURE__ */ React.createElement("svg", { className: `w-3 h-3 transition-transform ${showForecast ? "rotate-90" : ""}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" }, /* @__PURE__ */ React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" })), "Forecast Summary"), showForecast && /* @__PURE__ */ React.createElement("div", { className: "mt-1.5 text-[11px] text-gray-700 dark:text-gray-200 leading-relaxed" }, summaryText))), /* @__PURE__ */ React.createElement("div", { className: "acct-modal-main" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3 mb-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400 mb-1" }, "CS Forecast"), /* @__PURE__ */ React.createElement("input", { className: "w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 text-xs font-bold px-2.5 py-1.5 tabular-nums", inputMode: "decimal", placeholder: "--", value: csDraft, onChange: (e) => setCsDraft(e.target.value), onFocus: () => setCsDraft(normDj(csDraft)), onBlur: () => {
    const raw = normDj(csDraft);
    setCsDraft(raw === "" ? "" : isFinite(toNumber(raw)) ? fmtCurr(toNumber(raw)) : "");
  }, onKeyDown: (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRef.current?.();
    }
  } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400 mb-1" }, "Renewals Forecast"), /* @__PURE__ */ React.createElement("input", { className: "w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 text-xs font-bold px-2.5 py-1.5 tabular-nums", inputMode: "decimal", placeholder: "--", value: rnDraft, onChange: (e) => setRnDraft(e.target.value), onFocus: () => setRnDraft(normDj(rnDraft)), onBlur: () => {
    const raw = normDj(rnDraft);
    setRnDraft(raw === "" ? "" : isFinite(toNumber(raw)) ? fmtCurr(toNumber(raw)) : "");
  }, onKeyDown: (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRef.current?.();
    }
  } }))), /* @__PURE__ */ React.createElement("div", { className: "text-[10px] text-gray-400 mb-3" }, _hasCall ? "ELT Forecast = CS + Renewals (read-only). Clear both to set ELT manually. Calls save when you click Done." : "Enter CS and/or Renewals to compute ELT, or set ELT manually below."), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2.5 mb-4" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400 shrink-0" }, "ELT Forecast"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-28 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 text-xs font-bold px-2.5 py-1.5 tabular-nums",
      inputMode: "decimal",
      placeholder: "--",
      value: _hasCall ? fmtCurr(_eltComputed) : djDraft,
      readOnly: _hasCall,
      title: _hasCall ? "ELT = CS + Renewals (clear both to edit manually)" : "",
      onChange: (e) => {
        if (!_hasCall) setDjDraft(e.target.value);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!_hasCall) {
            const raw = normDj(djDraft);
            if (raw !== "") {
              const n = toNumber(raw);
              setDjDraft(isFinite(n) ? fmtCurr(n) : "");
            }
          }
          saveRef.current?.();
        }
      },
      onBlur: () => {
        const raw = normDj(djDraft);
        if (raw === "") {
          setDjDraft("");
          return;
        }
        const n = toNumber(raw);
        setDjDraft(isFinite(n) ? fmtCurr(n) : "");
      },
      onFocus: () => setDjDraft(normDj(djDraft))
    }
  ), !_hasCall && /* @__PURE__ */ React.createElement("button", { type: "button", className: "smallbtn smallbtn-xs smallbtn-indigo", onClick: () => setDjDraft(fmtCurr(bu)) }, "= BU FC"), !_hasCall && /* @__PURE__ */ React.createElement("button", { type: "button", className: "smallbtn smallbtn-xs smallbtn-emerald", onClick: () => setDjDraft("$0") }, "Flat"), !_hasCall && djDraft && /* @__PURE__ */ React.createElement("button", { type: "button", className: "smallbtn smallbtn-xs smallbtn-slate", onClick: () => setDjDraft("") }, "Clear"), _hasCall && /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400" }, "= CS + Renewals")), /* @__PURE__ */ React.createElement("div", { className: "mb-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: inputRef,
      className: "flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 text-xs px-3 py-2.5",
      placeholder: "Type your update and press Enter...",
      value: newEntry,
      onChange: (e) => setNewEntry(e.target.value),
      onKeyDown: handleKeyDown
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo text-[11px] px-4", onClick: handleAddEntry, disabled: !newEntry.trim() }, "Add")), /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-400 mt-1" }, "Enter to add entry \xB7 Cmd+S to save")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-2" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-400" }, "Updates"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "smallbtn smallbtn-xs smallbtn-slate", onClick: () => setShowRaw(!showRaw) }, showRaw ? "Timeline view" : "Edit raw")), showRaw ? /* @__PURE__ */ React.createElement(
    "textarea",
    {
      className: "w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 text-[11px] leading-relaxed p-3 resize-y",
      style: { minHeight: "14rem", lineHeight: "1.6" },
      value: noteDraft,
      onChange: (e) => setNoteDraft(e.target.value)
    }
  ) : /* @__PURE__ */ React.createElement("div", { className: "space-y-1 min-h-[10rem]" }, entries.length === 0 && callUpdates.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-400 italic py-4" }, "No notes yet. Type an update above and press Enter."), entries.map((e, i) => {
    const meta = parseNoteEntryMeta(e.date);
    return /* @__PURE__ */ React.createElement("div", { key: i, className: "note-timeline-entry" }, meta.when && /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 mb-0.5" }, meta.when), meta.author && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-500 dark:text-gray-400 mb-0.5" }, meta.author), !meta.when && !meta.author && i === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-gray-400 mb-0.5" }, "(undated)"), /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap", style: { wordBreak: "break-word" } }, e.text));
  }), callUpdates.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "pt-1.5 mt-1.5 border-t border-gray-100 dark:border-gray-700 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-widest font-bold text-gray-400 mb-1" }, "Forecast call changes"), callUpdates.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.key, className: "note-timeline-entry" }, c.ts && /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 mb-0.5" }, formatNoteDate(c.ts)), c.who && /* @__PURE__ */ React.createElement("div", { className: "text-[9px] text-gray-500 dark:text-gray-400 mb-0.5" }, c.who), c.changes.map((ch, j) => /* @__PURE__ */ React.createElement("div", { key: j, className: "text-[11px] text-gray-700 dark:text-gray-200 leading-relaxed" }, ch)))))), /* @__PURE__ */ React.createElement(NoteHistoryPanel, { history: existing ? existing.history : null }), /* @__PURE__ */ React.createElement(RelatedRenewalsPanel, { noteKey: nk, notes, accountName: safeString(row[acctKey]), onCopyFrom: copyFromRelated, onCopyAndArchive: copyAndArchiveFromRelated, onConsolidateAll: consolidateAllRelated, onDeleteRelated: onDeleteNote }), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700" }, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] text-gray-400 truncate" }, existing && existing.updatedAt ? `Last saved: ${formatNoteDate(existing.updatedAt)}${existing.editedByDisplay ? ` by ${existing.editedByDisplay}` : ""}` : "Not yet saved"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-emerald", onClick: handleSave }, "Done")))))));
}
function AccountInsightCard({ row, headerMap, settings, touchByAccount, rollups }) {
  const fmtUSD = (v) => `$${Math.round(Number(v) || 0).toLocaleString()}`;
  const atrKey = getAtrKey(headerMap, settings);
  const buKey = getBuKey(headerMap, settings);
  const dateKey = headerMap.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const healthKey = headerMap.HEALTH || "CRM_HEALTH_STATUS";
  const ownerKey = headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const partnerKey = headerMap.PARTNER || "PARTNER";
  const partnerTypeKey = headerMap.PARTNER_TYPE || "PARTNER_TYPE_C";
  const regionKey = headerMap.REGION || "REGION";
  const countryKey = headerMap.BILLING_COUNTRY || headerMap.COUNTRY || "COUNTRY";
  const segmentKey = headerMap.SEGMENT || "PRO_FORMA_MARKET_SEGMENT";
  const touchKey = headerMap.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
  const summaryKey = headerMap.FORECAST_SUMMARY || "FORECAST_SUMMARY";
  const products = Array.isArray(row.__products) ? row.__products : (safeString(row[headerMap.PRODUCT_LINES]) || "").split(/[,;|]/).map((s) => safeString(s)).filter(Boolean);
  const segmentVal = safeString(row[segmentKey]);
  const regionVal = safeString(row[regionKey]);
  const countryVal = safeString(row[countryKey]);
  const acctKeyVal = accountKeyFromRow(row, headerMap);
  const roll = rollups ? rollups.get(acctKeyVal) : null;
  const acctPriorKey = headerMap.NET_ARR_PRIOR || "NET_ARR_USD_PRIOR_QTR_END";
  const accountArr = roll?.maxNetArr != null ? roll.maxNetArr : toNumber(row[acctPriorKey]);
  const largest = roll?.largest || null;
  const atr = toNumber(row[atrKey]);
  const bu = toNumber(row[buKey]);
  const cc = atr > 0 ? bu / atr : 0;
  const grr = atr > 0 ? (atr - bu) / atr : 1;
  const renewalDt = parseDate(row[dateKey]);
  const daysToRenew = renewalDt ? Math.round((renewalDt - /* @__PURE__ */ new Date()) / (1e3 * 60 * 60 * 24)) : null;
  const touchVal = (() => {
    const acct = safeString(row[headerMap.ACCOUNT_NAME]) || "__NO_ACCOUNT__";
    const v = touchByAccount?.get?.(acct);
    const rowVal = toNumber(row[touchKey]);
    const val = isFinite(v) ? v : isFinite(rowVal) ? rowVal : null;
    return val;
  })();
  const healthRaw = safeString(row[healthKey]).toLowerCase();
  const isRisk = /red|amber|yellow|orange/.test(healthRaw);
  const isSoon = daysToRenew != null && daysToRenew <= 60;
  const isStaleTouch = isFinite(touchVal) && touchVal >= 60;
  const healthLabel = safeString(row[healthKey]) || "\u2014";
  const healthTone = classifyHealth(healthRaw);
  const healthClass = { green: "pill-health-green", amber: "pill-health-amber", red: "pill-health-red" }[healthTone] || "pill-health-other";
  const grrColor = grr >= 1 ? "#059669" : grr >= 0.85 ? "#d97706" : "#dc2626";
  const grrBg = grr >= 1 ? "rgba(16,185,129,0.08)" : grr >= 0.85 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";
  const detailLeft = [
    { label: "Owner", value: safeString(row[ownerKey]) || "\u2014" },
    { label: "Partner", value: safeString(row[partnerKey]) || "\u2014" },
    { label: "Partner type", value: safeString(row[partnerTypeKey]) || "\u2014" }
  ].filter((f) => f.value && f.value !== "\u2014");
  const detailRight = [
    { label: "Renewal date", value: safeString(row[dateKey]) || "\u2014" },
    daysToRenew != null ? { label: "Days to renew", value: `${daysToRenew}d` } : null,
    isFinite(touchVal) ? { label: "Days since touch", value: `${touchVal}d` } : null,
    largest ? { label: "Largest renewal", value: `${largest.date || "\u2014"} \xB7 ${fmtCompact(largest.atr || 0)}` } : null
  ].filter(Boolean);
  const summaryText = safeString(row[summaryKey]);
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-4 gap-3 mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "ATR"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#4f46e5" } }, fmtCompact(atr))), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "BU Forecast"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#d97706" } }, fmtCompact(bu)), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, "C/C ", formatPercent(cc))), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "GRR"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: grrColor } }, formatPercent(grr))), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Acct ARR"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#0891b2" } }, isFinite(accountArr) ? fmtCompact(accountArr) : "\u2014"))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-1.5 mb-2.5" }, isRisk && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-risk" }, "\u26A0 At risk"), isSoon && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-soon" }, "\u23F1 ", daysToRenew, "d to renewal"), isStaleTouch && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-touch" }, "\u{1F4ED} Touch stale \xB7 ", touchVal, "d"), !isRisk && !isSoon && !isStaleTouch && /* @__PURE__ */ React.createElement("span", { className: "acct-badge acct-badge-ok" }, "\u2713 No alerts"), /* @__PURE__ */ React.createElement("span", { className: "w-px h-3 bg-gray-200 dark:bg-gray-600 mx-0.5" }), /* @__PURE__ */ React.createElement("span", { className: `pill-chip ${healthClass}` }, healthLabel), regionVal && /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-chip-muted" }, regionVal), countryVal && /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-chip-muted" }, countryVal), segmentVal && /* @__PURE__ */ React.createElement("span", { className: "pill-chip pill-chip-muted" }, segmentVal)), products.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1 mb-2.5" }, products.map((p, i) => /* @__PURE__ */ React.createElement("span", { key: `${p}-${i}`, className: "pill-chip pill-chip-soft" }, p))), /* @__PURE__ */ React.createElement("div", { className: "acct-detail-2col mb-2.5" }, /* @__PURE__ */ React.createElement("div", null, detailLeft.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.label, className: "acct-detail-row" }, /* @__PURE__ */ React.createElement("span", { className: "acct-detail-lbl" }, f.label), /* @__PURE__ */ React.createElement("span", { className: "acct-detail-val", title: f.value }, f.value)))), /* @__PURE__ */ React.createElement("div", null, detailRight.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.label, className: "acct-detail-row" }, /* @__PURE__ */ React.createElement("span", { className: "acct-detail-lbl" }, f.label), /* @__PURE__ */ React.createElement("span", { className: "acct-detail-val", title: f.value }, f.value))))), summaryText && /* @__PURE__ */ React.createElement("div", { className: "acct-summary-box" }, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-widest font-bold text-indigo-500 dark:text-indigo-400 mb-1" }, "Forecast summary"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-700 dark:text-gray-300 leading-relaxed" }, summaryText)));
}
function AccountsToolbar({ rowsCount }) {
  const { actions, state } = useApp();
  const { headerMap, settings } = state;
  const atrSortKey = getAtrKey(headerMap, settings);
  const buSortKey = getBuKey(headerMap, settings);
  const atrSortLabel = settings.useRemainingArr ? "ATR (LTG)" : "Starting ARR";
  const buSortLabel = settings.useRemainingArr ? "BU_FC (Capped)" : "BU_FC";
  const sortOptions = [
    { label: "Next Renewal", value: headerMap.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE" },
    { label: atrSortLabel, value: atrSortKey },
    { label: buSortLabel, value: buSortKey },
    { label: "Account", value: headerMap.ACCOUNT_NAME || "CRM_ACCOUNT_NAME" },
    { label: "Region", value: headerMap.REGION || "REGION" },
    { label: "Health", value: headerMap.HEALTH || "CRM_HEALTH_STATUS" },
    { label: "Owner", value: headerMap.OWNER || "CRM_SUCCESS_OWNER_NAME" },
    { label: "CS Call", value: FC_SORT_CS },
    { label: "Renewals Call", value: FC_SORT_RN },
    { label: "ELT Call", value: FC_SORT_ELT }
  ].filter((opt, idx, arr) => opt.value && arr.findIndex((o) => o.value === opt.value) === idx);
  const sortValue = (() => {
    const base = settings.sortBy || (headerMap.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE");
    const atrBase = headerMap.ATR_STARTING || "ATR_ARR_USD_STARTING";
    const buBase = headerMap.BU_FC || "BU_FC";
    if (settings.useRemainingArr) {
      if (base === atrBase) return atrSortKey;
      if (base === buBase) return buSortKey;
      return base;
    }
    if (base === EFFECTIVE_ATR_KEY) return atrBase;
    if (base === EFFECTIVE_BU_KEY) return buBase;
    return base;
  })();
  const handleSortChange = (val) => actions.setSettings((prev) => ({ ...prev, sortBy: val }));
  const toggleSortDir = () => actions.setSettings((prev) => ({ ...prev, sortDir: prev.sortDir === "asc" ? "desc" : "asc" }));
  const [sortOpen, setSortOpen] = React.useState(false);
  return /* @__PURE__ */ React.createElement("div", { className: "glass-strip mb-2 justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px]", style: { color: "var(--ink-muted)" } }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold", style: { color: "var(--ink)" } }, rowsCount.toLocaleString()), " rows"), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 flex-wrap" }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: () => setSortOpen(!sortOpen) }, "Sort: ", sortOptions.find((o) => o.value === sortValue)?.label || "Date", " ", settings.sortDir === "asc" ? "\u2191" : "\u2193"), sortOpen && /* @__PURE__ */ React.createElement("div", { className: "filter-menu", style: { position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 160, zIndex: 50 } }, sortOptions.map((opt) => /* @__PURE__ */ React.createElement("button", { key: opt.value, className: `filter-option${opt.value === sortValue ? " active" : ""}`, style: { display: "block", width: "100%", textAlign: "left" }, onClick: () => {
    handleSortChange(opt.value);
    setSortOpen(false);
  } }, opt.label)), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--border)", margin: "4px 0" } }), /* @__PURE__ */ React.createElement("button", { className: `filter-option${settings.sortDir === "asc" ? " active" : ""}`, style: { display: "block", width: "100%", textAlign: "left" }, onClick: () => {
    toggleSortDir();
    setSortOpen(false);
  } }, "\u2191 Ascending"), /* @__PURE__ */ React.createElement("button", { className: `filter-option${settings.sortDir === "desc" ? " active" : ""}`, style: { display: "block", width: "100%", textAlign: "left" }, onClick: () => {
    toggleSortDir();
    setSortOpen(false);
  } }, "\u2193 Descending")), sortOpen && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 49 }, onClick: () => setSortOpen(false) })), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-slate", onClick: () => actions.toggleColumns() }, "Columns"), /* @__PURE__ */ React.createElement(ExportButton, null)));
}
function InlineFcCell({ value, onCommit, colorClass, title, placeholder }) {
  const fmt = (v) => v == null || !isFinite(toNumber(v)) ? "" : `$${Math.round(toNumber(v)).toLocaleString()}`;
  const [draft, setDraft] = React.useState(() => fmt(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(fmt(value));
  }, [value, focused]);
  const commit = () => {
    const raw = String(draft).replace(/[^\d.\-]/g, "");
    const next = raw === "" ? null : toNumber(raw);
    const nextNorm = next == null || !isFinite(next) ? null : Math.round(next);
    const curNorm = value == null || !isFinite(toNumber(value)) ? null : Math.round(toNumber(value));
    if (nextNorm !== curNorm) onCommit(nextNorm);
  };
  return /* @__PURE__ */ React.createElement("input", {
    type: "text",
    inputMode: "numeric",
    value: draft,
    title,
    placeholder: placeholder || "\u2014",
    className: "fc-inline-input " + (colorClass || ""),
    onFocus: (e) => {
      setFocused(true);
      setDraft(value == null || !isFinite(toNumber(value)) ? "" : String(Math.round(toNumber(value))));
      e.target.select();
    },
    onChange: (e) => setDraft(e.target.value),
    onBlur: () => {
      setFocused(false);
      commit();
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === "Escape") {
        setDraft(fmt(value));
        e.target.blur();
      }
    },
    onClick: (e) => e.stopPropagation()
  });
}
function DataTable({ rows }) {
  const { state, actions } = useApp();
  const { headerMap: hm, settings, visibleCols } = state;
  const notes = state.notes || {};
  const { byAccount: fcByAccount, reload: reloadFc } = useAccountForecasts();
  const [localFc, setLocalFc] = React.useState({});
  const reloadTimer = React.useRef(null);
  const scheduleReload = React.useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      Promise.resolve(reloadFc()).then(() => setLocalFc({}));
    }, 400);
  }, [reloadFc]);
  React.useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const upsideKey = hm.UPSIDE || "UPSIDE";
  const downsideKey = hm.DOWNSIDE || "DOWNSIDE";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const ownerKey = hm.OWNER || "CRM_SUCCESS_OWNER_NAME";
  const acctKey = hm.ACCOUNT_NAME || "CRM_ACCOUNT_NAME";
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const { accountRollups } = useAccountMeta();
  const touchByAccount = useMemo(() => {
    const touchKey = hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH";
    const m = /* @__PURE__ */ new Map();
    (state.data || []).forEach((r) => {
      const a = safeString(r[acctKey]);
      const v = toNumber(r[touchKey]);
      if (a && isFinite(v)) {
        const c = m.get(a);
        if (c === void 0 || v < c) m.set(a, v);
      }
    });
    return m;
  }, [state.data, hm, acctKey]);
  const fmtK = fmtCompact;
  const fmtPct = fmtPctRatio;
  const fmtCurrInput = (v) => {
    const n = toNumber(v);
    return isFinite(n) ? `$${Math.round(n).toLocaleString()}` : "";
  };
  const normDj = normalizeDj;
  function hBadge(val) {
    if (!val) return null;
    const sev = classifyHealth(val);
    const cls = sev === "green" ? "pill-health-green" : sev === "amber" ? "pill-health-amber" : sev === "red" ? "pill-health-red" : "pill-health-other";
    return /* @__PURE__ */ React.createElement("span", { className: `pill-chip ${cls}` }, val);
  }
  const currentSortKey = (() => {
    const base = settings.sortBy || dateKey;
    const atrBase = hm.ATR_STARTING || "ATR_ARR_USD_STARTING";
    const buBase = hm.BU_FC || "BU_FC";
    if (settings.useRemainingArr) {
      if (base === atrBase) return atrKey;
      if (base === buBase) return buKey;
      return base;
    }
    if (base === EFFECTIVE_ATR_KEY) return atrBase;
    if (base === EFFECTIVE_BU_KEY) return buBase;
    return base;
  })();
  const toggleSort = (key) => actions.setSettings((prev) => {
    const same = prev.sortBy === key;
    return { ...prev, sortBy: key, sortDir: same ? prev.sortDir === "asc" ? "desc" : "asc" : "asc" };
  });
  const sortIcon = (key) => currentSortKey === key ? settings.sortDir === "asc" ? " \u2191" : " \u2193" : "";
  const fcForRow = (r) => {
    if (typeof RenewalsCallKeys !== "undefined") {
      const ck = RenewalsCallKeys.buildCallKey(r, hm, settings);
      if (ck && localFc[ck]) return localFc[ck];
      if (ck && fcByAccount.has(ck)) return fcByAccount.get(ck);
    }
    const id = accountIdFromRow(r, hm);
    return id ? fcByAccount.get(id) : null;
  };
  const saveAcctFcInline = (row, field, newVal) => {
    const accountId = accountIdFromRow(row, hm);
    if (!accountId) return;
    const accountName = safeString(row[acctKey]) || "";
    const ck = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKey(row, hm, settings) : null;
    const yq = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.yearQuarterFromRow(row, hm) : "";
    const atr = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.effectiveAtrFromRow(row, hm, settings) : 0;
    const cur = fcForRow(row) || {};
    const curCs = cur.cs_forecast != null && isFinite(toNumber(cur.cs_forecast)) ? toNumber(cur.cs_forecast) : null;
    const curRn = cur.renewals_forecast != null && isFinite(toNumber(cur.renewals_forecast)) ? toNumber(cur.renewals_forecast) : null;
    const nextCs = field === "cs" ? newVal : curCs;
    const nextRn = field === "rn" ? newVal : curRn;
    if (ck) setLocalFc((prev) => ({ ...prev, [ck]: { call_key: ck, cs_forecast: nextCs, renewals_forecast: nextRn } }));
    const body = {
      call_key: ck,
      account_name: accountName,
      year_quarter: yq,
      rounded_atr: atr,
      source: "accounts_inline"
    };
    if (field === "cs") body.cs_forecast = newVal;
    else body.renewals_forecast = newVal;
    fetch("/api/renewals/account-forecasts/" + encodeURIComponent(accountId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => {
      if (r.ok) scheduleReload();
    }).catch(() => {
    });
  };
  const noteDjVal = (r) => {
    const nk = r.__noteKey;
    const note = nk ? notes[nk] : null;
    return note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
  };
  const fcSortVal = (r, key) => {
    const fc = fcForRow(r);
    if (key === FC_SORT_CS) return fc && fc.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
    if (key === FC_SORT_RN) return fc && fc.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
    const cs = fc && fc.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
    const rn = fc && fc.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
    if (cs != null || rn != null) return (cs || 0) + (rn || 0);
    return noteDjVal(r);
  };
  const clearAcctFc = async (row, mode, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const accountId = accountIdFromRow(row, hm);
    const accountName = safeString(row[acctKey]) || "";
    if (!accountId) return;
    const ck = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.buildCallKey(row, hm, settings) : null;
    const fc = fcForRow(row);
    const label = accountName || accountId;
    const msg = mode === "all" ? `Clear all saved calls for ${label}?` : mode === "cs" ? `Clear CS call for ${label}?` : `Clear Renewals call for ${label}?`;
    if (!confirm(msg)) return;
    let cs = fc?.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
    let rn = fc?.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
    if (mode === "cs") cs = null;
    else if (mode === "rn") rn = null;
    else if (mode === "all") {
      cs = null;
      rn = null;
    }
    try {
      const yq = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.yearQuarterFromRow(row, hm) : "";
      const atr = typeof RenewalsCallKeys !== "undefined" ? RenewalsCallKeys.effectiveAtrFromRow(row, hm, settings) : 0;
      const url = ck
        ? "/api/renewals/account-forecasts/" + encodeURIComponent(accountId) + "?call_key=" + encodeURIComponent(ck)
        : "/api/renewals/account-forecasts/" + encodeURIComponent(accountId);
      const res = mode === "all" ? await fetch(url, { method: "DELETE" }) : await fetch(
        "/api/renewals/account-forecasts/" + encodeURIComponent(accountId),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_key: ck,
            account_name: accountName,
            year_quarter: yq,
            rounded_atr: atr,
            cs_forecast: cs,
            renewals_forecast: rn,
            source: "accounts_clear"
          })
        }
      );
      if (res.ok) Promise.resolve(reloadFc()).then(() => setLocalFc({}));
    } catch (_) {
    }
  };
  const fcClearBtn = (row, mode, title) => /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded text-[9px] leading-none text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30",
      title,
      "aria-label": title,
      onClick: (e) => clearAcctFc(row, mode, e)
    },
    "\u00D7"
  );
  const sorted = useMemo(() => {
    const dir = settings.sortDir === "desc" ? -1 : 1;
    const fcKeys = /* @__PURE__ */ new Set([FC_SORT_CS, FC_SORT_RN, FC_SORT_ELT]);
    return [...rows].sort((a, b) => {
      if (fcKeys.has(currentSortKey)) {
        const av = fcSortVal(a, currentSortKey);
        const bv = fcSortVal(b, currentSortKey);
        const aNull = av == null || !isFinite(av);
        const bNull = bv == null || !isFinite(bv);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return (av - bv) * dir;
      }
      const av = a[currentSortKey], bv = b[currentSortKey];
      const da = Date.parse(av), db = Date.parse(bv);
      if (!isNaN(da) && !isNaN(db)) return (da - db) * dir;
      const na = toNumber(av), nb = toNumber(bv);
      if (na || nb) return (na - nb) * dir;
      return String(av || "").localeCompare(String(bv || "")) * dir;
    });
  }, [rows, currentSortKey, settings.sortDir, fcByAccount]);
  const ROW_HEIGHT = 26;
  const OVERSCAN = 8;
  const tableRef = React.useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const measure = () => setViewportHeight(el.clientHeight || 600);
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (ro) ro.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = tableRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [sorted.length, currentSortKey, settings.sortDir]);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(sorted.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const paged = sorted.slice(startIdx, endIdx);
  const padTop = startIdx * ROW_HEIGHT;
  const padBot = Math.max(0, (sorted.length - endIdx) * ROW_HEIGHT);
  const limit = sorted.length;
  const [selRow, setSelRow] = useState(null);
  const cols = [
    { id: "account", label: "Account", key: acctKey, _acct: true, sw: "30%" },
    visibleCols.quarter && { id: "quarter", label: "Qtr", key: qKey, sw: "50px" },
    visibleCols.region && { id: "region", label: "Region", key: hm.REGION || "REGION", sw: "50px" },
    visibleCols.country && { id: "country", label: "Country", key: hm.BILLING_COUNTRY || hm.COUNTRY || "COUNTRY", sw: "72px" },
    visibleCols.segment && { id: "segment", label: "Seg", key: hm.SEGMENT || "PRO_FORMA_MARKET_SEGMENT", sw: "88px", trunc: true },
    visibleCols.health && { id: "health", label: "Health", key: healthKey, sw: "80px", render: (v) => hBadge(v) },
    visibleCols.atr && { id: "atr", label: "ATR", key: atrKey, sw: "68px", right: true, render: (v) => fmtK(v) },
    visibleCols.bufc && { id: "bufc", label: "BU FC", key: buKey, sw: "68px", right: true, render: (v) => fmtK(v) },
    visibleCols.atr && visibleCols.bufc && { id: "cc", label: "CC%", key: "__CC__", sw: "42px", right: true, render: (_, r) => {
      const a = toNumber(r[atrKey]), b = toNumber(r[buKey]);
      return a > 0 ? fmtPct(b / a) : "\u2014";
    } },
    visibleCols.adjCc && { id: "adjCc", label: "Adj CC%", key: "__ADJ_CC__", sw: "52px", right: true, render: (_, r) => {
      const a = toNumber(r[atrKey]);
      if (!(a > 0)) return "\u2014";
      const fc = fcForRow(r);
      const cs = fc && fc.cs_forecast != null && isFinite(toNumber(fc.cs_forecast)) ? toNumber(fc.cs_forecast) : null;
      const rn = fc && fc.renewals_forecast != null && isFinite(toNumber(fc.renewals_forecast)) ? toNumber(fc.renewals_forecast) : null;
      const eff = cs != null || rn != null ? (cs || 0) + (rn || 0) : toNumber(r[buKey]);
      return /* @__PURE__ */ React.createElement("span", { title: "Effective forecast (ELT call if set, else BU FC) \u00F7 ATR" }, fmtPct(eff / a));
    } },
    visibleCols.bestCase && { id: "bestCase", label: "Best Case", key: "__BEST_CASE__", sw: "72px", right: true, render: (_, r) => {
      if (safeString(r[upsideKey]) === "") return "\u2014";
      return /* @__PURE__ */ React.createElement("span", { title: "BU FC + Upside" }, fmtK(toNumber(r[buKey]) + toNumber(r[upsideKey])));
    } },
    visibleCols.worstCase && { id: "worstCase", label: "Worst Case", key: "__WORST_CASE__", sw: "76px", right: true, render: (_, r) => {
      if (safeString(r[downsideKey]) === "") return "\u2014";
      return /* @__PURE__ */ React.createElement("span", { title: "BU FC + Downside" }, fmtK(toNumber(r[buKey]) + toNumber(r[downsideKey])));
    } },
    visibleCols.csCall && { id: "csCall", label: "CS Call", key: FC_SORT_CS, sw: "92px", right: true, render: (_, r) => {
      const fc = fcForRow(r);
      const val = fc && fc.cs_forecast != null && isFinite(toNumber(fc.cs_forecast)) ? toNumber(fc.cs_forecast) : null;
      return /* @__PURE__ */ React.createElement("span", { className: "fc-inline-wrap" }, /* @__PURE__ */ React.createElement(InlineFcCell, { value: val, colorClass: "fc-inline-cs", title: "CS Forecast \u2014 click to edit, Enter to save", onCommit: (nv) => saveAcctFcInline(r, "cs", nv) }), val != null && fcClearBtn(r, "cs", "Clear CS call"));
    } },
    visibleCols.renewalsCall && { id: "renewalsCall", label: "Renewals Call", key: FC_SORT_RN, sw: "104px", right: true, render: (_, r) => {
      const fc = fcForRow(r);
      const val = fc && fc.renewals_forecast != null && isFinite(toNumber(fc.renewals_forecast)) ? toNumber(fc.renewals_forecast) : null;
      return /* @__PURE__ */ React.createElement("span", { className: "fc-inline-wrap" }, /* @__PURE__ */ React.createElement(InlineFcCell, { value: val, colorClass: "fc-inline-rn", title: "Renewals Forecast \u2014 click to edit, Enter to save", onCommit: (nv) => saveAcctFcInline(r, "rn", nv) }), val != null && fcClearBtn(r, "rn", "Clear Renewals call"));
    } },
    visibleCols.eltCall && { id: "eltCall", label: "ELT Call", key: FC_SORT_ELT, sw: "76px", right: true, render: (_, r) => {
      const fc = fcForRow(r);
      const cs = fc && fc.cs_forecast != null ? toNumber(fc.cs_forecast) : null;
      const rn = fc && fc.renewals_forecast != null ? toNumber(fc.renewals_forecast) : null;
      if (cs != null || rn != null) {
        const sum = (cs || 0) + (rn || 0);
        return /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center justify-end gap-0.5 font-semibold" }, fmtK(sum), fcClearBtn(r, "all", "Clear all calls"));
      }
      // Fall back to the ELT Forecast override stored on the note (set in the
      // account card), matching how the Region tab surfaces ELT.
      const nk = r.__noteKey;
      const note = nk ? notes[nk] : null;
      const dj = note && !note.archived && note.djForecast != null && isFinite(toNumber(note.djForecast)) ? toNumber(note.djForecast) : null;
      if (dj == null) return null;
      return /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center justify-end gap-0.5 font-semibold", title: "ELT Forecast override (from account card)" }, fmtK(dj));
    } },
    visibleCols.nextRenewal && { id: "renewal", label: "Renewal", key: dateKey, sw: "72px" },
    visibleCols.priorArr && { id: "priorArr", label: "Acct ARR", key: "__PRIOR_ARR__", sw: "68px", right: true, render: (_, r) => {
      const acct = accountKeyFromRow(r, hm);
      const v = accountRollups.get(acct)?.maxNetArr;
      return v != null ? fmtK(v) : "\u2014";
    } },
    visibleCols.largestDate && { id: "lgDate", label: "Lg. Date", key: "__LARGEST_DATE__", sw: "72px", render: (_, r) => {
      const acct = accountKeyFromRow(r, hm);
      return accountRollups.get(acct)?.largest?.date || "\u2014";
    } },
    visibleCols.largestAtr && { id: "lgAtr", label: "Lg. ATR", key: "__LARGEST_ATR__", sw: "68px", right: true, render: (_, r) => {
      const acct = accountKeyFromRow(r, hm);
      const v = accountRollups.get(acct)?.largest?.atr;
      return v != null ? fmtK(v) : "\u2014";
    } },
    visibleCols.owner && { id: "owner", label: "Owner", key: ownerKey, sw: "90px", trunc: true },
    visibleCols.dictatedBy && { id: "dictatedBy", label: "Renewal Dictated By", key: hm.DICTATED_BY || "DICTATED_BY", sw: "120px", trunc: true },
    visibleCols.partner && { id: "partner", label: "Partner", key: hm.PARTNER || "PARTNER", sw: "80px", trunc: true },
    visibleCols.partnerType && { id: "partnerType", label: "Type", key: hm.PARTNER_TYPE || "PARTNER_TYPE_C", sw: "60px", trunc: true },
    visibleCols.summary && { id: "summary", label: "Forecast", key: hm.FORECAST_SUMMARY || "FORECAST_SUMMARY", sw: "110px", trunc: true },
    visibleCols.daysSinceTouch && { id: "touch", label: "Touch", key: hm.DAYS_SINCE_TOUCH || "DAYS_SINCE_LAST_CS_TOUCH", sw: "42px", right: true }
  ].filter(Boolean);
  return /* @__PURE__ */ React.createElement("div", { className: "card p-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { ref: tableRef, className: "table-container compact-table", style: { maxHeight: "calc(100vh - 270px)", overflowY: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full w-full table-fixed text-[10px] acct-data-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, cols.map((c) => {
    const active = c.key === currentSortKey;
    return /* @__PURE__ */ React.createElement("th", { key: c.id, className: `sticky top-0 glass-thead px-1 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap border-b z-10 ${c.right ? "text-right" : ""}`, style: { ...c.sw ? { width: c.sw } : {}, borderColor: "var(--border)" } }, /* @__PURE__ */ React.createElement("button", { className: `transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 ${active ? "text-indigo-600 dark:text-indigo-400" : ""}`, onClick: () => toggleSort(c.key) }, c.label, sortIcon(c.key)));
  }))), /* @__PURE__ */ React.createElement("tbody", null, padTop > 0 && /* @__PURE__ */ React.createElement("tr", { "aria-hidden": "true", style: { height: padTop } }, /* @__PURE__ */ React.createElement("td", { colSpan: cols.length, style: { padding: 0, border: 0 } })), paged.map((r, i) => {
    const noteKey = r.__noteKey;
    const hasNote = !!(noteKey && notes[noteKey]?.note);
    return /* @__PURE__ */ React.createElement("tr", { key: r.__uid || startIdx + i, className: "glass-row-accent", style: { height: ROW_HEIGHT }, onClick: () => setSelRow(r) }, cols.map((c) => {
      let display;
      if (c._acct) {
        const name = safeString(r[c.key]) || "(Unnamed)";
        display = /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1 min-w-0" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, name), hasNote && /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0", title: "Has notes" }));
      } else if (c.render) {
        const rendered = c.render(c.key === "__CC__" || c.key === "__ADJ_CC__" || c.key === "__BEST_CASE__" || c.key === "__WORST_CASE__" || c.key === "__PRIOR_ARR__" || c.key === "__LARGEST_DATE__" || c.key === "__LARGEST_ATR__" || c.key === FC_SORT_CS || c.key === FC_SORT_RN || c.key === FC_SORT_ELT ? null : r[c.key], r);
        display = rendered == null || rendered === "" ? /* @__PURE__ */ React.createElement("span", { className: "text-gray-300 dark:text-gray-600" }, "\u2014") : rendered;
      } else {
        const v = safeString(r[c.key]);
        display = v ? /* @__PURE__ */ React.createElement("span", { className: c.trunc ? "block truncate" : "" }, v) : /* @__PURE__ */ React.createElement("span", { className: "text-gray-300 dark:text-gray-600" }, "\u2014");
      }
      return /* @__PURE__ */ React.createElement("td", { key: c.id, className: `px-1 py-1 border-b border-gray-100 dark:border-gray-800/60 whitespace-nowrap ${c._acct ? "overflow-hidden" : ""} ${c.right ? "text-right tabular-nums" : ""} ${c.trunc ? "overflow-hidden" : ""}` }, display);
    }));
  }), padBot > 0 && /* @__PURE__ */ React.createElement("tr", { "aria-hidden": "true", style: { height: padBot } }, /* @__PURE__ */ React.createElement("td", { colSpan: cols.length, style: { padding: 0, border: 0 } })), sorted.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: cols.length, className: "px-4 py-10 text-center text-gray-400 text-xs" }, "No rows match your filters"))))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-center px-3 py-1.5 border-t", style: { borderColor: "var(--border)", background: "var(--card-bg)" } }, /* @__PURE__ */ React.createElement("span", { className: "pill-chip", style: { fontSize: "0.6rem" } }, sorted.length > 0 ? `Rows ${(startIdx + 1).toLocaleString()}\u2013${endIdx.toLocaleString()} of ${sorted.length.toLocaleString()}` : "0 rows")), selRow && /* @__PURE__ */ React.createElement(
    AccountNoteModal,
    {
      row: selRow,
      notes,
      headerMap: hm,
      settings,
      touchByAccount,
      rollups: accountRollups,
      formatCurrencyInputFn: fmtCurrInput,
      onSave: (nk, payload) => {
        const prior = notes[nk] || {};
        actions.setNote(nk, { ...prior, ...payload });
        setSelRow(null);
      },
      onClose: () => setSelRow(null),
      onArchiveNote: (key) => {
        const prior = notes[key] || {};
        actions.setNote(key, { ...prior, archived: true, updatedAt: Date.now() });
      },
      onDeleteNote: (key) => {
        actions.setNote(key, null);
      }
    }
  ));
}
function TrendingTab() {
  const { state, actions } = useApp();
  const { filters, headerMap: hm } = state;
  const regionKey = hm.REGION || "REGION";
  const qKey = hm.FISCAL_QUARTER || hm.YEAR_QUARTER || "YEAR_QUARTER";
  const rows = useFilteredRows();
  const regionOptions = useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    rows.forEach((r) => {
      const v = safeString(r[regionKey]);
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [rows, regionKey]);
  const quarterOptions = useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    rows.forEach((r) => {
      const v = safeString(r[qKey]);
      if (v && parseFiscalLabel(v).fy > 0) set.add(v);
    });
    return Array.from(set).sort((a, b) => {
      const pa = parseFiscalLabel(a), pb = parseFiscalLabel(b);
      return pa.fy !== pb.fy ? pa.fy - pb.fy : pa.fq - pb.fq;
    });
  }, [rows, qKey]);
  const [region, setRegion] = useState("");
  const [quarter, setQuarter] = useState("");
  const [band, setBand] = useState("");
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    const qs = new URLSearchParams({ slot: "active" });
    if (region) qs.set("region", region);
    if (quarter) qs.set("quarter", quarter);
    if (band) qs.set("band", band);
    fetch("/api/renewals/trending?" + qs.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) throw new Error(data.detail || "Trending load failed");
        setSeries(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [region, quarter, band]);
  const points = series?.points || [];
  const latest = points.length ? points[points.length - 1] : null;
  const prior = points.length > 1 ? points[points.length - 2] : null;
  const fmtC = fmtCompactDash;
  const chartH = 220;
  const chartW = 640;
  const pad = { t: 16, r: 16, b: 36, l: 56 };
  const innerW = chartW - pad.l - pad.r;
  const innerH = chartH - pad.t - pad.b;
  const renderLine = (key, color) => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p[key] || 0);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = maxV - minV || 1;
    const coords = points.map((p, i) => {
      const x = pad.l + i / (points.length - 1) * innerW;
      const y = pad.t + innerH - ((p[key] || 0) - minV) / span * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return /* @__PURE__ */ React.createElement("polyline", { key, fill: "none", stroke: color, strokeWidth: 2.5, points: coords });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3 flex flex-wrap gap-2 items-end" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1" }, "Region"), /* @__PURE__ */ React.createElement("select", { className: "filter-input text-xs", value: region, onChange: (e) => setRegion(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All regions"), regionOptions.map((r) => /* @__PURE__ */ React.createElement("option", { key: r, value: r }, r)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1" }, "Quarter"), /* @__PURE__ */ React.createElement("select", { className: "filter-input text-xs", value: quarter, onChange: (e) => setQuarter(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All quarters"), quarterOptions.map((q) => /* @__PURE__ */ React.createElement("option", { key: q, value: q }, q)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1" }, "Band contains"), /* @__PURE__ */ React.createElement("input", { className: "filter-input text-xs", placeholder: "e.g. 100K", value: band, onChange: (e) => setBand(e.target.value) })), series?.latest_effective_date && /* @__PURE__ */ React.createElement("div", { className: "ml-auto text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold" }, "Latest snapshot: ", series.latest_effective_date.slice(0, 10))), loading && /* @__PURE__ */ React.createElement("div", { className: "text-sm text-gray-500" }, "Loading snapshot history…"), err && /* @__PURE__ */ React.createElement("div", { className: "text-sm text-red-500" }, err), !loading && !err && points.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-sm text-gray-500" }, "Upload at least one active CSV snapshot to see trends."), latest && /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-2" }, [
    { label: "Total ATR", value: fmtC(latest.total_atr), delta: latest.atr_delta, accent: "#4f46e5" },
    { label: "Remaining C/C", value: fmtC(latest.remaining_cc), delta: latest.remaining_cc_delta, accent: "#d97706" },
    { label: "Expected C/C", value: fmtC(latest.expected_cc), delta: latest.expected_cc_delta, accent: "#059669" },
    { label: "Accounts", value: latest.account_count.toLocaleString(), delta: prior ? latest.account_count - prior.account_count : null, accent: "#6366f1" }
  ].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, c.label), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: c.accent } }, c.value), c.delta != null && /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub", style: { color: c.delta >= 0 ? "#059669" : "#dc2626" } }, (c.delta >= 0 ? "+" : "") + (Math.abs(c.delta) >= 1e6 ? fmtC(c.delta) : c.delta.toLocaleString()), " vs prior snapshot")))), points.length >= 2 && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3 overflow-x-auto" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold mb-2" }, "Snapshot trend (by effective date)"), /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${chartW} ${chartH}`, className: "w-full max-w-3xl", style: { minWidth: 320 } }, renderLine("total_atr", "#6366f1"), renderLine("remaining_cc", "#d97706"), renderLine("expected_cc", "#10b981"), points.map((p, i) => /* @__PURE__ */ React.createElement("text", { key: i, x: pad.l + i / Math.max(points.length - 1, 1) * innerW, y: chartH - 8, textAnchor: "middle", fontSize: 9, fill: "currentColor", className: "text-gray-500" }, (p.effective_date || "").slice(5, 10)))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-4 mt-2 text-[10px] text-gray-500" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { style: { color: "#6366f1" } }, "●"), " ATR"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { style: { color: "#d97706" } }, "●"), " Remaining C/C"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { style: { color: "#10b981" } }, "●"), " Expected C/C"))), points.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 border-b text-xs font-semibold" }, "Snapshot history (", points.length, ")"), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[10px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Effective", "Filename", "ATR", "Remaining C/C", "Expected C/C", "Accounts", "ATR Δ"].map((h) => /* @__PURE__ */ React.createElement("th", { key: h, className: "px-2 py-1.5 text-left font-semibold uppercase tracking-wider" }, h)))), /* @__PURE__ */ React.createElement("tbody", null, [...points].reverse().map((p) => /* @__PURE__ */ React.createElement("tr", { key: p.upload_id, className: "glass-row-accent" }, /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 tabular-nums" }, (p.effective_date || "").slice(0, 10)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 truncate max-w-[180px]", title: p.filename }, p.filename), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums" }, fmtC(p.total_atr)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums" }, fmtC(p.remaining_cc)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums" }, fmtC(p.expected_cc)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums" }, p.account_count.toLocaleString()), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums" }, p.atr_delta != null ? fmtC(p.atr_delta) : "—"))))))));
}
function Accounts() {
  const { state } = useApp();
  const { headerMap: hm, settings, notes } = state;
  const _allRows = useFilteredRows();
  const rows = React.useMemo(() => _allRows.filter((r) => isValidRenewal(r, hm, settings)), [_allRows, hm, settings]);
  const { byAccount: fcByAccount } = useAccountForecasts();
  useScopedCallKeys(rows, hm, settings);
  useScopedCallRollup(rows, hm, settings, notes, fcByAccount);
  const atrKey = getAtrKey(hm, settings);
  const buKey = getBuKey(hm, settings);
  const healthKey = hm.HEALTH || "CRM_HEALTH_STATUS";
  const dateKey = hm.NEXT_RENEWAL_DATE || "NEXT_RENEWAL_DATE";
  const fmtC = fmtCompactDash;
  const kpis = useMemo(() => {
    let totalAtr = 0, totalBu = 0, atRisk = 0, soon = 0;
    const today = /* @__PURE__ */ new Date();
    rows.forEach((r) => {
      totalAtr += toNumber(r[atrKey]);
      totalBu += toNumber(r[buKey]);
      const h = safeString(r[healthKey]).toLowerCase();
      if (/red|orange|amber|yellow/.test(h)) atRisk++;
      const dt = parseDate(r[dateKey]);
      if (dt && Math.ceil((dt - today) / 864e5) <= 30) soon++;
    });
    const grr = totalAtr > 0 ? (totalAtr - totalBu) / totalAtr : 1;
    return { count: rows.length, totalAtr, totalBu, grr, atRisk, soon };
  }, [rows, atrKey, buKey, healthKey, dateKey]);
  const grrColor = kpis.grr >= 1 ? "#059669" : kpis.grr >= 0.85 ? "#d97706" : "#dc2626";
  const grrBg = kpis.grr >= 1 ? "rgba(16,185,129,0.08)" : kpis.grr >= 0.85 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";
  const cc = kpis.totalAtr > 0 ? kpis.totalBu / kpis.totalAtr : 0;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Renewals"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#4f46e5" } }, kpis.count.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Total ATR"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#4f46e5" } }, fmtC(kpis.totalAtr))), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "BU Forecast"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#d97706" } }, fmtC(kpis.totalBu)), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, "CC ", kpis.totalAtr > 0 ? `${(cc * 100).toFixed(1)}%` : "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "Avg GRR"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: grrColor } }, kpis.totalAtr > 0 ? `${(kpis.grr * 100).toFixed(1)}%` : "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, "At Risk"), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: "#dc2626" } }, kpis.atRisk.toLocaleString()), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, kpis.soon, " due \u226430d"))), /* @__PURE__ */ React.createElement(AccountsToolbar, { rowsCount: rows.length }), /* @__PURE__ */ React.createElement(DataTable, { rows }));
}
function ColumnsDrawer() {
  const { state, actions } = useApp();
  const open = state.ui.showColumns;
  const list = [
    ["notes", "Notes"],
    ["quarter", "Quarter"],
    ["account", "Account"],
    ["region", "Region"],
    ["country", "Country"],
    ["segment", "Segment"],
    ["health", "Health"],
    ["atr", "ATR"],
    ["bufc", "BU_FC"],
    ["priorArr", "Account ARR"],
    ["largestDate", "Lg. Renewal Date"],
    ["largestAtr", "Lg. Renewal ATR"],
    ["nextRenewal", "Next Renewal"],
    ["owner", "Owner"],
    ["dictatedBy", "Renewal Dictated By"],
    ["partner", "Partner"],
    ["partnerType", "Partner Type"],
    ["summary", "Forecast Summary"],
    ["csCall", "CS Call"],
    ["renewalsCall", "Renewals Call"],
    ["eltCall", "ELT Call"],
    ["adjCc", "Adj. C/C %"],
    ["bestCase", "Best Case"],
    ["worstCase", "Worst Case"]
  ];
  if (!open) return null;
  return ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement("div", { className: "modal-overlay", onClick: (e) => {
      if (e.target === e.currentTarget) actions.toggleColumns();
    } }, /* @__PURE__ */ React.createElement("div", { className: "modal-card", style: { maxWidth: 420 } }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold text-sm", style: { color: "var(--ink)" } }, "Column Visibility"), /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-xs smallbtn-rose", onClick: () => actions.toggleColumns() }, "Close")), /* @__PURE__ */ React.createElement("div", { className: "p-4 flex flex-wrap gap-2" }, list.map(([key, label]) => /* @__PURE__ */ React.createElement("button", { key, className: `smallbtn ${state.visibleCols[key] ? "smallbtn-indigo" : "smallbtn-slate"}`, onClick: () => actions.setVisibleCol(key, !state.visibleCols[key]) }, label))))),
    document.body
  );
}
function RefreshOverlay() {
  const { refreshState, dismissRefreshState } = useApp();
  useEffect(() => {
    if (!refreshState || refreshState.phase !== "done") return;
    const t = setTimeout(() => dismissRefreshState(), 4e3);
    return () => clearTimeout(t);
  }, [refreshState, dismissRefreshState]);
  if (!refreshState) return null;
  const phase = refreshState.phase;
  const { filename, rowCount = 0, error, origin, mtimeMs, slot, label } = refreshState;
  const isError = phase === "error";
  const isDone = phase === "done";
  const isBusy = phase === "fetching" || phase === "parsing" || phase === "importing";
  const slotLabel = label || (slot === "historical" ? "Historical" : slot === "active" ? "Active" : null);
  const headline = isError ? "Could not load source" : isDone ? "Latest source loaded" : "Loading latest source...";
  const subStatus = isError ? error || "Unknown error" : phase === "fetching" ? `Downloading the latest ${slotLabel || "CSV"} from the server...` : phase === "parsing" ? `Parsing rows... ${rowCount ? rowCount.toLocaleString() : ""}` : phase === "importing" ? "Updating dashboard..." : isDone ? `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"} imported.` : "";
  const friendlyOrigin = origin === "data-source" ? "Downloads or workspace" : origin === "csv-list" ? "Renewals folder" : null;
  const stamp = mtimeMs ? new Date(mtimeMs) : null;
  const stampLabel = stamp && !Number.isNaN(stamp.getTime()) ? (() => {
    const diffSec = Math.floor((Date.now() - stamp.getTime()) / 1e3);
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} minute${Math.floor(diffSec / 60) === 1 ? "" : "s"} ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hour${Math.floor(diffSec / 3600) === 1 ? "" : "s"} ago`;
    return stamp.toLocaleString(void 0, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  })() : null;
  const iconWrapStyle = {
    width: 40,
    height: 40,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    background: isDone ? "rgba(16, 185, 129, 0.12)" : isError ? "rgba(239, 68, 68, 0.12)" : "rgba(99, 102, 241, 0.12)",
    color: isDone ? "#059669" : isError ? "#dc2626" : "#4f46e5"
  };
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Refreshing data",
      onClick: isBusy ? void 0 : dismissRefreshState,
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 2e3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(15,23,42,0.40)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)"
      }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: {
          width: "100%",
          maxWidth: 448,
          background: "var(--popup-bg)",
          border: "1px solid var(--popup-border)",
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)",
          color: "var(--text-primary)",
          overflow: "hidden"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { padding: "1.5rem" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: iconWrapStyle, "aria-hidden": "true" }, isBusy ? /* @__PURE__ */ React.createElement("span", { className: "loading-dots", style: { display: "inline-flex", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null)) : isDone ? /* @__PURE__ */ React.createElement("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }), /* @__PURE__ */ React.createElement("polyline", { points: "22 4 12 14.01 9 11.01" })) : /* @__PURE__ */ React.createElement("svg", { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("line", { x1: "15", y1: "9", x2: "9", y2: "15" }), /* @__PURE__ */ React.createElement("line", { x1: "9", y1: "9", x2: "15", y2: "15" }))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: "1.125rem", fontWeight: 600, margin: 0 } }, headline), slotLabel && /* @__PURE__ */ React.createElement("p", { style: { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#6366f1", marginTop: 2 } }, slotLabel), filename && /* @__PURE__ */ React.createElement("p", { style: { fontSize: "0.875rem", marginTop: 4, wordBreak: "break-word", color: "var(--text-primary)" } }, filename), (friendlyOrigin || stampLabel) && /* @__PURE__ */ React.createElement("p", { style: { fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 } }, friendlyOrigin && /* @__PURE__ */ React.createElement(React.Fragment, null, "From ", /* @__PURE__ */ React.createElement("b", null, friendlyOrigin)), friendlyOrigin && stampLabel && " \xB7 ", stampLabel && /* @__PURE__ */ React.createElement(React.Fragment, null, "saved ", stampLabel)), subStatus && /* @__PURE__ */ React.createElement("p", { style: { fontSize: "0.875rem", marginTop: 12, color: isError ? "#dc2626" : "var(--text-primary)" } }, isDone && rowCount ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("b", { style: { fontVariantNumeric: "tabular-nums" } }, rowCount.toLocaleString()), " row", rowCount === 1 ? "" : "s", " imported.") : subStatus)))),
      isBusy ? /* @__PURE__ */ React.createElement("div", { className: "loading-progress", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("div", { className: "loading-progress-bar" })) : /* @__PURE__ */ React.createElement("div", { style: { padding: "0 1.5rem 1.25rem 1.5rem", display: "flex", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          onClick: dismissRefreshState,
          style: {
            padding: "0.375rem 1rem",
            borderRadius: 8,
            background: "#4f46e5",
            color: "white",
            fontSize: "0.875rem",
            fontWeight: 600,
            border: "none",
            cursor: "pointer"
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.background = "#4338ca";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.background = "#4f46e5";
          }
        },
        isDone ? "OK" : "Close"
      ))
    )
  );
}
function generateWeeklyBriefHtml(brief, opts) {
  const esc = escapeHtml;
  const fmtD = fmtCompact;
  const fmtDash = fmtCompactDash;
  const signed = (n) => (n >= 0 ? "+" : "\u2212") + fmtD(Math.abs(n));
  const pctS = (v) => v == null || !isFinite(v) ? "\u2014" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  const genDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const sec = brief.sections || {};
  const bu = sec.bu_movement || { regions: [], rollup: {}, trend: [] };
  const rollup = bu.rollup || {};
  const bestCase = sec.best_case || {};
  const worstCase = sec.worst_case || {};
  const worsened = sec.worsened || [];
  const newFc = sec.new_forecast || [];
  // True totals (pre-cap) so the exported KPIs/headers match the on-screen tiles.
  const worsenedTotal = sec.worsened_total != null ? sec.worsened_total : worsened.length;
  const worsenedLargeTotal = sec.worsened_large_total != null ? sec.worsened_large_total : worsened.filter((r) => r.is_large).length;
  const newFcTotal = sec.new_forecast_total != null ? sec.new_forecast_total : newFc.length;
  const newFcLargeTotal = sec.new_forecast_large_total != null ? sec.new_forecast_large_total : newFc.filter((r) => r.is_large).length;
  const fmtDT = (iso) => {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const curEff = fmtDT(brief.current && brief.current.effective_date);
  const priEff = brief.prior && brief.prior.effective_date ? fmtDT(brief.prior.effective_date) : "\u2014";
  // Applied filters (echoed by the server) so the exported brief states
  // exactly what is scoping the numbers.
  const f = brief.filters || {};
  const filterBits = [];
  if (f.region && f.region !== "__ALL__") filterBits.push("Region: " + f.region);
  if (f.sub_region && f.sub_region !== "__ALL__") filterBits.push("Sub-region: " + f.sub_region);
  if (f.cs_manager && f.cs_manager !== "__ALL__") filterBits.push("CS mgr: " + f.cs_manager);
  if (f.segment && f.segment !== "__ALL__") filterBits.push("Segment: " + f.segment);
  if (f.owner && f.owner !== "__ALL__") filterBits.push("Owner: " + f.owner);
  if (f.arr_min != null) filterBits.push("ARR \u2265 " + fmtD(f.arr_min));
  if (f.arr_max != null) filterBits.push("ARR \u2264 " + fmtD(f.arr_max));
  const thr = opts && opts.threshold != null ? opts.threshold : brief.threshold;
  if (thr != null) filterBits.push("Large \u2265 " + fmtD(thr));
  const bandTxt = brief.band && brief.band !== "all" ? " \u00b7 Band " + esc(brief.band) : "";
  const scopeLine = `${esc(brief.quarter || "\u2014")}${bandTxt} \u00b7 ${curEff} vs ${priEff}${filterBits.length ? " \u00b7 " + esc(filterBits.join(" \u00b7 ")) : ""}`;
  const regionFilter = f.region && f.region !== "__ALL__" ? f.region : (opts && opts.region && opts.region !== "__ALL__" ? opts.region : null);
  const inRegion = (row) => !regionFilter || row.region === regionFilter;
  // Deltas: for BU FC, a positive swing == more churn/contraction == worse (red).
  const buDeltaColor = (n) => n > 0 ? "#ef4444" : n < 0 ? "#22c55e" : "#64748b";
  const upDeltaColor = (n) => n > 0 ? "#22c55e" : n < 0 ? "#ef4444" : "#64748b";
  const kpiCards = [
    { label: "BU Forecast (C/C)", val: fmtD(rollup.current || 0), detail: `${signed(rollup.delta || 0)} WoW`, detailColor: buDeltaColor(rollup.delta || 0), color: "#0ea5e9" },
    { label: "New $0\u2192FC accounts", val: String(newFcTotal), detail: `${newFcLargeTotal} large`, color: "#f59e0b" },
    { label: "Worsened accounts", val: String(worsenedTotal), detail: `${worsenedLargeTotal} \u2265 threshold`, color: "#ef4444" },
    { label: "Best Case", val: fmtD(bestCase.current_total || 0), detail: `${signed(bestCase.delta || 0)} WoW`, detailColor: buDeltaColor(bestCase.delta || 0), color: "#8b5cf6" },
    { label: "Worst Case", val: fmtD(worstCase.current_total || 0), detail: `${signed(worstCase.delta || 0)} WoW`, detailColor: buDeltaColor(worstCase.delta || 0), color: "#0d9488" }
  ];
  const regionRows = (regionFilter ? bu.regions.filter((r) => r.region === regionFilter) : bu.regions);
  const buTable = `
<table>
<tr><th>Region</th><th class="r">Accounts</th><th class="r">Prior BU FC</th><th class="r">Current BU FC</th><th class="r">\u0394 $</th><th class="r">\u0394 %</th></tr>
${regionRows.map((o) => `<tr><td style="font-weight:500">${esc(o.region)}</td><td class="r">${o.accounts}</td><td class="r">${fmtDash(o.prior)}</td><td class="r">${fmtDash(o.current)}</td><td class="r" style="color:${buDeltaColor(o.delta)};font-weight:600">${signed(o.delta)}</td><td class="r" style="color:${buDeltaColor(o.delta)}">${pctS(o.delta_pct)}</td></tr>`).join("\n")}
${!regionFilter ? `<tr style="font-weight:700;border-top:2px solid #e5e7eb"><td>Total</td><td class="r">${rollup.accounts || 0}</td><td class="r">${fmtDash(rollup.prior)}</td><td class="r">${fmtDash(rollup.current)}</td><td class="r" style="color:${buDeltaColor(rollup.delta || 0)}">${signed(rollup.delta || 0)}</td><td class="r" style="color:${buDeltaColor(rollup.delta || 0)}">${pctS(rollup.delta_pct)}</td></tr>` : ""}
</table>`;
  const trendHtml = bu.trend && bu.trend.length > 1 ? (() => {
    const rows = bu.trend.map((t, i) => {
      const v = t.total_bu_fc || 0;
      const adj = t.total_adjusted_fc != null ? t.total_adjusted_fc : v;
      const gap = t.gap != null ? t.gap : adj - v;
      const prev = i > 0 ? (bu.trend[i - 1].total_bu_fc || 0) : null;
      const d = prev == null ? null : v - prev;
      const dp = prev == null || prev === 0 ? null : d / Math.abs(prev) * 100;
      return { date: (t.effective_date || "").slice(0, 10), v, adj, gap, d, dp };
    });
    const first = rows[0], last = rows[rows.length - 1];
    const regionLabel = regionFilter || "All regions";
    const gapColor = Math.abs(last.gap) > 0.5 ? buDeltaColor(last.gap) : "#64748b";
    return `
<h3 style="font-size:12px;font-weight:700;margin:16px 0 4px">BU vs Adjusted (ELT) Forecast Trend (over time)</h3>
<p style="font-size:12px;margin:0 0 2px">Latest BU <strong style="color:#0369a1">${fmtDash(last.v)}</strong> &nbsp;&middot;&nbsp; Adjusted <strong style="color:#6366f1">${fmtDash(last.adj)}</strong> &nbsp;&middot;&nbsp; gap <strong style="color:${gapColor}">${signed(last.gap)}</strong></p>
${last.d != null ? `<p class="sub" style="margin:0 0 2px;color:${buDeltaColor(last.d)};font-weight:600">BU WoW ${signed(last.d)} (${pctS(last.dp)})</p>` : ""}
<p class="sub" style="margin:0 0 6px">${esc(regionLabel)} &middot; ${esc(first.date)} &rarr; ${esc(last.date)}</p>
<p class="sub" style="margin:0 0 6px;font-size:9px">BU = system bottoms-up forecast &middot; Adjusted = ELT / calls applied as-of each snapshot (falls back to BU where no call exists) &middot; gap = Adjusted \u2212 BU.</p>
<table>
<tr><th>Week (date)</th><th class="r">BU FC</th><th class="r">Adjusted FC</th><th class="r">\u0394 (Adj\u2212BU)</th></tr>
${rows.map((r) => `<tr><td>${esc(r.date)}</td><td class="r">${fmtDash(r.v)}</td><td class="r" style="color:#6366f1;font-weight:600">${fmtDash(r.adj)}</td><td class="r" style="color:${r.gap === 0 ? "#9ca3af" : buDeltaColor(r.gap)};font-weight:600">${r.gap === 0 ? "\u2014" : signed(r.gap)}</td></tr>`).join("\n")}
</table>`;
  })() : "";
  // "What happened" cell: two clearly-labeled source blocks (Forecast Summary
  // + Last Renewals Studio Note). Each block appears only when its source has
  // content; both empty => em-dash; below-threshold => muted placeholder.
  const explainAttr = (d) => [d.forecast_summary ? "Forecast Summary: " + d.forecast_summary : "", d.renewals_studio_note ? "Last Renewals Studio Note: " + d.renewals_studio_note : ""].filter(Boolean).join(" \u2014 ");
  const explainHtml = (d) => {
    if (!d.is_large) return "<span style='color:#9ca3af'>below threshold</span>";
    const parts = [];
    if (d.forecast_summary) parts.push(`<div><span style="font-weight:600;color:#374151">Forecast Summary:</span> ${esc(d.forecast_summary)}</div>`);
    if (d.renewals_studio_note) parts.push(`<div style="margin-top:2px"><span style="font-weight:600;color:#374151">Last Renewals Studio Note:</span> ${esc(d.renewals_studio_note)}</div>`);
    return parts.length ? parts.join("") : "\u2014";
  };
  const worsenedTable = (rows) => rows.length ? `
<table>
<tr><th>Account</th><th>Region</th><th class="r">Prior BU FC</th><th class="r">Current BU FC</th><th class="r">Adverse swing</th><th>What happened</th></tr>
${rows.map((d) => `<tr><td style="font-weight:500">${esc(d.account_name)}</td><td>${esc(d.region)}</td><td class="r">${fmtDash(d.prior_bu_fc)}</td><td class="r">${fmtDash(d.current_bu_fc)}</td><td class="r" style="color:#ef4444;font-weight:600">${signed(d.swing)}</td><td class="note-cell" title="${esc(explainAttr(d))}">${explainHtml(d)}</td></tr>`).join("\n")}
</table>` : `<p style="font-size:11px;color:#9ca3af;margin:6px 0">No worsened accounts.</p>`;
  const newFcTable = (rows) => rows.length ? `
<table>
<tr><th>Account</th><th>Region</th><th class="r">New BU FC</th><th>What happened</th></tr>
${rows.map((d) => `<tr><td style="font-weight:500">${esc(d.account_name)}</td><td>${esc(d.region)}</td><td class="r" style="color:#d97706;font-weight:600">${fmtDash(d.current_bu_fc)}</td><td class="note-cell" title="${esc(explainAttr(d))}">${explainHtml(d)}</td></tr>`).join("\n")}
</table>` : `<p style="font-size:11px;color:#9ca3af;margin:6px 0">No new in-quarter forecasts.</p>`;
  // C/C convention: increase = more churn/contraction = worse (red); decrease
  // = better (green).
  const moverTable = (up, down, deltaLabel) => `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
<div><h3 style="font-size:12px;font-weight:700;margin:0 0 6px;color:#ef4444">Top 5 driving increase (more C/C)</h3>${up.length ? `<table><tr><th>Account</th><th>Region</th><th class="r">${esc(deltaLabel)}</th></tr>${up.map((d) => `<tr><td>${esc(d.account_name)}</td><td>${esc(d.region)}</td><td class="r" style="color:#ef4444;font-weight:600">${signed(d.delta)}</td></tr>`).join("")}</table>` : `<p style="font-size:11px;color:#9ca3af">None.</p>`}</div>
<div><h3 style="font-size:12px;font-weight:700;margin:0 0 6px;color:#22c55e">Top 5 driving decrease (less C/C)</h3>${down.length ? `<table><tr><th>Account</th><th>Region</th><th class="r">${esc(deltaLabel)}</th></tr>${down.map((d) => `<tr><td>${esc(d.account_name)}</td><td>${esc(d.region)}</td><td class="r" style="color:#22c55e;font-weight:600">${signed(d.delta)}</td></tr>`).join("")}</table>` : `<p style="font-size:11px;color:#9ca3af">None.</p>`}</div>
</div>`;
  const bestCaseTable = (up, down) => moverTable(up, down, "\u0394 Best Case");
  const worstCaseTable = (up, down) => moverTable(up, down, "\u0394 Worst Case");
  const overallBlock = `
<h2>Overall Rollup</h2>
${buTable}
${trendHtml}
<h3 style="font-size:12px;font-weight:700;margin:16px 0 6px">Accounts that worsened WoW (${worsenedTotal > worsened.length ? "top " + worsened.length + " of " + worsenedTotal : worsenedTotal})</h3>
${worsenedTable(worsened)}
<h3 style="font-size:12px;font-weight:700;margin:16px 0 6px">New in-quarter forecast \u2014 $0 \u2192 FC (${newFcTotal > newFc.length ? "top " + newFc.length + " of " + newFcTotal : newFcTotal})</h3>
${newFcTable(newFc)}
<h3 style="font-size:12px;font-weight:700;margin:16px 0 6px">Best Case movement (${fmtDash(bestCase.current_total)}, <span style="color:${buDeltaColor(bestCase.delta || 0)}">${signed(bestCase.delta || 0)} WoW</span>)</h3>
${bestCaseTable(bestCase.top_increase || [], bestCase.top_decrease || [])}
<h3 style="font-size:12px;font-weight:700;margin:16px 0 6px">Worst Case movement (${fmtDash(worstCase.current_total)}, <span style="color:${buDeltaColor(worstCase.delta || 0)}">${signed(worstCase.delta || 0)} WoW</span>)</h3>
${worstCaseTable(worstCase.top_increase || [], worstCase.top_decrease || [])}`;
  const regionsForBlocks = regionFilter ? [regionFilter] : bu.regions.map((r) => r.region);
  const perRegionBlocks = regionsForBlocks.map((rname) => {
    const rMove = bu.regions.find((r) => r.region === rname) || { current: 0, prior: 0, delta: 0, delta_pct: null, accounts: 0 };
    const rWorse = worsened.filter((d) => d.region === rname);
    const rNew = newFc.filter((d) => d.region === rname);
    const rBcUp = (bestCase.top_increase || []).filter((d) => d.region === rname);
    const rBcDown = (bestCase.top_decrease || []).filter((d) => d.region === rname);
    const rWcUp = (worstCase.top_increase || []).filter((d) => d.region === rname);
    const rWcDown = (worstCase.top_decrease || []).filter((d) => d.region === rname);
    return `
<h2>Region: ${esc(rname)}</h2>
<p class="sub" style="margin-bottom:8px">${rMove.accounts} accounts \u00b7 BU FC ${fmtDash(rMove.current)} (${signed(rMove.delta)} WoW, ${pctS(rMove.delta_pct)})</p>
<h3 style="font-size:12px;font-weight:700;margin:10px 0 6px">Worsened WoW (${rWorse.length})</h3>
${worsenedTable(rWorse)}
<h3 style="font-size:12px;font-weight:700;margin:14px 0 6px">New in-quarter forecast (${rNew.length})</h3>
${newFcTable(rNew)}
<h3 style="font-size:12px;font-weight:700;margin:14px 0 6px">Best Case movers</h3>
${bestCaseTable(rBcUp, rBcDown)}
<h3 style="font-size:12px;font-weight:700;margin:14px 0 6px">Worst Case movers</h3>
${worstCaseTable(rWcUp, rWcDown)}`;
  }).join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly 100K+ Regional Brief</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1f2937;padding:40px;max-width:1200px;margin:0 auto;font-size:13px;line-height:1.5}
h1{font-size:20px;font-weight:700;margin-bottom:4px}
h2{font-size:14px;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
.sub{font-size:11px;color:#6b7280;margin-bottom:24px}
.kpi-row{display:grid;grid-template-columns:repeat(${kpiCards.length},1fr);gap:12px;margin-bottom:24px}
.kpi{border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
.kpi .label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;font-weight:600}
.kpi .val{font-size:22px;font-weight:700}
.kpi .detail{font-size:10px;color:#9ca3af;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
th{background:#f9fafb;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em;padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb}
td{padding:6px 10px;border-bottom:1px solid #f3f4f6;vertical-align:top}
.r{text-align:right}
tr:hover{background:#f9fafb}
.note-cell{max-width:360px;font-size:10px;color:#64748b}
@media print{body{padding:20px;font-size:11px}.kpi .val{font-size:16px}}
</style></head><body>
<h1>Weekly 100K+ Regional Brief</h1>
<p class="sub">${scopeLine} &middot; Generated ${genDate}</p>
${brief.warning ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:11px;color:#92400e;margin-bottom:16px">${esc(brief.warning)}</p>` : ""}
<div class="kpi-row">
${kpiCards.map((c) => `<div class="kpi"><div class="label" style="color:${c.color}">${c.label}</div><div class="val">${c.val}</div><div class="detail"${c.detailColor ? ` style="color:${c.detailColor};font-weight:600"` : ""}>${esc(c.detail)}</div></div>`).join("\n")}
</div>
${overallBlock}
${perRegionBlocks}
<p style="font-size:9px;color:#9ca3af;margin-top:24px;text-align:center">Generated ${genDate} &middot; Renewals Intelligence Studio &middot; Weekly 100K+ Regional Brief</p>
</body></html>`;
  try {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `Weekly_100K_Brief_${(brief.quarter || "current").replace(/[^a-zA-Z0-9]/g, "_")}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  } catch (e) {
    alert("Could not generate brief: " + e.message);
  }
}
function WeeklyBriefTab() {
  const fmtC = fmtCompactDash;
  const fmtMoney = fmtCompact;
  const signed = (n) => (n >= 0 ? "+" : "\u2212") + fmtMoney(Math.abs(n));
  const pctS = (v) => v == null || !isFinite(v) ? "\u2014" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  // Friendly snapshot timestamps (drop the raw filename): "Jul 27, 2026, 4:24 PM".
  const fmtDateTime = (iso) => {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleString(void 0, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const fmtDateShort = (iso) => {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString(void 0, { month: "short", day: "numeric", year: "numeric" });
  };
  // Consume the app's shared filter state so the brief opens pre-scoped to
  // whatever the rest of the dashboard is narrowed to (same mechanism, not a
  // parallel one). Single-valued app selections seed the brief's dimensions;
  // the CCO defaults (band 100k+, current quarter) remain the fallback.
  const { state } = useApp();
  const sf = state && state.filters || {};
  // The brief's account scope is driven ENTIRELY by the app's global Filters
  // bar (state.filters); the brief no longer has its own scope dropdowns. Each
  // dimension is DERIVED from the shared filter state (not local component
  // state) so editing the top Filters bar re-scopes and re-fetches the brief.
  const firstOf = (arr) => Array.isArray(arr) && arr.length === 1 ? arr[0] : "__ALL__";
  // A dimension scopes the brief only when EXACTLY ONE value is selected in the
  // global bar; 0 or 2+ selections => "All" for that dimension (the endpoint
  // takes one value per dimension and the brief is a single-cut summary).
  const region = firstOf(sf.regions);
  const segment = firstOf(sf.segments);
  const owner = firstOf(sf.owners);
  // Quarter: exactly one globally-selected quarter scopes the brief; empty, the
  // default seed, or a multi-select all fall back to the current fiscal quarter
  // (empty string => endpoint auto-picks it).
  const quarter = Array.isArray(sf.quarters) && sf.quarters.length === 1 ? sf.quarters[0] : "";
  // Account inclusion is driven by the app's ARR range filter (on ATR), NOT a
  // fixed 100k+ band. Derive arr_min/arr_max from the global Filters bar and
  // disable the band bucket (band=all) server-side. With no ARR filter set,
  // the brief keeps its CCO default floor of $100K so it still opens as a
  // 100K+ brief until the user narrows ARR from the top bar.
  const DEFAULT_ARR_FLOOR = 1e5;
  const _n = (v) => (v != null && v !== "" && isFinite(Number(v))) ? Number(v) : null;
  const _ranges = Array.isArray(sf.arrRanges) ? sf.arrRanges : [];
  let gArrMin = null, gArrMax = null;
  if (_ranges.length >= 1) {
    const mins = _ranges.map((r) => _n(r.min)).filter((v) => v != null);
    const maxs = _ranges.map((r) => _n(r.max)).filter((v) => v != null && v > 0 && isFinite(v));
    gArrMin = mins.length ? Math.min.apply(null, mins) : null;
    // Only bound the top when EVERY selected range has a finite max (an
    // open-ended top range means "no ceiling").
    gArrMax = (maxs.length && maxs.length === _ranges.length) ? Math.max.apply(null, maxs) : null;
  } else {
    gArrMin = _n(sf.arrMin);
    gArrMax = _n(sf.arrMax);
  }
  const arrFilterActive = gArrMin != null || gArrMax != null;
  const arrMin = arrFilterActive ? gArrMin : DEFAULT_ARR_FLOOR;
  const arrMax = arrFilterActive ? gArrMax : null;
  const [currentId, setCurrentId] = useState("");
  const [priorId, setPriorId] = useState("");
  const [threshold, setThreshold] = useState(50000);
  // Client-side noise filters (no refetch). Worsened: min adverse swing.
  // New $0->FC: min new BU FC (there's no prior swing since prior was $0, so
  // the meaningful magnitude is the size of the new forecast). 0 = show all.
  const [minSwing, setMinSwing] = useState(0);
  const [minNewFc, setMinNewFc] = useState(0);
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const didInit = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    const qs = new URLSearchParams({ slot: "active", threshold: String(threshold || 0) });
    if (currentId) qs.set("current", currentId);
    if (priorId) qs.set("prior", priorId);
    // Every filter is applied SERVER-side so all sections — including BOTH
    // trend series — are scoped consistently. Each active dimension MUST be
    // in the fetch params AND the effect deps below, or the trend would
    // ignore the selection.
    // sub_region and cs_manager are intentionally omitted: the global Filters
    // bar has no equivalent dimensions, so the brief no longer scopes on them.
    if (region && region !== "__ALL__") qs.set("region", region);
    if (segment && segment !== "__ALL__") qs.set("segment", segment);
    if (owner && owner !== "__ALL__") qs.set("owner", owner);
    if (quarter) qs.set("quarter", quarter);
    // Disable the coarse band bucket; the ARR range governs inclusion.
    qs.set("band", "all");
    if (arrMin != null) qs.set("arr_min", String(arrMin));
    if (arrMax != null) qs.set("arr_max", String(arrMax));
    fetch("/api/renewals/weekly-brief?" + qs.toString(), { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (cancelled) return;
      if (!data.ok) throw new Error(data.detail || "Weekly brief load failed");
      setBrief(data);
      if (!didInit.current) {
        didInit.current = true;
        if (data.current && !currentId) setCurrentId(String(data.current.id));
        if (data.prior && !priorId) setPriorId(String(data.prior.id));
      }
    }).catch((e) => {
      if (!cancelled) setErr(e.message || String(e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentId, priorId, threshold, region, segment, owner, quarter, arrMin, arrMax]);
  const sec = brief && brief.sections;
  const bu = sec && sec.bu_movement || { regions: [], rollup: {}, trend: [] };
  const rollup = bu.rollup || {};
  const bestCase = sec && sec.best_case || {};
  const worstCase = sec && sec.worst_case || {};
  // Data is already region-scoped by the server; render it directly.
  const worsened = sec && sec.worsened || [];
  const newFc = sec && sec.new_forecast || [];
  const regionRows = bu.regions || [];
  const snapshots = brief && brief.snapshots || [];
  const buDeltaColor = (n) => n > 0 ? "#ef4444" : n < 0 ? "#22c55e" : "#64748b";
  const upDeltaColor = (n) => n > 0 ? "#22c55e" : n < 0 ? "#ef4444" : "#64748b";
  const snapLabel = (s) => fmtDateTime(s.effective_date) + (s.row_count ? " \u00b7 " + Number(s.row_count).toLocaleString() + " rows" : "");
  const cell = (txt, cls) => /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 " + (cls || "") }, txt);
  const th = (txt, cls) => /* @__PURE__ */ React.createElement("th", { key: txt, className: "px-2 py-1.5 text-left font-semibold uppercase tracking-wider " + (cls || "") }, txt);
  // Shared payload for the download button (scope values are echoed by the
  // server too, but the threshold comes from the brief-local control).
  const dlOpts = { region, segment, owner, quarter, band: "all", arr_min: arrMin, arr_max: arrMax, threshold };
  // ---- controls -----------------------------------------------------------
  // Only brief-specific controls live here: the snapshot pair to diff and the
  // large-mover threshold. All account scope comes from the global Filters bar.
  const ctrlLabel = (txt) => /* @__PURE__ */ React.createElement("div", { className: "text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1" }, txt);
  const curSel = /* @__PURE__ */ React.createElement("div", null, ctrlLabel("Current snapshot"), /* @__PURE__ */ React.createElement("select", { className: "filter-input text-xs", value: currentId, onChange: (e) => setCurrentId(e.target.value) }, snapshots.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.id, value: String(s.id) }, snapLabel(s)))));
  const priorSel = /* @__PURE__ */ React.createElement("div", null, ctrlLabel("Compare to (prior)"), /* @__PURE__ */ React.createElement("select", { className: "filter-input text-xs", value: priorId, onChange: (e) => setPriorId(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Auto (previous week)"), snapshots.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.id, value: String(s.id) }, snapLabel(s)))));
  const thrInput = /* @__PURE__ */ React.createElement("div", null, ctrlLabel("Large-mover threshold ($)"), /* @__PURE__ */ React.createElement("input", { className: "filter-input text-xs w-28", type: "number", step: "5000", value: threshold, onChange: (e) => setThreshold(Number(e.target.value) || 0) }));
  const dlBtn = /* @__PURE__ */ React.createElement("button", { className: "smallbtn smallbtn-indigo", disabled: !brief || !brief.sections, onClick: () => brief && generateWeeklyBriefHtml(brief, dlOpts) }, "Download brief");
  const controls = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3 flex flex-wrap gap-3 items-end" }, curSel, priorSel, thrInput, /* @__PURE__ */ React.createElement("div", { className: "ml-auto" }, dlBtn));
  // ---- applied-filters chip strip -----------------------------------------
  // Read-only summary of what's scoping the brief, in three labelled groups.
  // Scope now mirrors the GLOBAL Filters bar (users change it up top), so these
  // chips are informational rather than removable.
  const mutedChip = (key, label) => /* @__PURE__ */ React.createElement("span", { key, className: "region-filter-chip region-filter-chip-muted" }, label);
  const groupLabel = (txt) => /* @__PURE__ */ React.createElement("span", { className: "text-[9px] uppercase tracking-wider text-gray-500 font-semibold shrink-0" }, txt);
  // Group 1 \u2014 Comparing: the snapshot pair being diffed (driven by the
  // Current/Prior snapshot dropdowns). Informational.
  const comparingVal = brief && brief.current ? (brief.prior ? fmtDateShort(brief.prior.effective_date) : "\u2014") + " \u2192 " + fmtDateShort(brief.current.effective_date) : "\u2014";
  const comparingGroup = /* @__PURE__ */ React.createElement("div", { className: "wb-filter-group" }, groupLabel("Comparing"), mutedChip("pair", comparingVal));
  // Group 2 \u2014 Scope: account-inclusion filters sourced from the global bar.
  // Band + Quarter always define the brief; Region/Segment/Owner appear when
  // active. A multi-select in the global bar collapses to "All" for the brief,
  // which the chip states plainly so it's never ambiguous.
  const dimChip = (key, label, arr) => {
    const a = Array.isArray(arr) ? arr : [];
    if (a.length === 1) return mutedChip(key, label + ": " + a[0]);
    if (a.length > 1) return mutedChip(key, label + ": " + a.length + " selected \u00b7 brief shows All");
    return null;
  };
  const scopeChips = [];
  const arrChipLabel = arrFilterActive
    ? ("ARR " + (arrMin != null ? "\u2265 " + fmtMoney(arrMin) : "") + (arrMin != null && arrMax != null ? " \u00b7 " : "") + (arrMax != null ? "\u2264 " + fmtMoney(arrMax) : ""))
    : "ARR \u2265 " + fmtMoney(DEFAULT_ARR_FLOOR) + " (default)";
  scopeChips.push(mutedChip("arr", arrChipLabel));
  if (brief && brief.quarter) scopeChips.push(mutedChip("q", "Quarter " + brief.quarter + (brief.quarter_auto_selected ? " (auto)" : "")));
  [dimChip("region", "Region", sf.regions), dimChip("seg", "Segment", sf.segments), dimChip("own", "Owner", sf.owners)].forEach((c) => { if (c) scopeChips.push(c); });
  const scopeGroup = /* @__PURE__ */ React.createElement("div", { className: "wb-filter-group" }, groupLabel("Scope"), /* @__PURE__ */ React.createElement("div", { className: "region-filter-summary" }, scopeChips));
  // Group 3 \u2014 Large-mover cutoff: the threshold for flagging large movers.
  // Informational (adjusted via the Large threshold input); does NOT filter rows.
  const cutoffGroup = /* @__PURE__ */ React.createElement("div", { className: "wb-filter-group" }, groupLabel("Large-mover cutoff"), mutedChip("thr", "\u2265 " + fmtMoney(threshold)));
  const scopeHint = /* @__PURE__ */ React.createElement("div", { className: "wb-filter-hint text-[10px] text-gray-500 mt-1" }, "Scope is controlled by the Filters bar at the top of the page.");
  const chipStrip = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface px-3 py-2" }, /* @__PURE__ */ React.createElement("div", { className: "wb-filter-strip" }, comparingGroup, scopeGroup, cutoffGroup), scopeHint);
  // ---- Plain-English takeaway (the single most important line) ------------
  // States the headline WoW movement for the current scope in one sentence,
  // color-coded to the C/C convention (increase = worse = red).
  const scopeLabel = region === "__ALL__" ? "all regions" : region;
  const tkDelta = rollup.delta || 0;
  const tkVerb = tkDelta > 0 ? "worsened by" : tkDelta < 0 ? "improved by" : "held roughly flat";
  const takeaway = /* @__PURE__ */ React.createElement("div", { className: "wb-takeaway", style: { borderLeft: "3px solid " + buDeltaColor(tkDelta), background: "rgba(148,163,184,0.10)", borderRadius: 8, padding: "8px 12px", fontSize: "12px", lineHeight: 1.5 } },
    "This week, the BU forecast (C/C) for ",
    /* @__PURE__ */ React.createElement("b", null, scopeLabel),
    " ",
    /* @__PURE__ */ React.createElement("b", { style: { color: buDeltaColor(tkDelta) } }, tkVerb, tkDelta === 0 ? "" : " " + fmtMoney(Math.abs(tkDelta)) + (rollup.delta_pct == null || !isFinite(rollup.delta_pct) ? "" : " (" + Math.abs(rollup.delta_pct).toFixed(1) + "%)")),
    ", to ",
    /* @__PURE__ */ React.createElement("b", null, fmtC(rollup.current)),
    ". ",
    /* @__PURE__ */ React.createElement("b", { style: { color: "#ef4444" } }, worsened.length),
    (worsened.length === 1 ? " account worsened" : " accounts worsened"),
    " \u00b7 ",
    /* @__PURE__ */ React.createElement("b", { style: { color: "#d97706" } }, newFc.length),
    " new $0\u2192FC.");
  // ---- Merged header: title + takeaway + controls + scope chips (one card) -
  const briefHeader = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3 space-y-2" },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-2 flex-wrap" },
      /* @__PURE__ */ React.createElement("div", { className: "text-sm font-semibold" }, "Weekly 100K+ Regional Brief"),
      dlBtn),
    takeaway,
    /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-3 items-end" }, curSel, priorSel, thrInput),
    /* @__PURE__ */ React.createElement("div", { className: "wb-filter-strip" }, comparingGroup, scopeGroup, cutoffGroup),
    scopeHint);
  if (loading && !brief) return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, controls, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-gray-500" }, "Loading weekly brief\u2026"));
  if (err) return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, controls, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-red-500" }, err));
  if (!sec) return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, controls, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-gray-500" }, brief && brief.warning || "Upload at least two active CSV snapshots to compare week over week."));
  // ---- KPI tiles ----------------------------------------------------------
  const kpis = [
    { label: "BU Forecast (C/C)", value: fmtC(rollup.current), delta: rollup.delta, deltaColor: buDeltaColor(rollup.delta || 0), accent: "#0ea5e9" },
    { label: "Best Case", value: fmtC(bestCase.current_total), delta: bestCase.delta, deltaColor: buDeltaColor(bestCase.delta || 0), accent: "#8b5cf6" },
    { label: "Worst Case", value: fmtC(worstCase.current_total), delta: worstCase.delta, deltaColor: buDeltaColor(worstCase.delta || 0), accent: "#0d9488" },
    { label: "Worsened accounts", value: String(sec.worsened_total != null ? sec.worsened_total : (sec.worsened || []).length), sub: `${sec.worsened_large_total != null ? sec.worsened_large_total : (sec.worsened || []).filter((r) => r.is_large).length} \u2265 threshold`, accent: "#ef4444" },
    { label: "New $0\u2192FC", value: String(sec.new_forecast_total != null ? sec.new_forecast_total : (sec.new_forecast || []).length), sub: `${sec.new_forecast_large_total != null ? sec.new_forecast_large_total : (sec.new_forecast || []).filter((r) => r.is_large).length} large`, accent: "#f59e0b" }
  ];
  const kpiRow = /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-2" }, kpis.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "glass-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-label" }, c.label), /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-value", style: { color: c.accent } }, c.value), c.delta != null ? /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub", style: { color: c.deltaColor } }, signed(c.delta), " WoW") : c.sub ? /* @__PURE__ */ React.createElement("div", { className: "glass-kpi-sub" }, c.sub) : null)));
  // ---- Section 1: BU movement by region ----------------------------------
  const buRegionCard = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" },
    /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 border-b text-xs font-semibold" }, "1 \u00b7 BU forecast movement by region"),
    /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[11px]" },
      /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Region", "Accounts", "Prior BU FC", "Current BU FC", "\u0394 $", "\u0394 %"].map((h, i) => th(h, i > 0 ? "text-right" : "")))),
      /* @__PURE__ */ React.createElement("tbody", null,
        regionRows.map((o) => /* @__PURE__ */ React.createElement("tr", { key: o.region, className: "glass-row-accent" }, cell(o.region, "font-medium"), cell(o.accounts, "text-right tabular-nums"), cell(fmtC(o.prior), "text-right tabular-nums"), cell(fmtC(o.current), "text-right tabular-nums"), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums font-semibold", style: { color: buDeltaColor(o.delta) } }, signed(o.delta)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums", style: { color: buDeltaColor(o.delta) } }, pctS(o.delta_pct)))),
        region === "__ALL__" && /* @__PURE__ */ React.createElement("tr", { className: "font-bold border-t-2", style: { borderColor: "var(--border)" } }, cell("Total"), cell(rollup.accounts || 0, "text-right tabular-nums"), cell(fmtC(rollup.prior), "text-right tabular-nums"), cell(fmtC(rollup.current), "text-right tabular-nums"), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums", style: { color: buDeltaColor(rollup.delta || 0) } }, signed(rollup.delta || 0)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums", style: { color: buDeltaColor(rollup.delta || 0) } }, pctS(rollup.delta_pct)))))));
  // ---- Trend chart (BU vs Adjusted/ELT forecast over time) ----------------
  const trend = bu.trend || [];
  let trendCard = null;
  if (trend.length > 1) {
    const BU_COLOR = "#0ea5e9", ADJ_COLOR = "#6366f1";
    // BU_FC = forecasted churn/contraction; higher = worse. The gap
    // (Adjusted \u2212 BU) shows how much the teams' calls move the number.
    const trendRows = trend.map((t, i) => {
      const buv = t.total_bu_fc || 0;
      const adj = t.total_adjusted_fc != null ? t.total_adjusted_fc : buv;
      const gap = t.gap != null ? t.gap : adj - buv;
      const prevBu = i > 0 ? (trend[i - 1].total_bu_fc || 0) : null;
      const d = prevBu == null ? null : buv - prevBu;
      const dp = prevBu == null || prevBu === 0 ? null : d / Math.abs(prevBu) * 100;
      return { date: (t.effective_date || "").slice(0, 10), bu: buv, adj, gap, d, dp };
    });
    const first = trendRows[0];
    const latest = trendRows[trendRows.length - 1];
    const regionLabel = region === "__ALL__" ? "All regions" : region;
    // ---- chart geometry (domain spans BOTH series) ----
    const w = 720, h = 300, pad = { t: 30, r: 24, b: 58, l: 68 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const allVals = trendRows.reduce((a, r) => { a.push(r.bu, r.adj); return a; }, []);
    const dataMin = Math.min(...allVals), dataMax = Math.max(...allVals);
    // Nice, human-friendly Y ticks (loose labeling) so the axis reads in
    // round increments instead of raw data-max fractions.
    const niceNum = (x, round) => {
      if (!(x > 0)) return 1;
      const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
      const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
      return nf * Math.pow(10, e);
    };
    const N_TICKS = 5;
    let lo = dataMin, hi = dataMax;
    if (hi <= lo) hi = lo + Math.abs(lo || 1);
    const step = niceNum(niceNum(hi - lo, false) / (N_TICKS - 1), true) || 1;
    const yMin = Math.floor(lo / step) * step;
    const yMax = Math.ceil(hi / step) * step;
    const tickCount = Math.max(1, Math.round((yMax - yMin) / step));
    const xAt = (i) => pad.l + (trendRows.length === 1 ? 0 : i / (trendRows.length - 1)) * iw;
    const yAt = (v) => pad.t + ih - (v - yMin) / (yMax - yMin || 1) * ih;
    const gridEls = [];
    for (let i = 0; i <= tickCount; i++) {
      const val = yMin + i * step;
      const gy = yAt(val);
      gridEls.push(/* @__PURE__ */ React.createElement("line", { key: "g" + i, x1: pad.l, y1: gy, x2: w - pad.r, y2: gy, stroke: "currentColor", strokeWidth: 1, className: "text-gray-200 dark:text-gray-700", opacity: 0.7 }));
      gridEls.push(/* @__PURE__ */ React.createElement("text", { key: "gt" + i, x: pad.l - 8, y: gy + 3, textAnchor: "end", fontSize: 10, fill: "currentColor", className: "text-gray-500" }, fmtMoney(val)));
    }
    const buCoords = trendRows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.bu).toFixed(1)}`).join(" ");
    const adjCoords = trendRows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.adj).toFixed(1)}`).join(" ");
    const GAP_EPS = 0.5;
    const anyDiv = trendRows.some((r) => Math.abs(r.gap) > GAP_EPS);
    // Shade the area between the two lines. Where they coincide the band has
    // zero height (invisible); where they diverge, the gap reads at a glance.
    const bandEl = anyDiv ? /* @__PURE__ */ React.createElement("polygon", {
      points: trendRows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.adj).toFixed(1)}`).concat(trendRows.map((r, i) => `${xAt(trendRows.length - 1 - i).toFixed(1)},${yAt(trendRows[trendRows.length - 1 - i].bu).toFixed(1)}`)).join(" "),
      fill: ADJ_COLOR, opacity: 0.14, stroke: "none"
    }) : null;
    // Labels: one per point. A single BU label where the lines coincide; a
    // second (Adjusted) label ONLY where they diverge, offset so the two
    // never overlap (higher point labelled above, lower point below). To keep
    // the chart uncluttered, only first / last / divergence points are
    // labelled (tooltip + table carry the rest).
    const lastIdx = trendRows.length - 1;
    const labelAll = trendRows.length <= 4;
    const pointEls = [];
    const labelEls = [];
    trendRows.forEach((r, i) => {
      const bx = xAt(i), by = yAt(r.bu), ay = yAt(r.adj);
      const isDiv = Math.abs(r.gap) > GAP_EPS;
      const tip = `${r.date}\nBU FC ${fmtMoney(r.bu)}\nAdjusted (ELT) ${fmtMoney(r.adj)}\nGap (Adj\u2212BU) ${signed(r.gap)}` + (r.d == null ? "" : `\nBU WoW ${signed(r.d)} (${pctS(r.dp)})`);
      // BU marker at every point; Adjusted marker only where it diverges.
      pointEls.push(/* @__PURE__ */ React.createElement("circle", { key: "bc" + i, cx: bx, cy: by, r: 3, fill: BU_COLOR }));
      if (isDiv) pointEls.push(/* @__PURE__ */ React.createElement("circle", { key: "ac" + i, cx: bx, cy: ay, r: 3.8, fill: ADJ_COLOR, stroke: "#fff", strokeWidth: 1 }));
      pointEls.push(/* @__PURE__ */ React.createElement("circle", { key: "bh" + i, cx: bx, cy: by, r: 12, fill: "transparent" }, /* @__PURE__ */ React.createElement("title", null, tip)));
      if (isDiv) pointEls.push(/* @__PURE__ */ React.createElement("circle", { key: "ah" + i, cx: bx, cy: ay, r: 12, fill: "transparent" }, /* @__PURE__ */ React.createElement("title", null, tip)));
      if (labelAll || i === 0 || i === lastIdx || isDiv) {
        if (isDiv) {
          const topIsAdj = ay <= by;
          const topY = Math.min(ay, by), botY = Math.max(ay, by);
          labelEls.push(/* @__PURE__ */ React.createElement("text", { key: "lt" + i, x: bx, y: topY - 8, textAnchor: "middle", fontSize: 10, fontWeight: 700, fill: topIsAdj ? ADJ_COLOR : BU_COLOR }, fmtMoney(topIsAdj ? r.adj : r.bu)));
          labelEls.push(/* @__PURE__ */ React.createElement("text", { key: "lb" + i, x: bx, y: botY + 15, textAnchor: "middle", fontSize: 10, fontWeight: 700, fill: topIsAdj ? BU_COLOR : ADJ_COLOR }, fmtMoney(topIsAdj ? r.bu : r.adj)));
        } else {
          labelEls.push(/* @__PURE__ */ React.createElement("text", { key: "lc" + i, x: bx, y: by - 8, textAnchor: "middle", fontSize: 10, fontWeight: 700, fill: BU_COLOR }, fmtMoney(r.bu)));
        }
      }
    });
    const xLabelEls = trendRows.map((r, i) => /* @__PURE__ */ React.createElement("text", { key: "x" + i, x: xAt(i), y: h - pad.b + 16, textAnchor: "middle", fontSize: 9, fill: "currentColor", className: "text-gray-500" }, r.date.slice(5)));
    const axisLine = /* @__PURE__ */ React.createElement("line", { x1: pad.l, y1: pad.t + ih, x2: w - pad.r, y2: pad.t + ih, stroke: "currentColor", strokeWidth: 1, className: "text-gray-300 dark:text-gray-600" });
    const yTitle = /* @__PURE__ */ React.createElement("text", { x: 14, y: pad.t + ih / 2, textAnchor: "middle", fontSize: 10, fontWeight: 600, fill: "currentColor", className: "text-gray-500", transform: `rotate(-90 14 ${pad.t + ih / 2})` }, "Forecast (C/C)");
    const xTitle = /* @__PURE__ */ React.createElement("text", { x: pad.l + iw / 2, y: h - 4, textAnchor: "middle", fontSize: 10, fontWeight: 600, fill: "currentColor", className: "text-gray-500" }, "Snapshot week (effective date)");
    const svg = /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${w} ${h}`, className: "wb-trend-chart", role: "img", "aria-label": `BU vs adjusted forecast over time for ${regionLabel}` }, gridEls, bandEl, axisLine, /* @__PURE__ */ React.createElement("polyline", { fill: "none", stroke: BU_COLOR, strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round", points: buCoords }), /* @__PURE__ */ React.createElement("polyline", { fill: "none", stroke: ADJ_COLOR, strokeWidth: 2, strokeDasharray: "6 3", strokeLinejoin: "round", strokeLinecap: "round", points: adjCoords }), pointEls, labelEls, xLabelEls, yTitle, xTitle);
    // ---- legend ----
    const legend = /* @__PURE__ */ React.createElement("div", { className: "wb-trend-legend" },
      /* @__PURE__ */ React.createElement("span", { className: "wb-trend-legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "wb-trend-swatch", style: { background: BU_COLOR } }), "BU forecast (system)"),
      /* @__PURE__ */ React.createElement("span", { className: "wb-trend-legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "wb-trend-swatch wb-trend-swatch-dash", style: { color: ADJ_COLOR } }), "Adjusted \u2014 ELT / calls (as-of)"));
    // ---- headline callout (scannable: primary amounts, WoW as a separate
    //      secondary line) ----
    const gapColor = Math.abs(latest.gap) > GAP_EPS ? buDeltaColor(latest.gap) : "#64748b";
    const headline = /* @__PURE__ */ React.createElement("div", { className: "wb-trend-headline" },
      /* @__PURE__ */ React.createElement("div", { className: "wb-trend-headline-primary" },
        /* @__PURE__ */ React.createElement("span", null, "Latest BU ", /* @__PURE__ */ React.createElement("b", { style: { color: BU_COLOR } }, fmtC(latest.bu))),
        /* @__PURE__ */ React.createElement("span", null, "Adjusted ", /* @__PURE__ */ React.createElement("b", { style: { color: ADJ_COLOR } }, fmtC(latest.adj))),
        /* @__PURE__ */ React.createElement("span", null, "gap ", /* @__PURE__ */ React.createElement("b", { style: { color: gapColor } }, signed(latest.gap)))),
      latest.d != null && /* @__PURE__ */ React.createElement("div", { className: "wb-trend-headline-wow", style: { color: buDeltaColor(latest.d) } }, "BU WoW ", signed(latest.d), " (", pctS(latest.dp), ")"),
      /* @__PURE__ */ React.createElement("div", { className: "wb-trend-headline-sub" }, regionLabel, " \u00b7 ", first.date, " \u2192 ", latest.date));
    // ---- companion data table (Week \u00b7 BU FC \u00b7 Adjusted FC \u00b7 gap) ----
    const tableEl = /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto mt-3" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[11px]" },
      /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Week (date)", "BU FC", "Adjusted FC", "\u0394 (Adj\u2212BU)"].map((hh, i) => th(hh, i > 0 ? "text-right" : "")))),
      /* @__PURE__ */ React.createElement("tbody", null, trendRows.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: "glass-row-accent" },
        cell(r.date, "tabular-nums"),
        cell(fmtC(r.bu), "text-right tabular-nums"),
        cell(fmtC(r.adj), "text-right tabular-nums"),
        /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums font-semibold", style: { color: r.gap === 0 ? "#9ca3af" : buDeltaColor(r.gap) } }, r.gap === 0 ? "\u2014" : signed(r.gap)))))));
    trendCard = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface p-3" },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-1" },
        /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold" }, "BU vs adjusted (ELT) forecast over time"),
        /* @__PURE__ */ React.createElement("div", { className: "text-[10px] text-gray-500" }, "Higher = more forecasted churn/contraction \u00b7 gap = Adj \u2212 BU")),
      legend, headline, svg, tableEl);
  }
  // ---- "What happened" cell: two clearly-labeled source blocks -----------
  // Renders Forecast Summary and Last Renewals Studio Note as separate labeled
  // lines; each block appears ONLY when its source has content. If both are
  // empty, shows "\u2014"; below-threshold rows show a muted placeholder.
  const explainCell = (d) => {
    if (!d.is_large) return /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, "below threshold");
    const fs = d.forecast_summary;
    const note = d.renewals_studio_note;
    if (!fs && !note) return "\u2014";
    const lbl = "font-semibold text-gray-600 dark:text-gray-300";
    const blocks = [];
    if (fs) blocks.push(/* @__PURE__ */ React.createElement("div", { key: "fs" }, /* @__PURE__ */ React.createElement("span", { className: lbl }, "Forecast Summary: "), fs));
    if (note) blocks.push(/* @__PURE__ */ React.createElement("div", { key: "note", className: fs ? "mt-1" : "" }, /* @__PURE__ */ React.createElement("span", { className: lbl }, "Last Renewals Studio Note: "), note));
    return blocks;
  };
  const explainTitle = (d) => [d.forecast_summary ? "Forecast Summary: " + d.forecast_summary : "", d.renewals_studio_note ? "Last Renewals Studio Note: " + d.renewals_studio_note : ""].filter(Boolean).join("\n");
  // ---- Section 2: worsened (with a client-side min-swing noise filter) ----
  const worsenedShown = worsened.filter((d) => (d.swing || 0) >= (minSwing || 0));
  const worsenedTotal = sec.worsened_total != null ? sec.worsened_total : worsened.length;
  const worsenedCount = worsenedShown.length === worsenedTotal ? "(" + worsenedTotal + ")" : "(showing " + worsenedShown.length + " of " + worsenedTotal + ")";
  const worsenedCard = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" },
    /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap" },
      /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold" }, "2 \u00b7 Accounts that worsened WoW ", worsenedCount),
      /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-1 text-[10px] text-gray-500 font-normal" }, "Min adverse swing $",
        /* @__PURE__ */ React.createElement("input", { className: "filter-input text-xs w-24", type: "number", step: "5000", min: "0", value: minSwing, onChange: (e) => setMinSwing(Number(e.target.value) || 0) }))),
    /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[11px]" },
      /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Account", "Region", "Prior BU FC", "Current BU FC", "Adverse swing", "What happened"].map((h, i) => th(h, i >= 2 && i <= 4 ? "text-right" : "")))),
      /* @__PURE__ */ React.createElement("tbody", null, worsenedShown.length ? worsenedShown.map((d, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: "glass-row-accent" }, cell(d.account_name, "font-medium"), cell(d.region), cell(fmtC(d.prior_bu_fc), "text-right tabular-nums"), cell(fmtC(d.current_bu_fc), "text-right tabular-nums"), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums font-semibold", style: { color: "#ef4444" } }, signed(d.swing)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-[10px] text-gray-500 max-w-[320px]", title: explainTitle(d) }, explainCell(d)))) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "px-2 py-3 text-gray-500", colSpan: 6 }, minSwing > 0 && worsened.length ? "No accounts with adverse swing \u2265 " + fmtMoney(minSwing) + " in this scope." : "No worsened accounts in this scope."))))));
  // ---- Section 3: new $0->FC (with a client-side min-new-FC noise filter) --
  const newFcShown = newFc.filter((d) => (d.current_bu_fc || 0) >= (minNewFc || 0));
  const newFcTotal = sec.new_forecast_total != null ? sec.new_forecast_total : newFc.length;
  const newFcCount = newFcShown.length === newFcTotal ? "(" + newFcTotal + ")" : "(showing " + newFcShown.length + " of " + newFcTotal + ")";
  const newFcCard = /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" },
    /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap" },
      /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold" }, "3 \u00b7 New in-quarter forecast \u2014 $0 \u2192 FC ", newFcCount),
      /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-1 text-[10px] text-gray-500 font-normal" }, "Min new FC $",
        /* @__PURE__ */ React.createElement("input", { className: "filter-input text-xs w-24", type: "number", step: "5000", min: "0", value: minNewFc, onChange: (e) => setMinNewFc(Number(e.target.value) || 0) }))),
    /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[11px]" },
      /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Account", "Region", "New BU FC", "What happened"].map((h, i) => th(h, i === 2 ? "text-right" : "")))),
      /* @__PURE__ */ React.createElement("tbody", null, newFcShown.length ? newFcShown.map((d, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: "glass-row-accent" }, cell(d.account_name, "font-medium"), cell(d.region), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums font-semibold", style: { color: "#d97706" } }, fmtC(d.current_bu_fc)), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-[10px] text-gray-500 max-w-[320px]", title: explainTitle(d) }, explainCell(d)))) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "px-2 py-3 text-gray-500", colSpan: 4 }, minNewFc > 0 && newFc.length ? "No new forecasts \u2265 " + fmtMoney(minNewFc) + " in this scope." : "No new in-quarter forecasts in this scope."))))));
  // ---- Best/Worst Case movement ------------------------------------------
  // C/C convention: an INCREASE in forecasted churn/contraction = worse = red;
  // a decrease = better = green (same as BU/worsened coloring).
  const driverTable = (rows, color, emptyTxt, deltaLabel) => /* @__PURE__ */ React.createElement("table", { className: "min-w-full text-[11px]" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "glass-thead" }, ["Account", "Region", deltaLabel || "\u0394"].map((h, i) => th(h, i === 2 ? "text-right" : "")))), /* @__PURE__ */ React.createElement("tbody", null, rows.length ? rows.map((d, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: "glass-row-accent" }, cell(d.account_name, "font-medium"), cell(d.region), /* @__PURE__ */ React.createElement("td", { className: "px-2 py-1 text-right tabular-nums font-semibold", style: { color } }, signed(d.delta)))) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "px-2 py-3 text-gray-500", colSpan: 3 }, emptyTxt))));
  const caseCard = (num, title, sectionData, deltaLabel) => {
    const inc = sectionData.top_increase || [];
    const dec = sectionData.top_decrease || [];
    return /* @__PURE__ */ React.createElement("div", { className: "glass-card-surface overflow-hidden" },
      /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 border-b text-xs font-semibold flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", null, num + " \u00b7 " + title), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-normal text-gray-500" }, "Total ", fmtC(sectionData.current_total), " \u00b7 ", /* @__PURE__ */ React.createElement("span", { style: { color: buDeltaColor(sectionData.delta || 0) } }, signed(sectionData.delta || 0), " WoW"))),
      /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3 p-3" },
        /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-red-500 mb-1" }, "Top 5 driving increase (more C/C)"), driverTable(inc, "#ef4444", "None.", deltaLabel)),
        /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-semibold text-emerald-600 mb-1" }, "Top 5 driving decrease (less C/C)"), driverTable(dec, "#22c55e", "None.", deltaLabel))));
  };
  const bestCaseCard = caseCard("4", "Best Case movement", bestCase, "\u0394 Best Case");
  const worstCaseCard = caseCard("5", "Worst Case movement", worstCase, "\u0394 Worst Case");
  const casesRow = /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-3" }, bestCaseCard, worstCaseCard);
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, briefHeader, brief.warning && /* @__PURE__ */ React.createElement("div", { className: "rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200/80 dark:ring-amber-800/40 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300" }, brief.warning), kpiRow, buRegionCard, trendCard, worsenedCard, newFcCard, casesRow);
}
function App() {
  const { state, actions, idbReady, serverInfo } = useApp();
  const { csvAutoLoadStatus } = useAppStatus();
  const hasData = state?.data?.length > 0;
  const [gateStep, setGateStep] = useState(() => hasData ? "done" : "loading");
  const didAutoApplyRegionRef = useRef(false);
  useEffect(() => {
    if (!idbReady) return;
    setGateStep((prev) => {
      if (prev === "done") return prev;
      if ((state?.data?.length || 0) > 0) return "done";
      if (prev !== "loading") return prev;
      if (serverInfo === null) return "loading";
      if (serverInfo?.ok && (csvAutoLoadStatus === "idle" || csvAutoLoadStatus === "pending")) {
        return "loading";
      }
      return "done";
    });
  }, [idbReady, state?.data?.length, serverInfo, csvAutoLoadStatus]);
  useEffect(() => {
    if (gateStep === "done") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [state.ui.activeTab, gateStep]);
  useEffect(() => {
    if (!hasData || gateStep !== "done" || didAutoApplyRegionRef.current) return;
    didAutoApplyRegionRef.current = true;
    actions.setTab("region");
    actions.setFilters((prev) => ({
      ...prev,
      regions: [],
      countries: [],
      segments: [],
      industries: [],
      healths: [],
      owners: [],
      partners: [],
      partnerTypes: [],
      quarters: [],
      search: "",
      dateFrom: "",
      dateTo: "",
      band: "all",
      hasNotes: false
    }));
  }, [hasData, gateStep, actions]);
  return /* @__PURE__ */ React.createElement("div", { className: "min-h-full region-font" }, gateStep === "loading" && /* @__PURE__ */ React.createElement("div", { className: "splash-shell", style: { display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "var(--muted)" } }, /* @__PURE__ */ React.createElement("svg", { className: "mx-auto mb-3 animate-spin", width: "32", height: "32", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M21 12a9 9 0 11-6.219-8.56" })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: "0.9rem", fontWeight: 600 } }, "Restoring your session..."))), /* @__PURE__ */ React.createElement("div", { className: `app-shell ${gateStep !== "done" ? "is-hidden" : ""}` }, /* @__PURE__ */ React.createElement(Header, null), /* @__PURE__ */ React.createElement("main", { className: "max-w-7xl mx-auto px-4 pt-4 pb-6 space-y-4" }, !hasData && /* @__PURE__ */ React.createElement(NoDataBanner, null), /* @__PURE__ */ React.createElement(React.Fragment, null, state.ui.activeTab === "partner" && /* @__PURE__ */ React.createElement(Partner, null), state.ui.activeTab === "accounts" && /* @__PURE__ */ React.createElement(Accounts, null), state.ui.activeTab === "region" && /* @__PURE__ */ React.createElement(RegionQuarterTable, null), state.ui.activeTab === "notes" && /* @__PURE__ */ React.createElement(NotesHub, null), state.ui.activeTab === "historical" && /* @__PURE__ */ React.createElement(HistoricalTab, null), state.ui.activeTab === "targets" && /* @__PURE__ */ React.createElement(TargetsTab, null), state.ui.activeTab === "weekly" && /* @__PURE__ */ React.createElement(WeeklyBriefTab, null)), /* @__PURE__ */ React.createElement("footer", { className: "text-xs text-gray-500 dark:text-gray-400 text-center pt-6" }, "Data, notes, targets, and settings persist in your browser. Use Reset to clear everything.")), /* @__PURE__ */ React.createElement(ColumnsDrawer, null)), /* @__PURE__ */ React.createElement(RefreshOverlay, null));
}
function NoDataBanner() {
  return /* @__PURE__ */ React.createElement("div", { className: "rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200/80 dark:ring-amber-800/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[13px] text-amber-800 dark:text-amber-200" }, /* @__PURE__ */ React.createElement("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0 } }, /* @__PURE__ */ React.createElement("path", { d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, "No data loaded yet"), " \u2014 load it from Admin (CSV upload or Snowflake \u2018Run now\u2019).")), /* @__PURE__ */ React.createElement("a", { href: "/admin", className: "smallbtn smallbtn-indigo whitespace-nowrap", style: { textDecoration: "none" } }, "Go to Admin"));
}
ReactDOM.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ React.createElement(ErrorBoundary, null, /* @__PURE__ */ React.createElement(AppProvider, null, /* @__PURE__ */ React.createElement(App, null)))
);
