import { init, asm, cstr_to_j as _s } from '../lib/core.js'
import { db_open, db_exec } from '../lib/db.js'

const app = document.querySelector('#app')
const board = document.createElement('pre')
app.append(board)

const log = (msg) => {
	board.innerHTML += `${msg}`
}

log(`started\n\n`)

await init()

log(`version: ${_s(asm._libversion())}\n`)
log(`source ID: ${_s(asm._sourceid())}\n`)

const pDb = db_open(':memory:', 4 | 2)
log(`\nopened db @ ${pDb}\n`)

const flags = []
db_exec(pDb, `PRAGMA compile_options`, (r) => flags.push(r.values[0]))
// console.log(flags)

const initSQL = `CREATE TABLE IF NOT EXISTS foo(name, bar);
INSERT INTO foo (name, bar) VALUES ('a', ${Math.random()}), ('b', ${Math.random()})`

db_exec(pDb, initSQL)
log(`\ninserted values\n\n`)

db_exec(pDb, `SELECT * FROM foo`, ({ names, values }) => {
	const ent = names.map((n, i) => [n, values[i]])
	log(`got row: ${JSON.stringify(Object.fromEntries(ent))}\n`)
})

log(`\ndone`)
