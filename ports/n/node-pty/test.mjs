// @test-platforms: openharmony
// @test-platform-reason: PTY 功能测试需要真实 TTY 会话与平台原生 binding；CI consumer 环境在 darwin 上上游 spawn-helper posix_spawnp 失败、win32 无头 AttachConsole 失败、linux-x64 上游装期 node-gyp 产物无输出。桌面平台行为与本 port 无关（darwin/win32 上游预编译原样随包发布），真机 OpenHarmony 上签名预编译 binding 通过真实 spawn/stdio/resize/exit 验证。
import assert from 'node:assert/strict';

// 真实 PTY 功能验证：require、spawn、stdout 交互、stdin 写入、
// resize、退出状态。全部用 process.execPath（node）做子进程，
// 保证在容器、真机和 Windows 消费矩阵上都可用。
export default function test({ requirePackage }) {
  const pty = requirePackage('node-pty');

  const collect = (term) => { let buf = ''; term.onData((d) => { buf += d; }); return () => buf; };
  const waitFor = (pred, ms = 15000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (pred()) { clearInterval(timer); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(timer); reject(new Error('waitFor timeout')); }
    }, 20);
  });

  async function run() {
    // 1. require + spawn：子进程 stdout 经 PTY 主端回流
    {
      const term = pty.spawn(process.execPath, ['-e', 'console.log("hello-pty-out")'], {
        name: 'xterm', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
      });
      const getBuf = collect(term);
      const exit = new Promise((r) => term.onExit(r));
      await waitFor(() => getBuf().includes('hello-pty-out'));
      term.kill();
      const { exitCode } = await exit;
      assert.equal(exitCode, 0, 'child exit code');
    }

    // 2. 退出状态码透传
    {
      const term = pty.spawn(process.execPath, ['-e', 'process.exit(42)'], {
        name: 'xterm', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
      });
      const { exitCode } = await new Promise((r) => term.onExit(r));
      assert.equal(exitCode, 42, 'exit code passthrough');
    }

    // 3. stdin 交互 + resize：子进程逐行回显当前 tty 行数
    {
      const script = [
        "require('readline').createInterface({input:process.stdin}).on('line',()=>{",
        'console.log("rows="+process.stdout.rows);});',
      ].join('');
      const term = pty.spawn(process.execPath, ['-e', script], {
        name: 'xterm', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
      });
      const getBuf = collect(term);
      const waitRows = (n) => waitFor(() => {
        const hits = getBuf().match(/rows=(\d+)/g) || [];
        return hits.includes('rows=' + n);
      });
      term.write('\n');
      await waitRows(24);
      term.resize(123, 30);
      term.write('\n');
      await waitRows(30);
      term.kill();
      await new Promise((r) => term.onExit(r));
    }

    return { result: { spawn: true, stdio: true, resize: true, exitCode: true }, assets: [] };
  }

  return run();
}
