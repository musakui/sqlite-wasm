const { MIN_SAFE_INTEGER, MAX_SAFE_INTEGER } = Number
const MAX_BIGINT_64 = 0x7FFFFFFFFFFFFFFFn
const MIN_BIGINT_64 = ~MAX_BIGINT_64

const DECODER = new TextDecoder('utf8')

export const isPtr32 = (ptr) => 'number' === typeof ptr && ptr === (ptr | 0) && ptr >= 0

export const isPtr = isPtr32

export const isFunction = (fn) => fn instanceof Function

export const isInt32 = (n) => 'bigint' !== typeof n && !!(n === (n | 0) && n <= 2147483647 && n >= -2147483648)

export const bigIntFits64 = (b) => b >= MIN_BIGINT_64 && b <= MAX_BIGINT_64

export const bigIntFits32 = (b) => b >= -0x7fffffffn - 1n && b <= 0x7fffffffn

export const bigIntFitsDouble = (b) => b >= MIN_SAFE_INTEGER && b <= MAX_SAFE_INTEGER

export const isTypedArray = (v) => (isInt32(v?.constructor?.BYTES_PER_ELEMENT) ? v : false)

export const isSAB = globalThis.SharedArrayBuffer ? (b) => b instanceof SharedArrayBuffer : () => false

export const typedArrayPart = (arr, s, e) => (isSAB(arr.buffer) ? arr.slice(s, e) : arr.subarray(s, e))

export const isSQLableTypedArray = (v) => v && (v instanceof Uint8Array || v instanceof Int8Array || v instanceof ArrayBuffer)

export const isBindableTypedArray = isSQLableTypedArray

export const typedArrayToString = (arr, s, e) => DECODER.decode(typedArrayPart(arr, s, e))

export const toss = (...args) => {
	throw new Error(args.join(' '))
}

export const hasSyncAccessHandle = () => {
	return navigator?.storage?.getDirectory && globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle
}

export const jstrlen = (str) => {
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

export const jstrcpy = (jstr, tgt, offset = 0, maxBytes = -1, addNul = true) => {
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
