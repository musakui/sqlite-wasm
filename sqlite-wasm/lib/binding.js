import { HAS_BIGINT, ptrIR } from './constants.js'
import { getASM, structs } from './base.js'
import { abort } from './util.js'
import * as util from './util.js'
import * as heap from './heap.js'

const BINDSCOPE_CONTEXT = 'context'
const BINDSCOPE_PERMANENT = 'permanent'
const BINDSCOPE_SINGLETON = 'singleton'
const BINDSCOPE_TRANSIENT = 'transient'

const bindScopes = [BINDSCOPE_CONTEXT, BINDSCOPE_PERMANENT, BINDSCOPE_SINGLETON, BINDSCOPE_TRANSIENT]

const __xIdent = (v) => v
const __xInt = (v) => v | 0
const __xFloat = (v) => parseFloat(v)

const __xArgStr = (v) => {
	if (typeof v === 'string') return heap.scopedAllocCString(v)
	return v ? __xInt(v) : null
}

const __xWithFree = (fn) => (v) => {
	try {
		return v ? fn(v) : null
	} finally {
		heap.dealloc(i)
	}
}

const __xResultStr = (v) => heap.cstrToJs(v)
const __xResultStrFree = __xWithFree(__xResultStr)
const __xJSON = (v) => JSON.parse(heap.cstrToJs(v))

const shared = {
	i8: (i) => (i | 0) & 0xff,
	i16: (i) => (i | 0) & 0xffff,
	i32: __xInt,
	int: __xInt,
	f32: __xFloat,
	f64: __xFloat,
	float: __xFloat,
	double: __xFloat,
	...(HAS_BIGINT ? { i64: BigInt } : null),
}

const special = [
	['*', __xInt],
	[null, __xIdent],
	['null', __xIdent],
	['void*', __xInt],
	['sqlite3_value*', __xInt],
]

const static_string_cache = Object.create(null)
const __xArgStaticString = (v) => {
	if (util.isPtr(v)) return v
	const k = '' + v
	if (!static_string_cache[k]) {
		static_string_cache[k] = heap.allocCString(k)
	}
	return static_string_cache[k]
}

export const flexibleString = (v) => {
	if (v instanceof ArrayBuffer) return util.bufToString(v)
	if (util.isSQLableTypedArray(v)) return util.typedArrayToString(v)
	if (Array.isArray(v)) return v.join('')
	return util.isPtr(v) ? heap.cstrToJs(v) : v
}

/**
 * @param {string} name
 */
export const xGet = (name) => getASM()[name] ?? abort(`no such symbol ${name}`)

export const xArg = new Map([
	...special,
	['**', __xInt],
	['utf8', __xArgStr],
	['string', __xArgStr],
	['pointer', __xArgStr],
	['sqlite3_filename', __xInt],
	['sqlite3_stmt*', __xInt],
	['sqlite3_session*', __xInt],
	['sqlite3_context*', __xInt],
	['sqlite3_changegroup*', __xInt],
	['sqlite3_changeset_iter*', __xInt],
	['string:static', __xArgStaticString],
	['string:flexible', (v) => __xArgStr(flexibleString(v))],
	['sqlite3_module*', (v) => __xInt(v instanceof structs.sqlite3_module ? v.pointer : v)],
	['sqlite3_index_info*', (v) => __xInt(v instanceof structs.sqlite3_index_info ? v.pointer : v)],
	...Object.entries(shared),
])

export const xResult = new Map([
	...special,
	['number', Number],
	['json', __xJSON],
	['utf8', __xResultStr],
	['string', __xResultStr],
	['utf8:dealloc', __xResultStrFree],
	['string:dealloc', __xResultStrFree],
	['json:dealloc', __xWithFree(__xJSON)],
	['pointer', __xInt],
	['sqlite3*', __xInt],
	['sqlite3_vfs*', __xInt],
	['sqlite3_stmt*', __xInt],
	['sqlite3_context*', __xInt],
	['void', () => undefined],
	...Object.entries(shared),
])

/** @param {Function} fn */
const __argMismatch = (fn) => abort(`${fn.name || 'func'} requires ${fn.length} arg(s)`)

/**
 * @param {unknown} resultType
 * @param {unknown[]} argTypes
 */
const checkArgs = (resultType, argTypes) => {
	if (resultType !== undefined && !xResult.has(resultType)) {
		// add resulttype or throw
	}

	for (const t of argTypes) {
		if (xArg.has(t)) continue
		if (t instanceof AbstractArgAdapter) {
			xArg.set(t, (...args) => t.convertArg(...args))
			continue
		}
		// invalid ?
	}
}

/**
 * @param {Function} func
 * @param {unknown} resultType
 * @param {unknown[]} argTypes
 */
const __wrapFunction = (func, resultType, argTypes) => {
	const xlen = func.length
	if (argTypes.length !== xlen) __argMismatch(func)

	if (resultType === null && !xlen) return func

	return (...args) => {
		if (args.length !== xlen) __argMismatch(func)
		const scope = heap.scopedAllocPush()
		try {
			const cva = argTypes.map((t, i) => xArg.get(t)(args[i], args, i))
			const result = func(...cva)
			if (resultType === null) return result
			if (resultType) return xResult.get(resultType)(result)
		} finally {
			heap.scopedAllocPop(scope)
		}
	}
}

/** @typedef {import('./types').ArgTypes} ArgTypes */
/** @typedef {import('./types').ResultTypeMap} ResultTypeMap */

/**
 * wrap an exported function by name
 *
 * the creation is deferred until the first call
 *
 * @template {ArgTypes} P
 * @template {keyof ResultTypeMap | null | undefined} R
 * @param {string} name name of exported function
 * @param {R} resultType return type
 * @param {P} argTypes parameter types
 */
export const __wrapASM = (name, resultType, ...argTypes) => {
	checkArgs(resultType, argTypes)

	let fn

	const wrapped = (...args) => {
		if (!fn) {
			fn = __wrapFunction(xGet(name), resultType, argTypes)
		}
		return fn(...args)
	}
	Object.defineProperty(wrapped, 'name', { value: name })

	return /** @type {(...args: import('./types').MappedArgs<P>) => R extends undefined ? void : ResultTypeMap[R]} */ (wrapped)
}

/**
 * @param {...unknown} args
 */
export const xWrap = (...args) => {
	let [fArg, resultType, ...argTypes] = args
	if (args.length === 3 && Array.isArray(args[2])) {
		argTypes = args[2]
	}
	if (util.isPtr(fArg)) {
		fArg = heap.functionEntry(fArg) || abort('func ptr not found in Table')
	}
	const xf = util.isFunction(fArg) ? fArg : xGet(fArg)
	return __wrapFunction(xf, resultType, argTypes)
}

export const xCall = (fname, ...args) => {
	const fn = xGet(fname)
	if (!util.isFunction(fn)) abort(`'${fname}' is not a function`)
	if (fn.length !== args.length) abort(`'${fname}' needs ${fn.length} arg(s)`)
	return 1 === args.length && Array.isArray(args[0]) ? fn(args[0]) : fn(args)
}

const adaptPtr = xArg.get(ptrIR)
for (const t of Object.keys(shared)) {
	const k = `${t}*`
	xArg.set(k, adaptPtr)
	xResult.set(k, adaptPtr)
}

/*
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
*/

/**
 * @abstract
 * @template {unknown} [T=unknown]
 */
export class AbstractArgAdapter {
	/** @type {string} */
	name

	constructor(opts) {
		this.name = opts?.name ?? 'unnamed'
	}

	/**
	 * @abstract
	 * @param {unknown} v
	 * @param {unknown[]} argv
	 * @param {number} idx
	 */
	convertArg(v, argv, idx) {
		abort('should be subclassed')
	}
}

export class BaseFuncPtrAdapter extends AbstractArgAdapter {
	/** @type {Function | undefined} */
	callProxy

	/** @type {string} */
	signature

	constructor(opts) {
		super(opts)
		if (typeof opts?.signature === 'string') {
			this.signature = opts.signature
		} else {
			abort(`signature is required`)
		}

		if (util.isFunction(opts?.callProxy)) {
			this.callProxy = opts.callProxy
		}
	}
}

/**
 * @template {Function} [T=Function]
 * @extends {BaseFuncPtrAdapter<T>}
 */
export class ContextFuncPtrAdapter extends BaseFuncPtrAdapter {
	/** @type {Function} */
	contextKey = () => this

	constructor(opts) {
		super(opts)
		if (util.isFunction(opts?.contextKey)) {
			this.contextKey = opts.contextKey
		}
		this.installFunction = (v) => heap.__installFunction(v, signature, isTransient)
	}
}

/**
 * @template {Function} [T=Function]
 * @extends {BaseFuncPtrAdapter<T>}
 */
export class FuncPtrAdapter extends BaseFuncPtrAdapter {
	/** @type {Map<string, unknown[]>} */
	#cmap = new Map()

	constructor(opt) {
		super(opt)

		let bindScope = opt.bindScope

		if (opt.contextKey instanceof Function) {
			this.contextKey = opt.contextKey
			if (!bindScope) {
				bindScope = BINDSCOPE_CONTEXT
			}
		} else {
			this.contextKey = () => this
		}

		if (bindScopes.indexOf(bindScope) < 0) abort(`Invalid bindScope`)

		this.isContext = bindScope === BINDSCOPE_CONTEXT
		const isTransient = bindScope === BINDSCOPE_TRANSIENT
		this.singleton = bindScope === BINDSCOPE_SINGLETON ? [] : undefined
		this.installFunction = (v) => heap.__installFunction(v, this.signature, isTransient)
	}

	/** @param {string} key */
	contextMap(key) {
		const cm = this.#cmap
		if (!cm.has(key)) cm.set(key, [])
		return cm.get(key)
	}

	/**
	 * @param {Function | number | null | undefined} v
	 * @param {unknown[]} argv
	 * @param {number} argIndex
	 */
	convertArg(v, argv, argIndex) {
		let pair = this.singleton
		if (!pair && this.isContext) {
			pair = this.contextMap(this.contextKey(argv, argIndex))
		}
		if (pair && pair[0] === v) return pair[1]
		if (v instanceof Function) {
			if (this.callProxy) v = this.callProxy(v)
			const fp = this.installFunction(v)
			if (pair) {
				if (pair[1]) {
					try {
						heap.scopeCache.at(-1).push(pair[1])
					} catch (e) {}
				}
				pair[0] = v
				pair[1] = fp
			}
		} else if (util.isPtr(v) || v === null || v === undefined) {
			if (pair && pair[1] && pair[1] !== v) {
				try {
					heap.scopeCache.at(-1).push(pair[1])
				} catch (e) {}
				pair[0] = pair[1] = v | 0
			}
			return v || 0
		}
		return abort('invalid argument type')
	}
}
