import { C_API } from './base.js'
import * as heap from './heap.js'
import { FuncPtrAdapter, __wrapASM } from './binding.js'

const UDF = undefined

const PTR = '*'
const PPTR = '**'

const INT = 'int'
const I64 = 'i64'
const F64 = 'f64'

const STRING = 'string'
const STATIC = 'string:static'
const SFLEXI = 'string:flexible'

const DB = 'sqlite3*'
const VFS = 'sqlite3_vfs*'
const STMT = 'sqlite3_stmt*'
const VALUE = 'sqlite3_value*'
const CONTEXT = 'sqlite3_context*'

const FILENAME = 'sqlite3_filename'

export const sqlite3_aggregate_context = __wrapASM('sqlite3_aggregate_context', 'void*', CONTEXT, INT)
export const sqlite3_bind_double = __wrapASM('sqlite3_bind_double', INT, STMT, INT, F64)
export const sqlite3_bind_int = __wrapASM('sqlite3_bind_int', INT, STMT, INT, INT)
export const sqlite3_bind_int64 = __wrapASM('sqlite3_bind_int64', INT, STMT, INT, I64)
export const sqlite3_bind_null = __wrapASM('sqlite3_bind_null', UDF, STMT, INT)
export const sqlite3_bind_parameter_count = __wrapASM('sqlite3_bind_parameter_count', INT, STMT)
export const sqlite3_bind_parameter_index = __wrapASM('sqlite3_bind_parameter_index', INT, STMT, STRING)
export const sqlite3_bind_pointer = __wrapASM('sqlite3_bind_pointer', INT, STMT, INT, PTR, STATIC, PTR)

export const sqlite3_bind_blob_raw = __wrapASM('sqlite3_bind_blob', INT, STMT, INT, PTR, INT, PTR)
export const sqlite3_bind_text_raw = __wrapASM('sqlite3_bind_text', INT, STMT, INT, STRING, INT, PTR)

export const sqlite3_busy_timeout = __wrapASM('sqlite3_busy_timeout', INT, DB, INT)
export const sqlite3_changes = __wrapASM('sqlite3_changes', INT, DB)
export const sqlite3_clear_bindings = __wrapASM('sqlite3_clear_bindings', INT, STMT)
export const sqlite3_collation_needed = __wrapASM('sqlite3_collation_needed', INT, DB, PTR, PTR)
export const sqlite3_column_blob = __wrapASM('sqlite3_column_blob', PTR, STMT, INT)
export const sqlite3_column_bytes = __wrapASM('sqlite3_column_bytes', INT, STMT, INT)
export const sqlite3_column_count = __wrapASM('sqlite3_column_count', INT, STMT)
export const sqlite3_column_double = __wrapASM('sqlite3_column_double', F64, STMT, INT)
export const sqlite3_column_int = __wrapASM('sqlite3_column_int', INT, STMT, INT)
export const sqlite3_column_int64 = __wrapASM('sqlite3_column_int64', I64, STMT, INT)
export const sqlite3_column_name = __wrapASM('sqlite3_column_name', STRING, STMT, INT)
export const sqlite3_column_text = __wrapASM('sqlite3_column_text', STRING, STMT, INT)
export const sqlite3_column_type = __wrapASM('sqlite3_column_type', INT, STMT, INT)
export const sqlite3_column_value = __wrapASM('sqlite3_column_value', VALUE, STMT, INT)

export const sqlite3_compileoption_get = __wrapASM('sqlite3_compileoption_get', STRING, INT)
export const sqlite3_compileoption_used = __wrapASM('sqlite3_compileoption_used', INT, STRING)
export const sqlite3_complete = __wrapASM('sqlite3_complete', INT, SFLEXI)
export const sqlite3_context_db_handle = __wrapASM('sqlite3_context_db_handle', DB, CONTEXT)
export const sqlite3_data_count = __wrapASM('sqlite3_data_count', INT, STMT)
export const sqlite3_db_filename = __wrapASM('sqlite3_db_filename', STRING, DB, STRING)
export const sqlite3_db_handle = __wrapASM('sqlite3_db_handle', DB, STMT)
export const sqlite3_db_name = __wrapASM('sqlite3_db_name', STRING, DB, INT)
export const sqlite3_db_status = __wrapASM('sqlite3_db_status', INT, DB, INT, PTR, PTR, INT)
export const sqlite3_errcode = __wrapASM('sqlite3_errcode', INT, DB)
export const sqlite3_errmsg = __wrapASM('sqlite3_errmsg', STRING, DB)
export const sqlite3_error_offset = __wrapASM('sqlite3_error_offset', INT, DB)
export const sqlite3_errstr = __wrapASM('sqlite3_errstr', STRING, INT)
export const sqlite3_expanded_sql = __wrapASM('sqlite3_expanded_sql', STRING, STMT)
export const sqlite3_extended_errcode = __wrapASM('sqlite3_extended_errcode', INT, DB)
export const sqlite3_extended_result_codes = __wrapASM('sqlite3_extended_result_codes', INT, DB, INT)

const execCallback = new FuncPtrAdapter({
	signature: 'i(pipp)',
	bindScope: 'transient',
	callProxy: (cb) => {
		return (_, nc, cv, cn) => {
			try {
				return cb(heap.cArgvToJs(nc, cv), heap.cArgvToJs(nc, cn)) | 0
			} catch (e) {
				return e.resultCode || C_API.SQLITE_ERROR
			}
		}
	},
})
export const sqlite3_exec = __wrapASM('sqlite3_exec', INT, DB, SFLEXI, execCallback, PTR, PPTR)

export const sqlite3_file_control = __wrapASM('sqlite3_file_control', INT, DB, STRING, INT, PTR)
export const sqlite3_finalize = __wrapASM('sqlite3_finalize', INT, STMT)
export const sqlite3_get_auxdata = __wrapASM('sqlite3_get_auxdata', PTR, CONTEXT, INT)
export const sqlite3_initialize = __wrapASM('sqlite3_initialize', UDF)
export const sqlite3_keyword_check = __wrapASM('sqlite3_keyword_check', INT, STRING, INT)
export const sqlite3_keyword_count = __wrapASM('sqlite3_keyword_count', INT)
export const sqlite3_keyword_name = __wrapASM('sqlite3_keyword_name', INT, INT, PPTR, PTR)
export const sqlite3_libversion = __wrapASM('sqlite3_libversion', STRING)
export const sqlite3_libversion_number = __wrapASM('sqlite3_libversion_number', INT)
export const sqlite3_limit = __wrapASM('sqlite3_limit', INT, DB, INT, INT)
export const sqlite3_malloc = __wrapASM('sqlite3_malloc', PTR, INT)
export const sqlite3_open = __wrapASM('sqlite3_open', INT, STRING, PTR)
export const sqlite3_open_v2 = __wrapASM('sqlite3_open_v2', INT, STRING, PTR, INT, STRING)
export const sqlite3_close_v2_raw = __wrapASM('sqlite3_close_v2', INT, DB)

export const sqlite3_prepare_v3_full = __wrapASM('sqlite3_prepare_v3', INT, DB, PTR, INT, INT, PPTR, PPTR)
export const sqlite3_prepare_v3_basic = __wrapASM('sqlite3_prepare_v3', INT, DB, STRING, INT, INT, PPTR, PPTR)

export const sqlite3_reset = __wrapASM('sqlite3_reset', INT, STMT)
export const sqlite3_result_blob = __wrapASM('sqlite3_result_blob', UDF, CONTEXT, PTR, INT, PTR)
export const sqlite3_result_double = __wrapASM('sqlite3_result_double', UDF, CONTEXT, F64)
export const sqlite3_result_error = __wrapASM('sqlite3_result_error', UDF, CONTEXT, STRING, INT)
export const sqlite3_result_error_code = __wrapASM('sqlite3_result_error_code', UDF, CONTEXT, INT)
export const sqlite3_result_error_nomem = __wrapASM('sqlite3_result_error_nomem', UDF, CONTEXT)
export const sqlite3_result_error_toobig = __wrapASM('sqlite3_result_error_toobig', UDF, CONTEXT)
export const sqlite3_result_int = __wrapASM('sqlite3_result_int', UDF, CONTEXT, INT)
export const sqlite3_result_int64 = __wrapASM('sqlite3_result_int64', UDF, PTR, I64)
export const sqlite3_result_null = __wrapASM('sqlite3_result_null', UDF, CONTEXT)
export const sqlite3_result_pointer = __wrapASM('sqlite3_result_pointer', UDF, CONTEXT, PTR, STATIC, PTR)
export const sqlite3_result_subtype = __wrapASM('sqlite3_result_subtype', UDF, VALUE, INT)
export const sqlite3_result_text = __wrapASM('sqlite3_result_text', UDF, CONTEXT, STRING, INT, PTR)
export const sqlite3_result_zeroblob64 = __wrapASM('sqlite3_result_zeroblob64', INT, PTR, I64)

export const sqlite3_serialize = __wrapASM('sqlite3_serialize', PTR, DB, STRING, PTR, INT)
export const sqlite3_shutdown = __wrapASM('sqlite3_shutdown', UDF)
export const sqlite3_sourceid = __wrapASM('sqlite3_sourceid', STRING)
export const sqlite3_sql = __wrapASM('sqlite3_sql', STRING, STMT)
export const sqlite3_status = __wrapASM('sqlite3_status', INT, INT, PTR, PTR, INT)
export const sqlite3_step = __wrapASM('sqlite3_step', INT, STMT)
export const sqlite3_stmt_isexplain = __wrapASM('sqlite3_stmt_isexplain', INT, STMT)
export const sqlite3_stmt_readonly = __wrapASM('sqlite3_stmt_readonly', INT, STMT)
export const sqlite3_stmt_status = __wrapASM('sqlite3_stmt_status', INT, STMT, INT, INT)
export const sqlite3_strglob = __wrapASM('sqlite3_strglob', INT, STRING, STRING)
export const sqlite3_stricmp = __wrapASM('sqlite3_stricmp', INT, STRING, STRING)
export const sqlite3_strlike = __wrapASM('sqlite3_strlike', INT, STRING, STRING, INT)
export const sqlite3_strnicmp = __wrapASM('sqlite3_strnicmp', INT, STRING, STRING, INT)

// prettier-ignore
export const sqlite3_table_column_metadata = __wrapASM('sqlite3_table_column_metadata', INT, DB, STRING, STRING, STRING, PPTR, PPTR, PTR, PTR, PTR)

export const sqlite3_total_changes = __wrapASM('sqlite3_total_changes', INT, DB)
export const sqlite3_total_changes64 = __wrapASM('sqlite3_total_changes64', I64, DB)
export const sqlite3_txn_state = __wrapASM('sqlite3_txn_state', INT, DB, STRING)
export const sqlite3_uri_boolean = __wrapASM('sqlite3_uri_boolean', INT, FILENAME, STRING, INT)
export const sqlite3_uri_key = __wrapASM('sqlite3_uri_key', STRING, FILENAME, INT)
export const sqlite3_uri_parameter = __wrapASM('sqlite3_uri_parameter', STRING, FILENAME, STRING)
export const sqlite3_user_data = __wrapASM('sqlite3_user_data', 'void*', CONTEXT)
export const sqlite3_value_blob = __wrapASM('sqlite3_value_blob', PTR, VALUE)
export const sqlite3_value_bytes = __wrapASM('sqlite3_value_bytes', INT, VALUE)
export const sqlite3_value_double = __wrapASM('sqlite3_value_double', F64, VALUE)
export const sqlite3_value_dup = __wrapASM('sqlite3_value_dup', VALUE, VALUE)
export const sqlite3_value_free = __wrapASM('sqlite3_value_free', UDF, VALUE)
export const sqlite3_value_frombind = __wrapASM('sqlite3_value_frombind', INT, VALUE)
export const sqlite3_value_int = __wrapASM('sqlite3_value_int', INT, VALUE)
export const sqlite3_value_int64 = __wrapASM('sqlite3_value_int64', I64, VALUE)
export const sqlite3_value_nochange = __wrapASM('sqlite3_value_nochange', INT, VALUE)
export const sqlite3_value_numeric_type = __wrapASM('sqlite3_value_numeric_type', INT, VALUE)
export const sqlite3_value_pointer = __wrapASM('sqlite3_value_pointer', PTR, VALUE, STATIC)
export const sqlite3_value_subtype = __wrapASM('sqlite3_value_subtype', INT, VALUE)
export const sqlite3_value_text = __wrapASM('sqlite3_value_text', STRING, VALUE)
export const sqlite3_value_type = __wrapASM('sqlite3_value_type', INT, VALUE)
export const sqlite3_vfs_find = __wrapASM('sqlite3_vfs_find', PTR, STRING)
export const sqlite3_vfs_register = __wrapASM('sqlite3_vfs_register', INT, VFS, INT)
export const sqlite3_vfs_unregister = __wrapASM('sqlite3_vfs_unregister', INT, VFS)
