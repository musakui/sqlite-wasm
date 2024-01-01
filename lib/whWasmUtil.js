import { xGet, xCall, xArg, xResult, AbstractArgAdapter, FuncPtrAdapter } from './binding.js'
import * as heap from './heap.js'
import * as util from './util.js'

const toss = util.toss

export function WhWasmUtilInstaller(target) {
	const cache = Object.create(null)
	cache.xWrap = Object.assign(Object.create(null), {
		convert: Object.assign(Object.create(null), {
			arg: xArg,
			result: xResult,
		}),
	})
	target.xGet = xGet
	target.xCall = xCall

	const __argcMismatch = (f, n) => toss(f + '() requires', n, 'argument(s).')

	xArg.FuncPtrAdapter = FuncPtrAdapter 

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
			fArg = heap.functionEntry(fArg) || toss('Function pointer not found in WASM function table.')
		}
		const fIsFunc = fArg instanceof Function
		const xf = fIsFunc ? fArg : xGet(fArg)
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
			const scope = heap.scopedAllocPush()
			try {
				for (const i in args) args[i] = cxw.convertArgNoCheck(argTypes[i], args[i], args, i)
				return cxw.convertResultNoCheck(resultType, xf.apply(null, args))
			} finally {
				heap.scopedAllocPop(scope)
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