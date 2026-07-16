import { navigateTo } from '../../router/index.js';

// Formularios de Google (solicitud de acceso). Centralizados aquí para poder
// cambiarlos en un solo lugar. Hay uno genérico y uno específico por rol.
const REQUEST_FORMS = {
    general: 'https://forms.gle/ix7tePMizVstVeFz7', // "Solicitar Acceso" (nav y CTA final)
    coach:   'https://forms.gle/ix7tePMizVstVeFz7', // "Quiero ser Coach"
    atleta:  'https://forms.gle/eeYwqkrEcUqXQdtz7', // "Quiero ser Atleta"
};

// Abre un formulario en una pestaña nueva de forma segura (noopener).
function openForm(url) {
    window.open(url, '_blank', 'noopener');
}

export function initLanding() {
    // Botones que llevan al login: el de la barra ("Iniciar Sesión") y los del hero
    // ("Soy Coach" / "Soy Atleta").
    const loginButtonIds = ['nav-login', 'cta-coach', 'cta-atleta'];
    loginButtonIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => navigateTo('/login'));
    });

    // Botones "Solicitar Acceso" (nav y CTA final) abren el formulario genérico.
    const requestAccessIds = ['nav-cta', 'final-cta-btn'];
    requestAccessIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => openForm(REQUEST_FORMS.general));
    });

    // Botones "Quiero ser Coach" / "Quiero ser Atleta": cada uno abre SU formulario
    // según data-cta ("coach" | "atleta"). Si llegara otro valor, cae al genérico.
    document.querySelectorAll('[data-cta]').forEach((btn) => {
        const url = REQUEST_FORMS[btn.dataset.cta] || REQUEST_FORMS.general;
        btn.addEventListener('click', () => openForm(url));
    });

    const exploreBtn = document.getElementById('explore-benefits');
    if (exploreBtn) {
        exploreBtn.addEventListener('click', () => {
            document.getElementById('caracteristicas')?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    // Menú móvil (hamburguesa)
    const toggle = document.getElementById('landing-nav-toggle');
    const links = document.getElementById('landing-nav-links');
    if (toggle && links) {
        toggle.addEventListener('click', () => {
            links.classList.toggle('open');
            toggle.classList.toggle('active');
        });

        links.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                links.classList.remove('open');
                toggle.classList.remove('active');
            });
        });
    }

    // Enlaces del footer (Términos / Privacidad) → página /legal.
    // El data-footer-link ("terminos" | "privacidad") elige qué texto mostrar.
    document.querySelectorAll('[data-footer-link]').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(`/legal?type=${link.dataset.footerLink}`);
        });
    });
}
