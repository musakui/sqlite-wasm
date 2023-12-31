import { capi, wasm, sqliteError, cstrToJs, C_API, structs } from './base.js'
import { abort, isPtr, checkOPFS } from './util.js'
import * as heap from './heap.js'
import * as logger from './logger.js'

let thePool = null

let poolUtil = null

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

const getRandomName = () => Math.random().toString(36).slice(2)

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

const __mapVfsToPool = new Map()
const getPoolForVfs = (pVfs) => __mapVfsToPool.get(pVfs)
const setPoolForVfs = (pVfs, pool) => {
	if (pool) __mapVfsToPool.set(pVfs, pool)
	else __mapVfsToPool.delete(pVfs)
}

const __mapSqlite3File = new Map()
const getPoolForPFile = (pFile) => __mapSqlite3File.get(pFile)
const setPoolForPFile = (pFile, pool) => {
	if (pool) __mapSqlite3File.set(pFile, pool)
	else __mapSqlite3File.delete(pFile)
}

export const initPool = async (sqlite3, pool) => {
	await checkOPFS()
	thePool = new pool({})
	try {
		await thePool.isReady
		poolUtil = new OpfsSAHPoolUtil(thePool)
		if (sqlite3.oo1) {
			const oo1 = sqlite3.oo1
			const theVfs = thePool.getVfs()
			const OpfsSAHPoolDb = function (...args) {
				const opt = oo1.DB.dbCtorHelper.normalizeArgs(...args)
				opt.vfs = theVfs.$zName
				oo1.DB.dbCtorHelper.call(this, opt)
			}
			OpfsSAHPoolDb.prototype = Object.create(oo1.DB.prototype)
			poolUtil.OpfsSAHPoolDb = OpfsSAHPoolDb
			oo1.DB.dbCtorHelper.setVfsPostOpenSql(theVfs.pointer, (oo1Db) => {
				capi.sqlite3_exec(oo1Db, ['pragma journal_mode=DELETE;', 'pragma cache_size=-16384;'], 0, 0, 0)
			})
		}
	} catch (err) {
		await thePool.removeVfs()
		throw err
	}
	return poolUtil
}

const ioMethods = {
	xSectorSize: () => SECTOR_SIZE,
	xFileControl: () => C_API.SQLITE_NOTFOUND,
	xDeviceCharacteristics: () => C_API.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN,
	xCheckReservedLock: (pFile, pOut) => {
		const pool = getPoolForPFile(pFile)
		pool.log('xCheckReservedLock')
		pool.storeErr()
		wasm.poke32(pOut, 1)
		return 0
	},
	xClose: (pFile) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)
		if (file) {
			try {
				pool.log(`xClose ${file.path}`)
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
	xFileSize: (pFile, pSz64) => {
		const pool = getPoolForPFile(pFile)
		pool.log(`xFileSize`)
		const file = pool.getOFileForS3File(pFile)
		const size = file.sah.getSize() - HEADER_OFFSET_DATA
		wasm.poke64(pSz64, BigInt(size))
		return 0
	},
	xLock: (pFile, lockType) => {
		const pool = getPoolForPFile(pFile)
		pool.log(`xLock ${lockType}`)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)
		file.lockType = lockType
		return 0
	},
	xRead: (pFile, pDest, n, offset64) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)
		pool.log(`xRead ${file.path} ${n} @ ${offset64}`)
		try {
			const nRead = file.sah.read(heap.HEAP8U().subarray(pDest, pDest + n), { at: HEADER_OFFSET_DATA + Number(offset64) })
			if (nRead < n) {
				heap.HEAP8U().fill(0, pDest + nRead, pDest + n)
				return C_API.SQLITE_IOERR_SHORT_READ
			}
			return 0
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
	xSync: (pFile, flags) => {
		const pool = getPoolForPFile(pFile)
		pool.log(`xSync ${flags}`)
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
		pool.log(`xTruncate ${sz64}`)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)

		try {
			file.sah.truncate(HEADER_OFFSET_DATA + Number(sz64))
			return 0
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
	xUnlock: (pFile, lockType) => {
		const pool = getPoolForPFile(pFile)
		pool.log('xUnlock')
		const file = pool.getOFileForS3File(pFile)
		file.lockType = lockType
		return 0
	},
	xWrite: (pFile, pSrc, n, offset64) => {
		const pool = getPoolForPFile(pFile)
		pool.storeErr()
		const file = pool.getOFileForS3File(pFile)
		pool.log(`xWrite ${file.path} ${n} ${offset64}`)
		try {
			const nBytes = file.sah.write(heap.HEAP8U().subarray(pSrc, pSrc + n), { at: HEADER_OFFSET_DATA + Number(offset64) })
			return n === nBytes ? 0 : abort('Unknown write() failure.')
		} catch (e) {
			return pool.storeErr(e, C_API.SQLITE_IOERR)
		}
	},
}

export const installSAHPool = (sqlite3) => {
	const initPromises = Object.create(null)

	const optionDefaults = Object.assign(Object.create(null), {
		name: 'opfs-sahpool',
		directory: undefined,
		initialCapacity: 6,
		clearOnInit: false,
		verbosity: 2,
	})

	const struct = new structs.sqlite3_io_methods()
	sqlite3.vfs.installVfs({ io: { struct, methods: ioMethods } })

	const vfsMethods = {
		xAccess: function (pVfs, zName, flags, pOut) {
			const pool = getPoolForVfs(pVfs)
			pool.storeErr()
			try {
				const name = pool.getPath(zName)
				wasm.poke32(pOut, pool.hasFilename(name) ? 1 : 0)
			} catch (e) {
				wasm.poke32(pOut, 0)
			}
			return 0
		},
		xCurrentTime: function (pVfs, pOut) {
			wasm.poke(pOut, 2440587.5 + new Date().getTime() / 86400000, 'double')
			return 0
		},
		xCurrentTimeInt64: function (pVfs, pOut) {
			wasm.poke(pOut, 2440587.5 * 86400000 + new Date().getTime(), 'i64')
			return 0
		},
		xDelete: function (pVfs, zName, doSyncDir) {
			const pool = getPoolForVfs(pVfs)
			pool.log(`xDelete ${cstrToJs(zName)}`)
			pool.storeErr()
			try {
				pool.deletePath(pool.getPath(zName))
				return 0
			} catch (e) {
				pool.storeErr(e)
				return C_API.SQLITE_IOERR_DELETE
			}
		},
		xFullPathname: function (pVfs, zName, nOut, pOut) {
			const i = heap.cstrncpy(pOut, zName, nOut)
			return i < nOut ? 0 : C_API.SQLITE_CANTOPEN
		},
		xGetLastError: function (pVfs, nOut, pOut) {
			const pool = getPoolForVfs(pVfs)
			const e = pool.popErr()
			pool.log(`xGetLastError ${nOut} e =`, e)
			if (e) {
				const scope = heap.scopedAllocPush()
				try {
					const [cMsg, n] = heap.scopedAllocCStringWithLength(e.message)
					heap.cstrncpy(pOut, cMsg, nOut)
					if (n > nOut) wasm.poke8(pOut + nOut - 1, 0)
				} catch (e) {
					return C_API.SQLITE_NOMEM
				} finally {
					heap.scopedAllocPop(scope)
				}
			}
			return e ? e.sqlite3Rc || C_API.SQLITE_IOERR : 0
		},

		xOpen: function f(pVfs, zName, pFile, flags, pOutFlags) {
			const pool = getPoolForVfs(pVfs)
			try {
				pool.log(`xOpen ${cstrToJs(zName)} ${flags}`)

				const path = zName && wasm.peek8(zName) ? pool.getPath(zName) : getRandomName()
				let sah = pool.getSAHForPath(path)
				if (!sah && flags & C_API.SQLITE_OPEN_CREATE) {
					if (pool.getFileCount() < pool.getCapacity()) {
						sah = pool.nextAvailableSAH()
						pool.setAssociatedPath(sah, path, flags)
					} else {
						abort(`SAH pool is full. Cannot create file ${path}`)
					}
				}
				if (!sah) {
					abort(`file not found: ${path}`)
				}

				const file = { path, flags, sah }
				pool.mapS3FileToOFile(pFile, file)
				file.lockType = C_API.SQLITE_LOCK_NONE
				const sq3File = new structs.sqlite3_file(pFile)
				sq3File.$pMethods = struct.pointer
				sq3File.dispose()
				wasm.poke32(pOutFlags, flags)
				return 0
			} catch (e) {
				pool.storeErr(e)
				return C_API.SQLITE_CANTOPEN
			}
		},
	}

	const createOpfsVfs = function (vfsName) {
		if (capi.sqlite3_vfs_find(vfsName)) {
			sqliteError('VFS name is already registered:', vfsName)
		}
		const opfsVfs = new structs.sqlite3_vfs()

		const pDVfs = capi.sqlite3_vfs_find(null)
		const dVfs = pDVfs ? new structs.sqlite3_vfs(pDVfs) : null
		opfsVfs.$iVersion = 2
		opfsVfs.$szOsFile = structs.sqlite3_file.structInfo.sizeof
		opfsVfs.$mxPathname = HEADER_MAX_PATH_SIZE
		opfsVfs.addOnDispose((opfsVfs.$zName = heap.allocCString(vfsName)), () => setPoolForVfs(opfsVfs.pointer, 0))

		if (dVfs) {
			opfsVfs.$xRandomness = dVfs.$xRandomness
			opfsVfs.$xSleep = dVfs.$xSleep
			dVfs.dispose()
		}
		if (!opfsVfs.$xRandomness && !vfsMethods.xRandomness) {
			vfsMethods.xRandomness = function (pVfs, nOut, pOut) {
				const heap = heap.HEAP8U()
				let i = 0
				for (; i < nOut; ++i) heap[pOut + i] = (Math.random() * 255000) & 0xff
				return i
			}
		}
		if (!opfsVfs.$xSleep && !vfsMethods.xSleep) {
			vfsMethods.xSleep = (pVfs, ms) => 0
		}
		sqlite3.vfs.installVfs({
			vfs: { struct: opfsVfs, methods: vfsMethods },
		})
		return opfsVfs
	}

	class OpfsSAHPool {
		vfsDir

		#dhVfsRoot

		#dhOpaque

		#dhVfsParent

		#mapSAHToName = new Map()

		#mapFilenameToSAH = new Map()

		#availableSAH = new Set()

		#mapS3FileToOFile_ = new Map()

		#apBody = new Uint8Array(HEADER_CORPUS_SIZE)

		#dvBody

		#cVfs

		constructor(options = Object.create(null)) {
			this.vfsName = options.name || optionDefaults.name
			this.#cVfs = createOpfsVfs(this.vfsName)
			setPoolForVfs(this.#cVfs.pointer, this)
			this.vfsDir = options.directory || '.' + this.vfsName
			this.#dvBody = new DataView(this.#apBody.buffer, this.#apBody.byteOffset)
			this.isReady = this.reset(!!(options.clearOnInit ?? optionDefaults.clearOnInit)).then(() => {
				if (this.$error) throw this.$error
				return this.getCapacity() ? Promise.resolve(undefined) : this.addCapacity(options.initialCapacity || optionDefaults.initialCapacity)
			})
		}

		log(...args) {}

		getVfs() {
			return this.#cVfs
		}

		getCapacity() {
			return this.#mapSAHToName.size
		}

		getFileCount() {
			return this.#mapFilenameToSAH.size
		}

		getFileNames() {
			const rc = []
			const iter = this.#mapFilenameToSAH.keys()
			for (const n of iter) rc.push(n)
			return rc
		}

		async addCapacity(n) {
			for (let i = 0; i < n; ++i) {
				const name = getRandomName()
				const h = await this.#dhOpaque.getFileHandle(name, {
					create: true,
				})
				const ah = await h.createSyncAccessHandle()
				this.#mapSAHToName.set(ah, name)
				this.setAssociatedPath(ah, '', 0)
			}
			return this.getCapacity()
		}

		async reduceCapacity(n) {
			let nRm = 0
			for (const ah of Array.from(this.#availableSAH)) {
				if (nRm === n || this.getFileCount() === this.getCapacity()) {
					break
				}
				const name = this.#mapSAHToName.get(ah)

				ah.close()
				await this.#dhOpaque.removeEntry(name)
				this.#mapSAHToName.delete(ah)
				this.#availableSAH.delete(ah)
				++nRm
			}
			return nRm
		}

		releaseAccessHandles() {
			for (const ah of this.#mapSAHToName.keys()) ah.close()
			this.#mapSAHToName.clear()
			this.#mapFilenameToSAH.clear()
			this.#availableSAH.clear()
		}

		async acquireAccessHandles(clearFiles) {
			const files = []
			for await (const [name, h] of this.#dhOpaque) {
				if ('file' === h.kind) {
					files.push([name, h])
				}
			}
			return Promise.all(
				files.map(async ([name, h]) => {
					try {
						const ah = await h.createSyncAccessHandle()
						this.#mapSAHToName.set(ah, name)
						if (clearFiles) {
							ah.truncate(HEADER_OFFSET_DATA)
							this.setAssociatedPath(ah, '', 0)
						} else {
							const path = this.getAssociatedPath(ah)
							if (path) {
								this.#mapFilenameToSAH.set(path, ah)
							} else {
								this.#availableSAH.add(ah)
							}
						}
					} catch (e) {
						this.storeErr(e)
						this.releaseAccessHandles()
						throw e
					}
				})
			)
		}

		getAssociatedPath(sah) {
			sah.read(this.#apBody, { at: 0 })

			const flags = this.#dvBody.getUint32(HEADER_OFFSET_FLAGS)
			if (this.#apBody[0] && (flags & C_API.SQLITE_OPEN_DELETEONCLOSE || (flags & PERSISTENT_FILE_TYPES) === 0)) {
				logger.warn(`Removing file with unexpected flags ${flags.toString(16)}`, this.#apBody)
				this.setAssociatedPath(sah, '', 0)
				return ''
			}

			const fileDigest = new Uint32Array(HEADER_DIGEST_SIZE / 4)
			sah.read(fileDigest, { at: HEADER_OFFSET_DIGEST })
			const compDigest = this.computeDigest(this.#apBody)
			if (fileDigest.every((v, i) => v === compDigest[i])) {
				const pathBytes = this.#apBody.findIndex((v) => 0 === v)
				if (0 === pathBytes) {
					sah.truncate(HEADER_OFFSET_DATA)
				}
				return pathBytes ? textDecoder.decode(this.#apBody.subarray(0, pathBytes)) : ''
			} else {
				logger.warn('Disassociating file with bad digest.')
				this.setAssociatedPath(sah, '', 0)
				return ''
			}
		}

		setAssociatedPath(sah, path, flags) {
			const enc = textEncoder.encodeInto(path, this.#apBody)
			if (HEADER_MAX_PATH_SIZE <= enc.written + 1) {
				abort(`Path too long ${path}`)
			}
			this.#apBody.fill(0, enc.written, HEADER_MAX_PATH_SIZE)
			this.#dvBody.setUint32(HEADER_OFFSET_FLAGS, flags)

			const digest = this.computeDigest(this.#apBody)
			sah.write(this.#apBody, { at: 0 })
			sah.write(digest, { at: HEADER_OFFSET_DIGEST })
			sah.flush()

			if (path) {
				this.#mapFilenameToSAH.set(path, sah)
				this.#availableSAH.delete(sah)
			} else {
				sah.truncate(HEADER_OFFSET_DATA)
				this.#availableSAH.add(sah)
			}
		}

		computeDigest(byteArray) {
			let h1 = 0xdeadbeef
			let h2 = 0x41c6ce57
			for (const v of byteArray) {
				h1 = 31 * h1 + v * 307
				h2 = 31 * h2 + v * 307
			}
			return new Uint32Array([h1 >>> 0, h2 >>> 0])
		}

		async reset(clearFiles) {
			await this.isReady
			let h = await navigator.storage.getDirectory()
			let prev, prevName
			for (const d of this.vfsDir.split('/')) {
				if (d) {
					prev = h
					h = await h.getDirectoryHandle(d, { create: true })
				}
			}
			this.#dhVfsRoot = h
			this.#dhVfsParent = prev
			this.#dhOpaque = await this.#dhVfsRoot.getDirectoryHandle(OPAQUE_DIR_NAME, { create: true })
			this.releaseAccessHandles()
			return this.acquireAccessHandles(clearFiles)
		}

		getPath(arg) {
			if (isPtr(arg)) arg = cstrToJs(arg)
			return (arg instanceof URL ? arg : new URL(arg, 'file://localhost/')).pathname
		}

		deletePath(path) {
			const sah = this.#mapFilenameToSAH.get(path)
			if (sah) {
				this.#mapFilenameToSAH.delete(path)
				this.setAssociatedPath(sah, '', 0)
			}
			return !!sah
		}

		storeErr(e, code) {
			if (e) {
				e.sqlite3Rc = code || C_API.SQLITE_IOERR
				console.error(e)
			}
			this.$error = e
			return code
		}

		popErr() {
			const rc = this.$error
			this.$error = undefined
			return rc
		}

		nextAvailableSAH() {
			const [rc] = this.#availableSAH.keys()
			return rc
		}

		getOFileForS3File(pFile) {
			return this.#mapS3FileToOFile_.get(pFile)
		}

		mapS3FileToOFile(pFile, file) {
			if (file) {
				this.#mapS3FileToOFile_.set(pFile, file)
				setPoolForPFile(pFile, this)
			} else {
				this.#mapS3FileToOFile_.delete(pFile)
				setPoolForPFile(pFile, false)
			}
		}

		hasFilename(name) {
			return this.#mapFilenameToSAH.has(name)
		}

		getSAHForPath(path) {
			return this.#mapFilenameToSAH.get(path)
		}

		async removeVfs() {
			if (!this.#cVfs.pointer || !this.#dhOpaque) return false
			capi.sqlite3_vfs_unregister(this.#cVfs.pointer)
			this.#cVfs.dispose()
			try {
				this.releaseAccessHandles()
				await this.#dhVfsRoot.removeEntry(OPAQUE_DIR_NAME, {
					recursive: true,
				})
				this.#dhOpaque = undefined
				await this.#dhVfsParent.removeEntry(this.#dhVfsRoot.name, {
					recursive: true,
				})
				this.#dhVfsRoot = this.#dhVfsParent = undefined
			} catch (e) {
				logger.error(this.vfsName, 'removeVfs() failed:', e)
			}
			return true
		}

		exportFile(name) {
			const sah = this.#mapFilenameToSAH.get(name) || abort(`File not found: ${name}`)
			const n = sah.getSize() - HEADER_OFFSET_DATA
			const b = new Uint8Array(n > 0 ? n : 0)
			if (n > 0) {
				const nRead = sah.read(b, { at: HEADER_OFFSET_DATA })
				if (nRead != n) {
					abort(`Expected to read ${n} bytes but read ${nRead}`)
				}
			}
			return b
		}

		async importDbChunked(name, callback) {
			const sah = this.#mapFilenameToSAH.get(name) || this.nextAvailableSAH() || abort('No available handles to import to')
			sah.truncate(0)
			let nWrote = 0,
				chunk,
				checkedHeader = false,
				err = false
			try {
				while (undefined !== (chunk = await callback())) {
					if (chunk instanceof ArrayBuffer) chunk = new Uint8Array(chunk)
					if (0 === nWrote && chunk.byteLength >= 15) {
						//util.affirmDbHeader(chunk)
						//checkedHeader = true
					}
					sah.write(chunk, { at: HEADER_OFFSET_DATA + nWrote })
					nWrote += chunk.byteLength
				}
				if (nWrote < 512 || 0 !== nWrote % 512) {
					abort(`Input size ${nWrote} is not correct for an SQLite database`)
				}
				if (!checkedHeader) {
					const header = new Uint8Array(20)
					sah.read(header, { at: 0 })
					//util.affirmDbHeader(header)
				}
				sah.write(new Uint8Array([1, 1]), {
					at: HEADER_OFFSET_DATA + 18,
				})
			} catch (e) {
				this.setAssociatedPath(sah, '', 0)
				throw e
			}
			this.setAssociatedPath(sah, name, C_API.SQLITE_OPEN_MAIN_DB)
			return nWrote
		}

		importDb(name, bytes) {
			if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
			else if (bytes instanceof Function) return this.importDbChunked(name, bytes)
			const sah = this.#mapFilenameToSAH.get(name) || this.nextAvailableSAH() || abort('No available handles to import to.')
			const n = bytes.byteLength
			if (n < 512 || n % 512 != 0) {
				abort('Byte array size is invalid for an SQLite db')
			}
			const header = 'SQLite format 3'
			for (let i = 0; i < header.length; ++i) {
				if (header.charCodeAt(i) !== bytes[i]) {
					abort('Input does not contain an SQLite database header')
				}
			}
			const nWrote = sah.write(bytes, { at: HEADER_OFFSET_DATA })
			if (nWrote != n) {
				this.setAssociatedPath(sah, '', 0)
				abort(`Expected to write ${n} bytes but wrote ${nWrote}`)
			} else {
				sah.write(new Uint8Array([1, 1]), {
					at: HEADER_OFFSET_DATA + 18,
				})
				this.setAssociatedPath(sah, name, C_API.SQLITE_OPEN_MAIN_DB)
			}
			return nWrote
		}
	}

	sqlite3.installOpfsSAHPoolVfs = async function (options = Object.create(null)) {
		const vfsName = options.name || optionDefaults.name
		if (initPromises[vfsName]) return initPromises[vfsName]
		return (initPromises[vfsName] = initPool(sqlite3, OpfsSAHPool))
	}
}

class OpfsSAHPoolUtil {
	#p

	constructor(sahPool) {
		this.#p = sahPool
		this.vfsName = sahPool.vfsName
	}

	async addCapacity(n) {
		return this.#p.addCapacity(n)
	}

	async reduceCapacity(n) {
		return this.#p.reduceCapacity(n)
	}

	getCapacity() {
		return this.#p.getCapacity(this.#p)
	}

	getFileCount() {
		return this.#p.getFileCount()
	}
	getFileNames() {
		return this.#p.getFileNames()
	}

	async reserveMinimumCapacity(min) {
		const c = this.#p.getCapacity()
		return c < min ? this.#p.addCapacity(min - c) : c
	}

	exportFile(name) {
		return this.#p.exportFile(name)
	}

	importDb(name, bytes) {
		return this.#p.importDb(name, bytes)
	}

	async wipeFiles() {
		return this.#p.reset(true)
	}

	unlink(filename) {
		return this.#p.deletePath(filename)
	}

	async removeVfs() {
		return this.#p.removeVfs()
	}
}
