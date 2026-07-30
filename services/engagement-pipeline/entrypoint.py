#!/usr/bin/env python3
import os
import subprocess
import time
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", "8080"))
RUNBOOK = os.environ.get("RUNBOOK_TO_RUN", "06-render-html-report.sh")
CLOUD_SQL_CONNECTION_NAME = os.environ.get("CLOUD_SQL_CONNECTION_NAME", "")
REPORT_FILE_PATH = os.environ.get("REPORT_FILE_PATH", "")

def start_cloud_sql_proxy():
    if not CLOUD_SQL_CONNECTION_NAME:
        print("No CLOUD_SQL_CONNECTION_NAME set, skipping proxy startup", flush=True)
        return
    print(f"Starting Cloud SQL Proxy for {CLOUD_SQL_CONNECTION_NAME} on 127.0.0.1:5432", flush=True)
    subprocess.Popen(
        ["/usr/local/bin/cloud-sql-proxy", "--port", "5432", CLOUD_SQL_CONNECTION_NAME],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    for _ in range(30):
        try:
            with socket.create_connection(("127.0.0.1", 5432), timeout=1):
                print("Cloud SQL Proxy is ready.", flush=True)
                return
        except OSError:
            time.sleep(1)
    print("WARNING: Cloud SQL Proxy did not become ready within 30 seconds.", flush=True)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.run_and_respond()

    def do_POST(self):
        self.run_and_respond()

    def run_and_respond(self):
        try:
            env = os.environ.copy()
            env["PGHOST"] = "127.0.0.1"
            env["PGPORT"] = "5432"
            result = subprocess.run(
                ["bash", f"./ops/runbooks/{RUNBOOK}"],
                capture_output=True, text=True, timeout=850, env=env,
            )
            log_output = result.stdout + "\n" + result.stderr
            print(log_output, flush=True)

            if result.returncode != 0:
                body = log_output.encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if REPORT_FILE_PATH and os.path.isfile(REPORT_FILE_PATH):
                with open(REPORT_FILE_PATH, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                body = log_output.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        except subprocess.TimeoutExpired:
            body = b"Runbook execution timed out."
            self.send_response(504)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = f"Unexpected error: {e}".encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")

if __name__ == "__main__":
    start_cloud_sql_proxy()
    print(f"Starting HTTP server on port {PORT}, will execute ops/runbooks/{RUNBOOK} on request", flush=True)
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
