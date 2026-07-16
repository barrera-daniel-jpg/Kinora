import { loadHTML } from '../helpers/loadHTML.js';
import { AuthService } from '../services/auth.js';
import { initLogin } from '../pages/login/login.js';
import { initDashboard } from '../pages/dashboard/dashboard.js';
import { initProjects } from '../pages/projects/projects.js';
import { initLanding } from '../pages/landing/landing.js';
import { renderNavbar } from '../components/navbar/navbar.js';
import { initAtleta } from '../pages/atletas/atletas.js';
import { initEjercicios } from '../pages/ejercicios/ejercicios.js';
import { initCoaches } from '../pages/coaches/coaches.js';
import { initAdmins } from '../pages/admins/admins.js';
import { initLegal } from '../pages/legal/legal.js';

const routes = {
    '/': { html: '/src/pages/landing/landing.html', init: initLanding, private: false },
    '/login': { html: '/src/pages/login/login.html', init: initLogin, private: false },
    '/dashboard': { html: '/src/pages/dashboard/dashboard.html', init: initDashboard, private: true },
    '/projects': { html: '/src/pages/projects/projects.html', init: initProjects, private: true },
    '/atletas': { html: '/src/pages/atletas/atletas.html', init: initAtleta, private: true },
    '/ejercicios': { html: '/src/pages/ejercicios/ejercicios.html', init: initEjercicios, private: true },
    '/coaches': { html: '/src/pages/coaches/coaches.html', init: initCoaches, private: true },
    '/admins': { html: '/src/pages/admins/admins.html', init: initAdmins, private: true },
    // alwaysAccessible: visible con o sin sesión (no redirige al dashboard aunque haya login).
    '/legal': { html: '/src/pages/legal/legal.html', init: initLegal, private: false, alwaysAccessible: true }
};

export async function navigateTo(path) {
    window.history.pushState({}, '', path);
    await router();
}

export async function router() {
    const path = window.location.pathname;
    let route = routes[path] || routes['/'];

    const user = AuthService.getCurrentUser();

    // 1. Protección de rutas públicas/privadas
    if (route.private && !AuthService.isAuthenticated()) {
        window.history.pushState({}, '', '/login');
        route = routes['/login'];
    } else if (!route.private && !route.alwaysAccessible && AuthService.isAuthenticated()) {
        window.history.pushState({}, '', '/dashboard');
        route = routes['/dashboard'];
    }

    // 2. Renderizar la barra de navegación de forma condicional
    await renderNavbar();

    // 3. Cargar e inyectar el HTML de la vista actual
    const content = await loadHTML(route.html);
    document.getElementById('app').innerHTML = content;

    // 4. Ejecutar el controlador lógico de la vista cargada
    route.init();
}

// Escuchar los botones de atrás/adelante del navegador
window.addEventListener('popstate', router);