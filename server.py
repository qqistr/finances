#!/usr/bin/env python3
"""
Simple local development server for EcomVision Finances web app.
Usage: python3 server.py [port]
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def run():
    socketserver.TCPServer.allow_reuse_address = True
    for port in range(PORT, PORT + 20):
        try:
            with socketserver.TCPServer(("", port), Handler) as httpd:
                print(f"✨ EcomVision Finances web app is running at:")
                print(f"👉 http://localhost:{port}")
                print(f"Press Ctrl+C to stop.")
                httpd.serve_forever()
                break
        except OSError:
            continue

if __name__ == "__main__":
    run()
