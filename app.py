from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import logging
import os

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

logging.basicConfig(level=logging.INFO)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/transcript/<video_id>', methods=['GET'])
def get_transcript(video_id):
    try:
        logging.info(f"Fetching transcript for video: {video_id}")
        
        # Follow the documentation provided: 
        # Instantiate the API and use .fetch()
        ytt_api = YouTubeTranscriptApi()
        fetched_transcript = ytt_api.fetch(video_id)
        
        # The FetchedTranscript object is iterable and each item has a 'text' attribute
        full_text = " ".join([snippet.text for snippet in fetched_transcript])
        
        return jsonify({
            "video_id": video_id,
            "transcript": full_text
        })
    except Exception as e:
        logging.error(f"Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
