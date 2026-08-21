#!/usr/bin/env python3
"""Build the Last Ride Registry dataset from raw FARS files.

Input:  data/raw/{year}/{accident,person,vehicle}.csv  (any filename casing)
Output: data/processed/cyclist_fatalities.csv   one row per person killed
        data/processed/validation_report.txt
        site/public/data/points.json            compact arrays for map/animation
        site/public/data/aggregates.json        pre-computed chart data

Definitions follow NHTSA "pedalcyclist": PER_TYP 6 (bicyclist) or 7 (other
cyclist), INJ_SEV 4 (fatal). Crash-level flags (hit_and_run,
drunk_driver_involved, speeding_involved) mean "any vehicle in the crash",
matching NHTSA's published crash-factor convention.
"""
import duckdb
import glob
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")
SITE_DATA = os.path.join(ROOT, "site", "public", "data")
YEARS = range(2010, 2025)

STATES = {
    1: ("AL", "Alabama"), 2: ("AK", "Alaska"), 4: ("AZ", "Arizona"),
    5: ("AR", "Arkansas"), 6: ("CA", "California"), 8: ("CO", "Colorado"),
    9: ("CT", "Connecticut"), 10: ("DE", "Delaware"), 11: ("DC", "District of Columbia"),
    12: ("FL", "Florida"), 13: ("GA", "Georgia"), 15: ("HI", "Hawaii"),
    16: ("ID", "Idaho"), 17: ("IL", "Illinois"), 18: ("IN", "Indiana"),
    19: ("IA", "Iowa"), 20: ("KS", "Kansas"), 21: ("KY", "Kentucky"),
    22: ("LA", "Louisiana"), 23: ("ME", "Maine"), 24: ("MD", "Maryland"),
    25: ("MA", "Massachusetts"), 26: ("MI", "Michigan"), 27: ("MN", "Minnesota"),
    28: ("MS", "Mississippi"), 29: ("MO", "Missouri"), 30: ("MT", "Montana"),
    31: ("NE", "Nebraska"), 32: ("NV", "Nevada"), 33: ("NH", "New Hampshire"),
    34: ("NJ", "New Jersey"), 35: ("NM", "New Mexico"), 36: ("NY", "New York"),
    37: ("NC", "North Carolina"), 38: ("ND", "North Dakota"), 39: ("OH", "Ohio"),
    40: ("OK", "Oklahoma"), 41: ("OR", "Oregon"), 42: ("PA", "Pennsylvania"),
    44: ("RI", "Rhode Island"), 45: ("SC", "South Carolina"), 46: ("SD", "South Dakota"),
    47: ("TN", "Tennessee"), 48: ("TX", "Texas"), 49: ("UT", "Utah"),
    50: ("VT", "Vermont"), 51: ("VA", "Virginia"), 53: ("WA", "Washington"),
    54: ("WV", "West Virginia"), 55: ("WI", "Wisconsin"), 56: ("WY", "Wyoming"),
    # FARS also codes PR (43? no: 43 unused) — PR = 72, VI = 78; keep if present
    72: ("PR", "Puerto Rico"), 78: ("VI", "Virgin Islands"),
}

LIGHT = {1: "daylight", 2: "dark - not lighted", 3: "dark - lighted",
         4: "dawn", 5: "dusk", 6: "dark - unknown lighting", 7: "other"}

DAY_WEEK = {1: "Sunday", 2: "Monday", 3: "Tuesday", 4: "Wednesday",
            5: "Thursday", 6: "Friday", 7: "Saturday"}

WEATHER = {1: "clear", 2: "rain", 3: "sleet/hail", 4: "snow",
           5: "fog/smog/smoke", 6: "severe crosswinds", 7: "blowing sand/dirt",
           8: "other", 10: "cloudy", 11: "blowing snow", 12: "freezing rain"}

# FUNC_SYS (2015+) buckets; pre-2015 ROAD_FNC is mapped onto these in SQL
ROAD_CLASS = {1: "interstate", 2: "freeway/expressway", 3: "principal arterial",
              4: "minor arterial", 5: "major collector", 6: "minor collector",
              7: "local road"}

INTERSECTION = {1: "not at intersection", 2: "four-way", 3: "T", 4: "Y",
                5: "traffic circle", 6: "roundabout", 7: "five-point or more",
                10: "L"}

RUR_URB = {1: "rural", 2: "urban"}

# L_STATUS of the striking driver; 6 = valid dominates every year (sanity-checked)
LICENSE = {0: "not licensed", 1: "suspended", 2: "revoked", 3: "expired",
           4: "cancelled or denied", 5: "learner permit", 6: "valid"}

DIED_AT = {7: "at scene", 8: "en route", 0: "later"}

# Coarse striking-vehicle classes from FARS BODY_TYP codes (stable enough
# 2010-2024 for these buckets; anything unmapped -> "other/unknown").
def body_class_sql(col):
    return f"""CASE
      WHEN {col} BETWEEN 1 AND 13 THEN 'car'
      WHEN {col} BETWEEN 14 AND 19 THEN 'suv'
      WHEN {col} BETWEEN 20 AND 29 THEN 'van'
      WHEN {col} BETWEEN 30 AND 39 THEN 'pickup/light truck'
      WHEN {col} BETWEEN 50 AND 59 THEN 'bus'
      WHEN {col} BETWEEN 60 AND 79 THEN 'large truck'
      WHEN {col} BETWEEN 80 AND 89 THEN 'motorcycle'
      ELSE NULL END"""


def find_file(year, base):
    for f in glob.glob(os.path.join(RAW, str(year), "*")):
        if os.path.basename(f).lower() == base + ".csv":
            return f
    return None


def load_year(con, year):
    acc = find_file(year, "accident")
    per = find_file(year, "person")
    veh = find_file(year, "vehicle")
    if not (acc and per and veh):
        sys.exit(f"missing raw files for {year}")
    for name, path in (("acc", acc), ("per", per), ("veh", veh)):
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE {name} AS
          SELECT * FROM read_csv('{path}', header=true, all_varchar=false,
                                 ignore_errors=true, normalize_names=true)
        """)
        # normalize_names prefixes SQL keywords with "_" (month -> _month); undo
        for (col,) in con.execute(
                f"SELECT column_name FROM (DESCRIBE {name})").fetchall():
            if col.startswith("_"):
                con.execute(f'ALTER TABLE {name} RENAME COLUMN "{col}" TO "{col.lstrip("_")}"')


def cols(con, table):
    return {r[0] for r in con.execute(
        f"SELECT column_name FROM (DESCRIBE {table})").fetchall()}


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SITE_DATA, exist_ok=True)
    con = duckdb.connect()
    frames = []
    for year in YEARS:
        load_year(con, year)
        percols = cols(con, "per")
        acccols = cols(con, "acc")
        # striking vehicle: use STR_VEH if present, else single-vehicle heuristic
        str_veh = "p.str_veh" if "str_veh" in percols else "NULL"
        # roadway class/land use: FUNC_SYS + RUR_URB from 2015; ROAD_FNC before
        if "func_sys" in acccols:
            rur_urb = "a.rur_urb"
            road_class = "a.func_sys"
        else:
            rur_urb = ("CASE WHEN a.road_fnc BETWEEN 1 AND 9 THEN 1 "
                       "WHEN a.road_fnc BETWEEN 11 AND 19 THEN 2 ELSE NULL END")
            road_class = """CASE a.road_fnc
              WHEN 1 THEN 1 WHEN 11 THEN 1
              WHEN 12 THEN 2
              WHEN 2 THEN 3 WHEN 13 THEN 3
              WHEN 3 THEN 4 WHEN 14 THEN 4
              WHEN 4 THEN 5 WHEN 15 THEN 5
              WHEN 5 THEN 6
              WHEN 6 THEN 7 WHEN 16 THEN 7
              ELSE NULL END"""
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE year_out AS
          WITH crash_flags AS (
            SELECT st_case,
              MAX(CASE WHEN hit_run BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS hit_and_run,
              MAX(CASE WHEN dr_drink = 1 THEN 1 ELSE 0 END) AS drunk_driver_involved,
              MAX(CASE WHEN speedrel BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS speeding_involved,
              COUNT(*) AS vehicle_count
            FROM veh GROUP BY st_case
          ),
          striking AS (
            SELECT st_case, veh_no, {body_class_sql('body_typ')} AS vclass,
              CASE WHEN trav_sp BETWEEN 0 AND 96 THEN trav_sp ELSE NULL END AS trav_sp,
              CASE WHEN vspd_lim BETWEEN 5 AND 90 THEN vspd_lim ELSE NULL END AS vspd_lim,
              CASE WHEN mod_year BETWEEN 1900 AND {year + 1} THEN mod_year ELSE NULL END AS mod_year,
              CASE WHEN l_status BETWEEN 0 AND 6 THEN l_status ELSE NULL END AS l_status,
              CASE WHEN prev_acc BETWEEN 0 AND 90 THEN prev_acc ELSE NULL END AS prev_acc,
              CASE WHEN prev_dwi BETWEEN 0 AND 90 THEN prev_dwi ELSE NULL END AS prev_dwi,
              CASE WHEN prev_spd BETWEEN 0 AND 90 THEN prev_spd ELSE NULL END AS prev_spd
            FROM veh
          ),
          drivers AS (
            SELECT st_case, veh_no,
              MAX(CASE WHEN age BETWEEN 10 AND 120 THEN age ELSE NULL END) AS drv_age,
              MAX(CASE sex WHEN 1 THEN 'M' WHEN 2 THEN 'F' ELSE NULL END) AS drv_sex
            FROM per WHERE per_typ = 1 GROUP BY st_case, veh_no
          )
          SELECT
            {year} AS year,
            p.st_case,
            p.per_no,
            printf('%d-%d-%d', {year}, p.st_case, p.per_no) AS id,
            make_date({year}, a.month, a.day) AS date,
            CASE WHEN a.hour BETWEEN 0 AND 23 THEN a.hour ELSE NULL END AS hour,
            a.state AS state_fips,
            a.county AS county_fips,
            CASE WHEN a.latitude BETWEEN -90 AND 77 AND a.latitude != 0
                 THEN round(a.latitude, 5) ELSE NULL END AS latitude,
            CASE WHEN a.longitud BETWEEN -180 AND -60 AND a.longitud != 0
                 THEN round(a.longitud, 5) ELSE NULL END AS longitude,
            CASE WHEN p.age BETWEEN 0 AND 120 THEN p.age ELSE NULL END AS age,
            CASE p.sex WHEN 1 THEN 'M' WHEN 2 THEN 'F' ELSE NULL END AS sex,
            CASE p.per_typ WHEN 6 THEN 'bicyclist' ELSE 'other cyclist' END AS person_type,
            a.lgt_cond AS light_code,
            cf.hit_and_run,
            cf.drunk_driver_involved,
            cf.speeding_involved,
            cf.vehicle_count,
            CASE WHEN {str_veh} IS NOT NULL AND {str_veh} > 0
                 THEN sv.vclass
                 WHEN cf.vehicle_count = 1 THEN sv1.vclass
                 ELSE NULL END AS striking_vehicle,
            -- crash context
            a.day_week AS day_week_code,
            NULLIF(trim(CAST(a.tway_id AS VARCHAR)), '') AS street,
            NULLIF(trim(CAST(a.tway_id2 AS VARCHAR)), '') AS cross_street,
            {rur_urb} AS rur_urb_code,
            {road_class} AS road_class_code,
            a.typ_int AS intersection_code,
            a.weather AS weather_code,
            CASE WHEN a.wrk_zone BETWEEN 1 AND 4 THEN 1 ELSE 0 END AS work_zone,
            p.doa AS doa_code,
            -- striking vehicle + its driver (same resolution as striking_vehicle)
            CASE WHEN {str_veh} > 0 THEN sv.trav_sp WHEN cf.vehicle_count = 1 THEN sv1.trav_sp END AS striking_vehicle_speed_mph,
            CASE WHEN {str_veh} > 0 THEN sv.vspd_lim WHEN cf.vehicle_count = 1 THEN sv1.vspd_lim END AS posted_speed_limit_mph,
            CASE WHEN {str_veh} > 0 THEN sv.mod_year WHEN cf.vehicle_count = 1 THEN sv1.mod_year END AS striking_vehicle_model_year,
            CASE WHEN {str_veh} > 0 THEN sv.l_status WHEN cf.vehicle_count = 1 THEN sv1.l_status END AS license_code,
            CASE WHEN {str_veh} > 0 THEN sv.prev_acc WHEN cf.vehicle_count = 1 THEN sv1.prev_acc END AS driver_prior_crashes,
            CASE WHEN {str_veh} > 0 THEN sv.prev_dwi WHEN cf.vehicle_count = 1 THEN sv1.prev_dwi END AS driver_prior_dwi,
            CASE WHEN {str_veh} > 0 THEN sv.prev_spd WHEN cf.vehicle_count = 1 THEN sv1.prev_spd END AS driver_prior_speeding,
            CASE WHEN {str_veh} > 0 THEN d.drv_age WHEN cf.vehicle_count = 1 THEN d1.drv_age END AS driver_age,
            CASE WHEN {str_veh} > 0 THEN d.drv_sex WHEN cf.vehicle_count = 1 THEN d1.drv_sex END AS driver_sex
          FROM per p
          JOIN acc a USING (st_case)
          LEFT JOIN crash_flags cf USING (st_case)
          LEFT JOIN striking sv ON sv.st_case = p.st_case AND sv.veh_no = {str_veh}
          LEFT JOIN striking sv1 ON sv1.st_case = p.st_case AND sv1.veh_no = 1
          LEFT JOIN drivers d ON d.st_case = p.st_case AND d.veh_no = {str_veh}
          LEFT JOIN drivers d1 ON d1.st_case = p.st_case AND d1.veh_no = 1
          WHERE p.per_typ IN (6, 7) AND p.inj_sev = 4
        """)
        frames.append(con.execute("SELECT * FROM year_out").df())
        print(f"{year}: {len(frames[-1])} deaths")

    import pandas as pd
    df = pd.concat(frames, ignore_index=True)
    df["state"] = df.state_fips.map(lambda f: STATES.get(int(f), ("??", "Unknown"))[0])
    df["state_name"] = df.state_fips.map(lambda f: STATES.get(int(f), ("??", "Unknown"))[1])
    df["light_condition"] = df.light_code.map(lambda c: LIGHT.get(int(c)) if pd.notna(c) else None)
    df["dark"] = df.light_code.map(lambda c: 1 if pd.notna(c) and int(c) in (2, 3, 6) else 0)

    def decode(src, table):
        return df[src].map(lambda c: table.get(int(c)) if pd.notna(c) else None)
    df["day_of_week"] = decode("day_week_code", DAY_WEEK)
    df["rural_urban"] = decode("rur_urb_code", RUR_URB)
    df["road_class"] = decode("road_class_code", ROAD_CLASS)
    df["intersection"] = decode("intersection_code", INTERSECTION)
    df["weather"] = decode("weather_code", WEATHER)
    df["died_at"] = decode("doa_code", DIED_AT)
    df["driver_license_status"] = decode("license_code", LICENSE)

    keep = ["id", "date", "hour", "day_of_week", "state", "state_name", "state_fips",
            "county_fips", "latitude", "longitude", "street", "cross_street",
            "rural_urban", "road_class", "intersection", "weather", "work_zone",
            "age", "sex", "person_type", "died_at", "light_condition",
            "hit_and_run", "drunk_driver_involved", "speeding_involved",
            "vehicle_count", "striking_vehicle", "striking_vehicle_model_year",
            "striking_vehicle_speed_mph", "posted_speed_limit_mph",
            "driver_age", "driver_sex", "driver_license_status",
            "driver_prior_crashes", "driver_prior_dwi", "driver_prior_speeding",
            "year"]
    master = df[keep + ["dark"]].sort_values(["date", "id"]).reset_index(drop=True)
    master.drop(columns=["dark"]).to_csv(
        os.path.join(OUT, "cyclist_fatalities.csv"), index=False)

    # --- validation report -------------------------------------------------
    lines = ["Last Ride Registry — validation report", ""]
    lines.append("Deaths per year (ours) — NHTSA published pedalcyclist totals for spot-check:")
    published = {2010: 623, 2015: 829, 2018: 871, 2020: 948, 2021: 966,
                 2022: 1105, 2023: 1166}  # NHTSA Traffic Safety Facts (approx, see README)
    for y, n in master.groupby("year").size().items():
        ref = published.get(y)
        flag = ""
        if ref:
            delta = abs(n - ref) / ref
            flag = f"  published≈{ref}  Δ{delta:.1%}" + ("  ⚠️" if delta > 0.02 else "  ✓")
        lines.append(f"  {y}: {n}{flag}")
    geo = master.latitude.notna().mean()
    lines.append(f"\nGeocoded rows: {geo:.1%}")
    lines.append(f"Hit-and-run share 2019: {master[master.year==2019].hit_and_run.mean():.1%} (AAA: 16.5%)")
    lines.append(f"Hit-and-run share 2023: {master[master.year==2023].hit_and_run.mean():.1%} (AAA: 23.6%)")
    lines.append(f"Total rows: {len(master)}")
    report = "\n".join(lines)
    print("\n" + report)
    with open(os.path.join(OUT, "validation_report.txt"), "w") as f:
        f.write(report + "\n")

    # --- site: compact points ---------------------------------------------
    pts = master[master.latitude.notna()]
    state_list = sorted(pts.state.unique().tolist())
    veh_list = [v for v in pts.striking_vehicle.dropna().unique().tolist()]
    st_idx = {s: i for i, s in enumerate(state_list)}
    veh_idx = {v: i for i, v in enumerate(veh_list)}
    points = {
        "fields": ["lon", "lat", "year", "doy", "hit_run", "dark", "age", "sex", "st", "veh"],
        "states": state_list,
        "vehicles": veh_list,
        "rows": [
            [round(r.longitude, 4), round(r.latitude, 4), int(r.year),
             int(pd.Timestamp(r.date).dayofyear), int(r.hit_and_run or 0),
             int(r.dark), (int(r.age) if pd.notna(r.age) else -1),
             {"M": 1, "F": 2}.get(r.sex, 0), st_idx[r.state],
             veh_idx.get(r.striking_vehicle, -1)]
            for r in pts.itertuples()
        ],
    }
    with open(os.path.join(SITE_DATA, "points.json"), "w") as f:
        json.dump(points, f, separators=(",", ":"))

    # site copies of the release files
    master.drop(columns=["dark"]).to_csv(
        os.path.join(SITE_DATA, "cyclist_fatalities.csv"), index=False)
    dict_src = os.path.join(ROOT, "data", "DATA_DICTIONARY.md")
    if os.path.exists(dict_src):
        import shutil
        shutil.copy(dict_src, os.path.join(SITE_DATA, "DATA_DICTIONARY.md"))

    # --- site: aggregates ---------------------------------------------------
    per_year = master.groupby("year").agg(
        deaths=("id", "size"), hit_run=("hit_and_run", "sum"),
        drunk=("drunk_driver_involved", "sum"), dark=("dark", "sum")).reset_index()
    per_state = master.groupby(["state", "state_name"]).agg(
        deaths=("id", "size"), hit_run=("hit_and_run", "sum")).reset_index()
    per_state_year = master.groupby(["state", "year"]).size().rename("deaths").reset_index()
    ages = master.age.dropna().astype(int)
    striking = master.striking_vehicle.value_counts()
    light = master.light_condition.value_counts()
    aggregates = {
        "generated": "see git history",
        "total_deaths": int(len(master)),
        "years": {int(r.year): {"deaths": int(r.deaths), "hit_run": int(r.hit_run),
                                "drunk": int(r.drunk), "dark": int(r.dark)}
                  for r in per_year.itertuples()},
        "states": {r.state: {"name": r.state_name, "deaths": int(r.deaths),
                             "hit_run": int(r.hit_run)}
                   for r in per_state.itertuples()},
        "state_year": {f"{r.state}-{r.year}": int(r.deaths) for r in per_state_year.itertuples()},
        "age_hist": {str(b): int(((ages >= b) & (ages < b + 10)).sum()) for b in range(0, 100, 10)},
        "striking_vehicle": {k: int(v) for k, v in striking.items()},
        "light": {k: int(v) for k, v in light.items()},
    }
    with open(os.path.join(SITE_DATA, "aggregates.json"), "w") as f:
        json.dump(aggregates, f, separators=(",", ":"))
    print(f"\nwrote {len(points['rows'])} points, aggregates, master CSV")


if __name__ == "__main__":
    main()
