import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend } from '../../services/api.js';

// Endpoint de admins. Crear un admin genera, en el servidor, un usuario
// (role 'admin') con la contraseña hasheada. Solo el superadmin gestiona admins.
const ADMINS_URL = `${API_URL}/admins`;

/**
 * initAdmins()
 * Controlador de la vista de Admins. Solo el superadmin puede gestionar admins.
 */
export async function initAdmins() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-admin');
    const formContainer = document.getElementById('admin-form-container');
    const adminForm = document.getElementById('admin-form');
    const cancelButton = document.getElementById('btn-cancel-admin');

    // Solo el superadmin gestiona admins.
    if (!currentUser || currentUser.role !== 'superadmin') {
        showCreateButton.style.display = 'none';
    }

    showCreateButton.addEventListener('click', () => {
        adminForm.reset();
        document.getElementById('admin-id').value = '';
        document.getElementById('admin-form-title').textContent = 'Crear Admin';
        formContainer.style.display = 'block';
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        adminForm.reset();
    });

    adminForm.addEventListener('submit', handleAdminSubmission);

    await renderAdmins();
}

/**
 * renderAdmins()
 * Trae los admins del backend y dibuja una tarjeta por cada uno.
 */
async function renderAdmins() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('admins-list');
    listContainer.innerHTML = '';

    const admins = await apiGet(ADMINS_URL);

    if (!admins.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay admins registrados.</p>';
        return;
    }

    admins.forEach(admin => {
        const card = document.createElement('div');
        card.className = 'card';

        let actionsHTML = '';
        if (currentUser && currentUser.role === 'superadmin') {
            actionsHTML = `
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                    <button class="btn btn-danger btn-delete-admin" data-id="${admin.id}">Eliminar</button>
                </div>
            `;
        }

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${admin.username}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Correo: ${admin.email || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Activo: ${admin.is_active ? 'Sí' : 'No'}</small></p>
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-delete-admin').forEach(button =>
        button.addEventListener('click', removeAdmin));
}

/**
 * handleAdminSubmission(event)
 * Crea un admin (usuario con role='admin') con su contraseña.
 */
async function handleAdminSubmission(event) {
    event.preventDefault();

    const payload = {
        username: document.getElementById('admin-username').value,
        email: document.getElementById('admin-email').value || null,
        password: document.getElementById('admin-password').value
    };

    try {
        await apiSend(ADMINS_URL, 'POST', payload, 'No se pudo guardar el admin.');

        document.getElementById('admin-form-container').style.display = 'none';
        document.getElementById('admin-form').reset();
        await renderAdmins();
    } catch (error) {
        console.error('Error al guardar el admin:', error);
        alert(error.message);
    }
}

/**
 * removeAdmin(event)
 * Elimina un admin tras confirmar.
 */
async function removeAdmin(event) {
    if (!confirm('¿Seguro que deseas eliminar este admin?')) return;

    const adminId = event.target.dataset.id;
    try {
        await apiSend(`${ADMINS_URL}/${adminId}`, 'DELETE', undefined, 'No se pudo eliminar el admin.');
        await renderAdmins();
    } catch (error) {
        alert(error.message);
    }
}
