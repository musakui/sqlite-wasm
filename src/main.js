import { openDB } from './db.js'

const app = document.querySelector('#app')
app.innerHTML = `begin ${Date.now()}\n\n`

const db = openDB()

await db.exec(`DROP TABLE IF EXISTS "test_table";
CREATE TABLE IF NOT EXISTS "test_table" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text, "val" number
) WITHOUT ROWID;`)

app.innerHTML += 'inited\n\ninserting... '

await db.exec(`BEGIN TRANSACTION`)

for (let i = 0; i < 8; ++i) {
	await db.exec({
		sql: `INSERT INTO "test_table" (id, name, val) VALUES (?, ?, ?);`,
		bind: [`id${i}`, Math.random().toString(16).slice(2), Math.random()],
	})
	app.innerHTML += `${i} `
}

await db.exec(`COMMIT`)
app.innerHTML += ' ok\n\n'

await db.exec(`UPDATE test_table SET name = 'smol', val = 0 WHERE id = 'id0'`)
app.innerHTML += 'updated\n\n'

const result = await db.exec(`SELECT * FROM test_table ORDER BY val LIMIT 3`)

app.innerHTML += JSON.stringify(result, null, 2)
app.innerHTML += '\n\n'

const buf = await db.export()
app.innerHTML += `exported ${buf.byteLength}\n\n`

const imp = await db.init(buf)
app.innerHTML += `imported ${imp}\n\n`

app.innerHTML += JSON.stringify(await db.exec(`SELECT * FROM test_table WHERE id = 'id0'`), null, 2)