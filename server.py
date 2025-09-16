#!/usr/bin/env python3
"""
Simple static file server
Serves files from the 'src' directory on port 3000
"""

import http.server
import socketserver
import os
import sys
from pathlib import Path

PORT = 3000
HOST_PATH = 'docs'

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Set the directory to serve files from
        super().__init__(*args, directory=os.path.join(os.path.dirname(__file__), HOST_PATH), **kwargs)
    
    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

def main():
    
    # Check if directory exists
    public_path = Path(__file__).parent / HOST_PATH
    if not public_path.exists():
        print(f"Error: {HOST_PATH} directory not found at {public_path}")
        sys.exit(1)
    
    # Create server
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"Serving files from {HOST_PATH} directory at http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main() 
