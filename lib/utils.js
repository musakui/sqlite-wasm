/**
 * @param {string} message
 * @param {unknown} [cause]
 */
export const abort = (message, cause) => {
	throw new Error(message, { cause })
}

/**
 * @template [T=number]
 * @param {number} length
 * @param {(n: number) => T} [fn]
 */
export const range = (length, fn) => {
	/** @type {(_: unknown, i: number) => T} */
	const c = fn ? (_, i) => fn(i) : (_, i) => i
	return Array.from({ length }, c)
}

/**
 * @param {unknown} fn
 * @return {fn is Function}
 */
export const isFunction = (fn) => fn instanceof Function
