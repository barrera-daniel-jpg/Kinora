import { loadHTML } from '../../helpers/loadHTML.js';
import { AuthService } from '../../services/auth.js';
import { navigateTo } from '../../router/index.js';

export async function renderNavbar() {
    const container = document.getElementById('navbar-container');
    
    if (!AuthService.isAuthenticated()) {
        container.innerHTML = '';
        return;
    }

    if (container.innerHTML === '') {
        container.innerHTML = await loadHTML('/src/components/navbar/navbar.html');
        
        document.getElementById('nav-dashboard').addEventListener('click', () => navigateTo('/dashboard'));
        document.getElementById('nav-projects').addEventListener('click', () => navigateTo('/projects'));
        document.getElementById('nav-atletas').addEventListener('click',() => navigateTo('/atletas'))
        document.getElementById('nav-ejercicios').addEventListener('click',() => navigateTo('/ejercicios'))
        document.getElementById('nav-coaches').addEventListener('click',() => navigateTo('/coaches'))
        document.getElementById('nav-admins').addEventListener('click',() => navigateTo('/admins'))
        document.getElementById('nav-logout').addEventListener('click', () => {
            AuthService.logout();
            navigateTo('/login');
        });
    }

    // Mostramos/ocultamos enlaces según el rol en cada render (por si cambia de
    // usuario sin recargar).
    //
    // Matriz id-del-enlace -> roles que lo ven. Cada rol solo ve lo que puede usar:
    //  - atleta: Dashboard y Rutinas (estas últimas en modo solo lectura).
    //  - coach: además Ejercicios y Atletas (los suyos).
    //  - admin: además Coaches (los que él creó).
    //  - superadmin: todo, incluido Admins.
    const NAV_ROLES = {
        'nav-dashboard':  ['athlete', 'coach', 'admin', 'superadmin'],
        'nav-projects':   ['athlete', 'coach', 'admin', 'superadmin'],
        'nav-ejercicios': ['coach', 'admin', 'superadmin'],
        'nav-atletas':    ['coach', 'admin', 'superadmin'],
        'nav-coaches':    ['admin', 'superadmin'],
        'nav-admins':     ['superadmin'],
        // Cerrar sesión siempre visible para cualquier usuario autenticado.
        'nav-logout':     ['athlete', 'coach', 'admin', 'superadmin'],
    };

    const user = AuthService.getCurrentUser();
    const role = user && user.role;

    for (const [id, allowedRoles] of Object.entries(NAV_ROLES)) {
        const link = document.getElementById(id);
        if (link) {
            link.style.display = allowedRoles.includes(role) ? '' : 'none';
        }
    }
}