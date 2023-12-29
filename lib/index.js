import { loadWASM, capi } from './init.js'
import { installStruct } from './struct.js'
import { installWhWasm } from './whWasm.js'
import { installOO1 } from './oo1.js'
import { installSAHPool } from './sahPool.js'
import { initCapi } from './setup.js'

export async function init() {
	await loadWASM()
	initCapi(capi)
	const sqlite3 = { capi }
	installWhWasm(sqlite3)
	installOO1(sqlite3)
	installStruct(sqlite3)
	installSAHPool(sqlite3)
	return sqlite3
}
