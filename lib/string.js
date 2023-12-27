export function lengthBytesUTF8(str) {
	let len = 0
	for (let i = 0; i < str.length; ++i) {
		const c = str.charCodeAt(i)
		if (c <= 0x7f) {
			len++
		} else if (c <= 0x7ff) {
			len += 2
		} else if (c >= 0xd800 && c <= 0xdfff) {
			len += 4
			++i
		} else {
			len += 3
		}
	}
	return len
}

export function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
	if (!(maxBytesToWrite > 0)) return 0

	let startIdx = outIdx,
		endIdx = outIdx + maxBytesToWrite - 1
	for (let i = 0; i < str.length; ++i) {
		let u = str.charCodeAt(i)
		if (u >= 0xd800 && u <= 0xdfff) {
			const u1 = str.charCodeAt(++i)
			u = (0x10000 + ((u & 0x3ff) << 10)) | (u1 & 0x3ff)
		}
		if (u <= 0x7f) {
			if (outIdx >= endIdx) break
			heap[outIdx++] = u
		} else if (u <= 0x7ff) {
			if (outIdx + 1 >= endIdx) break
			heap[outIdx++] = 0xc0 | (u >> 6)
			heap[outIdx++] = 0x80 | (u & 63)
		} else if (u <= 0xffff) {
			if (outIdx + 2 >= endIdx) break
			heap[outIdx++] = 0xe0 | (u >> 12)
			heap[outIdx++] = 0x80 | ((u >> 6) & 63)
			heap[outIdx++] = 0x80 | (u & 63)
		} else {
			if (outIdx + 3 >= endIdx) break
			heap[outIdx++] = 0xf0 | (u >> 18)
			heap[outIdx++] = 0x80 | ((u >> 12) & 63)
			heap[outIdx++] = 0x80 | ((u >> 6) & 63)
			heap[outIdx++] = 0x80 | (u & 63)
		}
	}

	heap[outIdx] = 0
	return outIdx - startIdx
}
