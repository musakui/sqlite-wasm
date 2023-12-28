import { onReady } from './stuff.js'

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
	const memory = new WebAssembly.Memory({ initial: 256, maximum: 32768 })

	const src = await WebAssembly.instantiateStreaming(source, {
		wasi_snapshot_preview1: {
			...noops(fdcall.map((c) => `fd_${c}`)),
			environ_sizes_get: () => 0,
			environ_get: () => 0,
		},
		env: {
			memory,
			...noops(others),
			__syscall_openat: () => -44,
			emscripten_date_now: () => Date.now(),
		},
	})
	return onReady(src.instance.exports, memory)
}

export const version = {
	libVersion: '3.44.2',
	libVersionNumber: 3044002,
	sourceId: '2023-11-24 11:41:44 ebead0e7230cd33bcec9f95d2183069565b9e709bf745c9b5db65cc0cbf92c0f',
	downloadVersion: 3440200,
}
