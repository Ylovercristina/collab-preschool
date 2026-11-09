# Play-is-School

Preschool Monitoring System

## Google login CAPTCHA configuration

Google login on `frontend/pages/login.html` uses reCAPTCHA v2 Checkbox. The `.env` credentials are used by default. Admins can manage one custom reCAPTCHA configuration from **Dashboard → Settings → Manage**. Register the frontend host (for example `localhost` or `127.0.0.1`) with the CAPTCHA site.

Set these values in `backend/.env`:

```env
RECAPTCHA_SITE_KEY=your_public_site_key
RECAPTCHA_SECRET_KEY=your_private_secret_key
RECAPTCHA_ALLOWED_HOSTNAMES=localhost,127.0.0.1
```

The allowed-hostname value is optional for `.env` credentials. The site key is returned to the login page by the backend; the secret key is only used server-side. CAPTCHA verification fails closed if either credential is missing.

## Google sign-in credentials

Google sign-in uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` from `backend/.env` by default. Admins can manage one custom Google sign-in configuration from **Dashboard → Settings → Manage**. Secret values are never displayed.

In Google Cloud, add the backend's configured `GOOGLE_CALLBACK_URL` (for example, `http://localhost:5000/api/auth/google/callback`) as an authorized redirect URI for the sign-in OAuth client. Google Calendar uses a **separate Web application OAuth client** configured with `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`; add `GOOGLE_CALENDAR_CALLBACK_URL` (for example, `http://localhost:5000/api/calendar/google/callback`) to that client's authorized redirect URIs. Keep both client secrets server-side and out of version control.

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
4. Go to **APIs & Services → Credentials** and create a separate **Web application** OAuth client for Google Calendar. Add this to that client's **Authorized redirect URIs**:
   `http://localhost:5000/api/calendar/google/callback`
   For a deployed server, add its own `https://…/api/calendar/google/callback` too.
5. Add the separate Calendar OAuth credentials to `backend/.env` (the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` remain for Google sign-in):
   ```env
   GOOGLE_CALENDAR_CLIENT_ID=...
   GOOGLE_CALENDAR_CLIENT_SECRET=...
   GOOGLE_CALENDAR_CALLBACK_URL=http://localhost:5000/api/calendar/google/callback
   SCHOOL_TIME_ZONE=Asia/Manila
   GOOGLE_CALENDAR_EVENT_DURATION_MINUTES=60
   ```
6. Restart the backend. An admin can connect a school calendar from **Events & Calendar**. Individual users connect their personal calendars in **Settings** or from an event's **Add to Google Calendar** button. New Calendar connections use the dedicated Calendar client, independently of the Google sign-in client.

### Academic progress photos from Google Drive

Teachers can choose **Choose from Google Drive** from **Academic Progress** to open Google's native file picker (Recent, Upload, My Drive, and Starred) without leaving the progress form. The first use asks the teacher to authorize access in a popup; after approval, the native picker opens automatically. Enable the **Google Drive API** and **Google Picker API** in the same Google Cloud project, add `https://www.googleapis.com/auth/drive.file` to the OAuth consent screen, and configure a browser API key restricted to the app's website and Google Picker API. Set `GOOGLE_DRIVE_PICKER_API_KEY` to that key and `GOOGLE_CLOUD_PROJECT_NUMBER` to the project's numeric ID in `backend/.env`. Configure `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_CALLBACK_URL` for the dedicated Drive OAuth client, with `http://localhost:5000/api/drive/google/callback` registered as an authorized redirect URI. The Drive refresh token is encrypted on the server. Teachers with an older Drive authorization will be asked to authorize once more for the Picker's file-selection permission. After the teacher selects photos, the server copies supported JPG, PNG, or WEBP images (up to 5 MB each) into the existing private progress-photo store when the progress record is saved. Parents can view these photos only while the student remains linked to their account.

### Event venue map

The venue picker uses Leaflet with MapTiler street tiles when `MAPTILER_API_KEY` is set in `backend/.env`; without a key, it falls back to OpenStreetMap tiles. The key is sent to the browser for map requests, so restrict it to the app's website in MapTiler. Place search continues to use OpenStreetMap Nominatim.

### How it behaves

- Only events that are **published and approved** are copied. Drafts, pending and rejected events are not; unpublishing an event removes its Google copy.
- Each school-calendar event maps to one Google event with a fixed ID. Personal copies use a separate per-user managed event ID; retries and edits do not create duplicates. Only app-managed copies are changed or deleted.
- Event times use `SCHOOL_TIME_ZONE`. Events have no end time in Play-is-School, so Google gets `GOOGLE_CALENDAR_EVENT_DURATION_MINUTES` as the length. Reminders: 1 day and 1 hour before.
- The refresh token is encrypted on the server and never sent to the browser. If access is revoked or expires, the panel shows **Reconnect needed**.
- The admin's school calendar is separate from personal calendars. Admins can choose to copy every published school event to the configured school calendar.
- Each user can connect a Google account from **Settings**. Connecting imports that account's primary-calendar events into the shared system calendar; the user must explicitly consent first. Imported entries, including Google events marked private, are visible to all users who can access the system calendar. Only connect an account whose calendar is appropriate to share.
- Calendar authorization hints Google with the user's existing Play-is-School email and uses incremental authorization, so an active Google browser session can skip the account picker and previously granted permissions are reused. First-time Calendar access still requires Google permission. The callback verifies the Google account identity against the signed-in Play-is-School account; reconnecting retains the previously associated Google account.
- Imported Google events remain Google-owned: the app never edits them in Google. **Sync calendar now** imports additions, updates, and deletions using Google's incremental sync API. Sync runs on connection and when a user requests it; it does not run continuously in the background.
- System events are still copied to a user's Google Calendar only when explicitly selected. School-side edits update those app-managed copies, and removing one deletes only that app-managed copy.
- Disconnecting removes that user's imported events from the shared system calendar and leaves events already copied to Google Calendar unchanged. Reconnecting imports the calendar again.
