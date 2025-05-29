// coté caméra local
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(path.join(__dirname, "videos.db"));
const videoDir = path.join(__dirname, "..", "videos");

function extractDateFromFilename(filename) {
  const match = filename.match(/(\d{10,13})/);
  if (!match) return null;
  const timestampMs = parseInt(match[1], 10);
  const date = new Date(timestampMs);
  if (isNaN(date.getTime())) return null;
  return timestampMs; // retourne timestamp UNIX en ms
}

function updateVideoDates(callback) {
  fs.readdir(videoDir, (err, files) => {
    if (err) {
      console.error("Erreur lecture du dossier vidéos :", err);
      if (callback) callback(err);
      return;
    }

    if (files.length === 0) {
      if (callback) callback();
      return;
    }

    let pending = files.length;

    files.forEach(file => {
      const date = extractDateFromFilename(file);
      if (!date) {
        console.warn(`⚠️ Pas de date reconnue dans le nom : ${file}`);
        if (--pending === 0 && callback) callback();
        return;
      }

      db.run(
        `UPDATE videos SET date = ? WHERE nom = ? AND (date IS NULL OR date = '')`,
        [date.toString(), file],
        function (err) {
          if (err) console.error("Erreur maj date :", err.message);
          else if (this.changes > 0)
            console.log(`✅ Date mise à jour pour : ${file} -> ${date}`);

          if (--pending === 0 && callback) callback();
        }
      );
    });
  });
}

module.exports = updateVideoDates;
