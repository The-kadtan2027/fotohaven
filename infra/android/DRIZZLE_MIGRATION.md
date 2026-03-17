# Long-term: Migrate from Prisma → Drizzle ORM

> **Why:** Prisma downloads a native query-engine binary and must detect the target
> platform at install time. On Termux/ARM64 it picks the wrong binary by default,
> requiring an automated postinstall patch. Drizzle has no native engine — it talks
> to SQLite through `better-sqlite3` (a Node native addon that compiles against the
> system SQLite already present in Termux). Zero binary-download logic, zero patching.

---

## New dependencies

```bash
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3
npm uninstall prisma @prisma/client
```

Remove from `package.json`:
- `"prisma": "5.22"` (devDependency)
- `"@prisma/client": "5.22"` (dependency)
- `"postinstall": "node infra/android/prisma-android-fix.js"` (scripts)

---

## Schema rewrite

Delete `prisma/schema.prisma`. Create `src/lib/schema.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const albums = sqliteTable('Album', {
  id:          text('id').primaryKey(),
  title:       text('title').notNull(),
  clientName:  text('clientName').notNull(),
  shareToken:  text('shareToken').notNull().unique(),
  password:    text('password'),
  expiresAt:   integer('expiresAt', { mode: 'timestamp' }),
  createdAt:   integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt:   integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const ceremonies = sqliteTable('Ceremony', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  albumId:   text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  order:     integer('order').notNull().default(0),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
});

export const photos = sqliteTable('Photo', {
  id:           text('id').primaryKey(),
  filename:     text('filename').notNull(),
  originalName: text('originalName').notNull(),
  size:         integer('size').notNull(),
  mimeType:     text('mimeType').notNull(),
  storageKey:   text('storageKey').notNull(),
  width:        integer('width'),
  height:       integer('height'),
  ceremonyId:   text('ceremonyId').notNull().references(() => ceremonies.id, { onDelete: 'cascade' }),
  createdAt:    integer('createdAt', { mode: 'timestamp' }).notNull(),
});

export const comments = sqliteTable('Comment', {
  id:        text('id').primaryKey(),
  body:      text('body').notNull(),
  author:    text('author').notNull(),
  photoId:   text('photoId').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
});
```

---

## DB client rewrite (`src/lib/db.ts`)

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database(process.env.DATABASE_URL!.replace('file:', ''));
export const db = drizzle(sqlite, { schema });
```

> `better-sqlite3` is **synchronous** — remove all `await` from `db.*` calls.

---

## API route changes (mechanical find-replace)

| Prisma pattern | Drizzle equivalent |
|---|---|
| `db.album.findMany({ include: { ceremonies: true } })` | `db.query.albums.findMany({ with: { ceremonies: true } })` |
| `db.album.create({ data: { ... } })` | `db.insert(albums).values({ ... }).returning()` |
| `db.album.update({ where: { id }, data: { ... } })` | `db.update(albums).set({ ... }).where(eq(albums.id, id))` |
| `db.album.delete({ where: { id } })` | `db.delete(albums).where(eq(albums.id, id))` |
| `db.album.findUnique({ where: { shareToken } })` | `db.query.albums.findFirst({ where: eq(albums.shareToken, token) })` |

---

## Migration

```bash
# Generate SQL from schema
npx drizzle-kit generate

# Push to existing SQLite DB (non-destructive)
npx drizzle-kit push
```

Add to `package.json` scripts:
```json
"db:generate": "drizzle-kit generate",
"db:push":     "drizzle-kit push",
"db:studio":   "drizzle-kit studio"
```

---

## Files to touch

| File | Action |
|---|---|
| `prisma/schema.prisma` | DELETE |
| `infra/android/prisma-android-fix.js` | DELETE |
| `src/lib/schema.ts` | CREATE (see above) |
| `src/lib/db.ts` | REWRITE |
| `src/app/api/albums/route.ts` | UPDATE queries |
| `src/app/api/albums/[albumId]/route.ts` | UPDATE queries |
| `src/app/api/upload/route.ts` | UPDATE queries |
| `src/app/api/share/[token]/route.ts` | UPDATE queries |
| `src/app/api/comments/route.ts` | UPDATE queries |
| `package.json` | UPDATE deps + scripts |
| `CLAUDE.md` | UPDATE tech stack table |

Estimated effort: **4–6 hours** of mechanical work. No logic changes needed.
