from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
import logging
import os
import requests
import re
import random

app = Flask(__name__)
CORS(app)

logging.disable(logging.CRITICAL)


# Invidious instances for fallback (Free API)
INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net",
    "https://yewtu.be",
    "https://vid.puffyan.us",
    "https://invidious.drg.li",
    "https://invidious.jing.rocks"
]

def clean_vtt(vtt_text):
    """Cleans VTT content to plain text."""
    lines = vtt_text.splitlines()
    cleaned_lines = []
    last_line = ""
    
    for line in lines:
        line = line.strip()
        # Skip headers, empty lines, and timestamps
        if not line or line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r'^(?:\d{2}:)?\d{2}:\d{2}\.\d{3} --> (?:\d{2}:)?\d{2}:\d{2}\.\d{3}', line):
            continue
        
        # Remove tags
        line = re.sub(r'<[^>]+>', '', line)
        
        # Basic deduplication for rolling captions
        if line != last_line:
             cleaned_lines.append(line)
             last_line = line
             
    return " ".join(cleaned_lines)

def fetch_from_invidious(video_id):
    """Fetches transcript from public Invidious instances."""
    instances = INVIDIOUS_INSTANCES.copy()
    random.shuffle(instances)
    
    for instance in instances[:2]:
        try:
            # 1. Get Captions List
            resp = requests.get(f"{instance}/api/v1/captions/{video_id}", timeout=2.5)
            if resp.status_code != 200:
                continue
            
            data = resp.json()
            captions = data.get('captions', [])
            if not captions:
                continue
            
            # 2. Find English track
            selected_track = next((c for c in captions if c.get('languageCode') == 'en'), None)
            
            track_url = ""
            if selected_track:
                 track_url = f"{instance}{selected_track['url']}"
            else:
                 # Fallback: get first available and auto-translate
                 if captions:
                    first_track = captions[0]
                    track_url = f"{instance}{first_track['url']}&tlang=en"
            
            if track_url:
                track_resp = requests.get(track_url, timeout=2.5)
                if track_resp.status_code == 200:
                    return clean_vtt(track_resp.text)
        except Exception as e:
            logging.warning(f"Invidious instance {instance} failed: {e}")
            continue
            
    return None

@app.route('/transcript/<video_id>', methods=['GET'])

def get_transcript(video_id):
    try:
        logging.info(f"Fetching transcript for video: {video_id}")
        
        # Configure Proxies from Environment Variable
        proxies = None
        if os.environ.get("YOUTUBE_PROXY"):
            proxy_url = os.environ.get("YOUTUBE_PROXY")
            proxies = {"http": proxy_url, "https": proxy_url}

        # Get the list of available transcripts
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id, proxies=proxies)
        except Exception as list_error:
            # If listing fails, try direct fetch (default behavior)
            logging.warning(f"Failed to list transcripts, trying direct fetch: {list_error}")
            try:
                fetched_transcript = YouTubeTranscriptApi.get_transcript(video_id, proxies=proxies)
                full_text = " ".join([snippet['text'] for snippet in fetched_transcript])
                return jsonify({
                    "video_id": video_id,
                    "transcript": full_text
                })
            except Exception as fetch_error:
                 raise fetch_error

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
        
        # Extract text (fetched_transcript is a list of dicts)
        full_text = " ".join([snippet['text'] for snippet in fetched_transcript])
        
        return jsonify({
            "video_id": video_id,
            "transcript": full_text,
            "language_code": transcript.language_code,
            "is_generated": transcript.is_generated
        })

    except Exception as e:
        logging.warning(f"Primary Youtube API failed: {e}. Trying Invidious fallback...")
        
        # Fallback to Invidious
        fallback_text = fetch_from_invidious(video_id)
        if fallback_text:
             logging.info("Invidious fallback successful.")
             return jsonify({
                "video_id": video_id,
                "transcript": fallback_text,
                "source": "invidious_fallback"
            })

        status_code = 500
        error_msg = str(e)
        if "No transcript found" in error_msg:
             status_code = 404
        
        logging.error(f"Error: {error_msg}")
        return jsonify({"error": error_msg}), status_code



@app.route('/verify-recaptcha', methods=['POST'])
def verify_recaptcha():
    try:
        data = request.get_json()
        token = data.get('token')
        action = data.get('action') # Expecting action from frontend
        
        if not token:
             return jsonify({'success': False, 'error': 'No token provided'}), 400

        # reCAPTCHA Enterprise Configuration
        project_id = "aidube"
        site_key = "6LcL004sAAAAALsn74XuPBG2bSC19YId79_PT6rB"
        api_key = "AIzaSyDFkjR_NuVsXkB13M7oVTzqWq-ukvtx5dU"
        
        verify_url = f"https://recaptchaenterprise.googleapis.com/v1/projects/{project_id}/assessments?key={api_key}"
        
        payload = {
            "event": {
                "token": token,
                "expectedAction": action,
                "siteKey": site_key,
            }
        }
        
        response = requests.post(verify_url, json=payload)
        result = response.json()
        
        # Check if the token is valid
        if result.get('tokenProperties', {}).get('valid') == True:
             # Check if the expected action matches
             if result.get('tokenProperties', {}).get('action') == action:
                 # Check risk score if needed, for now just pass
                 # score = result.get('riskAnalysis', {}).get('score')
                 return jsonify({'success': True, 'score': result.get('riskAnalysis', {}).get('score')}), 200
             else:
                 return jsonify({'success': False, 'error': 'Invalid action'}), 400
        else:
            return jsonify({'success': False, 'error': result.get('tokenProperties', {}).get('invalidReason')}), 400
            
    except Exception as e:
        logging.error(f"Recaptcha verification failed: {e}")
        return jsonify({'error': str(e)}), 500

# Check for main execution is not required in serverless environment

@app.route('/api/config', methods=['GET'])
def get_config():
    env_keys_str = os.environ.get("GEMINI_API_KEYS", os.environ.get("GEMINI_API_KEY", ""))
    env_keys_str = env_keys_str.replace('"', '').replace("'", "")
    keys = [k.strip() for k in env_keys_str.split(",") if k.strip()]
    return jsonify({"gemini_keys": keys}), 200
