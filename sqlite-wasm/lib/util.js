const { MIN_SAFE_INTEGER, MAX_SAFE_INTEGER } = Number
const MAX_BIGINT_64 = 0x7fffffffffffffffn
const MIN_BIGINT_64 = ~MAX_BIGINT_64

const DECODER = new TextDecoder('utf8')

export const NO_OP = () => {}

/**
 * @param {string} msg
 * @param {unknown} [cause]
 */
export const abort = (msg, cause) => {
	throw new Error(msg, cause ? { cause } : undefined)
}

export const randString = () => Math.random().toString(36).slice(2)

/**
 * @param {unknown} b
 * @return {b is SharedArrayBuffer}
 */
export const isSAB = (b) => (globalThis.SharedArrayBuffer ? b instanceof SharedArrayBuffer : false)

/**
 * @param {unknown} fn
 * @return {fn is Function}
 */
export const isFunction = (fn) => fn instanceof Function

/**
 * @param {unknown} ptr
 * @return {ptr is number}
 */
export const isPtr32 = (ptr) => 'number' === typeof ptr && ptr === (ptr | 0) && ptr >= 0

export const isPtr = isPtr32

/**
 * @param {unknown} n
 * @return {n is number}
 */
export const isInt32 = (n) => 'bigint' !== typeof n && !!(n === (n | 0) && n <= 2147483647 && n >= -2147483648)

/**
 * @param {unknown} v
 * @return {v is Uint8Array}
 */
export const isTypedArray = (v) => (isInt32(v?.constructor?.BYTES_PER_ELEMENT) ? v : false)

/**
 * @param {unknown} v
 * @return {v is Uint8Array | Int8Array | ArrayBuffer}
 */
export const isSQLableTypedArray = (v) => v && (v instanceof Uint8Array || v instanceof Int8Array || v instanceof ArrayBuffer)

export const isBindableTypedArray = isSQLableTypedArray

/** @param {number} b */
export const bigIntFits64 = (b) => b >= MIN_BIGINT_64 && b <= MAX_BIGINT_64

/** @param {number} b */
export const bigIntFits32 = (b) => b >= -0x7fffffffn - 1n && b <= 0x7fffffffn

/** @param {number} b */
export const bigIntFitsDouble = (b) => b >= MIN_SAFE_INTEGER && b <= MAX_SAFE_INTEGER

/**
 * @param {Uint8Array} arr
 * @param {number} [s]
 * @param {number} [e]
 */
export const typedArrayPart = (arr, s, e) => (isSAB(arr.buffer) ? arr.slice(s, e) : arr.subarray(s, e))

/**
 * @param {Uint8Array} arr
 * @param {number} [s]
 * @param {number} [e]
 */
export const typedArrayToString = (arr, s, e) => DECODER.decode(typedArrayPart(arr, s, e))

/** @param {ArrayBuffer} buf */
export const bufToString = (buf) => DECODER.decode(buf)

export const checkOPFS = async () => {
	const dh = await globalThis?.navigator?.storage?.getDirectory()
	if (!dh) abort('could not open OPFS')
	const fn = `.c-${randString()}`
	const fh = await dh.getFileHandle(fn, { create: true })
	const ah = await fh.createSyncAccessHandle()
	const cp = ah.close()
	await cp
	await dh.removeEntry(fn)
	if (cp?.then) abort('handle.close() is async')
}

export const toss = (...args) => {
	throw new Error(args.join(' '))
}
