import { importObject, onReady, updateMemoryViews } from './stuff.js'

const wasmSrc = new URL('../sqlite-wasm/jswasm/sqlite3.wasm', import.meta.url)

export async function init() {
	updateMemoryViews()
	const src = await WebAssembly.instantiateStreaming(fetch(wasmSrc), importObject)
	return await onReady(src.instance.exports)
}
