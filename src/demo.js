const INIT_DB = `
DROP TABLE IF EXISTS "smol";
DROP TABLE IF EXISTS "searcher";

CREATE TABLE IF NOT EXISTS "smol" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"inty" number,
	"rand" number
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS "searcher" USING fts5(
	"name", "desc",
	"iid" UNINDEXED
);
`

const rand = () => Math.random()
const randStr = () => rand().toString(16).slice(2)

/**
 * @param {import('../index').Database} db
 * @param {{
 *	log: (s: str, b?: str) => void;
 *	exportDb: () => ArrayBuffer; importDb: (b: ArrayBuffer) => number;
 * }} utils
 */
export const runDemo = (db, utils) => {
	const { log } = utils
	log('begin')
	db.exec(INIT_DB)
	log('initialized')

	log('inserting with bind')
	db.exec(`BEGIN TRANSACTION`)
	for (let i = 0; i < 8; ++i) {
		db.exec({
			sql: `INSERT INTO "smol" (id, name, inty, rand) VALUES (?, ?, ?, ?)`,
			bind: [`id${i}`, randStr(), i, rand()],
		})
	}
	db.exec(`COMMIT`)
	log('OK')

	log('inserting with prepared statement')
	const stmt = db.prepare(`INSERT INTO "smol" (id, name, rand, inty) VALUES (?, ?, ?, ?)`)
	db.exec(`BEGIN TRANSACTION`)
	for (let i = 10; i < 1000; ++i) {
		stmt.bind([`id${i}`, randStr(), rand(), i]).stepReset()
	}
	db.exec(`COMMIT`)
	log('OK')

	const [count] = db.exec({ sql: `SELECT COUNT(id) FROM smol`, rowMode: 'array' })
	log(`row count: ${count}`)

	db.exec(`UPDATE smol SET name = 'smol', rand = 0 WHERE id = 'id0'`)
	log('updated row')

	const rows = db.exec({
		sql: `SELECT * FROM smol ORDER BY rand LIMIT 3`,
		rowMode: 'array',
	})
	log('got rows', JSON.stringify(rows, null, 2))

	const buf = utils.exportDb()
	log(`exported: ${buf.byteLength} bytes`)

	const imp = utils.importDb(buf)
	log(`imported: ${imp} bytes`)

	const [row] = db.exec({
		sql: `SELECT * FROM smol WHERE id = 'id0'`,
		rowMode: 'object',
	})
	log('got row', JSON.stringify(row))

	log(`end`)
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
