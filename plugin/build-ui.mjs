// Собирает ui.html: вшивает видео и постер в ui.src.html как data-URI.
// Запуск:  node build-ui.mjs   (из папки plugin)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const b64 = (file, mime) => `data:${mime};base64,` + readFileSync(join(dir, 'assets', file)).toString('base64');

let html = readFileSync(join(dir, 'ui.src.html'), 'utf8');
html = html.replace('{{CAT_WEBM}}', b64('cat.webm', 'video/webm')).replace('{{CAT_POSTER}}', b64('poster.jpg', 'image/jpeg'));
writeFileSync(join(dir, 'ui.html'), html);
console.log('ui.html written,', (html.length / 1024).toFixed(0), 'KB');
