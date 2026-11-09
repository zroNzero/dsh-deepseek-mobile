'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const [tarGz, dest, entry, port] = process.argv.slice(2);

function extractTarGz() {
  const buf = zlib.gunzipSync(fs.readFileSync(tarGz));
  let off = 0;
  let longName = null;

  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!rawName) {
      off += 512;
      continue;
    }

    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeText, 8) || 0;
    const type = String.fromCharCode(header[156]);

    if (type === 'L') {
      longName = buf.subarray(off + 512, off + 512 + size).toString('utf8').replace(/\0.*$/, '');
      off += 512 + Math.ceil(size / 512) * 512;
      continue;
    }

    if (type === 'x' || type === 'g') {
      const pax = buf.subarray(off + 512, off + 512 + size).toString('utf8');
      const match = /(?:^|\n)\d+ path=([^\n]+)/.exec(pax);
      if (match) longName = match[1];
      off += 512 + Math.ceil(size / 512) * 512;
      continue;
    }

    const name = longName || rawName;
    longName = null;
    off += 512;

    if (type === '5') {
      fs.mkdirSync(path.join(dest, name), { recursive: true });
      continue;
    }

    // Symlinks and device nodes cannot be created in the OHOS app sandbox;
    // the JS payload only needs regular files.
    if (type === '2' || type === '3' || type === '4') continue;
    if (!size) continue;

    const full = path.join(dest, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
}

(async () => {
  if (!fs.existsSync(entry)) {
    extractTarGz();
  }

  // OHOS libuv returns EEXIST when Node lazily opens fd 0 as a pipe; the web
  // profile never reads stdin, so provide an inert stream before importing
  // the CLI (whose ESM facade enumerates the process builtin).
  try {
    const { Readable } = require('node:stream');
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: new Readable({ read() {} })
    });
  } catch (_) {}

  const patch = path.join(dest, 'cloud-github.patch.yml');
  const plugin = path.join(dest, 'lib/node_modules/cloud-github.mjs');
  console.log(`[cloud-github] patch=${fs.existsSync(patch)} plugin=${fs.existsSync(plugin)} dest=${dest}`);
  const cliArgs = ['web'];
  if (fs.existsSync(patch)) cliArgs.push('--patch', patch);
  cliArgs.push('--no-open', '--port', String(port || 3080));
  process.argv = [process.execPath, entry, ...cliArgs];
  const mod = await import(pathToFileURL(entry).href);
  await mod.runCli();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
