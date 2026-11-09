const asar = require('@electron/asar');
const f = 'D:/PC/deepseekharness/resources/app.asar';
const base = 'dsh\\node_modules\\@deepseek-ai\\dsh-web-frontend\\dist\\index.html';
const variants = [base, base.replace(/\\/g, '/'), '\\' + base, '/' + base];
for (const p of variants) {
  try {
    const b = asar.extractFile(f, p);
    console.log('OK', JSON.stringify(p), b.length);
  } catch (e) {
    console.log('FAIL', JSON.stringify(p), e.message.slice(0, 100));
  }
}
