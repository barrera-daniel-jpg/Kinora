import { API_URL, setToken, clearToken, getToken } from './api.js';

// Servicio de autenticación contra el backend (tabla base_v1.users).
//
// El login usa NOMBRE DE USUARIO (username) + contraseña, y la verificación de la
// contraseña (hasheada con bcrypt) ocurre SIEMPRE en el servidor.
//
// Qué se guarda al iniciar sesión, y en dos sitios distintos:
//   · 'auth_token'   -> el token firmado. Es la CREDENCIAL: lo que api.js manda en
//                       cada petición y lo único que el backend acepta como prueba
//                       de identidad.
//   · 'user_session' -> los datos del usuario (nombre, rol...). Es solo para PINTAR
//                       la interfaz: qué mostrar en la barra de navegación, cómo
//                       saludar, qué botones enseñar.
//
// La distinción importa: 'user_session' es texto plano en el navegador y el usuario
// lo puede editar a mano. Si alguien se cambia el rol a "superadmin" ahí, verá más
// botones en pantalla, pero el backend seguirá leyendo su rol REAL del token firmado
// y le responderá 403. Por eso las decisiones de interfaz pueden salir de aquí, pero
// las de seguridad jamás.
export const AuthService = {
    /**
     * login(username, password)
     * Verifica las credenciales y, si son correctas, guarda el token y los datos
     * del usuario para el resto de la sesión.
     *
     * @returns {Promise<object>} Los datos del usuario (sin el token).
     * @throws {Error} Con el mensaje del backend si las credenciales fallan.
     */
    async login(username, password) {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Credenciales incorrectas');
        }

        // El backend devuelve: id, username, role ('superadmin'/'admin'/'coach'/
        // 'athlete'), email, full_name, coach_id, athlete_id y token.
        const { token, ...user } = await response.json();

        setToken(token);
        localStorage.setItem('user_session', JSON.stringify(user));
        return user;
    },

    /**
     * logout()
     * Cierra la sesión borrando token y datos.
     *
     * Se borran los DOS: si quedara el token, la siguiente visita seguiría teniendo
     * una credencial válida a mano; si quedara user_session, la app creería que hay
     * sesión y mostraría la interfaz de un usuario que ya salió.
     */
    logout() {
        clearToken();
        localStorage.removeItem('user_session');
    },

    /**
     * getCurrentUser()
     * Los datos del usuario de la sesión, o null si no hay.
     *
     * El try/catch cubre el caso de un 'user_session' corrupto (editado a mano o a
     * medio escribir): sin él, un JSON inválido lanzaría en cada render y dejaría
     * la app en blanco sin forma de salir. Preferimos tratarlo como "sin sesión".
     */
    getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('user_session'));
        } catch {
            return null;
        }
    },

    /**
     * isAuthenticated()
     * Hay sesión si existen a la vez el token y los datos del usuario.
     *
     * Se comprueban los dos porque son cosas distintas: sin token no se puede
     * llamar a la API, y sin datos no se puede pintar la interfaz. Tener solo uno
     * (por ejemplo, tras limpiar el navegador a medias) es una sesión rota, y es
     * mejor mandar al login que dejar la app en un estado imposible.
     *
     * Ojo: esto NO valida el token — el navegador no puede, porque no conoce el
     * secreto de firma. Si está caducado, lo dirá el backend con un 401 y api.js
     * se encargará de mandar al login.
     */
    isAuthenticated() {
        return Boolean(getToken() && this.getCurrentUser());
    },

    /**
     * changePassword(currentPassword, newPassword)
     * Cambia la contraseña del usuario que tiene la sesión abierta.
     * Exige la contraseña actual: tener la sesión abierta no basta para poder
     * cambiarla (ver POST /api/auth/change-password en el backend).
     */
    async changePassword(currentPassword, newPassword) {
        const response = await fetch(`${API_URL}/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'No se pudo cambiar la contraseña.');
        }
        return response.json();
    }
};
