import { init } from '../sqlite-wasm/lib/index.js'
import * as wasm from '../sqlite-wasm/lib/wasm.js'
import { runDemo } from './demo.js'

const DB_FILE = '/db.sqlite3'

const sqlite = await init()
const PoolUtil = await sqlite.installOpfsSAHPoolVfs()
const db = new PoolUtil.OpfsSAHPoolDb(DB_FILE)

const utils = {
	log: (m, b) => self.postMessage({ message: m, body: b }),
	exportDb: () => wasm.sqlite3_js_db_export(db).buffer,
	importDb: (p) => {
		if (!(p instanceof ArrayBuffer)) return 0
		PoolUtil.importDb(DB_FILE, p)
		return p.byteLength
	},
}

try {
	runDemo(db, utils)
} catch (error) {
	self.postMessage({ error })
}
