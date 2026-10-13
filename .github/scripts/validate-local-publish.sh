#!/bin/sh
set -eu
export npm_config_progress=false

port_dir=$(cd "$1" && pwd)
registry=http://127.0.0.1:4873
temporary=$(mktemp -d "${TMPDIR:-/tmp}/ohos-port-registry.XXXXXX")
verdaccio_pid=

cleanup() {
  if [ -n "$verdaccio_pid" ]; then
    kill "$verdaccio_pid" 2>/dev/null || true
    wait "$verdaccio_pid" 2>/dev/null || true
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$temporary/storage" "$temporary/app" "$temporary/bin" "$temporary/consumer"
artifacts="$port_dir/artifacts"
mkdir -p "$artifacts"
touch "$temporary/packed.jsonl"
real_npm=$(command -v npm)
cat > "$temporary/bin/npm" <<'EOF'
#!/bin/sh
set -eu
if [ "${1:-}" = publish ]; then
  shift
  node -e '
    const p=require(process.cwd()+"/package.json");
    if (!p.name.startsWith("@ohos-npm-ports/")) throw new Error("Unexpected publish scope: " + p.name);
    require("fs").appendFileSync(process.env.PACKAGE_LIST,`${p.name}@${p.version}\n`);
  '
  if [ "${PUBLISH_DRY_RUN:-0}" = 1 ]; then exit 0; fi
  exec "$REAL_NPM" publish "$@" --registry "$PORT_REGISTRY" --@ohos-npm-ports:registry="$PORT_REGISTRY"
fi
exec "$REAL_NPM" "$@"
EOF
chmod +x "$temporary/bin/npm"
touch "$temporary/expected-packages.txt"
(
  cd "$port_dir"
  PATH="$temporary/bin:$PATH" REAL_NPM="$real_npm" PORT_REGISTRY="$registry" \
    PACKAGE_LIST="$temporary/expected-packages.txt" PUBLISH_DRY_RUN=1 sh ./publish.sh
)
if [ ! -s "$temporary/expected-packages.txt" ]; then
  echo "publish.sh did not declare any package" >&2
  exit 1
fi

verdaccio_version=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).verdaccio" "$(dirname "$0")/tool-versions.json")
attempt=0
until npm install --prefix "$temporary/app" --no-audit --no-fund --fetch-retries=5 "verdaccio@$verdaccio_version"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 3 ]; then echo "Verdaccio install failed" >&2; exit 1; fi
  sleep $((attempt * 3))
done
cat > "$temporary/config.yaml" <<EOF
storage: $temporary/storage
listen: 127.0.0.1:4873
max_body_size: 256mb
auth:
  htpasswd:
    file: $temporary/htpasswd
    max_users: 1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
EOF

# Locally built packages must never merge versions or tarballs from npmjs.
while IFS= read -r package; do
  name=${package%@*}
  key=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$name")
  printf '  %s:\n    access: $all\n    publish: $authenticated\n' "$key" >> "$temporary/config.yaml"
done < "$temporary/expected-packages.txt"
cat >> "$temporary/config.yaml" <<EOF
  '@ohos-npm-ports/*':
    access: \$all
    publish: \$authenticated
    proxy: npmjs
  '**':
    access: \$all
    publish: \$authenticated
    proxy: npmjs
EOF

"$temporary/app/node_modules/.bin/verdaccio" --config "$temporary/config.yaml" >"$temporary/verdaccio.log" 2>&1 &
verdaccio_pid=$!
ready=false
attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl -fsS "$registry/-/ping" >/dev/null 2>&1; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" != true ]; then
  cat "$temporary/verdaccio.log"
  echo "Verdaccio did not become ready" >&2
  exit 1
fi

if [ -d /system/lib64/ndk ]; then
  export LD_LIBRARY_PATH="/system/lib64/ndk${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export NPM_CONFIG_USERCONFIG="$temporary/npmrc"
user=ci-publisher
registration=$(curl -fsS -X PUT \
  -H 'Content-Type: application/json' \
  --data "{\"_id\":\"org.couchdb.user:$user\",\"name\":\"$user\",\"password\":\"local-registry-only\",\"email\":\"ci@example.invalid\",\"type\":\"user\",\"roles\":[],\"date\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" \
  "$registry/-/user/org.couchdb.user:$user")
token=$(printf '%s' "$registration" | node -e 'let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(input).token ?? ""));')
if [ -z "$token" ]; then
  echo "Verdaccio did not return an authentication token" >&2
  exit 1
fi
printf 'registry=%s/\n@ohos-npm-ports:registry=%s/\n//127.0.0.1:4873/:_authToken=%s\n' "$registry" "$registry" "$token" > "$NPM_CONFIG_USERCONFIG"

touch "$temporary/packages.txt"
(
  cd "$port_dir"
  PATH="$temporary/bin:$PATH" REAL_NPM="$real_npm" PORT_REGISTRY="$registry" PACKAGE_LIST="$temporary/packages.txt" sh ./publish.sh
)
cmp "$temporary/expected-packages.txt" "$temporary/packages.txt"

while IFS= read -r package; do
  [ -n "$package" ] || continue
  echo "Checking $package from Verdaccio"
  "$real_npm" view "$package" dist.tarball --json --registry "$registry" |
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
      const url=JSON.parse(s);
      if (!url.startsWith(process.argv[1]+"/")) throw new Error("Tarball is not from the temporary registry: " + url);
      console.log(url);
    });' "$registry"
  "$real_npm" view "$package" --json --registry "$registry" > "$temporary/published.json"
  PACKED_METADATA="$temporary/packed.jsonl" node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    (async()=>{
      const {name,version,dist}=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(!dist.tarball.startsWith(process.argv[3]+"/"))throw new Error("Published tarball must come from this Verdaccio");
      const response=await fetch(dist.tarball,{signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error(`Published tarball download failed: ${response.status}`);
      const data=Buffer.from(await response.arrayBuffer());
      const integrity="sha512-"+crypto.createHash("sha512").update(data).digest("base64");
      if(integrity!==dist.integrity)throw new Error("Downloaded artifact differs from the published tarball");
      const filename=`${name.replace(/^@/,"").replace("/","-")}-${version}.tgz`;
      fs.writeFileSync(path.join(process.argv[2],filename),data);
      fs.appendFileSync(process.env.PACKED_METADATA,JSON.stringify({name,version,filename,integrity})+"\n");
      console.log(`Exported published tarball: ${name}@${version}; ${integrity}`);
    })().catch(error=>{console.error(error);process.exitCode=1;});
    ' "$temporary/published.json" "$artifacts" "$registry"
  (
    cd "$temporary/consumer"
    # Bounded and foreground so a hanging postinstall fails visibly instead of
    # consuming the whole job timeout; install scripts still run normally.
    timeout 1200 "$real_npm" install --foreground-scripts --no-audit --no-fund --registry "$registry" "$package"
  )
done < "$temporary/packages.txt"

node -e '
  const fs=require("fs");
  const packages=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
  fs.writeFileSync(process.argv[2],JSON.stringify({sourceSha:process.env.GITHUB_SHA,portDir:process.argv[3],packages},null,2)+"\n");
' "$temporary/packed.jsonl" "$artifacts/manifest.json" "$1"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "artifact-name=port-$(basename "$(dirname "$port_dir")")-$(basename "$port_dir")" >> "$GITHUB_OUTPUT"
fi

echo "Verdaccio publish and consumer install succeeded for:"
cat "$temporary/packages.txt"
