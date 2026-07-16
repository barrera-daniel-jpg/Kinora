/**
 * loadHTML(path)
 * Descarga un archivo .html como TEXTO (no lo parsea como DOM). El router usa el
 * resultado para inyectarlo con `innerHTML` en el contenedor #app y así cambiar de
 * vista sin recargar la página (comportamiento de SPA).
 *
 * Si la descarga falla (ruta equivocada, servidor caído), devuelve un HTML de error
 * en vez de lanzar, para que el router no se rompa y la app siga navegable.
 *
 * @param {string} path Ruta del archivo .html (p. ej. '/src/pages/login/login.html').
 * @returns {Promise<string>} El HTML como cadena, o un mensaje de error.
 */
export async function loadHTML(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Error cargando HTML: ${path}`);
        }
        return await response.text();
    } catch (error) {
        console.error(error);
        return '<h2>Error cargando contenido</h2>';
    }
}