---
name: inspector
description: >-
  Visualize all Claude Code configuration as a beautiful HTML dashboard.
  Use when the user asks to "inspect config", "show my setup", "what skills/plugins do I have",
  "generate config dashboard", "audit my Claude Code setup", or invokes "/inspect".
version: 1.0.0
user-invocable: true
---

# Claude Code Inspector

Generate a self-contained HTML dashboard that visualizes all Claude Code configuration:
Skills, Plugins, MCP Servers, Hooks, Memory files, and Settings.

## Usage

When triggered, execute the dashboard generator script:

```bash
node ~/.claude/skills/inspector/scripts/generate-dashboard.js
```

This produces `claude-code-inspector.html` in the current working directory.

## What it scans

- **Skills**: Both `~/.claude/skills/` (user-level) and `.claude/skills/` (project-level)
- **Plugins**: `~/.claude/plugins/installed_plugins.json` cross-referenced with enabled status
- **MCP Servers**: Project `.claude/settings.json` mcpServers section
- **Hooks**: User and project settings hooks configuration
- **Memory**: Project memory, user-project memory, CLAUDE.md, other documentation
- **Settings**: Git config, permissions, environment variables

## Security

All secrets (API keys, tokens, passwords) are automatically masked in the output.
The generated HTML is safe to share.

## After generation

1. Report the output file path to the user
2. Open it in the browser: `open claude-code-inspector.html` (macOS) or `xdg-open` (Linux)
