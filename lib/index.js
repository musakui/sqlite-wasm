import { wasmMemory, onReady } from './stuff.js'

/** @param {string[]} arr */
const noops = (arr, NO_OP = () => {}) => Object.fromEntries(arr.map((c) => [c, NO_OP]))

const fdcall = ['close', 'read', 'seek', 'sync', 'write', 'fdstat_get']

const syscall = [
	'ioctl',
	'chmod',
	'rmdir',
	'stat64',
	'openat',
	'fchmod',
	'getcwd',
	'fcntl64',
	'fstat64',
	'lstat64',
	'mkdirat',
	'fchown32',
	'unlinkat',
	'faccessat',
	'utimensat',
	'newfstatat',
	'readlinkat',
	'ftruncate64',
]

/**
 * @param {Response | PromiseLike<Response>} source
 */
export async function init(source) {
	const src = await WebAssembly.instantiateStreaming(source, {
		wasi_snapshot_preview1: {
			...noops(fdcall.map((c) => `fd_${c}`)),
			...noops(['environ_get', 'environ_sizes_get']),
		},
		env: {
			...noops(syscall.map((c) => `__syscall_${c}`)),
			...noops([
				'_mmap_js',
				'_tzset_js',
				'_munmap_js',
				'_localtime_js',
				'emscripten_get_now',
				'emscripten_date_now',
				'emscripten_resize_heap',
				'_emscripten_get_now_is_monotonic',
			]),
			memory: wasmMemory,
			__syscall_openat: () => -44,
		},
	})
	return await onReady(src.instance.exports)
}
