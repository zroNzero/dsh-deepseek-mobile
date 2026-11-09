import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { writeFileAtomic } from 'file:///D:/PC/dsh/dsh-one-sync/lib/config.js'

const dir = await fs.mkdtemp('D:/PC/dsh/dsh-mobile/tools/atomic-')
const file = path.join(dir, 'key')
try {
  await fs.writeFile(file, 'abc')
  const before = await fs.stat(file)
  const skipped = await writeFileAtomic(file, Buffer.from('abc'))
  const after = await fs.stat(file)
  assert.equal(skipped, false, 'identical content must be skipped')
  assert.equal(after.mtimeMs, before.mtimeMs, 'identical content must keep mtime')
  assert.equal(await fs.readFile(file, 'utf8'), 'abc')

  await writeFileAtomic(file, Buffer.from('def'))
  assert.equal(await fs.readFile(file, 'utf8'), 'def', 'changed content must be written')

  const realRename = fs.rename
  let renameCalls = 0
  fs.rename = async () => {
    renameCalls += 1
    const error = new Error('EPERM: operation not permitted, rename')
    error.code = 'EPERM'
    throw error
  }
  try {
    await writeFileAtomic(file, Buffer.from('ghi'))
  } finally {
    fs.rename = realRename
  }
  assert.equal(renameCalls, 6, `rename must be attempted 6 times (initial + 5 retries), got ${renameCalls}`)
  assert.equal(await fs.readFile(file, 'utf8'), 'ghi', 'rename failure must fall back to in-place write')

  const realWrite = fs.writeFile
  let writeCalls = 0
  fs.writeFile = async (...args) => {
    writeCalls += 1
    if (writeCalls <= 2) {
      const error = new Error('EBUSY: resource busy')
      error.code = 'EBUSY'
      throw error
    }
    return realWrite(...args)
  }
  try {
    await writeFileAtomic(file, Buffer.from('jkl'))
  } finally {
    fs.writeFile = realWrite
  }
  assert.equal(await fs.readFile(file, 'utf8'), 'jkl', 'EBUSY writes must be retried')
  assert.ok(writeCalls >= 3, `expected retries, write calls=${writeCalls}`)

  console.log(JSON.stringify({ ok: true, renameCalls, writeCalls }))
} finally {
  await fs.rm(dir, { recursive: true, force: true })
}
