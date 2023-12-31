import { getASM, getMemory as mem } from './instance.js'
import { heap as HEAP8U, alloc, allocError, sqliteError } from './base.js'
import { abort, isBindableTypedArray } from './util.js'

const ENCODER = new TextEncoder('utf8')

/** @type {number[][]} */
const scopeCache = []

/**
 * @param {number} m
 * @param {number} n
 * @return {number}
 */
export const realloc = (m, n) => {
	if (!n) return 0
	return getASM().sqlite3_realloc(m, n) || allocError(`realloc(${n}) failed`)
}

/**
 * @param {number} n
 * @return {void}
 */
export const dealloc = (n) => getASM().sqlite3_free(n)

export const HEAP8 = () => new Int8Array(mem().buffer)
export const HEAP16 = () => new Int16Array(mem().buffer)
export const HEAP16U = () => new Uint16Array(mem().buffer)

export const HEAP32 = () => new Int32Array(mem().buffer)
export const HEAP32U = () => new Uint32Array(mem().buffer)

export const HEAP32F = () => new Float32Array(mem().buffer)
export const HEAP64F = () => new Float64Array(mem().buffer)

export const HEAP64 = () => new globalThis.BigInt64Array(mem().buffer)
export const HEAP64U = () => new globalThis.BigUint64Array(mem().buffer)

/**
 * @param {unknown} n
 * @param {boolean} unsigned
 */
const __getHeap = (n, unsigned = true) => {
	switch (n) {
		case Int8Array:
			return HEAP8
		case Uint8Array:
			return HEAP8U
		case Int16Array:
			return HEAP16
		case Uint16Array:
			return HEAP16U
		case Int32Array:
			return HEAP32
		case Uint32Array:
			return HEAP32U
		case 8:
			return unsigned ? HEAP8U : HEAP8
		case 16:
			return unsigned ? HEAP16U : HEAP16
		case 32:
			return unsigned ? HEAP32U : HEAP32
		case 64:
			return unsigned ? HEAP64U : HEAP64
		default:
			if (n === globalThis.BigInt64Array) return HEAP64
			if (n === globalThis.BigUint64Array) return HEAP64U
			break
	}
	return abort(`invalid size ${n}`)
}

/** @param {unknown} src */
export const allocFromTypedArray = (src) => {
	if (src instanceof ArrayBuffer) {
		src = new Uint8Array(src)
	}
	if (!isBindableTypedArray(src)) return sqliteError('not a supported type')
	const pRet = alloc(src.byteLength || 1)
	__getHeap(src.constructor)().set(src.byteLength ? src : [0], pRet)
	return pRet
}

export const functionTable = () => getASM().__indirect_function_table

export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

export const uninstallFunction = (ptr) => {

}

/**
 * @param {string} jstr
 * @param {boolean} returnWithLength
 * @param {typeof alloc | typeof scopedAlloc} allocator
 */
const __allocCStr = (jstr, returnWithLength, allocator) => {
	if ('string' !== typeof jstr) return null
	const u = ENCODER.encode(jstr)
	const ptr = allocator(u.length + 1)
	const heap = HEAP8U()
	heap.set(u, ptr)
	heap[ptr + u.length] = 0
	return returnWithLength ? [ptr, u.length] : ptr
}

export const scopedAllocPush = () => {
	/** @type {number[]} */
	const a = []
	scopeCache.push(a)
	return a
}

/** @param {number} state */
export const scopedAllocPop = (state) => {
	const n = state ? scopeCache.indexOf(state) : scopeCache.length - 1
	if (n < 0) toss('Invalid state for scopedAllocPop')
	if (!state) {
		state = scopeCache[n]
	}

	scopeCache.splice(n, 1)
	for (let p; (p = state.pop()); ) {
		if (functionEntry(p)) {
			uninstallFunction(p)
		} else {
			dealloc(p)
		}
	}
}

/** @param {number} n */
export const scopedAlloc = (n) => {
	if (!scopeCache.length) abort('No scope is active')
	const p = alloc(n)
	scopeCache.at(-1).push(p)
	return p
}

/** @param {string} jstr */
export const scopedAllocCString = (jstr, returnWithLength = false) => {
	return __allocCStr(jstr, returnWithLength, scopedAlloc)
}

/** @param {string} jstr */
export const allocCString = (jstr, returnWithLength = false) => {
	return __allocCStr(jstr, returnWithLength, alloc)
}

export { alloc, HEAP8U }
