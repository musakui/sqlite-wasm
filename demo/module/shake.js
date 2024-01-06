import { load } from '../../sqlite-wasm/lib/instance.js'
import { setup } from '../../sqlite-wasm/lib/base.js'
import { initVFS, openDbFile } from '../../sqlite-wasm/lib/vfs.js'
import { openDb } from '../../sqlite-wasm/lib/db_ops.js'

/** @param {string} message */
const log = (message, body) => self.postMessage({ message, body })

log('started')

await load()
log('loaded')

setup()
const vfsPointer = await initVFS()
await openDbFile('db.sqlite3')
openDb('db.sqlite3', vfsPointer)

log('end')
