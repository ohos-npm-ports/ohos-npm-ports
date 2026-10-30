resource_names=()

resource() {
  if [ "$#" -ne 3 ]; then
    echo 'resource requires: resource "name" "url" "sha256"' >&2
    return 64
  fi
  local name="$1"
  if [[ ! "$name" =~ ^[a-z][a-z0-9_]*$ ]]; then
    echo "Invalid resource name: ${name}" >&2
    return 64
  fi
  local url_variable="resource_${name}_url"
  local sha_variable="resource_${name}_sha256"
  if [ -n "${!url_variable+x}" ]; then
    echo "Duplicate resource: ${name}" >&2
    return 64
  fi
  printf -v "$url_variable" '%s' "$2"
  printf -v "$sha_variable" '%s' "$3"
  resource_names+=("$name")
}

_npm_ports_fetch() {
  local url="$1"
  local sha256="$2"
  local output="$3"
  mkdir -p "$(dirname "$output")"
  curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 "$url" -o "$output"
  printf '%s  %s\n' "$sha256" "$output" | sha256sum -c -
}

fetch_source() {
  if [ "$#" -ne 1 ] || [ -z "${source:-}" ] || [ -z "${sha256:-}" ]; then
    echo 'fetch_source requires an output path and source/sha256 metadata' >&2
    return 64
  fi
  _npm_ports_fetch "$source" "$sha256" "$1"
}

fetch_resource() {
  if [ "$#" -ne 2 ]; then
    echo 'fetch_resource requires: fetch_resource "name" "output"' >&2
    return 64
  fi
  local url_variable="resource_$1_url"
  local sha_variable="resource_$1_sha256"
  if [ -z "${!url_variable:-}" ] || [ -z "${!sha_variable:-}" ]; then
    echo "Unknown resource: $1" >&2
    return 64
  fi
  _npm_ports_fetch "${!url_variable}" "${!sha_variable}" "$2"
}
