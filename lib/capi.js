import { getASM } from './instance.js'
import { sqliteError, sqlite3_js_rc_str, C_API } from './base.js'
import * as util from './util.js'
import * as heap from './heap.js'
import * as wasm from './wasm.js'
import * as pstack from './pstack.js'
import * as logger from './logger.js'
import { xWrapASM } from './binding.js'

export const sqlite3_aggregate_context = xWrapASM('sqlite3_aggregate_context', 'void*', 'sqlite3_context*', 'int')
export const sqlite3_bind_double = xWrapASM('sqlite3_bind_double', 'int', 'sqlite3_stmt*', 'int', 'f64')
export const sqlite3_bind_int = xWrapASM('sqlite3_bind_int', 'int', 'sqlite3_stmt*', 'int', 'int')
export const sqlite3_bind_int64 = xWrapASM('sqlite3_bind_int64', 'int', 'sqlite3_stmt*', 'int', 'i64')
export const sqlite3_bind_null = xWrapASM('sqlite3_bind_null', undefined, 'sqlite3_stmt*', 'int')
export const sqlite3_bind_parameter_count = xWrapASM('sqlite3_bind_parameter_count', 'int', 'sqlite3_stmt*')
export const sqlite3_bind_parameter_index = xWrapASM('sqlite3_bind_parameter_index', 'int', 'sqlite3_stmt*', 'string')
export const sqlite3_bind_pointer = xWrapASM('sqlite3_bind_pointer', 'int', 'sqlite3_stmt*', 'int', '*', 'string:static', '*')

export const sqlite3_busy_timeout = xWrapASM('sqlite3_busy_timeout', 'int', 'sqlite3*', 'int')
export const sqlite3_changes = xWrapASM('sqlite3_changes', 'int', 'sqlite3*')
export const sqlite3_clear_bindings = xWrapASM('sqlite3_clear_bindings', 'int', 'sqlite3_stmt*')
export const sqlite3_collation_needed = xWrapASM('sqlite3_collation_needed', 'int', 'sqlite3*', '*', '*')
export const sqlite3_column_blob = xWrapASM('sqlite3_column_blob', '*', 'sqlite3_stmt*', 'int')
export const sqlite3_column_bytes = xWrapASM('sqlite3_column_bytes', 'int', 'sqlite3_stmt*', 'int')
export const sqlite3_column_count = xWrapASM('sqlite3_column_count', 'int', 'sqlite3_stmt*')
export const sqlite3_column_double = xWrapASM('sqlite3_column_double', 'f64', 'sqlite3_stmt*', 'int')
export const sqlite3_column_int = xWrapASM('sqlite3_column_int', 'int', 'sqlite3_stmt*', 'int')
export const sqlite3_column_int64 = xWrapASM('sqlite3_column_int64', 'i64', 'sqlite3_stmt*', 'int')
export const sqlite3_column_name = xWrapASM('sqlite3_column_name', 'string', 'sqlite3_stmt*', 'int')
export const sqlite3_column_text = xWrapASM('sqlite3_column_text', 'string', 'sqlite3_stmt*', 'int')
export const sqlite3_column_type = xWrapASM('sqlite3_column_type', 'int', 'sqlite3_stmt*', 'int')
export const sqlite3_column_value = xWrapASM('sqlite3_column_value', 'sqlite3_value*', 'sqlite3_stmt*', 'int')

export const sqlite3_compileoption_get = xWrapASM('sqlite3_compileoption_get', 'string', 'int')
export const sqlite3_compileoption_used = xWrapASM('sqlite3_compileoption_used', 'int', 'string')
export const sqlite3_complete = xWrapASM('sqlite3_complete', 'int', 'string:flexible')
export const sqlite3_context_db_handle = xWrapASM('sqlite3_context_db_handle', 'sqlite3*', 'sqlite3_context*')
export const sqlite3_data_count = xWrapASM('sqlite3_data_count', 'int', 'sqlite3_stmt*')
export const sqlite3_db_filename = xWrapASM('sqlite3_db_filename', 'string', 'sqlite3*', 'string')
export const sqlite3_db_handle = xWrapASM('sqlite3_db_handle', 'sqlite3*', 'sqlite3_stmt*')
export const sqlite3_db_name = xWrapASM('sqlite3_db_name', 'string', 'sqlite3*', 'int')
export const sqlite3_db_status = xWrapASM('sqlite3_db_status', 'int', 'sqlite3*', 'int', '*', '*', 'int')
export const sqlite3_errcode = xWrapASM('sqlite3_errcode', 'int', 'sqlite3*')
export const sqlite3_errmsg = xWrapASM('sqlite3_errmsg', 'string', 'sqlite3*')
export const sqlite3_error_offset = xWrapASM('sqlite3_error_offset', 'int', 'sqlite3*')
export const sqlite3_errstr = xWrapASM('sqlite3_errstr', 'string', 'int')
export const sqlite3_expanded_sql = xWrapASM('sqlite3_expanded_sql', 'string', 'sqlite3_stmt*')
export const sqlite3_extended_errcode = xWrapASM('sqlite3_extended_errcode', 'int', 'sqlite3*')
export const sqlite3_extended_result_codes = xWrapASM('sqlite3_extended_result_codes', 'int', 'sqlite3*', 'int')

export const sqlite3_file_control = xWrapASM('sqlite3_file_control', 'int', 'sqlite3*', 'string', 'int', '*')
export const sqlite3_finalize = xWrapASM('sqlite3_finalize', 'int', 'sqlite3_stmt*')
export const sqlite3_get_auxdata = xWrapASM('sqlite3_get_auxdata', '*', 'sqlite3_context*', 'int')
export const sqlite3_initialize = xWrapASM('sqlite3_initialize', undefined)
export const sqlite3_keyword_check = xWrapASM('sqlite3_keyword_check', 'int', 'string', 'int')
export const sqlite3_keyword_count = xWrapASM('sqlite3_keyword_count', 'int')
export const sqlite3_keyword_name = xWrapASM('sqlite3_keyword_name', 'int', 'int', '**', '*')
export const sqlite3_libversion = xWrapASM('sqlite3_libversion', 'string')
export const sqlite3_libversion_number = xWrapASM('sqlite3_libversion_number', 'int')
export const sqlite3_limit = xWrapASM('sqlite3_limit', 'int', 'sqlite3*', 'int', 'int')
export const sqlite3_malloc = xWrapASM('sqlite3_malloc', '*', 'int')
export const sqlite3_open = xWrapASM('sqlite3_open', 'int', 'string', '*')
export const sqlite3_open_v2 = xWrapASM('sqlite3_open_v2', 'int', 'string', '*', 'int', 'string')

export const sqlite3_reset = xWrapASM('sqlite3_reset', 'int', 'sqlite3_stmt*')
export const sqlite3_result_blob = xWrapASM('sqlite3_result_blob', undefined, 'sqlite3_context*', '*', 'int', '*')
export const sqlite3_result_double = xWrapASM('sqlite3_result_double', undefined, 'sqlite3_context*', 'f64')
export const sqlite3_result_error = xWrapASM('sqlite3_result_error', undefined, 'sqlite3_context*', 'string', 'int')
export const sqlite3_result_error_code = xWrapASM('sqlite3_result_error_code', undefined, 'sqlite3_context*', 'int')
export const sqlite3_result_error_nomem = xWrapASM('sqlite3_result_error_nomem', undefined, 'sqlite3_context*')
export const sqlite3_result_error_toobig = xWrapASM('sqlite3_result_error_toobig', undefined, 'sqlite3_context*')
export const sqlite3_result_int = xWrapASM('sqlite3_result_int', undefined, 'sqlite3_context*', 'int')
export const sqlite3_result_int64 = xWrapASM('sqlite3_result_int64', undefined, '*', 'i64')
export const sqlite3_result_null = xWrapASM('sqlite3_result_null', undefined, 'sqlite3_context*')
export const sqlite3_result_pointer = xWrapASM('sqlite3_result_pointer', undefined, 'sqlite3_context*', '*', 'string:static', '*')
export const sqlite3_result_subtype = xWrapASM('sqlite3_result_subtype', undefined, 'sqlite3_value*', 'int')
export const sqlite3_result_text = xWrapASM('sqlite3_result_text', undefined, 'sqlite3_context*', 'string', 'int', '*')
export const sqlite3_result_zeroblob64 = xWrapASM('sqlite3_result_zeroblob64', 'int', '*', 'i64')

export const sqlite3_serialize = xWrapASM('sqlite3_serialize', '*', 'sqlite3*', 'string', '*', 'int')
export const sqlite3_shutdown = xWrapASM('sqlite3_shutdown', undefined)
export const sqlite3_sourceid = xWrapASM('sqlite3_sourceid', 'string')
export const sqlite3_sql = xWrapASM('sqlite3_sql', 'string', 'sqlite3_stmt*')
export const sqlite3_status = xWrapASM('sqlite3_status', 'int', 'int', '*', '*', 'int')
export const sqlite3_step = xWrapASM('sqlite3_step', 'int', 'sqlite3_stmt*')
export const sqlite3_stmt_isexplain = xWrapASM('sqlite3_stmt_isexplain', 'int', 'sqlite3_stmt*')
export const sqlite3_stmt_readonly = xWrapASM('sqlite3_stmt_readonly', 'int', 'sqlite3_stmt*')
export const sqlite3_stmt_status = xWrapASM('sqlite3_stmt_status', 'int', 'sqlite3_stmt*', 'int', 'int')
export const sqlite3_strglob = xWrapASM('sqlite3_strglob', 'int', 'string', 'string')
export const sqlite3_stricmp = xWrapASM('sqlite3_stricmp', 'int', 'string', 'string')
export const sqlite3_strlike = xWrapASM('sqlite3_strlike', 'int', 'string', 'string', 'int')
export const sqlite3_strnicmp = xWrapASM('sqlite3_strnicmp', 'int', 'string', 'string', 'int')
export const sqlite3_table_column_metadata = xWrapASM('sqlite3_table_column_metadata', 'int', 'sqlite3*', 'string', 'string', 'string', '**', '**', '*', '*', '*')
export const sqlite3_total_changes = xWrapASM('sqlite3_total_changes', 'int', 'sqlite3*')
export const sqlite3_total_changes64 = xWrapASM('sqlite3_total_changes64', 'i64', 'sqlite3*')
export const sqlite3_txn_state = xWrapASM('sqlite3_txn_state', 'int', 'sqlite3*', 'string')
export const sqlite3_uri_boolean = xWrapASM('sqlite3_uri_boolean', 'int', 'sqlite3_filename', 'string', 'int')
export const sqlite3_uri_key = xWrapASM('sqlite3_uri_key', 'string', 'sqlite3_filename', 'int')
export const sqlite3_uri_parameter = xWrapASM('sqlite3_uri_parameter', 'string', 'sqlite3_filename', 'string')
export const sqlite3_user_data = xWrapASM('sqlite3_user_data', 'void*', 'sqlite3_context*')
export const sqlite3_value_blob = xWrapASM('sqlite3_value_blob', '*', 'sqlite3_value*')
export const sqlite3_value_bytes = xWrapASM('sqlite3_value_bytes', 'int', 'sqlite3_value*')
export const sqlite3_value_double = xWrapASM('sqlite3_value_double', 'f64', 'sqlite3_value*')
export const sqlite3_value_dup = xWrapASM('sqlite3_value_dup', 'sqlite3_value*', 'sqlite3_value*')
export const sqlite3_value_free = xWrapASM('sqlite3_value_free', undefined, 'sqlite3_value*')
export const sqlite3_value_frombind = xWrapASM('sqlite3_value_frombind', 'int', 'sqlite3_value*')
export const sqlite3_value_int = xWrapASM('sqlite3_value_int', 'int', 'sqlite3_value*')
export const sqlite3_value_int64 = xWrapASM('sqlite3_value_int64', 'i64', 'sqlite3_value*')
export const sqlite3_value_nochange = xWrapASM('sqlite3_value_nochange', 'int', 'sqlite3_value*')
export const sqlite3_value_numeric_type = xWrapASM('sqlite3_value_numeric_type', 'int', 'sqlite3_value*')
export const sqlite3_value_pointer = xWrapASM('sqlite3_value_pointer', '*', 'sqlite3_value*', 'string:static')
export const sqlite3_value_subtype = xWrapASM('sqlite3_value_subtype', 'int', 'sqlite3_value*')
export const sqlite3_value_text = xWrapASM('sqlite3_value_text', 'string', 'sqlite3_value*')
export const sqlite3_value_type = xWrapASM('sqlite3_value_type', 'int', 'sqlite3_value*')
export const sqlite3_vfs_find = xWrapASM('sqlite3_vfs_find', '*', 'string')
export const sqlite3_vfs_register = xWrapASM('sqlite3_vfs_register', 'int', 'sqlite3_vfs*', 'int')
export const sqlite3_vfs_unregister = xWrapASM('sqlite3_vfs_unregister', 'int', 'sqlite3_vfs*')


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


export { sqlite3_js_rc_str }