const { MIN_SAFE_INTEGER, MAX_SAFE_INTEGER } = Number
const MAX_BIGINT = BigInt('0x7fffffffffffffff')
const MIN_BIGINT = ~MAX_BIGINT

const DECODER = new TextDecoder('utf8')

export const isInt32 = (n) => 'bigint' !== typeof n && !!(n === (n | 0) && n <= 2147483647 && n >= -2147483648)

export const bigIntFits64 = (b) => b >= MIN_BIGINT && b <= MAX_BIGINT

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
