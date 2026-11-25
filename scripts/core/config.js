// scripts/core/config.js
//
// Values filled in from app.ini by `tonka serve` / `tonka build` (double-brace placeholders).
// Google values are public by design: a Client ID only works from the origins
// you allow in Google Cloud. See GOOGLE_SETUP.md.

const CONFIG = {
  version: "{{version}}",
  googleClientId: "{{google_client_id}}",
  googleApiKey: "{{google_api_key}}",
  googleAppId: "{{google_app_id}}",
};
