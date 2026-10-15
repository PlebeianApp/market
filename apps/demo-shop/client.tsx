/**
 * client.tsx — the browser entry.
 *
 * The server has already rendered this page (`server.ts`), and it passes the
 * same props through `window.__DEMO_SHOP__`. So the browser *hydrates* what is
 * already on screen rather than re-fetching it: step 1's data reads are the
 * server's, and steps 2–5 (add to cart, checkout, payment) attach here without
 * gating the first paint on a relay.
 */

import * as React from 'react'
import { hydrateRoot } from 'react-dom/client'

import { App, type DemoShopPageProps } from './instance/App'

declare global {
	interface Window {
		__DEMO_SHOP__?: DemoShopPageProps
	}
}

const mount = document.getElementById('root')
const props = window.__DEMO_SHOP__

if (!mount) throw new Error('demo-shop: #root is missing from the served page')
if (!props) throw new Error('demo-shop: window.__DEMO_SHOP__ carries no props')

hydrateRoot(mount, <App {...props} />)