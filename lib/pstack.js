import { ptrSizeof } from './constants.js'
import { getASM } from './instance.js'
import { allocError } from './base.js'

// https://sqlite.org/wasm/doc/trunk/api-wasm.md#wasm-pstack

/** @param {unknown} sz */
export const sizeofIR = (sz) => {
	if (typeof sz === 'number') return sz
	switch (sz) {
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
			if (`${sz}`.endsWith('*')) return ptrSizeof
	}
	return allocError(`invalid size '${sz}'`)
}

/**
 * @param {number | string} sz
 * @return {number}
 */
export const alloc = (sz) => {
	return getASM().sqlite3_wasm_pstack_alloc(sizeofIR(sz)) || allocError(`pstack.alloc(${n}) failed`)
}

/**
 * @param {number} n
 * @param {number | string} sz
 */
export const allocChunks = (n, sz) => {
	const mem = alloc(n * sizeofIR(sz))
	const rc = []
	let offset = 0
	for (let i = 0; i < n; ++i, offset += sz) rc.push(mem + offset)
	return rc
}

export const allocPtr = (n = 1, safePtrSize = true) => {
	const sz = safePtrSize ? 8 : ptrSizeof
	return 1 === n ? alloc(sz) : allocChunks(n, sz)
}

/**
 * @param {number} n
 * @return {void}
 */
export const restore = (n) => getASM().sqlite3_wasm_pstack_restore(n)

/** @return {number} */
export const getPtr = () => getASM().sqlite3_wasm_pstack_ptr

/** @return {number} */
export const getQuota = () => getASM().sqlite3_wasm_pstack_quota

/** @return {number} */
export const getRemaining = () => getASM().sqlite3_wasm_pstack_remaining
