#!/bin/zsh
cd -- "${0:A:h}" || exit 1

# Finder may not inherit the PATH used by Terminal or a Node version manager.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  codex_node_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$codex_node_bin/node" ]]; then
    export PATH="$codex_node_bin:$PATH"
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 24, then follow docs/MACOS.md.'
  read -r '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Run pnpm install --frozen-lockfile in this folder first. See docs/MACOS.md.'
  read -r '?Press Return to close.'
  exit 1
fi
node scripts/start.mjs
if [[ $? -ne 0 ]]; then
  read -r '?Sentinel stopped with an error. Press Return to close.'
fi
