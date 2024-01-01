import { ptrSizeof } from './constants.js'
import { C_API } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import { DB, Stmt } from './oo2.js'
import { bigIntFitsDouble } from './util.js'

/** @typedef {import('./types').WasmPointer<'stmt'>} StmtPointer */

/**
 * @param {StmtPtr} pSt
 * @param {number} idx
 * @param {number} [asType]
 */
const column_result = (pSt, idx, asType) => {
	switch (asType ?? capi.sqlite3_column_type(pSt, idx)) {
		case C_API.SQLITE_NULL:
			return null
		case C_API.SQLITE_INTEGER:
			const num = capi.sqlite3_column_int64(pSt, idx)
			return bigIntFitsDouble(num) ? Number(num) : num
		case C_API.SQLITE_FLOAT:
			return capi.sqlite3_column_double(pSt, idx)
		case C_API.SQLITE_TEXT:
			return capi.sqlite3_column_text(pSt, idx)
		case C_API.SQLITE_BLOB:
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
 */
const getRowAsArray = (pSt) => {
	const length = capi.sqlite3_column_count(pSt)
	return Array.from({ length }, (_, i) => column_result(pSt, i))
}

/**
 * @param {StmtPointer} pSt
 */
const getRowAsObject = (pSt) => {
	const length = capi.sqlite3_column_count(pSt)
	const arr = Array.from({ length }, (_, i) => {
		return /** @type {const} */ ([
			//
			capi.sqlite3_column_name(pSt, i),
			column_result(pSt, i),
		])
	})
	return Object.fromEntries(arr)
}

/**
 * @template {T}
 * @param {DB} db
 * @param {string} sql
 * @param {unknown[]} bind
 * @param {(p: import('./oo2').StmtPointer, d: import('./oo2').DBPointer) => T} cb
 */
export const db_exec_str = (db, sql, bind = [], cb = undefined) => {
	/** @type {Stmt} */
	let stmt
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

		while (pSql && heap.peek(pSql, 'i8')) {
			heap.pokePtr([ppStmt, pzTail], 0)
			const prc = capi.sqlite3_prepare_v3_full(db.pointer, pSql, sqlByteLen, 0, ppStmt, pzTail)
			checkRc(prc, db.pointer)
			const pStmt = heap.peekPtr(ppStmt)
			pSql = heap.peekPtr(pzTail)
			sqlByteLen = pSqlEnd - pSql
			if (!pStmt) continue
			stmt = new Stmt(db, pStmt)
			if (bind.length && stmt.parameterCount) {
				// bind stmt
			}
			if (cb && capi.sqlite3_column_count(pStmt)) {
				resultRows.push(...stmt.runSteps(cb))
				cb = null
			} else {
				stmt.step()
			}
			stmt.reset().finalize()
		}
		return resultRows
	} finally {
		heap.scopedAllocPop(stack)
		if (stmt) {
			stmt.unlock()
			stmt.finalize()
		}
	}
}
