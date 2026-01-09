# Run Dev

Start the development environment with existing database (no seeding).

## Steps

1. Start the local relay server in the background:

   ```bash
   next.orly.dev serve &
   ```

2. Wait for relay to be ready, then start the dev server:
   ```bash
   sleep 2 && bun dev
   ```

## Notes

- The relay runs on ws://localhost:10547
- Uses existing data in the relay (no fresh seed)
- Use `/stopdev` to stop the servers
