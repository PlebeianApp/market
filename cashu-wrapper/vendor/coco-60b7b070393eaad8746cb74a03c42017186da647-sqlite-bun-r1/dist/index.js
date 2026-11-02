// @bun
// packages/sql-storage/src/repositories.ts
import {
  createRepositoryFacade,
  invokeRepositoryMethod,
  isRepositoryMutation,
  RepositoryTransactionConflictError,
  validateWalletAuthorityIdentity,
  WalletAuthorityConflictError,
  WalletAuthorityGenerationExhaustedError,
  WalletAuthorityLifecycleError,
  WalletAuthorityNotAcquiredError,
  WalletAuthorityValidationError
} from "@cashu/coco-core/adapter";

// packages/sql-storage/src/schema.ts
import { normalizeMintUrl } from "@cashu/coco-core/adapter";
var SEND_OPERATION_METHOD_MIGRATION_IDS = [
  "012_send_operations_method",
  "013_send_operations_method"
];
var RECEIVE_OPERATION_MIGRATION_IDS = [
  "013_receive_operations",
  "012_receive_operations"
];
function getUnixTimeSeconds() {
  return Math.floor(Date.now() / 1000);
}
async function tableExists(db, tableName) {
  const row = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return !!row;
}
async function getTableColumns(db, tableName) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}
async function insertMigrationIds(db, ids) {
  const appliedAt = getUnixTimeSeconds();
  for (const id of ids) {
    await db.run("INSERT OR IGNORE INTO coco_cashu_migrations (id, appliedAt) VALUES (?, ?)", [
      id,
      appliedAt
    ]);
  }
}
async function addSendOperationMethodColumns(db) {
  const columns = await getTableColumns(db, "coco_cashu_send_operations");
  if (!columns.has("method")) {
    await db.run(`ALTER TABLE coco_cashu_send_operations ADD COLUMN method TEXT NOT NULL DEFAULT 'default'`);
  }
  if (!columns.has("methodDataJson")) {
    await db.run(`ALTER TABLE coco_cashu_send_operations ADD COLUMN methodDataJson TEXT NOT NULL DEFAULT '{}'`);
  }
}
async function addProofUnitColumn(db) {
  const columns = await getTableColumns(db, "coco_cashu_proofs");
  if (!columns.has("unit")) {
    await db.run(`ALTER TABLE coco_cashu_proofs ADD COLUMN unit TEXT NOT NULL DEFAULT 'sat'`);
  }
  await db.run(`
    UPDATE coco_cashu_proofs
    SET unit = COALESCE(
      (
        SELECT LOWER(TRIM(coco_cashu_keysets.unit))
        FROM coco_cashu_keysets
        WHERE coco_cashu_keysets.mintUrl = coco_cashu_proofs.mintUrl
          AND coco_cashu_keysets.id = coco_cashu_proofs.id
          AND coco_cashu_keysets.unit IS NOT NULL
          AND TRIM(coco_cashu_keysets.unit) <> ''
        LIMIT 1
      ),
      CASE
        WHEN unit IS NULL OR TRIM(unit) = '' THEN 'sat'
        ELSE LOWER(TRIM(unit))
      END
    )
  `);
  await db.run("CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_state ON coco_cashu_proofs(mintUrl, unit, state)");
  await db.run("CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_id_state ON coco_cashu_proofs(mintUrl, unit, id, state)");
  await db.run("CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_unit_state ON coco_cashu_proofs(unit, state)");
}
async function addSendOperationUnitColumn(db) {
  const columns = await getTableColumns(db, "coco_cashu_send_operations");
  if (!columns.has("unit")) {
    await db.run(`ALTER TABLE coco_cashu_send_operations ADD COLUMN unit TEXT NOT NULL DEFAULT 'sat'`);
  }
  await db.run("UPDATE coco_cashu_send_operations SET unit = 'sat' WHERE unit IS NULL OR TRIM(unit) = ''");
  await db.run("UPDATE coco_cashu_send_operations SET unit = LOWER(TRIM(unit))");
}
async function backfillSendOperationTokensFromHistory(db) {
  await db.run(`
    UPDATE coco_cashu_send_operations
    SET tokenJson = (
      SELECT h.tokenJson
      FROM coco_cashu_history h
      WHERE h.type = 'send'
        AND h.operationId = coco_cashu_send_operations.id
        AND h.mintUrl = coco_cashu_send_operations.mintUrl
        AND h.tokenJson IS NOT NULL
      ORDER BY h.createdAt DESC, h.id DESC
      LIMIT 1
    )
    WHERE tokenJson IS NULL
      AND EXISTS (
        SELECT 1
        FROM coco_cashu_history h
        WHERE h.type = 'send'
          AND h.operationId = coco_cashu_send_operations.id
          AND h.mintUrl = coco_cashu_send_operations.mintUrl
          AND h.tokenJson IS NOT NULL
      )
   `);
}
async function migrateAmountColumnsToText(db) {
  if (await tableExists(db, "coco_cashu_proofs")) {
    await db.exec(`
      ALTER TABLE coco_cashu_proofs RENAME TO coco_cashu_proofs_legacy_amounts;

      CREATE TABLE coco_cashu_proofs (
        mintUrl   TEXT NOT NULL,
        id        TEXT NOT NULL,
        unit      TEXT NOT NULL DEFAULT 'sat',
        amount    TEXT NOT NULL,
        secret    TEXT NOT NULL,
        C         TEXT NOT NULL,
        dleqJson  TEXT,
        witnessJson   TEXT,
        state     TEXT NOT NULL CHECK (state IN ('inflight', 'ready', 'spent')),
        createdAt INTEGER NOT NULL,
        usedByOperationId TEXT,
        createdByOperationId TEXT,
        PRIMARY KEY (mintUrl, secret)
      );

      INSERT INTO coco_cashu_proofs (
        mintUrl, id, unit, amount, secret, C, dleqJson, witnessJson, state, createdAt,
        usedByOperationId, createdByOperationId
      )
      SELECT
        mintUrl,
        id,
        COALESCE(
          (
            SELECT LOWER(TRIM(coco_cashu_keysets.unit))
            FROM coco_cashu_keysets
            WHERE coco_cashu_keysets.mintUrl = coco_cashu_proofs_legacy_amounts.mintUrl
              AND coco_cashu_keysets.id = coco_cashu_proofs_legacy_amounts.id
              AND coco_cashu_keysets.unit IS NOT NULL
              AND TRIM(coco_cashu_keysets.unit) <> ''
            LIMIT 1
          ),
          'sat'
        ),
        CAST(amount AS TEXT), secret, C, dleqJson, witnessJson, state, createdAt,
        usedByOperationId, createdByOperationId
      FROM coco_cashu_proofs_legacy_amounts;

      DROP TABLE coco_cashu_proofs_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_state ON coco_cashu_proofs(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_state ON coco_cashu_proofs(mintUrl, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_id_state ON coco_cashu_proofs(mintUrl, id, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_state ON coco_cashu_proofs(mintUrl, unit, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_id_state ON coco_cashu_proofs(mintUrl, unit, id, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_unit_state ON coco_cashu_proofs(unit, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_usedByOp ON coco_cashu_proofs(usedByOperationId) WHERE usedByOperationId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_createdByOp ON coco_cashu_proofs(createdByOperationId) WHERE createdByOperationId IS NOT NULL;
    `);
  }
  if (await tableExists(db, "coco_cashu_mint_quotes")) {
    await db.exec(`
      ALTER TABLE coco_cashu_mint_quotes RENAME TO coco_cashu_mint_quotes_legacy_amounts;

      CREATE TABLE coco_cashu_mint_quotes (
        mintUrl TEXT NOT NULL,
        quote   TEXT NOT NULL,
        state   TEXT NOT NULL CHECK (state IN ('UNPAID','PAID','ISSUED')),
        request TEXT NOT NULL,
        amount  TEXT NOT NULL,
        unit    TEXT NOT NULL,
        expiry  INTEGER,
        pubkey  TEXT,
        PRIMARY KEY (mintUrl, quote)
      );

      INSERT INTO coco_cashu_mint_quotes (
        mintUrl, quote, state, request, amount, unit, expiry, pubkey
      )
      SELECT mintUrl, quote, state, request, CAST(amount AS TEXT), unit, expiry, pubkey
      FROM coco_cashu_mint_quotes_legacy_amounts;

      DROP TABLE coco_cashu_mint_quotes_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_quotes_state ON coco_cashu_mint_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_quotes_mint ON coco_cashu_mint_quotes(mintUrl);
    `);
  }
  if (await tableExists(db, "coco_cashu_melt_quotes")) {
    await db.exec(`
      ALTER TABLE coco_cashu_melt_quotes RENAME TO coco_cashu_melt_quotes_legacy_amounts;

      CREATE TABLE coco_cashu_melt_quotes (
        mintUrl TEXT NOT NULL,
        quote   TEXT NOT NULL,
        state   TEXT NOT NULL CHECK (state IN ('UNPAID','PENDING','PAID')),
        request TEXT NOT NULL,
        amount  TEXT NOT NULL,
        unit    TEXT NOT NULL,
        expiry  INTEGER NOT NULL,
        fee_reserve TEXT NOT NULL,
        payment_preimage TEXT,
        PRIMARY KEY (mintUrl, quote)
      );

      INSERT INTO coco_cashu_melt_quotes (
        mintUrl, quote, state, request, amount, unit, expiry, fee_reserve, payment_preimage
      )
      SELECT
        mintUrl, quote, state, request, CAST(amount AS TEXT), unit, expiry,
        CAST(fee_reserve AS TEXT), payment_preimage
      FROM coco_cashu_melt_quotes_legacy_amounts;

      DROP TABLE coco_cashu_melt_quotes_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_state ON coco_cashu_melt_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_mint ON coco_cashu_melt_quotes(mintUrl);
    `);
  }
  if (await tableExists(db, "coco_cashu_history")) {
    await db.exec(`
      ALTER TABLE coco_cashu_history RENAME TO coco_cashu_history_legacy_amounts;

      CREATE TABLE coco_cashu_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        mintUrl   TEXT NOT NULL,
        type      TEXT NOT NULL CHECK (type IN ('mint','melt','send','receive')),
        unit      TEXT NOT NULL,
        amount    TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        quoteId   TEXT,
        state     TEXT,
        paymentRequest TEXT,
        tokenJson TEXT,
        metadata  TEXT,
        operationId TEXT
      );

      INSERT INTO coco_cashu_history (
        id, mintUrl, type, unit, amount, createdAt, quoteId, state, paymentRequest,
        tokenJson, metadata, operationId
      )
      SELECT
        id, mintUrl, type, unit, CAST(amount AS TEXT), createdAt, quoteId, state,
        paymentRequest, tokenJson, metadata, operationId
      FROM coco_cashu_history_legacy_amounts;

      DROP TABLE coco_cashu_history_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_mint_createdAt
        ON coco_cashu_history(mintUrl, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_mint_quote
        ON coco_cashu_history(mintUrl, quoteId);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_type
        ON coco_cashu_history(type);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_quote_mint
        ON coco_cashu_history(mintUrl, quoteId, type)
        WHERE type = 'mint' AND quoteId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_quote_melt
        ON coco_cashu_history(mintUrl, quoteId, type)
        WHERE type = 'melt' AND quoteId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_operation_send
        ON coco_cashu_history(mintUrl, operationId)
        WHERE type = 'send' AND operationId IS NOT NULL;
    `);
  }
  if (await tableExists(db, "coco_cashu_send_operations")) {
    await db.exec(`
      ALTER TABLE coco_cashu_send_operations RENAME TO coco_cashu_send_operations_legacy_amounts;

      CREATE TABLE coco_cashu_send_operations (
        id         TEXT PRIMARY KEY,
        mintUrl    TEXT NOT NULL,
        amount     TEXT NOT NULL,
        unit       TEXT NOT NULL DEFAULT 'sat',
        state      TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'pending', 'finalized', 'rolling_back', 'rolled_back')),
        createdAt  INTEGER NOT NULL,
        updatedAt  INTEGER NOT NULL,
        error      TEXT,
        needsSwap  INTEGER,
        fee        TEXT,
        inputAmount TEXT,
        inputProofSecretsJson TEXT,
        outputDataJson TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        tokenJson TEXT
      );

      INSERT INTO coco_cashu_send_operations (
        id, mintUrl, amount, unit, state, createdAt, updatedAt, error, needsSwap, fee,
        inputAmount, inputProofSecretsJson, outputDataJson, method, methodDataJson, tokenJson
      )
      SELECT
        id, mintUrl, CAST(amount AS TEXT), 'sat', state, createdAt, updatedAt, error, needsSwap,
        CASE WHEN fee IS NULL THEN NULL ELSE CAST(fee AS TEXT) END,
        CASE WHEN inputAmount IS NULL THEN NULL ELSE CAST(inputAmount AS TEXT) END,
        inputProofSecretsJson, outputDataJson, method, methodDataJson, tokenJson
      FROM coco_cashu_send_operations_legacy_amounts;

      DROP TABLE coco_cashu_send_operations_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_state ON coco_cashu_send_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_mint ON coco_cashu_send_operations(mintUrl);
    `);
  }
  if (await tableExists(db, "coco_cashu_melt_operations")) {
    await db.exec(`
      ALTER TABLE coco_cashu_melt_operations RENAME TO coco_cashu_melt_operations_legacy_amounts;

      CREATE TABLE coco_cashu_melt_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'pending', 'finalized', 'rolling_back', 'rolled_back')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        quoteId TEXT,
        amount TEXT,
        fee_reserve TEXT,
        swap_fee TEXT,
        needsSwap INTEGER,
        inputAmount TEXT,
        inputProofSecretsJson TEXT,
        changeOutputDataJson TEXT,
        swapOutputDataJson TEXT,
        changeAmount TEXT,
        effectiveFee TEXT,
        finalizedDataJson TEXT,
        unit TEXT
      );

      INSERT INTO coco_cashu_melt_operations (
        id, mintUrl, state, createdAt, updatedAt, error, method, methodDataJson, quoteId,
        amount, fee_reserve, swap_fee, needsSwap, inputAmount, inputProofSecretsJson,
        changeOutputDataJson, swapOutputDataJson, changeAmount, effectiveFee, finalizedDataJson, unit
      )
      SELECT
        id, mintUrl, state, createdAt, updatedAt, error, method, methodDataJson, quoteId,
        CASE WHEN amount IS NULL THEN NULL ELSE CAST(amount AS TEXT) END,
        CASE WHEN fee_reserve IS NULL THEN NULL ELSE CAST(fee_reserve AS TEXT) END,
        CASE WHEN swap_fee IS NULL THEN NULL ELSE CAST(swap_fee AS TEXT) END,
        needsSwap,
        CASE WHEN inputAmount IS NULL THEN NULL ELSE CAST(inputAmount AS TEXT) END,
        inputProofSecretsJson, changeOutputDataJson, swapOutputDataJson,
        CASE WHEN changeAmount IS NULL THEN NULL ELSE CAST(changeAmount AS TEXT) END,
        CASE WHEN effectiveFee IS NULL THEN NULL ELSE CAST(effectiveFee AS TEXT) END,
        finalizedDataJson, unit
      FROM coco_cashu_melt_operations_legacy_amounts;

      DROP TABLE coco_cashu_melt_operations_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_operations_state
        ON coco_cashu_melt_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_operations_mint
        ON coco_cashu_melt_operations(mintUrl);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_melt_operations_mint_quote
        ON coco_cashu_melt_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `);
  }
  if (await tableExists(db, "coco_cashu_receive_operations")) {
    await db.exec(`
      ALTER TABLE coco_cashu_receive_operations RENAME TO coco_cashu_receive_operations_legacy_amounts;

      CREATE TABLE coco_cashu_receive_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        amount TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'finalized', 'rolled_back')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        fee TEXT,
        inputProofsJson TEXT NOT NULL,
        outputDataJson TEXT,
        unit TEXT NOT NULL DEFAULT 'sat'
      );

      INSERT INTO coco_cashu_receive_operations (
        id, mintUrl, amount, state, createdAt, updatedAt, error, fee,
        inputProofsJson, outputDataJson, unit
      )
      SELECT
        id, mintUrl, CAST(amount AS TEXT), state, createdAt, updatedAt, error,
        CASE WHEN fee IS NULL THEN NULL ELSE CAST(fee AS TEXT) END,
        inputProofsJson, outputDataJson, unit
      FROM coco_cashu_receive_operations_legacy_amounts;

      DROP TABLE coco_cashu_receive_operations_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_receive_operations_state
        ON coco_cashu_receive_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_receive_operations_mint
        ON coco_cashu_receive_operations(mintUrl);
    `);
  }
  if (await tableExists(db, "coco_cashu_mint_operations")) {
    await db.exec(`
      ALTER TABLE coco_cashu_mint_operations RENAME TO coco_cashu_mint_operations_legacy_amounts;

      CREATE TABLE coco_cashu_mint_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        quoteId TEXT,
        state TEXT NOT NULL CHECK (state IN ('init', 'pending', 'executing', 'finalized', 'failed')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        amount TEXT,
        unit TEXT,
        request TEXT,
        expiry INTEGER,
        pubkey TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        terminalFailureJson TEXT,
        outputDataJson TEXT
      );

      INSERT INTO coco_cashu_mint_operations (
        id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson,
        amount, unit, request, expiry, pubkey, lastObservedRemoteState,
        lastObservedRemoteStateAt, terminalFailureJson, outputDataJson
      )
      SELECT
        id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson,
        CASE WHEN amount IS NULL THEN NULL ELSE CAST(amount AS TEXT) END,
        unit, request, expiry, pubkey, lastObservedRemoteState,
        lastObservedRemoteStateAt, terminalFailureJson, outputDataJson
      FROM coco_cashu_mint_operations_legacy_amounts;

      DROP TABLE coco_cashu_mint_operations_legacy_amounts;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_state
        ON coco_cashu_mint_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint
        ON coco_cashu_mint_operations(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint_quote
        ON coco_cashu_mint_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `);
  }
}
async function reconcileMigrationAliases(db) {
  if (await tableExists(db, "coco_cashu_send_operations")) {
    const sendColumns = await getTableColumns(db, "coco_cashu_send_operations");
    if (sendColumns.has("method") && sendColumns.has("methodDataJson")) {
      await insertMigrationIds(db, SEND_OPERATION_METHOD_MIGRATION_IDS);
    }
  }
  if (await tableExists(db, "coco_cashu_receive_operations")) {
    await insertMigrationIds(db, RECEIVE_OPERATION_MIGRATION_IDS);
  }
}
var MIGRATIONS = [
  {
    id: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_mints (
        mintUrl   TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        mintInfo  TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS coco_cashu_keysets (
        mintUrl   TEXT NOT NULL,
        id        TEXT NOT NULL,
        keypairs  TEXT NOT NULL,
        active    INTEGER NOT NULL,
        feePpk    INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, id)
      );

      CREATE TABLE IF NOT EXISTS coco_cashu_counters (
        mintUrl  TEXT NOT NULL,
        keysetId TEXT NOT NULL,
        counter  INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, keysetId)
      );

      CREATE TABLE IF NOT EXISTS coco_cashu_proofs (
        mintUrl   TEXT NOT NULL,
        id        TEXT NOT NULL,
        unit      TEXT NOT NULL DEFAULT 'sat',
        amount    INTEGER NOT NULL,
        secret    TEXT NOT NULL,
        C         TEXT NOT NULL,
        dleqJson  TEXT,
        witnessJson   TEXT,
        state     TEXT NOT NULL CHECK (state IN ('inflight', 'ready', 'spent')),
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, secret)
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_state ON coco_cashu_proofs(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_state ON coco_cashu_proofs(mintUrl, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_id_state ON coco_cashu_proofs(mintUrl, id, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_state ON coco_cashu_proofs(mintUrl, unit, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_mint_unit_id_state ON coco_cashu_proofs(mintUrl, unit, id, state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_unit_state ON coco_cashu_proofs(unit, state);

      CREATE TABLE IF NOT EXISTS coco_cashu_mint_quotes (
        mintUrl TEXT NOT NULL,
        quote   TEXT NOT NULL,
        state   TEXT NOT NULL CHECK (state IN ('UNPAID','PAID','ISSUED')),
        request TEXT NOT NULL,
        amount  INTEGER NOT NULL,
        unit    TEXT NOT NULL,
        expiry  INTEGER NOT NULL,
        pubkey  TEXT,
        PRIMARY KEY (mintUrl, quote)
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_quotes_state ON coco_cashu_mint_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_quotes_mint ON coco_cashu_mint_quotes(mintUrl);
    `
  },
  {
    id: "002_melt_quotes",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_melt_quotes (
        mintUrl TEXT NOT NULL,
        quote   TEXT NOT NULL,
        state   TEXT NOT NULL CHECK (state IN ('UNPAID','PENDING','PAID')),
        request TEXT NOT NULL,
        amount  INTEGER NOT NULL,
        unit    TEXT NOT NULL,
        expiry  INTEGER NOT NULL,
        fee_reserve INTEGER NOT NULL,
        payment_preimage TEXT,
        PRIMARY KEY (mintUrl, quote)
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_state ON coco_cashu_melt_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_mint ON coco_cashu_melt_quotes(mintUrl);
    `
  },
  {
    id: "003_history",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        mintUrl   TEXT NOT NULL,
        type      TEXT NOT NULL CHECK (type IN ('mint','melt','send','receive')),
        unit      TEXT NOT NULL,
        amount    INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        quoteId   TEXT,
        state     TEXT,
        paymentRequest TEXT,
        tokenJson TEXT,
        metadata  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_mint_createdAt
        ON coco_cashu_history(mintUrl, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_mint_quote
        ON coco_cashu_history(mintUrl, quoteId);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_type
        ON coco_cashu_history(type);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_quote_mint
        ON coco_cashu_history(mintUrl, quoteId, type)
        WHERE type = 'mint' AND quoteId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_quote_melt
        ON coco_cashu_history(mintUrl, quoteId, type)
        WHERE type = 'melt' AND quoteId IS NOT NULL;
    `
  },
  {
    id: "004_mint_trusted_field",
    sql: `
      ALTER TABLE coco_cashu_mints ADD COLUMN trusted INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    id: "005_keyset_unit_field",
    sql: `
      ALTER TABLE coco_cashu_keysets ADD COLUMN unit TEXT;
    `
  },
  {
    id: "006_keypairs",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_keypairs (
        publicKey TEXT PRIMARY KEY,
        secretKey TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        derivationIndex INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_keypairs_createdAt ON coco_cashu_keypairs(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_keypairs_derivationIndex ON coco_cashu_keypairs(derivationIndex DESC) WHERE derivationIndex IS NOT NULL;
    `
  },
  {
    id: "007_normalize_mint_urls",
    run: async (db) => {
      const mints = await db.all("SELECT mintUrl FROM coco_cashu_mints");
      const urlMapping = new Map;
      for (const { mintUrl } of mints) {
        const normalized = normalizeMintUrl(mintUrl);
        urlMapping.set(mintUrl, normalized);
      }
      const normalizedToOriginal = new Map;
      for (const [original, normalized] of urlMapping) {
        const existing = normalizedToOriginal.get(normalized);
        if (existing && existing !== original) {
          throw new Error(`Mint URL normalization conflict: "${existing}" and "${original}" both normalize to "${normalized}". ` + `Please manually resolve this conflict before running the migration.`);
        }
        normalizedToOriginal.set(normalized, original);
      }
      const tables = [
        "coco_cashu_mints",
        "coco_cashu_keysets",
        "coco_cashu_counters",
        "coco_cashu_proofs",
        "coco_cashu_mint_quotes",
        "coco_cashu_melt_quotes",
        "coco_cashu_history"
      ];
      for (const [original, normalized] of urlMapping) {
        if (original === normalized)
          continue;
        for (const table of tables) {
          await db.run(`UPDATE ${table} SET mintUrl = ? WHERE mintUrl = ?`, [normalized, original]);
        }
      }
    }
  },
  {
    id: "008_send_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_send_operations (
        id         TEXT PRIMARY KEY,
        mintUrl    TEXT NOT NULL,
        amount     INTEGER NOT NULL,
        state      TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'pending', 'completed', 'rolling_back', 'rolled_back')),
        createdAt  INTEGER NOT NULL,
        updatedAt  INTEGER NOT NULL,
        error      TEXT,
        needsSwap  INTEGER,
        fee        INTEGER,
        inputAmount INTEGER,
        inputProofSecretsJson TEXT,
        outputDataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_state ON coco_cashu_send_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_mint ON coco_cashu_send_operations(mintUrl);

      ALTER TABLE coco_cashu_proofs ADD COLUMN usedByOperationId TEXT;
      ALTER TABLE coco_cashu_proofs ADD COLUMN createdByOperationId TEXT;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_usedByOp ON coco_cashu_proofs(usedByOperationId) WHERE usedByOperationId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_proofs_createdByOp ON coco_cashu_proofs(createdByOperationId) WHERE createdByOperationId IS NOT NULL;
    `
  },
  {
    id: "009_history_send_operation",
    sql: `
      ALTER TABLE coco_cashu_history ADD COLUMN operationId TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_history_mint_operation_send
        ON coco_cashu_history(mintUrl, operationId)
        WHERE type = 'send' AND operationId IS NOT NULL;
    `
  },
  {
    id: "010_rename_completed_to_finalized",
    run: async (db) => {
      await db.run(`UPDATE coco_cashu_history SET state = 'finalized' WHERE type = 'send' AND state = 'completed'`);
      await db.exec(`
        CREATE TABLE coco_cashu_send_operations_new (
          id         TEXT PRIMARY KEY,
          mintUrl    TEXT NOT NULL,
          amount     INTEGER NOT NULL,
          state      TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'pending', 'finalized', 'rolling_back', 'rolled_back')),
          createdAt  INTEGER NOT NULL,
          updatedAt  INTEGER NOT NULL,
          error      TEXT,
          needsSwap  INTEGER,
          fee        INTEGER,
          inputAmount INTEGER,
          inputProofSecretsJson TEXT,
          outputDataJson TEXT
        );

        INSERT INTO coco_cashu_send_operations_new 
        SELECT 
          id, mintUrl, amount,
          CASE WHEN state = 'completed' THEN 'finalized' ELSE state END,
          createdAt, updatedAt, error, needsSwap, fee, inputAmount,
          inputProofSecretsJson, outputDataJson
        FROM coco_cashu_send_operations;

        DROP TABLE coco_cashu_send_operations;

        ALTER TABLE coco_cashu_send_operations_new RENAME TO coco_cashu_send_operations;

        CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_state ON coco_cashu_send_operations(state);
        CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_mint ON coco_cashu_send_operations(mintUrl);
      `);
    }
  },
  {
    id: "011_melt_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_melt_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'pending', 'finalized', 'rolling_back', 'rolled_back')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        quoteId TEXT,
        amount INTEGER,
        fee_reserve INTEGER,
        swap_fee INTEGER,
        needsSwap INTEGER,
        inputAmount INTEGER,
        inputProofSecretsJson TEXT,
        changeOutputDataJson TEXT,
        swapOutputDataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_operations_state
        ON coco_cashu_melt_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_operations_mint
        ON coco_cashu_melt_operations(mintUrl);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_melt_operations_mint_quote
        ON coco_cashu_melt_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `
  },
  {
    id: "012_send_operations_method",
    run: addSendOperationMethodColumns
  },
  {
    id: "013_receive_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_receive_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        amount INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('init', 'prepared', 'executing', 'finalized', 'rolled_back')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        fee INTEGER,
        inputProofsJson TEXT NOT NULL,
        outputDataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_receive_operations_state
        ON coco_cashu_receive_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_receive_operations_mint
        ON coco_cashu_receive_operations(mintUrl);
    `
  },
  {
    id: "014_send_operations_token",
    sql: `
      ALTER TABLE coco_cashu_send_operations ADD COLUMN tokenJson TEXT;
    `
  },
  {
    id: "015_reset_keysets_for_string_denoms",
    sql: `
      DELETE FROM coco_cashu_keysets;
      UPDATE coco_cashu_mints SET updatedAt = 0;
    `
  },
  {
    id: "016_melt_settlement_amounts",
    sql: `
      ALTER TABLE coco_cashu_melt_operations ADD COLUMN changeAmount INTEGER;
      ALTER TABLE coco_cashu_melt_operations ADD COLUMN effectiveFee INTEGER;
    `
  },
  {
    id: "017_auth_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_auth_sessions (
        mintUrl      TEXT PRIMARY KEY NOT NULL,
        accessToken  TEXT NOT NULL,
        refreshToken TEXT,
        expiresAt    INTEGER NOT NULL,
        scope        TEXT,
        batPoolJson  TEXT
      );
    `
  },
  {
    id: "018_mint_operations",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_mint_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        quoteId TEXT,
        state TEXT NOT NULL CHECK (state IN ('init', 'pending', 'executing', 'finalized', 'failed')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        amount INTEGER,
        unit TEXT,
        request TEXT,
        expiry INTEGER,
        pubkey TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        terminalFailureJson TEXT,
        outputDataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_state
        ON coco_cashu_mint_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint
        ON coco_cashu_mint_operations(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint_quote
        ON coco_cashu_mint_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `
  },
  {
    id: "019_mint_operations_pending_lifecycle",
    sql: `
      ALTER TABLE coco_cashu_mint_operations RENAME TO coco_cashu_mint_operations_legacy;

      CREATE TABLE coco_cashu_mint_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        quoteId TEXT,
        state TEXT NOT NULL CHECK (state IN ('init', 'pending', 'executing', 'finalized', 'failed')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        amount INTEGER,
        unit TEXT,
        request TEXT,
        expiry INTEGER,
        pubkey TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        terminalFailureJson TEXT,
        outputDataJson TEXT
      );

      INSERT INTO coco_cashu_mint_operations (
        id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson, amount, unit, request, expiry, pubkey, lastObservedRemoteState, lastObservedRemoteStateAt, terminalFailureJson, outputDataJson
      )
      SELECT
        id,
        mintUrl,
        quoteId,
        CASE
          WHEN state = 'prepared' THEN 'pending'
          WHEN state = 'rolled_back' THEN 'finalized'
          ELSE state
        END,
        createdAt,
        updatedAt,
        error,
        method,
        methodDataJson,
        amount,
        unit,
        request,
        expiry,
        pubkey,
        lastObservedRemoteState,
        lastObservedRemoteStateAt,
        terminalFailureJson,
        outputDataJson
      FROM coco_cashu_mint_operations_legacy;

      DROP TABLE coco_cashu_mint_operations_legacy;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_state
        ON coco_cashu_mint_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint
        ON coco_cashu_mint_operations(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint_quote
        ON coco_cashu_mint_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `
  },
  {
    id: "020_mint_operations_failed_state",
    sql: `
      ALTER TABLE coco_cashu_mint_operations RENAME TO coco_cashu_mint_operations_legacy;

      CREATE TABLE coco_cashu_mint_operations (
        id TEXT PRIMARY KEY,
        mintUrl TEXT NOT NULL,
        quoteId TEXT,
        state TEXT NOT NULL CHECK (state IN ('init', 'pending', 'executing', 'finalized', 'failed')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        method TEXT NOT NULL,
        methodDataJson TEXT NOT NULL,
        amount INTEGER,
        unit TEXT,
        request TEXT,
        expiry INTEGER,
        pubkey TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        terminalFailureJson TEXT,
        outputDataJson TEXT
      );

      INSERT INTO coco_cashu_mint_operations (
        id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson, amount, unit, request, expiry, pubkey, lastObservedRemoteState, lastObservedRemoteStateAt, terminalFailureJson, outputDataJson
      )
      SELECT
        id,
        mintUrl,
        quoteId,
        state,
        createdAt,
        updatedAt,
        error,
        method,
        methodDataJson,
        amount,
        unit,
        request,
        expiry,
        pubkey,
        lastObservedRemoteState,
        lastObservedRemoteStateAt,
        terminalFailureJson,
        outputDataJson
      FROM coco_cashu_mint_operations_legacy;

      DROP TABLE coco_cashu_mint_operations_legacy;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_state
        ON coco_cashu_mint_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint
        ON coco_cashu_mint_operations(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint_quote
        ON coco_cashu_mint_operations(mintUrl, quoteId)
        WHERE quoteId IS NOT NULL;
    `
  },
  {
    id: "021_melt_finalized_data",
    sql: `
      ALTER TABLE coco_cashu_melt_operations ADD COLUMN finalizedDataJson TEXT;
    `
  },
  {
    id: "022_melt_operation_unit",
    sql: `
      ALTER TABLE coco_cashu_melt_operations ADD COLUMN unit TEXT;
    `
  },
  {
    id: "023_receive_operation_unit",
    sql: `
      ALTER TABLE coco_cashu_receive_operations ADD COLUMN unit TEXT NOT NULL DEFAULT 'sat';
    `
  },
  {
    id: "024_amount_columns_text",
    run: migrateAmountColumnsToText
  },
  {
    id: "025_proof_unit",
    run: addProofUnitColumn
  },
  {
    id: "026_send_operation_unit",
    run: addSendOperationUnitColumn
  },
  {
    id: "027_payment_request_receive",
    sql: `
      ALTER TABLE coco_cashu_receive_operations ADD COLUMN sourceJson TEXT;

      CREATE TABLE IF NOT EXISTS coco_cashu_payment_request_receive_operations (
        id TEXT PRIMARY KEY,
        requestId TEXT,
        encodedRequest TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'completed', 'cancelled')),
        transport TEXT NOT NULL CHECK (transport IN ('inband', 'nostr', 'post')),
        amount TEXT NOT NULL,
        unit TEXT NOT NULL,
        mintsJson TEXT NOT NULL,
        singleUse INTEGER NOT NULL,
        description TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        error TEXT,
        completedAt INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_pr_receive_operations_state
        ON coco_cashu_payment_request_receive_operations(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_pr_receive_operations_request_id
        ON coco_cashu_payment_request_receive_operations(requestId);

      CREATE TABLE IF NOT EXISTS coco_cashu_payment_request_receive_attempts (
        id TEXT PRIMARY KEY,
        requestOperationId TEXT NOT NULL,
        requestId TEXT,
        transport TEXT NOT NULL CHECK (transport IN ('inband', 'nostr', 'post')),
        transportMessageId TEXT,
        payloadHash TEXT NOT NULL,
        senderPubkey TEXT,
        memo TEXT,
        mintUrl TEXT NOT NULL,
        unit TEXT NOT NULL,
        grossAmount TEXT NOT NULL,
        fee TEXT,
        netAmount TEXT,
        receiveOperationId TEXT,
        state TEXT NOT NULL CHECK (state IN ('received', 'validating', 'receiving', 'finalized', 'rejected')),
        error TEXT,
        payloadJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_pr_receive_attempts_request_operation
        ON coco_cashu_payment_request_receive_attempts(requestOperationId);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_pr_receive_attempts_state
        ON coco_cashu_payment_request_receive_attempts(state);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_pr_receive_attempts_message
        ON coco_cashu_payment_request_receive_attempts(transportMessageId)
        WHERE transportMessageId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_pr_receive_attempts_payload
        ON coco_cashu_payment_request_receive_attempts(requestOperationId, payloadHash);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_pr_receive_attempts_receive
        ON coco_cashu_payment_request_receive_attempts(receiveOperationId)
        WHERE receiveOperationId IS NOT NULL;
    `
  },
  {
    id: "028_history_projection_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_send_operations_createdAt
        ON coco_cashu_send_operations(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_operations_createdAt
        ON coco_cashu_melt_operations(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_createdAt
        ON coco_cashu_mint_operations(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_receive_operations_createdAt
        ON coco_cashu_receive_operations(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_createdAt
        ON coco_cashu_history(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_history_type_operation
        ON coco_cashu_history(type, operationId)
        WHERE operationId IS NOT NULL;
    `
  },
  {
    id: "029_backfill_send_operation_tokens",
    run: backfillSendOperationTokensFromHistory
  },
  {
    id: "030_method_aware_mint_quotes",
    sql: `
      CREATE TABLE IF NOT EXISTS coco_cashu_canonical_mint_quotes (
        mintUrl TEXT NOT NULL,
        method TEXT NOT NULL,
        quoteId TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('UNPAID','PAID','ISSUED')),
        request TEXT NOT NULL,
        amount TEXT NOT NULL,
        unit TEXT NOT NULL,
        expiry INTEGER,
        pubkey TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        reusable INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, method, quoteId)
      );

      INSERT INTO coco_cashu_canonical_mint_quotes (
        mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey,
        lastObservedRemoteState, lastObservedRemoteStateAt, reusable, createdAt, updatedAt
      )
      SELECT
        mintUrl,
        method,
        quoteId,
        CASE
          WHEN lastObservedRemoteState IN ('UNPAID','PAID','ISSUED') THEN lastObservedRemoteState
          WHEN state = 'finalized' THEN 'ISSUED'
          ELSE 'UNPAID'
        END,
        request,
        amount,
        unit,
        expiry,
        pubkey,
        CASE
          WHEN lastObservedRemoteState IN ('UNPAID','PAID','ISSUED') THEN lastObservedRemoteState
          WHEN state = 'finalized' THEN 'ISSUED'
          ELSE 'UNPAID'
        END,
        COALESCE(lastObservedRemoteStateAt, updatedAt * 1000),
        0,
        createdAt * 1000,
        updatedAt * 1000
      FROM coco_cashu_mint_operations
      WHERE quoteId IS NOT NULL
        AND request IS NOT NULL
        AND amount IS NOT NULL
        AND unit IS NOT NULL
      ON CONFLICT(mintUrl, method, quoteId) DO UPDATE SET
        state = excluded.state,
        request = excluded.request,
        amount = excluded.amount,
        unit = excluded.unit,
        expiry = excluded.expiry,
        pubkey = excluded.pubkey,
        lastObservedRemoteState = excluded.lastObservedRemoteState,
        lastObservedRemoteStateAt = excluded.lastObservedRemoteStateAt,
        updatedAt = excluded.updatedAt;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_state
        ON coco_cashu_canonical_mint_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_mint
        ON coco_cashu_canonical_mint_quotes(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_method
        ON coco_cashu_canonical_mint_quotes(method);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_mint_operations_mint_method_quote
        ON coco_cashu_mint_operations(mintUrl, method, quoteId)
        WHERE quoteId IS NOT NULL;
    `
  },
  {
    id: "031_method_aware_melt_quotes",
    sql: `
      ALTER TABLE coco_cashu_melt_quotes RENAME TO coco_cashu_melt_quotes_legacy;

      CREATE TABLE coco_cashu_melt_quotes (
        mintUrl TEXT NOT NULL,
        method TEXT NOT NULL,
        quoteId TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('UNPAID','PENDING','PAID')),
        request TEXT NOT NULL,
        amount TEXT NOT NULL,
        unit TEXT NOT NULL,
        expiry INTEGER NOT NULL,
        fee_reserve TEXT NOT NULL,
        payment_preimage TEXT,
        changeJson TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, method, quoteId)
      );

      INSERT INTO coco_cashu_melt_quotes (
        mintUrl, method, quoteId, state, request, amount, unit, expiry, fee_reserve,
        payment_preimage, changeJson, lastObservedRemoteState, lastObservedRemoteStateAt,
        createdAt, updatedAt
      )
      SELECT
        mintUrl,
        'bolt11',
        quote,
        state,
        request,
        amount,
        unit,
        expiry,
        fee_reserve,
        payment_preimage,
        NULL,
        state,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM coco_cashu_melt_quotes_legacy;

      INSERT INTO coco_cashu_melt_quotes (
        mintUrl, method, quoteId, state, request, amount, unit, expiry, fee_reserve,
        payment_preimage, changeJson, lastObservedRemoteState, lastObservedRemoteStateAt,
        createdAt, updatedAt
      )
      SELECT
        mintUrl,
        method,
        quoteId,
        CASE
          WHEN state = 'finalized' THEN 'PAID'
          WHEN state IN ('pending','executing') THEN 'PENDING'
          ELSE 'UNPAID'
        END,
        COALESCE(json_extract(methodDataJson, '$.invoice'), quoteId),
        amount,
        unit,
        0,
        fee_reserve,
        json_extract(finalizedDataJson, '$.preimage'),
        NULL,
        CASE
          WHEN state = 'finalized' THEN 'PAID'
          WHEN state IN ('pending','executing') THEN 'PENDING'
          ELSE 'UNPAID'
        END,
        updatedAt * 1000,
        createdAt * 1000,
        updatedAt * 1000
      FROM coco_cashu_melt_operations
      WHERE quoteId IS NOT NULL
        AND amount IS NOT NULL
        AND fee_reserve IS NOT NULL
        AND unit IS NOT NULL
      ON CONFLICT(mintUrl, method, quoteId) DO UPDATE SET
        state = excluded.state,
        request = excluded.request,
        amount = excluded.amount,
        unit = excluded.unit,
        fee_reserve = excluded.fee_reserve,
        payment_preimage = excluded.payment_preimage,
        lastObservedRemoteState = excluded.lastObservedRemoteState,
        lastObservedRemoteStateAt = excluded.lastObservedRemoteStateAt,
        updatedAt = excluded.updatedAt;

      DROP TABLE coco_cashu_melt_quotes_legacy;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_state
        ON coco_cashu_melt_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_mint
        ON coco_cashu_melt_quotes(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_method
        ON coco_cashu_melt_quotes(method);
    `
  },
  {
    id: "032_onchain_melt_quotes",
    sql: `
      ALTER TABLE coco_cashu_melt_quotes RENAME TO coco_cashu_melt_quotes_pre_onchain;

      CREATE TABLE coco_cashu_melt_quotes (
        mintUrl TEXT NOT NULL,
        method TEXT NOT NULL,
        quoteId TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('UNPAID','PENDING','PAID')),
        request TEXT NOT NULL,
        amount TEXT NOT NULL,
        unit TEXT NOT NULL,
        expiry INTEGER NOT NULL,
        fee_reserve TEXT,
        payment_preimage TEXT,
        fee_options_json TEXT,
        outpoint TEXT,
        changeJson TEXT,
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, method, quoteId)
      );

      INSERT INTO coco_cashu_melt_quotes (
        mintUrl, method, quoteId, state, request, amount, unit, expiry, fee_reserve,
        payment_preimage, fee_options_json, outpoint, changeJson, lastObservedRemoteState,
        lastObservedRemoteStateAt, createdAt, updatedAt
      )
      SELECT
        mintUrl, method, quoteId, state, request, amount, unit, expiry, fee_reserve,
        payment_preimage, NULL, NULL, changeJson, lastObservedRemoteState,
        lastObservedRemoteStateAt, createdAt, updatedAt
      FROM coco_cashu_melt_quotes_pre_onchain;

      DROP TABLE coco_cashu_melt_quotes_pre_onchain;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_state
        ON coco_cashu_melt_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_mint
        ON coco_cashu_melt_quotes(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_melt_quotes_method
        ON coco_cashu_melt_quotes(method);
    `
  },
  {
    id: "032_mint_quote_method_data",
    sql: `
      ALTER TABLE coco_cashu_canonical_mint_quotes
        RENAME TO coco_cashu_canonical_mint_quotes_legacy_quote_data;

      CREATE TABLE coco_cashu_canonical_mint_quotes (
        mintUrl TEXT NOT NULL,
        method TEXT NOT NULL,
        quoteId TEXT NOT NULL,
        state TEXT CHECK (state IS NULL OR state IN ('UNPAID','PAID','ISSUED')),
        request TEXT NOT NULL,
        amount TEXT,
        unit TEXT NOT NULL,
        expiry INTEGER,
        pubkey TEXT,
        quoteDataJson TEXT NOT NULL DEFAULT '{}',
        lastObservedRemoteState TEXT,
        lastObservedRemoteStateAt INTEGER,
        reusable INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (mintUrl, method, quoteId)
      );

      INSERT INTO coco_cashu_canonical_mint_quotes (
        mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey, quoteDataJson,
        lastObservedRemoteState, lastObservedRemoteStateAt, reusable, createdAt, updatedAt
      )
      SELECT
        mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey, '{}',
        lastObservedRemoteState, lastObservedRemoteStateAt, reusable, createdAt, updatedAt
      FROM coco_cashu_canonical_mint_quotes_legacy_quote_data;

      DROP TABLE coco_cashu_canonical_mint_quotes_legacy_quote_data;

      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_state
        ON coco_cashu_canonical_mint_quotes(state);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_mint
        ON coco_cashu_canonical_mint_quotes(mintUrl);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_canonical_mint_quotes_method
        ON coco_cashu_canonical_mint_quotes(method);
    `
  },
  {
    id: "033_keypair_purpose",
    sql: `
      ALTER TABLE coco_cashu_keypairs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'p2pk';
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_keypairs_purpose_createdAt
        ON coco_cashu_keypairs(purpose, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_coco_cashu_keypairs_purpose_derivationIndex
        ON coco_cashu_keypairs(purpose, derivationIndex DESC)
        WHERE derivationIndex IS NOT NULL;
    `
  },
  {
    id: "034_clean_unquoted_mint_operations",
    sql: `
      DELETE FROM coco_cashu_mint_operations
      WHERE quoteId IS NULL OR TRIM(quoteId) = '';
    `
  },
  {
    id: "035_duplicate_quote_ids",
    sql: `
      DROP INDEX IF EXISTS ux_coco_cashu_history_mint_quote_mint;
      DROP INDEX IF EXISTS ux_coco_cashu_history_mint_quote_melt;
    `
  },
  {
    id: "036_quote_identity_unique_indexes",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_canonical_mint_quotes_identity
        ON coco_cashu_canonical_mint_quotes(mintUrl, quoteId);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coco_cashu_melt_quotes_identity
        ON coco_cashu_melt_quotes(mintUrl, quoteId);
    `
  },
  {
    id: "037_mint_quote_accounting",
    sql: `
      ALTER TABLE coco_cashu_canonical_mint_quotes
        ADD COLUMN amountPaid TEXT NOT NULL DEFAULT '0';
      ALTER TABLE coco_cashu_canonical_mint_quotes
        ADD COLUMN amountIssued TEXT NOT NULL DEFAULT '0';
      ALTER TABLE coco_cashu_canonical_mint_quotes
        ADD COLUMN remoteUpdatedAt INTEGER;

      UPDATE coco_cashu_canonical_mint_quotes
      SET amountPaid = CASE
            WHEN reusable = 1
              THEN COALESCE(
                CAST(json_extract(
                  CASE WHEN json_valid(quoteDataJson) THEN quoteDataJson ELSE '{}' END,
                  '$.amountPaid'
                ) AS TEXT),
                '0'
              )
            WHEN state IN ('PAID', 'ISSUED')
              THEN COALESCE(CAST(amount AS TEXT), '0')
            ELSE '0'
          END,
          amountIssued = CASE
            WHEN reusable = 1
              THEN COALESCE(
                CAST(json_extract(
                  CASE WHEN json_valid(quoteDataJson) THEN quoteDataJson ELSE '{}' END,
                  '$.amountIssued'
                ) AS TEXT),
                '0'
              )
            WHEN state = 'ISSUED'
              THEN COALESCE(CAST(amount AS TEXT), '0')
            ELSE '0'
          END,
          remoteUpdatedAt = NULL,
          quoteDataJson = CASE
            WHEN json_valid(quoteDataJson) THEN quoteDataJson
            ELSE '{}'
          END;
    `
  },
  {
    id: "038_keypair_derivation_allocations",
    sql: `
      CREATE TABLE coco_cashu_keypair_derivation_allocations (
        purpose TEXT PRIMARY KEY,
        lastAllocatedIndex INTEGER NOT NULL
          CHECK (lastAllocatedIndex BETWEEN -1 AND 2147483647)
      );

      INSERT INTO coco_cashu_keypair_derivation_allocations (purpose, lastAllocatedIndex)
      SELECT purpose, MAX(derivationIndex)
      FROM coco_cashu_keypairs
      WHERE derivationIndex IS NOT NULL
      GROUP BY purpose;
    `
  },
  {
    id: "039_send_operation_revision",
    sql: `
      ALTER TABLE coco_cashu_send_operations
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
    `
  },
  {
    id: "040_send_execution_memo",
    sql: `
      ALTER TABLE coco_cashu_send_operations
        ADD COLUMN executionMemo TEXT;
    `
  },
  {
    id: "041_send_reclaim_data",
    sql: `ALTER TABLE coco_cashu_send_operations ADD COLUMN reclaimDataJson TEXT;`
  },
  {
    id: "042_receive_operation_revision",
    run: async (db) => {
      const columns = await db.all("PRAGMA table_info(coco_cashu_receive_operations)");
      if (!columns.some((column) => column.name === "revision")) {
        await db.exec("ALTER TABLE coco_cashu_receive_operations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)");
      }
    }
  },
  {
    id: "043_wallet_authority",
    sql: `
      CREATE TABLE coco_cashu_wallet_authority (
        namespace TEXT PRIMARY KEY,
        singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
        ownerId TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation > 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'released'))
      );
    `
  },
  {
    id: "044_operation_id_ownership",
    run: async (db) => {
      await db.exec(`
      CREATE TABLE coco_cashu_operation_ids (
        id TEXT PRIMARY KEY,
        ownerType TEXT NOT NULL CHECK (ownerType IN (
          'send', 'receive', 'mint', 'melt',
          'payment-request-receive', 'payment-request-receive-attempt'
        ))
      );
      `);
      const sources = [
        ["coco_cashu_send_operations", "send"],
        ["coco_cashu_receive_operations", "receive"],
        ["coco_cashu_mint_operations", "mint"],
        ["coco_cashu_melt_operations", "melt"],
        ["coco_cashu_payment_request_receive_operations", "payment-request-receive"],
        ["coco_cashu_payment_request_receive_attempts", "payment-request-receive-attempt"]
      ];
      for (const [tableName, ownerType] of sources) {
        const rows = await db.all(`SELECT id FROM ${tableName} ORDER BY id`);
        for (const row of rows) {
          const existing = await db.get("SELECT ownerType FROM coco_cashu_operation_ids WHERE id = ?", [row.id]);
          if (existing) {
            throw new Error(`Historical operation ID collision for ${row.id}: ${existing.ownerType} and ${ownerType}`);
          }
          await db.run("INSERT INTO coco_cashu_operation_ids (id, ownerType) VALUES (?, ?)", [
            row.id,
            ownerType
          ]);
        }
      }
    }
  }
];
async function ensureSchema(db) {
  await ensureSchemaUpTo(db);
}
async function ensureSchemaUpTo(db, stopBeforeId) {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS coco_cashu_migrations (
      id        TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );
  `);
  await reconcileMigrationAliases(db);
  const appliedRows = await db.all("SELECT id FROM coco_cashu_migrations ORDER BY id ASC");
  const applied = new Set(appliedRows.map((r) => r.id));
  for (const migration of MIGRATIONS) {
    if (stopBeforeId && migration.id === stopBeforeId)
      break;
    if (applied.has(migration.id))
      continue;
    await db.transaction(async (tx) => {
      if (migration.sql) {
        await tx.exec(migration.sql);
      }
      if (migration.run) {
        await migration.run(tx);
      }
      await tx.run("INSERT INTO coco_cashu_migrations (id, appliedAt) VALUES (?, ?)", [
        migration.id,
        getUnixTimeSeconds()
      ]);
    });
  }
  await reconcileMigrationAliases(db);
}

// packages/sql-storage/src/repositories/MintRepository.ts
class SqliteMintRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async isTrustedMint(mintUrl) {
    const row = await this.db.get("SELECT trusted FROM coco_cashu_mints WHERE mintUrl = ? LIMIT 1", [mintUrl]);
    return row?.trusted === 1;
  }
  async getMintByUrl(mintUrl) {
    const mint = await this.findMintByUrl(mintUrl);
    if (!mint) {
      throw new Error(`Mint not found: ${mintUrl}`);
    }
    return mint;
  }
  async findMintByUrl(mintUrl) {
    const row = await this.db.get("SELECT mintUrl, name, mintInfo, trusted, createdAt, updatedAt FROM coco_cashu_mints WHERE mintUrl = ? LIMIT 1", [mintUrl]);
    if (!row)
      return null;
    return {
      mintUrl: row.mintUrl,
      name: row.name,
      mintInfo: JSON.parse(row.mintInfo),
      trusted: row.trusted === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
  async getAllMints() {
    const rows = await this.db.all("SELECT mintUrl, name, mintInfo, trusted, createdAt, updatedAt FROM coco_cashu_mints");
    return rows.map((r) => ({
      mintUrl: r.mintUrl,
      name: r.name,
      mintInfo: JSON.parse(r.mintInfo),
      trusted: r.trusted === 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  }
  async getAllTrustedMints() {
    const rows = await this.db.all("SELECT mintUrl, name, mintInfo, trusted, createdAt, updatedAt FROM coco_cashu_mints WHERE trusted = 1");
    return rows.map((r) => ({
      mintUrl: r.mintUrl,
      name: r.name,
      mintInfo: JSON.parse(r.mintInfo),
      trusted: r.trusted === 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  }
  async addNewMint(mint) {
    await this.db.run(`INSERT INTO coco_cashu_mints (mintUrl, name, mintInfo, trusted, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl) DO UPDATE SET
         name=excluded.name,
         mintInfo=excluded.mintInfo,
         trusted=excluded.trusted,
         createdAt=excluded.createdAt,
         updatedAt=excluded.updatedAt`, [
      mint.mintUrl,
      mint.name,
      JSON.stringify(mint.mintInfo),
      mint.trusted ? 1 : 0,
      mint.createdAt,
      mint.updatedAt
    ]);
  }
  async addOrUpdateMint(mint) {
    await this.db.run(`INSERT INTO coco_cashu_mints (mintUrl, name, mintInfo, trusted, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl) DO UPDATE SET
         name=excluded.name,
         mintInfo=excluded.mintInfo,
         trusted=excluded.trusted,
         updatedAt=excluded.updatedAt`, [
      mint.mintUrl,
      mint.name,
      JSON.stringify(mint.mintInfo),
      mint.trusted ? 1 : 0,
      mint.createdAt,
      mint.updatedAt
    ]);
  }
  async updateMint(mint) {
    await this.addNewMint(mint);
  }
  async setMintTrusted(mintUrl, trusted) {
    await this.db.run("UPDATE coco_cashu_mints SET trusted = ? WHERE mintUrl = ?", [
      trusted ? 1 : 0,
      mintUrl
    ]);
  }
  async deleteMint(mintUrl) {
    await this.db.run("DELETE FROM coco_cashu_mints WHERE mintUrl = ?", [mintUrl]);
  }
}

// packages/sql-storage/src/utils.ts
function getUnixTimeSeconds2() {
  return Math.floor(Date.now() / 1000);
}
function hexToBytes(hexString) {
  if (!/^[0-9a-fA-F]+$/.test(hexString)) {
    throw new Error("Invalid hex string: contains non-hex characters");
  }
  if (hexString.length % 2 !== 0) {
    throw new Error(`Invalid hex string: odd length (${hexString.length})`);
  }
  const matches = hexString.match(/.{2}/g);
  if (!matches) {
    throw new Error("Failed to parse hex string");
  }
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function assertFieldPresent(value, field, operationId) {
  if (value == null) {
    throw new Error(`Invalid operation row ${operationId}: missing required field "${field}"`);
  }
  return value;
}

// packages/sql-storage/src/repositories/KeysetRepository.ts
class SqliteKeysetRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getKeysetsByMintUrl(mintUrl) {
    const rows = await this.db.all("SELECT mintUrl, id, unit, keypairs, active, feePpk, updatedAt FROM coco_cashu_keysets WHERE mintUrl = ?", [mintUrl]);
    return rows.map((r) => ({
      mintUrl: r.mintUrl,
      id: r.id,
      unit: r.unit ?? "",
      keypairs: JSON.parse(r.keypairs),
      active: !!r.active,
      feePpk: r.feePpk,
      updatedAt: r.updatedAt
    }));
  }
  async getKeysetById(mintUrl, id) {
    const row = await this.db.get("SELECT mintUrl, id, unit, keypairs, active, feePpk, updatedAt FROM coco_cashu_keysets WHERE mintUrl = ? AND id = ? LIMIT 1", [mintUrl, id]);
    if (!row)
      return null;
    return {
      mintUrl: row.mintUrl,
      id: row.id,
      unit: row.unit ?? "",
      keypairs: JSON.parse(row.keypairs),
      active: !!row.active,
      feePpk: row.feePpk,
      updatedAt: row.updatedAt
    };
  }
  async updateKeyset(keyset) {
    const now = getUnixTimeSeconds2();
    const existing = await this.db.get("SELECT keypairs FROM coco_cashu_keysets WHERE mintUrl = ? AND id = ? LIMIT 1", [keyset.mintUrl, keyset.id]);
    if (!existing) {
      await this.db.run("INSERT INTO coco_cashu_keysets (mintUrl, id, unit, keypairs, active, feePpk, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        keyset.mintUrl,
        keyset.id,
        keyset.unit,
        JSON.stringify({}),
        keyset.active ? 1 : 0,
        keyset.feePpk,
        now
      ]);
      return;
    }
    await this.db.run("UPDATE coco_cashu_keysets SET unit = ?, active = ?, feePpk = ?, updatedAt = ? WHERE mintUrl = ? AND id = ?", [keyset.unit, keyset.active ? 1 : 0, keyset.feePpk, now, keyset.mintUrl, keyset.id]);
  }
  async addKeyset(keyset) {
    const now = getUnixTimeSeconds2();
    await this.db.run(`INSERT INTO coco_cashu_keysets (mintUrl, id, unit, keypairs, active, feePpk, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, id) DO UPDATE SET
         unit=excluded.unit,
         keypairs=excluded.keypairs,
         active=excluded.active,
         feePpk=excluded.feePpk,
         updatedAt=excluded.updatedAt`, [
      keyset.mintUrl,
      keyset.id,
      keyset.unit,
      JSON.stringify(keyset.keypairs ?? {}),
      keyset.active ? 1 : 0,
      keyset.feePpk,
      now
    ]);
  }
  async deleteKeyset(mintUrl, keysetId) {
    await this.db.run("DELETE FROM coco_cashu_keysets WHERE mintUrl = ? AND id = ?", [
      mintUrl,
      keysetId
    ]);
  }
}

// packages/sql-storage/src/repositories/KeyRingRepository.ts
var DEFAULT_KEYPAIR_PURPOSE = "p2pk";
function rowToKeypair(row) {
  return {
    publicKeyHex: row.publicKey,
    secretKey: hexToBytes(row.secretKey),
    derivationIndex: row.derivationIndex ?? undefined,
    purpose: row.purpose ?? DEFAULT_KEYPAIR_PURPOSE
  };
}

class SqliteKeyRingRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getPersistedKeyPair(publicKey, purpose) {
    const row = await this.db.get(`SELECT publicKey, secretKey, derivationIndex, purpose
       FROM coco_cashu_keypairs
       WHERE publicKey = ? ${purpose ? "AND purpose = ?" : ""} LIMIT 1`, purpose ? [publicKey, purpose] : [publicKey]);
    if (!row)
      return null;
    try {
      return rowToKeypair(row);
    } catch (error) {
      throw new Error(`Failed to parse secret key for public key ${publicKey}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  async setPersistedKeyPair(keyPair) {
    const secretKeyHex = bytesToHex(keyPair.secretKey);
    const purpose = keyPair.purpose ?? DEFAULT_KEYPAIR_PURPOSE;
    await this.db.run(`INSERT INTO coco_cashu_keypairs (publicKey, secretKey, createdAt, derivationIndex, purpose)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(publicKey) DO UPDATE SET
         secretKey=excluded.secretKey,
         derivationIndex=COALESCE(excluded.derivationIndex, coco_cashu_keypairs.derivationIndex),
         purpose=excluded.purpose`, [keyPair.publicKeyHex, secretKeyHex, Date.now(), keyPair.derivationIndex ?? null, purpose]);
  }
  async deletePersistedKeyPair(publicKey, purpose) {
    await this.db.run(`DELETE FROM coco_cashu_keypairs WHERE publicKey = ? ${purpose ? "AND purpose = ?" : ""}`, purpose ? [publicKey, purpose] : [publicKey]);
  }
  async getAllPersistedKeyPairs(purpose) {
    const rows = await this.db.all(`SELECT publicKey, secretKey, derivationIndex, purpose
       FROM coco_cashu_keypairs ${purpose ? "WHERE purpose = ?" : ""}`, purpose ? [purpose] : []);
    return rows.map((row) => {
      try {
        return rowToKeypair(row);
      } catch (error) {
        throw new Error(`Failed to parse secret key for public key ${row.publicKey}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    });
  }
  async getLatestKeyPair(purpose) {
    const row = await this.db.get(`SELECT publicKey, secretKey, derivationIndex, purpose
       FROM coco_cashu_keypairs
       ${purpose ? "WHERE purpose = ?" : ""}
       ORDER BY createdAt DESC LIMIT 1`, purpose ? [purpose] : []);
    if (!row)
      return null;
    try {
      return rowToKeypair(row);
    } catch (error) {
      throw new Error(`Failed to parse latest secret key for public key ${row.publicKey}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  async getLastAllocatedIndex(purpose) {
    const row = await this.db.get(`SELECT lastAllocatedIndex FROM coco_cashu_keypair_derivation_allocations WHERE purpose = ?`, [purpose]);
    return row?.lastAllocatedIndex ?? null;
  }
  async getHighestStoredDerivationIndex(purpose) {
    const row = await this.db.get(`SELECT MAX(derivationIndex) AS derivationIndex FROM coco_cashu_keypairs WHERE purpose = ?`, [purpose]);
    return row?.derivationIndex ?? null;
  }
  async setLastAllocatedIndex(purpose, derivationIndex) {
    await this.db.run(`INSERT INTO coco_cashu_keypair_derivation_allocations (purpose, lastAllocatedIndex)
       VALUES (?, ?)
       ON CONFLICT(purpose) DO UPDATE SET lastAllocatedIndex=excluded.lastAllocatedIndex`, [purpose, derivationIndex]);
  }
}

// packages/sql-storage/src/repositories/CounterRepository.ts
class SqliteCounterRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getCounter(mintUrl, keysetId) {
    const row = await this.db.get("SELECT counter FROM coco_cashu_counters WHERE mintUrl = ? AND keysetId = ? LIMIT 1", [mintUrl, keysetId]);
    if (!row)
      return null;
    return { mintUrl, keysetId, counter: row.counter };
  }
  async setCounter(mintUrl, keysetId, counter) {
    await this.db.run(`INSERT INTO coco_cashu_counters (mintUrl, keysetId, counter)
       VALUES (?, ?, ?)
       ON CONFLICT(mintUrl, keysetId) DO UPDATE SET counter = excluded.counter`, [mintUrl, keysetId, counter]);
  }
}

// packages/sql-storage/src/repositories/ProofRepository.ts
import {
  DEFAULT_UNIT,
  deserializeAmount,
  normalizeUnit,
  serializeAmount
} from "@cashu/coco-core/adapter";
var MAX_PROOF_SECRET_LOOKUP_BATCH_SIZE = 900;
var PROOF_COLUMNS = "mintUrl, id, unit, amount, secret, C, dleqJson, witnessJson, state, usedByOperationId, createdByOperationId";
function normalizeProofUnit(proof) {
  return normalizeUnit(proof.unit);
}
function getUnitFilter(filter) {
  const units = [...filter?.units ?? [], ...filter?.unit ? [filter.unit] : []];
  if (units.length === 0)
    return;
  return Array.from(new Set(units.map((unit) => normalizeUnit(unit))));
}
function appendUnitFilter(sql, params, filter) {
  const units = getUnitFilter(filter);
  if (!units || units.length === 0)
    return sql;
  if (units.length === 1) {
    const [unit] = units;
    params.push(unit);
    return `${sql} AND unit = ?`;
  }
  params.push(...units);
  return `${sql} AND unit IN (${units.map(() => "?").join(", ")})`;
}
function rowToProof(r) {
  const base = {
    id: r.id,
    amount: deserializeAmount(r.amount),
    secret: r.secret,
    C: r.C,
    ...r.dleqJson ? { dleq: JSON.parse(r.dleqJson) } : {},
    ...r.witnessJson ? { witness: JSON.parse(r.witnessJson) } : {}
  };
  return {
    ...base,
    mintUrl: r.mintUrl,
    unit: normalizeUnit(r.unit ?? undefined, { defaultUnit: DEFAULT_UNIT }),
    state: r.state,
    ...r.usedByOperationId ? { usedByOperationId: r.usedByOperationId } : {},
    ...r.createdByOperationId ? { createdByOperationId: r.createdByOperationId } : {}
  };
}

class SqliteProofRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async saveProofs(mintUrl, proofs) {
    if (!proofs || proofs.length === 0)
      return;
    const now = getUnixTimeSeconds2();
    const normalizedProofs = proofs.map((proof) => ({
      ...proof,
      unit: normalizeProofUnit(proof)
    }));
    await this.db.transaction(async (tx) => {
      const selectSql = "SELECT 1 AS x FROM coco_cashu_proofs WHERE mintUrl = ? AND secret = ? LIMIT 1";
      for (const p of normalizedProofs) {
        const exists = await tx.get(selectSql, [mintUrl, p.secret]);
        if (exists) {
          throw new Error(`Proof with secret already exists: ${p.secret}`);
        }
      }
      const insertSql = "INSERT INTO coco_cashu_proofs (mintUrl, id, unit, amount, secret, C, dleqJson, witnessJson, state, createdAt, usedByOperationId, createdByOperationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      for (const p of normalizedProofs) {
        const dleqJson = p.dleq ? JSON.stringify(p.dleq) : null;
        const witnessJson = p.witness ? JSON.stringify(p.witness) : null;
        await tx.run(insertSql, [
          mintUrl,
          p.id,
          p.unit,
          serializeAmount(p.amount),
          p.secret,
          p.C,
          dleqJson,
          witnessJson,
          p.state,
          now,
          p.usedByOperationId ?? null,
          p.createdByOperationId ?? null
        ]);
      }
    });
  }
  async getReadyProofs(mintUrl, filter) {
    const params = [mintUrl];
    const rows = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND state = 'ready'`, params, filter), params);
    return rows.map(rowToProof);
  }
  async getInflightProofs(mintUrls, filter) {
    if (!mintUrls || mintUrls.length === 0) {
      const params2 = [];
      const rows2 = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE state = 'inflight'`, params2, filter), params2);
      return rows2.map(rowToProof);
    }
    const mintUrlList = mintUrls.map((url) => url.trim()).filter((url) => url.length > 0);
    if (mintUrlList.length === 0)
      return [];
    const uniqueMintUrls = Array.from(new Set(mintUrlList));
    const placeholders = uniqueMintUrls.map(() => "?").join(", ");
    const params = uniqueMintUrls;
    const rows = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE state = 'inflight' AND mintUrl IN (${placeholders})`, params, filter), params);
    return rows.map(rowToProof);
  }
  async getAllReadyProofs(filter) {
    const params = [];
    const rows = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE state = 'ready'`, params, filter), params);
    return rows.map(rowToProof);
  }
  async getProofsByKeysetId(mintUrl, keysetId, filter) {
    const params = [mintUrl, keysetId];
    const rows = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND id = ? AND state = 'ready'`, params, filter), params);
    return rows.map(rowToProof);
  }
  async setProofState(mintUrl, secrets, state) {
    if (!secrets || secrets.length === 0)
      return;
    await this.db.transaction(async (tx) => {
      const updateSql = "UPDATE coco_cashu_proofs SET state = ? WHERE mintUrl = ? AND secret = ?";
      for (const s of secrets) {
        await tx.run(updateSql, [state, mintUrl, s]);
      }
    });
  }
  async deleteProofs(mintUrl, secrets) {
    if (!secrets || secrets.length === 0)
      return;
    await this.db.transaction(async (tx) => {
      const delSql = "DELETE FROM coco_cashu_proofs WHERE mintUrl = ? AND secret = ?";
      for (const s of secrets) {
        await tx.run(delSql, [mintUrl, s]);
      }
    });
  }
  async wipeProofsByKeysetId(mintUrl, keysetId) {
    await this.db.run("DELETE FROM coco_cashu_proofs WHERE mintUrl = ? AND id = ?;", [
      mintUrl,
      keysetId
    ]);
  }
  async reserveProofs(mintUrl, secrets, operationId) {
    if (!secrets || secrets.length === 0)
      return;
    await this.db.transaction(async (tx) => {
      const selectSql = "SELECT secret, state, usedByOperationId FROM coco_cashu_proofs WHERE mintUrl = ? AND secret = ?";
      for (const secret of secrets) {
        const row = await tx.get(selectSql, [mintUrl, secret]);
        if (!row) {
          throw new Error(`Proof with secret not found: ${secret}`);
        }
        if (row.state !== "ready") {
          throw new Error(`Proof is not ready, cannot reserve: ${secret}`);
        }
        if (row.usedByOperationId) {
          throw new Error(`Proof already reserved by operation ${row.usedByOperationId}: ${secret}`);
        }
      }
      const updateSql = "UPDATE coco_cashu_proofs SET usedByOperationId = ? WHERE mintUrl = ? AND secret = ?";
      for (const secret of secrets) {
        await tx.run(updateSql, [operationId, mintUrl, secret]);
      }
    });
  }
  async releaseProofs(mintUrl, secrets) {
    if (!secrets || secrets.length === 0)
      return;
    await this.db.transaction(async (tx) => {
      const updateSql = "UPDATE coco_cashu_proofs SET usedByOperationId = NULL WHERE mintUrl = ? AND secret = ?";
      for (const secret of secrets) {
        await tx.run(updateSql, [mintUrl, secret]);
      }
    });
  }
  async setCreatedByOperation(mintUrl, secrets, operationId) {
    if (!secrets || secrets.length === 0)
      return;
    await this.db.transaction(async (tx) => {
      const updateSql = "UPDATE coco_cashu_proofs SET createdByOperationId = ? WHERE mintUrl = ? AND secret = ?";
      for (const secret of secrets) {
        await tx.run(updateSql, [operationId, mintUrl, secret]);
      }
    });
  }
  async getProofBySecret(mintUrl, secret) {
    const row = await this.db.get(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND secret = ?`, [mintUrl, secret]);
    return row ? rowToProof(row) : null;
  }
  async getProofsBySecrets(mintUrl, secrets) {
    if (!secrets || secrets.length === 0) {
      return [];
    }
    const uniqueSecrets = Array.from(new Set(secrets));
    const proofsBySecret = new Map;
    for (let i = 0;i < uniqueSecrets.length; i += MAX_PROOF_SECRET_LOOKUP_BATCH_SIZE) {
      const secretBatch = uniqueSecrets.slice(i, i + MAX_PROOF_SECRET_LOOKUP_BATCH_SIZE);
      const placeholders = secretBatch.map(() => "?").join(", ");
      const rows = await this.db.all(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND secret IN (${placeholders})`, [mintUrl, ...secretBatch]);
      for (const row of rows) {
        proofsBySecret.set(row.secret, rowToProof(row));
      }
    }
    return uniqueSecrets.flatMap((secret) => {
      const proof = proofsBySecret.get(secret);
      return proof ? [proof] : [];
    });
  }
  async getProofsByOperationId(mintUrl, operationId) {
    const rows = await this.db.all(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND (usedByOperationId = ? OR createdByOperationId = ?)`, [mintUrl, operationId, operationId]);
    return rows.map(rowToProof);
  }
  async getAvailableProofs(mintUrl, filter) {
    const params = [mintUrl];
    const rows = await this.db.all(appendUnitFilter(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE mintUrl = ? AND state = 'ready' AND usedByOperationId IS NULL`, params, filter), params);
    return rows.map(rowToProof);
  }
  async getReservedProofs() {
    const rows = await this.db.all(`SELECT ${PROOF_COLUMNS} FROM coco_cashu_proofs WHERE state = 'ready' AND usedByOperationId IS NOT NULL`);
    return rows.map(rowToProof);
  }
}

// packages/sql-storage/src/repositories/MeltQuoteRepository.ts
import {
  deserializeAmount as deserializeAmount2,
  deserializeBlindedSignatures,
  normalizeMintUrl as normalizeMintUrl2,
  QuoteIdentityConflictError,
  serializeAmount as serializeAmount2,
  serializeBlindedSignatures,
  stringifyJson
} from "@cashu/coco-core/adapter";
function rowToQuote(row) {
  const base = {
    mintUrl: row.mintUrl,
    method: row.method,
    quoteId: row.quoteId,
    quote: row.quoteId,
    state: row.state,
    request: row.request,
    amount: deserializeAmount2(row.amount),
    unit: row.unit,
    expiry: row.expiry,
    change: row.changeJson ? deserializeBlindedSignatures(JSON.parse(row.changeJson)) : undefined,
    lastObservedRemoteState: row.lastObservedRemoteState ?? undefined,
    lastObservedRemoteStateAt: row.lastObservedRemoteStateAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (row.method === "onchain") {
    const feeOptions = row.fee_options_json ? JSON.parse(row.fee_options_json) : undefined;
    if (!Array.isArray(feeOptions) || feeOptions.length === 0) {
      throw new Error(`Stored onchain melt quote ${row.quoteId} is missing fee_options`);
    }
    return {
      ...base,
      method: "onchain",
      fee_options: feeOptions.map((option) => ({
        ...option,
        fee_reserve: deserializeAmount2(option.fee_reserve)
      })),
      outpoint: row.outpoint ?? undefined
    };
  }
  if (row.fee_reserve === null || row.fee_reserve === undefined) {
    throw new Error(`Stored BOLT melt quote ${row.quoteId} is missing fee_reserve`);
  }
  return {
    ...base,
    method: row.method,
    fee_reserve: deserializeAmount2(row.fee_reserve),
    payment_preimage: row.payment_preimage ?? undefined
  };
}

class SqliteMeltQuoteRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getMeltQuoteById(identity) {
    const normalizedMintUrl = normalizeMintUrl2(identity.mintUrl);
    const rows = await this.db.all(`SELECT mintUrl, method, quoteId, state, request, amount, unit, fee_reserve, expiry,
              payment_preimage, fee_options_json, outpoint, changeJson, lastObservedRemoteState, lastObservedRemoteStateAt,
              createdAt, updatedAt
       FROM coco_cashu_melt_quotes
       WHERE mintUrl = ? AND quoteId = ?`, [normalizedMintUrl, identity.quoteId]);
    if (rows.length > 1) {
      throw new QuoteIdentityConflictError("melt", normalizedMintUrl, identity.quoteId, rows.map((row) => row.method));
    }
    return rows[0] ? rowToQuote(rows[0]) : null;
  }
  async getMeltQuote(mintUrl, method, quoteId) {
    const row = await this.db.get(`SELECT mintUrl, method, quoteId, state, request, amount, unit, fee_reserve, expiry,
              payment_preimage, fee_options_json, outpoint, changeJson, lastObservedRemoteState, lastObservedRemoteStateAt,
              createdAt, updatedAt
       FROM coco_cashu_melt_quotes
       WHERE mintUrl = ? AND method = ? AND quoteId = ? LIMIT 1`, [normalizeMintUrl2(mintUrl), method, quoteId]);
    return row ? rowToQuote(row) : null;
  }
  async upsertMeltQuote(quote) {
    const now = Date.now();
    const normalizedMintUrl = normalizeMintUrl2(quote.mintUrl);
    const identityOwner = await this.getMeltQuoteById({
      mintUrl: normalizedMintUrl,
      quoteId: quote.quoteId
    });
    if (identityOwner && identityOwner.method !== quote.method) {
      throw new QuoteIdentityConflictError("melt", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Melt quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
    }
    const row = {
      mintUrl: normalizedMintUrl,
      method: quote.method,
      quoteId: quote.quoteId,
      state: quote.state,
      request: quote.request,
      amount: serializeAmount2(quote.amount),
      unit: quote.unit,
      fee_reserve: quote.method === "onchain" ? null : serializeAmount2(quote.fee_reserve),
      expiry: quote.expiry,
      payment_preimage: quote.method === "onchain" ? null : quote.payment_preimage ?? null,
      fee_options_json: quote.method === "onchain" ? stringifyJson(quote.fee_options.map((option) => ({
        ...option,
        fee_reserve: serializeAmount2(option.fee_reserve)
      }))) : null,
      outpoint: quote.method === "onchain" ? quote.outpoint ?? null : null,
      changeJson: quote.change ? stringifyJson(serializeBlindedSignatures(quote.change)) : null,
      lastObservedRemoteState: quote.lastObservedRemoteState ?? quote.state,
      lastObservedRemoteStateAt: quote.lastObservedRemoteStateAt ?? now,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt || now
    };
    const persisted = await this.db.get(`INSERT INTO coco_cashu_melt_quotes
         (mintUrl, method, quoteId, state, request, amount, unit, fee_reserve, expiry,
          payment_preimage, fee_options_json, outpoint, changeJson, lastObservedRemoteState,
          lastObservedRemoteStateAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, method, quoteId) DO UPDATE SET
         state=excluded.state,
         request=excluded.request,
         amount=excluded.amount,
         unit=excluded.unit,
         fee_reserve=excluded.fee_reserve,
         expiry=excluded.expiry,
         payment_preimage=excluded.payment_preimage,
         fee_options_json=excluded.fee_options_json,
         outpoint=excluded.outpoint,
         changeJson=excluded.changeJson,
         lastObservedRemoteState=excluded.lastObservedRemoteState,
         lastObservedRemoteStateAt=excluded.lastObservedRemoteStateAt,
         updatedAt=excluded.updatedAt
       RETURNING mintUrl, method, quoteId, state, request, amount, unit, fee_reserve, expiry,
                 payment_preimage, fee_options_json, outpoint, changeJson,
                 lastObservedRemoteState, lastObservedRemoteStateAt, createdAt, updatedAt`, [
      row.mintUrl,
      row.method,
      row.quoteId,
      row.state,
      row.request,
      row.amount,
      row.unit,
      row.fee_reserve ?? null,
      row.expiry,
      row.payment_preimage ?? null,
      row.fee_options_json ?? null,
      row.outpoint ?? null,
      row.changeJson ?? null,
      row.lastObservedRemoteState ?? null,
      row.lastObservedRemoteStateAt ?? null,
      row.createdAt,
      row.updatedAt
    ]);
    if (!persisted) {
      throw new Error(`Melt quote ${quote.quoteId} for ${quote.method} at ${normalizedMintUrl} was not returned after persistence`);
    }
    return rowToQuote(persisted);
  }
  async getPendingMeltQuotes(method) {
    const rows = await this.db.all(`SELECT mintUrl, method, quoteId, state, request, amount, unit, fee_reserve, expiry,
              payment_preimage, fee_options_json, outpoint, changeJson, lastObservedRemoteState, lastObservedRemoteStateAt,
              createdAt, updatedAt
       FROM coco_cashu_melt_quotes
       WHERE state != 'PAID' ${method ? "AND method = ?" : ""}`, method ? [method] : []);
    return rows.map(rowToQuote);
  }
}

// packages/sql-storage/src/repositories/MintQuoteRepository.ts
import {
  deserializeAmount as deserializeAmount3,
  deriveBolt11MintQuoteState,
  getMintQuoteAmount,
  getMintQuoteRemoteState,
  isMintQuotePending,
  isStatefulMintQuote,
  normalizeMintUrl as normalizeMintUrl3,
  QuoteIdentityConflictError as QuoteIdentityConflictError2,
  serializeAmount as serializeAmount3,
  stringifyJson as stringifyJson2
} from "@cashu/coco-core/adapter";
function parseQuoteData(value) {
  if (!value)
    return {};
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" ? parsed : {};
}
function rowToMintQuote(row) {
  const quoteData = parseQuoteData(row.quoteDataJson);
  if (row.method === "onchain" || row.method === "bolt12") {
    const pubkey = quoteData.pubkey ?? row.pubkey ?? "";
    const amountValue = quoteData.amount ?? row.amount ?? undefined;
    const amount2 = row.method === "bolt12" && amountValue !== undefined ? deserializeAmount3(amountValue) : undefined;
    return {
      mintUrl: row.mintUrl,
      method: row.method,
      quoteId: row.quoteId,
      quote: row.quoteId,
      request: row.request,
      unit: row.unit,
      ...amount2 !== undefined ? { amount: amount2 } : {},
      expiry: row.expiry,
      pubkey,
      reusable: true,
      amountPaid: deserializeAmount3(row.amountPaid),
      amountIssued: deserializeAmount3(row.amountIssued),
      remoteUpdatedAt: row.remoteUpdatedAt,
      quoteData: {
        pubkey,
        ...amount2 !== undefined ? { amount: amount2 } : {}
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
  const amount = deserializeAmount3(quoteData.amount ?? row.amount ?? 0);
  const amountPaid = deserializeAmount3(row.amountPaid);
  const amountIssued = deserializeAmount3(row.amountIssued);
  const state = deriveBolt11MintQuoteState(amountPaid, amountIssued);
  return {
    mintUrl: row.mintUrl,
    method: "bolt11",
    quoteId: row.quoteId,
    quote: row.quoteId,
    state,
    request: row.request,
    amount,
    unit: row.unit,
    expiry: row.expiry,
    pubkey: row.pubkey ?? undefined,
    reusable: false,
    amountPaid,
    amountIssued,
    remoteUpdatedAt: row.remoteUpdatedAt,
    quoteData: { amount },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function serializeQuoteData(quote) {
  if (isStatefulMintQuote(quote)) {
    return stringifyJson2({ amount: serializeAmount3(quote.quoteData.amount) });
  }
  if (quote.method === "bolt12") {
    const amount = quote.quoteData.amount ?? quote.amount;
    return stringifyJson2({
      pubkey: quote.quoteData.pubkey,
      ...amount !== undefined ? { amount: serializeAmount3(amount) } : {}
    });
  }
  return stringifyJson2({
    pubkey: quote.quoteData.pubkey
  });
}

class SqliteMintQuoteRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getMintQuoteById(identity) {
    const normalizedMintUrl = normalizeMintUrl3(identity.mintUrl);
    const rows = await this.db.all(`SELECT mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey,
              quoteDataJson, amountPaid, amountIssued, remoteUpdatedAt, reusable,
              createdAt, updatedAt
       FROM coco_cashu_canonical_mint_quotes
       WHERE mintUrl = ? AND quoteId = ?`, [normalizedMintUrl, identity.quoteId]);
    if (rows.length > 1) {
      throw new QuoteIdentityConflictError2("mint", normalizedMintUrl, identity.quoteId, rows.map((row) => row.method));
    }
    return rows[0] ? rowToMintQuote(rows[0]) : null;
  }
  async getMintQuote(mintUrl, method, quoteId) {
    const row = await this.db.get(`SELECT mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey,
              quoteDataJson, amountPaid, amountIssued, remoteUpdatedAt, reusable,
              createdAt, updatedAt
       FROM coco_cashu_canonical_mint_quotes
       WHERE mintUrl = ? AND method = ? AND quoteId = ? LIMIT 1`, [normalizeMintUrl3(mintUrl), method, quoteId]);
    return row ? rowToMintQuote(row) : null;
  }
  async upsertMintQuote(quote) {
    const now = Date.now();
    const normalizedMintUrl = normalizeMintUrl3(quote.mintUrl);
    const identityOwner = await this.getMintQuoteById({
      mintUrl: normalizedMintUrl,
      quoteId: quote.quoteId
    });
    if (identityOwner && identityOwner.method !== quote.method) {
      throw new QuoteIdentityConflictError2("mint", normalizedMintUrl, quote.quoteId, [identityOwner.method, quote.method], `Mint quote ${quote.quoteId} at ${normalizedMintUrl} already exists for method ${identityOwner.method}`);
    }
    const state = getMintQuoteRemoteState(quote) ?? null;
    const amount = getMintQuoteAmount(quote);
    await this.db.run(`INSERT INTO coco_cashu_canonical_mint_quotes
         (mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey, quoteDataJson,
          amountPaid, amountIssued, remoteUpdatedAt, reusable, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl, method, quoteId) DO UPDATE SET
         state=excluded.state,
         request=excluded.request,
         amount=excluded.amount,
         unit=excluded.unit,
         expiry=excluded.expiry,
         pubkey=excluded.pubkey,
         quoteDataJson=excluded.quoteDataJson,
         amountPaid=excluded.amountPaid,
         amountIssued=excluded.amountIssued,
         remoteUpdatedAt=excluded.remoteUpdatedAt,
         reusable=excluded.reusable,
         updatedAt=excluded.updatedAt`, [
      normalizedMintUrl,
      quote.method,
      quote.quoteId,
      state,
      quote.request,
      amount ? serializeAmount3(amount) : null,
      quote.unit,
      quote.expiry,
      quote.pubkey ?? null,
      serializeQuoteData(quote),
      serializeAmount3(quote.amountPaid),
      serializeAmount3(quote.amountIssued),
      quote.remoteUpdatedAt,
      quote.reusable ? 1 : 0,
      quote.createdAt,
      quote.updatedAt || now
    ]);
  }
  async setMintQuoteState(mintUrl, method, quoteId, state, observedAt = Date.now()) {
    await this.db.run(`UPDATE coco_cashu_canonical_mint_quotes
       SET state = CASE
             WHEN ? = 'ISSUED' OR amountIssued = amount THEN 'ISSUED'
             WHEN ? IN ('PAID', 'ISSUED') OR amountPaid = amount THEN 'PAID'
             ELSE 'UNPAID'
           END,
           amountPaid = CASE WHEN ? IN ('PAID', 'ISSUED') THEN amount ELSE amountPaid END,
           amountIssued = CASE WHEN ? = 'ISSUED' THEN amount ELSE amountIssued END,
           updatedAt = CASE WHEN updatedAt > ? THEN updatedAt ELSE ? END
       WHERE mintUrl = ? AND method = ? AND quoteId = ?
         AND method = 'bolt11'
         AND amount IS NOT NULL
         AND remoteUpdatedAt IS NULL
         AND (
           (amountPaid = '0' AND amountIssued = '0') OR
           (amountPaid = amount AND amountIssued = '0') OR
           (amountPaid = amount AND amountIssued = amount)
         )`, [
      state,
      state,
      state,
      state,
      observedAt,
      observedAt,
      normalizeMintUrl3(mintUrl),
      method,
      quoteId
    ]);
  }
  async getPendingMintQuotes(method) {
    const rows = await this.db.all(`SELECT mintUrl, method, quoteId, state, request, amount, unit, expiry, pubkey,
              quoteDataJson, amountPaid, amountIssued, remoteUpdatedAt, reusable,
              createdAt, updatedAt
       FROM coco_cashu_canonical_mint_quotes
       ${method ? "WHERE method = ?" : ""}`, method ? [method] : []);
    return rows.map(rowToMintQuote).filter(isMintQuotePending);
  }
}

// packages/sql-storage/src/repositories/LegacyMintQuoteRepository.ts
import { Amount } from "@cashu/cashu-ts";
import {
  deserializeAmount as deserializeAmount4,
  normalizeMintUrl as normalizeMintUrl4
} from "@cashu/coco-core/adapter";

class SqliteLegacyMintQuoteRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getPendingLegacyMintQuotes(mintUrl) {
    const normalizedMintUrl = mintUrl ? normalizeMintUrl4(mintUrl) : undefined;
    const rows = await this.db.all(`SELECT mintUrl, quote, state, request, amount, unit, expiry, pubkey
       FROM coco_cashu_mint_quotes
       WHERE state != 'ISSUED' ${normalizedMintUrl ? "AND mintUrl = ?" : ""}`, normalizedMintUrl ? [normalizedMintUrl] : []);
    const now = Date.now();
    return rows.map((row) => {
      const amount = deserializeAmount4(row.amount);
      return {
        mintUrl: row.mintUrl,
        method: "bolt11",
        quoteId: row.quote,
        quote: row.quote,
        state: row.state,
        request: row.request,
        amount,
        unit: row.unit,
        expiry: row.expiry,
        pubkey: row.pubkey ?? undefined,
        reusable: false,
        amountPaid: row.state === "PAID" ? amount : Amount.zero(),
        amountIssued: Amount.zero(),
        remoteUpdatedAt: null,
        quoteData: {
          amount
        },
        createdAt: now,
        updatedAt: now
      };
    });
  }
}

// packages/sql-storage/src/repositories/HistoryRepository.ts
import {
  deserializeAmount as deserializeAmount5,
  deserializeToken,
  operationHistoryId,
  parseHistoryEntryId,
  projectLegacyHistoryRow
} from "@cashu/coco-core/adapter";
var projectionSelect = `
  SELECT *
  FROM (
    SELECT
      'operation' AS source,
      'send:' || id AS id,
      NULL AS legacyHistoryId,
      'send' AS type,
      mintUrl,
      COALESCE(unit, 'sat') AS unit,
      amount,
      createdAt * 1000 AS createdAt,
      updatedAt * 1000 AS updatedAt,
      state,
      NULL AS quoteId,
      NULL AS paymentRequest,
      tokenJson,
      NULL AS inputProofsJson,
      NULL AS metadata,
      id AS operationId,
      NULL AS remoteState,
      error
    FROM coco_cashu_send_operations
    WHERE state != 'init'

    UNION ALL

    SELECT
      'operation' AS source,
      'melt:' || id AS id,
      NULL AS legacyHistoryId,
      'melt' AS type,
      mintUrl,
      COALESCE(unit, 'sat') AS unit,
      amount,
      createdAt * 1000 AS createdAt,
      updatedAt * 1000 AS updatedAt,
      state,
      quoteId,
      NULL AS paymentRequest,
      NULL AS tokenJson,
      NULL AS inputProofsJson,
      NULL AS metadata,
      id AS operationId,
      NULL AS remoteState,
      error
    FROM coco_cashu_melt_operations
    WHERE state IN ('prepared', 'executing', 'pending', 'finalized', 'rolling_back', 'rolled_back')

    UNION ALL

    SELECT
      'operation' AS source,
      'mint:' || op.id AS id,
      NULL AS legacyHistoryId,
      'mint' AS type,
      op.mintUrl,
      op.unit,
      op.amount,
      op.createdAt * 1000 AS createdAt,
      op.updatedAt * 1000 AS updatedAt,
      op.state,
      op.quoteId,
      op.request AS paymentRequest,
      NULL AS tokenJson,
      NULL AS inputProofsJson,
      NULL AS metadata,
      op.id AS operationId,
      q.state AS remoteState,
      op.error
    FROM coco_cashu_mint_operations op
    LEFT JOIN coco_cashu_canonical_mint_quotes q
      ON q.mintUrl = op.mintUrl
     AND q.method = op.method
     AND q.quoteId = op.quoteId
    WHERE op.state != 'init'

    UNION ALL

    SELECT
      'operation' AS source,
      'receive:' || id AS id,
      NULL AS legacyHistoryId,
      'receive' AS type,
      mintUrl,
      COALESCE(unit, 'sat') AS unit,
      amount,
      createdAt * 1000 AS createdAt,
      updatedAt * 1000 AS updatedAt,
      state,
      NULL AS quoteId,
      NULL AS paymentRequest,
      NULL AS tokenJson,
      inputProofsJson,
      sourceJson AS metadata,
      id AS operationId,
      NULL AS remoteState,
      error
    FROM coco_cashu_receive_operations
    WHERE state IN ('finalized', 'rolled_back')

    UNION ALL

    SELECT
      'legacy' AS source,
      'legacy:' || h.id AS id,
      CAST(h.id AS TEXT) AS legacyHistoryId,
      h.type,
      h.mintUrl,
      h.unit,
      h.amount,
      h.createdAt,
      h.createdAt AS updatedAt,
      COALESCE(h.state, '') AS state,
      h.quoteId,
      h.paymentRequest,
      h.tokenJson,
      NULL AS inputProofsJson,
      h.metadata,
      h.operationId,
      NULL AS remoteState,
      NULL AS error
    FROM coco_cashu_history h
    WHERE NOT (
      h.operationId IS NOT NULL AND EXISTS (
        SELECT 1 FROM (
          SELECT 'send' AS type, id AS operationId
          FROM coco_cashu_send_operations
          WHERE state != 'init'
          UNION ALL
          SELECT 'melt' AS type, id AS operationId
          FROM coco_cashu_melt_operations
          WHERE state IN (
            'prepared',
            'executing',
            'pending',
            'finalized',
            'rolling_back',
            'rolled_back'
          )
          UNION ALL
          SELECT 'mint' AS type, id AS operationId
          FROM coco_cashu_mint_operations
          WHERE state != 'init'
          UNION ALL
          SELECT 'receive' AS type, id AS operationId
          FROM coco_cashu_receive_operations
          WHERE state IN ('finalized', 'rolled_back')
        ) op
        WHERE op.type = h.type AND op.operationId = h.operationId
      )
    )
    AND NOT (
      h.operationId IS NULL
      AND h.type IN ('mint', 'melt')
      AND h.quoteId IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT 'mint' AS type, mintUrl, quoteId
          FROM coco_cashu_mint_operations
          WHERE state != 'init'
          UNION ALL
          SELECT 'melt' AS type, mintUrl, quoteId
          FROM coco_cashu_melt_operations
          WHERE state IN (
            'prepared',
            'executing',
            'pending',
            'finalized',
            'rolling_back',
            'rolled_back'
          )
        ) opq
        WHERE opq.type = h.type AND opq.mintUrl = h.mintUrl AND opq.quoteId = h.quoteId
      )
    )
  )
`;
function parseToken(tokenJson) {
  return tokenJson ? deserializeToken(JSON.parse(tokenJson)) : undefined;
}
function parseMetadata(metadata) {
  return metadata ? JSON.parse(metadata) : undefined;
}
function parseReceiveSourceMetadata(sourceJson) {
  if (!sourceJson)
    return;
  const source = JSON.parse(sourceJson);
  if (source.type !== "payment-request" || typeof source.requestOperationId !== "string" || typeof source.attemptId !== "string" || typeof source.transport !== "string") {
    return;
  }
  return {
    source: "payment-request",
    requestOperationId: source.requestOperationId,
    attemptId: source.attemptId,
    ...typeof source.requestId === "string" ? { requestId: source.requestId } : {},
    transport: source.transport,
    ...typeof source.transportMessageId === "string" ? { transportMessageId: source.transportMessageId } : {},
    ...typeof source.senderPubkey === "string" ? { senderPubkey: source.senderPubkey } : {},
    ...typeof source.memo === "string" ? { memo: source.memo } : {}
  };
}

class SqliteHistoryRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getPaginatedHistoryEntries(limit, offset) {
    const rows = await this.db.all(`${projectionSelect}
       ORDER BY createdAt DESC, id DESC
       LIMIT ? OFFSET ?`, [limit, offset]);
    return rows.map(rowToEntry);
  }
  async getHistoryEntryById(id) {
    const parsed = parseHistoryEntryId(id);
    if (!parsed)
      return null;
    if (parsed.source === "legacy") {
      const row2 = await this.db.get(`${projectionSelect}
         WHERE source = 'legacy' AND legacyHistoryId = ?
         LIMIT 1`, [parsed.legacyHistoryId]);
      return row2 ? rowToEntry(row2) : null;
    }
    const row = await this.db.get(`${projectionSelect}
       WHERE source = 'operation' AND type = ? AND operationId = ?
       LIMIT 1`, [parsed.type, parsed.operationId]);
    return row ? rowToEntry(row) : null;
  }
}
function rowToEntry(row) {
  if (row.source === "legacy") {
    return projectLegacyHistoryRow(rowToLegacyInput(row));
  }
  const base = {
    id: operationHistoryId(row.type, row.operationId ?? ""),
    source: "operation",
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mintUrl: row.mintUrl,
    unit: row.unit ?? "sat",
    operationId: row.operationId ?? "",
    amount: deserializeAmount5(row.amount),
    state: row.state,
    ...row.error ? { error: row.error } : {}
  };
  switch (row.type) {
    case "mint":
      return {
        ...base,
        type: "mint",
        quoteId: row.quoteId ?? "",
        paymentRequest: row.paymentRequest ?? "",
        state: row.state,
        ...row.remoteState ? { remoteState: row.remoteState } : {}
      };
    case "melt":
      return {
        ...base,
        type: "melt",
        quoteId: row.quoteId ?? "",
        state: row.state
      };
    case "send": {
      const token = parseToken(row.tokenJson);
      return {
        ...base,
        type: "send",
        state: row.state,
        ...token ? { token } : {}
      };
    }
    case "receive": {
      const metadata = parseReceiveSourceMetadata(row.metadata);
      return {
        ...base,
        type: "receive",
        state: row.state,
        ...metadata ? { metadata } : {},
        ...row.state === "finalized" ? {
          token: {
            mint: row.mintUrl,
            proofs: parseTokenProofs(row.inputProofsJson),
            unit: row.unit ?? "sat"
          }
        } : {}
      };
    }
  }
}
function rowToLegacyInput(row) {
  return {
    legacyHistoryId: row.legacyHistoryId ?? row.id.slice("legacy:".length),
    type: row.type,
    createdAt: row.createdAt,
    mintUrl: row.mintUrl,
    unit: row.unit ?? "sat",
    amount: deserializeAmount5(row.amount),
    quoteId: row.quoteId,
    state: row.state || null,
    paymentRequest: row.paymentRequest,
    token: parseToken(row.tokenJson),
    metadata: parseMetadata(row.metadata),
    operationId: row.operationId
  };
}
function parseTokenProofs(inputProofsJson) {
  const proofs = inputProofsJson ? JSON.parse(inputProofsJson) : [];
  return proofs.map((proof) => ({
    ...proof,
    amount: deserializeAmount5(proof.amount)
  }));
}

// packages/sql-storage/src/repositories/SendOperationRepository.ts
import {
  deserializeAmount as deserializeAmount6,
  deserializeToken as deserializeToken2,
  normalizeUnit as normalizeUnit2,
  serializeAmount as serializeAmount4,
  stringifyJson as stringifyJson3
} from "@cashu/coco-core/adapter";

// packages/sql-storage/src/repositories/OperationIdOwnership.ts
import { OperationIdConflictError } from "@cashu/coco-core/adapter";
async function claimOperationId(db, id, ownerType) {
  const existing = await db.get("SELECT id, ownerType FROM coco_cashu_operation_ids WHERE id = ? LIMIT 1", [id]);
  if (existing) {
    throw new OperationIdConflictError(id, existing.ownerType);
  }
  await db.run("INSERT INTO coco_cashu_operation_ids (id, ownerType) VALUES (?, ?)", [
    id,
    ownerType
  ]);
}

// packages/sql-storage/src/repositories/SendOperationRepository.ts
function parseToken2(tokenJson) {
  return tokenJson ? deserializeToken2(JSON.parse(tokenJson)) : undefined;
}
function serializeToken(operation) {
  const maybeTokenOperation = operation;
  return maybeTokenOperation.token ? JSON.stringify(maybeTokenOperation.token) : null;
}
function rowToOperation(row) {
  const base = {
    id: row.id,
    mintUrl: row.mintUrl,
    amount: deserializeAmount6(row.amount),
    unit: normalizeUnit2(row.unit ?? "sat"),
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000,
    revision: row.revision ?? 0,
    error: row.error ?? undefined,
    executionMemo: row.executionMemo ?? undefined,
    reclaimData: row.reclaimDataJson ? JSON.parse(row.reclaimDataJson) : undefined,
    method: row.method,
    methodData: JSON.parse(row.methodDataJson)
  };
  if (row.state === "init") {
    return { ...base, state: "init" };
  }
  const preparedData = {
    needsSwap: row.needsSwap === 1,
    fee: deserializeAmount6(assertFieldPresent(row.fee, "fee", row.id)),
    inputAmount: deserializeAmount6(assertFieldPresent(row.inputAmount, "inputAmount", row.id)),
    inputProofSecrets: row.inputProofSecretsJson ? JSON.parse(row.inputProofSecretsJson) : [],
    outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : undefined
  };
  switch (row.state) {
    case "prepared":
      return { ...base, state: "prepared", ...preparedData };
    case "executing":
      return { ...base, state: "executing", ...preparedData };
    case "pending":
      return {
        ...base,
        state: "pending",
        ...preparedData,
        token: parseToken2(row.tokenJson)
      };
    case "finalized":
      return {
        ...base,
        state: "finalized",
        ...preparedData,
        token: parseToken2(row.tokenJson)
      };
    case "rolling_back":
      return {
        ...base,
        state: "rolling_back",
        ...preparedData,
        token: parseToken2(row.tokenJson)
      };
    case "rolled_back":
      return {
        ...base,
        state: "rolled_back",
        ...preparedData,
        token: parseToken2(row.tokenJson)
      };
    default:
      throw new Error(`Unknown state: ${row.state}`);
  }
}
function operationToParams(op) {
  const createdAtSeconds = Math.floor(op.createdAt / 1000);
  const updatedAtSeconds = Math.floor(op.updatedAt / 1000);
  if (op.state === "init") {
    return [
      op.id,
      op.mintUrl,
      serializeAmount4(op.amount),
      op.unit,
      op.state,
      createdAtSeconds,
      updatedAtSeconds,
      op.error ?? null,
      op.executionMemo ?? null,
      op.method,
      stringifyJson3(op.methodData),
      null,
      null,
      null,
      null,
      null,
      null,
      op.revision ?? 0,
      op.reclaimData ? stringifyJson3(op.reclaimData) : null
    ];
  }
  return [
    op.id,
    op.mintUrl,
    serializeAmount4(op.amount),
    op.unit,
    op.state,
    createdAtSeconds,
    updatedAtSeconds,
    op.error ?? null,
    op.executionMemo ?? null,
    op.method,
    stringifyJson3(op.methodData),
    op.needsSwap ? 1 : 0,
    serializeAmount4(op.fee),
    serializeAmount4(op.inputAmount),
    JSON.stringify(op.inputProofSecrets),
    op.outputData ? JSON.stringify(op.outputData) : null,
    serializeToken(op),
    op.revision ?? 0,
    op.reclaimData ? stringifyJson3(op.reclaimData) : null
  ];
}

class SqliteSendOperationRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(operation) {
    const exists = await this.db.get("SELECT id FROM coco_cashu_send_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (exists) {
      throw new Error(`SendOperation with id ${operation.id} already exists`);
    }
    await claimOperationId(this.db, operation.id, "send");
    const params = operationToParams(operation);
    await this.db.run(`INSERT INTO coco_cashu_send_operations 
        (id, mintUrl, amount, unit, state, createdAt, updatedAt, error, executionMemo, method, methodDataJson, needsSwap, fee, inputAmount, inputProofSecretsJson, outputDataJson, tokenJson, revision, reclaimDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
  }
  async update(operation) {
    const exists = await this.db.get("SELECT id FROM coco_cashu_send_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (!exists) {
      throw new Error(`SendOperation with id ${operation.id} not found`);
    }
    const updatedAtSeconds = getUnixTimeSeconds2();
    if (operation.state === "init") {
      await this.db.run(`UPDATE coco_cashu_send_operations 
         SET state = ?, updatedAt = ?, error = ?, executionMemo = ?, unit = ?, revision = ?, reclaimDataJson = ?
         WHERE id = ?`, [
        operation.state,
        updatedAtSeconds,
        operation.error ?? null,
        operation.executionMemo ?? null,
        operation.unit,
        operation.revision ?? 0,
        operation.reclaimData ? stringifyJson3(operation.reclaimData) : null,
        operation.id
      ]);
    } else {
      await this.db.run(`UPDATE coco_cashu_send_operations 
         SET state = ?, updatedAt = ?, error = ?, executionMemo = ?, unit = ?, needsSwap = ?, fee = ?, inputAmount = ?, inputProofSecretsJson = ?, outputDataJson = ?, tokenJson = ?, revision = ?, reclaimDataJson = ?
         WHERE id = ?`, [
        operation.state,
        updatedAtSeconds,
        operation.error ?? null,
        operation.executionMemo ?? null,
        operation.unit,
        operation.needsSwap ? 1 : 0,
        serializeAmount4(operation.fee),
        serializeAmount4(operation.inputAmount),
        JSON.stringify(operation.inputProofSecrets),
        operation.outputData ? JSON.stringify(operation.outputData) : null,
        serializeToken(operation),
        operation.revision ?? 0,
        operation.reclaimData ? stringifyJson3(operation.reclaimData) : null,
        operation.id
      ]);
    }
  }
  async transition(input) {
    if (input.next.id !== input.operationId) {
      throw new Error("Send operation transition cannot change the operation id");
    }
    const next = input.next;
    const prepared = next.state === "init" ? [null, null, null, null, null, null] : [
      next.needsSwap ? 1 : 0,
      serializeAmount4(next.fee),
      serializeAmount4(next.inputAmount),
      JSON.stringify(next.inputProofSecrets),
      next.outputData ? JSON.stringify(next.outputData) : null,
      serializeToken(next)
    ];
    const result = await this.db.run(`UPDATE coco_cashu_send_operations
       SET state = ?, updatedAt = ?, error = ?, executionMemo = ?, unit = ?, needsSwap = ?, fee = ?, inputAmount = ?,
           inputProofSecretsJson = ?, outputDataJson = ?, tokenJson = ?, revision = ?, reclaimDataJson = ?
       WHERE id = ? AND state = ? AND revision = ?`, [
      next.state,
      Math.floor(next.updatedAt / 1000),
      next.error ?? null,
      next.executionMemo ?? null,
      next.unit,
      ...prepared,
      input.expectedRevision + 1,
      next.reclaimData ? stringifyJson3(next.reclaimData) : null,
      input.operationId,
      input.expectedState,
      input.expectedRevision
    ]);
    return result.changes === 1;
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_send_operations WHERE id = ?", [id]);
    return row ? rowToOperation(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_send_operations WHERE state = ?", [state]);
    return rows.map(rowToOperation);
  }
  async getPending() {
    const rows = await this.db.all("SELECT * FROM coco_cashu_send_operations WHERE state IN ('executing', 'pending', 'rolling_back')");
    return rows.map(rowToOperation);
  }
  async getByMintUrl(mintUrl) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_send_operations WHERE mintUrl = ?", [mintUrl]);
    return rows.map(rowToOperation);
  }
  async delete(id) {
    await this.db.run("DELETE FROM coco_cashu_send_operations WHERE id = ?", [id]);
  }
}

// packages/sql-storage/src/repositories/MeltOperationRepository.ts
import {
  deserializeAmount as deserializeAmount7,
  normalizeMeltMethodData,
  normalizeUnit as normalizeUnit3,
  serializeAmount as serializeAmount5,
  stringifyJson as stringifyJson4
} from "@cashu/coco-core/adapter";
var getOperationQuoteId = (operation) => ("quoteId" in operation) && operation.quoteId ? operation.quoteId : undefined;
var preparedStates = [
  "prepared",
  "executing",
  "pending",
  "finalized",
  "rolling_back",
  "rolled_back"
];
var isPreparedState = (state) => preparedStates.includes(state);
var parseMethodData = (row) => normalizeMeltMethodData(JSON.parse(row.methodDataJson));
var rowToOperation2 = (row) => {
  const base = {
    id: row.id,
    mintUrl: row.mintUrl,
    method: row.method,
    methodData: parseMethodData(row),
    unit: normalizeUnit3(row.unit ?? "sat"),
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000,
    error: row.error ?? undefined
  };
  if (!isPreparedState(row.state)) {
    return {
      ...base,
      state: "init",
      ...row.quoteId ? { quoteId: row.quoteId } : {}
    };
  }
  const preparedData = {
    quoteId: row.quoteId ?? "",
    amount: deserializeAmount7(assertFieldPresent(row.amount, "amount", row.id)),
    fee_reserve: deserializeAmount7(assertFieldPresent(row.fee_reserve, "fee_reserve", row.id)),
    swap_fee: deserializeAmount7(assertFieldPresent(row.swap_fee, "swap_fee", row.id)),
    needsSwap: row.needsSwap === 1,
    inputAmount: deserializeAmount7(assertFieldPresent(row.inputAmount, "inputAmount", row.id)),
    inputProofSecrets: row.inputProofSecretsJson ? JSON.parse(row.inputProofSecretsJson) : [],
    changeOutputData: row.changeOutputDataJson ? JSON.parse(row.changeOutputDataJson) : { keep: [], send: [] },
    swapOutputData: row.swapOutputDataJson ? JSON.parse(row.swapOutputDataJson) : undefined
  };
  const operation = {
    ...base,
    state: row.state,
    ...preparedData
  };
  if (row.state === "finalized") {
    return {
      ...operation,
      changeAmount: row.changeAmount !== null ? deserializeAmount7(row.changeAmount) : undefined,
      effectiveFee: row.effectiveFee !== null ? deserializeAmount7(row.effectiveFee) : undefined,
      finalizedData: row.finalizedDataJson ? JSON.parse(row.finalizedDataJson) : undefined
    };
  }
  return operation;
};
var operationToParams2 = (operation) => {
  const createdAtSeconds = Math.floor(operation.createdAt / 1000);
  const updatedAtSeconds = Math.floor(operation.updatedAt / 1000);
  const methodDataJson = stringifyJson4(operation.methodData);
  if (operation.state === "init") {
    return [
      operation.id,
      operation.mintUrl,
      operation.state,
      createdAtSeconds,
      updatedAtSeconds,
      operation.error ?? null,
      operation.method,
      methodDataJson,
      operation.quoteId ?? null,
      operation.unit,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ];
  }
  const settlement = operation;
  const changeAmount = operation.state === "finalized" && settlement.changeAmount !== undefined ? serializeAmount5(settlement.changeAmount) : null;
  const effectiveFee = operation.state === "finalized" && settlement.effectiveFee !== undefined ? serializeAmount5(settlement.effectiveFee) : null;
  const finalizedDataJson = operation.state === "finalized" && settlement.finalizedData !== undefined ? JSON.stringify(settlement.finalizedData) : null;
  return [
    operation.id,
    operation.mintUrl,
    operation.state,
    createdAtSeconds,
    updatedAtSeconds,
    operation.error ?? null,
    operation.method,
    methodDataJson,
    operation.quoteId,
    operation.unit,
    serializeAmount5(operation.amount),
    serializeAmount5(operation.fee_reserve),
    serializeAmount5(operation.swap_fee),
    operation.needsSwap ? 1 : 0,
    serializeAmount5(operation.inputAmount),
    JSON.stringify(operation.inputProofSecrets),
    JSON.stringify(operation.changeOutputData),
    operation.swapOutputData ? JSON.stringify(operation.swapOutputData) : null,
    changeAmount,
    effectiveFee,
    finalizedDataJson
  ];
};

class SqliteMeltOperationRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(operation) {
    if (operation.state === "failed") {
      throw new Error("Cannot persist failed melt operation");
    }
    const exists = await this.db.get("SELECT id FROM coco_cashu_melt_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (exists) {
      throw new Error(`MeltOperation with id ${operation.id} already exists`);
    }
    await claimOperationId(this.db, operation.id, "melt");
    await this.assertNoDuplicateQuoteOperation(operation);
    const params = operationToParams2(operation);
    await this.db.run(`INSERT INTO coco_cashu_melt_operations
         (id, mintUrl, state, createdAt, updatedAt, error, method, methodDataJson, quoteId, unit, amount, fee_reserve, swap_fee, needsSwap, inputAmount, inputProofSecretsJson, changeOutputDataJson, swapOutputDataJson, changeAmount, effectiveFee, finalizedDataJson)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
  }
  async update(operation) {
    if (operation.state === "failed") {
      throw new Error("Cannot persist failed melt operation");
    }
    const exists = await this.db.get("SELECT id FROM coco_cashu_melt_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (!exists) {
      throw new Error(`MeltOperation with id ${operation.id} not found`);
    }
    await this.assertNoDuplicateQuoteOperation(operation);
    const updatedAtSeconds = getUnixTimeSeconds2();
    if (operation.state === "init") {
      await this.db.run(`UPDATE coco_cashu_melt_operations
         SET state = ?, updatedAt = ?, error = ?, method = ?, methodDataJson = ?, quoteId = ?, unit = ?
         WHERE id = ?`, [
        operation.state,
        updatedAtSeconds,
        operation.error ?? null,
        operation.method,
        stringifyJson4(operation.methodData),
        operation.quoteId ?? null,
        operation.unit,
        operation.id
      ]);
      return;
    }
    const settlement = operation;
    await this.db.run(`UPDATE coco_cashu_melt_operations
        SET state = ?, updatedAt = ?, error = ?, method = ?, methodDataJson = ?, quoteId = ?, unit = ?, amount = ?, fee_reserve = ?, swap_fee = ?, needsSwap = ?, inputAmount = ?, inputProofSecretsJson = ?, changeOutputDataJson = ?, swapOutputDataJson = ?, changeAmount = ?, effectiveFee = ?, finalizedDataJson = ?
        WHERE id = ?`, [
      operation.state,
      updatedAtSeconds,
      operation.error ?? null,
      operation.method,
      stringifyJson4(operation.methodData),
      operation.quoteId,
      operation.unit,
      serializeAmount5(operation.amount),
      serializeAmount5(operation.fee_reserve),
      serializeAmount5(operation.swap_fee),
      operation.needsSwap ? 1 : 0,
      serializeAmount5(operation.inputAmount),
      JSON.stringify(operation.inputProofSecrets),
      JSON.stringify(operation.changeOutputData),
      operation.swapOutputData ? JSON.stringify(operation.swapOutputData) : null,
      operation.state === "finalized" && settlement.changeAmount !== undefined ? serializeAmount5(settlement.changeAmount) : null,
      operation.state === "finalized" && settlement.effectiveFee !== undefined ? serializeAmount5(settlement.effectiveFee) : null,
      operation.state === "finalized" && settlement.finalizedData !== undefined ? JSON.stringify(settlement.finalizedData) : null,
      operation.id
    ]);
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_melt_operations WHERE id = ?", [id]);
    return row ? rowToOperation2(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_melt_operations WHERE state = ?", [state]);
    return rows.map(rowToOperation2);
  }
  async getPending() {
    const rows = await this.db.all("SELECT * FROM coco_cashu_melt_operations WHERE state IN ('executing', 'pending')");
    return rows.map(rowToOperation2);
  }
  async getByMintUrl(mintUrl) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_melt_operations WHERE mintUrl = ?", [mintUrl]);
    return rows.map(rowToOperation2);
  }
  async getByQuoteId(mintUrl, quoteId) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_melt_operations WHERE mintUrl = ? AND quoteId = ?", [mintUrl, quoteId]);
    return rows.map(rowToOperation2);
  }
  async delete(id) {
    await this.db.run("DELETE FROM coco_cashu_melt_operations WHERE id = ?", [id]);
  }
  async assertNoDuplicateQuoteOperation(operation) {
    const quoteId = getOperationQuoteId(operation);
    if (!quoteId)
      return;
    const duplicate = await this.db.get("SELECT id FROM coco_cashu_melt_operations WHERE mintUrl = ? AND quoteId = ? AND id <> ? LIMIT 1", [operation.mintUrl, quoteId, operation.id]);
    if (duplicate) {
      throw new Error(`MeltOperation already exists for mint ${operation.mintUrl} and quote ${quoteId}`);
    }
  }
}

// packages/sql-storage/src/repositories/AuthSessionRepository.ts
import { deserializeAmount as deserializeAmount8 } from "@cashu/coco-core/adapter";
function parseBatPool(batPoolJson) {
  if (!batPoolJson)
    return;
  const proofs = JSON.parse(batPoolJson);
  return proofs?.map((proof) => ({
    ...proof,
    amount: deserializeAmount8(proof.amount)
  }));
}
function rowToSession(row) {
  return {
    mintUrl: row.mintUrl,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? undefined,
    expiresAt: row.expiresAt,
    scope: row.scope ?? undefined,
    batPool: parseBatPool(row.batPoolJson)
  };
}

class SqliteAuthSessionRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async getSession(mintUrl) {
    const row = await this.db.get("SELECT mintUrl, accessToken, refreshToken, expiresAt, scope, batPoolJson FROM coco_cashu_auth_sessions WHERE mintUrl = ? LIMIT 1", [mintUrl]);
    if (!row)
      return null;
    return rowToSession(row);
  }
  async saveSession(session) {
    await this.db.run(`INSERT INTO coco_cashu_auth_sessions (mintUrl, accessToken, refreshToken, expiresAt, scope, batPoolJson)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(mintUrl) DO UPDATE SET
         accessToken=excluded.accessToken,
         refreshToken=excluded.refreshToken,
         expiresAt=excluded.expiresAt,
         scope=excluded.scope,
         batPoolJson=excluded.batPoolJson`, [
      session.mintUrl,
      session.accessToken,
      session.refreshToken ?? null,
      session.expiresAt,
      session.scope ?? null,
      session.batPool ? JSON.stringify(session.batPool) : null
    ]);
  }
  async deleteSession(mintUrl) {
    await this.db.run("DELETE FROM coco_cashu_auth_sessions WHERE mintUrl = ?", [mintUrl]);
  }
  async getAllSessions() {
    const rows = await this.db.all("SELECT mintUrl, accessToken, refreshToken, expiresAt, scope, batPoolJson FROM coco_cashu_auth_sessions");
    return rows.map(rowToSession);
  }
}

// packages/sql-storage/src/repositories/MintOperationRepository.ts
import { deserializeAmount as deserializeAmount9, serializeAmount as serializeAmount6, stringifyJson as stringifyJson5 } from "@cashu/coco-core/adapter";
var persistedStates = ["pending", "executing", "finalized", "failed"];
var isPersistedState = (state) => persistedStates.includes(state);
var normalizeState = (state) => {
  if (state === "pending" || state === "executing" || state === "finalized" || state === "failed") {
    return state;
  }
  return "init";
};
var requireQuoteId = (row) => {
  if (!row.quoteId || row.quoteId.trim() === "") {
    throw new Error(`MintOperation ${row.id} is missing required quoteId`);
  }
  return row.quoteId;
};
var rowToOperation3 = (row) => {
  const quoteId = requireQuoteId(row);
  const base = {
    id: row.id,
    mintUrl: row.mintUrl,
    method: row.method,
    methodData: JSON.parse(row.methodDataJson),
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000,
    error: row.error ?? undefined,
    ...row.terminalFailureJson ? { terminalFailure: JSON.parse(row.terminalFailureJson) } : {}
  };
  const intent = {
    amount: deserializeAmount9(row.amount ?? 0),
    unit: row.unit ?? ""
  };
  if (!isPersistedState(row.state)) {
    return {
      ...base,
      ...intent,
      state: "init",
      quoteId
    };
  }
  return {
    ...base,
    ...intent,
    state: normalizeState(row.state),
    quoteId,
    request: row.request ?? "",
    expiry: row.expiry ?? null,
    pubkey: row.pubkey ?? undefined,
    outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : { keep: [], send: [] }
  };
};
var operationToParams3 = (operation) => {
  const createdAtSeconds = Math.floor(operation.createdAt / 1000);
  const updatedAtSeconds = Math.floor(operation.updatedAt / 1000);
  const methodDataJson = stringifyJson5(operation.methodData);
  if (operation.state === "init") {
    return [
      operation.id,
      operation.mintUrl,
      operation.quoteId,
      operation.state,
      createdAtSeconds,
      updatedAtSeconds,
      operation.error ?? null,
      operation.method,
      methodDataJson,
      serializeAmount6(operation.amount),
      operation.unit,
      null,
      null,
      null,
      null,
      null,
      operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
      null
    ];
  }
  return [
    operation.id,
    operation.mintUrl,
    operation.quoteId,
    operation.state,
    createdAtSeconds,
    updatedAtSeconds,
    operation.error ?? null,
    operation.method,
    methodDataJson,
    serializeAmount6(operation.amount),
    operation.unit,
    operation.request,
    operation.expiry,
    operation.pubkey ?? null,
    null,
    null,
    operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
    JSON.stringify(operation.outputData)
  ];
};

class SqliteMintOperationRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(operation) {
    const exists = await this.db.get("SELECT id FROM coco_cashu_mint_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (exists) {
      throw new Error(`MintOperation with id ${operation.id} already exists`);
    }
    await claimOperationId(this.db, operation.id, "mint");
    const params = operationToParams3(operation);
    await this.db.run(`INSERT INTO coco_cashu_mint_operations
        (id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson, amount, unit, request, expiry, pubkey, lastObservedRemoteState, lastObservedRemoteStateAt, terminalFailureJson, outputDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
  }
  async update(operation) {
    const exists = await this.db.get("SELECT id FROM coco_cashu_mint_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (!exists) {
      throw new Error(`MintOperation with id ${operation.id} not found`);
    }
    const updatedAtSeconds = getUnixTimeSeconds2();
    if (operation.state === "init") {
      await this.db.run(`UPDATE coco_cashu_mint_operations
         SET quoteId = ?, state = ?, updatedAt = ?, error = ?, method = ?, methodDataJson = ?, amount = ?, unit = ?, terminalFailureJson = ?
         WHERE id = ?`, [
        operation.quoteId,
        operation.state,
        updatedAtSeconds,
        operation.error ?? null,
        operation.method,
        stringifyJson5(operation.methodData),
        serializeAmount6(operation.amount),
        operation.unit,
        operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
        operation.id
      ]);
      return;
    }
    await this.db.run(`UPDATE coco_cashu_mint_operations
       SET quoteId = ?, state = ?, updatedAt = ?, error = ?, method = ?, methodDataJson = ?, amount = ?, unit = ?, request = ?, expiry = ?, pubkey = ?, lastObservedRemoteState = ?, lastObservedRemoteStateAt = ?, terminalFailureJson = ?, outputDataJson = ?
       WHERE id = ?`, [
      operation.quoteId,
      operation.state,
      updatedAtSeconds,
      operation.error ?? null,
      operation.method,
      stringifyJson5(operation.methodData),
      serializeAmount6(operation.amount),
      operation.unit,
      operation.request,
      operation.expiry,
      operation.pubkey ?? null,
      null,
      null,
      operation.terminalFailure ? JSON.stringify(operation.terminalFailure) : null,
      JSON.stringify(operation.outputData),
      operation.id
    ]);
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_mint_operations WHERE id = ?", [id]);
    return row ? rowToOperation3(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_mint_operations WHERE state = ?", [state]);
    return rows.map(rowToOperation3);
  }
  async getPending() {
    const rows = await this.db.all("SELECT * FROM coco_cashu_mint_operations WHERE state IN ('pending', 'executing')");
    return rows.map(rowToOperation3);
  }
  async getByMintUrl(mintUrl) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_mint_operations WHERE mintUrl = ?", [mintUrl]);
    return rows.map(rowToOperation3);
  }
  async getByQuoteId(mintUrl, method, quoteId) {
    const rows = await this.db.all(`SELECT * FROM coco_cashu_mint_operations
       WHERE mintUrl = ? AND method = ? AND quoteId = ?
       ORDER BY createdAt ASC, id ASC`, [mintUrl, method, quoteId]);
    return rows.map(rowToOperation3);
  }
  async delete(id) {
    await this.db.run("DELETE FROM coco_cashu_mint_operations WHERE id = ?", [id]);
  }
}

// packages/sql-storage/src/repositories/ReceiveOperationRepository.ts
import { deserializeAmount as deserializeAmount10, serializeAmount as serializeAmount7 } from "@cashu/coco-core/adapter";
function getOperationUnit(op) {
  return op.unit ?? "sat";
}
function parseInputProofs(inputProofsJson) {
  const proofs = inputProofsJson ? JSON.parse(inputProofsJson) : [];
  return proofs.map((proof) => ({
    ...proof,
    amount: deserializeAmount10(proof.amount)
  }));
}
function rowToOperation4(row) {
  const base = {
    id: row.id,
    revision: row.revision ?? 0,
    mintUrl: row.mintUrl,
    unit: row.unit ?? "sat",
    amount: deserializeAmount10(row.amount),
    inputProofs: parseInputProofs(row.inputProofsJson),
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000,
    error: row.error ?? undefined,
    source: row.sourceJson ? JSON.parse(row.sourceJson) : undefined
  };
  if (row.state === "init") {
    return { ...base, state: "init" };
  }
  const preparedData = {
    fee: deserializeAmount10(assertFieldPresent(row.fee, "fee", row.id)),
    outputData: row.outputDataJson ? JSON.parse(row.outputDataJson) : undefined
  };
  switch (row.state) {
    case "prepared":
      return { ...base, state: "prepared", ...preparedData };
    case "executing":
      return { ...base, state: "executing", ...preparedData };
    case "finalized":
      return { ...base, state: "finalized", ...preparedData };
    case "rolled_back":
      return { ...base, state: "rolled_back", ...preparedData };
    default:
      throw new Error(`Unknown state: ${row.state}`);
  }
}
function operationToParams4(op) {
  const createdAtSeconds = Math.floor(op.createdAt / 1000);
  const updatedAtSeconds = Math.floor(op.updatedAt / 1000);
  if (op.state === "init") {
    return [
      op.id,
      op.mintUrl,
      getOperationUnit(op),
      serializeAmount7(op.amount),
      op.state,
      createdAtSeconds,
      updatedAtSeconds,
      op.error ?? null,
      null,
      JSON.stringify(op.inputProofs),
      null,
      op.source ? JSON.stringify(op.source) : null,
      op.revision ?? 0
    ];
  }
  return [
    op.id,
    op.mintUrl,
    getOperationUnit(op),
    serializeAmount7(op.amount),
    op.state,
    createdAtSeconds,
    updatedAtSeconds,
    op.error ?? null,
    serializeAmount7(op.fee),
    JSON.stringify(op.inputProofs),
    op.outputData ? JSON.stringify(op.outputData) : null,
    op.source ? JSON.stringify(op.source) : null,
    op.revision ?? 0
  ];
}

class SqliteReceiveOperationRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(operation) {
    const exists = await this.db.get("SELECT id FROM coco_cashu_receive_operations WHERE id = ? LIMIT 1", [operation.id]);
    if (exists) {
      throw new Error(`ReceiveOperation with id ${operation.id} already exists`);
    }
    await claimOperationId(this.db, operation.id, "receive");
    const params = operationToParams4(operation);
    await this.db.run(`INSERT INTO coco_cashu_receive_operations
        (id, mintUrl, unit, amount, state, createdAt, updatedAt, error, fee, inputProofsJson, outputDataJson, sourceJson, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
  }
  async update(operation) {
    const params = operationToParams4({ ...operation, updatedAt: Date.now() });
    const result = await this.db.run(`UPDATE coco_cashu_receive_operations SET mintUrl = ?, unit = ?, amount = ?, state = ?, createdAt = ?, updatedAt = ?, error = ?, fee = ?, inputProofsJson = ?, outputDataJson = ?, sourceJson = ?, revision = ? WHERE id = ?`, [...params.slice(1), operation.id]);
    if (result.changes === 0)
      throw new Error(`ReceiveOperation with id ${operation.id} not found`);
  }
  async transition(input) {
    if (input.next.id !== input.operationId)
      throw new Error("Receive operation transition cannot change the operation id");
    const params = operationToParams4({ ...input.next, revision: input.expectedRevision + 1 });
    const result = await this.db.run(`UPDATE coco_cashu_receive_operations SET mintUrl = ?, unit = ?, amount = ?, state = ?, createdAt = ?, updatedAt = ?, error = ?, fee = ?, inputProofsJson = ?, outputDataJson = ?, sourceJson = ?, revision = ? WHERE id = ? AND state = ? AND revision = ?`, [...params.slice(1), input.operationId, input.expectedState, input.expectedRevision]);
    return result.changes === 1;
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_receive_operations WHERE id = ?", [id]);
    return row ? rowToOperation4(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_receive_operations WHERE state = ?", [state]);
    return rows.map(rowToOperation4);
  }
  async getPending() {
    const rows = await this.db.all("SELECT * FROM coco_cashu_receive_operations WHERE state IN ('executing')");
    return rows.map(rowToOperation4);
  }
  async getByMintUrl(mintUrl) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_receive_operations WHERE mintUrl = ?", [mintUrl]);
    return rows.map(rowToOperation4);
  }
  async getByPaymentRequestAttemptId(attemptId) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_receive_operations WHERE sourceJson IS NOT NULL");
    const operation = rows.map(rowToOperation4).find((candidate) => candidate.source?.type === "payment-request" && candidate.source.attemptId === attemptId);
    return operation ?? null;
  }
  async delete(id) {
    await this.db.run("DELETE FROM coco_cashu_receive_operations WHERE id = ?", [id]);
  }
}

// packages/sql-storage/src/repositories/PaymentRequestReceiveRepository.ts
import { deserializeAmount as deserializeAmount11, serializeAmount as serializeAmount8 } from "@cashu/coco-core/adapter";
function operationToRow(operation) {
  return {
    id: operation.id,
    requestId: operation.requestId ?? null,
    encodedRequest: operation.encodedRequest,
    state: operation.state,
    transport: operation.transport,
    amount: serializeAmount8(operation.amount),
    unit: operation.unit,
    mintsJson: JSON.stringify(operation.mints),
    singleUse: operation.singleUse ? 1 : 0,
    description: operation.description ?? null,
    createdAt: Math.floor(operation.createdAt / 1000),
    updatedAt: Math.floor(operation.updatedAt / 1000),
    error: operation.error ?? null,
    completedAt: operation.completedAt ? Math.floor(operation.completedAt / 1000) : null
  };
}
function rowToOperation5(row) {
  return {
    id: row.id,
    requestId: row.requestId ?? undefined,
    encodedRequest: row.encodedRequest,
    state: row.state,
    transport: row.transport,
    amount: deserializeAmount11(row.amount),
    unit: row.unit,
    mints: JSON.parse(row.mintsJson),
    singleUse: row.singleUse === 1,
    description: row.description ?? undefined,
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000,
    error: row.error ?? undefined,
    completedAt: row.completedAt ? row.completedAt * 1000 : undefined
  };
}
function attemptToRow(attempt) {
  return {
    id: attempt.id,
    requestOperationId: attempt.requestOperationId,
    requestId: attempt.requestId ?? null,
    transport: attempt.transport,
    transportMessageId: attempt.transportMessageId ?? null,
    payloadHash: attempt.payloadHash,
    senderPubkey: attempt.senderPubkey ?? null,
    memo: attempt.memo ?? null,
    mintUrl: attempt.mintUrl,
    unit: attempt.unit,
    grossAmount: serializeAmount8(attempt.grossAmount),
    fee: attempt.fee ? serializeAmount8(attempt.fee) : null,
    netAmount: attempt.netAmount ? serializeAmount8(attempt.netAmount) : null,
    receiveOperationId: attempt.receiveOperationId ?? null,
    state: attempt.state,
    error: attempt.error ?? null,
    payloadJson: attempt.payload ? JSON.stringify(attempt.payload) : null,
    createdAt: Math.floor(attempt.createdAt / 1000),
    updatedAt: Math.floor(attempt.updatedAt / 1000)
  };
}
function rowToAttempt(row) {
  const payload = row.payloadJson ? JSON.parse(row.payloadJson) : undefined;
  return {
    id: row.id,
    requestOperationId: row.requestOperationId,
    requestId: row.requestId ?? undefined,
    transport: row.transport,
    transportMessageId: row.transportMessageId ?? undefined,
    payloadHash: row.payloadHash,
    senderPubkey: row.senderPubkey ?? undefined,
    memo: row.memo ?? undefined,
    mintUrl: row.mintUrl,
    unit: row.unit,
    grossAmount: deserializeAmount11(row.grossAmount),
    fee: row.fee === null ? undefined : deserializeAmount11(row.fee),
    netAmount: row.netAmount === null ? undefined : deserializeAmount11(row.netAmount),
    receiveOperationId: row.receiveOperationId ?? undefined,
    state: row.state,
    error: row.error ?? undefined,
    payload,
    createdAt: row.createdAt * 1000,
    updatedAt: row.updatedAt * 1000
  };
}

class SqlitePaymentRequestReceiveOperationRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(operation) {
    await claimOperationId(this.db, operation.id, "payment-request-receive");
    const row = operationToRow(operation);
    await this.db.run(`INSERT INTO coco_cashu_payment_request_receive_operations
        (id, requestId, encodedRequest, state, transport, amount, unit, mintsJson, singleUse, description, createdAt, updatedAt, error, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  }
  async update(operation) {
    const row = operationToRow({ ...operation, updatedAt: Date.now() });
    await this.db.run(`UPDATE coco_cashu_payment_request_receive_operations
       SET requestId = ?, encodedRequest = ?, state = ?, transport = ?, amount = ?, unit = ?,
           mintsJson = ?, singleUse = ?, description = ?, updatedAt = ?, error = ?, completedAt = ?
       WHERE id = ?`, [
      row.requestId,
      row.encodedRequest,
      row.state,
      row.transport,
      row.amount,
      row.unit,
      row.mintsJson,
      row.singleUse,
      row.description,
      getUnixTimeSeconds2(),
      row.error,
      row.completedAt,
      row.id
    ]);
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_payment_request_receive_operations WHERE id = ?", [id]);
    return row ? rowToOperation5(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_operations WHERE state = ?", [state]);
    return rows.map(rowToOperation5);
  }
  async getActiveByRequestId(requestId) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_operations WHERE state = 'active' AND requestId = ?", [requestId]);
    return rows.map(rowToOperation5);
  }
  async list(filter) {
    const rows = filter?.state ? await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_operations WHERE state = ?", [filter.state]) : await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_operations");
    return rows.map(rowToOperation5);
  }
}

class SqlitePaymentRequestReceiveAttemptRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(attempt) {
    await claimOperationId(this.db, attempt.id, "payment-request-receive-attempt");
    const row = attemptToRow(attempt);
    await this.db.run(`INSERT INTO coco_cashu_payment_request_receive_attempts
        (id, requestOperationId, requestId, transport, transportMessageId, payloadHash, senderPubkey,
         memo, mintUrl, unit, grossAmount, fee, netAmount, receiveOperationId, state, error,
         payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  }
  async update(attempt) {
    const row = attemptToRow({ ...attempt, updatedAt: Date.now() });
    await this.db.run(`UPDATE coco_cashu_payment_request_receive_attempts
       SET requestId = ?, transport = ?, transportMessageId = ?, payloadHash = ?, senderPubkey = ?,
           memo = ?, mintUrl = ?, unit = ?, grossAmount = ?, fee = ?, netAmount = ?,
           receiveOperationId = ?, state = ?, error = ?, payloadJson = ?, updatedAt = ?
       WHERE id = ?`, [
      row.requestId,
      row.transport,
      row.transportMessageId,
      row.payloadHash,
      row.senderPubkey,
      row.memo,
      row.mintUrl,
      row.unit,
      row.grossAmount,
      row.fee,
      row.netAmount,
      row.receiveOperationId,
      row.state,
      row.error,
      row.payloadJson,
      getUnixTimeSeconds2(),
      row.id
    ]);
  }
  async getById(id) {
    const row = await this.db.get("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE id = ?", [id]);
    return row ? rowToAttempt(row) : null;
  }
  async getByRequestOperationId(requestOperationId) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE requestOperationId = ?", [requestOperationId]);
    return rows.map(rowToAttempt);
  }
  async getByReceiveOperationId(receiveOperationId) {
    const row = await this.db.get("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE receiveOperationId = ?", [receiveOperationId]);
    return row ? rowToAttempt(row) : null;
  }
  async getByTransportMessageId(transportMessageId) {
    const row = await this.db.get("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE transportMessageId = ?", [transportMessageId]);
    return row ? rowToAttempt(row) : null;
  }
  async getByPayloadHash(requestOperationId, payloadHash) {
    const row = await this.db.get("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE requestOperationId = ? AND payloadHash = ?", [requestOperationId, payloadHash]);
    return row ? rowToAttempt(row) : null;
  }
  async getByRequestIdAndPayloadHash(requestId, payloadHash) {
    const row = await this.db.get(`SELECT * FROM coco_cashu_payment_request_receive_attempts
       WHERE requestId = ? AND payloadHash = ?
       ORDER BY CASE WHEN state = 'finalized' THEN 0 ELSE 1 END, createdAt ASC
       LIMIT 1`, [requestId, payloadHash]);
    return row ? rowToAttempt(row) : null;
  }
  async getByState(state) {
    const rows = await this.db.all("SELECT * FROM coco_cashu_payment_request_receive_attempts WHERE state = ?", [state]);
    return rows.map(rowToAttempt);
  }
  async delete(id) {
    await this.db.run("DELETE FROM coco_cashu_payment_request_receive_attempts WHERE id = ?", [id]);
  }
}

// packages/sql-storage/src/repositories.ts
var nativeCreate = Object.create;
var nativeDefineProperty = Object.defineProperty;
var nativeDefineProperties = Object.defineProperties;
var nativeFreeze = Object.freeze;
var nativeKeys = Object.keys;

class RepositoryTransactionCallbackFailure extends Error {
  error;
  constructor(error) {
    super("Repository transaction callback failed");
    this.error = error;
    this.name = "RepositoryTransactionCallbackFailure";
    this.cause = error;
  }
}
function getSqliteErrorCode(error) {
  if (typeof error !== "object" || error === null)
    return "";
  if ("code" in error)
    return String(error.code).toUpperCase();
  if ("errno" in error)
    return String(error.errno).toUpperCase();
  return "";
}
function hasSqliteTransactionConflictCode(error) {
  const code = getSqliteErrorCode(error);
  return code === "5" || code === "6" || code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
}
function isSqliteTransactionConflict(error) {
  if (hasSqliteTransactionConflictCode(error))
    return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("database is locked") || message.includes("database table is locked") || message.includes("database is busy");
}
function createRepositoryScope(database) {
  return {
    mintRepository: new SqliteMintRepository(database),
    keyRingRepository: new SqliteKeyRingRepository(database),
    counterRepository: new SqliteCounterRepository(database),
    keysetRepository: new SqliteKeysetRepository(database),
    proofRepository: new SqliteProofRepository(database),
    meltQuoteRepository: new SqliteMeltQuoteRepository(database),
    mintQuoteRepository: new SqliteMintQuoteRepository(database),
    legacyMintQuoteRepository: new SqliteLegacyMintQuoteRepository(database),
    historyRepository: new SqliteHistoryRepository(database),
    sendOperationRepository: new SqliteSendOperationRepository(database),
    meltOperationRepository: new SqliteMeltOperationRepository(database),
    authSessionRepository: new SqliteAuthSessionRepository(database),
    mintOperationRepository: new SqliteMintOperationRepository(database),
    receiveOperationRepository: new SqliteReceiveOperationRepository(database),
    paymentRequestReceiveOperationRepository: new SqlitePaymentRequestReceiveOperationRepository(database),
    paymentRequestReceiveAttemptRepository: new SqlitePaymentRequestReceiveAttemptRepository(database)
  };
}

class SqlStorageRepositories {
  mintRepository;
  keyRingRepository;
  counterRepository;
  keysetRepository;
  proofRepository;
  meltQuoteRepository;
  mintQuoteRepository;
  legacyMintQuoteRepository;
  historyRepository;
  sendOperationRepository;
  meltOperationRepository;
  authSessionRepository;
  mintOperationRepository;
  receiveOperationRepository;
  paymentRequestReceiveOperationRepository;
  paymentRequestReceiveAttemptRepository;
  #database;
  #rootScope;
  #initialized = false;
  #heldAuthority = null;
  #authorityState = "unacquired";
  claimSessionAttachment;
  releaseSessionAttachment;
  constructor(options) {
    let sessionAttachment = null;
    nativeDefineProperties(this, {
      claimSessionAttachment: {
        configurable: false,
        enumerable: false,
        writable: false,
        value: () => {
          if (sessionAttachment !== null) {
            throw new WalletAuthorityLifecycleError("The repository root is already attached to an active Manager");
          }
          const token = () => {};
          sessionAttachment = token;
          return token;
        }
      },
      releaseSessionAttachment: {
        configurable: false,
        enumerable: false,
        writable: false,
        value: (token) => {
          if (token !== sessionAttachment || sessionAttachment === null)
            return false;
          sessionAttachment = null;
          return true;
        }
      }
    });
    this.#database = options.database;
    const repositories = createRepositoryScope(this.#database);
    this.#rootScope = repositories;
    const keys = nativeKeys(repositories);
    for (let index = 0;index < keys.length; index += 1) {
      const key = keys[index];
      nativeDefineProperty(this, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#wrapRootRepository(key)
      });
    }
  }
  async init() {
    await ensureSchema(this.#database);
    this.#initialized = true;
  }
  async acquireAuthority(identity) {
    validateWalletAuthorityIdentity(identity);
    if (!this.#initialized)
      throw new WalletAuthorityLifecycleError("Repository is not initialized");
    if (this.#authorityState !== "unacquired") {
      throw new WalletAuthorityLifecycleError(`Repository authority is already ${this.#authorityState}; create a new repository root`);
    }
    const authority = await this.#database.transaction(async (database) => {
      const storeAuthorities = await database.all("SELECT namespace, ownerId, generation, status FROM coco_cashu_wallet_authority");
      const mismatched = storeAuthorities.find((entry) => entry.namespace !== identity.namespace);
      if (mismatched) {
        throw new WalletAuthorityValidationError(`Wallet store is bound to namespace ${mismatched.namespace}, not ${identity.namespace}`);
      }
      const previous = await database.get("SELECT namespace, ownerId, generation, status FROM coco_cashu_wallet_authority WHERE namespace = ?", [identity.namespace]);
      const generation = Number(previous?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new WalletAuthorityGenerationExhaustedError(identity.namespace);
      }
      await database.run(`INSERT INTO coco_cashu_wallet_authority (namespace, ownerId, generation, status)
         VALUES (?, ?, ?, 'active')
         ON CONFLICT(namespace) DO UPDATE SET
           ownerId = excluded.ownerId,
           generation = excluded.generation,
           status = 'active'`, [identity.namespace, identity.ownerId, generation]);
      return { ...identity, generation, status: "active" };
    }, { mode: "immediate" });
    this.#heldAuthority = authority;
    this.#authorityState = "active";
    return { ...authority };
  }
  async releaseAuthority() {
    if (!this.#heldAuthority || this.#authorityState !== "active")
      return false;
    const expected = { ...this.#heldAuthority };
    const released = await this.#database.transaction(async (database) => {
      const result = await database.run(`UPDATE coco_cashu_wallet_authority SET status = 'released'
         WHERE namespace = ? AND ownerId = ? AND generation = ? AND status = 'active'`, [expected.namespace, expected.ownerId, expected.generation]);
      return result.changes === 1;
    }, { mode: "immediate" });
    this.#authorityState = released ? "released" : "stale";
    return released;
  }
  getAuthority() {
    return this.#heldAuthority ? { ...this.#heldAuthority } : null;
  }
  getAuthorityState() {
    return this.#authorityState;
  }
  async withTransaction(fn) {
    const expected = this.#heldAuthority ? { ...this.#heldAuthority } : null;
    try {
      return await this.#database.transaction(async (txDatabase) => {
        try {
          await this.#assertAuthority(txDatabase, expected);
          const transactionScope = createFencedRepositoryScope(createRepositoryScope(txDatabase));
          let result;
          try {
            result = await fn(transactionScope.scope);
          } finally {
            transactionScope.deactivate();
          }
          await this.#assertAuthority(txDatabase, expected);
          return result;
        } catch (error) {
          if (error instanceof RepositoryTransactionConflictError)
            throw error;
          if (hasSqliteTransactionConflictCode(error)) {
            throw new RepositoryTransactionConflictError(undefined, error);
          }
          throw new RepositoryTransactionCallbackFailure(error);
        }
      }, { mode: "immediate" });
    } catch (error) {
      if (error instanceof RepositoryTransactionCallbackFailure)
        throw error.error;
      if (error instanceof RepositoryTransactionConflictError)
        throw error;
      if (isSqliteTransactionConflict(error)) {
        throw new RepositoryTransactionConflictError(undefined, error);
      }
      throw error;
    }
  }
  #wrapRootRepository(key) {
    return createRepositoryFacade(key, (method, args) => {
      if (isRepositoryMutation(key, method)) {
        return this.withTransaction((scope) => Promise.resolve(invokeRepositoryMethod(key, scope[key], method, args)));
      }
      return invokeRepositoryMethod(key, this.#rootScope[key], method, args);
    });
  }
  async#assertAuthority(database, expected) {
    if (!expected)
      throw new WalletAuthorityNotAcquiredError;
    const current = await database.get("SELECT namespace, ownerId, generation, status FROM coco_cashu_wallet_authority WHERE namespace = ?", [expected.namespace]);
    if (!sameActiveAuthority(current, expected)) {
      this.#authorityState = "stale";
      throw new WalletAuthorityConflictError(expected.namespace, expected.generation, current ? Number(current.generation) : undefined);
    }
  }
}
function createFencedRepositoryScope(raw) {
  let active = true;
  const scope = nativeCreate(null);
  const keys = nativeKeys(raw);
  for (let index = 0;index < keys.length; index += 1) {
    const key = keys[index];
    nativeDefineProperty(scope, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: createRepositoryFacade(key, (method, args) => {
        if (!active)
          throw new WalletAuthorityLifecycleError("Repository transaction has ended");
        return invokeRepositoryMethod(key, raw[key], method, args);
      })
    });
  }
  nativeFreeze(scope);
  return {
    scope,
    deactivate: () => {
      active = false;
    }
  };
}
function sameActiveAuthority(current, expected) {
  return current?.status === "active" && current.namespace === expected.namespace && current.ownerId === expected.ownerId && Number(current.generation) === expected.generation;
}
// packages/sqlite-bun/src/db.ts
import { statSync } from "fs";
var activeTransactions = new Map;
function getDatabaseIdentity(database) {
  const databases = database.prepare("PRAGMA database_list").all();
  const filename = databases.find((entry) => entry.name === "main")?.file;
  if (!filename)
    return database;
  try {
    const { dev, ino } = statSync(filename, { bigint: true });
    return `${dev}:${ino}`;
  } catch {
    return filename;
  }
}

class SqliteDb {
  root;
  scopeToken;
  constructor(optionsOrRoot, scopeToken = null) {
    if ("database" in optionsOrRoot) {
      this.root = {
        db: optionsOrRoot.database,
        databaseIdentity: getDatabaseIdentity(optionsOrRoot.database),
        transactionQueue: Promise.resolve(),
        currentScope: null,
        scopeDepth: 0,
        pendingTransactionCount: 0,
        statementCache: new Map
      };
      this.scopeToken = null;
    } else {
      this.root = optionsOrRoot;
      this.scopeToken = scopeToken;
    }
  }
  get raw() {
    return this.root.db;
  }
  getCachedStatement(sql) {
    const { statementCache } = this.root;
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = this.root.db.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  }
  shouldWaitForTransaction() {
    return this.root.pendingTransactionCount > 0 && (!this.scopeToken || this.root.currentScope !== this.scopeToken);
  }
  async waitForActiveTransaction() {
    while (this.root.pendingTransactionCount > 0 && (!this.scopeToken || this.root.currentScope !== this.scopeToken)) {
      await this.root.transactionQueue;
    }
  }
  async exec(sql) {
    if (this.shouldWaitForTransaction()) {
      await this.waitForActiveTransaction();
    }
    return new Promise((resolve, reject) => {
      try {
        this.root.db.exec(sql);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }
  async run(sql, params = []) {
    if (this.shouldWaitForTransaction()) {
      await this.waitForActiveTransaction();
    }
    return new Promise((resolve, reject) => {
      try {
        const statement = this.getCachedStatement(sql);
        const result = statement.run(...params);
        const lastInsertRowId = Number(result.lastInsertRowid);
        resolve({
          lastID: lastInsertRowId,
          lastInsertRowId,
          changes: result.changes
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  async get(sql, params = []) {
    if (this.shouldWaitForTransaction()) {
      await this.waitForActiveTransaction();
    }
    return new Promise((resolve, reject) => {
      try {
        const statement = this.getCachedStatement(sql);
        const result = statement.get(...params);
        if (result === null || result === undefined) {
          resolve(undefined);
          return;
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }
  async all(sql, params = []) {
    if (this.shouldWaitForTransaction()) {
      await this.waitForActiveTransaction();
    }
    return new Promise((resolve, reject) => {
      try {
        const statement = this.getCachedStatement(sql);
        const result = statement.all(...params);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }
  async transaction(fn, options) {
    const { root } = this;
    if (this.scopeToken && root.currentScope === this.scopeToken) {
      root.scopeDepth++;
      try {
        return await fn(this);
      } finally {
        root.scopeDepth--;
      }
    }
    const scopeToken = Symbol("bun-sqlite-transaction");
    const scopedDb = new SqliteDb(root, scopeToken);
    const previousTransaction = root.transactionQueue;
    let resolver;
    root.transactionQueue = new Promise((resolve) => {
      resolver = resolve;
    });
    root.pendingTransactionCount++;
    let previousBusyTimeout;
    let registeredTransaction = false;
    try {
      await previousTransaction.catch((error) => {
        console.warn("Previous transaction failed:", error);
      });
      root.currentScope = scopeToken;
      root.scopeDepth = 1;
      const localTransactions = activeTransactions.get(root.databaseIdentity) ?? 0;
      if (localTransactions > 0) {
        previousBusyTimeout = root.db.prepare("PRAGMA busy_timeout").get().timeout;
        root.db.exec("PRAGMA busy_timeout = 0");
      }
      activeTransactions.set(root.databaseIdentity, localTransactions + 1);
      registeredTransaction = true;
      await scopedDb.exec(options?.mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN");
      try {
        const result = await fn(scopedDb);
        await scopedDb.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          await scopedDb.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    } finally {
      if (previousBusyTimeout !== undefined) {
        try {
          root.db.exec(`PRAGMA busy_timeout = ${previousBusyTimeout}`);
        } catch {}
      }
      if (registeredTransaction) {
        const remaining = (activeTransactions.get(root.databaseIdentity) ?? 1) - 1;
        if (remaining > 0)
          activeTransactions.set(root.databaseIdentity, remaining);
        else
          activeTransactions.delete(root.databaseIdentity);
      }
      root.scopeDepth = 0;
      root.currentScope = null;
      root.pendingTransactionCount--;
      resolver();
    }
  }
  close() {
    return new Promise((resolve, reject) => {
      try {
        this.root.db.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }
}

// packages/sqlite-bun/src/index.ts
var nativeDefineProperties2 = Object.defineProperties;

class SqliteRepositories {
  mintRepository;
  keyRingRepository;
  counterRepository;
  keysetRepository;
  proofRepository;
  meltQuoteRepository;
  mintQuoteRepository;
  legacyMintQuoteRepository;
  historyRepository;
  sendOperationRepository;
  meltOperationRepository;
  authSessionRepository;
  mintOperationRepository;
  receiveOperationRepository;
  paymentRequestReceiveOperationRepository;
  paymentRequestReceiveAttemptRepository;
  #db;
  #repositories;
  claimSessionAttachment;
  releaseSessionAttachment;
  constructor(options) {
    this.#db = new SqliteDb(options);
    this.#repositories = new SqlStorageRepositories({ database: this.#db });
    nativeDefineProperties2(this, {
      claimSessionAttachment: {
        configurable: false,
        enumerable: false,
        writable: false,
        value: this.#repositories.claimSessionAttachment
      },
      releaseSessionAttachment: {
        configurable: false,
        enumerable: false,
        writable: false,
        value: this.#repositories.releaseSessionAttachment
      },
      mintRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.mintRepository
      },
      keyRingRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.keyRingRepository
      },
      counterRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.counterRepository
      },
      keysetRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.keysetRepository
      },
      proofRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.proofRepository
      },
      meltQuoteRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.meltQuoteRepository
      },
      mintQuoteRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.mintQuoteRepository
      },
      legacyMintQuoteRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.legacyMintQuoteRepository
      },
      historyRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.historyRepository
      },
      sendOperationRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.sendOperationRepository
      },
      meltOperationRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.meltOperationRepository
      },
      authSessionRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.authSessionRepository
      },
      mintOperationRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.mintOperationRepository
      },
      receiveOperationRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.receiveOperationRepository
      },
      paymentRequestReceiveOperationRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.paymentRequestReceiveOperationRepository
      },
      paymentRequestReceiveAttemptRepository: {
        configurable: false,
        enumerable: true,
        writable: false,
        value: this.#repositories.paymentRequestReceiveAttemptRepository
      }
    });
  }
  async init() {
    await this.#repositories.init();
  }
  acquireAuthority(identity) {
    return this.#repositories.acquireAuthority(identity);
  }
  releaseAuthority() {
    return this.#repositories.releaseAuthority();
  }
  getAuthority() {
    return this.#repositories.getAuthority();
  }
  getAuthorityState() {
    return this.#repositories.getAuthorityState();
  }
  async withTransaction(fn) {
    return this.#repositories.withTransaction(fn);
  }
}
export {
  SqliteRepositories
};
