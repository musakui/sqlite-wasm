import { ptrSizeof, SQLITE } from './constants.js'
import { C_API, getASM } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import * as pstack from './pstack.js' 
import { DB, Stmt } from './oo2.js'
import { bigIntFitsDouble } from './util.js'

/** @typedef {import('./types').StmtPointer} StmtPointer */

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

const oflags = SQLITE.OPEN_CREATE | SQLITE.OPEN_READWRITE | SQLITE.OPEN_EXRESCODE

export const openDb = (fn, vfs) => {
	let pDb
	const asm = getASM()
	const stack = pstack.getPtr()
	try {
		const fnPtr = heap.allocCString(fn)
		const pPtr = pstack.allocPtr()
		const rc = asm.sqlite3_open_v2(fnPtr, pPtr, oflags, vfs)
		pDb = heap.peekPtr(pPtr)
		asm.sqlite3_extended_result_codes(pDb, 1)
	} catch (e) {
		if (pDb) asm.sqlite3_close_v2_raw(pDb)
		throw e
	} finally {
		pstack.restore(stack)
	}
	try {
		const pVfs = asm.sqlite3_wasm_db_vfs(pDb, 0)
	} catch (e) {
		// close
		throw e
	}
}