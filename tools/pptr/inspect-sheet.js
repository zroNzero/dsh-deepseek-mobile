const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets';
const SHOTS = 'D:/PC/dsh/dsh-mobile/shots';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://127.0.0.1:8900/index.html', { waitUntil: 'networkidle0' });
  const css = fs.readFileSync(path.join(ROOT, 'inject/inject.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'inject/inject.js'), 'utf8');
  await page.evaluate((c) => { const s = document.createElement('style'); s.textContent = c; document.head.appendChild(s); }, css);
  await page.evaluate(js);
  await sleep(300);

  // open sync directly, drawer closed
  await page.evaluate(() => document.querySelector('[data-action="open-sync"]').click());
  await sleep(1200);

  const info = await page.evaluate(() => {
    const t = document.querySelector('#sheet-sync .sync-title');
    const sub = document.querySelector('#sheet-sync .sync-sub');
    const at = document.elementFromPoint(120, 82);
    const cs = getComputedStyle(t);
    return {
      titleRect: t.getBoundingClientRect().toJSON(),
      subRect: sub.getBoundingClientRect().toJSON(),
      textDecoration: cs.textDecorationLine,
      textShadow: cs.textShadow,
      font: cs.fontFamily + ' / ' + cs.fontSize + ' / ' + cs.fontWeight,
      elemAt: at ? (at.tagName + '.' + at.className) : null,
      bodyScrollTop: document.querySelector('#sheet-sync .sheet-body').scrollTop,
      drawerOpen: document.getElementById('ds-drawer').style.transform,
      sheetZ: getComputedStyle(document.getElementById('sheet-sync')).zIndex,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(SHOTS, 'debug-sync-direct.png') });

  await page.evaluate(() => { document.getElementById('sheet-sync').classList.remove('open'); });
  await sleep(400);
  await page.evaluate(() => document.querySelector('[data-action="open-settings"]').click());
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, 'debug-settings-direct.png') });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
