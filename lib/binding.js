import { getASM } from './init.js'
import { ptrIR } from './constants.js'
import { abort, isFunction } from './util.js'

export const functionTable = () => getASM().__indirect_function_table

export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

export const xGet = (name) => getASM()[name] ?? abort(`no such symbol ${name}`)

const __xIdent = (i) => i
const __xArgPtr = (i) => i | 0
const __xArgFloat = (i) => Number(i).valueOf()

export const xArg = new Map([
	[null, __xIdent],
	['*', __xArgPtr],
	['**', __xArgPtr],
	['null', __xIdent],
	['i8', (i) => (i | 0) & 0xff],
	['i16', (i) => (i | 0) & 0xffff],
	['i32', __xArgPtr],
	['int', __xArgPtr],
	['i64', BigInt],
	['f32', __xArgFloat],
	['f64', __xArgFloat],
	['float', __xArgFloat],
	['double', __xArgFloat],
])

export const xResult = new Map([
	['*', __xArgPtr],
	[null, __xIdent],
	['null', __xIdent],
	['pointer', __xArgPtr],
	['void', (v) => undefined],
	['number', Number],
])

const copyToResult = ['i8', 'i16', 'i32', 'int', 'f32', 'float', 'f64', 'double', 'i64']

const adaptPtr = xArg.get(ptrIR)

for (const t of copyToResult) {
	xArg.set(t + '*', adaptPtr)
	xResult.set(t + '*', adaptPtr)
	xResult.set(t, xArg.get(t))
}

export const xCall = (fname, ...args) => {
	const fn = xGet(fname)
	if (!isFunction(fn)) abort(`'${fname}' is not a function`)
	if (fn.length !== args.length) abort(`'${fname}' requires ${fn.length} argument(s)`)
	return 1 === args.length && Array.isArray(args[0]) ? fn(args[0]) : fn(args)
}
