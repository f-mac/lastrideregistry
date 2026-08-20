# Last Ride Registry — data dictionary

**File:** `cyclist_fatalities.csv` — one row per person killed while riding a
bicycle (or other pedal cycle) in a US traffic crash, 2010–2024.

**Source:** NHTSA Fatality Analysis Reporting System (FARS) annual national
files (public domain). Rows are FARS `person` records with person type 6
(bicyclist) or 7 (other cyclist) and injury severity 4 (fatal), joined to the
`accident` and `vehicle` tables. This matches NHTSA's published "pedalcyclist"
definition; our yearly totals reconcile with NHTSA Traffic Safety Facts within
rounding (several years exact).

**License:** CC BY 4.0 — credit "Last Ride Registry" (lastrideregistry.com).
Upstream FARS data is US-government public domain.

| Column | Type | Description |
|---|---|---|
| `id` | text | `{year}-{st_case}-{per_no}` — unique per victim; `st_case` is the FARS case number, stable within a year |
| `date` | date | Crash date (YYYY-MM-DD) |
| `hour` | int | Hour of crash, 0–23 local; empty if unknown |
| `state` | text | USPS state code |
| `state_name` | text | State name |
| `state_fips` | int | State FIPS code |
| `county_fips` | int | County FIPS code (within state); 0/blank if unknown |
| `latitude`, `longitude` | float | Crash location, 5 decimals, as recorded by the reporting agency; empty when FARS marks it unreported (~0.5% of rows) |
| `age` | int | Victim age in years; empty if unknown (FARS 998/999) |
| `sex` | text | `M` / `F`; empty if unknown or other coding |
| `person_type` | text | `bicyclist` (FARS 6) or `other cyclist` (FARS 7 — e.g. pedalcycle passenger, unicycle) |
| `light_condition` | text | Decoded FARS LGT_COND: daylight, dawn, dusk, dark - lighted, dark - not lighted, dark - unknown lighting, other; empty if unknown |
| `hit_and_run` | 0/1 | **Crash-level flag:** 1 if any vehicle in the crash was coded hit-and-run (FARS HIT_RUN 1–5). NHTSA's own convention for crash factors |
| `drunk_driver_involved` | 0/1 | Crash-level flag: any vehicle whose driver was coded as drinking (DR_DRINK = 1) |
| `speeding_involved` | 0/1 | Crash-level flag: any vehicle coded speeding-related (SPEEDREL 1–5) |
| `vehicle_count` | int | Motor vehicles in the crash |
| `striking_vehicle` | text | Coarse body class of the striking vehicle: car, suv, van, pickup/light truck, bus, large truck, motorcycle. Uses the FARS striking-vehicle link where present, else the vehicle in single-vehicle crashes; empty when the striking vehicle can't be attributed (multi-vehicle crashes without a link) |
| `year` | int | Crash year (= FARS file year) |

## Caveats

- **2024 is preliminary.** It comes from NHTSA's Annual Report File and will be
  revised (historically upward ~1–2%) when the final file is published. We
  re-release when that happens.
- Crash-level flags (`hit_and_run`, `drunk_driver_involved`,
  `speeding_involved`) describe **the crash**, not necessarily the vehicle that
  struck the victim — in multi-vehicle crashes the flagged vehicle can be
  another one. Single-vehicle crashes (the large majority here) are unaffected.
- `striking_vehicle` body-class buckets are coarse on purpose; FARS BODY_TYP
  codes shift slightly across years and fine classes are not comparable.
- FARS contains no names and no driver legal outcomes. Verified
  charge/conviction outcomes are the registry's v2 (see the roadmap on the
  site).
- Helmet use is recorded inconsistently across FARS years and is omitted from
  v1 rather than published half-wrong.
