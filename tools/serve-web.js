const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets/web');
const port = Number(process.argv[3] || 8899);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback for extensionless routes
      if (!path.extname(p)) {
        fs.readFile(path.join(root, 'index.html'), (e2, b2) => {
          if (e2) { res.writeHead(404).end('not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(b2);
        });
        return;
      }
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' }).end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
