import { C_API, capi as capi_o, sqliteError } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import * as wasm from './wasm.js'
import * as pstack from './pstack.js'

/** @typedef {import('./types').WasmPointer<'db'>} DBPointer */
/** @typedef {import('./types').WasmPointer<'stmt'>} StmtPointer */

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

export class DB {
	constructor(filename = '', flags = '', vfs = null) {
		const fn = filename || ':memory:'
		const flagStr = flags || 'c'
		const vfsName = vfs ?? null

		let oflags = 0
		if (flagStr.indexOf('c') > -1) {
			oflags |= C_API.SQLITE_OPEN_CREATE | C_API.SQLITE_OPEN_READWRITE
		}
		if (flagStr.indexOf('w') > -1) {
			oflags |= C_API.SQLITE_OPEN_READWRITE
		}
		if (oflags === 0) {
			oflags |= C_API.SQLITE_OPEN_READONLY
		}

		/** @type {DBPointer} */
		let pDb
		const stack = pstack.getPtr()
		try {
			const pPtr = pstack.allocPtr()
			let rc = capi_o.sqlite3_open_v2(fn, pPtr, oflags, vfsName || 0)
			pDb = heap.peekPtr(pPtr)
			checkRc(rc, pDb)
			capi.sqlite3_extended_result_codes(pDb, 1)
		} catch (e) {
			if (pDb) capi_o.sqlite3_close_v2(pDb)
			throw e
		} finally {
			pstack.restore(stack)
		}
		this.filename = fnJs
		__ptrMap.set(this, pDb)
		__stmtMap.set(this, new Map())
		try {
			const pVfs = wasm.sqlite3_js_db_vfs(pDb)
			if (!pVfs) sqliteError('cannot get VFS for new db')
		} catch (e) {
			this.close()
			throw e
		}
	}

	/** @return {DBPointer} */
	get pointer() {
		return __ptrMap.get(this)
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
		capi_o.sqlite3_close_v2(pDb)
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
		this.parameterCount = capi.sqlite3_bind_parameter_count(pSt)
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
