import { asm } from './core.js'

const typeCodes = { f64: 0x7c, f32: 0x7d, i64: 0x7e, i32: 0x7f }

/** @param {keyof typeCodes} x */
const typeCode = (x) => typeCodes[x]

/** @param {number} n */
const encodeBytes = (n) => (n < 128 ? [n] : [n % 128, n >> 7])

/**
 * create a funcref for the function table
 *
 * stand-in for the upcoming `WebAssembly.Function` constructor
 *
 * @param {Function} func
 * @param {keyof typeCodes | null} resultType
 * @param {...keyof typeCodes} argTypes
 */
export const to_funcref = (func, resultType, ...argTypes) => {
	// prettier-ignore
	const typeSection = [
		// 1 func
		0x01, 0x60,
		// arg types
		...encodeBytes(argTypes.length), ...argTypes.map(typeCode),
		// result type
		...(resultType === null ? [0x00] : [0x01, typeCode(resultType)]),
	]

	// prettier-ignore
	const bytecode = new Uint8Array([
		// magic number (ASM)
		0x00, 0x61, 0x73, 0x6d,
		// version
		0x01, 0x00, 0x00, 0x00,
		// type section
		0x01, ...encodeBytes(typeSection.length), ...typeSection,
		// import "e" "f" (func $e.f (type $t0))
		0x02, 0x07, 0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
		// export "f" (func $e.f)
		0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00,
	])

	const mod = new WebAssembly.Module(bytecode)
	const inst = new WebAssembly.Instance(mod, { e: { f: func } })
	return inst.exports.f
}

export const function_table = () => asm.__indirect_function_table

/**
 * @param {Function} func
 * @param {keyof typeCodes | null} resultType
 * @param {...keyof typeCodes} argTypes
 */
export const install_function = (func, resultType, ...argTypes) => {
	const ft = function_table()
	const ptr = ft.length
	ft.grow(1)
	ft.set(ptr, to_funcref(func, resultType, ...argTypes))
	return ptr
}
