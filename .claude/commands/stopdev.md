# Stop Dev

Stop all running development servers.

## Steps

1. Kill the bun dev server:

   ```bash
   pkill -f "bun dev" || true
   ```

2. Kill the relay server:
   ```bash
   pkill -f "next.orly.dev serve" || true
   ```

## Notes

- Stops both the Bun dev server and the local relay
- Safe to run even if servers aren't running
