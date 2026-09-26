# Play & Grow — Preschool Monitoring System

A full website for a play-based preschool, built on the stack you asked for:
**MongoDB + Express + Node.js** on the backend, with a plain HTML/CSS/JS frontend
(no build step needed) styled around a "learn through play" theme.

It implements the requirements from your spec for all three roles — **Admin**,
**Teacher**, and **Parent** — including signup/login/logout/forgot-password,
admission management, attendance, academic progress, fee tracking & payments,
events, parent–teacher messaging, emergency alerts, and authorized-pickup
verification.

## Project structure

```
preschool-website/
├── backend/              Express + MongoDB API
│   ├── config/db.js
│   ├── models/           Mongoose schemas
│   ├── controllers/
│   ├── routes/
│   ├── middleware/auth.js   JWT auth + role guard
│   ├── utils/
│   ├── server.js
│   └── .env.example
└── frontend/              Static site (no build tools required)
    ├── index.html          Public landing page
    ├── pages/              login, signup, forgot/reset password, 3 dashboards
    ├── css/style.css
    └── js/                 api.js (fetch client), dashboard-common.js, admin/teacher/parent.js
```

## 1. Set up the backend

You'll need **Node.js 18+** and a **MongoDB** database (local install, or a free
cluster on MongoDB Atlas).

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `MONGO_URI` — your MongoDB connection string
- `JWT_SECRET` — any long random string
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — the first admin account's login

Start it:

```bash
npm run dev      # with nodemon, auto-restarts on changes
# or
npm start
```

On first run, since there's no admin account yet, the server automatically
creates one from your `SEED_ADMIN_*` values and prints the credentials to the
console. Use those to log in as admin the first time, then change the password.

The API runs at `http://localhost:5000/api` (health check: `GET /api/health`).

## 2. Run the frontend

It's static files, so any simple static server works. Easiest options:

- **VS Code**: install the "Live Server" extension, right-click `frontend/index.html` → "Open with Live Server".
- **Node**: `npx serve frontend`
- **Python**: `cd frontend && python3 -m http.server 5500`

Then open the site (e.g. `http://127.0.0.1:5500`).

If your frontend runs on a different port than `5500`, update `CLIENT_ORIGIN`
in `backend/.env` to match (for CORS), and if your backend runs anywhere other
than `localhost:5000`, update `API_BASE` at the top of `frontend/js/api.js`.

## 3. Try it out

1. Log in as the seeded admin.
2. In **Accounts**, add a teacher.
3. In **Students**, add a student and (optionally) link them to a parent
   account once one signs up and you approve it.
4. Have a parent sign up from the public site (`Get started` → parent signup)
   — their account starts **pending** until you approve it under **Accounts**.
5. Log in as the teacher to mark attendance, log progress, message the
   parent, or send an emergency alert.
6. Log in as the parent to see progress, attendance, fees, events, and to
   register people authorized to pick up their child.

## Notes & things to know before going live

- **Passwords** are hashed with bcrypt; sessions use JWTs (7-day expiry by default).
- **Forgot password** generates a reset token but there's no email service
  wired up — the token is returned directly in the API response (and shown on
  the "forgot password" page) so you can test the flow. Wire up a real mailer
  (e.g. Nodemailer + SMTP or a transactional email API) before production, and
  stop returning the token in the response.
- **Roles**: admins and parents can self-signup; teacher accounts are created
  by an admin (matches your spec, where only Admin and Parent have a Signup
  story). Parent accounts require admin approval before they can log in.
- This is a solid, working foundation covering every user story in your
  spec — feel free to ask for refinements (file uploads for student photos,
  email notifications, a nicer calendar view, deployment help, etc.).
