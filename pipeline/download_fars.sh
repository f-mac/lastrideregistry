#!/bin/bash
# Download NHTSA FARS National CSV files, 2010-2024, and extract the tables we need.
# FARS data is public domain (US government work).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
FAILED=""
for YEAR in $(seq 2010 2024); do
  ZIP="data/raw/FARS${YEAR}NationalCSV.zip"
  DEST="data/raw/${YEAR}"
  if [ -d "$DEST" ] && ls "$DEST" | grep -qi accident; then
    echo "[$YEAR] already extracted, skipping"
    continue
  fi
  if [ ! -s "$ZIP" ]; then
    echo "[$YEAR] downloading..."
    curl -sfL --retry 3 --retry-delay 5 -o "$ZIP" \
      "https://static.nhtsa.gov/nhtsa/downloads/FARS/${YEAR}/National/FARS${YEAR}NationalCSV.zip" \
      || { echo "[$YEAR] DOWNLOAD FAILED"; FAILED="$FAILED $YEAR"; rm -f "$ZIP"; continue; }
  fi
  mkdir -p "$DEST"
  # -C case-insensitive, -j junk paths (some years nest files in a subdir),
  # wildcards match both layouts. pbtype only exists 2014+.
  unzip -o -q -C -j "$ZIP" "*accident.csv" "*person.csv" "*vehicle.csv" "*pbtype.csv" -d "$DEST" \
    || { echo "[$YEAR] EXTRACT FAILED"; FAILED="$FAILED $YEAR"; continue; }
  echo "[$YEAR] done: $(ls "$DEST" | tr '\n' ' ')"
done
if [ -n "$FAILED" ]; then echo "FAILED YEARS:$FAILED"; exit 1; fi
echo "ALL DOWNLOADS COMPLETE"
