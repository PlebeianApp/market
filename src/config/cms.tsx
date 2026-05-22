import { CMSUserProfile, type CMSUserProfileProps } from '../components/cms/CMSUserProfile'
import { CMSItemGrid, type CMSItemGridProps } from '../components/cms/CMSItemGrid'
import type { Config } from '@puckeditor/core'
import { CustomTextField } from '@/components/editor/CustomTextField'

console.log('CMSItemGrid loaded?', CMSItemGrid)

type Components = {
	CMSUserProfile: CMSUserProfileProps
	CMSItemGrid: CMSItemGridProps
	HeadingBlock: {
		title: string
	}
	Paragraph: {
		text: string
	}
}

const config: Config<Components> = {
	components: {
		CMSUserProfile: {
			fields: {
				pubkey: {
					type: 'text',
					label: 'Public Key (hex)',
				},
				relayUrl: {
					type: 'text',
					label: 'Relay URL (optional)',
				},
			},
			render: ({ pubkey }: CMSUserProfileProps) => <CMSUserProfile pubkey={pubkey} />,
		},
		CMSItemGrid: {
			fields: {
				kind: {
					type: 'number',
					label: 'Event Kind',
				},
				limit: {
					type: 'number',
					label: 'Max Items',
				},
				author: {
					type: 'text',
					label: 'Pubkey of author',
				},
				relayUrl: {
					type: 'text',
					label: 'Relay URL (optional)',
				},
				tags: {
					type: 'custom',
					label: 'Tag filters for nostr fetch query',
					render: ({ name, onChange, value, field }) => <CustomTextField field={field} value={value ?? []} onChange={onChange} />,
				},
			},
			defaultProps: {
				kind: 30402,
				limit: 5,
				author: '',
				tags: [], // Default to empty array
			},
			render: ({ kind, tags, limit, relayUrl, author }: CMSItemGridProps) => (
				<CMSItemGrid kind={kind} tags={tags} author={author} limit={limit} relayUrl={relayUrl} />
			),
		},
		HeadingBlock: {
			fields: {
				title: {
					type: 'text',
				},
			},
			defaultProps: {
				title: 'Hello, world',
			},
			render: ({ title }: { title: string }) => {
				return <h1 className="text-3xl font-bold">{title}</h1>
			},
		},
		Paragraph: {
			fields: {
				text: { type: 'text' },
			},
			defaultProps: {
				text: 'Paragraph',
			},
			render: ({ text }: { text: string }) => (
				<div className="p-16">
					<p className="text-lg">{text}</p>
				</div>
			),
		},
	},
}

export default config
