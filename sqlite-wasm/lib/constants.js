export const DEBUG = !!globalThis.DEBUG

export const HAS_BIGINT = !!globalThis.BigInt

export const ptrSizeof = 4

export const ptrIR = 'i32'

export const isLittleEndian = (() => {
	const buffer = new ArrayBuffer(2)
	new DataView(buffer).setInt16(0, 256, true)
	return new Int16Array(buffer)[0] === 256
})()

export const BindTypes = {
	null: 1,
	number: 2,
	string: 3,
	boolean: 4,
	blob: 5,
	...(HAS_BIGINT ? { bigint: 2 } : null),
}
