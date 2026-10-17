#!/usr/bin/env bash
# Puts launch-medsync on your PATH: a link in ~/.local/bin, and ~/.local/bin
# added to PATH in ~/.zshrc and ~/.bashrc where it is not there already.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/bin"

chmod +x "$root/scripts/launch-medsync" "$root/scripts/install-launcher.sh"
mkdir -p "$bin"
ln -sf "$root/scripts/launch-medsync" "$bin/launch-medsync"
echo "Linked $bin/launch-medsync -> $root/scripts/launch-medsync"

for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if grep -qs '\.local/bin' "$rc"; then
    echo "$rc already puts ~/.local/bin on PATH"
  else
    printf '\n# added by medsync scripts/install-launcher.sh\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
    echo "Added ~/.local/bin to PATH in $rc"
  fi
done

case ":$PATH:" in
  *":$bin:"*) echo "Ready: run launch-medsync" ;;
  *) echo "Open a new terminal (or run: source ~/.zshrc) before running launch-medsync" ;;
esac
