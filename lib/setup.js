import { cstrToJs, xCall, loadResultCodes } from './binding.js'
import { Jaccwabyt } from './jaccwabyt.js'
import { alloc, dealloc, HEAP8U } from './heap.js'

const ignoreStructs = new Set(['WasmTestStruct'])

export const initCapi = (target) => {
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

	for (const [g, group] of Object.entries(obj)) {
		if (g === 'structs') {
			for (const s of group) {
				if (ignoreStructs.has(s.name)) continue
				target[s.name] = binder(s)
			}
			continue
		}

		const ent = Object.entries(group)

		if (g === 'resultCodes') loadResultCodes(ent)

		for (const [k, v] of ent) {
			target[k] = v
		}
	}
}
