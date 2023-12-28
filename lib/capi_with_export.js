import { getExports, wasm, sqliteError, allocError, AllocError } from './init.js'
import { ptrSizeof } from './constants.js'
import * as pstack from './pstack.js'
import * as util from './util.js'
import * as logger from './logger.js'

const exports = await getExports()

export const alloc = (n) => exports.sqlite3_malloc(n) || allocError(`Failed to allocate ${n} bytes`)

export const realloc = (m, n) => (n ? exports.sqlite3_realloc(m, n) || allocError(`Failed to reallocate ${n} bytes`) : 0)

export const dealloc = exports.sqlite3_free

export const sqlite3_js_db_export = (pDb, schema = 0) => {
	pDb = wasm.xWrap.testConvertArg('sqlite3*', pDb)
	if (!pDb) sqliteError('Invalid sqlite3* argument.')
	const scope = wasm.scopedAllocPush()
	let pOut
	try {
		const pSize = wasm.scopedAlloc(8 + ptrSizeof)
		const ppOut = pSize + 8

		const zSchema = schema ? (util.isPtr(schema) ? schema : wasm.scopedAllocCString('' + schema)) : 0
		let rc = exports.sqlite3_wasm_db_serialize(pDb, zSchema, ppOut, pSize, 0)
		if (rc) {
			sqliteError('Database serialization failed with code', sqlite3.capi.sqlite3_js_rc_str(rc))
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
	if (!exports.sqlite3_wasm_db_error) return code

	const __db_err = wasm.xWrap('sqlite3_wasm_db_error', 'int', 'sqlite3*', 'int', 'string')
	if (code instanceof AllocError) {
		code = capi.SQLITE_NOMEM
		message = 0
	} else if (code instanceof Error) {
		message = message || '' + code
		code = code.resultCode || capi.SQLITE_ERROR
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
		if (rc) sqliteError('Creation of file failed with sqlite3 result code', capi.sqlite3_js_rc_str(rc))
	} finally {
		dealloc(pData)
	}
}