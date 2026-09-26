#!/bin/sh
# verify 一次性服务：代码测试 → 构建 → 已启动页面健康端点冒烟 → 裁决业务模块冒烟。
# 任一步失败即非零退出；全部通过输出 OK 并以 0 退出。
set -e

echo "== [verify] 1/4 单元测试 =="
npm run test

echo "== [verify] 2/4 构建 =="
npm run build

echo "== [verify] 3/4 已启动页面健康端点冒烟 =="
WEB_URL="${WEB_SMOKE_URL:-http://web:80}"
i=0
until wget -q -O- "$WEB_URL/health" | grep -q ok; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "健康端点 $WEB_URL/health 不可达"
    exit 1
  fi
  sleep 2
done
wget -q -O- "$WEB_URL/" | grep -q "配重挂装裁决" || {
  echo "首页内容冒烟失败"
  exit 1
}
echo "健康端点与首页冒烟通过"

echo "== [verify] 4/4 裁决业务模块冒烟 =="
npm run smoke

echo "== [verify] 全部检查通过 =="
