const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 420, isMobile: true },
  });
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await page.goto('http://127.0.0.1:8900/synctest.html', { waitUntil: 'networkidle0' });

  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const doc = await client.send('DOM.getDocument');
  const node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.sync-title' });
  const fonts = await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
  console.log('FONTS', JSON.stringify(fonts, null, 2));

  await page.addStyleTag({ content: '.sync-title,.sync-sub{font-family:"Microsoft YaHei",sans-serif !important;}' });
  await sleep(200);
  await page.screenshot({ path: 'D:/PC/dsh/dsh-mobile/shots/synctest-yahei.png' });

  await page.addStyleTag({ content: '.sync-title,.sync-sub{font-family:"Noto Sans SC","Noto Sans CJK SC",sans-serif !important;}' });
  await sleep(200);
  await page.screenshot({ path: 'D:/PC/dsh/dsh-mobile/shots/synctest-noto.png' });

  await page.addStyleTag({ content: '.sync-title,.sync-sub{font-family:"Segoe UI",sans-serif !important;}' });
  await sleep(200);
  await page.screenshot({ path: 'D:/PC/dsh/dsh-mobile/shots/synctest-segoe.png' });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
