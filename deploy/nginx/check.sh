#!/usr/bin/env bash
# deploy/nginx/check.sh
#
# Validate the nginx configuration here, in a throwaway container, rather than
# on the server.
#
# plugin-universe had six configurations fail `nginx -t` on the server, every
# one of them findable locally in a second. This is that check.
#
# `nginx -t` does not catch everything. It will not tell you that an
# `add_header` inside a location replaces the server block's headers, or that a
# `proxy_pass` without a trailing slash fails to strip the prefix. Those are
# checked by grep below, because a syntax checker cannot see intent.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fragments=("$here/jigdaw.conf" "$here/vocab.conf")
image="${NGINX_IMAGE:-nginx:alpine}"

runtime=""
for candidate in podman docker; do
  if command -v "$candidate" >/dev/null 2>&1; then runtime="$candidate"; break; fi
done
if [ -z "$runtime" ]; then
  echo "check: no podman or docker, so nginx cannot be validated here" >&2
  echo "check: install one, or run 'nginx -t' against the assembled file yourself" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The fragment is a set of location blocks, so it is wrapped in the smallest
# server that makes it valid. TLS is left out deliberately: certbot owns those
# lines on the server and they are not what this is checking.
cat > "$work/nginx.conf" <<'CONF'
events { worker_connections 64; }
http {
  server {
    listen 8080;
    server_name strandz.it;
    include /etc/nginx/conf.d/jigdaw.conf;
  }
  server {
    listen 8081;
    server_name hyperdata.it;
    include /etc/nginx/conf.d/vocab.conf;
  }
}
CONF
for f in "${fragments[@]}"; do cp "$f" "$work/"; done

echo "check: validating with $runtime ($image)"
output="$($runtime run --rm \
  -v "$work/nginx.conf:/etc/nginx/nginx.conf:ro,Z" \
  -v "$work/jigdaw.conf:/etc/nginx/conf.d/jigdaw.conf:ro,Z" \
  -v "$work/vocab.conf:/etc/nginx/conf.d/vocab.conf:ro,Z" \
  "$image" nginx -t 2>&1)" || {
    echo "$output" >&2
    echo "check: FAILED" >&2
    exit 1
  }

echo "$output" | sed 's/^/  /'
warnings="$(printf '%s\n' "$output" | grep -ci 'warn' || true)"
echo "check: syntax ok, $warnings warning(s)"

# What nginx -t cannot see. These apply to the proxying fragment; vocab.conf
# serves files directly and has no upstream to hide headers from.
fail=0
fragment="$here/jigdaw.conf"

if ! grep -qE 'proxy_pass\s+http://127\.0\.0\.1:[0-9]+/;' "$fragment"; then
  echo "check: proxy_pass has no trailing slash, so the /jigdaw/ prefix is not stripped" >&2
  fail=1
fi

for header in Access-Control-Allow-Origin Cross-Origin-Resource-Policy X-Content-Type-Options; do
  if ! grep -q "add_header $header" "$fragment"; then
    echo "check: $header is missing; a plugin origin without it serves plugins no host can read" >&2
    fail=1
  fi
done

# `always`, or the header is absent on error responses, and a 404 for a profile
# is still a cross-origin response a host has to read.
# Comments are stripped first: this file explains the add_header trap in prose,
# and matching that explanation was the check's own first false positive.
if grep -v '^[[:space:]]*#' "$fragment" | grep 'add_header' | grep -v 'always' | grep -q .; then
  echo "check: an add_header is missing 'always', so it is not sent on error responses" >&2
  fail=1
fi

# Every header nginx adds must also be hidden from the upstream, or it is sent
# twice. A browser rejects Access-Control-Allow-Origin with multiple values
# outright, and the application sets these itself so that it is correct when
# run with no proxy in front of it. Found by curling through a real nginx.
while read -r header; do
  if ! grep -q "proxy_hide_header $header;" "$fragment"; then
    echo "check: $header is added but not hidden from the upstream, so it is sent twice" >&2
    fail=1
  fi
done < <(grep -v '^[[:space:]]*#' "$fragment" | grep -oP 'add_header \K[A-Za-z-]+' | sort -u)

if grep -qE '^\s*types\s*\{' "$fragment"; then
  echo "check: a types block replaces the mime map for this location" >&2
  fail=1
fi

# The vocabulary fragment has its own rule: a term must 303, not 200. Answering
# 200 asserts that the property IS the page returned.
if ! grep -q 'return 303' "$here/vocab.conf"; then
  echo "check: vocab.conf does not 303 a term to its document; a 200 would assert the term is the page" >&2
  fail=1
fi
if ! grep -q 'add_header Access-Control-Allow-Origin' "$here/vocab.conf"; then
  echo "check: vocab.conf has no CORS header; a browser cannot read the vocabulary cross-origin" >&2
  fail=1
fi

[ "$fail" -eq 0 ] || { echo "check: FAILED"; exit 1; }
echo "check: intent checks ok"
