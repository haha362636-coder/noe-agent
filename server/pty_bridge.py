#!/usr/bin/env python3
# 极简伪终端桥：让交互式 CLI（如 claude auth login、/config）在 App 内置终端里运行。
# 用法：pty_bridge.py <cols> <rows> <cmd> [args...]
# stdin → 终端输入；终端输出 → stdout；fd 3 接收 "cols rows\n" 调整窗口大小。
import os, sys, pty, select, struct, fcntl, termios, signal, errno


def set_size(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except OSError:
        pass


def main():
    cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, master = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ.pop('NO_COLOR', None)
        os.environ.pop('FORCE_COLOR', None)
        try:
            os.execvp(argv[0], argv)
        except OSError as e:
            sys.stderr.write('无法启动 %s: %s\r\n' % (argv[0], e))
            os._exit(127)

    set_size(master, cols, rows)
    ctrl = 3
    try:
        os.fstat(ctrl)
    except OSError:
        ctrl = None
    fds = [0, master] + ([ctrl] if ctrl is not None else [])
    ctrl_buf = b''
    while True:
        try:
            r, _, _ = select.select(fds, [], [])
        except InterruptedError:
            continue
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError as e:
                if e.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            os.write(1, data)
        if 0 in r:
            data = os.read(0, 65536)
            if not data:
                fds.remove(0)
            else:
                os.write(master, data)
        if ctrl is not None and ctrl in r:
            data = os.read(ctrl, 1024)
            if not data:
                fds.remove(ctrl)
                ctrl = None
            else:
                ctrl_buf += data
                while b'\n' in ctrl_buf:
                    line, ctrl_buf = ctrl_buf.split(b'\n', 1)
                    try:
                        c, rw = map(int, line.split())
                        set_size(master, c, rw)
                        os.kill(pid, signal.SIGWINCH)
                    except (ValueError, OSError):
                        pass
    _, status = os.waitpid(pid, 0)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)


if __name__ == '__main__':
    main()
