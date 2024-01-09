import * as util from './util.js'
import * as heap_m from './heap.js'
import * as logger from './logger.js'
import { ptrSizeof, ptrIR, isLittleEndian } from './constants.js'

const toss = util.toss
const xPtrPropName = '(pointer-is-external)'

const isFuncSig = (s) => '(' === s[1]
const isAutoPtrSig = (s) => 'P' === s
const sigLetter = (s) => (isFuncSig(s) ? 'p' : s[0])
const sPropName = (s, k) => s + '::' + k

const isNumericValue = (v) => Number.isFinite(v) || v instanceof (BigInt || Number)

const sigIR = (s) => {
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

const sigDVGetter = (s) => {
	switch (sigLetter(s)) {
		case 'p':
		case 'P':
		case 's': {
			switch (ptrSizeof) {
				case 4:
					return 'getInt32'
				case 8:
					return 'getBigInt64'
			}
		}
		case 'i':
			return 'getInt32'
		case 'c':
			return 'getInt8'
		case 'C':
			return 'getUint8'
		case 'j':
			return 'getBigInt64'
		case 'f':
			return 'getFloat32'
		case 'd':
			return 'getFloat64'
	}
	toss('Unhandled DataView getter for signature:', s)
}

const sigDVSetter = (s) => {
	switch (sigLetter(s)) {
		case 'p':
		case 'P':
		case 's': {
			switch (ptrSizeof) {
				case 4:
					return 'setInt32'
				case 8:
					return 'setBigInt64'
			}
		}
		case 'i':
			return 'setInt32'
		case 'c':
			return 'setInt8'
		case 'C':
			return 'setUint8'
		case 'j':
			return 'setBigInt64'
		case 'f':
			return 'setFloat32'
		case 'd':
			return 'setFloat64'
	}
	toss('Unhandled DataView setter for signature:', s)
}

const sigDVSetWrapper = (s) => {
	switch (sigLetter(s)) {
		case 'i':
		case 'f':
		case 'c':
		case 'C':
		case 'd':
			return Number
		case 'j':
			return BigInt
		case 'p':
		case 'P':
		case 's':
			switch (ptrSizeof) {
				case 4:
					return Number
				case 8:
					return BigInt
			}
	}
	toss('Unhandled DataView set wrapper for signature:', s)
}

const __propThrowOnSet = (structName, propName) => {
	return () => toss(sPropName(structName, propName), 'is read-only.')
}

const rop = (value) => ({
	configurable: false,
	writable: false,
	iterable: false,
	value,
})

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
					else if ('number' === typeof x) heap_m.dealloc(x)
				} catch (e) {
					logger.warn('ondispose() for', ctor.structName, '@', m, 'threw. NOT propagating it.', e)
				}
			}
		} else if (obj.ondispose instanceof Function) {
			try {
				obj.ondispose()
			} catch (e) {
				logger.warn('ondispose() for', ctor.structName, '@', m, 'threw. NOT propagating it.', e)
			}
		}
		delete obj.ondispose
		if (ctor.debugFlags.__flags.dealloc) {
			logger.log('debug.dealloc:', obj[xPtrPropName] ? 'EXTERNAL' : '', ctor.structName, 'instance:', ctor.structInfo.sizeof, 'bytes @' + m)
		}
		if (!obj[xPtrPropName]) heap_m.dealloc(m)
	}
}

const __allocStruct = function (ctor, obj, m) {
	let fill = !m
	if (m) Object.defineProperty(obj, xPtrPropName, rop(m))
	else {
		m = heap_m.alloc(ctor.structInfo.sizeof)
		if (!m) toss('Allocation of', ctor.structName, 'structure failed.')
	}
	try {
		if (ctor.debugFlags.__flags.alloc) {
			logger.log('debug.alloc:', fill ? '' : 'EXTERNAL', ctor.structName, 'instance:', ctor.structInfo.sizeof, 'bytes @' + m)
		}
		if (fill) heap_m.heap8u().fill(0, m, m + ctor.structInfo.sizeof)
		__instancePointerMap.set(obj, m)
	} catch (e) {
		__freeStruct(ctor, obj, m)
		throw e
	}
}

const memberPrefix = '$'
const memberSuffix = ''

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

const __structMemberKeys = rop(function () {
	const a = []
	for (const k of Object.keys(this.structInfo.members)) {
		a.push(this.memberKey(k))
	}
	return a
})

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
	const mem = heap_m.heap8u()
	for (; mem[pos] !== 0; ++pos) {}

	return addr === pos ? '' : util.typedArrayToString(mem, addr, pos)
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
	const mem = heap_m.alloc(u.length + 1)
	if (!mem) toss('Allocation error while duplicating string:', str)
	const h = heap_m.heap8u()

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
			logger.log('debug.getter:', f._.getters[sigGlyph], 'for', sigIR(sigGlyph), xPropName, '@', this.pointer, '+', descr.offset, 'sz', descr.sizeof)
		}
		let rc = new DataView(heap_m.heap8u().buffer, this.pointer + descr.offset, descr.sizeof)[f._.getters[sigGlyph]](0, isLittleEndian)
		if (dbg.getter) logger.log('debug.getter:', xPropName, 'result =', rc)
		return rc
	}
	if (descr.readOnly) {
		prop.set = __propThrowOnSet(ctor.prototype.structName, key)
	} else {
		prop.set = function (v) {
			if (dbg.setter) {
				logger.log('debug.setter:', f._.setters[sigGlyph], 'for', sigIR(sigGlyph), xPropName, '@', this.pointer, '+', descr.offset, 'sz', descr.sizeof, v)
			}
			if (!this.pointer) {
				toss('Cannot set struct property on disposed instance.')
			}
			if (null === v) v = 0
			else
				while (!isNumericValue(v)) {
					if (isAutoPtrSig(descr.signature) && v instanceof StructType) {
						v = v.pointer || 0
						if (dbg.setter) logger.log('debug.setter:', xPropName, 'resolved to', v)
						break
					}
					toss('Invalid value for pointer-type', xPropName + '.')
				}
			new DataView(heap_m.heap8u().buffer, this.pointer + descr.offset, descr.sizeof)[f._.setters[sigGlyph]](0, f._.sw[sigGlyph](v), isLittleEndian)
		}
	}
	Object.defineProperty(ctor.prototype, key, prop)
}

const validateStructInfo = (structInfo) => {
	let lastMember = false
	for (const [k, m] of Object.entries(structInfo.members)) {
		if (!m.sizeof) toss(structName, 'member', k, 'is missing sizeof.')
		else if (m.sizeof === 1) {
			m.signature === 'c' ||
				m.signature === 'C' ||
				toss('Unexpected sizeof==1 member', sPropName(structInfo.name, k), 'with signature', m.signature)
		} else {
			if (0 !== m.sizeof % 4) {
				logger.warn('Invalid struct member description =', m, 'from', structInfo)
				toss(structName, 'member', k, 'sizeof is not aligned. sizeof=' + m.sizeof)
			}
			if (0 !== m.offset % 4) {
				logger.warn('Invalid struct member description =', m, 'from', structInfo)
				toss(structName, 'member', k, 'offset is not aligned. offset=' + m.offset)
			}
		}
		if (!lastMember || lastMember.offset < m.offset) lastMember = m
	}
	if (!lastMember) toss('No member property descriptions found.')
	else if (structInfo.sizeof < lastMember.offset + lastMember.sizeof) {
		toss(
			'Invalid struct config:',
			structName,
			'max member offset (' + lastMember.offset + ') ',
			'extends past end of struct (sizeof=' + structInfo.sizeof + ').'
		)
	}
}

export const Jaccwabyt = function StructBinderFactory(config) {
	const SBF = StructBinderFactory

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

	const StructBinder = function StructBinder(structName, structInfo) {
		if (1 === arguments.length) {
			structInfo = structName
			structName = structInfo.name
		} else if (!structInfo.name) {
			structInfo.name = structName
		}
		if (!structName) toss('Struct name is required.')
		validateStructInfo(structInfo)
		const debugFlags = rop(SBF.__makeDebugFlags(StructBinder.debugFlags))

		class StructCtor extends StructType {
			constructor(externalMemory) {
				super(structName, structInfo, rop)
				if (arguments.length) {
					if (externalMemory !== (externalMemory | 0) || externalMemory <= 0) {
						toss('Invalid pointer value for', structName, 'constructor.')
					}
					__allocStruct(StructCtor, this, externalMemory)
				} else {
					__allocStruct(StructCtor, this)
				}
			}

			static get structName() { return structName }
			static get structInfo() { return structInfo }
			static memberKey(k) { return __memberKey(k) }
			static memberKeys() {
				const a = []
				for (const k of Object.keys(this.structInfo.members)) {
					a.push(this.memberKey(k))
				}
				return a
			}
		}
		Object.defineProperties(StructCtor, { debugFlags })
		Object.defineProperties(StructCtor.prototype, { debugFlags })
		for (const [name, member] of Object.entries(structInfo.members)) {
			makeMemberWrapper(StructCtor, name, member)
		}
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

export class StructType {
	constructor(structName, structInfo) {
		if (arguments[2] !== rop) {
			toss('Do not call the StructType constructor from client-level code.')
		}
		Object.defineProperties(this, {
			structName: rop(structName),
			structInfo: rop(structInfo),
		})
	}

	get memberKey() {
		return __memberKey
	}

	get memberKeys() {
		const a = []
		for (const k of Object.keys(this.structInfo.members)) {
			a.push(this.memberKey(k))
		}
		return a
	}

	get memoryDump() {
		const p = this.pointer
		return p ? new Uint8Array(heap_m.heap8u().slice(p, p + this.structInfo.sizeof)) : null
	}

	get pointer() {
		return __instancePointerMap.get(this)
	}

	dispose() {
		__freeStruct(this.constructor, this)
	}

	lookupMember(memberName, tossIfNotFound = true) {
		return __lookupMember(this.structInfo, memberName, tossIfNotFound)
	}

	memberToJsString(memberName) {
		return __memberToJsString(this, memberName)
	}

	memberIsString(memberName, tossIfNotFound = true) {
		return __memberIsString(this, memberName, tossIfNotFound)
	}

	memberSignature(memberName, emscriptenFormat = false) {
		return __memberSignature(this, memberName, emscriptenFormat)
	}

	setMemberCString(memberName, str) {
		return __setMemberCString(this, memberName, str)
	}

	addOnDispose(...v) {
		__addOnDispose(this, ...v)
		return this
	}
}

/*
Object.defineProperties(StructType, {
	allocCString: rop(__allocCString),
	isA: rop((v) => v instanceof StructType),
	hasExternalPointer: rop((v) => v instanceof StructType && !!v[xPtrPropName]),
	memberKey: __memberKeyProp,
})
*/
