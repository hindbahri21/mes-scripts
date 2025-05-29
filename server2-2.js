// coté caméra de surveillance
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require('bcrypt');
const fs = require("fs");
const winston = require('winston');

const app = express();
const PORT = 3000;

// Connexion à la base SQLite
const db = new sqlite3.Database(path.join(__dirname, "videos.db"), sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error("❌ Erreur de connexion à la base de données SQLite :", err.message);
    process.exit(1);
  } else {
    console.log("✅ Connexion à SQLite3 réussie");

    // Création table users si elle n'existe pas
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Création du trigger update_users_updated_at
    db.run(`
      CREATE TRIGGER IF NOT EXISTS update_users_updated_at
      AFTER UPDATE ON users
      FOR EACH ROW
      BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
      END;
    `);
  }
});

// Winston logger
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

// Middleware Express
app.set("view engine", "ejs");
app.set("views", path.join(__dirname));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// Sessions
app.use(session({
  secret: "secretPFE",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 2
  }
}));

// Fonction de log d'action
function logAction(userId, action, details = '') {
  const stmt = db.prepare('INSERT INTO logs_actions (user_id, action, details) VALUES (?, ?, ?)');
  stmt.run(userId, action, details, function(err) {
    if (err) {
      logger.error(`Erreur insertion log DB: ${err.message}`);
    }
  });
  stmt.finalize();
  logger.info({ userId, action, details, timestamp: new Date().toISOString() });
  console.log(`LOG => Utilisateur: ${userId}, action: ${action}, details: ${details}`);
}

// Auth middleware
function checkAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/");
  }
}

// Page de login
app.get("/", (req, res) => {
  res.render("login_client", { error: null, user: req.session.user || null });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Récupérer l'utilisateur dans la table users
  db.get("SELECT id, password FROM users WHERE username = ?", [username], (err, row) => {
    if (err) {
      logger.error(`Erreur DB login: ${err.message}`);
      return res.render("login_client", { error: "Erreur serveur, veuillez réessayer" });
    }
    if (!row) {
      // utilisateur inconnu
      logAction('inconnu', 'echec_connexion', `Utilisateur non trouvé: ${username}`);
      return res.render("login_client", { error: "Identifiants invalides" });
    }

    // Comparer le mot de passe (ici bcrypt)
    bcrypt.compare(password, row.password, (err, result) => {
      if (err) {
        logger.error(`Erreur bcrypt: ${err.message}`);
        return res.render("login_client", { error: "Erreur serveur, veuillez réessayer" });
      }

      if (result) {
        // Auth OK
        req.session.user = { id: row.id, username: username };
        logAction(row.id, 'connexion_reussie');
        res.redirect("/videos");
      } else {
        // Mot de passe incorrect
        logAction(row.id, 'echec_connexion', 'Mot de passe incorrect');
        res.render("login_client", { error: "Identifiants invalides" });
      }
    });
  });
});

// Page liste des vidéos (protégée)
app.get("/videos", checkAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  db.get("SELECT COUNT(*) AS count FROM enregistrements", (err, countResult) => {
    if (err) {
      logAction(req.session.user.username, 'erreur_recherche_videos', err.message);
      return res.send("Erreur DB");
    }

    const totalVideos = countResult.count;
    const totalPages = Math.ceil(totalVideos / limit);

    db.all("SELECT * FROM enregistrements ORDER BY id ASC LIMIT ? OFFSET ?", [limit, offset], (err, rows) => {
      if (err) {
        logAction(req.session.user.username, 'erreur_recherche_videos', err.message);
        return res.send("Erreur DB");
      }

      res.render("list_video", {
        videos: rows,
        username: req.session.user.username,
        currentPage: page,
        totalPages: totalPages,
        user: req.session.user  // pour avoir un objet user complet
      });
    });
  });
});


// Déconnexion
app.get("/logout", (req, res) => {
  if (req.session.user) {
    logAction(req.session.user.username, 'deconnexion');
  }
  req.session.destroy();
  res.redirect("/");
});

app.get('/list_video', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 5; // Nombre de vidéos par page
  const offset = (page - 1) * limit;

  db.all("SELECT * FROM enregistrements ORDER BY id ASC LIMIT ? OFFSET ?", [limit, offset], (err, rows) => {
    if (err) {
      console.error("Erreur lors du comptage des vidéos :", err.message);
      return res.status(500).send("Erreur serveur");
    }

    const totalVideos = countResult[0].count;
    const totalPages = Math.ceil(totalVideos / limit);

    db.all("SELECT * FROM enregistrements ORDER BY id ASC LIMIT ? OFFSET ?", [limit, offset], (err, rows) => {
      if (err) {
        console.error("Erreur lors de la récupération des vidéos :", err.message);
        return res.status(500).send("Erreur serveur");
      }

      // Exemple pour l'utilisateur connecté (à adapter selon la logique)
      const username = req.session?.username || 'Invité';

      res.render('list_video', {
        videos: rows,
        username: username,
        currentPage: page,
        totalPages: totalPages
      });
    });
  });
});

// Téléchargement
app.get("/download/:id", checkAuth, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM enregistrements WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      logAction(req.session.user.username, 'echec_download', `id: ${id}`);
      return res.send("Vidéo non trouvée");
    }
    logAction(req.session.user.username, 'download', `id: ${id}`);
    res.download(row.chemin);
  });
});

// Lecture (stream)
app.get("/watch/:id", checkAuth, (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM enregistrements WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      logAction(req.session.user.username, 'echec_stream', `id: ${id}`);
      return res.send("Vidéo non trouvée");
    }
    logAction(req.session.user.username, 'stream', `id: ${id}`);
    res.sendFile(row.chemin);
  });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
