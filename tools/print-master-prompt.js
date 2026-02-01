const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readText(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').trim();
}

function section(title) {
  return `\n\n=== ${title} ===\n`;
}

const sitemapXml = readText('sitemap.xml');
const robotsTxt = readText('robots.txt');
const adsTxt = readText('ads.txt');
const swaConfig = readText('staticwebapp.config.json');
const pages = JSON.parse(readText('tools/site-content.json'));

function urlFor(file) {
  if (file === 'index.html') return 'https://www.cardsense.in/';
  if (file === 'admin_ui/index.html') return '(private) https://www.cardsense.in/admin (rewrite to /admin_ui/index.html)';
  return `https://www.cardsense.in/${file}`;
}

let out = '';

out += 'MASTER PROMPT: CardSense Tech website (sitemap + full page text)\n';
out += '\nUse the content below as source-of-truth. Do not invent new services, projects, URLs, contact details, or API routes.';
out += '\nKeep the site dark-theme only.';

out += section('SITEMAP.XML (current)');
out += sitemapXml + '\n';

out += section('ROBOTS RULES (current)');
out += robotsTxt + '\n';

out += section('ADS.TXT (current)');
out += adsTxt + '\n';

out += section('AZURE STATIC WEB APPS ROUTING (current)');
out += swaConfig + '\n';

out += section('PUBLIC PAGES (title, meta description, main text)');
for (const p of pages) {
  // Skip admin UI here; put it in its own section.
  if (p.file === 'admin_ui/index.html') continue;

  out += `\n--- ${urlFor(p.file)} ---\n`;
  if (p.title) out += `Title: ${p.title}\n`;
  if (p.description) out += `Meta description: ${p.description}\n`;
  out += '\nMain text:\n';
  out += (p.mainText || '').trim() + '\n';
}

const admin = pages.find((x) => x.file === 'admin_ui/index.html');
if (admin) {
  out += section('ADMIN UI (private)');
  out += `URL: ${urlFor(admin.file)}\n`;
  if (admin.title) out += `Title: ${admin.title}\n`;
  out += '\nMain text:\n';
  out += (admin.mainText || '').trim() + '\n';
}

out += section('SERVERLESS API ROUTES (current)');
out += [
  '- /api/bgremover/{*path} -> proxy to BGREMOVER_API_BASE_URL (rate limited)\n',
  '- /api/signature/{*path} -> proxy to SIGNATURE_API_BASE_URL (rate limited; supports /batch_zip helper)\n',
  '- /api/v1/admin/{*path} -> admin proxy to BGREMOVER_API_BASE_URL/api/v1/admin (preserves cookies; no-store)\n',
].join('');
out += '\nRequired settings (upstream):\n';
out += '- BGREMOVER_API_BASE_URL\n';
out += '- SIGNATURE_API_BASE_URL\n';
out += '\nOptional settings:\n';
out += '- BGREMOVER_API_KEY_HEADER, BGREMOVER_API_KEY, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_PER_DAY\n';
out += '- SIGNATURE_API_KEY_HEADER, SIGNATURE_API_KEY, SIGNATURE_RATE_LIMIT_PER_MINUTE, SIGNATURE_RATE_LIMIT_PER_DAY\n';

process.stdout.write(out);
