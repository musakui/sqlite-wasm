export type WasmPointer = number

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
	'void*': WasmPointer
	'sqlite3*': WasmPointer
	'sqlite3_value*': WasmPointer
}

export interface ResultTypeMap extends SharedTypeMap {
	void: void
	utf8: string
	string: string
	number: number
	pointer: WasmPointer
}

export interface ArgTypeMap extends SharedTypeMap {
	'**': WasmPointer
	utf8: number
	string: number
	pointer: number
	sqlite3_filename: number
	'sqlite3_context*': WasmPointer
	'sqlite3_stmt*': WasmPointer
	'sqlite3_vfs*': WasmPointer
	'string:static': string
	'string:flexible': number
}

export type ArgTypeName = keyof ArgTypeMap

export type MappedArgs<T extends ArgTypeName[]> = {
	[Index in keyof T]: ArgTypeMap[T[Index]]
}
