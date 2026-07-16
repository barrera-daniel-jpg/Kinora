import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend, scopeQuery } from '../../services/api.js';

// Endpoint de coaches. Crear un coach genera, en el servidor, un usuario
// (role 'coach') + su perfil, con la contraseña hasheada.
const COACHES_URL = `${API_URL}/coaches`;

/**
 * initCoaches()
 * Controlador de la vista de Coaches. Solo el admin puede gestionar coaches.
 */
export async function initCoaches() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-coach');
    const formContainer = document.getElementById('coach-form-container');
    const coachForm = document.getElementById('coach-form');
    const cancelButton = document.getElementById('btn-cancel-coach');

    // El admin (y el superadmin, que hereda sus poderes) gestionan coaches.
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        showCreateButton.style.display = 'none';
    }

    showCreateButton.addEventListener('click', () => {
        coachForm.reset();
        document.getElementById('coach-id').value = '';
        document.getElementById('coach-form-title').textContent = 'Crear Coach';
        formContainer.style.display = 'block';
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        coachForm.reset();
    });

    coachForm.addEventListener('submit', handleCoachSubmission);

    await renderCoaches();
}

/**
 * renderCoaches()
 * Trae los coaches del backend y dibuja una tarjeta por cada uno.
 */
async function renderCoaches() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('coaches-list');
    listContainer.innerHTML = '';

    // AISLAMIENTO: el admin ve solo SUS coaches (?admin_id=); el superadmin, todos.
    const coaches = await apiGet(`${COACHES_URL}${scopeQuery(currentUser)}`);

    if (!coaches.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay coaches registrados.</p>';
        return;
    }

    coaches.forEach(coach => {
        const card = document.createElement('div');
        card.className = 'card';

        let actionsHTML = '';
        if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')) {
            actionsHTML = `
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                    <button class="btn btn-danger btn-delete-coach" data-id="${coach.id}">Eliminar</button>
                </div>
            `;
        }

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${coach.full_name}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Usuario: ${coach.username}</small></p>
                <p style="margin: 0;"><small>Correo: ${coach.email || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Teléfono: ${coach.phone || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Aprobado: ${coach.is_approved ? 'Sí' : 'No'}</small></p>
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-delete-coach').forEach(button =>
        button.addEventListener('click', removeCoach));
}

/**
 * handleCoachSubmission(event)
 * Crea un coach (usuario + perfil) con su contraseña.
 */
async function handleCoachSubmission(event) {
    event.preventDefault();

    // AISLAMIENTO: si quien crea el coach es un admin, el coach nace etiquetado con su
    // admin_id (user.id) para que solo ese admin lo vea. El superadmin lo deja sin dueño.
    const currentUser = AuthService.getCurrentUser();
    const admin_id = currentUser && currentUser.role === 'admin' ? currentUser.id : null;

    const payload = {
        full_name: document.getElementById('coach-name').value,
        phone: document.getElementById('coach-phone').value || null,
        username: document.getElementById('coach-username').value,
        email: document.getElementById('coach-email').value || null,
        password: document.getElementById('coach-password').value,
        admin_id
    };

    try {
        await apiSend(COACHES_URL, 'POST', payload, 'No se pudo guardar el coach.');

        document.getElementById('coach-form-container').style.display = 'none';
        document.getElementById('coach-form').reset();
        await renderCoaches();
    } catch (error) {
        console.error('Error al guardar el coach:', error);
        alert(error.message);
    }
}

/**
 * removeCoach(event)
 * Elimina un coach tras confirmar.
 */
async function removeCoach(event) {
    if (!confirm('¿Seguro que deseas eliminar este coach?')) return;

    const coachId = event.target.dataset.id;
    try {
        await apiSend(`${COACHES_URL}/${coachId}`, 'DELETE', undefined, 'No se pudo eliminar el coach.');
        await renderCoaches();
    } catch (error) {
        alert(error.message);
    }
}
