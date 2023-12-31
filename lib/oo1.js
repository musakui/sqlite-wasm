import { capi, wasm, structs, sqliteError, sqlite3_js_rc_str, cstrToJs, C_API } from './base.js'
import { flexibleString } from './binding.js'
import { ptrSizeof, BindTypes } from './constants.js'
import { sqlite3_js_db_vfs } from './capi_extras.js'
import * as util from './util.js'
import * as heap from './heap.js'
import * as pstack from './pstack.js'
import * as logger from './logger.js'

const __ptrMap = new WeakMap()
const __stmtMap = new WeakMap()

const __vfsPostOpenSql = Object.create(null)

const getOwnOption = (opts, p, dflt) => {
	const d = Object.getOwnPropertyDescriptor(opts, p)
	return d ? d.value : dflt
}

const affirmDbOpen = (db) => (db?.pointer ? db : sqliteError('DB was closed'))

const affirmStmtOpen = (stmt) => (stmt?.pointer ? stmt : sqliteError('Stmt was closed'))

const isSupportedBindType = function (v) {
	let t = BindTypes[null === v || undefined === v ? 'null' : typeof v]
	switch (t) {
		case BindTypes.boolean:
		case BindTypes.null:
		case BindTypes.number:
		case BindTypes.string:
		case BindTypes.bigint:
			return t
		default:
			return util.isBindableTypedArray(v) ? BindTypes.blob : undefined
	}
}

const affirmSupportedBindType = function (v) {
	return isSupportedBindType(v) || sqliteError('Unsupported bind() argument type:', typeof v)
}

const affirmParamIndex = (stmt, key) => {
	const n = 'number' === typeof key ? key : capi.sqlite3_bind_parameter_index(stmt.pointer, key)
	if (0 === n || !util.isInt32(n)) {
		sqliteError('Invalid bind() parameter name: ' + key)
	} else if (n < 1 || n > stmt.parameterCount) sqliteError('Bind index', key, 'is out of range.')
	return n
}

const affirmNotLockedByExec = (stmt, currentOpName) => {
	if (stmt._lockedByExec) {
		sqliteError('Operation is illegal when statement is locked:', currentOpName)
	}
	return stmt
}

const affirmColIndex = function (stmt, ndx) {
	if (ndx !== (ndx | 0) || ndx < 0 || ndx >= stmt.columnCount) {
		sqliteError('Column index', ndx, 'is out of range.')
	}
	return stmt
}

const __selectAll = (db, sql, bind, rowMode) =>
	db.exec({
		sql,
		bind,
		rowMode,
		returnValue: 'resultRows',
	})

const bindOne = function f(stmt, ndx, bindType, val) {
	affirmNotLockedByExec(affirmStmtOpen(stmt), 'bind()')
	if (!f._) {
		f._tooBigInt = (v) => sqliteError('BigInt value is too big to store without precision loss:', v)
		f._ = {
			string: function (stmt, ndx, val, asBlob) {
				const [pStr, n] = heap.allocCStringWithLength(val)
				const f = asBlob ? capi.sqlite3_bind_blob : capi.sqlite3_bind_text
				return f(stmt.pointer, ndx, pStr, n, C_API.SQLITE_WASM_DEALLOC)
			},
		}
	}
	affirmSupportedBindType(val)
	ndx = affirmParamIndex(stmt, ndx)
	let rc = 0
	switch (null === val || undefined === val ? BindTypes.null : bindType) {
		case BindTypes.null:
			rc = capi.sqlite3_bind_null(stmt.pointer, ndx)
			break
		case BindTypes.string:
			rc = f._.string(stmt, ndx, val, false)
			break
		case BindTypes.number: {
			let m
			if (util.isInt32(val)) {
				m = capi.sqlite3_bind_int
			} else if ('bigint' === typeof val) {
				if (!util.bigIntFits64(val)) {
					f._tooBigInt(val)
				} else {
					m = capi.sqlite3_bind_int64
				}
			} else {
				val = Number(val)
				m = Number.isInteger(val) ? capi.sqlite3_bind_int64 : capi.sqlite3_bind_double
			}
			rc = m(stmt.pointer, ndx, val)
			break
		}
		case BindTypes.boolean:
			rc = capi.sqlite3_bind_int(stmt.pointer, ndx, val ? 1 : 0)
			break
		case BindTypes.blob: {
			if ('string' === typeof val) {
				rc = f._.string(stmt, ndx, val, true)
				break
			} else if (val instanceof ArrayBuffer) {
				val = new Uint8Array(val)
			} else if (!util.isBindableTypedArray(val)) {
				sqliteError('Binding a value as a blob requires', 'that it be a string, Uint8Array, Int8Array, or ArrayBuffer.')
			}
			const pBlob = wasm.alloc(val.byteLength || 1)
			heap.HEAP8().set(val.byteLength ? val : [0], pBlob)
			rc = capi.sqlite3_bind_blob(stmt.pointer, ndx, pBlob, val.byteLength, C_API.SQLITE_WASM_DEALLOC)
			break
		}
		default:
			sqliteError('Unsupported bind() argument type: ' + typeof val)
	}
	if (rc) DB.checkRc(stmt.db.pointer, rc)
	stmt._mayGet = false
	return stmt
}

const __selectFirstRow = (db, sql, bind, ...getArgs) => {
	const stmt = db.prepare(sql)
	try {
		const rc = stmt.bind(bind).step() ? stmt.get(...getArgs) : undefined
		stmt.reset()
		return rc
	} finally {
		stmt.finalize()
	}
}

const parseExecArgs = function (db, args) {
	const out = Object.create(null)
	out.opt = Object.create(null)
	switch (args.length) {
		case 1:
			if ('string' === typeof args[0] || util.isSQLableTypedArray(args[0])) {
				out.sql = args[0]
			} else if (Array.isArray(args[0])) {
				out.sql = args[0]
			} else if (args[0] && 'object' === typeof args[0]) {
				out.opt = args[0]
				out.sql = out.opt.sql
			}
			break
		case 2:
			out.sql = args[0]
			out.opt = args[1]
			break
		default:
			sqliteError('Invalid argument count for exec().')
	}
	out.sql = flexibleString(out.sql)
	if ('string' !== typeof out.sql) {
		sqliteError('Missing SQL argument or unsupported SQL value type.')
	}
	const opt = out.opt
	switch (opt.returnValue) {
		case 'resultRows':
			if (!opt.resultRows) opt.resultRows = []
			out.returnVal = () => opt.resultRows
			break
		case 'saveSql':
			if (!opt.saveSql) opt.saveSql = []
			out.returnVal = () => opt.saveSql
			break
		case undefined:
		case 'this':
			out.returnVal = () => db
			break
		default:
			sqliteError('Invalid returnValue value:', opt.returnValue)
	}
	if (!opt.callback && !opt.returnValue && undefined !== opt.rowMode) {
		if (!opt.resultRows) opt.resultRows = []
		out.returnVal = () => opt.resultRows
	}
	if (opt.callback || opt.resultRows) {
		switch (undefined === opt.rowMode ? 'array' : opt.rowMode) {
			case 'object':
				out.cbArg = (stmt) => stmt.get(Object.create(null))
				break
			case 'array':
				out.cbArg = (stmt) => stmt.get([])
				break
			case 'stmt':
				if (Array.isArray(opt.resultRows)) {
					sqliteError(
						'exec(): invalid rowMode for a resultRows array: must',
						"be one of 'array', 'object',",
						'a result column number, or column name reference.'
					)
				}
				out.cbArg = (stmt) => stmt
				break
			default:
				if (util.isInt32(opt.rowMode)) {
					out.cbArg = (stmt) => stmt.get(opt.rowMode)
					break
				} else if ('string' === typeof opt.rowMode && opt.rowMode.length > 1 && '$' === opt.rowMode[0]) {
					const $colName = opt.rowMode.substr(1)
					out.cbArg = (stmt) => {
						const rc = stmt.get(Object.create(null))[$colName]
						return undefined === rc ? sqliteError(C_API.SQLITE_NOTFOUND, 'exec(): unknown result column:', $colName) : rc
					}
					break
				}
				sqliteError('Invalid rowMode:', opt.rowMode)
		}
	}
	return out
}

export const installOO1 = (sqlite3) => {
	const __dbTraceToConsole = wasm.installFunction(
		'i(ippp)',
		function (t, c, p, x) {
			if (C_API.SQLITE_TRACE_STMT === t) {
				logger.info('SQL TRACE #' + ++this.counter + ' via sqlite3@' + c + ':', wasm.cstrToJs(x))
			}
		}.bind({ counter: 0 })
	)

	const checkSqlite3Rc = function (dbPtr, sqliteResultCode) {
		if (sqliteResultCode) {
			if (dbPtr instanceof DB) dbPtr = dbPtr.pointer
			sqliteError(
				sqliteResultCode,
				'sqlite3 result code',
				sqliteResultCode + ':',
				dbPtr ? capi.sqlite3_errmsg(dbPtr) : capi.sqlite3_errstr(sqliteResultCode)
			)
		}
		return arguments[0]
	}

	const dbCtorHelper = function ctor(...args) {
		if (!ctor._name2vfs) {
			ctor._name2vfs = Object.create(null)
		}
		const opt = ctor.normalizeArgs(...args)
		let fn = opt.filename,
			vfsName = opt.vfs,
			flagsStr = opt.flags
		if (
			('string' !== typeof fn && 'number' !== typeof fn) ||
			'string' !== typeof flagsStr ||
			(vfsName && 'string' !== typeof vfsName && 'number' !== typeof vfsName)
		) {
			sqliteError('Invalid arguments for DB constructor.')
		}
		let fnJs = 'number' === typeof fn ? cstrToJs(fn) : fn
		const vfsCheck = ctor._name2vfs[fnJs]
		if (vfsCheck) {
			vfsName = vfsCheck.vfs
			fn = fnJs = vfsCheck.filename(fnJs)
		}
		let pDb,
			oflags = 0
		if (flagsStr.indexOf('c') >= 0) {
			oflags |= C_API.SQLITE_OPEN_CREATE | C_API.SQLITE_OPEN_READWRITE
		}
		if (flagsStr.indexOf('w') >= 0) oflags |= C_API.SQLITE_OPEN_READWRITE
		if (0 === oflags) oflags |= C_API.SQLITE_OPEN_READONLY
		oflags |= C_API.SQLITE_OPEN_EXRESCODE
		const stack = pstack.getPtr()
		try {
			const pPtr = pstack.allocPtr()
			let rc = capi.sqlite3_open_v2(fn, pPtr, oflags, vfsName || 0)
			pDb = heap.peekPtr(pPtr)
			checkSqlite3Rc(pDb, rc)
			capi.sqlite3_extended_result_codes(pDb, 1)
			if (flagsStr.indexOf('t') >= 0) {
				capi.sqlite3_trace_v2(pDb, C_API.SQLITE_TRACE_STMT, __dbTraceToConsole, pDb)
			}
		} catch (e) {
			if (pDb) capi.sqlite3_close_v2(pDb)
			throw e
		} finally {
			pstack.restore(stack)
		}
		this.filename = fnJs
		__ptrMap.set(this, pDb)
		__stmtMap.set(this, Object.create(null))
		try {
			const pVfs = sqlite3_js_db_vfs(pDb)
			if (!pVfs) sqliteError('Internal error: cannot get VFS for new db handle.')
			const postInitSql = __vfsPostOpenSql[pVfs]
			if (postInitSql instanceof Function) {
				postInitSql(this, sqlite3)
			} else if (postInitSql) {
				checkSqlite3Rc(pDb, capi.sqlite3_exec(pDb, postInitSql, 0, 0, 0))
			}
		} catch (e) {
			this.close()
			throw e
		}
	}

	dbCtorHelper.setVfsPostOpenSql = (pVfs, sql) => {
		__vfsPostOpenSql[pVfs] = sql
	}

	dbCtorHelper.normalizeArgs = function (filename = ':memory:', flags = 'c', vfs = null) {
		const arg = {}
		if (1 === arguments.length && arguments[0] && 'object' === typeof arguments[0]) {
			Object.assign(arg, arguments[0])
			if (undefined === arg.flags) arg.flags = 'c'
			if (undefined === arg.vfs) arg.vfs = null
			if (undefined === arg.filename) arg.filename = ':memory:'
		} else {
			arg.filename = filename
			arg.flags = flags
			arg.vfs = vfs
		}
		return arg
	}

	class DB {
		constructor(...args) {
			dbCtorHelper.apply(this, args)
		}
		static checkRc(db, resultCode) {
			return checkSqlite3Rc(db, resultCode)
		}

		get pointer() {
			return __ptrMap.get(this)
		}

		isOpen() {
			return !!this.pointer
		}
		affirmOpen() {
			return affirmDbOpen(this)
		}
		close() {
			if (this.pointer) {
				if (this.onclose && this.onclose.before instanceof Function) {
					try {
						this.onclose.before(this)
					} catch (e) {}
				}
				const pDb = this.pointer
				Object.keys(__stmtMap.get(this)).forEach((k, s) => {
					if (s && s.pointer) {
						try {
							s.finalize()
						} catch (e) {}
					}
				})
				__ptrMap.delete(this)
				__stmtMap.delete(this)
				capi.sqlite3_close_v2(pDb)
				if (this.onclose && this.onclose.after instanceof Function) {
					try {
						this.onclose.after(this)
					} catch (e) {}
				}
				delete this.filename
			}
		}
		changes(total = false, sixtyFour = false) {
			const p = affirmDbOpen(this).pointer
			if (total) {
				return sixtyFour ? capi.sqlite3_total_changes64(p) : capi.sqlite3_total_changes(p)
			} else {
				return sixtyFour ? capi.sqlite3_changes64(p) : capi.sqlite3_changes(p)
			}
		}
		dbFilename(dbName = 'main') {
			return capi.sqlite3_db_filename(affirmDbOpen(this).pointer, dbName)
		}
		dbName(dbNumber = 0) {
			return capi.sqlite3_db_name(affirmDbOpen(this).pointer, dbNumber)
		}
		dbVfsName(dbName = 0) {
			let rc
			const pVfs = sqlite3_js_db_vfs(affirmDbOpen(this).pointer, dbName)
			if (pVfs) {
				const v = new structs.sqlite3_vfs(pVfs)
				try {
					rc = cstrToJs(v.$zName)
				} finally {
					v.dispose()
				}
			}
			return rc
		}
		prepare(sql) {
			affirmDbOpen(this)
			const stack = pstack.getPtr()
			let ppStmt, pStmt
			try {
				ppStmt = pstack.alloc(8)
				DB.checkRc(this, capi.sqlite3_prepare_v2(this.pointer, sql, -1, ppStmt, null))
				pStmt = heap.peekPtr(ppStmt)
			} finally {
				pstack.restore(stack)
			}
			if (!pStmt) sqliteError('Cannot prepare empty SQL.')
			const stmt = new Stmt(this, pStmt, BindTypes)
			__stmtMap.get(this)[pStmt] = stmt
			return stmt
		}
		exec() {
			affirmDbOpen(this)
			const arg = parseExecArgs(this, arguments)
			if (!arg.sql) {
				return sqliteError('exec() requires an SQL string.')
			}
			const opt = arg.opt
			const callback = opt.callback
			const resultRows = Array.isArray(opt.resultRows) ? opt.resultRows : undefined
			let stmt
			let bind = opt.bind
			let evalFirstResult = !!(arg.cbArg || opt.columnNames || resultRows)
			const stack = heap.scopedAllocPush()
			const saveSql = Array.isArray(opt.saveSql) ? opt.saveSql : undefined
			try {
				const isTA = util.isSQLableTypedArray(arg.sql)
				let sqlByteLen = isTA ? arg.sql.byteLength : util.jstrlen(arg.sql)
				const ppStmt = heap.scopedAlloc(2 * ptrSizeof + (sqlByteLen + 1))
				const pzTail = ppStmt + ptrSizeof
				let pSql = pzTail + ptrSizeof
				const pSqlEnd = pSql + sqlByteLen
				if (isTA) heap.HEAP8().set(arg.sql, pSql)
				else util.jstrcpy(arg.sql, heap.HEAP8(), pSql, sqlByteLen, false)
				wasm.poke(pSql + sqlByteLen, 0)
				while (pSql && heap.peek(pSql, 'i8')) {
					wasm.pokePtr([ppStmt, pzTail], 0)
					DB.checkRc(this, capi.sqlite3_prepare_v3(this.pointer, pSql, sqlByteLen, 0, ppStmt, pzTail))
					const pStmt = heap.peekPtr(ppStmt)
					pSql = heap.peekPtr(pzTail)
					sqlByteLen = pSqlEnd - pSql
					if (!pStmt) continue
					if (saveSql) saveSql.push(capi.sqlite3_sql(pStmt).trim())
					stmt = new Stmt(this, pStmt, BindTypes)
					if (bind && stmt.parameterCount) {
						stmt.bind(bind)
						bind = null
					}
					if (evalFirstResult && stmt.columnCount) {
						let gotColNames = Array.isArray(opt.columnNames) ? 0 : 1
						evalFirstResult = false
						if (arg.cbArg || resultRows) {
							for (; stmt.step(); stmt._lockedByExec = false) {
								if (0 === gotColNames++) stmt.getColumnNames(opt.columnNames)
								stmt._lockedByExec = true
								const row = arg.cbArg(stmt)
								if (resultRows) resultRows.push(row)
								if (callback && false === callback.call(opt, row, stmt)) {
									break
								}
							}
							stmt._lockedByExec = false
						}
						if (0 === gotColNames) {
							stmt.getColumnNames(opt.columnNames)
						}
					} else {
						stmt.step()
					}
					stmt.reset().finalize()
					stmt = null
				}
			} finally {
				heap.scopedAllocPop(stack)
				if (stmt) {
					delete stmt._lockedByExec
					stmt.finalize()
				}
			}
			return arg.returnVal()
		}
		createFunction(name, xFunc, opt) {
			switch (arguments.length) {
				case 1:
					opt = name
					name = opt.name
					xFunc = opt.xFunc || 0
					break
				case 2:
					if (!util.isFunction(xFunc)) {
						opt = xFunc
						xFunc = opt.xFunc || 0
					}
					break
			}
			if (!opt) opt = {}
			if ('string' !== typeof name) {
				sqliteError('Invalid arguments: missing function name.')
			}
			let xStep = opt.xStep || 0
			let xFinal = opt.xFinal || 0
			const xValue = opt.xValue || 0
			const xInverse = opt.xInverse || 0
			let isWindow = undefined
			if (util.isFunction(xFunc)) {
				isWindow = false
				if (util.isFunction(xStep) || util.isFunction(xFinal)) {
					sqliteError('Ambiguous arguments: scalar or aggregate?')
				}
				xStep = xFinal = null
			} else if (util.isFunction(xStep)) {
				if (!util.isFunction(xFinal)) {
					sqliteError('Missing xFinal() callback for aggregate or window UDF.')
				}
				xFunc = null
			} else if (util.isFunction(xFinal)) {
				sqliteError('Missing xStep() callback for aggregate or window UDF.')
			} else {
				sqliteError('Missing function-type properties.')
			}
			if (false === isWindow) {
				if (util.isFunction(xValue) || util.isFunction(xInverse)) {
					sqliteError('xValue and xInverse are not permitted for non-window UDFs.')
				}
			} else if (util.isFunction(xValue)) {
				if (!util.isFunction(xInverse)) {
					sqliteError('xInverse must be provided if xValue is.')
				}
				isWindow = true
			} else if (util.isFunction(xInverse)) {
				sqliteError('xValue must be provided if xInverse is.')
			}
			const pApp = opt.pApp
			if (undefined !== pApp && null !== pApp && ('number' !== typeof pApp || !util.isInt32(pApp))) {
				sqliteError('Invalid value for pApp property. Must be a legal WASM pointer value.')
			}
			const xDestroy = opt.xDestroy || 0
			if (xDestroy && !util.isFunction(xDestroy)) {
				sqliteError('xDestroy property must be a function.')
			}
			let fFlags = 0
			if (getOwnOption(opt, 'deterministic')) fFlags |= C_API.SQLITE_DETERMINISTIC
			if (getOwnOption(opt, 'directOnly')) fFlags |= C_API.SQLITE_DIRECTONLY
			if (getOwnOption(opt, 'innocuous')) fFlags |= C_API.SQLITE_INNOCUOUS
			name = name.toLowerCase()
			const xArity = xFunc || xStep
			const arity = getOwnOption(opt, 'arity')
			const arityArg = 'number' === typeof arity ? arity : xArity.length ? xArity.length - 1 : 0
			let rc
			if (isWindow) {
				rc = capi.sqlite3_create_window_function(
					this.pointer,
					name,
					arityArg,
					C_API.SQLITE_UTF8 | fFlags,
					pApp || 0,
					xStep,
					xFinal,
					xValue,
					xInverse,
					xDestroy
				)
			} else {
				rc = capi.sqlite3_create_function_v2(this.pointer, name, arityArg, C_API.SQLITE_UTF8 | fFlags, pApp || 0, xFunc, xStep, xFinal, xDestroy)
			}
			DB.checkRc(this, rc)
			return this
		}
		selectValue(sql, bind, asType) {
			return __selectFirstRow(this, sql, bind, 0, asType)
		}
		selectValues(sql, bind, asType) {
			const stmt = this.prepare(sql),
				rc = []
			try {
				stmt.bind(bind)
				while (stmt.step()) rc.push(stmt.get(0, asType))
				stmt.reset()
			} finally {
				stmt.finalize()
			}
			return rc
		}
		selectArray(sql, bind) {
			return __selectFirstRow(this, sql, bind, [])
		}
		selectObject(sql, bind) {
			return __selectFirstRow(this, sql, bind, {})
		}
		selectArrays(sql, bind) {
			return __selectAll(this, sql, bind, 'array')
		}
		selectObjects(sql, bind) {
			return __selectAll(this, sql, bind, 'object')
		}
		openStatementCount() {
			return this.pointer ? Object.keys(__stmtMap.get(this)).length : 0
		}
		transaction(callback) {
			let opener = 'BEGIN'
			if (arguments.length > 1) {
				if (/[^a-zA-Z]/.test(arguments[0])) {
					sqliteError(C_API.SQLITE_MISUSE, 'Invalid argument for BEGIN qualifier.')
				}
				opener += ' ' + arguments[0]
				callback = arguments[1]
			}
			affirmDbOpen(this).exec(opener)
			try {
				const rc = callback(this)
				this.exec('COMMIT')
				return rc
			} catch (e) {
				this.exec('ROLLBACK')
				throw e
			}
		}
		savepoint(callback) {
			affirmDbOpen(this).exec('SAVEPOINT oo1')
			try {
				const rc = callback(this)
				this.exec('RELEASE oo1')
				return rc
			} catch (e) {
				this.exec('ROLLBACK to SAVEPOINT oo1; RELEASE SAVEPOINT oo1')
				throw e
			}
		}
		checkRc(resultCode) {
			return checkSqlite3Rc(this, resultCode)
		}
	}

	DB.dbCtorHelper = dbCtorHelper

	class Stmt {
		constructor() {
			if (BindTypes !== arguments[2]) {
				sqliteError(C_API.SQLITE_MISUSE, 'Do not call the Stmt constructor directly. Use DB.prepare().')
			}
			this.db = arguments[0]
			__ptrMap.set(this, arguments[1])
			this.parameterCount = capi.sqlite3_bind_parameter_count(this.pointer)
		}

		get pointer() {
			return __ptrMap.get(this)
		}

		get columnCount() {
			return capi.sqlite3_column_count(this.pointer)
		}

		finalize() {
			if (this.pointer) {
				affirmNotLockedByExec(this, 'finalize()')
				const rc = capi.sqlite3_finalize(this.pointer)
				delete __stmtMap.get(this.db)[this.pointer]
				__ptrMap.delete(this)
				delete this._mayGet
				delete this.parameterCount
				delete this._lockedByExec
				delete this.db
				return rc
			}
		}
		clearBindings() {
			affirmNotLockedByExec(affirmStmtOpen(this), 'clearBindings()')
			capi.sqlite3_clear_bindings(this.pointer)
			this._mayGet = false
			return this
		}
		reset(alsoClearBinds) {
			affirmNotLockedByExec(this, 'reset()')
			if (alsoClearBinds) this.clearBindings()
			const rc = capi.sqlite3_reset(affirmStmtOpen(this).pointer)
			this._mayGet = false
			checkSqlite3Rc(this.db, rc)
			return this
		}
		bind() {
			affirmStmtOpen(this)
			let ndx, arg
			switch (arguments.length) {
				case 1:
					ndx = 1
					arg = arguments[0]
					break
				case 2:
					ndx = arguments[0]
					arg = arguments[1]
					break
				default:
					sqliteError('Invalid bind() arguments.')
			}
			if (undefined === arg) {
				return this
			} else if (!this.parameterCount) {
				sqliteError('This statement has no bindable parameters.')
			}
			this._mayGet = false
			if (null === arg) {
				return bindOne(this, ndx, BindTypes.null, arg)
			} else if (Array.isArray(arg)) {
				if (1 !== arguments.length) {
					sqliteError('When binding an array, an index argument is not permitted.')
				}
				arg.forEach((v, i) => bindOne(this, i + 1, affirmSupportedBindType(v), v))
				return this
			} else if (arg instanceof ArrayBuffer) {
				arg = new Uint8Array(arg)
			}
			if ('object' === typeof arg && !util.isBindableTypedArray(arg)) {
				if (1 !== arguments.length) {
					sqliteError('When binding an object, an index argument is not permitted.')
				}
				Object.keys(arg).forEach((k) => bindOne(this, k, affirmSupportedBindType(arg[k]), arg[k]))
				return this
			} else {
				return bindOne(this, ndx, affirmSupportedBindType(arg), arg)
			}
		}
		bindAsBlob(ndx, arg) {
			affirmStmtOpen(this)
			if (1 === arguments.length) {
				arg = ndx
				ndx = 1
			}
			const t = affirmSupportedBindType(arg)
			if (BindTypes.string !== t && BindTypes.blob !== t && BindTypes.null !== t) {
				sqliteError('Invalid value type for bindAsBlob()')
			}
			return bindOne(this, ndx, BindTypes.blob, arg)
		}
		step() {
			affirmNotLockedByExec(this, 'step()')
			const rc = capi.sqlite3_step(affirmStmtOpen(this).pointer)
			switch (rc) {
				case C_API.SQLITE_DONE:
					return (this._mayGet = false)
				case C_API.SQLITE_ROW:
					return (this._mayGet = true)
				default:
					this._mayGet = false
					logger.warn('sqlite3_step() rc=', rc, sqlite3_js_rc_str(rc), 'SQL =', capi.sqlite3_sql(this.pointer))
					DB.checkRc(this.db.pointer, rc)
			}
		}
		stepReset() {
			this.step()
			return this.reset()
		}
		stepFinalize() {
			try {
				const rc = this.step()
				this.reset()
				return rc
			} finally {
				try {
					this.finalize()
				} catch (e) {}
			}
		}
		get(ndx, asType) {
			if (!affirmStmtOpen(this)._mayGet) {
				sqliteError('Stmt.step() has not (recently) returned true.')
			}
			if (Array.isArray(ndx)) {
				let i = 0
				const n = this.columnCount
				while (i < n) {
					ndx[i] = this.get(i++)
				}
				return ndx
			} else if (ndx && 'object' === typeof ndx) {
				let i = 0
				const n = this.columnCount
				while (i < n) {
					ndx[capi.sqlite3_column_name(this.pointer, i)] = this.get(i++)
				}
				return ndx
			}
			affirmColIndex(this, ndx)
			switch (undefined === asType ? capi.sqlite3_column_type(this.pointer, ndx) : asType) {
				case C_API.SQLITE_NULL:
					return null
				case C_API.SQLITE_INTEGER: {
					const rc = capi.sqlite3_column_int64(this.pointer, ndx)
					if (rc >= Number.MIN_SAFE_INTEGER && rc <= Number.MAX_SAFE_INTEGER) {
						return Number(rc).valueOf()
					}
					return rc
				}
				case C_API.SQLITE_FLOAT:
					return capi.sqlite3_column_double(this.pointer, ndx)
				case C_API.SQLITE_TEXT:
					return capi.sqlite3_column_text(this.pointer, ndx)
				case C_API.SQLITE_BLOB: {
					const n = capi.sqlite3_column_bytes(this.pointer, ndx),
						ptr = capi.sqlite3_column_blob(this.pointer, ndx),
						rc = new Uint8Array(n)

					if (n) rc.set(wasm.heap8u().slice(ptr, ptr + n), 0)

					if (n && this.db._blobXfer instanceof Array) {
						this.db._blobXfer.push(rc.buffer)
					}
					return rc
				}
				default:
					sqliteError("Don't know how to translate", 'type of result column #' + ndx + '.')
			}
			sqliteError('Not reached.')
		}
		getInt(ndx) {
			return this.get(ndx, C_API.SQLITE_INTEGER)
		}
		getFloat(ndx) {
			return this.get(ndx, C_API.SQLITE_FLOAT)
		}
		getString(ndx) {
			return this.get(ndx, C_API.SQLITE_TEXT)
		}
		getBlob(ndx) {
			return this.get(ndx, C_API.SQLITE_BLOB)
		}
		getJSON(ndx) {
			const s = this.get(ndx, C_API.SQLITE_STRING)
			return null === s ? s : JSON.parse(s)
		}
		getColumnName(ndx) {
			return capi.sqlite3_column_name(affirmColIndex(affirmStmtOpen(this), ndx).pointer, ndx)
		}
		getColumnNames(tgt = []) {
			affirmColIndex(affirmStmtOpen(this), 0)
			const n = this.columnCount
			for (let i = 0; i < n; ++i) {
				tgt.push(capi.sqlite3_column_name(this.pointer, i))
			}
			return tgt
		}
		getParamIndex(name) {
			return affirmStmtOpen(this).parameterCount ? capi.sqlite3_bind_parameter_index(this.pointer, name) : undefined
		}
	}

	sqlite3.oo1 = { DB, Stmt }
}
