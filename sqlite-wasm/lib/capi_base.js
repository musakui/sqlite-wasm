import { xWrapASM } from './binding.js'

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

export const sqlite3_aggregate_context = xWrapASM('sqlite3_aggregate_context', 'void*', CONTEXT, INT)
export const sqlite3_bind_double = xWrapASM('sqlite3_bind_double', INT, STMT, INT, F64)
export const sqlite3_bind_int = xWrapASM('sqlite3_bind_int', INT, STMT, INT, INT)
export const sqlite3_bind_int64 = xWrapASM('sqlite3_bind_int64', INT, STMT, INT, I64)
export const sqlite3_bind_null = xWrapASM('sqlite3_bind_null', UDF, STMT, INT)
export const sqlite3_bind_parameter_count = xWrapASM('sqlite3_bind_parameter_count', INT, STMT)
export const sqlite3_bind_parameter_index = xWrapASM('sqlite3_bind_parameter_index', INT, STMT, STRING)
export const sqlite3_bind_pointer = xWrapASM('sqlite3_bind_pointer', INT, STMT, INT, PTR, STATIC, PTR)

export const sqlite3_busy_timeout = xWrapASM('sqlite3_busy_timeout', INT, DB, INT)
export const sqlite3_changes = xWrapASM('sqlite3_changes', INT, DB)
export const sqlite3_clear_bindings = xWrapASM('sqlite3_clear_bindings', INT, STMT)
export const sqlite3_collation_needed = xWrapASM('sqlite3_collation_needed', INT, DB, PTR, PTR)
export const sqlite3_column_blob = xWrapASM('sqlite3_column_blob', PTR, STMT, INT)
export const sqlite3_column_bytes = xWrapASM('sqlite3_column_bytes', INT, STMT, INT)
export const sqlite3_column_count = xWrapASM('sqlite3_column_count', INT, STMT)
export const sqlite3_column_double = xWrapASM('sqlite3_column_double', F64, STMT, INT)
export const sqlite3_column_int = xWrapASM('sqlite3_column_int', INT, STMT, INT)
export const sqlite3_column_int64 = xWrapASM('sqlite3_column_int64', I64, STMT, INT)
export const sqlite3_column_name = xWrapASM('sqlite3_column_name', STRING, STMT, INT)
export const sqlite3_column_text = xWrapASM('sqlite3_column_text', STRING, STMT, INT)
export const sqlite3_column_type = xWrapASM('sqlite3_column_type', INT, STMT, INT)
export const sqlite3_column_value = xWrapASM('sqlite3_column_value', VALUE, STMT, INT)

export const sqlite3_compileoption_get = xWrapASM('sqlite3_compileoption_get', STRING, INT)
export const sqlite3_compileoption_used = xWrapASM('sqlite3_compileoption_used', INT, STRING)
export const sqlite3_complete = xWrapASM('sqlite3_complete', INT, SFLEXI)
export const sqlite3_context_db_handle = xWrapASM('sqlite3_context_db_handle', DB, CONTEXT)
export const sqlite3_data_count = xWrapASM('sqlite3_data_count', INT, STMT)
export const sqlite3_db_filename = xWrapASM('sqlite3_db_filename', STRING, DB, STRING)
export const sqlite3_db_handle = xWrapASM('sqlite3_db_handle', DB, STMT)
export const sqlite3_db_name = xWrapASM('sqlite3_db_name', STRING, DB, INT)
export const sqlite3_db_status = xWrapASM('sqlite3_db_status', INT, DB, INT, PTR, PTR, INT)
export const sqlite3_errcode = xWrapASM('sqlite3_errcode', INT, DB)
export const sqlite3_errmsg = xWrapASM('sqlite3_errmsg', STRING, DB)
export const sqlite3_error_offset = xWrapASM('sqlite3_error_offset', INT, DB)
export const sqlite3_errstr = xWrapASM('sqlite3_errstr', STRING, INT)
export const sqlite3_expanded_sql = xWrapASM('sqlite3_expanded_sql', STRING, STMT)
export const sqlite3_extended_errcode = xWrapASM('sqlite3_extended_errcode', INT, DB)
export const sqlite3_extended_result_codes = xWrapASM('sqlite3_extended_result_codes', INT, DB, INT)

export const sqlite3_file_control = xWrapASM('sqlite3_file_control', INT, DB, STRING, INT, PTR)
export const sqlite3_finalize = xWrapASM('sqlite3_finalize', INT, STMT)
export const sqlite3_get_auxdata = xWrapASM('sqlite3_get_auxdata', PTR, CONTEXT, INT)
export const sqlite3_initialize = xWrapASM('sqlite3_initialize', UDF)
export const sqlite3_keyword_check = xWrapASM('sqlite3_keyword_check', INT, STRING, INT)
export const sqlite3_keyword_count = xWrapASM('sqlite3_keyword_count', INT)
export const sqlite3_keyword_name = xWrapASM('sqlite3_keyword_name', INT, INT, PPTR, PTR)
export const sqlite3_libversion = xWrapASM('sqlite3_libversion', STRING)
export const sqlite3_libversion_number = xWrapASM('sqlite3_libversion_number', INT)
export const sqlite3_limit = xWrapASM('sqlite3_limit', INT, DB, INT, INT)
export const sqlite3_malloc = xWrapASM('sqlite3_malloc', PTR, INT)
export const sqlite3_open = xWrapASM('sqlite3_open', INT, STRING, PTR)
export const sqlite3_open_v2 = xWrapASM('sqlite3_open_v2', INT, STRING, PTR, INT, STRING)

export const sqlite3_reset = xWrapASM('sqlite3_reset', INT, STMT)
export const sqlite3_result_blob = xWrapASM('sqlite3_result_blob', UDF, CONTEXT, PTR, INT, PTR)
export const sqlite3_result_double = xWrapASM('sqlite3_result_double', UDF, CONTEXT, F64)
export const sqlite3_result_error = xWrapASM('sqlite3_result_error', UDF, CONTEXT, STRING, INT)
export const sqlite3_result_error_code = xWrapASM('sqlite3_result_error_code', UDF, CONTEXT, INT)
export const sqlite3_result_error_nomem = xWrapASM('sqlite3_result_error_nomem', UDF, CONTEXT)
export const sqlite3_result_error_toobig = xWrapASM('sqlite3_result_error_toobig', UDF, CONTEXT)
export const sqlite3_result_int = xWrapASM('sqlite3_result_int', UDF, CONTEXT, INT)
export const sqlite3_result_int64 = xWrapASM('sqlite3_result_int64', UDF, PTR, I64)
export const sqlite3_result_null = xWrapASM('sqlite3_result_null', UDF, CONTEXT)
export const sqlite3_result_pointer = xWrapASM('sqlite3_result_pointer', UDF, CONTEXT, PTR, STATIC, PTR)
export const sqlite3_result_subtype = xWrapASM('sqlite3_result_subtype', UDF, VALUE, INT)
export const sqlite3_result_text = xWrapASM('sqlite3_result_text', UDF, CONTEXT, STRING, INT, PTR)
export const sqlite3_result_zeroblob64 = xWrapASM('sqlite3_result_zeroblob64', INT, PTR, I64)

export const sqlite3_serialize = xWrapASM('sqlite3_serialize', PTR, DB, STRING, PTR, INT)
export const sqlite3_shutdown = xWrapASM('sqlite3_shutdown', UDF)
export const sqlite3_sourceid = xWrapASM('sqlite3_sourceid', STRING)
export const sqlite3_sql = xWrapASM('sqlite3_sql', STRING, STMT)
export const sqlite3_status = xWrapASM('sqlite3_status', INT, INT, PTR, PTR, INT)
export const sqlite3_step = xWrapASM('sqlite3_step', INT, STMT)
export const sqlite3_stmt_isexplain = xWrapASM('sqlite3_stmt_isexplain', INT, STMT)
export const sqlite3_stmt_readonly = xWrapASM('sqlite3_stmt_readonly', INT, STMT)
export const sqlite3_stmt_status = xWrapASM('sqlite3_stmt_status', INT, STMT, INT, INT)
export const sqlite3_strglob = xWrapASM('sqlite3_strglob', INT, STRING, STRING)
export const sqlite3_stricmp = xWrapASM('sqlite3_stricmp', INT, STRING, STRING)
export const sqlite3_strlike = xWrapASM('sqlite3_strlike', INT, STRING, STRING, INT)
export const sqlite3_strnicmp = xWrapASM('sqlite3_strnicmp', INT, STRING, STRING, INT)

// prettier-ignore
export const sqlite3_table_column_metadata = xWrapASM('sqlite3_table_column_metadata', INT, DB, STRING, STRING, STRING, PPTR, PPTR, PTR, PTR, PTR)

export const sqlite3_total_changes = xWrapASM('sqlite3_total_changes', INT, DB)
export const sqlite3_total_changes64 = xWrapASM('sqlite3_total_changes64', I64, DB)
export const sqlite3_txn_state = xWrapASM('sqlite3_txn_state', INT, DB, STRING)
export const sqlite3_uri_boolean = xWrapASM('sqlite3_uri_boolean', INT, FILENAME, STRING, INT)
export const sqlite3_uri_key = xWrapASM('sqlite3_uri_key', STRING, FILENAME, INT)
export const sqlite3_uri_parameter = xWrapASM('sqlite3_uri_parameter', STRING, FILENAME, STRING)
export const sqlite3_user_data = xWrapASM('sqlite3_user_data', 'void*', CONTEXT)
export const sqlite3_value_blob = xWrapASM('sqlite3_value_blob', PTR, VALUE)
export const sqlite3_value_bytes = xWrapASM('sqlite3_value_bytes', INT, VALUE)
export const sqlite3_value_double = xWrapASM('sqlite3_value_double', F64, VALUE)
export const sqlite3_value_dup = xWrapASM('sqlite3_value_dup', VALUE, VALUE)
export const sqlite3_value_free = xWrapASM('sqlite3_value_free', UDF, VALUE)
export const sqlite3_value_frombind = xWrapASM('sqlite3_value_frombind', INT, VALUE)
export const sqlite3_value_int = xWrapASM('sqlite3_value_int', INT, VALUE)
export const sqlite3_value_int64 = xWrapASM('sqlite3_value_int64', I64, VALUE)
export const sqlite3_value_nochange = xWrapASM('sqlite3_value_nochange', INT, VALUE)
export const sqlite3_value_numeric_type = xWrapASM('sqlite3_value_numeric_type', INT, VALUE)
export const sqlite3_value_pointer = xWrapASM('sqlite3_value_pointer', PTR, VALUE, STATIC)
export const sqlite3_value_subtype = xWrapASM('sqlite3_value_subtype', INT, VALUE)
export const sqlite3_value_text = xWrapASM('sqlite3_value_text', STRING, VALUE)
export const sqlite3_value_type = xWrapASM('sqlite3_value_type', INT, VALUE)
export const sqlite3_vfs_find = xWrapASM('sqlite3_vfs_find', PTR, STRING)
export const sqlite3_vfs_register = xWrapASM('sqlite3_vfs_register', INT, VFS, INT)
export const sqlite3_vfs_unregister = xWrapASM('sqlite3_vfs_unregister', INT, VFS)
