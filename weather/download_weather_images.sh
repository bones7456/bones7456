#!/bin/bash
YESTERDAY=$(date -v-1d +%Y%m%d 2>/dev/null || date -d "yesterday" +%Y%m%d)
DIR="/var/www/luy.li/data/weather_images/$YESTERDAY"
mkdir -p "$DIR"

for h in {0..23}; do
  for m in {0..11}; do
    TIME=$(printf "%s%02d%02d" "$YESTERDAY" "$h" "$((m*5))")
    URL="https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${TIME}00dBR.dpsri.png"
    FILE="$DIR/${TIME}.png"
    [ -f "$FILE" ] || curl -s -f -o "$FILE" "$URL" || rm -f "$FILE"
  done
done
