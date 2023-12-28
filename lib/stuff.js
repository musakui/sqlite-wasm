import * as util from './util.js'
import { wasm, capi } from './init.js'
import { installStruct } from './struct.js'
import { installWhWasm } from './whWasm.js'
import { installOO1 } from './oo1.js'
import { installSAHPool } from './sahPool.js'
import { SQLite3Error, WasmAllocError } from './capi_base.js'

/**
 * @param {WebAssembly.Exports} exp
 * @param {WebAssembly.Memory} memory
 */
export const onReady = (exp, memory) => {
	const exports = exp
	exports.__wasm_call_ctors()

	const config = Object.assign(Object.create(null), {
		exports,
		memory,
		debug: console.debug.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
		log: console.log.bind(console),
	})

	const toss3 = (...args) => {
		throw new SQLite3Error(...args)
	}

	const alloc = (n) => exports.sqlite3_malloc(n) || WasmAllocError.toss(`Failed to allocate ${n} bytes`)
	const realloc = (m, n) => (n ? exports.sqlite3_realloc(m, n) || WasmAllocError.toss(`Failed to reallocate ${n} bytes`) : 0)
	const dealloc = exports.sqlite3_free

	Object.assign(wasm, {
		ptrSizeof: 4,
		ptrIR: 'i32',
		exports,
		memory,
		alloc,
		realloc,
		dealloc,
	})

	wasm.allocFromTypedArray = function (src) {
		if (src instanceof ArrayBuffer) {
			src = new Uint8Array(src)
		}
		if (!util.isBindableTypedArray(src)) toss3('Value is not of a supported TypedArray type.')
		const pRet = alloc(src.byteLength || 1)
		wasm.heapForSize(src.constructor).set(src.byteLength ? src : [0], pRet)
		return pRet
	}

	wasm.pstack = Object.assign(Object.create(null), {
		restore: exports.sqlite3_wasm_pstack_restore,
		alloc: function (n) {
			if ('string' === typeof n && !(n = wasm.sizeofIR(n))) {
				WasmAllocError.toss('Invalid value for pstack.alloc(', arguments[0], ')')
			}
			return exports.sqlite3_wasm_pstack_alloc(n) || WasmAllocError.toss('Could not allocate', n, 'bytes from the pstack.')
		},
		allocChunks: function (n, sz) {
			if ('string' === typeof sz && !(sz = wasm.sizeofIR(sz))) {
				WasmAllocError.toss('Invalid size value for allocChunks(', arguments[1], ')')
			}
			const mem = wasm.pstack.alloc(n * sz)
			const rc = []
			let i = 0,
				offset = 0
			for (; i < n; ++i, offset += sz) rc.push(mem + offset)
			return rc
		},
		allocPtr: (n = 1, safePtrSize = true) => {
			return 1 === n ? wasm.pstack.alloc(safePtrSize ? 8 : wasm.ptrSizeof) : wasm.pstack.allocChunks(n, safePtrSize ? 8 : wasm.ptrSizeof)
		},
		call: function (f) {
			const stackPos = wasm.pstack.pointer
			try {
				return f(sqlite3)
			} finally {
				wasm.pstack.restore(stackPos)
			}
		},
	})

	Object.defineProperties(wasm.pstack, {
		pointer: {
			configurable: false,
			iterable: true,
			writeable: false,
			get: exports.sqlite3_wasm_pstack_ptr,
		},
		quota: {
			configurable: false,
			iterable: true,
			writeable: false,
			get: exports.sqlite3_wasm_pstack_quota,
		},
		remaining: {
			configurable: false,
			iterable: true,
			writeable: false,
			get: exports.sqlite3_wasm_pstack_remaining,
		},
	})

	capi.sqlite3_js_db_vfs = (dbP, name = 0) => wasm.sqlite3_wasm_db_vfs(dbP, name)

	capi.sqlite3_value_to_js = function (pVal, throwIfCannotConvert = true) {
		let arg
		const valType = capi.sqlite3_value_type(pVal)
		switch (valType) {
			case capi.SQLITE_INTEGER:
				arg = capi.sqlite3_value_int64(pVal)
				if (util.bigIntFitsDouble(arg)) arg = Number(arg)
				break
			case capi.SQLITE_FLOAT:
				arg = capi.sqlite3_value_double(pVal)
				break
			case capi.SQLITE_TEXT:
				arg = capi.sqlite3_value_text(pVal)
				break
			case capi.SQLITE_BLOB: {
				const n = capi.sqlite3_value_bytes(pVal)
				const pBlob = capi.sqlite3_value_blob(pVal)
				if (n && !pBlob) sqlite3.WasmAllocError.toss('Cannot allocate memory for blob argument of', n, 'byte(s)')
				arg = n ? wasm.heap8u().slice(pBlob, pBlob + Number(n)) : null
				break
			}
			case capi.SQLITE_NULL:
				arg = null
				break
			default:
				if (throwIfCannotConvert) {
					toss3(capi.SQLITE_MISMATCH, 'Unhandled sqlite3_value_type():', valType)
				}
				arg = undefined
		}
		return arg
	}

	capi.sqlite3_values_to_js = function (argc, pArgv, throwIfCannotConvert = true) {
		let i
		const tgt = []
		for (i = 0; i < argc; ++i) {
			tgt.push(capi.sqlite3_value_to_js(wasm.peekPtr(pArgv + wasm.ptrSizeof * i), throwIfCannotConvert))
		}
		return tgt
	}

	capi.sqlite3_result_error_js = function (pCtx, e) {
		if (e instanceof WasmAllocError) {
			capi.sqlite3_result_error_nomem(pCtx)
		} else {
			capi.sqlite3_result_error(pCtx, '' + e, -1)
		}
	}

	capi.sqlite3_result_js = function (pCtx, val) {
		if (val instanceof Error) {
			capi.sqlite3_result_error_js(pCtx, val)
			return
		}
		try {
			switch (typeof val) {
				case 'undefined':
					break
				case 'boolean':
					capi.sqlite3_result_int(pCtx, val ? 1 : 0)
					break
				case 'bigint':
					if (util.bigIntFits32(val)) {
						capi.sqlite3_result_int(pCtx, Number(val))
					} else if (util.bigIntFitsDouble(val)) {
						capi.sqlite3_result_double(pCtx, Number(val))
					} else {
						if (util.bigIntFits64(val)) capi.sqlite3_result_int64(pCtx, val)
						else toss3('BigInt value', val.toString(), 'is too BigInt for int64.')
					}
					break
				case 'number': {
					let f
					if (util.isInt32(val)) {
						f = capi.sqlite3_result_int
					} else if (Number.isInteger(val) && util.bigIntFits64(BigInt(val))) {
						f = capi.sqlite3_result_int64
					} else {
						f = capi.sqlite3_result_double
					}
					f(pCtx, val)
					break
				}
				case 'string': {
					const [p, n] = wasm.allocCString(val, true)
					capi.sqlite3_result_text(pCtx, p, n, capi.SQLITE_WASM_DEALLOC)
					break
				}
				case 'object':
					if (null === val) {
						capi.sqlite3_result_null(pCtx)
						break
					} else if (util.isBindableTypedArray(val)) {
						const pBlob = wasm.allocFromTypedArray(val)
						capi.sqlite3_result_blob(pCtx, pBlob, val.byteLength, capi.SQLITE_WASM_DEALLOC)
						break
					}

				default:
					toss3("Don't not how to handle this UDF result value:", typeof val, val)
			}
		} catch (e) {
			capi.sqlite3_result_error_js(pCtx, e)
		}
	}

	const sqlite3 = {
		WasmAllocError: WasmAllocError,
		SQLite3Error: SQLite3Error,
		capi,
		wasm,
		config,
	}

	installWhWasm(sqlite3)
	installOO1(sqlite3)
	installStruct(sqlite3)
	installSAHPool(sqlite3)

	return sqlite3
}
