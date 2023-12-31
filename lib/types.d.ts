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
	'*': number
	'null': null
	'void*': number
	'sqlite3*': number
	'sqlite3_value*': number
}

export interface ArgTypeMap extends SharedTypeMap {
	'**': number
	utf8: number
	string: number
	pointer: number
	sqlite3_filename: number
	'sqlite3_context*': number
	'sqlite3_stmt*': number
	'sqlite3_vfs*': number
	'string:static': string
	'string:flexible': number
}

export type ArgTypeName = keyof ArgTypeMap

export type MappedArgs<T extends ArgTypeName[]> = {
	[Index in keyof T]: ArgTypeMap[T[Index]]
}

export interface ResultTypeMap extends SharedTypeMap {
	void: void
	utf8: string
	string: string
	number: number
	pointer: number
}
