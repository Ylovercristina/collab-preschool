// ---------- Play-is-School -- Shared Dashboard Logic & Components ----------

function initSidebarNav() {
  document.querySelectorAll('.nav-item[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPanel = document.getElementById(`panel-${btn.dataset.panel}`);
      if (targetPanel) targetPanel.classList.add('active');
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
  el: null,
  body: null,
  init() {
    this.el = document.getElementById('modalBackdrop');
    this.body = document.getElementById('modalBody');
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        if (e.target === this.el) this.close();
      });
    }
  },
  open(html, isWide = false) {
    if (!this.el) this.init();
    if (!this.el) return;
    this.body.className = `modal ${isWide ? 'modal-wide' : ''}`;
    this.body.innerHTML = `
      <button class="modal-close" aria-label="Close modal" title="Close"><i class="fa-solid fa-xmark"></i></button>
      ${html}
    `;
    this.body.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.el.classList.add('open');
  },
  close() {
    if (this.el) {
      this.el.classList.remove('open');
      this.body.innerHTML = '';
    }
  },
};

// ==========================================================================
// EVENTS CALENDAR COMPONENT
// ==========================================================================
class EventsCalendar {
  constructor({ containerId, events = [], canManage = false, onDeleteEvent, onEventAdded }) {
    this.container = document.getElementById(containerId);
    this.events = events;
    this.canManage = canManage;
    this.onDeleteEvent = onDeleteEvent;
    this.onEventAdded = onEventAdded;
    this.currentDate = new Date();
    this.viewMode = 'calendar'; // 'calendar' or 'list'
  }

  setEvents(events) {
    this.events = events;
    this.render();
  }

  nextMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    this.render();
  }

  prevMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    this.render();
  }

  today() {
    this.currentDate = new Date();
    this.render();
  }

  setView(mode) {
    this.viewMode = mode;
    this.render();
  }

  showEventDetails(ev) {
    const formattedDate = new Date(ev.date).toLocaleDateString(undefined, {
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

    Modal.open(`
      <h3>Event Details</h3>
      <div class="event-detail-item">
        <div class="event-detail-label">Event Title</div>
        <div class="event-detail-val" style="font-weight:700; font-size:17px; color:var(--primary);">${ev.title}</div>
      </div>
      <div class="event-detail-item">
        <div class="event-detail-label">Date</div>
        <div class="event-detail-val"><i class="fa-regular fa-calendar" style="margin-right:6px; color:var(--primary);"></i> ${formattedDate}</div>
      </div>
      <div class="event-detail-item">
        <div class="event-detail-label">Audience</div>
        <div class="event-detail-val">
          <span class="badge ${ev.audience === 'teachers' ? 'pending' : (ev.audience === 'parents' ? 'partial' : 'approved')}">
            ${audienceLabels[ev.audience] || ev.audience || 'All'}
          </span>
        </div>
      </div>
      ${ev.description ? `
        <div class="event-detail-item">
          <div class="event-detail-label">Description</div>
          <div class="event-detail-val" style="background:#F8FAFC; padding:12px; border-radius:8px; border:1px solid #E2E8F0; line-height:1.5;">${ev.description}</div>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid #E2E8F0;">
        ${this.canManage ? `
          <button class="btn btn-danger btn-sm" id="calDeleteEventBtn">
            <i class="fa-solid fa-trash-can"></i> Remove Event
          </button>
        ` : '<div></div>'}
        <button class="btn btn-ghost btn-sm" id="calCloseEventBtn">Close</button>
      </div>
    `);

    document.getElementById('calCloseEventBtn').addEventListener('click', () => Modal.close());
    if (this.canManage && this.onDeleteEvent) {
      document.getElementById('calDeleteEventBtn').addEventListener('click', async () => {
        if (confirm(`Are you sure you want to remove the event "${ev.title}"?`)) {
          Modal.close();
          await this.onDeleteEvent(ev._id);
        }
      });
    }
  }

  render() {
    if (!this.container) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[month];

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    // Build Toolbar
    let html = `
      <div class="calendar-card">
        <div class="calendar-toolbar">
          <div class="calendar-month-heading">
            <i class="fa-regular fa-calendar-days" style="color:var(--primary);"></i>
            <span>${monthName} ${year}</span>
          </div>

          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div class="calendar-nav-group">
              <button class="calendar-nav-btn" data-cal-prev title="Previous Month" aria-label="Previous Month">
                <i class="fa-solid fa-chevron-left"></i>
              </button>
              <button class="btn btn-ghost btn-sm" data-cal-today>Today</button>
              <button class="calendar-nav-btn" data-cal-next title="Next Month" aria-label="Next Month">
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>

            <div style="display:inline-flex; border:1px solid #CBD5E1; border-radius:6px; overflow:hidden;">
              <button class="btn btn-sm ${this.viewMode === 'calendar' ? 'btn-primary' : 'btn-ghost'}" data-cal-view="calendar" style="border-radius:0; border:none; padding:6px 12px;">
                <i class="fa-solid fa-calendar-days"></i> Calendar
              </button>
              <button class="btn btn-sm ${this.viewMode === 'list' ? 'btn-primary' : 'btn-ghost'}" data-cal-view="list" style="border-radius:0; border:none; padding:6px 12px;">
                <i class="fa-solid fa-list-ul"></i> List
              </button>
            </div>
          </div>
        </div>
    `;

    if (this.viewMode === 'calendar') {
      // Days of the week header
      html += `
        <div class="calendar-days-header">
          <div class="calendar-day-header-cell">Sun</div>
          <div class="calendar-day-header-cell">Mon</div>
          <div class="calendar-day-header-cell">Tue</div>
          <div class="calendar-day-header-cell">Wed</div>
          <div class="calendar-day-header-cell">Thu</div>
          <div class="calendar-day-header-cell">Fri</div>
          <div class="calendar-day-header-cell">Sat</div>
        </div>
        <div class="calendar-grid">
      `;

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      // Total calendar cells (either 35 or 42)
      const totalCells = (firstDay + daysInMonth) > 35 ? 42 : 35;

      for (let i = 0; i < totalCells; i++) {
        let cellDay = 0;
        let isOtherMonth = false;
        let cellDate = null;

        if (i < firstDay) {
          cellDay = daysInPrevMonth - firstDay + 1 + i;
          isOtherMonth = true;
          cellDate = new Date(year, month - 1, cellDay);
        } else if (i >= firstDay + daysInMonth) {
          cellDay = i - (firstDay + daysInMonth) + 1;
          isOtherMonth = true;
          cellDate = new Date(year, month + 1, cellDay);
        } else {
          cellDay = i - firstDay + 1;
          cellDate = new Date(year, month, cellDay);
        }

        const isTodayCell = isCurrentMonth && !isOtherMonth && cellDay === today.getDate();

        // Match events for this date
        const matchingEvents = this.events.filter((e) => {
          const d = new Date(e.date);
          return (
            d.getFullYear() === cellDate.getFullYear() &&
            d.getMonth() === cellDate.getMonth() &&
            d.getDate() === cellDate.getDate()
          );
        });

        const hasEvents = matchingEvents.length > 0;

        html += `
          <div class="calendar-cell ${isOtherMonth ? 'other-month' : ''} ${isTodayCell ? 'today' : ''} ${hasEvents ? 'has-events' : ''}" data-cal-date="${cellDate.toISOString()}">
            <div class="calendar-cell-top">
              <span class="day-number">${cellDay}</span>
              ${hasEvents ? `<span class="has-events-badge">${matchingEvents.length}</span>` : ''}
            </div>
            <div class="calendar-events-container">
              ${matchingEvents.slice(0, 3).map((ev) => `
                <div class="event-pill audience-${ev.audience || 'all'}" data-event-id="${ev._id}" title="${ev.title}">
                  ${ev.title}
                </div>
              `).join('')}
              ${matchingEvents.length > 3 ? `<div style="font-size:10px; color:var(--primary); font-weight:700;">+${matchingEvents.length - 3} more</div>` : ''}
            </div>
          </div>
        `;
      }

      html += `</div></div>`; // Close grid and card
    } else {
      // List View
      const sortedEvents = [...this.events].sort((a, b) => new Date(a.date) - new Date(b.date));

      html += `<div style="padding:20px;">`;
      if (sortedEvents.length) {
        html += sortedEvents.map((ev) => {
          const formatted = new Date(ev.date).toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          return `
            <div class="card" style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
              <div>
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                  <h3 style="margin:0; font-size:16px;">${ev.title}</h3>
                  <span class="badge ${ev.audience === 'teachers' ? 'pending' : (ev.audience === 'parents' ? 'partial' : 'approved')}">
                    ${ev.audience || 'all'}
                  </span>
                </div>
                <p style="margin:0 0 4px; font-size:13.5px; color:var(--primary); font-weight:600;">
                  <i class="fa-regular fa-calendar"></i> ${formatted}
                </p>
                ${ev.description ? `<p style="margin:0; font-size:13.5px; color:var(--ink-soft);">${ev.description}</p>` : ''}
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-secondary btn-sm" data-view-event-id="${ev._id}">
                  <i class="fa-solid fa-eye"></i> Details
                </button>
                ${this.canManage ? `
                  <button class="btn btn-ghost btn-sm" data-del-event-id="${ev._id}">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');
      } else {
        html += `
          <div class="empty-state">
            <i class="fa-regular fa-calendar-xmark"></i>
            <p>No events scheduled yet.</p>
          </div>
        `;
      }
      html += `</div></div>`; // Close list & card
    }

    this.container.innerHTML = html;

    // Attach Toolbar Event Listeners
    const prevBtn = this.container.querySelector('[data-cal-prev]');
    const nextBtn = this.container.querySelector('[data-cal-next]');
    const todayBtn = this.container.querySelector('[data-cal-today]');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevMonth());
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextMonth());
    if (todayBtn) todayBtn.addEventListener('click', () => this.today());

    this.container.querySelectorAll('[data-cal-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.setView(btn.dataset.calView));
    });

    // Attach Event Pill Listeners (Calendar View)
    this.container.querySelectorAll('[data-event-id]').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const ev = this.events.find((x) => x._id === pill.dataset.eventId);
        if (ev) this.showEventDetails(ev);
      });
    });

    // Attach Date Cell Click Listeners
    this.container.querySelectorAll('.calendar-cell.has-events').forEach((cell) => {
      cell.addEventListener('click', () => {
        const cellDate = new Date(cell.dataset.calDate);
        const dayEvents = this.events.filter((e) => {
          const d = new Date(e.date);
          return (
            d.getFullYear() === cellDate.getFullYear() &&
            d.getMonth() === cellDate.getMonth() &&
            d.getDate() === cellDate.getDate()
          );
        });
        if (dayEvents.length === 1) {
          this.showEventDetails(dayEvents[0]);
        } else if (dayEvents.length > 1) {
          // Show list of events on this date
          Modal.open(`
            <h3>Events on ${cellDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</h3>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
              ${dayEvents.map((ev) => `
                <div class="card" style="padding:14px; cursor:pointer;" data-sub-event="${ev._id}">
                  <div style="font-weight:700; color:var(--primary); font-size:15px;">${ev.title}</div>
                  <div style="font-size:12.5px; color:var(--ink-muted); margin-top:2px;">Audience: ${ev.audience}</div>
                  ${ev.description ? `<p style="margin:4px 0 0; font-size:13px;">${ev.description}</p>` : ''}
                </div>
              `).join('')}
            </div>
          `);
          document.querySelectorAll('[data-sub-event]').forEach((card) => {
            card.addEventListener('click', () => {
              const ev = this.events.find((x) => x._id === card.dataset.subEvent);
              if (ev) this.showEventDetails(ev);
            });
          });
        }
      });
    });

    // Attach List View Listeners
    this.container.querySelectorAll('[data-view-event-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ev = this.events.find((x) => x._id === btn.dataset.viewEventId);
        if (ev) this.showEventDetails(ev);
      });
    });
    if (this.canManage && this.onDeleteEvent) {
      this.container.querySelectorAll('[data-del-event-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ev = this.events.find((x) => x._id === btn.dataset.delEventId);
          if (ev && confirm(`Are you sure you want to remove "${ev.title}"?`)) {
            await this.onDeleteEvent(ev._id);
          }
        });
      });
    }
  }
}

// ==========================================================================
// STUDENT DETAILS & AUTHORIZED PICKUP MODAL HELPERS (Admin & Teacher)
// ==========================================================================

async function showStudentDetailsModal(studentId, { canEdit = true, onStudentUpdated } = {}) {
  try {
    const [{ student }, { authorizations }] = await Promise.all([
      api.get(`/students/${studentId}`),
      api.get(`/pickup/student/${studentId}`),
    ]);

    const renderModalContent = (s, pickupList) => {
      const birthdateStr = s.birthdate ? new Date(s.birthdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not specified';

      return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #E2E8F0; padding-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:22px; color:var(--ink);">${s.name}</h3>
            <span class="badge ${s.status}">${s.status}</span>
          </div>
          ${canEdit ? `
            <button class="btn btn-secondary btn-sm" id="modalEditStudentBtn">
              <i class="fa-solid fa-pen-to-square"></i> Edit Student
            </button>
          ` : ''}
        </div>

        <div class="grid-2" style="margin-bottom:20px;">
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Class</div>
            <div style="font-weight:600; font-size:14.5px;">${s.className || 'Unassigned'}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Birthdate</div>
            <div style="font-weight:600; font-size:14.5px;">${birthdateStr}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Parent / Guardian</div>
            <div style="font-weight:600; font-size:14.5px;">${s.parent ? `${s.parent.name} (${s.parent.email || s.parent.phone || ''})` : 'None linked'}</div>
          </div>
          <div style="background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Assigned Teacher</div>
            <div style="font-weight:600; font-size:14.5px;">${s.teacher ? s.teacher.name : 'Unassigned'}</div>
          </div>
        </div>

        ${s.notes ? `
          <div style="margin-bottom:20px; background:#F8FAFC; padding:12px 14px; border-radius:8px; border:1px solid #E2E8F0;">
            <div class="event-detail-label">Notes &amp; Dietary / Medical Info</div>
            <div style="font-size:14px; color:var(--ink-soft);">${s.notes}</div>
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
                    ${p.authorizedName}
                    ${p.verified && p.verified.length ? `<span class="badge approved" style="margin-left:6px;"><i class="fa-solid fa-check-double"></i> Verified ${p.verified.length}×</span>` : ''}
                  </div>
                  <div class="info-meta">
                    <strong>Relationship:</strong> ${p.relationship} &nbsp;|&nbsp;
                    <strong>Contact:</strong> ${p.contact}
                  </div>
                  ${p.identification ? `
                    <div class="info-meta" style="margin-top:4px;">
                      <strong>ID / Details:</strong> ${p.identification}
                    </div>
                  ` : ''}
                </div>
                ${canEdit ? `
                  <div class="pickup-actions">
                    <button class="btn btn-ghost btn-sm" data-edit-p="${p._id}" title="Edit Person">
                      <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn btn-danger btn-sm" data-del-p="${p._id}" title="Remove Person">
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
          if (onStudentUpdated) onStudentUpdated(updatedStudent);
          showStudentDetailsModal(studentId, { canEdit, onStudentUpdated });
        });
      });

      // Bind Add Pickup button
      document.getElementById('modalAddPickupBtn')?.addEventListener('click', () => {
        openPickupFormModal({ studentId }, async () => {
          showStudentDetailsModal(studentId, { canEdit, onStudentUpdated });
        });
      });

      // Bind Edit Pickup buttons
      document.querySelectorAll('[data-edit-p]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = authorizations.find((a) => a._id === btn.dataset.editP);
          if (item) {
            openPickupFormModal({ studentId, pickup: item }, async () => {
              showStudentDetailsModal(studentId, { canEdit, onStudentUpdated });
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
            showStudentDetailsModal(studentId, { canEdit, onStudentUpdated });
          }
        });
      });
    }
  } catch (err) {
    alert('Could not load student details: ' + err.message);
  }
}

// Edit Student Modal (Used by both Admin and Teacher)
async function openEditStudentModal(student, onSaved) {
  const [{ users: parents }, { users: teachers }] = await Promise.all([
    api.get('/users?role=parent&status=approved'),
    api.get('/users?role=teacher'),
  ]);

  const birthdateFormatted = student.birthdate ? new Date(student.birthdate).toISOString().slice(0, 10) : '';

  Modal.open(`
    <h3>Edit Student Information</h3>
    <div id="modalEditMsg" class="form-msg"></div>
    <form id="editStudentForm">
      <div class="field">
        <label for="esName">Full Name</label>
        <input type="text" id="esName" value="${student.name || ''}" required />
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="esBirthdate">Birthdate</label>
          <input type="date" id="esBirthdate" value="${birthdateFormatted}" />
        </div>
        <div class="field">
          <label for="esClass">Class / Grade</label>
          <input type="text" id="esClass" value="${student.className || ''}" placeholder="e.g. Sunbeams" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="esParent">Parent / Guardian</label>
          <select id="esParent">
            <option value="">— Unassigned —</option>
            ${parents.map((p) => `
              <option value="${p.id}" ${student.parent && (student.parent._id === p.id || student.parent === p.id) ? 'selected' : ''}>
                ${p.name} (${p.email})
              </option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label for="esTeacher">Assigned Teacher</label>
          <select id="esTeacher">
            <option value="">— Unassigned —</option>
            ${teachers.map((t) => `
              <option value="${t.id}" ${student.teacher && (student.teacher._id === t.id || student.teacher === t.id) ? 'selected' : ''}>
                ${t.name}
              </option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="esNotes">Notes (Medical, Allergies, Special Needs)</label>
        <textarea id="esNotes" rows="3" placeholder="Enter notes or special considerations…">${student.notes || ''}</textarea>
      </div>

      <div class="field">
        <label for="esStatus">Status</label>
        <select id="esStatus">
          <option value="active" ${student.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="archived" ${student.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select>
      </div>

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
    msg.className = 'form-msg';

    const payload = {
      name: document.getElementById('esName').value.trim(),
      birthdate: document.getElementById('esBirthdate').value || null,
      className: document.getElementById('esClass').value.trim(),
      parent: document.getElementById('esParent').value || null,
      teacher: document.getElementById('esTeacher').value || null,
      notes: document.getElementById('esNotes').value.trim(),
      status: document.getElementById('esStatus').value,
    };

    try {
      const res = await api.patch(`/students/${student._id}`, payload);
      Modal.close();
      if (onSaved) onSaved(res.student);
    } catch (err) {
      showMsg(msg, err.message);
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

      <div class="field">
        <label for="ppId">Identification / Additional Details</label>
        <input type="text" id="ppId" value="${isEditing ? (pickup.identification || '') : ''}" placeholder="e.g. Driver's License #, Authorized on Fridays" />
        <div class="field-hint">Specify ID type, number, or any specific pickup authorization instructions.</div>
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
      identification: document.getElementById('ppId').value.trim(),
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

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  initLogout();
  setWhoName();
  if (document.getElementById('modalBackdrop')) Modal.init();
});
