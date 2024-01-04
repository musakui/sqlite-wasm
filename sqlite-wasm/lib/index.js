import { load } from './instance.js'
import { setup } from './base.js'
import { installOO1 } from './oo1.js'
import { installStruct } from './struct.js'
import { installSAHPool } from './sahPool.js'

export async function init() {
	let src = '../jswasm/sqlite3.wasm'
	try {
		// use vite to get the URL if possible
		const m = await import('../jswasm/sqlite3.wasm?url')
		if (m.default) {
			src = m.default
		}
	} catch (err) {}
	await load(src)
	setup()
	const sqlite3 = {}
	installOO1(sqlite3)
	installStruct(sqlite3)
	await installSAHPool(sqlite3)
	return sqlite3
}
