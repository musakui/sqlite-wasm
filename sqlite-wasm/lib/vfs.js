import { C_API, structs } from './base.js'
import * as heap from './heap.js'

const SECTOR_SIZE = 4096
const HEADER_MAX_PATH_SIZE = 512
const HEADER_FLAGS_SIZE = 4
const HEADER_DIGEST_SIZE = 8
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
const HEADER_OFFSET_FLAGS = HEADER_MAX_PATH_SIZE
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE
const HEADER_OFFSET_DATA = SECTOR_SIZE

const PERSISTENT_FILE_TYPES = C_API.SQLITE_OPEN_MAIN_DB | C_API.SQLITE_OPEN_MAIN_JOURNAL | C_API.SQLITE_OPEN_SUPER_JOURNAL | C_API.SQLITE_OPEN_WAL

const OPAQUE_DIR_NAME = '.opaque'

/** @type {Map<number, number>} */
const lockTypeMap = new Map()

/**
 * @param {number} pFile
 * @param {number} lockType
 */
const setLock = (pFile, lockType) => {
	lockTypeMap.set(pFile, lockType)
	return 0
}

/** @type {Map<number, pool>} */
const fileMap = new Map()

const ioMethods = {
	xSectorSize: () => SECTOR_SIZE,
	xFileControl: () => C_API.SQLITE_NOTFOUND,
	xDeviceCharacteristics: () => C_API.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN,
	xLock: setLock,
	xUnlock: setLock,
	/**
	 * @param {number} pFile
	 * @param {number} pOut
	 */
	xCheckReservedLock: (pFile, pOut) => {
		const pool = getPoolForPFile(pFile)
		heap.poke32(pOut, 1)
		return 0
	},
	/**
	 * @param {number} pFile
	 */
	xClose: (pFile) => {
		const pool = getPoolForPFile(pFile)
		const file = pool.getOFileForS3File(pFile)
		if (file) {
			try {
				pool.mapS3FileToOFile(pFile, false)
				file.sah.flush()
				if (file.flags & C_API.SQLITE_OPEN_DELETEONCLOSE) {
					pool.deletePath(file.path)
				}
			} catch (e) {
				return pool.storeErr(e, C_API.SQLITE_IOERR)
			}
		}
		return 0
	},
	/**
	 * @param {number} pFile
	 * @param {number} pSz64
	 */
	xFileSize: (pFile, pSz64) => {
		const pool = getPoolForPFile(pFile)
		const file = pool.getOFileForS3File(pFile)
		const size = file.sah.getSize() - HEADER_OFFSET_DATA
		heap.poke64(pSz64, BigInt(size))
		return 0
	},
	xRead: (pFile, pDest, n, offset64) => {
		const pool = getPoolForPFile(pFile)
		const file = pool.getOFileForS3File(pFile)
		try {
			const op = { at: HEADER_OFFSET_DATA + Number(offset64) }
			const nRead = file.sah.read(heap.heap8u().subarray(pDest, pDest + n), op)
			if (nRead < n) {
				heap.heap8u().fill(0, pDest + nRead, pDest + n)
				return C_API.SQLITE_IOERR_SHORT_READ
			}
			return 0
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
	/**
	 * @param {number} pFile
	 * @param {number} _flags
	 */
	xSync: (pFile, _flags) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)

		try {
			file.sah.flush()
			return 0
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
	xTruncate: (pFile, sz64) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)

		try {
			file.sah.truncate(HEADER_OFFSET_DATA + Number(sz64))
			return 0
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
	/**
	 * @param {number} pFile
	 * @param {number} pSrc
	 * @param {number} n
	 * @param {number} offset64
	 */
	xWrite: (pFile, pSrc, n, offset64) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)
		try {
			const op = { at: HEADER_OFFSET_DATA + Number(offset64) }
			const nBytes = file.sah.write(heap.heap8u().subarray(pSrc, pSrc + n), op)
			return n === nBytes ? 0 : abort('Unknown write() failure.')
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
}
