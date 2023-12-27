import { init } from '../lib/index.js'

const DB_FILE = '/db.sqlite3'

const post = (d) => self.postMessage(d)

const sqlite = await init({
	print: (...m) => post({ type: 'log', message: m }),
	printErr: (...m) => post({ type: 'err', message: m }),
})

const db = new sqlite.oo1.OpfsDb(DB_FILE)

const run = (act, p) => {
	switch (act) {
		case 'init':
			if (p instanceof ArrayBuffer) {
				sqlite.oo1.OpfsDb.importDb(DB_FILE, p)
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
