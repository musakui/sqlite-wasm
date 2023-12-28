import { getExports, capi } from './init.js'
import { installStruct } from './struct.js'
import { installWhWasm } from './whWasm.js'
import { installOO1 } from './oo1.js'
import { installSAHPool } from './sahPool.js'

export async function init() {
	const exports = await getExports()
	const sqlite3 = { capi }
	installWhWasm(sqlite3, exports)
	installOO1(sqlite3)
	installStruct(sqlite3)
	installSAHPool(sqlite3)
	return sqlite3
}

export const version = {
	libVersion: '3.44.2',
	libVersionNumber: 3044002,
	sourceId: '2023-11-24 11:41:44 ebead0e7230cd33bcec9f95d2183069565b9e709bf745c9b5db65cc0cbf92c0f',
	downloadVersion: 3440200,
}
