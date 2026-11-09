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

async function apiRequest(path, { method = 'GET', body, auth = true, headers: additionalHeaders = {} } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (auth && Auth.getToken()) headers.Authorization = `Bearer ${Auth.getToken()}`;
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
      Auth.clear();
      window.location.href = getLoginUrl();
    }
    throw new Error((data && data.message) || `Request failed (${res.status})`);
  }
  return data;
}

const api = {
  get: (path, opts = {}) => apiRequest(path, opts),
  post: (path, body, opts = {}) => apiRequest(path, { method: 'POST', body, ...opts }),
  patch: (path, body, opts = {}) => apiRequest(path, { method: 'PATCH', body, ...opts }),
  put: (path, body, opts = {}) => apiRequest(path, { method: 'PUT', body, ...opts }),
  putFormData: (path, body) => apiRequest(path, { method: 'PUT', body }),
  del: (path) => apiRequest(path, { method: 'DELETE' }),
};

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
function showMsg(node, text, type = 'error') {
  node.textContent = text;
  node.className = `form-msg ${type}`;
}
