import * as PATH from './path.js'
import * as PATH_FS from './pathFs.js'
import { lengthBytesUTF8, stringToUTF8Array } from './string.js'

export const FS = {
	genericErrors: {},
	nextfd: (fd_start = 0, fd_end = FS.MAX_OPEN_FDS) => {
		for (var fd = fd_start; fd <= fd_end; fd++) {
			if (!FS.streams[fd]) {
				return fd
			}
		}
		throw new FS.ErrnoError(33)
	},
	open: (path, flags, mode) => {
		if (path === '') {
			throw new FS.ErrnoError(44)
		}
		flags = typeof flags == 'string' ? FS.modeStringToFlags(flags) : flags
		mode = typeof mode == 'undefined' ? 438 : mode
		if (flags & 64) {
			mode = (mode & 4095) | 32768
		} else {
			mode = 0
		}
		var node
		if (typeof path == 'object') {
			node = path
		} else {
			path = PATH.normalize(path)
			try {
				var lookup = FS.lookupPath(path, {
					follow: !(flags & 131072),
				})
				node = lookup.node
			} catch (e) {}
		}

		var created = false
		if (flags & 64) {
			if (node) {
				if (flags & 128) {
					throw new FS.ErrnoError(20)
				}
			} else {
				node = FS.mknod(path, mode, 0)
				created = true
			}
		}
		if (!node) {
			throw new FS.ErrnoError(44)
		}

		if (FS.isChrdev(node.mode)) {
			flags &= ~512
		}

		if (flags & 65536 && !FS.isDir(node.mode)) {
			throw new FS.ErrnoError(54)
		}

		if (!created) {
			var errCode = FS.mayOpen(node, flags)
			if (errCode) {
				throw new FS.ErrnoError(errCode)
			}
		}

		if (flags & 512 && !created) {
			FS.truncate(node, 0)
		}

		flags &= ~(128 | 512 | 131072)

		var stream = FS.createStream({
			node: node,
			path: FS.getPath(node),
			flags: flags,
			seekable: true,
			position: 0,
			stream_ops: node.stream_ops,

			ungotten: [],
			error: false,
		})

		if (stream.stream_ops.open) {
			stream.stream_ops.open(stream)
		}
		return stream
	},
	ensureErrnoError: () => {
		if (FS.ErrnoError) return
		FS.ErrnoError = function ErrnoError(errno, node) {
			this.node = node
			this.setErrno = function (errno) {
				this.errno = errno
			}
			this.setErrno(errno)
			this.message = 'FS error'
		}
		FS.ErrnoError.prototype = new Error()
		FS.ErrnoError.prototype.constructor = FS.ErrnoError
		;[44].forEach((code) => {
			FS.genericErrors[code] = new FS.ErrnoError(code)
			FS.genericErrors[code].stack = '<generic error, no stack>'
		})
	},
}

const readMode = 292 | 73
const writeMode = 146

const FSNode = function (parent, name, mode, rdev) {
	if (!parent) {
		parent = this
	}
	this.parent = parent
	this.mount = parent.mount
	this.mounted = null
	this.id = FS.nextInode++
	this.name = name
	this.mode = mode
	this.node_ops = {}
	this.stream_ops = {}
	this.rdev = rdev
}

FS.FSNode = FSNode
FS.ensureErrnoError()

