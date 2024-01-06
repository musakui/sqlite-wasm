import { load } from '../../sqlite-wasm/lib/instance.js'
import { setup } from '../../sqlite-wasm/lib/base.js'
import { initVFS, openDbFile } from '../../sqlite-wasm/lib/vfs.js'
import { openDb, db_exec_str } from '../../sqlite-wasm/lib/db_ops.js'
import { SQLITE } from '../../sqlite-wasm/lib/constants.js'

/** @param {string} message */
const log = (message, body) => self.postMessage({ message, body })

log('started')

await load()
log('loaded')

const flags = SQLITE.OPEN_CREATE | SQLITE.OPEN_READWRITE | SQLITE.OPEN_EXRESCODE

setup()
const vfsPointer = await initVFS()
await openDbFile('db.sqlite3')
const pDb = openDb('db.sqlite3', flags, vfsPointer)
db_exec_str(pDb, `CREATE TABLE IF NOT EXISTS test(a, b)`)

log('end')
