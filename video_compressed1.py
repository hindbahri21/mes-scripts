# coté caméra local
import os
import sys
import io
import subprocess
import cv2
import sqlite3
from datetime import datetime
from upload_video import upload_to_b2

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

# Connexion DB SQLite
db = sqlite3.connect('videos.db')
cursor = db.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT UNIQUE,
    timestamp INTEGER,
    duree TEXT,
    chemin TEXT,
    date TEXT
)
""")
db.commit()

def get_video_duration(video_path):
    command = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video_path
    ]
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        total_seconds = float(result.stdout.strip())
        h, m, s = int(total_seconds // 3600), int((total_seconds % 3600) // 60), int(total_seconds % 60)
        return f"{h:02}:{m:02}:{s:02}"
    except Exception as e:
        print(f"❌ Erreur durée vidéo : {e}")
        return "00:00:00"

def compress_video(input_file, output_file):
    if not os.path.exists(input_file):
        print(f"❌ Le fichier {input_file} n'existe pas.")
        return False

    cap = cv2.VideoCapture(input_file)
    if not cap.isOpened():
        print("❌ Erreur lecture vidéo.")
        return False

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps != fps or fps == 0:
        print("⚠️ FPS invalide. Défaut à 30 fps.")
        fps = 30
    cap.release()

    command = [
        'ffmpeg', '-i', input_file,
        '-vcodec', 'libx264', '-acodec', 'aac',
        '-preset', 'fast', '-crf', '23',
        '-r', str(fps), '-y', output_file
    ]

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
        print(f"✅ Compression terminée.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Erreur compression : {e.stderr}")
        return False

def update_video_in_db(filename, timestamp, duration, path, date_readable):
    try:
        cursor.execute(
            'INSERT INTO videos (nom, timestamp, duree, chemin, date) VALUES (?, ?, ?, ?, ?)',
            (filename, timestamp, duration, path, date_readable)
        )
        db.commit()
        print(f"✅ Video compressée traitée dans la base de données")
    except sqlite3.IntegrityError:
        print(f"⚠️ Vidéo déjà enregistrée : {filename}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("📌 Usage : python video_compressed1.py <input_file> <output_file>")
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]

    success = compress_video(input_path, output_path)

    if success:
        filename = os.path.basename(output_path)
        timestamp = int(os.path.getmtime(output_path))

        # Formattage de la date lisible en français (format 'jj/mm/aaaa hh:mm:ss')
        date_readable = datetime.fromtimestamp(timestamp).strftime('%d/%m/%Y %H:%M:%S')

        duration = get_video_duration(output_path)

        update_video_in_db(filename, timestamp, duration, output_path, date_readable)

        print("📤 Upload vers B2 en cours...")
        upload_to_b2(input_path, output_path, filename, timestamp, duration)
