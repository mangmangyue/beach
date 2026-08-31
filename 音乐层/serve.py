#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""音乐层的本地预览服务器。

  python3 音乐层/serve.py [端口]      默认 8781
  → http://localhost:8781/音乐层/预览.html

用 ThreadingHTTPServer 而不是 `python3 -m http.server`：
后者是单线程的，唱片架一次并发拉十张封面时会随机丢连接（ERR_SOCKET_NOT_CONNECTED），
看起来像图挂了，其实是服务器的问题。
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PROJ = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # 开 keep-alive，少握手少丢连接

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PROJ, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # 改了就刷新，不用清缓存
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8781
    print("→ http://localhost:%d/音乐层/预览.html" % port)
    print("→ http://localhost:%d/音乐层/UI组件预览.html" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
