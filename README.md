# Play-is-School

Preschool Monitoring System

## Google login CAPTCHA configuration

Google login on `frontend/pages/login.html` uses reCAPTCHA v2 Checkbox. Create a reCAPTCHA site in the Google reCAPTCHA admin console, then add these values to `backend/.env`:

```env
RECAPTCHA_SITE_KEY=your_public_site_key
RECAPTCHA_SECRET_KEY=your_private_secret_key
```

Register the frontend host (for example `localhost` or `127.0.0.1`) with the CAPTCHA site. The site key is returned to the login page by the backend; the secret key is only used server-side. Without both values, Google login fails closed and reports that CAPTCHA is not configured.

## Configure a custom Google sign-in client

An admin can add a client from **Dashboard → Settings → Manage Google OAuth Clients**, then select it under **Authentication & Security Settings**. Use the complete Client ID and Client Secret for a Google Cloud **Web application** OAuth client. The secret is encrypted before it is stored and is never returned to the browser; leave the secret field blank when editing to keep the saved value.

In Google Cloud, add the backend's configured `GOOGLE_CALLBACK_URL` (for example, `http://localhost:5000/api/auth/google/callback`) as an authorized redirect URI. The selected client is used by Google sign-in/signup and new school or personal Calendar connections. To use the same client for Calendar, also add `GOOGLE_CALENDAR_CALLBACK_URL` (for example, `http://localhost:5000/api/calendar/google/callback`) to that client's authorized redirect URIs. Existing Calendar connections continue using the client they were created with. The `.env` Google client remains available as the default option. Keep private client secrets out of frontend files and version control.

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
   - While the app is in **Testing**, add each Google account that will connect a school or personal calendar under **Test users**.
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
6. Restart the backend. An admin can connect a school calendar from **Events & Calendar**. Individual users connect their personal calendars in **Settings** or from an event's **Add to Google Calendar** button.

### How it behaves

- Only events that are **published and approved** are copied. Drafts, pending and rejected events are not; unpublishing an event removes its Google copy.
- Each school-calendar event maps to one Google event with a fixed ID. Personal copies use a separate per-user managed event ID; retries and edits do not create duplicates. Only app-managed copies are changed or deleted.
- Event times use `SCHOOL_TIME_ZONE`. Events have no end time in Play-is-School, so Google gets `GOOGLE_CALENDAR_EVENT_DURATION_MINUTES` as the length. Reminders: 1 day and 1 hour before.
- The refresh token is encrypted on the server and never sent to the browser. If access is revoked or expires, the panel shows **Reconnect needed**.
- **Disconnect** stops syncing but leaves events already in Google Calendar untouched.
- The admin's school calendar is separate from personal calendars. Admins can choose to copy every published school event to the configured school calendar.
- Each user can connect their own Google account and explicitly add individual published events from the event details. Personal event copies are never created automatically.
- A selected event is updated when school details change and removed from the user's calendar when it is unpublished or deleted, provided access is still authorized. Removing a selected event deletes only the app-managed copy.
- **Retry selected event updates** in Settings retries app-managed personal copies only; it never adds events the user did not select.
- Personal refresh tokens are encrypted on the server and never sent to the browser. Disconnecting stops future updates and leaves existing personal calendar copies unchanged; reconnecting resumes updates for events previously selected.
