import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv(override=True)

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    print("No API key found in environment variables.")
    # Fallback to the hardcoded key if env fails, just for this test
    # api_key = "AIzaSyAi59x6Dxknr5CgFvGqtNz-VvG-GG2smVE" 
    print("Please set the GOOGLE_API_KEY in the .env file.")
else:
    print(f"API Key loaded. Starts with: {api_key[:10]}...")

if api_key:
    genai.configure(api_key=api_key)

# Try a few likely model names
models_to_test = ['gemini-1.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-pro']
 


for model_name in models_to_test:
    print(f"\nTesting model: {model_name}")
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content("Hello, can you hear me?")
        print(f"✅ SUCCESS with {model_name}!")
        print(f"Response: {response.text}")
        break # Stop after first success
    except Exception as e:
        print(f"❌ FAILED with {model_name}")
        # print(f"Error details: {e}") # Uncomment for full traceback if needed
        if "429" in str(e) or "ResourceExhausted" in str(e):
             print("  -> Quota exhausted (Rate Limit). This is common for free tier.")
        else:
             print(f"  -> Error: {str(e)[:100]}...") # Print first 100 chars of error
