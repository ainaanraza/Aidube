from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import logging
import os

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)

# Vercel handles static files automatically.
# We ONLY define the API route here.

@app.route('/transcript/<video_id>', methods=['GET'])
def get_transcript(video_id):
    try:
        logging.info(f"Fetching transcript for video: {video_id}")
        
        ytt_api = YouTubeTranscriptApi()
        
        # Get the list of available transcripts
        try:
            transcript_list = ytt_api.list(video_id)
        except Exception as list_error:
            # If listing fails, try direct fetch (default behavior)
            logging.warning(f"Failed to list transcripts, trying direct fetch: {list_error}")
            fetched_transcript = ytt_api.fetch(video_id)
            full_text = " ".join([snippet.text for snippet in fetched_transcript])
            return jsonify({
                "video_id": video_id,
                "transcript": full_text
            })

        transcript = None

        # 1. Try to find a manually created English transcript
        try:
            transcript = transcript_list.find_manually_created_transcript(['en'])
        except:
            pass

        # 2. If no manual English, try generated English
        if not transcript:
            try:
                transcript = transcript_list.find_generated_transcript(['en'])
            except:
                pass
        
        # 3. If no English at all, try to find ANY transcript and translate it to English
        if not transcript:
            # Iterate through available transcripts to find a translatable one
            for t in transcript_list:
                if t.is_translatable:
                    try:
                        transcript = t.translate('en')
                        break
                    except Exception as e:
                        logging.warning(f"Translation failed for {t.language_code}: {e}")
                        continue
            
            # If still no transcript (and couldn't translate), try to just get the first available one as fallback
            if not transcript:
                 for t in transcript_list:
                     transcript = t
                     break

        if not transcript:
             return jsonify({"error": "No suitable transcript found"}), 404

        fetched_transcript = transcript.fetch()
        
        # Extract text
        full_text = " ".join([snippet.text for snippet in fetched_transcript])
        
        return jsonify({
            "video_id": video_id,
            "transcript": full_text,
            "language_code": transcript.language_code,
            "is_generated": transcript.is_generated
        })

    except Exception as e:
        logging.error(f"Error: {str(e)}")
        # Try one last absolute fallback if the fancy logic fails
        try:
             ytt_api = YouTubeTranscriptApi()
             fetched_transcript = ytt_api.fetch(video_id)
             full_text = " ".join([snippet.text for snippet in fetched_transcript])
             return jsonify({
                "video_id": video_id,
                "transcript": full_text
            })
        except:
            return jsonify({"error": str(e)}), 500

# Serverless function entry point

