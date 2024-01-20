declare const objTag: unique symbol

type PStack = { readonly [objTag]: 'pstack' }

export interface LoaderOptions<Exports extends WebAssembly.Exports> {
	/** transform props for easier access */
	propTransform: (p: string) => string

	/** convenience option for providing Exports */
	exports: Exports
}

export interface EmscriptenImports {
	env?: {
		memory?: WebAssembly.Memory
	}

	wasi_snapshot_preview1?: {
		environ_get: (ctx: number, env: number, buf: number) => number
		environ_sizes_get: (ctx: number, count: number, buf_size: number) => number
	}
}

export type WasmPointer<T = unknown> = number & { readonly [objTag]: T }

export interface SQLiteASM extends WebAssembly.Exports {
	_initialize(): void

	// memory management
	_malloc<T>(n: number): WasmPointer<T>
	_free(n: WasmPointer): void
	_realloc<T>(m: WasmPointer<T>, n: number): WasmPointer<T>

	// version
	_libversion_number(): number
	_libversion(): WasmPointer<string>
	_sourceid(): WasmPointer<string>

	// internal methods
	__wasm_pstack_alloc<T>(n: number): WasmPointer<T>
	__wasm_pstack_restore(n: WasmPointer<PStack>): void
	__wasm_pstack_ptr(): WasmPointer<PStack>
	__wasm_pstack_quota(): number
	__wasm_pstack_remaining(): number
}
