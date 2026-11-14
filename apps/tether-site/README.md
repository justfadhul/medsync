# Tether site

The Tether landing page as its own deploy. It lives in this repo and renders the same page as the hospital
app's `/tether` (`components/landing/tether/landing.tsx`). There is one copy of the code, deployed in two places
until the cutover.

**What it does not carry from the hospital app:** the hospital stylesheet, Sentry, the Bricolage and Geist
fonts, and `lib/env`. Its stylesheet is Tailwind plus the Tide tokens.

## Run it

From the repo root (it uses the root `node_modules`; there is no install here):

```bash
npm run tether:dev
```

```bash
npm run tether:build
```

The dev server runs at http://localhost:3010. The production build takes about 15 seconds; the hospital app
takes about 13 minutes.

## Deploy (Fadhul, once)

1. **Vercel → New Project →** this GitHub repo.
   - Root Directory: `apps/tether-site`.
   - Keep "Include files outside the root directory" on.
   - `vercel.json` already sets the framework and installs from the repo root (`cd ../.. && npm ci`).
2. **Environment variables:**

   | Variable                    | Value                                                                                      | Needed for                                                    |
   | --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
   | `TETHER_SITE_URL`           | the site's domain, e.g. `tether.ug` (https:// optional); unset, Vercel's production domain | canonical links, sitemap, sharing                             |
   | `NEXT_PUBLIC_SUPABASE_URL`  | as in the hospital project                                                                 | the clinic form                                               |
   | `SUPABASE_SERVICE_ROLE_KEY` | as in the hospital project                                                                 | the clinic form                                               |
   | `FEATURE_PRE_ALERT`         | leave unset                                                                                | keeps the emergency answer's pre-alert sentence off (D-LP-06) |

   Without the two Supabase variables the page still works; only the form answers "We could not send that".

3. **Domain:** add it in the project's Domains tab.
4. **Git deploys:** turn them off to match the hospital project, and deploy by hand:
   ```bash
   vercel deploy --prod
   ```
   Run it from the repo root, linked to this project.

**Not yet tried on Vercel.** The local production build and every browser check pass (see below). If Vercel
cannot find `next` with this layout, the fallback is to make the repo an npm workspace (`"workspaces":
["apps/*"]` in the root `package.json`).

## Checked locally (13 Nov 2026)

Same throttle as Step 0 (412 px phone, CPU ×4, Slow 4G, cold cache, 5 runs). The hospital app's figures are its
`/tether`.

|       | This site                       | Hospital app | Budget                      |
| ----- | ------------------------------- | ------------ | --------------------------- |
| LCP   | **1.75 s**                      | 2.41 s       | ≤ 2.5 s                     |
| INP   | **64 ms**                       | 80 ms        | ≤ 200 ms                    |
| CLS   | 0.008                           | 0.008        | ≤ 0.05                      |
| CSS   | **16 KB**                       | 64 KB        | ≤ 30 KB                     |
| Fonts | **53 KB** (Figtree, Geist Mono) | 157 KB       | Figtree and Geist Mono only |
| JS    | 183 KB                          | 271 KB       | page's own ≤ 120 KB         |
| HTML  | 18 KB                           | 21 KB        | report                      |

- **Scenarios:** S1–S14 and S16 all pass. axe finds 0 issues at 1440 / 1024 / 834 / 390, light and dark.
- **Looks:** the screenshots of every section, both themes, 1440 and 390, match the hospital app's to the pixel.
  The countdown's seconds are the only difference.

## Keeping it in step

- **Tokens:** `app/pw-tokens.css` is generated, the same block as `app/globals.css`. When the Tide tokens
  change, regenerate both. `tests/tether-landing/site.test.ts` fails if they differ.
  ```bash
  node scripts/patient-web/gen-tokens.mjs mobile/src/theme/tide.ts > apps/tether-site/app/pw-tokens.css
  ```
- **Page code:** lives in `components/landing/tether`, `content/tether-landing` and `lib/landing`, shared with
  the hospital app. The form's action is `lib/landing/actions.ts`.
- **At the cutover:** the hospital app's `/` can send visitors to the site, and `/tether` with its flag can be
  deleted. That is Fadhul's call.
