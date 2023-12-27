const DECODER = new TextDecoder('utf8')
const ENCODER = new TextEncoder('utf8')

const defineGroups = [
	'access',
	'authorizer',
	'blobFinalizers',
	'changeset',
	'config',
	'dataTypes',
	'dbConfig',
	'dbStatus',
	'encodings',
	'fcntl',
	'flock',
	'ioCap',
	'limits',
	'openFlags',
	'prepareFlags',
	'resultCodes',
	'sqlite3Status',
	'stmtStatus',
	'syncFlags',
	'trace',
	'txnState',
	'udfFlags',
	'version',
	'serialize',
	'session',
	'vtab',
]

const toss = (...args) => {
	throw new Error(args.join(' '))
}

const xPtrPropName = '(pointer-is-external)'

const Jaccwabyt = function StructBinderFactory(config) {
	if (!(config.heap instanceof WebAssembly.Memory) && !(config.heap instanceof Function)) {
		toss('config.heap must be WebAssembly.Memory instance or a function.')
	}
	;['alloc', 'dealloc'].forEach(function (k) {
		config[k] instanceof Function || toss("Config option '" + k + "' must be a function.")
	})
	const SBF = StructBinderFactory
	const heap = config.heap instanceof Function ? config.heap : () => new Uint8Array(config.heap.buffer),
		alloc = config.alloc,
		dealloc = config.dealloc,
		log = config.log || console.log.bind(console),
		memberPrefix = config.memberPrefix || '',
		memberSuffix = config.memberSuffix || '',
		BigInt = globalThis['BigInt'],
		BigInt64Array = globalThis['BigInt64Array'],
		ptrSizeof = config.ptrSizeof || 4,
		ptrIR = config.ptrIR || 'i32'
	if (!SBF.debugFlags) {
		SBF.__makeDebugFlags = function (deriveFrom = null) {
			if (deriveFrom && deriveFrom.__flags) deriveFrom = deriveFrom.__flags
			const f = function f(flags) {
				if (0 === arguments.length) {
					return f.__flags
				}
				if (flags < 0) {
					delete f.__flags.getter
					delete f.__flags.setter
					delete f.__flags.alloc
					delete f.__flags.dealloc
				} else {
					f.__flags.getter = 0 !== (0x01 & flags)
					f.__flags.setter = 0 !== (0x02 & flags)
					f.__flags.alloc = 0 !== (0x04 & flags)
					f.__flags.dealloc = 0 !== (0x08 & flags)
				}
				return f._flags
			}
			Object.defineProperty(f, '__flags', {
				iterable: false,
				writable: false,
				value: Object.create(deriveFrom),
			})
			if (!deriveFrom) f(0)
			return f
		}
		SBF.debugFlags = SBF.__makeDebugFlags()
	}

	const isLittleEndian = (function () {
		const buffer = new ArrayBuffer(2)
		new DataView(buffer).setInt16(0, 256, true)

		return new Int16Array(buffer)[0] === 256
	})()

	const isFuncSig = (s) => '(' === s[1]
	const isAutoPtrSig = (s) => 'P' === s
	const sigLetter = (s) => (isFuncSig(s) ? 'p' : s[0])

	const sigIR = function (s) {
		switch (sigLetter(s)) {
			case 'c':
			case 'C':
				return 'i8'
			case 'i':
				return 'i32'
			case 'p':
			case 'P':
			case 's':
				return ptrIR
			case 'j':
				return 'i64'
			case 'f':
				return 'float'
			case 'd':
				return 'double'
		}
		toss('Unhandled signature IR:', s)
	}

	const affirmBigIntArray = BigInt64Array ? () => true : () => toss('BigInt64Array is not available.')

	const sigDVGetter = function (s) {
		switch (sigLetter(s)) {
			case 'p':
			case 'P':
			case 's': {
				switch (ptrSizeof) {
					case 4:
						return 'getInt32'
					case 8:
						return affirmBigIntArray() && 'getBigInt64'
				}
				break
			}
			case 'i':
				return 'getInt32'
			case 'c':
				return 'getInt8'
			case 'C':
				return 'getUint8'
			case 'j':
				return affirmBigIntArray() && 'getBigInt64'
			case 'f':
				return 'getFloat32'
			case 'd':
				return 'getFloat64'
		}
		toss('Unhandled DataView getter for signature:', s)
	}

	const sigDVSetter = function (s) {
		switch (sigLetter(s)) {
			case 'p':
			case 'P':
			case 's': {
				switch (ptrSizeof) {
					case 4:
						return 'setInt32'
					case 8:
						return affirmBigIntArray() && 'setBigInt64'
				}
				break
			}
			case 'i':
				return 'setInt32'
			case 'c':
				return 'setInt8'
			case 'C':
				return 'setUint8'
			case 'j':
				return affirmBigIntArray() && 'setBigInt64'
			case 'f':
				return 'setFloat32'
			case 'd':
				return 'setFloat64'
		}
		toss('Unhandled DataView setter for signature:', s)
	}

	const sigDVSetWrapper = function (s) {
		switch (sigLetter(s)) {
			case 'i':
			case 'f':
			case 'c':
			case 'C':
			case 'd':
				return Number
			case 'j':
				return affirmBigIntArray() && BigInt
			case 'p':
			case 'P':
			case 's':
				switch (ptrSizeof) {
					case 4:
						return Number
					case 8:
						return affirmBigIntArray() && BigInt
				}
				break
		}
		toss('Unhandled DataView set wrapper for signature:', s)
	}

	const sPropName = (s, k) => s + '::' + k

	const __propThrowOnSet = function (structName, propName) {
		return () => toss(sPropName(structName, propName), 'is read-only.')
	}

	const __instancePointerMap = new WeakMap()

	const __freeStruct = function (ctor, obj, m) {
		if (!m) m = __instancePointerMap.get(obj)
		if (m) {
			__instancePointerMap.delete(obj)
			if (Array.isArray(obj.ondispose)) {
				let x
				while ((x = obj.ondispose.shift())) {
					try {
						if (x instanceof Function) x.call(obj)
						else if (x instanceof StructType) x.dispose()
						else if ('number' === typeof x) dealloc(x)
					} catch (e) {
						console.warn('ondispose() for', ctor.structName, '@', m, 'threw. NOT propagating it.', e)
					}
				}
			} else if (obj.ondispose instanceof Function) {
				try {
					obj.ondispose()
				} catch (e) {
					console.warn('ondispose() for', ctor.structName, '@', m, 'threw. NOT propagating it.', e)
				}
			}
			delete obj.ondispose
			if (ctor.debugFlags.__flags.dealloc) {
				log('debug.dealloc:', obj[xPtrPropName] ? 'EXTERNAL' : '', ctor.structName, 'instance:', ctor.structInfo.sizeof, 'bytes @' + m)
			}
			if (!obj[xPtrPropName]) dealloc(m)
		}
	}

	const rop = (value) => ({
		configurable: false,
		writable: false,
		iterable: false,
		value,
	})

	const __allocStruct = function (ctor, obj, m) {
		let fill = !m
		if (m) Object.defineProperty(obj, xPtrPropName, rop(m))
		else {
			m = alloc(ctor.structInfo.sizeof)
			if (!m) toss('Allocation of', ctor.structName, 'structure failed.')
		}
		try {
			if (ctor.debugFlags.__flags.alloc) {
				log('debug.alloc:', fill ? '' : 'EXTERNAL', ctor.structName, 'instance:', ctor.structInfo.sizeof, 'bytes @' + m)
			}
			if (fill) heap().fill(0, m, m + ctor.structInfo.sizeof)
			__instancePointerMap.set(obj, m)
		} catch (e) {
			__freeStruct(ctor, obj, m)
			throw e
		}
	}

	const __memoryDump = function () {
		const p = this.pointer
		return p ? new Uint8Array(heap().slice(p, p + this.structInfo.sizeof)) : null
	}

	const __memberKey = (k) => memberPrefix + k + memberSuffix
	const __memberKeyProp = rop(__memberKey)

	const __lookupMember = function (structInfo, memberName, tossIfNotFound = true) {
		let m = structInfo.members[memberName]
		if (!m && (memberPrefix || memberSuffix)) {
			for (const v of Object.values(structInfo.members)) {
				if (v.key === memberName) {
					m = v
					break
				}
			}
			if (!m && tossIfNotFound) {
				toss(sPropName(structInfo.name, memberName), 'is not a mapped struct member.')
			}
		}
		return m
	}

	const __memberSignature = function f(obj, memberName, emscriptenFormat = false) {
		if (!f._) f._ = (x) => x.replace(/[^vipPsjrdcC]/g, '').replace(/[pPscC]/g, 'i')
		const m = __lookupMember(obj.structInfo, memberName, true)
		return emscriptenFormat ? f._(m.signature) : m.signature
	}

	const __ptrPropDescriptor = {
		configurable: false,
		enumerable: false,
		get: function () {
			return __instancePointerMap.get(this)
		},
		set: () => toss("Cannot assign the 'pointer' property of a struct."),
	}

	const __structMemberKeys = rop(function () {
		const a = []
		for (const k of Object.keys(this.structInfo.members)) {
			a.push(this.memberKey(k))
		}
		return a
	})

	const __utf8Decode = function (arrayBuffer, begin, end) {
		return DECODER.decode(arrayBuffer.buffer instanceof SharedArrayBuffer ? arrayBuffer.slice(begin, end) : arrayBuffer.subarray(begin, end))
	}

	const __memberIsString = function (obj, memberName, tossIfNotFound = false) {
		const m = __lookupMember(obj.structInfo, memberName, tossIfNotFound)
		return m && 1 === m.signature.length && 's' === m.signature[0] ? m : false
	}

	const __affirmCStringSignature = function (member) {
		if ('s' === member.signature) return
		toss('Invalid member type signature for C-string value:', JSON.stringify(member))
	}

	const __memberToJsString = function f(obj, memberName) {
		const m = __lookupMember(obj.structInfo, memberName, true)
		__affirmCStringSignature(m)
		const addr = obj[m.key]

		if (!addr) return null
		let pos = addr
		const mem = heap()
		for (; mem[pos] !== 0; ++pos) {}

		return addr === pos ? '' : __utf8Decode(mem, addr, pos)
	}

	const __addOnDispose = function (obj, ...v) {
		if (obj.ondispose) {
			if (!Array.isArray(obj.ondispose)) {
				obj.ondispose = [obj.ondispose]
			}
		} else {
			obj.ondispose = []
		}
		obj.ondispose.push(...v)
	}

	const __allocCString = function (str) {
		const u = ENCODER.encode(str)
		const mem = alloc(u.length + 1)
		if (!mem) toss('Allocation error while duplicating string:', str)
		const h = heap()

		h.set(u, mem)
		h[mem + u.length] = 0

		return mem
	}

	const __setMemberCString = function (obj, memberName, str) {
		const m = __lookupMember(obj.structInfo, memberName, true)
		__affirmCStringSignature(m)

		const mem = __allocCString(str)
		obj[m.key] = mem
		__addOnDispose(obj, mem)
		return obj
	}

	const StructType = function ctor(structName, structInfo) {
		if (arguments[2] !== rop) {
			toss('Do not call the StructType constructor', 'from client-level code.')
		}
		Object.defineProperties(this, {
			structName: rop(structName),
			structInfo: rop(structInfo),
		})
	}

	StructType.prototype = Object.create(null, {
		dispose: rop(function () {
			__freeStruct(this.constructor, this)
		}),
		lookupMember: rop(function (memberName, tossIfNotFound = true) {
			return __lookupMember(this.structInfo, memberName, tossIfNotFound)
		}),
		memberToJsString: rop(function (memberName) {
			return __memberToJsString(this, memberName)
		}),
		memberIsString: rop(function (memberName, tossIfNotFound = true) {
			return __memberIsString(this, memberName, tossIfNotFound)
		}),
		memberKey: __memberKeyProp,
		memberKeys: __structMemberKeys,
		memberSignature: rop(function (memberName, emscriptenFormat = false) {
			return __memberSignature(this, memberName, emscriptenFormat)
		}),
		memoryDump: rop(__memoryDump),
		pointer: __ptrPropDescriptor,
		setMemberCString: rop(function (memberName, str) {
			return __setMemberCString(this, memberName, str)
		}),
	})

	Object.assign(StructType.prototype, {
		addOnDispose: function (...v) {
			__addOnDispose(this, ...v)
			return this
		},
	})

	Object.defineProperties(StructType, {
		allocCString: rop(__allocCString),
		isA: rop((v) => v instanceof StructType),
		hasExternalPointer: rop((v) => v instanceof StructType && !!v[xPtrPropName]),
		memberKey: __memberKeyProp,
	})

	const isNumericValue = (v) => Number.isFinite(v) || v instanceof (BigInt || Number)

	const makeMemberWrapper = function f(ctor, name, descr) {
		if (!f._) {
			f._ = { getters: {}, setters: {}, sw: {} }
			const a = ['i', 'c', 'C', 'p', 'P', 's', 'f', 'd', 'v()', 'j']
			a.forEach(function (v) {
				f._.getters[v] = sigDVGetter(v)
				f._.setters[v] = sigDVSetter(v)
				f._.sw[v] = sigDVSetWrapper(v)
			})
			const rxSig1 = /^[ipPsjfdcC]$/,
				rxSig2 = /^[vipPsjfdcC]\([ipPsjfdcC]*\)$/
			f.sigCheck = function (obj, name, key, sig) {
				if (Object.prototype.hasOwnProperty.call(obj, key)) {
					toss(obj.structName, 'already has a property named', key + '.')
				}
				rxSig1.test(sig) || rxSig2.test(sig) || toss('Malformed signature for', sPropName(obj.structName, name) + ':', sig)
			}
		}
		const key = ctor.memberKey(name)
		f.sigCheck(ctor.prototype, name, key, descr.signature)
		descr.key = key
		descr.name = name
		const sigGlyph = sigLetter(descr.signature)
		const xPropName = sPropName(ctor.prototype.structName, key)
		const dbg = ctor.prototype.debugFlags.__flags

		const prop = Object.create(null)
		prop.configurable = false
		prop.enumerable = false
		prop.get = function () {
			if (dbg.getter) {
				log('debug.getter:', f._.getters[sigGlyph], 'for', sigIR(sigGlyph), xPropName, '@', this.pointer, '+', descr.offset, 'sz', descr.sizeof)
			}
			let rc = new DataView(heap().buffer, this.pointer + descr.offset, descr.sizeof)[f._.getters[sigGlyph]](0, isLittleEndian)
			if (dbg.getter) log('debug.getter:', xPropName, 'result =', rc)
			return rc
		}
		if (descr.readOnly) {
			prop.set = __propThrowOnSet(ctor.prototype.structName, key)
		} else {
			prop.set = function (v) {
				if (dbg.setter) {
					log('debug.setter:', f._.setters[sigGlyph], 'for', sigIR(sigGlyph), xPropName, '@', this.pointer, '+', descr.offset, 'sz', descr.sizeof, v)
				}
				if (!this.pointer) {
					toss('Cannot set struct property on disposed instance.')
				}
				if (null === v) v = 0
				else
					while (!isNumericValue(v)) {
						if (isAutoPtrSig(descr.signature) && v instanceof StructType) {
							v = v.pointer || 0
							if (dbg.setter) log('debug.setter:', xPropName, 'resolved to', v)
							break
						}
						toss('Invalid value for pointer-type', xPropName + '.')
					}
				new DataView(heap().buffer, this.pointer + descr.offset, descr.sizeof)[f._.setters[sigGlyph]](0, f._.sw[sigGlyph](v), isLittleEndian)
			}
		}
		Object.defineProperty(ctor.prototype, key, prop)
	}

	const StructBinder = function StructBinder(structName, structInfo) {
		if (1 === arguments.length) {
			structInfo = structName
			structName = structInfo.name
		} else if (!structInfo.name) {
			structInfo.name = structName
		}
		if (!structName) toss('Struct name is required.')
		let lastMember = false
		Object.keys(structInfo.members).forEach((k) => {
			const m = structInfo.members[k]
			if (!m.sizeof) toss(structName, 'member', k, 'is missing sizeof.')
			else if (m.sizeof === 1) {
				m.signature === 'c' ||
					m.signature === 'C' ||
					toss('Unexpected sizeof==1 member', sPropName(structInfo.name, k), 'with signature', m.signature)
			} else {
				if (0 !== m.sizeof % 4) {
					console.warn('Invalid struct member description =', m, 'from', structInfo)
					toss(structName, 'member', k, 'sizeof is not aligned. sizeof=' + m.sizeof)
				}
				if (0 !== m.offset % 4) {
					console.warn('Invalid struct member description =', m, 'from', structInfo)
					toss(structName, 'member', k, 'offset is not aligned. offset=' + m.offset)
				}
			}
			if (!lastMember || lastMember.offset < m.offset) lastMember = m
		})
		if (!lastMember) toss('No member property descriptions found.')
		else if (structInfo.sizeof < lastMember.offset + lastMember.sizeof) {
			toss(
				'Invalid struct config:',
				structName,
				'max member offset (' + lastMember.offset + ') ',
				'extends past end of struct (sizeof=' + structInfo.sizeof + ').'
			)
		}
		const debugFlags = rop(SBF.__makeDebugFlags(StructBinder.debugFlags))

		const StructCtor = function StructCtor(externalMemory) {
			if (!(this instanceof StructCtor)) {
				toss('The', structName, "constructor may only be called via 'new'.")
			} else if (arguments.length) {
				if (externalMemory !== (externalMemory | 0) || externalMemory <= 0) {
					toss('Invalid pointer value for', structName, 'constructor.')
				}
				__allocStruct(StructCtor, this, externalMemory)
			} else {
				__allocStruct(StructCtor, this)
			}
		}
		Object.defineProperties(StructCtor, {
			debugFlags: debugFlags,
			isA: rop((v) => v instanceof StructCtor),
			memberKey: __memberKeyProp,
			memberKeys: __structMemberKeys,
			methodInfoForKey: rop(function (mKey) {}),
			structInfo: rop(structInfo),
			structName: rop(structName),
		})
		StructCtor.prototype = new StructType(structName, structInfo, rop)
		Object.defineProperties(StructCtor.prototype, {
			debugFlags: debugFlags,
			constructor: rop(StructCtor),
		})
		Object.keys(structInfo.members).forEach((name) => makeMemberWrapper(StructCtor, name, structInfo.members[name]))
		return StructCtor
	}
	StructBinder.StructType = StructType
	StructBinder.config = config
	StructBinder.allocCString = __allocCString
	if (!StructBinder.debugFlags) {
		StructBinder.debugFlags = SBF.__makeDebugFlags(SBF.debugFlags)
	}
	return StructBinder
}

export const installWhWasm = (sqlite3) => {
	const capi = sqlite3.capi,
		wasm = sqlite3.wasm,
		util = sqlite3.util

	WhWasmUtilInstaller(wasm)

	const contextKey = (a) => a[0]
	const FPA = (o) => new wasm.xWrap.FuncPtrAdapter(o)

	wasm.bindingSignatures = [
		['sqlite3_aggregate_context', 'void*', 'sqlite3_context*', 'int'],
		['sqlite3_bind_double', 'int', 'sqlite3_stmt*', 'int', 'f64'],
		['sqlite3_bind_int', 'int', 'sqlite3_stmt*', 'int', 'int'],
		['sqlite3_bind_null', undefined, 'sqlite3_stmt*', 'int'],
		['sqlite3_bind_parameter_count', 'int', 'sqlite3_stmt*'],
		['sqlite3_bind_parameter_index', 'int', 'sqlite3_stmt*', 'string'],
		['sqlite3_bind_pointer', 'int', 'sqlite3_stmt*', 'int', '*', 'string:static', '*'],
		['sqlite3_busy_handler', 'int', ['sqlite3*', FPA({ signature: 'i(pi)', contextKey }), '*']],
		['sqlite3_busy_timeout', 'int', 'sqlite3*', 'int'],
		['sqlite3_changes', 'int', 'sqlite3*'],
		['sqlite3_clear_bindings', 'int', 'sqlite3_stmt*'],
		['sqlite3_collation_needed', 'int', 'sqlite3*', '*', '*'],
		['sqlite3_column_blob', '*', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_bytes', 'int', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_count', 'int', 'sqlite3_stmt*'],
		['sqlite3_column_double', 'f64', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_int', 'int', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_name', 'string', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_text', 'string', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_type', 'int', 'sqlite3_stmt*', 'int'],
		['sqlite3_column_value', 'sqlite3_value*', 'sqlite3_stmt*', 'int'],
		['sqlite3_commit_hook', 'void*', ['sqlite3*', FPA({ name: 'sqlite3_commit_hook', signature: 'i(p)', contextKey }), '*']],
		['sqlite3_compileoption_get', 'string', 'int'],
		['sqlite3_compileoption_used', 'int', 'string'],
		['sqlite3_complete', 'int', 'string:flexible'],
		['sqlite3_context_db_handle', 'sqlite3*', 'sqlite3_context*'],
		['sqlite3_data_count', 'int', 'sqlite3_stmt*'],
		['sqlite3_db_filename', 'string', 'sqlite3*', 'string'],
		['sqlite3_db_handle', 'sqlite3*', 'sqlite3_stmt*'],
		['sqlite3_db_name', 'string', 'sqlite3*', 'int'],
		['sqlite3_db_status', 'int', 'sqlite3*', 'int', '*', '*', 'int'],
		['sqlite3_errcode', 'int', 'sqlite3*'],
		['sqlite3_errmsg', 'string', 'sqlite3*'],
		['sqlite3_error_offset', 'int', 'sqlite3*'],
		['sqlite3_errstr', 'string', 'int'],
		[
			'sqlite3_exec',
			'int',
			[
				'sqlite3*',
				'string:flexible',
				FPA({
					signature: 'i(pipp)',
					bindScope: 'transient',
					callProxy: (callback) => {
						return (_, nc, cv, cn) => {
							try {
								return callback(wasm.cArgvToJs(nc, cv), wasm.cArgvToJs(nc, cn)) | 0
							} catch (e) {
								return e.resultCode || capi.SQLITE_ERROR
							}
						}
					},
				}),
				'*',
				'**',
			],
		],
		['sqlite3_expanded_sql', 'string', 'sqlite3_stmt*'],
		['sqlite3_extended_errcode', 'int', 'sqlite3*'],
		['sqlite3_extended_result_codes', 'int', 'sqlite3*', 'int'],
		['sqlite3_file_control', 'int', 'sqlite3*', 'string', 'int', '*'],
		['sqlite3_finalize', 'int', 'sqlite3_stmt*'],
		['sqlite3_free', undefined, '*'],
		['sqlite3_get_auxdata', '*', 'sqlite3_context*', 'int'],
		['sqlite3_initialize', undefined],
		['sqlite3_keyword_count', 'int'],
		['sqlite3_keyword_name', 'int', ['int', '**', '*']],
		['sqlite3_keyword_check', 'int', ['string', 'int']],
		['sqlite3_libversion', 'string'],
		['sqlite3_libversion_number', 'int'],
		['sqlite3_limit', 'int', ['sqlite3*', 'int', 'int']],
		['sqlite3_malloc', '*', 'int'],
		['sqlite3_open', 'int', 'string', '*'],
		['sqlite3_open_v2', 'int', 'string', '*', 'int', 'string'],
		[
			'sqlite3_progress_handler',
			undefined,
			['sqlite3*', 'int', FPA({ name: 'xProgressHandler', signature: 'i(p)', bindScope: 'context', contextKey }), '*'],
		],
		['sqlite3_realloc', '*', '*', 'int'],
		['sqlite3_reset', 'int', 'sqlite3_stmt*'],
		['sqlite3_result_blob', undefined, 'sqlite3_context*', '*', 'int', '*'],
		['sqlite3_result_double', undefined, 'sqlite3_context*', 'f64'],
		['sqlite3_result_error', undefined, 'sqlite3_context*', 'string', 'int'],
		['sqlite3_result_error_code', undefined, 'sqlite3_context*', 'int'],
		['sqlite3_result_error_nomem', undefined, 'sqlite3_context*'],
		['sqlite3_result_error_toobig', undefined, 'sqlite3_context*'],
		['sqlite3_result_int', undefined, 'sqlite3_context*', 'int'],
		['sqlite3_result_null', undefined, 'sqlite3_context*'],
		['sqlite3_result_pointer', undefined, 'sqlite3_context*', '*', 'string:static', '*'],
		['sqlite3_result_subtype', undefined, 'sqlite3_value*', 'int'],
		['sqlite3_result_text', undefined, 'sqlite3_context*', 'string', 'int', '*'],
		['sqlite3_result_zeroblob', undefined, 'sqlite3_context*', 'int'],
		['sqlite3_rollback_hook', 'void*', ['sqlite3*', FPA({ name: 'sqlite3_rollback_hook', signature: 'v(p)', contextKey }), '*']],
		[
			'sqlite3_set_authorizer',
			'int',
			[
				'sqlite3*',
				FPA({
					name: 'sqlite3_set_authorizer::xAuth',
					signature: 'i(pissss)',
					contextKey,
					callProxy: (callback) => {
						return (pV, iCode, s0, s1, s2, s3) => {
							try {
								s0 = s0 && wasm.cstrToJs(s0)
								s1 = s1 && wasm.cstrToJs(s1)
								s2 = s2 && wasm.cstrToJs(s2)
								s3 = s3 && wasm.cstrToJs(s3)
								return callback(pV, iCode, s0, s1, s2, s3) || 0
							} catch (e) {
								return e.resultCode || capi.SQLITE_ERROR
							}
						}
					},
				}),
				'*',
			],
		],
		['sqlite3_set_auxdata', undefined, ['sqlite3_context*', 'int', '*', FPA({ name: 'xDestroyAuxData', signature: 'v(*)', contextKey })]],
		['sqlite3_shutdown', undefined],
		['sqlite3_sourceid', 'string'],
		['sqlite3_sql', 'string', 'sqlite3_stmt*'],
		['sqlite3_status', 'int', 'int', '*', '*', 'int'],
		['sqlite3_step', 'int', 'sqlite3_stmt*'],
		['sqlite3_stmt_isexplain', 'int', ['sqlite3_stmt*']],
		['sqlite3_stmt_readonly', 'int', ['sqlite3_stmt*']],
		['sqlite3_stmt_status', 'int', 'sqlite3_stmt*', 'int', 'int'],
		['sqlite3_strglob', 'int', 'string', 'string'],
		['sqlite3_stricmp', 'int', 'string', 'string'],
		['sqlite3_strlike', 'int', 'string', 'string', 'int'],
		['sqlite3_strnicmp', 'int', 'string', 'string', 'int'],
		['sqlite3_table_column_metadata', 'int', 'sqlite3*', 'string', 'string', 'string', '**', '**', '*', '*', '*'],
		['sqlite3_total_changes', 'int', 'sqlite3*'],
		['sqlite3_trace_v2', 'int', ['sqlite3*', 'int', FPA({ name: 'sqlite3_trace_v2::callback', signature: 'i(ippp)', contextKey }), '*']],
		['sqlite3_txn_state', 'int', ['sqlite3*', 'string']],
		['sqlite3_uri_boolean', 'int', 'sqlite3_filename', 'string', 'int'],
		['sqlite3_uri_key', 'string', 'sqlite3_filename', 'int'],
		['sqlite3_uri_parameter', 'string', 'sqlite3_filename', 'string'],
		['sqlite3_user_data', 'void*', 'sqlite3_context*'],
		['sqlite3_value_blob', '*', 'sqlite3_value*'],
		['sqlite3_value_bytes', 'int', 'sqlite3_value*'],
		['sqlite3_value_double', 'f64', 'sqlite3_value*'],
		['sqlite3_value_dup', 'sqlite3_value*', 'sqlite3_value*'],
		['sqlite3_value_free', undefined, 'sqlite3_value*'],
		['sqlite3_value_frombind', 'int', 'sqlite3_value*'],
		['sqlite3_value_int', 'int', 'sqlite3_value*'],
		['sqlite3_value_nochange', 'int', 'sqlite3_value*'],
		['sqlite3_value_numeric_type', 'int', 'sqlite3_value*'],
		['sqlite3_value_pointer', '*', 'sqlite3_value*', 'string:static'],
		['sqlite3_value_subtype', 'int', 'sqlite3_value*'],
		['sqlite3_value_text', 'string', 'sqlite3_value*'],
		['sqlite3_value_type', 'int', 'sqlite3_value*'],
		['sqlite3_vfs_find', '*', 'string'],
		['sqlite3_vfs_register', 'int', 'sqlite3_vfs*', 'int'],
		['sqlite3_vfs_unregister', 'int', 'sqlite3_vfs*'],
	]

	wasm.bindingSignatures.int64 = [
		['sqlite3_bind_int64', 'int', ['sqlite3_stmt*', 'int', 'i64']],
		['sqlite3_changes64', 'i64', ['sqlite3*']],
		['sqlite3_column_int64', 'i64', ['sqlite3_stmt*', 'int']],
		['sqlite3_create_module', 'int', ['sqlite3*', 'string', 'sqlite3_module*', '*']],
		['sqlite3_create_module_v2', 'int', ['sqlite3*', 'string', 'sqlite3_module*', '*', '*']],
		['sqlite3_declare_vtab', 'int', ['sqlite3*', 'string:flexible']],
		['sqlite3_deserialize', 'int', 'sqlite3*', 'string', '*', 'i64', 'i64', 'int'],
		['sqlite3_drop_modules', 'int', ['sqlite3*', '**']],
		['sqlite3_last_insert_rowid', 'i64', ['sqlite3*']],
		['sqlite3_malloc64', '*', 'i64'],
		['sqlite3_msize', 'i64', '*'],
		['sqlite3_overload_function', 'int', ['sqlite3*', 'string', 'int']],
		['sqlite3_preupdate_blobwrite', 'int', 'sqlite3*'],
		['sqlite3_preupdate_count', 'int', 'sqlite3*'],
		['sqlite3_preupdate_depth', 'int', 'sqlite3*'],
		[
			'sqlite3_preupdate_hook',
			'*',
			[
				'sqlite3*',
				FPA({
					name: 'sqlite3_preupdate_hook',
					signature: 'v(ppippjj)',
					contextKey,
					callProxy: (callback) => {
						return (p, db, op, zDb, zTbl, iKey1, iKey2) => {
							callback(p, db, op, wasm.cstrToJs(zDb), wasm.cstrToJs(zTbl), iKey1, iKey2)
						}
					},
				}),
				'*',
			],
		],
		['sqlite3_preupdate_new', 'int', ['sqlite3*', 'int', '**']],
		['sqlite3_preupdate_old', 'int', ['sqlite3*', 'int', '**']],
		['sqlite3_realloc64', '*', '*', 'i64'],
		['sqlite3_result_int64', undefined, '*', 'i64'],
		['sqlite3_result_zeroblob64', 'int', '*', 'i64'],
		['sqlite3_serialize', '*', 'sqlite3*', 'string', '*', 'int'],
		['sqlite3_set_last_insert_rowid', undefined, ['sqlite3*', 'i64']],
		['sqlite3_status64', 'int', 'int', '*', '*', 'int'],
		['sqlite3_total_changes64', 'i64', ['sqlite3*']],
		[
			'sqlite3_update_hook',
			'*',
			[
				'sqlite3*',
				FPA({
					name: 'sqlite3_update_hook',
					signature: 'v(iippj)',
					contextKey,
					callProxy: (callback) => {
						return (p, op, z0, z1, rowid) => {
							callback(p, op, wasm.cstrToJs(z0), wasm.cstrToJs(z1), rowid)
						}
					},
				}),
				'*',
			],
		],
		['sqlite3_uri_int64', 'i64', ['sqlite3_filename', 'string', 'i64']],
		['sqlite3_value_int64', 'i64', 'sqlite3_value*'],
		['sqlite3_vtab_collation', 'string', 'sqlite3_index_info*', 'int'],
		['sqlite3_vtab_distinct', 'int', 'sqlite3_index_info*'],
		['sqlite3_vtab_in', 'int', 'sqlite3_index_info*', 'int', 'int'],
		['sqlite3_vtab_in_first', 'int', 'sqlite3_value*', '**'],
		['sqlite3_vtab_in_next', 'int', 'sqlite3_value*', '**'],

		['sqlite3_vtab_nochange', 'int', 'sqlite3_context*'],
		['sqlite3_vtab_on_conflict', 'int', 'sqlite3*'],
		['sqlite3_vtab_rhs_value', 'int', 'sqlite3_index_info*', 'int', '**'],
	]

	if (!!wasm.exports.sqlite3changegroup_add) {
		const __ipsProxy = {
			signature: 'i(ps)',
			callProxy: (callback) => (p, s) => {
				try {
					return callback(p, wasm.cstrToJs(s)) | 0
				} catch (e) {
					return e.resultCode || capi.SQLITE_ERROR
				}
			},
		}

		wasm.bindingSignatures.int64.push(
			...[
				['sqlite3changegroup_add', 'int', ['sqlite3_changegroup*', 'int', 'void*']],
				[
					'sqlite3changegroup_add_strm',
					'int',
					['sqlite3_changegroup*', FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }), 'void*'],
				],
				['sqlite3changegroup_delete', undefined, ['sqlite3_changegroup*']],
				['sqlite3changegroup_new', 'int', ['**']],
				['sqlite3changegroup_output', 'int', ['sqlite3_changegroup*', 'int*', '**']],
				[
					'sqlite3changegroup_output_strm',
					'int',
					['sqlite3_changegroup*', FPA({ name: 'xOutput', signature: 'i(ppi)', bindScope: 'transient' }), 'void*'],
				],
				[
					'sqlite3changeset_apply',
					'int',
					[
						'sqlite3*',
						'int',
						'void*',
						FPA({ name: 'xFilter', bindScope: 'transient', ...__ipsProxy }),
						FPA({ name: 'xConflict', signature: 'i(pip)', bindScope: 'transient' }),
						'void*',
					],
				],
				[
					'sqlite3changeset_apply_strm',
					'int',
					[
						'sqlite3*',
						FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }),
						'void*',
						FPA({ name: 'xFilter', bindScope: 'transient', ...__ipsProxy }),
						FPA({ name: 'xConflict', signature: 'i(pip)', bindScope: 'transient' }),
						'void*',
					],
				],
				[
					'sqlite3changeset_apply_v2',
					'int',
					[
						'sqlite3*',
						'int',
						'void*',
						FPA({ name: 'xFilter', bindScope: 'transient', ...__ipsProxy }),
						FPA({ name: 'xConflict', signature: 'i(pip)', bindScope: 'transient' }),
						'void*',
						'**',
						'int*',
						'int',
					],
				],
				[
					'sqlite3changeset_apply_v2_strm',
					'int',
					[
						'sqlite3*',
						FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }),
						'void*',
						FPA({ name: 'xFilter', bindScope: 'transient', ...__ipsProxy }),
						FPA({ name: 'xConflict', signature: 'i(pip)', bindScope: 'transient' }),
						'void*',
						'**',
						'int*',
						'int',
					],
				],
				['sqlite3changeset_concat', 'int', ['int', 'void*', 'int', 'void*', 'int*', '**']],
				[
					'sqlite3changeset_concat_strm',
					'int',
					[
						FPA({ name: 'xInputA', signature: 'i(ppp)', bindScope: 'transient' }),
						'void*',
						FPA({ name: 'xInputB', signature: 'i(ppp)', bindScope: 'transient' }),
						'void*',
						FPA({ name: 'xOutput', signature: 'i(ppi)', bindScope: 'transient' }),
						'void*',
					],
				],
				['sqlite3changeset_conflict', 'int', ['sqlite3_changeset_iter*', 'int', '**']],
				['sqlite3changeset_finalize', 'int', ['sqlite3_changeset_iter*']],
				['sqlite3changeset_fk_conflicts', 'int', ['sqlite3_changeset_iter*', 'int*']],
				['sqlite3changeset_invert', 'int', ['int', 'void*', 'int*', '**']],
				[
					'sqlite3changeset_invert_strm',
					'int',
					[
						FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }),
						'void*',
						FPA({ name: 'xOutput', signature: 'i(ppi)', bindScope: 'transient' }),
						'void*',
					],
				],
				['sqlite3changeset_new', 'int', ['sqlite3_changeset_iter*', 'int', '**']],
				['sqlite3changeset_next', 'int', ['sqlite3_changeset_iter*']],
				['sqlite3changeset_old', 'int', ['sqlite3_changeset_iter*', 'int', '**']],
				['sqlite3changeset_op', 'int', ['sqlite3_changeset_iter*', '**', 'int*', 'int*', 'int*']],
				['sqlite3changeset_pk', 'int', ['sqlite3_changeset_iter*', '**', 'int*']],
				['sqlite3changeset_start', 'int', ['**', 'int', '*']],
				['sqlite3changeset_start_strm', 'int', ['**', FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }), 'void*']],
				['sqlite3changeset_start_v2', 'int', ['**', 'int', '*', 'int']],
				['sqlite3changeset_start_v2_strm', 'int', ['**', FPA({ name: 'xInput', signature: 'i(ppp)', bindScope: 'transient' }), 'void*', 'int']],
				['sqlite3session_attach', 'int', ['sqlite3_session*', 'string']],
				['sqlite3session_changeset', 'int', ['sqlite3_session*', 'int*', '**']],
				['sqlite3session_changeset_size', 'i64', ['sqlite3_session*']],
				[
					'sqlite3session_changeset_strm',
					'int',
					['sqlite3_session*', FPA({ name: 'xOutput', signature: 'i(ppp)', bindScope: 'transient' }), 'void*'],
				],
				['sqlite3session_config', 'int', ['int', 'void*']],
				['sqlite3session_create', 'int', ['sqlite3*', 'string', '**']],

				['sqlite3session_diff', 'int', ['sqlite3_session*', 'string', 'string', '**']],
				['sqlite3session_enable', 'int', ['sqlite3_session*', 'int']],
				['sqlite3session_indirect', 'int', ['sqlite3_session*', 'int']],
				['sqlite3session_isempty', 'int', ['sqlite3_session*']],
				['sqlite3session_memory_used', 'i64', ['sqlite3_session*']],
				['sqlite3session_object_config', 'int', ['sqlite3_session*', 'int', 'void*']],
				['sqlite3session_patchset', 'int', ['sqlite3_session*', '*', '**']],
				['sqlite3session_patchset_strm', 'int', ['sqlite3_session*', FPA({ name: 'xOutput', signature: 'i(ppp)', bindScope: 'transient' }), 'void*']],
				['sqlite3session_table_filter', undefined, ['sqlite3_session*', FPA({ name: 'xFilter', ...__ipsProxy, contextKey }), '*']],
			]
		)
	}

	wasm.bindingSignatures.wasm = [
		['sqlite3_wasm_db_reset', 'int', 'sqlite3*'],
		['sqlite3_wasm_db_vfs', 'sqlite3_vfs*', 'sqlite3*', 'string'],
		['sqlite3_wasm_vfs_create_file', 'int', 'sqlite3_vfs*', 'string', '*', 'int'],
		['sqlite3_wasm_posix_create_file', 'int', 'string', '*', 'int'],
		['sqlite3_wasm_vfs_unlink', 'int', 'sqlite3_vfs*', 'string'],
	]

	sqlite3.StructBinder = Jaccwabyt({
		heap: wasm.heap8u,
		alloc: wasm.alloc,
		dealloc: wasm.dealloc,
		memberPrefix: '$',
	})

	{
		const __xString = wasm.xWrap.argAdapter('string')
		wasm.xWrap.argAdapter('string:flexible', (v) => __xString(util.flexibleString(v)))

		wasm.xWrap.argAdapter(
			'string:static',
			function (v) {
				if (wasm.isPtr(v)) return v
				v = '' + v
				let rc = this[v]
				return rc || (this[v] = wasm.allocCString(v))
			}.bind(Object.create(null))
		)

		const __xArgPtr = wasm.xWrap.argAdapter('*')
		const nilType = function () {}
		wasm.xWrap.argAdapter('sqlite3_filename', __xArgPtr)('sqlite3_context*', __xArgPtr)('sqlite3_value*', __xArgPtr)('void*', __xArgPtr)(
			'sqlite3_changegroup*',
			__xArgPtr
		)('sqlite3_changeset_iter*', __xArgPtr)('sqlite3_session*', __xArgPtr)('sqlite3_stmt*', (v) =>
			__xArgPtr(v instanceof (sqlite3?.oo1?.Stmt || nilType) ? v.pointer : v)
		)('sqlite3*', (v) => __xArgPtr(v instanceof (sqlite3?.oo1?.DB || nilType) ? v.pointer : v))('sqlite3_index_info*', (v) =>
			__xArgPtr(v instanceof (capi.sqlite3_index_info || nilType) ? v.pointer : v)
		)('sqlite3_module*', (v) => __xArgPtr(v instanceof (capi.sqlite3_module || nilType) ? v.pointer : v))('sqlite3_vfs*', (v) => {
			if ('string' === typeof v) return capi.sqlite3_vfs_find(v) || sqlite3.SQLite3Error.toss(capi.SQLITE_NOTFOUND, 'Unknown sqlite3_vfs name:', v)
			return __xArgPtr(v instanceof (capi.sqlite3_vfs || nilType) ? v.pointer : v)
		})

		const __xRcPtr = wasm.xWrap.resultAdapter('*')
		wasm.xWrap.resultAdapter('sqlite3*', __xRcPtr)('sqlite3_context*', __xRcPtr)('sqlite3_stmt*', __xRcPtr)('sqlite3_value*', __xRcPtr)(
			'sqlite3_vfs*',
			__xRcPtr
		)('void*', __xRcPtr)

		if (0 === wasm.exports.sqlite3_step.length) {
			wasm.xWrap.doArgcCheck = false
			sqlite3.config.warn('Disabling sqlite3.wasm.xWrap.doArgcCheck due to environmental quirks.')
		}
		for (const e of wasm.bindingSignatures) {
			capi[e[0]] = wasm.xWrap.apply(null, e)
		}
		for (const e of wasm.bindingSignatures.int64) {
			capi[e[0]] = wasm.xWrap.apply(null, e)
		}
		for (const e of wasm.bindingSignatures.wasm) {
			wasm[e[0]] = wasm.xWrap.apply(null, e)
		}

		delete wasm.bindingSignatures

		if (wasm.exports.sqlite3_wasm_db_error) {
			const __db_err = wasm.xWrap('sqlite3_wasm_db_error', 'int', 'sqlite3*', 'int', 'string')

			util.sqlite3_wasm_db_error = function (pDb, resultCode, message) {
				if (resultCode instanceof sqlite3.WasmAllocError) {
					resultCode = capi.SQLITE_NOMEM
					message = 0
				} else if (resultCode instanceof Error) {
					message = message || '' + resultCode
					resultCode = resultCode.resultCode || capi.SQLITE_ERROR
				}
				return pDb ? __db_err(pDb, resultCode, message) : resultCode
			}
		} else {
			util.sqlite3_wasm_db_error = function (pDb, errCode, msg) {
				console.warn('sqlite3_wasm_db_error() is not exported.', arguments)
				return errCode
			}
		}
	}

	{
		const cJson = wasm.xCall('sqlite3_wasm_enum_json')
		if (!cJson) {
			toss("Maintenance required: increase sqlite3_wasm_enum_json()'s", 'static buffer size!')
		}

		wasm.ctype = JSON.parse(wasm.cstrToJs(cJson))

		for (const t of defineGroups) {
			for (const e of Object.entries(wasm.ctype[t])) {
				capi[e[0]] = e[1]
			}
		}
		if (!wasm.functionEntry(capi.SQLITE_WASM_DEALLOC)) {
			toss('Internal error: cannot resolve exported function', 'entry SQLITE_WASM_DEALLOC (==' + capi.SQLITE_WASM_DEALLOC + ').')
		}
		const __rcMap = Object.create(null)
		for (const t of ['resultCodes']) {
			for (const e of Object.entries(wasm.ctype[t])) {
				__rcMap[e[1]] = e[0]
			}
		}

		capi.sqlite3_js_rc_str = (rc) => __rcMap[rc]

		const notThese = Object.assign(Object.create(null), { WasmTestStruct: true })
		for (const s of wasm.ctype.structs) {
			if (!notThese[s.name]) {
				capi[s.name] = sqlite3.StructBinder(s)
			}
		}
		if (capi.sqlite3_index_info) {
			for (const k of ['sqlite3_index_constraint', 'sqlite3_index_orderby', 'sqlite3_index_constraint_usage']) {
				capi.sqlite3_index_info[k] = capi[k]
				delete capi[k]
			}
			capi.sqlite3_vtab_config = wasm.xWrap('sqlite3_wasm_vtab_config', 'int', ['sqlite3*', 'int', 'int'])
		}
	}

	const __dbArgcMismatch = (pDb, f, n) => {
		return util.sqlite3_wasm_db_error(pDb, capi.SQLITE_MISUSE, f + '() requires ' + n + ' argument' + (1 === n ? '' : 's') + '.')
	}

	const __errEncoding = (pDb) => {
		return util.sqlite3_wasm_db_error(pDb, capi.SQLITE_FORMAT, 'SQLITE_UTF8 is the only supported encoding.')
	}

	const __argPDb = (pDb) => wasm.xWrap.argAdapter('sqlite3*')(pDb)
	const __argStr = (str) => (wasm.isPtr(str) ? wasm.cstrToJs(str) : str)
	const __dbCleanupMap = function (pDb, mode) {
		pDb = __argPDb(pDb)
		let m = this.dbMap.get(pDb)
		if (!mode) {
			this.dbMap.delete(pDb)
			return m
		} else if (!m && mode > 0) {
			this.dbMap.set(pDb, (m = Object.create(null)))
		}
		return m
	}.bind(
		Object.assign(Object.create(null), {
			dbMap: new Map(),
		})
	)

	__dbCleanupMap.addCollation = function (pDb, name) {
		const m = __dbCleanupMap(pDb, 1)
		if (!m.collation) m.collation = new Set()
		m.collation.add(__argStr(name).toLowerCase())
	}

	__dbCleanupMap._addUDF = function (pDb, name, arity, map) {
		name = __argStr(name).toLowerCase()
		let u = map.get(name)
		if (!u) map.set(name, (u = new Set()))
		u.add(arity < 0 ? -1 : arity)
	}

	__dbCleanupMap.addFunction = function (pDb, name, arity) {
		const m = __dbCleanupMap(pDb, 1)
		if (!m.udf) m.udf = new Map()
		this._addUDF(pDb, name, arity, m.udf)
	}

	__dbCleanupMap.addWindowFunc = function (pDb, name, arity) {
		const m = __dbCleanupMap(pDb, 1)
		if (!m.wudf) m.wudf = new Map()
		this._addUDF(pDb, name, arity, m.wudf)
	}

	__dbCleanupMap.cleanup = function (pDb) {
		pDb = __argPDb(pDb)

		const closeArgs = [pDb]
		for (const name of [
			'sqlite3_busy_handler',
			'sqlite3_commit_hook',
			'sqlite3_preupdate_hook',
			'sqlite3_progress_handler',
			'sqlite3_rollback_hook',
			'sqlite3_set_authorizer',
			'sqlite3_trace_v2',
			'sqlite3_update_hook',
		]) {
			const x = wasm.exports[name]
			closeArgs.length = x.length
			try {
				capi[name](...closeArgs)
			} catch (e) {
				console.warn('close-time call of', name + '(', closeArgs, ') threw:', e)
			}
		}
		const m = __dbCleanupMap(pDb, 0)
		if (!m) return
		if (m.collation) {
			for (const name of m.collation) {
				try {
					capi.sqlite3_create_collation_v2(pDb, name, capi.SQLITE_UTF8, 0, 0, 0)
				} catch (e) {}
			}
			delete m.collation
		}
		let i
		for (i = 0; i < 2; ++i) {
			const fmap = i ? m.wudf : m.udf
			if (!fmap) continue
			const func = i ? capi.sqlite3_create_window_function : capi.sqlite3_create_function_v2
			for (const e of fmap) {
				const name = e[0],
					arities = e[1]
				const fargs = [pDb, name, 0, capi.SQLITE_UTF8, 0, 0, 0, 0, 0]
				if (i) fargs.push(0)
				for (const arity of arities) {
					try {
						fargs[2] = arity
						func.apply(null, fargs)
					} catch (e) {}
				}
				arities.clear()
			}
			fmap.clear()
		}
		delete m.udf
		delete m.wudf
	}

	{
		const __sqlite3CloseV2 = wasm.xWrap('sqlite3_close_v2', 'int', 'sqlite3*')
		capi.sqlite3_close_v2 = function (pDb) {
			if (1 !== arguments.length) return __dbArgcMismatch(pDb, 'sqlite3_close_v2', 1)
			if (pDb) {
				try {
					__dbCleanupMap.cleanup(pDb)
				} catch (e) {}
			}
			return __sqlite3CloseV2(pDb)
		}
	}

	if (capi.sqlite3session_table_filter) {
		const __sqlite3SessionDelete = wasm.xWrap('sqlite3session_delete', undefined, ['sqlite3_session*'])
		capi.sqlite3session_delete = function (pSession) {
			if (1 !== arguments.length) {
				return __dbArgcMismatch(pDb, 'sqlite3session_delete', 1)
			} else if (pSession) {
				capi.sqlite3session_table_filter(pSession, 0, 0)
			}
			__sqlite3SessionDelete(pSession)
		}
	}

	{
		const contextKey = (argv, argIndex) => {
			return 'argv[' + argIndex + ']:' + argv[0] + ':' + wasm.cstrToJs(argv[1]).toLowerCase()
		}
		const __sqlite3CreateCollationV2 = wasm.xWrap('sqlite3_create_collation_v2', 'int', [
			'sqlite3*',
			'string',
			'int',
			'*',
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xCompare',
				signature: 'i(pipip)',
				contextKey,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xDestroy',
				signature: 'v(p)',
				contextKey,
			}),
		])

		capi.sqlite3_create_collation_v2 = function (pDb, zName, eTextRep, pArg, xCompare, xDestroy) {
			if (6 !== arguments.length) return __dbArgcMismatch(pDb, 'sqlite3_create_collation_v2', 6)
			else if (0 === (eTextRep & 0xf)) {
				eTextRep |= capi.SQLITE_UTF8
			} else if (capi.SQLITE_UTF8 !== (eTextRep & 0xf)) {
				return __errEncoding(pDb)
			}
			try {
				const rc = __sqlite3CreateCollationV2(pDb, zName, eTextRep, pArg, xCompare, xDestroy)
				if (0 === rc && xCompare instanceof Function) {
					__dbCleanupMap.addCollation(pDb, zName)
				}
				return rc
			} catch (e) {
				return util.sqlite3_wasm_db_error(pDb, e)
			}
		}

		capi.sqlite3_create_collation = (pDb, zName, eTextRep, pArg, xCompare) => {
			return 5 === arguments.length
				? capi.sqlite3_create_collation_v2(pDb, zName, eTextRep, pArg, xCompare, 0)
				: __dbArgcMismatch(pDb, 'sqlite3_create_collation', 5)
		}
	}

	{
		const contextKey = function (argv, argIndex) {
			return argv[0] + ':' + (argv[2] < 0 ? -1 : argv[2]) + ':' + argIndex + ':' + wasm.cstrToJs(argv[1]).toLowerCase()
		}

		const __cfProxy = Object.assign(Object.create(null), {
			xInverseAndStep: {
				signature: 'v(pip)',
				contextKey,
				callProxy: (callback) => {
					return (pCtx, argc, pArgv) => {
						try {
							callback(pCtx, ...capi.sqlite3_values_to_js(argc, pArgv))
						} catch (e) {
							capi.sqlite3_result_error_js(pCtx, e)
						}
					}
				},
			},
			xFinalAndValue: {
				signature: 'v(p)',
				contextKey,
				callProxy: (callback) => {
					return (pCtx) => {
						try {
							capi.sqlite3_result_js(pCtx, callback(pCtx))
						} catch (e) {
							capi.sqlite3_result_error_js(pCtx, e)
						}
					}
				},
			},
			xFunc: {
				signature: 'v(pip)',
				contextKey,
				callProxy: (callback) => {
					return (pCtx, argc, pArgv) => {
						try {
							capi.sqlite3_result_js(pCtx, callback(pCtx, ...capi.sqlite3_values_to_js(argc, pArgv)))
						} catch (e) {
							capi.sqlite3_result_error_js(pCtx, e)
						}
					}
				},
			},
			xDestroy: {
				signature: 'v(p)',
				contextKey,

				callProxy: (callback) => {
					return (pVoid) => {
						try {
							callback(pVoid)
						} catch (e) {
							console.error('UDF xDestroy method threw:', e)
						}
					}
				},
			},
		})

		const __sqlite3CreateFunction = wasm.xWrap('sqlite3_create_function_v2', 'int', [
			'sqlite3*',
			'string',
			'int',
			'int',
			'*',
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xFunc',
				...__cfProxy.xFunc,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xStep',
				...__cfProxy.xInverseAndStep,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xFinal',
				...__cfProxy.xFinalAndValue,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xDestroy',
				...__cfProxy.xDestroy,
			}),
		])

		const __sqlite3CreateWindowFunction = wasm.xWrap('sqlite3_create_window_function', 'int', [
			'sqlite3*',
			'string',
			'int',
			'int',
			'*',
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xStep',
				...__cfProxy.xInverseAndStep,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xFinal',
				...__cfProxy.xFinalAndValue,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xValue',
				...__cfProxy.xFinalAndValue,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xInverse',
				...__cfProxy.xInverseAndStep,
			}),
			new wasm.xWrap.FuncPtrAdapter({
				name: 'xDestroy',
				...__cfProxy.xDestroy,
			}),
		])

		capi.sqlite3_create_function_v2 = function f(pDb, funcName, nArg, eTextRep, pApp, xFunc, xStep, xFinal, xDestroy) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(pDb, 'sqlite3_create_function_v2', f.length)
			} else if (0 === (eTextRep & 0xf)) {
				eTextRep |= capi.SQLITE_UTF8
			} else if (capi.SQLITE_UTF8 !== (eTextRep & 0xf)) {
				return __errEncoding(pDb)
			}
			try {
				const rc = __sqlite3CreateFunction(pDb, funcName, nArg, eTextRep, pApp, xFunc, xStep, xFinal, xDestroy)
				if (0 === rc && (xFunc instanceof Function || xStep instanceof Function || xFinal instanceof Function || xDestroy instanceof Function)) {
					__dbCleanupMap.addFunction(pDb, funcName, nArg)
				}
				return rc
			} catch (e) {
				console.error('sqlite3_create_function_v2() setup threw:', e)
				return util.sqlite3_wasm_db_error(pDb, e, 'Creation of UDF threw: ' + e)
			}
		}

		capi.sqlite3_create_function = function f(pDb, funcName, nArg, eTextRep, pApp, xFunc, xStep, xFinal) {
			return f.length === arguments.length
				? capi.sqlite3_create_function_v2(pDb, funcName, nArg, eTextRep, pApp, xFunc, xStep, xFinal, 0)
				: __dbArgcMismatch(pDb, 'sqlite3_create_function', f.length)
		}

		capi.sqlite3_create_window_function = function f(pDb, funcName, nArg, eTextRep, pApp, xStep, xFinal, xValue, xInverse, xDestroy) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(pDb, 'sqlite3_create_window_function', f.length)
			} else if (0 === (eTextRep & 0xf)) {
				eTextRep |= capi.SQLITE_UTF8
			} else if (capi.SQLITE_UTF8 !== (eTextRep & 0xf)) {
				return __errEncoding(pDb)
			}
			try {
				const rc = __sqlite3CreateWindowFunction(pDb, funcName, nArg, eTextRep, pApp, xStep, xFinal, xValue, xInverse, xDestroy)
				if (
					0 === rc &&
					(xStep instanceof Function ||
						xFinal instanceof Function ||
						xValue instanceof Function ||
						xInverse instanceof Function ||
						xDestroy instanceof Function)
				) {
					__dbCleanupMap.addWindowFunc(pDb, funcName, nArg)
				}
				return rc
			} catch (e) {
				console.error('sqlite3_create_window_function() setup threw:', e)
				return util.sqlite3_wasm_db_error(pDb, e, 'Creation of UDF threw: ' + e)
			}
		}

		capi.sqlite3_create_function_v2.udfSetResult =
			capi.sqlite3_create_function.udfSetResult =
			capi.sqlite3_create_window_function.udfSetResult =
				capi.sqlite3_result_js

		capi.sqlite3_create_function_v2.udfConvertArgs =
			capi.sqlite3_create_function.udfConvertArgs =
			capi.sqlite3_create_window_function.udfConvertArgs =
				capi.sqlite3_values_to_js

		capi.sqlite3_create_function_v2.udfSetError =
			capi.sqlite3_create_function.udfSetError =
			capi.sqlite3_create_window_function.udfSetError =
				capi.sqlite3_result_error_js
	}

	{
		const __flexiString = (v, n) => {
			if ('string' === typeof v) {
				n = -1
			} else if (util.isSQLableTypedArray(v)) {
				n = v.byteLength
				v = util.typedArrayToString(v instanceof ArrayBuffer ? new Uint8Array(v) : v)
			} else if (Array.isArray(v)) {
				v = v.join('')
				n = -1
			}
			return [v, n]
		}

		const __prepare = {
			basic: wasm.xWrap('sqlite3_prepare_v3', 'int', ['sqlite3*', 'string', 'int', 'int', '**', '**']),

			full: wasm.xWrap('sqlite3_prepare_v3', 'int', ['sqlite3*', '*', 'int', 'int', '**', '**']),
		}

		capi.sqlite3_prepare_v3 = function f(pDb, sql, sqlLen, prepFlags, ppStmt, pzTail) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(pDb, 'sqlite3_prepare_v3', f.length)
			}
			const [xSql, xSqlLen] = __flexiString(sql, sqlLen)
			switch (typeof xSql) {
				case 'string':
					return __prepare.basic(pDb, xSql, xSqlLen, prepFlags, ppStmt, null)
				case 'number':
					return __prepare.full(pDb, xSql, xSqlLen, prepFlags, ppStmt, pzTail)
				default:
					return util.sqlite3_wasm_db_error(pDb, capi.SQLITE_MISUSE, 'Invalid SQL argument type for sqlite3_prepare_v2/v3().')
			}
		}

		capi.sqlite3_prepare_v2 = function f(pDb, sql, sqlLen, ppStmt, pzTail) {
			return f.length === arguments.length
				? capi.sqlite3_prepare_v3(pDb, sql, sqlLen, 0, ppStmt, pzTail)
				: __dbArgcMismatch(pDb, 'sqlite3_prepare_v2', f.length)
		}
	}

	{
		const __bindText = wasm.xWrap('sqlite3_bind_text', 'int', ['sqlite3_stmt*', 'int', 'string', 'int', '*'])
		const __bindBlob = wasm.xWrap('sqlite3_bind_blob', 'int', ['sqlite3_stmt*', 'int', '*', 'int', '*'])

		capi.sqlite3_bind_text = function f(pStmt, iCol, text, nText, xDestroy) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(capi.sqlite3_db_handle(pStmt), 'sqlite3_bind_text', f.length)
			} else if (wasm.isPtr(text) || null === text) {
				return __bindText(pStmt, iCol, text, nText, xDestroy)
			} else if (text instanceof ArrayBuffer) {
				text = new Uint8Array(text)
			} else if (Array.isArray(pMem)) {
				text = pMem.join('')
			}
			let p, n
			try {
				if (util.isSQLableTypedArray(text)) {
					p = wasm.allocFromTypedArray(text)
					n = text.byteLength
				} else if ('string' === typeof text) {
					;[p, n] = wasm.allocCString(text)
				} else {
					return util.sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), capi.SQLITE_MISUSE, 'Invalid 3rd argument type for sqlite3_bind_text().')
				}
				return __bindText(pStmt, iCol, p, n, capi.SQLITE_WASM_DEALLOC)
			} catch (e) {
				wasm.dealloc(p)
				return util.sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), e)
			}
		}

		capi.sqlite3_bind_blob = function f(pStmt, iCol, pMem, nMem, xDestroy) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(capi.sqlite3_db_handle(pStmt), 'sqlite3_bind_blob', f.length)
			} else if (wasm.isPtr(pMem) || null === pMem) {
				return __bindBlob(pStmt, iCol, pMem, nMem, xDestroy)
			} else if (pMem instanceof ArrayBuffer) {
				pMem = new Uint8Array(pMem)
			} else if (Array.isArray(pMem)) {
				pMem = pMem.join('')
			}
			let p, n
			try {
				if (util.isBindableTypedArray(pMem)) {
					p = wasm.allocFromTypedArray(pMem)
					n = nMem >= 0 ? nMem : pMem.byteLength
				} else if ('string' === typeof pMem) {
					;[p, n] = wasm.allocCString(pMem)
				} else {
					return util.sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), capi.SQLITE_MISUSE, 'Invalid 3rd argument type for sqlite3_bind_blob().')
				}
				return __bindBlob(pStmt, iCol, p, n, capi.SQLITE_WASM_DEALLOC)
			} catch (e) {
				wasm.dealloc(p)
				return util.sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), e)
			}
		}
	}

	{
		capi.sqlite3_config = function (op, ...args) {
			if (arguments.length < 2) return capi.SQLITE_MISUSE
			switch (op) {
				case capi.SQLITE_CONFIG_COVERING_INDEX_SCAN:
				case capi.SQLITE_CONFIG_MEMSTATUS:
				case capi.SQLITE_CONFIG_SMALL_MALLOC:
				case capi.SQLITE_CONFIG_SORTERREF_SIZE:
				case capi.SQLITE_CONFIG_STMTJRNL_SPILL:
				case capi.SQLITE_CONFIG_URI:
					return wasm.exports.sqlite3_wasm_config_i(op, args[0])
				case capi.SQLITE_CONFIG_LOOKASIDE:
					return wasm.exports.sqlite3_wasm_config_ii(op, args[0], args[1])
				case capi.SQLITE_CONFIG_MEMDB_MAXSIZE:
					return wasm.exports.sqlite3_wasm_config_j(op, args[0])
				case capi.SQLITE_CONFIG_GETMALLOC:
				case capi.SQLITE_CONFIG_GETMUTEX:
				case capi.SQLITE_CONFIG_GETPCACHE2:
				case capi.SQLITE_CONFIG_GETPCACHE:
				case capi.SQLITE_CONFIG_HEAP:
				case capi.SQLITE_CONFIG_LOG:
				case capi.SQLITE_CONFIG_MALLOC:
				case capi.SQLITE_CONFIG_MMAP_SIZE:
				case capi.SQLITE_CONFIG_MULTITHREAD:
				case capi.SQLITE_CONFIG_MUTEX:
				case capi.SQLITE_CONFIG_PAGECACHE:
				case capi.SQLITE_CONFIG_PCACHE2:
				case capi.SQLITE_CONFIG_PCACHE:
				case capi.SQLITE_CONFIG_PCACHE_HDRSZ:
				case capi.SQLITE_CONFIG_PMASZ:
				case capi.SQLITE_CONFIG_SERIALIZED:
				case capi.SQLITE_CONFIG_SINGLETHREAD:
				case capi.SQLITE_CONFIG_SQLLOG:
				case capi.SQLITE_CONFIG_WIN32_HEAPSIZE:
				default:
					return capi.SQLITE_NOTFOUND
			}
		}
	}

	{
		const __autoExtFptr = new Set()

		capi.sqlite3_auto_extension = function (fPtr) {
			if (fPtr instanceof Function) {
				fPtr = wasm.installFunction('i(ppp)', fPtr)
			} else if (1 !== arguments.length || !wasm.isPtr(fPtr)) {
				return capi.SQLITE_MISUSE
			}
			const rc = wasm.exports.sqlite3_auto_extension(fPtr)
			if (fPtr !== arguments[0]) {
				if (0 === rc) __autoExtFptr.add(fPtr)
				else wasm.uninstallFunction(fPtr)
			}
			return rc
		}

		capi.sqlite3_cancel_auto_extension = function (fPtr) {
			if (!fPtr || 1 !== arguments.length || !wasm.isPtr(fPtr)) return 0
			return wasm.exports.sqlite3_cancel_auto_extension(fPtr)
		}

		capi.sqlite3_reset_auto_extension = function () {
			wasm.exports.sqlite3_reset_auto_extension()
			for (const fp of __autoExtFptr) wasm.uninstallFunction(fp)
			__autoExtFptr.clear()
		}
	}

	wasm.xWrap.FuncPtrAdapter.warnOnUse = true
}

function WhWasmUtilInstaller(target) {
	if (!target.exports) {
		Object.defineProperty(target, 'exports', {
			enumerable: true,
			configurable: true,
			get: () => target.instance && target.instance.exports,
		})
	}

	const ptrIR = target.pointerIR || 'i32'
	const ptrSizeof = (target.ptrSizeof = 'i32' === ptrIR ? 4 : 'i64' === ptrIR ? 8 : toss('Unhandled ptrSizeof:', ptrIR))

	const cache = Object.create(null)

	cache.heapSize = 0
	cache.memory = null
	cache.freeFuncIndexes = []
	cache.scopedAlloc = []

	target.sizeofIR = (n) => {
		switch (n) {
			case 'i8':
				return 1
			case 'i16':
				return 2
			case 'i32':
			case 'f32':
			case 'float':
				return 4
			case 'i64':
			case 'f64':
			case 'double':
				return 8
			case '*':
				return ptrSizeof
			default:
				return ('' + n).endsWith('*') ? ptrSizeof : undefined
		}
	}

	const heapWrappers = function () {
		if (!cache.memory) {
			cache.memory = target.memory instanceof WebAssembly.Memory ? target.memory : target.exports.memory
		} else if (cache.heapSize === cache.memory.buffer.byteLength) {
			return cache
		}

		const b = cache.memory.buffer
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
		const c = cache.memory && cache.heapSize === cache.memory.buffer.byteLength ? cache : heapWrappers()
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

	target.functionTable = function () {
		return target.exports.__indirect_function_table
	}

	target.functionEntry = function (fptr) {
		const ft = target.functionTable()
		return fptr < ft.length ? ft.get(fptr) : undefined
	}

	target.jsFuncToWasm = function f(func, sig) {
		if (!f._) {
			f._ = {
				sigTypes: Object.assign(Object.create(null), {
					i: 'i32',
					p: 'i32',
					P: 'i32',
					s: 'i32',
					j: 'i64',
					f: 'f32',
					d: 'f64',
				}),

				typeCodes: Object.assign(Object.create(null), {
					f64: 0x7c,
					f32: 0x7d,
					i64: 0x7e,
					i32: 0x7f,
				}),

				uleb128Encode: function (tgt, method, n) {
					if (n < 128) tgt[method](n)
					else tgt[method](n % 128 | 128, n >> 7)
				},

				rxJSig: /^(\w)\((\w*)\)$/,

				sigParams: function (sig) {
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
		wasmCode.push(
			0x02,
			0x07,

			0x01,
			0x01,
			0x65,
			0x01,
			0x66,
			0x00,
			0x00,
			0x07,
			0x05,

			0x01,
			0x01,
			0x66,
			0x00,
			0x00
		)
		return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(wasmCode)), {
			e: { f: func },
		}).exports['f']
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
		const ft = target.functionTable()
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
		const ft = target.functionTable()
		fi.push(ptr)
		const rc = ft.get(ptr)
		ft.set(ptr, null)
		return rc
	}

	target.peek = function f(ptr, type = 'i8') {
		if (type.endsWith('*')) type = ptrIR
		const c = cache.memory && cache.heapSize === cache.memory.buffer.byteLength ? cache : heapWrappers()
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
		const c = cache.memory && cache.heapSize === cache.memory.buffer.byteLength ? cache : heapWrappers()
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
	target.isPtr32 = (ptr) => 'number' === typeof ptr && ptr === (ptr | 0) && ptr >= 0
	target.isPtr = target.isPtr32

	target.cstrlen = function (ptr) {
		if (!ptr || !target.isPtr(ptr)) return null
		const h = heapWrappers().HEAP8U
		let pos = ptr
		for (; h[pos] !== 0; ++pos) {}
		return pos - ptr
	}

	const __utf8Decode = function (arrayBuffer, begin, end) {
		return DECODER.decode(arrayBuffer.buffer instanceof SharedArrayBuffer ? arrayBuffer.slice(begin, end) : arrayBuffer.subarray(begin, end))
	}

	target.cstrToJs = function (ptr) {
		const n = target.cstrlen(ptr)
		return n ? __utf8Decode(heapWrappers().HEAP8U, ptr, ptr + n) : null === n ? n : ''
	}

	target.jstrlen = function (str) {
		if ('string' !== typeof str) return null
		const n = str.length
		let len = 0
		for (let i = 0; i < n; ++i) {
			let u = str.charCodeAt(i)
			if (u >= 0xd800 && u <= 0xdfff) {
				u = (0x10000 + ((u & 0x3ff) << 10)) | (str.charCodeAt(++i) & 0x3ff)
			}
			if (u <= 0x7f) ++len
			else if (u <= 0x7ff) len += 2
			else if (u <= 0xffff) len += 3
			else len += 4
		}
		return len
	}

	target.jstrcpy = function (jstr, tgt, offset = 0, maxBytes = -1, addNul = true) {
		if (!tgt || (!(tgt instanceof Int8Array) && !(tgt instanceof Uint8Array))) {
			toss('jstrcpy() target must be an Int8Array or Uint8Array.')
		}
		if (maxBytes < 0) maxBytes = tgt.length - offset
		if (!(maxBytes > 0) || !(offset >= 0)) return 0
		let i = 0,
			max = jstr.length
		const begin = offset,
			end = offset + maxBytes - (addNul ? 1 : 0)
		for (; i < max && offset < end; ++i) {
			let u = jstr.charCodeAt(i)
			if (u >= 0xd800 && u <= 0xdfff) {
				u = (0x10000 + ((u & 0x3ff) << 10)) | (jstr.charCodeAt(++i) & 0x3ff)
			}
			if (u <= 0x7f) {
				if (offset >= end) break
				tgt[offset++] = u
			} else if (u <= 0x7ff) {
				if (offset + 1 >= end) break
				tgt[offset++] = 0xc0 | (u >> 6)
				tgt[offset++] = 0x80 | (u & 0x3f)
			} else if (u <= 0xffff) {
				if (offset + 2 >= end) break
				tgt[offset++] = 0xe0 | (u >> 12)
				tgt[offset++] = 0x80 | ((u >> 6) & 0x3f)
				tgt[offset++] = 0x80 | (u & 0x3f)
			} else {
				if (offset + 3 >= end) break
				tgt[offset++] = 0xf0 | (u >> 18)
				tgt[offset++] = 0x80 | ((u >> 12) & 0x3f)
				tgt[offset++] = 0x80 | ((u >> 6) & 0x3f)
				tgt[offset++] = 0x80 | (u & 0x3f)
			}
		}
		if (addNul) tgt[offset++] = 0
		return offset - begin
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

	target.jstrToUintArray = (str, addNul = false) => {
		return ENCODER.encode(addNul ? str + '\0' : str)
	}

	const __affirmAlloc = (obj, funcName) => {
		if (!(obj.alloc instanceof Function) || !(obj.dealloc instanceof Function)) {
			toss('Object is missing alloc() and/or dealloc() function(s)', 'required by', funcName + '().')
		}
	}

	const __allocCStr = function (jstr, returnWithLength, allocator, funcName) {
		__affirmAlloc(target, funcName)
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

	target.allocCString = (jstr, returnWithLength = false) => __allocCStr(jstr, returnWithLength, target.alloc, 'allocCString()')

	target.scopedAllocPush = function () {
		__affirmAlloc(target, 'scopedAllocPush')
		const a = []
		cache.scopedAlloc.push(a)
		return a
	}

	target.scopedAllocPop = function (state) {
		__affirmAlloc(target, 'scopedAllocPop')
		const n = arguments.length ? cache.scopedAlloc.indexOf(state) : cache.scopedAlloc.length - 1
		if (n < 0) toss('Invalid state object for scopedAllocPop().')
		if (0 === arguments.length) state = cache.scopedAlloc[n]
		cache.scopedAlloc.splice(n, 1)
		for (let p; (p = state.pop()); ) {
			if (target.functionEntry(p)) {
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
		__affirmAlloc(target, method)
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
		return target.exports[name] || toss('Cannot find exported symbol:', name)
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

	cache.xWrap.convert.arg = new Map()

	cache.xWrap.convert.result = new Map()
	const xArg = cache.xWrap.convert.arg,
		xResult = cache.xWrap.convert.result

	const __xArgPtr = 'i32' === ptrIR ? (i) => i | 0 : (i) => BigInt(i) | BigInt(0)
	xArg
		.set('i64', (i) => BigInt(i))
		.set('i32', __xArgPtr)
		.set('i16', (i) => (i | 0) & 0xffff)
		.set('i8', (i) => (i | 0) & 0xff)
		.set('f32', (i) => Number(i).valueOf())
		.set('float', xArg.get('f32'))
		.set('f64', xArg.get('f32'))
		.set('double', xArg.get('f64'))
		.set('int', xArg.get('i32'))
		.set('null', (i) => i)
		.set(null, xArg.get('null'))
		.set('**', __xArgPtr)
		.set('*', __xArgPtr)
	xResult
		.set('*', __xArgPtr)
		.set('pointer', __xArgPtr)
		.set('number', (v) => Number(v))
		.set('void', (v) => undefined)
		.set('null', (v) => v)
		.set(null, xResult.get('null'))

	{
		const copyToResult = ['i8', 'i16', 'i32', 'int', 'f32', 'float', 'f64', 'double', 'i64']
		const adaptPtr = xArg.get(ptrIR)
		for (const t of copyToResult) {
			xArg.set(t + '*', adaptPtr)
			xResult.set(t + '*', adaptPtr)
			xResult.set(t, xArg.get(t) || toss('Missing arg converter:', t))
		}
	}

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
				console.warn('xArg.FuncPtrAdapter is an internal-only API and is not intended to be invoked from client-level code. Invoked with:', opt)
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
			} else if (target.isPtr(v) || null === v || undefined === v) {
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
	xArg.FuncPtrAdapter.debugOut = console.debug.bind(console)
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
		if (target.isPtr(fArg)) {
			fArg = target.functionEntry(fArg) || toss('Function pointer not found in WASM function table.')
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
