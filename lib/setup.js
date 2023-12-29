import { getExports, loadResultCodes } from './init.js'
import { alloc, dealloc, HEAP8U } from './heap.js'
import { cstrToJs } from './binding.js'

import { Jaccwabyt } from './jaccwabyt.js'

const ignoreStructs = new Set(['WasmTestStruct'])

export let StructBinder = null

export const initCapi = (target) => {
	const cJson = getExports().sqlite3_wasm_enum_json()
	if (!cJson) {
		toss(`Maintenance required: increase the static buffer size for sqlite3_wasm_enum_json`)
	}

	StructBinder = Jaccwabyt({ alloc, dealloc, heap: HEAP8U, memberPrefix: '$' })

	const obj = JSON.parse(cstrToJs(cJson))
	for (const [g, group] of Object.entries(obj)) {
		if (g === 'structs') {
			for (const s of group) {
				if (ignoreStructs.has(s.name)) continue
				target[s.name] = StructBinder(s)
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
