const runWorker = (url) => {
	const worker = new Worker(url, { type: 'module' })
	worker.addEventListener('message', (evt) => {
		const { error, message } = evt.data
		if (error) {
			app.innerHTML += `\n\nERROR: ${error}`
		} else if (message) {
			app.innerHTML += message
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
