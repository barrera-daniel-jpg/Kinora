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

    showCreateButton.addEventListener('click', () => openAdminForm(null));

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        adminForm.reset();
    });

    adminForm.addEventListener('submit', handleAdminSubmission);

    await renderAdmins();
}

/**
 * openAdminForm(admin)
 * Abre el formulario vacío (crear) o relleno con un admin (editar).
 *
 * Al editar se oculta la contraseña: este formulario no la cambia. Para eso está
 * el flujo de "cambiar contraseña", que exige conocer la actual.
 */
function openAdminForm(admin) {
    const form = document.getElementById('admin-form');
    form.reset();

    const isEditing = Boolean(admin);
    const passwordGroup = document.getElementById('admin-password-group');

    passwordGroup.style.display = isEditing ? 'none' : '';
    document.getElementById('admin-password').required = !isEditing;

    if (isEditing) {
        document.getElementById('admin-id').value = admin.id;
        document.getElementById('admin-username').value = admin.username || '';
        document.getElementById('admin-email').value = admin.email || '';
        document.getElementById('admin-active').checked = admin.is_active !== false;
    } else {
        document.getElementById('admin-id').value = '';
        document.getElementById('admin-active').checked = true;
    }

    document.getElementById('admin-form-title').textContent = isEditing ? 'Editar Admin' : 'Crear Admin';
    document.getElementById('admin-form-container').style.display = 'block';
}

/**
 * renderAdmins()
 * Trae los admins del backend y dibuja una tarjeta por cada uno.
 *
 * Los datos ya vienen listos del backend (incluido coach_count, contado en la BD),
 * así que aquí solo se pintan.
 */
async function renderAdmins() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('admins-list');
    listContainer.innerHTML = '';

    let admins;
    try {
        admins = await apiGet(ADMINS_URL);
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    if (!admins.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay admins registrados.</p>';
        return;
    }

    const canManage = currentUser && currentUser.role === 'superadmin';

    admins.forEach(admin => {
        const card = document.createElement('div');
        card.className = 'card';

        const actionsHTML = canManage
            ? `<div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                   <button class="btn btn-edit-admin" data-id="${admin.id}">Editar</button>
                   <button class="btn btn-danger btn-delete-admin" data-id="${admin.id}">Eliminar</button>
               </div>`
            : '';

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${admin.username}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Correo: ${admin.email || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Coaches a su cargo: ${admin.coach_count ?? 0}</small></p>
                <p style="margin: 0;"><small>Acceso: ${admin.is_active ? 'Activo' : 'Suspendido'}</small></p>
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-edit-admin').forEach(button =>
        button.addEventListener('click', prepareAdminEdition));
    document.querySelectorAll('.btn-delete-admin').forEach(button =>
        button.addEventListener('click', removeAdmin));
}

/**
 * prepareAdminEdition(event)
 * Carga un admin en el formulario para editarlo.
 *
 * No hay endpoint GET /admins/:id, así que se busca en la lista que ya tenemos.
 * Es una petición menos y los datos son los mismos que se acaban de pintar.
 */
async function prepareAdminEdition(event) {
    const adminId = Number(event.target.dataset.id);
    try {
        const admins = await apiGet(ADMINS_URL);
        const admin = admins.find(a => a.id === adminId);
        if (!admin) return alert('Ese admin ya no existe.');
        openAdminForm(admin);
    } catch (error) {
        alert(error.message);
    }
}

/**
 * handleAdminSubmission(event)
 * Crea (POST) o edita (PUT) un admin.
 */
async function handleAdminSubmission(event) {
    event.preventDefault();

    const adminId = document.getElementById('admin-id').value;
    const isEditing = Boolean(adminId);

    const payload = {
        username: document.getElementById('admin-username').value,
        email: document.getElementById('admin-email').value || null
    };

    if (isEditing) {
        // Suspender el acceso en vez de borrar: el admin no entra, pero sus coaches
        // siguen colgando de él.
        payload.is_active = document.getElementById('admin-active').checked;
    } else {
        payload.password = document.getElementById('admin-password').value;
    }

    const url = isEditing ? `${ADMINS_URL}/${adminId}` : ADMINS_URL;
    const method = isEditing ? 'PUT' : 'POST';

    try {
        await apiSend(url, method, payload, 'No se pudo guardar el admin.');

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
 *
 * Sus coaches NO se borran: quedan sin dueño y pasan a manos del superadmin. El
 * backend responde cuántos quedaron así y se avisa, porque si no, esos coaches
 * desaparecerían de la vista del admin sin que nadie supiera que hay que reasignarlos.
 */
async function removeAdmin(event) {
    if (!confirm('¿Seguro que deseas eliminar este admin?\n\nSus coaches NO se borran: quedarán sin dueño y solo el superadmin podrá gestionarlos.')) return;

    const adminId = event.target.dataset.id;
    try {
        const result = await apiSend(`${ADMINS_URL}/${adminId}`, 'DELETE', undefined, 'No se pudo eliminar el admin.');

        if (result.orphaned_coaches > 0) {
            alert(`Admin eliminado. ${result.orphaned_coaches} coach(es) quedaron sin dueño; reasígnalos cuando puedas.`);
        }
        await renderAdmins();
    } catch (error) {
        alert(error.message);
    }
}
