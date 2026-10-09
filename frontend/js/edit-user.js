const editUserAdmin = requireRole('admin');
const accountsUrl = 'dashboard-admin.html?panel=users';
const editUserId = new URLSearchParams(window.location.search).get('id');
const editUserForm = document.getElementById('editUserForm');
const editUserCard = document.getElementById('editUserCard');
const editUserError = document.getElementById('editUserError');
const editUserRole = document.getElementById('editRole');
const editChildrenField = document.getElementById('editChildrenField');
const editUserImage = document.getElementById('editUserImage');
let editUserPreviewUrl = '';

function imageUrl(avatar) {
  if (!avatar) return '';
  if (/^(https?:|blob:|data:)/i.test(avatar)) return avatar;
  return `${API_BASE.replace(/\/api\/?$/, '')}${avatar.startsWith('/') ? '' : '/'}${avatar}`;
}

function renderEditAvatar(avatar, name) {
  const image = document.getElementById('editUserAvatar');
  const initials = document.getElementById('editUserInitials');
  initials.textContent = (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  initials.hidden = false;
  image.hidden = true;
  image.onerror = () => {
    image.hidden = true;
    initials.hidden = false;
  };
  if (!avatar) return;
  image.src = imageUrl(avatar);
  image.alt = `${name || 'User'} profile image`;
  image.onload = () => {
    image.hidden = false;
    initials.hidden = true;
  };
}

function showEditError(message, isNotFound = false) {
  editUserCard.hidden = true;
  editUserError.hidden = false;
  document.getElementById('editUserErrorTitle').textContent = isNotFound ? 'User not found' : 'Could not load user';
  document.getElementById('editUserErrorMessage').textContent = message;
}

function syncChildrenVisibility() {
  editChildrenField.hidden = editUserRole.value !== 'parent';
}

function populateEditUser(user) {
  document.getElementById('editFirstName').value = user.firstName || '';
  document.getElementById('editMiddleName').value = user.middleName || '';
  document.getElementById('editLastName').value = user.lastName || '';
  document.getElementById('editEmail').value = user.email || '';
  document.getElementById('editPhone').value = user.phone || '';
  document.getElementById('editAddress').value = user.address || '';
  editUserRole.value = user.role;
  document.getElementById('editChildrenNames').value = (user.childrenNames || []).join('\n');
  syncChildrenVisibility();
  renderEditAvatar(user.avatar, user.name);
}

async function loadEditUser() {
  if (!editUserAdmin) return;
  if (!editUserId) {
    showEditError('No user ID was provided.', true);
    return;
  }

  try {
    const { user } = await api.get(`/users/${encodeURIComponent(editUserId)}`);
    populateEditUser(user);
    editUserCard.hidden = false;
    editUserForm.hidden = false;
  } catch (err) {
    showEditError(err.message, err.message.toLowerCase() === 'user not found.');
  }
}

editUserRole.addEventListener('change', syncChildrenVisibility);
editUserImage.addEventListener('change', () => {
  const file = editUserImage.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    editUserImage.value = '';
    showMsg(document.getElementById('editUserMessage'), 'Choose a JPG, PNG or WEBP image no larger than 2 MB.');
    return;
  }
  if (editUserPreviewUrl) URL.revokeObjectURL(editUserPreviewUrl);
  editUserPreviewUrl = URL.createObjectURL(file);
  const name = [
    document.getElementById('editFirstName').value,
    document.getElementById('editMiddleName').value,
    document.getElementById('editLastName').value,
  ].filter(Boolean).join(' ');
  renderEditAvatar(editUserPreviewUrl, name);
});

editUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const phone = document.getElementById('editPhone').value.trim();
  const phoneDigits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9\s().-]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    showMsg(document.getElementById('editUserMessage'), 'Enter a valid contact number.');
    return;
  }

  const formData = new FormData(editUserForm);
  if (editUserRole.value === 'parent') {
    formData.set('childrenNames', JSON.stringify(
      document.getElementById('editChildrenNames').value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
    ));
  }
  const submitButton = editUserForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await api.putFormData(`/users/${encodeURIComponent(editUserId)}`, formData);
    showMsg(document.getElementById('editUserMessage'), 'User updated. Returning to Accounts...', 'success');
    window.setTimeout(() => { window.location.href = accountsUrl; }, 900);
  } catch (err) {
    showMsg(document.getElementById('editUserMessage'), err.message);
    submitButton.disabled = false;
  }
});

loadEditUser();