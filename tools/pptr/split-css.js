const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = 'D:/PC/dsh/dsh-mobile/shots';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 300, isMobile: true },
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8900/synctest.html', { waitUntil: 'networkidle0' });
  await sleep(200);

  const selectors = await page.evaluate(() => {
    const s = document.styleSheets[0];
    return Array.from(s.cssRules).map((r, i) => i + ': ' + (r.selectorText || r.cssText.slice(0, 60)));
  });
  console.log('RULES\n' + selectors.join('\n'));

  await page.evaluate(() => { document.styleSheets[0].disabled = true; });
  await sleep(200);
  await page.screenshot({ path: SHOTS + '/split-disabled.png' });

  await page.evaluate(() => {
    document.styleSheets[0].disabled = false;
    const s = document.styleSheets[0];
    const keep = ['.sync-title', '.sync-sub', '.sync-head', '.sync-logo', '.status-pill', '.ic'];
    for (let i = s.cssRules.length - 1; i >= 0; i--) {
      const r = s.cssRules[i];
      const sel = r.selectorText || '';
      if (!keep.some((k) => sel.indexOf(k) >= 0)) s.deleteRule(i);
    }
  });
  await sleep(200);
  await page.screenshot({ path: SHOTS + '/split-minimal.png' });

  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = 'html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#0A0A0A;color:#F5F6F7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:15px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}';
    document.head.appendChild(st);
  });
  await sleep(200);
  await page.screenshot({ path: SHOTS + '/split-global.png' });

  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}';
    document.head.appendChild(st);
  });
  await sleep(200);
  await page.screenshot({ path: SHOTS + '/split-star.png' });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
