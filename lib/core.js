import { loader } from './emsmallen.js'

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
		imports?.env?.memory ??
		new WebAssembly.Memory({ initial: 256, maximum: 32768 })

	const src = await load(fetch(wasmSrc ?? DEFAULT_WASM_SRC), {
		...imports,
		env: { ...imports.env, memory },
	})

	asm._initialize()

	return src
}

/**
 * @param {string} message
 * @param {unknown} [cause]
 */
export const abort = (message, cause) => {
	throw new Error(message, { cause })
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
	 * @param {number} n
	 * @return {WasmPointer<T>}
	 */
	const alloc = (n) => {
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
 * copy a string into the WASM heap at the given pointer
 * @param {string} str
 * @param {WasmPointer<string>} ptr
 */
export const jstr_to_c = (str, ptr, max = 0) => {
	const raw = ENCODER.encode(str)
	const len = max > 0 ? Math.min(max, raw.length) : raw.length
	const heap = heap8u()
	heap.set(raw, ptr)
	heap[ptr + len] = 0
	return len
}
