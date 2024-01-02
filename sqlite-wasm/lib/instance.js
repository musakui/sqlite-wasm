import { DEBUG } from './constants.js'
import { abort, NO_OP } from './util.js'

const DEFAULT_WASM_SRC = '../jswasm/sqlite3.wasm'

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
	c, DEBUG ? ((..._) => console.warn(`'${c}':`, _)) : NO_OP
]))

/** @type {Promise<void> | null} */
let initPromise = null

/** @type {WebAssembly.Instance | null} */
let instance = null

/** @type {WebAssembly.Memory | null} */
let memory = null

/**
 * @param {Response | PromiseLike<Response>} [source]
 * @param {WebAssembly.MemoryDescriptor} [memOpts]
 */
const __load = async (source, memOpts) => {
	if (!source) {
		source = fetch(new URL(DEFAULT_WASM_SRC, import.meta.url))
	}

	memory = new WebAssembly.Memory({
		initial: 256,
		maximum: 32768,
		...memOpts,
	})

	const src = await WebAssembly.instantiateStreaming(source, {
		env: {
			memory,
			...noops(others),
			...noops(syscall.map((c) => `__syscall_${c}`)),
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

export const getMemory = () => memory ?? abort(NOT_INITIALIZED)

export const getASM = () => instance?.exports ?? abort(NOT_INITIALIZED)

/**
 * load WASM module
 *
 * Only needs to be called once;
 * options provided to subsequent invocations will be ignored
 *
 * @param {Response | PromiseLike<Response>} [source] response from fetch
 * @param {WebAssembly.MemoryDescriptor} [memoryOptions] options for the Memory
 */
export const load = async (source, memoryOptions) => {
	if (!initPromise) {
		initPromise = __load(source, memoryOptions)
	}
	return await initPromise
}
