const splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/

export const isAbs = (path) => path.charAt(0) === '/'

export const splitPath = (filename) => splitPathRe.exec(filename).slice(1)

export const normalizeArray = (parts, allowAboveRoot) => {
	let up = 0
	for (let i = parts.length - 1; i >= 0; i--) {
		let last = parts[i]
		if (last === '.') {
			parts.splice(i, 1)
		} else if (last === '..') {
			parts.splice(i, 1)
			up++
		} else if (up) {
			parts.splice(i, 1)
			up--
		}
	}

	if (allowAboveRoot) {
		for (; up; up--) {
			parts.unshift('..')
		}
	}
	return parts
}

export const normalize = (path) => {
	const isAbsolute = isAbs(path),
		trailingSlash = path.substr(-1) === '/'

	path = normalizeArray(
		path.split('/').filter((p) => !!p),
		!isAbsolute
	).join('/')
	if (!path && !isAbsolute) {
		path = '.'
	}
	if (path && trailingSlash) {
		path += '/'
	}
	return (isAbsolute ? '/' : '') + path
}

export const dirname = (path) => {
	let result = splitPath(path),
		root = result[0],
		dir = result[1]
	if (!root && !dir) {
		return '.'
	}
	if (dir) {
		dir = dir.slice(0, -1)
	}
	return root + dir
}

export const basename = (path) => {
	if (path === '/') return '/'
	path = normalize(path)
	path = path.replace(/\/$/, '')
	const lastSlash = path.lastIndexOf('/')
	if (lastSlash === -1) return path
	return path.substr(lastSlash + 1)
}

export const join = (...args) => normalize(args.join('/'))

export const join2 = (l, r) => normalize(l + '/' + r)
