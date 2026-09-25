# ADR 0121 — Location engine: UBOS hierarchy, derived region, self-hosted reverse geocoding, patient GPS not kept

**Status:** Accepted — 2026-09-25 (Onboarding v2, D3, D4, E1, E2, E3). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Geography was a 21-district placeholder with Kampala sub-counties only. The region picker constrained nothing: Eastern + Arua and Western + Gulu were accepted, and one production application is saved as Kampala + Western.

## Decision

1. **Dataset:** OCHA COD-AB Uganda v01 (UBOS boundaries, valid 2020-08-24, CC BY-IGO) with 4 regions, 135 districts, 203 counties and 1,520 sub-counties. The imports (`scripts/import-geo.mjs`, `scripts/gen-geo-sql.mjs`) are repeatable. There is no parish or village level in the dataset, so village or cell is free text.
2. **Storage keeps the per-level tables** (E1). Hard FKs from three tables make a `geo_units` table costlier. `pcode` columns are added.
3. **Legacy rows:** keep their ids. 20 of the 21 map by exact name; Fort Portal is retired and reported.
4. **The district is the truth:**
   - `hospital_applications.region_id` is set by trigger (LOC-1).
   - A sub-county outside its district is refused (LOC-4).
   - The form submits one pcode; region is never an input.
5. **Search** runs in-process over a 70 kB JSON (E2: pg_trgm is not installed in production). The 135-district list (1.1 kB gz) ships with the page, so a district can be chosen offline.
6. **"Use my location"** runs a bounding-box prefilter and point-in-polygon over simplified sub-county outlines on our own server (E3). There is no third-party geocoder and no PostGIS. Accuracy decides the level: ≤ 2 km gives the sub-county, ≤ 20 km the district, and anything worse gives nothing.
7. **LOC-7:** the point is used once and dropped. It is never stored, never logged (logger PII list and Sentry `request.data` stripped), and never sent anywhere.

## Consequences

- **Cities:** the 2020 vintage predates the July 2020 cities, so they appear as "<Name> Municipality" and "Gulu city" searches that. 135 district-level units, not 146.
- A later UBOS vintage (parishes) is a new import plus a new migration.
