import { getASM } from './instance.js'
import { capi, structs, cstrToJs, C_API } from './base.js'
import { ptrIR } from './constants.js'
import { scopedAllocPop, scopedAllocPush, allocCString, dealloc, scopedAllocCString, functionEntry } from './heap.js'
import { abort, isPtr, isFunction, isSQLableTypedArray, bufToString, typedArrayToString } from './util.js'

const __xIdent = (v) => v
const __xArgInt = (v) => v | 0
const __xArgFloat = (v) => parseFloat(v)
const __xArgStr = (v) => cstrToJs(v)
const __xArgJSON = (v) => JSON.parse(cstrToJs(v))
const __xArgString = (v) => {
	if (typeof v === 'string') return scopedAllocCString(v)
	return v ? __xArgInt(v) : null
}

const __xArgWithFree = (fn) => (v) => {
	try {
		return v ? fn(v) : null
	} finally {
		dealloc(i)
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
	if (isPtr(v)) return v
	const k = '' + v
	if (!static_string_cache[k]) {
		static_string_cache[k] = allocCString(k)
	}
	return static_string_cache[k]
}

export const flexibleString = function (v) {
	if (v instanceof ArrayBuffer) return bufToString(v)
	if (isSQLableTypedArray(v)) return typedArrayToString(v)
	if (Array.isArray(v)) return v.join('')
	return isPtr(v) ? cstrToJs(v) : v
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
	['sqlite3_vfs*', (v) => {
		if ('string' === typeof v) return capi.sqlite3_vfs_find(v) || sqliteError(C_API.SQLITE_NOTFOUND, `Unknown sqlite3_vfs name ${v}`)
		return __xArgInt(v instanceof structs.sqlite3_vfs ? v.pointer : v)
	}],
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
	if (isPtr(fArg)) {
		fArg = functionEntry(fArg) || abort('func ptr not found in Table')
	}
	const xf = isFunction(fArg) ? fArg : xGet(fArg)
}

const convertResult = (v, t) => (null === t ? v : t ? xResult.get(t)(v) : undefined)

/** @typedef {import('./types').ArgTypeName} ArgTypeName */
/** @typedef {import('./types').ResultTypeMap} ResultTypeMap */

/**
 * @template {ArgTypeName[]} ArgTypes
 * @template {keyof ResultTypeMap | undefined} ResultType
 * @param {Function} func
 * @param {ResultType} resultType
 * @param {ArgTypes} argTypes
 */
const __wrapFunction = (func, resultType, argTypes) => {
	const xlen = func.length
	/**
	 * @param {import('./types').MappedArgs<ArgTypes>} args
	 * @return {ResultType extends undefined ? void : ResultTypeMap[ResultType]}
	 */
	const wrapped = (...args) => {
		if (args.length !== xlen) __argMismatch(func)
		const scope = scopedAllocPush()
		try {
			const cva = argTypes.map((t, i) => xArg.get(t)(args[i], args, i))
			return convertResult(func(...cva), resultType)
		} finally {
			scopedAllocPop(scope)
		}
	}

	return wrapped
}

	/*
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
	*/

/**
 * @template {ArgTypeName[]} ArgTypes
 * @template {keyof ResultTypeMap | undefined} ResultType
 * @param {string} name
 * @param {ResultType | undefined} resultType
 * @param {ArgTypes} argTypes
 */
export const xWrapASM = (name, resultType, ...argTypes) => {
	let fn

	/**
	 * @param {import('./types').MappedArgs<ArgTypes>} args
	 * @return {ResultType extends undefined ? void : ResultTypeMap[ResultType]}
	 */
	const wrapped = (...args) => {
		if (!fn) {
			fn = __wrapFunction(xGet(name), resultType, argTypes)
		}
		return fn(...args)
	}

	return wrapped
}

/**
 * @param {...unknown} args
 */
export const xWrap = (...args) => {

}

export const xCall = (fname, ...args) => {
	const fn = xGet(fname)
	if (!isFunction(fn)) abort(`'${fname}' is not a function`)
	if (fn.length !== args.length) abort(`'${fname}' needs ${fn.length} arg(s)`)
	return 1 === args.length && Array.isArray(args[0]) ? fn(args[0]) : fn(args)
}

const adaptPtr = xArg.get(ptrIR)
for (const t of Object.keys(shared)) {
	const k = `${t}*`
	xArg.set(k, adaptPtr)
	xResult.set(k, adaptPtr)
}
