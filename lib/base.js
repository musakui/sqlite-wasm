import { getASM, getMemory } from './instance.js'
import { abort, isPtr, typedArrayToString } from './util.js'

import { Jaccwabyt } from './jaccwabyt.js'
import { WhWasmUtilInstaller } from './whWasmUtil.js'

/** @type {Map<number, string>} */
const __rcMap = new Map()

/** @type {import('./types').VersionInfo} */
const VERSION = Object.create(null)

const MAINTANENCE_REQUIRED = `Maintenance required: increase the static buffer size for sqlite3_wasm_enum_json`

const ignoreStructs = ['WasmTestStruct']
const indexStructs = ['info', 'orderby', 'constraint', 'constraint_usage']

const processStructs = (sts, binder) => {
	const ign = new Set(ignoreStructs)
	const temp = new Map()
	for (const s of sts) {
		if (ign.has(s.name)) continue
		temp.set(s.name, binder(s))
	}

	const [info, ...keys] = indexStructs.map((n) => `sqlite3_index_${n}`)
	const index_info = temp.get(info)

	for (const k of keys) {
		index_info[k] = temp.get(k)
		temp.delete(k)
	}

	return Object.fromEntries(temp.entries())
}

export let StructBinder = null

export const wasm = Object.create(null)

export const capi = Object.create(null)

/** @type {Readonly<Record<string, number>>} */
export const C_API = Object.create(null)

/** @type {Record<string, Function>} */
export const structs = Object.create(null)

export const version = {
	get libVersion() {
		return VERSION.SQLITE_VERSION
	},
	get libVersionNumber() {
		return VERSION.SQLITE_VERSION_NUMBER
	},
	get sourceId() {
		return VERSION.SQLITE_SOURCE_ID
	},
}

/**
 * @param {number} n
 * @return {number}
 */
export const alloc = (n) => {
	return getASM().sqlite3_malloc(n) || allocError(`alloc(${n}) failed`)
}

/**
 * @param {number} n
 * @return {void}
 */
export const dealloc = (n) => getASM().sqlite3_free(n)

/**
 * @param {number} m
 * @param {number} n
 * @return {number}
 */
export const realloc = (m, n) => {
	if (!n) return 0
	return getASM().sqlite3_realloc(m, n) || allocError(`realloc(${n}) failed`)
}

export const heap = () => new Uint8Array(getMemory().buffer)

/** @param {number} ptr */
export const cstrlen = (ptr) => {
	if (!ptr || !isPtr(ptr)) return null
	const h = heap()
	const ori = ptr
	while (h[++ptr] !== 0) {}
	return ptr - ori
}

/** @param {number} ptr */
export const cstrToJs = (ptr) => {
	const n = cstrlen(ptr)
	return n ? typedArrayToString(heap(), ptr, ptr + n) : null === n ? n : ''
}

export const setup = () => {
	const asm = getASM()
	asm.__wasm_call_ctors()

	const cjStr = asm.sqlite3_wasm_enum_json()
	if (!cjStr) abort(MAINTANENCE_REQUIRED)

	StructBinder = Jaccwabyt({
		heap,
		alloc,
		dealloc,
		memberPrefix: '$',
	})

	const obj = JSON.parse(cstrToJs(cjStr))
	for (const [g, group] of Object.entries(obj)) {
		if (g === 'structs') {
			Object.assign(structs, processStructs(group, StructBinder))
			continue
		}

		if (g === 'version') {
			Object.assign(VERSION, group)
			continue
		}

		const ent = Object.entries(group)

		if (g === 'resultCodes') {
			for (const [k, v] of ent) __rcMap.set(v, k)
		}

		for (const [k, v] of ent) {
			C_API[k] = v
		}
	}

	WhWasmUtilInstaller(wasm)
}

/** @param {number} rc */
export const sqlite3_js_rc_str = (rc) => __rcMap.get(rc)

export const sqliteError = (...args) => {
	throw new SQLite3Error(...args)
}

/** @param {string} msg */
export const allocError = (msg) => {
	throw new AllocError(msg)
}

export class SQLite3Error extends Error {
	name = 'SQLite3Error'

	/** @type {number} */
	#rc

	constructor(rc, ...args) {
		const rt = typeof rc
		const a1o = typeof args[0] === 'object'
		if (rt === 'number' && rc === (rc | 0)) {
			const rcStr = sqlite3_js_rc_str(rc) || `code #${rc}`
			if (!args.length) {
				super(rcStr)
			} else if (a1o) {
				super(rcStr, args[0])
			} else {
				super(`${rcStr}: ${args.join(' ')}`)
			}
			this.#rc = rc
		} else if (rt === 'string' && a1o) {
			super(rc, args[0])
		} else {
			super(`${rc} ${args.join(' ')}`)
		}
	}

	get resultCode() {
		return this.#rc || C_API.SQLITE_ERROR
	}
}

export class AllocError extends SQLite3Error {
	name = 'WasmAllocError'

	constructor(msg) {
		super(C_API.SQLITE_NOMEM, msg)
	}
}
