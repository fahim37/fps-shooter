#!/usr/bin/env bash
# Downloads the free "[Standard]" zip of a Quaternius itch.io pack into assets-raw/.
# Usage: scripts/fetch-itch.sh <itch-slug> [file-name-filter]
# itch.io signs each file URL for only 60s, so a stalled transfer is resumed with a fresh URL.
set -euo pipefail
slug="$1"; filter="${2:-Standard}"
root="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"; out="$root/assets-raw"; mkdir -p "$out"
tmp="$out/.tmp-$$"; mkdir -p "$tmp"; trap 'rm -rf "$tmp"' EXIT
jar="$tmp/cookies"; UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]]||"")}catch{console.log("")}})' "$1"; }
csrf() { grep -oE 'csrf_token" value="[^"]+"' "$1" | head -1 | sed 's/.*value="//; s/"$//'; }

curl -sfL -A "$UA" -c "$jar" -b "$jar" "https://quaternius.itch.io/$slug" -o "$tmp/page.html"
dl=$(curl -sf -A "$UA" -c "$jar" -b "$jar" -X POST --data-urlencode "csrf_token=$(csrf "$tmp/page.html")" \
  -H "X-Requested-With: XMLHttpRequest" "https://quaternius.itch.io/$slug/download_url" | json url)
[ -n "$dl" ] || { echo "no download page for $slug" >&2; exit 1; }
curl -sfL -A "$UA" -c "$jar" -b "$jar" "$dl" -o "$tmp/dl.html"

# Pair each upload id with its file name, pick the one matching the filter.
node -e '
const h=require("fs").readFileSync(process.argv[1],"utf8");
const re=/data-upload_id="(\d+)"[\s\S]*?title="([^"]+)"/g; let m;
while((m=re.exec(h))) console.log(m[1]+"\t"+m[2]);' "$tmp/dl.html" > "$tmp/uploads.tsv"
line=$(grep -F "[$filter]" "$tmp/uploads.tsv" | head -1 || true)
[ -n "$line" ] || { echo "no [$filter] upload in $slug:"; cat "$tmp/uploads.tsv"; exit 1; } >&2
id="${line%%$'\t'*}"; name="${line#*$'\t'}"
part="$out/$name.part"

for attempt in 1 2 3 4 5 6 7 8; do
  url=$(curl -sf -A "$UA" -c "$jar" -b "$jar" -X POST --data-urlencode "csrf_token=$(csrf "$tmp/dl.html")" \
    -H "X-Requested-With: XMLHttpRequest" "https://quaternius.itch.io/$slug/file/$id?source=game_download&after_download_lightbox=1&as_props=1" | json url)
  [ -n "$url" ] || { echo "no file url for $name" >&2; exit 1; }
  echo "Downloading $name (attempt $attempt) ..."
  if curl -fL -sS -C - --speed-time 20 --speed-limit 20000 "$url" -o "$part"; then
    mv "$part" "$out/$name"; echo "$out/$name"; exit 0
  fi
  echo "stalled at $(wc -c < "$part") bytes, resuming" >&2
done
echo "failed to download $name" >&2; exit 1
