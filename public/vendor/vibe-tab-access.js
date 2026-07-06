/**
 * Loads role-based tab visibility from GET /api/renewals/tab-access.
 */
(function (global) {
  'use strict';

  let allowedTabs = null;

  function isAllowed(tabId) {
    if (!allowedTabs) return true;
    return allowedTabs.has(tabId);
  }

  async function load() {
    try {
      const res = await fetch('/api/renewals/tab-access', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const tabs = Array.isArray(data.tabs) ? data.tabs : [];
      allowedTabs = new Set(tabs);
      global.__renewalsAllowedTabs = function () {
        return tabs.slice();
      };
      try {
        global.dispatchEvent(new CustomEvent('renewals-tab-access-loaded'));
      } catch (_) {}
    } catch (_) {}
  }

  global.RenewalsTabAccess = {
    load: load,
    isAllowed: isAllowed,
  };

  load();
})(typeof window !== 'undefined' ? window : globalThis);
