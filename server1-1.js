// coté caméra de surveillance
const { spawn } = require('child_process');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');

if (process.argv.length < 3) {
  console.error("❌ Usage : node server1-1.js <chemin_vers_video.ts>");
  process.exit(1);
}

const filePath = process.argv[2];
const fileName = path.basename(filePath);

// Connexion à la base SQLite (ajuste le chemin si besoin)
const db = new sqlite3.Database(path.join(__dirname, "videos.db"), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error("❌ Erreur de connexion à SQLite :", err.message);
    process.exit(1);
  }
});

// Création de la table enregistrements si elle n'existe pas
const createTableSQL = `
CREATE TABLE IF NOT EXISTS enregistrements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT UNIQUE,
  duree TEXT,
  date TEXT,
  chemin TEXT
);
`;

db.run(createTableSQL, (err) => {
  if (err) {
    console.error("❌ Erreur lors de la création de la table :", err.message);
    process.exit(1);
  }
});

function getVideoDuration(file, callback) {
  exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`, (err, stdout) => {
    if (err) {
      console.error("❌ Erreur obtention durée vidéo :", err);
      return callback('00:00:00');
    }
    const totalSeconds = Math.floor(parseFloat(stdout));
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    callback(`${h}:${m}:${s}`);
  });
}

console.log(`📤 Traitement de la vidéo "${fileName}" en cours...`);

const pythonProcess = spawn('python', [
  path.join(__dirname, 'upload_video1.py'),
  filePath
]);

pythonProcess.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
});

pythonProcess.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

pythonProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`❌ Upload échoué pour "${fileName}" avec code ${code}`);
    db.close();
    return;
  }

  getVideoDuration(filePath, (duration) => {
    const dateLisible = new Date().toLocaleString('fr-FR', { hour12: false });

    const insertSQL = `INSERT OR IGNORE INTO enregistrements (nom, duree, date, chemin) VALUES (?, ?, ?, ?)`;
    db.run(insertSQL, [fileName, duration, dateLisible, filePath], function(err) {
      if (err) {
        console.error("❌ Erreur insertion dans la base :", err.message);
      } else if (this.changes === 0) {
        console.log("ℹ️ Enregistrement déjà existant, insertion ignorée.");
      } else {
        console.log(`✅ Enregistrement inséré dans la base avec ID ${this.lastID}`);
        console.log("✅ Données stockées dans la table enregistrements de la base de données");
      }
      db.close();
    });
  });
});
