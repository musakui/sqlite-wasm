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
	await db.exec(`INSERT INTO "test_table" (id, name, val) VALUES ('id${i}', '${Math.random().toString(16).slice(2)}', ${Math.random()});`)
	app.innerHTML += `${i} `
}

await db.exec(`COMMIT`)

app.innerHTML += ' ok\n\n'

await db.exec(`UPDATE test_table SET name = 'a name' WHERE id = 'id2'`)

app.innerHTML += 'updated\n\n'

const buf = await db.export()
app.innerHTML += `exported ${buf.byteLength}\n\n`

const imp = await db.init(buf)
app.innerHTML += `imported ${imp}\n\n`

app.innerHTML += JSON.stringify(await db.exec(`SELECT * from test_table WHERE id = 'id2'`), null, 2)
