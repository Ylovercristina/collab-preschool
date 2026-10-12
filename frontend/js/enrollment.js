function enrollmentEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function enrollmentDateValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadAdminEnrollment() {
  const message = document.getElementById('adminEnrollmentMessage');
  const status = document.getElementById('adminEnrollmentStatus');
  try {
    const [{ period }, { applications }] = await Promise.all([
      api.get('/enrollment/availability'),
      api.get('/enrollment/applications'),
    ]);
    document.getElementById('enrollmentTerm').value = period?.term || '';
    document.getElementById('enrollmentSchoolYear').value = period?.schoolYear || '';
    document.getElementById('enrollmentOpensAt').value = enrollmentDateValue(period?.opensAt);
    document.getElementById('enrollmentClosesAt').value = enrollmentDateValue(period?.closesAt);
    document.getElementById('enrollmentEnabled').checked = period ? period.enabled : true;
    status.textContent = period
      ? `Current setting: ${period.term} ${period.schoolYear} — ${period.enabled ? 'enabled' : 'disabled'} (${fmtDate(period.opensAt)} to ${fmtDate(period.closesAt)}).`
      : 'No enrollment period is configured yet.';

    const container = document.getElementById('adminEnrollmentApplications');
    container.innerHTML = applications.length ? `
      <table>
        <thead><tr><th>Student</th><th>Parent / Guardian</th><th>Submitted by</th><th>Term</th><th>Class requested</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${applications.map((application) => `
          <tr>
            <td><strong>${enrollmentEscape(application.studentName)}</strong><div style="font-size:12px;color:var(--ink-muted);">Born ${fmtDate(application.birthdate)}</div></td>
            <td>${enrollmentEscape(application.guardianName || application.parent?.name || '—')}<div style="font-size:12px;color:var(--ink-muted);">${enrollmentEscape(application.guardianPhone || application.parent?.phone || '')}</div></td>
            <td>${enrollmentEscape(application.applicant?.name || application.parent?.name || '—')}<div style="font-size:12px;color:var(--ink-muted);">${enrollmentEscape(application.submittedRole || 'parent')}</div></td>
            <td>${enrollmentEscape(application.term)} ${enrollmentEscape(application.schoolYear)}</td>
            <td>${enrollmentEscape(application.requestedClass || 'No preference')}</td>
            <td>${fmtDate(application.createdAt)}</td>
            <td><span class="badge ${application.status === 'approved' ? 'approved' : application.status === 'rejected' ? 'archived' : 'pending'}">${enrollmentEscape(application.status)}</span></td>
            <td>${application.status === 'pending' ? `<div style="display:flex;gap:6px;"><button class="btn btn-primary btn-sm" data-enrollment-review="${application._id}" data-enrollment-status="approved">Approve</button><button class="btn btn-ghost btn-sm" data-enrollment-review="${application._id}" data-enrollment-status="rejected">Reject</button></div>` : application.student ? `Student: ${enrollmentEscape(application.student.studentId || application.student.name)}` : '—'}</td>
          </tr>
          ${application.notes ? `<tr><td colspan="8" style="font-size:13px;color:var(--ink-muted);">Additional information: ${enrollmentEscape(application.notes)}</td></tr>` : ''}
        `).join('')}</tbody>
      </table>
    ` : '<div class="empty-state"><i class="fa-solid fa-file-circle-question"></i><p>No enrollment applications have been submitted.</p></div>';
  } catch (err) {
    showMsg(message, err.message);
  }
}

document.getElementById('enrollmentPeriodForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('adminEnrollmentMessage');
  message.textContent = '';
  try {
    await api.put('/enrollment/period', {
      term: document.getElementById('enrollmentTerm').value.trim(),
      schoolYear: document.getElementById('enrollmentSchoolYear').value.trim(),
      opensAt: document.getElementById('enrollmentOpensAt').value,
      closesAt: document.getElementById('enrollmentClosesAt').value,
      enabled: document.getElementById('enrollmentEnabled').checked,
    });
    showMsg(message, 'Enrollment availability saved.', 'success');
    await loadAdminEnrollment();
  } catch (err) {
    showMsg(message, err.message);
  }
});

document.getElementById('adminEnrollmentApplications')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-enrollment-review]');
  if (!button) return;
  const action = button.dataset.enrollmentStatus;
  const prompt = action === 'approved'
    ? 'Approve this application and add the student to the active roster?'
    : 'Reject this enrollment application?';
  if (!confirm(prompt)) return;
  try {
    await api.patch(`/enrollment/applications/${button.dataset.enrollmentReview}`, { status: action });
    await loadAdminEnrollment();
  } catch (err) {
    showMsg(document.getElementById('adminEnrollmentMessage'), err.message);
  }
});

async function loadParentEnrollment() {
  return loadEnrollmentPanel('parent');
}

async function loadTeacherEnrollment() {
  return loadEnrollmentPanel('teacher');
}

async function loadEnrollmentPanel(role) {
  const isTeacher = role === 'teacher';
  const prefix = isTeacher ? 'teacher' : 'parent';
  const availability = document.getElementById(`${prefix}EnrollmentAvailability`);
  const formContainer = document.getElementById(`${prefix}EnrollmentFormContainer`);
  const applicationsContainer = document.getElementById(`${prefix}EnrollmentApplications`);
  availability.innerHTML = '<p>Checking enrollment availability…</p>';
  formContainer.innerHTML = '';
  applicationsContainer.innerHTML = '';
  try {
    const result = await api.get('/enrollment/availability');
    if (result.available) {
      availability.innerHTML = `<div class="card" style="margin-bottom:16px;"><strong>Applications open:</strong> ${enrollmentEscape(result.period.term)} ${enrollmentEscape(result.period.schoolYear)}<div style="font-size:13px;color:var(--ink-muted);margin-top:4px;">Apply by ${fmtDate(result.period.closesAt)}.</div></div>`;
      formContainer.innerHTML = `
        <div class="card" style="max-width:760px;margin-bottom:20px;">
          <h3 style="margin-top:0;">Enrollment application</h3>
          <div id="${prefix}EnrollmentMessage" class="form-msg" aria-live="polite"></div>
          <form id="${prefix}EnrollmentForm">
            <div class="grid-2">
              <div class="field"><label for="applicationStudentName">Student full name</label><input id="applicationStudentName" maxlength="120" required /></div>
              <div class="field"><label for="applicationBirthdate">Birthdate</label><input id="applicationBirthdate" type="date" required /></div>
              ${isTeacher ? '<div class="field"><label for="applicationGuardianName">Parent / guardian full name</label><input id="applicationGuardianName" maxlength="120" required /></div>' : ''}
              <div class="field"><label for="applicationClass">Preferred class / group (optional)</label><input id="applicationClass" maxlength="80" /></div>
              <div class="field"><label for="applicationPhone">Guardian contact number (optional)</label><input id="applicationPhone" maxlength="30" /></div>
            </div>
            <div class="field"><label for="applicationNotes">Additional information (optional)</label><textarea id="applicationNotes" rows="3" maxlength="1000"></textarea></div>
            <button class="btn btn-primary" type="submit"><i class="fa-solid fa-paper-plane"></i> Submit application</button>
          </form>
        </div>`;
      document.getElementById(`${prefix}EnrollmentForm`).addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = document.getElementById(`${prefix}EnrollmentMessage`);
        try {
          await api.post('/enrollment/applications', {
            studentName: document.getElementById('applicationStudentName').value.trim(),
            birthdate: document.getElementById('applicationBirthdate').value,
            guardianName: isTeacher ? document.getElementById('applicationGuardianName').value.trim() : undefined,
            requestedClass: document.getElementById('applicationClass').value.trim(),
            guardianPhone: document.getElementById('applicationPhone').value.trim(),
            notes: document.getElementById('applicationNotes').value.trim(),
          });
          showMsg(message, isTeacher ? 'Enrollment application submitted for admin review.' : 'Your enrollment application has been submitted.', 'success');
          event.target.reset();
          await loadEnrollmentPanel(role);
        } catch (err) {
          showMsg(message, err.message);
        }
      });
    } else {
      const periodLabel = result.period
        ? `Enrollment for ${enrollmentEscape(result.period.term)} ${enrollmentEscape(result.period.schoolYear)} is not currently open.`
        : 'There is no available enrollment term at this time.';
      availability.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>${periodLabel} Please check back when the school opens applications.</p></div>`;
    }

    const applications = result.applications || [];
    applicationsContainer.innerHTML = applications.length ? `
      <h2 style="font-size:19px;">Your applications</h2>
      <div class="table-responsive"><table><thead><tr><th>Student</th><th>Term</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
        ${applications.map((application) => `<tr><td>${enrollmentEscape(application.studentName)}</td><td>${enrollmentEscape(application.term)} ${enrollmentEscape(application.schoolYear)}</td><td>${fmtDate(application.createdAt)}</td><td><span class="badge ${application.status === 'approved' ? 'approved' : application.status === 'rejected' ? 'archived' : 'pending'}">${enrollmentEscape(application.status)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '';
  } catch (err) {
    availability.innerHTML = `<div class="form-msg error">${enrollmentEscape(err.message)}</div>`;
  }
}
