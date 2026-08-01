#!/usr/bin/env bash
# Точка входу, яку варто викликати з будь-якого проєкту/сесії — не з
# tools/note.mjs напряму. Причина: у звичайному новому шеллі команди
# `node` часто немає в PATH (стоїть через nvm), тож ми самі підвантажуємо
# nvm, якщо node не знайшовся, і тільки тоді делегуємо в note.mjs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node не знайдено навіть після спроби підвантажити nvm. Постав Node.js або перевір ~/.nvm." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) не знайдено в PATH — без нього note.mjs не зможе комітити в репозиторій." >&2
  exit 1
fi

exec node "$SCRIPT_DIR/note.mjs" "$@"
