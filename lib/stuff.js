import { FS } from './fsOri.js'
import * as PATH from './path.js'
import { lengthBytesUTF8, stringToUTF8Array } from './string.js'
import { installOpfsVfs } from './opfsVFS.js'
import { installStruct } from './struct.js'
import { installWhWasm } from './whWasm.js'
import { installOO1 } from './oo1.js'

/** @type {WebAssembly.Exports} */
let asm

const DECODER = new TextDecoder('utf8')

let HEAP8, HEAPU8, HEAP16, HEAP32, HEAPU32

const wasmMemory = new WebAssembly.Memory({
	initial: 16777216 / 65536,
	maximum: 2147483648 / 65536,
})

export const updateMemoryViews = () => {
	const b = wasmMemory.buffer
	HEAP8 = new Int8Array(b)
	HEAP16 = new Int16Array(b)
	HEAP32 = new Int32Array(b)
	HEAPU8 = new Uint8Array(b)
	HEAPU32 = new Uint32Array(b)
}

const isInt32 = (n) => {
	return 'bigint' !== typeof n && !!(n === (n | 0) && n <= 2147483647 && n >= -2147483648)
}

const bigIntFits64 = function f(b) {
	if (!f._max) {
		f._max = BigInt('0x7fffffffffffffff')
		f._min = ~f._max
	}
	return b >= f._min && b <= f._max
}

const bigIntFits32 = (b) => b >= -0x7fffffffn - 1n && b <= 0x7fffffffn

const bigIntFitsDouble = function f(b) {
	if (!f._min) {
		f._min = Number.MIN_SAFE_INTEGER
		f._max = Number.MAX_SAFE_INTEGER
	}
	return b >= f._min && b <= f._max
}

const isTypedArray = (v) => {
	return v && v.constructor && isInt32(v.constructor.BYTES_PER_ELEMENT) ? v : false
}

const isSharedTypedArray = (aTypedArray) => aTypedArray.buffer instanceof SharedArrayBuffer

const typedArrayPart = (aTypedArray, begin, end) => {
	return isSharedTypedArray(aTypedArray) ? aTypedArray.slice(begin, end) : aTypedArray.subarray(begin, end)
}

const isBindableTypedArray = (v) => {
	return v && (v instanceof Uint8Array || v instanceof Int8Array || v instanceof ArrayBuffer)
}

const isSQLableTypedArray = (v) => {
	return v && (v instanceof Uint8Array || v instanceof Int8Array || v instanceof ArrayBuffer)
}

const typedArrayToString = function (typedArray, begin, end) {
	return DECODER.decode(typedArrayPart(typedArray, begin, end))
}

function UTF8ToString(ptr, maxBytesToRead) {
	return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : ''
}

function stringToUTF8(str, outPtr, maxBytesToWrite) {
	return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite)
}

function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
	let endIdx = idx + maxBytesToRead
	let endPtr = idx

	while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr

	if (endPtr - idx > 16 && heapOrArray.buffer && DECODER) {
		return DECODER.decode(heapOrArray.subarray(idx, endPtr))
	}
	let str = ''

	while (idx < endPtr) {
		let u0 = heapOrArray[idx++]
		if (!(u0 & 0x80)) {
			str += String.fromCharCode(u0)
			continue
		}
		let u1 = heapOrArray[idx++] & 63
		if ((u0 & 0xe0) == 0xc0) {
			str += String.fromCharCode(((u0 & 31) << 6) | u1)
			continue
		}
		let u2 = heapOrArray[idx++] & 63
		if ((u0 & 0xf0) == 0xe0) {
			u0 = ((u0 & 15) << 12) | (u1 << 6) | u2
		} else {
			u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63)
		}

		if (u0 < 0x10000) {
			str += String.fromCharCode(u0)
		} else {
			let ch = u0 - 0x10000
			str += String.fromCharCode(0xd800 | (ch >> 10), 0xdc00 | (ch & 0x3ff))
		}
	}
	return str
}

const SYSCALLS = {
	DEFAULT_POLLMASK: 5,
	calculateAt: function (dirfd, path, allowEmpty) {
		if (PATH.isAbs(path)) {
			return path
		}

		var dir
		if (dirfd === -100) {
			dir = FS.cwd()
		} else {
			var dirstream = SYSCALLS.getStreamFromFD(dirfd)
			dir = dirstream.path
		}
		if (path.length == 0) {
			if (!allowEmpty) {
				throw new FS.ErrnoError(44)
			}
			return dir
		}
		return PATH.join2(dir, path)
	},
	doStat: function (func, path, buf) {
		try {
			var stat = func(path)
		} catch (e) {
			if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
				return -54
			}
			throw e
		}
		HEAP32[buf >> 2] = stat.dev
		HEAP32[(buf + 8) >> 2] = stat.ino
		HEAP32[(buf + 12) >> 2] = stat.mode
		HEAPU32[(buf + 16) >> 2] = stat.nlink
		HEAP32[(buf + 20) >> 2] = stat.uid
		HEAP32[(buf + 24) >> 2] = stat.gid
		HEAP32[(buf + 28) >> 2] = stat.rdev
		;(tempI64 = [
			stat.size >>> 0,
			((tempDouble = stat.size),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[(buf + 40) >> 2] = tempI64[0]),
			(HEAP32[(buf + 44) >> 2] = tempI64[1])
		HEAP32[(buf + 48) >> 2] = 4096
		HEAP32[(buf + 52) >> 2] = stat.blocks
		var atime = stat.atime.getTime()
		var mtime = stat.mtime.getTime()
		var ctime = stat.ctime.getTime()
		;(tempI64 = [
			Math.floor(atime / 1000) >>> 0,
			((tempDouble = Math.floor(atime / 1000)),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[(buf + 56) >> 2] = tempI64[0]),
			(HEAP32[(buf + 60) >> 2] = tempI64[1])
		HEAPU32[(buf + 64) >> 2] = (atime % 1000) * 1000
		;(tempI64 = [
			Math.floor(mtime / 1000) >>> 0,
			((tempDouble = Math.floor(mtime / 1000)),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[(buf + 72) >> 2] = tempI64[0]),
			(HEAP32[(buf + 76) >> 2] = tempI64[1])
		HEAPU32[(buf + 80) >> 2] = (mtime % 1000) * 1000
		;(tempI64 = [
			Math.floor(ctime / 1000) >>> 0,
			((tempDouble = Math.floor(ctime / 1000)),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[(buf + 88) >> 2] = tempI64[0]),
			(HEAP32[(buf + 92) >> 2] = tempI64[1])
		HEAPU32[(buf + 96) >> 2] = (ctime % 1000) * 1000
		;(tempI64 = [
			stat.ino >>> 0,
			((tempDouble = stat.ino),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[(buf + 104) >> 2] = tempI64[0]),
			(HEAP32[(buf + 108) >> 2] = tempI64[1])
		return 0
	},
	doMsync: function (addr, stream, len, flags, offset) {
		if (!FS.isFile(stream.node.mode)) {
			throw new FS.ErrnoError(43)
		}
		if (flags & 2) {
			return 0
		}
		var buffer = HEAPU8.slice(addr, addr + len)
		FS.msync(stream, buffer, offset, len, flags)
	},
	varargs: undefined,
	get: function () {
		SYSCALLS.varargs += 4
		var ret = HEAP32[(SYSCALLS.varargs - 4) >> 2]
		return ret
	},
	getStr: function (ptr) {
		var ret = UTF8ToString(ptr)
		return ret
	},
	getStreamFromFD: function (fd) {
		var stream = FS.getStream(fd)
		if (!stream) throw new FS.ErrnoError(8)
		return stream
	},
}

let tempDouble
let tempI64

function ___syscall_chmod(path, mode) {
	try {
		path = SYSCALLS.getStr(path)
		FS.chmod(path, mode)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_faccessat(dirfd, path, amode, flags) {
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path)
		if (amode & ~7) {
			return -28
		}
		var lookup = FS.lookupPath(path, { follow: true })
		var node = lookup.node
		if (!node) {
			return -44
		}
		var perms = ''
		if (amode & 4) perms += 'r'
		if (amode & 2) perms += 'w'
		if (amode & 1) perms += 'x'
		if (perms && FS.nodePermissions(node, perms)) {
			return -2
		}
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_fchmod(fd, mode) {
	try {
		FS.fchmod(fd, mode)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_fchown32(fd, owner, group) {
	try {
		FS.fchown(fd, owner, group)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function setErrNo(value) {
	HEAP32[asm.___errno_location() >> 2] = value
	return value
}

function ___syscall_fcntl64(fd, cmd, varargs) {
	SYSCALLS.varargs = varargs
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		switch (cmd) {
			case 0: {
				var arg = SYSCALLS.get()
				if (arg < 0) {
					return -28
				}
				var newStream
				newStream = FS.createStream(stream, arg)
				return newStream.fd
			}
			case 1:
			case 2:
				return 0
			case 3:
				return stream.flags
			case 4: {
				var arg = SYSCALLS.get()
				stream.flags |= arg
				return 0
			}
			case 5: {
				var arg = SYSCALLS.get()
				var offset = 0

				HEAP16[(arg + offset) >> 1] = 2
				return 0
			}
			case 6:
			case 7:
				return 0
			case 16:
			case 8:
				return -28
			case 9:
				setErrNo(28)
				return -1
			default: {
				return -28
			}
		}
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_fstat64(fd, buf) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		return SYSCALLS.doStat(FS.stat, stream.path, buf)
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

var MAX_INT53 = 9007199254740992

var MIN_INT53 = -9007199254740992
function bigintToI53Checked(num) {
	return num < MIN_INT53 || num > MAX_INT53 ? NaN : Number(num)
}

function ___syscall_ftruncate64(fd, length) {
	try {
		length = bigintToI53Checked(length)
		if (isNaN(length)) return -61
		FS.ftruncate(fd, length)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_getcwd(buf, size) {
	try {
		if (size === 0) return -28
		var cwd = FS.cwd()
		var cwdLengthInBytes = lengthBytesUTF8(cwd) + 1
		if (size < cwdLengthInBytes) return -68
		stringToUTF8(cwd, buf, size)
		return cwdLengthInBytes
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_ioctl(fd, op, varargs) {
	SYSCALLS.varargs = varargs
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		switch (op) {
			case 21509:
			case 21505: {
				if (!stream.tty) return -59
				return 0
			}
			case 21510:
			case 21511:
			case 21512:
			case 21506:
			case 21507:
			case 21508: {
				if (!stream.tty) return -59
				return 0
			}
			case 21519: {
				if (!stream.tty) return -59
				var argp = SYSCALLS.get()
				HEAP32[argp >> 2] = 0
				return 0
			}
			case 21520: {
				if (!stream.tty) return -59
				return -28
			}
			case 21531: {
				var argp = SYSCALLS.get()
				return FS.ioctl(stream, op, argp)
			}
			case 21523: {
				if (!stream.tty) return -59
				return 0
			}
			case 21524: {
				if (!stream.tty) return -59
				return 0
			}
			default:
				return -28
		}
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_lstat64(path, buf) {
	try {
		path = SYSCALLS.getStr(path)
		return SYSCALLS.doStat(FS.lstat, path, buf)
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_mkdirat(dirfd, path, mode) {
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path)

		path = PATH.normalize(path)
		if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1)
		FS.mkdir(path, mode, 0)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_newfstatat(dirfd, path, buf, flags) {
	try {
		path = SYSCALLS.getStr(path)
		var nofollow = flags & 256
		var allowEmpty = flags & 4096
		flags = flags & ~6400
		path = SYSCALLS.calculateAt(dirfd, path, allowEmpty)
		return SYSCALLS.doStat(nofollow ? FS.lstat : FS.stat, path, buf)
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_openat(dirfd, path, flags, varargs) {
	SYSCALLS.varargs = varargs
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path)
		var mode = varargs ? SYSCALLS.get() : 0
		return FS.open(path, flags, mode).fd
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_readlinkat(dirfd, path, buf, bufsize) {
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path)
		if (bufsize <= 0) return -28
		var ret = FS.readlink(path)

		var len = Math.min(bufsize, lengthBytesUTF8(ret))
		var endChar = HEAP8[buf + len]
		stringToUTF8(ret, buf, bufsize + 1)

		HEAP8[buf + len] = endChar
		return len
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_rmdir(path) {
	try {
		path = SYSCALLS.getStr(path)
		FS.rmdir(path)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_stat64(path, buf) {
	try {
		path = SYSCALLS.getStr(path)
		return SYSCALLS.doStat(FS.stat, path, buf)
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function ___syscall_unlinkat(dirfd, path, flags) {
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path)
		if (flags === 0) {
			FS.unlink(path)
		} else if (flags === 512) {
			FS.rmdir(path)
		} else {
			throw new WebAssembly.RuntimeError('invalid flags')
		}
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function readI53FromI64(ptr) {
	return HEAPU32[ptr >> 2] + HEAP32[(ptr + 4) >> 2] * 4294967296
}

function ___syscall_utimensat(dirfd, path, times, flags) {
	try {
		path = SYSCALLS.getStr(path)
		path = SYSCALLS.calculateAt(dirfd, path, true)
		if (!times) {
			var atime = Date.now()
			var mtime = atime
		} else {
			var seconds = readI53FromI64(times)
			var nanoseconds = HEAP32[(times + 8) >> 2]
			atime = seconds * 1000 + nanoseconds / (1000 * 1000)
			times += 16
			seconds = readI53FromI64(times)
			nanoseconds = HEAP32[(times + 8) >> 2]
			mtime = seconds * 1000 + nanoseconds / (1000 * 1000)
		}
		FS.utime(path, atime, mtime)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

var nowIsMonotonic = true
function __emscripten_get_now_is_monotonic() {
	return nowIsMonotonic
}

function __isLeapYear(year) {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

var __MONTH_DAYS_LEAP_CUMULATIVE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

var __MONTH_DAYS_REGULAR_CUMULATIVE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
function __yday_from_date(date) {
	var isLeapYear = __isLeapYear(date.getFullYear())
	var monthDaysCumulative = isLeapYear ? __MONTH_DAYS_LEAP_CUMULATIVE : __MONTH_DAYS_REGULAR_CUMULATIVE
	var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1

	return yday
}
function __localtime_js(time, tmPtr) {
	var date = new Date(readI53FromI64(time) * 1000)
	HEAP32[tmPtr >> 2] = date.getSeconds()
	HEAP32[(tmPtr + 4) >> 2] = date.getMinutes()
	HEAP32[(tmPtr + 8) >> 2] = date.getHours()
	HEAP32[(tmPtr + 12) >> 2] = date.getDate()
	HEAP32[(tmPtr + 16) >> 2] = date.getMonth()
	HEAP32[(tmPtr + 20) >> 2] = date.getFullYear() - 1900
	HEAP32[(tmPtr + 24) >> 2] = date.getDay()

	var yday = __yday_from_date(date) | 0
	HEAP32[(tmPtr + 28) >> 2] = yday
	HEAP32[(tmPtr + 36) >> 2] = -(date.getTimezoneOffset() * 60)

	var start = new Date(date.getFullYear(), 0, 1)
	var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
	var winterOffset = start.getTimezoneOffset()
	var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset)) | 0
	HEAP32[(tmPtr + 32) >> 2] = dst
}

function __mmap_js(len, prot, flags, fd, off, allocated, addr) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		var res = FS.mmap(stream, len, off, prot, flags)
		var ptr = res.ptr
		HEAP32[allocated >> 2] = res.allocated
		HEAPU32[addr >> 2] = ptr
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function __munmap_js(addr, len, prot, flags, fd, offset) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		if (prot & 2) {
			SYSCALLS.doMsync(addr, stream, len, flags, offset)
		}
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return -e.errno
	}
}

function allocateUTF8(str) {
	const size = lengthBytesUTF8(str) + 1
	const ret = asm.malloc(size)
	if (ret) stringToUTF8Array(str, HEAP8, ret, size)
	return ret
}

function __tzset_js(timezone, daylight, tzname) {
	var currentYear = new Date().getFullYear()
	var winter = new Date(currentYear, 0, 1)
	var summer = new Date(currentYear, 6, 1)
	var winterOffset = winter.getTimezoneOffset()
	var summerOffset = summer.getTimezoneOffset()

	var stdTimezoneOffset = Math.max(winterOffset, summerOffset)

	HEAPU32[timezone >> 2] = stdTimezoneOffset * 60

	HEAP32[daylight >> 2] = Number(winterOffset != summerOffset)

	function extractZone(date) {
		var match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/)
		return match ? match[1] : 'GMT'
	}
	var winterName = extractZone(winter)
	var summerName = extractZone(summer)
	var winterNamePtr = allocateUTF8(winterName)
	var summerNamePtr = allocateUTF8(summerName)
	if (summerOffset < winterOffset) {
		HEAPU32[tzname >> 2] = winterNamePtr
		HEAPU32[(tzname + 4) >> 2] = summerNamePtr
	} else {
		HEAPU32[tzname >> 2] = summerNamePtr
		HEAPU32[(tzname + 4) >> 2] = winterNamePtr
	}
}

function _emscripten_date_now() {
	return Date.now()
}

var _emscripten_get_now
_emscripten_get_now = () => performance.now()
function getHeapMax() {
	return 2147483648
}

function emscripten_realloc_buffer(size) {
	var b = wasmMemory.buffer
	try {
		wasmMemory.grow((size - b.byteLength + 65535) >>> 16)
		updateMemoryViews()
		return 1
	} catch (e) {}
}
function _emscripten_resize_heap(requestedSize) {
	var oldSize = HEAPU8.length
	requestedSize = requestedSize >>> 0

	var maxHeapSize = getHeapMax()
	if (requestedSize > maxHeapSize) {
		return false
	}

	let alignUp = (x, multiple) => x + ((multiple - (x % multiple)) % multiple)

	for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
		var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown)

		overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296)

		var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536))

		var replacement = emscripten_realloc_buffer(newSize)
		if (replacement) {
			return true
		}
	}
	return false
}

const ENV = {}

function getEnvStrings() {
	if (!getEnvStrings.strings) {
		var lang = ((typeof navigator == 'object' && navigator.languages && navigator.languages[0]) || 'C').replace('-', '_') + '.UTF-8'
		var env = {
			USER: 'web_user',
			LOGNAME: 'web_user',
			PATH: '/',
			PWD: '/',
			HOME: '/home/web_user',
			LANG: lang,
			_: './this.program',
		}

		for (var x in ENV) {
			if (ENV[x] === undefined) delete env[x]
			else env[x] = ENV[x]
		}
		var strings = []
		for (var x in env) {
			strings.push(x + '=' + env[x])
		}
		getEnvStrings.strings = strings
	}
	return getEnvStrings.strings
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
	for (var i = 0; i < str.length; ++i) {
		HEAP8[buffer++ >> 0] = str.charCodeAt(i)
	}

	if (!dontAddNull) HEAP8[buffer >> 0] = 0
}

function _environ_get(__environ, environ_buf) {
	var bufSize = 0
	getEnvStrings().forEach(function (string, i) {
		var ptr = environ_buf + bufSize
		HEAPU32[(__environ + i * 4) >> 2] = ptr
		writeAsciiToMemory(string, ptr)
		bufSize += string.length + 1
	})
	return 0
}

function _environ_sizes_get(penviron_count, penviron_buf_size) {
	var strings = getEnvStrings()
	HEAPU32[penviron_count >> 2] = strings.length
	var bufSize = 0
	strings.forEach(function (string) {
		bufSize += string.length + 1
	})
	HEAPU32[penviron_buf_size >> 2] = bufSize
	return 0
}

function _fd_close(fd) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		FS.close(stream)
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

function _fd_fdstat_get(fd, pbuf) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)

		var type = stream.tty ? 2 : FS.isDir(stream.mode) ? 3 : FS.isLink(stream.mode) ? 7 : 4
		HEAP8[pbuf >> 0] = type

		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

function doReadv(stream, iov, iovcnt, offset) {
	var ret = 0
	for (var i = 0; i < iovcnt; i++) {
		var ptr = HEAPU32[iov >> 2]
		var len = HEAPU32[(iov + 4) >> 2]
		iov += 8
		var curr = FS.read(stream, HEAP8, ptr, len, offset)
		if (curr < 0) return -1
		ret += curr
		if (curr < len) break
		if (typeof offset !== 'undefined') {
			offset += curr
		}
	}
	return ret
}

function _fd_read(fd, iov, iovcnt, pnum) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		var num = doReadv(stream, iov, iovcnt)
		HEAPU32[pnum >> 2] = num
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

function _fd_seek(fd, offset, whence, newOffset) {
	try {
		offset = bigintToI53Checked(offset)
		if (isNaN(offset)) return 61
		var stream = SYSCALLS.getStreamFromFD(fd)
		FS.llseek(stream, offset, whence)
		;(tempI64 = [
			stream.position >>> 0,
			((tempDouble = stream.position),
			+Math.abs(tempDouble) >= 1.0
				? tempDouble > 0.0
					? (Math.min(+Math.floor(tempDouble / 4294967296.0), 4294967295.0) | 0) >>> 0
					: ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296.0) >>> 0
				: 0),
		]),
			(HEAP32[newOffset >> 2] = tempI64[0]),
			(HEAP32[(newOffset + 4) >> 2] = tempI64[1])
		if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

function _fd_sync(fd) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		if (stream.stream_ops && stream.stream_ops.fsync) {
			return stream.stream_ops.fsync(stream)
		}
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

function doWritev(stream, iov, iovcnt, offset) {
	var ret = 0
	for (var i = 0; i < iovcnt; i++) {
		var ptr = HEAPU32[iov >> 2]
		var len = HEAPU32[(iov + 4) >> 2]
		iov += 8
		var curr = FS.write(stream, HEAP8, ptr, len, offset)
		if (curr < 0) return -1
		ret += curr
		if (typeof offset !== 'undefined') {
			offset += curr
		}
	}
	return ret
}

function _fd_write(fd, iov, iovcnt, pnum) {
	try {
		var stream = SYSCALLS.getStreamFromFD(fd)
		var num = doWritev(stream, iov, iovcnt)
		HEAPU32[pnum >> 2] = num
		return 0
	} catch (e) {
		if (typeof FS == 'undefined' || !(e instanceof FS.ErrnoError)) throw e
		return e.errno
	}
}

const asmLibraryArg = {
	__syscall_chmod: ___syscall_chmod,
	__syscall_faccessat: ___syscall_faccessat,
	__syscall_fchmod: ___syscall_fchmod,
	__syscall_fchown32: ___syscall_fchown32,
	__syscall_fcntl64: ___syscall_fcntl64,
	__syscall_fstat64: ___syscall_fstat64,
	__syscall_ftruncate64: ___syscall_ftruncate64,
	__syscall_getcwd: ___syscall_getcwd,
	__syscall_ioctl: ___syscall_ioctl,
	__syscall_lstat64: ___syscall_lstat64,
	__syscall_mkdirat: ___syscall_mkdirat,
	__syscall_newfstatat: ___syscall_newfstatat,
	__syscall_openat: ___syscall_openat,
	__syscall_readlinkat: ___syscall_readlinkat,
	__syscall_rmdir: ___syscall_rmdir,
	__syscall_stat64: ___syscall_stat64,
	__syscall_unlinkat: ___syscall_unlinkat,
	__syscall_utimensat: ___syscall_utimensat,
	_emscripten_get_now_is_monotonic: __emscripten_get_now_is_monotonic,
	_localtime_js: __localtime_js,
	_mmap_js: __mmap_js,
	_munmap_js: __munmap_js,
	_tzset_js: __tzset_js,
	emscripten_date_now: _emscripten_date_now,
	emscripten_get_now: _emscripten_get_now,
	emscripten_resize_heap: _emscripten_resize_heap,
	memory: wasmMemory,
}

const wasi_snapshot_preview1 = {
	environ_get: _environ_get,
	environ_sizes_get: _environ_sizes_get,
	fd_close: _fd_close,
	fd_fdstat_get: _fd_fdstat_get,
	fd_read: _fd_read,
	fd_seek: _fd_seek,
	fd_sync: _fd_sync,
	fd_write: _fd_write,
}

export const importObject = {
	env: asmLibraryArg,
	wasi_snapshot_preview1,
}

export const onReady = (exported) => {
	asm = exported
	asm.__wasm_call_ctors()

	const config = Object.assign(Object.create(null), {
		exports: asm,
		memory: wasmMemory,
		/*
		debug: console.debug.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
		log: console.log.bind(console),
		*/
	})

	const capi = Object.create(null)
	const wasm = Object.create(null)

	const flexibleString = function (v) {
		if (isSQLableTypedArray(v)) {
			return typedArrayToString(v instanceof ArrayBuffer ? new Uint8Array(v) : v)
		} else if (Array.isArray(v)) return v.join('')
		else if (wasm.isPtr(v)) v = wasm.cstrToJs(v)
		return v
	}

	class SQLite3Error extends Error {
		constructor(...args) {
			let rc
			if (args.length) {
				const f = args[0]
				if (typeof f === 'number' && f === (f | 0)) {
					rc = args[0]
					const rcStr = capi.sqlite3_js_rc_str?.(rc) || `Unknown result code #${rc}`
					if (1 === args.length) {
						super(rcStr)
					} else {
						if ('object' === typeof args[1]) {
							super(rcStr, args[1])
						} else {
							args[0] = rcStr + ':'
							super(args.join(' '))
						}
					}
				} else {
					if (2 === args.length && 'object' === typeof args[1]) {
						super(...args)
					} else {
						super(args.join(' '))
					}
				}
			}
			this.resultCode = rc || capi.SQLITE_ERROR
			this.name = 'SQLite3Error'
		}
	}

	SQLite3Error.toss = (...args) => {
		throw new SQLite3Error(...args)
	}
	const toss3 = SQLite3Error.toss

	class WasmAllocError extends Error {
		constructor(...args) {
			if (2 === args.length && 'object' === typeof args[1]) {
				super(...args)
			} else if (args.length) {
				super(args.join(' '))
			} else {
				super('Allocation failed.')
			}
			this.resultCode = capi.SQLITE_NOMEM
			this.name = 'WasmAllocError'
		}
	}

	WasmAllocError.toss = (...args) => {
		throw new WasmAllocError(...args)
	}

	const util = {
		flexibleString,
		bigIntFits32,
		bigIntFits64,
		bigIntFitsDouble,
		isBindableTypedArray,
		isInt32,
		isSQLableTypedArray,
		isTypedArray,
		typedArrayToString,
		isSharedTypedArray,
		toss3,
		typedArrayPart,
		affirmDbHeader: function (bytes) {
			if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
			const header = 'SQLite format 3'
			if (header.length > bytes.byteLength) {
				toss3('Input does not contain an SQLite3 database header.')
			}
			for (let i = 0; i < header.length; ++i) {
				if (header.charCodeAt(i) !== bytes[i]) {
					toss3('Input does not contain an SQLite3 database header.')
				}
			}
		},
		affirmIsDb: function (bytes) {
			if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes)
			const n = bytes.byteLength
			if (n < 512 || n % 512 !== 0) {
				toss3('Byte array size', n, 'is invalid for an SQLite3 db.')
			}
			util.affirmDbHeader(bytes)
		},
	}

	function sqlite3ApiBootstrap() {
		delete capi.sqlite3_bind_blob
		delete capi.sqlite3_bind_text

		Object.assign(wasm, {
			ptrSizeof: config.wasmPtrSizeof || 4,
			ptrIR: config.wasmPtrIR || 'i32',
			exports: config.exports,
			memory: config.memory || config.exports.memory,
			alloc: (n) => asm.sqlite3_malloc(n) || WasmAllocError.toss(`Failed to allocate ${n} bytes`),
			realloc: (m, n) => (n ? asm.sqlite3_realloc(m, n) || WasmAllocError.toss(`Failed to reallocate ${n} bytes`) : 0),
			dealloc: asm.sqlite3_free,
		})

		wasm.allocFromTypedArray = function (src) {
			if (src instanceof ArrayBuffer) {
				src = new Uint8Array(src)
			}
			if (!isBindableTypedArray(src)) toss3('Value is not of a supported TypedArray type.')
			const pRet = wasm.alloc(src.byteLength || 1)
			wasm.heapForSize(src.constructor).set(src.byteLength ? src : [0], pRet)
			return pRet
		}

		wasm.compileOptionUsed = function f(optName) {
			if (!arguments.length) {
				if (f._result) return f._result
				else if (!f._opt) {
					f._rx = /^([^=]+)=(.+)/
					f._rxInt = /^-?\d+$/
					f._opt = function (opt, rv) {
						const m = f._rx.exec(opt)
						rv[0] = m ? m[1] : opt
						rv[1] = m ? (f._rxInt.test(m[2]) ? +m[2] : m[2]) : true
					}
				}
				const rc = {},
					ov = [0, 0]
				let i = 0,
					k
				while ((k = capi.sqlite3_compileoption_get(i++))) {
					f._opt(k, ov)
					rc[ov[0]] = ov[1]
				}
				return (f._result = rc)
			} else if (Array.isArray(optName)) {
				const rc = {}
				optName.forEach((v) => {
					rc[v] = capi.sqlite3_compileoption_used(v)
				})
				return rc
			} else if ('object' === typeof optName) {
				Object.keys(optName).forEach((k) => {
					optName[k] = capi.sqlite3_compileoption_used(k)
				})
				return optName
			}
			return 'string' === typeof optName ? !!capi.sqlite3_compileoption_used(optName) : false
		}

		wasm.pstack = Object.assign(Object.create(null), {
			restore: wasm.exports.sqlite3_wasm_pstack_restore,
			alloc: function (n) {
				if ('string' === typeof n && !(n = wasm.sizeofIR(n))) {
					WasmAllocError.toss('Invalid value for pstack.alloc(', arguments[0], ')')
				}
				return wasm.exports.sqlite3_wasm_pstack_alloc(n) || WasmAllocError.toss('Could not allocate', n, 'bytes from the pstack.')
			},

			allocChunks: function (n, sz) {
				if ('string' === typeof sz && !(sz = wasm.sizeofIR(sz))) {
					WasmAllocError.toss('Invalid size value for allocChunks(', arguments[1], ')')
				}
				const mem = wasm.pstack.alloc(n * sz)
				const rc = []
				let i = 0,
					offset = 0
				for (; i < n; ++i, offset += sz) rc.push(mem + offset)
				return rc
			},

			allocPtr: (n = 1, safePtrSize = true) => {
				return 1 === n ? wasm.pstack.alloc(safePtrSize ? 8 : wasm.ptrSizeof) : wasm.pstack.allocChunks(n, safePtrSize ? 8 : wasm.ptrSizeof)
			},

			call: function (f) {
				const stackPos = wasm.pstack.pointer
				try {
					return f(sqlite3)
				} finally {
					wasm.pstack.restore(stackPos)
				}
			},
		})

		Object.defineProperties(wasm.pstack, {
			pointer: {
				configurable: false,
				iterable: true,
				writeable: false,
				get: wasm.exports.sqlite3_wasm_pstack_ptr,
			},
			quota: {
				configurable: false,
				iterable: true,
				writeable: false,
				get: wasm.exports.sqlite3_wasm_pstack_quota,
			},
			remaining: {
				configurable: false,
				iterable: true,
				writeable: false,
				get: wasm.exports.sqlite3_wasm_pstack_remaining,
			},
		})

		capi.sqlite3_randomness = (...args) => {
			if (1 === args.length && util.isTypedArray(args[0]) && 1 === args[0].BYTES_PER_ELEMENT) {
				const ta = args[0]
				if (0 === ta.byteLength) {
					wasm.exports.sqlite3_randomness(0, 0)
					return ta
				}
				const stack = wasm.pstack.pointer
				try {
					let n = ta.byteLength,
						offset = 0
					const r = wasm.exports.sqlite3_randomness
					const heap = wasm.heap8u()
					const nAlloc = n < 512 ? n : 512
					const ptr = wasm.pstack.alloc(nAlloc)
					do {
						const j = n > nAlloc ? nAlloc : n
						r(j, ptr)
						ta.set(typedArrayPart(heap, ptr, ptr + j), offset)
						n -= j
						offset += j
					} while (n > 0)
				} catch (e) {
					console.error('Highly unexpected (and ignored!) exception in sqlite3_randomness():', e)
				} finally {
					wasm.pstack.restore(stack)
				}
				return ta
			}
			wasm.exports.sqlite3_randomness(...args)
		}

		capi.sqlite3_js_db_uses_vfs = function (pDb, vfsName, dbName = 0) {
			try {
				const pK = capi.sqlite3_vfs_find(vfsName)
				if (!pK) return false
				else if (!pDb) {
					return pK === capi.sqlite3_vfs_find(0) ? pK : false
				} else {
					return pK === capi.sqlite3_js_db_vfs(pDb, dbName) ? pK : false
				}
			} catch (e) {
				return false
			}
		}

		capi.sqlite3_js_vfs_list = function () {
			const rc = []
			let pVfs = capi.sqlite3_vfs_find(0)
			while (pVfs) {
				const oVfs = new capi.sqlite3_vfs(pVfs)
				rc.push(wasm.cstrToJs(oVfs.$zName))
				pVfs = oVfs.$pNext
				oVfs.dispose()
			}
			return rc
		}

		capi.sqlite3_js_db_export = function (pDb, schema = 0) {
			pDb = wasm.xWrap.testConvertArg('sqlite3*', pDb)
			if (!pDb) toss3('Invalid sqlite3* argument.')
			const scope = wasm.scopedAllocPush()
			let pOut
			try {
				const pSize = wasm.scopedAlloc(8 + wasm.ptrSizeof)
				const ppOut = pSize + 8

				const zSchema = schema ? (wasm.isPtr(schema) ? schema : wasm.scopedAllocCString('' + schema)) : 0
				let rc = wasm.exports.sqlite3_wasm_db_serialize(pDb, zSchema, ppOut, pSize, 0)
				if (rc) {
					toss3('Database serialization failed with code', sqlite3.capi.sqlite3_js_rc_str(rc))
				}
				pOut = wasm.peekPtr(ppOut)
				const nOut = wasm.peek(pSize, 'i64')
				rc = nOut ? wasm.heap8u().slice(pOut, pOut + Number(nOut)) : new Uint8Array()
				return rc
			} finally {
				if (pOut) wasm.exports.sqlite3_free(pOut)
				wasm.scopedAllocPop(scope)
			}
		}

		capi.sqlite3_js_db_vfs = (dbPointer, dbName = 0) => wasm.sqlite3_wasm_db_vfs(dbPointer, dbName)

		capi.sqlite3_js_aggregate_context = (pCtx, n) => {
			return capi.sqlite3_aggregate_context(pCtx, n) || (n ? WasmAllocError.toss('Cannot allocate', n, 'bytes for sqlite3_aggregate_context()') : 0)
		}

		capi.sqlite3_js_posix_create_file = function (filename, data, dataLen) {
			let pData
			if (data && wasm.isPtr(data)) {
				pData = data
			} else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
				pData = wasm.allocFromTypedArray(data)
				if (arguments.length < 3 || !util.isInt32(dataLen) || dataLen < 0) {
					dataLen = data.byteLength
				}
			} else {
				SQLite3Error.toss('Invalid 2nd argument for sqlite3_js_posix_create_file().')
			}
			try {
				if (!util.isInt32(dataLen) || dataLen < 0) {
					SQLite3Error.toss('Invalid 3rd argument for sqlite3_js_posix_create_file().')
				}
				const rc = wasm.sqlite3_wasm_posix_create_file(filename, pData, dataLen)
				if (rc) SQLite3Error.toss('Creation of file failed with sqlite3 result code', capi.sqlite3_js_rc_str(rc))
			} finally {
				wasm.dealloc(pData)
			}
		}

		capi.sqlite3_db_config = function (pDb, op, ...args) {
			if (!this.s) {
				this.s = wasm.xWrap('sqlite3_wasm_db_config_s', 'int', ['sqlite3*', 'int', 'string:static'])
				this.pii = wasm.xWrap('sqlite3_wasm_db_config_pii', 'int', ['sqlite3*', 'int', '*', 'int', 'int'])
				this.ip = wasm.xWrap('sqlite3_wasm_db_config_ip', 'int', ['sqlite3*', 'int', 'int', '*'])
			}
			switch (op) {
				case capi.SQLITE_DBCONFIG_ENABLE_FKEY:
				case capi.SQLITE_DBCONFIG_ENABLE_TRIGGER:
				case capi.SQLITE_DBCONFIG_ENABLE_FTS3_TOKENIZER:
				case capi.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION:
				case capi.SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE:
				case capi.SQLITE_DBCONFIG_ENABLE_QPSG:
				case capi.SQLITE_DBCONFIG_TRIGGER_EQP:
				case capi.SQLITE_DBCONFIG_RESET_DATABASE:
				case capi.SQLITE_DBCONFIG_DEFENSIVE:
				case capi.SQLITE_DBCONFIG_WRITABLE_SCHEMA:
				case capi.SQLITE_DBCONFIG_LEGACY_ALTER_TABLE:
				case capi.SQLITE_DBCONFIG_DQS_DML:
				case capi.SQLITE_DBCONFIG_DQS_DDL:
				case capi.SQLITE_DBCONFIG_ENABLE_VIEW:
				case capi.SQLITE_DBCONFIG_LEGACY_FILE_FORMAT:
				case capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA:
				case capi.SQLITE_DBCONFIG_STMT_SCANSTATUS:
				case capi.SQLITE_DBCONFIG_REVERSE_SCANORDER:
					return this.ip(pDb, op, args[0], args[1] || 0)
				case capi.SQLITE_DBCONFIG_LOOKASIDE:
					return this.pii(pDb, op, args[0], args[1], args[2])
				case capi.SQLITE_DBCONFIG_MAINDBNAME:
					return this.s(pDb, op, args[0])
				default:
					return capi.SQLITE_MISUSE
			}
		}.bind(Object.create(null))

		capi.sqlite3_value_to_js = function (pVal, throwIfCannotConvert = true) {
			let arg
			const valType = capi.sqlite3_value_type(pVal)
			switch (valType) {
				case capi.SQLITE_INTEGER:
					arg = capi.sqlite3_value_int64(pVal)
					if (util.bigIntFitsDouble(arg)) arg = Number(arg)
					break
				case capi.SQLITE_FLOAT:
					arg = capi.sqlite3_value_double(pVal)
					break
				case capi.SQLITE_TEXT:
					arg = capi.sqlite3_value_text(pVal)
					break
				case capi.SQLITE_BLOB: {
					const n = capi.sqlite3_value_bytes(pVal)
					const pBlob = capi.sqlite3_value_blob(pVal)
					if (n && !pBlob) sqlite3.WasmAllocError.toss('Cannot allocate memory for blob argument of', n, 'byte(s)')
					arg = n ? wasm.heap8u().slice(pBlob, pBlob + Number(n)) : null
					break
				}
				case capi.SQLITE_NULL:
					arg = null
					break
				default:
					if (throwIfCannotConvert) {
						toss3(capi.SQLITE_MISMATCH, 'Unhandled sqlite3_value_type():', valType)
					}
					arg = undefined
			}
			return arg
		}

		capi.sqlite3_values_to_js = function (argc, pArgv, throwIfCannotConvert = true) {
			let i
			const tgt = []
			for (i = 0; i < argc; ++i) {
				tgt.push(capi.sqlite3_value_to_js(wasm.peekPtr(pArgv + wasm.ptrSizeof * i), throwIfCannotConvert))
			}
			return tgt
		}

		capi.sqlite3_result_error_js = function (pCtx, e) {
			if (e instanceof WasmAllocError) {
				capi.sqlite3_result_error_nomem(pCtx)
			} else {
				capi.sqlite3_result_error(pCtx, '' + e, -1)
			}
		}

		capi.sqlite3_result_js = function (pCtx, val) {
			if (val instanceof Error) {
				capi.sqlite3_result_error_js(pCtx, val)
				return
			}
			try {
				switch (typeof val) {
					case 'undefined':
						break
					case 'boolean':
						capi.sqlite3_result_int(pCtx, val ? 1 : 0)
						break
					case 'bigint':
						if (util.bigIntFits32(val)) {
							capi.sqlite3_result_int(pCtx, Number(val))
						} else if (util.bigIntFitsDouble(val)) {
							capi.sqlite3_result_double(pCtx, Number(val))
						} else {
							if (util.bigIntFits64(val)) capi.sqlite3_result_int64(pCtx, val)
							else toss3('BigInt value', val.toString(), 'is too BigInt for int64.')
						}
						break
					case 'number': {
						let f
						if (util.isInt32(val)) {
							f = capi.sqlite3_result_int
						} else if (Number.isInteger(val) && util.bigIntFits64(BigInt(val))) {
							f = capi.sqlite3_result_int64
						} else {
							f = capi.sqlite3_result_double
						}
						f(pCtx, val)
						break
					}
					case 'string': {
						const [p, n] = wasm.allocCString(val, true)
						capi.sqlite3_result_text(pCtx, p, n, capi.SQLITE_WASM_DEALLOC)
						break
					}
					case 'object':
						if (null === val) {
							capi.sqlite3_result_null(pCtx)
							break
						} else if (util.isBindableTypedArray(val)) {
							const pBlob = wasm.allocFromTypedArray(val)
							capi.sqlite3_result_blob(pCtx, pBlob, val.byteLength, capi.SQLITE_WASM_DEALLOC)
							break
						}

					default:
						toss3("Don't not how to handle this UDF result value:", typeof val, val)
				}
			} catch (e) {
				capi.sqlite3_result_error_js(pCtx, e)
			}
		}

		capi.sqlite3_column_js = function (pStmt, iCol, throwIfCannotConvert = true) {
			const v = capi.sqlite3_column_value(pStmt, iCol)
			return 0 === v ? undefined : capi.sqlite3_value_to_js(v, throwIfCannotConvert)
		}

		const __newOldValue = function (pObj, iCol, impl) {
			impl = capi[impl]
			if (!this.ptr) this.ptr = wasm.allocPtr()
			else wasm.pokePtr(this.ptr, 0)
			const rc = impl(pObj, iCol, this.ptr)
			if (rc) return SQLite3Error.toss(rc, arguments[2] + '() failed with code ' + rc)
			const pv = wasm.peekPtr(this.ptr)
			return pv ? capi.sqlite3_value_to_js(pv, true) : undefined
		}.bind(Object.create(null))

		capi.sqlite3_preupdate_new_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_new')
		capi.sqlite3_preupdate_old_js = (pDb, iCol) => __newOldValue(pDb, iCol, 'sqlite3_preupdate_old')
		capi.sqlite3changeset_new_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_new')
		capi.sqlite3changeset_old_js = (pIt, iCol) => __newOldValue(pIt, iCol, 'sqlite3changeset_old')

		const sqlite3 = {
			WasmAllocError: WasmAllocError,
			SQLite3Error: SQLite3Error,
			capi,
			util,
			wasm,
			config,
			version: {
				libVersion: '3.44.2',
				libVersionNumber: 3044002,
				sourceId: '2023-11-24 11:41:44 ebead0e7230cd33bcec9f95d2183069565b9e709bf745c9b5db65cc0cbf92c0f',
				downloadVersion: 3440200,
			},
			client: undefined,
			scriptInfo: Object.create(null),
		}

		try {
			installWhWasm(sqlite3)
			installOO1(sqlite3)
			installStruct(sqlite3)
		} catch (e) {
			console.error('sqlite3 bootstrap initializer threw:', e)
			throw e
		}

		return sqlite3
	}

	const sqlite3 = sqlite3ApiBootstrap()

	return installOpfsVfs(sqlite3).then(() => sqlite3)
}
