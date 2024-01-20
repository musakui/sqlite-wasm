import { abort } from './utils.js'
import {
	//
	asm,
	dealloc,
	peek_ptr,
	alloc_str,
	get_pstack,
	get_str_arr,
} from './core.js'
import { install_function } from './funcref.js'

/** @typedef {import('./types').DBPointer} DBPointer */

let execCallback = 0

/** @type {import('./types').ExecCallback | null} */
let currentCallback = null

/**
 * @param {string} filename
 * @param {number} flags
 * @param {string} [vfs]
 */
export const db_open = (filename, flags, vfs) => {
	/** @type {DBPointer} */
	let pDb = 0
	let fnPt = 0
	let vfsPt = 0

	const pstack = get_pstack()
	try {
		fnPt = alloc_str(filename)
		if (vfs) {
			vfsPt = alloc_str(vfs)
		}
		const pPtr = pstack.alloc()
		const rc = asm._open_v2(fnPt, pPtr, flags, vfsPt)
		if (rc) abort(rc)
		pDb = peek_ptr(pPtr)
		if (!pDb) abort('could not find db')
	} finally {
		dealloc(fnPt)
		dealloc(vfsPt)
		pstack.restore()
	}

	return pDb
}

/**
 * @param {DBPointer} pDb
 * @param {string} sql
 * @param {import('./types').ExecCallback} [callback]
 */
export const db_exec = (pDb, sql, callback) => {
	if (callback instanceof Function) {
		currentCallback = callback
		if (!execCallback) {
			const i32 = 'i32'
			const cb = (_, c, v, n) => {
				currentCallback?.({
					get values() {
						return get_str_arr(v, c)
					},
					get names() {
						return get_str_arr(n, c)
					},
				})
			}
			execCallback = install_function(cb, i32, i32, i32, i32, i32)
		}
	} else {
		currentCallback = null
	}

	let sqlPt = 0

	try {
		sqlPt = alloc_str(sql)
		const rc = asm._exec(pDb, sqlPt, execCallback, 0, 0)
		if (rc) abort(rc)
	} finally {
		dealloc(sqlPt)
	}
}
