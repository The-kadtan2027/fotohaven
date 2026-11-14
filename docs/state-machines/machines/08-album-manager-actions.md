# Machine 08 — Album manager: load, destructive actions, dedup scan

Owner: `src/app/albums/[albumId]/page.tsx` plus photo/ceremony/album routes.

Status: F-16 implemented (load error + Retry). Per-action busy guards for destructive actions were not added; the report-only risk remains.

## As-is

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Ready: 200
    Loading --> Loading: non-OK non-401 (loading never cleared)
    Loading --> Login: 401
    Ready --> Ready: select/blur/delete/dedup
    Ready --> Ready: auto-ceremony creation fails -> photos fall back to active ceremony
    Ready --> Scanning: Find/Rescan duplicates
    Scanning --> ScanResults: hashes ready
    Scanning --> ScanError: thrown (rare)
    ScanResults --> Ready: close/select duplicates
    Ready --> Ready: upload queue
```

Observed:

- `fetchAlbum` returns without clearing loading for 404/500 (`:131-158`), so “Album not found” and any retry UI are unreachable.
- Destructive actions have confirm dialogs but no pending/disabled state per target: two rapid confirms can issue two DELETEs (second 404 → toast), and the selection bar stays until refresh.
- `onDrop` can place folder photos into the wrong ceremony if auto-create failed (`:216-268`).
- Duplicate scan hashes thumbnails one by one; per-photo failures are skipped silently; a partial set shows as successful.

## To-be

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Ready: 200
    Loading --> LoadError: non-OK / network
    LoadError --> Loading: Retry
    Loading --> Login: 401
    Ready --> Busy: delete/blur/reprocess/scan (per action)
    Busy --> Ready: ok (refresh)
    Busy --> Ready: error (toast, state unchanged)
    Ready --> Scanning
    Scanning --> ScanResults: groups
    Scanning --> ScanError: error message + Retry
    ScanResults --> Ready
```

Transition table (destructive subset):

| From | Event | Guard | Effect | To |
|---|---|---|---|---|
| Ready | DELETE_PHOTO_CONFIRMED | not busy | DELETE, refresh | Busy |
| Busy | ok | — | toast + refresh | Ready |
| Busy | fail | — | toast + keep row/selection | Ready |
| Ready | DELETE_ALBUM_CONFIRMED | not busy | DELETE, leave page | Leaving |
| Ready | SCAN_START | not busy | hash originals sequentially | Scanning |
| Scanning | DONE | — | open modal + persist hashes | ScanResults |
| Scanning | FAIL | — | inline error + Retry | ScanError |

UI contract:

| State | Sees | Can do | Disabled |
|---|---|---|---|
| Loading | centered spinner | — | — |
| LoadError | message + retry | Retry | — |
| Busy | action button spinner | other actions? no | the action’s controls |
| ScanError | inline red line under header | Find/Rescan | — |

## Server authority

All destructive calls are admin-guarded (`middleware.ts:31-58`); the client is not trusted for album ownership. File deletion precedes DB deletion; partial storage failures are silent (reported L-10).
