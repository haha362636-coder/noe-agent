// 时光机：AI 每次干活前后给工作目录拍快照，记录改了哪些文件，并支持一键撤销 / 恢复。
// 快照存在 ~/.noe-agent/snapshots/<目录哈希> 的影子 Git 仓库里（--git-dir 与 --work-tree 分离），
// 不会碰项目自己的 .git，也不要求项目本身是 Git 仓库；项目的 .gitignore 照样生效。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { baseEnv, which } = require('./env');
const { DIR: STORE_DIR } = require('./store');
const { t } = require('./i18n');

const DIR = path.join(STORE_DIR, 'snapshots');
// 常见的依赖、构建产物和大文件目录：项目没写 .gitignore 时也不拍进快照
const EXCLUDE = ['.git/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', '.next/', '.nuxt/', 'dist/', 'build/', 'target/', '.gradle/',
  'Pods/', 'DerivedData/', '.cache/', '.DS_Store', '*.dmg', '*.zip', '*.iso', '*.mp4', '*.mov'];
const SNAP_TIMEOUT = 20000;

let gitBin;
function gitPath() {
  if (gitBin !== undefined) return gitBin;
  gitBin = which('git');
  // macOS 没装命令行工具时 /usr/bin/git 只是个壳，一调用就会弹安装框
  if (gitBin === '/usr/bin/git' && process.platform === 'darwin') {
    try { execFileSync('xcode-select', ['-p'], { stdio: 'ignore', timeout: 5000 }); } catch { gitBin = null; }
  }
  return gitBin;
}

const disabled = new Set(); // 拍快照超时的目录（太大），本次运行期间不再尝试
const locks = new Map();    // cwd -> Promise，同一目录的 git 操作串行，避免 index.lock 冲突

function gitDir(cwd) { return path.join(DIR, crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16)); }

function git(cwd, args, { timeout = SNAP_TIMEOUT, input } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...baseEnv(), GIT_DIR: gitDir(cwd), GIT_WORK_TREE: cwd, GIT_AUTHOR_NAME: 'Noe', GIT_AUTHOR_EMAIL: 'noe@local', GIT_COMMITTER_NAME: 'Noe', GIT_COMMITTER_EMAIL: 'noe@local' };
    const p = execFile(gitPath(), ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args],
      { cwd, env, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
        if (err) return reject(Object.assign(new Error(String(errOut || err.message).trim().split('\n').pop()), { killed: err.killed }));
        resolve(out);
      });
    if (input != null) p.stdin.end(input);
  });
}

function locked(cwd, fn) {
  const prev = locks.get(cwd) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(cwd, tail);
  tail.then(() => { if (locks.get(cwd) === tail) locks.delete(cwd); });
  return run;
}

/** 这个目录能不能拍快照：主目录、根目录这类太大的地方不拍 */
function usable(cwd) {
  if (!cwd || !gitPath() || disabled.has(cwd)) return false;
  const home = os.homedir();
  if (['/', home, path.dirname(home), '/Users', '/Volumes', '/tmp', '/private/tmp'].includes(cwd)) return false;
  if (cwd.startsWith(STORE_DIR)) return false;
  try { return fs.statSync(cwd).isDirectory(); } catch { return false; }
}

async function ensureRepo(cwd) {
  const gd = gitDir(cwd);
  if (fs.existsSync(path.join(gd, 'HEAD'))) return;
  fs.mkdirSync(gd, { recursive: true });
  // GIT_DIR 指向影子仓库后 init 会把仓库建在那里；工作区每次通过 GIT_WORK_TREE 指定
  await git(cwd, ['init', '-q']);
  // 快照之间靠 commit 链保持可达；关掉自动 gc，避免旧快照被清理
  await git(cwd, ['config', 'gc.auto', '0']);
  fs.mkdirSync(path.join(gd, 'info'), { recursive: true });
  fs.writeFileSync(path.join(gd, 'info', 'exclude'), EXCLUDE.join('\n') + '\n');
  fs.writeFileSync(path.join(gd, 'noe-cwd'), cwd);
}

/** 给目录拍一个快照，返回 commit id；目录不适合或失败时返回 null */
function take(cwd, label = '') {
  if (!usable(cwd)) return Promise.resolve(null);
  return locked(cwd, async () => {
    try {
      await ensureRepo(cwd);
      await git(cwd, ['add', '-A', '--ignore-errors', '.']).catch((e) => { if (e.killed) throw e; });
      const tree = (await git(cwd, ['write-tree'])).trim();
      let parent = '';
      try { parent = (await git(cwd, ['rev-parse', '-q', '--verify', 'refs/heads/noe'])).trim(); } catch { /* 第一个快照 */ }
      // 和上一个快照完全一样就直接复用，避免空提交
      if (parent && (await git(cwd, ['rev-parse', parent + '^{tree}'])).trim() === tree) return parent;
      const commit = (await git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', label || 'snapshot'])).trim();
      await git(cwd, ['update-ref', 'refs/heads/noe', commit]);
      return commit;
    } catch (e) {
      if (e.killed) {
        // 目录太大，拍一次就超时：本次运行不再给它拍，并清理残留的锁
        disabled.add(cwd);
        try { fs.rmSync(path.join(gitDir(cwd), 'index.lock'), { force: true }); } catch { /* 忽略 */ }
      }
      console.error('[snapshot]', cwd, e.message);
      return null;
    }
  });
}

/** 两个快照之间的文件改动：[{ path, status: 'A'|'M'|'D', add, del, binary }] */
async function changes(cwd, from, to) {
  const [ns, st] = await Promise.all([
    git(cwd, ['diff', '--no-renames', '--numstat', '-z', from, to]),
    git(cwd, ['diff', '--no-renames', '--name-status', '-z', from, to]),
  ]);
  const status = {};
  const parts = st.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) status[parts[i + 1]] = parts[i][0];
  return ns.split('\0').filter(Boolean).map((line) => {
    const [a, d, ...p] = line.split('\t');
    const file = p.join('\t');
    return { path: file, status: status[file] || 'M', add: a === '-' ? 0 : +a, del: d === '-' ? 0 : +d, binary: a === '-' };
  });
}

/** 统一格式的差异文本，可只看一个文件 */
async function diff(cwd, from, to, file) {
  const out = await git(cwd, ['diff', '--no-renames', '--no-color', '-U3', from, to, '--', ...(file ? [file] : ['.'])]);
  return out.length > 400000 ? out.slice(0, 400000) + '\n' + t('…（差异太长，已截断）') : out;
}

/**
 * 把 paths 恢复成快照 target 里的样子（target 里没有的文件会被删除）。
 * expect：这些文件现在“应该”是哪个快照的样子；如果之后又被改过，返回冲突列表而不动文件（除非 force）。
 */
function restore(cwd, { target, expect, paths, force }) {
  if (!gitPath()) return Promise.reject(new Error(t('没有找到 git，无法恢复')));
  return locked(cwd, async () => {
    await ensureRepo(cwd);
    if (!force && expect) {
      // 当前状态和预期不一样的文件 = 之后又被人或别的 AI 改过
      await git(cwd, ['add', '-A', '--ignore-errors', '.']).catch(() => {});
      const cur = (await git(cwd, ['write-tree'])).trim();
      const changed = (await git(cwd, ['diff', '--no-renames', '--name-only', '-z', expect, cur, '--', ...paths])).split('\0').filter(Boolean);
      if (changed.length) return { conflicts: changed };
    }
    const exists = new Set((await git(cwd, ['ls-tree', '-r', '-z', '--name-only', target, '--', ...paths])).split('\0').filter(Boolean));
    const keep = paths.filter((p) => exists.has(p));
    for (const p of paths.filter((x) => !exists.has(x))) {
      const full = path.resolve(cwd, p);
      if (full.startsWith(cwd + path.sep)) fs.rmSync(full, { force: true });
    }
    // 分批写回，避免参数过长
    for (let i = 0; i < keep.length; i += 200) await git(cwd, ['checkout', target, '--', ...keep.slice(i, i + 200)]);
    return { ok: true };
  });
}

/** 读快照里某个文件的原始内容（二进制安全） */
function blob(cwd, commit, file) {
  return new Promise((resolve, reject) => {
    const env = { ...baseEnv(), GIT_DIR: gitDir(cwd), GIT_WORK_TREE: cwd };
    execFile(gitPath(), ['cat-file', 'blob', `${commit}:${file}`], { cwd, env, encoding: 'buffer', timeout: SNAP_TIMEOUT, maxBuffer: 512 * 1024 * 1024 },
      (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim().split('\n').pop())) : resolve(out)));
  });
}

/**
 * 把另一个目录（AI 擂台的沙盒）快照 commit 里的这些文件写到 dest：新增 / 修改的写入，删除的删掉。
 * files 来自 changes()；可执行权限一并带过去。
 */
async function exportFiles(srcCwd, commit, files, dest) {
  if (!gitPath()) throw new Error(t('没有找到 git，无法合并改动'));
  const root = path.resolve(dest);
  const keep = files.filter((f) => f.status !== 'D').map((f) => f.path);
  const exec = new Set();
  for (let i = 0; i < keep.length; i += 200) {
    const out = await git(srcCwd, ['ls-tree', '-r', '-z', commit, '--', ...keep.slice(i, i + 200)]);
    for (const line of out.split('\0').filter(Boolean)) { const [info, p] = line.split('\t'); if (info.startsWith('100755')) exec.add(p); }
  }
  for (const f of files) {
    const out = path.resolve(root, f.path);
    if (!out.startsWith(root + path.sep)) continue;
    if (f.status === 'D') { fs.rmSync(out, { force: true }); continue; }
    const buf = await blob(srcCwd, commit, f.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    if (exec.has(f.path) && process.platform !== 'win32') fs.chmodSync(out, 0o755);
  }
}

function clearAll() { disabled.clear(); fs.rmSync(DIR, { recursive: true, force: true }); }

module.exports = { take, changes, diff, restore, exportFiles, clearAll, available: () => !!gitPath() };
