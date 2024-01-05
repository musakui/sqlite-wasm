import { load, getASM } from '../../sqlite-wasm/lib/instance.js'
import { setup, structs } from '../../sqlite-wasm/lib/base.js'
import { installMethods } from '../../sqlite-wasm/lib/struct.js'

/** @param {string} message */
const log = (message, body) => self.postMessage({ message, body })

log('started')

await load()
log('loaded')

setup()
const asm = getASM()

const ioStruct = new structs.sqlite3_io_methods()
installMethods(ioStruct, {
})
console.log(ioStruct)

log('end')
