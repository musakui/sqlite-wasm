import { C_API, sqlite3_js_rc_str, getASM } from './base.js'
import * as util from './util.js'
import * as heap from './heap.js'
import * as pstack from './pstack.js'
import * as logger from './logger.js'
import { xWrapASM } from './binding.js'

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
			const hp = heap.heap8u()
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


const __autoExtFptr = new Set()

/**
 * @param {Function | number} fPtr
 */
export const sqlite3_auto_extension = (fPtr) => {
	const ori = fPtr
	if (util.isFunction(fPtr)) {
		fPtr = heap.installFunction(fPtr, 'i(ppp)')
	} else if (!util.isPtr(fPtr)) {
		return C_API.SQLITE_MISUSE
	}
	/** @type {number} */
	const rc = getASM().sqlite3_auto_extension(fPtr)
	if (fPtr !== ori) {
		if (rc === 0) {
			__autoExtFptr.add(fPtr)
		} else {
			heap.uninstallFunction(fPtr)
		}
	}
	return rc
}

export const sqlite3_reset_auto_extension = () => {
	getASM().sqlite3_reset_auto_extension()
	for (const fp of __autoExtFptr) heap.uninstallFunction(fp)
	__autoExtFptr.clear()
}

const __db_err = xWrapASM('sqlite3_wasm_db_error', 'int', 'sqlite3*', 'int', 'string')

export const sqlite3_wasm_db_error = (pDb, code, message) => {
	if (code instanceof AllocError) {
		code = C_API.SQLITE_NOMEM
		message = 0
	} else if (code instanceof Error) {
		message = message || '' + code
		code = code.resultCode || C_API.SQLITE_ERROR
	}
	return pDb ? __db_err(pDb, code, message) : code
}

const __config_s = xWrapASM('sqlite3_wasm_db_config_s', 'int', 'sqlite3*', 'int', 'string:static')
const __config_pii = xWrapASM('sqlite3_wasm_db_config_pii', 'int', 'sqlite3*', 'int', '*', 'int', 'int')
const __config_ip = xWrapASM('sqlite3_wasm_db_config_ip', 'int', 'sqlite3*', 'int', 'int', '*')

export const sqlite3_db_config = (pDb, op, ...args) => {
	switch (op) {
		case C_API.SQLITE_DBCONFIG_LOOKASIDE:
			return __config_pii(pDb, op, args[0], args[1], args[2])
		case C_API.SQLITE_DBCONFIG_MAINDBNAME:
			return __config_s(pDb, op, args[0])
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
			return __config_ip(pDb, op, args[0], args[1] || 0)
		default:
			return C_API.SQLITE_MISUSE
	}
}

export { sqlite3_js_rc_str }
export * from './capi_base.js'
