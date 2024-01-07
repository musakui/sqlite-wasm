import { load } from '../../sqlite-wasm/lib/instance.js'
import { setup } from '../../sqlite-wasm/lib/base.js'
import { initVFS, getVFS, openDbFile, releaseHandles } from '../../sqlite-wasm/lib/vfs.js'
import { openDb, closeDb, db_exec, db_exec_stmt } from '../../sqlite-wasm/lib/db_ops.js'
import { SQLITE } from '../../sqlite-wasm/lib/constants.js'

const INIT_DB = `
PRAGMA journal_mode=DELETE;
PRAGMA cache_size=-16384;

DROP TABLE IF EXISTS "smol";
DROP TABLE IF EXISTS "searcher";

CREATE TABLE IF NOT EXISTS "smol" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"rand" real,
	"bloo" blob,
	"inty" integer
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS "searcher" USING fts5(
	"name", "desc",
	"iid" UNINDEXED
);
`

const bl = new Uint8Array([4, 3, 2, 1])

/** @param {string} message */
const log = (message, body) => self.postMessage({ message, body })

log('started')

await load()
log('loaded')

setup()

let pDb = null
const flags = SQLITE.OPEN_CREATE | SQLITE.OPEN_READWRITE | SQLITE.OPEN_EXRESCODE
await initVFS()


try {
	await openDbFile('db.sqlite3')
	pDb = openDb('db.sqlite3', flags, getVFS())
	log('open')
	db_exec(pDb, INIT_DB)
	log('created')
	db_exec(pDb, `INSERT INTO "smol" (id, name, rand, inty, bloo) VALUES ('id0', 'asdf', ${Math.random()}, 5, x'deadbeef')`)
	db_exec(pDb, `INSERT INTO "smol" (id, name, rand, inty, bloo) VALUES ('id1', 'zcvd', ${Math.random()}, 2, x'01234567')`)
	log('inserted')
	db_exec_stmt(pDb, `INSERT INTO "smol" (id, name, rand, inty, bloo) VALUES (?, ?, ?, ?, ?)`, ['id2', 'aaaa', Math.random(), 8, bl])
	db_exec_stmt(pDb, `SELECT * FROM smol`)
	log('selected')
} finally {
	closeDb(pDb)
	releaseHandles()
}

log('end')
