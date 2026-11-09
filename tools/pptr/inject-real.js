const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3099/?token=AzLQLge9qpsJ6sWXvtvKOPu4ZsIJisK7Q56QZ_CiMLo';
const ROOT = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets/inject';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, isMobile: true },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  const css = fs.readFileSync(ROOT + '/inject.css', 'utf8');
  const js = fs.readFileSync(ROOT + '/inject.js', 'utf8');
  await page.evaluate((c) => { const s = document.createElement('style'); s.textContent = c; document.head.appendChild(s); }, css);
  await page.evaluate(js);
  await sleep(2500);
  const meta = await page.evaluate(() => ({
    meta: window.__DSH_INJECT_META__,
    card: document.querySelector('.ds-composer-card') ? true : false,
    back: typeof window.handleAndroidBack,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log('META', JSON.stringify(meta));
  await page.screenshot({ path: 'D:/PC/dsh/dsh-mobile/shots/real-dsh-injected.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
