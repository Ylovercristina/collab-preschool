// ---------- Admin Class Management ----------
let managedClasses = [];
let classTeachers = [];
let classStudents = [];

function escapeClassHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function sameClassName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

window.loadClasses = async function loadClasses() {
  const message = document.getElementById('classesMessage');
  message.textContent = '';
  try {
    const [classResult, teacherResult, studentResult] = await Promise.all([
      api.get('/classes'),
      api.get('/records/teachers'),
      api.get('/students?status=active'),
    ]);
    managedClasses = classResult.classes || [];
    classTeachers = (teacherResult.teachers || []).filter((teacher) => teacher.status !== 'archived');
    classStudents = studentResult.students || [];
    renderClassNotices(classResult.unregistered || [], classResult.unassignedStudents || 0);
    renderClasses();
  } catch (err) {
    showMsg(message, err.message);
  }
};

function renderClassNotices(unregistered, unassignedStudents) {
  const notices = document.getElementById('classesNotices');
  notices.innerHTML = `
    ${unregistered.length ? `<div class="class-notice">
      <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
      <div><strong>Class names in use but not set up yet</strong><p>Set them up to assign a teacher and keep class names consistent.</p>
        <div class="class-notice-chips">${unregistered.map((name) => `<button type="button" class="btn btn-ghost btn-sm" data-setup-class="${escapeClassHtml(name)}"><i class="fa-solid fa-plus"></i> ${escapeClassHtml(name)}</button>`).join('')}</div>
      </div>
    </div>` : ''}
    ${unassignedStudents ? `<div class="class-notice">
      <i class="fa-solid fa-user-clock" aria-hidden="true"></i>
      <div><strong>${unassignedStudents} active student${unassignedStudents === 1 ? ' has' : 's have'} no class</strong><p>Open a class and use "Add student" to place them.</p></div>
    </div>` : ''}`;
  notices.querySelectorAll('[data-setup-class]').forEach((button) => {
    button.addEventListener('click', () => openClassForm({ name: button.dataset.setupClass }));
  });
}

function renderClasses() {
  updateClassOptionsList();
  const filter = document.getElementById('classStatusFilter').value;
  const rows = managedClasses.filter((item) => !filter || item.status === filter);
  document.getElementById('classResultCount').textContent = `Showing ${rows.length} of ${managedClasses.length} classes`;
  const body = document.getElementById('classesTbody');
  body.innerHTML = rows.length ? rows.map((item) => `<tr>
      <td><strong>${escapeClassHtml(item.name)}</strong>${item.description ? `<div class="class-description">${escapeClassHtml(item.description)}</div>` : ''}</td>
      <td>${item.teacher ? escapeClassHtml(item.teacher.name) : '<span class="badge pending">No teacher</span>'}</td>
      <td>${item.activeStudents}</td>
      <td><span class="badge ${item.status === 'active' ? 'approved' : 'archived'}">${item.status === 'active' ? 'Active' : 'Archived'}</span></td>
      <td><div class="record-actions">
        ${item.status === 'active' ? `
          <button type="button" class="btn btn-secondary btn-sm" data-class-students="${escapeClassHtml(item._id)}"><i class="fa-solid fa-users"></i> Students</button>
          <button type="button" class="btn btn-ghost btn-sm" data-class-edit="${escapeClassHtml(item._id)}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-class-archive="${escapeClassHtml(item._id)}"><i class="fa-solid fa-box-archive"></i> Archive</button>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-class-restore="${escapeClassHtml(item._id)}"><i class="fa-solid fa-rotate-left"></i> Restore</button>`}
      </div></td>
    </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-chalkboard-user"></i><p>${managedClasses.length ? 'No classes match this filter.' : 'No classes yet. Create one with New Class.'}</p></div></td></tr>`;

  const find = (id) => managedClasses.find((item) => item._id === id);
  body.querySelectorAll('[data-class-edit]').forEach((button) => button.addEventListener('click', () => openClassForm(find(button.dataset.classEdit))));
  body.querySelectorAll('[data-class-students]').forEach((button) => button.addEventListener('click', () => openClassStudents(find(button.dataset.classStudents))));
  body.querySelectorAll('[data-class-archive]').forEach((button) => button.addEventListener('click', () => changeClassStatus(find(button.dataset.classArchive), 'archive', button)));
  body.querySelectorAll('[data-class-restore]').forEach((button) => button.addEventListener('click', () => changeClassStatus(find(button.dataset.classRestore), 'restore', button)));
}

function openClassForm(classroom = {}) {
  const isEdit = Boolean(classroom._id);
  const currentTeacher = classroom.teacher ? String(classroom.teacher._id || classroom.teacher) : '';
  const leading = new Map(managedClasses
    .filter((item) => item.status === 'active' && item.teacher && item._id !== classroom._id)
    .map((item) => [String(item.teacher._id), item.name]));
  Modal.open(`
    <h3>${isEdit ? `Edit ${escapeClassHtml(classroom.name)}` : 'New class'}</h3>
    <form id="classForm" novalidate>
      <div class="field"><label for="classNameInput">Class name <span class="required-mark" aria-hidden="true">*</span></label><input id="classNameInput" maxlength="80" required value="${escapeClassHtml(classroom.name || '')}" placeholder="e.g. Kinder 1 - Sunflower" /></div>
      <div class="field"><label for="classTeacherInput">Teacher</label>
        <select id="classTeacherInput">
          <option value="">No teacher yet</option>
          ${classTeachers.map((teacher) => {
    const busy = leading.get(String(teacher._id));
    return `<option value="${escapeClassHtml(teacher._id)}" ${String(teacher._id) === currentTeacher ? 'selected' : ''} ${busy ? 'disabled' : ''}>${escapeClassHtml(teacher.name)}${busy ? ` (leads ${escapeClassHtml(busy)})` : ''}</option>`;
  }).join('')}
        </select>
        <div class="field-hint">Every student in this class is assigned to this teacher. A teacher can lead one active class.</div>
      </div>
      <div class="field"><label for="classDescriptionInput">Description</label><textarea id="classDescriptionInput" rows="2" maxlength="500" placeholder="Age group, schedule or room (optional)">${escapeClassHtml(classroom.description || '')}</textarea></div>
      ${isEdit ? '<div class="field-hint">Renaming a class also renames it on every student and teacher record.</div>' : ''}
      <div id="classFormMessage" class="form-msg" role="alert"></div>
      <div class="event-form-actions"><button type="button" class="btn btn-ghost" id="classFormCancel">Cancel</button><button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Create class'}</button></div>
    </form>`);
  document.getElementById('classFormCancel').addEventListener('click', () => Modal.close());
  document.getElementById('classForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formMessage = document.getElementById('classFormMessage');
    const name = document.getElementById('classNameInput').value.trim();
    if (!name) {
      showMsg(formMessage, 'Class name is required.');
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setButtonLoading(button, true, 'Saving');
    const body = {
      name,
      teacher: document.getElementById('classTeacherInput').value || null,
      description: document.getElementById('classDescriptionInput').value.trim(),
    };
    try {
      if (isEdit) await api.patch(`/classes/${classroom._id}`, body);
      else await api.post('/classes', body);
      Modal.close();
      showToast(isEdit ? 'Class updated.' : 'Class created.');
      await loadClasses();
    } catch (err) {
      setButtonLoading(button, false);
      showMsg(formMessage, err.message);
    }
  });
}

function openClassStudents(classroom) {
  const inClass = classStudents.filter((student) => sameClassName(student.className, classroom.name));
  const others = classStudents.filter((student) => !sameClassName(student.className, classroom.name));
  Modal.open(`
    <h3>${escapeClassHtml(classroom.name)} students</h3>
    <p class="field-hint">Teacher: ${classroom.teacher ? escapeClassHtml(classroom.teacher.name) : 'none assigned'}. Moving a student changes which teacher can see them. Attendance and progress history stay with the student.</p>
    <div class="class-student-list">${inClass.length ? inClass.map((student) => `
      <div class="class-student-row">
        <div><strong>${escapeClassHtml(student.name)}</strong><span>${escapeClassHtml(student.studentId || '')}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-unassign-student="${escapeClassHtml(student._id)}">Remove from class</button>
      </div>`).join('') : '<div class="empty-state"><p>No active students in this class yet.</p></div>'}</div>
    <form id="classAddStudentForm" class="class-add-student">
      <label for="classAddStudentSelect">Add student</label>
      <div class="gcal-calendar-row">
        <select id="classAddStudentSelect" ${others.length ? '' : 'disabled'}>
          ${others.length ? others.map((student) => `<option value="${escapeClassHtml(student._id)}">${escapeClassHtml(student.name)} — ${escapeClassHtml(student.className || 'Unassigned')}</option>`).join('') : '<option>All active students are already in this class</option>'}
        </select>
        <button type="submit" class="btn btn-primary btn-sm" ${others.length ? '' : 'disabled'}>Add</button>
      </div>
    </form>
    <div id="classStudentsMessage" class="form-msg" role="alert"></div>`, true);

  const message = document.getElementById('classStudentsMessage');
  const moveStudent = async (studentId, className, button) => {
    setButtonLoading(button, true, 'Saving');
    try {
      await api.patch(`/students/${studentId}`, { className });
      await loadClasses();
      const refreshed = managedClasses.find((item) => item._id === classroom._id);
      if (refreshed) openClassStudents(refreshed);
      showToast('Class updated.');
    } catch (err) {
      setButtonLoading(button, false);
      showMsg(message, err.message);
    }
  };
  document.querySelectorAll('[data-unassign-student]').forEach((button) => button.addEventListener('click', () => {
    const student = classStudents.find((item) => item._id === button.dataset.unassignStudent);
    if (student && confirm(`Remove ${student.name} from ${classroom.name}? They will be Unassigned until placed in another class.`)) {
      moveStudent(student._id, 'Unassigned', button);
    }
  }));
  document.getElementById('classAddStudentForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const select = document.getElementById('classAddStudentSelect');
    if (select.value) moveStudent(select.value, classroom.name, event.currentTarget.querySelector('button[type="submit"]'));
  });
}

async function changeClassStatus(classroom, action, button) {
  if (action === 'archive' && !confirm(`Archive ${classroom.name}? It can be restored later. No student, attendance or progress records are deleted.`)) return;
  setButtonLoading(button, true, action === 'archive' ? 'Archiving' : 'Restoring');
  try {
    await api.patch(`/classes/${classroom._id}/${action}`, {});
    showToast(action === 'archive' ? 'Class archived.' : 'Class restored.');
    await loadClasses();
  } catch (err) {
    setButtonLoading(button, false);
    showMsg(document.getElementById('classesMessage'), err.message);
  }
}

document.getElementById('addClassBtn').addEventListener('click', () => openClassForm());
document.getElementById('classStatusFilter').addEventListener('change', renderClasses);

// Suggests managed class names in the student forms (Records Management and Edit student).
function updateClassOptionsList() {
  let list = document.getElementById('managedClassOptions');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'managedClassOptions';
    document.body.appendChild(list);
  }
  list.innerHTML = managedClasses
    .filter((item) => item.status === 'active')
    .map((item) => `<option value="${escapeClassHtml(item.name)}"></option>`).join('');
}

api.get('/classes').then(({ classes }) => {
  managedClasses = classes || [];
  updateClassOptionsList();
}).catch(() => {});
