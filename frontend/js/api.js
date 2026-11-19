// ---------- Play-is-School API Client ----------
// The API runs on port 5000 of the same host that served this page, so other devices
// (e.g. http://192.168.1.20:5500) reach the server instead of their own "localhost".
// Set window.PLAY_IS_SCHOOL_API_BASE before this script to point somewhere else.
const API_BASE = window.PLAY_IS_SCHOOL_API_BASE
  || `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000/api`;

function getLoginUrl() {
  const inPages = window.location.pathname.includes('/pages/');
  return inPages ? 'login.html' : 'pages/login.html';
}

function getDashboardUrl(role) {
  const inPages = window.location.pathname.includes('/pages/');
  return inPages ? `dashboard-${role}.html` : `pages/dashboard-${role}.html`;
}

// ---------- Per-tab sessions ----------
// Each tab keeps its own login in sessionStorage, so an admin, a teacher and a parent can be
// signed in side by side (even in one browser) without one login replacing another.
// localStorage only remembers the most recent login so a newly opened tab starts signed in.
const SESSION_TOKEN_KEY = 'png_token';
const SESSION_USER_KEY = 'png_user';

function storageGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function storageSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* storage unavailable */ }
}
function storageRemove(storage, key) {
  try { storage.removeItem(key); } catch { /* storage unavailable */ }
}

// New tab: adopt the most recent login once; afterwards this tab keeps its own session.
if (!storageGet(sessionStorage, SESSION_TOKEN_KEY) && storageGet(localStorage, SESSION_TOKEN_KEY)) {
  storageSet(sessionStorage, SESSION_TOKEN_KEY, storageGet(localStorage, SESSION_TOKEN_KEY));
  storageSet(sessionStorage, SESSION_USER_KEY, storageGet(localStorage, SESSION_USER_KEY) || 'null');
}

const Auth = {
  getToken: () => storageGet(sessionStorage, SESSION_TOKEN_KEY),
  getUser: () => {
    try { return JSON.parse(storageGet(sessionStorage, SESSION_USER_KEY) || 'null'); } catch { return null; }
  },
  setSession: (token, user) => {
    const userJson = JSON.stringify(user);
    storageSet(sessionStorage, SESSION_TOKEN_KEY, token);
    storageSet(sessionStorage, SESSION_USER_KEY, userJson);
    storageSet(localStorage, SESSION_TOKEN_KEY, token);
    storageSet(localStorage, SESSION_USER_KEY, userJson);
  },
  clear: () => {
    // Only forget the shared "most recent login" if it belongs to this tab's account,
    // so logging out here never signs out another user's tab.
    const token = storageGet(sessionStorage, SESSION_TOKEN_KEY);
    if (token && storageGet(localStorage, SESSION_TOKEN_KEY) === token) {
      storageRemove(localStorage, SESSION_TOKEN_KEY);
      storageRemove(localStorage, SESSION_USER_KEY);
    }
    storageRemove(sessionStorage, SESSION_TOKEN_KEY);
    storageRemove(sessionStorage, SESSION_USER_KEY);
  },
  isLoggedIn: () => !!storageGet(sessionStorage, SESSION_TOKEN_KEY),
};

// Reads the expiry from the sign-in token (no secret needed: the server still verifies it).
function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload && payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function showSessionExpired(message) {
  showErrorPopup(`${message}\n\nYour changes were not saved. Sign in again in a new tab, then come back and save.`, {
    title: 'Please sign in again',
    action: { label: 'Sign in', href: getLoginUrl() },
  });
}

// Writes (saving, deleting, uploading) are checked before they are sent: an expired or missing
// session is caught here, so the form keeps what was typed instead of failing on the server.
function validateTokenBeforeSaving() {
  const token = Auth.getToken();
  if (!token || token.split('.').length !== 3) {
    return 'You are not signed in.';
  }
  const expiresAt = tokenExpiresAt(token);
  if (!expiresAt) return 'Your session is not valid.';
  if (expiresAt - Date.now() < 10 * 1000) return 'Your session has expired.';
  return '';
}

// `version` = the updatedAt of the record that was loaded for editing. The server refuses the
// change (409) if someone else saved the record in the meantime (optimistic locking).
async function apiRequest(path, { method = 'GET', body, auth = true, headers: additionalHeaders = {}, version } = {}) {
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  if (auth && isWrite && path !== '/auth/logout') {
    const problem = validateTokenBeforeSaving();
    if (problem) {
      showSessionExpired(problem);
      const error = new Error(`${problem} Sign in again to save your changes.`);
      error.status = 401;
      error.code = 'TOKEN_EXPIRED';
      throw error;
    }
  }
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (auth && Auth.getToken()) headers.Authorization = `Bearer ${Auth.getToken()}`;
  if (version) {
    const parsed = new Date(version);
    if (!Number.isNaN(parsed.getTime())) headers['X-Record-Version'] = parsed.toISOString();
  }
  Object.assign(headers, additionalHeaders);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  const refreshedIntegrationAccess = res.headers.get('X-Integration-Access-Refresh');
  if (refreshedIntegrationAccess && typeof onIntegrationAccessRefreshed === 'function') {
    onIntegrationAccessRefreshed(refreshedIntegrationAccess, additionalHeaders['X-Integration-Access']);
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401 && auth) {
      if (isWrite) {
        // Don't leave the page during a save: the person would lose what they typed.
        showSessionExpired((data && data.message) || 'Your session is no longer valid.');
      } else {
        Auth.clear();
        window.location.href = getLoginUrl();
      }
    }
    if (res.status === 429 && data && data.retryAfterSeconds && typeof showToast === 'function') {
      showToast(data.message, 'error');
    }
    const error = new Error((data && data.message) || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = data && data.code;
    error.data = data;
    throw error;
  }
  return data;
}

const api = {
  get: (path, opts = {}) => apiRequest(path, opts),
  post: (path, body, opts = {}) => apiRequest(path, { method: 'POST', body, ...opts }),
  patch: (path, body, opts = {}) => apiRequest(path, { method: 'PATCH', body, ...opts }),
  put: (path, body, opts = {}) => apiRequest(path, { method: 'PUT', body, ...opts }),
  putFormData: (path, body, opts = {}) => apiRequest(path, { method: 'PUT', body, ...opts }),
  del: (path) => apiRequest(path, { method: 'DELETE' }),
};

// ---------- Edit locks ("X is currently editing this") ----------
// Opening a record for editing locks it to you. Anyone else who tries to edit it sees who is
// editing and is asked to wait. The lock is kept alive while the form is open and released on
// save, cancel, close or leaving the page; if a browser closes, it expires on its own.
const EDIT_LOCK_HEARTBEAT_MS = 30 * 1000;

const EditLocks = {
  held: new Map(), // "resource:id" -> handle

  lockedMessage(error) {
    const holder = error.data && error.data.lockedBy;
    if (!holder) return error.message;
    const since = holder.since ? new Date(holder.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return `${error.message}${since ? `\n\nEditing since ${since}.` : ''}`;
  },

  showLocked(error) {
    const holder = (error.data && error.data.lockedBy) || {};
    showErrorPopup(this.lockedMessage(error), { title: `${holder.name || 'Someone'} is editing this` });
  },

  // Returns a handle, or null when someone else is editing (the pop-up is shown for you).
  // `isActive` (optional) lets the lock release itself once the form is no longer open.
  async acquire(resource, id, { isActive } = {}) {
    if (!resource || !id) return { release() {} };
    const key = `${resource}:${id}`;
    if (this.held.has(key)) this.held.get(key).release();
    try {
      await api.post('/locks', { resource, id: String(id) });
    } catch (error) {
      if (error.status === 423) {
        this.showLocked(error);
        return null;
      }
      // Lock service unavailable: let the person edit; the server still checks versions on save.
      console.warn('[edit-lock] Could not lock record:', error.message);
      return { release() {} };
    }
    let released = false;
    const handle = {
      resource,
      id: String(id),
      release: () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        this.held.delete(key);
        sendLockRelease(resource, id);
      },
    };
    const timer = setInterval(() => {
      if (isActive && !isActive()) {
        handle.release();
        return;
      }
      api.post('/locks', { resource, id: String(id) }).catch((error) => {
        if (error.status === 423) {
          // Our lock lapsed (e.g. the computer slept) and someone else took the record.
          handle.release();
          this.showLocked(error);
        }
      });
    }, EDIT_LOCK_HEARTBEAT_MS);
    this.held.set(key, handle);
    return handle;
  },

  releaseAll() {
    Array.from(this.held.values()).forEach((handle) => handle.release());
  },
};

// keepalive lets the release reach the server even while the page is closing.
function sendLockRelease(resource, id) {
  const token = Auth.getToken();
  if (!token) return;
  fetch(`${API_BASE}/locks?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
    keepalive: true,
  }).catch(() => { /* the lock expires on its own */ });
}

window.addEventListener('pagehide', () => EditLocks.releaseAll());

// Guards a dashboard page: redirect to login if not authenticated,
// or to the correct dashboard if the role doesn't match this page.
function requireRole(expectedRole) {
  if (!Auth.isLoggedIn()) {
    window.location.href = getLoginUrl();
    return null;
  }
  const user = Auth.getUser();
  if (expectedRole && user.role !== expectedRole) {
    window.location.href = getDashboardUrl(user.role);
    return null;
  }
  return user;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(n) {
  return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
// Shows an error as a pop-up. Uses a modal <dialog> so it appears above any open dialog.
// Optional `action` adds a second button, e.g. { label: 'Go to Sign In', href: 'login.html' }.
// `onClose` runs after the pop-up is dismissed.
function showErrorPopup(text, { title = 'Something went wrong', action = null, onClose = null } = {}) {
  let popup = document.getElementById('errorPopupDialog');
  if (!popup) {
    popup = document.createElement('dialog');
    popup.id = 'errorPopupDialog';
    popup.className = 'credential-manager integration-otp-dialog error-popup';
    popup.setAttribute('aria-labelledby', 'errorPopupTitle');
    popup.innerHTML = `
      <div class="credential-manager-header"><h2 id="errorPopupTitle"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> <span id="errorPopupTitleText"></span></h2></div>
      <p id="errorPopupText" class="error-popup-text"></p>
      <div class="credential-manager-actions">
        <a class="btn btn-secondary" id="errorPopupAction" hidden></a>
        <button type="button" class="btn btn-primary" id="closeErrorPopup">OK</button>
      </div>`;
    document.body.appendChild(popup);
    popup.querySelector('#closeErrorPopup').addEventListener('click', () => popup.close());
    popup.addEventListener('click', (event) => {
      if (event.target === popup) popup.close();
    });
    popup.addEventListener('close', () => {
      const callback = popup.onCloseCallback;
      popup.onCloseCallback = null;
      if (typeof callback === 'function') callback();
    });
  }
  popup.querySelector('#errorPopupTitleText').textContent = title;
  popup.querySelector('#errorPopupText').textContent = text;
  const actionLink = popup.querySelector('#errorPopupAction');
  actionLink.hidden = !action;
  if (action) {
    actionLink.textContent = action.label;
    actionLink.href = action.href;
  }
  popup.onCloseCallback = onClose;
  if (!popup.open) popup.showModal();
  popup.querySelector('#closeErrorPopup').focus();
}

function showMsg(node, text, type = 'error') {
  node.textContent = text;
  node.className = `form-msg ${type}`;
}
