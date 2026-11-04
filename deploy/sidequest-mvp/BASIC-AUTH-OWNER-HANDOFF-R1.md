# Five-account Basic Auth owner handoff R1

Status: prepared, not installed. No password is present in this repository.

## Why this route

The five testers are on separate networks, so a temporary `/32` allowlist is
not practical. One independent high-entropy Basic Auth account per tester,
inside the already-required trusted TLS connection, provides a short-lived
access gate without changing the auction application or its pinned HTTPS
origin. The application remains bound to `127.0.0.1:8180` and the authority to
`127.0.0.1:8181`.

The server-level nginx include in `nginx-basic-auth-r1.conf` protects every
location inherited by the exact HTTPS virtual host, including the UI, auction
API and same-origin fake-sat mint routes. It must be included in the final
configuration produced by the ongoing HTTPS lane; do not install a competing
server block.

## Owner-only credential creation

The owner should create and retain the five passwords directly in their
password manager. Use five independently generated passwords of at least 20
characters. Do not reuse an SSH, email, Nostr or other account password.

On the owner's trusted workstation, run this interactively outside an agent
session:

```text
./deploy/sidequest-mvp/prepare-demo-basic-auth-hashes.sh /OWNER_PRIVATE_PATH/plebeian-auctions-demo.htpasswd
```

The helper prompts without echo, stores only salted SHA-512 crypt hashes and
creates the output once with mode `0600`. Passwords are never command-line
arguments, environment variables, repository files or agent output.

The owner then stages only the hash file to APP. The installed target must be a
regular, non-symlink, single-link file at:

```text
/etc/nginx/plebeian-auctions-demo.htpasswd
```

Required metadata is `root:www-data 0640`. The staged file must contain exactly
five unique lines named `demo-1` through `demo-5`, each with a `$6$` digest, and
no blank or additional account. The staging and installation procedure must
not print its contents.

## HTTPS integration and verification

After the certificate lane has produced its exact final APP virtual host:

1. Install `nginx-basic-auth-r1.conf` as a root-owned `0644` snippet.
2. Include it once at the `server` level, so every location inherits it.
3. Run `nginx -t`. Do not reload on any error.
4. Reload nginx once; do not restart the auction services.
5. From an ordinary external browser, require a valid certificate and a Basic
   Auth prompt. An unauthenticated request must return `401` with no application
   body. Each of the five accounts must receive the site with its own password;
   a wrong password must return `401`.
6. Confirm `/api/config`, `/api/browser-release-pins` and the fake-mint routes
   are also inaccessible without authentication. Confirm the browser auction
   flow succeeds after authentication and the origin remains exactly
   `https://139.162.161.233`.

Never log an `Authorization` header. Access logs may retain usernames depending
on the final nginx format; use a format that omits `$remote_user`, query strings
and request bodies for the short demo.

## Secure distribution

The agent does not receive or send any password. The owner shares each account
only with its named tester using a recipient-specific password-manager secure
share. Do not send credentials in chat, email, meeting notes or screenshots.
Each tester gets only one username and its corresponding password.

The five demo accounts are independent from the tab-local auction identities.
After Basic Auth succeeds, each tester still selects **Use demo identity** in a
separate browser profile and must keep that tab open until settlement.

## Cleanup

After the meeting, a separate approved cleanup should remove the five-account
access file and Basic Auth include, validate nginx, and either close public 443
or replace the temporary access mechanism. Do not leave the meeting passwords
as a production access control.

## Remaining approval

Approval of the account names permits preparation of these five accounts. It
does not by itself authorize changing the live HTTPS virtual host or reloading
nginx. Once the HTTPS lane's exact config and certificate are known, obtain one
scoped approval to install the hash file and snippet, modify only that virtual
host to include the snippet, validate, reload nginx and verify the five accounts
without printing credentials.

