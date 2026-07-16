// Capa de acceso a la API del backend (Express + PostgreSQL).
// Aquí viven la URL base y los helpers que TODAS las páginas usan para hablar con
// el servidor, de modo que la lógica de red (fetch + manejo de errores) esté en un
// solo lugar y no repetida en cada vista.

// URL base del backend propio (API REST en Express + PostgreSQL).
// El proyecto se ejecuta SOLO en local, así que apunta fijo al puerto 3001.
// Si algún día cambia el puerto de la API, este es el único lugar a tocar.
export const API_URL = 'http://localhost:3001/api';

/**
 * apiGet(url)
 * GET que devuelve el JSON ya parseado. Se usa para LISTAR/LEER recursos.
 * Por qué existe: unifica el `fetch(...).then(r => r.json())` que estaba repetido
 * en cada `render*()` de las páginas.
 */
export async function apiGet(url) {
    const response = await fetch(url);
    return response.json();
}

/**
 * apiSend(url, method, body, fallbackMessage)
 * Envía una operación de ESCRITURA (POST / PUT / DELETE) y centraliza el manejo de
 * errores: si el backend responde con un código != 2xx, lanza un Error con el
 * mensaje que mandó el servidor (`data.error`) o, si no hay, con `fallbackMessage`.
 *
 * Por qué existe: antes este bloque estaba copiado en coaches/admins/atletas/
 * ejercicios/projects:
 *     const res = await fetch(...);
 *     if (!res.ok) { const data = await res.json().catch(() => ({}));
 *                    throw new Error(data.error || '...'); }
 * Al centralizarlo, cada página solo hace `await apiSend(...)` dentro de un try/catch.
 *
 * @param {string} url            Endpoint completo.
 * @param {string} method         'POST' | 'PUT' | 'DELETE'.
 * @param {object} [body]         Cuerpo a enviar como JSON (se omite en DELETE).
 * @param {string} fallbackMessage Mensaje si el backend no devuelve uno propio.
 * @returns {Promise<object>}     El cuerpo JSON de la respuesta (o {} si viene vacío).
 */
export async function apiSend(url, method, body, fallbackMessage = 'La operación falló.') {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
        // Intentamos leer el mensaje de error del backend; si el cuerpo no es JSON
        // (o viene vacío), usamos el mensaje de respaldo para no romper el flujo.
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || fallbackMessage);
    }
    return response.json().catch(() => ({}));
}

/**
 * scopeQuery(user)
 * Devuelve el "?..." de AISLAMIENTO para listar recursos que tienen dueño
 * (coaches / atletas / rutinas / ejercicios), según el rol de quien consulta:
 *   - coach      -> ?coach_id=<su perfil>   (solo lo suyo)
 *   - admin      -> ?admin_id=<su user.id>  (los coaches que creó y, en cascada, su gente)
 *   - superadmin -> ''                       (sin filtro: ve TODO)
 * El atleta es un caso aparte (usa ?athlete_id= solo en rutinas) y no pasa por aquí.
 */
export function scopeQuery(user) {
    if (!user) return '';
    if (user.role === 'coach' && user.coach_id) return `?coach_id=${user.coach_id}`;
    if (user.role === 'admin') return `?admin_id=${user.id}`;
    return ''; // superadmin
}
