#!/usr/bin/env python3
"""E2E 测试驱动：启动本地服务器 + 无头 Chromium，收集 test/e2e.html 上报的结果。

用法: python3 test/run.py [chrome路径]
默认依次尝试: $CHROME_BIN、chromium、google-chrome、Playwright 缓存的 headless shell。
"""
import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = '/tmp/imgcompressor-e2e-results.jsonl'
PORT = 8931
TIMEOUT = 180


def find_chrome():
    candidates = [
        os.environ.get('CHROME_BIN', ''),
        shutil.which('chromium') or '',
        shutil.which('chromium-browser') or '',
        shutil.which('google-chrome') or '',
    ]
    pw_cache = os.path.expanduser('~/.cache/ms-playwright')
    if os.path.isdir(pw_cache):
        for entry in sorted(os.listdir(pw_cache), reverse=True):
            for sub in ('chrome-linux/chrome', 'chrome-linux64/chrome',
                        'chrome-headless-shell-linux64/chrome-headless-shell'):
                candidates.append(os.path.join(pw_cache, entry, sub))
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/report':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            with open(RESULTS, 'ab') as fh:
                fh.write(body + b'\n')
            self.send_response(204)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


def main():
    chrome = sys.argv[1] if len(sys.argv) > 1 else find_chrome()
    if not chrome:
        print('未找到 Chrome/Chromium，请通过参数或 CHROME_BIN 指定路径')
        return 2

    open(RESULTS, 'w').close()
    handler = functools.partial(Handler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    proc = subprocess.Popen([
        chrome, '--headless', '--disable-gpu', '--no-sandbox',
        '--disable-dev-shm-usage', '--remote-debugging-port=0',
        f'http://127.0.0.1:{PORT}/test/e2e.html',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    deadline = time.time() + TIMEOUT
    finished = False
    while time.time() < deadline:
        with open(RESULTS, 'rb') as fh:
            if b'ALL DONE' in fh.read():
                finished = True
                break
        time.sleep(0.5)

    proc.terminate()
    server.shutdown()

    if not finished:
        print('测试超时未完成')
        return 2

    failed = 0
    with open(RESULTS, 'r', encoding='utf-8') as fh:
        for raw in fh:
            rec = json.loads(raw)
            status = 'PASS' if rec['pass'] else 'FAIL'
            if not rec['pass']:
                failed += 1
            print(f"[{status}] {rec['name']}  {rec['detail']}")
    print(f'\n{"全部通过" if failed == 0 else f"{failed} 项失败"}')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
