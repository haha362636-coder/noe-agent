// electron-builder afterPack 钩子（只给 Windows 版用）：
// 在 macOS 上没有 Wine 就没法用 rcedit，这里改用纯 JS 的 resedit 给 Noe Agent.exe 换上图标和版本信息，
// 否则任务栏 / 任务管理器里显示的是 Electron 的默认图标和名字。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const { load } = require(process.env.NOE_RESEDIT_CJS);
  const ResEdit = await load();
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const version = ctx.packager.appInfo.version;
  const name = ctx.packager.appInfo.productName;

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  // 图标
  const ico = ResEdit.Data.IconFile.from(makeIco(path.join(ctx.packager.info.projectDir, 'build', 'icon.png')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));

  // 版本信息（任务管理器显示的是 FileDescription）
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const nums = (version.match(/\d+/g) || []).map(Number).slice(0, 3);
    while (nums.length < 4) nums.push(0);
    vi.setFileVersion(...nums); vi.setProductVersion(...nums);
    for (const lang of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(lang, {
        FileDescription: name, ProductName: name, InternalName: name, OriginalFilename: path.basename(exePath),
        CompanyName: name, LegalCopyright: ctx.packager.config.copyright || '', FileVersion: version, ProductVersion: version,
      });
    }
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • 已写入 exe 图标和版本信息  file=${path.basename(exePath)}`);
};

// 用 macOS 自带的 sips 缩放出多个尺寸，拼成 PNG 内嵌式 .ico
function makeIco(png) {
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'noe-ico-'));
  const imgs = sizes.map((s) => {
    const out = path.join(tmp, `${s}.png`);
    execFileSync('sips', ['-z', String(s), String(s), png, '--out', out], { stdio: 'ignore' });
    return fs.readFileSync(out);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}
