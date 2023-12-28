import { init } from '../lib/index.js'
import { runDemo } from './demo.js'

const wasmSrc = new URL('../sqlite-wasm/jswasm/sqlite3.wasm', import.meta.url)

const DB_FILE = '/db.sqlite3'

const sqlite = await init(fetch(wasmSrc))
const PoolUtil = await sqlite.installOpfsSAHPoolVfs()
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
	runDemo(bundle, (m) => self.postMessage({ message: m }))
} catch (error) {
	self.postMessage({ error })
}
