import { ptrSizeof } from './constants.js'
import { getASM, wasm as wasm_ori, C_API, AllocError, allocError, sqliteError, sqlite3_js_rc_str, structs } from './base.js'
import * as capi from './capi.js'
import * as heap from './heap.js'
import * as util from './util.js'
import * as pstack_m from './pstack.js'
import { xWrapASM } from './binding.js'

export const sqlite3_wasm_db_reset = xWrapASM('sqlite3_wasm_db_reset', 'int', 'sqlite3*')
export const sqlite3_wasm_db_vfs = xWrapASM('sqlite3_wasm_db_vfs', 'sqlite3_vfs*', 'sqlite3*', 'string')
export const sqlite3_wasm_posix_create_file = xWrapASM('sqlite3_wasm_posix_create_file', 'int', 'string', '*', 'int')
export const sqlite3_wasm_vfs_create_file = xWrapASM('sqlite3_wasm_vfs_create_file', 'int', 'sqlite3_vfs*', 'string', '*', 'int')
export const sqlite3_wasm_vfs_unlink = xWrapASM('sqlite3_wasm_vfs_unlink', 'int', 'sqlite3_vfs*', 'string')

export const sqlite3_js_aggregate_context = (pCtx, n) => {
	return capi.sqlite3_aggregate_context(pCtx, n) || (n ? allocError(`Cannot allocate ${n} bytes for sqlite3_aggregate_context`) : 0)
}

export const sqlite3_js_db_export = (pDb, schema = 0) => {
	pDb = wasm_ori.xWrap.testConvertArg('sqlite3*', pDb)
	if (!pDb) return sqliteError('Invalid db')
	const asm = getASM()
	const scope = heap.scopedAllocPush()
	let pOut
	try {
		const pSize = heap.scopedAlloc(8 + ptrSizeof)
		const ppOut = pSize + 8
		const zSchema = schema ? (util.isPtr(schema) ? schema : heap.scopedAllocCString('' + schema)) : 0
		let rc = asm.sqlite3_wasm_db_serialize(pDb, zSchema, ppOut, pSize, 0)
		if (rc) {
			sqliteError(`Database serialization failed with code ${sqlite3_js_rc_str(rc)}`)
		}
		pOut = heap.peekPtr(ppOut)
		const nOut = heap.peek(pSize, 'i64')
		rc = nOut ? heap.heap8u().slice(pOut, pOut + Number(nOut)) : new Uint8Array()
		return rc
	} finally {
		if (pOut) heap.dealloc(pOut)
		heap.scopedAllocPop(scope)
	}
}

export const sqlite3_js_db_vfs = (dbP, name = 0) => sqlite3_wasm_db_vfs(dbP, name)

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

export const sqlite3_js_posix_create_file = (filename, data, dataLen) => {
	let pData
	if (data && util.isPtr(data)) {
		pData = data
	} else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
		pData = heap.allocFromTypedArray(data)
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
		const rc = sqlite3_wasm_posix_create_file(filename, pData, dataLen)
		if (rc) sqliteError(`Creation of file failed with sqlite3 result code ${sqlite3_js_rc_str(rc)}`)
	} finally {
		heap.dealloc(pData)
	}
}

export const sqlite3_js_vfs_list = () => {
	const rc = []
	let pVfs = capi.sqlite3_vfs_find(0)
	while (pVfs) {
		const oVfs = new structs.sqlite3_vfs(pVfs)
		rc.push(heap.cstrToJs(oVfs.$zName))
		pVfs = oVfs.$pNext
		oVfs.dispose()
	}
	return rc
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
				const [p, n] = heap.allocCStringWithLength(val)
				capi.sqlite3_result_text(pCtx, p, n, C_API.SQLITE_WASM_DEALLOC)
				break
			}
			case 'object':
				if (null === val) {
					capi.sqlite3_result_null(pCtx)
					break
				} else if (util.isBindableTypedArray(val)) {
					const pBlob = heap.allocFromTypedArray(val)
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

/**
 * @param {number} pVal
 */
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
			arg = n ? heap.heap8u().slice(pBlob, pBlob + Number(n)) : null
			break
		}
		case C_API.SQLITE_NULL:
			arg = null
			break
		default:
			if (throwIfCannotConvert) {
				sqliteError(C_API.SQLITE_MISMATCH, `Unhandled sqlite3_value_type: ${valType}`)
			}
			arg = undefined
	}
	return arg
}

/**
 * @param {number} argc
 * @param {number} pArgv
 */
export const sqlite3_values_to_js = (argc, pArgv, throwIfCannotConvert = true) => {
	let i
	const tgt = []
	for (i = 0; i < argc; ++i) {
		tgt.push(sqlite3_value_to_js(heap.peekPtr(pArgv + ptrSizeof * i), throwIfCannotConvert))
	}
	return tgt
}

export const sqlite3_column_js = (pStmt, iCol, throwIfCannotConvert = true) => {
	const v = capi.sqlite3_column_value(pStmt, iCol)
	return 0 === v ? undefined : sqlite3_value_to_js(v, throwIfCannotConvert)
}

export const compileOptionUsed = function f(optName) {
	if (!arguments.length) {
		if (f._result) return f._result
		else if (!f._opt) {
			f._rx = /^([^=]+)=(.+)/
			f._rxInt = /^-?\d+$/
			f._opt = function (opt, rv) {
				const m = f._rx.exec(opt)
				rv[0] = m ? m[1] : opt
				rv[1] = m ? (f._rxInt.test(m[2]) ? +m[2] : m[2]) : true
			}
		}
		const rc = {},
			ov = [0, 0]
		let i = 0,
			k
		while ((k = capi.sqlite3_compileoption_get(i++))) {
			f._opt(k, ov)
			rc[ov[0]] = ov[1]
		}
		return (f._result = rc)
	} else if (Array.isArray(optName)) {
		return Object.fromEntries(optName.map((v) => [v, capi.sqlite3_compileoption_used(v)]))
	} else if ('object' === typeof optName) {
		return Object.fromEntries(Object.keys(optName).map((k) => [k, capi.sqlite3_compileoption_used(k)]))
	}
	return 'string' === typeof optName ? !!capi.sqlite3_compileoption_used(optName) : false
}

export const pstack = {
	alloc: pstack_m.alloc,
	allocPtr: pstack_m.allocPtr,
	allocChunks: pstack_m.allocChunks,
	get pointer() {
		return pstack_m.getPtr()
	},
	get quota() {
		return pstack_m.getQuota()
	},
	get remaining() {
		return pstack_m.getRemaining()
	},
	restore: pstack_m.restore,
}

export { sqlite3_js_rc_str }
export * from './heap.js'
export { isPtr } from './util.js'
export { sizeofIR } from './pstack.js'
