import { DEBUG } from './constants.js'
import { abort, NO_OP } from './util.js'

const NOT_INITIALIZED = 'not initialized'

const fdcall = ['close', 'read', 'seek', 'sync', 'write', 'fdstat_get']

// prettier-ignore
const syscall = [
	'ioctl', 'chmod', 'rmdir', 'stat64', 'openat', 'fchmod', 'getcwd',
	'fcntl64', 'fstat64', 'lstat64', 'mkdirat', 'fchown32', 'unlinkat',
	'faccessat', 'utimensat', 'newfstatat', 'readlinkat', 'ftruncate64',
]

// prettier-ignore
const others = [
	'_mmap_js', '_tzset_js', '_munmap_js', '_localtime_js',
	'emscripten_get_now', 'emscripten_resize_heap',
	'_emscripten_get_now_is_monotonic',
]

// prettier-ignore
/** @param {string[]} a */
const noops = (a) => Object.fromEntries(a.map((c) => [
	c, DEBUG ? ((..._) => console.warn(`'${c}' called with:`, _)) : NO_OP
]))

/** @type {Promise<void> | null} */
let initPromise = null

/** @type {WebAssembly.Instance | null} */
let instance = null

/** @type {WebAssembly.Memory | null} */
let memory = null

/** @param {Response | PromiseLike<Response>} resp */
const __load = async (resp) => {
	const src = await WebAssembly.instantiateStreaming(resp, {
		env: {
			memory,
			...noops(others),
			...noops(syscall.map((c) => `__syscall_${c}`)),
			// need to return the generic error code to work
			__syscall_openat: () => -44,
			emscripten_date_now: () => Date.now(),
		},
		wasi_snapshot_preview1: {
			...noops(fdcall.map((c) => `fd_${c}`)),
			environ_sizes_get: () => 0,
			environ_get: () => 0,
		},
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
