export {
	defineActionFor,
	defineExtension,
	EXTENSION_RUNTIMES,
	isValidExtensionIcon,
	MAX_DESCRIPTION_LENGTH,
	parseExtensionConfig,
	validateExtensionDefinition,
	validateExtensionManifest,
} from './extension'
export type {
	AnyExtensionDefinition,
	ExtensionContext,
	ExtensionDefinition,
	ExtensionLifecycle,
	ExtensionManifest,
	ExtensionRuntime,
	ParsedExtensionConfig,
} from './extension'
export {
	EXTENSION_HOST_PORTS,
	EXTENSION_HTTP_METHODS,
	ExtensionHttpError,
	isEgressAllowed,
	isLocalhostOrigin,
	parseEgressOrigin,
	parseJsonResponseBody,
} from './hostPorts'
export type {
	ExtensionHostPortName,
	ExtensionHostPorts,
	ExtensionHttpErrorReason,
	ExtensionHttpMethod,
	ExtensionHttpRequest,
	ExtensionHttpResponse,
	ExtensionLogFields,
	ExtensionLogger,
	ScopedHttpPort,
	ScopedRelayPort,
	ScopedRelayQueryOptions,
} from './hostPorts'
export {
	actionTransports,
	DEFAULT_EXTENSION_ACTION_TRANSPORTS,
	describeExtensionActions,
	executeExtensionAction,
	EXTENSION_ACTION_AUTH,
	EXTENSION_ACTION_ERROR_STATUS,
	EXTENSION_ACTION_TRANSPORTS,
	ExtensionActionError,
	extensionActionPath,
	isValidExtensionActionName,
	providerStatusToActionError,
	toExtensionActionErrorResponse,
} from './actions'
export type {
	AnyExtensionActionDefinition,
	ExecuteExtensionActionParams,
	ExtensionActionAuth,
	ExtensionActionContext,
	ExtensionActionDefinition,
	ExtensionActionErrorBody,
	ExtensionActionErrorCode,
	ExtensionActionRateLimit,
	ExtensionActionResponseBody,
	ExtensionActionSuccessBody,
	ExtensionActionTransport,
	ExtensionActionWireErrorCode,
	ExtensionCaller,
	PublicExtensionActionDescriptor,
} from './actions'
export { invokeExtensionAction, parseExtensionActionEnvelope, parseExtensionActionResponse } from './client'
export type { ExtensionActionFetch, InvokeExtensionActionOptions } from './client'
export {
	callerFromContextVmMeta,
	describeExtensionActionTools,
	EXTENSION_TOOL_PREFIX,
	extensionActionToolName,
	invokeExtensionActionOverContextVm,
	parseContextVmToolResult,
	parseExtensionActionToolName,
	toContextVmToolResult,
} from './contextvm'
export type { ContextVmCallTool, ContextVmToolResult, ExtensionActionToolDescriptor, InvokeOverContextVmOptions } from './contextvm'
export { describeExtension, findExtensionAction, parsePublicExtensionAction, parsePublicExtensionDescriptors } from './descriptors'
export type { ExtensionActionTarget, PublicExtensionDescriptor } from './descriptors'
export {
	addExtensionServer,
	sendAdminRequest,
	describeCatalogEntry,
	EXTENSION_BUILTINS_PATH,
	EXTENSION_SERVERS_PATH,
	removeExtensionServer,
	setBuiltinExtensionEnabled,
	EXTENSION_CATALOG_PATH,
	EXTENSION_CATALOG_STATES,
	fetchExtensionCatalog,
	parseExtensionCatalog,
	parseExtensionCatalogResponse,
} from './catalog'
export type {
	ExtensionCatalog,
	ExtensionCatalogEntry,
	ExtensionCatalogState,
	ExtensionManagedBy,
	FetchExtensionCatalogOptions,
} from './catalog'
export {
	BINDING_SUGGESTION_META_KEY,
	buildRepositorySnapshot,
	canonicalJson,
	hashInputSchema,
	collectRegistryServers,
	CONTEXTVM_SERVER_ANNOUNCEMENT_KIND,
	CONTEXTVM_TOOLS_LIST_KIND,
	EXTENSION_REGISTRY_D_TAG,
	EXTENSION_REGISTRY_LIST_KIND,
	parseRegistryList,
	parseRepositorySnapshot,
	parseServerAnnouncement,
	parseToolsList,
	suggestBinding,
} from './repository'
export type {
	BuildRepositoryParams,
	RepositoryEntryState,
	RepositoryExtensionEntry,
	RepositorySnapshot,
	RepositoryTool,
	SuggestedBinding,
} from './repository'
export {
	actionNameProblem,
	CAPABILITY_FORMAT_HINT,
	capabilityProblem,
	createRemoteBinding,
	createRemoteBindings,
	deleteRemoteBinding,
	EXTENSION_BINDINGS_PATH,
	parseRemoteBindingRequest,
	parseRemoteBindingViews,
	parseRemoteExtensionId,
	REMOTE_BINDING_STATES,
	REMOTE_EXTENSION_PREFIX,
	RemoteActionOutputSchema,
	remoteExtensionId,
	toRemoteActionOutput,
	updateRemoteBinding,
} from './bindings'
export type { RemoteActionOutput, RemoteBindingRequest, RemoteBindingState, RemoteBindingView } from './bindings'
