import { init } from '../lib/index.js'
import { sqlite3_js_db_export } from '../lib/capi_extras_with_export.js'
import { runDemo } from './demo.js'

const DB_FILE = '/db.sqlite3'

const sqlite = await init()
const PoolUtil = await sqlite.installOpfsSAHPoolVfs()
const db = new PoolUtil.OpfsSAHPoolDb(DB_FILE)

const utils = {
	log: (m, b) => self.postMessage({ message: m, body: b }),
	exportDb: () => sqlite3_js_db_export(db).buffer,
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
