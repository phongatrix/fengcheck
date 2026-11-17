#!/usr/bin/env bash
# =============================================================================
#  Chạy app Chấm thi OMR trên Linux/macOS.
#  Mọi logic nằm trong run.mjs (Node.js); file này chỉ kiểm tra Node rồi gọi nó.
#
#    ./run.sh                     # cài + build + chạy cổng 3210
#    ./run.sh --port=3211         # chọn cổng khác
#    ./run.sh --dev               # chế độ phát triển
# =============================================================================
set -u

cd "$(dirname "$0")" || exit 1

echo
echo "  CHẤM THI OMR — khởi động trên $(uname -s)"
echo "  ----------------------------------------"

if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'

  [✗] Không tìm thấy Node.js.

      Cách cài (chọn một):
        • Ubuntu/Debian : curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
        • Fedora        : sudo dnf module install nodejs:20
        • Arch          : sudo pacman -S nodejs npm
        • macOS (brew)  : brew install node@20

      Cài xong mở terminal mới rồi chạy lại:  ./run.sh

EOF
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 18 ] 2>/dev/null; then
  echo
  echo "  [✗] Node.js hiện tại quá cũ: v$(node -v 2>/dev/null). Cần ≥ v18.17."
  echo "      Nâng cấp Node rồi chạy lại (xem hướng dẫn ở trên)."
  echo
  exit 1
fi

# Cho phép bấm đúp trong trình quản lý tệp: nếu không có terminal, vẫn chạy.
exec node ./run.mjs "$@"
