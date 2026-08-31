/**
 * Escritura en GitHub con la Contents API.
 * El token va en Propiedades del script, nunca en el código.
 * Propiedades necesarias: GH_TOKEN, GH_REPO (usuario/repo), GH_RAMA (opcional, main).
 */

function ghConfig() {
  const token = PROP.getProperty('GH_TOKEN');
  const repo = PROP.getProperty('GH_REPO');
  if (!token || !repo) {
    throw new Error('faltan las propiedades GH_TOKEN o GH_REPO del script');
  }
  return { token: token, repo: repo, rama: PROP.getProperty('GH_RAMA') || 'main' };
}

function ghPedir(url, opciones) {
  const cfg = ghConfig();
  opciones.headers = {
    Authorization: 'Bearer ' + cfg.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  opciones.muteHttpExceptions = true;
  const r = UrlFetchApp.fetch(url, opciones);
  return { codigo: r.getResponseCode(), cuerpo: r.getContentText() };
}

function ghSha(ruta) {
  const cfg = ghConfig();
  const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + ruta +
    '?ref=' + encodeURIComponent(cfg.rama);
  const r = ghPedir(url, { method: 'get' });
  if (r.codigo === 404) return null;          // archivo nuevo
  if (r.codigo !== 200) {
    throw new Error('GitHub respondió ' + r.codigo + ' al leer ' + ruta + ': ' + recorte(r.cuerpo));
  }
  return JSON.parse(r.cuerpo).sha;
}

function subirAGithub(ruta, contenido) {
  const cfg = ghConfig();
  const sha = ghSha(ruta);
  const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + ruta;

  const cuerpo = {
    message: 'Colación: actualiza ' + ruta.split('/').pop() + ' desde la planilla',
    content: Utilities.base64Encode(contenido, Utilities.Charset.UTF_8),
    branch: cfg.rama
  };
  if (sha) cuerpo.sha = sha;

  const r = ghPedir(url, {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(cuerpo)
  });

  if (r.codigo === 409 || r.codigo === 422) {
    // otro commit llegó primero: reintentar una vez con el sha nuevo
    cuerpo.sha = ghSha(ruta);
    const r2 = ghPedir(url, {
      method: 'put',
      contentType: 'application/json',
      payload: JSON.stringify(cuerpo)
    });
    if (r2.codigo >= 300) {
      throw new Error('GitHub rechazó ' + ruta + ' (' + r2.codigo + '): ' + recorte(r2.cuerpo));
    }
    return;
  }

  if (r.codigo >= 300) {
    const pista = r.codigo === 401 ? ' — el token no sirve o expiró'
      : r.codigo === 403 ? ' — el token no tiene permiso de escritura en el repo'
        : r.codigo === 404 ? ' — revisa GH_REPO y que el token tenga acceso'
          : '';
    throw new Error('GitHub respondió ' + r.codigo + ' al escribir ' + ruta + pista + ': ' + recorte(r.cuerpo));
  }
}

function recorte(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  return t.length > 180 ? t.slice(0, 180) + '…' : t;
}

/** Escribe el resultado de la última publicación en Config, para que se vea sin abrir el script. */
function escribirEstado(texto) {
  try {
    const hoja = SpreadsheetApp.getActive().getSheetByName(HOJAS.config.nombre);
    if (!hoja) return;
    const valores = hoja.getDataRange().getValues();
    for (let f = 1; f < valores.length; f++) {
      if (String(valores[f][0]).trim() === 'Estado') {
        hoja.getRange(f + 1, 2).setValue(texto);
        return;
      }
    }
    hoja.appendRow(['Estado', texto]);
  } catch (err) {
    // no bloquear la publicación por no poder escribir el estado
  }
}

/** Comprueba el token y el repo sin publicar nada. Se corre a mano desde el editor. */
function probarConexion() {
  const cfg = ghConfig();
  const r = ghPedir('https://api.github.com/repos/' + cfg.repo, { method: 'get' });
  if (r.codigo === 200) {
    const repo = JSON.parse(r.cuerpo);
    Logger.log('OK: ' + repo.full_name + ' (rama por defecto: ' + repo.default_branch + ')');
  } else {
    Logger.log('Error ' + r.codigo + ': ' + recorte(r.cuerpo));
  }
}
