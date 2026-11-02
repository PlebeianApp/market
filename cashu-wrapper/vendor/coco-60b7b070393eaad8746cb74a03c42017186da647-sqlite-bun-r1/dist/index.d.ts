import type { Database } from "bun:sqlite";
import type { Repositories, RepositoryTransactionScope } from "@cashu/coco-core/adapter";

export interface SqliteRepositoriesOptions {
  database: Database;
}

export declare class SqliteRepositories implements Repositories {
  readonly mintRepository: Repositories["mintRepository"];
  readonly keyRingRepository: Repositories["keyRingRepository"];
  readonly counterRepository: Repositories["counterRepository"];
  readonly keysetRepository: Repositories["keysetRepository"];
  readonly proofRepository: Repositories["proofRepository"];
  readonly meltQuoteRepository: Repositories["meltQuoteRepository"];
  readonly mintQuoteRepository: Repositories["mintQuoteRepository"];
  readonly legacyMintQuoteRepository: Repositories["legacyMintQuoteRepository"];
  readonly historyRepository: Repositories["historyRepository"];
  readonly sendOperationRepository: Repositories["sendOperationRepository"];
  readonly meltOperationRepository: Repositories["meltOperationRepository"];
  readonly authSessionRepository: Repositories["authSessionRepository"];
  readonly mintOperationRepository: Repositories["mintOperationRepository"];
  readonly receiveOperationRepository: Repositories["receiveOperationRepository"];
  readonly paymentRequestReceiveOperationRepository: Repositories["paymentRequestReceiveOperationRepository"];
  readonly paymentRequestReceiveAttemptRepository: Repositories["paymentRequestReceiveAttemptRepository"];
  constructor(options: SqliteRepositoriesOptions);
  init(): Promise<void>;
  claimSessionAttachment(): unknown;
  releaseSessionAttachment(token: unknown): boolean;
  acquireAuthority(identity: Parameters<Repositories["acquireAuthority"]>[0]): ReturnType<Repositories["acquireAuthority"]>;
  releaseAuthority(): ReturnType<Repositories["releaseAuthority"]>;
  getAuthority(): ReturnType<Repositories["getAuthority"]>;
  getAuthorityState(): ReturnType<Repositories["getAuthorityState"]>;
  withTransaction<T>(fn: (repos: RepositoryTransactionScope) => Promise<T>): Promise<T>;
}
