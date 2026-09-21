#!/bin/bash
# クラウドセッションの起動時に依存を入れる。
#
# 環境の setup script ではなくここに置く理由：setup script は一度走るとファイルシステムの
# スナップショットがキャッシュされ、以降のセッションでスキップされる。package-lock.json を
# 更新しても古い node_modules のままセッションが始まってしまう。
# ローカルには node_modules が既にあるので、クラウド以外では何もしない。
set -u

[ "${CLAUDE_CODE_REMOTE:-}" = 'true' ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

lock_hash() {
  # クラウドは Ubuntu（sha256sum）。手元で試すとき用に shasum も見る。
  sha256sum package-lock.json 2>/dev/null || shasum -a 256 package-lock.json
}

stamp='node_modules/.install-stamp'
current="$(lock_hash | cut -d' ' -f1)"

# ロックファイルが前回の npm ci から変わっていなければ入れ直さない（resume を待たせない）
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current" ]; then
  exit 0
fi

if npm ci; then
  printf '%s' "$current" > "$stamp"
else
  echo 'npm ci に失敗した。依存が入っていないので、テストや typecheck の前に手動で npm ci すること。'
fi

# 依存が入らなくてもセッション自体は続ける
exit 0
