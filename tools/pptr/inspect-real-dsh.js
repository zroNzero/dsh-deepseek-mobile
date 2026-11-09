const puppeteer = require('puppeteer-core');
const fs = require('fs');

const URL = 'http://127.0.0.1:3099/?token=AzLQLge9qpsJ6sWXvtvKOPu4ZsIJisK7Q56QZ_CiMLo';
const SHOTS = 'D:/PC/dsh/dsh-mobile/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 }).catch((e) => console.log('goto', e.message));
  await sleep(6000);
  await page.screenshot({ path: SHOTS + '/real-dsh-412.png' });

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const els = [];
    for (const sel of ['.dsh-sidebar', '.sidebar-panel', '.input-box-container', 'aside', 'nav', 'textarea', '[contenteditable="true"]', 'main']) {
      const el = q(sel);
      if (!el) { els.push({ sel, found: false }); continue; }
      const r = el.getBoundingClientRect();
      els.push({ sel, found: true, tag: el.tagName, cls: String(el.className).slice(0, 160), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    const textareas = Array.from(document.querySelectorAll('textarea')).map((t) => ({ cls: String(t.className).slice(0, 100), ph: t.placeholder, parent: t.parentElement ? t.parentElement.className : '' }));
    return {
      title: document.title,
      bodyStart: document.body.innerHTML.slice(0, 1200),
      els,
      textareas,
      rootChildren: Array.from(document.body.children).map((e) => e.tagName + '.' + String(e.className).slice(0, 80)),
      text: document.body.innerText.slice(0, 400),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('ERRORS', errors.slice(0, 10).join(' | ') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
