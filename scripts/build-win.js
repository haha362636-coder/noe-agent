// 在 macOS 上交叉打包 Windows 版（x64），和 Mac 版完全分开：
//   暂存目录  build-win/      （复制一份 electron/ server/ public/，单独的 package.json）
//   打包输出  dist-win/       （electron-builder 的中间产物）
//   最终产物  release-win/    （安装包 .exe + 免安装 .zip + SHA256SUMS.txt）
// Mac 版的 package.json、dist/、release/ 都不会被改动。
// 用法：npm run dist:win
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'build-win');
const OUT = path.join(ROOT, 'dist-win');
const RELEASE = path.join(ROOT, 'release-win');
const PTY_VERSION = '1.2.0-beta.15'; // @lydell/node-pty：自带 Windows 预编译 ConPTY，无需在 Windows 上编译

const root = require(path.join(ROOT, 'package.json'));
const electronVersion = require(path.join(ROOT, 'node_modules/electron/package.json')).version;
const run = (cmd, cwd = ROOT) => { console.log(`\n$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };

// 1. 暂存应用文件
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const dir of ['electron', 'server', 'public', 'build']) fs.cpSync(path.join(ROOT, dir), path.join(STAGE, dir), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(STAGE, 'LICENSE'));

// 2. Windows 专用 package.json
const pkg = {
  name: root.name, productName: root.productName, version: root.version, description: root.description,
  license: root.license, author: root.author, homepage: root.homepage, main: root.main,
  dependencies: { '@lydell/node-pty': PTY_VERSION },
  build: {
    appId: root.build.appId, productName: root.build.productName, copyright: root.build.copyright,
    electronVersion,
    directories: { output: OUT, buildResources: 'build' },
    files: ['electron/**', 'server/**', 'public/**', 'package.json', 'node_modules/**', '!server/pty_bridge.py'],
    asarUnpack: ['node_modules/@lydell/**'], // conpty.dll / OpenConsole.exe 必须在 asar 外才能被加载
    npmRebuild: false, // 预编译的 N-API 模块，不能（也不需要）在 macOS 上重编
    afterPack: path.join(__dirname, 'win-after-pack.js'), // 给 exe 换图标和版本信息
    win: {
      icon: 'build/icon.png',
      target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
      artifactName: 'Noe-Agent-${version}-win-${arch}.${ext}',
      // rcedit 在 macOS 上要 Wine；图标和版本信息改由 afterPack 钩子用 resedit 写入
      signAndEditExecutable: false,
    },
    nsis: {
      oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Noe Agent',
      uninstallDisplayName: 'Noe Agent',
      artifactName: 'Noe-Agent-${version}-win-${arch}-setup.${ext}',
    },
  },
};
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2));

// 3. 只装 Windows x64 的预编译 node-pty
run('npm install --omit=dev --os=win32 --cpu=x64 --no-audit --no-fund --no-package-lock', STAGE);
const native = path.join(STAGE, 'node_modules/@lydell/node-pty-win32-x64');
if (!fs.existsSync(native)) throw new Error('没有装上 @lydell/node-pty-win32-x64，Windows 内置终端会不可用');

// 4. 打包（resedit 装在暂存目录的 .tools 里，只在打包时用，不进安装包）
const TOOLS = path.join(STAGE, '.tools');
run(`npm install --prefix "${TOOLS}" resedit@3.1.0 --no-audit --no-fund --no-package-lock`);
process.env.NOE_RESEDIT_CJS = path.join(TOOLS, 'node_modules/resedit/cjs.cjs');
fs.rmSync(OUT, { recursive: true, force: true });
run(`npx electron-builder --win --x64 --projectDir "${STAGE}" --publish never`);

// 5. 整理到 release-win/
fs.mkdirSync(RELEASE, { recursive: true });
const files = fs.readdirSync(OUT).filter((f) => f.includes(root.version) && /\.(exe|zip)$/.test(f));
const sums = [];
for (const f of files) {
  fs.copyFileSync(path.join(OUT, f), path.join(RELEASE, f));
  sums.push(`${crypto.createHash('sha256').update(fs.readFileSync(path.join(RELEASE, f))).digest('hex')}  ${f}`);
}
fs.writeFileSync(path.join(RELEASE, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`\n✓ Windows 版已输出到 release-win/：\n  ${files.join('\n  ')}`);
