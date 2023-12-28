import { capi } from './init.js'

export class SQLite3Error extends Error {
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

export class WasmAllocError extends Error {
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
