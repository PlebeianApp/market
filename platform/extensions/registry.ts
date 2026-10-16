import { ValidationError } from '@sdk/core/errors'
import { parseExtensionConfig, type AnyExtensionDefinition, type ExtensionRuntime } from '@sdk/core/extensions'
import { failure, success, type Result } from '@sdk/core/result'

/** Stored per-instance values; Platform owns these, including private secrets. */
export interface ExtensionInstanceSetting {
	id: string
	enabled: boolean
	publicConfig?: unknown
	privateConfig?: unknown
}

export interface PublicExtensionDescriptor {
	id: string
	version: string
	capabilities: readonly string[]
	config: unknown
}

interface ConfiguredExtension {
	definition: AnyExtensionDefinition
	publicConfig: unknown
	privateConfig: unknown
}

interface RunningExtension {
	definition: AnyExtensionDefinition
	handle: unknown
	controller: AbortController
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
		return this.configured.map(({ definition, publicConfig }) => ({
			id: definition.manifest.id,
			version: definition.manifest.version,
			capabilities: [...definition.manifest.capabilities],
			config: publicConfig,
		}))
	}

	/** Starts enabled extensions for one runtime; on failure, already-started ones are stopped. */
	async start(runtime: ExtensionRuntime): Promise<void> {
		const startedNow: RunningExtension[] = []
		try {
			for (const entry of this.configured) {
				const { manifest, lifecycle } = entry.definition
				if (!lifecycle || !manifest.runtimes.includes(runtime)) continue
				if (this.running.some((item) => item.definition.manifest.id === manifest.id)) continue

				const controller = new AbortController()
				const handle = await lifecycle.start({
					instanceId: this.instanceId,
					runtime,
					publicConfig: entry.publicConfig,
					privateConfig: runtime === 'client' ? undefined : entry.privateConfig,
					signal: controller.signal,
				})
				const item = { definition: entry.definition, handle, controller }
				startedNow.push(item)
				this.running.push(item)
			}
		} catch (error) {
			await this.stopItems(startedNow).catch(() => undefined)
			throw error
		}
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
