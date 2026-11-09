// Command runner that appends every command's status/output to build_debug.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'build_debug.log');
const stamp = () => new Date().toISOString();
const cmd = process.argv.slice(2).join(' ');
if (!cmd) { console.error('usage: node run.js "<command>"'); process.exit(2); }

fs.appendFileSync(logFile, `\n=== [${stamp()}] CMD: ${cmd}\n`);
const child = spawn(cmd, {
  shell: true,
  cwd: process.env.RUN_CWD ? path.resolve(__dirname, process.env.RUN_CWD) : process.cwd(),
  env: process.env,
  windowsHide: true,
});

let buffer = [];
child.stdout.on('data', (d) => { buffer.push(d); process.stdout.write(d); });
child.stderr.on('data', (d) => { buffer.push(d); process.stderr.write(d); });
child.on('error', (e) => {
  fs.appendFileSync(logFile, `SPAWN ERROR: ${e.message}\n`);
  process.exit(1);
});
child.on('close', (code) => {
  try {
    fs.appendFileSync(logFile, Buffer.concat(buffer));
    fs.appendFileSync(logFile, `\n=== [${stamp()}] EXIT: ${code}\n`);
  } catch (e) { /* ignore log write failure */ }
  process.exit(code === null ? 1 : code);
});
