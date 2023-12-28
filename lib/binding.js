import { instance } from './init.js'
import { ptrIR } from './constants.js'

export const functionTable = () => instance?.exports.__indirect_function_table

export const functionEntry = (fptr) => {
	const ft = functionTable()
	return fptr < ft.length ? ft.get(fptr) : undefined
}

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