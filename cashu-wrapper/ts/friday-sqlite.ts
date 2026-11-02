/**
 * Small constructor adapter around the Coco Bun SQLite implementation pinned
 * to the same source commit as this POC's vendored Coco core.
 *
 * Do not replace this with the public registry's nominal 2.0.0 package without
 * re-running the repository contract and live restart tests. That publication
 * predates the pinned core's authority and `findMintByUrl` contracts despite
 * carrying the same major/minor version.
 */
import { Database } from "bun:sqlite";
import { SqliteRepositories } from "@cashu/coco-sqlite-bun";

export class FridaySqliteRepositories extends SqliteRepositories {
	constructor(database: Database) {
		super({ database });
	}
}
