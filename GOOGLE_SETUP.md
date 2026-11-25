# Google Drive setup

Fortress Wallet talks to Google Drive straight from the browser. Google needs to know your copy of the app, which takes about 10 minutes in Google Cloud Console and is free. You end up with a **Client ID**, which goes into `app.ini`.

The app asks only for **`drive.file`**: access to files the app created itself, or that you picked for it. It cannot see anything else on your Drive. Google classes this permission as *non-sensitive*, so no app review is needed.

> Google renames menu items now and then. If a name below doesn't match exactly, look for the closest one. The steps stay the same.

## 1. Create a project

1. Open <https://console.cloud.google.com/> and sign in.
2. Project picker (top left) → **New project** → name it `Fortress Wallet` → **Create**, then select it.

## 2. Turn on the Drive API

**APIs & Services → Library** → search **Google Drive API** → **Enable**.

(Only for the optional file picker, step 6: also enable **Google Picker API**.)

## 3. Consent screen

**APIs & Services → OAuth consent screen** (or **Google Auth Platform**) → **Get started**:

- **App name:** `Fortress Wallet`, **support email:** yours
- **Audience:** **External**
- **Contact email:** yours → finish.

Then:

- **Data access → Add or remove scopes** → tick **`.../auth/drive.file`** ("See, edit, create and delete only the specific Google Drive files you use with this app") → **Update** → **Save**.
- **Audience → Test users → Add users** → your Google account (and anyone else who will use your copy).

While the app is in *Testing*, only test users can sign in, which is what you want for a personal app. You can also **Publish** it: `drive.file` needs no verification.

## 4. Client ID

**APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Clients → Create client**):

- **Application type:** Web application
- **Name:** `Fortress Wallet web`
- **Authorized JavaScript origins:** the addresses the app runs from, with no path and no trailing slash, for example:
  - `https://wallet.your-domain.com`
  - `http://localhost:3000` (for `tonka serve`)
- **Authorized redirect URIs:** leave empty.

**Create** → copy the **Client ID** (`1234…apps.googleusercontent.com`).

## 5. Put it in `app.ini`

```ini
google_client_id = "1234567890-abc123.apps.googleusercontent.com"
```

Restart `tonka serve`, or build again. **File → Connect Google Drive** now appears.

The Client ID is **not a secret**: it is meant to sit in web pages, and it only works from the origins you listed in step 4.

## 6. (Optional) "Pick another file from Drive"

This lets you open a wallet file that you uploaded to Drive by hand, rather than one the app created. You need two more values:

1. **Credentials → Create credentials → API key.** Edit it:
   - **Application restrictions → Websites:** `https://wallet.your-domain.com/*` (and `http://localhost:3000/*`)
   - **API restrictions:** Google Picker API
2. **Project number:** shown on the project's **Dashboard** or in **IAM & Admin → Settings**.

```ini
google_api_key = "AIza..."
google_app_id = "1234567890"
```

## How it behaves

- **First connection:** Google asks you to choose an account and to allow access to "files you use with this app".
- **Later:** one click on *Connect* opens a short pop-up that closes by itself, with no password and no consent screen again. The pop-up has to come from a click; browsers block pop-ups that open on their own.
- **After about an hour** the access token expires. The app shows *Google sign-in needed* and one click reconnects.
- **Two devices:** before saving, the app checks whether the file on Drive changed since it was opened. If it did, you choose: keep your version or load the one from Drive.
- **Disconnect** (File dialog) revokes the token at Google. You can also remove the app at <https://myaccount.google.com/permissions>.

## Hosting checklist

- Serve the page over **HTTPS** (localhost is fine for testing).
- A strict `Content-Security-Policy` header for the built page could look like this:

  ```
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com;
  connect-src 'self' https://www.googleapis.com https://api.frankfurter.dev;
  frame-src https://accounts.google.com https://docs.google.com;
  style-src 'self' 'unsafe-inline' https://accounts.google.com;
  img-src 'self' data: https:;
  font-src 'self' data:;
  ```

  `'unsafe-inline'` is needed because `tonka build` puts the scripts and styles inside `index.html`. Build with `-i -f` so the libraries and fonts are inlined as well.
