/**
 * Server-first data loading for Renewals Studio.
 *
 * The compiled dashboard downloads ~12 MB CSVs and parses them with
 * Papaparse on every cold load. We intercept those fetches and serve
 * pre-parsed rows from Postgres via /api/renewals/parsed-data instead.
 *
 * Postgres remains the source of truth; IndexedDB may still cache a
 * copy after import for faster in-session reloads.
 */
(function vibeServerParsedData() {
  'use strict';

  var PARSED_SENTINEL = '__VIBE_SERVER_PARSED__';
  var pendingImport = null;

  function inferSlotFromUrl(url) {
    var lower = String(url || '').toLowerCase();
    if (lower.indexOf('historical') >= 0) return 'historical';
    return 'active';
  }

  function isCsvFileFetch(url) {
    if (!url) return false;
    return (
      url.indexOf('/api/renewals/data-source/file') >= 0 ||
      url.indexOf('/apps/renewals/') >= 0
    );
  }

  function wrapRenewalsActions() {
    var actions = window.__renewalsActions;
    if (!actions || actions.__vibeServerWrapped) return !!actions;
    ['importCSV', 'importHistoricalCSV'].forEach(function (name) {
      var orig = actions[name];
      if (typeof orig !== 'function') return;
      actions[name] = function (rows, headers, uploadedAtMs) {
        // Papaparse completes with empty rows after our sentinel shortcut.
        if (!rows || !rows.length) return;
        return orig.call(this, rows, headers, uploadedAtMs);
      };
    });
    actions.__vibeServerWrapped = true;
    return true;
  }

  function waitForActions(maxMs) {
    maxMs = maxMs || 6000;
    var started = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        if (wrapRenewalsActions()) return resolve(window.__renewalsActions);
        if (Date.now() - started >= maxMs) return resolve(null);
        setTimeout(tick, 50);
      })();
    });
  }

  function directImport(slot, payload) {
    var actions = window.__renewalsActions;
    if (!actions) return false;
    var key = slot + ':' + String(payload.csv_upload_id || payload.mtimeMs || 0);
    if (window.__renewalsServerImportKeys && window.__renewalsServerImportKeys[key]) {
      return true;
    }
    if (!window.__renewalsServerImportKeys) window.__renewalsServerImportKeys = {};
    var fnName = slot === 'historical' ? 'importHistoricalCSV' : 'importCSV';
    var fn = actions[fnName];
    if (typeof fn !== 'function') return false;
    fn(payload.rows || [], payload.headers || [], payload.mtimeMs || Date.now());
    window.__renewalsServerImportKeys[key] = true;
    return true;
  }

  // Short-circuit Papaparse when the dashboard thinks it parsed CSV text.
  if (window.Papa && typeof window.Papa.parse === 'function') {
    var origPapaParse = window.Papa.parse;
    window.Papa.parse = function (input, config) {
      if (input === PARSED_SENTINEL) {
        setTimeout(function () {
          if (config && typeof config.complete === 'function') config.complete();
        }, 0);
        return { abort: function () {} };
      }
      return origPapaParse.apply(this, arguments);
    };
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = async function (resource, init) {
    var url = typeof resource === 'string'
      ? resource
      : (resource && resource.url) || '';

    if (!isCsvFileFetch(url)) {
      return origFetch(resource, init);
    }

    var slot = inferSlotFromUrl(url);
    try {
      var parsedUrl = '/api/renewals/parsed-data?slot=' + encodeURIComponent(slot);
      var parsedRes = await origFetch(parsedUrl, Object.assign({ cache: 'no-store' }, init || {}));
      if (!parsedRes.ok) {
        // Fall back to raw CSV if snapshots aren't ready yet.
        return origFetch(resource, init);
      }
      var payload = await parsedRes.json();
      if (!payload || !payload.ok || !Array.isArray(payload.rows) || !payload.rows.length) {
        return origFetch(resource, init);
      }

      pendingImport = payload;
      await waitForActions();
      directImport(slot, payload);
      pendingImport = null;

      return {
        ok: true,
        status: 200,
        headers: { get: function () { return 'text/vnd.vibe.parsed'; } },
        text: async function () { return PARSED_SENTINEL; },
        json: async function () { return payload; },
      };
    } catch (_) {
      return origFetch(resource, init);
    }
  };

  // Wrap import handlers as soon as the React bundle registers them.
  var wrapTimer = setInterval(function () {
    if (wrapRenewalsActions()) clearInterval(wrapTimer);
  }, 100);
  setTimeout(function () { clearInterval(wrapTimer); }, 30000);
})();
