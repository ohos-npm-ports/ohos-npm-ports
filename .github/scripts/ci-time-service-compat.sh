#!/bin/sh
# CI-ONLY compatibility layer. This is NOT the real OpenHarmony time service.
#
# The ci-runner image has no /system/lib64/ndk/libtime_service_ndk.so, only the
# SDK link stub (no NEEDED, no implementation). Native addons built with
# iana-time-zone (Next SWC, Nx, ...) import OH_TimeService_GetTimeZone and
# cannot be dlopen'd without a library of that name. Provide just that symbol,
# answering from TZ or /etc/localtime, so the real native code can load and run.
# Nothing here validates the real system time service.
target=/system/lib64/ndk/libtime_service_ndk.so
if [ "$(uname -s)" = Linux ] && [ ! -e "$target" ] && command -v binary-sign-tool >/dev/null 2>&1; then
  work=$(mktemp -d)
  cat > "$work/compat.c" <<'EOF'
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
/* TimeService_ErrCode OH_TimeService_GetTimeZone(char *timeZone, uint32_t len) */
int OH_TimeService_GetTimeZone(char *timeZone, uint32_t len) {
  char name[256] = "UTC";
  const char *tz = getenv("TZ");
  if (tz && *tz) {
    strncpy(name, tz[0] == ':' ? tz + 1 : tz, sizeof(name) - 1);
  } else {
    char link[256];
    ssize_t n = readlink("/etc/localtime", link, sizeof(link) - 1);
    if (n > 0) {
      link[n] = 0;
      const char *z = strstr(link, "zoneinfo/");
      if (z) strncpy(name, z + 9, sizeof(name) - 1);
    }
  }
  if (!timeZone || strlen(name) + 1 > len) return 401;
  strcpy(timeZone, name);
  return 0;
}
EOF
  if cc -shared -fPIC -Wl,-soname,libtime_service_ndk.so -o "$work/unsigned.so" "$work/compat.c" &&
     binary-sign-tool sign -selfSign 1 -inFile "$work/unsigned.so" -outFile "$work/libtime_service_ndk.so"; then
    mkdir -p "$(dirname "$target")"
    cp "$work/libtime_service_ndk.so" "$target"
    chmod 755 "$target"
    echo "Installed CI-only time service compatibility library at $target"
  else
    echo "Could not build the CI-only time service compatibility library" >&2
  fi
  rm -rf "$work"
fi
