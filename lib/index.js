import { getExports, getMemory } from './init.js'
import { onReady } from './stuff.js'

export async function init() {
	const exports = await getExports()
	return onReady(exports, getMemory())
}

export const version = {
	libVersion: '3.44.2',
	libVersionNumber: 3044002,
	sourceId: '2023-11-24 11:41:44 ebead0e7230cd33bcec9f95d2183069565b9e709bf745c9b5db65cc0cbf92c0f',
	downloadVersion: 3440200,
}
