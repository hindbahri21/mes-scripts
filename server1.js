const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const db = new sqlite3.Database(path.join(__dirname, "videos.db"), sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error("❌ Erreur de connexion à la base de données SQLite :", err.message);
    process.exit(1);
  } else {
    console.log("✅ Connexion à SQLite3 réussie");
    db.run("PRAGMA key = 'mot_de_passe_ultra_secret';");
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT UNIQUE,
      timestamp INTEGER,
      duree TEXT,
      chemin TEXT,
      date TEXT
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS mouvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER,
      timestamp INTEGER,
      description TEXT,
      FOREIGN KEY(video_id) REFERENCES videos(id)
  );`);
});

const app = express();
const port = 3000;

const publicDir = path.join('C:', 'Users', 'hindb', 'vs code', 'pfe', 'public');
const videosDir = path.join('C:', 'Users', 'hindb', 'vs code', 'pfe', 'videos');
const pythonScriptPath = path.join('C:', 'Users', 'hindb', 'vs code', 'pfe', 'public', 'video_compressed1.py');

app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index1.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/api/videos', (req, res) => {
  db.all("SELECT * FROM videos", (err, rows) => {
    if (err) {
      console.error('Erreur SQL /api/videos:', err);
      return res.status(500).json({ error: err.message });
    }
    const videos = rows.map(video => ({
      id: video.id,
      name: video.nom,
      timestamp: video.timestamp,
      duration: video.duree,
      fullPath: video.chemin,
      date: video.date
    }));
    res.json(videos);
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    cb(null, videosDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `video_${timestamp}.webm`);
  }
});

const upload = multer({ storage });

let lastReceivedVideoFilename = null;

app.post('/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Aucun fichier vidéo reçu.');
  }

  lastReceivedVideoFilename = req.file.filename;

  const originalInputPath = path.join(videosDir, req.file.filename);
  const fileStats = fs.statSync(originalInputPath);
  const timestamp = Math.floor(fileStats.mtimeMs / 1000);

  const uniqueSuffix = `${timestamp}_${uuidv4()}`;
  const compressedFilename = `compressed_video_${uniqueSuffix}.mp4`;
  const compressedOutputPath = path.join(videosDir, compressedFilename);
  const dateLisible = new Date(timestamp * 1000).toLocaleString('fr-FR', { hour12: false });

  console.log(`✅ Vidéo reçue : ${req.file.filename}`);

  const getVideoDuration = (filePath, callback) => {
    exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (err, stdout) => {
      if (err) {
        console.error("❌ Erreur lors de l'obtention de la durée :", err);
        callback('00:00:00');
      } else {
        const totalSeconds = Math.floor(parseFloat(stdout));
        const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        callback(`${hours}:${minutes}:${seconds}`);
      }
    });
  };

  exec(`python "${pythonScriptPath}" "${originalInputPath}" "${compressedOutputPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Erreur compression : ${error.message}`);
      return res.status(500).send('Erreur lors de la compression.');
    }

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    getVideoDuration(compressedOutputPath, (duration) => {
      const insertStmt = `INSERT OR IGNORE INTO videos (nom, timestamp, duree, chemin, date) VALUES (?, ?, ?, ?, ?)`;
      db.run(insertStmt, [compressedFilename, timestamp, duration, compressedOutputPath, dateLisible], function (err) {
        if (err) {
          console.error(`❌ Erreur d'insertion dans la base de données :`, err.message);
          return res.status(500).send('Erreur d\'enregistrement dans la base.');
        }

        fs.unlink(originalInputPath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(`❌ Erreur suppression fichier original : ${unlinkErr.message}`);
          } else {
            console.log(`🗑️ Vidéo originale supprimée : ${req.file.filename}`);
          }
        });

        if (this.changes === 0) {
          return res.status(200).send('Vidéo déjà présente, insertion ignorée.');
        }

        // Récupérer l'ID de la vidéo insérée
        const videoId = this.lastID;
        console.log("ID de la vidéo insérée :", videoId);

        // Lecture fichier JSON des mouvements
        const motionDataPath = path.join(videosDir, `motion_${uniqueSuffix}.json`);

        fs.readFile(motionDataPath, 'utf8', (readErr, data) => {
          if (readErr) {
            console.error("Erreur lecture fichier mouvements:", readErr);
            return res.status(500).send('Erreur lecture fichier mouvements.');
          }

          let mouvements;
          try {
            mouvements = JSON.parse(data);
          } catch (e) {
            console.error("Erreur JSON mouvements:", e);
            return res.status(500).send('Erreur JSON mouvements.');
          }

          if (!Array.isArray(mouvements)) {
            console.error("Format invalide : mouvements n'est pas un tableau.");
            return res.status(400).send('Format des mouvements invalide.');
          }

          console.log(`Lecture ${mouvements.length} mouvements du fichier.`);

          mouvements.forEach(m => {
            if (typeof m.timestamp !== 'number') {
              console.error("Mouvement avec timestamp invalide :", m);
              return;  // skip ce mouvement
            }
            db.run(`INSERT INTO mouvements (video_id, timestamp, description) VALUES (?, ?, ?)`,
              [videoId, m.timestamp, m.description || "Mouvement détecté"],
              (err) => {
                if (err) {
                  console.error("Erreur insertion mouvement :", err);
                } else {
                  console.log("Mouvement inséré:", m);
                }
              });
          });

          console.log(`Tous les mouvements tentés d'insertion pour la vidéo ID ${videoId}`);
          res.send(`✅ Vidéo compressée et mouvements insérés: ${compressedFilename}`);
        });
      });
    });
  });
});


const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let activeClients = [];

wss.on('connection', (ws) => {
  console.log('🔗 Client connecté via WebSocket');
  activeClients.push(ws);

  ws.on('message', (message) => {
    const msg = message.toString();
    console.log('📨 Message reçu du client :', msg);

    if (msg === 'ready-to-record') {
      ws.send('start-recording');
    }

    if (msg === 'stop-recording') {
      ws.send('stop-recording');
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client déconnecté');
    activeClients = activeClients.filter(client => client !== ws);
  });
});

process.on('SIGINT', () => {
  console.log('🔴 Arrêt du serveur...');
  activeClients.forEach(client => {
    client.send('stop-recording');
  });
  server.close(() => {
    console.log('✅ Serveur arrêté.');
    process.exit(0);
  });
});

server.listen(port, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${port}`);
});
