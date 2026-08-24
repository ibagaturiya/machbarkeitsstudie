#!/usr/bin/env python3
"""Local static server for the tool.

Plain `python3 -m http.server` is what the build plan suggests (section 2),
but its default caching headers make edited JS/JSON files silently stale in
the browser -- a real problem for this project's no-build-step architecture,
where there's no bundler hash to invalidate anything. This subclass just
disables caching so a reload always picks up the current files.

Usage: python3 serve.py   (then open http://localhost:8000)
"""
import http.server, socket, socketserver

PORT = 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

class DualStackServer(socketserver.ThreadingTCPServer):
    """IPv6 socket with V6ONLY off, so one listener answers on both stacks.

    Threading, not the plain TCPServer: the browser opens several parallel
    connections for the JS files and map tiles, and a single-threaded server
    serves them one at a time -- one slow or kept-alive connection then
    wedges the whole server and the page stops loading entirely.

    Dual stack, not plain AF_INET: on macOS `localhost` resolves to ::1
    first, and an IPv4-only listener refuses that connection. curl quietly
    retries over 127.0.0.1 and looks fine, but Chrome shows a plain "site
    can't be reached" on http://localhost:8000 while the server is running
    and serving perfectly -- which is exactly as confusing as it sounds.
    """
    address_family = socket.AF_INET6
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass  # no IPv6 here; the IPv4 fallback below takes over
        super().server_bind()


class IPv4Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    try:
        server = DualStackServer(("::", PORT), NoCacheHandler)
    except OSError:
        server = IPv4Server(("", PORT), NoCacheHandler)
    with server as httpd:
        print(f"Serving on http://localhost:{PORT} (no-cache)")
        httpd.serve_forever()
