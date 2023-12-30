import { getASM } from './init.js'
import { capi, wasm, sqliteError, allocError, AllocError, sqlite3_js_rc_str, C_API, structs } from './base.js'
import { ptrSizeof } from './constants.js'
import * as pstack from './pstack.js'
import * as util from './util.js'
import * as logger from './logger.js'
import * as heap from './heap.js'

const __newOldValue = function (pObj, iCol, impl) {
	impl = capi[impl]
	if (!this.ptr) this.ptr = wasm.allocPtr()
	else wasm.pokePtr(this.ptr, 0)
	const rc = impl(pObj, iCol, this.ptr)
	if (rc) sqliteError(rc, arguments[2] + '() failed with code ' + rc)
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
		const oVfs = new structs.sqlite3_vfs(pVfs)
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
		case C_API.SQLITE_INTEGER:
			arg = capi.sqlite3_value_int64(pVal)
			if (util.bigIntFitsDouble(arg)) arg = Number(arg)
			break
		case C_API.SQLITE_FLOAT:
			arg = capi.sqlite3_value_double(pVal)
			break
		case C_API.SQLITE_TEXT:
			arg = capi.sqlite3_value_text(pVal)
			break
		case C_API.SQLITE_BLOB: {
			const n = capi.sqlite3_value_bytes(pVal)
			const pBlob = capi.sqlite3_value_blob(pVal)
			if (n && !pBlob) allocError(`Cannot allocate memory for blob argument of ${n} byte(s)`)
			arg = n ? wasm.heap8u().slice(pBlob, pBlob + Number(n)) : null
			break
		}
		case C_API.SQLITE_NULL:
			arg = null
			break
		default:
			if (throwIfCannotConvert) {
				sqliteError(C_API.SQLITE_MISMATCH, 'Unhandled sqlite3_value_type():', valType)
			}
			arg = undefined
	}
	return arg
}

export const sqlite3_values_to_js = (argc, pArgv, throwIfCannotConvert = true) => {
	let i
	const tgt = []
	for (i = 0; i < argc; ++i) {
		tgt.push(sqlite3_value_to_js(wasm.peekPtr(pArgv + ptrSizeof * i), throwIfCannotConvert))
	}
	return tgt
}

export const sqlite3_js_aggregate_context = (pCtx, n) => {
	return capi.sqlite3_aggregate_context(pCtx, n) || (n ? allocError(`Cannot allocate ${n} bytes for sqlite3_aggregate_context()`) : 0)
}

export const sqlite3_column_js = (pStmt, iCol, throwIfCannotConvert = true) => {
	const v = capi.sqlite3_column_value(pStmt, iCol)
	return 0 === v ? undefined : capi.sqlite3_value_to_js(v, throwIfCannotConvert)
}

export const sqlite3_result_error_js = (pCtx, e) => {
	if (e instanceof AllocError) {
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
					else sqliteError('BigInt value', val.toString(), 'is too BigInt for int64.')
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
				const [p, n] = heap.allocCString(val, true)
				capi.sqlite3_result_text(pCtx, p, n, C_API.SQLITE_WASM_DEALLOC)
				break
			}
			case 'object':
				if (null === val) {
					capi.sqlite3_result_null(pCtx)
					break
				} else if (util.isBindableTypedArray(val)) {
					const pBlob = wasm.allocFromTypedArray(val)
					capi.sqlite3_result_blob(pCtx, pBlob, val.byteLength, C_API.SQLITE_WASM_DEALLOC)
					break
				}

			default:
				sqliteError("Don't not how to handle this UDF result value:", typeof val, val)
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

export const alloc = (n) => getASM().sqlite3_malloc(n) || allocError(`Failed to allocate ${n} bytes`)

export const realloc = (m, n) => (n ? getASM().sqlite3_realloc(m, n) || allocError(`Failed to reallocate ${n} bytes`) : 0)

export const dealloc = (n) => getASM().sqlite3_free(n)

export const sqlite3_js_db_export = (pDb, schema = 0) => {
	pDb = wasm.xWrap.testConvertArg('sqlite3*', pDb)
	if (!pDb) sqliteError('Invalid sqlite3* argument.')
	const exports = getASM()
	const scope = wasm.scopedAllocPush()
	let pOut
	try {
		const pSize = wasm.scopedAlloc(8 + ptrSizeof)
		const ppOut = pSize + 8

		const zSchema = schema ? (util.isPtr(schema) ? schema : wasm.scopedAllocCString('' + schema)) : 0
		let rc = exports.sqlite3_wasm_db_serialize(pDb, zSchema, ppOut, pSize, 0)
		if (rc) {
			sqliteError('Database serialization failed with code', sqlite3_js_rc_str(rc))
		}
		pOut = wasm.peekPtr(ppOut)
		const nOut = wasm.peek(pSize, 'i64')
		rc = nOut ? wasm.heap8u().slice(pOut, pOut + Number(nOut)) : new Uint8Array()
		return rc
	} finally {
		if (pOut) exports.sqlite3_free(pOut)
		wasm.scopedAllocPop(scope)
	}
}

export const sqlite3_randomness = (...args) => {
	const exports = getASM()
	if (1 === args.length && util.isTypedArray(args[0]) && 1 === args[0].BYTES_PER_ELEMENT) {
		const ta = args[0]
		if (0 === ta.byteLength) {
			exports.sqlite3_randomness(0, 0)
			return ta
		}
		const stack = pstack.getPtr()
		try {
			let n = ta.byteLength
			let offset = 0
			const r = exports.sqlite3_randomness
			const heap = wasm.heap8u()
			const nAlloc = n < 512 ? n : 512
			const ptr = pstack.alloc(nAlloc)
			do {
				const j = n > nAlloc ? nAlloc : n
				r(j, ptr)
				ta.set(util.typedArrayPart(heap, ptr, ptr + j), offset)
				n -= j
				offset += j
			} while (n > 0)
		} catch (e) {
			logger.error('Highly unexpected (and ignored!) exception in sqlite3_randomness():', e)
		} finally {
			pstack.restore(stack)
		}
		return ta
	}
	exports.sqlite3_randomness(...args)
}

export const sqlite3_wasm_db_error = (pDb, code, message) => {
	const exports = getASM()
	if (!exports.sqlite3_wasm_db_error) return code

	const __db_err = wasm.xWrap('sqlite3_wasm_db_error', 'int', 'sqlite3*', 'int', 'string')
	if (code instanceof AllocError) {
		code = C_API.SQLITE_NOMEM
		message = 0
	} else if (code instanceof Error) {
		message = message || '' + code
		code = code.resultCode || C_API.SQLITE_ERROR
	}
	return pDb ? __db_err(pDb, code, message) : code
}

export const sqlite3_js_posix_create_file = (filename, data, dataLen) => {
	let pData
	if (data && util.isPtr(data)) {
		pData = data
	} else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
		pData = wasm.allocFromTypedArray(data)
		if (arguments.length < 3 || !util.isInt32(dataLen) || dataLen < 0) {
			dataLen = data.byteLength
		}
	} else {
		sqliteError('Invalid 2nd argument for sqlite3_js_posix_create_file().')
	}
	try {
		if (!util.isInt32(dataLen) || dataLen < 0) {
			sqliteError('Invalid 3rd argument for sqlite3_js_posix_create_file().')
		}
		const rc = wasm.sqlite3_wasm_posix_create_file(filename, pData, dataLen)
		if (rc) sqliteError('Creation of file failed with sqlite3 result code', sqlite3_js_rc_str(rc))
	} finally {
		dealloc(pData)
	}
}

export const sqlite3_cancel_auto_extension = (fPtr, ...args) => {
	if (!fPtr || args.length || !util.isPtr(fPtr)) return 0
	return getASM().sqlite3_cancel_auto_extension(fPtr)
}

export const sqlite3_config = (op, ...args) => {
	if (!args.length) return C_API.SQLITE_MISUSE

	const exports = getASM()

	switch (op) {
		case C_API.SQLITE_CONFIG_COVERING_INDEX_SCAN:
		case C_API.SQLITE_CONFIG_MEMSTATUS:
		case C_API.SQLITE_CONFIG_SMALL_MALLOC:
		case C_API.SQLITE_CONFIG_SORTERREF_SIZE:
		case C_API.SQLITE_CONFIG_STMTJRNL_SPILL:
		case C_API.SQLITE_CONFIG_URI:
			return exports.sqlite3_wasm_config_i(op, args[0])
		case C_API.SQLITE_CONFIG_LOOKASIDE:
			return exports.sqlite3_wasm_config_ii(op, args[0], args[1])
		case C_API.SQLITE_CONFIG_MEMDB_MAXSIZE:
			return exports.sqlite3_wasm_config_j(op, args[0])
		/*
		case C_API.SQLITE_CONFIG_GETMALLOC:
		case C_API.SQLITE_CONFIG_GETMUTEX:
		case C_API.SQLITE_CONFIG_GETPCACHE2:
		case C_API.SQLITE_CONFIG_GETPCACHE:
		case C_API.SQLITE_CONFIG_HEAP:
		case C_API.SQLITE_CONFIG_LOG:
		case C_API.SQLITE_CONFIG_MALLOC:
		case C_API.SQLITE_CONFIG_MMAP_SIZE:
		case C_API.SQLITE_CONFIG_MULTITHREAD:
		case C_API.SQLITE_CONFIG_MUTEX:
		case C_API.SQLITE_CONFIG_PAGECACHE:
		case C_API.SQLITE_CONFIG_PCACHE2:
		case C_API.SQLITE_CONFIG_PCACHE:
		case C_API.SQLITE_CONFIG_PCACHE_HDRSZ:
		case C_API.SQLITE_CONFIG_PMASZ:
		case C_API.SQLITE_CONFIG_SERIALIZED:
		case C_API.SQLITE_CONFIG_SINGLETHREAD:
		case C_API.SQLITE_CONFIG_SQLLOG:
		case C_API.SQLITE_CONFIG_WIN32_HEAPSIZE:
		*/
		default:
			return C_API.SQLITE_NOTFOUND
	}
}
