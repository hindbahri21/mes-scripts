// coté caméra de surveillance
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const path = require('path');

const dossier = 'C:\\Users\\hindb\\Downloads';

const watcher = chokidar.watch(dossier, {
  persistent: true,
  depth: 0,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 3000,
    pollInterval: 100
  }
});

watcher.on('add', filePath => {
  if (filePath.endsWith('.ts')) {
    console.log(`🎬 Nouvelle vidéo détectée : ${path.basename(filePath)}`);

    const process = spawn('node', ['server1-1.js', filePath], {
      cwd: 'C:\\Users\\hindb\\vs code\\pfe\\public' // ajuste selon l’emplacement de server1-1.js
    });

    process.stdout.on('data', data => {
      console.log(data.toString());
    });
    process.stderr.on('data', data => {
      console.error(data.toString());
    });
    process.on('close', code => {
      console.log(`✅ server1-1.js terminé avec code ${code}`);
    });
  }
});
