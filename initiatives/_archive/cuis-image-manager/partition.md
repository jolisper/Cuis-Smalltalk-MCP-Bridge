# Partition of cuis-image-manager

## Parts (implementation order)

1. `cuis-image-manager-01-core`: 27 invariants; assumes: none
2. `cuis-image-manager-02-lifecycle`: 22 invariants; assumes: `cuis-image-manager-01-core`
3. `cuis-image-manager-03-cleanup`: 11 invariants; assumes: `cuis-image-manager-01-core`, `cuis-image-manager-02-lifecycle`

## Invariant mapping

| old | part-dir | new |
|---|---|---|
| 1 | cuis-image-manager-01-core | 1 |
| 2 | cuis-image-manager-01-core | 2 |
| 3 | cuis-image-manager-01-core | 3 |
| 4 | cuis-image-manager-01-core | 4 |
| 5 | cuis-image-manager-01-core | 5 |
| 6 | cuis-image-manager-01-core | 6 |
| 7 | cuis-image-manager-01-core | 7 |
| 8 | cuis-image-manager-01-core | 8 |
| 9 | cuis-image-manager-01-core | 9 |
| 10 | cuis-image-manager-01-core | 10 |
| 11 | cuis-image-manager-01-core | 11 |
| 12 | cuis-image-manager-01-core | 12 |
| 13 | cuis-image-manager-01-core | 13 |
| 14 | cuis-image-manager-01-core | 14 |
| 15 | cuis-image-manager-01-core | 15 |
| 16 | cuis-image-manager-01-core | 16 |
| 17 | cuis-image-manager-01-core | 17 |
| 18 | cuis-image-manager-01-core | 18 |
| 19 | cuis-image-manager-01-core | 19 |
| 20 | cuis-image-manager-01-core | 20 |
| 21 | cuis-image-manager-01-core | 21 |
| 22 | cuis-image-manager-01-core | 22 |
| 23 | cuis-image-manager-01-core | 23 |
| 24 | cuis-image-manager-01-core | 24 |
| 25 | cuis-image-manager-01-core | 25 |
| 26 | cuis-image-manager-02-lifecycle | 1 |
| 27 | cuis-image-manager-02-lifecycle | 2 |
| 28 | cuis-image-manager-02-lifecycle | 3 |
| 29 | cuis-image-manager-02-lifecycle | 4 |
| 30 | cuis-image-manager-02-lifecycle | 5 |
| 31 | cuis-image-manager-02-lifecycle | 6 |
| 32 | cuis-image-manager-02-lifecycle | 7 |
| 33 | cuis-image-manager-02-lifecycle | 8 |
| 34 | cuis-image-manager-02-lifecycle | 9 |
| 35 | cuis-image-manager-02-lifecycle | 10 |
| 36 | cuis-image-manager-02-lifecycle | 11 |
| 37 | cuis-image-manager-02-lifecycle | 12 |
| 38 | cuis-image-manager-02-lifecycle | 13 |
| 39 | cuis-image-manager-02-lifecycle | 14 |
| 40 | cuis-image-manager-02-lifecycle | 15 |
| 41 | cuis-image-manager-02-lifecycle | 16 |
| 42 | cuis-image-manager-02-lifecycle | 17 |
| 43 | cuis-image-manager-03-cleanup | 1 |
| 44 | cuis-image-manager-03-cleanup | 2 |
| 45 | cuis-image-manager-03-cleanup | 3 |
| 46 | cuis-image-manager-03-cleanup | 4 |
| 47 | cuis-image-manager-03-cleanup | 5 |
| 48 | cuis-image-manager-03-cleanup | 6 |
| 49 | cuis-image-manager-03-cleanup | 7 |
| 50 | cuis-image-manager-03-cleanup | 8 |
| 51 | cuis-image-manager-03-cleanup | 9 |
| 52 | cuis-image-manager-02-lifecycle | 18 |
| 53 | cuis-image-manager-02-lifecycle | 19 |
| 54 | cuis-image-manager-03-cleanup | 10 |
| 55 | cuis-image-manager-03-cleanup | 11 |
| 56 | cuis-image-manager-02-lifecycle | 20 |
| 57 | cuis-image-manager-01-core | 26 |
| 58 | cuis-image-manager-02-lifecycle | 21 |
| 59 | cuis-image-manager-01-core | 27 |
| 60 | cuis-image-manager-02-lifecycle | 22 |

## Cross-part edges

| from | to | parts | rules | evidence |
|---|---|---|---|---|
| 56 | 22 | 2 → 1 | state | Cuis version an instance was made from |
| 27 | 18 | 2 → 1 | output | running state |
| 30 | 18 | 2 → 1 | output | running (untracked) |
| 39 | 19 | 2 → 1 | state | stale record |
| 40 | 18 | 2 → 1 | output | running (untracked) |
| 44 | 18 | 3 → 1 | output | running (tracked or untracked) |
| 49 | 18 | 3 → 1 | output | running (tracked or untracked) |

## Kept apart despite link

| from | to | parts | rules | evidence |
|---|---|---|---|---|
| 26 | 23 | 2 → 1 | fixture | start needs a created instance |
| 26 | 14 | 2 → 1 | fixture | start prepares the Cuis home first |
| 43 | 23 | 3 → 1 | fixture | reset needs a created instance |
| 45 | 26 | 3 → 2 | fixture | instance unable to start |
| 47 | 23 | 3 → 1 | fixture | destroy needs a created instance |
| 54 | 1 | 3 → 1 | fixture | skill exposes the commands |
| 52 | 1 | 2 → 1 | fixture | commands that change an instance |
| 48 | 4 | 3 → 1 | fixture | no prompts |

## Implementation order

1. /spec-technical cuis-image-manager-01-core
2. /spec-technical cuis-image-manager-02-lifecycle
3. /spec-technical cuis-image-manager-03-cleanup
