# Last Ride Registry

**[lastrideregistry.com](https://lastrideregistry.com)** — an open registry of
every cyclist killed by a driver on a US road since 2010.

13,050 people were killed riding bicycles on American roads between 2010 and
2024. Annual deaths rose 88%. Nearly one in four drivers who killed a cyclist
in 2023 fled the scene. No agency tracks what happened to the drivers
afterward. This project maps every death, opens the data, and — next — traces
driver legal outcomes through court records, case by case.

## What's here

```
pipeline/   FARS download + dataset build (Python, duckdb)
data/       processed release files + data dictionary
site/       the website (Astro, MapLibre, hand-rolled canvas/SVG)
```

## The data

- `data/processed/cyclist_fatalities.csv` — one row per person killed:
  date, location (99.5% geocoded), age, sex, light condition, striking-vehicle
  class, hit-and-run / impaired / speeding crash flags. 2010–2024.
- `data/DATA_DICTIONARY.md` — column definitions and caveats.
- Source: NHTSA [FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars)
  (public domain). Yearly totals reconcile with NHTSA's published counts
  (several years exact; see `data/processed/validation_report.txt`).

**License: data CC BY 4.0** (credit "Last Ride Registry"), **code MIT**.

## Rebuild from scratch

```bash
./pipeline/download_fars.sh        # ~1 GB of FARS zips from NHTSA
python3 pipeline/build_dataset.py  # needs: pip install duckdb pandas
cd site && npm install && npm run build
```

## Roadmap

- **v1 (this)** — open dataset + map + trends.
- **v2** — court-record-verified driver outcomes for the 2023 hit-and-run
  cohort (~275 cases): charged / convicted / sentenced / nothing, with
  citations.
- **v3** — every year, every case, with a public correction channel.

Corrections and contributions welcome — open an issue or PR.
