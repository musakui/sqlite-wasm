import { capi, wasm, sqliteError, C_API } from './base.js'
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

export const sqlite3_db_config = function (pDb, op, ...args) {
	if (!this.s) {
		this.s = wasm.xWrap('sqlite3_wasm_db_config_s', 'int', ['sqlite3*', 'int', 'string:static'])
		this.pii = wasm.xWrap('sqlite3_wasm_db_config_pii', 'int', ['sqlite3*', 'int', '*', 'int', 'int'])
		this.ip = wasm.xWrap('sqlite3_wasm_db_config_ip', 'int', ['sqlite3*', 'int', 'int', '*'])
	}
	switch (op) {
		case C_API.SQLITE_DBCONFIG_ENABLE_FKEY:
		case C_API.SQLITE_DBCONFIG_ENABLE_TRIGGER:
		case C_API.SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER:
		case C_API.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION:
		case C_API.SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE:
		case C_API.SQLITE_DBCONFIG_ENABLE_QPSG:
		case C_API.SQLITE_DBCONFIG_TRIGGER_EQP:
		case C_API.SQLITE_DBCONFIG_RESET_DATABASE:
		case C_API.SQLITE_DBCONFIG_DEFENSIVE:
		case C_API.SQLITE_DBCONFIG_WRITABLE_SCHEMA:
		case C_API.SQLITE_DBCONFIG_LEGACY_ALTER_TABLE:
		case C_API.SQLITE_DBCONFIG_DQS_DML:
		case C_API.SQLITE_DBCONFIG_DQS_DDL:
		case C_API.SQLITE_DBCONFIG_ENABLE_VIEW:
		case C_API.SQLITE_DBCONFIG_LEGACY_FILE_FORMAT:
		case C_API.SQLITE_DBCONFIG_TRUSTED_SCHEMA:
		case C_API.SQLITE_DBCONFIG_STMT_SCANSTATUS:
		case C_API.SQLITE_DBCONFIG_REVERSE_SCANORDER:
			return this.ip(pDb, op, args[0], args[1] || 0)
		case C_API.SQLITE_DBCONFIG_LOOKASIDE:
			return this.pii(pDb, op, args[0], args[1], args[2])
		case C_API.SQLITE_DBCONFIG_MAINDBNAME:
			return this.s(pDb, op, args[0])
		default:
			return C_API.SQLITE_MISUSE
	}
}.bind(Object.create(null))
