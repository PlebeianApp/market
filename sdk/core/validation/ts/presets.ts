/**
 * presets.ts — `PASS_THROUGH` as a declared value, and preset selection.
 *
 * **`#07b8c7` is the whole reason this file exists**: with no presets supplied the module is a
 * pass-through that refuses nothing, and item 3 of the increment's order fixes the answer when
 * a candidate is covered by no preset — pass-through — so a host that declares nothing gets
 * exactly the behaviour of no module at all.
 *
 * `PASS_THROUGH` is a **declared value a test reads** (the `EvictionPolicy` / `WriteBackPolicy`
 * precedent, `#d4f95d`), not a branch buried in the engine: an empty `kinds` list covers every
 * kind, and an empty `checks` list has nothing to fail, so the same constant answers for "no
 * presets" and for "a preset set that covers another kind".
 */
import type { Event, ValidationPreset } from './types'

/**
 * The declared pass-through preset: covers every kind (an empty `kinds` list is the wildcard)
 * and carries no check, so nothing can refuse. Frozen, because a host must not be able to turn
 * the default into a rule by mutating it.
 */
/** #07b8c7 — PASS_THROUGH: the declared pass-through preset, covers every kind and refuses nothing. */
export const PASS_THROUGH: ValidationPreset = Object.freeze({
	name: 'pass-through',
	kinds: [],
	checks: [],
})

/**
 * Does this preset cover the candidate? An empty `kinds` list is the wildcard and covers every
 * kind; otherwise the candidate's kind must be named.
 */
/** #07b8c7 — covers: does a preset cover the candidate's kind. */
export function covers(preset: ValidationPreset, event: Event): boolean {
	return preset.kinds.length === 0 || preset.kinds.includes(event.kind)
}

/**
 * The preset that covers the candidate, or `PASS_THROUGH` when none does. This is the one
 * place the spec's default is decided (`#07b8c7`), and it returns a value rather than a branch
 * so a test can read the answer for a candidate the host never declared a kind for.
 *
 * **A specific match wins over a wildcard, whatever order the host declared them in.** An
 * empty `kinds` list covers every kind, so a wildcard listed first would otherwise shadow every
 * rule beneath it and refuse a candidate with a preset the host did not mean to apply. Order
 * still decides **within** the specific matches and **within** the wildcards: the first
 * declared of the winning class is the one that runs.
 */
/** #07b8c7 — selectPreset: the preset that covers the candidate, or `PASS_THROUGH`. */
export function selectPreset(presets: readonly ValidationPreset[], event: Event): ValidationPreset {
	const specific = presets.find((preset) => preset.kinds.length > 0 && preset.kinds.includes(event.kind))
	return specific ?? presets.find((preset) => covers(preset, event)) ?? PASS_THROUGH
}
