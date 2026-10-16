#!/usr/bin/env node
/**
 * verify.cjs — the headless checks for the signer BPMN build.
 *
 *   node verify.cjs <viewer.html> <_render-canvas.html> <signer-session.png>
 *
 * 1. Opens the viewer from a file:// URL in headless chromium, imports the
 *    diagram the viewer ships (the same XML), and reports the importer's own
 *    warnings plus every console message. Zero warnings is the acceptance bar.
 * 2. Prints the element-type histogram from bpmn-js's element registry, so it
 *    can be compared with the histogram the generator printed from its tables.
 * 3. Opens the second page — the one sized to the canvas, not the widget page —
 *    and screenshots it at that size to signer-session.png.
 *
 * Playwright is resolved by absolute path first: `require('playwright')`
 * resolves relative to this script's own directory, not the cwd, so an
 * installed-but-next-door package would otherwise be MODULE_NOT_FOUND.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const PLAYWRIGHT_CANDIDATES = [
	process.env.PLAYWRIGHT_PATH,
	'/home/admin_maxime/work/wt-consol/node_modules/playwright',
	'/home/admin_maxime/work/node_modules/playwright',
	'playwright',
].filter(Boolean)

let chromium = null
let playwrightFrom = null
for (const candidate of PLAYWRIGHT_CANDIDATES) {
	try {
		chromium = require(candidate).chromium
		playwrightFrom = candidate
		break
	} catch (err) {
		/* try the next candidate */
	}
}
if (!chromium) {
	process.stdout.write('playwright: NOT FOUND (tried ' + PLAYWRIGHT_CANDIDATES.join(', ') + ')\n')
	process.stdout.write('IMPORT_WARNINGS=could not run\n')
	process.exit(0)
}

const [viewerPath, renderPath, pngPath] = process.argv.slice(2)
const canvasW = Number(process.env.CANVAS_W || 4000)
const canvasH = Number(process.env.CANVAS_H || 6000)

const out = []
out.push('playwright: ' + playwrightFrom)

async function main() {
	const browser = await chromium.launch({
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
	})

	// --- 1 + 2: the widget page, imported exactly as the reader will import it
	const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
	const console_ = []
	page.on('console', (msg) => console_.push(msg.type() + ': ' + msg.text()))
	page.on('pageerror', (err) => console_.push('pageerror: ' + err.message))
	await page.goto('file://' + path.resolve(viewerPath), { waitUntil: 'load' })
	await page.waitForFunction('window.__viewerReady === true', null, { timeout: 60000 })

	const debugLabels = process.env.DEBUG_LABELS === '1'
	const importResult = await page.evaluate((dbgLabels) => {
		const viewer = window.__viewer
		const registry = viewer.get('elementRegistry')
		const counts = {}
		registry.getAll().forEach((el) => {
			const type = el.type || 'unknown'
			counts[type] = (counts[type] || 0) + 1
		})
		const canvas = viewer.get('canvas')

		// --- label geometry, measured on the rendered text: a label's drawn text
		// must not sit on a shape that is not its owner, and two labels' text must
		// not sit on each other. The registered box is unioned with the text bbox,
		// because bpmn-js keeps a stale height for some flow labels.
		const all = registry.getAll()
		const labels = all.filter((el) => el.type === 'label')
		const shapes = all.filter(
			(el) =>
				el.type !== 'label' &&
				el.width > 0 &&
				el.type !== 'bpmn:SequenceFlow' &&
				el.type !== 'bpmn:MessageFlow' &&
				el.type !== 'bpmn:Process' &&
				el.type !== 'bpmn:Collaboration' &&
				el.type !== 'bpmn:Lane' &&
				el.type !== 'bpmn:Participant',
		)
		const box = (el) => ({ x: el.x, y: el.y, w: el.width, h: el.height })
		const hit = (p, q) => p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2
		// the union of the registered box and what is actually drawn
		const drawn = (l) => {
			const b = box(l)
			let tb = null
			const gfx = registry.getGraphics(l)
			if (gfx && gfx.getBBox) {
				try {
					const r = gfx.getBBox()
					tb = { x: l.x + r.x, y: l.y + r.y, w: r.width, h: r.height }
				} catch (e) {
					tb = null
				}
			}
			if (!tb) return b
			const x = Math.min(b.x, tb.x),
				y = Math.min(b.y, tb.y)
			const x2 = Math.max(b.x + b.w, tb.x + tb.w),
				y2 = Math.max(b.y + b.h, tb.y + tb.h)
			return { x: x, y: y, w: x2 - x, h: y2 - y }
		}
		const overlaps = []
		for (const l of labels) {
			const owner = l.labelTarget
			const lb = drawn(l)
			for (const s of shapes) {
				if (owner && (s === owner || (owner.host && s === owner.host))) continue
				if (hit(lb, box(s))) {
					overlaps.push((l.name || l.id) + ' [' + (owner ? owner.id : '?') + '] over ' + s.id)
				}
			}
		}
		const labelCollisions = []
		const drawnBoxes = labels.map((l) => ({ l: l, r: drawn(l) }))
		for (let i = 0; i < drawnBoxes.length; i++) {
			for (let j = i + 1; j < drawnBoxes.length; j++) {
				if (hit(drawnBoxes[i].r, drawnBoxes[j].r)) {
					labelCollisions.push((drawnBoxes[i].l.name || drawnBoxes[i].l.id) + ' / ' + (drawnBoxes[j].l.name || drawnBoxes[j].l.id))
				}
			}
		}
		const clipped = []
		const detail = []
		for (const l of labels) {
			const gfx = registry.getGraphics(l)
			if (!gfx || !gfx.getBBox) continue
			let b
			try {
				b = gfx.getBBox()
			} catch (e) {
				continue
			}
			const lb = box(l)
			detail.push({
				id: l.id,
				owner: l.labelTarget && l.labelTarget.id,
				text: l.name,
				box: { x: Math.round(lb.x), y: Math.round(lb.y), w: Math.round(lb.w), h: Math.round(lb.h) },
				text2: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
				di:
					l.di && l.di.label && l.di.label.bounds
						? {
								x: Math.round(l.di.label.bounds.x),
								y: Math.round(l.di.label.bounds.y),
								w: Math.round(l.di.label.bounds.width),
								h: Math.round(l.di.label.bounds.height),
							}
						: null,
			})
			if (b.height > lb.h + 1.5 || b.width > lb.w + 1.5) {
				clipped.push(
					(l.name || l.id) +
						' text ' +
						Math.round(b.width) +
						'x' +
						Math.round(b.height) +
						' > box ' +
						Math.round(lb.w) +
						'x' +
						Math.round(lb.h),
				)
			}
		}

		return {
			warnings: window.__importWarnings || [],
			errors: window.__importErrors || [],
			counts: counts,
			total: registry.getAll().length,
			firstOffset: window.__firstElementOffset || null,
			viewbox: canvas.viewbox(),
			labels: labels.length,
			labelOverlaps: overlaps,
			labelClipped: clipped,
			labelCollisions: labelCollisions,
			labelDetail: dbgLabels ? detail : [],
		}
	}, debugLabels)

	out.push('')
	out.push('widget import warnings: ' + importResult.warnings.length)
	for (const w of importResult.warnings) out.push('  WARNING: ' + JSON.stringify(w))
	out.push('widget import errors: ' + importResult.errors.length)
	for (const e of importResult.errors) out.push('  ERROR: ' + e)
	out.push('console messages: ' + console_.length)
	for (const m of console_) out.push('  ' + m)
	out.push(
		'opened at scale ' +
			importResult.viewbox.scale +
			'; first element offset inside the viewport: ' +
			JSON.stringify(importResult.firstOffset),
	)
	out.push('')
	out.push('element registry (bpmn-js), by type:')
	Object.keys(importResult.counts)
		.sort()
		.forEach((k) => {
			out.push('  ' + k + ' ' + importResult.counts[k])
			out.push('HIST ' + k + ' ' + importResult.counts[k])
		})
	out.push('HIST label ' + importResult.labels)
	out.push('  total ' + importResult.total)
	out.push('HIST total ' + importResult.total)
	out.push('')
	out.push('label geometry — a label printed over a shape that is not its owner: ' + importResult.labelOverlaps.length)
	for (const o of importResult.labelOverlaps) out.push('  OVERLAP: ' + o)
	out.push("label geometry — two labels' text on each other: " + importResult.labelCollisions.length)
	for (const c of importResult.labelCollisions) out.push('  COLLIDE: ' + c)
	out.push('label geometry — rendered text bigger than the registry says (info only): ' + importResult.labelClipped.length)
	for (const c of importResult.labelClipped) out.push('  tall: ' + c)
	for (const d of importResult.labelDetail) out.push('  LABEL ' + JSON.stringify(d))
	out.push('LABEL_OVERLAPS=' + importResult.labelOverlaps.length)
	out.push('LABEL_COLLISIONS=' + importResult.labelCollisions.length)
	out.push('LABEL_CLIPPED=' + importResult.labelClipped.length)
	out.push('IMPORT_WARNINGS=' + importResult.warnings.length)

	// --- the viewer's own controls: zoom buttons, and the talk-back buttons that
	// open a branch's detail in the page (they must work, not just exist)
	const controls = await page.evaluate(async () => {
		const canvas = window.__viewer.get('canvas')
		const seen = {}
		const click = (id) => document.getElementById(id).click()
		const wait = () => new Promise((r) => setTimeout(r, 60))
		click('fit')
		await wait()
		seen.fit = canvas.viewbox().scale
		click('z150')
		await wait()
		seen.z150 = canvas.viewbox().scale
		click('z100')
		await wait()
		seen.z100 = canvas.viewbox().scale
		const buttons = Array.prototype.slice.call(document.querySelectorAll('.btns button'))
		seen.buttons = buttons.length
		seen.opened = []
		for (const b of buttons) {
			b.click()
			await wait()
			const target = document.getElementById(b.getAttribute('data-target'))
			seen.opened.push(target && target.classList.contains('open') ? target.id : 'MISSING:' + b.getAttribute('data-target'))
		}
		const badge = document.querySelector('.bjs-powered-by')
		seen.badgeHidden = !badge || getComputedStyle(badge).display === 'none'
		const palette = document.querySelector('.djs-palette, .bjs-palette')
		seen.paletteHidden = !palette || getComputedStyle(palette).display === 'none'
		seen.panels = document.querySelectorAll('#panels section').length
		return seen
	})
	out.push(
		'viewer controls: fit scale ' +
			controls.fit.toFixed(3) +
			', 150% -> ' +
			controls.z150.toFixed(3) +
			', 100% -> ' +
			controls.z100.toFixed(3),
	)
	out.push('viewer talk-back buttons: ' + controls.buttons + '   opened: ' + JSON.stringify(controls.opened))
	// the amber "specified, not exercised end to end" marking must actually be
	// painted, not merely present in the XML
	const amber = await page.evaluate(() => {
		const reg = window.__viewer.get('elementRegistry')
		const ids = []
		reg.getAll().forEach((el) => {
			if (el.type === 'label' || !el.width) return
			const g = reg.getGraphics(el)
			const shape = g && g.querySelector('path, rect, circle, polygon')
			if (!shape) return
			const fill = getComputedStyle(shape).fill
			if (fill === 'rgb(254, 243, 199)') ids.push(el.id)
		})
		return ids
	})
	out.push('amber shapes actually painted in the viewer: ' + amber.length + ' -> ' + JSON.stringify(amber.sort()))
	out.push(
		'powered-by badge hidden: ' +
			controls.badgeHidden +
			'   palette hidden: ' +
			controls.paletteHidden +
			'   side-panel sections: ' +
			controls.panels,
	)
	out.push('VIEWER_150=' + controls.z150.toFixed(2) + ' VIEWER_100=' + controls.z100.toFixed(2))
	await page.close()

	// --- 3: the full-resolution PNG, from the page sized to the canvas
	const renderPage = await browser.newPage({
		viewport: { width: Math.ceil(canvasW), height: Math.ceil(canvasH) },
		deviceScaleFactor: 1,
	})
	const renderConsole = []
	renderPage.on('console', (msg) => renderConsole.push(msg.type() + ': ' + msg.text()))
	renderPage.on('pageerror', (err) => renderConsole.push('pageerror: ' + err.message))
	await renderPage.goto('file://' + path.resolve(renderPath), { waitUntil: 'load' })
	await renderPage.waitForFunction('window.__renderReady === true', null, { timeout: 90000 })
	const renderInfo = await renderPage.evaluate(() => ({
		info: window.__renderInfo || null,
		error: window.__renderError || null,
		warnings: window.__importWarnings || [],
	}))
	await renderPage.screenshot({
		path: pngPath,
		clip: { x: 0, y: 0, width: Math.ceil(canvasW), height: Math.ceil(canvasH) },
		fullPage: false,
	})
	const size = fs.statSync(pngPath)
	out.push('')
	out.push(
		'render page: ' +
			Math.ceil(canvasW) +
			' x ' +
			Math.ceil(canvasH) +
			' css px, scale ' +
			(renderInfo.info && renderInfo.info.scale) +
			', viewbox ' +
			JSON.stringify(renderInfo.info && renderInfo.info.viewbox),
	)
	out.push('render import warnings: ' + renderInfo.warnings.length)
	for (const w of renderInfo.warnings) out.push('  WARNING: ' + JSON.stringify(w))
	if (renderInfo.error) out.push('render error: ' + renderInfo.error)
	out.push('render console messages: ' + renderConsole.length)
	for (const m of renderConsole) out.push('  ' + m)
	out.push('png: ' + path.basename(pngPath) + '  ' + size.size + ' bytes')
	await renderPage.close()
	await browser.close()
}

main()
	.then(() => {
		process.stdout.write(out.join('\n') + '\n')
	})
	.catch((err) => {
		process.stdout.write(out.join('\n') + '\n')
		process.stdout.write('verify.cjs failed: ' + ((err && err.stack) || err) + '\n')
		process.stdout.write('IMPORT_WARNINGS=error\n')
		process.exit(1)
	})
