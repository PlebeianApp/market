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
