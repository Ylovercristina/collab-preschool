// Shared across all three dashboards: panel switching, modal helper, logout.

function initSidebarNav() {
  document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
      if (typeof onPanelShown === 'function') onPanelShown(btn.dataset.panel);
      if (btn.dataset.panel === 'settings') loadSettingsProfile();
    });
  });

  const requestedPanel = new URLSearchParams(window.location.search).get('panel');
  const panelButton = Array.from(document.querySelectorAll('.nav-item[data-panel]'))
    .find((btn) => btn.dataset.panel === requestedPanel);
  if (panelButton) panelButton.click();
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

function profileImageUrl(avatar) {
  if (!avatar) return '';
  if (/^(https?:|blob:|data:)/i.test(avatar)) return avatar;
  return `${API_BASE.replace(/\/api\/?$/, '')}${avatar.startsWith('/') ? '' : '/'}${avatar}`;
}

function renderProfileAvatar(image, initials, avatar, name) {
  const letters = (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
  initials.textContent = letters || '?';
  initials.hidden = false;
  image.hidden = true;
  image.onerror = () => {
    image.hidden = true;
    initials.hidden = false;
  };
  if (!avatar) return;
  image.src = profileImageUrl(avatar);
  image.alt = `${name || 'User'} profile image`;
  image.onload = () => {
    image.hidden = false;
    initials.hidden = true;
  };
}

function renderSidebarProfile(user) {
  const name = document.getElementById('whoName');
  const email = document.getElementById('whoEmail');
  const image = document.getElementById('sidebarAvatar');
  const initials = document.getElementById('sidebarInitials');
  if (name) name.textContent = user.name;
  if (email) email.textContent = user.email;
  if (image && initials) renderProfileAvatar(image, initials, user.avatar, user.name);
}

async function setWhoName() {
  try {
    const { user } = await api.get('/users/me');
    renderSidebarProfile(user);
  } catch (err) {
    const name = document.getElementById('whoName');
    if (name) name.textContent = 'Profile unavailable';
    console.error('Could not load sidebar profile:', err.message);
  }
}

function populateSettingsProfile(user) {
  document.getElementById('profileFirstName').value = user.firstName || '';
  document.getElementById('profileMiddleName').value = user.middleName || '';
  document.getElementById('profileLastName').value = user.lastName || '';
  document.getElementById('profileEmail').value = user.email || '';
  document.getElementById('profileAddress').value = user.address || '';
  document.getElementById('profilePhone').value = user.phone || '';
  const childrenField = document.getElementById('profileChildrenField');
  const childrenNames = document.getElementById('profileChildrenNames');
  childrenField.hidden = user.role !== 'parent';
  childrenNames.value = user.role === 'parent' ? (user.childrenNames || []).join('\n') : '';
  renderProfileAvatar(
    document.getElementById('profilePreviewImage'),
    document.getElementById('profilePreviewInitials'),
    user.avatar,
    user.name
  );
}

async function loadSettingsProfile() {
  const form = document.getElementById('profileForm');
  if (!form) return;
  try {
    const { user } = await api.get('/users/me');
    renderSidebarProfile(user);
    populateSettingsProfile(user);
    const message = document.getElementById('profileFormMessage');
    message.textContent = '';
    message.className = 'form-msg';
  } catch (err) {
    showMsg(document.getElementById('profileFormMessage'), err.message);
  }
}

function initSettingsProfile() {
  const form = document.getElementById('profileForm');
  if (!form) return;
  const message = document.getElementById('profileFormMessage');
  const imageInput = document.getElementById('profileImage');
  let previewUrl = '';

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      imageInput.value = '';
      showMsg(message, 'Choose a JPG, PNG or WEBP image no larger than 2 MB.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    renderProfileAvatar(
      document.getElementById('profilePreviewImage'),
      document.getElementById('profilePreviewInitials'),
      previewUrl,
      [
        document.getElementById('profileFirstName').value,
        document.getElementById('profileMiddleName').value,
        document.getElementById('profileLastName').value,
      ].filter(Boolean).join(' ')
    );
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const firstName = document.getElementById('profileFirstName').value.trim();
    const middleName = document.getElementById('profileMiddleName').value.trim();
    const lastName = document.getElementById('profileLastName').value.trim();
    const email = document.getElementById('profileEmail').value.trim();
    const address = document.getElementById('profileAddress').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (!firstName || !lastName || !email || !address || !phone) {
      showMsg(message, 'First name, last name, email, address and contact number are required.');
      return;
    }
    if (firstName.length > 80 || middleName.length > 80 || lastName.length > 80) {
      showMsg(message, 'Each name field must be 80 characters or fewer.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg(message, 'Enter a valid email address.');
      return;
    }
    if (!/^\+?[0-9\s().-]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      showMsg(message, 'Enter a valid contact number.');
      return;
    }
    const formData = new FormData(form);
    const childrenField = document.getElementById('profileChildrenField');
    if (!childrenField.hidden) {
      formData.set('childrenNames', JSON.stringify(
        document.getElementById('profileChildrenNames').value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
      ));
    }

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await api.putFormData('/users/me', formData);
      const { user } = await api.get('/users/me');
      renderSidebarProfile(user);
      form.reset();
      populateSettingsProfile(user);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      showMsg(message, 'Your profile has been updated.', 'success');
    } catch (err) {
      showMsg(message, err.message);
    } finally {
      submitButton.disabled = false;
    }
  });
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
  initSettingsProfile();
  setWhoName();
  if (document.getElementById('modalBackdrop')) Modal.init();
});
