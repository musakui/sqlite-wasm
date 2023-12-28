import { installStruct } from './struct.js'
import { installWhWasm } from './whWasm.js'
import { installOO1 } from './oo1.js'
import { installSAHPool } from './sahPool.js'

/** @type {WebAssembly.Exports} */
let asm

export const wasmMemory = new WebAssembly.Memory({ initial: 16777216 / 65536, maximum: 2147483648 / 65536 })

const isInt32 = (n) => 'bigint' !== typeof n && !!(n === (n | 0) && n <= 2147483647 && n >= -2147483648)
const { MIN_SAFE_INTEGER, MAX_SAFE_INTEGER } = Number
const MAX_BIGINT = BigInt('0x7fffffffffffffff')
const MIN_BIGINT = ~MAX_BIGINT
const bigIntFits64 = (b) => b >= MIN_BIGINT && b <= MAX_BIGINT
const bigIntFits32 = (b) => b >= -0x7fffffffn - 1n && b <= 0x7fffffffn
const bigIntFitsDouble = (b) => b >= MIN_SAFE_INTEGER && b <= MAX_SAFE_INTEGER
const isTypedArray = (v) => (v?.constructor && isInt32(v.constructor.BYTES_PER_ELEMENT) ? v : false)
const typedArrayPart = (arr, s, e) => (arr.buffer instanceof SharedArrayBuffer ? arr.slice(s, e) : arr.subarray(s, e))
const isSQLableTypedArray = (v) => v && (v instanceof Uint8Array || v instanceof Int8Array || v instanceof ArrayBuffer)
const isBindableTypedArray = isSQLableTypedArray
const typedArrayToString = (typedArray, begin, end) => DECODER.decode(typedArrayPart(typedArray, begin, end))

export const onReady = (exported) => {
	asm = exported
	asm.__wasm_call_ctors()

	const config = Object.assign(Object.create(null), {
		exports: asm,
		memory: wasmMemory,
		/*
		debug: console.debug.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
		log: console.log.bind(console),
		*/
	})

	const capi = Object.create(null)

	class SQLite3Error extends Error {
		constructor(...args) {
			let rc
			if (args.length) {
				const f = args[0]
				if (typeof f === 'number' && f === (f | 0)) {
					rc = args[0]
					const rcStr = capi.sqlite3_js_rc_str?.(rc) || `Unknown result code #${rc}`
					if (1 === args.length) {
						super(rcStr)
					} else {
						if ('object' === typeof args[1]) {
							super(rcStr, args[1])
						} else {
							args[0] = rcStr + ':'
							super(args.join(' '))
						}
					}
				} else {
					if (2 === args.length && 'object' === typeof args[1]) {
						super(...args)
					} else {
						super(args.join(' '))
					}
				}
			}
			this.resultCode = rc || capi.SQLITE_ERROR
			this.name = 'SQLite3Error'
		}

		static toss(...args) {
			throw new SQLite3Error(...args)
		}
	}

	const toss3 = (...args) => {
		throw new SQLite3Error(...args)
	}

	class WasmAllocError extends Error {
		constructor(...args) {
			if (2 === args.length && 'object' === typeof args[1]) {
				super(...args)
			} else if (args.length) {
				super(args.join(' '))
			} else {
				super('Allocation failed.')
			}
			this.resultCode = capi.SQLITE_NOMEM
			this.name = 'WasmAllocError'
		}

		static toss(...args) {
			throw new WasmAllocError(...args)
		}
	}

	const wasm = Object.assign(Object.create(null), {
		ptrSizeof: 4,
		ptrIR: 'i32',
		exports: asm,
		memory: wasmMemory,
		alloc: (n) => asm.sqlite3_malloc(n) || WasmAllocError.toss(`Failed to allocate ${n} bytes`),
		realloc: (m, n) => (n ? asm.sqlite3_realloc(m, n) || WasmAllocError.toss(`Failed to reallocate ${n} bytes`) : 0),
		dealloc: asm.sqlite3_free,
	})

	const flexibleString = function (v) {
		if (isSQLableTypedArray(v)) {
			return typedArrayToString(v instanceof ArrayBuffer ? new Uint8Array(v) : v)
		} else if (Array.isArray(v)) return v.join('')
		else if (wasm.isPtr(v)) v = wasm.cstrToJs(v)
		return v
	}

	const header = 'SQLite format 3'
	const affirmIsDb = (bytes) => {
		if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
		const n = bytes.byteLength
		if (n < 512 || n % 512 !== 0) {
			toss3('Byte array size', n, 'is invalid for an SQLite3 db.')
		}
		if (header.length > bytes.byteLength) {
			toss3('Input does not contain an SQLite3 database header.')
		}
		for (let i = 0; i < header.length; ++i) {
			if (header.charCodeAt(i) !== bytes[i]) {
				toss3('Input does not contain an SQLite3 database header.')
			}
		}
	}

	function sqlite3ApiBootstrap() {
		wasm.allocFromTypedArray = function (src) {
			if (src instanceof ArrayBuffer) {
				src = new Uint8Array(src)
			}
			if (!isBindableTypedArray(src)) toss3('Value is not of a supported TypedArray type.')
			const pRet = wasm.alloc(src.byteLength || 1)
			wasm.heapForSize(src.constructor).set(src.byteLength ? src : [0], pRet)
			return pRet
		}

		wasm.compileOptionUsed = function f(optName) {
			if (!arguments.length) {
				if (f._result) return f._result
				else if (!f._opt) {
					f._rx = /^([^=]+)=(.+)/
					f._rxInt = /^-?\d+$/
					f._opt = function (opt, rv) {
						const m = f._rx.exec(opt)
						rv[0] = m ? m[1] : opt
						rv[1] = m ? (f._rxInt.test(m[2]) ? +m[2] : m[2]) : true
					}
				}
				const rc = {},
					ov = [0, 0]
				let i = 0,
					k
				while ((k = capi.sqlite3_compileoption_get(i++))) {
					f._opt(k, ov)
					rc[ov[0]] = ov[1]
				}
				return (f._result = rc)
			} else if (Array.isArray(optName)) {
				const rc = {}
				optName.forEach((v) => {
					rc[v] = capi.sqlite3_compileoption_used(v)
				})
				return rc
			} else if ('object' === typeof optName) {
				Object.keys(optName).forEach((k) => {
					optName[k] = capi.sqlite3_compileoption_used(k)
				})
				return optName
			}
			return 'string' === typeof optName ? !!capi.sqlite3_compileoption_used(optName) : false
		}

		wasm.pstack = Object.assign(Object.create(null), {
			restore: wasm.exports.sqlite3_wasm_pstack_restore,
			alloc: function (n) {
				if ('string' === typeof n && !(n = wasm.sizeofIR(n))) {
					WasmAllocError.toss('Invalid value for pstack.alloc(', arguments[0], ')')
				}
				return wasm.exports.sqlite3_wasm_pstack_alloc(n) || WasmAllocError.toss('Could not allocate', n, 'bytes from the pstack.')
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
				get: wasm.exports.sqlite3_wasm_pstack_ptr,
			},
			quota: {
				configurable: false,
				iterable: true,
				writeable: false,
				get: wasm.exports.sqlite3_wasm_pstack_quota,
			},
			remaining: {
				configurable: false,
				iterable: true,
				writeable: false,
				get: wasm.exports.sqlite3_wasm_pstack_remaining,
			},
		})

		capi.sqlite3_randomness = (...args) => {
			if (1 === args.length && isTypedArray(args[0]) && 1 === args[0].BYTES_PER_ELEMENT) {
				const ta = args[0]
				if (0 === ta.byteLength) {
					wasm.exports.sqlite3_randomness(0, 0)
					return ta
				}
				const stack = wasm.pstack.pointer
				try {
					let n = ta.byteLength,
						offset = 0
					const r = wasm.exports.sqlite3_randomness
					const heap = wasm.heap8u()
					const nAlloc = n < 512 ? n : 512
					const ptr = wasm.pstack.alloc(nAlloc)
					do {
						const j = n > nAlloc ? nAlloc : n
						r(j, ptr)
						ta.set(typedArrayPart(heap, ptr, ptr + j), offset)
						n -= j
						offset += j
					} while (n > 0)
				} catch (e) {
					console.error('Highly unexpected (and ignored!) exception in sqlite3_randomness():', e)
				} finally {
					wasm.pstack.restore(stack)
				}
				return ta
			}
			wasm.exports.sqlite3_randomness(...args)
		}

		capi.sqlite3_js_db_uses_vfs = function (pDb, vfsName, dbName = 0) {
			try {
				const pK = capi.sqlite3_vfs_find(vfsName)
				if (!pK) return false
				else if (!pDb) {
					return pK === capi.sqlite3_vfs_find(0) ? pK : false
				} else {
					return pK === capi.sqlite3_js_db_vfs(pDb, dbName) ? pK : false
				}
			} catch (e) {
				return false
			}
		}

		capi.sqlite3_js_vfs_list = function () {
			const rc = []
			let pVfs = capi.sqlite3_vfs_find(0)
			while (pVfs) {
				const oVfs = new capi.sqlite3_vfs(pVfs)
				rc.push(wasm.cstrToJs(oVfs.$zName))
				pVfs = oVfs.$pNext
				oVfs.dispose()
			}
			return rc
		}

		capi.sqlite3_js_db_export = function (pDb, schema = 0) {
			pDb = wasm.xWrap.testConvertArg('sqlite3*', pDb)
			if (!pDb) toss3('Invalid sqlite3* argument.')
			const scope = wasm.scopedAllocPush()
			let pOut
			try {
				const pSize = wasm.scopedAlloc(8 + wasm.ptrSizeof)
				const ppOut = pSize + 8

				const zSchema = schema ? (wasm.isPtr(schema) ? schema : wasm.scopedAllocCString('' + schema)) : 0
				let rc = wasm.exports.sqlite3_wasm_db_serialize(pDb, zSchema, ppOut, pSize, 0)
				if (rc) {
					toss3('Database serialization failed with code', sqlite3.capi.sqlite3_js_rc_str(rc))
				}
				pOut = wasm.peekPtr(ppOut)
				const nOut = wasm.peek(pSize, 'i64')
				rc = nOut ? wasm.heap8u().slice(pOut, pOut + Number(nOut)) : new Uint8Array()
				return rc
			} finally {
				if (pOut) wasm.exports.sqlite3_free(pOut)
				wasm.scopedAllocPop(scope)
			}
		}

		capi.sqlite3_js_db_vfs = (dbPointer, dbName = 0) => wasm.sqlite3_wasm_db_vfs(dbPointer, dbName)

		capi.sqlite3_js_aggregate_context = (pCtx, n) => {
			return capi.sqlite3_aggregate_context(pCtx, n) || (n ? WasmAllocError.toss('Cannot allocate', n, 'bytes for sqlite3_aggregate_context()') : 0)
		}

		capi.sqlite3_js_posix_create_file = function (filename, data, dataLen) {
			let pData
			if (data && wasm.isPtr(data)) {
				pData = data
			} else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
				pData = wasm.allocFromTypedArray(data)
				if (arguments.length < 3 || !isInt32(dataLen) || dataLen < 0) {
					dataLen = data.byteLength
				}
			} else {
				SQLite3Error.toss('Invalid 2nd argument for sqlite3_js_posix_create_file().')
			}
			try {
				if (!isInt32(dataLen) || dataLen < 0) {
					SQLite3Error.toss('Invalid 3rd argument for sqlite3_js_posix_create_file().')
				}
				const rc = wasm.sqlite3_wasm_posix_create_file(filename, pData, dataLen)
				if (rc) SQLite3Error.toss('Creation of file failed with sqlite3 result code', capi.sqlite3_js_rc_str(rc))
			} finally {
				wasm.dealloc(pData)
			}
		}

		capi.sqlite3_db_config = function (pDb, op, ...args) {
			if (!this.s) {
				this.s = wasm.xWrap('sqlite3_wasm_db_config_s', 'int', ['sqlite3*', 'int', 'string:static'])
				this.pii = wasm.xWrap('sqlite3_wasm_db_config_pii', 'int', ['sqlite3*', 'int', '*', 'int', 'int'])
				this.ip = wasm.xWrap('sqlite3_wasm_db_config_ip', 'int', ['sqlite3*', 'int', 'int', '*'])
			}
			switch (op) {
				case capi.SQLITE_DBCONFIG_ENABLE_FKEY:
				case capi.SQLITE_DBCONFIG_ENABLE_TRIGGER:
				case capi.SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER:
				case capi.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION:
				case capi.SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE:
				case capi.SQLITE_DBCONFIG_ENABLE_QPSG:
				case capi.SQLITE_DBCONFIG_TRIGGER_EQP:
				case capi.SQLITE_DBCONFIG_RESET_DATABASE:
				case capi.SQLITE_DBCONFIG_DEFENSIVE:
				case capi.SQLITE_DBCONFIG_WRITABLE_SCHEMA:
				case capi.SQLITE_DBCONFIG_LEGACY_ALTER_TABLE:
				case capi.SQLITE_DBCONFIG_DQS_DML:
				case capi.SQLITE_DBCONFIG_DQS_DDL:
				case capi.SQLITE_DBCONFIG_ENABLE_VIEW:
				case capi.SQLITE_DBCONFIG_LEGACY_FILE_FORMAT:
				case capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA:
				case capi.SQLITE_DBCONFIG_STMT_SCANSTATUS:
				case capi.SQLITE_DBCONFIG_REVERSE_SCANORDER:
					return this.ip(pDb, op, args[0], args[1] || 0)
				case capi.SQLITE_DBCONFIG_LOOKASIDE:
					return this.pii(pDb, op, args[0], args[1], args[2])
				case capi.SQLITE_DBCONFIG_MAINDBNAME:
					return this.s(pDb, op, args[0])
				default:
					return capi.SQLITE_MISUSE
			}
		}.bind(Object.create(null))

		capi.sqlite3_value_to_js = function (pVal, throwIfCannotConvert = true) {
			let arg
			const valType = capi.sqlite3_value_type(pVal)
			switch (valType) {
				case capi.SQLITE_INTEGER:
					arg = capi.sqlite3_value_int64(pVal)
					if (bigIntFitsDouble(arg)) arg = Number(arg)
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
						if (bigIntFits32(val)) {
							capi.sqlite3_result_int(pCtx, Number(val))
						} else if (bigIntFitsDouble(val)) {
							capi.sqlite3_result_double(pCtx, Number(val))
						} else {
							if (bigIntFits64(val)) capi.sqlite3_result_int64(pCtx, val)
							else toss3('BigInt value', val.toString(), 'is too BigInt for int64.')
						}
						break
					case 'number': {
						let f
						if (isInt32(val)) {
							f = capi.sqlite3_result_int
						} else if (Number.isInteger(val) && bigIntFits64(BigInt(val))) {
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
						} else if (isBindableTypedArray(val)) {
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

		capi.sqlite3_column_js = function (pStmt, iCol, throwIfCannotConvert = true) {
			const v = capi.sqlite3_column_value(pStmt, iCol)
			return 0 === v ? undefined : capi.sqlite3_value_to_js(v, throwIfCannotConvert)
		}

		const __newOldValue = function (pObj, iCol, impl) {
			impl = capi[impl]
			if (!this.ptr) this.ptr = wasm.allocPtr()
			else wasm.pokePtr(this.ptr, 0)
			const rc = impl(pObj, iCol, this.ptr)
			if (rc) return SQLite3Error.toss(rc, arguments[2] + '() failed with code ' + rc)
			const pv = wasm.peekPtr(this.ptr)
			return pv ? capi.sqlite3_value_to_js(pv, true) : undefined
		}.bind(Object.create(null))

		capi.sqlite3_preupdate_new_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_new')
		capi.sqlite3_preupdate_old_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_old')
		capi.sqlite3changeset_new_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_new')
		capi.sqlite3changeset_old_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_old')

		const sqlite3 = {
			WasmAllocError: WasmAllocError,
			SQLite3Error: SQLite3Error,
			util: { toss3, affirmIsDb, flexibleString, isSQLableTypedArray },
			capi,
			wasm,
			config,
			version: {
				libVersion: '3.44.2',
				libVersionNumber: 3044002,
				sourceId: '2023-11-24 11:41:44 ebead0e7230cd33bcec9f95d2183069565b9e709bf745c9b5db65cc0cbf92c0f',
				downloadVersion: 3440200,
			},
		}

		try {
			installWhWasm(sqlite3)
			installOO1(sqlite3)
			installStruct(sqlite3)
			installSAHPool(sqlite3)
		} catch (e) {
			console.error('sqlite3 bootstrap initializer threw:', e)
			throw e
		}

		return sqlite3
	}

	return sqlite3ApiBootstrap()
}
