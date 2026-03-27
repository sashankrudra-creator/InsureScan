import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, g
from werkzeug.security import generate_password_hash, check_password_hash
import google.generativeai as genai
from dotenv import load_dotenv
from PIL import Image
import io
import smtplib
from email.mime.text import MIMEText
import datetime

load_dotenv(override=True)

app = Flask(__name__)
app.secret_key = 'super-secret-autoscan-key'

# DATABASE SETUP
# Example: postgres://username:password@localhost:5432/dbname
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/car_damage_db')

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        # Note: psycopg2 needs keyword arguments or a URL for connection
        db = g._database = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        db.autocommit = True
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        with db.cursor() as cur:
            cur.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    is_admin INTEGER DEFAULT 0,
                    plan TEXT DEFAULT 'Free Plan',
                    analysis_count INTEGER DEFAULT 0,
                    last_active TEXT
                )
            ''')
            
            # Ensure default admin exists
            admin_email = 'admin@autoscan.ai'
            cur.execute('SELECT id FROM users WHERE email = %s', (admin_email,))
            existing_admin = cur.fetchone()
            if not existing_admin:
                admin_pass = generate_password_hash('admin123')
                cur.execute('INSERT INTO users (name, email, password, is_admin) VALUES (%s, %s, %s, %s)', 
                           ('System Admin', admin_email, admin_pass, 1))
        # db.commit() is not needed if db.autocommit = True

init_db()

@app.route('/upgrade_plan', methods=['POST'])
def upgrade_plan():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    plan_name = request.json.get('plan', 'Premium Plan')
    db = get_db()
    with db.cursor() as cur:
        cur.execute('UPDATE users SET plan = %s, analysis_count = 0 WHERE id = %s', (plan_name, session['user_id']))
    return jsonify({'success': True})

@app.context_processor
def inject_user():
    user = None
    if 'user_id' in session:
        db = get_db()
        with db.cursor() as cur:
            cur.execute('SELECT id, name, email, is_admin, plan FROM users WHERE id = %s', (session['user_id'],))
            user_row = cur.fetchone()
        if user_row:
            user = dict(user_row)
    return dict(current_user=user)

@app.before_request
def update_last_active():
        db = get_db()
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with db.cursor() as cur:
            cur.execute('UPDATE users SET last_active = %s WHERE id = %s', (now, session['user_id']))



# Configure Gemini AI and API Key Cycling setup
_api_cycle_state = {'index': 0}

def get_api_keys():
    load_dotenv(override=True)
    keys = []
    # Check for GOOGLE_API_KEYS (comma separated)
    keys_env = os.getenv('GOOGLE_API_KEYS')
    if keys_env:
        keys = [str(k).strip() for k in keys_env.split(',') if str(k).strip()]
    
    if not keys:
        # Fallback to single or multiple individual keys (e.g. GOOGLE_API_KEY, GOOGLE_API_KEY_1)
        for key, value in os.environ.items():
            if key.startswith('GOOGLE_API_KEY') and str(value).strip():
                if str(value).strip() not in keys:
                    keys.append(str(value).strip())
    
    return keys

# --- EMAIL NOTIFICATION SETUP ---
notified_keys = set() # Track already notified keys to prevent spam

def send_quota_notification(exhausted_key):
    """Sends an email notification when an API key reaches its quota limit."""
    if exhausted_key in notified_keys:
        return # Skip if already notified
    
    sender_email = os.getenv('EMAIL_USER', 'sashankrudra@gmail.com')
    app_password = os.getenv('EMAIL_APP_PASSWORD') # Must be a Gmail App Password
    target_email = os.getenv('EMAIL_TARGET', 'sashankrudra@gmail.com')

    if not app_password:
        print(f"DEBUG: Skipping email for key {exhausted_key[:10]}... because EMAIL_APP_PASSWORD is not set.")
        return

    subject = "⚠️ AutoScan AI: API Key Quota Exhausted"
    body = f"""
    Hello,
    
    An API key in your AutoScan AI application has reached its quota limit and has been cycled:
    
    Exhausted Key: {exhausted_key[:15]}...{exhausted_key[-5:]}
    Time Detected: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    
    The system has automatically moved to the next available key. Please update your .env file once you refresh your quotas.
    
    Regards,
    AutoScan AI System
    """

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender_email
    msg['To'] = target_email

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(sender_email, app_password)
            server.sendmail(sender_email, target_email, msg.as_string())
        
        notified_keys.add(exhausted_key) # Log as notified
        print(f"SUCCESS: Email notification sent for key ending in ...{exhausted_key[-5:]}")
    except Exception as e:
        print(f"ERROR: Failed to send email notification: {str(e)}")
# ---------------------------------

initial_keys = get_api_keys()
if initial_keys:
    genai.configure(api_key=initial_keys[0])

def get_gemini_response(image):
    # Reload keys dynamically
    available_keys = get_api_keys()
    
    if not available_keys:
        raise ValueError("API Keys not found. Please set GOOGLE_API_KEY or GOOGLE_API_KEYS in .env file.")

    # List of models to try in order of preference
    # Prioritizing 'lite' models which might be less congested/have better availability
    models_to_try = [
        'gemini-1.5-flash',
        'gemini-flash-latest',
        'gemini-2.0-flash-lite-001',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash',
        'gemini-pro-latest'
    ]

    prompt = """
    You are an expert car damage assessor and cost estimator.
    
    IMPORTANT FIRST STEP: Verify if the image clearly contains a car (e.g., hatchback, sedan, SUV, coupe, wagon, etc.).
    If the image DOES NOT contain a car (for example, if it is a motorcycle, bicycle, truck, bus, person, landscape, document, or any other object), you must NOT perform any damage analysis. Instead, output a JSON object with this exact schema:
    {
        "error": "This application is only for analyzing car damages. Please upload an image of a car."
    }
    
    If the image DOES contain a car, proceed with the damage analysis and output a JSON object with this exact schema:
    {
        "vehicle_details": {
            "make": "Vehicle Make",
            "model": "Vehicle Model",
            "year": "Estimated Year",
            "color": "Vehicle Color",
            "license_plate": "License Plate Number (if visible)",
             "type": "Vehicle Type (Sedan, SUV, Truck, etc.)"
        },
        "damages": [
            {
                "part": "Part Name",
                "description": "Description of damage",
                "severity": "Severity Level (Minor, Moderate, Severe)",
                "estimated_cost_inr": "Cost Range INR",
                "estimated_cost_usd": "Cost Range USD"
            }
        ],
        "total_estimated_cost_inr": "Total Range INR",
        "total_estimated_cost_usd": "Total Range USD",
        "recommendations": ["List of 3-5 recommended repairs"],
        "summary": "Brief summary of the overall condition (max 2 sentences)."
    }
    """
    
    generation_config = {
        "temperature": 0.4,
        "top_p": 1,
        "top_k": 32,
        "max_output_tokens": 4096,
        "response_mime_type": "application/json",
    }

    import time
    from google.api_core.exceptions import ResourceExhausted, NotFound

    last_error = None

    for i, model_name in enumerate(models_to_try):
        # Add a small delay before trying the next model to avoid hammering the API
        if i > 0:
            time.sleep(2)
            
        # print(f"DEBUG: Trying model {model_name}...")
        model = genai.GenerativeModel(model_name)
        
        # Retry logic with automatic API key cycling
        max_attempts = len(available_keys) * 2  # Try each key up to 2 times
        base_delay = 2 

        for attempt in range(max_attempts):
            # Configure with the current key in the cycle
            current_key = available_keys[_api_cycle_state['index'] % len(available_keys)]
            genai.configure(api_key=current_key)

            try:
                response = model.generate_content(
                    [prompt, image],
                    generation_config=generation_config
                )
                return response.text
            except ResourceExhausted:
                # Trigger email notification
                send_quota_notification(current_key)
                
                # Automatically cycle to the next key when limit is reached
                _api_cycle_state['index'] += 1
                
                if attempt < max_attempts - 1:
                    sleep_time = base_delay
                    time.sleep(sleep_time)
                    continue
                else:
                    last_error = f"Rate limit exceeded for all keys on {model_name}."
            except NotFound:
                # print(f"DEBUG: Model {model_name} not found, skipping.")
                last_error = f"Model {model_name} not found."
                break # Move to next model immediately
            except ValueError:
                 return json.dumps({
                    "error": "Image analysis blocked by safety filters. Please try another image."
                })
            except Exception as e:
                 last_error = f"API Error with {model_name}: {str(e)}"
                 
                 # Cycle key on generic errors (like invalid key or authentication issues)
                 _api_cycle_state['index'] += 1
                 if attempt < max_attempts - 1:
                     time.sleep(base_delay)
                     continue
                 else:
                     break
        
    # If we've tried all models and failed
    return json.dumps({"error": f"The AI service is currently busy. Last error: {last_error}"})



@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        name = request.form['name']
        email = request.form['email']
        password = request.form['password']
        
        db = get_db()
        with db.cursor() as cur:
            cur.execute('SELECT id FROM users WHERE email = %s', (email,))
            existing_user = cur.fetchone()
        
        if existing_user:
            return render_template('signup.html', error='Email already exists. Please log in.')
            
        # Check if first user
        with db.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM users')
            user_count_row = cur.fetchone()
            user_count = user_count_row['count'] if 'count' in user_count_row else list(user_count_row.values())[0]
            is_admin = 1 if user_count == 0 else 0
            
            hashed_password = generate_password_hash(password)
            cur.execute('INSERT INTO users (name, email, password, is_admin) VALUES (%s, %s, %s, %s) RETURNING id', 
                       (name, email, hashed_password, is_admin))
            new_id = cur.fetchone()['id']
            
        # Auto login
        session['user_id'] = new_id
        return redirect(url_for('profile'))
        
    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        
        db = get_db()
        with db.cursor() as cur:
            cur.execute('SELECT * FROM users WHERE email = %s', (email,))
            user = cur.fetchone()
            
            if user and check_password_hash(user['password'], password):
                # Special case: grant admin if email matches admin@autoscan.ai
                if user['email'] == 'admin@autoscan.ai' and user['is_admin'] == 0:
                    cur.execute('UPDATE users SET is_admin = 1 WHERE id = %s', (user['id'],))
                    # Reload user row
                    cur.execute('SELECT * FROM users WHERE id = %s', (user['id'],))
                    user = cur.fetchone()

                session['user_id'] = user['id']
                # Redirect admins to dashboard, regular users to profile
                if user['is_admin'] == 1:
                    return redirect(url_for('admin_dashboard'))
                return redirect(url_for('profile'))
            else:
                return render_template('login.html', error='Invalid email or password.')
            
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect(url_for('index'))

@app.route('/profile')
def profile():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    db = get_db()
    with db.cursor() as cur:
        cur.execute('SELECT name, email, plan, analysis_count FROM users WHERE id = %s', (session['user_id'],))
        user = cur.fetchone()
    return render_template('profile.html', user=dict(user))


@app.route('/admin')
def admin_panel():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    with db.cursor() as cur:
        cur.execute('SELECT is_admin FROM users WHERE id = %s', (session['user_id'],))
        current_u = cur.fetchone()
        if not current_u or not dict(current_u).get('is_admin'):
            return "Access Denied: You must be an administrator to view this page.", 403
        
        cur.execute('SELECT id, name, email, is_admin FROM users')
        all_users = cur.fetchall()
    return render_template('admin.html', users=[dict(u) for u in all_users])

@app.route('/make_admin')
def make_admin():
    # Hidden route to give yourself admin access easily for demonstration
    if 'user_id' in session:
        db = get_db()
        with db.cursor() as cur:
            cur.execute('UPDATE users SET is_admin = 1 WHERE id = %s', (session['user_id'],))
        return redirect(url_for('admin_panel'))
    return redirect(url_for('login'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/features')
def features():
    return render_template('features.html')

@app.route('/how-it-works')
def how_it_works():
    return render_template('how_it_works.html')

@app.route('/pricing')
def pricing():
    return render_template('pricing.html')

@app.route('/scan-now')
def scan_now():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('scan_now.html')

@app.route('/admin')
def admin_dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    
    db = get_db()
    with db.cursor() as cur:
        cur.execute('SELECT is_admin FROM users WHERE id = %s', (session['user_id'],))
        current = cur.fetchone()
        if not current or current['is_admin'] != 1:
            return "Access Denied: Admin privileges required.", 403
        
        cur.execute('SELECT name, email, is_admin, plan, analysis_count, last_active FROM users ORDER BY last_active DESC')
        users = cur.fetchall()
    return render_template('admin.html', users=users)

@app.route('/transaction')
def transaction():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('transaction.html')

@app.route('/analyze', methods=['POST'])
def analyze_damage():
    if 'user_id' not in session:
        return jsonify({'error': 'Please log in to perform analysis.', 'redirect': url_for('login')}), 401

    db = get_db()
    with db.cursor() as cur:
        cur.execute('SELECT plan, analysis_count FROM users WHERE id = %s', (session['user_id'],))
        user = cur.fetchone()
        
        if user:
            plan = str(user['plan']).lower()
            analysis_count = user['analysis_count'] if user['analysis_count'] is not None else 0
            if 'free' in plan and analysis_count >= 5:
                return jsonify({
                    'error': 'You have reached your 5 free analysis limit. Please upgrade your plan.',
                    'redirect': url_for('transaction')
                }), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No file part'})
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'})
    
    if file:
        try:
            # Read the image file
            image_bytes = file.read()
            image = Image.open(io.BytesIO(image_bytes))
            
            # Get response from Gemini
            gemini_response = get_gemini_response(image)
            print(f"DEBUG - Raw Gemini Response: {gemini_response}") # Log to console

            # It should be valid JSON now, but let's be safe
            try:
                result = json.loads(gemini_response)
                
                # Increment analysis count if the response doesn't contain an error
                if not result.get('error'):
                    with db.cursor() as cur:
                        cur.execute('UPDATE users SET analysis_count = COALESCE(analysis_count, 0) + 1 WHERE id = %s', (session['user_id'],))
                    
                return jsonify(result)
            except json.JSONDecodeError as e:
                print(f"JSON Decode Error: {e}")
                return jsonify({
                    'error': 'Failed to parse API response',
                    'raw_response': gemini_response # Send back to client for debugging
                })
                
        except Exception as e:
            print(f"Server Error: {e}")
            return jsonify({'error': str(e)})

if __name__ == '__main__':
    app.run(debug=True)
