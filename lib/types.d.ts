declare const objTag: unique symbol

type PStack = { readonly [objTag]: 'pstack' }

type RawDB = { readonly [objTag]: 'db' }

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

export type DBPointer = WasmPointer<RawDB>

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

	_open_v2(
		name: WasmPointer<string>,
		ptr: WasmPointer,
		flags: number,
		vfs: WasmPointer<string>
	): number

	_exec(
		db: DBPointer,
		sql: WasmPointer<string>,
		cb: WasmPointer<Function>,
		cbarg: WasmPointer,
		errmsg: WasmPointer<WasmPointer<string>>
	): number

	// internal methods
	__wasm_pstack_alloc<T>(n: number): WasmPointer<T>
	__wasm_pstack_restore(n: WasmPointer<PStack>): void
	__wasm_pstack_ptr(): WasmPointer<PStack>
	__wasm_pstack_quota(): number
	__wasm_pstack_remaining(): number

	// function table
	__indirect_function_table: WebAssembly.Table
}

interface ExecRowResult {
	values: readonly string[]
	names: readonly string[]
}

export type ExecCallback = (result: ExecRowResult) => void
