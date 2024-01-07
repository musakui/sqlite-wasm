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
	"inty" integer
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS "searcher" USING fts5(
	"name", "desc",
	"iid" UNINDEXED
);
`

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
	db_exec(pDb, `INSERT INTO "smol" (id, name, rand, inty) VALUES ('id0', 'asdf', 0.512, 5)`)
	db_exec(pDb, `INSERT INTO "smol" (id, name, rand, inty) VALUES ('id1', 'zcvd', 0.123, 2)`)
	log('inserted')
	db_exec_stmt(pDb, `SELECT * FROM smol`)
	log('selected')
} finally {
	closeDb(pDb)
	releaseHandles()
}

log('end')
