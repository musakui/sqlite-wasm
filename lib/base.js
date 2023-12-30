import { getASM, getMemory } from './instance.js'
import { abort, isPtr, typedArrayToString } from './util.js'

import { Jaccwabyt } from './jaccwabyt.js'
import { WhWasmUtilInstaller } from './whWasmUtil.js'

const ignoreStructs = new Set(['WasmTestStruct'])

/** @type {Map<number, string>} */
const __rcMap = new Map()

export let StructBinder = null

export const wasm = Object.create(null)

export const capi = Object.create(null)

/** @type {Record<string, number>} */
export const C_API = Object.create(null)

/** @type {Record<string, Function>} */
export const structs = Object.create(null)

/** @type {{ SQLITE_VERSION_NUMBER: number; SQLITE_VERSION: string; SQLITE_SOURCE_ID: string }} */
export const VERSION = Object.create(null)

/**
 * @param {number} n
 * @return {number}
 */
export const alloc = (n) => getASM().sqlite3_malloc(n) || allocError(`alloc(${n}) failed`)

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

const processStructs = (sts) => {
	const temp = new Map()
	for (const s of sts) {
		if (ignoreStructs.has(s.name)) continue
		temp.set(s.name, StructBinder(s))
	}

	const [info, ...keys] = ['info', 'orderby', 'constraint', 'constraint_usage'].map((n) => `sqlite3_index_${n}`)
	const index_info = temp.get(info)

	for (const k of keys) {
		index_info[k] = temp.get(k)
		temp.delete(k)
	}

	return Object.fromEntries(temp.entries())
}

export const setup = () => {
	const asm = getASM()
	asm.__wasm_call_ctors()

	const cjStr = asm.sqlite3_wasm_enum_json()
	if (!cjStr) {
		abort(`Maintenance required: increase the static buffer size for sqlite3_wasm_enum_json`)
	}

	StructBinder = Jaccwabyt({
		heap,
		alloc,
		dealloc: asm.sqlite3_free,
		memberPrefix: '$',
	})

	const obj = JSON.parse(cstrToJs(cjStr))
	for (const [g, group] of Object.entries(obj)) {
		if (g === 'structs') {
			Object.assign(structs, processStructs(group))
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

	wasm.alloc = alloc
	wasm.dealloc = asm.sqlite3_free
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
