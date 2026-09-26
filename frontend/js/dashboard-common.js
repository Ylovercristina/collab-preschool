// Shared across all three dashboards: panel switching, modal helper, logout.

function initSidebarNav() {
  document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
      if (typeof onPanelShown === 'function') onPanelShown(btn.dataset.panel);
    });
  });
}

function initLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try { await api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Auth.clear();
    window.location.href = '../index.html';
  });
}

function setWhoName() {
  const el = document.getElementById('whoName');
  const user = Auth.getUser();
  if (el && user) el.textContent = user.name;
}

const Modal = {
  el: null, body: null,
  init() {
    this.el = document.getElementById('modalBackdrop');
    this.body = document.getElementById('modalBody');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
  },
  open(html) {
    this.body.innerHTML = `<button class="modal-close" aria-label="Close">✕</button>${html}`;
    this.body.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.el.classList.add('open');
  },
  close() { this.el.classList.remove('open'); this.body.innerHTML = ''; },
};

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  initLogout();
  setWhoName();
  if (document.getElementById('modalBackdrop')) Modal.init();
});
