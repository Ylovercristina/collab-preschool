// ---------- Admin Academic Progress & Records Management ----------
function escapeRecordHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function recordDate(value) {
  return value ? fmtDate(value) : '—';
}

function studentRecordId(student) {
  return student.studentId || student._id;
}

let progressStudents = [];
let progressEntries = [];
let selectedProgressStudentId = '';
let managedRecordCategory = 'students';
let managedStudents = [];
let managedTeachers = [];
let selectedManagedRecord = null;

function progressState(student) {
  const entries = progressEntries.filter((entry) => entry.student?._id === student._id);
  if (!entries.length) return { label: 'No records', key: 'none', className: 'archived' };
  if (entries.some((entry) => entry.areasForImprovement?.trim())) {
    return { label: 'Support noted', key: 'support', className: 'pending' };
  }
  return { label: 'Progress recorded', key: 'records', className: 'approved' };
}

function renderProgressStudents() {
  const body = document.getElementById('progressStudentsTbody');
  if (!body) return;
  const query = document.getElementById('progressSearch').value.trim().toLowerCase();
  const className = document.getElementById('progressClassFilter').value;
  const stateFilter = document.getElementById('progressStatusFilter').value;
  const students = progressStudents.filter((student) => {
    const state = progressState(student);
    const searchText = `${studentRecordId(student)} ${student.name} ${student.className || ''}`.toLowerCase();
    return (!query || searchText.includes(query))
      && (!className || student.className === className)
      && (!stateFilter || state.key === stateFilter);
  });
  const count = document.getElementById('progressResultCount');
  count.textContent = `Showing ${students.length} of ${progressStudents.length} students`;
  body.innerHTML = students.length ? students.map((student) => {
    const state = progressState(student);
    const entries = progressEntries.filter((entry) => entry.student?._id === student._id);
    return `<tr>
      <td><strong>${escapeRecordHtml(studentRecordId(student))}</strong></td>
      <td>${escapeRecordHtml(student.name)}</td>
      <td>${escapeRecordHtml(student.className || 'Unassigned')}</td>
      <td><span class="badge ${state.className} record-status">${escapeRecordHtml(state.label)}</span></td>
      <td>${entries.length}</td>
      <td><button type="button" class="btn btn-secondary btn-sm" data-progress-student="${escapeRecordHtml(student._id)}"><i class="fa-solid fa-eye"></i> Review</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>${progressStudents.length ? 'No students match these filters.' : 'No enrolled students are available.'}</p></div></td></tr>`;

  body.querySelectorAll('[data-progress-student]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedProgressStudentId = button.dataset.progressStudent;
      renderProgressStudents();
      Modal.open('<div id="progressDetailsModalContent" class="modal-detail-content" aria-live="polite"></div>', true);
      Modal.body.classList.add('modal-details');
      renderProgressDetails();
    });
  });
}

function renderProgressDetails() {
  const container = document.getElementById('progressDetailsModalContent');
  if (!container) return;
  const student = progressStudents.find((item) => item._id === selectedProgressStudentId);
  if (!student) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>This student is no longer available.</p></div>';
    return;
  }

  const entries = progressEntries
    .filter((entry) => entry.student?._id === student._id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!entries.length) {
    container.innerHTML = `${studentProgressHeaderHtml(student, [])}
      <div class="empty-state"><i class="fa-solid fa-clipboard-question"></i><p>No academic progress records are available for this student yet.</p></div>`;
    return;
  }

  const uniqueLines = (field) => [...new Set(entries.map((entry) => entry[field]?.trim()).filter(Boolean))];
  const strengths = uniqueLines('strengths');
  const improvements = uniqueLines('areasForImprovement');
  const development = uniqueLines('overallDevelopment');
  const reviewedCount = entries.filter((entry) => entry.reviewedAt).length;
  container.innerHTML = `
    ${studentProgressHeaderHtml(student, entries, `<span class="badge ${reviewedCount === entries.length ? 'approved' : 'pending'}">${reviewedCount} of ${entries.length} reviewed</span>`)}
    <div class="progress-summary-grid">
      <div class="progress-summary-item"><span class="record-info-label">Strengths</span>${strengths.length ? strengths.map(escapeRecordHtml).join('<br>') : 'Not recorded yet'}</div>
      <div class="progress-summary-item"><span class="record-info-label">Areas for improvement</span>${improvements.length ? improvements.map(escapeRecordHtml).join('<br>') : 'No areas noted'}</div>
      <div class="progress-summary-item"><span class="record-info-label">Overall development</span>${development.length ? development.map(escapeRecordHtml).join('<br>') : 'Not recorded yet'}</div>
    </div>
    <h3 style="margin:16px 0 4px;">Progress over time</h3>
    <div class="progress-entry-list">${entries.map((entry) => progressEntryCardHtml(entry, {
      actionsHtml: entry.reviewedAt
        ? `<span class="badge approved"><i class="fa-solid fa-check"></i> Reviewed ${recordDate(entry.reviewedAt)}</span>`
        : `<button type="button" class="btn btn-secondary btn-sm" data-review-progress="${escapeRecordHtml(entry._id)}"><i class="fa-solid fa-check"></i> Mark reviewed</button>`,
    })).join('')}</div>`;
  hydrateProtectedImages(container);

  container.querySelectorAll('[data-review-progress]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api.patch(`/progress/${button.dataset.reviewProgress}/review`, {});
        await loadAcademicProgress();
      } catch (err) {
        button.disabled = false;
        showMsg(document.getElementById('progressMessage'), err.message);
      }
    });
  });
}

window.loadAcademicProgress = async function loadAcademicProgress() {
  const message = document.getElementById('progressMessage');
  message.textContent = '';
  try {
    const [{ students }, { progress }] = await Promise.all([
      api.get('/students?status=active'),
      api.get('/progress'),
    ]);
    progressStudents = students || [];
    progressEntries = progress || [];
    const classes = [...new Set(progressStudents.map((student) => student.className).filter(Boolean))].sort();
    const classFilter = document.getElementById('progressClassFilter');
    const selectedClass = classFilter.value;
    classFilter.innerHTML = '<option value="">All classes</option>' + classes.map((name) => `<option value="${escapeRecordHtml(name)}">${escapeRecordHtml(name)}</option>`).join('');
    classFilter.value = classes.includes(selectedClass) ? selectedClass : '';
    if (!progressStudents.some((student) => student._id === selectedProgressStudentId)) {
      selectedProgressStudentId = '';
    }
    renderProgressStudents();
    if (document.getElementById('progressDetailsModalContent')) renderProgressDetails();
  } catch (err) {
    showMsg(message, err.message);
  }
};

function exportProgressCsv() {
  if (!progressEntries.length) {
    showMsg(document.getElementById('progressMessage'), 'There are no academic progress records to export.');
    return;
  }
  const columns = ['Student ID', 'Student', 'Class / Section', 'Date', 'Learning Area', 'Milestone', 'Activity', 'Assessment', 'Teacher Evaluation', 'Strengths', 'Areas for Improvement', 'Overall Development', 'Teacher', 'Review Status'];
  const rows = progressEntries.map((entry) => [
    entry.student?.studentId || entry.student?._id || '',
    entry.student?.name || '',
    entry.student?.className || '',
    entry.date ? new Date(entry.date).toLocaleDateString() : '',
    entry.learningArea || '',
    entry.milestone || '',
    entry.activity || '',
    entry.assessment || '',
    entry.evaluation || '',
    entry.strengths || '',
    entry.areasForImprovement || '',
    entry.overallDevelopment || '',
    entry.teacher?.name || '',
    entry.reviewedAt ? 'Reviewed' : 'Awaiting review',
  ]);
  const csv = [columns, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'student-academic-progress.csv';
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById('progressSearch').addEventListener('input', renderProgressStudents);
document.getElementById('progressClassFilter').addEventListener('change', renderProgressStudents);
document.getElementById('progressStatusFilter').addEventListener('change', renderProgressStudents);
document.getElementById('progressExportBtn').addEventListener('click', exportProgressCsv);
document.getElementById('progressPrintBtn').addEventListener('click', () => {
  if (!selectedProgressStudentId) {
    showMsg(document.getElementById('progressMessage'), 'Select a student before printing their report.');
    return;
  }
  document.body.classList.add('print-progress');
  window.print();
  window.setTimeout(() => document.body.classList.remove('print-progress'), 1000);
});

function recordObjectId(record) {
  return record._id;
}

function filteredManagedRecords() {
  const records = managedRecordCategory === 'students' ? managedStudents : managedTeachers;
  const query = document.getElementById('recordsSearch').value.trim().toLowerCase();
  const selectedClass = document.getElementById('recordsClassFilter').value;
  return records.filter((record) => {
    const id = managedRecordCategory === 'students' ? studentRecordId(record) : (record.employeeId || record._id);
    const className = managedRecordCategory === 'students' ? record.className : record.assignedClass;
    const searchText = managedRecordCategory === 'students'
      ? `${id} ${record.name} ${className || ''} ${record.guardianName || ''} ${record.guardianPhone || ''} ${record.parent?.name || ''} ${record.parent?.email || ''}`.toLowerCase()
      : `${id} ${record.name} ${className || ''} ${record.email || ''} ${record.phone || ''}`.toLowerCase();
    return (!query || searchText.includes(query)) && (!selectedClass || className === selectedClass);
  });
}

function renderManagedRecords() {
  const teachers = managedRecordCategory === 'teachers';
  const records = filteredManagedRecords();
  const thead = document.getElementById('recordsThead');
  const tbody = document.getElementById('recordsTbody');
  thead.innerHTML = teachers
    ? '<tr><th>Employee ID</th><th>Teacher</th><th>Contact</th><th>Class / Section</th><th>Employment</th><th>Actions</th></tr>'
    : '<tr><th>Student ID</th><th>Student</th><th>Class / Section</th><th>Enrollment</th><th>Parent / Guardian</th><th>Actions</th></tr>';
  document.getElementById('recordsResultCount').textContent = `Showing ${records.length} of ${(teachers ? managedTeachers : managedStudents).length} records`;
  tbody.innerHTML = records.length ? records.map((record) => {
    const id = recordObjectId(record);
    const recordNumber = teachers ? (record.employeeId || record._id) : studentRecordId(record);
    const className = teachers ? record.assignedClass : record.className;
    return `<tr>
      <td><strong>${escapeRecordHtml(recordNumber)}</strong></td>
      <td>${escapeRecordHtml(record.name)}${teachers ? `<div style="font-size:12px;color:var(--ink-muted);">${escapeRecordHtml(record.email || '')}</div>` : ''}</td>
      ${teachers
        ? `<td>${escapeRecordHtml(record.phone || '—')}</td><td>${escapeRecordHtml(className || 'Unassigned')}</td><td>${escapeRecordHtml(record.employmentType || '—')}<div style="font-size:12px;color:var(--ink-muted);">${recordDate(record.employmentStartDate)}</div></td>`
        : `<td>${escapeRecordHtml(className || 'Unassigned')}</td><td>${recordDate(record.enrollmentDate || record.createdAt)}</td><td>${escapeRecordHtml(record.guardianName || record.parent?.name || '—')}<div style="font-size:12px;color:var(--ink-muted);">${escapeRecordHtml(record.guardianPhone || record.parent?.phone || '')}</div></td>`}
      <td><div class="record-actions"><button type="button" class="btn btn-secondary btn-sm" data-view-record="${escapeRecordHtml(id)}"><i class="fa-solid fa-eye"></i> View</button><button type="button" class="btn btn-ghost btn-sm" data-edit-record="${escapeRecordHtml(id)}"><i class="fa-solid fa-pen"></i> Edit</button></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>${(teachers ? managedTeachers : managedStudents).length ? 'No records match these filters.' : `No ${teachers ? 'teacher' : 'student'} records are available.`}</p></div></td></tr>`;

  tbody.querySelectorAll('[data-view-record]').forEach((button) => button.addEventListener('click', () => {
    const record = (teachers ? managedTeachers : managedStudents).find((item) => recordObjectId(item) === button.dataset.viewRecord);
    if (record) openManagedRecordDetails(record);
  }));
  tbody.querySelectorAll('[data-edit-record]').forEach((button) => button.addEventListener('click', () => {
    const record = (teachers ? managedTeachers : managedStudents).find((item) => recordObjectId(item) === button.dataset.editRecord);
    if (record) openManagedRecordForm(record);
  }));
}

function recordInfo(label, value) {
  return `<div class="record-info-item"><span class="record-info-label">${escapeRecordHtml(label)}</span>${escapeRecordHtml(value || '—')}</div>`;
}

function openManagedRecordDetails(record) {
  selectedManagedRecord = record;
  Modal.open('<div id="managedRecordModalContent" class="modal-detail-content" aria-live="polite"></div>', true);
  Modal.body.classList.add('modal-details');
  renderManagedRecordDetails();
}

function renderManagedRecordDetails() {
  const container = document.getElementById('managedRecordModalContent');
  if (!container) return;
  const record = selectedManagedRecord;
  if (!record) return;
  const isTeacher = managedRecordCategory === 'teachers';
  const recordType = isTeacher ? 'teachers' : 'students';
  const recordNumber = isTeacher ? (record.employeeId || record._id) : studentRecordId(record);
  const fields = isTeacher
    ? [
      recordInfo('Employee ID', recordNumber),
      recordInfo('Email', record.email),
      recordInfo('Contact', record.phone),
      recordInfo('Assigned class / section', record.assignedClass),
      recordInfo('Employment type', record.employmentType),
      recordInfo('Employment start date', recordDate(record.employmentStartDate)),
      recordInfo('Account status', record.status),
      recordInfo('Date added', recordDate(record.createdAt)),
    ].join('')
    : [
      recordInfo('Student ID', recordNumber),
      recordInfo('Class / section', record.className),
      recordInfo('Enrollment date', recordDate(record.enrollmentDate || record.createdAt)),
      recordInfo('Birthdate', recordDate(record.birthdate)),
      recordInfo('Parent / guardian', record.guardianName || record.parent?.name),
      recordInfo('Guardian contact', record.guardianPhone || record.parent?.phone),
      recordInfo('Parent email', record.parent?.email),
      recordInfo('Assigned teacher', record.teacher?.name),
    ].join('');
  const docs = record.documents || [];
  container.innerHTML = `
    <div class="record-profile-heading"><div><span class="record-info-label">${isTeacher ? 'TEACHER PROFILE' : 'STUDENT PROFILE'}</span><h2 style="margin:0;">${escapeRecordHtml(record.name)}</h2></div><button type="button" class="btn btn-ghost btn-sm" data-profile-edit><i class="fa-solid fa-pen"></i> Edit profile</button></div>
    <div class="record-profile-grid">${fields}</div>
    ${!isTeacher && record.notes ? `<div class="record-info-item"><span class="record-info-label">Enrollment notes</span>${escapeRecordHtml(record.notes)}</div>` : ''}
    <h3 style="margin:18px 0 4px;">Related documents <span style="font-weight:500;color:var(--ink-muted);font-size:13px;">(${docs.length})</span></h3>
    ${docs.length ? `<div class="record-document-list">${docs.map((document) => `
      <div class="record-document-item">
        <div><strong><i class="fa-regular fa-file-lines" style="color:var(--primary);margin-right:6px;"></i>${escapeRecordHtml(document.originalName)}</strong><div style="font-size:12px;color:var(--ink-muted);">${Math.max(1, Math.round(document.size / 1024))} KB &middot; Added ${recordDate(document.uploadedAt)}</div></div>
        <div class="record-document-actions"><button type="button" class="btn btn-secondary btn-sm" data-open-record-document="${escapeRecordHtml(document._id)}"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</button><button type="button" class="btn btn-danger btn-sm" data-delete-record-document="${escapeRecordHtml(document._id)}" aria-label="Delete ${escapeRecordHtml(document.originalName)}"><i class="fa-solid fa-trash"></i></button></div>
      </div>`).join('')}</div>` : '<p style="color:var(--ink-muted);margin-top:10px;">No documents have been added.</p>'}
    <form class="records-upload-form" id="recordDocumentForm">
      <input type="file" name="documents" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple required aria-label="Choose related records" />
      <button type="submit" class="btn btn-secondary btn-sm"><i class="fa-solid fa-arrow-up-from-bracket"></i> Upload documents</button>
      <span class="field-hint">PDF, images, DOC or DOCX; up to 10 MB per file.</span>
    </form>`;
  container.querySelector('[data-profile-edit]').addEventListener('click', () => openManagedRecordForm(record));
  container.querySelectorAll('[data-open-record-document]').forEach((button) => {
    button.addEventListener('click', () => openRecordDocument(recordType, record._id, button.dataset.openRecordDocument));
  });
  container.querySelectorAll('[data-delete-record-document]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this document from the record?')) return;
      try {
        await api.del(`/records/${recordType}/${record._id}/documents/${button.dataset.deleteRecordDocument}`);
        await reloadManagedRecords(record._id);
      } catch (err) {
        showMsg(document.getElementById('recordsMessage'), err.message);
      }
    });
  });
  container.querySelector('#recordDocumentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('input[type="file"]');
    const formData = new FormData();
    [...input.files].forEach((file) => formData.append('documents', file));
    try {
      await api.post(`/records/${recordType}/${record._id}/documents`, formData);
      await reloadManagedRecords(record._id);
      document.getElementById('recordsMessage').textContent = '';
    } catch (err) {
      showMsg(document.getElementById('recordsMessage'), err.message);
    }
  });
}

async function openRecordDocument(type, recordId, documentId) {
  const preview = window.open('', '_blank');
  try {
    const response = await fetch(`${API_BASE}/records/${type}/${recordId}/documents/${documentId}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message || `Request failed (${response.status})`);
    }
    const url = URL.createObjectURL(await response.blob());
    if (preview) {
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'record-document';
      link.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    if (preview) preview.close();
    showMsg(document.getElementById('recordsMessage'), err.message);
  }
}

async function loadManagedRecords() {
  const message = document.getElementById('recordsMessage');
  message.textContent = '';
  try {
    if (managedRecordCategory === 'students') {
      const { students } = await api.get('/records/students');
      managedStudents = students || [];
    } else {
      const { teachers } = await api.get('/records/teachers');
      managedTeachers = teachers || [];
    }
    const classFilter = document.getElementById('recordsClassFilter');
    const classNames = [...new Set((managedRecordCategory === 'students' ? managedStudents.map((student) => student.className) : managedTeachers.map((teacher) => teacher.assignedClass)).filter(Boolean))].sort();
    const selectedClass = classFilter.value;
    classFilter.innerHTML = '<option value="">All classes</option>' + classNames.map((name) => `<option value="${escapeRecordHtml(name)}">${escapeRecordHtml(name)}</option>`).join('');
    classFilter.value = classNames.includes(selectedClass) ? selectedClass : '';
    const records = managedRecordCategory === 'students' ? managedStudents : managedTeachers;
    if (selectedManagedRecord && !records.some((record) => record._id === selectedManagedRecord._id)) selectedManagedRecord = null;
    if (selectedManagedRecord) selectedManagedRecord = records.find((record) => record._id === selectedManagedRecord._id) || null;
    renderManagedRecords();
    renderManagedRecordDetails();
    const addButton = document.getElementById('addManagedRecordBtn');
    addButton.innerHTML = `<i class="fa-solid fa-plus"></i> Add ${managedRecordCategory === 'students' ? 'student' : 'teacher'} record`;
  } catch (err) {
    showMsg(message, err.message);
  }
}

async function reloadManagedRecords(recordId) {
  await loadManagedRecords();
  const records = managedRecordCategory === 'students' ? managedStudents : managedTeachers;
  selectedManagedRecord = records.find((record) => record._id === recordId) || null;
  renderManagedRecordDetails();
}

window.loadManagedRecords = loadManagedRecords;

async function openManagedRecordForm(record = null) {
  const isTeacher = managedRecordCategory === 'teachers';
  const isEditing = Boolean(record);
  const dateValue = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';
  const recordFormDate = isTeacher ? dateValue(record?.employmentStartDate) : dateValue(record?.enrollmentDate || record?.createdAt);
  let relatedOptions = '';
  if (!isTeacher) {
    try {
      const [{ users: parents }, { users: teachers }] = await Promise.all([
        api.get('/users?role=parent'),
        api.get('/users?role=teacher'),
      ]);
      relatedOptions = `
        <div class="grid-2">
          <div class="field"><label for="managedParent">Parent account</label><select id="managedParent"><option value="">— Select parent —</option>${parents.map((parent) => `<option value="${escapeRecordHtml(parent.id)}" ${record?.parent?._id === parent.id ? 'selected' : ''}>${escapeRecordHtml(parent.name)} (${escapeRecordHtml(parent.email)})</option>`).join('')}</select></div>
          <div class="field"><label for="managedTeacher">Assigned teacher</label><select id="managedTeacher"><option value="">— Select teacher —</option>${teachers.map((teacher) => `<option value="${escapeRecordHtml(teacher.id)}" ${record?.teacher?._id === teacher.id ? 'selected' : ''}>${escapeRecordHtml(teacher.name)}</option>`).join('')}</select></div>
        </div>`;
    } catch (err) {
      showMsg(document.getElementById('recordsMessage'), err.message);
      return;
    }
  }

  Modal.open(`
    <h3>${isEditing ? 'Update' : 'Add'} ${isTeacher ? 'Teacher' : 'Student'} Record</h3>
    <div id="managedRecordFormMessage" class="form-msg" aria-live="polite"></div>
    <form id="managedRecordForm">
      <div class="grid-2">
        <div class="field"><label for="managedName">Full name</label><input id="managedName" maxlength="120" value="${escapeRecordHtml(record?.name || '')}" required /></div>
        ${isTeacher
          ? `<div class="field"><label for="managedPhone">Contact number</label><input id="managedPhone" type="tel" value="${escapeRecordHtml(record?.phone || '')}" required /></div>`
          : `<div class="field"><label for="managedClass">Class / section</label><input id="managedClass" list="managedClassOptions" maxlength="80" value="${escapeRecordHtml(record?.className || '')}" required /></div>`}
      </div>
      ${isTeacher ? `
        ${!isEditing ? '<div class="field"><label for="managedEmail">Email address (teacher sign-in)</label><input id="managedEmail" type="email" required /></div><div class="field"><label for="managedPassword">Temporary password</label><input id="managedPassword" type="password" minlength="6" required /></div>' : ''}
        <div class="grid-2">
          <div class="field"><label for="managedClass">Assigned class / section</label><input id="managedClass" maxlength="80" value="${escapeRecordHtml(record?.assignedClass || '')}" /></div>
          <div class="field"><label for="managedEmploymentType">Employment type</label><select id="managedEmploymentType" required><option value="">Select type</option>${['Full-time', 'Part-time', 'Contract', 'Substitute'].map((type) => `<option value="${type}" ${record?.employmentType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="managedEmploymentDate">Employment start date</label><input id="managedEmploymentDate" type="date" value="${recordFormDate}" required /></div>
      ` : `
        <div class="grid-2"><div class="field"><label for="managedEnrollmentDate">Enrollment date</label><input id="managedEnrollmentDate" type="date" value="${recordFormDate || new Date().toISOString().slice(0, 10)}" required /></div><div class="field"><label for="managedBirthdate">Birthdate</label><input id="managedBirthdate" type="date" value="${dateValue(record?.birthdate)}" /></div></div>
        ${relatedOptions}
        <div class="grid-2"><div class="field"><label for="managedGuardianName">Parent / guardian name</label><input id="managedGuardianName" maxlength="120" value="${escapeRecordHtml(record?.guardianName || '')}" /></div><div class="field"><label for="managedGuardianPhone">Guardian contact</label><input id="managedGuardianPhone" type="tel" value="${escapeRecordHtml(record?.guardianPhone || '')}" /></div></div>
        <div class="field"><label for="managedNotes">Enrollment notes</label><textarea id="managedNotes" rows="2" maxlength="1000">${escapeRecordHtml(record?.notes || '')}</textarea></div>
      `}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px;"><i class="fa-solid fa-floppy-disk"></i> Save record</button>
    </form>
  `, true);
  document.getElementById('managedRecordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formMessage = document.getElementById('managedRecordFormMessage');
    const name = document.getElementById('managedName').value.trim();
    const endpoint = isTeacher ? '/records/teachers' : '/records/students';
    try {
      let savedRecord;
      if (isTeacher) {
        const values = {
          name,
          phone: document.getElementById('managedPhone').value.trim(),
          assignedClass: document.getElementById('managedClass').value.trim(),
          employmentType: document.getElementById('managedEmploymentType').value,
          employmentStartDate: document.getElementById('managedEmploymentDate').value,
        };
        if (!isEditing) {
          values.email = document.getElementById('managedEmail').value.trim();
          values.password = document.getElementById('managedPassword').value;
        }
        const response = isEditing
          ? await api.patch(`${endpoint}/${record._id}`, values)
          : await api.post(endpoint, values);
        savedRecord = response.teacher;
      } else {
        const values = {
          name,
          className: document.getElementById('managedClass').value.trim(),
          enrollmentDate: document.getElementById('managedEnrollmentDate').value,
          birthdate: document.getElementById('managedBirthdate').value || undefined,
          parent: document.getElementById('managedParent').value || undefined,
          teacher: document.getElementById('managedTeacher').value || undefined,
          guardianName: document.getElementById('managedGuardianName').value.trim(),
          guardianPhone: document.getElementById('managedGuardianPhone').value.trim(),
          notes: document.getElementById('managedNotes').value.trim(),
        };
        const response = isEditing
          ? await api.patch(`${endpoint}/${record._id}`, values)
          : await api.post(endpoint, values);
        savedRecord = response.student;
      }
      Modal.close();
      selectedManagedRecord = savedRecord;
      await reloadManagedRecords(savedRecord._id);
      openManagedRecordDetails(selectedManagedRecord);
      document.getElementById('recordsMessage').textContent = '';
    } catch (err) {
      showMsg(formMessage, err.message);
    }
  });
}

document.querySelectorAll('[data-record-category]').forEach((button) => button.addEventListener('click', () => {
  managedRecordCategory = button.dataset.recordCategory;
  selectedManagedRecord = null;
  document.querySelectorAll('[data-record-category]').forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('recordsSearch').value = '';
  document.getElementById('recordsClassFilter').value = '';
  loadManagedRecords();
}));
document.getElementById('recordsSearch').addEventListener('input', renderManagedRecords);
document.getElementById('recordsClassFilter').addEventListener('change', renderManagedRecords);
document.getElementById('addManagedRecordBtn').addEventListener('click', () => openManagedRecordForm());
