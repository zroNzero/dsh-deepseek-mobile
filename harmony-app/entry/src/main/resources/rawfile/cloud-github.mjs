import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'cloud-github';
export const inject = ['tools', 'systemPrompt'];

const LOCAL_TOOLS = new Set([
  'read', 'read_image', 'write', 'edit', 'apply_patch', 'glob', 'grep',
  'bash', 'pwsh', 'terminal', 'job_list', 'job_output', 'job_kill',
  'plugin_manager', 'working_directory', 'workspace_dependencies',
]);

function loadSettings(config = {}) {
  let file = {};
  if (config.settingsPath) {
    try {
      file = JSON.parse(fs.readFileSync(config.settingsPath, 'utf8'));
    } catch {
      file = {};
    }
  }

  const token = file.token || process.env.DSH_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  let owner = file.owner || process.env.DSH_GITHUB_OWNER || '';
  let repo = file.repo || process.env.DSH_GITHUB_REPO || '';
  const branch = file.branch || process.env.DSH_GITHUB_BRANCH || 'main';

  if (repo.includes('/')) {
    const parts = repo.split('/').filter(Boolean);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1].replace(/\.git$/, '');
    }
  }

  if (!token) {
    throw new Error('GitHub token is not configured. Open Cloud GitHub settings and save a PAT with Contents read/write permission.');
  }
  if (!owner || !repo) {
    throw new Error('GitHub repository is not configured. Expected owner/repo in Cloud GitHub settings.');
  }

  return {
    token,
    owner,
    repo,
    branch,
    apiBase: (config.apiBase || file.apiBase || 'https://api.github.com').replace(/\/+$/, ''),
    maxFileBytes: Number(config.maxFileBytes || 2000000),
    timeoutMs: Number(config.timeoutMs || 30000),
  };
}

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function encodePath(path) {
  return String(path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function request(settings, endpoint, init = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${settings.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DSH-Harmony-Cloud-Github',
    ...(init.headers || {}),
  };
  const response = await fetch(`${settings.apiBase}${endpoint}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message
      ? body.message
      : String(text || response.statusText);
    throw new GitHubError(response.status, `GitHub ${response.status}: ${message}`);
  }
  return body;
}

function repoRoot(settings) {
  return `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
}

async function listFiles(config, args) {
  const settings = loadSettings(config);
  const path = encodePath(args.path);
  const suffix = path ? `/${path}` : '';
  const body = await request(
    settings,
    `${repoRoot(settings)}/contents${suffix}?ref=${encodeURIComponent(settings.branch)}`,
  );

  if (!Array.isArray(body)) {
    if (!body || body.type !== 'file') {
      throw new Error(`${args.path || '/'} is not a regular file; use gh_read_file.`);
    }
    return `${body.type}\t${body.path}\t${body.size ?? ''}\t${body.sha}`;
  }

  if (body.length === 0) return '(empty directory)';
  return body
    .map((entry) => `${entry.type}\t${entry.path}\t${entry.size ?? ''}\t${entry.sha}`)
    .join('\n');
}

async function readFile(config, args) {
  const settings = loadSettings(config);
  const path = encodePath(args.path);
  if (!path) throw new Error('path must name a file');
  const body = await request(
    settings,
    `${repoRoot(settings)}/contents/${path}?ref=${encodeURIComponent(settings.branch)}`,
  );

  if (Array.isArray(body)) {
    throw new Error(`${args.path} is a directory; use gh_list_files.`);
  }
  if (!body || body.type !== 'file') {
    throw new Error(`${args.path} is not a regular file.`);
  }
  if (Number(body.size || 0) > settings.maxFileBytes) {
    throw new Error(`${args.path} is ${body.size} bytes, above the ${settings.maxFileBytes}-byte limit.`);
  }
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`${args.path} has unsupported encoding ${body.encoding}.`);
  }

  const bytes = Buffer.from(body.content.replace(/\n/g, ''), 'base64');
  if (bytes.includes(0)) {
    throw new Error(`${args.path} looks binary; gh_read_file returns UTF-8 text only.`);
  }
  return bytes.toString('utf8');
}

function parseRepoSpec(value) {
  let text = String(value || '').trim();
  if (text.startsWith('https://github.com/')) text = text.substring('https://github.com/'.length);
  if (text.startsWith('http://github.com/')) text = text.substring('http://github.com/'.length);
  if (text.endsWith('/')) text = text.substring(0, text.length - 1);
  if (text.endsWith('.git')) text = text.substring(0, text.length - 4);
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('repo must be owner/repo or a GitHub URL');
  return { owner: parts[0], repo: parts[1] };
}

function extractTarGz(buffer, dest) {
  const data = zlib.gunzipSync(buffer);
  let off = 0;
  let longName = null;
  while (off + 512 <= data.length) {
    const header = data.subarray(off, off + 512);
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!rawName) { off += 512; continue; }
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeText, 8) || 0;
    const type = String.fromCharCode(header[156]);
    if (type === 'L') {
      longName = data.subarray(off + 512, off + 512 + size).toString('utf8').replace(/\0.*$/, '');
      off += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    if (type === 'x' || type === 'g') {
      const pax = data.subarray(off + 512, off + 512 + size).toString('utf8');
      const match = /(?:^|\n)\d+ path=([^\n]+)/.exec(pax);
      if (match) longName = match[1];
      off += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    let name = longName || rawName;
    longName = null;
    off += 512;
    const slash = name.indexOf('/');
    if (slash >= 0) name = name.substring(slash + 1);
    if (!name || name.includes('..')) {
      off += Math.ceil(size / 512) * 512;
      continue;
    }
    const full = path.join(dest, name);
    if (type === '5') {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    if (type === '2' || type === '3' || type === '4') {
      off += Math.ceil(size / 512) * 512;
      continue;
    }
    if (!size) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
}

function parsePluginSpec(value) {
  let text = String(value || '').trim();
  if (text.startsWith('npm:')) return { kind: 'npm', name: text.substring(4).trim() };
  if (text.startsWith('https://github.com/') || text.startsWith('http://github.com/')) {
    text = text.replace(/^https?:\/\/github\.com\//, '');
    const parts = text.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('GitHub URL must contain owner/repo');
    return { kind: 'github', owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  }
  if (text.startsWith('@') || !text.includes('/')) return { kind: 'npm', name: text };
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('expected owner/repo or an npm package name');
  return { kind: 'github', owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

async function downloadTarball(spec, ref, settings) {
  if (spec.kind === 'github') {
    let targetRef = ref;
    if (!targetRef) {
      const meta = await fetch(`https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${settings.token}`,
          'User-Agent': 'DSH-Harmony-Cloud-Github',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (meta.ok) targetRef = (await meta.json()).default_branch;
    }
    targetRef = targetRef || 'main';
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/tarball/${encodeURIComponent(targetRef)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${settings.token}`,
          'User-Agent': 'DSH-Harmony-Cloud-Github',
        },
        signal: AbortSignal.timeout(120000),
      },
    );
    if (!response.ok) throw new Error(`GitHub tarball ${response.status}: ${await response.text()}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), dependency: null, version: targetRef };
  }

  const metaResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(spec.name)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'DSH-Harmony-Cloud-Github' },
    signal: AbortSignal.timeout(30000),
  });
  if (!metaResponse.ok) throw new Error(`npm registry ${metaResponse.status} for ${spec.name}`);
  const meta = await metaResponse.json();
  const version = ref || meta['dist-tags']?.latest;
  const selected = version ? meta.versions?.[version] : undefined;
  if (!selected?.dist?.tarball) throw new Error(`npm package ${spec.name}@${version || 'latest'} has no tarball`);
  const tarball = await fetch(selected.dist.tarball, {
    headers: { 'User-Agent': 'DSH-Harmony-Cloud-Github' },
    signal: AbortSignal.timeout(120000),
  });
  if (!tarball.ok) throw new Error(`npm tarball ${tarball.status}`);
  return {
    buffer: Buffer.from(await tarball.arrayBuffer()),
    dependency: `^${version}`,
    version,
  };
}

async function installPlugin(config, args) {
  const settings = loadSettings(config);
  if (!config.profileDir) throw new Error('profileDir is not configured');
  const spec = parsePluginSpec(args.repo);
  const downloaded = await downloadTarball(spec, args.ref ? String(args.ref) : '', settings);

  const temp = fs.mkdtempSync(path.join(config.profileDir, '.plugin-'));
  try {
    extractTarGz(downloaded.buffer, temp);
    const pkgPath = path.join(temp, 'package.json');
    if (!fs.existsSync(pkgPath)) throw new Error('package.json not found at archive root');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.name) throw new Error('package.json has no name');
    if (!pkg.dsh || (!pkg.dsh.bundle && !pkg.dsh.client)) {
      throw new Error(`${pkg.name} does not declare a DSH bundle or client`);
    }

    const target = path.join(config.profileDir, 'node_modules', pkg.name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(temp, target, { recursive: true });

    const profilePath = path.join(config.profileDir, 'package.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    profile.dependencies = profile.dependencies || {};
    profile.dependencies[pkg.name] = spec.kind === 'github'
      ? `file:./node_modules/${pkg.name}`
      : (downloaded.dependency || `^${pkg.version}`);
    profile.dsh = profile.dsh || {};
    profile.dsh.profile = profile.dsh.profile || {};
    const bundles = profile.dsh.profile.bundles || [];
    if (!bundles.includes(pkg.name)) bundles.push(pkg.name);
    profile.dsh.profile.bundles = bundles;
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    return `已安装 ${pkg.name}`;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
async function writeFile(config, args) {
  const settings = loadSettings(config);
  const path = encodePath(args.path);
  if (!path) throw new Error('path must name a file');
  if (typeof args.content !== 'string') throw new Error('content must be a string');
  const message = String(args.message || `Update ${args.path}`);

  let sha;
  try {
    const current = await request(
      settings,
      `${repoRoot(settings)}/contents/${path}?ref=${encodeURIComponent(settings.branch)}`,
    );
    if (current && !Array.isArray(current) && current.type === 'file') {
      sha = current.sha;
    }
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }

  const payload = {
    message,
    content: Buffer.from(args.content, 'utf8').toString('base64'),
    branch: settings.branch,
  };
  if (sha) payload.sha = sha;

  const result = await request(
    settings,
    `${repoRoot(settings)}/contents/${path}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const commitSha = result?.commit?.sha || '(unknown)';
  const commitUrl = result?.commit?.html_url || '';
  return `Updated ${args.path}\ncommit: ${commitSha}${commitUrl ? `\n${commitUrl}` : ''}`;
}

export function apply(ctx, config = {}) {
  console.log('[cloud-github] plugin active');
  ctx.tools.register(defineTool({
    name: 'gh_list_files',
    description: 'List one directory in the configured GitHub repository. Returns type, path, size, and blob SHA. Use this instead of local filesystem tools.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Repository-relative directory path, for example "src" or "." for the root.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => listFiles(config, args),
  }));

  ctx.tools.register(defineTool({
    name: 'gh_read_file',
    description: 'Read one UTF-8 file from the configured GitHub repository using the Contents API. Use this instead of local read tools.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Repository-relative file path.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => readFile(config, args),
  }));

  ctx.tools.register(defineTool({
    name: 'gh_write_file',
    description: 'Create or replace one file in the configured GitHub repository with a direct commit through the Contents API. Use this instead of local write/edit tools.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Repository-relative file path.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Complete new UTF-8 file content.',
      },
      message: {
        type: 'string',
        required: true,
        description: 'Git commit message.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => writeFile(config, args),
  }));

  ctx.tools.register(defineTool({
    name: 'gh_install_plugin',
    description: 'Install a dependency-free DSH plugin into this profile without pnpm. Accepts a GitHub repository (owner/repo or URL) or an npm package name such as dsh-plugin-whale-pet, downloads its tarball, and updates the profile manifest. Requires an app restart.',
    parameters: {
      repo: {
        type: 'string',
        required: true,
        description: 'GitHub repository (owner/repo or full URL) or npm package name, for example "owner/dsh-plugin" or "dsh-plugin-whale-pet".',
      },
      ref: {
        type: 'string',
        description: 'GitHub branch/tag, or npm version; defaults to the repository default branch or npm latest.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => installPlugin(config, args),
  }));
  ctx.tools.guard((exec) => {
    if (LOCAL_TOOLS.has(exec.name)) {
      return `Cloud GitHub mode: local tool "${exec.name}" is disabled. Use gh_list_files, gh_read_file, or gh_write_file.`;
    }
  });

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/cloud-github/install',
      handler: async (req, res) => {
        const send = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          send(405, { ok: false, error: 'POST required' });
          return;
        }
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 65536) throw new Error('request too large');
          }
          const body = JSON.parse(raw || '{}');
          const result = await installPlugin(config, body);
          send(200, { ok: true, result });
        } catch (error) {
          send(400, { ok: false, error: String(error && error.message || error) });
        }
      },
    }), 'cloud-github: local plugin installer');
  });
  ctx.systemPrompt.section({
    name: 'cloud-github:mode',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GOAL'),
    text: [
      '<cloud_github_mode>',
      'You are in Cloud GitHub mode. There is no local code repository on this device.',
      'All repository reads and writes MUST use gh_list_files, gh_read_file, and gh_write_file.',
      'Do not use local filesystem tools, shell/terminal tools, package managers, or background job tools; they are disabled.',
      'gh_write_file creates a commit directly on the configured branch. Read a file before modifying it, write the complete new content, and use a clear commit message.',
      'pnpm and external package managers are unavailable. To install a dependency-free DSH plugin, use gh_install_plugin with its GitHub repo; restart the app afterwards.',
      'If a tool reports that GitHub is not configured, tell the user to open Cloud GitHub settings and save a fine-grained PAT with Contents read/write access plus owner/repo.',
      '</cloud_github_mode>',
    ].join('\n'),
  });
}
