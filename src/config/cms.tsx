import { CMSUserProfile, type CMSUserProfileProps } from '../components/cms/CMSUserProfile'
import type { Config } from '@puckeditor/core'
import { CustomFilterField } from '@/components/editor/CustomFilterField'
import { CMSProductGrid, type CMSProductGridProps } from '@/components/cms/CMSProductGrid'
import type { NDKUser } from '@nostr-dev-kit/ndk'

type Components = {
	CMSUserProfile: CMSUserProfileProps
	CMSProductGrid: CMSProductGridProps
	HeadingBlock: {
		title: string
	}
	Paragraph: {
		text: string
	}
}

export const getCMSConfig = (ownUser?: NDKUser): Config<Components> => ({
	components: {
		CMSUserProfile: {
			fields: {
				identifier: {
					type: 'text',
					label: 'Public Key (hex)',
				},
				relayUrl: {
					type: 'text',
					label: 'Relay URL (optional)',
				},
			},
			defaultProps: {
				identifier: ownUser?.npub ?? '',
			},
			render: ({ identifier }: CMSUserProfileProps) => <CMSUserProfile identifier={identifier} />,
		},
		CMSProductGrid: {
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
				tags: {
					type: 'custom',
					label: 'Nostr Filter Tags',
					metadata: {
						description: 'Add filters to narrow down the Nostr feed (e.g., Category: electronics)',
					},
					render: ({ name, onChange, value, field }) => <CustomFilterField field={field} value={value ?? []} onChange={onChange} />,
				},
				relayUrl: {
					type: 'text',
					label: 'Relay URL (optional)',
				},
			},
			defaultProps: {
				kind: 30402,
				limit: 5,
				author: ownUser?.npub ?? '',
				tags: [], // Default to empty array
			},
			render: ({ kind, tags, limit, relayUrl, author }: CMSProductGridProps) => (
				<CMSProductGrid kind={kind} tags={tags} author={author} limit={limit} relayUrl={relayUrl} />
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
})
