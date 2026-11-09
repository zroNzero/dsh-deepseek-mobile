const puppeteer = require('puppeteer-core');
const URL = 'http://127.0.0.1:3099/?token=AzLQLge9qpsJ6sWXvtvKOPu4ZsIJisK7Q56QZ_CiMLo';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, isMobile: true },
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));

  const out = await page.evaluate(() => {
    const ed = document.querySelector('[contenteditable="true"]');
    const ancestors = [];
    let n = ed;
    for (let i = 0; i < 5 && n; i++) {
      const r = n.getBoundingClientRect();
      ancestors.push({
        tag: n.tagName,
        cls: String(n.className).slice(0, 120),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        bg: getComputedStyle(n).backgroundColor,
        br: getComputedStyle(n).borderRadius,
      });
      n = n.parentElement;
    }
    const side = [...document.querySelectorAll('[class*=sidebar],[class*=panel],[data-mobile-nav]')].slice(0, 10).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName,
        cls: String(e.className).slice(0, 100),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        attrs: [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-expanded').map((a) => a.name + '=' + a.value).join(' '),
      };
    });
    const nav = document.querySelector('nav');
    const navAnc = [];
    let x = nav;
    for (let i = 0; i < 3 && x; i++) {
      const r = x.getBoundingClientRect();
      navAnc.push({ tag: x.tagName, cls: String(x.className).slice(0, 100), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      x = x.parentElement;
    }
    return { ancestors, side, navAnc };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
