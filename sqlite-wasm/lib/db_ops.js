import { ptrSizeof, SQLITE } from './constants.js'
import { getASM, sqliteError } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import * as pstack from './pstack.js' 
import { bigIntFitsDouble } from './util.js'

/** @typedef {import('./types').StmtPointer} StmtPointer */

/**
 * @param {StmtPtr} pSt
 * @param {number} idx
 * @param {number} [asType]
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
			return capi.sqlite3_column_text(pSt, idx)
		case SQLITE.BLOB:
			const n = capi.sqlite3_column_bytes(pSt, idx)
			const ptr = capi.sqlite3_column_blob(pSt, idx)
			const arr = new Uint8Array(n)
			if (n) arr.set(heap.heap8u().slice(ptr, ptr + n), 0)
			return arr
		default:
			sqliteError(`unknown column type at col #${idx}`)
	}
}

/**
 * @param {StmtPointer} pSt
 * @param {number} nCols
 */
const getRowAsArray = (pSt, nCols) => {
	return Array.from({ length: nCols }, (_, i) => column_result(pSt, i))
}

/**
 * @param {StmtPointer} pSt
 * @param {number} nCols
 */
const getRowAsObject = (pSt, nCols) => {
	const arr = Array.from({ length: nCols }, (_, i) => {
		return /** @type {const} */ ([
			//
			capi.sqlite3_column_name(pSt, i),
			column_result(pSt, i),
		])
	})
	return Object.fromEntries(arr)
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
 * @param {(p: import('./oo2').StmtPointer, d: import('./oo2').DBPointer) => T} cb
 */
export const db_exec_stmt = (pDb, sql, bind = [], cb = undefined) => {
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
			if (bind.length && paramCount) {
				// bind stmt
			}
			const nCols = asm.sqlite3_column_count(pStmt)
			let rc = 0
			while (rc !== SQLITE.DONE) {
				rc = asm.sqlite3_step(pStmt)
				if (rc === SQLITE.ROW) {
					console.log('got row', getRowAsArray(pStmt, nCols))
				} else if (rc !== SQLITE.DONE) {
					sqliteError(rc, 'step error')
				}
			}
			//const rrc = asm.sqlite3_reset(pStmt)
			//if (rrc) sqliteError(rrc, 'reset error')
			const frc = asm.sqlite3_finalize(pStmt)
			if (frc) sqliteError(frc, 'finalize error')
		}
		return resultRows
	} finally {
		heap.scopedAllocPop(stack)
	}
}

export const openDb = (fn, flags = 0, pVfs = null) => {
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
		heap.scopedAllocPop(scope)
		pstack.restore(stack)
	}
	return pDb
}

/** @param {number} pDb */
export const closeDb = (pDb) => getASM().sqlite3_close_v2(pDb)