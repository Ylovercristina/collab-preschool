# Play-is-School

Preschool Monitoring System

## Google login CAPTCHA configuration

Google login on `frontend/pages/login.html` uses reCAPTCHA v2 Checkbox. Create a reCAPTCHA site in the Google reCAPTCHA admin console, then add these values to `backend/.env`:

```env
RECAPTCHA_SITE_KEY=your_public_site_key
RECAPTCHA_SECRET_KEY=your_private_secret_key
```

Register the frontend host (for example `localhost` or `127.0.0.1`) with the CAPTCHA site. The site key is returned to the login page by the backend; the secret key is only used server-side. Without both values, Google login fails closed and reports that CAPTCHA is not configured.

## Start without package.json

If a package manifest is unavailable, but Node.js and the existing `backend/node_modules` directory are present, run `start-app.cmd`. It starts the backend directly with `node server.js` and serves the frontend using the dependency-free `frontend-server.js` file. Installing dependencies still requires a package manifest or an existing `node_modules` directory.

## Google Calendar sync

Published school events can be copied to one Google Calendar chosen by an admin. Play-is-School stays the source of truth: creating, editing, unpublishing or deleting an event updates the Google copy in the background. If Google is unavailable, the school calendar keeps working and the event shows "Google sync failed" with a **Retry sync** button.

The Google Calendar API is free to use and does not need a billing account.

### Setup

1. In the [Google Cloud console](https://console.cloud.google.com/), open the project that holds your Google sign-in OAuth client (or create a project).
2. Go to **APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - Add the scope `https://www.googleapis.com/auth/calendar.events`. The app also asks for `openid` and `email` only to show which account is connected.
   - While the app is in **Testing**, add the Google account that will own the school calendar under **Test users**.
4. Go to **APIs & Services → Credentials**, open the **Web application** OAuth client and add this to **Authorized redirect URIs**:
   `http://localhost:5000/api/calendar/google/callback`
   For a deployed server, add its own `https://…/api/calendar/google/callback` too.
5. Add to `backend/.env` (see `backend/.env.example`):
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_CALENDAR_CALLBACK_URL=http://localhost:5000/api/calendar/google/callback
   SCHOOL_TIME_ZONE=Asia/Manila
   GOOGLE_CALENDAR_EVENT_DURATION_MINUTES=60
   ```
6. Restart the backend. As an admin, open **Events & Calendar → Connect Google Calendar** and allow calendar access. Existing published events are copied right after connecting.

### How it behaves

- Only events that are **published and approved** are copied. Drafts, pending and rejected events are not; unpublishing an event removes its Google copy.
- Each school event maps to one Google event with a fixed ID, so retries and edits never create duplicates. Only events created by Play-is-School are changed or deleted.
- Event times use `SCHOOL_TIME_ZONE`. Events have no end time in Play-is-School, so Google gets `GOOGLE_CALENDAR_EVENT_DURATION_MINUTES` as the length. Reminders: 1 day and 1 hour before.
- The refresh token is encrypted on the server and never sent to the browser. If access is revoked or expires, the panel shows **Reconnect needed**.
- **Disconnect** stops syncing but leaves events already in Google Calendar untouched.
- Only admins see the connection panel and sync status. Teachers and parents get an **Add to my Google Calendar** link on published events, which adds a copy to their own calendar without giving them any access to the school calendar.
