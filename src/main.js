const runWorker = (url) => {
	const worker = new Worker(url, { type: 'module' })
	const started = Date.now()
	worker.addEventListener('message', (evt) => {
		const { error, message, body } = evt.data
		if (error) {
			app.innerHTML += `\n\nERROR: ${error}`
		}
		if (!message) return
		app.innerHTML += `[${Date.now() - started}] ${message}\n`
		if (body) {
			app.innerHTML += `\n${body}\n\n`
		}
	})
}

const app = document.querySelector('#app')
app.innerHTML = 'updated library:\n\n'
runWorker(new URL('./worker.js', import.meta.url))

const ori = document.querySelector('#ori')
ori.onclick = () => {
	ori.remove()
	app.innerHTML = 'original library:\n\n'
	runWorker(new URL('./originalWorker.js', import.meta.url))
}
