/**
 * Media URL detection shared by uploaders (preview) and renderers
 * (carousel / gallery / display). Files are typed by URL extension since
 * stored media URLs carry no separate MIME tag.
 */

/** Returns whether a media URL points to a video (vs an image). */
export function isVideoUrl(url: string): boolean {
	return /\.(mp4|webm|ogg|mov)($|\?)/i.test(url)
}

export function getMediaType(url: string): 'image' | 'video' {
	return isVideoUrl(url) ? 'video' : 'image'
}

/** Returns the lowercase file extension of a media URL, or undefined. */
export function getMediaExtension(url: string): string | undefined {
	const path = url.split('?')[0].split('#')[0]
	const m = path.match(/\.([a-zA-Z0-9]+)$/)
	return m ? m[1].toLowerCase() : undefined
}
