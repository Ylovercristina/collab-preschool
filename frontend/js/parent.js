const user = requireRole('parent');
let myChildren = [];
let activeChildId = null;
let activeTeacherId = null;

function onPanelShown(panel) {
  if (panel === 'progress') renderProgress();
  if (panel === 'attendance') renderAttendance();
  if (panel === 'fees') renderFees();
  if (panel === 'messages') openTeacherThread();
  if (panel === 'events') loadEvents();
  if (panel === 'pickup') renderPickup();
}

async function loadChildren() {
  const { students } = await api.get('/students');
  myChildren = students;
  if (myChildren.length) {
    activeChildId = myChildren[0]._id;
    activeTeacherId = myChildren[0].teacher ? myChildren[0].teacher._id : null;
  }
  const box = document.getElementById('childSwitcherBox');
  if (myChildren.length > 1) {
    box.innerHTML = `
      <label class="field-hint">Viewing: </label>
      <select id="childSwitch">${myChildren.map((c) => `<option value="${c._id}">${c.name}</option>`).join('')}</select>
    `;
    document.getElementById('childSwitch').addEventListener('change', (e) => {
      activeChildId = e.target.value;
      const child = myChildren.find((c) => c._id === activeChildId);
      activeTeacherId = child.teacher ? child.teacher._id : null;
      loadOverview(true);
    });
  } else if (myChildren.length === 1) {
    box.innerHTML = `<p style="margin:0;"><strong>${myChildren[0].name}</strong>${myChildren[0].className ? ` · ${myChildren[0].className}` : ''}</p>`;
  } else {
    box.innerHTML = `<div class="empty-state">No child linked to your account yet. Contact the school admin.</div>`;
  }
}

async function loadOverview(skipChildLoad) {
  if (!skipChildLoad) await loadChildren();

  const { alerts } = await api.get('/alerts');
  const recent = alerts.slice(0, 2);
  document.getElementById('alertsBanner').innerHTML = recent.map((a) => `
    <div class="alert-banner"><strong>🚨 ${a.title}</strong> — ${a.message}</div>
  `).join('');

  if (!activeChildId) {
    document.getElementById('latestProgress').innerHTML = '<div class="empty-state">Nothing yet.</div>';
    document.getElementById('upcomingEvents').innerHTML = '<div class="empty-state">Nothing yet.</div>';
    return;
  }

  const { progress } = await api.get(`/progress/student/${activeChildId}`);
  document.getElementById('latestProgress').innerHTML = progress.length ? `
    <p style="color:var(--ink); font-weight:700; margin-bottom:4px;">${fmtDate(progress[0].date)}</p>
    <p>${progress[0].milestone || progress[0].activity || progress[0].notes || 'Logged by teacher'}</p>
  ` : '<div class="empty-state">No entries yet.</div>';

  const { events } = await api.get('/events');
  const upcoming = events.filter((e) => new Date(e.date) >= new Date()).slice(0, 3);
  document.getElementById('upcomingEvents').innerHTML = upcoming.length
    ? upcoming.map((e) => `<div class="list-row"><span>${e.title}</span><span>${fmtDate(e.date)}</span></div>`).join('')
    : '<div class="empty-state">No upcoming events.</div>';
}

// ---------- Progress ----------
async function renderProgress() {
  if (!activeChildId) return;
  const { progress } = await api.get(`/progress/student/${activeChildId}`);
  document.getElementById('progressList').innerHTML = progress.length ? progress.map((p) => `
    <div class="card" style="margin-bottom:12px;">
      <p style="margin-bottom:4px; color:var(--ink); font-weight:700;">${fmtDate(p.date)} · ${p.teacher ? p.teacher.name : 'Teacher'}</p>
      ${p.milestone ? `<p><strong>Milestone:</strong> ${p.milestone}</p>` : ''}
      ${p.activity ? `<p><strong>Activity:</strong> ${p.activity}</p>` : ''}
      ${p.assessment ? `<p><strong>Assessment:</strong> ${p.assessment}</p>` : ''}
      ${p.notes ? `<p><strong>Notes:</strong> ${p.notes}</p>` : ''}
    </div>
  `).join('') : '<div class="empty-state">No progress logged yet.</div>';
}

// ---------- Attendance ----------
async function renderAttendance() {
  if (!activeChildId) return;
  const { attendance } = await api.get(`/attendance/student/${activeChildId}`);
  const tbody = document.getElementById('attTbody');
  tbody.innerHTML = attendance.length ? attendance.map((a) => `
    <tr><td>${fmtDate(a.date)}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${a.remarks || '—'}</td></tr>
  `).join('') : `<tr><td colspan="3"><div class="empty-state">No attendance records yet.</div></td></tr>`;
}

// ---------- Fees ----------
async function renderFees() {
  if (!activeChildId) return;
  const { fees } = await api.get(`/fees/student/${activeChildId}`);
  const tbody = document.getElementById('feesTbody');
  tbody.innerHTML = fees.length ? fees.map((f) => `
    <tr><td>${f.description}</td><td>${fmtMoney(f.amount)}</td><td>${fmtMoney(f.amountPaid)}</td><td>${fmtDate(f.dueDate)}</td><td><span class="badge ${f.status}">${f.status}</span></td></tr>
  `).join('') : `<tr><td colspan="5"><div class="empty-state">No fee records yet.</div></td></tr>`;
}

// ---------- Messages ----------
async function openTeacherThread() {
  if (!activeTeacherId) {
    document.getElementById('chatThread').innerHTML = '<div class="empty-state">No teacher assigned to your child yet.</div>';
    return;
  }
  const child = myChildren.find((c) => c._id === activeChildId);
  document.getElementById('threadWithName').textContent = child.teacher ? child.teacher.name : 'Teacher';
  const { messages } = await api.get(`/messages/thread/${activeTeacherId}`);
  const thread = document.getElementById('chatThread');
  thread.innerHTML = messages.map((m) => {
    const senderId = m.sender._id || m.sender;
    return `<div class="chat-bubble ${senderId === activeTeacherId ? 'theirs' : 'mine'}">${m.content}</div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

document.getElementById('sendChatBtn').addEventListener('click', async () => {
  const input = document.getElementById('chatInput');
  if (!activeTeacherId || !input.value.trim()) return;
  await api.post('/messages', { receiver: activeTeacherId, student: activeChildId, content: input.value.trim() });
  input.value = '';
  openTeacherThread();
});

// ---------- Events ----------
async function loadEvents() {
  const { events } = await api.get('/events');
  document.getElementById('eventsList').innerHTML = events.length ? events.map((ev) => `
    <div class="card" style="margin-bottom:14px;">
      <h3 style="margin-bottom:4px;">${ev.title}</h3>
      <p style="margin-bottom:4px;">${fmtDate(ev.date)}</p>
      <p style="margin:0;">${ev.description || ''}</p>
    </div>
  `).join('') : '<div class="empty-state">No events yet.</div>';
}

// ---------- Pickup ----------
async function renderPickup() {
  if (!activeChildId) { document.getElementById('pickupList').innerHTML = '<div class="empty-state">No child linked yet.</div>'; return; }
  const { authorizations } = await api.get(`/pickup/student/${activeChildId}`);
  document.getElementById('pickupList').innerHTML = authorizations.length ? authorizations.map((a) => `
    <div class="list-row">
      <span><strong>${a.authorizedName}</strong> — ${a.relationship} · ${a.contact}</span>
      <button class="btn btn-ghost btn-sm" data-del="${a._id}">Remove</button>
    </div>
  `).join('') : '<div class="empty-state">No authorized pickup people added yet.</div>';

  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api.del(`/pickup/${b.dataset.del}`);
    renderPickup();
  }));
}

document.getElementById('addPickupBtn').addEventListener('click', () => {
  if (!activeChildId) return;
  Modal.open(`
    <h3>Add authorized pickup person</h3>
    <div id="modalMsg" class="form-msg"></div>
    <form id="pickupForm">
      <div class="field"><label>Full name</label><input id="pName" required /></div>
      <div class="field"><label>Relationship to child</label><input id="pRel" placeholder="e.g. Grandmother, Uncle" required /></div>
      <div class="field"><label>Contact number</label><input id="pContact" required /></div>
      <button class="btn btn-primary btn-block" type="submit">Save</button>
    </form>
  `);
  document.getElementById('pickupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('modalMsg');
    try {
      await api.post('/pickup', {
        student: activeChildId,
        authorizedName: document.getElementById('pName').value.trim(),
        relationship: document.getElementById('pRel').value.trim(),
        contact: document.getElementById('pContact').value.trim(),
      });
      Modal.close();
      renderPickup();
    } catch (err) { showMsg(msg, err.message); }
  });
});

loadOverview();
