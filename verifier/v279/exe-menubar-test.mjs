// v279 打包实测: 启动 exe (hideTitleBar=true 已在 userData settings.json), 整屏截图验证菜单栏可见
// 用法: node verifier/v279/exe-menubar-test.mjs <exe路径>
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) { console.error('usage: node exe-menubar-test.mjs <exe>'); process.exit(1); }

const shot = path.join(dir, 'menubar-shot.png');
const ps = `
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('${shot.replace(/\\/g, '/')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SHOT_OK $b.Width x $b.Height"
`;

console.log('launching:', exe);
const appRoot = path.resolve(dir, '../..'); // app 目录 (main.cjs 入口)
const child = spawn(exe, ['.'], { cwd: appRoot, detached: true, stdio: 'ignore' });
child.unref();
await new Promise(r => setTimeout(r, 10000)); // 等首跑/加载
try {
  const out = execSync(`powershell -NoProfile -Command "${ps.replace(/\n/g, '; ').replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
  console.log(out.trim());
} catch (e) { console.error('screenshot failed:', e.message); }
// 关 exe (按可执行文件名)
try { execSync(`powershell -NoProfile -Command "Get-Process | Where-Object { $_.Path -eq '${exe.replace(/\\/g, '\\\\').replace(/'/g, "''")}' } | Stop-Process -Force"`); } catch {}
console.log('DONE');
