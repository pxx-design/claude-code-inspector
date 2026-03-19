#!/bin/bash
#
# Claude Code Inspector - One-click installer
# Installs the inspector skill to ~/.claude/skills/inspector/
#

set -e

REPO_BASE="https://raw.githubusercontent.com/pxx-design/claude-code-inspector/main"
INSTALL_DIR="$HOME/.claude/skills/inspector"
SCRIPTS_DIR="$INSTALL_DIR/scripts"

echo ""
echo "  Claude Code Inspector"
echo "  ─────────────────────"
echo ""

# Create directories
mkdir -p "$SCRIPTS_DIR"

# Download files
echo "  Downloading..."

curl -fsSL "$REPO_BASE/skill/SKILL.md" -o "$INSTALL_DIR/SKILL.md"
curl -fsSL "$REPO_BASE/skill/scripts/generate-dashboard.js" -o "$SCRIPTS_DIR/generate-dashboard.js"

# Make script executable
chmod +x "$SCRIPTS_DIR/generate-dashboard.js"

echo "  Installed to $INSTALL_DIR"
echo ""
echo "  Usage:"
echo "    In Claude Code, type /inspect to generate a visual dashboard"
echo "    Or run directly: node ~/.claude/skills/inspector/scripts/generate-dashboard.js"
echo ""
echo "  Done."
echo ""
