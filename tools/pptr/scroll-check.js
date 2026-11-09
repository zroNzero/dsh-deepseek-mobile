const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8900/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const ROOT = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets';
  await page.evaluate((css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }, fs.readFileSync(path.join(ROOT, 'inject/inject.css'), 'utf8'));
  await page.evaluate(fs.readFileSync(path.join(ROOT, 'inject/inject.js'), 'utf8'));
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('[data-prompt]')[1].click());
  await sleep(6500);

  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    return {
      scrollY: window.scrollY,
      docTop: document.scrollingElement.scrollTop,
      bodyOverflow: getComputedStyle(document.body).overflow,
      topbar: r('.topbar'),
      chat: r('#chat-scroll'),
      chatScrollTop: document.querySelector('#chat-scroll').scrollTop,
      chatScrollHeight: document.querySelector('#chat-scroll').scrollHeight,
      firstMsg: r('.msg'),
      lastMsg: r('.msg:last-child'),
      atTop: (document.elementFromPoint(200, 40) || {}).className,
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await page.screenshot({ path: 'D:/PC/dsh/dsh-mobile/shots/after-fix-chat.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
