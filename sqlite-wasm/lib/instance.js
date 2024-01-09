import { abort } from './util.js'

const NOT_INITIALIZED = 'not initialized'

/** @type {Promise<void> | null} */
let initPromise = null

/** @type {WebAssembly.Instance | null} */
let instance = null

/** @type {WebAssembly.Memory | null} */
let memory = null

/**
 * @param {Response | PromiseLike<Response>} resp
 */
const __load = async (resp) => {
	/** @type {ProxyHandler} */
	const handler = {
		get(target, prop) {
			return target[prop] ?? (() => abort(`${prop} was called but not implemented`))
		},
	}

	const env = {
		memory,
		emscripten_date_now: () => Date.now(),
		// return a generic errorcode. required for the original vfs code
		__syscall_openat: () => -44,
	}

	const wasi = {
		environ_sizes_get: () => 0,
		environ_get: () => 0,
	}

	const src = await WebAssembly.instantiateStreaming(resp, {
		env: new Proxy(env, handler),
		wasi_snapshot_preview1: new Proxy(wasi, handler),
	})

	instance = src.instance
}

/** Get the Memory object. Throws if not loaded */
export const getMemory = () => memory ?? abort(NOT_INITIALIZED)

/** Get the Exports object. Throws if not loaded */
export const getASM = () => instance?.exports ?? abort(NOT_INITIALIZED)

/**
 * Load and init the WASM module
 *
 * Only needs to be called once;
 * options provided to subsequent invocations will be ignored
 *
 * @param {string | URL | Response | PromiseLike<Response>} [source] source for the WASM module
 * @param {WebAssembly.MemoryDescriptor} [memoryOptions] options for the Memory object
 */
export const load = async (source, memoryOptions) => {
	if (!initPromise) {
		memory = new WebAssembly.Memory({
			initial: 256,
			maximum: 32768,
			...memoryOptions,
		})

		if (!source) {
			try {
				// try to get the URL via Vite
				const m = await import('../jswasm/sqlite3.wasm?url')
				if (!m.default) abort()
				source = m.default
			} catch (err) {
				source = '../jswasm/sqlite3.wasm'
			}
		}

		const r = typeof source === 'string' || source instanceof URL ? fetch(source) : source
		initPromise = __load(r, memoryOptions)
	}
	return await initPromise
}
