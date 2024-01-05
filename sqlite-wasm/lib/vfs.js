import { structs } from './base.js'
import * as SQLITE from './embedded.js'
import * as heap from './heap.js'
import { abort } from './util.js'

/** @type {unknown} */
let fsError = null

/** @type {FileSystemDirectoryHandle | null} */
let poolDh = null

const SECTOR_SIZE = 4096

const EPOCH_JULIAN_DAY = 2440587.5
const MILLSECONDS_IN_DAY = 86400000

const OPAQUE_DIR_NAME = '.vfs_pool'

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

/** @type {Map<string, FileSystemSyncAccessHandle>} */
const sahMap = new Map()

/** @type {Map<number, string>} */
const ptrMap = new Map()

/** @type {Map<string, string>} */
const vfsFileMap = new Map()

/** @type {Map<string, number>} */
const vfsFlags = new Map()

const addHandle = async () => {
	const name = randName()
	const fh = await poolDh.getFileHandle(name, { create: true })
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
	const fn = (zName && heap.peek8(zName)) ? heap.cstrToJs(zName) : randName()
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


export const initVFS = async () => {
	const ioMethods = {
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
	}

	const vfsMethods = {
		xOpen,
		xAccess,
		xDelete,
		xCurrentTime,
		xCurrentTimeInt64,
		xFullPathname,
	}
}
