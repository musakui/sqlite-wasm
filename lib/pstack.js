import { getExports, wasm, WasmAllocError } from './init.js'

const exports = await getExports()

export const restore = exports.sqlite3_wasm_pstack_restore

export const alloc = (n) => {
	if ('string' === typeof n && !(n = wasm.sizeofIR(n))) {
		WasmAllocError.toss('Invalid value for pstack.alloc(', arguments[0], ')')
	}
	return exports.sqlite3_wasm_pstack_alloc(n) || WasmAllocError.toss('Could not allocate', n, 'bytes from the pstack.')
}

export const allocChunks = (n, sz) => {
	if ('string' === typeof sz && !(sz = wasm.sizeofIR(sz))) {
		WasmAllocError.toss('Invalid size value for allocChunks(', arguments[1], ')')
	}
	const mem = alloc(n * sz)
	const rc = []
	let offset = 0
	for (let i = 0; i < n; ++i, offset += sz) rc.push(mem + offset)
	return rc
}

export const allocPtr = (n = 1, safePtrSize = true) => {
	return 1 === n ? alloc(safePtrSize ? 8 : wasm.ptrSizeof) : allocChunks(n, safePtrSize ? 8 : wasm.ptrSizeof)
}

export const getPtr = () => exports.sqlite3_wasm_pstack_ptr

export const getQuota = () => exports.sqlite3_wasm_pstack_quota

export const getRemaining = () => exports.sqlite3_wasm_pstack_remaining
