import * as PATH from './path.js'

function trim(arr) {
	let start = 0
	for (; start < arr.length; start++) {
		if (arr[start] !== '') break
	}
	let end = arr.length - 1
	for (; end >= 0; end--) {
		if (arr[end] !== '') break
	}
	if (start > end) return []
	return arr.slice(start, end - start + 1)
}

export const resolve = function () {
	let resolvedPath = '',
		resolvedAbsolute = false
	for (let i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
		let path = i >= 0 ? arguments[i] : FS.cwd()

		if (typeof path != 'string') {
			throw new TypeError('Arguments to path.resolve must be strings')
		} else if (!path) {
			return ''
		}
		resolvedPath = path + '/' + resolvedPath
		resolvedAbsolute = PATH.isAbs(path)
	}

	resolvedPath = PATH.normalizeArray(
		resolvedPath.split('/').filter((p) => !!p),
		!resolvedAbsolute
	).join('/')
	return (resolvedAbsolute ? '/' : '') + resolvedPath || '.'
}

export const relative = (from, to) => {
	from = resolve(from).slice(1)
	to = resolve(to).slice(1)

	let fromParts = trim(from.split('/'))
	let toParts = trim(to.split('/'))
	let length = Math.min(fromParts.length, toParts.length)
	let samePartsLength = length
	for (let i = 0; i < length; i++) {
		if (fromParts[i] !== toParts[i]) {
			samePartsLength = i
			break
		}
	}
	let outputParts = []
	for (let i = samePartsLength; i < fromParts.length; i++) {
		outputParts.push('..')
	}
	outputParts = outputParts.concat(toParts.slice(samePartsLength))
	return outputParts.join('/')
}
