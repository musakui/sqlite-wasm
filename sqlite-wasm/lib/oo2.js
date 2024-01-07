import { C_API, sqliteError } from './base.js'
import * as heap from './heap.js'
import * as capi from './capi.js'
import * as pstack from './pstack.js'

/** @typedef {import('./types').DBPointer} DBPointer */
/** @typedef {import('./types').StmtPointer} StmtPointer */

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

export class Stmt {
	/** @type {DB} */
	#db

	/** @type {StmtPointer | null} */
	#ptr = null

	#mayGet = false

	#locked = false

	/**
	 * @param {DB} db
	 * @param {StmtPointer} ptr
	 */
	constructor(db, ptr) {
		this.#db = db
		this.#ptr = ptr
	}

	get pointer() {
		return this.#ptr
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
		const pSt = affirmNotLocked(this)
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
		checkRc(capi.sqlite3_reset(pSt), this.#db.pointer)
		return this
	}

	finalize() {
		const rc = capi.sqlite3_finalize(affirmNotLocked(this, 'finalize'))
		this.#ptr = null
		return rc
	}
}
