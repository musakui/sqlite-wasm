import init from '../sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs'
import { runDemo } from './demo.js'

const DB_FILE = '/db-ori'

const sqlite = await init()
const PoolUtil = await sqlite.installOpfsSAHPoolVfs({ name: 'ori', directory: '.ori' })
const db = new PoolUtil.OpfsSAHPoolDb(DB_FILE)

const bundle = {
	exec: (...a) => db.exec(...a),
	exportDb: () => sqlite.capi.sqlite3_js_db_export(db).buffer,
	importDb: (p) => {
		if (!(p instanceof ArrayBuffer)) return 0
		PoolUtil.importDb(DB_FILE, p)
		return p.byteLength
	},
}

try {
	await runDemo(bundle, (m) => self.postMessage({ message: m }))
} catch (error) {
	self.postMessage({ error })
}