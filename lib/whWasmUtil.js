import { getASM, getMemory } from './init.js'
import { xArg, xResult, functionTable, functionEntry } from './binding.js'
import { ptrIR, ptrSizeof } from './constants.js'
import * as util from './util.js'
import * as logger from './logger.js'

const toss = util.toss
const ENCODER = new TextEncoder('utf8')

export function WhWasmUtilInstaller(target) {
	const asm = getASM()
	const mem = getMemory()

	const cache = Object.create(null)

	cache.heapSize = 0
	cache.memory = null
	cache.freeFuncIndexes = []
	cache.scopedAlloc = []

	const heapWrappers = function () {
		if (cache.heapSize === mem.buffer.byteLength) {
			return cache
		}

		const b = mem.buffer
		cache.HEAP8 = new Int8Array(b)
		cache.HEAP8U = new Uint8Array(b)
		cache.HEAP16 = new Int16Array(b)
		cache.HEAP16U = new Uint16Array(b)
		cache.HEAP32 = new Int32Array(b)
		cache.HEAP32U = new Uint32Array(b)
		cache.HEAP64 = new BigInt64Array(b)
		cache.HEAP64U = new BigUint64Array(b)
		cache.HEAP32F = new Float32Array(b)
		cache.HEAP64F = new Float64Array(b)
		cache.heapSize = b.byteLength
		return cache
	}

	target.heap8 = () => heapWrappers().HEAP8
	target.heap8u = () => heapWrappers().HEAP8U
	target.heap16 = () => heapWrappers().HEAP16
	target.heap16u = () => heapWrappers().HEAP16U
	target.heap32 = () => heapWrappers().HEAP32
	target.heap32u = () => heapWrappers().HEAP32U
	target.heapForSize = function (n, unsigned = true) {
		const c = mem && cache.heapSize === mem.buffer.byteLength ? cache : heapWrappers()
		switch (n) {
			case Int8Array:
				return c.HEAP8
			case Uint8Array:
				return c.HEAP8U
			case Int16Array:
				return c.HEAP16
			case Uint16Array:
				return c.HEAP16U
			case Int32Array:
				return c.HEAP32
			case Uint32Array:
				return c.HEAP32U
			case 8:
				return unsigned ? c.HEAP8U : c.HEAP8
			case 16:
				return unsigned ? c.HEAP16U : c.HEAP16
			case 32:
				return unsigned ? c.HEAP32U : c.HEAP32
			case 64:
				if (c.HEAP64) return unsigned ? c.HEAP64U : c.HEAP64
				break
			default:
				if (n === globalThis['BigUint64Array']) return c.HEAP64U
				else if (n === globalThis['BigInt64Array']) return c.HEAP64
				break
		}
		toss('Invalid heapForSize() size: expecting 8, 16, 32,', 'or (if BigInt is enabled) 64.')
	}

	target.jsFuncToWasm = function f(func, sig) {
		if (!f._) {
			f._ = {
				rxJSig: /^(\w)\((\w*)\)$/,
				sigTypes: Object.assign(Object.create(null), { i: 'i32', p: 'i32', P: 'i32', s: 'i32', j: 'i64', f: 'f32', d: 'f64' }),
				typeCodes: Object.assign(Object.create(null), { f64: 0x7c, f32: 0x7d, i64: 0x7e, i32: 0x7f }),
				uleb128Encode: (tgt, method, n) => {
					if (n < 128) tgt[method](n)
					else tgt[method](n % 128 | 128, n >> 7)
				},
				sigParams: (sig) => {
					const m = f._.rxJSig.exec(sig)
					return m ? m[2] : sig.substr(1)
				},
				letterType: (x) => f._.sigTypes[x] || toss('Invalid signature letter:', x),
				pushSigType: (dest, letter) => dest.push(f._.typeCodes[f._.letterType(letter)]),
			}
		}
		if ('string' === typeof func) {
			const x = sig
			sig = func
			func = x
		}
		const sigParams = f._.sigParams(sig)
		const wasmCode = [0x01, 0x60]
		f._.uleb128Encode(wasmCode, 'push', sigParams.length)
		for (const x of sigParams) f._.pushSigType(wasmCode, x)
		if ('v' === sig[0]) wasmCode.push(0)
		else {
			wasmCode.push(1)
			f._.pushSigType(wasmCode, sig[0])
		}
		f._.uleb128Encode(wasmCode, 'unshift', wasmCode.length)
		wasmCode.unshift(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01)
		wasmCode.push(0x02, 0x07, 0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00, 0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00)
		return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(wasmCode)), { e: { f: func } }).exports['f']
	}

	const __installFunction = function f(func, sig, scoped) {
		if (scoped && !cache.scopedAlloc.length) {
			toss('No scopedAllocPush() scope is active.')
		}
		if ('string' === typeof func) {
			const x = sig
			sig = func
			func = x
		}
		if ('string' !== typeof sig || !(func instanceof Function)) {
			toss('Invalid arguments: expecting (function,signature) ' + 'or (signature,function).')
		}
		const ft = functionTable()
		const oldLen = ft.length
		let ptr
		while (cache.freeFuncIndexes.length) {
			ptr = cache.freeFuncIndexes.pop()
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
				cache.scopedAlloc[cache.scopedAlloc.length - 1].push(ptr)
			}
			return ptr
		} catch (e) {
			if (!(e instanceof TypeError)) {
				if (ptr === oldLen) cache.freeFuncIndexes.push(oldLen)
				throw e
			}
		}

		try {
			const fptr = target.jsFuncToWasm(func, sig)
			ft.set(ptr, fptr)
			if (scoped) {
				cache.scopedAlloc[cache.scopedAlloc.length - 1].push(ptr)
			}
		} catch (e) {
			if (ptr === oldLen) cache.freeFuncIndexes.push(oldLen)
			throw e
		}
		return ptr
	}

	target.installFunction = (func, sig) => __installFunction(func, sig, false)
	target.scopedInstallFunction = (func, sig) => __installFunction(func, sig, true)
	target.uninstallFunction = function (ptr) {
		if (!ptr && 0 !== ptr) return undefined
		const fi = cache.freeFuncIndexes
		const ft = functionTable()
		fi.push(ptr)
		const rc = ft.get(ptr)
		ft.set(ptr, null)
		return rc
	}

	target.peek = function f(ptr, type = 'i8') {
		if (type.endsWith('*')) type = ptrIR
		const c = mem && cache.heapSize === mem.buffer.byteLength ? cache : heapWrappers()
		const list = Array.isArray(ptr) ? [] : undefined
		let rc
		do {
			if (list) ptr = arguments[0].shift()
			switch (type) {
				case 'i1':
				case 'i8':
					rc = c.HEAP8[ptr >> 0]
					break
				case 'i16':
					rc = c.HEAP16[ptr >> 1]
					break
				case 'i32':
					rc = c.HEAP32[ptr >> 2]
					break
				case 'float':
				case 'f32':
					rc = c.HEAP32F[ptr >> 2]
					break
				case 'double':
				case 'f64':
					rc = Number(c.HEAP64F[ptr >> 3])
					break
				case 'i64':
					rc = BigInt(c.HEAP64[ptr >> 3])
					break
				default:
					toss('Invalid type for peek():', type)
			}
			if (list) list.push(rc)
		} while (list && arguments[0].length)
		return list || rc
	}

	target.poke = function (ptr, value, type = 'i8') {
		if (type.endsWith('*')) type = ptrIR
		const c = mem && cache.heapSize === mem.buffer.byteLength ? cache : heapWrappers()
		for (const p of Array.isArray(ptr) ? ptr : [ptr]) {
			switch (type) {
				case 'i1':
				case 'i8':
					c.HEAP8[p >> 0] = value
					continue
				case 'i16':
					c.HEAP16[p >> 1] = value
					continue
				case 'i32':
					c.HEAP32[p >> 2] = value
					continue
				case 'float':
				case 'f32':
					c.HEAP32F[p >> 2] = value
					continue
				case 'double':
				case 'f64':
					c.HEAP64F[p >> 3] = value
					continue
				case 'i64':
					if (c.HEAP64) {
						c.HEAP64[p >> 3] = BigInt(value)
						continue
					}

				default:
					toss('Invalid type for poke(): ' + type)
			}
		}
		return this
	}

	target.peekPtr = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, ptrIR)
	target.pokePtr = (ptr, value = 0) => target.poke(ptr, value, ptrIR)
	target.peek8 = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'i8')
	target.poke8 = (ptr, value) => target.poke(ptr, value, 'i8')
	target.peek16 = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'i16')
	target.poke16 = (ptr, value) => target.poke(ptr, value, 'i16')
	target.peek32 = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'i32')
	target.poke32 = (ptr, value) => target.poke(ptr, value, 'i32')
	target.peek64 = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'i64')
	target.poke64 = (ptr, value) => target.poke(ptr, value, 'i64')
	target.peek32f = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'f32')
	target.poke32f = (ptr, value) => target.poke(ptr, value, 'f32')
	target.peek64f = (...ptr) => target.peek(1 === ptr.length ? ptr[0] : ptr, 'f64')
	target.poke64f = (ptr, value) => target.poke(ptr, value, 'f64')
	target.getMemValue = target.peek
	target.getPtrValue = target.peekPtr
	target.setMemValue = target.poke
	target.setPtrValue = target.pokePtr

	target.cstrlen = function (ptr) {
		if (!ptr || !util.isPtr(ptr)) return null
		const h = heapWrappers().HEAP8U
		let pos = ptr
		for (; h[pos] !== 0; ++pos) {}
		return pos - ptr
	}

	target.cstrToJs = function (ptr) {
		const n = target.cstrlen(ptr)
		return n ? util.typedArrayToString(heapWrappers().HEAP8U, ptr, ptr + n) : null === n ? n : ''
	}

	target.cstrncpy = function (tgtPtr, srcPtr, n) {
		if (!tgtPtr || !srcPtr) toss('cstrncpy() does not accept NULL strings.')
		if (n < 0) n = target.cstrlen(strPtr) + 1
		else if (!(n > 0)) return 0
		const heap = target.heap8u()
		let i = 0,
			ch
		for (; i < n && (ch = heap[srcPtr + i]); ++i) {
			heap[tgtPtr + i] = ch
		}
		if (i < n) heap[tgtPtr + i++] = 0
		return i
	}

	const __allocCStr = function (jstr, returnWithLength, allocator, funcName) {
		if ('string' !== typeof jstr) return null
		{
			const u = ENCODER.encode(jstr),
				ptr = allocator(u.length + 1),
				heap = heapWrappers().HEAP8U
			heap.set(u, ptr)
			heap[ptr + u.length] = 0
			return returnWithLength ? [ptr, u.length] : ptr
		}
	}

	target.scopedAllocPush = function () {
		const a = []
		cache.scopedAlloc.push(a)
		return a
	}

	target.scopedAllocPop = function (state) {
		const n = arguments.length ? cache.scopedAlloc.indexOf(state) : cache.scopedAlloc.length - 1
		if (n < 0) toss('Invalid state object for scopedAllocPop().')
		if (0 === arguments.length) state = cache.scopedAlloc[n]
		cache.scopedAlloc.splice(n, 1)
		for (let p; (p = state.pop()); ) {
			if (functionEntry(p)) {
				target.uninstallFunction(p)
			} else target.dealloc(p)
		}
	}

	target.scopedAlloc = function (n) {
		if (!cache.scopedAlloc.length) {
			toss('No scopedAllocPush() scope is active.')
		}
		const p = target.alloc(n)
		cache.scopedAlloc[cache.scopedAlloc.length - 1].push(p)
		return p
	}

	Object.defineProperty(target.scopedAlloc, 'level', {
		configurable: false,
		enumerable: false,
		get: () => cache.scopedAlloc.length,
		set: () => toss("The 'active' property is read-only."),
	})

	target.scopedAllocCString = (jstr, returnWithLength = false) => __allocCStr(jstr, returnWithLength, target.scopedAlloc, 'scopedAllocCString()')

	const __allocMainArgv = function (isScoped, list) {
		const pList = target[isScoped ? 'scopedAlloc' : 'alloc']((list.length + 1) * target.ptrSizeof)
		let i = 0
		list.forEach((e) => {
			target.pokePtr(pList + target.ptrSizeof * i++, target[isScoped ? 'scopedAllocCString' : 'allocCString']('' + e))
		})
		target.pokePtr(pList + target.ptrSizeof * i, 0)
		return pList
	}

	target.scopedAllocMainArgv = (list) => __allocMainArgv(true, list)

	target.allocMainArgv = (list) => __allocMainArgv(false, list)

	target.cArgvToJs = (argc, pArgv) => {
		const list = []
		for (let i = 0; i < argc; ++i) {
			const arg = target.peekPtr(pArgv + target.ptrSizeof * i)
			list.push(arg ? target.cstrToJs(arg) : null)
		}
		return list
	}

	target.scopedAllocCall = function (func) {
		target.scopedAllocPush()
		try {
			return func()
		} finally {
			target.scopedAllocPop()
		}
	}

	const __allocPtr = function (howMany, safePtrSize, method) {
		const pIr = safePtrSize ? 'i64' : ptrIR
		let m = target[method](howMany * (safePtrSize ? 8 : ptrSizeof))
		target.poke(m, 0, pIr)
		if (1 === howMany) {
			return m
		}
		const a = [m]
		for (let i = 1; i < howMany; ++i) {
			m += safePtrSize ? 8 : ptrSizeof
			a[i] = m
			target.poke(m, 0, pIr)
		}
		return a
	}

	target.allocPtr = (howMany = 1, safePtrSize = true) => __allocPtr(howMany, safePtrSize, 'alloc')

	target.scopedAllocPtr = (howMany = 1, safePtrSize = true) => __allocPtr(howMany, safePtrSize, 'scopedAlloc')

	target.xGet = function (name) {
		return asm[name] || toss('Cannot find exported symbol:', name)
	}

	const __argcMismatch = (f, n) => toss(f + '() requires', n, 'argument(s).')

	target.xCall = function (fname, ...args) {
		const f = target.xGet(fname)
		if (!(f instanceof Function)) toss('Exported symbol', fname, 'is not a function.')
		if (f.length !== args.length) __argcMismatch(fname, f.length)
		return 2 === arguments.length && Array.isArray(arguments[1]) ? f.apply(null, arguments[1]) : f.apply(null, args)
	}

	cache.xWrap = Object.create(null)
	cache.xWrap.convert = Object.create(null)
	cache.xWrap.convert.arg = xArg
	cache.xWrap.convert.result = xResult

	const __xArgPtr = (i) => i | 0
	const __xArgString = function (v) {
		if ('string' === typeof v) return target.scopedAllocCString(v)
		return v ? __xArgPtr(v) : null
	}
	xArg.set('string', __xArgString).set('utf8', __xArgString).set('pointer', __xArgString)

	xResult
		.set('string', (i) => target.cstrToJs(i))
		.set('utf8', xResult.get('string'))
		.set('string:dealloc', (i) => {
			try {
				return i ? target.cstrToJs(i) : null
			} finally {
				target.dealloc(i)
			}
		})
		.set('utf8:dealloc', xResult.get('string:dealloc'))
		.set('json', (i) => JSON.parse(target.cstrToJs(i)))
		.set('json:dealloc', (i) => {
			try {
				return i ? JSON.parse(target.cstrToJs(i)) : null
			} finally {
				target.dealloc(i)
			}
		})

	class AbstractArgAdapter {
		constructor(opt) {
			this.name = opt.name || 'unnamed adapter'
		}

		convertArg(v, argv, argIndex) {
			toss('AbstractArgAdapter must be subclassed.')
		}
	}

	xArg.FuncPtrAdapter = class FuncPtrAdapter extends AbstractArgAdapter {
		constructor(opt) {
			super(opt)
			if (xArg.FuncPtrAdapter.warnOnUse) {
				logger.warn('xArg.FuncPtrAdapter is an internal-only API and is not intended to be invoked from client-level code. Invoked with:', opt)
			}
			this.name = opt.name || 'unnamed'
			this.signature = opt.signature
			if (opt.contextKey instanceof Function) {
				this.contextKey = opt.contextKey
				if (!opt.bindScope) opt.bindScope = 'context'
			}
			this.bindScope = opt.bindScope || toss('FuncPtrAdapter options requires a bindScope (explicit or implied).')
			if (FuncPtrAdapter.bindScopes.indexOf(opt.bindScope) < 0) {
				toss(`Invalid options.bindScope (${opt.bindMod}) for FuncPtrAdapter. Expecting one of: (${FuncPtrAdapter.bindScopes.join(', ')})`)
			}
			this.isTransient = 'transient' === this.bindScope
			this.isContext = 'context' === this.bindScope
			this.isPermanent = 'permanent' === this.bindScope
			this.singleton = 'singleton' === this.bindScope ? [] : undefined
			this.callProxy = opt.callProxy instanceof Function ? opt.callProxy : undefined
		}

		contextKey(argv, argIndex) {
			return this
		}

		contextMap(key) {
			const cm = this.__cmap || (this.__cmap = new Map())
			let rc = cm.get(key)
			if (undefined === rc) cm.set(key, (rc = []))
			return rc
		}

		convertArg(v, argv, argIndex) {
			let pair = this.singleton
			if (!pair && this.isContext) {
				pair = this.contextMap(this.contextKey(argv, argIndex))
			}
			if (pair && pair[0] === v) return pair[1]
			if (v instanceof Function) {
				if (this.callProxy) v = this.callProxy(v)
				const fp = __installFunction(v, this.signature, this.isTransient)
				if (pair) {
					if (pair[1]) {
						try {
							cache.scopedAlloc[cache.scopedAlloc.length - 1].push(pair[1])
						} catch (e) {}
					}
					pair[0] = v
					pair[1] = fp
				}
				return fp
			} else if (util.isPtr(v) || null === v || undefined === v) {
				if (pair && pair[1] && pair[1] !== v) {
					try {
						cache.scopedAlloc[cache.scopedAlloc.length - 1].push(pair[1])
					} catch (e) {}
					pair[0] = pair[1] = v | 0
				}
				return v || 0
			} else {
				throw new TypeError(
					'Invalid FuncPtrAdapter argument type. ' +
						'Expecting a function pointer or a ' +
						(this.name ? this.name + ' ' : '') +
						'function matching signature ' +
						this.signature +
						'.'
				)
			}
		}
	}

	xArg.FuncPtrAdapter.warnOnUse = false
	xArg.FuncPtrAdapter.debugOut = logger.debug
	xArg.FuncPtrAdapter.bindScopes = ['transient', 'context', 'singleton', 'permanent']

	const __xArgAdapterCheck = (t) => xArg.get(t) || toss('Argument adapter not found:', t)
	const __xResultAdapterCheck = (t) => xResult.get(t) || toss('Result adapter not found:', t)

	cache.xWrap.convertArg = (t, ...args) => __xArgAdapterCheck(t)(...args)
	cache.xWrap.convertArgNoCheck = (t, ...args) => xArg.get(t)(...args)
	cache.xWrap.convertResult = (t, v) => (null === t ? v : t ? __xResultAdapterCheck(t)(v) : undefined)
	cache.xWrap.convertResultNoCheck = (t, v) => (null === t ? v : t ? xResult.get(t)(v) : undefined)

	target.xWrap = function (fArg, resultType, ...argTypes) {
		if (3 === arguments.length && Array.isArray(arguments[2])) {
			argTypes = arguments[2]
		}
		if (util.isPtr(fArg)) {
			fArg = functionEntry(fArg) || toss('Function pointer not found in WASM function table.')
		}
		const fIsFunc = fArg instanceof Function
		const xf = fIsFunc ? fArg : target.xGet(fArg)
		if (fIsFunc) fArg = xf.name || 'unnamed function'
		if (argTypes.length !== xf.length) __argcMismatch(fArg, xf.length)
		if (null === resultType && 0 === xf.length) {
			return xf
		}
		if (undefined !== resultType && null !== resultType) __xResultAdapterCheck(resultType)
		for (const t of argTypes) {
			if (t instanceof AbstractArgAdapter) xArg.set(t, (...args) => t.convertArg(...args))
			else __xArgAdapterCheck(t)
		}
		const cxw = cache.xWrap
		if (0 === xf.length) {
			return (...args) => (args.length ? __argcMismatch(fArg, xf.length) : cxw.convertResult(resultType, xf.call(null)))
		}
		return function (...args) {
			if (args.length !== xf.length) __argcMismatch(fArg, xf.length)
			const scope = target.scopedAllocPush()
			try {
				for (const i in args) args[i] = cxw.convertArgNoCheck(argTypes[i], args[i], args, i)
				return cxw.convertResultNoCheck(resultType, xf.apply(null, args))
			} finally {
				target.scopedAllocPop(scope)
			}
		}
	}

	const __xAdapter = function (func, argc, typeName, adapter, modeName, xcvPart) {
		if ('string' === typeof typeName) {
			if (1 === argc) return xcvPart.get(typeName)
			else if (2 === argc) {
				if (!adapter) {
					delete xcvPart.get(typeName)
					return func
				} else if (!(adapter instanceof Function)) {
					toss(modeName, 'requires a function argument.')
				}
				xcvPart.set(typeName, adapter)
				return func
			}
		}
		toss('Invalid arguments to', modeName)
	}

	target.xWrap.resultAdapter = function f(typeName, adapter) {
		return __xAdapter(f, arguments.length, typeName, adapter, 'resultAdapter()', xResult)
	}

	target.xWrap.argAdapter = function f(typeName, adapter) {
		return __xAdapter(f, arguments.length, typeName, adapter, 'argAdapter()', xArg)
	}

	target.xWrap.FuncPtrAdapter = xArg.FuncPtrAdapter

	target.xCallWrapped = function (fArg, resultType, argTypes, ...args) {
		if (Array.isArray(arguments[3])) args = arguments[3]
		return target.xWrap(fArg, resultType, argTypes || []).apply(null, args || [])
	}

	target.xWrap.testConvertArg = cache.xWrap.convertArg
	target.xWrap.testConvertResult = cache.xWrap.convertResult

	return target
}