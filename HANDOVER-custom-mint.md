# Handover: Custom Mint URL Support for Auctions

## Context

This branch (`feat/auction-custom-mint-support`) is for a **separate PR** that adds custom mint URL entry to the auction form. It was extracted from PR #840 (`fix/auction-trusted-mint-state-ownership`) at the request of reviewers.

**Why it was split out:** Both Franchovy and maximotodev requested that custom mint support be removed from the state-ownership fix PR because trusted mints become signed auction tags (Cashu trust policy). Allowing arbitrary custom mints without security review introduces rug-pull risk for auction bidders. See PR #840 review comments for full discussion.

## What to Do

### 1. Re-add the custom mint code

The commit `de9a646f` (on `fix/auction-trusted-mint-state-ownership`) **removed** the custom mint functionality. You need to reverse that commit's changes to the 3 files below. The easiest way:

```bash
# Cherry-pick the parent commit (32fb8b0d) which had the custom mint code,
# then selectively keep only the custom-mint parts.
# OR simply reverse-apply the removal:
git show de9a646f | git apply -R
```

If `git apply -R` has conflicts (unlikely since this branch starts from that exact commit), apply the changes manually using the sections below.

### 2. Files and exact changes needed

#### `src/components/sheet-contents/auctions/AuctionFormContent.tsx`

Add back in `AuctionTabContent` function body:

```typescript
// After line: const [customMintInput, setCustomMintInput] = useState('')
// This state goes BEFORE the existing selectedMints line.
const [customMintInput, setCustomMintInput] = useState('')
```

```typescript
// After the addMint() function, add back:
const addCustomMint = () => {
	const trimmed = customMintInput.trim()
	if (!trimmed) return
	addMint(trimmed)
	setCustomMintInput('')
}
```

```typescript
// After the closing </div> of the unselected mints section (the one with the + buttons),
// add back the text input + button block:
				<div className="flex gap-2 mt-3">
					<Input
						placeholder="Enter mint URL..."
						value={customMintInput}
						onChange={(e) => setCustomMintInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault()
								addCustomMint()
							}
						}}
						className="flex-1"
					/>
					<Button type="button" variant="outline" size="sm" onClick={addCustomMint} disabled={!customMintInput.trim()}>
						<Plus className="w-4 h-4" />
					</Button>
				</div>
```

#### `src/lib/__tests__/auctionMintSync.test.ts`

Add back this test before the "does not duplicate" test:

```typescript
	test('custom mint not in availableMints is preserved in selection', () => {
		const result = syncMintSelection(['mint-a'], ['mint-a'], ['mint-a', 'https://custom.mint.example'], EMPTY)
		expect(result).toEqual(['mint-a', 'https://custom.mint.example'])
	})
```

#### `e2e-new/tests/auction-mint-state.spec.ts`

**Remove** the `unselectedMintLocator` helper function and the "user can re-add a previously removed mint via unselected list" test.

**Add back** these 3 tests:

```typescript
	test('user can add a custom mint URL via text input', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const customMintUrl = 'https://custom-test-mint.example.com'

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		await merchantPage.getByPlaceholder('Enter mint URL...').fill(customMintUrl)

		await merchantPage.getByPlaceholder('Enter mint URL...').press('Enter')

		await expect(merchantPage.locator(`span[title="${customMintUrl}"]`)).toBeVisible({ timeout: 10_000 })

		const removeButtons = merchantPage.getByTitle('Remove mint')
		const afterCount = await removeButtons.count()
		expect(afterCount).toBeGreaterThanOrEqual(DEFAULT_TRUSTED_MINTS.length + 1)
	})

	test('user can re-add a previously removed mint via text input', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const firstSelectedRow = removeButtons.first().locator('..')
		const removedMintSpan = firstSelectedRow.locator('span[title]')
		const removedMintUrl = (await removedMintSpan.getAttribute('title')) ?? ''

		await removeButtons.first().click()

		await expect(selectedMintLocator(merchantPage, removedMintUrl)).not.toBeVisible()

		await merchantPage.getByPlaceholder('Enter mint URL...').fill(removedMintUrl)
		await merchantPage.getByPlaceholder('Enter mint URL...').press('Enter')

		await expect(selectedMintLocator(merchantPage, removedMintUrl)).toBeVisible({ timeout: 10_000 })
	})

	test('empty text input does not add a mint', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const initialCount = await removeButtons.count()

		const input = merchantPage.getByPlaceholder('Enter mint URL...')
		await input.clear()

		const container = input.locator('xpath=../..')
		const addButton = container.locator('> button')
		await expect(addButton).toBeDisabled()

		const afterCount = await removeButtons.count()
		expect(afterCount).toBe(initialCount)
	})
```

### 3. Security enhancements (REQUIRED before merge)

The reviewers explicitly called out that custom mint support needs its own threat model. At minimum, add:

- **URL validation**: The input should validate that the entered string is a valid HTTPS URL
- **Buyer-facing warning**: Add a note in the UI explaining that custom mints are not vetted and buyers should verify trust
- **Mint reachability check** (optional but recommended): Warn if the mint URL is unreachable before allowing it

### 4. Target branch for PR

Per Franchovy's comment on PR #840, the target branch should be `origin/auctions/cashu-p2pk-path-oracle-v1` (not `feature/auctions-better-auction-submission-form`). Rebase accordingly before opening the PR.

### 5. Testing

```bash
# Unit tests (should be 11 pass after re-adding the custom mint test)
bun test src/lib/__tests__/auctionMintSync.test.ts

# Prettier
bunx prettier --check "src/components/sheet-contents/auctions/AuctionFormContent.tsx" \
  "src/lib/__tests__/auctionMintSync.test.ts" \
  "e2e-new/tests/auction-mint-state.spec.ts"

# E2E (Playwright) — requires relay + dev server running
# See e2e-new/playwright.config.ts for setup
npx playwright test --config e2e-new/playwright.config.ts e2e-new/tests/auction-mint-state.spec.ts
```

### 6. Commit and push

```bash
git add -A
git commit -m "feat(auctions): add custom mint URL support for trusted mints"
git push -u origin feat/auction-custom-mint-support
```

Then open a PR targeting `auctions/cashu-p2pk-path-oracle-v1`.

## Key Commit References

| Hash | Description |
|------|-------------|
| `32fb8b0d` | Original commit that added custom mint + offline mint preservation |
| `de9a646f` | Removal commit — reverse this to get custom mint code back |
| `9a55da5b` | Clean base commit for the state-ownership PR (no custom mints) |

## syncMintSelection (no changes needed)

The pure sync function in `src/lib/auctionMintSync.ts` already handles preserving mints not in `availableMints` (custom or offline). No changes needed there.
