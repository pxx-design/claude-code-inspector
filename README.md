# Claude Code Inspector

One command, one HTML file — see everything Claude Code knows, can do, and should improve.

Zero dependencies. Runs locally. All secrets auto-masked.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/pxx-design/claude-code-inspector/main/install.sh | bash
```

Or run directly:

```bash
node path/to/generate-dashboard.js
```

Both generate `claude-code-inspector.html` in your current directory. Open it in any browser.

## What you get

### Capability Map
10 capabilities in a Bento grid — instantly see what Claude can and can't do in your project:
- **Core**: read/write files, run terminal commands
- **Knowledge**: project rules (CLAUDE.md), cross-session memory
- **Connect**: web search, browser automation, team tools (Feishu/Slack/Notion)
- **Extend**: plugins, hooks, auto-commit

### Health Score
A 0–100 score with findings sorted by severity. Each finding is expandable with a one-line fix suggestion.

### Resource Inventory
Collapsible sections for all 9 dimensions:

| Section | What it shows |
|---------|---------------|
| Skills | Project and user-level skills with metadata |
| Plugins | Installed plugins with enabled/blocked status |
| MCP Servers | Configured servers, commands, env keys |
| Hooks | Event-based hooks with matchers |
| Agents | Expert roles from plugins, project, and user level |
| Commands | Slash commands with descriptions |
| Memory | CLAUDE.md, memory files with previews |
| Settings | Git config, permissions, environment variables |

### Design
- Claude brand palette (Pampas background, terra cotta accents)
- Serif display type, system sans-serif body
- WCAG AA compliant contrast ratios

## Security

All secrets (API keys, tokens, passwords) are automatically masked. The generated HTML is safe to share.

## Requirements

- Node.js >= 16

## How it works

A single Node.js script (~2000 lines, zero dependencies) that:

1. Scans `~/.claude/` and `.claude/` for all config files
2. Detects 10 capabilities from MCP servers, plugins, permissions, and settings
3. Runs 30+ health checks across 9 dimensions
4. Generates a self-contained HTML dashboard

No data leaves your machine.

## Uninstall

```bash
rm -rf ~/.claude/skills/inspector/
```

## License

MIT
