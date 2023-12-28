import { wasmMemory, onReady } from './stuff.js'

/** @param {string[]} a */
const noops = (a) => Object.fromEntries(a.map((c) => [c, (..._) => console.warn(`'${c}':`, _)]))

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
	...syscall.map((c) => `__syscall_${c}`),
]

/**
 * @param {Response | PromiseLike<Response>} source
 */
export async function init(source) {
	const src = await WebAssembly.instantiateStreaming(source, {
		wasi_snapshot_preview1: {
			...noops(fdcall.map((c) => `fd_${c}`)),
			environ_get: () => {},
			environ_sizes_get: () => {},
		},
		env: {
			...noops(others),
			memory: wasmMemory,
			__syscall_openat: () => -44,
			emscripten_date_now: () => {},
		},
	})
	return await onReady(src.instance.exports)
}
