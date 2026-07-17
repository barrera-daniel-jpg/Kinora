// Capa de acceso a la API del backend (Express + PostgreSQL).
// Aquí viven la URL base y los helpers que TODAS las páginas usan para hablar con
// el servidor, de modo que la lógica de red (token + fetch + manejo de errores)
// esté en un solo lugar y no repetida en cada vista.

// URL base del backend propio (API REST en Express + PostgreSQL).
// El proyecto se ejecuta SOLO en local, así que apunta fijo al puerto 3001.
// Si algún día cambia el puerto de la API, este es el único lugar a tocar.
export const API_URL = 'http://localhost:3001/api';

// Clave de localStorage donde vive el token de sesión.
// Se guarda aparte de los datos del usuario para que este archivo pueda leerlo sin
// importar auth.js: auth.js ya importa API_URL de aquí, y si nos importáramos el
// uno al otro tendríamos una dependencia circular.
const TOKEN_KEY = 'auth_token';

/**
 * getToken()
 * Devuelve el token de la sesión actual, o null si no hay sesión.
 */
export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * setToken(token) / clearToken()
 * Guardan y borran el token. Solo los usa AuthService, al entrar y al salir.
 */
export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

/**
 * buildHeaders(hasBody)
 * Arma las cabeceras de cada petición, con el token de sesión si lo hay.
 *
 * "Authorization: Bearer <token>" es la forma en que el backend sabe quién está
 * llamando. Sin esta cabecera, toda la API (menos el login) responde 401. Antes
 * mandábamos el rol y el coach_id en la URL y el servidor se fiaba; ahora la
 * identidad va firmada y el servidor la verifica.
 */
function buildHeaders(hasBody) {
    const headers = {};
    if (hasBody) headers['Content-Type'] = 'application/json';

    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return headers;
}

/**
 * handleAuthFailure()
 * Reacción común a un 401: la sesión ya no vale (caducó o el token es inválido).
 *
 * Limpiamos lo que quede en localStorage y mandamos al login. Si no lo hiciéramos,
 * la app se quedaría con una sesión fantasma: el usuario vería la interfaz pero
 * todas las peticiones fallarían sin explicación.
 *
 * Se usa location.replace en vez del router para forzar un arranque limpio y no
 * dejar la página muerta en el historial del navegador.
 */
function handleAuthFailure() {
    clearToken();
    localStorage.removeItem('user_session');
    window.location.replace('/login');
}

/**
 * apiGet(url)
 * GET autenticado que devuelve el JSON ya parseado. Se usa para LISTAR/LEER.
 *
 * Lanza si el backend responde con error, en vez de devolver el error como si
 * fueran datos. Antes no distinguía: una respuesta {error: "..."} se devolvía tal
 * cual y la página intentaba recorrerla como si fuera un array, con un
 * "x.map is not a function" como única pista de lo que había pasado.
 *
 * @param {string} url Endpoint completo.
 * @returns {Promise<any>} El cuerpo JSON de la respuesta.
 */
export async function apiGet(url) {
    const response = await fetch(url, { headers: buildHeaders(false) });

    if (response.status === 401) {
        handleAuthFailure();
        throw new Error('Sesión expirada.');
    }
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudieron cargar los datos.');
    }
    return response.json();
}

/**
 * apiSend(url, method, body, fallbackMessage)
 * Envía una operación de ESCRITURA (POST / PUT / PATCH / DELETE) y centraliza el
 * manejo de errores: si el backend responde con un código != 2xx, lanza un Error
 * con el mensaje que mandó el servidor (`data.error`) o, si no hay, con
 * `fallbackMessage`.
 *
 * Por qué existe: antes este bloque estaba copiado en coaches/admins/atletas/
 * ejercicios/projects. Al centralizarlo, cada página solo hace `await apiSend(...)`
 * dentro de un try/catch, y los mensajes de permiso del backend ("Solo puedes
 * modificar los ejercicios que creaste tú") llegan tal cual al usuario.
 *
 * @param {string} url             Endpoint completo.
 * @param {string} method          'POST' | 'PUT' | 'PATCH' | 'DELETE'.
 * @param {object} [body]          Cuerpo a enviar como JSON (se omite en DELETE).
 * @param {string} fallbackMessage Mensaje si el backend no devuelve uno propio.
 * @returns {Promise<object>}      El cuerpo JSON de la respuesta (o {} si viene vacío).
 */
export async function apiSend(url, method, body, fallbackMessage = 'La operación falló.') {
    const options = { method, headers: buildHeaders(body !== undefined) };
    if (body !== undefined) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (response.status === 401) {
        handleAuthFailure();
        throw new Error('Sesión expirada.');
    }
    if (!response.ok) {
        // Intentamos leer el mensaje de error del backend; si el cuerpo no es JSON
        // (o viene vacío), usamos el mensaje de respaldo para no romper el flujo.
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || fallbackMessage);
    }
    return response.json().catch(() => ({}));
}
