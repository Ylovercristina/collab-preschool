# Play-is-School API Documentation

REST API for the Play-is-School preschool management system (Node.js, Express 5, MongoDB/Mongoose).
This document covers every endpoint the backend exposes, the authentication and permission model,
error formats, rate limits, and how **PDF reports** are generated.

See also: [DATA_SCHEMA.md](DATA_SCHEMA.md) for the database collections and fields.

---

## Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Roles and permissions](#3-roles-and-permissions)
4. [Common conventions](#4-common-conventions)
5. [Errors](#5-errors)
6. [Rate limits](#6-rate-limits)
7. [Endpoints](#7-endpoints)
8. [PDF report generation](#8-pdf-report-generation)
9. [Quick-start examples](#9-quick-start-examples)

---

## 1. Overview

| Item | Value |
|---|---|
| Base URL | `http://<host>:5000/api` (port from `PORT`, default `5000`) |
| Format | JSON request and response bodies (`Content-Type: application/json`) unless the endpoint says *multipart* |
| Auth | JWT Bearer token (`Authorization: Bearer <token>`) |
| Static files | `GET /uploads/...` serves public uploads (e.g. profile pictures) |
| Frontend client | [frontend/js/api.js](../frontend/js/api.js) (`api.get`, `api.post`, `api.patch`, `api.put`, `api.del`) |

The frontend finds the API at port 5000 on the same host that served the page. Set
`window.PLAY_IS_SCHOOL_API_BASE` before loading `api.js` to point it somewhere else.

### Health and public config

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | Returns `{ "status": "ok", "name": "Play-is-School API" }` |
| GET | `/api/config/maps` | None | Returns `{ "mapTilerApiKey": "..." }` for the pickup/event maps |

---

## 2. Authentication

### Sign-in flow

1. `POST /api/auth/login` with email and password (or use Google sign-in).
2. Keep the returned `token`.
3. Send it on every protected request: `Authorization: Bearer <token>`.
4. `POST /api/auth/logout` revokes the token on the server.

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@school.edu", "password": "secret123" }
```

```json
200 OK
{
  "message": "Logged in.",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "_id": "...", "name": "...", "email": "...", "role": "admin", "status": "approved" }
}
```

### Token rules

A token is rejected (`401`) when it:

| Code | Reason |
|---|---|
| *(none)* | Missing, malformed or expired |
| `TOKEN_INVALID` | Not a session token, or the account no longer exists |
| `TOKEN_REVOKED` | The user logged out with this token |
| `TOKEN_STALE` | The account type changed, or the password was reset after the token was issued |

Archived or rejected accounts get `403`. Accounts that are not yet **approved** can read (`GET`) but
any write returns `403 ACCOUNT_NOT_ACTIVE`.

### Integration verification (admin settings)

Endpoints that read or change integration secrets (Google OAuth, reCAPTCHA, auth settings) also need
an `X-Integration-Access` header. Get it by requesting and verifying an email OTP (and PIN, if one is
configured) through `/api/auth/request-integration-otp`, `/verify-integration-otp` and
`/verify-integration-pin`. The grant lasts 30 minutes and is renewed on each use; the renewed value is
returned in the `X-Integration-Access-Refresh` response header.

---

## 3. Roles and permissions

Every account has an **account type** (`role`) and a **position** with per-module permissions.

### Account types

| Role | Dashboard |
|---|---|
| `admin` | Admin dashboard (System Administrator, System Manager, Principal) |
| `staff` | Staff Panel (Registrar, Finance Officer, Auditor). Office modules only, by permission; no account management or system settings |
| `teacher` | Teacher dashboard (Teacher, Teacher Aide). Grouped with staff in the Accounts list |
| `parent` | Parent dashboard (Parent / Guardian) |

### Permission levels per module

| Level | Meaning |
|---|---|
| `view` | Limited access: open the module and do its everyday actions |
| `manage` | Full access: create, edit and delete records (includes `view`) |
| `approve` | Approval access: review and approve items (includes `view`) |

Modules: `dashboard`, `users`, `students`, `classes`, `enrollment`, `records`, `attendance`,
`progress`, `fees`, `events`, `messages`, `alerts`, `pickup`, `reports`, `logs`, `settings`.

Defaults per position are defined in [backend/config/permissions.js](../backend/config/permissions.js).
A System Administrator can change them through `/api/permissions`. Permissions are re-read on every
request, so changes apply immediately.

In the endpoint tables below, **Access** reads as `roles · module:level`. For example
`admin · fees:manage` means the account must be an admin **and** have Full access to Fees.
`SysAdmin` means the System Administrator position only.

---

## 4. Common conventions

| Topic | Convention |
|---|---|
| IDs | MongoDB ObjectId strings (24 hex characters) |
| Dates | ISO 8601 strings. Query filters use `YYYY-MM-DD` |
| Success bodies | A named object, e.g. `{ "student": {...} }`, `{ "students": [...] }`, or `{ "message": "..." }` |
| Created | `201 Created` with the new record |
| Archive vs delete | Most records are archived first (`PATCH /:id/archive`) and can be restored; `DELETE` only removes archived items. Archived accounts are purged after 30 days |
| Uploads | `multipart/form-data`; field names are given per endpoint |

### Concurrency headers

Edits to shared records use two protections:

| Header / mechanism | Purpose |
|---|---|
| `X-Record-Version: <updatedAt>` | Optimistic locking. Send the `updatedAt` you loaded. If someone saved first you get `409 VERSION_CONFLICT` with `currentVersion` |
| Edit locks (`/api/locks`) | While another user holds the edit lock, saving returns `423 EDIT_LOCKED` with `lockedBy` |
| Fee payment lock | Only one payment change per fee at a time (30 s lock); a second one gets `409` |

---

## 5. Errors

All errors are JSON with at least a `message`:

```json
{ "code": "PERMISSION_DENIED", "module": "fees", "action": "manage",
  "message": "Your account does not have permission to make changes in Fees & Payments. Ask a System Administrator for access." }
```

| Status | When |
|---|---|
| `400` | Invalid input, invalid JSON body, invalid ID (`CastError`), validation error |
| `401` | Not signed in or token invalid (see [Token rules](#token-rules)) |
| `403` | Wrong role, missing permission (`PERMISSION_DENIED`), inactive account (`ACCOUNT_NOT_ACTIVE`), integration verification missing |
| `404` | Record not found, or `Route not found.` |
| `409` | Duplicate (e.g. email already used), `VERSION_CONFLICT`, payment lock |
| `413` | Body or upload too large |
| `423` | `EDIT_LOCKED`: someone else is editing the record |
| `429` | `RATE_LIMITED` (see below) or too many failed sign-ins / OTP attempts |
| `500` / `503` | Server or external service (email, Google) error |

---

## 6. Rate limits

Limits are counted in memory per signed-in session (or per IP when not signed in). Each response
carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. Over the limit the API
returns `429` with `Retry-After` and:

```json
{ "code": "RATE_LIMITED", "retryAfterSeconds": 42, "message": "Too many requests from this session. Please wait 42 seconds and try again." }
```

| Limit | Applies to | Max | Window | Key |
|---|---|---|---|---|
| api | All `/api` requests | 1500 | 5 min | session / IP |
| writes | All non-GET `/api` requests | 120 | 1 min | session / IP |
| login | `POST /auth/login` | 10 | 15 min | IP + email |
| loginIp | `POST /auth/login` | 50 | 15 min | IP |
| signup | `POST /auth/signup` | 10 | 60 min | IP |
| passwordReset | forgot / verify / resend / reset password | 8 | 15 min | IP + email |
| googleSignIn | `POST /auth/google/start`, `/google/exchange` | 30 | 15 min | IP |
| integrationCode | integration OTP / PIN | 10 | 15 min | session |
| backups | Backup create / upload / restore / delete | 20 | 60 min | session |
| emailBlast | `POST /fees/reminders/all` | 10 | 15 min | session |

---

## 7. Endpoints

### 7.1 Auth — `/api/auth`

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/signup` | Public | Parent self-registration. Body: `name`, `email`, `password` (min 8), `role: "parent"`, `phone?`. Account starts as pending approval |
| POST | `/login` | Public | Body: `email`, `password`. Returns `token`, `user` |
| POST | `/logout` | Signed in | Revokes the current token |
| GET | `/me` | Signed in | Returns `{ user }` |
| POST | `/forgot-password` | Public | Body: `email`. Emails a 6-digit OTP. Always returns a generic message and `resendAfter: 60` |
| POST | `/verify-reset-otp` | Public | Body: `email`, `otp`. Returns `{ resetToken }` |
| POST | `/resend-reset-otp` | Public | Body: `email` |
| POST | `/reset-password` | Public | Body: `resetToken`, `password`. Signs out all existing sessions |
| GET | `/recaptcha-config` | Public | Returns `{ siteKey }` |
| GET | `/settings` | Public | Public sign-in settings (Google sign-in / CAPTCHA enabled) |
| POST | `/google/start` | Public | Starts Google sign-in (with CAPTCHA token `captchaToken`) |
| GET | `/google` | Public | Browser redirect to Google (`?mode=`) |
| GET | `/google/callback` | Google redirect | OAuth callback |
| POST | `/google/exchange` | Public | Exchanges the one-time code from the callback for a session token |
| POST | `/request-integration-otp` | admin · settings:manage | Body: `purpose`. Emails an integration code |
| POST | `/verify-integration-otp` | admin · settings:manage | Body: `purpose`, `otp` |
| POST | `/verify-integration-pin` | admin · settings:manage | Body: `pin`, `pinChallenge` |
| GET | `/settings/manage` | admin · settings:manage + integration access | Full auth settings |
| PATCH | `/settings` | admin · settings:manage + integration access | Turn Google sign-in / CAPTCHA on or off |
| GET / PUT | `/google-clients` | admin · settings:manage + integration access | Read / save Google OAuth client |
| GET / PUT | `/recaptcha-clients` | admin · settings:manage + integration access | Read / save reCAPTCHA keys |
| POST | `/integrations/restore-defaults` | admin · settings:manage + integration access | Restore default integration config |

### 7.2 Users — `/api/users`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/me` | Signed in | Own profile |
| PUT | `/me` | Signed in | Update own profile. *Multipart*, optional `avatar` image (max 2 MB) |
| GET | `/` | admin · users:view (or students:manage / records:manage / classes:view) | List accounts |
| POST | `/` | admin · users:manage | Create account. Only a SysAdmin can create admins |
| GET | `/archived` | admin · users:view | Archived accounts |
| GET | `/:id` | admin · users:view | Account for editing |
| PUT | `/:id` | admin · users:manage | Update profile (multipart, `avatar`). Supports `X-Record-Version` |
| PATCH | `/:id` | admin · users:manage | Update fields. Only a SysAdmin can change `role` |
| PATCH | `/:id/archive` | admin · users:manage | Archive account |
| PATCH | `/:id/reactivate` | admin · users:manage | Restore archived account |
| PATCH | `/:id/approve` | admin · users:approve | Approve a parent registration (sends email) |
| PATCH | `/:id/reject` | admin · users:approve | Reject a registration |
| PATCH | `/:id/verify-email` | admin · users:manage | Mark a parent email as verified |
| DELETE | `/:id` | admin · users:manage | Permanently delete an archived account |

### 7.3 Permissions — `/api/permissions`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/me` | Signed in | Your effective permissions |
| GET | `/` | SysAdmin | Positions, modules and all accounts' permissions |
| PUT | `/roles/:position` | SysAdmin | Change a position's default permissions |
| PUT | `/users/:id` | SysAdmin | Set an account's position / custom permissions |

### 7.4 Students — `/api/students`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Signed in | List students. Teachers and parents only see their own students. `?status=active\|archived` |
| GET | `/archived` | admin · students:manage | Archived students and deletion dates |
| GET | `/:id` | Signed in (scoped) | One student |
| GET | `/:id/photo` | Admin, assigned teacher, or parent | Student photo (image) |
| PUT | `/:id/photo` | admin/teacher · students:manage, parent · students:view | *Multipart* field `photo` |
| POST | `/` | admin · students:manage | Body: `name`, `birthdate`, `className`, `parent`, `teacher`, `notes` |
| PATCH | `/:id` | admin/teacher · students:manage | Update. Supports `X-Record-Version` |
| PATCH | `/:id/archive` | admin · students:manage | Archive |
| PATCH | `/:id/restore` | admin · students:manage | Restore |
| DELETE | `/:id` | admin · students:manage | Permanently delete an archived student |

### 7.5 Classes — `/api/classes` (admin)

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | classes:view (or students:manage / records:manage) | List classes |
| POST | `/` | classes:manage | Create class |
| PATCH | `/:id` | classes:manage | Update. Supports `X-Record-Version` |
| PATCH | `/:id/archive` | classes:manage | Archive |
| PATCH | `/:id/restore` | classes:manage | Restore |

### 7.6 Enrollment — `/api/enrollment`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/availability` | Signed in | Whether the enrollment period is open |
| PUT | `/period` | admin · enrollment:manage | Set enrollment period dates |
| PATCH | `/period/start` | admin · enrollment:manage | Open the period now |
| GET | `/applications` | admin · enrollment:view | List applications |
| POST | `/applications` | parent/teacher · enrollment:view | Submit application. *Multipart*, optional `studentPhoto` |
| POST | `/applications/bulk-approve` | admin · enrollment:approve | Approve several applications |
| GET | `/applications/:id/photo` | admin/parent/teacher · enrollment:view | Applicant photo |
| PATCH | `/applications/:id` | admin · enrollment:approve | Approve or reject an application |

### 7.7 Records Management — `/api/records` (admin)

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/students` | records:view | Student records |
| POST | `/students` | records:manage | Create student record |
| PATCH | `/students/:id` | records:manage | Update. Supports `X-Record-Version` |
| GET | `/teachers` | records:view or classes:view | Teacher records |
| POST | `/teachers` | records:manage | Create teacher |
| PATCH | `/teachers/:id` | records:manage | Update teacher |
| POST | `/:type/:id/documents` | records:manage | *Multipart* `documents` (max 5 files, 10 MB each: PDF, JPG, PNG, WEBP, DOC, DOCX). `type` = `students` or `teachers` |
| GET | `/:type/:id/documents/:documentId` | records:view | Download a document |
| DELETE | `/:type/:id/documents/:documentId` | records:manage | Delete a document |

### 7.8 Attendance — `/api/attendance`

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/` | teacher · attendance:manage | Mark one: `student`, `date`, `status` (`present`, `absent`, `tardy`, `excused`; legacy `late` is treated as tardy), `remarks?`. Returns `201 { attendance }` |
| POST | `/bulk` | teacher · attendance:manage | `{ date, records: [{ student, status, remarks }] }`. Returns `{ saved, failed, warnings }` |
| GET | `/class?date=YYYY-MM-DD` | teacher · attendance:view | Roster for the teacher's students on a date (default today) |
| GET | `/class/report?from=YYYY-MM-DD&to=YYYY-MM-DD` | teacher · attendance:view | All attendance for the teacher's students in a range. **Data source for the Attendance PDF** |
| GET | `/student/:studentId` | attendance:view (scoped) | One student's attendance history. **Data source for the Attendance and Yearly PDFs** |

### 7.9 Academic Progress — `/api/progress`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | admin · progress:view | All progress entries for review |
| PATCH | `/:id/review` | admin · progress:approve | Mark as reviewed |
| POST | `/` | teacher · progress:manage | *Multipart* with optional `photos`. Fields include `student`, `entryType` (`activity`, `weekly`, `monthly`), `activity`, `milestone`, `learningArea`, `overallDevelopment`, `strengths`, `areasForImprovement`, `evaluation`, `assessment` |
| PATCH | `/:id` | teacher · progress:manage | Update (multipart, `photos`, `removeAttachments`). Supports `X-Record-Version` |
| GET | `/:id/attachments/:attachmentId` | admin/teacher/parent · progress:view | Attachment file |
| GET | `/student/:studentId` | progress:view (scoped) | Student's entries. **Data source for the Yearly Academic PDF** |
| GET | `/google-drive/status` | teacher · progress:manage | Google Drive connection status |
| POST | `/google-drive/connect` | teacher · progress:manage | Returns `{ authorizationUrl }` |
| GET | `/google-drive/picker-config` | teacher · progress:manage | Google Picker settings |

### 7.10 Fees and Payments — `/api/fees`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | admin · fees:view | All fees with payments. `?status=paid\|partial\|unpaid\|overdue`. **Data source for the Payment Collection report** |
| GET | `/teacher` | teacher · fees:view | Fees of the teacher's students (no payment details) |
| POST | `/` | admin · fees:manage | Body: `student`, `description`, `amount`, `dueDate` |
| GET | `/student/:studentId` | fees:view (scoped) | Student's fees (teachers do not see payments) |
| POST | `/reminders/all` | admin/teacher · fees:view | Email all parents with unpaid balances. Returns `{ unpaidFeeCount, remindedCount, skippedCount }` |
| POST | `/:id/reminders` | admin/teacher · fees:view | Remind one parent |
| GET | `/:id/reminders/:notificationId/email-summary` | admin/teacher · fees:view | Email delivery status |
| POST | `/:id/payments` | admin · fees:manage | Body: `amountPaid`, `datePaid`, `remarks?`. Issues a receipt number `OR-YYYY-NNNN`. Returns `201 { fee, payment }` |
| PATCH | `/:id/payments/:paymentId` | admin · fees:manage | Correct a payment (receipt marked `corrected`) |
| DELETE | `/:id/payments/:paymentId` | admin · fees:manage | Void a payment (receipt marked `voided`) |
| GET | `/:id/payments` | admin · fees:view | Payment list |
| GET | `/:id/payments/:paymentId/receipt` | admin/parent · fees:view | Receipt data. **Data source for the printable receipt** |

### 7.11 Events — `/api/events`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | events:view | Events visible to the user |
| POST | `/` | admin/teacher · events:manage | Create event (teacher events need approval) |
| GET | `/:id/email-summary` | admin/teacher · events:view | Email delivery status |
| PATCH | `/:id/review` | admin · events:approve | Approve / reject with note |
| PUT | `/:id/approve` | admin · events:approve | Approve |
| PATCH | `/:id` | admin/teacher · events:manage | Update. Supports `X-Record-Version` |
| DELETE | `/:id` | admin/teacher · events:manage | Delete |

### 7.12 Google Calendar and Drive — `/api/calendar`, `/api/drive`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/calendar/google/callback` | Google redirect | Calendar OAuth callback |
| GET | `/drive/google/callback` | Google redirect | Drive OAuth callback |
| GET | `/calendar/google/personal/status` | Signed in | Personal calendar connection |
| POST | `/calendar/google/personal/connect` | Signed in | Start personal connection |
| POST | `/calendar/google/personal/sync` | Signed in | Import personal events |
| POST / DELETE | `/calendar/google/personal/events/:id` | Signed in | Add / remove a school event on your calendar |
| DELETE | `/calendar/google/personal/connection` | Signed in | Disconnect |
| GET | `/calendar/google/status` | admin · settings:manage | School calendar status |
| POST | `/calendar/google/connect` | admin · settings:manage | Connect school calendar |
| PATCH | `/calendar/google/settings` | admin · settings:manage | Sync settings |
| POST | `/calendar/google/sync` | admin · settings:manage | Sync all events |
| POST | `/calendar/google/events/:id/sync` | admin · settings:manage | Sync one event |
| DELETE | `/calendar/google/connection` | admin · settings:manage | Disconnect |

### 7.13 Messages — `/api/messages`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/inbox` | messages:view | Conversations |
| GET | `/contacts` | messages:view | People you may message |
| GET | `/thread/:userId` | messages:view | Direct thread with a user |
| POST | `/` | messages:manage | Send a direct message |
| POST | `/groups` | messages:manage | Create a group |
| GET | `/groups/:groupId` | messages:view | Group messages |
| PATCH | `/groups/:groupId` | messages:manage | Rename group |
| POST | `/groups/:groupId/messages` | messages:manage | Send to group |

### 7.14 Notifications — `/api/notifications` (parent, teacher)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Your notifications |
| PATCH | `/read-all` | Mark all read |
| PATCH | `/:id/read` | Mark one read |

### 7.15 Emergency Alerts — `/api/alerts`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | alerts:view | Alerts (`?view=archived`) |
| POST | `/` | admin/teacher · alerts:manage | Send alert (emails parents) |
| POST | `/:id/updates` | admin/teacher · alerts:manage | Post an update. Returns `{ alert, recipientCount, emailSummary }` |
| GET | `/:id/email-summary` | admin/teacher · alerts:view | Delivery status |
| PATCH | `/:id/acknowledge` | parent · alerts:view | Acknowledge |
| PATCH | `/:id/archive` | admin/teacher · alerts:manage | Archive |
| PATCH | `/:id/restore` | admin/teacher · alerts:manage | Restore |
| DELETE | `/:id` | admin/teacher · alerts:manage | Delete an archived alert (history kept) |

### 7.16 Pickup Authorization — `/api/pickup`

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/` | admin/teacher/parent · pickup:manage | Body: `student`, `authorizedName`, `relationship`, `contact`, `identification` |
| GET | `/student/:studentId` | pickup:view | Authorized people for a student |
| PATCH | `/:id` | admin/teacher/parent · pickup:manage | Update. Supports `X-Record-Version` |
| POST | `/:id/verify` | teacher/admin · pickup:approve | Verify a pickup at release |
| DELETE | `/:id` | admin/teacher/parent · pickup:manage | Remove |

### 7.17 Reports — `/api/reports` (admin)

JSON summaries for the admin dashboard and Reports module.

| Method | Path | Access | Response |
|---|---|---|---|
| GET | `/students` | reports:view or dashboard:view | `{ total, active, archived, byClass: [{ _id: className, count }] }` |
| GET | `/fees` | reports:view or fees:view | `{ totalBilled, totalCollected, outstanding, byStatus, overdue: { count, amount }, count }` |
| GET | `/attendance` | reports:view | `{ byStatus: [{ _id: status, count }] }` |

### 7.18 Activity Logs — `/api/logs`

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | admin · logs:view | Activity log entries |

### 7.19 Edit Locks — `/api/locks`

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/` | Signed in | Acquire / renew an edit lock on a record (`resource`, `id`) |
| DELETE | `/` | Signed in | Release it (`?resource=&id=`) |

### 7.20 Backups — `/api/backups` (SysAdmin only)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List saved backups (a daily automatic backup runs; newest 14 kept) |
| POST | `/` | Create a backup now |
| POST | `/upload` | *Multipart* field `backup` (max 250 MB) |
| GET | `/:file/download` | Download a backup file |
| POST | `/:file/restore` | Restore the database from a saved backup |
| DELETE | `/:file` | Delete a backup |

---

## 8. PDF report generation

PDF reports are **generated in the browser**, not by the server. The API supplies the data as JSON;
the frontend builds the document and saves it on the user's device. No PDF file is stored on the
server and no endpoint returns `application/pdf`.

| Report | Who | Output | Library | Data endpoints |
|---|---|---|---|---|
| Attendance Report | Teacher | `.pdf` download | jsPDF | `GET /attendance/class/report`, `GET /attendance/student/:studentId` |
| Yearly Academic Report | Teacher | `.pdf` download | jsPDF | `GET /progress/student/:studentId`, `GET /attendance/student/:studentId` |
| Payment Collection Report | Admin | Print / Save as PDF | Browser print | `GET /fees` |
| Official Payment Receipt | Admin, Parent | Print / Save as PDF | Browser print | `GET /fees/:id/payments/:paymentId/receipt` |

### 8.1 Library setup

- Package: `jspdf@^2.5.2` ([frontend/package.json](../frontend/package.json)).
- Loaded on the teacher dashboard: `<script src="../node_modules/jspdf/dist/jspdf.umd.min.js"></script>`
  in [dashboard-teacher.html](../frontend/pages/dashboard-teacher.html).
- Accessed as `window.jspdf.jsPDF`. If it is missing, the user sees
  *"PDF generation is unavailable. Refresh the page and try again."*
- The school logo `frontend/img/logocollab.jpg` is fetched and embedded as a data URL.

Shared styling: brand green `rgb(39, 103, 73)` header bar, Helvetica, "Play-is-School / Learning
through Play" heading, and a footer with page numbers (`Page X of Y`) on every page.

### 8.2 Attendance Report (teacher)

Code: `generateAttendanceReport()` and `downloadAttendanceReport()` in
[frontend/js/teacher.js](../frontend/js/teacher.js).

**Inputs (modal):** student (one student or *All students*), period (month or full year), year/month.

**Data requests**

```http
# All assigned students
GET /api/attendance/class/report?from=2026-01-01&to=2026-12-31
Authorization: Bearer <teacher token>

# One student
GET /api/attendance/student/<studentId>
Authorization: Bearer <teacher token>
```

Both return:

```json
{
  "attendance": [
    {
      "_id": "...",
      "student": { "_id": "...", "name": "Ana Cruz", "className": "Kinder A" },
      "date": "2026-03-04T00:00:00.000Z",
      "status": "present",
      "remarks": ""
    }
  ]
}
```

The client keeps records whose date is between `from` and `to`, sorts newest first, and shows an
on-screen preview with totals for present, absent, tardy (`late` counts as tardy) and excused.

**PDF layout**

| Property | Value |
|---|---|
| Page | A4 landscape, mm units, 12 mm margin |
| Header | Logo, "Play-is-School", "Attendance Report", student name, period, generated time and record count |
| Table columns | Date · Student · Class · Status · Remarks (long text wraps; rows break across pages and the header repeats) |
| Highlight | `absent` status in red |
| Footer | "Play-is-School \| Official Attendance Record" and `Page X of Y` |
| File name | `attendance-<student>-<period>.pdf`, e.g. `attendance-all-students-year-2026.pdf`, `attendance-ana-cruz-march-2026.pdf` |

The **Download PDF** button is disabled until a report with at least one record is generated.

### 8.3 Yearly Academic Report (teacher)

Code: `buildYearlyReport()` and `downloadYearlyProgressReport()` in
[frontend/js/teacher.js](../frontend/js/teacher.js).

**Inputs (modal):** one assigned student, school year (current year and 5 previous), optional
teacher remarks typed into the modal (printed in the PDF).

**Data requests (sent in parallel)**

```http
GET /api/progress/student/<studentId>
GET /api/attendance/student/<studentId>
```

If the attendance request fails, the report is still built with no attendance.

**What the client computes for the selected year**

| Section | Content |
|---|---|
| Counts | Total entries, by type (`activity`, `weekly`, `monthly`), number of photos |
| Monthly summary | For each month: activity / weekly / monthly counts and entry titles (`milestone` or `activity`) |
| Learning areas | Entries per `learningArea` (blank = "Uncategorized"), most frequent first |
| Milestones | All `weekly` and `monthly` entries |
| Evaluation | Latest non-empty text of `overallDevelopment`, `strengths`, `areasForImprovement`, `evaluation`, `assessment` |
| Attendance | Present, absent, tardy, excused, total days, attendance rate = (present + tardy) / days, rounded % |
| Teacher remarks | Text from the modal |

**PDF layout**

| Property | Value |
|---|---|
| Page | A4 portrait, mm units, 14 mm margin |
| Header | Logo (skipped if it fails to load), "Play-is-School", "Yearly Academic Report", "School year: YYYY"; repeated on each page |
| Footer | "Play-is-School \| Generated <date/time>" and `Page X of Y` |
| File name | `yearly-academic-report-<student>-<year>.pdf`, e.g. `yearly-academic-report-ana-cruz-2026.pdf` |

### 8.4 Payment Collection Report (admin)

Code: `openPaymentReportsModal()` and `printPaymentReport()` in
[frontend/js/admin.js](../frontend/js/admin.js).

Uses the fees already loaded from `GET /api/fees` (each fee includes its `payments`). The admin
chooses **Daily**, **Monthly** or **Yearly**; payments are filtered by `datePaid`.

| Type | Title |
|---|---|
| Daily | Daily Payment Collection Report |
| Monthly | Monthly Payment Collection Report |
| Yearly | Yearly Payment Collection Report |

**Print** opens a formatted page in a new window (pop-ups must be allowed) with summary boxes and a
table: Date · Receipt No. · Student · Fee · Amount · Recorded by · Status. Voided payments are struck
through. Choose **Save as PDF** in the print dialog to get a PDF.

### 8.5 Official Payment Receipt (admin, parent)

Code: `showPaymentReceipt()` in [frontend/js/dashboard-common.js](../frontend/js/dashboard-common.js).

```http
GET /api/fees/<feeId>/payments/<paymentId>/receipt
Authorization: Bearer <admin or parent token>
```

Parents can only open receipts for their own children (`403` otherwise).

```json
{
  "receiptNumber": "OR-2026-0012",
  "state": "issued",
  "voidedAt": null,
  "receipt": {
    "datePaid": "2026-03-04T00:00:00.000Z",
    "schoolName": "Play-is-School",
    "studentName": "Ana Cruz",
    "gradeSection": "Kinder A",
    "feeName": "Tuition - March",
    "amountPaid": 2500,
    "method": "Cash",
    "totalFee": 5000,
    "totalPaid": 2500,
    "remainingBalance": 2500,
    "dueDate": "2026-03-31T00:00:00.000Z",
    "status": "Partial Payment",
    "recordedBy": "Finance Officer"
  }
}
```

| Field | Notes |
|---|---|
| `receiptNumber` | `OR-<year>-<4-digit sequence>`, assigned when the payment is logged; sequence restarts each year |
| `state` | `issued`, `corrected` or `voided` (shown as a stamp on the receipt) |
| `receipt` | A snapshot frozen at payment time, so later fee changes do not alter old receipts |

**Print Receipt** opens a print-ready page and calls `window.print()`; choose **Save as PDF** to get
a PDF.

### 8.6 Errors during PDF generation

| Situation | Result |
|---|---|
| jsPDF not loaded | Toast: "PDF generation is unavailable. Refresh the page and try again." |
| No records for the selection | Download button stays disabled |
| Logo cannot be loaded | Attendance PDF fails with "The school logo could not be loaded."; Yearly PDF continues without the logo |
| API error (401/403/429/500) | The error `message` from the API is shown in the report modal |
| Pop-up blocked (print reports) | Alert: "Please allow popups to print the report." |

---

## 9. Quick-start examples

```bash
# 1. Sign in
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher@school.edu","password":"secret123"}' | jq -r .token)

# 2. Attendance data for a class report (what the Attendance PDF uses)
curl -s "http://localhost:5000/api/attendance/class/report?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $TOKEN"

# 3. Progress data for the Yearly Academic PDF
curl -s http://localhost:5000/api/progress/student/<studentId> \
  -H "Authorization: Bearer $TOKEN"

# 4. Receipt data (admin or parent)
curl -s http://localhost:5000/api/fees/<feeId>/payments/<paymentId>/receipt \
  -H "Authorization: Bearer $TOKEN"

# 5. Update with optimistic locking
curl -s -X PATCH http://localhost:5000/api/students/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Record-Version: 2026-03-04T08:15:22.123Z" \
  -d '{"notes":"Allergic to peanuts"}'

# 6. Sign out
curl -s -X POST http://localhost:5000/api/auth/logout -H "Authorization: Bearer $TOKEN"
```

Using the frontend client:

```js
const { attendance } = await api.get('/attendance/class/report?from=2026-01-01&to=2026-12-31');
const { progress } = await api.get(`/progress/student/${studentId}`);
const { receipt, receiptNumber, state } = await api.get(`/fees/${feeId}/payments/${paymentId}/receipt`);
```
