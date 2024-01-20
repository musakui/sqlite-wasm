declare const objTag: unique symbol

type PStack = { readonly [objTag]: 'pstack' }

type RawDB = { readonly [objTag]: 'db' }
type RawStmt = { readonly [objTag]: 'stmt' }

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

// prettier-ignore
export type ErrorCode =
	|  1 |  2 |  3 |  4 |  5 |  6 |  7 |  8 |  9 | 10
	| 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
	| 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28

export type ResultCode = 0 | ErrorCode | 100 | 101

export interface SQLiteDatatype {
	1: number
	2: number | BigInt
	3: string
	4: unknown
	5: null
}

export type WasmPointer<T = unknown> = number & { readonly [objTag]: T }

export type DBPointer = WasmPointer<RawDB>
export type StmtPointer = WasmPointer<RawStmt>

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
		filename: WasmPointer<string>,
		ppDb: WasmPointer,
		flags: number,
		zVfs: WasmPointer<string>
	): number

	_close_v2(db: DBPointer): number

	_exec(
		db: DBPointer,
		sql: WasmPointer<string>,
		callback: WasmPointer<Function>,
		cbarg: WasmPointer,
		errmsg: WasmPointer<WasmPointer<string>>
	): ResultCode

	_prepare_v3(
		db: DBPointer,
		zSql: WasmPointer<string>,
		nByte: number,
		prepFlags: number,
		stmt: WasmPointer,
		pzTail: WasmPointer
	): ResultCode

	_step(stmt: StmtPointer): ResultCode
	_reset(stmt: StmtPointer): ResultCode
	_finalize(stmt: StmtPointer): ResultCode

	_bind_parameter_count(stmt: StmtPointer): number
	_bind_parameter_name(stmt: StmtPointer, idx: number): WasmPointer<string>
	_bind_parameter_index(stmt: StmtPointer, zName: WasmPointer<string>): number

	_bind_null(stmt: StmtPointer, idx: number): ResultCode

	_bind_int(stmt: StmtPointer, idx: number, val: number): ResultCode
	_bind_int64(stmt: StmtPointer, idx: number, val: BigInt): ResultCode
	_bind_double(stmt: StmtPointer, idx: number, val: number): ResultCode

	_bind_text(stmt: StmtPointer, idx: number, val: WasmPointer<string>): ResultCode
	_bind_blob(stmt: StmtPointer, idx: number, val: WasmPointer<string>): ResultCode

	_column_count(stmt: StmtPointer): number
	_column_type(stmt: StmtPointer, idx: number): keyof SQLiteDatatype
	_column_name(stmt: StmtPointer, idx: number): WasmPointer<string>

	_column_int(stmt: StmtPointer, idx: number): number
	_column_int64(stmt: StmtPointer, idx: number): BigInt
	_column_double(stmt: StmtPointer, idx: number): number

	_column_bytes(stmt: StmtPointer, idx: number): number
	_column_text(stmt: StmtPointer, idx: number): WasmPointer<string>
	_column_blob(stmt: StmtPointer, idx: number): WasmPointer<ArrayBuffer>

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
