from http.server import BaseHTTPRequestHandler
import os
import json

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        env_keys_str = os.environ.get("GEMINI_API_KEYS", os.environ.get("GEMINI_API_KEY", ""))
        env_keys_str = env_keys_str.replace('"', '').replace("'", "")
        keys = [k.strip() for k in env_keys_str.split(",") if k.strip()]
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        response = {"gemini_keys": keys}
        self.wfile.write(json.dumps(response).encode('utf-8'))
        return
