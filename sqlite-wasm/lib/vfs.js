import { getASM, sqliteError, structs } from './base.js'
import * as SQLITE from './embedded.js'
import * as heap from './heap.js'
import { abort } from './util.js'
import { installMethods } from './struct.js'

/** @typedef {import('./types').FileSystemSyncAccessHandle} FileSystemSyncAccessHandle */

/** @type {number | null} */
let ioPointer = null

/** @type {number | null} */
let vfsPointer = null

/** @type {unknown} */
let fsError = null

/** @type {FileSystemDirectoryHandle | null} */
let rootDh = null

/** @type {FileSystemDirectoryHandle | null} */
let poolDh = null

const MIN_POOL_SIZE = 2
const SECTOR_SIZE = 4096

const EPOCH_JULIAN_DAY = 2440587.5
const MILLSECONDS_IN_DAY = 86400000

const VFS_ROOT_DIRNAME = '.sqlite_vfs'
const VFS_STATE_FILENAME = '.sqlite_vfs_state'

let poolDir = VFS_ROOT_DIRNAME

const PERSISTENT_FILE_TYPES = SQLITE.OPEN_MAIN_DB | SQLITE.OPEN_MAIN_JOURNAL | SQLITE.OPEN_SUPER_JOURNAL | SQLITE.OPEN_WAL

const randName = () => Math.random().toString(36).slice(2, 10).padStart(8, '_')

const getTime = () => new Date().getTime()

/**
 * @param {unknown} [e]
 * @param {number} [code]
 */
const storeErr = (e, code) => {
	if (e) {
		e.sqlite3Rc = code || SQLITE.IOERR
		console.error(e)
	}
	fsError = e
	return code
}

/** @type {string[]} */
const freeHandles = []

/**
 * real path -> SyncAccessHandle
 * @type {Map<string, FileSystemSyncAccessHandle>}
 */
const sahMap = new Map()

/**
 * vfs file pointer -> vfs path
 * @type {Map<number, string>}
 */
const ptrMap = new Map()

/**
 * vfs path -> real path
 * @type {Map<string, string>}
 */
const vfsFileMap = new Map()

/**
 * vfs path -> flags
 * @type {Map<string, number>}
 */
const vfsFlags = new Map()

const addHandle = async () => {
	const fn = randName()
	const fh = await poolDh.getFileHandle(fn, { create: true })
	const name = `${poolDir}/${fn}`
	sahMap.set(name, await fh.createSyncAccessHandle())
	freeHandles.push(name)
	return name
}

/** @param {number} pFile */
const getRealPath = (pFile) => vfsFileMap.get(ptrMap.get(pFile))

/** @param {number} pFile */
const getSAH = (pFile) => sahMap.get(getRealPath(pFile))

const xSectorSize = () => SECTOR_SIZE

const xFileControl = () => SQLITE.NOTFOUND

const xDeviceCharacteristics = () => SQLITE.IOCAP_UNDELETABLE_WHEN_OPEN

/** @type {Map<number, number>} */
const lockTypeMap = new Map()

/**
 * @param {number} pFile
 * @param {number} lockType
 */
const setLock = (pFile, lockType) => {
	storeErr()
	lockTypeMap.set(pFile, lockType)
	return 0
}

/** @param {number} pOut */
const xCurrentTime = (_, pOut) => {
	heap.poke64f(pOut, EPOCH_JULIAN_DAY + getTime() / MILLSECONDS_IN_DAY)
	return 0
}

/** @param {number} pOut */
const xCurrentTimeInt64 = (_, pOut) => {
	heap.poke64(pOut, EPOCH_JULIAN_DAY * MILLSECONDS_IN_DAY + getTime())
	return 0
}

/** @param {number} pOut */
const xCheckReservedLock = (_, pOut) => {
	storeErr()
	heap.poke32(pOut, 1)
	return 0
}

/**
 * @param {number} pFile
 * @param {number} pSz64
 */
const xFileSize = (pFile, pSz64) => {
	storeErr()
	heap.poke64(pSz64, BigInt(getSAH(pFile)?.getSize() ?? 0))
	return 0
}

/**
 * @param {number} pFile
 * @param {number} pDest
 * @param {number} n
 * @param {BigInt} offset64
 */
const xRead = (pFile, pDest, n, offset64) => {
	storeErr()
	try {
		const hp = heap.heap8u()
		const at = Number(offset64)
		const dst = hp.subarray(pDest, pDest + n)
		const nRead = getSAH(pFile).read(dst, { at })
		if (nRead < n) {
			hp.fill(0, pDest + nRead, pDest + n)
			return SQLITE.IOERR_SHORT_READ
		}
		return 0
	} catch (e) {
		return storeErr(e, SQLITE.IOERR)
	}
}

/**
 * @param {number} pFile
 * @param {number} pSrc
 * @param {number} n
 * @param {BigInt} offset64
 */
const xWrite = (pFile, pSrc, n, offset64) => {
	storeErr()
	try {
		const at = Number(offset64)
		const src = heap.heap8u().subarray(pSrc, pSrc + n)
		const nBytes = getSAH(pFile).write(src, { at })
		return n === nBytes ? 0 : abort('unknown write failure')
	} catch (e) {
		return storeErr(e, SQLITE.IOERR)
	}
}

/**
 * @param {number} pFile
 * @param {number} _flags
 */
const xSync = (pFile, _flags) => {
	storeErr()
	try {
		getSAH(pFile).flush()
		return 0
	} catch (e) {
		return storeErr(e, SQLITE.IOERR)
	}
}

/**
 * @param {number} pFile
 * @param {number} sz64
 */
const xTruncate = (pFile, sz64) => {
	storeErr()
	try {
		getSAH(pFile).truncate(Number(sz64))
		return 0
	} catch (e) {
		return storeErr(e, SQLITE.IOERR)
	}
}

/**
 * @param {number} pFile
 */
const xClose = (pFile) => {
	storeErr()
	const path = getRealPath(pFile)
	if (!path) return 0
	try {
		sahMap.get(path).flush()
		if (flag & SQLITE.OPEN_DELETEONCLOSE) {
			vfsFileMap.delete(path)
			freeHandles.push(path)
		}
	} catch (e) {
		return storeErr(e, SQLITE.IOERR)
	}
	return 0
}

/**
 * @param {number} pVfs
 * @param {number} zName
 * @param {number} pFile
 * @param {number} flags
 * @param {number} pOutFlags
 */
const xOpen = (pVfs, zName, pFile, flags, pOutFlags) => {
	storeErr()
	const fn = zName && heap.peek8(zName) ? heap.cstrToJs(zName) : randName()
	try {
		let realPath = vfsFileMap.get(fn)
		if (!realPath && flags && SQLITE.OPEN_CREATE) {
			if (!freeHandles.length) return abort(`no more free handles to create ${fn}`)
			realPath = freeHandles.shift()
			vfsFileMap.set(fn, realPath)
		}
		if (!realPath) abort(`file not found ${fn}`)
		ptrMap.set(pFile, realPath)
		setLock(pFile, SQLITE.LOCK_NONE)
		const sq3File = new structs.sqlite3_file(pFile)
		sq3File.$pMethods = ioPointer
		sq3File.dispose()
		heap.poke32(pOutFlags, flags)
		return 0
	} catch (err) {
		storeErr(err)
		return SQLITE.CANTOPEN
	}
}

/**
 * @param {number} pVfs
 * @param {number} zName
 * @param {number} nOut
 * @param {number} pOut
 */
const xFullPathname = (pVfs, zName, nOut, pOut) => {
	const i = heap.cstrncpy(pOut, zName, nOut)
	return i < nOut ? 0 : SQLITE.CANTOPEN
}

/**
 * @param {number} pVfs
 * @param {number} zName
 * @param {number} flags
 * @param {number} pOut
 */
const xAccess = (pVfs, zName, flags, pOut) => {
	storeErr()
	const fn = heap.cstrToJs(zName)
	if (fn) {
		for (const info of fileMap.values()) {
			if (info[1] !== fn) continue
			heap.poke32(pOut, 1)
			return 0
		}
	}
	heap.poke32(pOut, 0)
	return 0
}

/**
 * @param {number} pVfs
 * @param {number} zName
 * @param {number} _doSyncDir
 */
const xDelete = (pVfs, zName, _doSyncDir) => {
	storeErr()
	try {
		const file = fileMap.get(heap.cstrToJs(zName))
		if (file) {
			freeHandles.push(file[1])
			file[1] = null
		}
		return 0
	} catch (e) {
		storeErr(e)
		return SQLITE.IOERR_DELETE
	}
}

export const openDbFile = async (fn) => {
	const fh = await rootDh.getFileHandle(fn, { create: true })
	sahMap.set(fn, await fh.createSyncAccessHandle())
	vfsFileMap.set(fn, fn)
}

export const initVFS = async () => {
	const dh = await globalThis?.navigator?.storage?.getDirectory()
	if (!dh) abort('could not open OPFS')

	const fh = await dh.getFileHandle(VFS_STATE_FILENAME, { create: true })
	const sah = await fh.createSyncAccessHandle()
	const cp = sah.close()
	await cp
	if (cp?.then) abort('sah.close() is async')

	const stateFile = await fh.getFile()
	const state = new Map(stateFile.size ? Object.entries(JSON.parse(await stateFile.text())) : [])

	rootDh = dh
	poolDh = await dh.getDirectoryHandle(VFS_ROOT_DIRNAME, { create: true })
	for await (const hd of poolDh.values()) {
		if (hd.kind !== 'file') continue
		const pathParts = await dh.resolve(hd)
		const name = pathParts.join('/')
		sahMap.set(name, await hd.createSyncAccessHandle())
		if (state.has(name)) {
			const [vn, vf] = state.get(name)
			vfsFileMap.set(vn, name)
			vfsFlags.set(vn, vf)
		} else {
			freeHandles.push(name)
		}
	}

	while (freeHandles.length < MIN_POOL_SIZE) {
		await addHandle()
	}

	const ioStruct = new structs.sqlite3_io_methods()
	installMethods(ioStruct, {
		xSectorSize,
		xFileControl,
		xLock: setLock,
		xUnlock: setLock,
		xCheckReservedLock,
		xSync,
		xRead,
		xWrite,
		xClose,
		xTruncate,
		xFileSize,
		xDeviceCharacteristics,
	})

	ioPointer = ioStruct.pointer

	const opfsVfs = new structs.sqlite3_vfs()
	opfsVfs.$szOsFile = structs.sqlite3_file.structInfo.sizeof
	opfsVfs.$mxPathname = 512

	const asm = getASM()

	const pDVfs = asm.sqlite3_vfs_find(null)
	const dVfs = pDVfs ? new structs.sqlite3_vfs(pDVfs) : null
	if (dVfs) {
		opfsVfs.$xRandomness = dVfs.$xRandomness
		opfsVfs.$xSleep = dVfs.$xSleep
		dVfs.dispose()
	}

	installMethods(opfsVfs, {
		xOpen,
		xAccess,
		xDelete,
		xCurrentTime,
		xCurrentTimeInt64,
		xFullPathname,
	})

	const rc = asm.sqlite3_vfs_register(opfsVfs.pointer, 1)
	if (rc) sqliteError(rc, `vfs registration failed`)
	vfsPointer = opfsVfs.pointer
	if (!vfsPointer) return sqliteError(`no pointer`)
	return vfsPointer
}
