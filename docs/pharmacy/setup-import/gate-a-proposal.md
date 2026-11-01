# Pharmacy set-up import: GATE A proposal

**Status:** Draft for the owner and CSO, 27 Oct 2026. Nothing is built yet.
**Branch:** `feat/pharmacy-setup-import` (worktree `~/Desktop/medsync-import`), cut from `feat/pharmacy-demo` 4ffcc9d2.
**Asks for:** ADR 0451 and migration 0251 (GATED, owner-applied).

## 1. The problem

A hospital going live today types its pharmacy in by hand, one place at a time:

- every product through Add a product, then
- every batch through Receive stock or "found on the shelf", then
- a blind count of each product before the place can go live (readiness condition 3).

A national referral store holds hundreds of products and more batches. Nothing imports them: `scripts/pharmacy/` loads only the national list (`import-national-list.ts`, `load-national-list.ts`).

## 2. What the import does

One spreadsheet, one row per batch on the shelf, uploaded by the pharmacy in charge. In one action it:

1. creates the hospital's **products** (or matches the ones it already has),
2. places each product at the **places** named in the sheet (stores, dispensing points, quarantine), and
3. writes each place's **opening stock** as that place's opening count.

It runs only through the stores that already write those records, so every row it makes is one the app can make by hand:

- `newProduct` and `placeProduct` in `lib/pharmacy/stock/store.ts`;
- the opening count, `recordStoreCount` step `"opening"` in `lib/pharmacy/stores/location-store.ts`, which writes `adjusted` movements with source and reason `opening`.

The import adds no stock kind and no shortcut around the ledger.

## 3. The sheet

One header row, then one row per batch. A product with no stock yet is a row with the batch columns blank: it is created and placed with nothing on the shelf.

| Column | Required | Rule |
|---|---|---|
| Place | yes | The exact name of a store, dispensing point or quarantine in this hospital, as on Places and suppliers. Wards and carts are excluded (they have their own counts). |
| Medicine | yes | The prescribing list's id (`artemether_lumefantrine`) or its generic name, exact (case and spacing ignored). |
| Product name | yes | As on the pack. |
| Manufacturer | no | |
| Strength | no | Kept as text, never converted (Law 7). |
| Pack size | no | Text. |
| Issue unit | yes | The unit every quantity is in (tablet, vial, bottle). |
| Registration number | no | NDA number. |
| Batch | with stock | |
| Expiry | with stock | `2027-03-31` or `2027-03` (runs to the month's end, as on Receive stock). |
| Quantity | with stock | A whole number of **issue units** on the shelf today. Never packs: MedSync converts nothing. |
| Reorder level | no | In issue units, at that place. |

The page offers the template as a download, with the hospital's own place names filled into an example row.

## 4. Matching, never guessing

- **Medicine.** The row is matched by exact id, or exact generic name, against the prescribing list (192 medicines in `data/prescribing/drug-catalogue.v0.json`).
  - With no exact match, the row is **not imported**. The check page shows it as "Not on the prescribing list" with the nearest names as text only, for a person to fix in the sheet.
  - Nothing is matched by similarity. This is the same rule as the national list (ADR 0282).
- **Product.** An existing product is reused only when the medicine, product name, strength, pack size and issue unit are all equal as text. Anything else is a new product. Two rows that describe the same new product make one product.
- **Place.** Exact name; with none, the row is refused.

## 5. Check, then import

1. **Upload.** CSV up to 2 MB or 5,000 rows.
2. **Check (writes nothing).** A pure engine (`lib/pharmacy/setup-import/`) reads the file and gives every row an outcome in words. The outcomes are:
   - "New product", "Matches {product}", or "Product only, no stock";
   - "Refused" with the reason;
   - "Controlled: count it on Controlled drugs".

   Totals sit per place. The page is a table with filters (All, Refused, New products, Controlled), and "Import" stays disabled while any row is refused, saying why.
3. **Import.** It runs in one transaction per place, so a place is set up whole or not at all.
   - Products are created first, then each place's opening count.
   - An opening count takes at most 500 lines, so a larger place gets several.
4. **After.** The page shows what was written: "{n} products created, {m} batches counted at {place}". It links to each place's Stock or Places page, and to its going-live page. Readiness condition 3 ("The stock is set up and counted") reads it from there.

**Idempotent.** The file's hash plus the row number make each row's client key. Uploading the same file again shows "Already imported on {date} by {name}" and writes nothing. A changed file imports only into places that are not live yet.

## 6. Rules the import keeps

- **Only places that are not live.** A live place is refused ("{place} is live. Receive or count stock there."). Stock at a live place moves only by delivery, issue or count, as today.
- **Opening at dispensing points.** Today the opening step is store-only. This extends it to dispensing points that are not live, with the same blind-count record, so the point's readiness reads the same count lines (`countedProductsAt`).
- **Controlled medicines are not imported** (proposed; see decision 2). Their rows are listed, and each is entered on Controlled drugs with a witness, because every controlled movement needs one (CD-5).
- **Expiry.** An expired batch is refused. A batch inside the expiry look-ahead is imported and marked "Expires in N days".
- **No doses, no prices** in the sheet. A price stays a separate signed step (CT-5).
- **Health supplies and local medicines** not on the prescribing list cannot be stocked today (`medicine_id` must be a prescribing-list id). They are refused with that reason. Stocking them is a separate decision (see decision 5).

## 7. Who, where, flags

- **Who.** Only a holder of `pharmacy.manage` (the pharmacy in charge, from a head assignment).
- **Where.** `/pharmacy/setup/import`. This is a Set-up tab in the Workspace v2 design (it is being built in its own session). Until then the page is linked from Places and suppliers.
- **Flag.** A new `PHARMACY_SETUP_IMPORT` (a list of hospital ids, or `1`), and the page also needs `PHARMACY_DISPENSING`. Importing into a store also needs `PHARMACY_STORE`.
- **Audit.** It writes no patient data.

## 8. Data

**Migration 0251** (GATED) adds `pharmacy_setup_imports`, one row per import: hospital, file name, file hash, rows, outcome per place, by, at. It is append-only and RLS-enabled like the other pharmacy tables. It also widens the opening count to dispensing points, if a constraint needs it (to confirm in the build).

## 9. Build steps and stops

| Step | What | Stop |
|---|---|---|
| 1 | The pure engine: CSV parse (no new dependency), the column map, matching, per-row outcomes, and the plan per place. Unit tests. | STOP 1: the outcomes table, reviewed against a real sheet |
| 2 | Migration 0251; opening at dispensing points; the import write over the existing stores. PGlite tests: a store and a point set up; readiness condition 3 met; a re-upload replays; controlled rows excluded; a live place refused. | STOP 2 |
| 3 | The page: upload, the check table, import, the result; the template download; copy in `content/pharmacy-setup-import.ts` (draft until the CSO signs). | STOP 3: a walk-through on the demo hospital |
| 4 | ADR 0451, CHANGELOG, user guide, FINAL-REPORT. | |

## 10. Decisions for the owner

1. **Excel or CSV?** CSV needs no new library; staff save their Excel sheet as CSV. Reading `.xlsx` directly needs a dependency (SheetJS). Proposed: CSV first.
2. **Controlled medicines.** Proposed: excluded, and counted on Controlled drugs with a witness. The alternative is one witness attestation for all of the import's controlled rows.
3. **Who imports.** Proposed: the pharmacy in charge (`pharmacy.manage`). The alternative is the hospital admin.
4. **Wards and carts.** Proposed: out of the first version (their levels and lists are signed separately).
5. **Health supplies and local medicines.** These are out of scope here. Stocking them needs the catalogue to accept items that are not on the prescribing list (a migration and a CSO decision).
6. **Wording.** Every outcome sentence is draft until the CSO signs it.
