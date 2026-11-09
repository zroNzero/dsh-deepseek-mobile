const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const archive = 'D:/PC/deepseekharness/resources/app.asar';
const outRoot = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets/web';
const prefix = '\\dsh\\node_modules\\@deepseek-ai\\dsh-web-frontend\\dist\\';

const all = asar.listPackage(archive);
const entries = all.filter((p) => p.startsWith(prefix) && !p.endsWith('\\'));
let count = 0;
let bytes = 0;
for (const entry of entries) {
  const rel = entry.slice(prefix.length).replace(/\\/g, '/');
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let buf;
  try {
    buf = asar.extractFile(archive, entry.replace(/^\\+/, ''));
  } catch (e) {
    if (/directory or link/.test(e.message)) { fs.mkdirSync(dest, { recursive: true }); continue; }
    throw e;
  }
  fs.writeFileSync(dest, buf);
  count++;
  bytes += buf.length;
}
console.log(`extracted ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${outRoot}`);
