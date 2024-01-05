import { HAS_BIGINT, ptrIR, ptrSizeof } from './constants.js'
import { abort, isBindableTypedArray } from './util.js'
import {
	//
	alloc,
	dealloc,
	realloc,
	cstrlen,
	cstrToJs,
	sqliteError,
	heap as heap8u,
	getMemory as mem,
	getASM,
} from './base.js'

const ENCODER = new TextEncoder('utf8')

/** @type {number[][]} */
export const scopeCache = []

/** @type {number[]} */
const freeFuncIndexes = []

const heap8 = () => new Int8Array(mem().buffer)
const heap16 = () => new Int16Array(mem().buffer)
const heap16u = () => new Uint16Array(mem().buffer)
const heap32 = () => new Int32Array(mem().buffer)
const heap32u = () => new Uint32Array(mem().buffer)
const heap32f = () => new Float32Array(mem().buffer)
const heap64f = () => new Float64Array(mem().buffer)
const heap64 = () => new globalThis.BigInt64Array(mem().buffer)
const heap64u = () => new globalThis.BigUint64Array(mem().buffer)

/**
 * @param {number | Uint8Array} n
 * @param {boolean} signed
 */
const __getHeap = (n, signed) => {
	switch (n) {
		case Int8Array:
			return heap8
		case Uint8Array:
			return heap8u
		case Int16Array:
			return heap16
		case Uint16Array:
			return heap16u
		case Int32Array:
			return heap32
		case Uint32Array:
			return heap32u
		case 8:
			return signed ? heap8 : heap8u
		case 16:
			return signed ? heap16 : heap16u
		case 32:
			return signed ? heap32 : heap32u
		case 64:
			return signed ? heap64 : heap64u
		default:
			if (n === globalThis.BigInt64Array) return heap64
			if (n === globalThis.BigUint64Array) return heap64u
			break
	}
	return abort(`invalid size ${n}`)
}

/**
 * @param {number | Uint8Array} n
 */
export const heapForSize = (n, unsigned = true) => __getHeap(n, !unsigned)()

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

/**
 * @param {number} fptr
 * @return {Function | undefined}
 */
export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

/**
 * @param {string} str
 * @param {typeof alloc | typeof scopedAlloc} allocator
 */
const __allocCStr = (str, allocator) => {
	const u = ENCODER.encode(str)
	const ptr = allocator(u.length + 1)
	const heap = heap8u()
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

export const scopedAllocCall = (func) => {
	scopedAllocPush()
	try {
		return func()
	} finally {
		scopedAllocPop()
	}
}

/** @param {string} s */
export const scopedAllocCString = (s) => __allocCStr(s, scopedAlloc)[0]

/** @param {string} s */
export const scopedAllocCStringWithLength = (s) => __allocCStr(s, scopedAlloc)

/** @param {string} s */
export const allocCString = (s) => __allocCStr(s, alloc)[0]

/** @param {string} s */
export const allocCStringWithLength = (s) => __allocCStr(s, alloc)

export const cstrncpy = (tgtPtr, srcPtr, n) => {
	if (!tgtPtr || !srcPtr) abort('cstrncpy() does not accept NULL strings')
	if (n < 0) {
		n = cstrlen(srcPtr) + 1
	} else if (!(n > 0)) {
		return 0
	}
	const heap = heap8u()
	let i = 0
	for (let ch; i < n && (ch = heap[srcPtr + i]); ++i) {
		heap[tgtPtr + i] = ch
	}
	if (i < n) heap[tgtPtr + i++] = 0
	return i
}

/**
 * @param {TypedArray} hp
 * @param {number} pos
 */
const __peek = (hp, pos) => hp[pos]

/**
 * @param {number} ptr
 */
const peek1 = (ptr, type = 'i8') => {
	if (type.endsWith('*')) type = ptrIR
	switch (type) {
		case 'i1':
		case 'i8':
			return heap8()[ptr >> 0]
		case 'i16':
			return heap16()[ptr >> 1]
		case 'i32':
			return heap32()[ptr >> 2]
		case 'float':
		case 'f32':
			return heap32f()[ptr >> 2]
		case 'double':
		case 'f64':
			return Number(heap64f()[ptr >> 3])
		case 'i64':
			return heap64()[ptr >> 3]
		default:
			break
	}
	return abort(`Invalid type for peek(): ${type}`)
}

/**
 * @param {number} ptr
 */
export const peek = (ptr, type = 'i8') => peek1(ptr, type)

/**
 * @param {number[]} ptrs
 */
export const peekMany = (ptrs, type = 'i8') => ptrs.map((p) => peek1(p, type))

/**
 * @param {number | number[]} ptr
 * @param {number} value
 */
export const poke = (ptr, value, type = 'i8') => {
	if (type.endsWith('*')) type = ptrIR
	let step = 0
	let hp
	switch (type) {
		case 'i1':
		case 'i8':
			hp = heap8()
			break
		case 'i16':
			hp = heap16()
			step = 1
			break
		case 'i32':
			hp = heap32()
			step = 2
			break
		case 'float':
		case 'f32':
			hp = heap32f()
			step = 2
			break
		case 'double':
		case 'f64':
			hp = heap64f()
			step = 3
			break
		case 'i64':
			if (HAS_BIGINT) {
				hp = heap64()
				step = 3
				value = BigInt(value)
				break
			}
		default:
			break
	}
	if (!hp) return abort(`Invalid type for poke: ${type}`)
	for (const p of Array.isArray(ptr) ? ptr : [ptr]) {
		hp[p >> step] = value
	}
}

/** @param {number} ptr */
export const peekPtr = (ptr) => peek1(ptr, ptrIR)

/** @param {number} ptr */
export const pokePtr = (ptr, value = 0) => poke(ptr, value, ptrIR)

/** @param {number} ptr */
export const peek8 = (ptr) => heap8()[ptr]

export const peek16 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i16')
export const peek32 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i32')
export const peek64 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i64')
export const peek32f = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'f32')
export const peek64f = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'f64')

export const poke8 = (ptr, value) => poke(ptr, value, 'i8')
export const poke16 = (ptr, value) => poke(ptr, value, 'i16')
export const poke32 = (ptr, value) => poke(ptr, value, 'i32')
export const poke64 = (ptr, value) => poke(ptr, value, 'i64')
export const poke32f = (ptr, value) => poke(ptr, value, 'f32')
export const poke64f = (ptr, value) => poke(ptr, value, 'f64')

const rxJSig = /^(\w)\((\w*)\)$/
const typeCodes = { f64: 0x7c, f32: 0x7d, i64: 0x7e, i32: 0x7f }
const sigTypes = { i: 'i32', p: 'i32', P: 'i32', s: 'i32', j: 'i64', f: 'f32', d: 'f64' }

const uleb128Encode = (tgt, method, n) => {
	if (n < 128) {
		tgt[method](n)
	} else {
		tgt[method](n % 128 | 128, n >> 7)
	}
}

const letterType = (x) => sigTypes[x] || abort(`Invalid signature letter: ${x}`)

const pushSigType = (dest, letter) => dest.push(typeCodes[letterType(letter)])

const jsFuncToWasm = (func, sig) => {
	if ('string' === typeof func) {
		;[sig, func] = [func, sig]
	}
	const m = rxJSig.exec(sig)
	const sp = m ? m[2] : sig.substr(1)
	const wasmCode = [0x01, 0x60]
	uleb128Encode(wasmCode, 'push', sp.length)
	for (const x of sp) pushSigType(wasmCode, x)
	if ('v' === sig[0]) {
		wasmCode.push(0)
	} else {
		wasmCode.push(1)
		pushSigType(wasmCode, sig[0])
	}
	uleb128Encode(wasmCode, 'unshift', wasmCode.length)
	wasmCode.unshift(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01)
	wasmCode.push(0x02, 0x07, 0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00, 0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00)
	return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(wasmCode)), { e: { f: func } }).exports.f
}

/**
 * @param {Function} func
 * @param {string} sig
 * @param {boolean} scoped
 */
export const __installFunction = (func, sig, scoped) => {
	if (scoped && !scopeCache.length) {
		toss('No scopedAllocPush() scope is active.')
	}
	if ('string' === typeof func) {
		;[sig, func] = [func, sig]
	}
	const ft = functionTable()
	const oldLen = ft.length
	let ptr
	while (freeFuncIndexes.length) {
		ptr = freeFuncIndexes.pop()
		if (ft.get(ptr)) {
			ptr = null
			continue
		} else {
			break
		}
	}
	if (!ptr) {
		ptr = oldLen
		ft.grow(1)
	}
	try {
		ft.set(ptr, func)
		if (scoped) {
			scopeCache.at(-1).push(ptr)
		}
		return ptr
	} catch (e) {
		if (!(e instanceof TypeError)) {
			if (ptr === oldLen) freeFuncIndexes.push(oldLen)
			throw e
		}
	}

	try {
		const fptr = jsFuncToWasm(func, sig)
		ft.set(ptr, fptr)
		if (scoped) scopeCache.at(-1).push(ptr)
	} catch (e) {
		if (ptr === oldLen) freeFuncIndexes.push(oldLen)
		throw e
	}
	return ptr
}

/**
 * @param {Function} func
 * @param {string} sig
 */
export const installFunction = (func, sig) => __installFunction(func, sig, false)

/**
 * @param {Function} func
 * @param {string} sig
 */
export const scopedInstallFunction = (func, sig) => __installFunction(func, sig, true)

/**
 * @param {number} ptr
 */
export const uninstallFunction = (ptr) => {
	if (!ptr && 0 !== ptr) return undefined
	const fi = freeFuncIndexes
	const ft = functionTable()
	fi.push(ptr)
	const rc = ft.get(ptr)
	ft.set(ptr, null)
	return rc
}

export const scopedAllocMainArgv = (list) => {
	const pList = scopedAlloc((list.length + 1) * ptrSizeof)
	let i = 0
	for (const el of list) {
		pokePtr(pList + ptrSizeof * i++, scopedAllocCString(`${el}`))
	}
	pokePtr(pList + ptrSizeof * i, 0)
	return pList
}

/**
 * @param {unknown[]} list
 */
export const allocMainArgv = (list) => {
	const pList = alloc((list.length + 1) * ptrSizeof)
	let i = 0
	for (const el of list) {
		pokePtr(pList + ptrSizeof * i++, allocCString(`${el}`))
	}
	pokePtr(pList + ptrSizeof * i, 0)
	return pList
}

export const cArgvToJs = (argc, pArgv) => {
	const list = []
	for (let i = 0; i < argc; ++i) {
		const arg = peekPtr(pArgv + ptrSizeof * i)
		list.push(arg ? cstrToJs(arg) : null)
	}
	return list
}

/**
 * @param {number} count
 * @param {boolean} safe
 */
const __allocPtr = (count, safe, allocator = alloc) => {
	const pIr = safe ? 'i64' : ptrIR
	const step = safe ? 8 : ptrSizeof
	let m = allocator(count * step)
	poke(m, 0, pIr)
	if (howMany === 1) return m
	const a = [m]
	for (let i = 1; i < howMany; ++i) {
		m += step
		a[i] = m
		poke(m, 0, pIr)
	}
	return a
}

export const allocPtr = (howMany = 1, safePtrSize = true) => __allocPtr(howMany, safePtrSize)

export const scopedAllocPtr = (howMany = 1, safePtrSize = true) => __allocPtr(howMany, safePtrSize, scopedAlloc)

/**
 * @param {string} str
 */
export const jstrlen = (str) => {
	if ('string' !== typeof str) return null
	const n = str.length
	let len = 0
	for (let i = 0; i < n; ++i) {
		let u = str.charCodeAt(i)
		if (u >= 0xd800 && u <= 0xdfff) {
			u = (0x10000 + ((u & 0x3ff) << 10)) | (str.charCodeAt(++i) & 0x3ff)
		}
		if (u <= 0x7f) ++len
		else if (u <= 0x7ff) len += 2
		else if (u <= 0xffff) len += 3
		else len += 4
	}
	return len
}

/**
 * @param {string} jstr
 * @param {Int8Array | Uint8Array} tgt
 */
export const jstrcpy = (jstr, tgt, offset = 0, maxBytes = -1, addNul = true) => {
	if (!tgt || (!(tgt instanceof Int8Array) && !(tgt instanceof Uint8Array))) {
		toss('jstrcpy() target must be an Int8Array or Uint8Array.')
	}
	if (maxBytes < 0) maxBytes = tgt.length - offset
	if (!(maxBytes > 0) || !(offset >= 0)) return 0
	let i = 0,
		max = jstr.length
	const begin = offset,
		end = offset + maxBytes - (addNul ? 1 : 0)
	for (; i < max && offset < end; ++i) {
		let u = jstr.charCodeAt(i)
		if (u >= 0xd800 && u <= 0xdfff) {
			u = (0x10000 + ((u & 0x3ff) << 10)) | (jstr.charCodeAt(++i) & 0x3ff)
		}
		if (u <= 0x7f) {
			if (offset >= end) break
			tgt[offset++] = u
		} else if (u <= 0x7ff) {
			if (offset + 1 >= end) break
			tgt[offset++] = 0xc0 | (u >> 6)
			tgt[offset++] = 0x80 | (u & 0x3f)
		} else if (u <= 0xffff) {
			if (offset + 2 >= end) break
			tgt[offset++] = 0xe0 | (u >> 12)
			tgt[offset++] = 0x80 | ((u >> 6) & 0x3f)
			tgt[offset++] = 0x80 | (u & 0x3f)
		} else {
			if (offset + 3 >= end) break
			tgt[offset++] = 0xf0 | (u >> 18)
			tgt[offset++] = 0x80 | ((u >> 12) & 0x3f)
			tgt[offset++] = 0x80 | ((u >> 6) & 0x3f)
			tgt[offset++] = 0x80 | (u & 0x3f)
		}
	}
	if (addNul) tgt[offset++] = 0
	return offset - begin
}

// prettier-ignore
export {
	alloc, dealloc, realloc,
	heap8, heap8u,
	heap16, heap16u,
	heap32, heap32u, heap32f,
	heap64, heap64u, heap64f, 
	cstrlen, cstrToJs,
}
