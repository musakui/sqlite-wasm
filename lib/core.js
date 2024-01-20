import { loader } from './emsmallen.js'

/** @type {WebAssembly.Memory} */
let memory = null

const DEFAULT_WASM_SRC = new URL('./sqlite3-ext.wasm', import.meta.url)

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
