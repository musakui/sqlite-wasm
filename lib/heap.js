import { getASM, getMemory } from './init.js'
import { heap as HEAP8U, alloc, allocError } from './base.js'
import { abort } from './util.js'

const ENCODER = new TextEncoder('utf8')

export const realloc = (m, n) => (n ? getASM().sqlite3_realloc(m, n) || allocError(`realloc(${n}) failed`) : 0)

export const dealloc = (n) => getASM().sqlite3_free(n)

export const HEAP8 = () => new Int8Array(getMemory().buffer)

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

export const scopedAllocPush = () => {
	const a = []
	scopeCache.push(a)
	return a
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