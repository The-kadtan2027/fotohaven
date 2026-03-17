Bug report:
- Where: npm run build
- What happens: Failed to collect page data for /api/albums
- What should happen: npm run build
- Error message:   npm run build

> fotohaven@0.1.0 build
> next build

   ▲ Next.js 15.1.4
   - Environments: .env.local, .env

   Creating an optimized production build ...
   Using cached swc package @next/swc-wasm-nodejs...
 ✓ Compiled successfully
   Skipping validation of types
   Skipping linting

   We detected TypeScript in your project and reconfigured your tsconfig.json file for you.
   The following suggested values were added to your tsconfig.json. These values can be changed to fit your project's needs:

        - target was set to ES2017 (For top-level `await`. Note: Next.js only polyfills for the esmodules target.)

   Collecting page data  ...Error [PrismaClientValidationError]: Invalid client engine type, please use `library` or `binary`
    at 4272 (.next/server/app/api/albums/route.js:1:3143)
    at t (.next/server/webpack-runtime.js:1:127)
    at 6493 (.next/server/app/api/albums/route.js:1:807)
    at t (.next/server/webpack-runtime.js:1:127)
    at t (.next/server/app/api/albums/route.js:1:3242)
    at <unknown> (.next/server/app/api/albums/route.js:1:3273)
    at t.X (.next/server/webpack-runtime.js:1:1191)
    at <unknown> (.next/server/app/api/albums/route.js:1:3255) {
  clientVersion: '5.22.0'
}

> Build error occurred
[Error: Failed to collect page data for /api/albums] { type: 'Error' }

Before fixing:
1. Read the relevant file(s) in full — do not guess at their contents.
2. Read CLAUDE.md → API contracts section if this is an API bug.
3. Identify the root cause before writing a single line of code. Tell me what it is.

Fix rules:
- Smallest possible change. One surgical str_replace, not a rewrite.
- Do not change unrelated code in the same file.
- After fixing, run: npx tsc --noEmit to confirm no type errors introduced.
- If the fix requires a schema change, stop and ask me before proceeding.

Show me the exact before/after diff of what you changed.





I want to implement: [FEATURE NAME]

Before writing any code:
1. Read CLAUDE.md — confirm the current data models and which files you will touch.
2. Read AGENTS.md — find the spec section for this feature. If a spec exists, follow it exactly. If no spec exists, write one in AGENTS.md first and show it to me for approval before proceeding.
3. Read every file you plan to modify before editing it.

Implementation rules:
- Use str_replace for targeted edits — do not rewrite whole files unless the spec says so.
- All storage I/O through src/lib/storage.ts only.
- All DB access through src/lib/db.ts only.
- No new npm packages without asking me first.
- After schema changes, remind me to run: npx prisma generate && npx prisma db push
- After completing, run: npx tsc --noEmit and fix any type errors before marking done.

When done, check off the acceptance criteria in AGENTS.md and show me the diff summary.




Resuming work on FotoHaven. You have no memory of our previous session.

1. Read CLAUDE.md to reload full project context.
2. Read AGENTS.md — find any tasks that are partially complete (look for mixed checked/unchecked acceptance criteria).
3. Run: npx tsc --noEmit — tell me if there are any existing type errors.
4. Run: git status — show me what files are modified or untracked.

Then tell me:
- What was the last task in progress (from AGENTS.md)
- The current state of the codebase (from tsc + git status)
- What the logical next step is

Wait for my confirmation before resuming work.




Now I have pulled the repo to my android device and ran the setup script but see what I got at 
Setting up environment file
⚠ .env.local created from .env.example
⚠ IMPORTANT: Edit .env.local with your actual values:
⚠   nano .env.local

▶ Bootstrapping database
prisma:warn Prisma detected unknown OS "android" and may not work as expected. Defaulting to "linux".
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
prisma:warn Prisma detected unknown OS "android" and may not work as expected. Defaulting to "linux".

✔ Generated Prisma Client (v5.11.0) to ./node_modules/@prisma/client in 243ms

Start using Prisma Client in Node.js (See: https://pris.ly/d/client)
```
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
```
or start using Prisma Client at the edge (See: https://pris.ly/d/accelerate)
```
import { PrismaClient } from '@prisma/client/edge'
const prisma = new PrismaClient()
```

See other ways of importing Prisma Client: http://pris.ly/d/importing-client

┌─────────────────────────────────────────────────────────────┐
│  Deploying your app to serverless or edge functions?        │
│  Try Prisma Accelerate for connection pooling and caching.  │
│  https://pris.ly/cli/accelerate                             │
└─────────────────────────────────────────────────────────────┘

prisma:warn Prisma detected unknown OS "android" and may not work as expected. Defaulting to "linux".
prisma:warn Prisma detected unknown OS "android" and may not work as expected. Defaulting to "linux".
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "dev.db" at "file:./dev.db"

Error: Could not parse schema engine response: SyntaxError: Unexpected token '/', "/data/data"... is not valid JSON
~/fotohaven $




# Download the correct binary
curl -L -o /tmp/query-engine.gz \
  "https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/linux-arm64-openssl-3.0.x/query-engine.gz"

# Check the download size — should be 15-25MB not 27KB
ls -lh /tmp/query-engine.gz



# Extract
gunzip -c /tmp/query-engine.gz > ~/fotohaven/node_modules/@prisma/engines/query-engine-linux-arm64-openssl-3.0.x

# Make executable
chmod +x ~/fotohaven/node_modules/@prisma/engines/query-engine-linux-arm64-openssl-3.0.x

# Also place it where Prisma Client looks
cp ~/fotohaven/node_modules/@prisma/engines/query-engine-linux-arm64-openssl-3.0.x \
   ~/fotohaven/node_modules/.prisma/client/query-engine-linux-arm64-openssl-3.0.x

# Verify it's a real ARM64 binary
file ~/fotohaven/node_modules/@prisma/engines/query-engine-linux-arm64-openssl-3.0.x