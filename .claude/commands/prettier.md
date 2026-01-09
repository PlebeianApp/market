# Prettier

Run Prettier formatting check as required by CI workflow.

## Instructions

1. Run `bun run format:check` to check for formatting issues (same as CI)
2. If there are formatting errors:
   - Show which files have issues
   - Run `bun run format` to fix them automatically
   - Report what was fixed
3. If no issues found, confirm the codebase passes the Prettier CI check
