import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { ensureMasterKey } from 'file:///D:/PC/dsh/dsh-one-sync/lib/sync-core.js'

const home = await fs.mkdtemp('D:/PC/dsh/dsh-mobile/tools/keysync-')
try {
  const transport = {
    snapshot: async () => ({ files: new Map() }),
    config: {},
  }
  const config = { passphrase: 'test-passphrase', rememberKey: true }
  const options = { home, transport, allowCreate: true }

  const first = await ensureMasterKey(config, options)
  const keyPath = path.join(home, 'one-sync', 'key')
  const before = await fs.stat(keyPath)
  await new Promise((resolve) => setTimeout(resolve, 40))

  const second = await ensureMasterKey(config, options)
  const after = await fs.stat(keyPath)
  assert.ok(Buffer.isBuffer(first) && first.length === 32)
  assert.ok(first.equals(second), 'repeated ensureMasterKey must return the same key')
  assert.equal(after.mtimeMs, before.mtimeMs, 'unchanged key cache must not be rewritten')

  console.log(JSON.stringify({ ok: true, keyCacheMtimeUnchanged: true, keyBytes: first.length }))
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
