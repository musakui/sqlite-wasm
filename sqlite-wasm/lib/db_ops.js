import { ptrSizeof, SQLITE } from './constants.js'
import { getASM, sqliteError } from './base.js'
import * as heap from './heap.js'
import * as pstack from './pstack.js'
import { bigIntFitsDouble, isTypedArray } from './util.js'

/** @typedef {import('./types').StmtPointer} StmtPointer */

/** @typedef {import('./types').SqliteDatatype} SqliteDatatype */

const STRING = 'string'
const BOOLEAN = 'boolean'
const BIGINT = 'bigint'

/**
 * @param {unknown} val
 * @param {string} tp
 */
const getBindType = (val, tp) => {
	if (!tp) {
		tp = typeof val
	}
	switch (tp) {
		case STRING:
			return SQLITE.TEXT
		case BIGINT:
		case BOOLEAN:
			return SQLITE.INTEGER
		case 'number':
			return val % 1 ? SQLITE.FLOAT : SQLITE.INTEGER
		default:
			if (val === null || val === undefined) return SQLITE.NULL
			if (val instanceof ArrayBuffer || isTypedArray(val)) return SQLITE.BLOB
	}
	return null
}

/**
 * @template T
 * @template {keyof SqliteDatatype} AsT
 * @param {StmtPtr} pSt
 * @param {number} idx
 * @param {AsT} [asType]
 * @return {AsT extends undefined ? T : SqliteDatatype[AsT]}
 */
const column_result = (pSt, idx, asType) => {
	const asm = getASM()
	switch (asType ?? asm.sqlite3_column_type(pSt, idx)) {
		case SQLITE.NULL:
			return null
		case SQLITE.INTEGER:
			const num = asm.sqlite3_column_int64(pSt, idx)
			return bigIntFitsDouble(num) ? Number(num) : num
		case SQLITE.FLOAT:
			return asm.sqlite3_column_double(pSt, idx)
		case SQLITE.TEXT:
			return heap.cstrToJs(asm.sqlite3_column_text(pSt, idx))
		case SQLITE.BLOB:
			const n = asm.sqlite3_column_bytes(pSt, idx)
			if (!n) return new Uint8Array(0)
			const ptr = asm.sqlite3_column_blob(pSt, idx)
			return new Uint8Array(heap.heap8u().slice(ptr, ptr + n))
		default:
			return sqliteError(`unknown column type at col #${idx}`)
	}
}

/**
 * @param {StmtPtr} pSt
 * @param {number} idx
 * @param {unknown} val
 */
const bind_parameter = (pSt, idx, val, asType) => {
	const asm = getASM()
	const tp = typeof val
	switch (asType ?? getBindType(val)) {
		case SQLITE.INTEGER:
			if (tp === BOOLEAN) {
				return asm.sqlite3_bind_int(pSt, idx, val ? 1 : 0)
			}
			const m = `sqlite3_bind_int${tp === BIGINT ? '64' : ''}`
			return asm[m](pSt, idx, val)
		case SQLITE.FLOAT:
			return asm.sqlite3_bind_double(pSt, idx, val)
		case SQLITE.TEXT:
			const [pStr, n] = heap.allocCStringWithLength(val)
			return asm.sqlite3_bind_text(pSt, idx, pStr, n, SQLITE.WASM_DEALLOC)
		case SQLITE.NULL:
			return asm.sqlite3_bind_null(pSt, idx)
		case SQLITE.BLOB:
			/** @type {number} */
			let len
			/** @type {number} */
			let pBlob
			if (val instanceof ArrayBuffer) {
				val = new Uint8Array(val)
			}
			if (tp === STRING) {
				;[pBlob, len] = heap.allocCStringWithLength(val)
			} else if (val.byteLength) {
				len = val.byteLength
				pBlob = heap.alloc(len)
				heap.heap8().set(val, pBlob)
			}
			return asm.sqlite3_bind_blob(pSt, idx, pBlob, len, SQLITE.WASM_DEALLOC)
	}
}

/**
 * @param {number} pDb
 * @param {string} sql
 */
export const db_exec = (pDb, sql) => {
	const asm = getASM()
	const stack = heap.scopedAllocPush()
	try {
		const sqlByteLen = heap.jstrlen(sql)
		const pSql = heap.scopedAlloc(2 * ptrSizeof + (sqlByteLen + 1)) + ptrSizeof + ptrSizeof
		heap.jstrcpy(sql, heap.heap8(), pSql, sqlByteLen, false)
		heap.poke(pSql + sqlByteLen, 0)

		const rc = asm.sqlite3_exec(pDb, pSql, 0, 0, 0)
		if (rc) sqliteError(rc, 'exec error')
	} finally {
		heap.scopedAllocPop(stack)
	}
}

/**
 * @template {T}
 * @param {number} pDb
 * @param {string} sql
 * @param {unknown[]} bind
 */
export const db_exec_stmt = (pDb, sql, bind = [], asObject = false) => {
	const asm = getASM()
	const stack = heap.scopedAllocPush()
	try {
		let sqlByteLen = heap.jstrlen(sql)
		const ppStmt = heap.scopedAlloc(2 * ptrSizeof + (sqlByteLen + 1))
		const pzTail = ppStmt + ptrSizeof
		let pSql = pzTail + ptrSizeof
		const pSqlEnd = pSql + sqlByteLen

		heap.jstrcpy(sql, heap.heap8(), pSql, sqlByteLen, false)
		heap.poke(pSql + sqlByteLen, 0)

		/** @type {T[]} */
		const resultRows = []

		while (pSql && heap.peek8(pSql)) {
			heap.pokePtr([ppStmt, pzTail], 0)
			const prc = asm.sqlite3_prepare_v2(pDb, pSql, sqlByteLen, ppStmt, pzTail)
			if (prc) sqliteError(prc, 'exec error')
			const pStmt = heap.peekPtr(ppStmt)
			pSql = heap.peekPtr(pzTail)
			sqlByteLen = pSqlEnd - pSql
			if (!pStmt) continue
			/** @type {number} */
			const paramCount = asm.sqlite3_bind_parameter_count(pStmt)
			if (bind?.length && paramCount) {
				for (let i = 0; i < bind.length; ++i) {
					const brc = bind_parameter(pStmt, i + 1, bind[i])
					if (brc) sqliteError(brc, 'bind error')
				}
			}
			const nCols = asm.sqlite3_column_count(pStmt)
			const cols = Array.from({ length: nCols }, (_, i) => {
				return asObject ? asm.sqlite3_column_name(pStmt, i) : i
			})
			let rc = 0
			while (rc !== SQLITE.DONE) {
				rc = asm.sqlite3_step(pStmt)
				if (rc === SQLITE.ROW) {
					console.log(cols.map((i) => column_result(pStmt, i)))
				} else if (rc !== SQLITE.DONE) {
					sqliteError(rc, 'step error')
				}
			}
			const frc = asm.sqlite3_finalize(pStmt)
			if (frc) sqliteError(frc, 'finalize error')
		}
		return resultRows
	} finally {
		heap.scopedAllocPop(stack)
	}
}

export const openDb = (fn, flags = 0, pVfs = null) => {
	/** @type {number} */
	let pDb
	const asm = getASM()
	const oflags = flags || SQLITE.OPEN_READONLY
	const scope = heap.scopedAllocPush()
	const stack = pstack.getPtr()
	try {
		const fnPtr = heap.scopedAllocCString(fn)
		const pPtr = pstack.allocPtr()
		const rc = asm.sqlite3_open_v2(fnPtr, pPtr, oflags, pVfs)
		if (rc) return sqliteError(rc)
		pDb = heap.peekPtr(pPtr)
		asm.sqlite3_extended_result_codes(pDb, 1)
	} catch (e) {
		if (pDb) asm.sqlite3_close_v2_raw(pDb)
		throw e
	} finally {
		pstack.restore(stack)
		heap.scopedAllocPop(scope)
	}
	return pDb
}

/** @param {number} pDb */
export const closeDb = (pDb) => {
	getASM().sqlite3_close_v2(pDb)
}
