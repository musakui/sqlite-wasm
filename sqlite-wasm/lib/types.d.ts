import { structs } from './base'
import type { AbstractArgAdapter } from './binding'
import type { BaseDB, Stmt } from './oo2'

declare const pointerTag: unique symbol

export type WasmPointer<T = unknown> = number & { readonly [pointerTag]: T }

export type DBPointer = WasmPointer<BaseDB>
export type StmtPointer = WasmPointer<Stmt>

export type VFSPointer = WasmPointer<typeof structs.sqlite3_vfs>

export type SQLValue = string | number | null | BigInt | Uint8Array | Int8Array | ArrayBuffer

export type VersionInfo = {
	SQLITE_VERSION: string
	SQLITE_SOURCE_ID: string
	SQLITE_VERSION_NUMBER: number
}

export interface FileSystemSyncAccessHandle {
	/** persists the changes from write() */
	flush(): void
	/** closes the file handle and releases the lock */
	close(): void
	/** get the size of the file in bytes */
	getSize(): number
	/** resizes the file to the specified number of bytes */
	truncate(newSize: number): void
	/**
	 * @param buffer buffer to read content into
	 */
	read(buffer: ArrayBuffer, opt?: { at?: number }): number
	/**
	 * @param buffer buffer to get the content to write
	 */
	write(buffer: ArrayBuffer, opt?: { at?: number }): number
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
	'*': WasmPointer<ArrayLike<unknown>>
	'void*': WasmPointer
	'sqlite3_value*': WasmPointer<'value'>
}

export interface ResultTypeMap extends SharedTypeMap {
	void: void
	utf8: string
	string: string
	number: number
	pointer: WasmPointer
	'sqlite3*': DBPointer
	'sqlite3_vfs*': VFSPointer
}

export interface ArgTypeMap extends SharedTypeMap {
	'**': WasmPointer<WasmPointer>
	utf8: number
	string: number
	pointer: number
	sqlite3_filename: number
	'string:static': string
	'string:flexible': number
	'sqlite3*': DBPointer
	'sqlite3_vfs*': VFSPointer
	'sqlite3_stmt*': StmtPointer
	'sqlite3_module*': WasmPointer<'module'>
	'sqlite3_session*': WasmPointer<'session'>
	'sqlite3_context*': WasmPointer<'context'>
	'sqlite3_index_info*': WasmPointer<'index_info'>
	'sqlite3_changegroup*': WasmPointer<'changegroup'>
	'sqlite3_changeset_iter*': WasmPointer<'changeset_iter'>
}

export type ArgTypes = Array<keyof ArgTypeMap | AbstractArgAdapter>

export type MappedArgs<T extends ArgTypes> = {
	[Index in keyof T]: T[Index] extends AbstractArgAdapter<infer R> ? R : ArgTypeMap[T[Index]]
}
