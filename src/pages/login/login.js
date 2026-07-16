import { AuthService } from '../../services/auth.js';
import { navigateTo } from '../../router/index.js';

export function initLogin() {
    const form = document.getElementById('login-form');
    const errorMsg = document.getElementById('login-error');

    const backLink = document.getElementById('auth-back');
    if (backLink) {
        backLink.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/');
        });
    }

    const requestLink = document.getElementById('auth-request');
    if (requestLink) {
        requestLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('https://forms.gle/ix7tePMizVstVeFz7', '_blank', 'noopener');
        });
    }

    // Sin el formulario no hay nada que enganchar; salimos sin romper el router.
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // Evita que la página se recargue
        errorMsg.style.display = 'none';

        // Capturamos los valores justo en el momento del envío.
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        try {
            await AuthService.login(username, password);
            navigateTo('/dashboard');
        } catch (error) {
            // Credenciales incorrectas o backend caído: mostramos el mensaje al usuario.
            errorMsg.textContent = error.message;
            errorMsg.style.display = 'block';
        }
    });
}