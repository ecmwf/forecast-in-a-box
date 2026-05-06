# Backend Glyph Contract Change

This document describes the breaking API changes to the glyph-related routes
under `/api/v1/blueprint/glyphs/` and provides a migration guide for client
implementors.

---

## Summary of Changes

| Route | Old Behaviour | New Behaviour |
|---|---|---|
| `GET /glyphs/list` | Required `glyph_type` param ("intrinsic" or "global"); returned `GlyphDetail` items | Optional `glyph_type` and `glyph_key` filters; returns discriminated-union items |
| `GET /glyphs/global/get` | Fetched a single global glyph by `global_glyph_id` | **Removed** — use `GET /glyphs/list?glyph_key=<key>` instead |
| `POST /glyphs/global/post` | Returned `GlobalGlyphResponse` without `glyph_type` | Same; now includes `glyph_type: "global"` field |
| `POST /glyphs/global/delete` | Did not exist | **Added** — deletes a global glyph by `global_glyph_id` |

---

## Detailed Route Changes

### `GET /glyphs/list` — New Signature

Query parameters (all optional):

| Parameter | Type | Default | Description |
|---|---|---|---|
| `glyph_type` | `"intrinsic" \| "global"` | (none — both) | Restrict to one type |
| `glyph_key` | `string` | (none) | Exact key match filter |
| `page` | `integer >= 1` | `1` | Page number |
| `page_size` | `integer >= 1` | `10` | Items per page |

The combined result set is ordered: intrinsic glyphs first (sorted by key),
then global glyphs (sorted by key).  Pagination spans the combined result.

#### Old Response Shape

```json
{
  "glyphs": [
    {
      "name": "runId",
      "display_name": "Run ID",
      "valueExample": "550e8400-...",
      "created_by": "intrinsic"
    }
  ],
  "total": 4,
  "page": 1,
  "page_size": 10
}
```

Global glyphs returned the same `GlyphDetail` shape, with `name` being the
glyph key and `valueExample` the glyph value.

#### New Response Shape

Each item in `glyphs` is a discriminated union on `glyph_type`.

Intrinsic glyph item:

```json
{
  "glyph_type": "intrinsic",
  "name": "runId",
  "display_name": "Run ID",
  "valueExample": "550e8400-e29b-41d4-a716-446655440000",
  "created_by": "intrinsic"
}
```

Global glyph item:

```json
{
  "glyph_type": "global",
  "global_glyph_id": "a1b2c3d4-...",
  "key": "myGlyph",
  "value": "my-value",
  "public": false,
  "overriddable": null,
  "created_by": "alice",
  "created_at": "2025-01-01 12:00:00",
  "updated_at": "2025-01-01 12:00:00"
}
```

Envelope fields (`total`, `page`, `page_size`) are unchanged.

### `GET /glyphs/global/get` — Removed

This endpoint has been removed.  Clients that used it to look up a glyph by id
after a POST should instead:

1. Obtain the `global_glyph_id` directly from the POST response (unchanged).
2. If lookup by key is needed, call `GET /glyphs/list?glyph_key=<key>` — this
   may return multiple rows when the same key is owned by different users, all
   of which are visible to the caller.

### `POST /glyphs/global/post` — Added `glyph_type` Field

The response body is otherwise identical to the old contract.  The new field:

```json
{
  "glyph_type": "global",
  ...existing fields...
}
```

### `POST /glyphs/global/delete` — New Endpoint

Request body:

```json
{
  "global_glyph_id": "a1b2c3d4-..."
}
```

Response: `204 No Content` on success.

Error codes:

| Status | Meaning |
|---|---|
| `404` | Glyph not found, or not visible to the caller |
| `403` | Caller is not the owner and is not an admin |

Only the glyph owner or an admin may delete a glyph.  Public glyphs owned by
an admin can be deleted by that admin or any other admin.

---

## Example Combined List Call

To retrieve all glyphs of any type:

```
GET /api/v1/blueprint/glyphs/list
```

To retrieve intrinsic glyphs only:

```
GET /api/v1/blueprint/glyphs/list?glyph_type=intrinsic
```

To retrieve global glyphs for a specific key:

```
GET /api/v1/blueprint/glyphs/list?glyph_type=global&glyph_key=myGlyph
```

To retrieve all glyphs (intrinsic + global) matching a key (useful when the
glyph type is unknown):

```
GET /api/v1/blueprint/glyphs/list?glyph_key=myGlyph
```

---

## Suggested Migration Strategy

### Step 1 — Update type definitions

Add the `glyph_type` discriminator field to existing glyph response types.
If your client models global glyphs separately, enrich them with the fields
present in the new `GlobalGlyphResponse` shape (especially `global_glyph_id`).

### Step 2 — Update list endpoint calls

Replace calls to `GET /glyphs/list?glyph_type=intrinsic` and
`GET /glyphs/list?glyph_type=global` with equivalent calls to the new
endpoint.  The query parameters are compatible; only the item shape differs.

For global glyph items, switch from reading `item.name` to `item.key`.

### Step 3 — Replace GET by id with list by key

Replace any call to `GET /glyphs/global/get?global_glyph_id=<id>` with
`GET /glyphs/list?glyph_key=<key>`.  The `global_glyph_id` is still available
from the POST response, and from the list items, so it can be stored client-
side for subsequent DELETE calls.

### Step 4 — Implement delete support

Add UI/logic to call `POST /glyphs/global/delete` with `{ "global_glyph_id": "..." }`.
The id is available in every `GlobalGlyphResponse` item from both the list and
post endpoints.
