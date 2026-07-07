/**
 * Session lock when IDP / proxy identity is lost while the app is open.
 * DB may still respond — we block the UI so users cannot keep editing unsaved work
 * that would fail on save. Refresh re-triggers company SSO automatically.
 */
(function (global) {
  'use strict';

  var POLL_MS = 30000;
  var locked = false;
  var wasAuthed = false;
  var strictAuth = true;
  var onWhoamiCallback = null;
  var pollTimer = null;
  var fetchPatched = false;

  function isAuthedUser(user) {
    return !!(user && (user.role === 'standard' || user.role === 'admin' || user.role === 'owner'));
  }

  function shouldEnforce() {
    return strictAuth === true;
  }

  function isAuth401(body) {
    if (!body) return true;
    var d = body.detail;
    if (d && typeof d === 'object' && d.error === 'sign_in_required') return true;
    if (d === 'sign_in_required') return true;
    if (body.error === 'sign_in_required') return true;
    return false;
  }

  function ensureOverlay() {
    if (document.getElementById('vibe-session-lock')) return;
    var style = document.createElement('style');
    style.id = 'vibe-session-lock-style';
    style.textContent =
      '#vibe-session-lock{position:fixed;inset:0;z-index:2147483646;display:none;' +
      'align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.72);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
      '#vibe-session-lock.open{display:flex}' +
      '.vibe-session-lock-card{max-width:420px;width:100%;background:#fff;color:#1e293b;' +
      'border-radius:14px;padding:28px 26px;box-shadow:0 25px 50px rgba(15,23,42,.25);text-align:center}' +
      'html.dark .vibe-session-lock-card{background:#131826;color:#e6e8ef;border:1px solid #232a3d}' +
      '.vibe-session-lock-icon{font-size:40px;line-height:1;margin-bottom:12px}' +
      '.vibe-session-lock-card h2{margin:0 0 10px;font-size:20px;font-weight:700}' +
      '.vibe-session-lock-card p{margin:0 0 20px;font-size:14px;line-height:1.55;color:#64748b}' +
      'html.dark .vibe-session-lock-card p{color:#9ea3b6}' +
      '.vibe-session-lock-btn{display:inline-flex;align-items:center;justify-content:center;' +
      'min-width:200px;padding:11px 18px;border:0;border-radius:10px;background:#4f46e5;' +
      'color:#fff;font-size:14px;font-weight:600;cursor:pointer}' +
      '.vibe-session-lock-btn:hover{background:#4338ca}' +
      'html.vibe-session-locked,html.vibe-session-locked body{overflow:hidden!important}' +
      'html.vibe-session-locked #root,html.vibe-session-locked main{pointer-events:none!important;' +
      'user-select:none!important;filter:blur(2px)}';
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.id = 'vibe-session-lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'vibe-session-lock-title');
    el.innerHTML =
      '<div class="vibe-session-lock-card">' +
        '<div class="vibe-session-lock-icon" aria-hidden="true">🔒</div>' +
        '<h2 id="vibe-session-lock-title">Session expired</h2>' +
        '<p data-vibe-session-lock-msg>Your company sign-in is no longer active. ' +
        'Refresh the page to sign in again — your SSO login will open automatically.</p>' +
        '<button type="button" class="vibe-session-lock-btn" data-vibe-session-refresh>' +
          'Refresh &amp; sign in' +
        '</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('[data-vibe-session-refresh]').addEventListener('click', function () {
      global.location.reload();
    });
  }

  function showLock(message) {
    if (locked) return;
    locked = true;
    ensureOverlay();
    document.documentElement.classList.add('vibe-session-locked');
    var overlay = document.getElementById('vibe-session-lock');
    var msg = overlay && overlay.querySelector('[data-vibe-session-lock-msg]');
    if (msg && message) msg.textContent = message;
    if (overlay) overlay.classList.add('open');
    try {
      global.dispatchEvent(new CustomEvent('renewals-session-locked'));
    } catch (_) {}
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    document.documentElement.classList.remove('vibe-session-locked');
    var overlay = document.getElementById('vibe-session-lock');
    if (overlay) overlay.classList.remove('open');
    try {
      global.dispatchEvent(new CustomEvent('renewals-session-unlocked'));
    } catch (_) {}
  }

  function onWhoami(data) {
    if (data && data.config) strictAuth = !!data.config.strict_auth;
    var user = data && data.user;
    if (isAuthedUser(user)) {
      wasAuthed = true;
      if (locked) unlock();
    } else if (wasAuthed) {
      showLock(
        'Your company sign-in session expired while you were working. ' +
        'Refresh the page to sign in again — unsaved changes on this screen were not written to the server.'
      );
    }
    if (typeof onWhoamiCallback === 'function') onWhoamiCallback(data);
  }

  function checkWhoami() {
    return global.fetch('/api/whoami', { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) {
          if (wasAuthed) {
            showLock(
              'Authentication is required. Refresh the page to sign in through your company SSO.'
            );
          }
          return null;
        }
        if (!res.ok) return null;
        return res.json().then(function (data) {
          onWhoami(data);
          return data;
        });
      })
      .catch(function () {
        return null;
      });
  }

  function installFetchGuard() {
    if (fetchPatched || typeof global.fetch !== 'function') return;
    fetchPatched = true;
    var orig = global.fetch.bind(global);
    global.fetch = function () {
      return orig.apply(global, arguments).then(function (res) {
        if (res.status === 401 && wasAuthed) {
          res.clone().json().then(function (body) {
            if (isAuth401(body)) {
              showLock(
                'Your session expired before this change could be saved. ' +
                'Refresh the page to sign in again, then retry your edit.'
              );
            }
          }).catch(function () {
            showLock(
              'Your session may have expired. Refresh the page to sign in again.'
            );
          });
        }
        return res;
      });
    };
  }

  function start(opts) {
    opts = opts || {};
    onWhoamiCallback = opts.onWhoami || null;
    if (opts.pollMs && opts.pollMs > 5000) POLL_MS = opts.pollMs;
    ensureOverlay();
    installFetchGuard();
    checkWhoami();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(checkWhoami, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkWhoami();
    });
    global.addEventListener('focus', checkWhoami);
  }

  function markAuthed() {
    wasAuthed = true;
  }

  global.RenewalsSessionLock = {
    start: start,
    onWhoami: onWhoami,
    markAuthed: markAuthed,
    checkWhoami: checkWhoami,
    showLock: showLock,
    unlock: unlock,
    isLocked: function () { return locked; },
    wasAuthed: function () { return wasAuthed; },
  };
})(window);
