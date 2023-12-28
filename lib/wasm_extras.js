import { capi } from './init.js'

export const compileOptionUsed = function f(optName) {
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
		return Object.fromEntries(optName.map((v) => [v, capi.sqlite3_compileoption_used(v)]))
	} else if ('object' === typeof optName) {
		return Object.fromEntries(Object.keys(optName).map((k) => [k, capi.sqlite3_compileoption_used(k)]))
	}
	return 'string' === typeof optName ? !!capi.sqlite3_compileoption_used(optName) : false
}
