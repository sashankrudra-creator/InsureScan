import sqlite3
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

# Configuration
SQLITE_DB = 'database.db'
POSTGRES_URL = os.getenv('DATABASE_URL')

def migrate():
    if not POSTGRES_URL:
        print("Error: DATABASE_URL not set in environment or .env file.")
        print("Example: DATABASE_URL=postgresql://user:password@localhost:5432/dbname")
        return

    # Connect to SQLite
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    # Connect to Postgres
    pg_conn = psycopg2.connect(POSTGRES_URL)
    pg_conn.autocommit = True
    pg_cur = pg_conn.cursor()

    print("Checking for existing tables in Postgres...")
    pg_cur.execute('''
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

    # Fetch users from SQLite
    print("Fetching users from SQLite...")
    sqlite_cur.execute("SELECT * FROM users")
    users = sqlite_cur.fetchall()

    if not users:
        print("No users found in SQLite to migrate.")
        return

    print(f"Migrating {len(users)} users...")
    for user in users:
        try:
            pg_cur.execute('''
                INSERT INTO users (id, name, email, password, is_admin, plan, analysis_count, last_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
            ''', (
                user['id'], user['name'], user['email'], user['password'], 
                user['is_admin'], user['plan'] if 'plan' in user.keys() else 'Free Plan', 
                user['analysis_count'] if 'analysis_count' in user.keys() else 0, 
                user['last_active'] if 'last_active' in user.keys() else None
            ))
        except Exception as e:
            print(f"Error migrating user {user['email']}: {e}")

    # Fix sequences for auto-increment IDs
    pg_cur.execute("SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(MAX(id), 1)) FROM users;")

    print("Migration completed successfully!")

    sqlite_conn.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate()
