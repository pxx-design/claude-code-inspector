#!/usr/bin/env node

/**
 * Claude Code Inspector - Dashboard Generator
 * Scans all Claude Code configuration and generates a self-contained HTML dashboard.
 * Zero dependencies - uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Constants & Path Resolution ─────────────────────────────────────────────

const HOME = os.homedir();
const CWD = process.cwd();

const PATHS = {
  userSettings: path.join(HOME, '.claude', 'settings.json'),
  userSkillsDir: path.join(HOME, '.claude', 'skills'),
  userSkillsManifest: path.join(HOME, '.claude', 'skills', '.skills-manifest.json'),
  pluginsInstalled: path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'),
  pluginsBlocklist: path.join(HOME, '.claude', 'plugins', 'blocklist.json'),
  pluginsCache: path.join(HOME, '.claude', 'plugins', 'cache'),
  projectsDir: path.join(HOME, '.claude', 'projects'),
  projectSettings: path.join(CWD, '.claude', 'settings.json'),
  projectSettingsLocal: path.join(CWD, '.claude', 'settings.local.json'),
  projectSkillsDir: path.join(CWD, '.claude', 'skills'),
  projectClaudeMd: path.join(CWD, '.claude', 'CLAUDE.md'),
  projectClaudeDir: path.join(CWD, '.claude'),
  userClaudeMd: path.join(HOME, '.claude', 'CLAUDE.md'),
  userAgentsDir: path.join(HOME, '.claude', 'agents'),
  userCommandsDir: path.join(HOME, '.claude', 'commands'),
  projectAgentsDir: path.join(CWD, '.claude', 'agents'),
  projectCommandsDir: path.join(CWD, '.claude', 'commands'),
};

// ─── Utility Functions ───────────────────────────────────────────────────────

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } }
function readTextSafe(p) { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } }
function listDir(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }

function shortenPath(absPath) {
  if (absPath.startsWith(HOME)) return '~' + absPath.slice(HOME.length);
  return absPath;
}

function maskSecret(key, value) {
  if (typeof value !== 'string') return String(value);
  if (/secret|token|key|password|credential|api_key|apikey|app_secret/i.test(key)) {
    return value.length <= 4 ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '\u2022\u2022\u2022\u2022' + value.slice(-4);
  }
  return value;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data = {};
  const lines = match[1].split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const i = line.indexOf(':');
    if (i > 0 && !/^\s/.test(line)) {
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      // Handle YAML block scalars (| or >)
      if ((val === '|' || val === '>') && idx + 1 < lines.length) {
        const blockLines = [];
        while (idx + 1 < lines.length && /^\s/.test(lines[idx + 1])) {
          idx++;
          blockLines.push(lines[idx].trim());
        }
        val = blockLines.join(val === '|' ? '\n' : ' ');
      }
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      data[key] = val;
    }
  }
  return data;
}

function getFileSizeStr(p) {
  try {
    const b = fs.statSync(p).size;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  } catch { return '?'; }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function truncate(s, n = 200) { return !s ? '' : s.length <= n ? s : s.slice(0, n) + '...'; }

function maskSecretsInText(text) {
  if (!text) return '';
  return text.replace(/(app_secret|app_id|secret|token|password|credential|api_key|apikey|open_id)[:\s=]+["']?([a-zA-Z0-9_\-]{8,})["']?/gi,
    (m, key, value) => `${key}: \u2022\u2022\u2022\u2022${value.slice(-4)}`);
}

// ─── Scanner A: Skills ───────────────────────────────────────────────────────

function scanSkillsDir(dirPath, source) {
  const skills = [];
  for (const entry of listDir(dirPath)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillDir = path.join(dirPath, entry.name);
    const content = readTextSafe(path.join(skillDir, 'SKILL.md'));
    if (!content) continue;
    const meta = parseFrontmatter(content);
    const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
    let subFileCount = 0;
    const count = (dir) => { for (const e of listDir(dir)) { if (e.isFile() && e.name !== 'SKILL.md') subFileCount++; else if (e.isDirectory()) count(path.join(dir, e.name)); } };
    count(skillDir);
    skills.push({
      name: meta.name || entry.name, description: meta.description || '', version: meta.version || '',
      path: shortenPath(skillDir), source, userInvocable: meta['user-invocable'] === 'true', subFileCount,
      bodyPreview: truncate(bodyMatch ? bodyMatch[1].trim() : '', 150),
    });
  }
  return skills;
}

function scanSkills() {
  const manifest = readJsonSafe(PATHS.userSkillsManifest);
  const userSkills = scanSkillsDir(PATHS.userSkillsDir, 'user');
  const projectSkills = scanSkillsDir(PATHS.projectSkillsDir, 'project');
  if (manifest?.skills && typeof manifest.skills === 'object') {
    for (const skill of userSkills) {
      const e = manifest.skills[skill.name];
      if (e) { skill.remoteSource = e.package || e.source || ''; skill.installedAt = e.installedAt || ''; }
    }
  }
  // Scan plugin-provided skills
  const pluginSkills = [];
  const installed = readJsonSafe(PATHS.pluginsInstalled);
  const userSettings = readJsonSafe(PATHS.userSettings);
  const enabledPlugins = userSettings?.enabledPlugins || {};
  if (installed?.plugins) {
    for (const [pluginId, versions] of Object.entries(installed.plugins)) {
      if (!Array.isArray(versions) || versions.length === 0) continue;
      if (enabledPlugins[pluginId] !== true) continue;
      const latest = versions[versions.length - 1];
      if (!latest.installPath) continue;
      const skills = scanSkillsDir(path.join(latest.installPath, 'skills'), 'plugin');
      skills.forEach(s => { s.pluginName = pluginId.split('@')[0]; });
      pluginSkills.push(...skills);
    }
  }
  return { userSkills, projectSkills, pluginSkills };
}

// ─── Scanner B: Plugins ──────────────────────────────────────────────────────

function scanPlugins() {
  const installedRaw = readJsonSafe(PATHS.pluginsInstalled);
  const blocklist = readJsonSafe(PATHS.pluginsBlocklist);
  const userSettings = readJsonSafe(PATHS.userSettings);
  const enabledPlugins = userSettings?.enabledPlugins || {};
  const plugins = [];
  const installed = installedRaw?.plugins || installedRaw || {};
  if (installed && typeof installed === 'object') {
    for (const [pluginId, versions] of Object.entries(installed)) {
      if (!Array.isArray(versions) || versions.length === 0) continue;
      const latest = versions[versions.length - 1];
      let pluginMeta = {};
      if (latest.installPath) {
        pluginMeta = readJsonSafe(path.join(latest.installPath, '.claude-plugin', 'plugin.json')) || {};
      }
      const blocklistArr = Array.isArray(blocklist?.plugins) ? blocklist.plugins : [];
      plugins.push({
        id: pluginId, name: pluginMeta.name || pluginId.split('@')[0], description: pluginMeta.description || '',
        version: latest.version || '', marketplace: pluginId.includes('@') ? pluginId.split('@')[1] : '',
        enabled: enabledPlugins[pluginId] === true, blocked: blocklistArr.some(b => b.plugin === pluginId),
        installedAt: latest.installedAt || '', lastUpdated: latest.lastUpdated || '',
        skillCount: pluginMeta.skills ? Object.keys(pluginMeta.skills).length : 0,
      });
    }
  }
  return { plugins };
}

// ─── Scanner C: MCP Servers ──────────────────────────────────────────────────

function scanMcpServers() {
  const servers = [];
  const seen = new Set();
  for (const { path: sp, scope } of [
    { path: PATHS.projectSettingsLocal, scope: 'project' },
    { path: PATHS.projectSettings, scope: 'project' },
    { path: PATHS.userSettings, scope: 'user' },
  ]) {
    const settings = readJsonSafe(sp);
    if (!settings?.mcpServers) continue;
    for (const [name, config] of Object.entries(settings.mcpServers)) {
      if (seen.has(name)) continue;
      seen.add(name);
      servers.push({
        name, command: config.command || '', args: config.args || [],
        envKeys: config.env ? Object.keys(config.env) : [], disabled: config.disabled === true, scope,
      });
    }
  }
  return { servers };
}

// ─── Scanner D: Hooks ────────────────────────────────────────────────────────

function scanHooks() {
  const hooks = [];
  for (const { path: sp, scope } of [
    { path: PATHS.projectSettingsLocal, scope: 'project' },
    { path: PATHS.userSettings, scope: 'user' },
    { path: PATHS.projectSettings, scope: 'project' },
  ]) {
    const settings = readJsonSafe(sp);
    if (!settings?.hooks) continue;
    for (const [event, matchers] of Object.entries(settings.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        hooks.push({
          event, matcher: matcher.matcher || '*', scope,
          commands: Array.isArray(matcher.hooks) ? matcher.hooks.map(h => ({ type: h.type || 'command', command: h.command || '' })) : [],
        });
      }
    }
  }
  return { hooks };
}

// ─── Scanner E: Memory ───────────────────────────────────────────────────────

function scanMemory() {
  const projectMemory = [], userProjectMemory = [], otherDocs = [];
  const projMemDir = path.join(PATHS.projectClaudeDir, 'memory');
  for (const entry of listDir(projMemDir)) {
    if (!entry.isFile()) continue;
    const fp = path.join(projMemDir, entry.name);
    projectMemory.push({ filename: entry.name, path: shortenPath(fp), size: getFileSizeStr(fp), preview: maskSecretsInText(truncate(readTextSafe(fp), 300)) });
  }
  const encodedPath = '-' + CWD.slice(1).replace(/\//g, '-');
  const userProjMemDir = path.join(PATHS.projectsDir, encodedPath, 'memory');
  for (const entry of listDir(userProjMemDir)) {
    if (!entry.isFile()) continue;
    const fp = path.join(userProjMemDir, entry.name);
    userProjectMemory.push({ filename: entry.name, path: shortenPath(fp), size: getFileSizeStr(fp), preview: maskSecretsInText(truncate(readTextSafe(fp), 300)) });
  }
  const claudeMdContent = readTextSafe(PATHS.projectClaudeMd);
  const claudeMd = { exists: !!claudeMdContent, path: shortenPath(PATHS.projectClaudeMd), size: claudeMdContent ? getFileSizeStr(PATHS.projectClaudeMd) : '', preview: maskSecretsInText(truncate(claudeMdContent, 500)) };
  for (const entry of listDir(PATHS.projectClaudeDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'CLAUDE.md') continue;
    const fp = path.join(PATHS.projectClaudeDir, entry.name);
    otherDocs.push({ filename: entry.name, path: shortenPath(fp), size: getFileSizeStr(fp), preview: maskSecretsInText(truncate(readTextSafe(fp), 200)) });
  }
  const userClaudeMdContent = readTextSafe(PATHS.userClaudeMd);
  const userClaudeMd = { exists: !!userClaudeMdContent, path: shortenPath(PATHS.userClaudeMd), size: userClaudeMdContent ? getFileSizeStr(PATHS.userClaudeMd) : '', preview: maskSecretsInText(truncate(userClaudeMdContent, 500)) };
  return { projectMemory, userProjectMemory, claudeMd, userClaudeMd, otherDocs };
}

// ─── Scanner F: Settings ─────────────────────────────────────────────────────

function scanSettings() {
  const ps = readJsonSafe(PATHS.projectSettings) || {};
  const pl = readJsonSafe(PATHS.projectSettingsLocal) || {};
  const us = readJsonSafe(PATHS.userSettings) || {};
  const gitConfig = {};
  for (const k of ['autoCommit', 'autoPush', 'autoPull', 'allowUnsafeOperations', 'alwaysManageReadOnly']) { if (k in pl) gitConfig[k] = pl[k]; else if (k in ps) gitConfig[k] = ps[k]; }
  const permissions = { allow: pl.permissions?.allow || ps.permissions?.allow || [], deny: pl.permissions?.deny || ps.permissions?.deny || [] };
  const envVars = {};
  if (us.env) { for (const [k, v] of Object.entries(us.env)) envVars[k] = maskSecret(k, v); }
  return { gitConfig, permissions, envVars };
}

// ─── Scanner H: Agents ───────────────────────────────────────────────────────

function scanAgentDir(dirPath, source) {
  const agents = [];
  for (const entry of listDir(dirPath)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fp = path.join(dirPath, entry.name);
    const content = readTextSafe(fp);
    if (!content) continue;
    const meta = parseFrontmatter(content);
    if (!meta.name && !meta.description) continue;
    const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
    agents.push({
      name: meta.name || entry.name.replace(/\.md$/, ''),
      description: meta.description || '',
      model: meta.model || '',
      tools: meta.tools ? meta.tools.split(',').map(t => t.trim()) : [],
      color: meta.color || '',
      path: shortenPath(fp),
      source,
      pluginName: '',
      bodyPreview: truncate(bodyMatch ? bodyMatch[1].trim() : '', 150),
    });
  }
  return agents;
}

function scanAgents() {
  const userAgents = scanAgentDir(PATHS.userAgentsDir, 'user');
  const projectAgents = scanAgentDir(PATHS.projectAgentsDir, 'project');
  const pluginAgents = [];
  const installed = readJsonSafe(PATHS.pluginsInstalled);
  const userSettings = readJsonSafe(PATHS.userSettings);
  const enabledPlugins = userSettings?.enabledPlugins || {};
  if (installed?.plugins) {
    for (const [pluginId, versions] of Object.entries(installed.plugins)) {
      if (!Array.isArray(versions) || versions.length === 0) continue;
      if (enabledPlugins[pluginId] !== true) continue;
      const latest = versions[versions.length - 1];
      if (!latest.installPath) continue;
      const agents = scanAgentDir(path.join(latest.installPath, 'agents'), 'plugin');
      agents.forEach(a => { a.pluginName = pluginId.split('@')[0]; });
      pluginAgents.push(...agents);
    }
  }
  return { userAgents, projectAgents, pluginAgents };
}

// ─── Scanner I: Commands ─────────────────────────────────────────────────────

function scanCommandDir(dirPath, source) {
  const commands = [];
  for (const entry of listDir(dirPath)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fp = path.join(dirPath, entry.name);
    const content = readTextSafe(fp);
    if (!content) continue;
    const meta = parseFrontmatter(content);
    commands.push({
      name: entry.name.replace(/\.md$/, ''),
      description: meta.description || '',
      argumentHint: meta['argument-hint'] || '',
      path: shortenPath(fp),
      source,
      pluginName: '',
      bodyPreview: truncate(content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim(), 150),
    });
  }
  return commands;
}

function scanCommands() {
  const userCommands = scanCommandDir(PATHS.userCommandsDir, 'user');
  const projectCommands = scanCommandDir(PATHS.projectCommandsDir, 'project');
  const pluginCommands = [];
  const installed = readJsonSafe(PATHS.pluginsInstalled);
  const userSettings = readJsonSafe(PATHS.userSettings);
  const enabledPlugins = userSettings?.enabledPlugins || {};
  if (installed?.plugins) {
    for (const [pluginId, versions] of Object.entries(installed.plugins)) {
      if (!Array.isArray(versions) || versions.length === 0) continue;
      if (enabledPlugins[pluginId] !== true) continue;
      const latest = versions[versions.length - 1];
      if (!latest.installPath) continue;
      const cmds = scanCommandDir(path.join(latest.installPath, 'commands'), 'plugin');
      cmds.forEach(c => { c.pluginName = pluginId.split('@')[0]; });
      pluginCommands.push(...cmds);
    }
  }
  return { userCommands, projectCommands, pluginCommands };
}

// ─── Capability Map Builder ──────────────────────────────────────────────────

function buildCapabilityMap(data) {
  const CAPS = [
    {
      id: 'search-internet', label: '搜索互联网', description: '主动搜索网页获取最新信息', category: 'connect', tier: 'mid', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
      detect: () => {
        const mcp = data.mcpServers.servers.find(s => !s.disabled && /search|serpapi|google|bing/i.test(s.name));
        const perm = data.settings.permissions.allow.some(p => /^WebSearch/.test(p));
        return { enabled: !!mcp || perm, source: mcp ? `${mcp.name} (MCP)` : (perm ? 'WebSearch (内置)' : '') };
      },
    },
    {
      id: 'browser', label: '操作浏览器', description: '自动化网页操作、截图、表单填写', category: 'connect', tier: 'mid', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="7" cy="6" r="0.8" fill="currentColor"/><circle cx="10" cy="6" r="0.8" fill="currentColor"/></svg>',
      detect: () => {
        const mcp = data.mcpServers.servers.find(s => !s.disabled && /playwright|puppeteer|browser|selenium/i.test(s.name));
        if (mcp) return { enabled: true, source: `${mcp.name} (MCP)` };
        const plugin = data.plugins.plugins.find(p => (p.enabled || !p.blocked) && /playwright|puppeteer|browser/i.test(p.name));
        if (plugin) return { enabled: true, source: `${plugin.name} (插件)` };
        const perm = data.settings.permissions.allow.some(p => /playwright|puppeteer|browser/i.test(p));
        if (perm) return { enabled: true, source: '已授权 (权限)' };
        return { enabled: false, source: '' };
      },
    },
    {
      id: 'team-tools', label: '连接团队工具', description: '飞书、Slack、Notion 等协作平台', category: 'connect', tier: 'mid', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      detect: () => {
        const map = { lark: '飞书', feishu: '飞书', slack: 'Slack', notion: 'Notion', linear: 'Linear', jira: 'Jira' };
        const hits = data.mcpServers.servers.filter(s => !s.disabled && Object.keys(map).some(k => s.name.toLowerCase().includes(k)));
        const names = [...new Set(hits.map(s => { for (const [k, v] of Object.entries(map)) { if (s.name.toLowerCase().includes(k)) return v; } return s.name; }))];
        return { enabled: hits.length > 0, source: names.join(' · ') };
      },
    },
    {
      id: 'file-access', label: '读写项目文件', description: '读取和修改项目中的代码文件', category: 'core', tier: 'base', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
      detect: () => {
        const writeAllowed = data.settings.permissions.allow.some(p => /^Write|^Edit/.test(p));
        const noRules = data.settings.permissions.allow.length === 0 && data.settings.permissions.deny.length === 0;
        return { enabled: true, source: writeAllowed ? '已授权自动写入' : (noRules ? '默认逐次确认' : '按规则控制') };
      },
    },
    {
      id: 'terminal', label: '执行终端命令', description: '在终端运行 shell 命令', category: 'core', tier: 'base', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      detect: () => {
        const broad = data.settings.permissions.allow.some(p => /^Bash\(\*\)$|^Bash$/.test(p));
        const any = data.settings.permissions.allow.some(p => /^Bash/.test(p));
        const noRules = data.settings.permissions.allow.length === 0 && data.settings.permissions.deny.length === 0;
        return { enabled: true, source: broad ? '完全开放' : (any ? '按规则授权' : (noRules ? '默认逐次确认' : '按规则控制')), warn: broad };
      },
    },
    {
      id: 'project-rules', label: '遵循项目规范', description: '按照 CLAUDE.md 中的指令行事', category: 'knowledge', tier: 'high', subtitle: '决定 Claude 是通用助手还是懂你的搭档', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      detect: () => {
        const p = data.memory.claudeMd.exists;
        const u = data.memory.userClaudeMd.exists;
        const parts = [];
        if (p) parts.push('项目级 (' + data.memory.claudeMd.size + ')');
        if (u) parts.push('用户级 (' + data.memory.userClaudeMd.size + ')');
        return { enabled: p || u, source: parts.join(' + ') };
      },
    },
    {
      id: 'memory', label: '记住历史决策', description: '跨对话记住你的偏好和项目决策', category: 'knowledge', tier: 'high', subtitle: '让 Claude 越用越顺手的关键', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      detect: () => {
        const n = data.memory.projectMemory.length + data.memory.userProjectMemory.length;
        return { enabled: n > 0, source: n > 0 ? n + ' 个记忆文件' : '' };
      },
    },
    {
      id: 'automation', label: '自动化工作流', description: '在关键操作前后自动执行脚本', category: 'automation', tier: 'base', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
      detect: () => {
        const evtMap = { SessionStart: '会话启动', PreToolUse: '工具调用前', PostToolUse: '工具调用后', SessionEnd: '会话结束', Stop: '停止时' };
        const events = [...new Set(data.hooks.hooks.map(h => evtMap[h.event] || h.event))].slice(0, 2);
        return { enabled: data.hooks.hooks.length > 0, source: events.join(' · ') };
      },
    },
    {
      id: 'auto-commit', label: '自动提交代码', description: '自动执行 git commit 和 push', category: 'automation', tier: 'base', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>',
      detect: () => {
        const ac = data.settings.gitConfig.autoCommit === true;
        const ap = data.settings.gitConfig.autoPush === true;
        return { enabled: ac, source: ac ? (ap ? '自动提交 + 推送' : '仅自动提交') : '未启用', warn: ap };
      },
    },
    {
      id: 'plugins', label: '使用社区插件', description: '来自插件市场的功能扩展', category: 'extend', tier: 'mid', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>',
      detect: () => {
        const ep = data.plugins.plugins.filter(p => p.enabled && !p.blocked);
        return { enabled: ep.length > 0, source: ep.length > 0 ? ep.map(p => p.name).slice(0, 3).join(' · ') : '' };
      },
    },
  ];
  return CAPS.map(cap => {
    const r = cap.detect();
    return { id: cap.id, label: cap.label, description: cap.description, category: cap.category, icon: cap.icon, tier: cap.tier, subtitle: cap.subtitle || '', enabled: r.enabled, source: r.source || '', warn: r.warn || false };
  });
}

// ─── Scanner G: Deep Health Check ────────────────────────────────────────────

function scanHealth(data) {
  const areas = [];
  const findings = [];
  let totalChecks = 0;
  const allSkills = [...data.skills.userSkills, ...data.skills.projectSkills, ...(data.skills.pluginSkills || [])];

  // ── CLAUDE.md 深度分析 ──
  const claudeMdContent = readTextSafe(PATHS.projectClaudeMd);
  const claudeLen = claudeMdContent ? claudeMdContent.length : 0;
  const claudeLevel = !claudeMdContent ? 'warn' : (claudeLen >= 200 ? 'good' : 'tip');
  areas.push({
    area: 'CLAUDE.md', sectionId: 'memory', level: claudeLevel,
    count: claudeMdContent ? 1 : 0, unit: '',
    desc: !claudeMdContent ? 'CLAUDE.md 尚未创建' : claudeLen >= 200 ? '项目指令充实' : 'CLAUDE.md 内容较少',
  });
  totalChecks++;
  if (!claudeMdContent) {
    findings.push({ area: 'CLAUDE.md', level: 'warn', title: '项目指令缺失', text: 'Claude 对项目一无所知，每次对话从零理解代码库', action: '创建 .claude/CLAUDE.md，写入技术栈、编码规范、项目结构', fixCmd: 'mkdir -p .claude && cat > .claude/CLAUDE.md << \'EOF\'\n# 项目指令\n\n## 技术栈\n<!-- 填写语言、框架、构建工具 -->\n\n## 编码规范\n<!-- 填写命名规则、代码风格 -->\n\n## 项目结构\n<!-- 填写目录布局说明 -->\nEOF' });
  } else if (claudeLen < 200) {
    findings.push({ area: 'CLAUDE.md', level: 'tip', title: '项目指令单薄', text: 'CLAUDE.md 仅 ' + claudeLen + ' 字符，难以覆盖关键上下文', action: '建议超过 500 字符，覆盖技术栈、编码风格、文件结构', fixCmd: 'printf \'\\n## 技术栈\\n\\n- 语言: \\n- 框架: \\n\\n## 编码规范\\n\\n- 命名规则: \\n- 代码风格: \\n\\n## 项目结构\\n\\n```\\nsrc/\\n├── \\n└── \\n```\\n\' >> .claude/CLAUDE.md && echo "已追加模板到 CLAUDE.md，请填写具体内容"' });
  } else {
    totalChecks++;
    if (!/react|vue|angular|svelte|next|nuxt|node|express|fastify|python|django|flask|typescript|rust|go|java|spring|kotlin|swift|flutter|tailwind|vite|webpack/i.test(claudeMdContent)) {
      findings.push({ area: 'CLAUDE.md', level: 'tip', title: '未描述技术栈', text: '未检测到技术栈相关描述，Claude 需要自行猜测项目使用的语言和框架', action: '在 CLAUDE.md 中添加技术栈说明（语言、框架、构建工具）', fixCmd: 'printf \'\\n## 技术栈\\n\\n- 语言: \\n- 框架: \\n- 构建工具: \\n\' >> .claude/CLAUDE.md && echo "已追加技术栈模板到 CLAUDE.md，请填写具体内容"' });
    }
    totalChecks++;
    if (!/规范|convention|style|lint|format|prettier|eslint|命名|naming|indent|tab|space|代码风格|coding.?standard/i.test(claudeMdContent)) {
      findings.push({ area: 'CLAUDE.md', level: 'tip', title: '未定义编码规范', text: '没有编码规范约束，Claude 的代码风格可能与项目不一致', action: '添加命名规则、代码风格、lint/format 配置等', fixCmd: 'printf \'\\n## 编码规范\\n\\n- 命名规则: camelCase\\n- 代码风格: \\n- lint/format: \\n\' >> .claude/CLAUDE.md && echo "已追加编码规范模板到 CLAUDE.md，请填写具体内容"' });
    }
    totalChecks++;
    if (!/结构|structure|目录|directory|folder|文件|layout|├|└|src\/|组织|organize/i.test(claudeMdContent)) {
      findings.push({ area: 'CLAUDE.md', level: 'tip', title: '未描述项目结构', text: 'Claude 不了解目录布局，可能在错误的位置创建文件', action: '添加关键目录说明和文件组织规则', fixCmd: 'printf \'\\n## 项目结构\\n\\n```\\nsrc/\\n├── \\n└── \\n```\\n\' >> .claude/CLAUDE.md && echo "已追加项目结构模板到 CLAUDE.md，请填写具体目录"' });
    }
  }

  // ── Skills 深度分析 ──
  const totalSkillCount = allSkills.length;
  const invocableCount = allSkills.filter(s => s.userInvocable).length;
  const fromPluginCount = allSkills.filter(s => s.remoteSource || s.source === 'plugin').length;
  let skillDesc = '还未配置技能';
  if (totalSkillCount > 0) {
    const parts = [];
    if (invocableCount > 0) parts.push(invocableCount + ' 个可调用');
    if (fromPluginCount > 0) parts.push(fromPluginCount + ' 个来自插件');
    skillDesc = parts.length > 0 ? parts.join(' · ') : '已扩展工作流';
  }
  const skillLevel = totalSkillCount === 0 ? 'tip' : (invocableCount === 0 ? 'tip' : 'good');
  areas.push({
    area: 'Skills', sectionId: 'skills', level: skillLevel,
    count: totalSkillCount, unit: '个', desc: skillDesc,
  });
  totalChecks++;
  if (totalSkillCount === 0) {
    findings.push({ area: 'Skills', level: 'tip', title: '未配置自定义工作流', text: '仅使用 Claude 内置能力，未定义针对项目的专属工作流', action: '创建 Skill 定义常用工作流（如 /commit、/review），或从插件市场安装', fixCmd: 'mkdir -p .claude/skills/example && cat > .claude/skills/example/SKILL.md << \'EOF\'\n---\nname: example\ndescription: 示例工作流\nuser-invocable: true\n---\n\n# 示例 Skill\n\n这是一个示例 Skill 模板，请根据实际需求修改。\nEOF\necho "已创建示例 Skill: .claude/skills/example/SKILL.md"' });
  } else {
    totalChecks++;
    if (invocableCount === 0) {
      findings.push({ area: 'Skills', level: 'tip', title: '技能不可手动调用', text: '已有 ' + totalSkillCount + ' 个 Skill 但均未标记为可手动调用', action: '在 SKILL.md frontmatter 中设置 user-invocable: true', fixCmd: 'echo "在每个 SKILL.md 的 frontmatter 中添加:\\nuser-invocable: true\\n\\n例如:\\n---\\nname: my-skill\\nuser-invocable: true\\n---"' });
    }
    totalChecks++;
    const noDescCount = allSkills.filter(s => !s.description || s.description.trim().length === 0).length;
    if (noDescCount > 0) {
      findings.push({ area: 'Skills', level: 'tip', title: noDescCount + ' 个 Skill 缺少描述', text: '缺少描述的 Skill 可能不会被 Claude 自动匹配到正确的任务', action: '为 Skill 添加有意义的 description', fixCmd: 'echo "在每个 SKILL.md 的 frontmatter 中添加 description 字段:\\n---\\nname: my-skill\\ndescription: 这个技能用于...\\n---"' });
    }
  }

  // ── Plugins 深度分析 ──
  const enabledCount = data.plugins.plugins.filter(p => p.enabled).length;
  const blockedCount = data.plugins.plugins.filter(p => p.blocked).length;
  const notEnabledCount = data.plugins.plugins.filter(p => !p.enabled && !p.blocked).length;
  const totalSkillsFromPlugins = data.plugins.plugins.reduce((sum, p) => sum + p.skillCount, 0);
  let pluginDesc = '还未安装';
  if (data.plugins.plugins.length > 0) {
    const parts = [];
    if (blockedCount > 0) parts.push(blockedCount + ' 个已屏蔽');
    else parts.push(enabledCount + ' 个启用');
    if (totalSkillsFromPlugins > 0) parts.push('提供 ' + totalSkillsFromPlugins + ' 个技能');
    pluginDesc = parts.join(' · ');
  }
  const pluginLevel = data.plugins.plugins.length === 0 ? 'tip' : (blockedCount > 0 ? 'tip' : 'good');
  areas.push({
    area: 'Plugins', sectionId: 'plugins', level: pluginLevel,
    count: data.plugins.plugins.length, unit: '个', desc: pluginDesc,
  });
  totalChecks++;
  if (data.plugins.plugins.length === 0) {
    findings.push({ area: 'Plugins', level: 'tip', title: '未安装插件', text: '仅使用内置工具，未利用社区生态', action: '浏览 /plugins 市场发现工具扩展', fixCmd: 'echo "在 Claude Code 中输入:\\n/plugins\\n浏览并安装需要的插件"' });
  } else {
    totalChecks++;
    if (blockedCount > 0) {
      findings.push({ area: 'Plugins', level: 'tip', title: blockedCount + ' 个插件被屏蔽', text: '被屏蔽的插件不会加载，占用磁盘空间', action: '确认是否需要恢复，否则建议卸载', fixCmd: 'echo "在 Claude Code 中输入:\\n/plugins\\n选择被屏蔽的插件，恢复或卸载"' });
    }
    totalChecks++;
    if (notEnabledCount > 0) {
      findings.push({ area: 'Plugins', level: 'tip', title: notEnabledCount + ' 个插件已安装但未启用', text: '插件已下载但未激活，不提供任何能力', action: '启用需要的插件，或卸载不需要的', fixCmd: 'echo "在 Claude Code 中输入:\\n/plugins\\n选择未启用的插件并激活"' });
    }
  }

  // ── MCP 深度分析 ──
  const activeSrv = data.mcpServers.servers.filter(s => !s.disabled);
  const disabledSrv = data.mcpServers.servers.filter(s => s.disabled);
  const mcpCategoryMap = { playwright: '浏览器', browser: '浏览器', puppeteer: '浏览器', search: '搜索', 'web-search': '搜索', context7: '文档', zread: '代码阅读', zai: '视觉', 'web-reader': '网页读取', github: 'GitHub', slack: 'Slack', notion: 'Notion', postgres: '数据库', supabase: '数据库', redis: '缓存', filesystem: '文件系统', lark: '飞书', feishu: '飞书', docker: 'Docker', kubernetes: 'K8s', figma: 'Figma', linear: 'Linear', jira: 'Jira', sentry: 'Sentry', stripe: 'Stripe' };
  let mcpDesc = '未连接外部工具';
  if (data.mcpServers.servers.length > 0) {
    const categories = activeSrv.map(s => {
      const n = s.name.toLowerCase();
      for (const [key, label] of Object.entries(mcpCategoryMap)) { if (n.includes(key)) return label; }
      return s.name;
    });
    const unique = [...new Set(categories)].slice(0, 3);
    mcpDesc = unique.join(' · ');
    if (disabledSrv.length > 0) mcpDesc += ' · ' + disabledSrv.length + ' 个禁用';
  }
  const mcpLevel = data.mcpServers.servers.length === 0 ? 'tip' : (disabledSrv.length > 0 ? 'tip' : 'good');
  areas.push({
    area: 'MCP', sectionId: 'mcp-servers', level: mcpLevel,
    count: data.mcpServers.servers.length, unit: '个', desc: mcpDesc,
  });
  totalChecks++;
  if (data.mcpServers.servers.length === 0) {
    findings.push({ area: 'MCP', level: 'tip', title: '未连接外部工具', text: 'Claude 无法操作浏览器、搜索引擎、数据库等外部系统', action: '在 settings.json 的 mcpServers 中添加所需工具', fixCmd: 'echo "在 Claude Code 中输入:\\n/install-mcp\\n或手动编辑 .claude/settings.json 的 mcpServers 字段"' });
  } else {
    totalChecks++;
    if (disabledSrv.length > 0) {
      findings.push({ area: 'MCP', level: 'tip', title: disabledSrv.length + ' 个 Server 已禁用', text: '禁用的 Server 仍占配置空间，不提供能力', action: '重新启用或移除', fixCmd: 'echo "编辑 .claude/settings.json，在 mcpServers 中找到 disabled: true 的条目，删除该字段或移除整个 server 配置"' });
    }
    const allMcpNames = activeSrv.map(s => s.name.toLowerCase()).join(' ');
    const allPluginNames = data.plugins.plugins.filter(p => p.enabled || !p.blocked).map(p => p.name.toLowerCase()).join(' ');
    const allNames = allMcpNames + ' ' + allPluginNames;
    totalChecks++;
    if (!/playwright|puppeteer|browser|selenium/.test(allNames)) {
      findings.push({ area: 'MCP', level: 'tip', title: '缺少浏览器自动化', text: '无法自动操作网页、截图、端到端测试', action: '添加 Playwright 或 Puppeteer MCP Server', fixCmd: 'npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-playwright' });
    }
    totalChecks++;
    if (!/search|web-search|serpapi|google/.test(allNames)) {
      findings.push({ area: 'MCP', level: 'tip', title: '缺少外部搜索能力', text: 'Claude 无法主动搜索互联网获取最新信息', action: '添加 web-search 类 MCP Server', fixCmd: 'echo "推荐方案（选一个执行）:\\n\\n1. Brave Search:\\nclaude mcp add web-search -- npx @anthropic-ai/mcp-web-search\\n\\n2. 或在 .claude/settings.json 的 mcpServers 中手动添加搜索服务配置"' });
    }
  }

  // ── Hooks 深度分析 ──
  const hookEventMap = { SessionStart: '会话启动', SessionStop: '会话结束', SessionEnd: '会话结束', PreToolUse: '工具调用前', PostToolUse: '工具调用后', Notification: '通知', Stop: '停止时', SubagentStop: '子任务结束', PrePromptSubmit: '提交前' };
  let hookDesc = '未配置自动化流程';
  if (data.hooks.hooks.length > 0) {
    const events = [...new Set(data.hooks.hooks.map(h => hookEventMap[h.event] || h.event))];
    hookDesc = events.slice(0, 3).join(' · ');
  }
  const hasPreToolUse = data.hooks.hooks.some(h => h.event === 'PreToolUse');
  const hasSessionStart = data.hooks.hooks.some(h => h.event === 'SessionStart');
  const hookLevel = data.hooks.hooks.length === 0 ? 'tip' : 'good';
  areas.push({
    area: 'Hooks', sectionId: 'hooks', level: hookLevel,
    count: data.hooks.hooks.length, unit: '个', desc: hookDesc,
  });
  totalChecks++;
  if (data.hooks.hooks.length === 0) {
    findings.push({ area: 'Hooks', level: 'tip', title: '未配置自动化', text: '所有操作需手动触发，无法在关键时刻自动执行任务', action: '添加 SessionStart 等事件 Hook 自动加载上下文', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=d.existsSync(f)?JSON.parse(d.readFileSync(f,'utf8')):{};j.hooks=j.hooks||{};j.hooks.SessionStart=[{command:'echo 项目: $(basename $(pwd))',timeout:5000}];d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加 SessionStart Hook')"` });
  } else {
    totalChecks++;
    if (!hasPreToolUse) {
      findings.push({ area: 'Hooks', level: 'tip', title: '缺少工具调用门控', text: '工具调用前无自动校验，无法拦截误操作', action: '添加 PreToolUse Hook 进行安全校验', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=d.existsSync(f)?JSON.parse(d.readFileSync(f,'utf8')):{};j.hooks=j.hooks||{};j.hooks.PreToolUse=j.hooks.PreToolUse||[];j.hooks.PreToolUse.push({matcher:'Bash',command:'echo \\\"检查命令: \\$TOOL_INPUT\\\"',timeout:5000});d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加 PreToolUse Hook')"` });
    }
    totalChecks++;
    if (!hasSessionStart) {
      findings.push({ area: 'Hooks', level: 'tip', title: '缺少会话初始化', text: '每次对话无法自动加载项目上下文或运行检查', action: '添加 SessionStart Hook 初始化工作环境', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=d.existsSync(f)?JSON.parse(d.readFileSync(f,'utf8')):{};j.hooks=j.hooks||{};j.hooks.SessionStart=j.hooks.SessionStart||[];j.hooks.SessionStart.push({command:'echo \\\"项目: \\$(basename \\$(pwd))\\\"',timeout:5000});d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加 SessionStart Hook')"` });
    }
  }

  // ── Memory 深度分析 ──
  const totalMem = data.memory.projectMemory.length + data.memory.userProjectMemory.length;
  let memDesc = '尚未建立跨会话记忆';
  if (totalMem > 0) {
    const topicNames = [...data.memory.projectMemory, ...data.memory.userProjectMemory]
      .map(m => m.filename.replace(/\.\w+$/, '').replace(/[-_]/g, ' '))
      .slice(0, 3);
    memDesc = topicNames.join(' · ');
  }
  const memLevel = totalMem === 0 ? 'tip' : 'good';
  areas.push({
    area: 'Memory', sectionId: 'memory', level: memLevel,
    count: totalMem, unit: '个', desc: memDesc,
  });
  totalChecks++;
  if (totalMem === 0) {
    findings.push({ area: 'Memory', level: 'tip', title: '无跨会话记忆', text: 'Claude 每次对话忘记之前的决策和偏好', action: '在对话中让 Claude 记住关键决策，或手动在 memory/ 目录创建文件', fixCmd: 'mkdir -p .claude/memory && echo "# 决策记录" > .claude/memory/MEMORY.md && echo "已创建 .claude/memory/MEMORY.md"' });
  } else {
    totalChecks++;
    const projMemPath = path.join(PATHS.projectClaudeDir, 'memory', 'MEMORY.md');
    const encodedCwd = '-' + CWD.slice(1).replace(/\//g, '-');
    const userProjMemPath = path.join(PATHS.projectsDir, encodedCwd, 'memory', 'MEMORY.md');
    const memMdContent = readTextSafe(projMemPath) || readTextSafe(userProjMemPath);
    if (memMdContent) {
      const lineCount = memMdContent.split('\n').length;
      if (lineCount > 200) {
        findings.push({ area: 'Memory', level: 'tip', title: '主记忆文件过长', text: 'MEMORY.md 有 ' + lineCount + ' 行，超出 200 行的部分会被截断，Claude 看不到', action: '精简 MEMORY.md 到 200 行以内，将详细内容拆分到专题文件', fixCmd: 'echo "操作步骤:\\n1. 打开 MEMORY.md\\n2. 将详细内容拆分到同目录下的专题文件（如 debugging.md、patterns.md）\\n3. 在 MEMORY.md 中用链接引用：[详见](debugging.md)\\n4. 保持 MEMORY.md 在 200 行以内"' });
      }
    }
  }

  // ── Permissions 深度分析 ──
  const allowCount = data.settings.permissions.allow.length;
  const denyCount = data.settings.permissions.deny.length;
  const totalRules = allowCount + denyCount;
  const hasBroadBash = data.settings.permissions.allow.some(p => /^Bash\(\*\)$|^Bash$/.test(p));
  const hasBroadEdit = data.settings.permissions.allow.some(p => /^Edit\(\*\)$|^Edit$/.test(p));
  const hasBroadWrite = data.settings.permissions.allow.some(p => /^Write\(\*\)$|^Write$/.test(p));
  const permLevel = (hasBroadBash || hasBroadEdit || hasBroadWrite) ? 'warn' : (totalRules === 0 ? 'tip' : (denyCount > 0 ? 'good' : 'tip'));
  areas.push({
    area: 'Permissions', sectionId: 'settings', level: permLevel,
    count: totalRules, unit: '条',
    desc: totalRules === 0 ? '默认模式，逐次确认' : (hasBroadBash ? '终端权限较宽' : allowCount + ' 允许 / ' + denyCount + ' 禁止'),
  });
  totalChecks++;
  if (hasBroadBash) {
    findings.push({ area: 'Permissions', level: 'warn', title: '终端权限完全开放', text: 'Claude 可不经确认执行任意 shell 命令，包括删除文件、安装软件等', action: '替换为具体模式：Bash(git *)、Bash(npm *) 等', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=JSON.parse(d.readFileSync(f,'utf8'));const a=j.permissions?.allow||[];j.permissions=j.permissions||{};j.permissions.allow=a.filter(r=>!/^Bash(\\(\\*\\))?$/.test(r)).concat(['Bash(git *)','Bash(npm *)','Bash(node *)','Bash(ls *)','Bash(cat *)']);j.permissions.deny=[...(j.permissions.deny||[]),'Bash(rm -rf *)','Bash(git push --force*)'];d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已替换为安全权限规则')"` });
  }
  totalChecks++;
  if (hasBroadEdit || hasBroadWrite) {
    findings.push({ area: 'Permissions', level: 'warn', title: '文件写入权限过宽', text: 'Claude 可不经确认修改任意文件，包括配置文件和敏感数据', action: '限制为特定目录或文件模式', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=JSON.parse(d.readFileSync(f,'utf8'));const a=j.permissions?.allow||[];j.permissions=j.permissions||{};j.permissions.allow=a.filter(r=>!/^(Edit|Write)(\\(\\*\\))?$/.test(r)).concat(['Edit(src/**)','Write(src/**)']);d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已限制文件写入权限到 src/ 目录')"` });
  }
  totalChecks++;
  if (totalRules === 0) {
    findings.push({ area: 'Permissions', level: 'tip', title: '默认权限模式', text: '每次工具调用都需要手动确认，工作效率较低', action: '添加 allow 规则加速常用操作，deny 规则屏蔽危险命令', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=d.existsSync(f)?JSON.parse(d.readFileSync(f,'utf8')):{};j.permissions={allow:['Bash(git *)','Bash(npm *)','Bash(node *)','Bash(ls *)','Read','Glob','Grep'],deny:['Bash(rm -rf *)','Bash(git push --force*)','Bash(git reset --hard*)']};d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加推荐权限规则')"` });
  } else if (allowCount > 0 && denyCount === 0) {
    findings.push({ area: 'Permissions', level: 'tip', title: '缺少禁止规则', text: '只有允许列表没有禁止列表，缺少对危险操作的兜底拦截', action: '添加 deny 规则：rm -rf、git push --force、git reset --hard 等', fixCmd: `node -e "const f='.claude/settings.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.permissions=j.permissions||{};j.permissions.deny=[...(j.permissions.deny||[]),'Bash(rm -rf *)','Bash(git push --force*)','Bash(git reset --hard*)'];require('fs').writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加 deny 规则')"` });
  }

  // ── Agents 深度分析 ──
  const allAgents = [...(data.agents?.userAgents || []), ...(data.agents?.projectAgents || []), ...(data.agents?.pluginAgents || [])];
  let agentDesc = '未配置专家角色';
  if (allAgents.length > 0) {
    agentDesc = allAgents.map(a => a.name).slice(0, 3).join(' · ');
  }
  areas.push({ area: 'Agents', sectionId: 'agents', level: allAgents.length === 0 ? 'tip' : 'good', count: allAgents.length, unit: '个', desc: agentDesc });
  totalChecks++;
  if (allAgents.length === 0) {
    findings.push({ area: 'Agents', level: 'tip', title: '未配置专家角色', text: '没有专门化的 Agent，所有任务由默认 Claude 处理', action: '创建 .claude/agents/ 目录定义专家 Agent，或安装含 Agent 的插件', fixCmd: 'mkdir -p .claude/agents && echo "已创建 .claude/agents/ 目录，可在其中添加 .md Agent 定义文件"' });
  }

  // ── Commands 深度分析 ──
  const allCommands = [...(data.commands?.userCommands || []), ...(data.commands?.projectCommands || []), ...(data.commands?.pluginCommands || [])];
  let cmdDesc = '未配置快捷指令';
  if (allCommands.length > 0) {
    cmdDesc = allCommands.map(c => '/' + c.name).slice(0, 3).join(' · ');
  }
  areas.push({ area: 'Commands', sectionId: 'commands', level: allCommands.length === 0 ? 'tip' : 'good', count: allCommands.length, unit: '个', desc: cmdDesc });
  totalChecks++;
  if (allCommands.length === 0) {
    findings.push({ area: 'Commands', level: 'tip', title: '未配置快捷指令', text: '每次都需要用自然语言描述意图，无法一键触发常用操作', action: '创建 .claude/commands/ 目录定义 /command-name 快捷指令', fixCmd: 'mkdir -p .claude/commands && echo "已创建 .claude/commands/ 目录，可在其中添加 .md 指令文件"' });
  }

  // ── 用户级 CLAUDE.md ──
  totalChecks++;
  const userClaudeMdContent = readTextSafe(PATHS.userClaudeMd);
  if (!userClaudeMdContent && claudeMdContent) {
    findings.push({ area: 'CLAUDE.md', level: 'tip', title: '无用户级全局指令', text: '项目有 CLAUDE.md 但缺少用户级全局指令，跨项目的通用偏好需要每个项目重复配置', action: '创建 ~/.claude/CLAUDE.md 写入通用偏好（语言、提交风格、沟通方式）', fixCmd: 'cat > ~/.claude/CLAUDE.md << \'EOF\'\n# 全局指令\n\n- 中文沟通\n- 提交信息用英文\n- 不自动 push\nEOF' });
  }

  // ── 跨维度洞察 ──
  if (hasBroadBash) {
    totalChecks++;
    if (!hasPreToolUse) {
      findings.push({ area: '跨维度', level: 'warn', title: '命令执行无安全防护', text: '终端完全开放且无 Hook 拦截，恶意或错误命令可直接执行', action: '至少添加 PreToolUse Hook 检查危险命令模式', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=d.existsSync(f)?JSON.parse(d.readFileSync(f,'utf8')):{};j.hooks=j.hooks||{};j.hooks.PreToolUse=j.hooks.PreToolUse||[];j.hooks.PreToolUse.push({matcher:'Bash',command:'echo \\\"安全检查: \\$TOOL_INPUT\\\"',timeout:5000});d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加安全防护 Hook')"` });
    }
  }
  if (claudeMdContent) {
    totalChecks++;
    if (totalMem === 0) {
      findings.push({ area: '跨维度', level: 'tip', title: '知识无法积累', text: '项目有静态指令但无动态记忆，Claude 的经验无法跨会话传承', action: '让 Claude 在对话中记住关键决策和偏好', fixCmd: 'mkdir -p .claude/memory && echo "# 决策记录\\n\\n## 关键决策\\n- \\n\\n## 偏好\\n- " > .claude/memory/MEMORY.md && echo "已创建 .claude/memory/MEMORY.md"' });
    }
  }
  if (activeSrv.length >= 3) {
    totalChecks++;
    if (denyCount === 0) {
      findings.push({ area: '跨维度', level: 'tip', title: '工具多但缺少约束', text: '连接了多个外部工具但权限无限制，操作半径较大', action: '添加 deny 规则限制危险操作', fixCmd: `node -e "const f='.claude/settings.json',d=require('fs'),j=JSON.parse(d.readFileSync(f,'utf8'));j.permissions=j.permissions||{};j.permissions.deny=[...(j.permissions.deny||[]),'Bash(rm -rf *)','Bash(git push --force*)','Bash(git reset --hard*)'];d.writeFileSync(f,JSON.stringify(j,null,2));console.log('已添加 deny 规则')"` });
    }
  }

  // ── 分数与等级 ──
  const warnCount = findings.filter(f => f.level === 'warn').length;
  const tipCount = findings.filter(f => f.level === 'tip').length;
  const score = Math.max(0, 100 - warnCount * 12 - tipCount * 4);
  const passedChecks = totalChecks - findings.length;

  let grade;
  if (score >= 90) grade = 'A+';
  else if (score >= 80) grade = 'A';
  else if (score >= 70) grade = 'B+';
  else if (score >= 60) grade = 'B';
  else if (score >= 40) grade = 'C';
  else grade = 'D';

  return { areas, findings, score, grade, totalChecks, passedChecks };
}

// ─── HTML Template Generator ─────────────────────────────────────────────────

function generateHTML(data) {
  const { skills, plugins, mcpServers, hooks, memory, settings, health, capabilityMap, agents, commands } = data;
  const { areas: healthAreas, findings, score: healthScore, grade: healthGrade, totalChecks, passedChecks } = health;
  const allSkills = [...skills.projectSkills, ...skills.userSkills, ...(skills.pluginSkills || [])];
  const allAgents = [...(agents.pluginAgents || []), ...(agents.projectAgents || []), ...(agents.userAgents || [])];
  const allCommands = [...(commands.pluginCommands || []), ...(commands.projectCommands || []), ...(commands.userCommands || [])];
  const enabledCaps = capabilityMap.filter(c => c.enabled).length;

  const NAV_ITEMS = [
    { id: 'overview', label: '全景' },
    { id: 'capabilities', label: '能力' },
    { id: 'health', label: '体检' },
    { id: 'skills', label: 'Skills' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'mcp-servers', label: 'MCP' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'agents', label: 'Agents' },
    { id: 'commands', label: 'Commands' },
    { id: 'memory', label: '\u8bb0\u5fc6' },
    { id: 'settings', label: '\u8bbe\u7f6e' },
  ];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Code Inspector</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #f4f3ee;
  --bg-warm: #ebe9e2;
  --card: rgba(255,255,255,0.5);
  --card-hover: rgba(255,255,255,0.7);
  --card-solid: #faf9f5;
  --glass-border: rgba(255,255,255,0.6);
  --border: rgba(0,0,0,0.06);
  --border-section: rgba(0,0,0,0.08);
  --text-1: #1a1915;
  --text-2: #4a4740;
  --text-3: #85817a;
  --text-4: #b0aea5;
  --code-bg: rgba(0,0,0,0.035);
  --accent: #d97757;
  --accent-light: rgba(217,119,87,0.10);
  --green: #788c5d;
  --green-text: #516b38;
  --green-light: rgba(120,140,93,0.12);
  --green-glass: rgba(120,140,93,0.06);
  --red: #c15f3c;
  --red-text: #943f22;
  --red-light: rgba(193,95,60,0.10);
  --amber: #c4a46e;
  --amber-text: #7a5d22;
  --amber-light: rgba(196,164,110,0.10);
  --amber-glass: rgba(196,164,110,0.06);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-glass: 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.5);
  --radius: 12px;
  --transition: all 0.2s ease;
  --blur: blur(16px);
}

html { scroll-behavior: smooth; }

body {
  font-family: 'Söhne', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text-1);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  position: relative;
}

::selection { background: rgba(204, 120, 92, 0.3); }

/* Subtle grain texture */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 9999;
}

/* Warm gradient accent */
body::before {
  content: '';
  position: fixed;
  top: -40%;
  right: -20%;
  width: 60%;
  height: 80%;
  background: radial-gradient(ellipse, rgba(196,164,110,0.07) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 64px 32px 96px;
  position: relative;
  z-index: 1;
}

/* ── Frosted Glass Mixin ── */
.glass {
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-glass);
}

/* ── Floating Nav ── */
.float-nav {
  position: fixed;
  right: max(16px, calc((100vw - 1080px) / 2 - 80px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 50;
  padding: 6px;
  background: rgba(255,255,255,0.35);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  box-shadow: var(--shadow-glass);
}

.float-nav a {
  display: block;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-4);
  text-decoration: none;
  border-radius: 6px;
  transition: var(--transition);
  text-align: right;
  letter-spacing: 0;
}

.float-nav a:hover {
  color: var(--text-2);
  background: rgba(255,255,255,0.4);
}

.float-nav a.active {
  color: var(--text-1);
  background: rgba(255,255,255,0.7);
  font-weight: 500;
}

/* ── Hero ── */
.hero {
  text-align: center;
  padding: 48px 40px 36px;
  margin-bottom: 48px;
  border-radius: 16px;
}

.hero-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 6px;
}
.hero-logo {
  width: 28px;
  height: 28px;
  color: #D97757;
}
.hero-title {
  font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: 19px;
  font-weight: 500;
  color: var(--text-1);
  letter-spacing: -0.01em;
}

.hero-meta {
  font-size: 13px;
  color: var(--text-4);
  margin-bottom: 36px;
}

.hero-score-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.hero-count {
  font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: 84px;
  font-weight: 600;
  letter-spacing: -0.04em;
  color: var(--text-1);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.hero-count-unit {
  font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: 16px;
  font-weight: 400;
  color: var(--text-3);
}

.hero-count-label {
  font-size: 14px;
  font-weight: 400;
  margin-top: 10px;
  letter-spacing: 0.01em;
}

/* Composition bar — tall segmented strip */
.hero-comp {
  display: flex;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  margin-top: 32px;
  gap: 2px;
}
.hero-comp-seg {
  height: 100%;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: flex 0.3s;
  cursor: default;
  position: relative;
}
.hero-comp-seg span {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  letter-spacing: 0.01em;
}
.hero-comp-legend {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 12px;
}
.hero-comp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-2);
  font-weight: 400;
}
.hero-comp-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

/* ── Overview Tiles ── */
.overview {
  margin-bottom: 56px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.overview-tile {
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 22px 24px;
  cursor: pointer;
  transition: var(--transition);
  text-decoration: none;
  color: inherit;
  display: block;
  border-left: 3px solid transparent;
}

.overview-tile:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  background: var(--card-hover);
}

.overview-tile.good {
  border-left-color: var(--green);
  background: linear-gradient(135deg, rgba(125,154,121,0.04) 0%, var(--card) 50%);
}

.overview-tile.tip {
  border-left-color: var(--amber);
  background: linear-gradient(135deg, rgba(196,164,110,0.05) 0%, var(--card) 50%);
}

.overview-tile.warn {
  border-left-color: var(--red);
  background: linear-gradient(135deg, rgba(184,120,120,0.05) 0%, var(--card) 50%);
}

.overview-tile.good:hover { background: linear-gradient(135deg, rgba(125,154,121,0.08) 0%, var(--card-hover) 50%); }
.overview-tile.tip:hover { background: linear-gradient(135deg, rgba(196,164,110,0.09) 0%, var(--card-hover) 50%); }
.overview-tile.warn:hover { background: linear-gradient(135deg, rgba(184,120,120,0.08) 0%, var(--card-hover) 50%); }

.tile-count {
  font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: 32px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: var(--text-1);
  line-height: 1.1;
  margin-bottom: 10px;
}

.tile-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-4);
  margin-left: 2px;
}

.tile-area {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 2px;
}

.tile-desc {
  font-size: 12px;
  color: var(--text-4);
}

/* ── Sections ── */
.section {
  margin-bottom: 64px;
}

.section-header {
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-section);
}

.section-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
  letter-spacing: -0.015em;
}

.section-desc {
  font-size: 13px;
  color: var(--text-4);
  margin-top: 4px;
}

.section-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  margin-bottom: 12px;
  margin-top: 24px;
}

.section-subtitle:first-child { margin-top: 0; }

/* ── Cards ── */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.card {
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 20px 24px;
  transition: var(--transition);
  box-shadow: var(--shadow-sm);
}

.card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  background: var(--card-hover);
  border-color: rgba(255,255,255,0.7);
}

.card-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.card-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
}

.card-version {
  font-size: 11px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}

.card-desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
  margin-bottom: 12px;
}

.card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(0,0,0,0.04);
  font-size: 12px;
  color: var(--text-4);
}

.card-meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Status & Badge ── */
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.green { background: #5e8c59; box-shadow: 0 0 6px rgba(94,140,89,0.5); }
.status-dot.red { background: #b06060; box-shadow: 0 0 6px rgba(176,96,96,0.5); }
.status-dot.amber { background: #b89540; box-shadow: 0 0 6px rgba(184,149,64,0.5); }

.badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.badge-scope { background: rgba(0,0,0,0.05); color: var(--text-3); }
.badge-invocable { background: rgba(94,140,89,0.14); color: #4a7a45; }

/* ── Code Block ── */
.code-block {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 10px 14px;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
  overflow-x: auto;
  font-variant-ligatures: none;
  margin-top: 8px;
  word-break: break-all;
}

/* ── Path ── */
.path {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-4);
  cursor: pointer;
  transition: color 0.15s ease;
}

.path:hover { color: var(--text-2); }

/* ── Hooks Table ── */
.hooks-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  overflow: hidden;
}

.hooks-table th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-4);
  text-align: left;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-section);
  background: rgba(0,0,0,0.015);
}

.hooks-table td {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-2);
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.hooks-table td:first-child { font-weight: 500; color: var(--text-1); }
.hooks-table tr:last-child td { border-bottom: none; }

/* ── Memory ── */
.memory-item {
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  margin-bottom: 6px;
  overflow: hidden;
  transition: var(--transition);
}

.memory-item:hover { background: var(--card-hover); border-color: rgba(255,255,255,0.7); }

.memory-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  cursor: pointer;
  user-select: none;
}

.memory-name { font-size: 14px; font-weight: 500; color: var(--text-1); }
.memory-size { font-size: 12px; color: var(--text-4); font-variant-numeric: tabular-nums; }

.memory-preview { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.memory-preview.open { max-height: 400px; }

.memory-preview-content {
  padding: 12px 20px 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
  white-space: pre-wrap;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  border-top: 1px solid rgba(0,0,0,0.04);
  margin: 0 20px 16px;
}

.memory-toggle {
  font-size: 12px;
  color: var(--text-4);
  transition: transform 0.2s ease;
}

.memory-toggle.open { transform: rotate(90deg); }

/* ── Settings ── */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.settings-panel {
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 20px 24px;
}

.settings-panel-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 12px;
}

.settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}

.settings-row:last-child { border-bottom: none; }
.settings-key { color: var(--text-2); font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 12px; }
.settings-value { color: var(--text-3); font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace; font-size: 12px; }

.permission-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }

.permission-pill {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.permission-pill.allow { background: var(--green-light); color: var(--green-text); }
.permission-pill.deny { background: var(--red-light); color: var(--red-text); }

.empty { text-align: center; padding: 32px; font-size: 13px; color: var(--text-4); }

/* ── Capability Map ── */
.capability-map { margin-bottom: 56px; }

/* ── Tier: High — 2-col span cards with subtitle ── */
.cap-tier-high {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.cap-card-high {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px;
  background: var(--card-solid);
  border: 1px solid rgba(0,0,0,0.04);
  border-radius: 12px;
  transition: var(--transition);
  cursor: default;
}
.cap-card-high:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.cap-card-high .cap-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cap-card-high .cap-icon svg { width: 20px; height: 20px; }

.cap-card-high .cap-body { flex: 1; min-width: 0; }
.cap-card-high .cap-label { font-size: 14px; font-weight: 500; color: var(--text-1); margin-bottom: 2px; }
.cap-card-high .cap-subtitle { font-size: 12px; color: var(--text-3); line-height: 1.4; margin-bottom: 6px; }
.cap-card-high .cap-source { font-size: 11px; color: var(--text-4); }

/* ── Tier: Mid — standard grid cards ── */
.cap-tier-mid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}

.cap-card-mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 10px 14px;
  background: var(--card-solid);
  border: 1px solid rgba(0,0,0,0.04);
  border-radius: 12px;
  transition: var(--transition);
  cursor: default;
}
.cap-card-mid:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.cap-card-mid .cap-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.cap-card-mid .cap-icon svg { width: 18px; height: 18px; }
.cap-card-mid .cap-label { font-size: 12px; font-weight: 500; color: var(--text-1); line-height: 1.3; }
.cap-card-mid .cap-source { font-size: 10px; color: var(--text-3); margin-top: 4px; line-height: 1.3; }

/* ── Tier: Base — compact 4-col mini grid ── */
.cap-tier-base {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.cap-card-base {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--card-solid);
  border: 1px solid rgba(0,0,0,0.04);
  border-radius: 10px;
  cursor: default;
  transition: var(--transition);
}
.cap-card-base:hover { box-shadow: 0 1px 4px rgba(0,0,0,0.05); }

.cap-card-base .cap-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cap-card-base .cap-icon svg { width: 14px; height: 14px; }
.cap-card-base .cap-label { font-size: 12px; font-weight: 400; color: var(--text-2); }

/* ── Shared status — icon is the only color signal ── */
.cap-status-enabled .cap-icon { background: rgba(120,140,93,0.12); color: var(--green-text); }
.cap-status-warn .cap-icon { background: rgba(196,164,110,0.14); color: var(--amber-text); }
.cap-status-disabled .cap-icon { background: var(--code-bg); color: var(--text-4); }
.cap-status-disabled { opacity: 0.5; }
.cap-status-disabled .cap-label { color: var(--text-4); }
.cap-status-disabled .cap-source,
.cap-status-disabled .cap-subtitle { color: var(--text-4); }

/* ── Health Score ── */
.health-score-card {
  text-align: center;
  padding: 32px 24px 28px;
  margin-bottom: 16px;
  border-radius: var(--radius);
}

.health-score-number {
  font-family: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: 64px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}

.health-score-grade {
  font-size: 20px;
  font-weight: 500;
  margin-top: 4px;
  letter-spacing: 0.02em;
}

.health-score-summary {
  font-size: 13px;
  color: var(--text-3);
  margin-top: 12px;
}

/* ── Health Findings ── */
.health-severity-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
}
.health-severity-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
}
.health-severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-severity-dot.warn { background: var(--red); }
.health-severity-dot.tip { background: var(--amber); }
.health-severity-dot.good { background: var(--green); }

.health-findings-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.health-row {
  border-radius: var(--radius);
  border: 1px solid var(--glass-border);
  background: var(--card);
  overflow: hidden;
}

.health-row summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: background 0.15s;
}
.health-row summary::-webkit-details-marker { display: none; }
.health-row summary::marker { display: none; content: ''; }
.health-row summary:hover { background: var(--card-hover); }

.health-row-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  color: #fff;
}
.health-row-icon.warn { background: var(--red-text); }
.health-row-icon.tip { background: var(--amber-text); }

.health-row-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
}

.health-row-area {
  font-size: 11px;
  color: var(--text-4);
  flex-shrink: 0;
}

.health-row-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-4);
  flex-shrink: 0;
  transition: transform 0.2s;
}
.health-row[open] .health-row-chevron { transform: rotate(90deg); }

.health-row-detail {
  padding: 0 16px 12px 46px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}
.health-row-detail .health-action-tag {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.03);
  font-size: 11px;
  color: var(--text-2);
}
.health-fix-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  margin-left: 8px;
  padding: 4px 12px;
  border: 1px solid rgba(217,119,87,0.3);
  border-radius: 6px;
  background: rgba(217,119,87,0.06);
  color: var(--accent);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.health-fix-btn:hover {
  background: rgba(217,119,87,0.12);
  border-color: rgba(217,119,87,0.5);
}
.health-fix-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
.health-fix-hint {
  font-size: 12px;
  color: var(--text-4);
  margin: 12px 0 4px;
  padding-left: 2px;
}

.health-good-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-3);
}
.health-good-summary .health-severity-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }

/* ── Collapsible Sections ── */
.section-collapse {
  margin-bottom: 12px;
  border-radius: var(--radius);
  background: var(--card);
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border);
  overflow: hidden;
}

.section-collapse > summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: background 0.15s;
}
.section-collapse > summary::-webkit-details-marker { display: none; }
.section-collapse > summary::marker { display: none; content: ''; }
.section-collapse > summary:hover { background: var(--card-hover); }

.section-collapse-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
}

.section-collapse-desc {
  flex: 1;
  font-size: 13px;
  color: var(--text-4);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-collapse-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  padding: 2px 10px;
  border-radius: 10px;
  background: var(--code-bg);
  flex-shrink: 0;
}

.section-collapse-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-4);
  flex-shrink: 0;
  transition: transform 0.2s;
}
.section-collapse[open] .section-collapse-chevron { transform: rotate(90deg); }

.section-collapse-body {
  padding: 0 20px 20px;
}

.section-collapse-body .section-desc {
  font-size: 12px;
  color: var(--text-4);
  margin-bottom: 16px;
}

.section-collapse-body .cards { margin-top: 0; }
.section-collapse-body .section-subtitle { margin-top: 8px; }
.section-collapse-body .section-subtitle:first-child { margin-top: 0; }

/* ── Footer ── */
.footer {
  margin-top: 64px;
  padding-top: 24px;
  border-top: 1px solid var(--border-section);
  font-size: 12px;
  color: var(--text-4);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--text-1);
  color: var(--bg);
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 8px;
  opacity: 0;
  transition: all 0.25s ease;
  pointer-events: none;
  z-index: 100;
  -webkit-backdrop-filter: var(--blur);
  backdrop-filter: var(--blur);
}

.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-width: 1280px) {
  .float-nav { display: none; }
}

@media (max-width: 960px) {
  .overview-grid { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 720px) {
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 720px) {
  .cap-tier-high { grid-template-columns: 1fr; }
  .cap-tier-mid { grid-template-columns: repeat(2, 1fr); }
  .cap-tier-base { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .cap-tier-mid { grid-template-columns: 1fr; }
  .cap-tier-base { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .container { padding: 32px 20px 64px; }
  .hero { padding: 32px 24px 28px; }
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
  .cards { grid-template-columns: 1fr; }
  .settings-grid { grid-template-columns: 1fr; }
  .footer { flex-direction: column; gap: 8px; }
}
</style>
</head>
<body>

<!-- Floating Nav -->
<nav class="float-nav" id="floatNav">
  ${NAV_ITEMS.map(n => `<a href="#${n.id}" data-section="${n.id}">${n.label}</a>`).join('\n  ')}
</nav>

<div class="container">

  <!-- Hero -->
  <div class="hero glass">
    <div class="hero-brand">
      <svg class="hero-logo" viewBox="0 0 16 16" fill="#D97757">
        <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
      </svg>
      <div class="hero-title">Claude Code Inspector</div>
    </div>
    <div class="hero-meta">
      ${escapeHtml(shortenPath(CWD))} &middot; ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
    </div>
    <div class="hero-score-row">
      <div class="hero-count">${healthScore}</div>
      <div class="hero-count-unit">/ 100</div>
    </div>
    <div class="hero-count-label" style="color:${healthScore >= 80 ? 'var(--green-text)' : healthScore >= 60 ? 'var(--amber-text)' : 'var(--red-text)'}">${healthGrade} &middot; ${enabledCaps} 项能力已启用</div>
    ${(() => {
      const AREA_COLORS = ['#9b7c5a','#788c5d','#c4864a','#6a9bcc','#b0956a','#c15f3c','#8a9e6e','#9688a8','#5d8fa8'];
      const total = healthAreas.reduce((s, h) => s + Math.max(h.count, 1), 0);
      let bar = '<div class="hero-comp">';
      let legend = '<div class="hero-comp-legend">';
      healthAreas.forEach((h, i) => {
        const c = AREA_COLORS[i % AREA_COLORS.length];
        const w = Math.max(h.count, 1) / total * 100;
        const label = w > 8 ? `<span>${escapeHtml(h.area)} ${h.count}</span>` : '';
        bar += `<div class="hero-comp-seg" style="flex:${w};background:${c}" title="${escapeHtml(h.area)}: ${h.count}">${label}</div>`;
        legend += `<div class="hero-comp-item"><div class="hero-comp-dot" style="background:${c}"></div>${escapeHtml(h.area)} ${h.count}</div>`;
      });
      bar += '</div>';
      legend += '</div>';
      return bar + legend;
    })()}
  </div>

  <!-- Overview -->
  <section class="overview" id="overview">
    <div class="overview-grid">
      ${healthAreas.map(h => `<a href="#${h.sectionId}" class="overview-tile ${h.level}">
        <div class="tile-count">${h.count}${h.unit ? `<span class="tile-unit">${escapeHtml(h.unit)}</span>` : ''}</div>
        <div class="tile-area">${escapeHtml(h.area)}</div>
        <div class="tile-desc">${escapeHtml(h.desc)}</div>
      </a>`).join('\n      ')}
    </div>
  </section>

  <!-- Capability Map -->
  <section class="capability-map" id="capabilities">
    <div class="section-header">
      <div class="section-title">能力地图</div>
      <div class="section-desc">Claude 在当前项目中能做什么、不能做什么</div>
    </div>
    <div class="cap-tier-high">
      ${capabilityMap.filter(c => c.tier === 'high').map(cap => {
        const status = cap.warn ? 'cap-status-warn' : (cap.enabled ? 'cap-status-enabled' : 'cap-status-disabled');
        return `<div class="cap-card-high ${status}" title="${escapeHtml(cap.description)}">
          <div class="cap-icon">${cap.icon}</div>
          <div class="cap-body">
            <div class="cap-label">${escapeHtml(cap.label)}</div>
            <div class="cap-subtitle">${escapeHtml(cap.subtitle)}</div>
            <div class="cap-source">${cap.enabled ? escapeHtml(cap.source) : '未启用'}</div>
          </div>
        </div>`;
      }).join('\n      ')}
    </div>
    <div class="cap-tier-mid">
      ${capabilityMap.filter(c => c.tier === 'mid').map(cap => {
        const status = cap.warn ? 'cap-status-warn' : (cap.enabled ? 'cap-status-enabled' : 'cap-status-disabled');
        return `<div class="cap-card-mid ${status}" title="${escapeHtml(cap.description)}">
          <div class="cap-icon">${cap.icon}</div>
          <div class="cap-label">${escapeHtml(cap.label)}</div>
          <div class="cap-source">${cap.enabled ? escapeHtml(cap.source) : '未启用'}</div>
        </div>`;
      }).join('\n      ')}
    </div>
    <div class="cap-tier-base">
      ${capabilityMap.filter(c => c.tier === 'base').map(cap => {
        const status = cap.warn ? 'cap-status-warn' : (cap.enabled ? 'cap-status-enabled' : 'cap-status-disabled');
        return `<div class="cap-card-base ${status}" title="${escapeHtml(cap.description)}">
          <div class="cap-icon">${cap.icon}</div>
          <div class="cap-label">${escapeHtml(cap.label)}</div>
        </div>`;
      }).join('\n      ')}
    </div>
  </section>

  <!-- Deep Health Check -->
  <section class="section" id="health">
    <div class="section-header">
      <div class="section-title">深度体检</div>
      <div class="section-desc">检查了 ${totalChecks} 项配置，覆盖 9 个维度 + 跨维度洞察</div>
    </div>
    <div class="health-score-card glass">
      <div class="health-score-number" style="color:${healthScore >= 80 ? 'var(--green-text)' : healthScore >= 60 ? 'var(--amber-text)' : 'var(--red-text)'}">${healthScore}</div>
      <div class="health-score-grade" style="color:${healthScore >= 80 ? 'var(--green-text)' : healthScore >= 60 ? 'var(--amber-text)' : 'var(--red-text)'}">${healthGrade}</div>
      <div class="health-score-summary">${(() => {
        const w = findings.filter(f => f.level === 'warn').length;
        const t = findings.filter(f => f.level === 'tip').length;
        const parts = [];
        if (w > 0) parts.push(w + ' 项需关注');
        if (t > 0) parts.push(t + ' 项可优化');
        parts.push(passedChecks + ' 项通过');
        return parts.join(' · ');
      })()}</div>
    </div>
    ${(() => {
      const warnCount = findings.filter(f => f.level === 'warn').length;
      const tipCount = findings.filter(f => f.level === 'tip').length;
      let html = '';
      // Severity distribution bar
      html += `<div class="health-severity-bar">
        ${warnCount > 0 ? `<div class="health-severity-item"><div class="health-severity-dot warn"></div>${warnCount} 项需关注</div>` : ''}
        ${tipCount > 0 ? `<div class="health-severity-item"><div class="health-severity-dot tip"></div>${tipCount} 项可优化</div>` : ''}
        <div class="health-severity-item"><div class="health-severity-dot good"></div>${passedChecks} 项通过</div>
      </div>`;
      // Findings as expandable rows — sorted warn first, then tip
      const sorted = [...findings].sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1));
      if (sorted.length > 0) {
        const hasFixable = sorted.some(f => f.fixCmd);
        if (hasFixable) {
          html += `<div class="health-fix-hint">展开条目查看详情，点击「复制修复命令」后在终端粘贴执行即可修复</div>`;
        }
        html += '<div class="health-findings-list">';
        let isFirst = true;
        for (const f of sorted) {
          html += `<details class="health-row"${isFirst ? ' open' : ''}>
            <summary>
              <div class="health-row-icon ${f.level}">${f.level === 'warn' ? '!' : 'i'}</div>
              <div class="health-row-title">${escapeHtml(f.title)}</div>
              <div class="health-row-area">${escapeHtml(f.area)}</div>
              <svg class="health-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </summary>
            <div class="health-row-detail">
              ${escapeHtml(f.text)}
              <div class="health-action-tag">${escapeHtml(f.action)}</div>
              ${f.fixCmd ? `<button class="health-fix-btn" data-cmd="${escapeHtml(f.fixCmd)}" onclick="copyFixCmd(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制修复命令</button>` : ''}
            </div>
          </details>`;
          isFirst = false;
        }
        html += '</div>';
      }
      // Passed summary
      if (passedChecks > 0) {
        const goodAreas = healthAreas.filter(a => a.level === 'good').map(a => escapeHtml(a.area));
        html += `<div class="health-good-summary">
          <div class="health-severity-dot good"></div>
          <span>${passedChecks} / ${totalChecks} 项通过${goodAreas.length > 0 ? ' · ' + goodAreas.join(' · ') : ''}</span>
        </div>`;
      }
      return html;
    })()}
  </section>

  <!-- Skills -->
  <details class="section-collapse" open id="skills">
    <summary>
      <span class="section-collapse-title">Skills</span>
      <span class="section-collapse-desc">专属工作流，像菜谱一样按步骤执行</span>
      <span class="section-collapse-count">${allSkills.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${skills.projectSkills.length > 0 ? `
    <div class="section-subtitle">\u9879\u76ee\u7ea7</div>
    <div class="cards">${skills.projectSkills.map(s => renderSkillCard(s)).join('\n')}</div>` : ''}
    ${skills.userSkills.length > 0 ? `
    <div class="section-subtitle">\u7528\u6237\u7ea7</div>
    <div class="cards">${skills.userSkills.map(s => renderSkillCard(s)).join('\n')}</div>` : ''}
    ${(skills.pluginSkills || []).length > 0 ? `
    <div class="section-subtitle">\u63d2\u4ef6\u63d0\u4f9b</div>
    <div class="cards">${skills.pluginSkills.map(s => renderSkillCard(s)).join('\n')}</div>` : ''}
    ${allSkills.length === 0 ? '<div class="empty">\u8fd8\u6ca1\u6709\u914d\u7f6e\u4efb\u4f55 Skill</div>' : ''}
    </div>
  </details>

  <!-- Plugins -->
  <details class="section-collapse" open id="plugins">
    <summary>
      <span class="section-collapse-title">Plugins</span>
      <span class="section-collapse-desc">社区功能扩展包，即装即用</span>
      <span class="section-collapse-count">${plugins.plugins.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${plugins.plugins.length > 0 ? `
    <div class="cards">${plugins.plugins.map(p => renderPluginCard(p)).join('\n')}</div>` : '<div class="empty">\u8fd8\u6ca1\u6709\u5b89\u88c5\u63d2\u4ef6</div>'}
    </div>
  </details>

  <!-- MCP Servers -->
  <details class="section-collapse" open id="mcp-servers">
    <summary>
      <span class="section-collapse-title">MCP Servers</span>
      <span class="section-collapse-desc">连接外部工具的通道</span>
      <span class="section-collapse-count">${mcpServers.servers.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${mcpServers.servers.length > 0 ? `
    <div class="cards">${mcpServers.servers.map(s => renderMcpCard(s)).join('\n')}</div>` : '<div class="empty">\u8fd8\u6ca1\u6709\u914d\u7f6e MCP Server</div>'}
    </div>
  </details>

  <!-- Hooks -->
  <details class="section-collapse" open id="hooks">
    <summary>
      <span class="section-collapse-title">Hooks</span>
      <span class="section-collapse-desc">关键操作前后的守卫脚本</span>
      <span class="section-collapse-count">${hooks.hooks.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${hooks.hooks.length > 0 ? `
    <table class="hooks-table">
      <thead><tr><th>\u4e8b\u4ef6</th><th>\u5339\u914d</th><th>\u547d\u4ee4</th><th>\u4f5c\u7528\u57df</th></tr></thead>
      <tbody>
        ${hooks.hooks.map(h => `<tr>
          <td>${escapeHtml(h.event)}</td>
          <td><code style="font-size:12px;color:var(--text-3)">${escapeHtml(h.matcher)}</code></td>
          <td>${h.commands.map(c => `<div class="code-block" style="margin:0;padding:6px 10px">${escapeHtml(c.command)}</div>`).join('')}</td>
          <td><span class="badge badge-scope">${h.scope === 'project' ? '\u9879\u76ee\u7ea7' : '\u7528\u6237\u7ea7'}</span></td>
        </tr>`).join('\n')}
      </tbody>
    </table>` : '<div class="empty">\u8fd8\u6ca1\u6709\u914d\u7f6e Hook</div>'}
    </div>
  </details>

  <!-- Agents -->
  <details class="section-collapse" open id="agents">
    <summary>
      <span class="section-collapse-title">Agents</span>
      <span class="section-collapse-desc">可委派任务的专家角色</span>
      <span class="section-collapse-count">${allAgents.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${agents.pluginAgents.length > 0 ? `
    <div class="section-subtitle">插件提供</div>
    <div class="cards">${agents.pluginAgents.map(a => renderAgentCard(a)).join('\n')}</div>` : ''}
    ${agents.projectAgents.length > 0 ? `
    <div class="section-subtitle">项目级</div>
    <div class="cards">${agents.projectAgents.map(a => renderAgentCard(a)).join('\n')}</div>` : ''}
    ${agents.userAgents.length > 0 ? `
    <div class="section-subtitle">用户级</div>
    <div class="cards">${agents.userAgents.map(a => renderAgentCard(a)).join('\n')}</div>` : ''}
    ${allAgents.length === 0 ? '<div class="empty">还没有配置 Agent</div>' : ''}
    </div>
  </details>

  <!-- Commands -->
  <details class="section-collapse" open id="commands">
    <summary>
      <span class="section-collapse-title">Commands</span>
      <span class="section-collapse-desc">/ 触发的快捷指令</span>
      <span class="section-collapse-count">${allCommands.length} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${commands.pluginCommands.length > 0 ? `
    <div class="section-subtitle">插件提供</div>
    <div class="cards">${commands.pluginCommands.map(c => renderCommandCard(c)).join('\n')}</div>` : ''}
    ${commands.projectCommands.length > 0 ? `
    <div class="section-subtitle">项目级</div>
    <div class="cards">${commands.projectCommands.map(c => renderCommandCard(c)).join('\n')}</div>` : ''}
    ${commands.userCommands.length > 0 ? `
    <div class="section-subtitle">用户级</div>
    <div class="cards">${commands.userCommands.map(c => renderCommandCard(c)).join('\n')}</div>` : ''}
    ${allCommands.length === 0 ? '<div class="empty">还没有配置 Command</div>' : ''}
    </div>
  </details>

  <!-- Memory -->
  <details class="section-collapse" open id="memory">
    <summary>
      <span class="section-collapse-title">\u8bb0\u5fc6\u4e0e\u6587\u6863</span>
      <span class="section-collapse-desc">跨对话记住的项目知识和偏好</span>
      <span class="section-collapse-count">${memory.projectMemory.length + memory.userProjectMemory.length + memory.otherDocs.length + (memory.claudeMd.exists ? 1 : 0) + (memory.userClaudeMd.exists ? 1 : 0)} 个</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    ${memory.claudeMd.exists ? `
    <div class="section-subtitle">项目指令 (CLAUDE.md)</div>
    ${renderMemoryItem({ filename: 'CLAUDE.md', path: memory.claudeMd.path, size: memory.claudeMd.size, preview: memory.claudeMd.preview })}` : ''}
    ${memory.userClaudeMd.exists ? `
    <div class="section-subtitle">用户级全局指令</div>
    ${renderMemoryItem({ filename: 'CLAUDE.md (用户级)', path: memory.userClaudeMd.path, size: memory.userClaudeMd.size, preview: memory.userClaudeMd.preview })}` : ''}
    ${memory.otherDocs.length > 0 ? `
    <div class="section-subtitle">\u5176\u4ed6\u6587\u6863</div>
    ${memory.otherDocs.map(d => renderMemoryItem(d)).join('\n')}` : ''}
    ${memory.projectMemory.length > 0 ? `
    <div class="section-subtitle">\u9879\u76ee\u8bb0\u5fc6</div>
    ${memory.projectMemory.map(m => renderMemoryItem(m)).join('\n')}` : ''}
    ${memory.userProjectMemory.length > 0 ? `
    <div class="section-subtitle">\u7528\u6237\u9879\u76ee\u8bb0\u5fc6</div>
    ${memory.userProjectMemory.map(m => renderMemoryItem(m)).join('\n')}` : ''}
    ${!memory.claudeMd.exists && memory.projectMemory.length === 0 && memory.userProjectMemory.length === 0 && memory.otherDocs.length === 0 ? '<div class="empty">\u8fd8\u6ca1\u6709\u8bb0\u5fc6\u6587\u4ef6</div>' : ''}
    </div>
  </details>

  <!-- Settings -->
  <details class="section-collapse" open id="settings">
    <summary>
      <span class="section-collapse-title">\u8bbe\u7f6e</span>
      <span class="section-collapse-desc">行为开关和安全边界</span>
      <span class="section-collapse-count">${settings.permissions.allow.length + settings.permissions.deny.length + Object.keys(settings.gitConfig).length} 项</span>
      <svg class="section-collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </summary>
    <div class="section-collapse-body">
    <div class="settings-grid">
      ${Object.keys(settings.gitConfig).length > 0 ? `
      <div class="settings-panel">
        <div class="settings-panel-title">Git \u914d\u7f6e</div>
        ${Object.entries(settings.gitConfig).map(([k, v]) => `<div class="settings-row"><span class="settings-key">${escapeHtml(k)}</span><span class="settings-value">${escapeHtml(String(v))}</span></div>`).join('\n')}
      </div>` : ''}
      ${settings.permissions.allow.length > 0 || settings.permissions.deny.length > 0 ? `
      <div class="settings-panel">
        <div class="settings-panel-title">\u6743\u9650</div>
        ${settings.permissions.allow.length > 0 ? `<div style="margin-bottom:8px;font-size:12px;color:var(--text-4);margin-top:4px">\u5141\u8bb8</div>
        <div class="permission-list">${settings.permissions.allow.map(p => `<span class="permission-pill allow">${escapeHtml(p)}</span>`).join('\n')}</div>` : ''}
        ${settings.permissions.deny.length > 0 ? `<div style="margin-bottom:8px;font-size:12px;color:var(--text-4);margin-top:12px">\u7981\u6b62</div>
        <div class="permission-list">${settings.permissions.deny.map(p => `<span class="permission-pill deny">${escapeHtml(p)}</span>`).join('\n')}</div>` : ''}
      </div>` : ''}
      ${Object.keys(settings.envVars).length > 0 ? `
      <div class="settings-panel">
        <div class="settings-panel-title">\u73af\u5883\u53d8\u91cf</div>
        ${Object.entries(settings.envVars).map(([k, v]) => `<div class="settings-row"><span class="settings-key">${escapeHtml(k)}</span><span class="settings-value">${escapeHtml(v)}</span></div>`).join('\n')}
      </div>` : ''}
    </div>
    ${Object.keys(settings.gitConfig).length === 0 && settings.permissions.allow.length === 0 && Object.keys(settings.envVars).length === 0 ? '<div class="empty">\u65e0\u81ea\u5b9a\u4e49\u8bbe\u7f6e</div>' : ''}
    </div>
  </details>

  <!-- Footer -->
  <div class="footer">
    <span>Claude Code Inspector \u751f\u6210</span>
    <span>\u5bc6\u94a5\u5df2\u8131\u654f &middot; <span class="status"><span class="status-dot amber"></span>\u53ef\u5b89\u5168\u5206\u4eab</span></span>
  </div>

</div>

<div class="toast" id="toast"></div>

<script>
function toggleMemory(el) {
  const preview = el.nextElementSibling;
  const toggle = el.querySelector('.memory-toggle');
  preview.classList.toggle('open');
  toggle.classList.toggle('open');
}

function copyPath(text) {
  navigator.clipboard.writeText(text).then(() => showToast('\u5df2\u590d\u5236\u8def\u5f84')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('\u5df2\u590d\u5236\u8def\u5f84');
  });
}

function copyFixCmd(btn) {
  const cmd = btn.getAttribute('data-cmd');
  navigator.clipboard.writeText(cmd).then(() => {
    showToast('\u5df2\u590d\u5236\u4fee\u590d\u547d\u4ee4');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> \u5df2\u590d\u5236';
    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> \u590d\u5236\u4fee\u590d\u547d\u4ee4'; }, 1500);
  }).catch(() => {
    const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('\u5df2\u590d\u5236\u4fee\u590d\u547d\u4ee4');
  });
}

function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

// Scroll spy for floating nav
const sections = document.querySelectorAll('.section, .section-collapse, .overview, .hero, .capability-map');
const navLinks = document.querySelectorAll('.float-nav a');

function updateNav() {
  let current = '';
  for (const sec of sections) {
    const rect = sec.getBoundingClientRect();
    if (rect.top <= 200) current = sec.id;
  }
  navLinks.forEach(a => {
    a.classList.toggle('active', a.dataset.section === current);
  });
}

window.addEventListener('scroll', updateNav, { passive: true });
updateNav();

// Auto-expand collapsed sections on nav click
document.querySelectorAll('.float-nav a, .overview-tile').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href') || a.getAttribute('data-section');
    const id = (href || '').replace('#', '');
    if (!id) return;
    const target = document.getElementById(id);
    if (target && target.tagName === 'DETAILS' && !target.open) {
      target.open = true;
    }
  });
});
</script>
</body>
</html>`;
}

// ─── Card Renderers ──────────────────────────────────────────────────────────

function renderSkillCard(skill) {
  return `<div class="card">
  <div class="card-header">
    <span class="card-name">${escapeHtml(skill.name)}</span>
    ${skill.version ? `<span class="card-version">v${escapeHtml(skill.version)}</span>` : ''}
  </div>
  <div class="card-desc">${escapeHtml(truncate(skill.description, 120))}</div>
  <div class="card-footer">
    <span class="badge badge-scope">${skill.source === 'project' ? '\u9879\u76ee\u7ea7' : skill.source === 'plugin' ? '\u63d2\u4ef6' : '\u7528\u6237\u7ea7'}</span>
    ${skill.userInvocable ? '<span class="badge badge-invocable">\u53ef\u8c03\u7528</span>' : ''}
    ${skill.pluginName ? `<span class="card-meta-item">${escapeHtml(skill.pluginName)}</span>` : ''}
    ${skill.subFileCount > 0 ? `<span class="card-meta-item">${skill.subFileCount} \u4e2a\u6587\u4ef6</span>` : ''}
    ${skill.remoteSource ? `<span class="card-meta-item">${escapeHtml(skill.remoteSource)}</span>` : ''}
    <span class="path" onclick="copyPath('${escapeHtml(skill.path)}')">${escapeHtml(skill.path)}</span>
  </div>
</div>`;
}

function renderPluginCard(plugin) {
  const sc = plugin.blocked ? 'red' : (plugin.enabled ? 'green' : 'red');
  const st = plugin.blocked ? '\u5df2\u5c4f\u853d' : (plugin.enabled ? '\u5df2\u542f\u7528' : '\u672a\u542f\u7528');
  return `<div class="card">
  <div class="card-header">
    <span class="card-name">${escapeHtml(plugin.name)}</span>
    ${plugin.version ? `<span class="card-version">v${escapeHtml(plugin.version)}</span>` : ''}
  </div>
  ${plugin.description ? `<div class="card-desc">${escapeHtml(truncate(plugin.description, 120))}</div>` : ''}
  <div class="card-footer">
    <span class="status"><span class="status-dot ${sc}"></span>${st}</span>
    ${plugin.marketplace ? `<span class="card-meta-item">${escapeHtml(plugin.marketplace)}</span>` : ''}
    ${plugin.skillCount > 0 ? `<span class="card-meta-item">${plugin.skillCount} \u4e2a Skills</span>` : ''}
  </div>
</div>`;
}

function renderMcpCard(server) {
  return `<div class="card">
  <div class="card-header">
    <span class="card-name">${escapeHtml(server.name)}</span>
    <span class="status"><span class="status-dot ${server.disabled ? 'red' : 'green'}"></span>${server.disabled ? '\u5df2\u7981\u7528' : '\u5df2\u542f\u7528'}</span>
  </div>
  <div class="code-block">${escapeHtml(server.command)} ${escapeHtml(server.args.join(' '))}</div>
  ${server.envKeys.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;font-size:12px;color:var(--text-4)">
    ${server.envKeys.map(k => `<span class="card-meta-item"><span class="status-dot amber" style="width:5px;height:5px"></span>${escapeHtml(k)}</span>`).join('\n')}
  </div>` : ''}
  <div style="margin-top:8px"><span class="badge badge-scope">${server.scope === 'project' ? '\u9879\u76ee\u7ea7' : '\u7528\u6237\u7ea7'}</span></div>
</div>`;
}

function renderMemoryItem(item) {
  return `<div class="memory-item">
  <div class="memory-header" onclick="toggleMemory(this)">
    <div>
      <span class="memory-name">${escapeHtml(item.filename)}</span>
      <span class="path" onclick="event.stopPropagation(); copyPath('${escapeHtml(item.path)}')" style="margin-left:12px">${escapeHtml(item.path)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px">
      <span class="memory-size">${item.size}</span>
      <span class="memory-toggle">\u25B6</span>
    </div>
  </div>
  <div class="memory-preview">
    <div class="memory-preview-content">${escapeHtml(item.preview)}</div>
  </div>
</div>`;
}

function renderAgentCard(agent) {
  const modelBadge = agent.model ? `<span class="badge badge-scope">${escapeHtml(agent.model)}</span>` : '';
  return `<div class="card">
  <div class="card-header">
    <span class="card-name">${escapeHtml(agent.name)}</span>
    ${modelBadge}
  </div>
  ${agent.description ? `<div class="card-desc">${escapeHtml(truncate(agent.description, 120))}</div>` : ''}
  ${agent.tools.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${agent.tools.slice(0, 6).map(t => `<span style="font-size:11px;padding:2px 6px;border-radius:3px;background:var(--code-bg);color:var(--text-3)">${escapeHtml(t)}</span>`).join('')}${agent.tools.length > 6 ? `<span style="font-size:11px;color:var(--text-4)">+${agent.tools.length - 6}</span>` : ''}</div>` : ''}
  <div class="card-footer">
    <span class="badge badge-scope">${agent.source === 'project' ? '项目级' : agent.source === 'plugin' ? '插件' : '用户级'}</span>
    ${agent.pluginName ? `<span class="card-meta-item">${escapeHtml(agent.pluginName)}</span>` : ''}
  </div>
</div>`;
}

function renderCommandCard(cmd) {
  return `<div class="card">
  <div class="card-header">
    <span class="card-name" style="font-family:'SF Mono',monospace">/${escapeHtml(cmd.name)}</span>
    ${cmd.argumentHint ? `<span class="card-version">${escapeHtml(cmd.argumentHint)}</span>` : ''}
  </div>
  ${cmd.description ? `<div class="card-desc">${escapeHtml(truncate(cmd.description, 120))}</div>` : ''}
  <div class="card-footer">
    <span class="badge badge-scope">${cmd.source === 'project' ? '项目级' : cmd.source === 'plugin' ? '插件' : '用户级'}</span>
    ${cmd.pluginName ? `<span class="card-meta-item">${escapeHtml(cmd.pluginName)}</span>` : ''}
  </div>
</div>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const skillsData = scanSkills();
  const pluginsData = scanPlugins();
  const mcpServersData = scanMcpServers();
  const hooksData = scanHooks();
  const memoryData = scanMemory();
  const settingsData = scanSettings();
  const agentsData = scanAgents();
  const commandsData = scanCommands();

  const dataForHealth = { skills: skillsData, plugins: pluginsData, mcpServers: mcpServersData, hooks: hooksData, memory: memoryData, settings: settingsData, agents: agentsData, commands: commandsData };
  const health = scanHealth(dataForHealth);
  const capabilityMap = buildCapabilityMap(dataForHealth);

  const data = { ...dataForHealth, health, capabilityMap };
  const html = generateHTML(data);
  const outputPath = path.join(CWD, 'claude-code-inspector.html');
  fs.writeFileSync(outputPath, html, 'utf-8');

  const counts = health.areas.map(h => `${h.area}: ${h.count}`).join('  ');
  console.log(`\nClaude Code Inspector`);
  console.log(`${'─'.repeat(40)}`);
  console.log(counts);
  console.log(`Health: ${health.score}/100 (${health.grade})`);
  console.log(`\nDashboard: ${outputPath}`);
}

main();
