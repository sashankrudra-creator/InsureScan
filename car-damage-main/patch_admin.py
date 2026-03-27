import os
import sqlite3

def patch_db():
    try:
        conn = sqlite3.connect('database.db')
        conn.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0')
        conn.commit()
        conn.close()
        print("Patched database to add is_admin flag.")
    except sqlite3.OperationalError:
        print("Column is_admin already exists or table doesn't exist.")

with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update init_db schema
old_schema = """            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )"""
new_schema = """            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0
            )"""
content = content.replace(old_schema, new_schema)

# 2. Update inject_user select statement
old_select = "SELECT id, name, email FROM users WHERE id = ?"
new_select = "SELECT id, name, email, is_admin FROM users WHERE id = ?"
content = content.replace(old_select, new_select)

# 3. Add Admin Routes
admin_routes = """
@app.route('/admin')
def admin_panel():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db = get_db()
    current_u = db.execute('SELECT is_admin FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    if not current_u or not dict(current_u).get('is_admin'):
        return "Access Denied: You must be an administrator to view this page.", 403
    
    all_users = db.execute('SELECT id, name, email, is_admin FROM users').fetchall()
    return render_template('admin.html', users=[dict(u) for u in all_users])

@app.route('/make_admin')
def make_admin():
    # Hidden route to give yourself admin access easily for demonstration
    if 'user_id' in session:
        db = get_db()
        db.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (session['user_id'],))
        db.commit()
        return redirect(url_for('admin_panel'))
    return redirect(url_for('login'))
"""

if "def admin_panel():" not in content:
    idx = content.find("@app.route('/profile')")
    if idx != -1:
        # insert after profile route
        end_profile = content.find("\n@", idx + 1)
        if end_profile == -1: end_profile = len(content) # if last route
        content = content[:end_profile] + "\n" + admin_routes + content[end_profile:]

with open('app.py', 'w', encoding='utf-8') as f:
    f.write(content)

patch_db()
print("app.py updated with admin logic.")
