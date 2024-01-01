declare const pointerTag: unique symbol

export type WasmPointer<T = unknown> = number & { readonly [pointerTag]: T }

export type VersionInfo = {
	SQLITE_VERSION: string
	SQLITE_SOURCE_ID: string
	SQLITE_VERSION_NUMBER: number
}

interface SharedTypeMap {
	i8: number
	i16: number
	i32: number
	i64: BigInt
	int: number
	f32: number
	f64: number
	float: number
	double: number
	null: null
	'*': WasmPointer
	'void*': WasmPointer<'void'>
	'sqlite3_value*': WasmPointer<'value'>
}

export interface ResultTypeMap extends SharedTypeMap {
	void: void
	utf8: string
	string: string
	number: number
	pointer: WasmPointer
	'sqlite3*': WasmPointer<'db'>
}

export interface ArgTypeMap extends SharedTypeMap {
	'**': WasmPointer<'*'>
	utf8: number
	string: number
	pointer: number
	sqlite3_filename: number
	'string:static': string
	'string:flexible': number
	'sqlite3*': WasmPointer<'db'>
	'sqlite3_vfs*': WasmPointer<'vfs'>
	'sqlite3_stmt*': WasmPointer<'stmt'>
	'sqlite3_module*': WasmPointer<'module'>
	'sqlite3_session*': WasmPointer<'session'>
	'sqlite3_context*': WasmPointer<'context'>
	'sqlite3_index_info*': WasmPointer<'index_info'>
	'sqlite3_changegroup*': WasmPointer<'changegroup'>
	'sqlite3_changeset_iter*': WasmPointer<'changeset_iter'>
}

export type ArgTypeName = keyof ArgTypeMap

export type MappedArgs<T extends ArgTypeName[]> = {
	[Index in keyof T]: ArgTypeMap[T[Index]]
}
