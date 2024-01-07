import { getASM, sqliteError, structs } from './base.js'
import * as SQLITE from './embedded.js'
import * as heap from './heap.js'
import { NO_OP, abort } from './util.js'
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
const CREATE_TRUE = { create: true }

const EPOCH_JULIAN_DAY = 2440587.5
const MILLSECONDS_IN_DAY = 86400000

const VFS_ROOT_DIRNAME = '.sqlite_vfs'
const VFS_STATE_FILENAME = '.state'

let poolDir = VFS_ROOT_DIRNAME

/** @type {number | null} */
let capTimeout = null

/** @type {number | null} */
let stateTimeout = null

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
	const fh = await poolDh.getFileHandle(fn, CREATE_TRUE)
	const name = `${poolDir}/${fn}`
	sahMap.set(name, await fh.createSyncAccessHandle())
	freeHandles.push(name)
	return name
}

const adjustCapacity = () => {
	if (capTimeout) clearTimeout(capTimeout)
	capTimeout = setTimeout(() => {
		if (freeHandles.length < MIN_POOL_SIZE) addHandle()
		capTimeout = null
	}, 5)
}

const saveState = () => {
	if (stateTimeout) clearTimeout(stateTimeout)
	stateTimeout = setTimeout(() => {
		const state = [...vfsFileMap.entries()].flatMap(([vn, rn]) => {
			if (!rn.startsWith(VFS_ROOT_DIRNAME)) return []
			return [[rn, [vn, vfsFlags.get(vn)]]]
		})
		stateTimeout = null
		console.log('state', state)
	}, 5)
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
		if (vfsFlags.get(ptrMap.get(pFile)) & SQLITE.OPEN_DELETEONCLOSE) {
			vfsFileMap.delete(path)
			freeHandles.push(path)
		}
		saveState()
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
			adjustCapacity()
		}
		if (!realPath) abort(`file not found ${fn}`)
		ptrMap.set(pFile, fn)
		vfsFlags.set(fn, flags)
		saveState()
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
 * @param {number} nOut
 * @param {number} pOut
 */
const xGetLastError = (pVfs, nOut, pOut) => {
	const e = fsError
	fsError = null
	if (e) {
		//
	}
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
		heap.poke32(pOut, vfsFileMap.has(fn) ? 1 : 0)
		return 0
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
		const fn = heap.cstrToJs(zName)
		const file = vfsFileMap.get(fn)
		if (file) {
			sahMap.get(file).truncate(0)
			freeHandles.push(file)
			vfsFileMap.delete(fn)
			vfsFlags.delete(fn)
		}
		saveState()
		return 0
	} catch (e) {
		storeErr(e)
		return SQLITE.IOERR_DELETE
	}
}

/**
 * @param {number} pVfs
 * @param {number} nOut
 * @param {number} pOut
 */
const xRandomness = (pVfs, nOut, pOut) => {
	const hp = heap.heap8u()
	let i = 0
	for (; i < nOut; ++i) hp[pOut + i] = (Math.random() * 255000) & 0xff
	return i
}

export const openDbFile = async (fn) => {
	const fh = await rootDh.getFileHandle(fn, CREATE_TRUE)
	sahMap.set(fn, await fh.createSyncAccessHandle())
	vfsFileMap.set(fn, fn)
}

export const initVFS = async () => {
	rootDh = await globalThis?.navigator?.storage?.getDirectory()
	if (!rootDh) abort('could not open OPFS')

	try {
		poolDh = await rootDh.getDirectoryHandle(VFS_ROOT_DIRNAME)
	} catch (err) {}

	const state = new Map()

	if (poolDh) {
		for await (const hd of poolDh.values()) {
			if (hd.kind !== 'file') continue
			if (hd.name === VFS_STATE_FILENAME) {
				const stateFile = await hd.getFile()
				if (!stateFile.size) continue
				const st = JSON.parse(await stateFile.text())
				for (const [k, v] of Object.entries(st)) {
					console.log('state', k, v)
				}
				continue
			}
			const parts = await rootDh.resolve(hd)
			sahMap.set(parts.join('/'), await hd.createSyncAccessHandle())
		}
	} else {
		const checkFile = `.opfs-check-${randName()}`
		const fh = await rootDh.getFileHandle(checkFile, CREATE_TRUE)
		const sah = await fh.createSyncAccessHandle()
		const cp = sah.close()
		await cp
		await fh.remove()
		if (cp?.then) abort('sah.close() is async')
		poolDh = await rootDh.getDirectoryHandle(VFS_ROOT_DIRNAME, CREATE_TRUE)
	}

	for (const k of sahMap.keys()) {
		if (!state.has(k)) {
			freeHandles.push(k)
			continue
		}
	}

	while (freeHandles.length < MIN_POOL_SIZE) {
		await addHandle()
	}

	const opfsVfs = new structs.sqlite3_vfs()
	opfsVfs.$szOsFile = structs.sqlite3_file.structInfo.sizeof
	opfsVfs.$mxPathname = 512

	const vfsMethods = {
	}

	const wrappedVfs = Object.fromEntries(Object.entries(vfsMethods).map(([k, v]) => {
		return [k, (...args) => {
			console.log(`vfs.${k}`, args)
			return v(...args)
		}]
	}))

	installMethods(opfsVfs, {
		...wrappedVfs,
		xOpen,
		xAccess,
		xDelete,
		xCurrentTime,
		xCurrentTimeInt64,
		xFullPathname,
		xRandomness,
		xGetLastError,
		xSleep: NO_OP,
	})

	vfsPointer = opfsVfs.pointer
	if (!vfsPointer) sqliteError(`no pointer`)

	const asm = getASM()
	const rc = asm.sqlite3_vfs_register(vfsPointer, 1)
	if (rc) sqliteError(rc, `vfs registration failed`)

	const ioMethods = {
	}

	const wrappedIo = Object.fromEntries(Object.entries(ioMethods).map(([k, v]) => {
		return [k, (...args) => {
			console.log(`io.${k}`, args)
			return v(...args)
		}]
	}))

	const ioStruct = new structs.sqlite3_io_methods()
	installMethods(ioStruct, {
		...wrappedIo,
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
}

export const getVFS = () => vfsPointer ?? abort('vfs not initialized')

export const releaseHandles = () => {
	for (const h of sahMap.keys()) {
		sahMap.get(h).close()
		sahMap.delete(h)
	}
}
