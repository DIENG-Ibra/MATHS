const https = require('https');

// Obtenir un access token depuis le refresh token
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }).toString();

    const options = {
      hostname: 'api.dropbox.com',
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error('No access token: ' + body));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Lister les fichiers d'un dossier Dropbox
function listFolder(accessToken, path) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ path, recursive: false });
    const options = {
      hostname: 'api.dropboxapi.com',
      path: '/2/files/list_folder',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Créer un lien partagé pour un fichier
function createSharedLink(accessToken, path) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ path, settings: { requested_visibility: 'public' } });
    const options = {
      hostname: 'api.dropboxapi.com',
      path: '/2/sharing/create_shared_link_with_settings',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error && json.error['.tag'] === 'shared_link_already_exists') {
            resolve(json.error.shared_link_already_exists.metadata.url);
          } else if (json.url) {
            resolve(json.url);
          } else {
            resolve(null);
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const FOLDERS = {
  'Tle Spécialité':      '/Cours-Maths-Dieng/Tle-Specialite',
  'Tle STMG':            '/Cours-Maths-Dieng/Tle-STMG',
  'Tle Complémentaires': '/Cours-Maths-Dieng/Tle-Complementaires',
  '1ère Spécialité':     '/Cours-Maths-Dieng/1ere-Specialite',
  '1ère STMG':           '/Cours-Maths-Dieng/1ere-STMG',
  '1ère Spécifique':     '/Cours-Maths-Dieng/1ere-Specifique',
};

function detectCat(name) {
  const n = name.toLowerCase();
  if (n.includes('cours') || n.includes('s1') || n.includes('s2') || n.includes('s3') ||
      n.includes('s4') || n.includes('s5') || n.includes('s6') || n.includes('s7') ||
      n.includes('s8') || n.includes('s9')) return 'Cours';
  if (n.includes('eval') || n.includes('dst') || n.includes('bac') || n.includes('controle') || n.includes('devoir')) return 'Évaluation';
  if (n.includes('exo') || n.includes('exercice') || n.includes('td') || n.includes('qcm')) return 'Exercices';
  return 'Autres';
}

// Format Vercel : export default function(req, res)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const classe = req.query.classe;
    if (!classe || !FOLDERS[classe]) {
      return res.status(400).json({ error: 'Classe invalide' });
    }

    const accessToken = await getAccessToken();
    const result = await listFolder(accessToken, FOLDERS[classe]);

    if (!result.entries) {
      return res.status(200).json([]);
    }

    const files = result.entries.filter(
      e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith('.pdf')
    );

    const docs = await Promise.all(files.map(async (f) => {
      const url = await createSharedLink(accessToken, f.path_lower);
      const directUrl  = url ? url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '?raw=1') : null;
      const previewUrl = url ? url.replace('?dl=0', '') : null;
      const title = f.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
      const cat   = detectCat(f.name);
      return { id: f.id, title, cat, catBase: cat, fileName: f.name, ext: 'pdf', classe, previewUrl, downloadUrl: directUrl };
    }));

    return res.status(200).json(docs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
