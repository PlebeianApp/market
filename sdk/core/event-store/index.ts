export { createMemoryEventStore } from './memoryEventStore'
export type { MemoryEventStoreOptions } from './memoryEventStore'
export { matchesFilter, selectMatching } from './filter'
export type { EventFilter } from './filter'
export {
	DELETION_REQUEST_KIND,
	getDTag,
	getReplaceableKey,
	isAddressableKind,
	isDeletedBy,
	isNewerVersion,
	isReplaceableKind,
	readDeletionTargets,
} from './mergeRules'
export type { DeletionTargets } from './mergeRules'
export type { EventAdmission, EventStoreAddResult, EventStorePort } from './port'
