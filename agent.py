import os
import json
import re
from google import genai
from google.genai import types
from dotenv import load_dotenv
import logging

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Fallback pool of API keys to prevent Quota Exhaustion limits
env_keys_str = os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", ""))
GEMINI_API_KEYS = [k.strip() for k in env_keys_str.split(",") if k.strip()]

# Filter out None and remove duplicates while preserving order
GEMINI_API_KEYS = list(dict.fromkeys(k for k in GEMINI_API_KEYS if k))

def run_research_agent(topic):
    """Main orchestration function for the research agent using Gemini Search Grounding."""
    logger.info(f"Starting research agent for topic: {topic}")
    
    if not GEMINI_API_KEYS:
        return {"topic": topic, "summary": "Failed to generate summary: No GEMINI API Keys available.", "resources": []}
        
    prompt = f"""
    You are an expert AI educational assistant researching the topic: "{topic}".
    Use your Google Search tool to find educational websites with text knowledge about this topic (like coding sites, tutorials, explanations, etc.).
    
    CRITICAL INSTRUCTIONS:
    1. Do not use Wikipedia, peer-reviewed academic papers, or journals. Provide resources from general web educational sources.
    2. For any URL you provide, you MUST provide the FULL, TRUE, DIRECT URL (e.g. https://www.example.com/page). 
    3. NEVER use relative URLs like /grounding-api-redirect/...
    
    You must return your entire response as a single valid JSON object. Do not include markdown formatting like ```json or anything else outside the JSON object.
    Follow this strict JSON structure:
    {{
        "summary": "Your detailed summary including headings and bold text formatted in markdown. Make sure to clearly outline the main concepts and provide a balanced overview. Use STRICT and CLEAN Markdown. DO NOT include relative grounding redirect links in the text.",
        "resources": [
            {{
                "title": "Site Title",
                "url": "https://www.original-authoritative-url.com/exact-page",
                "snippet": "Short description of the resource."
            }}
        ]
    }}
    """
    
    response = None
    last_error = None
    
    for idx, key in enumerate(GEMINI_API_KEYS):
        try:
            logger.info(f"Trying Gemini API key {idx + 1}/{len(GEMINI_API_KEYS)}...")
            client = genai.Client(api_key=key)
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[{"google_search": {}}],
                    temperature=0.2
                )
            )
            # If successful, break out of the loop
            break
        except Exception as e:
            error_msg = str(e).lower()
            last_error = e
            logger.warning(f"Key {idx + 1} failed: {e}")
            # If it's a 429 (Resource Exhausted), try next key, else it might be a fatal error
            if "429" in error_msg or "exhausted" in error_msg or "quota" in error_msg:
                continue
            else:
                # Fatal error that is not quota related
                break

    if not response:
        logger.error(f"All keys exhausted or a failure occurred. Last Error: {last_error}")
        return {
            "topic": topic,
            "summary": f"Failed to generate research (Quota Exhausted/API Error). Please try again later.",
            "resources": []
        }
        
    try:
        raw_text = response.text
        # Clean up possible markdown code blocks around json
        raw_text = re.sub(r'```json\n?', '', raw_text)
        raw_text = re.sub(r'```\n?', '', raw_text)
        
        # Fallback safeguard: if Gemini still returns relative grounding-api-redirect URLs, 
        # prepend the domain so it actually resolves correctly.
        raw_text = re.sub(r'(["\']|\[.*?\]\()/grounding-api-redirect/', r'\1https://www.google.com/search/grounding-api-redirect/', raw_text)
        
        raw_text = raw_text.strip()
        
        try:
            data = json.loads(raw_text)
            return {
                "topic": topic,
                "summary": data.get("summary", "No summary generated."),
                "resources": data.get("resources", [])
            }
        except json.JSONDecodeError as e:
            logger.error(f"JSON Parsing Error: {e}. Raw Text: {raw_text}")
            return {
                "topic": topic,
                "summary": "Failed to parse the AI response. Please try again.",
                "resources": []
            }

    except Exception as e:
        logger.error(f"Error during research agent execution: {e}")
        return {
            "topic": topic,
            "summary": f"An error occurred during research: {e}",
            "resources": []
        }
