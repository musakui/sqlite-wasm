/**
 * @param {string[]} strings
 * @param {...unknown} values
 */
export function SQL(strings, ...values) {
	return {
		sql: strings.join('?'),
		bind: values,
	}
}

export const openDB = () => {
	let mid = 0
	let readyResolve = null

	const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

	/** @type {Map<string, [() => void, () => void]>} */
	const execMap = new Map()

	const ready = new Promise((resolve, reject) => {
		readyResolve = resolve
		setTimeout(() => reject('timeout'), 10000)
	})

	/**
	 * @param {string} act
	 * @param {unknown} payload
	 */
	const send = async (act, payload) => {
		const id = `${++mid}`
		await ready
		return await new Promise((resolve, reject) => {
			execMap.set(id, [resolve, reject])
			worker.postMessage({ id, act, payload })
		})
	}

	const db = {
		send,
		ready: false,
		/** @return {Promise<number>} */
		init: (p) => send('init', p),
		/** @return {Promise<unknown>} */
		exec: (s) => send('exec', s),
		/** @return {Promise<ArrayBuffer>} */
		export: () => send('export'),
	}

	worker.addEventListener('message', (evt) => {
		const { type, message, id, ...rest } = evt.data
		switch (type) {
			case 'err':
				console.error(message)
				return
			case 'log':
				console.log(message)
				return
			case 'ready':
				Object.assign(db, rest, { ready: true })
				readyResolve()
				return
			default:
				if (!execMap.has(id)) return
				const [res, rej] = execMap.get(id)
				if (rej && rest.error) {
					rej(rest.error)
				} else if (res && rest.result) {
					res(rest.result)
				}
				execMap.delete(id)
		}
	})

	return db
}
