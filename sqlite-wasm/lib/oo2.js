import { C_API, sqliteError } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import * as pstack from './pstack.js'
import { sqlite3_wasm_db_vfs } from './wasm.js'

/** @typedef {import('./types').DBPointer} DBPointer */
/** @typedef {import('./types').StmtPointer} StmtPointer */

/** @type {WeakMap<DB | Stmt, DBPointer | StmtPointer>} */
const __ptrMap = new WeakMap()

/** @type {WeakMap<DB, Map<StmtPointer, Stmt>>} */
const __stmtMap = new WeakMap()

/**
 * @param {number} rc
 * @param {DBPointer} pDb
 */
const checkRc = (rc, pDb) => {
	if (!rc) return rc
	sqliteError(rc, `db err: ${pDb ? capi.sqlite3_errmsg(pDb) : capi.sqlite3_errstr(rc)}`)
}

/** @param {DB} db */
const affirmDbOpen = (db) => db.pointer ?? sqliteError(`db closed`)

/** @param {Stmt} st */
const affirmStmtOpen = (st) => st.pointer ?? sqliteError(`stmt closed`)

/** @param {Stmt} s */
const affirmNotLocked = (s, op = 'op') => {
	if (s.locked) return sqliteError(`${op} is illegal when stmt is locked`)
	return affirmStmtOpen(s)
}

export class BaseDB {
	/** @return {DBPointer} */
	get pointer() {
		return __ptrMap.get(this)
	}
}

export class DB extends BaseDB {
	constructor(flags = 0, vfs = null) {
		/** @type {DBPointer} */
		let pDb

		const oflags = flags || C_API.SQLITE_OPEN_READONLY
		const stack = pstack.getPtr()
		try {
			const pPtr = pstack.allocPtr()
			let rc = capi.sqlite3_open_v2(fn, pPtr, oflags, vfs || 0)
			pDb = heap.peekPtr(pPtr)
			checkRc(rc, pDb)
			capi.sqlite3_extended_result_codes(pDb, 1)
		} catch (e) {
			if (pDb) capi.sqlite3_close_v2_raw(pDb)
			throw e
		} finally {
			pstack.restore(stack)
		}
		try {
			const pVfs = sqlite3_wasm_db_vfs(pDb, 0)
			if (!pVfs) sqliteError('cannot get VFS for new db')
		} catch (e) {
			this.close()
			throw e
		}
		__ptrMap.set(this, pDb)
		__stmtMap.set(this, new Map())
	}

	close() {
		const pDb = this.pointer
		if (!pDb) return
		for (const s of __stmtMap.get(this).values()) {
			if (!s?.pointer) continue
			try {
				s.finalize()
			} catch (err) {}
		}
		__ptrMap.delete(this)
		__stmtMap.delete(this)
		capi.sqlite3_close_v2_raw(pDb)
	}
}

export class Stmt {
	/** @type {DB} */
	#db

	#mayGet = false

	#locked = false

	/**
	 * @param {DB} db
	 * @param {StmtPointer} pSt
	 */
	constructor(db, pSt) {
		this.#db = db
		__ptrMap.set(this, pSt)
		__stmtMap.get(db)?.set(pSt, this)
	}

	/** @return {StmtPointer} */
	get pointer() {
		return __ptrMap.get(this)
	}

	get locked() {
		return this.#locked
	}

	get mayGet() {
		return this.#mayGet
	}

	/**
	 * @template T
	 * @param {(pSt: StmtPointer, pDb: DBPointer) => T} cb
	 */
	*runSteps(cb) {
		const pSt = affirmNotLocked(this, 'runSteps')
		while (this.step()) {
			this.#locked = true
			yield cb(pSt, this.#db.pointer)
			this.#locked = false
		}
		this.#locked = false
	}

	step() {
		const pSt = affirmNotLocked(this, 'step')
		const rc = capi.sqlite3_step(pSt)
		switch (rc) {
			case C_API.SQLITE_DONE:
				return (this.#mayGet = false)
			case C_API.SQLITE_ROW:
				return (this.#mayGet = true)
			default:
				this.#mayGet = false
				// warn
				checkRc(rc, this.#db.pointer)
		}
	}

	clearBindings() {
		const pSt = affirmNotLocked(this, 'clearBindings')
		capi.sqlite3_clear_bindings(pSt)
		this.#mayGet = false
		return this
	}

	reset(alsoClearBinds = false) {
		const pSt = affirmNotLocked(this, 'reset')
		if (alsoClearBinds) this.clearBindings()
		this.#mayGet = false
		const rc = capi.sqlite3_reset(pSt)
		checkRc(rc, this.#db.pointer)
		return this
	}

	finalize() {
		const pSt = affirmNotLocked(this, 'finalize')
		const rc = capi.sqlite3_finalize(pSt)
		__stmtMap.get(this.#db).delete(pSt)
		__ptrMap.delete(this)
		return rc
	}
}
