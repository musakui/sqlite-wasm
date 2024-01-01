import { getASM } from './instance.js'
import { capi, wasm, C_API, cstrToJs } from './base.js'
import { functionEntry, allocFromTypedArray, cArgvToJs } from './heap.js'
import { abort } from './util.js'

import { sqlite3_wasm_db_error } from './capi.js'

import {
	sqlite3_result_js,
	sqlite3_result_error_js,
	sqlite3_values_to_js,
} from './wasm.js'

import * as util from './util.js'
import * as heap from './heap.js'
import * as logger from './logger.js'

export const installWhWasm = (sqlite3) => {
	const asm = getASM()
	const contextKey = (a) => a[0]
	const FPA = (o) => new wasm.xWrap.FuncPtrAdapter(o)

	wasm.bindingSignatures = [
		['sqlite3_busy_handler', 'int', ['sqlite3*', FPA({ signature: 'i(pi)', contextKey }), '*']],
		['sqlite3_commit_hook', 'void*', ['sqlite3*', FPA({ name: 'sqlite3_commit_hook', signature: 'i(p)', contextKey }), '*']],
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
								return callback(cArgvToJs(nc, cv), cArgvToJs(nc, cn)) | 0
							} catch (e) {
								return e.resultCode || C_API.SQLITE_ERROR
							}
						}
					},
				}),
				'*',
				'**',
			],
		],
		['sqlite3_free', undefined, '*'],
		['sqlite3_realloc', '*', '*', 'int'],
		[
			'sqlite3_progress_handler',
			undefined,
			['sqlite3*', 'int', FPA({ name: 'xProgressHandler', signature: 'i(p)', bindScope: 'context', contextKey }), '*'],
		],
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
								s0 = s0 && cstrToJs(s0)
								s1 = s1 && cstrToJs(s1)
								s2 = s2 && cstrToJs(s2)
								s3 = s3 && cstrToJs(s3)
								return callback(pV, iCode, s0, s1, s2, s3) || 0
							} catch (e) {
								return e.resultCode || C_API.SQLITE_ERROR
							}
						}
					},
				}),
				'*',
			],
		],
		['sqlite3_set_auxdata', undefined, ['sqlite3_context*', 'int', '*', FPA({ name: 'xDestroyAuxData', signature: 'v(*)', contextKey })]],
		['sqlite3_trace_v2', 'int', ['sqlite3*', 'int', FPA({ name: 'sqlite3_trace_v2::callback', signature: 'i(ippp)', contextKey }), '*']],
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
	]

	wasm.bindingSignatures.int64 = [
		['sqlite3_changes64', 'i64', ['sqlite3*']],
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
							callback(p, db, op, cstrToJs(zDb), cstrToJs(zTbl), iKey1, iKey2)
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
							callback(p, op, cstrToJs(z0), cstrToJs(z1), rowid)
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

	if (!!asm.sqlite3changegroup_add) {
		const __ipsProxy = {
			signature: 'i(ps)',
			callProxy: (callback) => (p, s) => {
				try {
					return callback(p, cstrToJs(s)) | 0
				} catch (e) {
					return e.resultCode || C_API.SQLITE_ERROR
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

	{
		const __xArgPtr = wasm.xWrap.argAdapter('*')
		const nilType = function () {}
		wasm.xWrap.argAdapter('sqlite3_stmt*', (v) =>
			__xArgPtr(v instanceof (sqlite3?.oo1?.Stmt || nilType) ? v.pointer : v)
		)('sqlite3*', (v) => __xArgPtr(v instanceof (sqlite3?.oo1?.DB || nilType) ? v.pointer : v))

		if (0 === asm.sqlite3_step.length) {
			wasm.xWrap.doArgcCheck = false
			warn('Disabling sqlite3.wasm.xWrap.doArgcCheck due to environmental quirks.')
		}
		for (const e of wasm.bindingSignatures) {
			capi[e[0]] = wasm.xWrap.apply(null, e)
		}
		for (const e of wasm.bindingSignatures.int64) {
			capi[e[0]] = wasm.xWrap.apply(null, e)
		}

		delete wasm.bindingSignatures

		if (!functionEntry(C_API.SQLITE_WASM_DEALLOC)) {
			abort('Internal error: cannot resolve exported function', 'entry SQLITE_WASM_DEALLOC (==' + capi.SQLITE_WASM_DEALLOC + ').')
		}

		capi.sqlite3_vtab_config = wasm.xWrap('sqlite3_wasm_vtab_config', 'int', ['sqlite3*', 'int', 'int'])
	}

	const __dbArgcMismatch = (pDb, f, n) => {
		return sqlite3_wasm_db_error(pDb, C_API.SQLITE_MISUSE, f + '() requires ' + n + ' argument' + (1 === n ? '' : 's') + '.')
	}

	const __errEncoding = (pDb) => {
		return sqlite3_wasm_db_error(pDb, C_API.SQLITE_FORMAT, 'SQLITE_UTF8 is the only supported encoding.')
	}

	const __argPDb = (pDb) => wasm.xWrap.argAdapter('sqlite3*')(pDb)
	const __argStr = (str) => (util.isPtr(str) ? cstrToJs(str) : str)
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
			const x = asm[name]
			closeArgs.length = x.length
			try {
				capi[name](...closeArgs)
			} catch (e) {
				logger.warn('close-time call of', name + '(', closeArgs, ') threw:', e)
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
				const fargs = [pDb, name, 0, C_API.SQLITE_UTF8, 0, 0, 0, 0, 0]
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
			return 'argv[' + argIndex + ']:' + argv[0] + ':' + cstrToJs(argv[1]).toLowerCase()
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
				eTextRep |= C_API.SQLITE_UTF8
			} else if (C_API.SQLITE_UTF8 !== (eTextRep & 0xf)) {
				return __errEncoding(pDb)
			}
			try {
				const rc = __sqlite3CreateCollationV2(pDb, zName, eTextRep, pArg, xCompare, xDestroy)
				if (0 === rc && xCompare instanceof Function) {
					__dbCleanupMap.addCollation(pDb, zName)
				}
				return rc
			} catch (e) {
				return sqlite3_wasm_db_error(pDb, e)
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
			return argv[0] + ':' + (argv[2] < 0 ? -1 : argv[2]) + ':' + argIndex + ':' + cstrToJs(argv[1]).toLowerCase()
		}

		const __cfProxy = Object.assign(Object.create(null), {
			xInverseAndStep: {
				signature: 'v(pip)',
				contextKey,
				callProxy: (callback) => {
					return (pCtx, argc, pArgv) => {
						try {
							callback(pCtx, ...sqlite3_values_to_js(argc, pArgv))
						} catch (e) {
							sqlite3_result_error_js(pCtx, e)
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
							sqlite3_result_js(pCtx, callback(pCtx))
						} catch (e) {
							sqlite3_result_error_js(pCtx, e)
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
							sqlite3_result_js(pCtx, callback(pCtx, ...sqlite3_values_to_js(argc, pArgv)))
						} catch (e) {
							sqlite3_result_error_js(pCtx, e)
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
							logger.error('UDF xDestroy method threw:', e)
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
				eTextRep |= C_API.SQLITE_UTF8
			} else if (C_API.SQLITE_UTF8 !== (eTextRep & 0xf)) {
				return __errEncoding(pDb)
			}
			try {
				const rc = __sqlite3CreateFunction(pDb, funcName, nArg, eTextRep, pApp, xFunc, xStep, xFinal, xDestroy)
				if (0 === rc && (xFunc instanceof Function || xStep instanceof Function || xFinal instanceof Function || xDestroy instanceof Function)) {
					__dbCleanupMap.addFunction(pDb, funcName, nArg)
				}
				return rc
			} catch (e) {
				logger.error('sqlite3_create_function_v2() setup threw:', e)
				return sqlite3_wasm_db_error(pDb, e, 'Creation of UDF threw: ' + e)
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
				eTextRep |= C_API.SQLITE_UTF8
			} else if (C_API.SQLITE_UTF8 !== (eTextRep & 0xf)) {
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
				logger.error('sqlite3_create_window_function() setup threw:', e)
				return sqlite3_wasm_db_error(pDb, e, 'Creation of UDF threw: ' + e)
			}
		}

		capi.sqlite3_create_function_v2.udfSetResult =
			capi.sqlite3_create_function.udfSetResult =
			capi.sqlite3_create_window_function.udfSetResult =
				sqlite3_result_js

		capi.sqlite3_create_function_v2.udfConvertArgs =
			capi.sqlite3_create_function.udfConvertArgs =
			capi.sqlite3_create_window_function.udfConvertArgs =
				sqlite3_values_to_js

		capi.sqlite3_create_function_v2.udfSetError =
			capi.sqlite3_create_function.udfSetError =
			capi.sqlite3_create_window_function.udfSetError =
				sqlite3_result_error_js
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
					return sqlite3_wasm_db_error(pDb, C_API.SQLITE_MISUSE, 'Invalid SQL argument type for sqlite3_prepare_v2/v3().')
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
			} else if (util.isPtr(text) || null === text) {
				return __bindText(pStmt, iCol, text, nText, xDestroy)
			} else if (text instanceof ArrayBuffer) {
				text = new Uint8Array(text)
			} else if (Array.isArray(pMem)) {
				text = pMem.join('')
			}
			let p, n
			try {
				if (util.isSQLableTypedArray(text)) {
					p = allocFromTypedArray(text)
					n = text.byteLength
				} else if ('string' === typeof text) {
					;[p, n] = heap.allocCString(text)
				} else {
					return sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), C_API.SQLITE_MISUSE, 'Invalid 3rd argument type for sqlite3_bind_text().')
				}
				return __bindText(pStmt, iCol, p, n, C_API.SQLITE_WASM_DEALLOC)
			} catch (e) {
				wasm.dealloc(p)
				return sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), e)
			}
		}

		capi.sqlite3_bind_blob = function f(pStmt, iCol, pMem, nMem, xDestroy) {
			if (f.length !== arguments.length) {
				return __dbArgcMismatch(capi.sqlite3_db_handle(pStmt), 'sqlite3_bind_blob', f.length)
			} else if (util.isPtr(pMem) || null === pMem) {
				return __bindBlob(pStmt, iCol, pMem, nMem, xDestroy)
			} else if (pMem instanceof ArrayBuffer) {
				pMem = new Uint8Array(pMem)
			} else if (Array.isArray(pMem)) {
				pMem = pMem.join('')
			}
			let p, n
			try {
				if (util.isBindableTypedArray(pMem)) {
					p = allocFromTypedArray(pMem)
					n = nMem >= 0 ? nMem : pMem.byteLength
				} else if ('string' === typeof pMem) {
					;[p, n] = heap.allocCString(pMem)
				} else {
					return sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), C_API.SQLITE_MISUSE, 'Invalid 3rd argument type for sqlite3_bind_blob().')
				}
				return __bindBlob(pStmt, iCol, p, n, C_API.SQLITE_WASM_DEALLOC)
			} catch (e) {
				wasm.dealloc(p)
				return sqlite3_wasm_db_error(capi.sqlite3_db_handle(pStmt), e)
			}
		}
	}

	wasm.xWrap.FuncPtrAdapter.warnOnUse = true
}
