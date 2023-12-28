import { capi, wasm, SQLite3Error, WasmAllocError } from './init.js'
import * as util from './util.js'

const __newOldValue = function (pObj, iCol, impl) {
	impl = capi[impl]
	if (!this.ptr) this.ptr = wasm.allocPtr()
	else wasm.pokePtr(this.ptr, 0)
	const rc = impl(pObj, iCol, this.ptr)
	if (rc) return SQLite3Error.toss(rc, arguments[2] + '() failed with code ' + rc)
	const pv = wasm.peekPtr(this.ptr)
	return pv ? capi.sqlite3_value_to_js(pv, true) : undefined
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
		SQLite3Error.toss('Byte array size', n, 'is invalid for an SQLite3 db.')
	}
	if (header.length > bytes.byteLength) {
		SQLite3Error.toss('Input does not contain an SQLite3 database header.')
	}
	for (let i = 0; i < header.length; ++i) {
		if (header.charCodeAt(i) !== bytes[i]) {
			SQLite3Error.toss('Input does not contain an SQLite3 database header.')
		}
	}
}

export const sqlite3_js_db_vfs = (dbP, name = 0) => wasm.sqlite3_wasm_db_vfs(dbP, name)

export const sqlite3_js_db_uses_vfs = (pDb, vfsName, dbName = 0) => {
	try {
		const pK = capi.sqlite3_vfs_find(vfsName)
		if (!pK) return false
		else if (!pDb) {
			return pK === capi.sqlite3_vfs_find(0) ? pK : false
		} else {
			return pK === sqlite3_js_db_vfs(pDb, dbName) ? pK : false
		}
	} catch (e) {
		return false
	}
}

export const sqlite3_js_vfs_list = () => {
	const rc = []
	let pVfs = capi.sqlite3_vfs_find(0)
	while (pVfs) {
		const oVfs = new capi.sqlite3_vfs(pVfs)
		rc.push(wasm.cstrToJs(oVfs.$zName))
		pVfs = oVfs.$pNext
		oVfs.dispose()
	}
	return rc
}

export const sqlite3_value_to_js = (pVal, throwIfCannotConvert = true) => {
	let arg
	const valType = capi.sqlite3_value_type(pVal)
	switch (valType) {
		case capi.SQLITE_INTEGER:
			arg = capi.sqlite3_value_int64(pVal)
			if (util.bigIntFitsDouble(arg)) arg = Number(arg)
			break
		case capi.SQLITE_FLOAT:
			arg = capi.sqlite3_value_double(pVal)
			break
		case capi.SQLITE_TEXT:
			arg = capi.sqlite3_value_text(pVal)
			break
		case capi.SQLITE_BLOB: {
			const n = capi.sqlite3_value_bytes(pVal)
			const pBlob = capi.sqlite3_value_blob(pVal)
			if (n && !pBlob) WasmAllocError.toss('Cannot allocate memory for blob argument of', n, 'byte(s)')
			arg = n ? wasm.heap8u().slice(pBlob, pBlob + Number(n)) : null
			break
		}
		case capi.SQLITE_NULL:
			arg = null
			break
		default:
			if (throwIfCannotConvert) {
				SQLite3Error.toss(capi.SQLITE_MISMATCH, 'Unhandled sqlite3_value_type():', valType)
			}
			arg = undefined
	}
	return arg
}

export const sqlite3_values_to_js = (argc, pArgv, throwIfCannotConvert = true) => {
	let i
	const tgt = []
	for (i = 0; i < argc; ++i) {
		tgt.push(sqlite3_value_to_js(wasm.peekPtr(pArgv + wasm.ptrSizeof * i), throwIfCannotConvert))
	}
	return tgt
}

export const sqlite3_js_aggregate_context = (pCtx, n) => {
	return capi.sqlite3_aggregate_context(pCtx, n) || (n ? WasmAllocError.toss('Cannot allocate', n, 'bytes for sqlite3_aggregate_context()') : 0)
}

export const sqlite3_column_js = (pStmt, iCol, throwIfCannotConvert = true) => {
	const v = capi.sqlite3_column_value(pStmt, iCol)
	return 0 === v ? undefined : capi.sqlite3_value_to_js(v, throwIfCannotConvert)
}

export const sqlite3_result_error_js = (pCtx, e) => {
	if (e instanceof WasmAllocError) {
		capi.sqlite3_result_error_nomem(pCtx)
	} else {
		capi.sqlite3_result_error(pCtx, '' + e, -1)
	}
}

export const sqlite3_result_js = (pCtx, val) => {
	if (val instanceof Error) {
		sqlite3_result_error_js(pCtx, val)
		return
	}
	try {
		switch (typeof val) {
			case 'undefined':
				break
			case 'boolean':
				capi.sqlite3_result_int(pCtx, val ? 1 : 0)
				break
			case 'bigint':
				if (util.bigIntFits32(val)) {
					capi.sqlite3_result_int(pCtx, Number(val))
				} else if (util.bigIntFitsDouble(val)) {
					capi.sqlite3_result_double(pCtx, Number(val))
				} else {
					if (util.bigIntFits64(val)) capi.sqlite3_result_int64(pCtx, val)
					else toss3('BigInt value', val.toString(), 'is too BigInt for int64.')
				}
				break
			case 'number': {
				let f
				if (util.isInt32(val)) {
					f = capi.sqlite3_result_int
				} else if (Number.isInteger(val) && util.bigIntFits64(BigInt(val))) {
					f = capi.sqlite3_result_int64
				} else {
					f = capi.sqlite3_result_double
				}
				f(pCtx, val)
				break
			}
			case 'string': {
				const [p, n] = wasm.allocCString(val, true)
				capi.sqlite3_result_text(pCtx, p, n, capi.SQLITE_WASM_DEALLOC)
				break
			}
			case 'object':
				if (null === val) {
					capi.sqlite3_result_null(pCtx)
					break
				} else if (util.isBindableTypedArray(val)) {
					const pBlob = wasm.allocFromTypedArray(val)
					capi.sqlite3_result_blob(pCtx, pBlob, val.byteLength, capi.SQLITE_WASM_DEALLOC)
					break
				}

			default:
				toss3("Don't not how to handle this UDF result value:", typeof val, val)
		}
	} catch (e) {
		sqlite3_result_error_js(pCtx, e)
	}
}

export const sqlite3_db_config = function (pDb, op, ...args) {
	if (!this.s) {
		this.s = wasm.xWrap('sqlite3_wasm_db_config_s', 'int', ['sqlite3*', 'int', 'string:static'])
		this.pii = wasm.xWrap('sqlite3_wasm_db_config_pii', 'int', ['sqlite3*', 'int', '*', 'int', 'int'])
		this.ip = wasm.xWrap('sqlite3_wasm_db_config_ip', 'int', ['sqlite3*', 'int', 'int', '*'])
	}
	switch (op) {
		case capi.SQLITE_DBCONFIG_ENABLE_FKEY:
		case capi.SQLITE_DBCONFIG_ENABLE_TRIGGER:
		case capi.SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER:
		case capi.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION:
		case capi.SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE:
		case capi.SQLITE_DBCONFIG_ENABLE_QPSG:
		case capi.SQLITE_DBCONFIG_TRIGGER_EQP:
		case capi.SQLITE_DBCONFIG_RESET_DATABASE:
		case capi.SQLITE_DBCONFIG_DEFENSIVE:
		case capi.SQLITE_DBCONFIG_WRITABLE_SCHEMA:
		case capi.SQLITE_DBCONFIG_LEGACY_ALTER_TABLE:
		case capi.SQLITE_DBCONFIG_DQS_DML:
		case capi.SQLITE_DBCONFIG_DQS_DDL:
		case capi.SQLITE_DBCONFIG_ENABLE_VIEW:
		case capi.SQLITE_DBCONFIG_LEGACY_FILE_FORMAT:
		case capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA:
		case capi.SQLITE_DBCONFIG_STMT_SCANSTATUS:
		case capi.SQLITE_DBCONFIG_REVERSE_SCANORDER:
			return this.ip(pDb, op, args[0], args[1] || 0)
		case capi.SQLITE_DBCONFIG_LOOKASIDE:
			return this.pii(pDb, op, args[0], args[1], args[2])
		case capi.SQLITE_DBCONFIG_MAINDBNAME:
			return this.s(pDb, op, args[0])
		default:
			return capi.SQLITE_MISUSE
	}
}.bind(Object.create(null))
