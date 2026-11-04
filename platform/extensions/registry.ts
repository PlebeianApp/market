import { ValidationError } from '@sdk/core/errors'
import {
	describeExtension,
	parseExtensionConfig,
	type AnyExtensionDefinition,
	type ExtensionActionContext,
	type ExtensionHostPorts,
	type ExtensionRuntime,
	type PublicExtensionDescriptor,
} from '@sdk/core/extensions'
import { failure, success, type Result } from '@sdk/core/result'

/** Stored per-instance values; Platform owns these, including private secrets. */
export interface ExtensionInstanceSetting {
	id: string
	enabled: boolean
	publicConfig?: unknown
	privateConfig?: unknown
}

export type { PublicExtensionDescriptor }

/** Builds host ports for one extension; called once per start with that extension's abort signal. */
export type ExtensionHostFactory = (definition: AnyExtensionDefinition, privateConfig: unknown, signal: AbortSignal) => ExtensionHostPorts

export interface ExtensionStartOptions {
	/** Required for actions; client runtimes never receive host ports. */
	createHost?: ExtensionHostFactory
	/**
	 * When true, an extension that fails to start is skipped and reported instead of rolling back the
	 * others. Extensions are optional, so a host process should not fail to boot because of one.
	 */
	isolateFailures?: boolean
}

export interface ExtensionStartFailure {
	id: string
	error: unknown
}

export interface RunningExtensionAction {
	definition: AnyExtensionDefinition
	context: ExtensionActionContext<unknown, unknown>
}

interface ConfiguredExtension {
	definition: AnyExtensionDefinition
	publicConfig: unknown
	privateConfig: unknown
}

interface RunningExtension {
	definition: AnyExtensionDefinition
	runtime: ExtensionRuntime
	handle: unknown
	controller: AbortController
	context: ExtensionActionContext<unknown, unknown> | undefined
}

/** Per-instance extension enablement, config validation, and lifecycle. One registry per market instance. */
export class ExtensionRegistry {
	private readonly definitions = new Map<string, AnyExtensionDefinition>()
	private configured: ConfiguredExtension[] = []
	private running: RunningExtension[] = []

	constructor(readonly instanceId: string) {
		if (!instanceId.trim()) throw new Error('ExtensionRegistry requires an instanceId')
	}

	register(definition: AnyExtensionDefinition): this {
		const { id } = definition.manifest
		if (this.definitions.has(id)) throw new Error(`Extension already registered: ${id}`)
		this.definitions.set(id, definition)
		return this
	}

	/** Replaces the enabled set atomically; nothing changes if any setting is invalid. */
	configure(settings: readonly ExtensionInstanceSetting[]): Result<void, ValidationError[]> {
		if (this.running.length > 0) return failure([new ValidationError('Stop running extensions before reconfiguring')])

		const errors: ValidationError[] = []
		const next: ConfiguredExtension[] = []
		const seen = new Set<string>()

		for (const setting of settings) {
			if (seen.has(setting.id)) {
				errors.push(new ValidationError(`Duplicate extension setting: ${setting.id}`, ['id']))
				continue
			}
			seen.add(setting.id)
			const definition = this.definitions.get(setting.id)
			if (!definition) {
				errors.push(new ValidationError(`Unknown extension: ${setting.id}`, ['id']))
				continue
			}
			if (!setting.enabled) continue
			const parsed = parseExtensionConfig(definition.manifest, setting)
			if (!parsed.ok) {
				errors.push(parsed.error)
				continue
			}
			next.push({ definition, ...parsed.value })
		}

		if (errors.length > 0) return failure(errors)
		this.configured = next
		return success(undefined)
	}

	isEnabled(id: string): boolean {
		return this.configured.some((entry) => entry.definition.manifest.id === id)
	}

	hasCapability(capability: string): boolean {
		return this.configured.some((entry) => entry.definition.manifest.capabilities.includes(capability))
	}

	/** Client-safe view for public config endpoints; private config is never included. */
	getPublicDescriptors(): PublicExtensionDescriptor[] {
		return this.configured.map(({ definition, publicConfig }) => describeExtension(definition, publicConfig))
	}

	/** Enabled, running server extension and its action context; `undefined` hides disabled and unknown alike. */
	getActionTarget(id: string): RunningExtensionAction | undefined {
		const running = this.running.find((item) => item.definition.manifest.id === id && item.runtime === 'server')
		if (!running?.context || !running.definition.actions) return undefined
		return { definition: running.definition, context: running.context }
	}

	/** Starts enabled extensions for one runtime. Without `isolateFailures`, a failure stops those already started. */
	async start(runtime: ExtensionRuntime, options: ExtensionStartOptions = {}): Promise<ExtensionStartFailure[]> {
		const startedNow: RunningExtension[] = []
		const failures: ExtensionStartFailure[] = []
		for (const entry of [...this.configured]) {
			const { manifest, lifecycle, actions } = entry.definition
			if (!manifest.runtimes.includes(runtime)) continue
			if (!lifecycle && !(runtime === 'server' && actions)) continue
			if (this.running.some((item) => item.definition.manifest.id === manifest.id)) continue

			const controller = new AbortController()
			try {
				const privateConfig = runtime === 'client' ? undefined : entry.privateConfig
				const host = runtime === 'client' ? undefined : options.createHost?.(entry.definition, entry.privateConfig, controller.signal)
				if (actions && runtime === 'server' && !host) throw new Error(`${manifest.id}: actions require host ports`)
				const context = {
					instanceId: this.instanceId,
					runtime,
					publicConfig: entry.publicConfig,
					privateConfig,
					signal: controller.signal,
					...(host ? { host } : {}),
				}
				const handle = lifecycle ? await lifecycle.start(context) : undefined
				const item: RunningExtension = {
					definition: entry.definition,
					runtime,
					handle,
					controller,
					context: host ? { ...context, host } : undefined,
				}
				startedNow.push(item)
				this.running.push(item)
			} catch (error) {
				controller.abort()
				if (options.isolateFailures) {
					failures.push({ id: manifest.id, error })
					// A failed extension is disabled, so it is neither advertised nor reachable.
					this.configured = this.configured.filter((item) => item !== entry)
					continue
				}
				await this.stopItems(startedNow).catch(() => undefined)
				throw error
			}
		}
		return failures
	}

	async stop(): Promise<void> {
		await this.stopItems([...this.running])
	}

	private async stopItems(items: RunningExtension[]): Promise<void> {
		const errors: unknown[] = []
		for (const item of [...items].reverse()) {
			item.controller.abort()
			try {
				await item.definition.lifecycle?.stop?.(item.handle)
			} catch (error) {
				errors.push(error)
			}
			this.running = this.running.filter((running) => running !== item)
		}
		if (errors.length > 0) throw new AggregateError(errors, 'One or more extensions failed to stop')
	}
}
