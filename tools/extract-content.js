const fs = require('fs');
const path = require('path');

const root = process.cwd();

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripScriptsAndStyles(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function htmlToReadableText(html) {
  const withoutScripts = stripScriptsAndStyles(html);

  // Add line breaks around common block elements for readability before stripping tags.
  const withBreaks = withoutScripts
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(h1|h2|h3|p|li|section|div)\s*>/gi, '\n')
    .replace(/<\s*(h1|h2|h3|p|li|section)\b[^>]*>/gi, '\n');

  const text = decodeEntities(stripTags(withBreaks));
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractFromFile(relativeFile) {
  const full = path.join(root, relativeFile);
  if (!fs.existsSync(full)) return null;

  const html = fs.readFileSync(full, 'utf8');

  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const desc =
    (html.match(
      /<meta\s+name=\"description\"\s+content=\"([^\"]*)\"\s*\/?\s*>/i,
    ) || [])[1] || '';
  const ogTitle =
    (html.match(/<meta\s+property=\"og:title\"\s+content=\"([^\"]*)\"/i) ||
      [])[1] || '';
  const ogDesc =
    (html.match(/<meta\s+property=\"og:description\"\s+content=\"([^\"]*)\"/i) ||
      [])[1] || '';

  const headings = [];
  for (const level of ['h1', 'h2', 'h3']) {
    const re = new RegExp(`<${level}[^>]*>([\\s\\S]*?)<\\/${level}>`, 'gi');
    let m;
    while ((m = re.exec(html))) {
      const text = decodeEntities(stripTags(m[1]));
      if (text) headings.push({ level, text });
    }
  }

  const ctas = [];
  const aRe = /<a\s+[^>]*href=(?:\"([^\"]+)\"|'([^']+)')[^>]*>([\\s\\S]*?)<\/a>/gi;
  let am;
  while ((am = aRe.exec(html))) {
    const href = am[1] || am[2] || '';
    const text = decodeEntities(stripTags(am[3]));
    if (!text) continue;

    if (
      /^mailto:|^tel:/i.test(href) ||
      /Request EXE|Request integration|Contact|Get in touch|Email|Call/i.test(text)
    ) {
      ctas.push({ text, href });
    }
  }

  // Main content text (for a single consolidated "content" prompt).
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const mainHtml = (mainMatch || bodyMatch || [])[1] || '';
  const mainText = mainHtml ? htmlToReadableText(mainHtml) : '';

  return {
    file: relativeFile.replace(/\\/g, '/'),
    title: decodeEntities(title),
    description: decodeEntities(desc),
    ogTitle: decodeEntities(ogTitle),
    ogDescription: decodeEntities(ogDesc),
    headings,
    ctas,
    mainText,
  };
}

const htmlFiles = fs
  .readdirSync(root)
  .filter((f) => f.toLowerCase().endsWith('.html'))
  .sort((a, b) => a.localeCompare(b));

// Include admin UI explicitly.
htmlFiles.push(path.join('admin_ui', 'index.html'));

const data = htmlFiles.map(extractFromFile).filter(Boolean);
process.stdout.write(JSON.stringify(data, null, 2));
