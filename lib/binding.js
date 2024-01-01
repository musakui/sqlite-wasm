import { ptrIR } from './constants.js'
import { getASM } from './instance.js'
import { capi, structs, C_API } from './base.js'
import { abort } from './util.js'
import * as util from './util.js'
import * as heap from './heap.js'

const __xIdent = (v) => v
const __xArgInt = (v) => v | 0
const __xArgFloat = (v) => parseFloat(v)
const __xArgStr = (v) => heap.cstrToJs(v)
const __xArgJSON = (v) => JSON.parse(heap.cstrToJs(v))

const __xArgString = (v) => {
	if (typeof v === 'string') return heap.scopedAllocCString(v)
	return v ? __xArgInt(v) : null
}

const __xArgWithFree = (fn) => (v) => {
	try {
		return v ? fn(v) : null
	} finally {
		heap.dealloc(i)
	}
}

const __xArgStrFree = __xArgWithFree(__xArgStr)

const shared = {
	i8: (i) => (i | 0) & 0xff,
	i16: (i) => (i | 0) & 0xffff,
	i32: __xArgInt,
	i64: BigInt,
	int: __xArgInt,
	f32: __xArgFloat,
	f64: __xArgFloat,
	float: __xArgFloat,
	double: __xArgFloat,
}

const special = [
	['*', __xArgInt],
	[null, __xIdent],
	['null', __xIdent],
	['void*', __xArgInt],
	['sqlite3_value*', __xArgInt],
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

export const xGet = (name) => getASM()[name] ?? abort(`no such symbol ${name}`)

export const xArg = new Map([
	...special,
	['**', __xArgInt],
	['utf8', __xArgString],
	['string', __xArgString],
	['pointer', __xArgString],
	['sqlite3_filename', __xArgInt],
	['sqlite3_session*', __xArgInt],
	['sqlite3_context*', __xArgInt],
	['sqlite3_changegroup*', __xArgInt],
	['sqlite3_changeset_iter*', __xArgInt],
	['string:static', __xArgStaticString],
	['string:flexible', (v) => __xArgString(flexibleString(v))],
	['sqlite3_module*', (v) => __xArgInt(v instanceof structs.sqlite3_module ? v.pointer : v)],
	['sqlite3_index_info*', (v) => __xArgInt(v instanceof structs.sqlite3_index_info ? v.pointer : v)],
	[
		'sqlite3_vfs*',
		(v) => {
			if ('string' === typeof v) return capi.sqlite3_vfs_find(v) || sqliteError(C_API.SQLITE_NOTFOUND, `Unknown sqlite3_vfs name ${v}`)
			return __xArgInt(v instanceof structs.sqlite3_vfs ? v.pointer : v)
		},
	],
	...Object.entries(shared),
])

export const xResult = new Map([
	...special,
	['number', Number],
	['utf8', __xArgStr],
	['json', __xArgJSON],
	['string', __xArgStr],
	['utf8:dealloc', __xArgStrFree],
	['string:dealloc', __xArgStrFree],
	['json:dealloc', __xArgWithFree(__xArgJSON)],
	['pointer', __xArgInt],
	['sqlite3*', __xArgInt],
	['sqlite3_vfs*', __xArgInt],
	['sqlite3_stmt*', __xArgInt],
	['sqlite3_context*', __xArgInt],
	['void', () => undefined],
	...Object.entries(shared),
])

/** @param {Function} fn */
const __argMismatch = (fn) => abort(`${fn.name || 'func'} requires ${fn.length} arg(s)`)

const parseArgs = (args) => {
	let [fArg, resultType, ...argTypes] = args
	if (args.length === 3 && Array.isArray(args[2])) {
		argTypes = args[2]
	}
	if (util.isPtr(fArg)) {
		fArg = heap.functionEntry(fArg) || abort('func ptr not found in Table')
	}
	const xf = util.isFunction(fArg) ? fArg : xGet(fArg)
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

	if (resultType !== undefined && !xResult.has(resultType)) {
		// add resulttype or throw
	}

	for (const t of argTypes) {
		if (xArg.has(t)) continue
		// if abstractargadapter set xarg
	}

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

/** @typedef {import('./types').ArgTypeName} ArgTypeName */
/** @typedef {import('./types').ResultTypeMap} ResultTypeMap */

/**
 * wrap an exported function by name
 *
 * the creation is deferred until the first call
 *
 * @template {ArgTypeName[]} P
 * @template {keyof ResultTypeMap | null | undefined} R
 * @param {string} name name of exported function
 * @param {R | undefined} resultType return type
 * @param {P} argTypes parameter types
 */
export const xWrapASM = (name, resultType, ...argTypes) => {
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
export const xWrap = (...args) => {}

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
