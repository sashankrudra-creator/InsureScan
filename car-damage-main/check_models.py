import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv(override=True)

# Try plural first
keys_env = os.getenv('GOOGLE_API_KEYS')
if keys_env:
    api_key = keys_env.split(',')[0].strip()
else:
    api_key = os.getenv('GOOGLE_API_KEY')

if not api_key:
    print("ERROR: No API Key found in .env")
    exit(1)

print(f"Testing key ending in: {api_key[-5:]}")
genai.configure(api_key=api_key)

try:
    print("Fetching available models...")
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f" - {m.name}")
    print("\n✅ KEY IS ACTIVE AND WORKING!")
except Exception as e:
    print(f"\n❌ KEY FAILED!")
    print(f"Error Message: {str(e)}")
