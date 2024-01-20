import { loader } from './emsmallen.js'
import { abort, range } from './utils.js'

/**
 * @template [T=unknown]
 * @typedef {import('./types').WasmPointer<T>} WasmPointer<T>
 */

/** @type {WebAssembly.Memory} */
let memory = null

const DEFAULT_WASM_SRC = new URL('./sqlite3-ext.wasm', import.meta.url)

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

const { asm, load } = loader({
	propTransform: (s) => `sqlite3${s}`,
	/** @type {import('./types').SQLiteASM} */
	exports: 0,
})

export { asm, memory }

/**
 * @param {string | URL} [wasmSrc]
 * @param {import('./types').EmscriptenImports} [imports]
 */
export const init = async (wasmSrc, imports) => {
	memory =
		imports?.env?.memory ?? new WebAssembly.Memory({ initial: 256, maximum: 32768 })

	const src = await load(fetch(wasmSrc ?? DEFAULT_WASM_SRC), {
		...imports,
		env: { ...imports?.env, memory },
	})

	asm._initialize()

	return src
}

/**
 * @template T
 * @param {number} n
 * @return {WasmPointer<T>}
 */
export const alloc = (n) => asm._malloc(n) || abort(`alloc(${n}) failed`)

/** @param {WasmPointer} p */
export const dealloc = (p) => asm._free(p)

export const get_pstack = () => {
	const ptr = asm.__wasm_pstack_ptr()

	/**
	 * @template T
	 * @return {WasmPointer<T>}
	 */
	const alloc = (n = 8) => {
		return asm.__wasm_pstack_alloc(n) || abort(`p.alloc(${n}) failed`)
	}

	const restore = () => asm.__wasm_pstack_restore(ptr)

	return { alloc, restore }
}

export const pstack = {
	get quota() {
		return asm.__wasm_pstack_quota()
	},
	get remaining() {
		return asm.__wasm_pstack_remaining()
	},
}

/**
 * create a byte-oriented view of the memory
 *
 * a reference to the view should not be held for long periods
 * as the buffer will be detached when the memory is expanded
 */
export const heap8u = () => new Uint8Array(memory.buffer)

export const heap32 = () => new Int32Array(memory.buffer)

/**
 * @template T
 * @param {WasmPointer} ptr
 * @return {WasmPointer<T>}
 */
export const peek_ptr = (ptr) => heap32()[ptr >> 2]

/**
 * seek to the end of a NUL terminated C string
 * @param {WasmPointer<string>} ptr
 */
const cstrend = (ptr) => {
	const heap = heap8u()
	while (heap[++ptr] !== 0) {}
	return ptr
}

/**
 * get the char length of a C string
 * @param {WasmPointer<string>} ptr
 */
export const cstrlen = (ptr) => {
	return ptr - cstrend(ptr)
}

/**
 * read the value of a C string
 * @param {WasmPointer<string>} ptr
 */
export const cstr_to_j = (ptr) => {
	const end = cstrend(ptr)
	return ptr === end ? '' : DECODER.decode(heap8u().slice(ptr, end))
}

/**
 * @param {WasmPointer<string[]>} ptr
 * @param {number} len
 */
export const get_str_arr = (ptr, len) => {
	const hp = heap32()
	const pp = ptr >> 2
	return range(len, (i) => cstr_to_j(hp[pp + i]))
}

/**
 * copy a string into the WASM heap at the given pointer or allocate space
 * @param {string} str
 * @param {WasmPointer<string>} [ptr]
 */
export const jstr_to_c = (str, ptr, len = 0) => {
	const raw = ENCODER.encode(str)
	const ln = len < 1 ? raw.length : len
	const pt = ptr ?? alloc(ln + 1)
	const heap = heap8u()
	heap.set(raw, pt)
	heap[pt + ln] = 0
	return /** @type {[ptr: WasmPointer<string>, len: number]} */ ([pt, ln])
}

/**
 * allocate space for a string
 * @param {string} str
 */
export const alloc_str = (str) => jstr_to_c(str)[0]

/**
 * create a template tag to allocate C strings
 * provides a dispose function to cleanup memory
 */
export const scoped_tag = () => {
	/** @type {WasmPointer<string>[]} */
	const cache = []

	const dispose = () => {
		for (const ptr of cache) dealloc(ptr)
		cache.splice(0, cache.length)
	}

	/**
	 * template tag
	 * @param {TemplateStringsArray} strs
	 * @param {...unknown} vals
	 */
	function tag(strs, ...vals) {
		const all = strs.slice(1).reduce((s, v, i) => `${s}${vals[i]}${v}`, strs[0])
		const ptr = alloc_str(all)
		cache.push(ptr)
		return ptr
	}
	Object.assign(tag, { dispose })
	return tag
}
