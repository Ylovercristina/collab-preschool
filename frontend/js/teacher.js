// ---------- Play-is-School -- Teacher Dashboard Controller ----------
const user = requireRole('teacher');
let myStudents = [];
let cachedTeacherFees = [];
let activeMessageThread = null;
let messageSearchTimer = null;
let messageSearchRequest = 0;
let teacherCalendar = null;
let teacherAudiencePicker = null;
let teacherAlertView = 'active';
let knownTeacherNotificationIds = new Set();
let teacherNotificationsInitialized = false;

function escapeTeacherHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function showMessageFeedback(node, text) {
  node.textContent = text;
  node.hidden = !text;
}

function relatedUserId(value) {
  return value ? String(value._id || value.id || value) : '';
}

function localDateValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatEmailSummary(summary) {
  const counts = `Sent ${summary.sent}, skipped ${summary.skipped} (${summary.unverified || 0} unverified email), failed ${summary.failed}`;
  return summary.complete ? counts : `${counts} (delivery logging in progress)`;
}

async function pollEmailSummary(path, initial, target) {
  let summary = initial;
  target.textContent = formatEmailSummary(summary);
  for (let attempt = 0; !summary.complete && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await api.get(path);
    summary = response.emailSummary;
    target.textContent = formatEmailSummary(summary);
  }
  return summary;
}

function onPanelShown(panel) {
  if (panel === 'overview') return loadOverview();
  if (panel === 'enrollment') return loadTeacherEnrollment();
  if (panel === 'students') return loadStudentsPanel();
  if (panel === 'fees') return loadFeeStatuses();
  if (panel === 'attendance') return loadAttendance();
  if (panel === 'progress') return loadProgressPanel();
  if (panel === 'messages') return loadInbox();
  if (panel === 'events') return loadEvents();
  if (panel === 'notifications') return loadTeacherNotifications();
  if (panel === 'pickup') return loadPickupPanel();
  if (panel === 'alerts') return loadAlerts();
}

async function loadMyStudents() {
  const { students } = await api.get('/students');
  myStudents = students || [];
  return myStudents;
}

// ---------- Overview ----------
async function loadOverview() {
  await Promise.all([loadMyStudents(), loadTeacherNotifications({ silent: true })]);
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-user-graduate"></i></div>
      <div class="stat-content"><div class="num">${myStudents.length}</div><div class="label">Assigned Students</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
      <div class="stat-content"><div class="num">${myStudents.filter((student) => student.status === 'active').length}</div><div class="label">Active Students</div></div>
    </div>
  `;
  const { roster } = await api.get(`/attendance/class?date=${localDateValue()}`);
  document.getElementById('todayRoster').innerHTML = roster.length ? `
    <div class="table-responsive">
      <table>
        <thead><tr><th>Student</th><th>Class</th><th>Today's Status</th></tr></thead>
        <tbody>
          ${roster.map((r) => `
            <tr>
              <td><strong>${r.student.name}</strong></td>
              <td>${r.student.className || '—'}</td>
              <td>${r.attendance ? `<span class="badge ${escapeTeacherHtml(r.attendance.status)}">${['late', 'tardy'].includes(r.attendance.status) ? 'Tardy' : escapeTeacherHtml(r.attendance.status)}</span>` : '<span style="color:var(--ink-muted); font-style:italic;">Not marked yet</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty-state"><i class="fa-solid fa-clipboard-question"></i><p>No students assigned to your class roster yet.</p></div>';
}

async function loadTeacherNotifications({ silent = false } = {}) {
  const container = document.getElementById('teacherNotificationsList');
  try {
    const { notifications = [], unreadCount = 0 } = await api.get('/notifications');
    const badge = document.getElementById('teacherNotificationUnreadBadge');
    if (badge) {
      badge.hidden = unreadCount === 0;
      badge.textContent = unreadCount;
      badge.setAttribute('aria-label', `${unreadCount} unread notifications`);
    }
    if (teacherNotificationsInitialized && !silent) {
      notifications
        .filter((notification) => !knownTeacherNotificationIds.has(notification._id))
        .forEach((notification) => showToast(`New school notification: ${notification.title}`, 'info'));
    }
    knownTeacherNotificationIds = new Set(notifications.map((notification) => notification._id));
    teacherNotificationsInitialized = true;
    if (!container) return;
    container.innerHTML = notifications.length ? `
      <div class="teacher-notification-list">
        ${notifications.map((notification) => `
          <article class="teacher-notification ${notification.readAt ? '' : 'unread'}">
            <div class="teacher-notification-icon"><i class="fa-solid fa-${notification.type === 'event' ? 'calendar-days' : 'bell'}" aria-hidden="true"></i></div>
            <div class="teacher-notification-content">
              <div class="teacher-notification-heading">
                <strong>${escapeTeacherHtml(notification.title)}</strong>
                <time datetime="${escapeTeacherHtml(notification.createdAt || '')}">${escapeTeacherHtml(fmtDate(notification.createdAt))}</time>
              </div>
              <p>${escapeTeacherHtml(notification.message)}</p>
            </div>
            ${notification.readAt
              ? '<span class="badge approved">Read</span>'
              : `<button type="button" class="btn btn-ghost btn-sm" data-mark-teacher-notification="${escapeTeacherHtml(notification._id)}">Mark read</button>`}
          </article>
        `).join('')}
      </div>
    ` : '<div class="empty-state"><i class="fa-solid fa-bell"></i><p>No notifications yet.</p></div>';

    container.querySelectorAll('[data-mark-teacher-notification]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api.patch(`/notifications/${button.dataset.markTeacherNotification}/read`, {});
          await loadTeacherNotifications({ silent: true });
        } catch (error) {
          showToast(error.message || 'Could not mark notification as read.', 'error');
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    if (container) {
      container.innerHTML = `<div class="notification-empty">${escapeTeacherHtml(error.message || 'Notifications could not be loaded.')}</div>`;
    }
    if (!silent) showToast(error.message || 'Notifications could not be loaded.', 'error');
  }
}

document.getElementById('refreshTeacherNotifications')?.addEventListener('click', () => {
  loadTeacherNotifications();
});

// ---------- Students Panel (Edit Student Information & Pickup) ----------
async function loadStudentsPanel() {
  await loadMyStudents();
  const displayList = myStudents;

  const tbody = document.getElementById('teacherStudentsTbody');
  if (!displayList.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map((s) => {
    const bdate = s.birthdate ? new Date(s.birthdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    return `
      <tr>
        <td><strong>${escapeTeacherHtml(s.name)}</strong></td>
        <td><span class="badge" style="background:#F1F5F9; color:var(--ink);">${escapeTeacherHtml(s.className || 'Unassigned')}</span></td>
        <td>${s.parent ? escapeTeacherHtml(s.parent.name) : '<em>Unassigned</em>'}</td>
        <td>${bdate}</td>
        <td><span class="badge ${escapeTeacherHtml(s.status)}">${escapeTeacherHtml(s.status)}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-student="${escapeTeacherHtml(s._id)}" title="Edit Student Information">
              <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-details-student="${escapeTeacherHtml(s._id)}" title="View Details & Authorized Pickup">
              <i class="fa-solid fa-shield-halved"></i> Details &amp; Pickup
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind Edit buttons
  tbody.querySelectorAll('[data-edit-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = displayList.find((x) => x._id === btn.dataset.editStudent);
      if (s) openEditStudentModal(s, loadStudentsPanel, { teacherMode: true });
    });
  });

  // Bind Details & Pickup buttons
  tbody.querySelectorAll('[data-details-student]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showStudentDetailsModal(btn.dataset.detailsStudent, {
        canEdit: true,
        onStudentUpdated: loadStudentsPanel,
        teacherMode: true,
      });
    });
  });
}

async function loadFeeStatuses() {
  const { fees } = await api.get('/fees/teacher');
  cachedTeacherFees = fees || [];
  const tbody = document.getElementById('teacherFeesTbody');
  if (!cachedTeacherFees.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fa-solid fa-credit-card"></i><p>No fee records for your assigned students.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = cachedTeacherFees.map((fee) => {
    const totalPaid = Number(Number(fee.amountPaid || 0).toFixed(2));
    const remaining = Math.max(0, Number((Number(fee.amount) - totalPaid).toFixed(2)));
    const status = totalPaid <= 0 ? 'unpaid' : (remaining === 0 ? 'paid' : 'partial');
    const statusLabel = { unpaid: 'Unpaid', partial: 'Partial Payment', paid: 'Paid' }[status];
    return `
      <tr>
        <td data-label="Student"><strong class="fee-primary-value">${escapeTeacherHtml(fee.student ? fee.student.name : '—')}</strong></td>
        <td data-label="Class">${escapeTeacherHtml(fee.student ? fee.student.className || '—' : '—')}</td>
        <td data-label="Fee">${escapeTeacherHtml(fee.description)}</td>
        <td data-label="Total" class="fee-numeric"><strong class="fee-primary-value">${fmtMoney(fee.amount)}</strong></td>
        <td data-label="Paid" class="fee-numeric">${fmtMoney(totalPaid)}</td>
        <td data-label="Remaining" class="fee-numeric"><span class="fee-balance">${fmtMoney(remaining)}</span></td>
        <td data-label="Due Date">${fmtDate(fee.dueDate)}</td>
        <td data-label="Status"><span class="badge ${status}">${statusLabel}</span></td>
        <td data-label="Actions"><div class="fee-row-actions">${status !== 'paid' ? `<button type="button" class="btn btn-secondary btn-sm" title="Remind parent" aria-label="Remind parent about ${escapeTeacherHtml(fee.student ? fee.student.name : 'student')}" data-fee-reminder="${escapeTeacherHtml(fee._id)}"><i class="fa-solid fa-envelope" aria-hidden="true"></i></button>` : '<span class="badge paid"><i class="fa-solid fa-check"></i> Settled</span>'}</div></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-fee-reminder]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const feeId = button.dataset.feeReminder;
        const { notification, emailSummary } = await api.post(`/fees/${feeId}/reminders`, {});
        const summaryTarget = document.createElement('span');
        const summary = await pollEmailSummary(
          `/fees/${feeId}/reminders/${notification._id}/email-summary`,
          emailSummary,
          summaryTarget
        );
        const emailStatus = summary.complete
          ? `Email: ${formatEmailSummary(summary)}.`
          : 'Email delivery is still processing; check the parent email address if it does not arrive.';
        showToast(`In-app reminder sent. ${emailStatus}`, summary.failed || summary.skipped ? 'error' : (summary.complete ? 'success' : 'info'));
      } catch (error) {
        showToast(error.message || 'Could not send the balance reminder.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

document.getElementById('remindAllFeesBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const unpaidFeeCount = cachedTeacherFees.filter((fee) => {
    return Number(fee.amount) - Number(fee.amountPaid || 0) > 0;
  }).length;
  if (!unpaidFeeCount) {
    showToast('There are no unpaid fees to remind.', 'info');
    return;
  }
  if (!window.confirm(`Send reminders for all ${unpaidFeeCount} unpaid fees for your assigned students? Each reminder creates an in-app notification and sends an email to the parent.`)) return;

  button.disabled = true;
  try {
    const result = await api.post('/fees/reminders/all', {});
    const skipped = result.skippedCount ? ` ${result.skippedCount} fee reminder(s) skipped because no active parent email was available.` : '';
    showToast(`${result.message}${skipped}`, result.skippedCount ? 'info' : 'success');
    await loadFeeStatuses();
  } catch (error) {
    showToast(error.message || 'Could not send all balance reminders.', 'error');
  } finally {
    button.disabled = false;
  }
});

// ---------- Attendance ----------
const attDateInput = document.getElementById('attDate');
attDateInput.value = localDateValue();
let generatedAttendanceReport = null;
let attendanceReportStudentName = '';
attDateInput.addEventListener('change', () => loadAttendance());
document.getElementById('openAttendanceReport').addEventListener('click', openAttendanceReport);

function openAttendanceReport() {
  const template = document.getElementById('attendanceReportModalTemplate');
  Modal.open(template.innerHTML, true);
  Modal.body.classList.add('modal-attendance-report');

  const reportToday = new Date();
  const period = Modal.body.querySelector('#attendanceReportPeriod');
  const monthField = Modal.body.querySelector('#attendanceReportMonthField');
  const month = Modal.body.querySelector('#attendanceReportMonth');
  const year = Modal.body.querySelector('#attendanceReportYear');
  populateAttendanceReportStudents(Modal.body.querySelector('#attendanceReportStudent'));
  year.value = reportToday.getFullYear();
  month.value = String(reportToday.getMonth() + 1);
  monthField.hidden = period.value === 'year';
  period.addEventListener('change', () => {
    monthField.hidden = period.value === 'year';
  });
  Modal.body.querySelector('#attendanceReportForm').addEventListener('submit', generateAttendanceReport);
  Modal.body.querySelector('#downloadAttendanceReport').addEventListener('click', downloadAttendanceReport);
  generatedAttendanceReport = null;
  attendanceReportStudentName = '';
}

function previousDateValue(value) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return localDateValue(date);
}

function attendanceStatusLabel(status) {
  const labels = { present: 'Present', absent: 'Absent', late: 'Tardy', tardy: 'Tardy', excused: 'Excused' };
  return labels[status] || 'Not recorded';
}

function renderAttendanceSummary(roster) {
  const counts = { present: 0, absent: 0, tardy: 0, excused: 0, unrecorded: 0 };
  roster.forEach(({ attendance }) => {
    if (!attendance) counts.unrecorded += 1;
    else if (attendance.status === 'late' || attendance.status === 'tardy') counts.tardy += 1;
    else if (Object.prototype.hasOwnProperty.call(counts, attendance.status)) counts[attendance.status] += 1;
  });
  document.getElementById('attendanceDailySummary').innerHTML = `
    <div class="attendance-summary-card"><span>Students</span><strong>${roster.length}</strong></div>
    <div class="attendance-summary-card"><span>Present</span><strong>${counts.present}</strong></div>
    <div class="attendance-summary-card attendance-summary-absent"><span>Absent</span><strong>${counts.absent}</strong></div>
    <div class="attendance-summary-card"><span>Tardy</span><strong>${counts.tardy}</strong></div>
    <div class="attendance-summary-card"><span>Excused</span><strong>${counts.excused}</strong></div>
    <div class="attendance-summary-card"><span>Not recorded</span><strong>${counts.unrecorded}</strong></div>
  `;
}

async function loadYesterdayAbsences() {
  const card = document.getElementById('yesterdayAbsenceCard');
  const yesterday = previousDateValue(localDateValue());
  const { roster } = await api.get(`/attendance/class?date=${encodeURIComponent(yesterday)}`);
  const absentStudents = roster.filter((row) => row.attendance && row.attendance.status === 'absent');
  card.hidden = absentStudents.length === 0;
  document.getElementById('yesterdayAbsenceCount').textContent = absentStudents.length;
  document.getElementById('yesterdayAbsenceList').innerHTML = absentStudents.map(({ student }) => `
    <span class="attendance-yesterday-student"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> ${escapeTeacherHtml(student.name)}${student.className ? ` · ${escapeTeacherHtml(student.className)}` : ''}</span>
  `).join('');
}

async function loadAttendance() {
  const date = attDateInput.value || localDateValue();
  const tbody = document.getElementById('attTbody');
  const message = document.getElementById('attendanceMessage');
  message.textContent = '';
  try {
    await loadMyStudents();
    const [dailyResult, yesterdayResult] = await Promise.allSettled([
      api.get(`/attendance/class?date=${encodeURIComponent(date)}`),
      loadYesterdayAbsences(),
    ]);
    if (dailyResult.status === 'rejected') throw dailyResult.reason;
    const { roster } = dailyResult.value;
    if (yesterdayResult.status === 'rejected') {
      showMsg(message, `Attendance loaded, but yesterday’s absences could not be checked: ${yesterdayResult.reason.message}`);
    }
    renderAttendanceSummary(roster);
    if (!roster.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-clipboard-user"></i><p>No students assigned to you.</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = roster.map((r) => `
      <tr class="${r.attendance && r.attendance.status === 'absent' ? 'attendance-absent-row' : ''}" data-student="${escapeTeacherHtml(r.student.id)}">
        <td><strong>${escapeTeacherHtml(r.student.name)}</strong></td>
        <td>${escapeTeacherHtml(r.student.className || '—')}</td>
        <td>
          <select class="statusSelect attendance-status-select" aria-label="Attendance status for ${escapeTeacherHtml(r.student.name)}" data-status="${r.attendance ? escapeTeacherHtml(r.attendance.status) : ''}">
            ${[['present', 'Present'], ['absent', 'Absent'], ['tardy', 'Tardy'], ['excused', 'Excused']].map(([value, label]) => `<option value="${value}" ${r.attendance && (r.attendance.status === value || (value === 'tardy' && r.attendance.status === 'late')) ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </td>
        <td><input class="remarksInput attendance-remarks-input" maxlength="500" value="${escapeTeacherHtml(r.attendance ? (r.attendance.remarks || '') : '')}" aria-label="Attendance remarks for ${escapeTeacherHtml(r.student.name)}" placeholder="Optional remarks" /></td>
        <td><div class="attendance-record-actions"><button type="button" class="btn btn-secondary btn-sm" data-save-attendance>Save</button><span data-attendance-state aria-live="polite">${r.attendance ? 'Saved' : 'Not recorded'}</span></div></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach((row) => {
      const saveButton = row.querySelector('[data-save-attendance]');
      const state = row.querySelector('[data-attendance-state]');
      const markUnsaved = () => { state.textContent = 'Unsaved changes'; };
      const statusSelect = row.querySelector('.statusSelect');
      statusSelect.addEventListener('change', () => {
        row.classList.toggle('attendance-absent-row', statusSelect.value === 'absent');
        statusSelect.dataset.status = statusSelect.value;
        markUnsaved();
      });
      row.querySelector('.remarksInput').addEventListener('input', markUnsaved);
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        state.textContent = 'Saving…';
        document.getElementById('attendanceMessage').textContent = '';
        try {
          await api.post('/attendance', {
            student: row.dataset.student,
            date,
            status: row.querySelector('.statusSelect').value,
            remarks: row.querySelector('.remarksInput').value.trim(),
          });
          state.textContent = 'Saved';
          await loadAttendance();
        } catch (err) {
          state.textContent = 'Not saved';
          showMsg(document.getElementById('attendanceMessage'), err.message);
        } finally {
          saveButton.disabled = false;
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Attendance roster could not be loaded.</p></div></td></tr>';
    showMsg(message, err.message);
  }
}

function csvField(value) {
  let text = String(value == null ? '' : value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function generateAttendanceReport(event) {
  event.preventDefault();
  const modal = Modal.body;
  const studentId = modal.querySelector('#attendanceReportStudent').value;
  const year = Number(modal.querySelector('#attendanceReportYear').value);
  const month = Number(modal.querySelector('#attendanceReportMonth').value);
  const selectedPeriod = modal.querySelector('#attendanceReportPeriod').value;
  const tbody = modal.querySelector('#attendanceReportTbody');
  const downloadButton = modal.querySelector('#downloadAttendanceReport');
  const summary = modal.querySelector('#attendanceReportSummary');
  const results = modal.querySelector('#attendanceReportResults');
  downloadButton.disabled = true;
  generatedAttendanceReport = null;
  if (!Number.isInteger(year) || year < 1900 || year > 9999
      || (selectedPeriod === 'month' && (!Number.isInteger(month) || month < 1 || month > 12))) {
    results.hidden = false;
    showMsg(summary, 'Choose a valid month and year for the report.');
    return;
  }
  const from = selectedPeriod === 'year'
    ? `${year}-01-01`
    : new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = selectedPeriod === 'year'
    ? `${year}-12-31`
    : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  results.hidden = false;
  summary.textContent = '';
  tbody.innerHTML = '<tr><td colspan="5">Loading attendance report…</td></tr>';
  try {
    const reportPath = studentId === 'all'
      ? `/attendance/class/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `/attendance/student/${encodeURIComponent(studentId)}`;
    const { attendance } = await api.get(reportPath);
    if (!Array.isArray(attendance)) {
      throw new Error('Attendance report could not be loaded. Please try again.');
    }
    const selectedStudent = studentId === 'all'
      ? null
      : myStudents.find((entry) => relatedUserId(entry) === studentId);
    if (studentId !== 'all' && !selectedStudent) {
      throw new Error('The selected student is not assigned to your account.');
    }
    generatedAttendanceReport = attendance
      .filter((record) => {
        const recordDate = new Date(record.date).toISOString().slice(0, 10);
        return recordDate >= from && recordDate <= to;
      })
      .map((record) => {
        const recordStudent = record.student && typeof record.student === 'object' && record.student.name
          ? record.student
          : selectedStudent;
        if (!recordStudent) {
          throw new Error('An attendance record is missing its student details.');
        }
        return {
          ...record,
          studentName: recordStudent.name,
          className: recordStudent.className || '',
        };
      })
      .sort((left, right) => (
        new Date(right.date) - new Date(left.date)
        || left.studentName.localeCompare(right.studentName)
      ));
    attendanceReportStudentName = studentId === 'all' ? 'all-students' : selectedStudent.name;
    const reportCounts = { present: 0, absent: 0, tardy: 0, excused: 0 };
    generatedAttendanceReport.forEach((record) => {
      const status = record.status === 'late' ? 'tardy' : record.status;
      if (Object.prototype.hasOwnProperty.call(reportCounts, status)) reportCounts[status] += 1;
    });
    summary.className = 'attendance-report-summary';
    summary.innerHTML = `
      <span><strong>${selectedPeriod === 'year' ? year : `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${year}`}</strong></span>
      <span><strong>${studentId === 'all' ? myStudents.length : 1}</strong> ${studentId === 'all' ? 'assigned students' : 'student'}</span>
      <span><strong>${generatedAttendanceReport.length}</strong> recorded days</span>
      <span><strong>${reportCounts.present}</strong> present</span>
      <span class="${reportCounts.absent ? 'attendance-report-absent' : ''}"><strong>${reportCounts.absent}</strong> absent</span>
      <span><strong>${reportCounts.tardy}</strong> tardy</span>
      <span><strong>${reportCounts.excused}</strong> excused</span>
    `;
    tbody.innerHTML = generatedAttendanceReport.length ? generatedAttendanceReport.map((record) => `
      <tr class="${record.status === 'absent' ? 'attendance-absent-row' : ''}">
        <td>${escapeTeacherHtml(new Date(record.date).toLocaleDateString())}</td>
        <td>${escapeTeacherHtml(record.studentName)}</td>
        <td>${escapeTeacherHtml(record.className || '—')}</td>
        <td><span class="attendance-report-status ${record.status === 'absent' ? 'is-absent' : ''}">${escapeTeacherHtml(attendanceStatusLabel(record.status))}</span></td>
        <td>${escapeTeacherHtml(record.remarks || '—')}</td>
      </tr>
    `).join('') : '<tr><td colspan="5">No attendance records found for this selection and date range.</td></tr>';
    downloadButton.disabled = generatedAttendanceReport.length === 0;
  } catch (err) {
    generatedAttendanceReport = null;
    summary.className = 'attendance-report-summary';
    showMsg(summary, err.message);
    tbody.innerHTML = '<tr><td colspan="5">Attendance report could not be generated.</td></tr>';
  }
}

function downloadAttendanceReport() {
  if (!generatedAttendanceReport || !generatedAttendanceReport.length) return;
  const rows = [
    ['Date', 'Student', 'Class', 'Status', 'Remarks'],
    ...generatedAttendanceReport.map((record) => [
      new Date(record.date).toLocaleDateString(),
      record.studentName,
      record.className,
      attendanceStatusLabel(record.status),
      record.remarks || '',
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance-${attendanceReportStudentName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'student'}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function populateAttendanceReportStudents(select) {
  const previousStudentId = select.value;
  select.innerHTML = myStudents.length
    ? `<option value="all">All assigned students</option>${myStudents.map((student) => `<option value="${escapeTeacherHtml(relatedUserId(student))}">${escapeTeacherHtml(student.name)}${student.className ? ` — ${escapeTeacherHtml(student.className)}` : ''}</option>`).join('')}`
    : '<option value="">No assigned students</option>';
  if (previousStudentId === 'all' || myStudents.some((student) => relatedUserId(student) === previousStudentId)) {
    select.value = previousStudentId;
  }
}

// ---------- Academic Progress ----------
let editingProgressId = '';

function escapeProgressText(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function resetProgressEdit() {
  editingProgressId = '';
  const form = document.getElementById('progressForm');
  form.reset();
  document.getElementById('pDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('progressFormTitle').innerHTML = '<i class="fa-solid fa-plus-circle" style="color:var(--primary); margin-right:6px;"></i>Log Milestone or Activity';
  document.getElementById('progressSaveButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Entry';
  document.getElementById('progressCancelEdit').hidden = true;
}

function editProgressEntry(entry) {
  editingProgressId = entry._id;
  document.getElementById('pDate').value = entry.date ? new Date(entry.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('pLearningArea').value = entry.learningArea || '';
  document.getElementById('pMilestone').value = entry.milestone || '';
  document.getElementById('pActivity').value = entry.activity || '';
  document.getElementById('pAssessment').value = entry.assessment || '';
  document.getElementById('pEvaluation').value = entry.evaluation || '';
  document.getElementById('pStrengths').value = entry.strengths || '';
  document.getElementById('pAreasForImprovement').value = entry.areasForImprovement || '';
  document.getElementById('pOverallDevelopment').value = entry.overallDevelopment || '';
  document.getElementById('pNotes').value = entry.notes || '';
  document.getElementById('progressFormTitle').textContent = 'Update Progress Entry';
  document.getElementById('progressSaveButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Entry';
  document.getElementById('progressCancelEdit').hidden = false;
  document.getElementById('progressForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadProgressPanel() {
  if (!document.getElementById('pDate').value) document.getElementById('pDate').value = new Date().toISOString().slice(0, 10);
  await loadMyStudents();
  const sel = document.getElementById('progStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${escapeTeacherHtml(s._id)}">${escapeTeacherHtml(s.name)}</option>`).join('');
  sel.onchange = renderProgressList;
  if (myStudents.length) renderProgressList();
  else document.getElementById('progressList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No students are assigned to you.</p></div>';
}

async function renderProgressList() {
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const { progress } = await api.get(`/progress/student/${sid}`);
  const list = document.getElementById('progressList');
  list.innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:var(--primary); font-weight:700;"><i class="fa-regular fa-calendar"></i> ${fmtDate(p.date)}${p.learningArea ? ` &middot; ${escapeProgressText(p.learningArea)}` : ''}</span>
        ${String(p.teacher?._id || p.teacher) === String(user.id) ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-progress="${escapeProgressText(p._id)}"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}
      </div>
      ${p.milestone ? `<p style="margin-bottom:4px;"><strong>Milestone:</strong> ${escapeProgressText(p.milestone)}</p>` : ''}
      ${p.activity ? `<p style="margin-bottom:4px;"><strong>Activity:</strong> ${escapeProgressText(p.activity)}</p>` : ''}
      ${p.assessment ? `<p style="margin-bottom:4px;"><strong>Assessment:</strong> ${escapeProgressText(p.assessment)}</p>` : ''}
      ${p.evaluation ? `<p style="margin-bottom:4px;"><strong>Teacher evaluation:</strong> ${escapeProgressText(p.evaluation)}</p>` : ''}
      ${p.strengths ? `<p style="margin-bottom:4px;"><strong>Strengths:</strong> ${escapeProgressText(p.strengths)}</p>` : ''}
      ${p.areasForImprovement ? `<p style="margin-bottom:4px;"><strong>Areas for improvement:</strong> ${escapeProgressText(p.areasForImprovement)}</p>` : ''}
      ${p.overallDevelopment ? `<p style="margin-bottom:4px;"><strong>Overall development:</strong> ${escapeProgressText(p.overallDevelopment)}</p>` : ''}
      ${p.notes ? `<p style="margin:0; color:var(--ink-soft); font-style:italic;">Notes: ${escapeProgressText(p.notes)}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No progress entries logged yet for this student.</p></div>';
  list.querySelectorAll('[data-edit-progress]').forEach((button) => {
    const entry = progress.find((item) => item._id === button.dataset.editProgress);
    if (entry) button.addEventListener('click', () => editProgressEntry(entry));
  });
}

document.getElementById('progressForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sid = document.getElementById('progStudentSelect').value;
  if (!sid) return;
  const message = document.getElementById('progressFormMessage');
  message.textContent = '';
  try {
    const values = {
      student: sid,
      date: document.getElementById('pDate').value,
      milestone: document.getElementById('pMilestone').value.trim(),
      activity: document.getElementById('pActivity').value.trim(),
      assessment: document.getElementById('pAssessment').value.trim(),
      learningArea: document.getElementById('pLearningArea').value,
      evaluation: document.getElementById('pEvaluation').value.trim(),
      strengths: document.getElementById('pStrengths').value.trim(),
      areasForImprovement: document.getElementById('pAreasForImprovement').value.trim(),
      overallDevelopment: document.getElementById('pOverallDevelopment').value.trim(),
      notes: document.getElementById('pNotes').value.trim(),
    };
    if (editingProgressId) {
      delete values.student;
      await api.patch(`/progress/${editingProgressId}`, values);
    } else {
      await api.post('/progress', values);
    }
    resetProgressEdit();
    message.textContent = '';
    await renderProgressList();
  } catch (err) {
    showMsg(message, err.message);
  }
});

document.getElementById('progressCancelEdit').addEventListener('click', () => {
  resetProgressEdit();
  document.getElementById('progressFormMessage').textContent = '';
});

// ---------- Messages ----------
async function loadInbox() {
  const box = document.getElementById('inboxList');
  try {
    await loadMyStudents();
    const { threads } = await api.get('/messages/inbox');
    box.innerHTML = threads.length ? threads.map((thread) => {
      const isGroup = thread.type === 'group';
      const title = isGroup ? thread.name : thread.with.name;
      const preview = thread.lastMessage ? thread.lastMessage.content : 'Start a conversation';
      const icon = isGroup ? 'fa-users' : (thread.with.role === 'teacher' ? 'fa-chalkboard-user' : 'fa-user');
      const isActive = activeMessageThread
        && (isGroup
          ? activeMessageThread.type === 'group' && activeMessageThread.groupId === thread.id
          : activeMessageThread.type === 'direct' && activeMessageThread.userId === thread.with.id);
      return `
        <button type="button" class="messenger-conversation${isActive ? ' active' : ''}" data-thread-type="${isGroup ? 'group' : 'direct'}" data-thread-id="${escapeTeacherHtml(thread.id)}">
          <span class="messenger-avatar"><i class="fa-solid ${icon}"></i></span>
          <span class="messenger-conversation-copy">
            <strong>${escapeTeacherHtml(title)}</strong>
            <span>${escapeTeacherHtml(preview)}</span>
          </span>
          ${thread.unread ? `<span class="messenger-unread" aria-label="${thread.unread} unread messages">${thread.unread}</span>` : ''}
        </button>
      `;
    }).join('') : '<div class="messenger-list-empty">No conversations yet. Search for a parent or teacher to start chatting.</div>';

    box.querySelectorAll('[data-thread-type]').forEach((row) => row.addEventListener('click', async () => {
      try {
        if (row.dataset.threadType === 'group') await openGroupThread(row.dataset.threadId);
        else {
          const thread = threads.find((item) => item.id === row.dataset.threadId);
          if (thread) await openDirectThread(thread.with.id, thread.with.name, thread.with.role);
        }
      } catch (err) {
        showMessageFeedback(document.getElementById('messageFormMessage'), err.message);
      }
    }));
  } catch (err) {
    box.innerHTML = `<div class="messenger-list-empty">${escapeTeacherHtml(err.message || 'Could not load conversations.')}</div>`;
  }
}

function showMessengerView(viewId) {
  document.getElementById('chatEmptyState').hidden = viewId !== 'empty';
  document.getElementById('teacherGroupComposer').hidden = viewId !== 'compose';
  document.getElementById('chatConversationView').hidden = viewId !== 'conversation';
}

function setActiveInboxThread(type, threadId) {
  document.querySelectorAll('#inboxList [data-thread-type]').forEach((row) => {
    row.classList.toggle('active', row.dataset.threadType === type && row.dataset.threadId === String(threadId));
  });
}

function renderMessages(messages, groupMessage) {
  const thread = document.getElementById('chatThread');
  const currentUserId = relatedUserId(user);
  thread.innerHTML = messages.map((message) => {
    const senderId = relatedUserId(message.sender);
    const sender = message.sender && typeof message.sender === 'object' ? message.sender : {};
    const senderName = sender.name || 'User';
    const content = escapeTeacherHtml(message.content).replace(/\r?\n/g, '<br>');
    if (!groupMessage) return `<div class="chat-bubble ${senderId === currentUserId ? 'mine' : 'theirs'}">${content}</div>`;
    const initials = senderName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
    const avatar = sender.avatar ? `data-avatar="${escapeTeacherHtml(sender.avatar)}"` : '';
    return `
      <div class="chat-message-row ${senderId === currentUserId ? 'mine' : 'theirs'}">
        <span class="chat-author-avatar" ${avatar} aria-label="${escapeTeacherHtml(senderName)}">
          <img alt="" hidden />
          <span>${escapeTeacherHtml(initials)}</span>
        </span>
        <div class="chat-bubble ${senderId === currentUserId ? 'mine' : 'theirs'}">
          <span class="chat-message-sender">${escapeTeacherHtml(senderName)}</span>${content}
        </div>
      </div>
    `;
  }).join('') || '<div class="messenger-thread-empty">Say hello to start the conversation.</div>';
  thread.querySelectorAll('.chat-author-avatar[data-avatar]').forEach((avatar) => {
    const image = avatar.querySelector('img');
    image.onerror = () => { image.hidden = true; };
    image.onload = () => { image.hidden = false; avatar.querySelector('span').hidden = true; };
    image.src = profileImageUrl(avatar.dataset.avatar);
  });
  thread.scrollTop = thread.scrollHeight;
}

async function openDirectThread(userId, name, role) {
  const parentStudents = role === 'parent'
    ? myStudents.filter((student) => student.status === 'active'
      && relatedUserId(student.parent) === String(userId))
    : [];
  activeMessageThread = { type: 'direct', userId: String(userId), name, role };
  setActiveInboxThread('direct', userId);
  showMessengerView('conversation');
  document.getElementById('threadWithName').textContent = name;
  document.getElementById('threadSubtitle').textContent = role === 'teacher' ? 'Teacher · Direct message' : 'Parent or guardian';
  document.getElementById('threadAvatar').innerHTML = `<i class="fa-solid ${role === 'teacher' ? 'fa-chalkboard-user' : 'fa-user'}"></i>`;
  document.getElementById('groupMembersSummary').hidden = true;
  const input = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendChatBtn');
  input.disabled = role === 'parent' && !parentStudents.length;
  sendButton.disabled = input.disabled;
  showMessageFeedback(document.getElementById('messageFormMessage'), '');
  const { messages } = await api.get(`/messages/thread/${encodeURIComponent(userId)}`);
  renderMessages(messages, false);
}

async function openGroupThread(groupId) {
  activeMessageThread = { type: 'group', groupId: String(groupId) };
  setActiveInboxThread('group', groupId);
  showMessengerView('conversation');
  document.getElementById('threadAvatar').innerHTML = '<i class="fa-solid fa-users"></i>';
  showMessageFeedback(document.getElementById('messageFormMessage'), '');
  const { conversation, messages } = await api.get(`/messages/groups/${encodeURIComponent(groupId)}`);
  activeMessageThread.name = conversation.name;
  document.getElementById('threadWithName').textContent = conversation.name;
  const familyCount = conversation.participants.filter((participant) => participant.role === 'parent').length;
  document.getElementById('threadSubtitle').textContent = `${familyCount} ${familyCount === 1 ? 'family' : 'families'} · ${conversation.students.length} assigned ${conversation.students.length === 1 ? 'student' : 'students'}`;
  const memberNames = conversation.participants.map((participant) => escapeTeacherHtml(participant.name));
  const members = document.getElementById('groupMembersSummary');
  members.textContent = `Members: ${memberNames.join(', ')}`;
  members.hidden = false;
  document.getElementById('chatInput').disabled = false;
  document.getElementById('sendChatBtn').disabled = false;
  renderMessages(messages, true);
}

function renderMessageContacts(contacts) {
  const results = document.getElementById('messageSearchResults');
  results.hidden = false;
  results.innerHTML = contacts.length ? contacts.map((contact, index) => {
    const description = contact.role === 'teacher'
      ? `Teacher${contact.assignedClass ? ` · ${contact.assignedClass}` : ''}`
      : `Parent of ${contact.students.map((student) => student.name).join(', ')}`;
    return `
      <button class="messenger-contact-result" type="button" data-contact-index="${index}">
        <span class="messenger-avatar"><i class="fa-solid ${contact.role === 'teacher' ? 'fa-chalkboard-user' : 'fa-user'}"></i></span>
        <span><strong>${escapeTeacherHtml(contact.name)}</strong><small>${escapeTeacherHtml(description)}</small></span>
      </button>
    `;
  }).join('') : '<div class="messenger-search-empty">No assigned parents or approved teachers found.</div>';

  results.querySelectorAll('[data-contact-index]').forEach((button) => button.addEventListener('click', async () => {
    const contact = contacts[Number(button.dataset.contactIndex)];
    results.hidden = true;
    document.getElementById('messageContactSearch').value = '';
    try {
      await openDirectThread(contact.id, contact.name, contact.role);
    } catch (err) {
      showMessageFeedback(document.getElementById('messageFormMessage'), err.message);
    }
  }));
}

document.getElementById('messageContactSearch').addEventListener('input', (event) => {
  clearTimeout(messageSearchTimer);
  const query = event.target.value.trim();
  const results = document.getElementById('messageSearchResults');
  const currentRequest = ++messageSearchRequest;
  if (!query) {
    results.hidden = true;
    results.innerHTML = '';
    return;
  }
  results.hidden = false;
  results.innerHTML = '<div class="messenger-search-empty">Searching contacts…</div>';
  messageSearchTimer = setTimeout(async () => {
    try {
      const response = await api.get(`/messages/contacts?q=${encodeURIComponent(query)}`);
      if (currentRequest === messageSearchRequest) renderMessageContacts(response.contacts);
    } catch (err) {
      if (currentRequest === messageSearchRequest) {
        results.innerHTML = `<div class="messenger-search-empty">${escapeTeacherHtml(err.message)}</div>`;
      }
    }
  }, 220);
});

function renderGroupStudents() {
  const students = myStudents.filter((student) => student.status === 'active'
    && student.parent
    && (!student.parent.status || student.parent.status === 'approved'));
  const list = document.getElementById('teacherGroupStudentList');
  list.innerHTML = students.length ? students.map((student) => `
    <label class="messenger-student-option">
      <input type="checkbox" name="groupStudent" value="${escapeTeacherHtml(student._id)}" />
      <span><strong>${escapeTeacherHtml(student.name)}</strong><small>${escapeTeacherHtml(student.className || 'Class not set')} · ${escapeTeacherHtml(student.parent.name || 'Parent')}</small></span>
    </label>
  `).join('') : '<div class="messenger-list-empty">No assigned students with an approved parent account are available for a family group.</div>';
}

document.getElementById('teacherNewGroupBtn').addEventListener('click', async () => {
  let loadError = null;
  if (!myStudents.length) {
    try {
      await loadMyStudents();
    } catch (err) {
      loadError = err;
    }
  }
  renderGroupStudents();
  document.getElementById('teacherGroupForm').reset();
  showMessageFeedback(document.getElementById('teacherGroupMessage'), '');
  document.getElementById('selectAllGroupStudents').textContent = 'Select all';
  document.querySelectorAll('#inboxList .messenger-conversation').forEach((row) => row.classList.remove('active'));
  showMessengerView('compose');
  if (loadError)   showMessageFeedback(document.getElementById('teacherGroupMessage'), loadError.message);
});

document.getElementById('selectAllGroupStudents').addEventListener('click', () => {
  const checkboxes = Array.from(document.querySelectorAll('#teacherGroupStudentList input[name="groupStudent"]'));
  const selectAll = checkboxes.some((checkbox) => !checkbox.checked);
  checkboxes.forEach((checkbox) => { checkbox.checked = selectAll; });
  document.getElementById('selectAllGroupStudents').textContent = selectAll ? 'Clear selection' : 'Select all';
});

document.getElementById('teacherGroupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const students = Array.from(document.querySelectorAll('#teacherGroupStudentList input[name="groupStudent"]:checked'))
    .map((checkbox) => checkbox.value);
  const message = document.getElementById('teacherGroupFirstMessage').value.trim();
  const button = document.getElementById('createTeacherGroupBtn');
  if (!students.length) {
    showMessageFeedback(document.getElementById('teacherGroupMessage'), 'Select at least one assigned student.');
    return;
  }
  if (!message) {
    showMessageFeedback(document.getElementById('teacherGroupMessage'), 'Write a first message for the group.');
    return;
  }
  button.disabled = true;
  showMessageFeedback(document.getElementById('teacherGroupMessage'), '');
  try {
    const { conversation } = await api.post('/messages/groups', {
      name: document.getElementById('teacherGroupName').value.trim(),
      students,
      content: message,
    });
    await openGroupThread(conversation._id);
    await loadInbox();
  } catch (err) {
    showMessageFeedback(document.getElementById('teacherGroupMessage'), err.message);
  } finally {
    button.disabled = false;
  }
});

function resizeMessageInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

['chatInput', 'teacherGroupFirstMessage'].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener('input', () => resizeMessageInput(input));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      input.form.requestSubmit();
    }
  });
});

document.getElementById('teacherMessageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const thread = activeMessageThread;
  const content = input.value.trim();
  if (!thread || !content) return;
  const sendButton = document.getElementById('sendChatBtn');
  sendButton.disabled = true;
  showMessageFeedback(document.getElementById('messageFormMessage'), '');
  try {
    if (thread.type === 'group') {
      await api.post(`/messages/groups/${encodeURIComponent(thread.groupId)}/messages`, { content });
    } else {
      await api.post('/messages', { receiver: thread.userId, content });
    }
    input.value = '';
    resizeMessageInput(input);
    if (thread.type === 'group') await openGroupThread(thread.groupId);
    else await openDirectThread(thread.userId, thread.name, thread.role);
    await loadInbox();
  } catch (err) {
    showMessageFeedback(document.getElementById('messageFormMessage'), err.message);
  } finally {
    sendButton.disabled = input.disabled;
  }
});

// ---------- Events Calendar ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  if (!teacherCalendar) {
    teacherCalendar = new EventsCalendar({
      containerId: 'teacherEventsCalendarContainer',
      events,
      canManage: true,
      onDeleteEvent: async (eventId) => {
        await api.del(`/events/${eventId}`);
        await loadEvents();
      },
      onEventUpdated: async (eventId, updates) => {
        await api.patch(`/events/${eventId}`, updates);
        await loadEvents();
      },
      canEditEvent: (event) => {
        const ownerId = event.createdBy?._id || event.createdBy;
        return String(ownerId) === String(user.id)
          && ['draft', 'pending', 'rejected'].includes(event.publicationStatus);
      },
      canDeleteEvent: (event) => {
        const ownerId = event.createdBy?._id || event.createdBy;
        return String(ownerId) === String(user.id)
          && event.publicationStatus === 'pending'
          && event.reviewStatus === 'pending';
      },
    });
  } else {
    teacherCalendar.setEvents(events);
  }
  renderEventStatusList(events, document.getElementById('teacherEventStatusList'));
}

document.getElementById('addEventBtn').addEventListener('click', async () => {
  try {
    await loadMyStudents();
    const classes = [...new Set(myStudents.map((student) => student.className).filter(Boolean))].sort();
    openEventComposer({
      classes,
      approvalRequired: true,
      onSave: (event) => api.post('/events', event),
      onComplete: async ({ event, emailSummary }) => {
        await loadEvents();
        const summaryTarget = document.getElementById('eventEmailSummary');
        summaryTarget.className = 'form-msg success';
        summaryTarget.textContent = event.publicationStatus === 'draft'
          ? 'Draft saved.'
          : (event.publicationStatus === 'pending'
            ? 'Submitted for admin approval. Selected recipients will be notified after approval.'
            : (event.emailRecipientCount === 0 ? 'Event saved, but no eligible recipients were found.' : formatEmailSummary(emailSummary)));
        if (event.publicationStatus === 'published' && !emailSummary.complete && event.emailRecipientCount) {
          await pollEmailSummary(`/events/${event._id}/email-summary`, emailSummary, summaryTarget);
        }
      },
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ---------- Pickup Verification Panel ----------
async function loadPickupPanel() {
  await loadMyStudents();
  const sel = document.getElementById('pickupStudentSelect');
  sel.innerHTML = myStudents.map((s) => `<option value="${escapeTeacherHtml(s._id)}">${escapeTeacherHtml(s.name)}${s.className ? ` (${escapeTeacherHtml(s.className)})` : ''}</option>`).join('');
  sel.disabled = !myStudents.length;
  sel.onchange = renderPickupList;
  document.getElementById('pickupStudentSearch').oninput = (event) => {
    const query = event.target.value.trim().toLowerCase();
    Array.from(sel.options).forEach((option) => { option.hidden = query && !option.textContent.toLowerCase().includes(query); });
  };
  if (myStudents.length) renderPickupList();
  else {
    document.getElementById('pickupList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students are assigned to you.</p></div>';
    document.getElementById('pickupHistory').innerHTML = '<div class="notification-empty">No verification records yet.</div>';
  }
}

async function renderPickupList() {
  const sid = document.getElementById('pickupStudentSelect').value;
  if (!sid) return;
  const { authorizations } = await api.get(`/pickup/student/${sid}`);
  const listEl = document.getElementById('pickupList');
  const student = myStudents.find((item) => item._id === sid);
  const initials = (student?.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  document.getElementById('pickupStudentSummary').innerHTML = student ? `<div class="pickup-student-card"><div class="pickup-student-initials" aria-hidden="true">${escapeTeacherHtml(initials)}</div><div><strong>${escapeTeacherHtml(student.name)}</strong><div class="info-meta">${escapeTeacherHtml(student.className || 'Class not assigned')}</div></div></div>` : '';

  listEl.innerHTML = authorizations.length ? authorizations.map((a) => `
    <div class="pickup-person-card">
      <label class="pickup-select-card" for="pickupPerson-${escapeTeacherHtml(a._id)}">
        <input id="pickupPerson-${escapeTeacherHtml(a._id)}" type="radio" name="pickupPerson" value="${escapeTeacherHtml(a._id)}" />
        <span><strong>${escapeTeacherHtml(a.authorizedName)}</strong><span class="info-meta" style="display:block;">${escapeTeacherHtml(a.relationship)} · ${escapeTeacherHtml(a.contact)}</span>${a.identification ? `<span class="info-meta" style="display:block;">${escapeTeacherHtml(a.identification)}</span>` : ''}<span class="badge ${a.verified.length ? 'approved' : 'pending'}" style="margin-top:6px;">${a.verified.length ? `${a.verified.length} prior verification${a.verified.length === 1 ? '' : 's'}` : 'No previous verification'}</span></span>
      </label>
      <div class="pickup-actions">
        <button class="btn btn-ghost btn-sm" data-edit-p="${a._id}" title="Edit Information">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-danger btn-sm" data-del-p="${a._id}" title="Remove Person">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  `).join('') + `
    <label class="pickup-select-card" for="pickupNotListed"><input id="pickupNotListed" type="radio" name="pickupPerson" value="not-listed" /><span><strong>Not on the list</strong><span class="info-meta" style="display:block;">Do not release the pupil. Contact the parent or an administrator.</span></span></label>
  ` : `
    <div class="empty-state"><i class="fa-solid fa-shield-halved"></i><p>No authorized pickup people are listed for this pupil.</p></div>
    <label class="pickup-select-card" for="pickupNotListed"><input id="pickupNotListed" type="radio" name="pickupPerson" value="not-listed" /><span><strong>Not on the list</strong><span class="info-meta" style="display:block;">Do not release the pupil. Contact the parent or an administrator.</span></span></label>
  `;

  const history = authorizations.flatMap((authorization) => (authorization.verified || []).map((entry) => ({
    date: entry.date,
    person: authorization.authorizedName,
    teacher: String(entry.verifiedBy || '') === String(user.id) ? user.name : 'Staff',
  }))).sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 20);
  document.getElementById('pickupHistory').innerHTML = history.length ? `
    <table class="pickup-history"><thead><tr><th>Date</th><th>Pupil</th><th>Person</th><th>Result</th><th>Teacher</th></tr></thead><tbody>
      ${history.map((entry) => `<tr><td>${new Date(entry.date).toLocaleString()}</td><td>${escapeTeacherHtml(student?.name || '—')}</td><td>${escapeTeacherHtml(entry.person)}</td><td><span class="badge approved">Authorized</span></td><td>${escapeTeacherHtml(entry.teacher)}</td></tr>`).join('')}
    </tbody></table>
  ` : '<div class="notification-empty">No authorized pickup verifications recorded for this pupil yet.</div>';

  document.getElementById('pickupResult').className = 'form-msg';
  document.getElementById('pickupResult').textContent = '';
  document.getElementById('pickupAuthorizeBtn').onclick = () => reviewPickupDecision('authorized', authorizations, sid);
  document.getElementById('pickupDenyBtn').onclick = () => reviewPickupDecision('denied', authorizations, sid);

  // Bind Edit button
  listEl.querySelectorAll('[data-edit-p]').forEach((b) => b.addEventListener('click', () => {
    const item = authorizations.find((x) => x._id === b.dataset.editP);
    if (item) {
      openPickupFormModal({ studentId: sid, pickup: item }, renderPickupList);
    }
  }));

  // Bind Delete button
  listEl.querySelectorAll('[data-del-p]').forEach((b) => b.addEventListener('click', async () => {
    const item = authorizations.find((x) => x._id === b.dataset.delP);
    if (item && confirm(`Remove ${item.authorizedName} from authorized pickup list?`)) {
      await api.del(`/pickup/${item._id}`);
      renderPickupList();
    }
  }));
}

function reviewPickupDecision(result, authorizations, studentId) {
  const selectedId = document.querySelector('input[name="pickupPerson"]:checked')?.value;
  const selected = authorizations.find((item) => item._id === selectedId);
  const isListed = Boolean(selected);
  const message = result === 'authorized'
    ? (isListed ? `Confirm that ${selected.authorizedName} is authorized to collect ${myStudents.find((student) => student._id === studentId)?.name || 'this pupil'}.` : 'Choose a listed authorized person before releasing the pupil.')
    : (selectedId === 'not-listed' || !isListed
      ? 'Do not release this pupil. Contact the parent or an administrator. This outcome cannot be recorded by the current pickup API.'
      : `Do not release the pupil if you are uncertain about ${selected.authorizedName}. The current pickup API only records authorized verifications.`);
  if (result === 'authorized' && !isListed) {
    showMsg(document.getElementById('pickupResult'), message);
    return;
  }
  const heading = result === 'authorized' ? 'Confirm Authorized Pickup' : 'Confirm Do Not Release';
  const actionLabel = result === 'authorized' ? 'Confirm and record' : 'Confirm decision';
  Modal.open(`<h3>${heading}</h3><p>${escapeTeacherHtml(message)}</p><div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelPickupDecision">Cancel</button><button type="button" class="btn ${result === 'authorized' ? 'pickup-authorized' : 'pickup-denied'}" id="confirmPickupDecision">${actionLabel}</button></div>`);
  document.getElementById('cancelPickupDecision').addEventListener('click', () => Modal.close());
  document.getElementById('confirmPickupDecision').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (result === 'denied') {
      Modal.close();
      showMsg(document.getElementById('pickupResult'), `${message} No denial record was saved.`, 'error');
      return;
    }
    setButtonLoading(button, true, 'Recording');
    try {
      await api.post(`/pickup/${selected._id}/verify`, {});
      Modal.close();
      const verifiedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      await renderPickupList();
      showMsg(document.getElementById('pickupResult'), `Pickup verified at ${verifiedAt}. Authorized, release pupil.`, 'success');
      showToast(`Pickup verified for ${selected.authorizedName}.`);
    } catch (err) {
      showMsg(document.getElementById('pickupResult'), err.message);
      setButtonLoading(button, false);
    }
  });
}

document.getElementById('teacherAddPickupBtn')?.addEventListener('click', () => {
  const sid = document.getElementById('pickupStudentSelect').value;
  if (!sid) return alert('Please select a student first.');
  openPickupFormModal({ studentId: sid }, renderPickupList);
});

// ---------- Emergency Alerts ----------
async function loadAlerts() {
  await loadMyStudents();
  const activeStudents = myStudents.filter((student) => student.status === 'active');
  if (!teacherAudiencePicker) {
    teacherAudiencePicker = createEmergencyAudiencePicker({
      containerId: 'teacherEmergencyAudience',
      students: activeStudents,
      wholeDescription: 'All active pupils in your assigned roster',
    });
  }
  await renderTeacherAlerts();
}

async function renderTeacherAlerts() {
  const { alerts } = await api.get(`/alerts?view=${teacherAlertView}`);
  document.getElementById('alertsList').innerHTML = alerts.length ? alerts.map((a) => `
    <div class="alert-banner">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong style="font-size:15px;">${escapeTeacherHtml(a.title)}</strong>
        <p style="margin:4px 0 6px; color:#7F1D1D;">${escapeTeacherHtml(a.description || a.message)}</p>
        <div class="field-hint" style="color:#991B1B;">
          ${new Date(a.createdAt).toLocaleString()} · ${escapeTeacherHtml(a.severity || 'high')} · ${a.acknowledgements?.length || 0} acknowledged · Issued by ${escapeTeacherHtml(a.createdBy ? a.createdBy.name : 'Staff')}
        </div>
        ${a.safetyInstructions ? `<p>${escapeTeacherHtml(a.safetyInstructions)}</p>` : ''}
        <div class="event-form-actions">
          ${teacherAlertView === 'archived' && a.status === 'archived' ? `<button type="button" class="btn btn-secondary btn-sm" data-alert-restore="${escapeTeacherHtml(a._id)}">Restore</button>` : ''}
          ${a.status !== 'deleted' ? `${teacherAlertView === 'active' ? `<button type="button" class="btn btn-ghost btn-sm" data-alert-archive="${escapeTeacherHtml(a._id)}">Archive</button>` : ''}<button type="button" class="btn btn-danger btn-sm" data-alert-delete="${escapeTeacherHtml(a._id)}">Delete</button>` : '<span class="badge status-badge-rejected">Soft deleted</span>'}
          ${teacherAlertView === 'active' && a.status !== 'all-clear' && a.status !== 'deleted' ? `<button type="button" class="btn btn-secondary btn-sm" data-alert-update="${escapeTeacherHtml(a._id)}">Send update</button><button type="button" class="btn btn-ghost btn-sm" data-alert-clear="${escapeTeacherHtml(a._id)}">Send all-clear</button>` : ''}
        </div>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><i class="fa-solid fa-shield-heart"></i><p>No emergency alerts issued.</p></div>';

  bindTeacherAlertManagement();
  document.querySelectorAll('[data-alert-update]').forEach((button) => button.addEventListener('click', async () => {
    openTeacherAlertFollowup(button.dataset.alertUpdate, 'update');
  }));
  document.querySelectorAll('[data-alert-clear]').forEach((button) => button.addEventListener('click', async () => {
    openTeacherAlertFollowup(button.dataset.alertClear, 'all-clear');
  }));
}

document.querySelectorAll('[data-teacher-alert-view]').forEach((button) => button.addEventListener('click', async () => {
  teacherAlertView = button.dataset.teacherAlertView;
  document.querySelectorAll('[data-teacher-alert-view]').forEach((tab) => {
    const active = tab.dataset.teacherAlertView === teacherAlertView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  try { await renderTeacherAlerts(); } catch (error) { showToast(error.message, 'error'); }
}));

function bindTeacherAlertManagement() {
  document.querySelectorAll('[data-alert-archive]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Archive this emergency alert? It will leave the active list and can be restored later. Email logs and acknowledgments will remain.')) return;
    try {
      await api.patch(`/alerts/${button.dataset.alertArchive}/archive`, {});
      showToast('Emergency alert archived.', 'info');
      await renderTeacherAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-alert-restore]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.patch(`/alerts/${button.dataset.alertRestore}/restore`, {});
      showToast('Emergency alert restored.');
      await renderTeacherAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
  document.querySelectorAll('[data-alert-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Soft-delete this alert? It will remain in the Archived tab marked as deleted. The alert, acknowledgments, and email logs are retained.')) return;
    try {
      await api.del(`/alerts/${button.dataset.alertDelete}`);
      showToast('Emergency alert soft-deleted.', 'info');
      await renderTeacherAlerts();
    } catch (error) { showToast(error.message, 'error'); }
  }));
}

function openTeacherAlertFollowup(alertId, status) {
  const allClear = status === 'all-clear';
  Modal.open(`<h3>${allClear ? 'Send All-Clear' : 'Send Emergency Update'}</h3><div class="field"><label for="teacherAlertFollowup">Message <span class="required-mark" aria-hidden="true">*</span></label><textarea id="teacherAlertFollowup" rows="4" required></textarea><small id="teacherAlertFollowupError" class="field-error"></small></div><div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelTeacherAlertFollowup">Cancel</button><button type="button" class="btn ${allClear ? 'btn-primary' : 'btn-danger'}" id="sendTeacherAlertFollowup">${allClear ? 'Send All-Clear' : 'Send Update'}</button></div>`);
  document.getElementById('cancelTeacherAlertFollowup').addEventListener('click', () => Modal.close());
  document.getElementById('sendTeacherAlertFollowup').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const message = document.getElementById('teacherAlertFollowup').value.trim();
    if (!message) {
      document.getElementById('teacherAlertFollowupError').textContent = 'Enter an update message.';
      return;
    }
    setButtonLoading(button, true, 'Sending');
    try {
      await api.post(`/alerts/${alertId}/updates`, { message, status });
      Modal.close();
      showToast(allClear ? 'All-clear notice sent.' : 'Emergency update sent.');
      await loadAlerts();
    } catch (error) {
      showMsg(document.getElementById('teacherAlertFollowupError'), error.message);
      setButtonLoading(button, false);
    }
  });
}

document.getElementById('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!teacherAudiencePicker?.validate()) return;
  const audience = teacherAudiencePicker.getSelection();
  const targets = teacherAudiencePicker.getTargetStudents();
  const formValues = {
    emergencyType: document.getElementById('aType').value,
    title: document.getElementById('aTitle').value.trim(),
    severity: document.querySelector('input[name="teacherAlertSeverity"]:checked').value,
    description: document.getElementById('aMessage').value.trim(),
    safetyInstructions: document.getElementById('aInstructions').value.trim(),
  };
  const fieldErrors = {
    type: formValues.emergencyType ? '' : 'Select an emergency type.',
    title: formValues.title ? '' : 'Alert title is required.',
    description: formValues.description ? '' : 'Description is required.',
    instructions: formValues.safetyInstructions ? '' : 'Safety instructions are required.',
  };
  Object.entries(fieldErrors).forEach(([field, message]) => {
    document.querySelector(`[data-teacher-alert-error="${field}"]`).textContent = message;
    document.querySelector(`[data-teacher-alert-field="${field}"]`).classList.toggle('has-error', Boolean(message));
  });
  if (Object.values(fieldErrors).some(Boolean)) {
    document.querySelector('.has-error input, .has-error textarea, .has-error select')?.focus();
    return;
  }
  const parents = new Map();
  targets.forEach((student) => {
    if (student.parent) parents.set(relatedUserId(student.parent), student.parent);
  });
  const contactRows = Array.from(parents.values()).map((parent) => `
    <li>${escapeTeacherHtml(parent.name)} · ${escapeTeacherHtml(parent.email || 'No email')} · ${parent.emailVerified && parent.emailVerifiedBy ? 'Verified' : 'Not verified'}</li>
  `).join('');
  const emailEligible = [...parents.values()].filter((parent) => parent && typeof parent === 'object'
    && parent.status === 'approved' && parent.email && parent.emailVerified && parent.emailVerifiedBy).length;
  Modal.open(`
    <h3>Review Emergency Alert</h3>
    <p class="alert-banner"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>This will immediately notify parents by email.</span></p>
    <p><strong>${escapeTeacherHtml(formValues.title)}</strong> · ${escapeTeacherHtml(formValues.severity)}</p>
    <p>${escapeTeacherHtml(formValues.description)}</p>
    <p><strong>Safety instructions:</strong> ${escapeTeacherHtml(formValues.safetyInstructions)}</p>
    <p><strong>Affected pupils:</strong> ${targets.map((student) => escapeTeacherHtml(student.name)).join(', ') || 'None found'}</p>
    <p><strong>Classes:</strong> ${escapeTeacherHtml([...new Set(targets.map((student) => student.className).filter(Boolean))].join(', ') || 'Individual pupils')}</p>
    <p><strong>Parent contacts:</strong> ${parents.size} linked; ${emailEligible} eligible email addresses</p>
    <ul>${contactRows || '<li>No linked parent accounts; use another contact method.</li>'}</ul>
    <div id="alertReviewMessage" class="form-msg" aria-live="polite"></div>
    <div class="event-form-actions"><button type="button" class="btn btn-ghost" id="cancelAlertReview">Cancel</button><button type="button" class="btn btn-danger" id="confirmAlertSend"><i class="fa-solid fa-triangle-exclamation"></i> Confirm and send</button></div>
  `);
  document.getElementById('cancelAlertReview').addEventListener('click', () => Modal.close());
  document.getElementById('confirmAlertSend').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonLoading(button, true, 'Sending');
    const reviewMessage = document.getElementById('alertReviewMessage');
    try {
      const response = await api.post('/alerts', {
        title: formValues.title,
        emergencyType: formValues.emergencyType,
        severity: formValues.severity,
        description: formValues.description,
        safetyInstructions: formValues.safetyInstructions,
        students: audience.students,
        affectedClasses: audience.affectedClasses,
      });
      const summary = await pollEmailSummary(`/alerts/${response.alert._id}/email-summary`, response.emailSummary, reviewMessage);
      showMsg(reviewMessage, formatEmailSummary(summary), 'success');
      const emailSummary = document.getElementById('teacherAlertEmailSummary');
      emailSummary.className = 'form-msg success';
      emailSummary.textContent = `Emergency alert email summary: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped.`;
      showToast(emailSummary.textContent, summary.failed ? 'error' : 'success');
      document.getElementById('alertForm').reset();
      document.querySelectorAll('[data-teacher-alert-error]').forEach((node) => { node.textContent = ''; });
      document.querySelectorAll('[data-teacher-alert-field]').forEach((node) => node.classList.remove('has-error'));
      teacherAudiencePicker = createEmergencyAudiencePicker({ containerId: 'teacherEmergencyAudience', students: myStudents.filter((student) => student.status === 'active'), wholeDescription: 'All active pupils in your assigned roster' });
      await loadAlerts();
    } catch (err) {
      showMsg(reviewMessage, err.message);
      setButtonLoading(button, false);
    }
  });
});

loadOverview();
