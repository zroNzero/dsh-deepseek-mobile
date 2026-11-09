const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = 'D:/PC/dsh/dsh-mobile/refer/DSH-Kxxy/android/app/src/main/assets';
const SHOTS = 'D:/PC/dsh/dsh-mobile/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8900/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);

  const injectCss = fs.readFileSync(path.join(ROOT, 'inject/inject.css'), 'utf8');
  const injectJs = fs.readFileSync(path.join(ROOT, 'inject/inject.js'), 'utf8');
  await page.evaluate((css) => {
    const s = document.createElement('style');
    s.id = 'ds-inject-test';
    s.textContent = css;
    document.head.appendChild(s);
  }, injectCss);
  await page.evaluate(injectJs);
  await page.waitForFunction(() => window.__DSH_INJECTED__ === true, { timeout: 5000 });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'ui-injected-welcome.png') });

  const layout = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) };
    };
    return { composer: r('#composer'), drawer: r('#ds-drawer'), welcome: r('#welcome') };
  });
  console.log('LAYOUT', JSON.stringify(layout));

  // chat
  await page.click('[data-prompt]:nth-of-type(2)');
  await sleep(800);
  await page.screenshot({ path: path.join(SHOTS, 'ui-chat-thinking.png') });
  await page.waitForFunction(() => !document.querySelector('.typing'), { timeout: 6000 });
  await sleep(5200);
  await page.screenshot({ path: path.join(SHOTS, 'ui-chat-code.png') });

  // reasoning toggle + copy action visibility
  const reasoningOpen = await page.evaluate(() => {
    const r = document.querySelector('.reasoning');
    if (!r) return 'none';
    r.querySelector('.reasoning-head').click();
    return r.classList.contains('open');
  });
  console.log('REASONING_OPEN', reasoningOpen);
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'ui-chat-reasoning.png') });

  // back while drawer closed
  const back1 = await page.evaluate(() => window.handleAndroidBack());
  console.log('BACK_CLOSED', back1);

  // drawer
  await page.click('#btn-menu');
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, 'ui-drawer.png') });
  const back2 = await page.evaluate(() => window.handleAndroidBack());
  await sleep(400);
  console.log('BACK_DRAWER', back2, 'drawerOpen', await page.evaluate(() => window.__drawerOpen = (document.getElementById('ds-drawer').style.transform)));

  // settings
  await page.click('#btn-menu');
  await sleep(400);
  await page.click('#ds-drawer [data-action="open-settings"]');
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, 'ui-settings.png') });
  const back3 = await page.evaluate(() => window.handleAndroidBack());
  await sleep(400);
  console.log('BACK_SETTINGS', back3);

  // plugins
  await page.click('#btn-menu');
  await sleep(400);
  await page.click('#ds-drawer [data-action="open-plugins"]');
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, 'ui-plugins.png') });

  // sync
  await page.click('#sheet-plugins [data-action="open-sync"]');
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, 'ui-sync.png') });

  // export modal
  await page.click('#sheet-sync [data-action="sync-export"]');
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, 'ui-sync-export.png') });
  const modalText = await page.$eval('#modal-text', (el) => el.value.slice(0, 120));
  console.log('MODAL', modalText);

  // light theme
  await page.evaluate(() => { document.querySelector('[data-action="modal-cancel"]').click(); });
  await sleep(200);
  for (let i = 0; i < 6; i++) { await page.evaluate(() => window.handleAndroidBack()); await sleep(250); }
  await sleep(400);
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'ui-light.png') });

  console.log('ERRORS', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
