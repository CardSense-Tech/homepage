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
- **Api location**: `api`
- **Output location**: *(empty)*

### API (Azure Functions)
This repo includes Azure Functions under `api/` to power the demos without exposing upstream URLs or API keys in the browser.

Required application settings (set in Azure Static Web Apps -> Configuration -> Application settings, or in your Function App settings):

- **Signature demo proxy** (`/api/signature/*`)
	- `SIGNATURE_API_BASE_URL` = upstream API base (do not include trailing slash)
	- `SIGNATURE_API_KEY` = secret key value
	- `SIGNATURE_API_KEY_HEADER` = header name used by the upstream (default: `x-api-key`)

- **Background remover demo proxy** (`/api/bgremover/*`)
	- `BGREMOVER_API_BASE_URL`
	- `BGREMOVER_API_KEY`
	- `BGREMOVER_API_KEY_HEADER`

Do not commit secrets into HTML/JS.

