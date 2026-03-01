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

# Configure Gemini
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    logger.warning("GEMINI_API_KEY environment variable not set. Summarization will fail if not provided.")
    client = None
else:
    client = genai.Client(api_key=api_key)

def run_research_agent(topic):
    """Main orchestration function for the research agent using Gemini Search Grounding."""
    logger.info(f"Starting research agent for topic: {topic}")
    
    if not client:
        return {"topic": topic, "summary": "Failed to generate summary: GEMINI_API_KEY is missing.", "resources": []}
        
    try:
        prompt = f"""
        You are an expert AI educational assistant researching the topic: "{topic}".
        Use your Google Search tool to find educational websites with text knowledge about this topic (like coding sites, tutorials, explanations, etc.).
        CRITICAL: Do not use Wikipedia, peer-reviewed academic papers, or journals. Provide resources from general web educational sources.
        
        You must return your entire response as a single valid JSON object. Do not include markdown formatting like ```json or anything else outside the JSON object.
        Follow this strict JSON structure:
        {{
            "summary": "Your detailed summary including headings and bold text formatted in markdown. Make sure to clearly outline the main concepts and provide a balanced overview. Use STRICT and CLEAN Markdown.",
            "resources": [
                {{
                    "title": "Site Title",
                    "url": "https://original-url.com/...",
                    "snippet": "Short description of the resource."
                }}
            ]
        }}
        """
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[{"google_search": {}}],
                temperature=0.2
            )
        )
        
        raw_text = response.text
        # Clean up possible markdown code blocks around json
        raw_text = re.sub(r'```json\n?', '', raw_text)
        raw_text = re.sub(r'```\n?', '', raw_text)
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
