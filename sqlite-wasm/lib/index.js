import { load } from './instance.js'
import { setup } from './base.js'
import { installOO1 } from './oo1.js'
import { installStruct } from './struct.js'
import { installSAHPool } from './sahPool.js'

export async function init() {
	await load()
	setup()
	const sqlite3 = {}
	installOO1(sqlite3)
	installStruct(sqlite3)
	installSAHPool(sqlite3)
	return sqlite3
}
