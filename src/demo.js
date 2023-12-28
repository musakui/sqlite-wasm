const INIT_DB = `DROP TABLE IF EXISTS "test_table";
CREATE TABLE IF NOT EXISTS "test_table" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text, "val" number
) WITHOUT ROWID;`

/**
 * @param {(s: str) => Promise<void>} log
 */
export const runDemo = async (db, log) => {
	await log(`begin ${Date.now()}\n\n`)

	db.exec(INIT_DB)
	await log('inited\n\ninserting... ')

	db.exec(`BEGIN TRANSACTION`)
	for (let i = 0; i < 8; ++i) {
		db.exec({
			sql: `INSERT INTO "test_table" (id, name, val) VALUES (?, ?, ?);`,
			bind: [`id${i}`, Math.random().toString(16).slice(2), Math.random()],
		})
	}
	db.exec(`COMMIT`)
	await log(' ok\n\n')

	db.exec(`UPDATE test_table SET name = 'smol', val = 0 WHERE id = 'id0'`)
	await log('updated\n\n')

	const rows = db.exec({
		sql: `SELECT * FROM test_table ORDER BY val LIMIT 3`,
		rowMode: 'array',
	})
	await log(JSON.stringify(rows, null, 2))

	const buf = db.exportDb()
	await log(`\n\nexported ${buf.byteLength}\n\n`)

	const imp = await db.importDb(buf)
	await log(`imported ${imp}\n\n`)

	const [row] = await db.exec({
		sql: `SELECT * FROM test_table WHERE id = 'id0'`,
		rowMode: 'object',
	})
	await log(JSON.stringify(row, null, 2))

	await log(`\n\nend ${Date.now()}`)
}

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
