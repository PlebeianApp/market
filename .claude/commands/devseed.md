# Dev Seed

Start the development environment with a fresh seeded database.

## Steps

1. Start the local relay server in the background:

   ```bash
   next.orly.dev serve &
   ```

2. Wait for relay to be ready, then start the dev server with seeding:
   ```bash
   sleep 2 && bun dev:seed
   ```

## Notes

- The relay runs on ws://localhost:10547
- Seeds test data into the relay
- Use `/stopdev` to stop the servers
