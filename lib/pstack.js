import { getASM } from './init.js'
import { allocError } from './base.js'
import { ptrSizeof } from './constants.js'

const sizeofIR = (n) => {
	switch (n) {
		case 'i8':
			return 1
		case 'i16':
			return 2
		case 'i32':
		case 'f32':
		case 'float':
			return 4
		case 'i64':
		case 'f64':
		case 'double':
			return 8
		case '*':
			return ptrSizeof
		default:
			return ('' + n).endsWith('*') ? ptrSizeof : undefined
	}
}

export const alloc = (n) => {
	if ('string' === typeof n && !(n = sizeofIR(n))) {
		allocError(`Invalid value for pstack.alloc(${arguments[0]})`)
	}
	return getASM().sqlite3_wasm_pstack_alloc(n) || allocError(`Could not allocate ${n} bytes from the pstack`)
}

export const allocChunks = (n, sz) => {
	if ('string' === typeof sz && !(sz = sizeofIR(sz))) {
		allocError(`Invalid size value for allocChunks(${arguments[1]})`)
	}
	const mem = alloc(n * sz)
	const rc = []
	let offset = 0
	for (let i = 0; i < n; ++i, offset += sz) rc.push(mem + offset)
	return rc
}

export const allocPtr = (n = 1, safePtrSize = true) => {
	const sz = safePtrSize ? 8 : ptrSizeof
	return 1 === n ? alloc(sz) : allocChunks(n, sz)
}

export const restore = (n) => getASM().sqlite3_wasm_pstack_restore(n)

export const getPtr = () => getASM().sqlite3_wasm_pstack_ptr

export const getQuota = () => getASM().sqlite3_wasm_pstack_quota

export const getRemaining = () => getASM().sqlite3_wasm_pstack_remaining
