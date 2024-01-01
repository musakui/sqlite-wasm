import { C_API, structs, sqliteError, SQLite3Error, AllocError, StructBinder } from './base.js'
import { isPtr } from './util.js'
import * as capi from './capi.js'
import * as heap from './heap.js'
import * as logger from './logger.js'

const mnames = [
	'xCreate',
	'xConnect',
	'xBestIndex',
	'xDisconnect',
	'xDestroy',
	'xOpen',
	'xClose',
	'xFilter',
	'xNext',
	'xEof',
	'xColumn',
	'xRowid',
	'xUpdate',
	'xBegin',
	'xSync',
	'xCommit',
	'xRollback',
	'xFindFunction',
	'xRename',
	'xSavepoint',
	'xRelease',
	'xRollbackTo',
	'xShadowName',
]

export const installStruct = (sqlite3) => {
	const vfs = Object.create(null),
		vtab = Object.create(null)

	sqlite3.vfs = vfs
	sqlite3.vtab = vtab

	const sii = structs.sqlite3_index_info

	sii.prototype.nthConstraint = function (n, asPtr = false) {
		if (n < 0 || n >= this.$nConstraint) return false
		const ptr = this.$aConstraint + sii.sqlite3_index_constraint.structInfo.sizeof * n
		return asPtr ? ptr : new sii.sqlite3_index_constraint(ptr)
	}

	sii.prototype.nthConstraintUsage = function (n, asPtr = false) {
		if (n < 0 || n >= this.$nConstraint) return false
		const ptr = this.$aConstraintUsage + sii.sqlite3_index_constraint_usage.structInfo.sizeof * n
		return asPtr ? ptr : new sii.sqlite3_index_constraint_usage(ptr)
	}

	sii.prototype.nthOrderBy = function (n, asPtr = false) {
		if (n < 0 || n >= this.$nOrderBy) return false
		const ptr = this.$aOrderBy + sii.sqlite3_index_orderby.structInfo.sizeof * n
		return asPtr ? ptr : new sii.sqlite3_index_orderby(ptr)
	}

	const installMethod = function callee(tgt, name, func, applyArgcCheck = callee.installMethodArgcCheck) {
		if (!(tgt instanceof StructBinder.StructType)) {
			sqliteError('Usage error: target object is-not-a StructType.')
		} else if (!(func instanceof Function) && !isPtr(func)) {
			sqliteError('Usage errror: expecting a Function or WASM pointer to one.')
		}
		if (1 === arguments.length) {
			return (n, f) => callee(tgt, n, f, applyArgcCheck)
		}
		if (!callee.argcProxy) {
			callee.argcProxy = function (tgt, funcName, func, sig) {
				return function (...args) {
					if (func.length !== arguments.length) {
						sqliteError('Argument mismatch for', tgt.structInfo.name + '::' + funcName + ': Native signature is:', sig)
					}
					return func.apply(this, args)
				}
			}

			callee.removeFuncList = function () {
				if (this.ondispose.__removeFuncList) {
					this.ondispose.__removeFuncList.forEach((v, ndx) => {
						if ('number' === typeof v) {
							try {
								heap.uninstallFunction(v)
							} catch (e) {}
						}
					})
					delete this.ondispose.__removeFuncList
				}
			}
		}
		const sigN = tgt.memberSignature(name)
		if (sigN.length < 2) {
			sqliteError('Member', name, 'does not have a function pointer signature:', sigN)
		}
		const memKey = tgt.memberKey(name)
		const fProxy = applyArgcCheck && !isPtr(func) ? callee.argcProxy(tgt, memKey, func, sigN) : func
		if (isPtr(fProxy)) {
			if (fProxy && !heap.functionEntry(fProxy)) {
				sqliteError('Pointer', fProxy, 'is not a WASM function table entry.')
			}
			tgt[memKey] = fProxy
		} else {
			const pFunc = heap.installFunction(fProxy, tgt.memberSignature(name, true))
			tgt[memKey] = pFunc
			if (!tgt.ondispose || !tgt.ondispose.__removeFuncList) {
				tgt.addOnDispose('ondispose.__removeFuncList handler', callee.removeFuncList)
				tgt.ondispose.__removeFuncList = []
			}
			tgt.ondispose.__removeFuncList.push(memKey, pFunc)
		}
		return (n, f) => callee(tgt, n, f, applyArgcCheck)
	}
	installMethod.installMethodArgcCheck = false

	const installMethods = function (structInstance, methods, applyArgcCheck = installMethod.installMethodArgcCheck) {
		const seen = new Map()
		for (const k of Object.keys(methods)) {
			const m = methods[k]
			const prior = seen.get(m)
			if (prior) {
				const mkey = structInstance.memberKey(k)
				structInstance[mkey] = structInstance[structInstance.memberKey(prior)]
			} else {
				installMethod(structInstance, k, m, applyArgcCheck)
				seen.set(m, k)
			}
		}
		return structInstance
	}

	StructBinder.StructType.prototype.installMethod = function callee(name, func, applyArgcCheck = installMethod.installMethodArgcCheck) {
		return arguments.length < 3 && name && 'object' === typeof name ? installMethods(this, ...arguments) : installMethod(this, ...arguments)
	}

	StructBinder.StructType.prototype.installMethods = function (methods, applyArgcCheck = installMethod.installMethodArgcCheck) {
		return installMethods(this, methods, applyArgcCheck)
	}

	structs.sqlite3_vfs.prototype.registerVfs = function (asDefault = false) {
		if (!(this instanceof structs.sqlite3_vfs)) {
			sqliteError('Expecting a sqlite3_vfs-type argument.')
		}
		const rc = capi.sqlite3_vfs_register(this, asDefault ? 1 : 0)
		if (rc) {
			sqliteError('sqlite3_vfs_register(', this, ') failed with rc', rc)
		}
		if (this.pointer !== capi.sqlite3_vfs_find(this.$zName)) {
			sqliteError('BUG: sqlite3_vfs_find(vfs.$zName) failed for just-installed VFS', this)
		}
		return this
	}

	vfs.installVfs = function (opt) {
		let count = 0
		const propList = ['io', 'vfs']
		for (const key of propList) {
			const o = opt[key]
			if (o) {
				++count
				installMethods(o.struct, o.methods, !!o.applyArgcCheck)
				if ('vfs' === key) {
					if (!o.struct.$zName && 'string' === typeof o.name) {
						o.struct.addOnDispose((o.struct.$zName = heap.allocCString(o.name)))
					}
					o.struct.registerVfs(!!o.asDefault)
				}
			}
		}
		if (!count) sqliteError('Misuse: installVfs() options object requires at least', 'one of:', propList)
		return this
	}

	const __xWrapFactory = function (methodName, StructType) {
		return function (ptr, removeMapping = false) {
			if (0 === arguments.length) ptr = new StructType()
			if (ptr instanceof StructType) {
				this.set(ptr.pointer, ptr)
				return ptr
			} else if (!isPtr(ptr)) {
				sqliteError('Invalid argument to', methodName + '()')
			}
			let rc = this.get(ptr)
			if (removeMapping) this.delete(ptr)
			return rc
		}.bind(new Map())
	}

	const StructPtrMapper = function (name, StructType) {
		const __xWrap = __xWrapFactory(name, StructType)

		return Object.assign(Object.create(null), {
			StructType,

			create: (ppOut) => {
				const rc = __xWrap()
				heap.pokePtr(ppOut, rc.pointer)
				return rc
			},

			get: (pCObj) => __xWrap(pCObj),

			unget: (pCObj) => __xWrap(pCObj, true),

			dispose: (pCObj) => {
				const o = __xWrap(pCObj, true)
				if (o) o.dispose()
			},
		})
	}

	vtab.xVtab = StructPtrMapper('xVtab', structs.sqlite3_vtab)
	vtab.xCursor = StructPtrMapper('xCursor', structs.sqlite3_vtab_cursor)
	vtab.xIndexInfo = (pIdxInfo) => new structs.sqlite3_index_info(pIdxInfo)

	vtab.xError = function f(methodName, err, defaultRc) {
		if (f.errorReporter instanceof Function) {
			try {
				f.errorReporter('sqlite3_module::' + methodName + '(): ' + err.message)
			} catch (e) {}
		}
		let rc
		if (err instanceof AllocError) rc = C_API.SQLITE_NOMEM
		else if (arguments.length > 2) rc = defaultRc
		else if (err instanceof SQLite3Error) rc = err.resultCode
		return rc || C_API.SQLITE_ERROR
	}
	vtab.xError.errorReporter = logger.error

	vtab.xRowid = (ppRowid64, value) => heap.poke(ppRowid64, value, 'i64')

	vtab.setupModule = function (opt) {
		let createdMod = false
		const mod = this instanceof structs.sqlite3_module ? this : opt.struct || (createdMod = new structs.sqlite3_module())
		try {
			const methods = opt.methods || sqliteError("Missing 'methods' object.")
			for (const e of Object.entries({
				xConnect: 'xCreate',
				xDisconnect: 'xDestroy',
			})) {
				const k = e[0],
					v = e[1]
				if (true === methods[k]) methods[k] = methods[v]
				else if (true === methods[v]) methods[v] = methods[k]
			}
			if (opt.catchExceptions) {
				const fwrap = function (methodName, func) {
					if (['xConnect', 'xCreate'].indexOf(methodName) >= 0) {
						return function (pDb, pAux, argc, argv, ppVtab, pzErr) {
							try {
								return func(...arguments) || 0
							} catch (e) {
								if (!(e instanceof AllocError)) {
									heap.dealloc(heap.peekPtr(pzErr))
									heap.pokePtr(pzErr, heap.allocCString(e.message))
								}
								return vtab.xError(methodName, e)
							}
						}
					} else {
						return function (...args) {
							try {
								return func(...args) || 0
							} catch (e) {
								return vtab.xError(methodName, e)
							}
						}
					}
				}

				const remethods = Object.create(null)
				for (const k of mnames) {
					const m = methods[k]
					if (!(m instanceof Function)) continue
					else if ('xConnect' === k && methods.xCreate === m) {
						remethods[k] = methods.xCreate
					} else if ('xCreate' === k && methods.xConnect === m) {
						remethods[k] = methods.xConnect
					} else {
						remethods[k] = fwrap(k, m)
					}
				}
				installMethods(mod, remethods, false)
			} else {
				installMethods(mod, methods, !!opt.applyArgcCheck)
			}
			if (0 === mod.$iVersion) {
				let v
				if ('number' === typeof opt.iVersion) v = opt.iVersion
				else if (mod.$xShadowName) v = 3
				else if (mod.$xSavePoint || mod.$xRelease || mod.$xRollbackTo) v = 2
				else v = 1
				mod.$iVersion = v
			}
		} catch (e) {
			if (createdMod) createdMod.dispose()
			throw e
		}
		return mod
	}

	structs.sqlite3_module.prototype.setupModule = (opt) => vtab.setupModule(opt)
}
