// ---------- Play-is-School API Client ----------
// Change this if your backend runs somewhere other than localhost:5000
const API_BASE = 'http://localhost:5000/api';

function getLoginUrl() {
  const inPages = window.location.pathname.includes('/pages/');
  return inPages ? 'login.html' : 'pages/login.html';
}

function getDashboardUrl(role) {
  const inPages = window.location.pathname.includes('/pages/');
  return inPages ? `dashboard-${role}.html` : `pages/dashboard-${role}.html`;
}

const Auth = {
  getToken: () => localStorage.getItem('png_token'),
  getUser: () => JSON.parse(localStorage.getItem('png_user') || 'null'),
  setSession: (token, user) => {
    localStorage.setItem('png_token', token);
    localStorage.setItem('png_user', JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem('png_token');
    localStorage.removeItem('png_user');
  },
  isLoggedIn: () => !!localStorage.getItem('png_token'),
};

async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (auth && Auth.getToken()) headers.Authorization = `Bearer ${Auth.getToken()}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    throw new Error('Could not reach the server. Is the backend running?');
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
  get: (path) => apiRequest(path),
  post: (path, body, opts = {}) => apiRequest(path, { method: 'POST', body, ...opts }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body }),
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
