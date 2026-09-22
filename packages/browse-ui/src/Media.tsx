/**
 * `Media` — the one component with a target-specific seam, and the only place a component is allowed
 * to touch the host for something other than data.
 *
 * In-process it renders `<img src>` directly; in a sandbox that is a subresource request the CSP
 * blocks (`img-src data: blob:`), so it resolves bytes through `env.resource` and renders an object
 * URL. **Same props, two byte sources, one component.**
 */
import { useEffect, useState } from 'react'

import type { BrowseEnvironment } from '@plebeian/nostr-access'

export interface MediaProps {
	src: string | undefined
	alt: string
	env: BrowseEnvironment
	className?: string
}

export const Media = ({ src, alt, env, className }: MediaProps) => {
	const [resolved, setResolved] = useState<string | undefined>(undefined)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let cancelled = false
		setFailed(false)
		if (!src) {
			setResolved(undefined)
			return
		}
		env
			.resource(src)
			.then((url) => {
				if (!cancelled) setResolved(url)
			})
			.catch(() => {
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [src, env])

	if (!src || failed) {
		return <div className={`pb-card__media pb-card__media--placeholder ${className ?? ''}`}>no image</div>
	}

	return <img className={`pb-card__media ${className ?? ''}`} src={resolved ?? undefined} alt={alt} loading="lazy" />
}
