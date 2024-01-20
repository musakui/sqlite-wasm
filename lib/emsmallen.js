/** @type {{}} */
const raw = Object.create(null)

/**
 * create a shim for the importObject (to prevent LinkError)
 *
 * @param {string} name
 * @param {unknown} target
 * @param {(m: string) => void} [warn]
 */
const importShim = (name, target, warn) => {
	const unimplemented = (prop) => {
		return () => {
			throw new Error(`${name}.${prop} was called but not implemented`)
		}
	}

	return new Proxy(target, {
		get(tgt, prop) {
			warn?.(`${name}.${prop} was accessed`)
			return tgt[prop] ?? unimplemented(prop)
		},
	})
}

/**
 * @template {WebAssembly.Exports} Exports
 * @param {Partial<import('./types').LoaderOptions<Exports>>} [opts]
 */
export const loader = (opts) => {
	/** @type {WebAssembly.Exports | null} */
	let exps = null

	/**
	 * stream and instantiate module
	 * @param {Response | PromiseLike<Response>} source
	 * @param {import('./types').EmscriptenImports} [imports]
	 */
	const load = async (source, imports) => {
		const wasi = imports?.wasi_snapshot_preview1 ?? {
			environ_get: () => 0,
			environ_sizes_get: () => 0,
		}

		const src = await WebAssembly.instantiateStreaming(source, {
			env: importShim('env', imports?.env ?? {}),
			wasi_snapshot_preview1: importShim('wasi1', wasi),
		})

		exps = src.instance.exports

		// emscripten startup command
		exps.__wasm_call_ctors()

		return src
	}

	const xp = opts?.propTransform

	/** @type {Exports} */
	const asm = new Proxy(raw, {
		get(_, prop) {
			if (!exps) throw new Error('not ready')
			return exps[prop] ?? (xp && exps[xp(prop)])
		},
	})

	return { load, asm }
}
