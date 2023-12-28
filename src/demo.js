const INIT_DB = `
DROP TABLE IF EXISTS "smol";
DROP TABLE IF EXISTS "searcher";

CREATE TABLE IF NOT EXISTS "smol" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"val" number
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS "searcher" USING fts5(
	"name", "desc",
	"iid" UNINDEXED
);
`

/**
 * @param {(s: str) => void} log
 */
export const runDemo = (db, log) => {
	log(`begin ${Date.now()}\n\n`)

	db.exec(INIT_DB)
	log('inited\n\ninserting... ')

	db.exec(`BEGIN TRANSACTION`)
	for (let i = 0; i < 8; ++i) {
		db.exec({
			sql: `INSERT INTO "smol" (id, name, val) VALUES (?, ?, ?);`,
			bind: [`id${i}`, Math.random().toString(16).slice(2), Math.random()],
		})
	}
	db.exec(`COMMIT`)
	log(' ok\n\n')

	db.exec(`UPDATE smol SET name = 'smol', val = 0 WHERE id = 'id0'`)
	log('updated\n\n')

	const rows = db.exec({
		sql: `SELECT * FROM smol ORDER BY val LIMIT 3`,
		rowMode: 'array',
	})
	log(JSON.stringify(rows, null, 2))

	const buf = db.exportDb()
	log(`\n\nexported ${buf.byteLength}\n\n`)

	const imp = db.importDb(buf)
	log(`imported ${imp}\n\n`)

	const [row] = db.exec({
		sql: `SELECT * FROM smol WHERE id = 'id0'`,
		rowMode: 'object',
	})
	log(JSON.stringify(row, null, 2))

	log(`\n\nend ${Date.now()}`)
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
