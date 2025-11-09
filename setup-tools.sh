#!/bin/sh
set -e

alpine_repository="http://dl-cdn.alpinelinux.org/alpine/v3.22/main/aarch64/"

download_alpine_index() {
    curl -fsSL ${alpine_repository}/APKINDEX.tar.gz | tar -zx -C /tmp
}

get_apk_url() {
    package_name=$1
    package_version=$(grep -A1 "^P:${package_name}$" /tmp/APKINDEX | sed -n "s/^V://p")
    apk_file_name=${package_name}-${package_version}.apk
    echo ${alpine_repository}/${apk_file_name}
}

query_component() {
  component=$1
  curl -fsSL 'https://ci.openharmony.cn/api/daily_build/build/list/component' \
    -H 'Accept: application/json, text/plain, */*' \
    -H 'Content-Type: application/json' \
    --data-raw '{"projectName":"openharmony","branch":"master","pageNum":1,"pageSize":10,"deviceLevel":"","component":"'${component}'","type":1,"startTime":"2025090100000000","endTime":"20990101235959","sortType":"","sortField":"","hardwareBoard":"","buildStatus":"success","buildFailReason":"","withDomain":1}'
}


# 从 Alpine Linux 软件源里面下载一些工具软件安装到系统中
download_alpine_index
curl -L -O $(get_apk_url busybox-static) # 提供 unzip 命令，用来解压 ohos-sdk
curl -L -O $(get_apk_url jq)             # 下载 ohos-sdk 的时候解析接口内容要用到
curl -L -O $(get_apk_url oniguruma)      # jq 依赖这个
curl -L -O $(get_apk_url make)           # 编译东西的时候要用到
for file in *.apk; do
  tar -zxf $file -C /
done
rm -rf *.apk
ln -s /bin/busybox.static /bin/unzip

# 下载 Node.js
curl -L -O https://github.com/hqzing/ohos-node/releases/download/v24.2.0/node-v24.2.0-openharmony-arm64.tar.gz
tar -zxf node-v24.2.0-openharmony-arm64.tar.gz -C /opt
rm node-v24.2.0-openharmony-arm64.tar.gz

# 下载 Python
curl -L -O https://github.com/astral-sh/python-build-standalone/releases/download/20251014/cpython-3.12.12+20251014-aarch64-unknown-linux-musl-install_only.tar.gz
tar -zxf cpython-3.12.12+20251014-aarch64-unknown-linux-musl-install_only.tar.gz -C /opt
rm -rf cpython-3.12.12+20251014-aarch64-unknown-linux-musl-install_only.tar.gz

# 下载 ohos-sdk
sdk_ohos_download_url=$(query_component "ohos-sdk-public_ohos" | jq -r ".data.list.dataList[0].obsPath")
curl $sdk_ohos_download_url -o ohos-sdk-public_ohos.tar.gz
mkdir /opt/ohos-sdk
tar -zxf ohos-sdk-public_ohos.tar.gz -C /opt/ohos-sdk
cd /opt/ohos-sdk/ohos/
unzip -q native-*.zip
unzip -q toolchains-*.zip
cd - >/dev/null
rm ohos-sdk-public_ohos.tar.gz
