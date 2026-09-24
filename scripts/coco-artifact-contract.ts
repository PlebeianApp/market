import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const COCO_ROUND_9_SHA = '35941014a61af7dc112b31de8053db610b70085c' as const
export const COCO_CORE_INSTALLED_CONTENT_HASH = 'sha256:fd0b207c45ace25a74525df283b3a75183bba046faab5a0b7772df3dbb56e8eb' as const
export const COCO_INDEXEDDB_INSTALLED_CONTENT_HASH = 'sha256:efa6b6cadfaa7da1847c7beecea0b29e4f65052549410353e6c1d73b7013de91' as const

export async function installedContentHash(root: string): Promise<string> {
	const files: string[] = []
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory)) {
			const absolute = path.join(directory, entry)
			const metadata = await lstat(absolute)
			if (metadata.isSymbolicLink()) throw new Error(`Installed Coco package contains a forbidden symlink: ${absolute}`)
			if (metadata.isDirectory()) await visit(absolute)
			else if (metadata.isFile()) files.push(absolute)
			else throw new Error(`Installed Coco package contains an unsupported filesystem entry: ${absolute}`)
		}
	}
	await visit(root)
	const aggregate = createHash('sha256')
	for (const absolute of files.sort()) {
		const relative = path.relative(root, absolute).split(path.sep).join('/')
		const fileHash = createHash('sha256')
			.update(await readFile(absolute))
			.digest('hex')
		aggregate.update(relative).update('\0').update(fileHash).update('\n')
	}
	return `sha256:${aggregate.digest('hex')}`
}
