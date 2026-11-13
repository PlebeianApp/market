import { parseExtensionConfig, type AnyExtensionDefinition } from '@sdk/core/extensions'
import type { ExtensionEnvConfig } from './envConfig'
import type { ExtensionInstanceSetting } from './registry'

export interface BuiltinResolution {
	/** Settings to pass to `ExtensionRegistry.configure`. */
	settings: ExtensionInstanceSetting[]
	/** Ids an admin switched off in the store. */
	disabledByAdmin: Set<string>
	/** Ids the store can switch on: configured in the environment, or needing no private config. */
	enableable: Set<string>
	/** Admin-safe reasons an admin-enabled extension cannot run. */
	problems: Map<string, string>
}

/**
 * Combines environment configuration with store overrides (ADR-0023 §7.4). The environment supplies config and
 * secrets; an admin override can switch an extension off, or on when it needs no private config. Store overrides
 * never carry config values.
 */
export function resolveBuiltinSettings(
	definitions: readonly AnyExtensionDefinition[],
	envConfig: ExtensionEnvConfig,
	overrides: ReadonlyMap<string, boolean>,
): BuiltinResolution {
	const settings: ExtensionInstanceSetting[] = []
	const disabledByAdmin = new Set<string>()
	const enableable = new Set<string>()
	const problems = new Map<string, string>()

	for (const definition of definitions) {
		const id = definition.manifest.id
		const fromEnv = envConfig.settings.find((setting) => setting.id === id)
		const needsPrivateConfig = Boolean(definition.manifest.privateConfig)
		if (fromEnv || !needsPrivateConfig) enableable.add(id)

		const override = overrides.get(id)
		if (override === false) {
			disabledByAdmin.add(id)
			continue
		}
		if (fromEnv) {
			settings.push(fromEnv)
			continue
		}
		if (override !== true) continue
		if (needsPrivateConfig) {
			problems.set(id, 'Needs private settings in the server environment')
			continue
		}
		const setting: ExtensionInstanceSetting = { id, enabled: true, publicConfig: {} }
		const parsed = parseExtensionConfig(definition.manifest, setting)
		if (!parsed.ok) {
			problems.set(id, parsed.error.message)
			continue
		}
		settings.push(setting)
	}
	return { settings, disabledByAdmin, enableable, problems }
}
