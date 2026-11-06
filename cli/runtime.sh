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

_npm_ports_download() {
  local url="$1"
  local sha256="$2"
  local cache_base="${XDG_CACHE_HOME:-${HOME:-.}/.cache}"
  local cache_dir="${NPM_PORTS_CACHE_DIR:-${cache_base}/npm-ports}/downloads"
  local cached="${cache_dir}/${sha256}"
  local temporary="${cached}.tmp.$$"
  if [ -f "$cached" ] && ! printf '%s  %s\n' "$sha256" "$cached" | sha256sum -c - >/dev/null 2>&1; then
    rm -f "$cached"
  fi
  if [ ! -f "$cached" ]; then
    mkdir -p "$cache_dir"
    rm -f "$temporary"
    if ! curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 "$url" -o "$temporary"; then
      rm -f "$temporary"
      return 1
    fi
    if ! printf '%s  %s\n' "$sha256" "$temporary" | sha256sum -c -; then
      rm -f "$temporary"
      return 1
    fi
    # Do not replace a cached inode that another process may be copying.
    if ! ln "$temporary" "$cached" 2>/dev/null; then
      rm -f "$temporary"
      if [ ! -f "$cached" ]; then
        echo "Unable to create cached download: $cached" >&2
        return 1
      fi
    else
      rm -f "$temporary"
    fi
  fi
  NPM_PORTS_DOWNLOAD="$cached"
}

_npm_ports_fetch() {
  local url="$1"
  local sha256="$2"
  local output="$3"
  local temporary="${output}.tmp.$$"
  _npm_ports_download "$url" "$sha256"
  mkdir -p "$(dirname "$output")"
  if [ "$output" != "$NPM_PORTS_DOWNLOAD" ]; then
    rm -f "$temporary"
    if ! cp "$NPM_PORTS_DOWNLOAD" "$temporary"; then
      rm -f "$temporary"
      return 1
    fi
    if ! mv "$temporary" "$output"; then
      rm -f "$temporary"
      return 1
    fi
  fi
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

_npm_ports_extract() {
  local url="$1"
  local sha256="$2"
  local destination="$3"
  local strip_components=1
  local archive
  shift 3
  case "$destination" in
    ''|'/'|'.'|'..')
      echo "Unsafe extraction destination: ${destination}" >&2
      return 64
      ;;
  esac
  if [[ "${1:-}" == --strip-components=* ]]; then
    strip_components="${1#*=}"
    shift
  fi
  if [ "${1:-}" = '--' ]; then shift; fi
  case "$strip_components" in
    ''|*[!0-9]*)
      echo "Invalid --strip-components value: ${strip_components}" >&2
      return 64
      ;;
  esac
  _npm_ports_download "$url" "$sha256"
  archive="$NPM_PORTS_DOWNLOAD"
  rm -rf "$destination"
  mkdir -p "$destination"
  if ! tar -xf "$archive" -C "$destination" --strip-components="$strip_components" "$@"; then
    rm -rf "$destination"
    return 1
  fi
}

extract_source() {
  if [ "$#" -lt 1 ] || [ -z "${source:-}" ] || [ -z "${sha256:-}" ]; then
    echo 'extract_source requires an output directory and source/sha256 metadata' >&2
    return 64
  fi
  local destination="$1"
  shift
  _npm_ports_extract "$source" "$sha256" "$destination" "$@"
}

extract_resource() {
  if [ "$#" -lt 2 ]; then
    echo 'extract_resource requires: extract_resource "name" "output-directory" [tar options]' >&2
    return 64
  fi
  local url_variable="resource_$1_url"
  local sha_variable="resource_$1_sha256"
  if [ -z "${!url_variable:-}" ] || [ -z "${!sha_variable:-}" ]; then
    echo "Unknown resource: $1" >&2
    return 64
  fi
  local url="${!url_variable}"
  local sha256="${!sha_variable}"
  local destination="$2"
  shift 2
  _npm_ports_extract "$url" "$sha256" "$destination" "$@"
}

manifest_add_files() {
  if [ "$#" -lt 2 ]; then
    echo 'manifest_add_files requires a package.json and at least one path' >&2
    return 64
  fi
  local file="$1"
  shift
  "$NPM_PORTS_NODE" "$NPM_PORTS_MANIFEST" add-files "$file" "$@"
}

manifest_remove_script() {
  if [ "$#" -lt 2 ]; then
    echo 'manifest_remove_script requires a package.json and at least one script name' >&2
    return 64
  fi
  local file="$1"
  shift
  "$NPM_PORTS_NODE" "$NPM_PORTS_MANIFEST" remove-scripts "$file" "$@"
}
