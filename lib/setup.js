import { cstrToJs, xCall, loadResultCodes } from './binding.js'
import { Jaccwabyt } from './jaccwabyt.js'
import { alloc, dealloc, HEAP8U } from './heap.js'

const ignoreStructs = new Set(['WasmTestStruct'])

export const init = () => {
	const cJson = xCall('sqlite3_wasm_enum_json')
	if (!cJson) {
		toss(`Maintenance required: increase the static buffer size for sqlite3_wasm_enum_json`)
	}

	const obj = JSON.parse(cstrToJs(cJson))

	const binder = Jaccwabyt({
		alloc,
		dealloc,
		heap: HEAP8U,
		memberPrefix: '$',
	})

	const entries = Object.entries(obj).flatMap(([g, group]) => {
		if (g === 'structs') {
			return group.flatMap((s) => {
				return ignoreStructs.has(s.name) ? [] : [[s.name, binder(s)]]
			})
		}

		const ent = Object.entries(group)
		if (g === 'resultCodes') loadResultCodes(ent)
		return ent
	})

	return Object.fromEntries(entries)
}
