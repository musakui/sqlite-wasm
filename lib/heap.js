import { getASM, getMemory as mem } from './instance.js'
import { heap as HEAP8U, alloc, allocError, sqliteError } from './base.js'
import { abort, isBindableTypedArray } from './util.js'

const ENCODER = new TextEncoder('utf8')

export const realloc = (m, n) => (n ? getASM().sqlite3_realloc(m, n) || allocError(`realloc(${n}) failed`) : 0)

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
 * @param {boolean} us
 */
const __getHeap = (n, us) => {
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
			return us ? HEAP8U : HEAP8
		case 16:
			return us ? HEAP16U : HEAP16
		case 32:
			return us ? HEAP32U : HEAP32
		case 64:
			return us ? HEAP64U : HEAP64
		default:
			if (n === globalThis.BigInt64Array) return HEAP64
			if (n === globalThis.BigUint64Array) return HEAP64U
			break
	}
	return abort(`invalid size ${n}`)
}

/** @param {unknown} n */
export const heapForSize = (n, unsigned = true) => __getHeap(n, unsigned)()

/** @param {unknown} src */
export const allocFromTypedArray = (src) => {
	if (src instanceof ArrayBuffer) {
		src = new Uint8Array(src)
	}
	if (!isBindableTypedArray(src)) return sqliteError('not a supported type')
	const pRet = alloc(src.byteLength || 1)
	heapForSize(src.constructor).set(src.byteLength ? src : [0], pRet)
	return pRet
}

const __allocCStr = (jstr, returnWithLength, allocator) => {
	if ('string' !== typeof jstr) return null
	const u = ENCODER.encode(jstr)
	const ptr = allocator(u.length + 1)
	const heap = HEAP8U()
	heap.set(u, ptr)
	heap[ptr + u.length] = 0
	return returnWithLength ? [ptr, u.length] : ptr
}

const scopeCache = []

export const functionTable = () => getASM().__indirect_function_table

export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

export const uninstallFunction = (ptr) => {

}

export const scopedAllocPush = () => {
	const a = []
	scopeCache.push(a)
	return a
}

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

export const scopedAlloc = (n) => {
	if (!scopeCache.length) {
		abort('No scope is active')
	}
	const p = alloc(n)
	scopeCache[scopeCache.length - 1].push(p)
	return p
}

export const allocCString = (jstr, returnWithLength = false) => __allocCStr(jstr, returnWithLength, alloc)

export const scopedAllocCString = (jstr, returnWithLength = false) => __allocCStr(jstr, returnWithLength, scopedAlloc)

export { alloc, HEAP8U }
