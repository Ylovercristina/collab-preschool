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

function setAdminEnrollmentView(view) {
  document.querySelectorAll('.enrollment-category-tab').forEach((tab) => {
    const active = tab.dataset.enrollmentView === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.enrollment-view').forEach((panel) => {
    const active = panel.id === `enrollment${view.charAt(0).toUpperCase()}${view.slice(1)}View`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

document.querySelector('.enrollment-category-tabs')?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-enrollment-view]');
  if (tab) setAdminEnrollmentView(tab.dataset.enrollmentView);
});

let enrollmentSavedMessageTimeout;
let adminSavedEnrollmentPeriod = null;

function clearEnrollmentPeriodForm() {
  const form = document.getElementById('enrollmentPeriodForm');
  form.reset();
  ['enrollmentTerm', 'enrollmentSchoolYear', 'enrollmentOpensAt', 'enrollmentClosesAt'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('enrollmentEnabled').checked = true;
  document.getElementById('enrollmentSubmitButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save changes';
  document.getElementById('cancelEnrollmentEdit').hidden = true;
}

function editAdminSavedPeriod() {
  if (!adminSavedEnrollmentPeriod) return;
  document.getElementById('enrollmentTerm').value = adminSavedEnrollmentPeriod.term;
  document.getElementById('enrollmentSchoolYear').value = adminSavedEnrollmentPeriod.schoolYear;
  document.getElementById('enrollmentOpensAt').value = enrollmentDateValue(adminSavedEnrollmentPeriod.opensAt);
  document.getElementById('enrollmentClosesAt').value = enrollmentDateValue(adminSavedEnrollmentPeriod.closesAt);
  document.getElementById('enrollmentEnabled').checked = adminSavedEnrollmentPeriod.enabled;
  document.getElementById('enrollmentSubmitButton').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update availability';
  document.getElementById('cancelEnrollmentEdit').hidden = false;
  document.getElementById('enrollmentTerm').focus();
}

function renderAdminSavedPeriod(period) {
  const container = document.getElementById('adminEnrollmentSavedPeriod');
  adminSavedEnrollmentPeriod = period;
  if (!period) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const now = new Date();
  const opensAt = new Date(period.opensAt);
  const closesAt = new Date(period.closesAt);
  const started = Boolean(period.startedAt);
  const completed = closesAt < now;
  const accepting = started && period.enabled && opensAt <= now && closesAt >= now;
  const scheduled = started && opensAt > now && !completed;
  const canStart = period.enabled && closesAt >= now;
  const state = completed
    ? 'Enrollment ended'
    : accepting
      ? 'Enrollment in progress'
      : scheduled
        ? 'Scheduled'
        : started && !period.enabled
          ? 'Paused'
          : started
            ? 'Started'
            : 'Saved · not started';
  const stateClass = accepting ? 'is-open' : 'is-closed';
  const showStartButton = !started && !completed;

  container.hidden = false;
  container.innerHTML = `
    <div class="enrollment-saved-period-heading">
      <div>
        <span class="enrollment-section-label">SAVED AVAILABILITY</span>
        <h2>${enrollmentEscape(period.term)} <span>${enrollmentEscape(period.schoolYear)}</span></h2>
        <p>${fmtDate(period.opensAt)} – ${fmtDate(period.closesAt)}</p>
      </div>
      <span class="enrollment-settings-status ${stateClass}">${enrollmentEscape(state)}</span>
    </div>
    <div class="enrollment-saved-period-footer">
      <p>${showStartButton
        ? canStart
          ? 'Applications will not appear to families or staff until enrollment is started.'
          : 'Enable applications and choose a closing date in the future before starting enrollment.'
        : accepting
          ? 'Parents and teachers can now submit applications for admin review.'
          : completed
            ? 'This enrollment period has ended. Approved applications are listed below.'
            : scheduled
              ? 'Enrollment has started and will open to families on the scheduled date.'
              : period.enabled
                ? 'This saved period is active in the enrollment workflow.'
                : 'Applications are disabled for this period.'}</p>
      <div class="enrollment-saved-period-actions">
        <button type="button" id="editEnrollmentAvailability" class="btn btn-ghost btn-sm"><i class="fa-solid fa-pen"></i> Edit availability</button>
        ${showStartButton && canStart ? '<button type="button" id="adminStartEnrollment" class="btn btn-primary"><i class="fa-solid fa-play"></i> Start Enrollment</button>' : ''}
      </div>
    </div>`;
}

async function loadAdminEnrollment() {
  const message = document.getElementById('adminEnrollmentMessage');
  const status = document.getElementById('adminEnrollmentStatus');
  try {
    const [{ period }, { applications }] = await Promise.all([
      api.get('/enrollment/availability'),
      api.get('/enrollment/applications'),
    ]);
    renderAdminSavedPeriod(period);
    const availabilityBadge = document.getElementById('adminEnrollmentAvailabilityBadge');
    const currentlyOpen = Boolean(
      period
      && period.startedAt
      && period.enabled
      && new Date(period.opensAt) <= new Date()
      && new Date(period.closesAt) >= new Date()
    );
    availabilityBadge.className = `enrollment-settings-status ${currentlyOpen ? 'is-open' : 'is-closed'}`;
    const badgeText = !period
      ? 'Not configured'
      : currentlyOpen
        ? 'Accepting applications'
        : new Date(period.closesAt) < new Date()
          ? 'Enrollment ended'
          : period.startedAt && !period.enabled
            ? 'Enrollment paused'
            : period.startedAt && new Date(period.opensAt) > new Date()
              ? 'Scheduled'
          : period.startedAt
            ? 'Enrollment started'
            : 'Saved · not started';
    availabilityBadge.innerHTML = `<i class="fa-solid ${currentlyOpen ? 'fa-circle-check' : 'fa-circle-minus'}"></i> ${badgeText}`;
    status.textContent = period
      ? `Saved availability: ${period.term} ${period.schoolYear} — ${fmtDate(period.opensAt)} to ${fmtDate(period.closesAt)}.`
      : 'No enrollment period is configured yet.';

    const container = document.getElementById('adminEnrollmentApplications');
    const applicationCounts = applications.reduce((counts, application) => {
      counts[application.status] = (counts[application.status] || 0) + 1;
      return counts;
    }, {});
    const completedApplications = applications.filter((application) => application.status === 'approved');
    document.getElementById('adminEnrollmentCompletedCount').textContent = `${completedApplications.length} ${completedApplications.length === 1 ? 'student' : 'students'}`;
    document.getElementById('enrollmentCompletedTabCount').textContent = completedApplications.length;
    document.getElementById('enrollmentPendingTabCount').textContent = applications.filter((application) => ['pending', 'approving'].includes(application.status)).length;
    document.getElementById('adminEnrollmentCompleted').innerHTML = completedApplications.length ? `
      <div class="table-responsive"><table>
        <thead><tr><th>Student</th><th>Student ID</th><th>Parent / Guardian</th><th>Class</th><th>Enrolled</th></tr></thead>
        <tbody>${completedApplications.map((application) => `
          <tr>
            <td><strong>${enrollmentEscape(application.student?.name || application.studentName)}</strong><div style="font-size:12px;color:var(--ink-muted);">Born ${fmtDate(application.birthdate)}</div></td>
            <td>${enrollmentEscape(application.student?.studentId || '—')}</td>
            <td>${enrollmentEscape(application.guardianName || application.parent?.name || '—')}</td>
            <td>${enrollmentEscape(application.student?.className || application.requestedClass || 'Unassigned')}</td>
            <td>${fmtDate(application.student?.enrollmentDate || application.reviewedAt)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="enrollment-no-applications"><i class="fa-regular fa-circle-check"></i><div><strong>No completed enrollments yet</strong><p>Approved student records will appear here.</p></div></div>';
    document.getElementById('adminEnrollmentApplicationCounts').innerHTML = `
      <span>${applications.length} total</span>
      <span>${applicationCounts.pending || 0} pending</span>
      <span>${applicationCounts.approved || 0} approved</span>
      <span>${applicationCounts.rejected || 0} rejected</span>`;
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
            <td><span class="badge ${application.status === 'approved' ? 'approved' : application.status === 'rejected' ? 'archived' : 'pending'}">${enrollmentEscape(application.status === 'approving' ? 'approval in progress' : application.status)}</span></td>
            <td>${application.status === 'pending' ? `<div class="enrollment-review-actions"><button class="btn btn-primary btn-sm" data-enrollment-review="${application._id}" data-enrollment-status="approved">Approve</button><button class="btn btn-ghost btn-sm" data-enrollment-review="${application._id}" data-enrollment-status="rejected">Reject</button></div>` : application.status === 'approving' ? `<button class="btn btn-primary btn-sm" data-enrollment-review="${application._id}" data-enrollment-status="approved">Resume approval</button>` : application.student ? `Student: ${enrollmentEscape(application.student.studentId || application.student.name)}` : '—'}</td>
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
  window.clearTimeout(enrollmentSavedMessageTimeout);
  message.textContent = '';
  message.className = 'form-msg';
  try {
    await api.put('/enrollment/period', {
      term: document.getElementById('enrollmentTerm').value.trim(),
      schoolYear: document.getElementById('enrollmentSchoolYear').value.trim(),
      opensAt: document.getElementById('enrollmentOpensAt').value,
      closesAt: document.getElementById('enrollmentClosesAt').value,
      enabled: document.getElementById('enrollmentEnabled').checked,
    });
    clearEnrollmentPeriodForm();
    showMsg(message, 'Enrollment availability saved.', 'success');
    window.clearTimeout(enrollmentSavedMessageTimeout);
    enrollmentSavedMessageTimeout = window.setTimeout(() => {
      message.textContent = '';
      message.className = 'form-msg';
    }, 3500);
    await loadAdminEnrollment();
  } catch (err) {
    showMsg(message, err.message);
  }
});

document.getElementById('adminEnrollmentSavedPeriod')?.addEventListener('click', async (event) => {
  if (event.target.closest('#editEnrollmentAvailability')) {
    editAdminSavedPeriod();
    return;
  }
  const button = event.target.closest('#adminStartEnrollment');
  if (!button) return;
  button.disabled = true;
  try {
    await api.patch('/enrollment/period/start', {});
    showMsg(document.getElementById('adminEnrollmentMessage'), 'Enrollment has been started.', 'success');
    window.clearTimeout(enrollmentSavedMessageTimeout);
    enrollmentSavedMessageTimeout = window.setTimeout(() => {
      const message = document.getElementById('adminEnrollmentMessage');
      message.textContent = '';
      message.className = 'form-msg';
    }, 3500);
    await loadAdminEnrollment();
    setAdminEnrollmentView('applications');
  } catch (err) {
    showMsg(document.getElementById('adminEnrollmentMessage'), err.message);
    button.disabled = false;
  }
});

document.getElementById('cancelEnrollmentEdit')?.addEventListener('click', () => {
  clearEnrollmentPeriodForm();
  document.getElementById('adminEnrollmentStatus').textContent = adminSavedEnrollmentPeriod
    ? `Saved availability: ${adminSavedEnrollmentPeriod.term} ${adminSavedEnrollmentPeriod.schoolYear} — ${fmtDate(adminSavedEnrollmentPeriod.opensAt)} to ${fmtDate(adminSavedEnrollmentPeriod.closesAt)}.`
    : 'No enrollment period is configured yet.';
});

document.getElementById('adminEnrollmentApplications')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-enrollment-review]');
  if (!button) return;
  const action = button.dataset.enrollmentStatus;
  const prompt = action === 'approved'
    ? 'Approve this application and add the student to the active roster?'
    : 'Reject this enrollment application?';
  if (!confirm(prompt)) return;
  button.disabled = true;
  try {
    await api.patch(`/enrollment/applications/${button.dataset.enrollmentReview}`, { status: action });
    await loadAdminEnrollment();
  } catch (err) {
    showMsg(document.getElementById('adminEnrollmentMessage'), err.message);
    button.disabled = false;
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
  try {
    const result = await api.get('/enrollment/availability');
    if (result.available) {
      availability.innerHTML = `
        <section class="card enrollment-availability" aria-label="Current enrollment period">
          <div class="enrollment-period-copy">
            <span class="enrollment-section-label">CURRENT ENROLLMENT PERIOD</span>
            <h2>${enrollmentEscape(result.period.term)} <span>${enrollmentEscape(result.period.schoolYear)}</span></h2>
            <p>Applications close ${fmtDate(result.period.closesAt)}</p>
          </div>
          <span class="enrollment-open-status"><i class="fa-solid fa-circle"></i> Accepting applications</span>
        </section>`;
      ensureEnrollmentForm(role);
      formContainer.hidden = false;
    } else {
      const periodLabel = result.period?.startedAt
        ? `${enrollmentEscape(result.period.term)} ${enrollmentEscape(result.period.schoolYear)} is not currently open for applications.`
        : 'Enrollment is not open right now.';
      availability.innerHTML = `
        <section class="card enrollment-availability enrollment-availability-closed" aria-label="Enrollment availability">
          <div class="enrollment-period-copy">
            <span class="enrollment-section-label">ENROLLMENT PERIOD</span>
            <h2>${result.period?.startedAt ? `${enrollmentEscape(result.period.term)} <span>${enrollmentEscape(result.period.schoolYear)}</span>` : 'Applications are closed'}</h2>
            <p>${periodLabel} Please check back later.</p>
          </div>
          <span class="enrollment-closed-status"><i class="fa-solid fa-lock"></i> Closed</span>
        </section>`;
      formContainer.hidden = true;
    }

    const applications = result.applications || [];
    applicationsContainer.innerHTML = `
      <section class="card enrollment-my-applications">
        <div class="enrollment-my-applications-heading">
          <div>
            <h2>My applications</h2>
            <p>Check application details and review status.</p>
          </div>
          <span class="enrollment-application-total">${applications.length} ${applications.length === 1 ? 'application' : 'applications'}</span>
        </div>
        ${applications.length ? `
          <div class="enrollment-application-list">
            ${applications.map((application) => `
              <article class="enrollment-application-item">
                <div class="enrollment-application-item-heading">
                  <div>
                    <h3>${enrollmentEscape(application.studentName)}</h3>
                    <p>Submitted ${fmtDate(application.createdAt)}</p>
                  </div>
                  <span class="badge ${application.status === 'approved' ? 'approved' : application.status === 'rejected' ? 'archived' : 'pending'}">${enrollmentEscape(application.status === 'approving' ? 'processing' : application.status)}</span>
                </div>
                <dl class="enrollment-application-details">
                  <div><dt>Birthdate</dt><dd>${fmtDate(application.birthdate)}</dd></div>
                  <div><dt>Term</dt><dd>${enrollmentEscape(application.term)} ${enrollmentEscape(application.schoolYear)}</dd></div>
                  <div><dt>Requested class</dt><dd>${enrollmentEscape(application.requestedClass || 'No preference')}</dd></div>
                  <div><dt>Parent / guardian</dt><dd>${enrollmentEscape(application.guardianName || '—')}</dd></div>
                  <div><dt>Contact number</dt><dd>${enrollmentEscape(application.guardianPhone || '—')}</dd></div>
                </dl>
                ${application.notes ? `<p class="enrollment-application-notes"><strong>Additional information:</strong> ${enrollmentEscape(application.notes)}</p>` : ''}
              </article>`).join('')}
          </div>` : `
          <div class="enrollment-no-applications">
            <i class="fa-regular fa-clipboard"></i>
            <div><strong>No applications yet</strong><p>Applications you submit will appear here with their review status.</p></div>
          </div>`}
      </section>`;
  } catch (err) {
    availability.innerHTML = `<div class="form-msg error">${enrollmentEscape(err.message)}</div>`;
  }
}

function ensureEnrollmentForm(role) {
  const isTeacher = role === 'teacher';
  const prefix = isTeacher ? 'teacher' : 'parent';
  const formContainer = document.getElementById(`${prefix}EnrollmentFormContainer`);
  if (document.getElementById(`${prefix}EnrollmentForm`)) return;

  formContainer.innerHTML = `
    <div class="enrollment-form-launcher">
      <button type="button" class="btn btn-primary" id="${prefix}EnrollmentOpen" aria-expanded="false" aria-controls="${prefix}EnrollmentApplicationPanel">
        <i class="fa-solid fa-plus"></i> ${isTeacher ? 'Add Enrollment' : 'Enroll Student'}
      </button>
    </div>
    <div class="enrollment-modal-backdrop" id="${prefix}EnrollmentApplicationPanel" hidden>
      <section class="card enrollment-application-card" role="dialog" aria-modal="true" aria-labelledby="${prefix}EnrollmentTitle">
        <div class="enrollment-form-heading">
          <div><h2 id="${prefix}EnrollmentTitle">Enrollment application</h2><p>Student applications are reviewed by a school administrator before enrollment.</p></div>
          <button type="button" class="btn btn-ghost btn-sm" id="${prefix}EnrollmentClose" aria-label="Close enrollment application"><i class="fa-solid fa-xmark"></i> Close</button>
        </div>
        <div id="${prefix}EnrollmentMessage" class="form-msg" aria-live="polite"></div>
        <form id="${prefix}EnrollmentForm" class="enrollment-form">
          <div class="grid-2">
            <div class="field"><label for="applicationStudentName">Student full name</label><input id="applicationStudentName" maxlength="120" autocomplete="name" required /></div>
            <div class="field"><label for="applicationBirthdate">Birthdate</label><input id="applicationBirthdate" type="date" required /></div>
            ${isTeacher ? '<div class="field"><label for="applicationGuardianName">Parent / guardian full name</label><input id="applicationGuardianName" maxlength="120" required /></div>' : ''}
            <div class="field"><label for="applicationClass">Preferred class / group <span>(optional)</span></label><input id="applicationClass" maxlength="80" /></div>
            <div class="field"><label for="applicationPhone">Guardian contact number <span>(optional)</span></label><input id="applicationPhone" type="tel" maxlength="30" autocomplete="tel" /></div>
          </div>
          <div class="field"><label for="applicationNotes">Additional information <span>(optional)</span></label><textarea id="applicationNotes" rows="3" maxlength="1000"></textarea></div>
          <div class="enrollment-form-actions">
            <button class="btn btn-primary" type="submit"><i class="fa-solid fa-paper-plane"></i> Submit for approval</button>
            <span>Approval is required before the student is added to the official roster.</span>
          </div>
        </form>
      </section>
    </div>`;

  const applicationPanel = document.getElementById(`${prefix}EnrollmentApplicationPanel`);
  const openButton = document.getElementById(`${prefix}EnrollmentOpen`);
  const closeButton = document.getElementById(`${prefix}EnrollmentClose`);
  const setFormVisible = (visible) => {
    applicationPanel.hidden = !visible;
    openButton.setAttribute('aria-expanded', String(visible));
    if (visible) document.getElementById('applicationStudentName').focus();
    else openButton.focus();
  };
  openButton.addEventListener('click', () => setFormVisible(applicationPanel.hidden));
  closeButton.addEventListener('click', () => setFormVisible(false));
  applicationPanel.addEventListener('click', (event) => {
    if (event.target === applicationPanel) setFormVisible(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !applicationPanel.hidden) setFormVisible(false);
  });

  document.getElementById(`${prefix}EnrollmentForm`).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById(`${prefix}EnrollmentMessage`);
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await api.post('/enrollment/applications', {
        studentName: document.getElementById('applicationStudentName').value.trim(),
        birthdate: document.getElementById('applicationBirthdate').value,
        guardianName: isTeacher ? document.getElementById('applicationGuardianName').value.trim() : undefined,
        requestedClass: document.getElementById('applicationClass').value.trim(),
        guardianPhone: document.getElementById('applicationPhone').value.trim(),
        notes: document.getElementById('applicationNotes').value.trim(),
      });
      showMsg(message, 'Enrollment application submitted for admin review.', 'success');
      form.reset();
      await loadEnrollmentPanel(role);
    } catch (err) {
      showMsg(message, err.message);
    } finally {
      submitButton.disabled = false;
    }
  });
}
