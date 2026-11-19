// Generates ERD SVGs for docs/schema. Usage: node erd.js <outDir>
const fs = require('fs');
const path = require('path');
const outDir = process.argv[2];

const W = 270, HEAD = 34, ROW = 22, PAD = 8;
const C = {
  people: '#2563eb', enroll: '#059669', records: '#7c3aed', finance: '#d97706',
  comm: '#0891b2', alert: '#dc2626', sec: '#475569', integ: '#db2777', ref: '#94a3b8',
};

// field: [key, name, type]
const E = {
  USER: ['User', 'people', [['PK', '_id', 'ObjectId'], ['UK', 'email', 'String'], ['', 'name', 'String'], ['', 'password', 'String (hash)'], ['', 'role', 'admin|teacher|parent'], ['', 'status', 'pending|approved|…'], ['', 'position', 'String'], ['', 'assignedClass', 'String']]],
  CLASSROOM: ['Classroom', 'people', [['PK', '_id', 'ObjectId'], ['', 'name', 'String'], ['UK', 'nameKey', 'String'], ['FK', 'teacher', '→ User'], ['', 'status', 'active|archived']]],
  STUDENT: ['Student', 'people', [['PK', '_id', 'ObjectId'], ['UK', 'studentId', 'STU-XXXXXXXX'], ['', 'name', 'String'], ['', 'birthdate', 'Date'], ['', 'className', 'String'], ['FK', 'parent', '→ User'], ['FK', 'teacher', '→ User'], ['FK', 'enrollmentApplication', '→ Application'], ['', 'status', 'active|archived']]],
  PERIOD: ['EnrollmentPeriod', 'enroll', [['PK', '_id', 'ObjectId'], ['', 'term', 'String'], ['', 'schoolYear', 'String'], ['', 'opensAt', 'Date'], ['', 'closesAt', 'Date'], ['', 'enabled', 'Boolean']]],
  APP: ['EnrollmentApplication', 'enroll', [['PK', '_id', 'ObjectId'], ['FK', 'applicant', '→ User'], ['FK', 'period', '→ Period'], ['', 'studentName', 'String'], ['', 'birthdate', 'Date'], ['', 'status', 'pending|approved|…'], ['FK', 'student', '→ Student']]],
  ATT: ['Attendance', 'records', [['PK', '_id', 'ObjectId'], ['FK', 'student', '→ Student'], ['', 'date', 'Date'], ['', 'status', 'present|absent|…'], ['FK', 'markedBy', '→ User']]],
  PROG: ['AcademicProgress', 'records', [['PK', '_id', 'ObjectId'], ['FK', 'student', '→ Student'], ['FK', 'teacher', '→ User'], ['', 'entryType', 'activity|weekly|…'], ['', 'periodStart/End', 'Date'], ['', 'evaluation', 'String'], ['', 'attachments', '[embedded]']]],
  PICK: ['PickupAuthorization', 'records', [['PK', '_id', 'ObjectId'], ['FK', 'student', '→ Student'], ['', 'authorizedName', 'String'], ['', 'relationship', 'String'], ['', 'contact', 'String'], ['', 'verified', '[embedded]']]],
  FEE: ['Fee', 'finance', [['PK', '_id', 'ObjectId'], ['FK', 'student', '→ Student'], ['', 'description', 'String'], ['', 'amount', 'Number'], ['', 'amountPaid', 'Number'], ['', 'dueDate', 'Date'], ['', 'status', 'unpaid|partial|paid']]],
  PAY: ['Payment', 'finance', [['PK', '_id', 'ObjectId'], ['FK', 'fee', '→ Fee'], ['', 'amountPaid', 'Number'], ['', 'datePaid', 'Date'], ['', 'method', 'Cash'], ['', 'receiptNumber', 'String'], ['', 'receiptState', 'issued|voided|…']]],
  RC: ['ReceiptCounter', 'finance', [['PK', '_id', 'String'], ['', 'sequence', 'Number']]],

  CONV: ['Conversation', 'comm', [['PK', '_id', 'ObjectId'], ['', 'name', 'String'], ['FK', 'participants', '[→ User]'], ['FK', 'students', '[→ Student]'], ['FK', 'createdBy', '→ User']]],
  MSG: ['Message', 'comm', [['PK', '_id', 'ObjectId'], ['FK', 'sender', '→ User'], ['FK', 'receiver', '→ User'], ['FK', 'conversation', '→ Conversation'], ['FK', 'student', '→ Student'], ['', 'content', 'String'], ['', 'readBy', '[→ User]']]],
  EVENT: ['Event', 'comm', [['PK', '_id', 'ObjectId'], ['', 'title', 'String'], ['', 'date', 'Date'], ['', 'venue / location', 'String / embedded'], ['', 'targetClasses', '[String]'], ['', 'audience', 'all|teachers|parents'], ['', 'publicationStatus', 'draft|published|…'], ['FK', 'createdBy', '→ User']]],
  ALERT: ['EmergencyAlert', 'alert', [['PK', '_id', 'ObjectId'], ['', 'title', 'String'], ['', 'severity', 'low|…|critical'], ['', 'status', 'active|all-clear|…'], ['', 'affectedClasses', '[String]'], ['FK', 'students', '[→ Student]'], ['', 'acknowledgements', '[embedded]'], ['', 'updates', '[embedded]'], ['FK', 'createdBy', '→ User']]],
  NOTIF: ['Notification', 'comm', [['PK', '_id', 'ObjectId'], ['FK', 'parent', '→ User'], ['', 'type', 'fee|event|emergency|…'], ['FK', 'fee / payment', '→ Fee / Payment'], ['FK', 'event / alert', '→ Event / Alert'], ['FK', 'attendance', '→ Attendance'], ['FK', 'academicProgress', '→ AcademicProgress'], ['', 'readAt', 'Date']]],
  EMAIL: ['EmailLog', 'comm', [['PK', '_id', 'ObjectId'], ['FK', 'parent', '→ User'], ['', 'type', 'event|emergency|fee'], ['FK', 'event / alert / fee', '→ …'], ['FK', 'notification', '→ Notification'], ['', 'status', 'sent|failed|skipped']]],

  ROLE: ['RolePermission', 'sec', [['PK', '_id', 'ObjectId'], ['UK', 'position', 'String'], ['', 'permissions', 'Mixed'], ['FK', 'updatedBy', '→ User']]],
  REVOKED: ['RevokedToken', 'sec', [['PK', '_id', 'ObjectId'], ['UK', 'tokenHash', 'SHA-256'], ['FK', 'user', '→ User'], ['', 'expiresAt', 'Date (TTL)']]],
  LOCK: ['EditLock', 'sec', [['PK', '_id', 'ObjectId'], ['', 'resource', 'String'], ['', 'recordId', 'ObjectId (any)'], ['FK', 'user', '→ User'], ['', 'expiresAt', 'Date (TTL)']]],
  LOG: ['ActivityLog', 'sec', [['PK', '_id', 'ObjectId'], ['FK', 'user', '→ User'], ['', 'action', 'String'], ['', 'details', 'String']]],
  AUTHS: ['AuthSettings', 'sec', [['PK', '_id', 'ObjectId'], ['UK', 'key', '"global"'], ['', 'googleAuthEnabled', 'Boolean'], ['', 'captchaEnabled', 'Boolean'], ['', 'activeGoogleOAuthClientId', 'String'], ['', 'activeRecaptchaClientId', 'String']]],
  GOC: ['GoogleOAuthClient', 'sec', [['PK', '_id', 'ObjectId'], ['', 'label', 'String'], ['UK', 'normalizedClientId', 'String'], ['', 'callbackUrl', 'String'], ['', 'encryptedClientSecret', 'hidden']]],
  RECAP: ['RecaptchaClient', 'sec', [['PK', '_id', 'ObjectId'], ['', 'label', 'String'], ['UK', 'normalizedSiteKey', 'String'], ['', 'allowedHostnames', '[String]'], ['', 'encryptedSecret', 'hidden']]],
  CAL: ['CalendarIntegration', 'integ', [['PK', '_id', 'ObjectId'], ['UK', 'key', '"google"'], ['', 'connected', 'Boolean'], ['', 'calendarId', 'String'], ['', 'encryptedRefreshToken', 'hidden'], ['FK', 'connectedBy', '→ User'], ['', 'pendingDeletions', '[embedded]']]],
  PCONN: ['PersonalGoogleCalendarConnection', 'integ', [['PK', '_id', 'ObjectId'], ['FK', 'userId', '→ User (unique)'], ['', 'connected', 'Boolean'], ['', 'shareCalendarWithSchool', 'Boolean'], ['', 'encryptedRefreshToken', 'hidden'], ['', 'lastCalendarSyncAt', 'Date']]],
  PEVT: ['PersonalGoogleCalendarEvent', 'integ', [['PK', '_id', 'ObjectId'], ['FK', 'userId', '→ User'], ['FK', 'eventId', '→ Event'], ['', 'googleEventId', 'String'], ['', 'status', 'pending|synced|…']]],
  IMP: ['ImportedGoogleCalendarEvent', 'integ', [['PK', '_id', 'ObjectId'], ['FK', 'userId', '→ User'], ['', 'googleEventId', 'String'], ['', 'title', 'String'], ['', 'date', 'Date'], ['', 'status', 'active|removed']]],
  DRIVE: ['GoogleDriveConnection', 'integ', [['PK', '_id', 'ObjectId'], ['FK', 'userId', '→ User (unique)'], ['', 'connected', 'Boolean'], ['', 'accountEmail', 'String'], ['', 'encryptedRefreshToken', 'hidden']]],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function boxSize(id, ref) {
  if (ref) return { w: 200, h: HEAD };
  return { w: W, h: HEAD + E[id][2].length * ROW + PAD };
}

function render(file, title, subtitle, nodes, edges, width, height, legendGroups) {
  const pos = {};
  for (const n of nodes) {
    const s = boxSize(n.id, n.ref);
    pos[n.key || n.id] = { ...n, ...s };
  }
  const pt = (k, side, off = 0.5) => {
    const b = pos[k];
    if (!b) throw new Error('missing ' + k);
    if (side === 't') return [b.x + b.w * off, b.y];
    if (side === 'b') return [b.x + b.w * off, b.y + b.h];
    if (side === 'l') return [b.x, b.y + Math.min(b.h * off, b.h - 6)];
    return [b.x + b.w, b.y + Math.min(b.h * off, b.h - 6)];
  };
  let lines = '', labels = '';
  for (const e of edges) {
    const [a, as, ao, b, bs, bo, label, ca, cb, dashed, mid, lpos, wps] = e;
    const p1 = pt(a, as, ao), p2 = pt(b, bs, bo);
    const vA = as === 't' || as === 'b', vB = bs === 't' || bs === 'b';
    let d, lx, ly;
    if (vA && vB) {
      const my = mid ?? (p1[1] + p2[1]) / 2;
      d = `M${p1[0]},${p1[1]} V${my} H${p2[0]} V${p2[1]}`;
      if (Math.abs(p1[0] - p2[0]) < 2) { lx = p1[0] + 6; ly = (p1[1] + p2[1]) / 2; } else { lx = (p1[0] + p2[0]) / 2; ly = my - 5; }
    } else if (!vA && !vB) {
      const mx = mid ?? (p1[0] + p2[0]) / 2;
      d = `M${p1[0]},${p1[1]} H${mx} V${p2[1]} H${p2[0]}`;
      if (Math.abs(p1[1] - p2[1]) < 2) { lx = (p1[0] + p2[0]) / 2; ly = p1[1] - 5; } else { lx = mx + 6; ly = (p1[1] + p2[1]) / 2; }
    } else if (!vA && vB) {
      d = `M${p1[0]},${p1[1]} H${p2[0]} V${p2[1]}`;
      lx = (p1[0] + p2[0]) / 2; ly = p1[1] - 5;
    } else {
      d = `M${p1[0]},${p1[1]} V${p2[1]} H${p2[0]}`;
      lx = p1[0] + 6; ly = (p1[1] + p2[1]) / 2;
    }
    if (wps) d = `M${p1[0]},${p1[1]} ` + wps.map(([x, y]) => `L${x},${y}`).join(' ') + ` L${p2[0]},${p2[1]}`;
    if (lpos) { lx = lpos[0]; ly = lpos[1]; }
    lines += `<path d="${d}" fill="none" stroke="#64748b" stroke-width="1.6" ${dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
    if (label) {
      const anchor = 'middle';
      labels += `<text x="${lx}" y="${ly}" text-anchor="${(vA && vB && Math.abs(p1[0] - p2[0]) < 2) || (!vA && !vB && Math.abs(p1[1] - p2[1]) >= 2) || (vA && !vB) ? 'start' : anchor}" class="lbl">${esc(label)}</text>`;
    }
    const card = (p, side, txt) => {
      if (!txt) return '';
      const dx = side === 'l' ? -14 : side === 'r' ? 8 : 6;
      const dy = side === 't' ? -6 : side === 'b' ? 15 : -5;
      return `<text x="${p[0] + dx}" y="${p[1] + dy}" class="card">${txt}</text>`;
    };
    labels += card(p1, as, ca) + card(p2, bs, cb);
  }
  let boxes = '';
  for (const k of Object.keys(pos)) {
    const b = pos[k];
    if (b.ref) {
      boxes += `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="#f8fafc" stroke="${C.ref}" stroke-dasharray="4 3" stroke-width="1.5"/>
        <text x="${b.x + b.w / 2}" y="${b.y + 22}" text-anchor="middle" class="refname">${esc(E[b.id][0])}</text></g>`;
      continue;
    }
    const [name, grp, fields] = E[b.id];
    const col = C[grp];
    let rows = '';
    fields.forEach(([key, fname, type], i) => {
      const y = b.y + HEAD + i * ROW + 16;
      if (i % 2 === 1) rows += `<rect x="${b.x + 1}" y="${b.y + HEAD + i * ROW + 2}" width="${b.w - 2}" height="${ROW}" fill="#f8fafc"/>`;
      if (key) rows += `<text x="${b.x + 10}" y="${y}" class="key key${key}">${key}</text>`;
      rows += `<text x="${b.x + 38}" y="${y}" class="fname">${esc(fname)}</text>`;
      rows += `<text x="${b.x + b.w - 10}" y="${y}" text-anchor="end" class="ftype">${esc(type)}</text>`;
    });
    boxes += `<g>
      <rect x="${b.x + 2}" y="${b.y + 3}" width="${b.w}" height="${b.h}" rx="8" fill="#0f172a" opacity="0.06"/>
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="#fff" stroke="${col}" stroke-width="1.5"/>
      <path d="M${b.x},${b.y + HEAD} V${b.y + 8} a8,8 0 0 1 8,-8 H${b.x + b.w - 8} a8,8 0 0 1 8,8 V${b.y + HEAD} Z" fill="${col}"/>
      <text x="${b.x + 12}" y="${b.y + 22}" class="ename">${esc(name)}</text>
      ${rows}</g>`;
  }
  const legendY = height - 34;
  const legendNames = { people: 'People & classes', enroll: 'Enrollment', records: 'Learning records', finance: 'Fees & payments', comm: 'Communication', alert: 'Emergency', sec: 'Security & settings', integ: 'Google integrations' };
  let legend = '', lx = 40;
  for (const g of legendGroups) {
    legend += `<rect x="${lx}" y="${legendY - 11}" width="14" height="14" rx="3" fill="${C[g]}"/><text x="${lx + 20}" y="${legendY}" class="leg">${esc(legendNames[g])}</text>`;
    lx += 30 + legendNames[g].length * 7.2;
  }
  legend += `<line x1="${lx}" y1="${legendY - 4}" x2="${lx + 36}" y2="${legendY - 4}" stroke="#64748b" stroke-width="1.6"/><text x="${lx + 44}" y="${legendY}" class="leg">ObjectId reference</text>`;
  lx += 190;
  legend += `<line x1="${lx}" y1="${legendY - 4}" x2="${lx + 36}" y2="${legendY - 4}" stroke="#64748b" stroke-width="1.6" stroke-dasharray="6 4"/><text x="${lx + 44}" y="${legendY}" class="leg">Linked by text value</text>`;
  lx += 190;
  legend += `<rect x="${lx}" y="${legendY - 12}" width="36" height="16" rx="4" fill="#f8fafc" stroke="${C.ref}" stroke-dasharray="4 3"/><text x="${lx + 44}" y="${legendY}" class="leg">Defined in another diagram</text>`;
  lx += 240;
  legend += `<text x="${lx}" y="${legendY}" class="leg"><tspan class="keyPK" font-weight="700">PK</tspan> primary key · <tspan class="keyFK" font-weight="700">FK</tspan> reference · <tspan class="keyUK" font-weight="700">UK</tspan> unique · 1 / N cardinality</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif">
  <style>
    .ename{font-size:14px;font-weight:700;fill:#fff}
    .refname{font-size:13px;font-weight:600;fill:#475569}
    .fname{font-size:12.5px;fill:#0f172a}
    .ftype{font-size:11.5px;fill:#64748b}
    .key{font-size:10.5px;font-weight:700}
    .keyPK{fill:#b45309}.keyFK{fill:#2563eb}.keyUK{fill:#059669}
    .lbl{font-size:11.5px;fill:#334155;font-style:italic;paint-order:stroke;stroke:#fff;stroke-width:4px}
    .card{font-size:12px;font-weight:700;fill:#0f172a;paint-order:stroke;stroke:#fff;stroke-width:4px}
    .title{font-size:24px;font-weight:700;fill:#0f172a}
    .sub{font-size:13px;fill:#64748b}
    .leg{font-size:12.5px;fill:#334155}
  </style>
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="40" y="46" class="title">${esc(title)}</text>
  <text x="40" y="70" class="sub">${esc(subtitle)}</text>
  ${lines}${boxes}${labels}${legend}
</svg>`;
  fs.writeFileSync(path.join(outDir, file), svg);
}

// ---------- 1. Core school ----------
{
  const H = (id) => boxSize(id).h;
  const r1 = 110, r2 = 470, r3 = 820;
  const nodes = [
    { id: 'PERIOD', x: 40, y: r1 }, { id: 'APP', x: 400, y: r1 }, { id: 'USER', x: 820, y: r1 }, { id: 'CLASSROOM', x: 1240, y: r1 },
    { id: 'STUDENT', x: 820, y: r2 },
    { id: 'ATT', x: 40, y: r3 }, { id: 'PROG', x: 350, y: r3 }, { id: 'PICK', x: 660, y: r3 }, { id: 'FEE', x: 970, y: r3 }, { id: 'PAY', x: 1330, y: r3 },
    { id: 'RC', x: 1660, y: r3 + 55 },
  ];
  const edges = [
    ['PERIOD', 'r', 60 / 174, 'APP', 'l', 60 / 196, 'receives', '1', 'N', false, null, [355, 192]],
    ['USER', 'l', 0.3, 'APP', 'r', 65.4 / 196, 'applies', '1', 'N', false, null, [745, 168]],
    ['APP', 'b', 0.3, 'STUDENT', 'l', 0.3, 'approved into', '1', '0..1', false, null, [600, 534]],
    ['USER', 'b', 0.35, 'STUDENT', 't', 0.35, 'parent', '1', 'N'],
    ['USER', 'b', 0.65, 'STUDENT', 't', 0.65, 'teacher', '1', 'N'],
    ['USER', 'r', 0.35, 'CLASSROOM', 'l', 0.5, 'homeroom teacher', '1', 'N', false, null, [1165, 205]],
    ['CLASSROOM', 'b', 0.5, 'STUDENT', 'r', 0.3, 'className = name', '1', 'N', true],
    ['STUDENT', 'b', 0.15, 'ATT', 't', 0.5, '', '1', 'N', false, 770],
    ['STUDENT', 'b', 0.32, 'PROG', 't', 0.4, '', '', 'N', false, 770],
    ['STUDENT', 'b', 0.5, 'PICK', 't', 0.5, '', '', 'N', false, 770],
    ['STUDENT', 'b', 0.85, 'FEE', 't', 0.5, 'billed', '', 'N', false, 770, [1080, 765]],
    ['USER', 'l', 0.9, 'PROG', 't', 0.85, 'records (teacher)', '1', 'N', false, null, [726, 420], [[720, 110 + 0.9 * 218], [720, 795], [350 + 0.85 * 270, 795]]],
    ['FEE', 'r', 0.5, 'PAY', 'l', 0.5, 'paid by', '1', 'N', false, null, [1285, 942]],
    ['PAY', 'r', 0.5, 'RC', 'l', 43 / 86, 'numbers', '', '', true, null, [1630, 908]],
  ];
  render('1-core-school.svg', 'Collab Preschool — Core School Data', 'Users, classes, students, enrollment, attendance, progress, pickup, fees and payments', nodes, edges, 1960, 1110, ['people', 'enroll', 'records', 'finance']);
}

// ---------- 2. Communication ----------
{
  const r1 = 130, r2 = 520, r3 = 900;
  const uh = 218, nh = 218, mh = 196, ah = 240;
  const nodes = [
    { id: 'CONV', x: 40, y: r1 }, { id: 'MSG', x: 400, y: r1 }, { id: 'USER', x: 780, y: r1 }, { id: 'STUDENT', key: 'STUDENT', x: 1289, y: 400, ref: true },
    { id: 'EVENT', x: 400, y: r2 }, { id: 'NOTIF', x: 780, y: r2 }, { id: 'ALERT', x: 1200, y: r2 },
    { id: 'FEE', key: 'FEE', x: 140, y: r3, ref: true }, { id: 'PAY', key: 'PAY', x: 380, y: r3, ref: true }, { id: 'ATT', key: 'ATT', x: 600, y: r3, ref: true }, { id: 'PROG', key: 'PROG', x: 820, y: r3, ref: true },
    { id: 'EMAIL', x: 1200, y: r3 },
  ];
  const edges = [
    ['USER', 'l', 0.2, 'MSG', 'r', 0.2 * uh / mh, 'sends / receives', '1', 'N', false, null, [725, r1 + 0.2 * uh + 18]],
    ['CONV', 'r', 0.5, 'MSG', 'l', 76 / mh, 'contains', '1', 'N', false, null, [370, r1 + 94]],
    ['USER', 't', 0.3, 'CONV', 't', 0.5, 'participants (many-to-many)', 'N', 'N', false, 104],
    ['USER', 'b', 0.2, 'EVENT', 't', 0.6, 'creates', '1', 'N', false, 460],
    ['USER', 'b', 0.8, 'ALERT', 't', 0.3, 'creates', '1', 'N', false, 460],
    ['STUDENT', 'b', 0.5, 'ALERT', 't', 0.7, 'affected', 'N', 'N'],
    ['USER', 'b', 0.5, 'NOTIF', 't', 0.5, 'receives (parent)', '1', 'N', false, null, [921, 420]],
    ['EVENT', 'r', 0.4, 'NOTIF', 'l', 0.4, 'about', '0..1', 'N', false, null, [725, r2 + 0.4 * nh + 18]],
    ['ALERT', 'l', 0.4 * nh / ah, 'NOTIF', 'r', 0.4, 'about', '0..1', 'N', false, null, [1125, r2 + 0.4 * nh + 18]],
    ['NOTIF', 'b', 0.1, 'FEE', 't', 0.5, '', 'N', '0..1', false, 860],
    ['NOTIF', 'b', 0.25, 'PAY', 't', 0.5, '', '', '0..1', false, 860],
    ['NOTIF', 'b', 0.4, 'ATT', 't', 0.5, '', '', '0..1', false, 860],
    ['NOTIF', 'b', 0.55, 'PROG', 't', 0.5, '', '', '0..1', false, 860],
    ['NOTIF', 'b', 0.9, 'EMAIL', 'l', 0.3, 'emailed as', '0..1', 'N', false, null, [1060, 940]],
    ['ALERT', 'b', 0.5, 'EMAIL', 't', 0.5, 'for', '0..1', 'N'],
    ['EVENT', 'l', 0.85, 'EMAIL', 'b', 0.5, 'for', '0..1', 'N', false, null, [600, 1112], [[100, r2 + 0.85 * 218], [100, 1120], [1335, 1120]]],
    ['USER', 'r', 0.85, 'EMAIL', 'r', 0.5, 'emailed (parent)', '1', 'N', false, null, [1536, 700], [[1540, r1 + 0.85 * uh], [1540, r3 + 87]]],
  ];
  render('2-communication.svg', 'Collab Preschool — Communication, Events & Alerts', 'Messaging, school events, emergency alerts, in-app notifications and the email log  (Message.student and Conversation.students also reference Student)', nodes, edges, 1660, 1220, ['people', 'comm', 'alert']);
}

// ---------- 3. Security & integrations ----------
{
  const nodes = [
    { id: 'ROLE', x: 40, y: 110 }, { id: 'REVOKED', x: 40, y: 330 }, { id: 'LOCK', x: 40, y: 540 }, { id: 'LOG', x: 40, y: 790 },
    { id: 'USER', x: 520, y: 400 },
    { id: 'CAL', x: 1000, y: 110 }, { id: 'PCONN', x: 1000, y: 420 }, { id: 'DRIVE', x: 1000, y: 700 },
    { id: 'IMP', x: 520, y: 840 }, { id: 'PEVT', x: 1000, y: 960 }, { id: 'EVENT', key: 'EVENT', x: 1400, y: 1010, ref: true },
    { id: 'AUTHS', x: 1440, y: 110 }, { id: 'GOC', x: 1440, y: 420 }, { id: 'RECAP', x: 1440, y: 640 },
  ];
  const edges = [
    ['ROLE', 'r', 0.5, 'USER', 'l', 0.15, 'position = position', '1', 'N', true, 470],
    ['USER', 'l', 0.35, 'REVOKED', 'r', 0.5, 'logged out', '1', 'N', false, 400, [406, 458]],
    ['USER', 'l', 0.6, 'LOCK', 'r', 0.5, 'holds', '1', 'N', false, 400],
    ['USER', 'l', 0.85, 'LOG', 'r', 0.5, 'performed', '1', 'N', false, 440],
    ['USER', 'r', 0.15, 'CAL', 'l', 0.6, 'connectedBy (admin)', '1', '0..1', false, 900],
    ['USER', 'r', 0.4, 'PCONN', 'l', 0.4, 'owns', '1', '0..1', false, 900],
    ['USER', 'r', 0.65, 'DRIVE', 'l', 0.4, 'owns', '1', '0..1', false, 940],
    ['USER', 'b', 0.5, 'IMP', 't', 0.5, 'imported', '1', 'N'],
    ['USER', 'r', 0.9, 'PEVT', 'l', 0.5, 'synced copies', '1', 'N', false, 900],
    ['EVENT', 'l', 0.5, 'PEVT', 'r', 0.5, 'copied to', '1', 'N'],
    ['AUTHS', 'b', 0.3, 'GOC', 't', 0.3, 'active client', '', '0..1', true],
    ['AUTHS', 'r', 0.85, 'RECAP', 'r', 0.5, 'active client', '', '0..1', true, 1745, [1752, 520]],
  ];
  render('3-security-integrations.svg', 'Collab Preschool — Security, Access Control & Google Integrations', 'Permissions, sessions, edit locks, audit log, sign-in settings and Google Calendar / Drive connections', nodes, edges, 1880, 1170, ['people', 'sec', 'integ']);
}
console.log('ok');
