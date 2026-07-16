import { API_URL } from './api.js';

// Servicio de autenticación contra el backend (tabla base_v1.users).
// El login ahora usa NOMBRE DE USUARIO (username) + contraseña, y la
// verificación de la contraseña (hasheada con bcrypt) ocurre en el servidor.
export const AuthService = {
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

        // El backend devuelve: id, username, role ('coach'/'athlete'/'admin'),
        // email, full_name, coach_id, athlete_id.
        const user = await response.json();
        localStorage.setItem('user_session', JSON.stringify(user));
        return user;
    },

    logout() {
        localStorage.removeItem('user_session');
    },

    getCurrentUser() {
        return JSON.parse(localStorage.getItem('user_session'));
    },

    isAuthenticated() {
        return this.getCurrentUser() !== null;
    }
};
