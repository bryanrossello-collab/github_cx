/**
 * Stable call_key = accountId::yearQuarter::roundedATR
 * Must stay in sync with app/call_keys.py
 */
(function (global) {
  'use strict';

  function normalizeAccountName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNumber(v) {
    if (v == null || v === '') return NaN;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function effectiveAtrFromRow(row, hm, settings) {
    if (!row) return 0;
    const ltgKey = hm && (hm.ATR_LTG || hm.ATR_REMAINING || 'ATR_ARR_USD_LTG');
    const baseKey = hm && (hm.ATR_STARTING || 'ATR_ARR_USD_STARTING');
    const useLtg = settings && settings.useRemainingArr;
    if (useLtg && row.__ATR_EFFECTIVE != null) {
      return Math.round(toNumber(row.__ATR_EFFECTIVE) || 0);
    }
    if (useLtg) {
      const ltg = toNumber(row[ltgKey]);
      if (ltg > 0) return Math.round(ltg);
    }
    return Math.round(toNumber(row[baseKey]) || 0);
  }

  function yearQuarterFromRow(row, hm) {
    if (!row) return 'na';
    const fq = String(
      row.FISCAL_QUARTER ||
        row.YEAR_QUARTER ||
        (hm && row[hm.FISCAL_QUARTER]) ||
        (hm && row[hm.YEAR_QUARTER]) ||
        ''
    ).trim();
    if (fq) return fq;
    const dateKey = (hm && hm.NEXT_RENEWAL_DATE) || 'NEXT_RENEWAL_DATE';
    const raw = String(row[dateKey] || '').trim();
    if (raw) {
      const dt = Date.parse(raw);
      if (!Number.isNaN(dt)) return new Date(dt).toISOString().slice(0, 7);
      return raw.slice(0, 7) || 'na';
    }
    return 'na';
  }

  function buildCallKeyFromParts(accountId, accountName, yearQuarter, roundedAtr) {
    const acctBase = String(accountId || '').trim() || normalizeAccountName(accountName);
    if (!acctBase) return null;
    const period = String(yearQuarter || '').trim() || 'na';
    const atr = Math.round(Number(roundedAtr) || 0);
    return acctBase + '::' + period + '::' + atr;
  }

  function buildCallKey(row, hm, settings) {
    if (!row) return null;
    const acctId = String((hm && row[hm.ACCOUNT_ID]) || row.CRM_ACCOUNT_ID || '').trim();
    const acctName = String(
      (hm && row[hm.ACCOUNT_NAME]) || row.CRM_ACCOUNT_NAME || row.ACCOUNT_NAME || ''
    ).trim();
    const yq = yearQuarterFromRow(row, hm);
    const atr = effectiveAtrFromRow(row, hm, settings);
    return buildCallKeyFromParts(acctId, acctName, yq, atr);
  }

  global.RenewalsCallKeys = {
    normalizeAccountName: normalizeAccountName,
    buildCallKey: buildCallKey,
    buildCallKeyFromParts: buildCallKeyFromParts,
    yearQuarterFromRow: yearQuarterFromRow,
    effectiveAtrFromRow: effectiveAtrFromRow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
