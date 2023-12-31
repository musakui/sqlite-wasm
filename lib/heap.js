import { getASM, getMemory as mem } from './instance.js'
import { ptrIR } from './constants.js'
import { heap as HEAP8U, cstrlen, alloc, dealloc, realloc, sqliteError } from './base.js'
import { abort, isBindableTypedArray } from './util.js'

const ENCODER = new TextEncoder('utf8')

/** @type {number[][]} */
const scopeCache = []

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

/** @return {WebAssembly.Table} */
export const functionTable = () => getASM().__indirect_function_table

/** @param {number} fptr */
export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

export const uninstallFunction = (ptr) => {}

/**
 * @param {string} str
 * @param {typeof alloc | typeof scopedAlloc} allocator
 */
const __allocCStr = (str, allocator) => {
	const u = ENCODER.encode(str)
	const ptr = allocator(u.length + 1)
	const heap = HEAP8U()
	heap.set(u, ptr)
	heap[ptr + u.length] = 0
	return /** @type {[ptr: number, len: number]} */ ([ptr, u.length])
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

/** @param {string} s */
export const scopedAllocCString = (s) => __allocCStr(s, scopedAlloc)[0]

/** @param {string} s */
export const scopedAllocCStringWithLength = (s) => __allocCStr(s, scopedAlloc)

/** @param {string} s */
export const allocCString = (s) => __allocCStr(s, alloc)[0]

/** @param {string} s */
export const allocCStringWithLength = (s) => __allocCStr(s, alloc)

export { alloc, dealloc, realloc, HEAP8U }

export const cstrncpy = (tgtPtr, srcPtr, n) => {
	if (!tgtPtr || !srcPtr) abort('cstrncpy() does not accept NULL strings')
	if (n < 0) {
		n = cstrlen(srcPtr) + 1
	} else if (!(n > 0)) {
		return 0
	}
	const heap = HEAP8U()
	let i = 0
	for (let ch; i < n && (ch = heap[srcPtr + i]); ++i) {
		heap[tgtPtr + i] = ch
	}
	if (i < n) heap[tgtPtr + i++] = 0
	return i
}

export const peek = (ptr, type = 'i8') => {
	if (type.endsWith('*')) type = ptrIR
	const list = Array.isArray(ptr) ? [] : undefined
	let rc
	do {
		if (list) ptr = arguments[0].shift()
		switch (type) {
			case 'i1':
			case 'i8':
				rc = HEAP8()[ptr >> 0]
				break
			case 'i16':
				rc = HEAP16()[ptr >> 1]
				break
			case 'i32':
				rc = HEAP32()[ptr >> 2]
				break
			case 'float':
			case 'f32':
				rc = HEAP32F()[ptr >> 2]
				break
			case 'double':
			case 'f64':
				rc = Number(HEAP64F()[ptr >> 3])
				break
			case 'i64':
				rc = BigInt(HEAP64()[ptr >> 3])
				break
			default:
				toss('Invalid type for peek():', type)
		}
		if (list) list.push(rc)
	} while (list && arguments[0].length)
	return list || rc
}

export const peekPtr = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, ptrIR)