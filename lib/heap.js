import { getASM, getMemory as mem } from './instance.js'
import { ptrIR, ptrSizeof } from './constants.js'
import { heap as HEAP8U, cstrlen, cstrToJs, alloc, dealloc, realloc, sqliteError } from './base.js'
import { abort, isBindableTypedArray } from './util.js'

const ENCODER = new TextEncoder('utf8')

/** @type {number[][]} */
export const scopeCache = []

/** @type {number[]} */
const freeFuncIndexes = []

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
				abort(`Invalid type for peek(): ${type}`)
		}
		if (list) list.push(rc)
	} while (list && arguments[0].length)
	return list || rc
}

export const poke = (ptr, value, type = 'i8') => {
	if (type.endsWith('*')) type = ptrIR
	for (const p of Array.isArray(ptr) ? ptr : [ptr]) {
		switch (type) {
			case 'i1':
			case 'i8':
				HEAP8()[p >> 0] = value
				continue
			case 'i16':
				HEAP16()[p >> 1] = value
				continue
			case 'i32':
				HEAP32()[p >> 2] = value
				continue
			case 'float':
			case 'f32':
				HEAP32F()[p >> 2] = value
				continue
			case 'double':
			case 'f64':
				HEAP64F()[p >> 3] = value
				continue
			case 'i64':
				HEAP64()[p >> 3] = BigInt(value)
				continue
			default:
				abort(`Invalid type for poke(): ${type}`)
		}
	}
}

export const peekPtr = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, ptrIR)

export const pokePtr = (ptr, value = 0) => poke(ptr, value, ptrIR)

export const peek8 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i8')
export const poke8 = (ptr, value) => poke(ptr, value, 'i8')
export const peek16 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i16')
export const poke16 = (ptr, value) => poke(ptr, value, 'i16')
export const peek32 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i32')
export const poke32 = (ptr, value) => poke(ptr, value, 'i32')
export const peek64 = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'i64')
export const poke64 = (ptr, value) => poke(ptr, value, 'i64')
export const peek32f = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'f32')
export const poke32f = (ptr, value) => poke(ptr, value, 'f32')
export const peek64f = (...ptr) => peek(1 === ptr.length ? ptr[0] : ptr, 'f64')

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
	return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(wasmCode)), { e: { f: func } }).exports['f']
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
}

export const allocPtr = (count = 1, safe = true) => __allocPtr(count, safe)

export const scopedAllocPtr = (count = 1, safe = true) => __allocPtr(count, safe, scopedAlloc)

export { alloc, dealloc, realloc, HEAP8U }
