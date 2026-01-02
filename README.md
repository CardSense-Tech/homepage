# Personal Company Website (Static)

Modern, clean, professional multi-page site for a software developer focused on Smartcard, NFC, encryption, and security-critical applications.

## Pages
- `index.html` (Home)
- `about.html`
- `skills.html`
- `projects.html`
- `services.html`
- `demos.html` (placeholder)
- `404.html`

## Customize
- Update your name/company label in the header and metadata.
- Confirm the email address in `assets/main.js` (currently `cardsense.tech@gmail.com`).
- Phone number in the page footers is currently `+91 8087880110`.

## Local preview
Open `index.html` directly, or use any static server.

PowerShell example:
```powershell
# From repo root
python -m http.server 5500
```
Then visit: http://localhost:5500/

## Azure Static Web Apps
This is a static site (no build step). Configure your SWA deployment with:
- **App location**: `/`
- **Api location**: *(empty)*
- **Output location**: *(empty)*

If you later add an API, you can attach it via SWA functions without redesigning the pages.

