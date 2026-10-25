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
env_keys_str = env_keys_str.replace('"', '').replace("'", "")
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
        for candidate_model in ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash']:
            try:
                client = genai.Client(api_key=key)
                response = client.models.generate_content(
                    model=candidate_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}],
                        temperature=0.2
                    )
                )
                break
            except Exception as e:
                error_msg = str(e).lower()
                last_error = e
                if "429" in error_msg or "exhausted" in error_msg or "quota" in error_msg:
                    break # try next key
                continue # try next candidate model
        if response:
            break

    if not response:
        logger.error("All keys or candidate models exhausted")
        return {
            "topic": topic,
            "summary": "Failed to generate research. Please verify your GEMINI_API_KEY configuration.",
            "resources": []
        }
        
    try:
        raw_text = response.text
        # Clean up possible markdown code blocks around json
        raw_text = re.sub(r'```json\n?', '', raw_text)
        raw_text = re.sub(r'```\n?', '', raw_text)
        
        raw_text = re.sub(r'(["\']|\[.*?\]\()/grounding-api-redirect/', r'\1https://www.google.com/search/grounding-api-redirect/', raw_text)
        raw_text = raw_text.strip()
        
        try:
            data = json.loads(raw_text)
            return {
                "topic": topic,
                "summary": data.get("summary", "No summary generated."),
                "resources": data.get("resources", [])
            }
        except json.JSONDecodeError:
            logger.error("JSON Parsing Error in research agent")
            return {
                "topic": topic,
                "summary": "Failed to parse the AI response. Please try again.",
                "resources": []
            }

    except Exception:
        logger.error("Error during research agent execution")
        return {
            "topic": topic,
            "summary": "An error occurred during research. Please try again later.",
            "resources": []
        }
