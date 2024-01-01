import init from '../../index.mjs'
import { runDemo } from './demo.js'

const DB_FILE = '/db-ori'

const sqlite = await init()
console.log(sqlite)
const PoolUtil = await sqlite.installOpfsSAHPoolVfs({ name: 'ori', directory: '.ori' })
const db = new PoolUtil.OpfsSAHPoolDb(DB_FILE)

const utils = {
	log: (m, b) => self.postMessage({ message: m, body: b }),
	exportDb: () => sqlite.capi.sqlite3_js_db_export(db).buffer,
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