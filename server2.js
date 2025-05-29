// coté caméra local
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require('bcrypt');
const fs = require("fs");
const winston = require('winston');

const app = express();

// Connexion à la base SQLite
const db = new sqlite3.Database(path.join(__dirname, "videos.db"), sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error("❌ Erreur de connexion à la base de données SQLite :", err.message);
    process.exit(1); // quitte si on ne peut pas ouvrir la DB
  } else {
    console.log("✅ Connexion à SQLite3 réussie");
    db.run("PRAGMA key = 'mot_de_passe_ultra_secret';");

    // Création table users si elle n'existe pas
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error("Erreur création table users :", err.message);
      } else {
        console.log("✅ Table users créée ou déjà existante");
      }
    });

    // Création table logs_actions si elle n'existe pas
    db.run(`
      CREATE TABLE IF NOT EXISTS logs_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        details TEXT
      )
    `, (err) => {
      if (err) {
        console.error("Erreur création logs_actions :", err.message);
      } else {
        console.log("✅ Table logs_actions créée ou déjà existante");
      }

      // Création du trigger update_users_updated_at
      db.run(`
        CREATE TRIGGER IF NOT EXISTS update_users_updated_at
        AFTER UPDATE ON users
        FOR EACH ROW
        BEGIN
          UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
      `, (err) => {
        if (err) {
          console.error("Erreur création trigger update_users_updated_at :", err.message);
        } else {
          console.log("✅ Trigger update_users_updated_at créé ou déjà existant");
        }
      });
    });
  }
});

// Winston pour logger dans des fichiers
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "secret_key_client_auth",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // cookie secure uniquement en production (HTTPS)
    maxAge: 1000 * 60 * 60 * 2 // 2 heures
  }
}));

// Middleware pour servir les vidéos avec authentification
app.use('/videos', checkAuth, express.static(path.join(__dirname, '..', 'videos')));

// Configuration EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname));

// === Fonction de log centralisée ===
function logAction(userId, action, details = '') {
  // Log en DB
  const stmt = db.prepare('INSERT INTO logs_actions (user_id, action, details) VALUES (?, ?, ?)');
  stmt.run(userId, action, details, function(err) {
    if (err) {
      console.error("Erreur insertion log en DB :", err);
      logger.error(`Erreur insertion log DB: ${err.message}`);
    }
  });
  stmt.finalize();

  // Log dans Winston (fichiers)
  logger.info({ userId, action, details, timestamp: new Date().toISOString() });

  // Log console simple (optionnel)
  console.log(`LOG => Utilisateur: ${userId}, action: ${action}, details: ${details}`);
}

// Middleware pour vérifier si l'utilisateur est connecté
function checkAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/");
  }
}

// Gestion des échecs de connexion
const failedLogins = {};

// === Routes ===

// Page login
app.get("/", (req, res) => {
  res.render("login_client", { error: null, user: req.session.user });
});

// Traitement login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render("login_client", { error: "Veuillez fournir username et password", user: null });
  }

  const sql = `SELECT password FROM users WHERE username = ?`;
  db.get(sql, [username], (err, row) => {
    if (err) {
      console.error("Erreur DB lors récupération hash :", err);
      logAction(username || 'inconnu', 'erreur_login', err.message);
      return res.render("login_client", { error: "Erreur serveur, veuillez réessayer", user: null });
    }

    if (!row) {
      logAction(username || 'inconnu', 'echec_connexion', "Utilisateur non trouvé");
      return res.render("login_client", { error: "Utilisateur ou mot de passe incorrect", user: null });
    }

    bcrypt.compare(password, row.password, (err, result) => {
      if (err) {
        console.error("Erreur bcrypt :", err);
        logAction(username, 'erreur_login', err.message);
        return res.render("login_client", { error: "Erreur serveur, veuillez réessayer", user: null });
      }

      if (result) {
        failedLogins[username] = 0;
        logAction(username, 'connexion_reussie');
        // Session user minimaliste
        req.session.user = { username };
        return res.redirect("/list_video_client");
      } else {
        failedLogins[username] = (failedLogins[username] || 0) + 1;
        logAction(username, 'echec_connexion', `Tentative #${failedLogins[username]}`);

        if (failedLogins[username] >= 3) {
          logger.warn(`ALERTE: L'utilisateur ${username} a échoué 3 fois à se connecter.`);
          // TODO: Envoyer une alerte mail/webhook à l'admin
        }

        return res.render("login_client", { error: "Utilisateur ou mot de passe incorrect", user: null });
      }
    });
  });
});

// Déconnexion
app.get('/logout', (req, res) => {
  if (req.session.user) {
    logAction(req.session.user.username, 'deconnexion');
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Liste vidéos (protégée)
app.get("/list_video_client", checkAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1; // page courante, défaut 1
  const limit = 5; // nombre max vidéos par page
  const offset = (page - 1) * limit;

  // Compter le total de vidéos pour calculer nombre pages
  db.get("SELECT COUNT(*) AS count FROM videos", (err, countRow) => {
    if (err) {
      console.error(err.message);
      logAction(req.session.user.username, 'erreur_recherche_videos', err.message);
      return res.status(500).send("Erreur lors de la récupération des vidéos");
    }
    const totalVideos = countRow.count;
    const totalPages = Math.ceil(totalVideos / limit);

    // Requête avec tri date asc (anciennes en premier), pagination
    const sql = `SELECT id, nom, duree, date FROM videos ORDER BY date ASC LIMIT ? OFFSET ?`;
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) {
        console.error(err.message);
        logAction(req.session.user.username, 'erreur_recherche_videos', err.message);
        return res.status(500).send("Erreur lors de la récupération des vidéos");
      }

      const videos = rows.map(row => ({
        id: row.id,
        filename: row.nom,
        duration: row.duree,
        date: row.date || "N/A"
      }));

      res.render("list_video_client", {
        videos,
        user: req.session.user,
        currentPage: page,
        totalPages
      });
    });
  });
});


// Streaming vidéo avec support Range + log visionnage
app.get('/video/:filename', checkAuth, (req, res) => {
  const filename = req.params.filename;
  const videoPath = path.join(__dirname, '..', 'videos', filename);

  fs.stat(videoPath, (err, stat) => {
    if (err) {
      logAction(req.session.user.username, 'visionnage_video_echec', `video: ${filename}`);
      return res.status(404).send('Vidéo non trouvée');
    }

    logAction(req.session.user.username, 'visionnage_video', `video: ${filename}`);

    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) return res.status(416).send('Range Not Satisfiable');

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  });
});

// Téléchargement vidéo + log
app.get('/download/:filename', checkAuth, (req, res) => {
  const filename = req.params.filename;
  const videoPath = path.join(__dirname, '..', 'videos', filename);

  fs.access(videoPath, fs.constants.F_OK, (err) => {
    if (err) {
      logAction(req.session.user.username, 'telechargement_video_echec', `video: ${filename}`);
      return res.status(404).send("Vidéo non trouvée");
    }

    logAction(req.session.user.username, 'telechargement_video', `video: ${filename}`);

    res.download(videoPath, filename, (err) => {
      if (err) {
        console.error("Erreur téléchargement :", err);
        logAction(req.session.user.username, 'telechargement_video_erreur', err.message);
        res.status(500).send("Erreur lors du téléchargement");
      }
    });
  });
});


// Démarrage serveur
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
