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
