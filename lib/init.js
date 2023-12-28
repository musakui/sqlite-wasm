const DEFAULT_WASM_SRC = new URL('../sqlite-wasm/jswasm/sqlite3.wasm', import.meta.url)

const NO_OP = null // () => {}

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

/** @type {WebAssembly.Instance | null} */
export let instance = null

/** @type {WebAssembly.Memory | null} */
export let memory = null

export const capi = Object.create(null)

export const wasm = Object.create(null)

/**
 * @param {Response | PromiseLike<Response>} [source]
 * @param {WebAssembly.MemoryDescriptor} [memoryOptions]
 */
export const initStreaming = async (source, memoryOptions) => {
	if (instance) return instance.exports

	if (!source) {
		source = fetch(DEFAULT_WASM_SRC)
	}

	memory = new WebAssembly.Memory({
		initial: 256,
		maximum: 32768,
		...memoryOptions,
	})

	// prettier-ignore
	/** @param {string[]} a */
	const noops = (a) => Object.fromEntries(a.map((c) => [
		c, NO_OP || ((..._) => console.warn(`'${c}':`, _))
	]))

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
	return src.instance.exports
}

export const getExports = async () => {
	if (instance) return instance.exports
	return await initStreaming()
}

export const getMemory = () => {
	if (!memory) throw new Error('not initialized')
	return memory
}
