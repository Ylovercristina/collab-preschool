// ---------- Play-is-School -- Shared Dashboard Logic & Components ----------

// ---------- Email Delivery Summary Helpers ----------
function formatEmailSummary(summary) {
  if (!summary) return 'Email delivery status unavailable.';
  const counts = `Sent ${summary.sent}, skipped ${summary.skipped} (${summary.unverified || 0} unverified email), failed ${summary.failed}`;
  return summary.complete ? counts : `${counts} (delivery logging in progress)`;
}

async function pollEmailSummary(path, initial, target) {
  let summary = initial;
  if (target) target.textContent = formatEmailSummary(summary);
  for (let attempt = 0; !summary.complete && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await api.get(path);
    summary = response.emailSummary;
    if (target) target.textContent = formatEmailSummary(summary);
  }
  return summary;
}

function initSidebarNav() {
  document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPanel = document.getElementById(`panel-${btn.dataset.panel}`);
      if (targetPanel) targetPanel.classList.add('active');
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

function renderPaymentHistory(payments = [], feeId = '', totalFee = 0) {
  if (!payments.length) return '';
  const balancesAfterPayment = new Map();
  let totalPaid = 0;
  [...payments].sort((a, b) => new Date(a.datePaid) - new Date(b.datePaid)).forEach((payment) => {
    if (payment.receiptState !== 'voided') totalPaid += Number(payment.amountPaid || 0);
    balancesAfterPayment.set(String(payment._id), Math.max(0, totalFee - totalPaid));
  });
  return `
    <details style="margin-top:4px; font-size:12.5px;">
      <summary style="cursor:pointer; color:var(--primary); font-weight:600;">Payment history (${payments.length})</summary>
      <div style="margin-top:6px;">
        ${payments.map((payment) => {
          const remaining = payment.receiptSnapshot?.remainingBalance ?? balancesAfterPayment.get(String(payment._id));
          const receiptState = payment.receiptState || 'issued';
          return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:4px 0;">
              <span>${fmtMoney(payment.amountPaid)} - ${fmtDate(payment.datePaid)} - Cash - Receipt ${payment.receiptNumber || 'pending'} - Remaining after payment: ${fmtMoney(remaining)} - Recorded by ${payment.loggedBy?.name || 'School admin'}${payment.remarks ? ` - ${payment.remarks}` : ''}${receiptState === 'issued' ? '' : ` - ${receiptState}`}</span>
              <button class="btn btn-ghost btn-sm" data-view-receipt="${payment._id}" data-fee-id="${feeId}">View Receipt</button>
            </div>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

async function showPaymentReceipt(feeId, paymentId) {
  try {
    const { receipt, receiptNumber, state } = await api.get(`/fees/${feeId}/payments/${paymentId}/receipt`);
    if (!receipt) throw new Error('Receipt details are not available for this payment.');

    const isVoided = state === 'voided';
    const isCorrected = state === 'corrected';
    const stateLabel = isVoided ? 'VOIDED' : (isCorrected ? 'CORRECTED' : '');
    const isPaid = receipt.remainingBalance === 0;
    const statusColor = isPaid ? '#15803D' : '#B45309';
    const statusBg = isPaid ? '#DCFCE7' : '#FEF3C7';


    const logoPath = '../img/logocollab.jpg';

    // Helper to build a receipt data row
    const row = (label, value) => `
      <div style="display:flex; justify-content:space-between; align-items:baseline; padding:9px 0; border-bottom:1px solid #F1F5F9; gap:12px;">
        <span style="font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#64748B; white-space:nowrap;">${label}</span>
        <span style="font-size:14px; font-weight:600; color:#1E293B; text-align:right;">${value}</span>
      </div>`;

    // Build print-friendly plain rows (no inline HTML icons)
    const printRow = (label, value) => `<tr><td style="padding:7px 0; font-size:13px; color:#64748B; font-weight:600; white-space:nowrap; padding-right:24px;">${label}</td><td style="padding:7px 0; font-size:13px; color:#1E293B; font-weight:700; text-align:right;">${value}</td></tr>`;

    Modal.open(`
      <div id="printableReceipt" style="background:#FFFFFF; border-radius:12px; overflow:hidden;">

        <!-- Receipt Header -->
        <div style="background:linear-gradient(135deg,#38A169 0%,#276749 100%); padding:22px 24px 18px; display:flex; align-items:center; gap:16px;">
          <div style="width:52px; height:52px; border-radius:10px; background:#FFFFFF; overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.18);">
            <img src="${logoPath}" alt="School Logo" style="width:100%; height:100%; object-fit:cover; border-radius:9px;" onerror="this.style.display='none'" />
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:18px; font-weight:800; color:#FFFFFF; line-height:1.2;">${receipt.schoolName}</div>
            <div style="font-size:12px; color:rgba(255,255,255,0.82); margin-top:2px; font-weight:500;">Official Payment Receipt</div>
          </div>
          ${stateLabel ? `<div style="background:rgba(255,255,255,0.15); border:1.5px solid rgba(255,255,255,0.4); border-radius:6px; padding:4px 10px; font-size:12px; font-weight:800; color:#FFFFFF; letter-spacing:0.06em;">${stateLabel}</div>` : ''}
        </div>

        <!-- Receipt Number Banner -->
        <div style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; padding:10px 24px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748B;">Receipt No.</span>
          <span style="font-size:15px; font-weight:800; color:#2E7D32; letter-spacing:0.04em;">${receiptNumber}</span>
        </div>

        <!-- Receipt Body -->
        <div style="padding:6px 24px 16px;">

          <!-- Student Info Section -->
          <div style="margin-top:14px; margin-bottom:4px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:#94A3B8;">Student Information</div>
          <div style="background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0; padding:2px 12px; margin-bottom:10px;">
            ${row('Full Name', receipt.studentName)}
            ${row('Grade / Section', receipt.gradeSection)}
          </div>

          <!-- Fee Details Section -->
          <div style="margin-top:10px; margin-bottom:4px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:#94A3B8;">Fee Details</div>
          <div style="background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0; padding:2px 12px; margin-bottom:10px;">
            ${row('Description', receipt.feeName)}
            ${row('Total Fee', fmtMoney(receipt.totalFee))}
            ${row('Amount Paid', `<span style="color:#15803D;">${fmtMoney(receipt.amountPaid)}</span> <span style="font-size:12px; font-weight:500; color:#64748B;">(${receipt.method})</span>`)}
            ${row('Total Paid (Cumulative)', fmtMoney(receipt.totalPaid))}
            ${row('Remaining Balance', `<span style="color:${isPaid ? '#15803D' : '#B45309'}; font-weight:700;">${fmtMoney(receipt.remainingBalance)}</span>`)}
            ${receipt.dueDate && receipt.remainingBalance > 0 ? row('Due Date', fmtDate(receipt.dueDate)) : ''}
          </div>

          <!-- Payment Details Section -->
          <div style="margin-top:10px; margin-bottom:4px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:#94A3B8;">Payment Details</div>
          <div style="background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0; padding:2px 12px; margin-bottom:10px;">
            ${row('Date Paid', fmtDate(receipt.datePaid))}
            ${row('Payment Method', receipt.method)}
            ${row('Recorded By', receipt.recordedBy)}
          </div>

          <!-- Status Badge -->
          <div style="margin-top:14px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div style="display:inline-flex; align-items:center; gap:8px; background:${statusBg}; border-radius:8px; padding:8px 14px;">
              <i class="fa-solid fa-${isPaid ? 'circle-check' : 'clock'}" style="color:${statusColor}; font-size:15px;"></i>
              <span style="font-size:13px; font-weight:700; color:${statusColor};">${receipt.status}</span>
            </div>
            <div style="font-size:11.5px; color:#94A3B8;">Issued by Play-is-School</div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="padding:14px 24px 20px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #E2E8F0; gap:10px;">
          <button class="btn btn-ghost btn-sm" id="closeReceiptBtn"><i class="fa-solid fa-xmark"></i> Close</button>
          <button class="btn btn-primary btn-sm" id="printReceiptBtn"><i class="fa-solid fa-print"></i> Print Receipt</button>
        </div>

      </div>
    `);

    document.getElementById('closeReceiptBtn').addEventListener('click', () => Modal.close());

    document.getElementById('printReceiptBtn').addEventListener('click', () => {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
      const hasDue = receipt.dueDate && receipt.remainingBalance > 0;
      printWindow.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Receipt ${receiptNumber} — ${receipt.schoolName}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 32px; background: #fff; }
    .receipt { max-width: 580px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; }
    .receipt-header { background: #276749; padding: 20px 24px; display: flex; align-items: center; gap: 14px; }
    .receipt-logo { width: 48px; height: 48px; border-radius: 8px; background: #fff; object-fit: cover; }
    .receipt-header-text { flex: 1; }
    .receipt-header-text h1 { margin: 0; font-size: 18px; color: #fff; }
    .receipt-header-text p { margin: 2px 0 0; font-size: 12px; color: rgba(255,255,255,0.8); }
    .state-badge { border: 1.5px solid rgba(255,255,255,0.5); border-radius: 5px; padding: 3px 9px; font-size: 11px; font-weight: 800; color: #fff; letter-spacing: 0.06em; }
    .receipt-no-bar { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 9px 24px; display: flex; justify-content: space-between; }
    .receipt-no-bar .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    .receipt-no-bar .value { font-size: 15px; font-weight: 800; color: #276749; letter-spacing: 0.04em; }
    .receipt-body { padding: 16px 24px 20px; }
    .section-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin: 14px 0 6px; }
    .data-table { width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 6px; }
    .data-table td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table .lbl { color: #64748b; font-weight: 600; width: 46%; white-space: nowrap; }
    .data-table .val { color: #1e293b; font-weight: 700; text-align: right; }
    .status-row { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; }
    .status-pill { display: inline-block; padding: 6px 14px; border-radius: 7px; font-size: 13px; font-weight: 700; }
    .status-paid { background: #dcfce7; color: #15803d; }
    .status-partial { background: #fef3c7; color: #b45309; }
    .footer-note { font-size: 11px; color: #94a3b8; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
<div class="receipt">
  <div class="receipt-header">
    <img src="../img/logocollab.jpg" alt="Logo" class="receipt-logo" onerror="this.style.display='none'" />
    <div class="receipt-header-text">
      <h1>${receipt.schoolName}</h1>
      <p>Official Payment Receipt</p>
    </div>
    ${stateLabel ? `<span class="state-badge">${stateLabel}</span>` : ''}
  </div>
  <div class="receipt-no-bar">
    <span class="label">Receipt No.</span>
    <span class="value">${receiptNumber}</span>
  </div>
  <div class="receipt-body">
    <div class="section-label">Student Information</div>
    <table class="data-table">
      ${printRow('Full Name', receipt.studentName)}
      ${printRow('Grade / Section', receipt.gradeSection)}
    </table>

    <div class="section-label">Fee Details</div>
    <table class="data-table">
      ${printRow('Description', receipt.feeName)}
      ${printRow('Total Fee', fmtMoney(receipt.totalFee))}
      ${printRow('Amount Paid', `${fmtMoney(receipt.amountPaid)} (${receipt.method})`)}
      ${printRow('Total Paid (Cumulative)', fmtMoney(receipt.totalPaid))}
      ${printRow('Remaining Balance', fmtMoney(receipt.remainingBalance))}
      ${hasDue ? printRow('Due Date', fmtDate(receipt.dueDate)) : ''}
    </table>

    <div class="section-label">Payment Details</div>
    <table class="data-table">
      ${printRow('Date Paid', fmtDate(receipt.datePaid))}
      ${printRow('Payment Method', receipt.method)}
      ${printRow('Recorded By', receipt.recordedBy)}
    </table>

    <div class="status-row">
      <span class="status-pill ${isPaid ? 'status-paid' : 'status-partial'}">${receipt.status}</span>
      <span class="footer-note">Issued by Play-is-School</span>
    </div>
  </div>
</div>
</body>
</html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    });
  } catch (err) {
    alert(err.message);
  }
}

const Modal = {
  el: null,
  body: null,
  previousFocus: null,
  init() {
    this.el = document.getElementById('modalBackdrop');
    this.body = document.getElementById('modalBody');
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        if (e.target === this.el) this.close();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.el.classList.contains('open')) this.close();
      });
    }
  },
  open(html, isWide = false) {
    if (!this.el) this.init();
    if (!this.el) return;
    if (!this.el.classList.contains('open')) this.previousFocus = document.activeElement;
    this.body.className = `modal ${isWide ? 'modal-wide' : ''}`;
    this.body.setAttribute('role', 'dialog');
    this.body.setAttribute('aria-modal', 'true');
    this.body.innerHTML = `
      <button class="modal-close" aria-label="Close modal" title="Close"><i class="fa-solid fa-xmark"></i></button>
      ${html}
    `;
    this.body.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.el.classList.add('open');
    this.body.querySelector('.modal-close').focus();
  },
  close() {
    if (this.el) {
      this.el.classList.remove('open');
      this.body.innerHTML = '';
      if (this.previousFocus && this.previousFocus.isConnected) this.previousFocus.focus();
      this.previousFocus = null;
    }
  },
};

function showToast(message, type = 'success') {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-relevant', 'additions text');
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5000);
}

function setButtonLoading(button, isLoading, label = 'Saving') {
  if (isLoading) {
    if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${label}`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleHtml) {
      button.innerHTML = button.dataset.idleHtml;
      delete button.dataset.idleHtml;
    }
  }
}

function escapeDashboardHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// ---------- Event status calculation ----------
// Status is derived from approvalStatus and date/time in JavaScript.
// Approval workflow: teacher-created events start as "pending" (amber, waiting
// for admin approval); admin-created events are "approved" (blue) automatically.
// Pending events stay amber even after their date passes. Done (green) takes
// priority: an approved event whose date has passed becomes green.
function computeEventStatus(event) {
  // Determine approval status. Existing events without approvalStatus:
  // publicationStatus === 'published' means already approved (backward compat).
  // Note: Mongoose applies schema defaults (approvalStatus: 'pending') when
  // hydrating documents, so we cannot rely on approvalStatus === undefined.
  const isApproved =
    event.approvalStatus === 'approved' ||
    event.publicationStatus === 'published';
  if (!isApproved) return 'pending'; // amber — waiting for approval, always

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(event.date);
  eventDate.setHours(0, 0, 0, 0);
  if (eventDate < today) return 'done'; // green — approved but date has passed
  return 'approved'; // blue — approved and upcoming
}

function statusClass(status) {
  return `status-${status}`;
}

function statusLabel(status) {
  const labels = { done: 'Done', approved: 'Approved', pending: 'Pending' };
  return labels[status] || status;
}

// Google Calendar sync state; only admins receive event.googleCalendar from the API.
const GOOGLE_SYNC_LABELS = {
  synced: ['approved', 'In Google Calendar'],
  pending: ['pending', 'Syncing…'],
  failed: ['sync-failed', 'Google sync failed'],
  'not-synced': ['sync-off', 'Not in Google Calendar'],
};

function googleSyncBadge(event) {
  const sync = event.googleCalendar;
  const shouldSync = event.publicationStatus === 'published' && event.approvalStatus === 'approved';
  if (!sync || (!shouldSync && !sync.eventId)) return '';
  const [className, label] = GOOGLE_SYNC_LABELS[sync.status] || GOOGLE_SYNC_LABELS['not-synced'];
  return `<span class="badge ${className}" title="${escapeDashboardHtml(sync.error || label)}"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> ${label}</span>`;
}

function renderEventStatusList(events, container) {
  if (!container) return;
  const recent = (events || []).slice().sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 6);
  container.innerHTML = recent.length ? recent.map((event) => {
    const status = event.publicationStatus || 'published';
    const statusLabels = { draft: 'Draft', pending: 'Pending approval', rejected: 'Rejected', published: 'Published' };
    const evStatus = computeEventStatus(event);
    const sync = googleSyncBadge(event);
    return `<div class="event-status-row list-row"><div><strong>${escapeDashboardHtml(event.title)}</strong><p>${fmtDate(event.date)}${event.time ? ` · ${escapeDashboardHtml(event.time)}` : ''}${event.venue ? ` · ${escapeDashboardHtml(event.venue)}` : ''}</p></div><span class="badge status-badge-${status}">${statusLabels[status] || 'Published'}</span><span class="status-badge ${evStatus}">${statusLabel(evStatus)}</span>${sync}</div>`;
  }).join('') : '<div class="notification-empty">No events scheduled yet.</div>';
}

// ==========================================================================
// MAP VENUE PICKER (Leaflet + OpenStreetMap; no API key or billing needed)
// ==========================================================================
// Initial viewport when no venue is pinned yet (the Philippines); no marker is placed.
const DEFAULT_VENUE_MAP_VIEW = { center: [12.8797, 121.774], zoom: 5 };
const LEAFLET_BASE_URL = 'https://unpkg.com/leaflet@1.9.4/dist';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
let leafletLoader = null;
let nominatimQueue = Promise.resolve();
let lastNominatimRequest = 0;

function validEventLocation(location) {
  if (!location || typeof location !== 'object') return null;
  if (location.lat === null || location.lat === undefined || location.lat === '') return null;
  if (location.lng === null || location.lng === undefined || location.lng === '') return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { address: String(location.address || '').trim(), lat, lng, placeId: String(location.placeId || '').trim() };
}

function eventMapsUrl(ev) {
  const location = validEventLocation(ev && ev.location);
  if (location) {
    const params = new URLSearchParams({ api: '1', query: `${location.lat},${location.lng}` });
    if (location.placeId) params.set('query_place_id', location.placeId);
    return `https://www.google.com/maps/search/?${params}`;
  }
  const venue = String((ev && ev.venue) || '').trim();
  return venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}` : '';
}

function eventDirectionsUrl(ev) {
  const location = validEventLocation(ev && ev.location);
  const params = new URLSearchParams({ api: '1', destination: location ? `${location.lat},${location.lng}` : String(ev.venue || '').trim() });
  if (location && location.placeId) params.set('destination_place_id', location.placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}

function loadLeaflet() {
  if (window.L && typeof window.L.map === 'function') return Promise.resolve(window.L);
  if (!leafletLoader) {
    leafletLoader = new Promise((resolve, reject) => {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = `${LEAFLET_BASE_URL}/leaflet.css`;
      stylesheet.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      stylesheet.crossOrigin = '';
      document.head.appendChild(stylesheet);
      const script = document.createElement('script');
      script.src = `${LEAFLET_BASE_URL}/leaflet.js`;
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = () => (window.L ? resolve(window.L) : reject(new Error('The map could not be started.')));
      script.onerror = () => reject(new Error('The map could not be loaded. Check your internet connection and try again. You can still type the venue manually.'));
      document.head.appendChild(script);
    });
    leafletLoader.catch(() => { leafletLoader = null; });
  }
  return leafletLoader;
}

// OpenStreetMap's Nominatim service allows at most one request per second, so requests are queued.
function nominatimRequest(path, params) {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatimRequest + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimRequest = Date.now();
    const query = new URLSearchParams({ format: 'jsonv2', 'accept-language': navigator.language || 'en', ...params });
    const response = await fetch(`${NOMINATIM_URL}/${path}?${query}`);
    if (!response.ok) throw new Error(`Location service error (${response.status})`);
    return response.json();
  });
  nominatimQueue = run.catch(() => {});
  return run;
}

// Adds a "Select on Map" picker under a venue input. Only a confirmed pin is returned by getLocation().
function createVenuePicker({ root, venueInput, initialLocation = null }) {
  const state = {
    confirmed: validEventLocation(initialLocation),
    confirmedName: venueInput.value.trim(),
    pending: null,
    lookupId: 0,
    searchId: 0,
    results: [],
    map: null,
    marker: null,
    leaflet: null,
  };
  root.innerHTML = `
    <div class="venue-selected" data-venue-selected hidden></div>
    <button type="button" class="btn btn-ghost btn-block venue-map-toggle" data-venue-open></button>
    <div class="venue-picker" data-venue-panel hidden>
      <div class="venue-picker-search">
        <input type="search" data-venue-query maxlength="200" placeholder="Search for a school, building or street" aria-label="Search for a place" />
        <button type="button" class="btn btn-secondary" data-venue-search><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Search</button>
      </div>
      <ul class="venue-picker-results" data-venue-results hidden></ul>
      <div class="venue-picker-map" data-venue-map role="region" aria-label="Map for choosing the event venue"></div>
      <div class="field-hint">Search for a place, click the map, or drag the pin to the exact spot. Click the map before using the mouse wheel to zoom, or use the + and − buttons.</div>
      <div class="venue-picker-status" data-venue-status aria-live="polite"></div>
      <div class="venue-picker-actions">
        <button type="button" class="btn btn-ghost" data-venue-cancel>Cancel</button>
        <button type="button" class="btn btn-primary" data-venue-confirm disabled><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Use This Location</button>
      </div>
    </div>`;
  const selected = root.querySelector('[data-venue-selected]');
  const openButton = root.querySelector('[data-venue-open]');
  const panel = root.querySelector('[data-venue-panel]');
  const queryInput = root.querySelector('[data-venue-query]');
  const searchButton = root.querySelector('[data-venue-search]');
  const resultsList = root.querySelector('[data-venue-results]');
  const mapNode = root.querySelector('[data-venue-map]');
  const statusNode = root.querySelector('[data-venue-status]');
  const confirmButton = root.querySelector('[data-venue-confirm]');
  const formatCoords = ({ lat, lng }) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const placeName = (result) => String(result.name || String(result.display_name || '').split(',')[0] || '').trim();

  const setStatus = (message, type = '') => {
    statusNode.textContent = message;
    statusNode.className = `venue-picker-status${type ? ` ${type}` : ''}`;
  };
  const describePending = () => {
    const pending = state.pending;
    if (pending) setStatus(`Pinned: ${pending.name || pending.address || 'Selected point'} (${formatCoords(pending)})`);
  };
  const hideResults = () => {
    state.results = [];
    resultsList.hidden = true;
    resultsList.innerHTML = '';
  };

  function renderSelected() {
    const location = state.confirmed;
    openButton.innerHTML = `<i class="fa-regular fa-map" aria-hidden="true"></i> ${location ? 'Change location on map' : 'Select on Map'}`;
    selected.hidden = !location;
    if (!location) {
      selected.innerHTML = '';
      return;
    }
    const name = state.confirmedName || location.address || 'Pinned location';
    selected.innerHTML = `
      <div class="venue-selected-label">Selected venue</div>
      <div class="venue-selected-body">
        <i class="fa-solid fa-location-dot venue-selected-icon" aria-hidden="true"></i>
        <div class="venue-selected-text">
          <strong>${escapeDashboardHtml(name)}</strong>
          ${location.address && location.address !== name ? `<span>${escapeDashboardHtml(location.address)}</span>` : ''}
          <small>${formatCoords(location)}</small>
        </div>
        <i class="fa-regular fa-circle-check venue-selected-check" aria-hidden="true"></i>
      </div>
      <div class="venue-selected-links">
        <a href="${escapeDashboardHtml(eventMapsUrl({ location }))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> View on Google Maps</a>
        <button type="button" class="venue-selected-clear" data-venue-clear>Remove pin</button>
      </div>`;
    selected.querySelector('[data-venue-clear]').addEventListener('click', () => {
      state.confirmed = null;
      state.confirmedName = '';
      renderSelected();
    });
  }

  function setMarker(position) {
    if (!position) {
      if (state.marker) state.marker.remove();
      state.marker = null;
      return;
    }
    if (state.marker) {
      state.marker.setLatLng([position.lat, position.lng]);
      return;
    }
    state.marker = state.leaflet.marker([position.lat, position.lng], { draggable: true, title: 'Event venue' }).addTo(state.map);
    state.marker.on('dragend', () => {
      const latLng = state.marker.getLatLng().wrap();
      pinAt({ lat: latLng.lat, lng: latLng.lng }, { keepName: true });
    });
  }

  function resetPending() {
    state.lookupId += 1;
    state.searchId += 1;
    state.pending = null;
    confirmButton.disabled = true;
    hideResults();
    if (!state.map) return;
    setMarker(state.confirmed);
    if (state.confirmed) state.map.setView([state.confirmed.lat, state.confirmed.lng], 17);
  }

  async function pinAt(position, { keepName = false } = {}) {
    const lookupId = ++state.lookupId;
    const previousName = keepName && state.pending ? state.pending.name : '';
    state.pending = { ...position, name: previousName, address: '', placeId: '' };
    setMarker(position);
    hideResults();
    confirmButton.disabled = false;
    setStatus(`Looking up address for ${formatCoords(position)}…`);
    try {
      const result = await nominatimRequest('reverse', { lat: String(position.lat), lon: String(position.lng), zoom: '18' });
      if (lookupId !== state.lookupId) return;
      if (result && !result.error) {
        state.pending.address = result.display_name || '';
        if (!state.pending.name) state.pending.name = result.name || '';
      }
      describePending();
    } catch (err) {
      if (lookupId !== state.lookupId) return;
      setStatus(`Address lookup is unavailable, but the pinned coordinates (${formatCoords(position)}) can still be used.`, 'warning');
    }
  }

  function chooseResult(result) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    const location = validEventLocation({ lat, lng });
    if (!location) {
      setStatus('That place has no map location. Try another result or click the map.', 'error');
      return;
    }
    state.lookupId += 1;
    state.pending = { lat, lng, name: placeName(result), address: result.display_name || '', placeId: '' };
    setMarker(state.pending);
    state.map.setView([lat, lng], 17);
    hideResults();
    confirmButton.disabled = false;
    describePending();
  }

  async function runSearch() {
    const query = queryInput.value.trim();
    if (query.length < 3) {
      setStatus('Type at least 3 characters to search.', 'warning');
      return;
    }
    const searchId = ++state.searchId;
    searchButton.disabled = true;
    setStatus('Searching…');
    try {
      const params = { q: query, limit: '6' };
      if (state.map.getZoom() >= 9) {
        const bounds = state.map.getBounds();
        params.viewbox = [bounds.getWest(), bounds.getNorth(), bounds.getEast(), bounds.getSouth()].join(',');
      }
      const results = await nominatimRequest('search', params);
      if (searchId !== state.searchId) return;
      state.results = Array.isArray(results) ? results : [];
      if (!state.results.length) {
        hideResults();
        setStatus('No places found. Try a different search or click the map to pin the venue.', 'warning');
        return;
      }
      resultsList.innerHTML = state.results.map((result, index) => `
        <li><button type="button" data-result-index="${index}">
          <strong>${escapeDashboardHtml(placeName(result) || 'Unnamed place')}</strong>
          <span>${escapeDashboardHtml(result.display_name || '')}</span>
        </button></li>`).join('');
      resultsList.hidden = false;
      setStatus(`${state.results.length} place${state.results.length === 1 ? '' : 's'} found. Choose one below.`);
    } catch (err) {
      if (searchId === state.searchId) setStatus('Place search is unavailable right now. You can still click the map to pin the venue.', 'warning');
    } finally {
      if (searchId === state.searchId) searchButton.disabled = false;
    }
  }

  async function ensureMap() {
    if (state.map) return;
    const L = await loadLeaflet();
    state.leaflet = L;
    const start = state.confirmed;
    state.map = L.map(mapNode, {
      center: start ? [start.lat, start.lng] : DEFAULT_VENUE_MAP_VIEW.center,
      zoom: start ? 17 : DEFAULT_VENUE_MAP_VIEW.zoom,
      worldCopyJump: true,
      // Let the wheel and one-finger swipes scroll the form; the map zooms by wheel only after a click.
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
    });
    state.map.on('click focus', () => state.map.scrollWheelZoom.enable());
    state.map.on('mouseout blur', () => state.map.scrollWheelZoom.disable());
    let tileWarningShown = false;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).on('tileerror', () => {
      if (tileWarningShown) return;
      tileWarningShown = true;
      setStatus('Some map tiles failed to load. Check your internet connection.', 'warning');
    }).addTo(state.map);
    state.map.on('click', (event) => {
      const latLng = event.latlng.wrap();
      pinAt({ lat: latLng.lat, lng: latLng.lng });
    });
    if (start) setMarker(start);
  }

  openButton.addEventListener('click', async () => {
    panel.hidden = false;
    openButton.hidden = true;
    setStatus('Loading map…');
    try {
      await ensureMap();
      state.map.invalidateSize();
      resetPending();
      setStatus(state.confirmed ? 'Showing the saved location. Search, click, or drag the pin to change it.' : 'Search for the venue or click the map to drop a pin.');
      queryInput.focus();
    } catch (err) {
      setStatus(err.message || 'The map could not be loaded.', 'error');
    }
  });

  searchButton.addEventListener('click', () => {
    if (state.map) runSearch();
  });
  // Enter would otherwise submit the surrounding event form.
  queryInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (state.map) runSearch();
  });
  resultsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-index]');
    const result = button && state.results[Number(button.dataset.resultIndex)];
    if (result) chooseResult(result);
  });

  root.querySelector('[data-venue-cancel]').addEventListener('click', () => {
    resetPending();
    setStatus('');
    panel.hidden = true;
    openButton.hidden = false;
    openButton.focus();
  });

  confirmButton.addEventListener('click', () => {
    const pending = state.pending;
    const location = validEventLocation(pending);
    if (!location) {
      setStatus('Pin a location on the map first.', 'error');
      return;
    }
    state.lookupId += 1;
    state.confirmed = location;
    state.confirmedName = (pending.name || pending.address || formatCoords(location)).slice(0, 160);
    venueInput.value = state.confirmedName;
    venueInput.dispatchEvent(new Event('input', { bubbles: true }));
    state.pending = null;
    confirmButton.disabled = true;
    setStatus('');
    panel.hidden = true;
    openButton.hidden = false;
    renderSelected();
    openButton.focus();
  });

  renderSelected();
  return { getLocation: () => (state.confirmed ? { ...state.confirmed } : null) };
}

function openEventComposer({ classes = [], onSave, onComplete, approvalRequired = false }) {
  const dateToday = new Date();
  const todayValue = `${dateToday.getFullYear()}-${String(dateToday.getMonth() + 1).padStart(2, '0')}-${String(dateToday.getDate()).padStart(2, '0')}`;
  const renderForm = (values = {}, error = '') => {
    const selectedClasses = Array.isArray(values.targetClasses) ? values.targetClasses : [];
    Modal.open(`
      <h3>Event Details</h3>
      ${error ? `<div class="form-msg error" role="alert">${escapeDashboardHtml(error)}</div>` : ''}
      <form id="eventComposerForm" novalidate>
        <section class="event-composer-section">
          <h4>Event Details</h4>
          <div class="field" data-event-field="title"><label for="composerTitle">Title <span class="required-mark" aria-hidden="true">*</span></label><input id="composerTitle" maxlength="120" value="${escapeDashboardHtml(values.title || '')}" placeholder="e.g. Family Reading Morning" required aria-describedby="composerTitleError" /><small class="field-error" id="composerTitleError" data-event-error="title"></small></div>
          <div class="field" data-event-field="description"><label for="composerDescription">Description <span class="required-mark" aria-hidden="true">*</span></label><textarea id="composerDescription" rows="3" maxlength="3000" placeholder="Share what families should know" required aria-describedby="composerDescriptionError">${escapeDashboardHtml(values.description || '')}</textarea><small class="field-error" id="composerDescriptionError" data-event-error="description"></small></div>
        </section>
        <section class="event-composer-section">
          <h4>Schedule</h4>
          <div class="grid-2">
            <div class="field" data-event-field="date"><label for="composerDate">Date <span class="required-mark" aria-hidden="true">*</span></label><input type="date" id="composerDate" min="${todayValue}" value="${escapeDashboardHtml(values.date || '')}" required aria-describedby="composerDateError" /><small class="field-error" id="composerDateError" data-event-error="date"></small></div>
            <div class="field" data-event-field="time"><label for="composerTime">Time <span class="required-mark" aria-hidden="true">*</span></label><input type="time" id="composerTime" value="${escapeDashboardHtml(values.time || '')}" required aria-describedby="composerTimeError" /><small class="field-error" id="composerTimeError" data-event-error="time"></small></div>
          </div>
        </section>
        <section class="event-composer-section">
          <h4>Location</h4>
          <div class="field" data-event-field="venue"><label for="composerVenue">Venue <span class="required-mark" aria-hidden="true">*</span></label><input id="composerVenue" maxlength="160" value="${escapeDashboardHtml(values.venue || '')}" placeholder="e.g. School garden" required aria-describedby="composerVenueError" /><small class="field-error" id="composerVenueError" data-event-error="venue"></small></div>
          <div class="field" id="composerVenueMap"></div>
        </section>
        <section class="event-composer-section">
          <h4>Recipients</h4>
          <div class="field"><label for="composerTarget">Target group</label><select id="composerTarget"><option value="all" ${values.targetType !== 'classes' ? 'selected' : ''}>All recipients</option><option value="classes" ${values.targetType === 'classes' ? 'selected' : ''}>Selected classes</option></select></div>
          <div class="field" data-event-field="classes" id="composerClassesField" ${values.targetType === 'classes' ? '' : 'hidden'}><label for="composerClasses">Classes <span class="required-mark" aria-hidden="true">*</span></label><select id="composerClasses" multiple size="${Math.max(2, Math.min(classes.length, 5))}" aria-describedby="composerClassesError">${classes.map((name) => `<option value="${escapeDashboardHtml(name)}" ${selectedClasses.includes(name) ? 'selected' : ''}>${escapeDashboardHtml(name)}</option>`).join('')}</select><small class="field-error" id="composerClassesError" data-event-error="classes"></small></div>
          <div class="field"><label for="composerAudience">Notify</label><select id="composerAudience"><option value="all" ${(values.audience || 'all') === 'all' ? 'selected' : ''}>Parents and teachers</option><option value="parents" ${values.audience === 'parents' ? 'selected' : ''}>Parents only</option><option value="teachers" ${values.audience === 'teachers' ? 'selected' : ''}>Teachers only</option></select></div>
          <div class="field"><label for="composerStatus">Publication</label><select id="composerStatus">${approvalRequired ? `<option value="pending" ${values.publicationStatus !== 'draft' ? 'selected' : ''}>Submit for admin approval</option>` : `<option value="published" ${values.publicationStatus !== 'draft' ? 'selected' : ''}>Publish now</option>`}<option value="draft" ${values.publicationStatus === 'draft' ? 'selected' : ''}>Save as draft</option></select>${approvalRequired ? '<div class="field-hint">Selected recipients will be notified after admin approval.</div>' : ''}</div>
        </section>
        <div class="form-msg" id="composerError" role="alert"></div>
        <div class="event-form-actions"><button type="submit" class="btn btn-primary"><i class="fa-solid fa-calendar-check"></i> Continue</button></div>
      </form>
    `, true);

    const form = document.getElementById('eventComposerForm');
    const target = document.getElementById('composerTarget');
    const venuePicker = createVenuePicker({
      root: document.getElementById('composerVenueMap'),
      venueInput: document.getElementById('composerVenue'),
      initialLocation: values.location,
    });
    target.addEventListener('change', () => {
      document.getElementById('composerClassesField').hidden = target.value !== 'classes';
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = {
        title: document.getElementById('composerTitle').value.trim(),
        description: document.getElementById('composerDescription').value.trim(),
        date: document.getElementById('composerDate').value,
        time: document.getElementById('composerTime').value,
        venue: document.getElementById('composerVenue').value.trim(),
        location: venuePicker.getLocation(),
        targetType: target.value,
        targetClasses: Array.from(document.getElementById('composerClasses').selectedOptions, (option) => option.value),
        audience: document.getElementById('composerAudience').value,
        publicationStatus: document.getElementById('composerStatus').value,
      };
      const errors = {
        title: data.title ? '' : 'Title is required.',
        description: data.description ? '' : 'Description is required.',
        date: !data.date ? 'Date is required.' : (data.date < todayValue ? "Date can't be in the past." : ''),
        time: data.time ? '' : 'Time is required.',
        venue: data.venue ? '' : 'Venue is required.',
        classes: data.targetType === 'classes' && !data.targetClasses.length ? 'Choose at least one class.' : '',
      };
      Object.entries(errors).forEach(([field, message]) => {
        const errorNode = form.querySelector(`[data-event-error="${field}"]`);
        if (errorNode) errorNode.textContent = message;
        const fieldNode = form.querySelector(`[data-event-field="${field}"]`);
        if (fieldNode) fieldNode.classList.toggle('has-error', Boolean(message));
      });
      const invalid = Object.values(errors).some(Boolean);
      if (invalid) {
        const firstInvalid = form.querySelector('.has-error input, .has-error textarea, .has-error select');
        firstInvalid?.focus();
        return;
      }
      renderConfirmation(data);
    });
  };

  const renderConfirmation = (data) => {
    const date = new Date(`${data.date}T00:00:00`).toLocaleDateString();
    const audienceLabels = { all: 'Parents and teachers', parents: 'Parents only', teachers: 'Teachers only' };
    const recipients = `${audienceLabels[data.audience] || 'Parents and teachers'}${data.targetType === 'classes' ? ` · Classes: ${data.targetClasses.join(', ')}` : ''}`;
    Modal.open(`
      <h3>Confirm Event</h3>
      <p>Review the details and recipients before publishing.</p>
      <dl class="event-summary-list">
        <dt><strong>Title</strong></dt><dd>${escapeDashboardHtml(data.title)}</dd>
        <dt><strong>Description</strong></dt><dd>${escapeDashboardHtml(data.description)}</dd>
        <dt><strong>Schedule</strong></dt><dd>${escapeDashboardHtml(date)} at ${escapeDashboardHtml(data.time)}</dd>
        <dt><strong>Location</strong></dt><dd>${escapeDashboardHtml(data.venue)}${data.location ? `${data.location.address && data.location.address !== data.venue ? `<br><small>${escapeDashboardHtml(data.location.address)}</small>` : ''}<br><a href="${escapeDashboardHtml(eventMapsUrl(data))}" target="_blank" rel="noopener noreferrer">View on Google Maps</a>` : ''}</dd>
        <dt><strong>Recipients</strong></dt><dd>${escapeDashboardHtml(recipients)}</dd>
        <dt><strong>Status</strong></dt><dd>${data.publicationStatus === 'draft' ? 'Draft' : (data.publicationStatus === 'pending' ? 'Submit for admin approval' : 'Published')}</dd>
      </dl>
      <div id="eventConfirmError" class="form-msg" role="alert"></div>
      <div class="event-form-actions"><button type="button" class="btn btn-ghost" id="eventConfirmCancel">Cancel</button><button type="button" class="btn btn-primary" id="eventConfirmPublish">${data.publicationStatus === 'draft' ? 'Confirm and Save Draft' : (data.publicationStatus === 'pending' ? 'Submit for Approval' : 'Confirm and Publish')}</button></div>
    `, true);
    document.getElementById('eventConfirmCancel').addEventListener('click', () => renderForm(data));
    document.getElementById('eventConfirmPublish').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setButtonLoading(button, true, data.publicationStatus === 'draft' ? 'Saving' : (data.publicationStatus === 'pending' ? 'Submitting' : 'Publishing'));
      let response;
      try {
        response = await onSave(data);
      } catch (error) {
        const errorNode = document.getElementById('eventConfirmError');
        errorNode.textContent = error.message || 'Could not save the event.';
        errorNode.className = 'form-msg error';
        setButtonLoading(button, false);
        return;
      }
      Modal.close();
      showToast(data.publicationStatus === 'draft'
        ? 'Event draft saved.'
        : (data.publicationStatus === 'pending'
          ? 'Event submitted for admin approval. Selected recipients will be notified after approval.'
          : `Event published. ${response.event?.emailRecipientCount || 0} recipient accounts notified.`));
      if (onComplete) {
        try {
          await onComplete(response);
        } catch (error) {
          showToast(error.message || 'Event saved, but its status could not refresh.', 'error');
        }
      }
    });
  };

  renderForm();
}


function createEmergencyAudiencePicker({ containerId, students = [], wholeDescription }) {
  const root = document.getElementById(containerId);
  const activeStudents = students.filter((student) => student.status === 'active');
  const classes = [...new Set(activeStudents.map((student) => String(student.className || '').trim()).filter(Boolean))].sort();
  const state = { mode: 'school', selectedClasses: new Set(), selectedStudents: new Set(), query: '' };

  function selectedPupils() {
    if (state.mode === 'school') return activeStudents;
    if (state.mode === 'class') return activeStudents.filter((student) => state.selectedClasses.has(String(student.className || '').trim()));
    return activeStudents.filter((student) => state.selectedStudents.has(String(student._id)));
  }

  function selectionStats() {
    const pupils = selectedPupils();
    const classNames = state.mode === 'class'
      ? [...state.selectedClasses]
      : [...new Set(pupils.map((student) => String(student.className || '').trim()).filter(Boolean))];
    const parents = new Map();
    pupils.forEach((student) => {
      const parent = student.parent;
      if (!parent) return;
      const id = String(parent._id || parent);
      if (!parents.has(id)) parents.set(id, parent);
    });
    const eligibleParents = [...parents.values()].filter((parent) => parent && typeof parent === 'object'
      && parent.status === 'approved' && parent.email && parent.emailVerified && parent.emailVerifiedBy).length;
    return { pupils, classNames, linkedParents: parents.size, eligibleParents };
  }

  function render() {
    if (!root) return;
    const stats = selectionStats();
    const selectedChips = state.mode === 'school'
      ? `<span class="audience-chip">${escapeDashboardHtml(wholeDescription || 'Whole school')}<button type="button" data-remove-school aria-label="Clear whole school selection"><i class="fa-solid fa-xmark"></i></button></span>`
      : state.mode === 'class'
        ? [...state.selectedClasses].map((className) => `<span class="audience-chip">${escapeDashboardHtml(className)}<button type="button" data-remove-class="${escapeDashboardHtml(className)}" aria-label="Remove ${escapeDashboardHtml(className)}"><i class="fa-solid fa-xmark"></i></button></span>`).join('')
        : [...state.selectedStudents].map((studentId) => {
          const student = activeStudents.find((item) => String(item._id) === studentId);
          return student ? `<span class="audience-chip">${escapeDashboardHtml(student.name)}<button type="button" data-remove-student="${escapeDashboardHtml(studentId)}" aria-label="Remove ${escapeDashboardHtml(student.name)}"><i class="fa-solid fa-xmark"></i></button></span>` : '';
        }).join('');
    const classCards = classes.map((className) => {
      const count = activeStudents.filter((student) => String(student.className || '').trim() === className).length;
      return `<label class="audience-class-card"><input type="checkbox" data-audience-class="${escapeDashboardHtml(className)}" ${state.selectedClasses.has(className) ? 'checked' : ''}><span><strong>${escapeDashboardHtml(className)}</strong><small>${count} pupil${count === 1 ? '' : 's'}</small></span></label>`;
    }).join('');
    const groupedClasses = classes.map((className) => {
      const pupils = activeStudents.filter((student) => String(student.className || '').trim() === className
        && `${student.name} ${className}`.toLowerCase().includes(state.query));
      if (!pupils.length) return '';
      return `<section class="audience-pupil-group"><div class="audience-pupil-group-heading"><strong>${escapeDashboardHtml(className)}</strong><button type="button" class="btn btn-ghost btn-sm" data-select-class="${escapeDashboardHtml(className)}">Select all in class</button></div><div class="audience-pupil-list">${pupils.map((student) => `<label class="audience-pupil-option"><input type="checkbox" data-audience-student="${escapeDashboardHtml(student._id)}" ${state.selectedStudents.has(String(student._id)) ? 'checked' : ''}><span>${escapeDashboardHtml(student.name)}</span></label>`).join('')}</div></section>`;
    }).join('');

    root.innerHTML = `
      <div class="record-category-tabs audience-mode-tabs" role="tablist" aria-label="Emergency alert audience">
        ${[['school', 'Whole School'], ['class', 'By Class'], ['pupil', 'By Pupil']].map(([mode, label]) => `<button type="button" class="record-category-tab ${state.mode === mode ? 'active' : ''}" role="tab" aria-selected="${state.mode === mode}" data-audience-mode="${mode}">${label}</button>`).join('')}
      </div>
      ${state.mode === 'school' ? `<div class="audience-school-note"><i class="fa-solid fa-school" aria-hidden="true"></i><span>${escapeDashboardHtml(wholeDescription || 'All active pupils in the school')}</span></div>` : ''}
      ${state.mode === 'class' ? `<div class="audience-class-grid">${classCards || '<div class="notification-empty">No active classes available.</div>'}</div>` : ''}
      ${state.mode === 'pupil' ? `<div class="field audience-pupil-search"><label for="${containerId}Search">Search pupils</label><input id="${containerId}Search" type="search" value="${escapeDashboardHtml(state.query)}" placeholder="Search by name or class" autocomplete="off"></div><div class="audience-pupil-groups">${groupedClasses || '<div class="notification-empty">No pupils match this search.</div>'}</div>` : ''}
      <div class="audience-selected"><strong>Selected</strong><div class="audience-chips">${selectedChips || '<span class="field-hint">No pupils selected yet.</span>'}</div></div>
      <p class="audience-summary" aria-live="polite">${stats.classNames.length} class${stats.classNames.length === 1 ? '' : 'es'}, ${stats.pupils.length} pupil${stats.pupils.length === 1 ? '' : 's'}, ${stats.eligibleParents} verified parent${stats.eligibleParents === 1 ? '' : 's'} expected to receive email (${stats.linkedParents} linked)</p>
      <small class="field-error" data-audience-error></small>
    `;

    root.querySelectorAll('[data-audience-mode]').forEach((button) => button.addEventListener('click', () => {
      state.mode = button.dataset.audienceMode;
      state.query = '';
      render();
    }));
    root.querySelectorAll('[data-audience-class]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedClasses.add(checkbox.dataset.audienceClass);
      else state.selectedClasses.delete(checkbox.dataset.audienceClass);
      render();
    }));
    root.querySelectorAll('[data-audience-student]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedStudents.add(String(checkbox.dataset.audienceStudent));
      else state.selectedStudents.delete(String(checkbox.dataset.audienceStudent));
      render();
    }));
    root.querySelectorAll('[data-select-class]').forEach((button) => button.addEventListener('click', () => {
      activeStudents.filter((student) => String(student.className || '').trim() === button.dataset.selectClass)
        .forEach((student) => state.selectedStudents.add(String(student._id)));
      render();
    }));
    root.querySelectorAll('[data-remove-school]').forEach((button) => button.addEventListener('click', () => {
      state.mode = 'pupil';
      state.selectedStudents.clear();
      render();
    }));
    root.querySelectorAll('[data-remove-class]').forEach((button) => button.addEventListener('click', () => {
      state.selectedClasses.delete(button.dataset.removeClass);
      render();
    }));
    root.querySelectorAll('[data-remove-student]').forEach((button) => button.addEventListener('click', () => {
      state.selectedStudents.delete(String(button.dataset.removeStudent));
      render();
    }));
    const search = root.querySelector(`#${containerId}Search`);
    search?.addEventListener('input', (event) => {
      state.query = event.target.value.trim().toLowerCase();
      render();
      const nextSearch = root.querySelector(`#${containerId}Search`);
      nextSearch?.focus();
      nextSearch?.setSelectionRange(state.query.length, state.query.length);
    });
  }

  render();
  return {
    validate() {
      const valid = selectedPupils().length > 0;
      const error = root?.querySelector('[data-audience-error]');
      if (error) error.textContent = valid ? '' : 'Select at least one class or pupil.';
      return valid;
    },
    getSelection() {
      if (state.mode === 'school') return { students: activeStudents.map((student) => String(student._id)), affectedClasses: [] };
      if (state.mode === 'class') return { students: [], affectedClasses: [...state.selectedClasses] };
      return { students: [...state.selectedStudents], affectedClasses: [] };
    },
    getTargetStudents() {
      return selectedPupils();
    },
  };
}
// ==========================================================================
// EVENTS CALENDAR COMPONENT
// ==========================================================================
const CALENDAR_AUDIENCE_FILTERS = [
  { key: 'any', label: 'All events' },
  { key: 'all', label: 'Everyone' },
  { key: 'parents', label: 'Parents' },
  { key: 'teachers', label: 'Teachers' },
];

class EventsCalendar {
  constructor({ containerId, events = [], canManage = false, onDeleteEvent, onEventAdded, onEventUpdated, canEditEvent, canDeleteEvent }) {
    this.container = document.getElementById(containerId);
    this.events = events;
    this.canManage = canManage;
    this.onDeleteEvent = onDeleteEvent;
    this.onEventAdded = onEventAdded;
    this.onEventUpdated = onEventUpdated;
    this.canEditEventFn = canEditEvent;
    this.canDeleteEventFn = canDeleteEvent;
    this.currentDate = new Date();
    this.viewMode = 'calendar'; // 'calendar' or 'schedule'
    this.filter = 'any'; // 'any' or an audience: 'all', 'parents', 'teachers'
    this.selectedDate = this.startOfDay(new Date());
    // Auto-register for periodic status refresh
    if (!window.__eventCalendars) window.__eventCalendars = [];
    window.__eventCalendars.push(this);
    this.render();
  }

  getEventDate(ev) {
    const date = new Date(ev.date);
    if (!date.getUTCHours() && !date.getUTCMinutes() && !date.getUTCSeconds() && !date.getUTCMilliseconds()) {
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    return date;
  }

  setEvents(events) {
    this.events = events;
    this.render();
  }

  // Moving months shows today in the side panel when visible, otherwise the 1st.
  showMonth(offset) {
    this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + offset, 1);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === this.currentDate.getFullYear() && now.getMonth() === this.currentDate.getMonth();
    this.selectedDate = this.startOfDay(isCurrentMonth ? now : this.currentDate);
    this.render();
  }

  nextMonth() {
    this.showMonth(1);
  }

  prevMonth() {
    this.showMonth(-1);
  }

  today() {
    this.currentDate = new Date();
    this.selectedDate = this.startOfDay(new Date());
    this.render();
  }

  setView(mode) {
    this.viewMode = mode;
    this.render();
  }

  canEdit(ev) {
    return this.canManage && (!this.canEditEventFn || this.canEditEventFn(ev));
  }

  canDelete(ev) {
    return this.canManage && (!this.canDeleteEventFn || this.canDeleteEventFn(ev));
  }

  showEventDetails(ev) {
    const canEditEvent = this.canEdit(ev);
    const canDeleteEvent = this.canDelete(ev);
    const escapeValue = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const formattedDate = this.getEventDate(ev).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const audienceLabels = {
      all: 'Everyone (Parents & Teachers)',
      parents: 'Parents only',
      teachers: 'Teachers only',
    };
    const evStatus = computeEventStatus(ev);
    const venue = String(ev.venue || '').trim();
    const location = validEventLocation(ev.location);
    const mapEmbedUrl = location
      ? `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({
        bbox: [location.lng - 0.004, location.lat - 0.003, location.lng + 0.004, location.lat + 0.003].join(','),
        layer: 'mapnik',
        marker: `${location.lat},${location.lng}`,
      })}`
      : `https://www.google.com/maps?q=${encodeURIComponent(venue)}&output=embed`;

    Modal.open(`
      <h3>Event Details</h3>
      <div class="event-detail-item">
        <div class="event-detail-label">Event Title</div>
        <div class="event-detail-val" style="font-weight:700; font-size:17px; color:var(--primary);">${escapeValue(ev.title)}</div>
        <span class="status-badge ${evStatus}">${statusLabel(evStatus)}</span>
      </div>
      <div class="event-detail-item">
        <div class="event-detail-label">Date</div>
        <div class="event-detail-val"><i class="fa-regular fa-calendar" style="margin-right:6px; color:var(--primary);"></i> ${formattedDate}${ev.time ? ` · ${escapeValue(ev.time)}` : ''}</div>
      </div>
      ${venue ? `
        <div class="event-detail-item">
          <div class="event-detail-label">Venue</div>
          <div class="event-detail-val">${escapeValue(venue)}</div>
          ${location && location.address && location.address !== venue ? `<div class="field-hint">${escapeValue(location.address)}</div>` : ''}
          <div class="event-map" aria-label="Map showing ${escapeValue(venue)}">
            <iframe
              src="${escapeValue(mapEmbedUrl)}"
              title="Google Map for ${escapeValue(venue)}"
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
              allowfullscreen></iframe>
          </div>
          <div class="event-map-links">
            <a class="event-map-directions" href="${escapeValue(eventMapsUrl(ev))}" target="_blank" rel="noopener noreferrer">
              <i class="fa-solid fa-map-location-dot" aria-hidden="true"></i> View on Google Maps
            </a>
            <a class="event-map-directions" href="${escapeValue(eventDirectionsUrl(ev))}" target="_blank" rel="noopener noreferrer">
              <i class="fa-solid fa-diamond-turn-right" aria-hidden="true"></i> Get directions
            </a>
          </div>
        </div>
      ` : ''}
      <div class="event-detail-item">
        <div class="event-detail-label">Audience</div>
        <div class="event-detail-val">
          <span class="badge ${ev.audience === 'teachers' ? 'pending' : (ev.audience === 'parents' ? 'partial' : 'approved')}">
            ${escapeValue(audienceLabels[ev.audience] || ev.audience || 'All')}
          </span>
        </div>
      </div>
      ${this.googleCalendarDetailHtml(ev, escapeValue)}
      ${ev.description ? `
        <div class="event-detail-item">
          <div class="event-detail-label">Description</div>
          <div class="event-detail-val" style="background:#F8FAFC; padding:12px; border-radius:8px; border:1px solid #E2E8F0; line-height:1.5;">${escapeValue(ev.description).replace(/\r?\n/g, '<br>')}</div>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid #E2E8F0;">
        <div style="display:flex; gap:8px;">
          ${canEditEvent && this.onEventUpdated ? `
            <button class="btn btn-secondary btn-sm" id="calEditEventBtn">
              <i class="fa-solid fa-pen-to-square"></i> Edit Event
            </button>
          ` : ''}
          ${canDeleteEvent && this.onDeleteEvent ? `
            <button class="btn btn-danger btn-sm" id="calDeleteEventBtn">
              <i class="fa-solid fa-trash-can"></i> Remove Event
            </button>
          ` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" id="calCloseEventBtn">Close</button>
      </div>
    `);

    document.getElementById('calCloseEventBtn').addEventListener('click', () => Modal.close());
    const editBtn = document.getElementById('calEditEventBtn');
    if (editBtn) editBtn.addEventListener('click', () => this.showEditEvent(ev));
    const retrySyncBtn = document.getElementById('calRetrySyncBtn');
    if (retrySyncBtn) {
      retrySyncBtn.addEventListener('click', async () => {
        setButtonLoading(retrySyncBtn, true, 'Syncing');
        try {
          const { googleCalendar } = await api.post(`/calendar/google/events/${ev._id}/sync`, {});
          ev.googleCalendar = googleCalendar;
          showToast(googleCalendar.status === 'synced' ? 'Event synced to Google Calendar.' : (googleCalendar.error || 'Google Calendar sync did not complete.'), googleCalendar.status === 'synced' ? 'success' : 'error');
          this.showEventDetails(ev);
        } catch (err) {
          showToast(err.message, 'error');
          setButtonLoading(retrySyncBtn, false);
        }
      });
    }
    const deleteBtn = document.getElementById('calDeleteEventBtn');
    if (deleteBtn && canDeleteEvent && this.onDeleteEvent) {
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to remove the event "${ev.title}"?`)) {
          Modal.close();
          await this.onDeleteEvent(ev._id);
        }
      });
    }
  }

  googleCalendarDetailHtml(ev, escapeValue) {
    const sync = ev.googleCalendar;
    const syncBadge = googleSyncBadge(ev);
    const addLink = ev.addToGoogleCalendarUrl && !(sync && sync.htmlLink && sync.status === 'synced')
      ? `<a class="event-map-directions" href="${escapeValue(ev.addToGoogleCalendarUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Add to my Google Calendar</a>`
      : '';
    if (!syncBadge && !addLink) return '';
    return `
      <div class="event-detail-item">
        <div class="event-detail-label">Google Calendar</div>
        ${syncBadge ? `<div class="event-detail-val">${syncBadge}</div>` : ''}
        ${sync && sync.status === 'failed' && sync.error ? `<div class="form-msg error" role="alert">${escapeValue(sync.error)}</div>` : ''}
        ${sync && sync.lastSyncedAt && sync.status === 'synced' ? `<div class="field-hint">Last synced ${escapeValue(new Date(sync.lastSyncedAt).toLocaleString())}</div>` : ''}
        <div class="event-map-links">
          ${sync && sync.htmlLink && sync.status === 'synced' ? `<a class="event-map-directions" href="${escapeValue(sync.htmlLink)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Open in Google Calendar</a>` : ''}
          ${addLink}
          ${syncBadge && sync.status !== 'synced' ? '<button type="button" class="btn btn-ghost btn-sm" id="calRetrySyncBtn"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Retry sync</button>' : ''}
        </div>
      </div>`;
  }

  showEditEvent(ev) {
    const escapeValue = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const date = this.getEventDate(ev);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    Modal.open(`
      <h3>Edit School Event</h3>
      <div id="editEventMsg" class="form-msg"></div>
      <form id="editEventForm">
        <div class="field"><label>Event Title</label><input id="editEventTitle" value="${escapeValue(ev.title)}" required /></div>
        <div class="field"><label>Event Date</label><input type="date" id="editEventDate" value="${dateValue}" required /></div>
        <div class="grid-2">
          <div class="field"><label for="editEventTime">Time</label><input type="time" id="editEventTime" value="${escapeValue(ev.time || '09:00')}" required /></div>
          <div class="field"><label for="editEventVenue">Venue</label><input id="editEventVenue" value="${escapeValue(ev.venue || '')}" required /></div>
        </div>
        <div class="field" id="editEventVenueMap"></div>
        <div class="field"><label>Target Audience</label>
          <select id="editEventAudience">
            <option value="all" ${ev.audience === 'all' ? 'selected' : ''}>Everyone (Parents &amp; Staff)</option>
            <option value="parents" ${ev.audience === 'parents' ? 'selected' : ''}>Parents only</option>
            <option value="teachers" ${ev.audience === 'teachers' ? 'selected' : ''}>Teachers only</option>
          </select>
        </div>
        <div class="field"><label>Description / Details</label><textarea id="editEventDescription" rows="3">${escapeValue(ev.description || '')}</textarea></div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Save Changes</button>
      </form>
    `);
    const venuePicker = createVenuePicker({
      root: document.getElementById('editEventVenueMap'),
      venueInput: document.getElementById('editEventVenue'),
      initialLocation: ev.location,
    });
    document.getElementById('editEventForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('editEventMsg');
      try {
        await this.onEventUpdated(ev._id, {
          title: document.getElementById('editEventTitle').value.trim(),
          date: document.getElementById('editEventDate').value,
          time: document.getElementById('editEventTime').value,
          venue: document.getElementById('editEventVenue').value.trim(),
          location: venuePicker.getLocation(),
          audience: document.getElementById('editEventAudience').value,
          description: document.getElementById('editEventDescription').value.trim(),
        });
        Modal.close();
      } catch (err) {
        showMsg(msg, err.message);
      }
    });
  }

  startOfDay(date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  setFilter(filter) {
    this.filter = filter;
    this.render();
  }

  selectDay(date) {
    this.selectedDate = this.startOfDay(date);
    if (date.getMonth() !== this.currentDate.getMonth() || date.getFullYear() !== this.currentDate.getFullYear()) {
      this.currentDate = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    this.render();
    // The side panel sits under the grid on narrow screens; bring it into view.
    if (window.matchMedia && window.matchMedia('(max-width: 1100px)').matches) {
      this.container.querySelector('.cal-agenda')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Chips filter by audience, the only grouping school events have.
  filteredEvents() {
    if (this.filter === 'any') return this.events;
    return this.events.filter((ev) => (ev.audience || 'all') === this.filter);
  }

  formatEventTime(ev) {
    const match = /^(\d{2}):(\d{2})$/.exec(ev.time || '');
    if (!match) return 'All day';
    return new Date(2000, 0, 1, Number(match[1]), Number(match[2])).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  eventState(ev) {
    const status = computeEventStatus(ev);
    if (status === 'pending') return ['pending', 'Pending approval'];
    if (status === 'done') return ['done', 'Done'];
    if (this.isSameDay(this.getEventDate(ev), new Date())) return ['today', 'Happening today'];
    return ['upcoming', 'Upcoming'];
  }

  agendaItemHtml(ev) {
    const audience = CALENDAR_AUDIENCE_FILTERS.find((item) => item.key === (ev.audience || 'all')) || CALENDAR_AUDIENCE_FILTERS[1];
    const [stateClass, stateLabel] = this.eventState(ev);
    return `
      <button type="button" class="cal-agenda-item" data-agenda-event-id="${escapeDashboardHtml(ev._id)}">
        <span class="cal-agenda-time">${this.formatEventTime(ev)}</span>
        <span class="cal-agenda-body">
          <strong>${escapeDashboardHtml(ev.title)}</strong>
          ${ev.venue ? `<span class="cal-agenda-venue">${escapeDashboardHtml(ev.venue)}</span>` : ''}
          <span class="cal-agenda-meta">
            <span class="cal-agenda-audience"><span class="cal-chip-dot audience-${audience.key}" aria-hidden="true"></span>${audience.label}</span>
            <span class="cal-state ${stateClass}">${stateLabel}</span>
          </span>
        </span>
      </button>`;
  }

  agendaHtml(events) {
    const selected = this.selectedDate;
    const isToday = this.isSameDay(selected, new Date());
    const byTime = (a, b) => this.getEventDate(a) - this.getEventDate(b) || String(a.time || '').localeCompare(String(b.time || ''));
    const dayEvents = events.filter((ev) => this.isSameDay(this.getEventDate(ev), selected)).sort(byTime);
    const monthEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
    const laterEvents = events.filter((ev) => {
      const date = this.getEventDate(ev);
      return date > selected && date < monthEnd && !this.isSameDay(date, selected);
    }).sort(byTime);
    const laterGroups = laterEvents.reduce((groups, ev) => {
      const date = this.getEventDate(ev);
      const key = date.toDateString();
      if (!groups.has(key)) groups.set(key, { date, events: [] });
      groups.get(key).events.push(ev);
      return groups;
    }, new Map());
    const monthName = selected.toLocaleDateString(undefined, { month: 'long' });

    return `
      <aside class="cal-agenda" aria-label="Events for the selected day">
        <div class="cal-agenda-head">
          <h3>${isToday ? 'Today' : selected.toLocaleDateString(undefined, { weekday: 'short' })}</h3>
          <span>${selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        ${dayEvents.length ? dayEvents.map((ev) => this.agendaItemHtml(ev)).join('') : '<p class="cal-agenda-empty">Nothing scheduled on this day.</p>'}
        <h4 class="cal-agenda-later">Later in ${monthName}</h4>
        ${laterGroups.size ? [...laterGroups.values()].map(({ date, events: groupEvents }) => `
          <div class="cal-agenda-date">${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          ${groupEvents.map((ev) => this.agendaItemHtml(ev)).join('')}
        `).join('') : `<p class="cal-agenda-empty">No more events in ${monthName}.</p>`}
      </aside>`;
  }

  render() {
    if (!this.container) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthName = this.currentDate.toLocaleDateString(undefined, { month: 'long' });
    const today = new Date();
    const events = this.filteredEvents();

    let html = `
      <div class="cal-topbar">
        <div class="calendar-month-heading">
          <i class="fa-regular fa-calendar-days" style="color:var(--primary);"></i>
          <span>${monthName} ${year}</span>
        </div>
        <div class="cal-topbar-actions">
          <div class="calendar-nav-group">
            <button class="calendar-nav-btn" data-cal-prev title="Previous Month" aria-label="Previous Month">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <button class="btn btn-ghost btn-sm" data-cal-today>Today</button>
            <button class="calendar-nav-btn" data-cal-next title="Next Month" aria-label="Next Month">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
          <div class="cal-view-toggle" role="group" aria-label="Calendar view">
            <button class="btn btn-sm ${this.viewMode === 'calendar' ? 'btn-primary' : 'btn-ghost'}" data-cal-view="calendar" aria-pressed="${this.viewMode === 'calendar'}">
              <i class="fa-solid fa-calendar-days"></i> Calendar
            </button>
            <button class="btn btn-sm ${this.viewMode === 'schedule' ? 'btn-primary' : 'btn-ghost'}" data-cal-view="schedule" aria-pressed="${this.viewMode === 'schedule'}">
              <i class="fa-solid fa-calendar-week"></i> Schedule
            </button>
          </div>
        </div>
      </div>
      <div class="cal-filters" role="group" aria-label="Filter events by audience">
        ${CALENDAR_AUDIENCE_FILTERS.map((item) => `
          <button type="button" class="cal-chip ${this.filter === item.key ? 'active' : ''}" data-cal-filter="${item.key}" aria-pressed="${this.filter === item.key}">
            ${item.key === 'any' ? '' : `<span class="cal-chip-dot audience-${item.key}" aria-hidden="true"></span>`}${item.label}
          </button>`).join('')}
      </div>
    `;

    if (this.viewMode === 'calendar') {
      html += `
        <div class="cal-shell">
          <div class="calendar-card">
            <div class="calendar-days-header">
              ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<div class="calendar-day-header-cell">${day}</div>`).join('')}
            </div>
            <div class="calendar-grid">
      `;

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      // Total calendar cells (either 35 or 42)
      const totalCells = (firstDay + daysInMonth) > 35 ? 42 : 35;

      for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(year, month, i - firstDay + 1);
        const isOtherMonth = cellDate.getMonth() !== month;
        const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
        const matchingEvents = events.filter((ev) => this.isSameDay(this.getEventDate(ev), cellDate));
        const hasEvents = matchingEvents.length > 0;
        const classes = [
          'calendar-cell',
          isOtherMonth ? 'other-month' : '',
          isWeekend ? 'weekend' : '',
          this.isSameDay(cellDate, today) ? 'today' : '',
          this.isSameDay(cellDate, this.selectedDate) ? 'selected' : '',
          hasEvents ? 'has-events' : '',
        ].filter(Boolean).join(' ');

        html += `
          <div class="${classes}" data-cal-date="${cellDate.toISOString()}" role="button" tabindex="0" aria-label="${cellDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${hasEvents ? `, ${matchingEvents.length} event${matchingEvents.length === 1 ? '' : 's'}` : ''}">
            <div class="calendar-cell-top">
              <span class="day-number">${cellDate.getDate()}</span>
            </div>
            <div class="calendar-events-container">
              ${matchingEvents.slice(0, 3).map((ev) => {
                const evStatus = computeEventStatus(ev);
                return `<div class="event-pill audience-${escapeDashboardHtml(ev.audience || 'all')} status-${evStatus}" data-event-id="${escapeDashboardHtml(ev._id)}" title="${escapeDashboardHtml(ev.title)}">${escapeDashboardHtml(ev.title)}</div>`;
              }).join('')}
              ${matchingEvents.length > 3 ? `<div class="calendar-more">+${matchingEvents.length - 3} more</div>` : ''}
            </div>
          </div>
        `;
      }

      html += `
            </div>
            <div class="status-legend">
              <div class="status-legend-item"><div class="status-legend-dot" style="background:var(--status-done);"></div><span>Done</span></div>
              <div class="status-legend-item"><div class="status-legend-dot" style="background:var(--status-ongoing);"></div><span>Approved</span></div>
              <div class="status-legend-item"><div class="status-legend-dot" style="background:var(--status-pending);"></div><span>Pending</span></div>
            </div>
          </div>
          ${this.agendaHtml(events)}
        </div>
      `;
    } else {
      const todayStart = this.startOfDay(today);
      const compareEvents = (a, b) => this.getEventDate(a) - this.getEventDate(b) || String(a.time || '').localeCompare(String(b.time || '')) || a.title.localeCompare(b.title);
      const upcoming = events.filter((ev) => this.getEventDate(ev) >= todayStart).sort(compareEvents);
      const past = events.filter((ev) => this.getEventDate(ev) < todayStart).sort((a, b) => compareEvents(b, a));
      const groups = [...upcoming, ...past].reduce((result, ev) => {
        const date = this.getEventDate(ev);
        const key = date.toDateString();
        if (!result.has(key)) result.set(key, { date, events: [] });
        result.get(key).events.push(ev);
        return result;
      }, new Map());

      html += '<div class="calendar-card"><div class="calendar-schedule">';
      if (groups.size) {
        groups.forEach(({ date, events: dayEvents }) => {
          const isToday = this.isSameDay(date, todayStart);
          const dayLabel = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
          html += `
            <section class="schedule-day ${isToday ? 'today' : ''}">
              <h3 class="schedule-day-heading">${dayLabel}${isToday ? ' · Today' : ''}</h3>
              ${dayEvents.map((ev) => {
                const detail = ev.venue || ev.description;
                const evStatus = computeEventStatus(ev);
                return `
                  <article class="schedule-event status-${evStatus}">
                    <time class="schedule-event-time">${this.formatEventTime(ev)}</time>
                    <div class="schedule-event-info">
                      <span class="status-badge ${evStatus}">${statusLabel(evStatus)}</span>
                      <h4>${escapeDashboardHtml(ev.title)}</h4>
                      ${detail ? `<p>${escapeDashboardHtml(detail)}</p>` : ''}
                    </div>
                    <div class="schedule-event-actions">
                      <button class="btn btn-secondary btn-sm" data-view-event-id="${escapeDashboardHtml(ev._id)}"><i class="fa-solid fa-eye"></i> Details</button>
                      ${this.canDelete(ev) && this.onDeleteEvent ? `<button class="btn btn-ghost btn-sm" data-del-event-id="${escapeDashboardHtml(ev._id)}" aria-label="Remove ${escapeDashboardHtml(ev.title)}" title="Remove event"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    </div>
                  </article>
                `;
              }).join('')}
            </section>
          `;
        });
      } else {
        html += `
          <div class="empty-state">
            <i class="fa-regular fa-calendar-xmark"></i>
            <p>${this.filter === 'any' ? 'No events yet.' : 'No events for this audience.'}</p>
          </div>
        `;
      }
      html += '</div></div>';
    }

    this.container.innerHTML = html;

    const findEvent = (id) => this.events.find((x) => x._id === id);
    this.container.querySelector('[data-cal-prev]')?.addEventListener('click', () => this.prevMonth());
    this.container.querySelector('[data-cal-next]')?.addEventListener('click', () => this.nextMonth());
    this.container.querySelector('[data-cal-today]')?.addEventListener('click', () => this.today());
    this.container.querySelectorAll('[data-cal-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.setView(btn.dataset.calView));
    });
    this.container.querySelectorAll('[data-cal-filter]').forEach((btn) => {
      btn.addEventListener('click', () => this.setFilter(btn.dataset.calFilter));
    });

    // Event pills open details; clicking elsewhere in a day shows that day in the side panel.
    this.container.querySelectorAll('[data-event-id]').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = findEvent(pill.dataset.eventId);
        if (ev) this.showEventDetails(ev);
      });
    });
    this.container.querySelectorAll('.calendar-cell').forEach((cell) => {
      const select = () => this.selectDay(new Date(cell.dataset.calDate));
      cell.addEventListener('click', select);
      cell.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        select();
      });
    });
    this.container.querySelectorAll('[data-agenda-event-id]').forEach((item) => {
      item.addEventListener('click', () => {
        const ev = findEvent(item.dataset.agendaEventId);
        if (ev) this.showEventDetails(ev);
      });
    });

    // Attach List View Listeners
    this.container.querySelectorAll('[data-view-event-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ev = findEvent(btn.dataset.viewEventId);
        if (ev) this.showEventDetails(ev);
      });
    });
    if (this.canManage && this.onDeleteEvent) {
      this.container.querySelectorAll('[data-del-event-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ev = findEvent(btn.dataset.delEventId);
          if (ev && confirm(`Are you sure you want to remove "${ev.title}"?`)) {
            await this.onDeleteEvent(ev._id);
          }
        });
      });
    }
  }

  // Re-render to recalculate statuses (Done/Ongoing/Pending) without re-fetching
  refreshStatuses() {
    this.render();
  }
}

// ==========================================================================
// STUDENT DETAILS & AUTHORIZED PICKUP MODAL HELPERS (Admin & Teacher)
// ==========================================================================

function escapeStudentModalValue(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function showStudentDetailsModal(studentId, { canEdit = true, onStudentUpdated, teacherMode = false } = {}) {
  try {
    const [{ student }, { authorizations }] = await Promise.all([
      api.get(`/students/${studentId}`),
      api.get(`/pickup/student/${studentId}`),
    ]);

    const renderModalContent = (s, pickupList) => {
      const birthdateStr = s.birthdate ? new Date(s.birthdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not specified';
      const guardianDisplayName = s.guardianName || s.parent?.name || 'None linked';
      const guardianContact = s.parent?.email || s.parent?.phone;

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #E2E8F0; padding-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:22px; color:var(--ink);">${escapeStudentModalValue(s.name)}</h3>
            <span class="badge ${escapeStudentModalValue(s.status)}">${escapeStudentModalValue(s.status)}</span>
          </div>
          ${canEdit ? `
            <button class="btn btn-secondary btn-sm" id="modalEditStudentBtn">
              <i class="fa-solid fa-pen-to-square"></i> Edit Student
            </button>
          ` : ''}
        </div>

        <div class="grid-2" style="margin-bottom:20px;">
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Student ID</div>
            <div style="font-weight:600; font-size:14.5px;">${escapeStudentModalValue(s.studentId || 'Not assigned')}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Class</div>
            <div style="font-weight:600; font-size:14.5px;">${escapeStudentModalValue(s.className || 'Unassigned')}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Birthdate</div>
            <div style="font-weight:600; font-size:14.5px;">${birthdateStr}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Enrollment date</div>
            <div style="font-weight:600; font-size:14.5px;">${s.enrollmentDate ? fmtDate(s.enrollmentDate) : 'Not specified'}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Parent / Guardian</div>
            <div style="font-weight:600; font-size:14.5px;">${escapeStudentModalValue(guardianDisplayName)}${guardianContact ? ` (${escapeStudentModalValue(guardianContact)})` : ''}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Assigned Teacher</div>
            <div style="font-weight:600; font-size:14.5px;">${s.teacher ? escapeStudentModalValue(s.teacher.name) : 'Unassigned'}</div>
          </div>
          ${s.guardianPhone ? `<div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;"><div class="event-detail-label">Guardian contact</div><div style="font-weight:600; font-size:14.5px;">${escapeStudentModalValue(s.guardianPhone)}</div></div>` : ''}
        </div>

        ${s.notes ? `
          <div style="margin-bottom:20px; background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Notes &amp; Dietary / Medical Info</div>
            <div style="font-size:14px; color:var(--ink-soft);">${escapeStudentModalValue(s.notes)}</div>
          </div>
        ` : ''}

        <!-- Authorized Pickup Section -->
        <div style="border-top:2px solid #E2E8F0; padding-top:18px; margin-top:20px;">
          <div class="toolbar" style="margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-shield-halved" style="color:var(--primary); font-size:18px;"></i>
              <h4 style="margin:0; font-size:16px;">Authorized Persons for Pickup</h4>
            </div>
            ${canEdit ? `
              <button class="btn btn-primary btn-sm" id="modalAddPickupBtn">
                <i class="fa-solid fa-user-plus"></i> Add Authorized Person
              </button>
            ` : ''}
          </div>

          <div id="modalPickupListContainer">
            ${pickupList.length ? pickupList.map((p) => `
              <div class="pickup-person-card">
                <div>
                  <div class="info-title">
                    ${escapeStudentModalValue(p.authorizedName)}
                    ${p.verified && p.verified.length ? `<span class="badge approved" style="margin-left:6px;"><i class="fa-solid fa-check-double"></i> Verified ${p.verified.length}×</span>` : ''}
                  </div>
                  <div class="info-meta">
                    <strong>Relationship:</strong> ${escapeStudentModalValue(p.relationship)} &nbsp;|&nbsp;
                    <strong>Contact:</strong> ${escapeStudentModalValue(p.contact)}
                  </div>
                  ${p.identification ? `
                    <div class="info-meta" style="margin-top:4px;">
                      <strong>ID / Details:</strong> ${escapeStudentModalValue(p.identification)}
                    </div>
                  ` : ''}
                </div>
                ${canEdit ? `
                  <div class="pickup-actions">
                    <button class="btn btn-ghost btn-sm" data-edit-p="${escapeStudentModalValue(p._id)}" title="Edit Person">
                      <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn btn-danger btn-sm" data-del-p="${escapeStudentModalValue(p._id)}" title="Remove Person">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                ` : ''}
              </div>
            `).join('') : `
              <div class="empty-state" style="padding:24px 10px;">
                <i class="fa-solid fa-id-badge"></i>
                <p>No authorized pickup persons recorded for this child yet.</p>
              </div>
            `}
          </div>
        </div>
      `;
    };

    Modal.open(renderModalContent(student, authorizations), true);

    // Bind Edit Student button
    if (canEdit) {
      document.getElementById('modalEditStudentBtn')?.addEventListener('click', () => {
        openEditStudentModal(student, async (updatedStudent) => {
          if (onStudentUpdated) await onStudentUpdated(updatedStudent);
          await showStudentDetailsModal(studentId, { canEdit, onStudentUpdated, teacherMode });
        }, { teacherMode });
      });

      // Bind Add Pickup button
      document.getElementById('modalAddPickupBtn')?.addEventListener('click', () => {
        openPickupFormModal({ studentId }, async () => {
          showStudentDetailsModal(studentId, { canEdit, onStudentUpdated, teacherMode });
        });
      });

      // Bind Edit Pickup buttons
      document.querySelectorAll('[data-edit-p]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = authorizations.find((a) => a._id === btn.dataset.editP);
          if (item) {
            openPickupFormModal({ studentId, pickup: item }, async () => {
              showStudentDetailsModal(studentId, { canEdit, onStudentUpdated, teacherMode });
            });
          }
        });
      });

      // Bind Delete Pickup buttons
      document.querySelectorAll('[data-del-p]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const item = authorizations.find((a) => a._id === btn.dataset.delP);
          if (item && confirm(`Remove ${item.authorizedName} from authorized pickup list?`)) {
            await api.del(`/pickup/${item._id}`);
            showStudentDetailsModal(studentId, { canEdit, onStudentUpdated, teacherMode });
          }
        });
      });
    }
  } catch (err) {
    alert('Could not load student details: ' + err.message);
  }
}

// Edit Student Modal (Used by both Admin and Teacher)
async function openEditStudentModal(student, onSaved, { teacherMode = false } = {}) {
  let parents = [];
  let teachers = [];
  if (!teacherMode) {
    const results = await Promise.all([
      api.get('/users?role=parent&status=approved'),
      api.get('/users?role=teacher'),
    ]);
    parents = results[0].users;
    teachers = results[1].users;
  }

  const birthdateFormatted = student.birthdate ? new Date(student.birthdate).toISOString().slice(0, 10) : '';
  const enrollmentDateFormatted = student.enrollmentDate ? new Date(student.enrollmentDate).toISOString().slice(0, 10) : '';

  Modal.open(`
    <h3>${teacherMode ? 'Manage Student Enrollment' : 'Edit Student Information'}</h3>
    <div id="modalEditMsg" class="form-msg"></div>
    <form id="editStudentForm">
      <div class="field">
        <label for="esName">Full Name</label>
        <input type="text" id="esName" value="${escapeStudentModalValue(student.name || '')}" maxlength="120" required />
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="esBirthdate">Birthdate</label>
          <input type="date" id="esBirthdate" value="${birthdateFormatted}" />
        </div>
        <div class="field">
          <label for="esClass">Class / Grade</label>
          <input type="text" id="esClass" list="managedClassOptions" value="${escapeStudentModalValue(student.className || '')}" maxlength="80" placeholder="e.g. Sunbeams" />
        </div>
      </div>

      ${teacherMode ? `
        <div class="field">
          <label for="esEnrollmentDate">Enrollment date</label>
          <input type="date" id="esEnrollmentDate" value="${enrollmentDateFormatted}" required />
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="esGuardianName">Parent / guardian name</label>
            <input type="text" id="esGuardianName" value="${escapeStudentModalValue(student.guardianName || '')}" maxlength="120" />
          </div>
          <div class="field">
            <label for="esGuardianPhone">Guardian contact</label>
            <input type="tel" id="esGuardianPhone" value="${escapeStudentModalValue(student.guardianPhone || '')}" maxlength="30" />
          </div>
        </div>
      ` : `
      <div class="grid-2">
        <div class="field">
          <label for="esParent">Parent / Guardian</label>
          <select id="esParent">
            <option value="">— Unassigned —</option>
            ${parents.map((p) => `
              <option value="${escapeStudentModalValue(p.id)}" ${student.parent && String(student.parent._id || student.parent) === String(p.id) ? 'selected' : ''}>
                ${escapeStudentModalValue(p.name)} (${escapeStudentModalValue(p.email)})
              </option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label for="esTeacher">Assigned Teacher</label>
          <select id="esTeacher">
            <option value="">— Unassigned —</option>
            ${teachers.map((t) => `
              <option value="${escapeStudentModalValue(t.id)}" ${student.teacher && String(student.teacher._id || student.teacher) === String(t.id) ? 'selected' : ''}>
                ${escapeStudentModalValue(t.name)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
      `}

      <div class="field">
        <label for="esNotes">Notes (Medical, Allergies, Special Needs)</label>
        <textarea id="esNotes" rows="3" maxlength="1000" placeholder="Enter notes or special considerations…">${escapeStudentModalValue(student.notes || '')}</textarea>
      </div>

      ${teacherMode ? '' : `
      <div class="field">
        <label for="esStatus">Status</label>
        <select id="esStatus">
          <option value="active" ${student.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="archived" ${student.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select>
      </div>
      `}

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
        <button type="button" class="btn btn-ghost" id="cancelEditStudentBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `);

  document.getElementById('cancelEditStudentBtn').addEventListener('click', () => Modal.close());

  document.getElementById('editStudentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalEditMsg');
    const saveButton = e.currentTarget.querySelector('button[type="submit"]');
    msg.className = 'form-msg';
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    const payload = {
      name: document.getElementById('esName').value.trim(),
      birthdate: document.getElementById('esBirthdate').value || null,
      className: document.getElementById('esClass').value.trim(),
      notes: document.getElementById('esNotes').value.trim(),
    };
    if (teacherMode) {
      payload.enrollmentDate = document.getElementById('esEnrollmentDate').value;
      payload.guardianName = document.getElementById('esGuardianName').value.trim();
      payload.guardianPhone = document.getElementById('esGuardianPhone').value.trim();
    } else {
      payload.parent = document.getElementById('esParent').value || null;
      payload.teacher = document.getElementById('esTeacher').value || null;
      payload.status = document.getElementById('esStatus').value;
    }

    let updatedStudent;
    try {
      ({ student: updatedStudent } = await api.patch(`/students/${student._id}`, payload));
    } catch (err) {
      showMsg(msg, err.message);
      saveButton.disabled = false;
      saveButton.textContent = 'Save Changes';
      return;
    }

    try {
      saveButton.textContent = 'Updating dashboard...';
      if (onSaved) await onSaved(updatedStudent);
      Modal.close();
    } catch (err) {
      showMsg(msg, `Student saved, but the dashboard could not refresh: ${err.message}`);
      saveButton.disabled = false;
      saveButton.textContent = 'Save Changes';
    }
  });
}

// Add or Edit Pickup Form Modal
function openPickupFormModal({ studentId, pickup = null }, onSaved) {
  const isEditing = !!pickup;

  Modal.open(`
    <h3>${isEditing ? 'Edit Authorized Pickup Person' : 'Add Authorized Pickup Person'}</h3>
    <div id="modalPickupMsg" class="form-msg"></div>
    <form id="pickupPersonForm">
      <div class="field">
        <label for="ppName">Full Name</label>
        <input type="text" id="ppName" value="${isEditing ? pickup.authorizedName : ''}" placeholder="e.g. Maria Santos" required />
      </div>

      <div class="field">
        <label for="ppRel">Relationship to Child</label>
        <input type="text" id="ppRel" value="${isEditing ? pickup.relationship : ''}" placeholder="e.g. Grandmother, Aunt, Guardian" required />
      </div>

      <div class="field">
        <label for="ppContact">Contact Phone Number</label>
        <input type="tel" id="ppContact" value="${isEditing ? pickup.contact : ''}" placeholder="e.g. 0917 123 4567" required />
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
        <button type="button" class="btn btn-ghost" id="cancelPickupBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEditing ? 'Save Changes' : 'Add Person'}</button>
      </div>
    </form>
  `);

  document.getElementById('cancelPickupBtn').addEventListener('click', () => Modal.close());

  document.getElementById('pickupPersonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalPickupMsg');

    const payload = {
      authorizedName: document.getElementById('ppName').value.trim(),
      relationship: document.getElementById('ppRel').value.trim(),
      contact: document.getElementById('ppContact').value.trim(),
    };

    try {
      if (isEditing) {
        await api.patch(`/pickup/${pickup._id}`, payload);
      } else {
        await api.post('/pickup', { student: studentId, ...payload });
      }
      Modal.close();
      if (onSaved) onSaved();
    } catch (err) {
      showMsg(msg, err.message);
    }
  });
}

function initDashboardSync() {
  let refreshInProgress = false;
  window.setInterval(async () => {
    if (refreshInProgress || document.hidden || document.querySelector('.modal-backdrop.open')) return;
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel || typeof onPanelShown !== 'function') return;

    refreshInProgress = true;
    try {
      await onPanelShown(activePanel.id.replace(/^panel-/, ''));
    } catch (err) {
      console.error('[dashboard] Could not refresh current panel:', err.message);
    } finally {
      refreshInProgress = false;
    }
  }, 5000);

  // Recalculate event statuses (Done/Ongoing/Pending) every minute without re-fetching
  window.setInterval(() => {
    if (document.hidden || document.querySelector('.modal-backdrop.open')) return;
    (window.__eventCalendars || []).forEach((cal) => cal.refreshStatuses());
  }, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  initLogout();
  initSettingsProfile();
  setWhoName();
  initDashboardSync();
  if (document.getElementById('modalBackdrop')) Modal.init();
});

// ==========================================================================
// ACADEMIC PROGRESS: SHARED RENDERING (Admin & Teacher)
// ==========================================================================
const PROGRESS_TYPE_LABELS = { activity: 'Activity', weekly: 'Weekly milestone', monthly: 'Monthly milestone' };
const protectedImageCache = new Map();

// Photos need the login token, so they are fetched and shown from a local blob URL.
function fetchProtectedImage(path) {
  if (!protectedImageCache.has(path)) {
    const request = fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 403 ? 'Not allowed' : 'Photo unavailable');
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob));
    request.catch(() => protectedImageCache.delete(path));
    protectedImageCache.set(path, request);
  }
  return protectedImageCache.get(path);
}

function hydrateProtectedImages(root) {
  root.querySelectorAll('img[data-protected-src]').forEach((image) => {
    const path = image.dataset.protectedSrc;
    image.removeAttribute('data-protected-src');
    image.closest('.progress-photo')?.classList.add('loading');
    fetchProtectedImage(path)
      .then((url) => { image.src = url; })
      .catch(() => {
        image.alt = 'Photo unavailable';
        image.closest('.progress-photo')?.classList.add('failed');
      })
      .finally(() => image.closest('.progress-photo')?.classList.remove('loading'));
  });
  root.querySelectorAll('[data-photo-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const image = button.querySelector('img');
      if (image && image.src) openImageLightbox(image.src, image.alt);
    });
  });
}

function openImageLightbox(src, alt = '') {
  document.querySelector('.image-lightbox')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', alt || 'Photo preview');
  overlay.innerHTML = `
    <button type="button" class="image-lightbox-close" aria-label="Close photo"><i class="fa-solid fa-xmark"></i></button>
    <img alt="${escapeDashboardHtml(alt)}" />
    ${alt ? `<p>${escapeDashboardHtml(alt)}</p>` : ''}`;
  overlay.querySelector('img').src = src;
  const previousFocus = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    previousFocus?.focus?.();
  };
  // Capture phase so Escape closes the photo before the dialog underneath.
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('.image-lightbox-close')) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  overlay.querySelector('.image-lightbox-close').focus();
}

function utcDateLabel(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return value ? new Date(value).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' }) : '';
}

function progressPeriodLabel(entry) {
  if (entry.entryType === 'monthly' && entry.periodStart) return utcDateLabel(entry.periodStart, { month: 'long', year: 'numeric' });
  if (entry.entryType === 'weekly' && entry.periodStart) {
    return `Week of ${utcDateLabel(entry.periodStart, { month: 'short', day: 'numeric' })} – ${utcDateLabel(entry.periodEnd)}`;
  }
  return utcDateLabel(entry.date);
}

function isCurrentProgressPeriod(entry) {
  if (!entry.periodStart || !entry.periodEnd) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return new Date(entry.periodStart).toISOString().slice(0, 10) <= today && today <= new Date(entry.periodEnd).toISOString().slice(0, 10);
}

function studentInitials(name = '') {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

// Prominent "whose record is this" header.
function studentProgressHeaderHtml(student, entries = [], extraHtml = '') {
  const milestones = entries.filter((entry) => entry.entryType === 'weekly' || entry.entryType === 'monthly').length;
  const photos = entries.reduce((total, entry) => total + (entry.attachments || []).length, 0);
  return `
    <div class="student-progress-header">
      <div class="student-avatar" aria-hidden="true">${escapeDashboardHtml(studentInitials(student.name))}</div>
      <div class="student-progress-identity">
        <span class="student-progress-eyebrow">Academic progress record</span>
        <h2>${escapeDashboardHtml(student.name)}</h2>
        <p>${escapeDashboardHtml(student.className || 'Unassigned')}${student.studentId ? ` · ID ${escapeDashboardHtml(student.studentId)}` : ''}${student.teacher?.name ? ` · Teacher: ${escapeDashboardHtml(student.teacher.name)}` : ''}</p>
      </div>
      <div class="student-progress-stats">
        <span><strong>${entries.length}</strong> records</span>
        <span><strong>${milestones}</strong> milestones</span>
        <span><strong>${photos}</strong> photos</span>
      </div>
      ${extraHtml}
    </div>`;
}

function progressPhotoGridHtml(entry) {
  const attachments = entry.attachments || [];
  if (!attachments.length) return '';
  return `<div class="progress-photo-grid">${attachments.map((attachment) => `
    <button type="button" class="progress-photo" data-photo-open aria-label="Open photo ${escapeDashboardHtml(attachment.originalName)}">
      <img data-protected-src="/progress/${escapeDashboardHtml(entry._id)}/attachments/${escapeDashboardHtml(attachment._id)}" alt="${escapeDashboardHtml(attachment.originalName)}" loading="lazy" />
    </button>`).join('')}</div>`;
}

function progressEntryCardHtml(entry, { actionsHtml = '' } = {}) {
  const type = entry.entryType || 'activity';
  const current = isCurrentProgressPeriod(entry);
  const field = (label, value) => (value ? `<p><strong>${label}:</strong> ${escapeDashboardHtml(value)}</p>` : '');
  const title = entry.milestone || entry.activity || 'Progress record';
  return `
    <article class="progress-entry progress-entry-${type} ${current ? 'is-current' : ''}">
      <div class="progress-entry-heading">
        <div>
          <div class="progress-entry-tags">
            <span class="progress-type-badge ${type}">${PROGRESS_TYPE_LABELS[type] || 'Activity'}</span>
            ${current ? `<span class="progress-type-badge current">This ${type === 'weekly' ? 'week' : 'month'}</span>` : ''}
            ${entry.learningArea ? `<span class="progress-category">${escapeDashboardHtml(entry.learningArea)}</span>` : ''}
          </div>
          <h4>${escapeDashboardHtml(title)}</h4>
          <div class="progress-entry-meta">${escapeDashboardHtml(progressPeriodLabel(entry))}${entry.teacher?.name ? ` · ${escapeDashboardHtml(entry.teacher.name)}` : ''}${entry.className ? ` · ${escapeDashboardHtml(entry.className)}` : ''}</div>
        </div>
        ${actionsHtml ? `<div class="progress-entry-actions">${actionsHtml}</div>` : ''}
      </div>
      ${entry.milestone && entry.activity ? field('Description', entry.activity) : ''}
      ${field('Observations', entry.observations)}
      ${field('Assessment result', entry.assessment)}
      ${field('Teacher evaluation', entry.evaluation)}
      ${field('Strengths', entry.strengths)}
      ${field('Needs support', entry.areasForImprovement)}
      ${field('Overall development', entry.overallDevelopment)}
      ${field('Progress notes', entry.notes)}
      ${progressPhotoGridHtml(entry)}
    </article>`;
}
