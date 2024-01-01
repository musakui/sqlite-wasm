import { capi, sqliteError } from './base.js'
import * as heap from './heap.js'
import { sqlite3_value_to_js } from './wasm.js'

const __newOldValue = function (pObj, iCol, impl) {
	impl = capi[impl]
	if (!this.ptr) this.ptr = heap.allocPtr()
	else heap.pokePtr(this.ptr, 0)
	const rc = impl(pObj, iCol, this.ptr)
	if (rc) sqliteError(rc, arguments[2] + '() failed with code ' + rc)
	const pv = heap.peekPtr(this.ptr)
	return pv ? sqlite3_value_to_js(pv, true) : undefined
}.bind(Object.create(null))

export const sqlite3_preupdate_new_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_new')
export const sqlite3_preupdate_old_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_old')
export const sqlite3changeset_new_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_new')
export const sqlite3changeset_old_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_old')

const header = 'SQLite format 3'
export const affirmIsDb = (bytes) => {
	if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
	const n = bytes.byteLength
	if (n < 512 || n % 512 !== 0) {
		sqliteError(`Byte array size ${n} is invalid for an SQLite3 db`)
	}
	if (header.length > bytes.byteLength) {
		sqliteError('Input does not contain an SQLite3 database header')
	}
	for (let i = 0; i < header.length; ++i) {
		if (header.charCodeAt(i) !== bytes[i]) {
			sqliteError('Input does not contain an SQLite3 database header.')
		}
	}
}
