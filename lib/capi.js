import { getASM } from './instance.js'
import { wasm, sqliteError, sqlite3_js_rc_str } from './base.js'
import { ptrSizeof } from './constants.js'
import * as util from './util.js'
import * as heap from './heap.js'
import * as pstack from './pstack.js'
import * as logger from './logger.js'

export const sqlite3_js_db_export = (pDb, schema = 0) => {
	pDb = wasm.xWrap.testConvertArg('sqlite3*', pDb)
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
			sqliteError('Database serialization failed with code', sqlite3_js_rc_str(rc))
		}
		pOut = heap.peekPtr(ppOut)
		const nOut = heap.peek(pSize, 'i64')
		rc = nOut ? heap.HEAP8U().slice(pOut, pOut + Number(nOut)) : new Uint8Array()
		return rc
	} finally {
		if (pOut) asm.sqlite3_free(pOut)
		heap.scopedAllocPop(scope)
	}
}

export const sqlite3_randomness = (...args) => {
	const asm = getASM()
	if (1 === args.length && util.isTypedArray(args[0]) && 1 === args[0].BYTES_PER_ELEMENT) {
		const ta = args[0]
		if (0 === ta.byteLength) {
			asm.sqlite3_randomness(0, 0)
			return ta
		}
		const stack = pstack.getPtr()
		try {
			let n = ta.byteLength
			let offset = 0
			const r = asm.sqlite3_randomness
			const hp = heap.HEAP8U()
			const nAlloc = n < 512 ? n : 512
			const ptr = pstack.alloc(nAlloc)
			do {
				const j = n > nAlloc ? nAlloc : n
				r(j, ptr)
				ta.set(util.typedArrayPart(hp, ptr, ptr + j), offset)
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
	asm.sqlite3_randomness(...args)
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
		const rc = wasm.sqlite3_wasm_posix_create_file(filename, pData, dataLen)
		if (rc) sqliteError('Creation of file failed with sqlite3 result code', sqlite3_js_rc_str(rc))
	} finally {
		heap.dealloc(pData)
	}
}

export const sqlite3_cancel_auto_extension = (fPtr, ...args) => {
	if (!fPtr || args.length || !util.isPtr(fPtr)) return 0
	return getASM().sqlite3_cancel_auto_extension(fPtr)
}

export const sqlite3_config = (op, ...args) => {
	if (!op || !args.length) return C_API.SQLITE_MISUSE

	const asm = getASM()

	switch (op) {
		case C_API.SQLITE_CONFIG_COVERING_INDEX_SCAN:
		case C_API.SQLITE_CONFIG_MEMSTATUS:
		case C_API.SQLITE_CONFIG_SMALL_MALLOC:
		case C_API.SQLITE_CONFIG_SORTERREF_SIZE:
		case C_API.SQLITE_CONFIG_STMTJRNL_SPILL:
		case C_API.SQLITE_CONFIG_URI:
			return asm.sqlite3_wasm_config_i(op, args[0])
		case C_API.SQLITE_CONFIG_LOOKASIDE:
			return asm.sqlite3_wasm_config_ii(op, args[0], args[1])
		case C_API.SQLITE_CONFIG_MEMDB_MAXSIZE:
			return asm.sqlite3_wasm_config_j(op, args[0])
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