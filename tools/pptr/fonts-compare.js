const puppeteer = require('puppeteer-core');

async function fontsFor(page, client, selector) {
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const doc = await client.send('DOM.getDocument');
  const node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!node.nodeId) return { error: 'no node ' + selector };
  const fonts = await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
  return fonts;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-proxy-server', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 420, isMobile: true },
  });

  const p1 = await browser.newPage();
  const c1 = await p1.target().createCDPSession();
  await p1.goto('http://127.0.0.1:8900/synctest.html', { waitUntil: 'networkidle0' });
  console.log('synctest .sync-title', JSON.stringify(await fontsFor(p1, c1, '.sync-title')));
  console.log('synctest body', JSON.stringify(await fontsFor(p1, c1, 'body')));

  const p2 = await browser.newPage();
  const c2 = await p2.target().createCDPSession();
  await p2.goto('http://127.0.0.1:8900/baret2.test.html', { waitUntil: 'networkidle0' });
  console.log('baret2 .a', JSON.stringify(await fontsFor(p2, c2, '.a')));
  console.log('baret2 body', JSON.stringify(await fontsFor(p2, c2, 'body')));

  const p3 = await browser.newPage();
  const c3 = await p3.target().createCDPSession();
  await p3.goto('http://127.0.0.1:8900/baret.test.html', { waitUntil: 'networkidle0' });
  console.log('baret div', JSON.stringify(await fontsFor(p3, c3, 'div')));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
