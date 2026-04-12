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
          // Si le lien existe déjà
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
  if (n.includes('cours')) return 'Cours';
  if (n.includes('eval') || n.includes('dst') || n.includes('controle') || n.includes('devoir')) return 'Évaluation';
  if (n.includes('exo') || n.includes('exercice') || n.includes('td') || n.includes('qcm')) return 'Exercices';
  return 'Autres';
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const classe = event.queryStringParameters && event.queryStringParameters.classe;
    if (!classe || !FOLDERS[classe]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Classe invalide' }) };
    }

    const accessToken = await getAccessToken();
    const result = await listFolder(accessToken, FOLDERS[classe]);

    if (!result.entries) {
      return { statusCode: 200, headers, body: JSON.stringify([]) };
    }

    const files = result.entries.filter(e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith('.pdf'));

    const docs = await Promise.all(files.map(async (f) => {
      const url = await createSharedLink(accessToken, f.path_lower);
      // Convertir le lien de partage en lien direct
      const directUrl = url ? url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '?raw=1') : null;
      const previewUrl = url ? url.replace('?dl=0', '') : null;
      const title = f.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
      const cat = detectCat(f.name);
      return {
        id: f.id,
        title,
        cat,
        catBase: cat,
        fileName: f.name,
        ext: 'pdf',
        classe,
        previewUrl,
        downloadUrl: directUrl,
      };
    }));

    return { statusCode: 200, headers, body: JSON.stringify(docs) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
