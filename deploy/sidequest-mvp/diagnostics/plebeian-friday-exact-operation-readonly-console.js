(() => {
  "use strict";

  const EXPECTED_ORIGIN = "https://139.162.161.233";
  const EXPECTED_ACTOR = "558ea655bffa18113913c8af8f73c7a4b790c239556f7577b03c29040b63f37b";
  const EXPECTED_OPERATION = "2ca379e28fcfb2f2f12770e3f8257395633bd99b73a4c7d5fb2d64dcfa0fa1e2";
  const EXPECTED_AUCTION = "auction-1794437139881";
  const PUBLIC_STATE_KEY = "plebeian-friday-browser-public-operations-v1";
  const PRIVATE_DATABASE = "plebeian-friday-browser-private-v1";
  const PRIVATE_DATABASE_VERSION = 3;
  const OPERATION_STORE = "operations";
  const ABORT_STORE = "funding-aborts";
  const PROOF_STORE = "coco_cashu_proofs";
  const PROOF_OPERATION_INDEX = "usedByOperationId";
  const ID = /^[A-Za-z0-9_-]{1,160}$/;
  const PHASES = new Set([
    "keys_ready",
    "coco_send_pending",
    "coco_locked",
    "envelope_prepared",
    "server_prepared",
    "finalized",
  ]);

  function fail(message) {
    throw new Error(`PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${message}`);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
  }

  async function databaseCatalog(platform) {
    if (typeof platform.indexedDB?.databases !== "function") {
      fail("IndexedDB database enumeration is unavailable; stop without opening any database");
    }
    const entries = await platform.indexedDB.databases();
    if (!Array.isArray(entries)) fail("IndexedDB database enumeration is malformed");
    return entries;
  }

  async function openExistingExact(platform, catalog, name, requiredStores, exactVersion) {
    const matches = catalog.filter((entry) => entry && entry.name === name);
    if (matches.length !== 1) fail(`${name} is not uniquely present; no database was opened`);
    const catalogVersion = matches[0].version;
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
      fail(`${name} has an invalid catalog version`);
    }
    if (exactVersion !== undefined && catalogVersion !== exactVersion) {
      fail(`${name} schema version differs; no database was opened`);
    }

    return new Promise((resolve, reject) => {
      const request = platform.indexedDB.open(name);
      let upgradeAttempted = false;
      request.onblocked = () => reject(new Error(`PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${name} open was blocked`));
      request.onupgradeneeded = () => {
        upgradeAttempted = true;
        try { request.transaction?.abort(); } catch { /* the open still fails closed */ }
      };
      request.onerror = () => reject(new Error(
        `PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${upgradeAttempted
          ? `${name} would create or upgrade; the attempt was aborted`
          : `${name} could not be opened read-only`}`,
      ));
      request.onsuccess = () => {
        const database = request.result;
        if (upgradeAttempted) {
          database.close();
          reject(new Error(`PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${name} unexpectedly upgraded`));
          return;
        }
        if (database.version !== catalogVersion) {
          database.close();
          reject(new Error(`PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${name} changed version during inspection`));
          return;
        }
        if (requiredStores.some((store) => !database.objectStoreNames.contains(store))) {
          database.close();
          reject(new Error(`PLEBEIAN_READ_ONLY_DIAGNOSTIC: ${name} lacks the reviewed stores`));
          return;
        }
        resolve(database);
      };
    });
  }

  function readPublicIntent(platform) {
    const raw = platform.localStorage?.getItem(PUBLIC_STATE_KEY);
    if (typeof raw !== "string") fail("the public operation index is absent");
    let parsed;
    try { parsed = JSON.parse(raw); } catch { fail("the public operation index is not JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || !["PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1", "PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V2"].includes(parsed.schema)
      || !Array.isArray(parsed.pendingBids)) {
      fail("the public operation index schema differs");
    }
    const matches = parsed.pendingBids.filter((entry) => entry
      && typeof entry === "object"
      && entry.fundingOperationId === EXPECTED_OPERATION);
    if (matches.length !== 1) fail("the exact public operation is not uniquely retained");
    const intent = matches[0];
    if (intent.schema !== "PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1"
      || intent.actor !== EXPECTED_ACTOR
      || intent.auctionId !== EXPECTED_AUCTION
      || !ID.test(intent.environmentId)
      || intent.bidAmount !== 111) {
      fail("the retained public operation identity differs");
    }
    return { environmentId: intent.environmentId };
  }

  async function inspect(platform) {
    if (platform.location?.origin !== EXPECTED_ORIGIN) fail("origin differs; stop in the current tab");
    const intent = readPublicIntent(platform);
    const catalog = await databaseCatalog(platform);
    const cocoDatabaseName = `plebeian-friday-coco-${intent.environmentId}-${EXPECTED_ACTOR}`;
    const identityKey = `${intent.environmentId}\u0000${EXPECTED_ACTOR}\u0000${EXPECTED_OPERATION}`;

    const privateDatabase = await openExistingExact(
      platform,
      catalog,
      PRIVATE_DATABASE,
      [OPERATION_STORE, ABORT_STORE],
      PRIVATE_DATABASE_VERSION,
    );
    let operation;
    let abortKey;
    try {
      const transaction = privateDatabase.transaction([OPERATION_STORE, ABORT_STORE], "readonly");
      const operationRequest = transaction.objectStore(OPERATION_STORE).get(identityKey);
      const abortRequest = transaction.objectStore(ABORT_STORE).getKey(identityKey);
      [operation, abortKey] = await Promise.all([
        requestResult(operationRequest),
        requestResult(abortRequest),
      ]);
    } finally {
      privateDatabase.close();
    }

    if (operation !== undefined && (
      !operation || typeof operation !== "object" || Array.isArray(operation)
      || operation.schema !== "PLEBEIAN_FRIDAY_BROWSER_PAYMENT_OPERATION_V1"
      || operation.actor !== EXPECTED_ACTOR
      || operation.environmentId !== intent.environmentId
      || operation.fundingOperationId !== EXPECTED_OPERATION
      || operation.auctionId !== EXPECTED_AUCTION
      || !PHASES.has(operation.phase)
    )) {
      fail("the exact private operation record is malformed or cross-identity");
    }

    const cocoDatabase = await openExistingExact(
      platform,
      catalog,
      cocoDatabaseName,
      [PROOF_STORE],
    );
    let proofOperationLinkCount;
    try {
      const transaction = cocoDatabase.transaction(PROOF_STORE, "readonly");
      const proofStore = transaction.objectStore(PROOF_STORE);
      if (!proofStore.indexNames.contains(PROOF_OPERATION_INDEX)) {
        fail("the Coco proof operation index is absent");
      }
      proofOperationLinkCount = await requestResult(
        proofStore.index(PROOF_OPERATION_INDEX).count(EXPECTED_OPERATION),
      );
    } finally {
      cocoDatabase.close();
    }
    if (!Number.isSafeInteger(proofOperationLinkCount) || proofOperationLinkCount < 0) {
      fail("the proof operation-link count is invalid");
    }

    return Object.freeze({
      schema: "PLEBEIAN_FRIDAY_EXACT_OPERATION_DIAGNOSTIC_V1",
      originMatch: true,
      publicIntentPresent: true,
      localActorMatch: operation === undefined ? null : true,
      localEnvironmentMatch: operation === undefined ? null : true,
      operationPresent: operation !== undefined,
      operationPhase: operation === undefined ? null : operation.phase,
      proofOperationLinkCount,
      fundingAbortJournalPresent: abortKey !== undefined,
    });
  }

  void inspect(globalThis).then(
    (result) => console.log("PLEBEIAN_READ_ONLY_DIAGNOSTIC_RESULT", result),
    (error) => console.error("PLEBEIAN_READ_ONLY_DIAGNOSTIC_FAILED", Object.freeze({
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "unknown failure",
    })),
  );
})();
