#!/bin/bash

EMSDK_QUIET=1 source /emsdk/emsdk_env.sh

rm -f jswasm/build/*

BUILD_FLAGS=(
	-DSQLITE_OMIT_UTF16
	-DSQLITE_THREADSAFE=0
	-DSQLITE_TEMP_STORE=2
	-DSQLITE_OMIT_DEPRECATED
	-DSQLITE_OMIT_SHARED_CACHE
	-DSQLITE_OMIT_LOAD_EXTENSION
	-DSQLITE_OMIT_DECLTYPE
	-DSQLITE_OMIT_AUTOINIT
	-DSQLITE_MAX_EXPR_DEPTH=0
	-DSQLITE_DEFAULT_MEMSTATUS=0
	-DSQLITE_OMIT_PROGRESS_CALLBACK
	-DSQLITE_LIKE_DOESNT_MATCH_BLOBS
	-DSQLITE_ENABLE_FTS5
	#-DSQLITE_ENABLE_RTREE
	#-DSQLITE_ENABLE_STMTVTAB
	#-DSQLITE_ENABLE_DBPAGE_VTAB
	#-DSQLITE_ENABLE_DBSTAT_VTAB
	#-DSQLITE_ENABLE_BYTECODE_VTAB
	#-DSQLITE_ENABLE_OFFSET_SQL_FUNC
	#-DSQLITE_ENABLE_EXPLAIN_COMMENTS
	#-DSQLITE_ENABLE_UNKNOWN_SQL_FUNCTION
	#-DSQLITE_WASM_ENABLE_C_TESTS
)

EXPORTED_FUNCTIONS=(
	sqlite3_initialize
	sqlite3_errcode
	sqlite3_free
	sqlite3_malloc sqlite3_malloc64
	sqlite3_realloc sqlite3_realloc64
	sqlite3_open_v2 sqlite3_close_v2 sqlite3_exec
	sqlite3_prepare_v3 sqlite3_step sqlite3_reset sqlite3_finalize
	sqlite3_bind_int sqlite3_bind_int64 sqlite3_bind_double sqlite3_bind_blob
	sqlite3_bind_null sqlite3_bind_parameter_count sqlite3_bind_parameter_index
	sqlite3_column_text sqlite3_column_int sqlite3_column_int64
	sqlite3_column_blob sqlite3_column_bytes sqlite3_column_double
	sqlite3_column_type sqlite3_column_value sqlite3_column_count sqlite3_column_name
	sqlite3_libversion sqlite3_libversion_number sqlite3_sourceid
	sqlite3_vfs_find sqlite3_vfs_register sqlite3_vfs_unregister
)

printf "_%s\n" "${EXPORTED_FUNCTIONS[@]}" > jswasm/build/EXPORTED_FUNCTIONS.txt

emcc -o jswasm/build/sqlite3.mjs -v -Oz -g3 --minify=0 \
	--no-entry --cache jswasm/.cache \
	-sEXPORTED_FUNCTIONS=@jswasm/build/EXPORTED_FUNCTIONS.txt \
	-sIMPORTED_MEMORY -sALLOW_MEMORY_GROWTH -sALLOW_TABLE_GROWTH \
	-sENVIRONMENT=web -sWASM_BIGINT -sGLOBAL_BASE=4096 -sSTACK_SIZE=512KB \
	-sERROR_ON_UNDEFINED_SYMBOLS -sLLD_REPORT_UNDEFINED \
	-Wno-limited-postlink-optimizations -I. -I../../ \
	${BUILD_FLAGS[@]} -DSQLITE_C=../../sqlite3.c api/sqlite3-wasm.c

rm jswasm/build/EXPORTED_FUNCTIONS.txt

outfile="jswasm/build/sqlite3.wasm"
[ -f $outfile ] || exit
echo "before strip: $(stat --printf='%8s' ${outfile}) bytes"
wasm-strip ${outfile}
echo " after strip: $(stat --printf='%8s' ${outfile}) bytes"
