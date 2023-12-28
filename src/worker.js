//import initOri from '../sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs'
import { init } from '../lib/index.js'

const wasmSrc = new URL('../sqlite-wasm/jswasm/sqlite3.wasm', import.meta.url)

const DB_FILE = '/db.sqlite3'

const post = (d) => self.postMessage(d)

//const sqlite = await initOri()
const sqlite = await init(fetch(wasmSrc))

const PoolUtil = await sqlite.installOpfsSAHPoolVfs({});
const db = new PoolUtil.OpfsSAHPoolDb(DB_FILE)

const run = (act, p) => {
	switch (act) {
		case 'init':
			if (p instanceof ArrayBuffer) {
				PoolUtil.importDb(DB_FILE, p)
				return p.byteLength
			}
			return 0
		case 'exec':
			const q = typeof p === 'string' ? { sql: p } : p
			return db.exec({ rowMode: 'array', ...q })
		case 'export':
			return sqlite.capi.sqlite3_js_db_export(db).buffer
		default:
			break
	}
}

self.onmessage = (evt) => {
	const { id, act, payload } = evt.data
	try {
		post({ id, result: run(act, payload) })
	} catch (error) {
		post({ id, error })
	}
}

post({ type: 'ready', version: sqlite.version, filename: db.filename })
