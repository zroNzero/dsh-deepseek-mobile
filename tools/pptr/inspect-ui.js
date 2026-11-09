const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MOBILE = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets/mobile';
const SHOTS = 'D:/PC/dsh/dsh-mobile/shots';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8900/index.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));

  const metrics = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
    };
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      topbar: rect('.topbar'),
      menu: rect('#btn-menu'),
      newChat: rect('#btn-new'),
      model: rect('#btn-model'),
      grid: rect('.prompt-grid'),
      card1: rect('.prompt-card'),
      composer: rect('.input-box-container'),
      send: rect('#btn-send'),
      htmlFont: getComputedStyle(document.documentElement).fontSize,
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
  console.log('ERRORS:', errors.join(' | ') || 'none');

  await page.screenshot({ path: path.join(SHOTS, 'ui-puppeteer-welcome.png') });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
