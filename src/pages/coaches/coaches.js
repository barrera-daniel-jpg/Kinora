import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend } from '../../services/api.js';

// Endpoint de coaches. Crear un coach genera, en el servidor, un usuario
// (role 'coach') + su perfil, con la contraseña hasheada.
const COACHES_URL = `${API_URL}/coaches`;

// Roles que gestionan coaches. El backend lo vuelve a comprobar; esto solo decide
// qué se dibuja.
const MANAGER_ROLES = ['admin', 'superadmin'];

/**
 * initCoaches()
 * Controlador de la vista de Coaches. Solo admin y superadmin la usan.
 */
export async function initCoaches() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-coach');
    const formContainer = document.getElementById('coach-form-container');
    const coachForm = document.getElementById('coach-form');
    const cancelButton = document.getElementById('btn-cancel-coach');

    if (!currentUser || !MANAGER_ROLES.includes(currentUser.role)) {
        showCreateButton.style.display = 'none';
    }

    showCreateButton.addEventListener('click', () => {
        openCoachForm(null);
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        coachForm.reset();
    });

    coachForm.addEventListener('submit', handleCoachSubmission);

    await renderCoaches();
}

/**
 * openCoachForm(coach)
 * Abre el formulario vacío (crear) o relleno con un coach (editar).
 *
 * La contraseña se comporta distinto según el caso, y por eso se ajusta aquí:
 *   · Al CREAR es obligatoria — sin ella el coach no podría entrar nunca.
 *   · Al EDITAR se oculta, porque este formulario no cambia contraseñas. Para eso
 *     está "cambiar contraseña", que exige conocer la actual. Si se dejara aquí,
 *     un campo vacío parecería "no cambiar" pero se enviaría igual.
 */
function openCoachForm(coach) {
    const form = document.getElementById('coach-form');
    form.reset();

    const isEditing = Boolean(coach);
    const passwordGroup = document.getElementById('coach-password-group');
    const passwordInput = document.getElementById('coach-password');

    passwordGroup.style.display = isEditing ? 'none' : '';
    passwordInput.required = !isEditing;

    // El usuario tampoco se cambia al editar: es su identidad para iniciar sesión.
    document.getElementById('coach-username').disabled = isEditing;

    if (isEditing) {
        document.getElementById('coach-id').value = coach.id;
        document.getElementById('coach-name').value = coach.full_name || '';
        document.getElementById('coach-phone').value = coach.phone || '';
        document.getElementById('coach-username').value = coach.username || '';
        document.getElementById('coach-email').value = coach.email || '';
        document.getElementById('number-document').value = coach.document_number || '';
        // La fecha llega como ISO ("1990-01-01T00:00:00.000Z") y el <input type="date">
        // solo acepta "1990-01-01": nos quedamos con la parte anterior a la T.
        document.getElementById('coach-birthdate').value = coach.birthdate
            ? String(coach.birthdate).split('T')[0]
            : '';
    } else {
        document.getElementById('coach-id').value = '';
    }

    document.getElementById('coach-form-title').textContent = isEditing ? 'Editar Coach' : 'Crear Coach';
    document.getElementById('coach-form-container').style.display = 'block';
}

/**
 * renderCoaches()
 * Trae los coaches visibles y dibuja una tarjeta por cada uno.
 * El recorte (admin -> solo los suyos) lo aplica el backend según el token.
 */
async function renderCoaches() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('coaches-list');
    listContainer.innerHTML = '';

    let coaches;
    try {
        coaches = await apiGet(COACHES_URL);
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    if (!coaches.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay coaches registrados.</p>';
        return;
    }

    const canManage = currentUser && MANAGER_ROLES.includes(currentUser.role);

    coaches.forEach(coach => {
        const card = document.createElement('div');
        card.className = 'card';

        const actionsHTML = canManage
            ? `<div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                   <button class="btn btn-edit-coach" data-id="${coach.id}">Editar</button>
                   <button class="btn btn-danger btn-delete-coach" data-id="${coach.id}">Eliminar</button>
               </div>`
            : '';

        // La fecha se muestra en formato local; sin esto se vería el ISO crudo.
        const birthdate = coach.birthdate
            ? new Date(coach.birthdate).toLocaleDateString('es-CO')
            : 'No registrada';

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${coach.full_name}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Usuario: ${coach.username}</small></p>
                <p style="margin: 0;"><small>Correo: ${coach.email || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Número de documento: ${coach.document_number || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Fecha de nacimiento: ${birthdate}</small></p>
                <p style="margin: 0;"><small>Teléfono: ${coach.phone || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Acceso: ${coach.is_active === false ? 'Suspendido' : 'Activo'}</small></p>
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-edit-coach').forEach(button =>
        button.addEventListener('click', prepareCoachEdition));
    document.querySelectorAll('.btn-delete-coach').forEach(button =>
        button.addEventListener('click', removeCoach));
}

/**
 * prepareCoachEdition(event)
 * Carga un coach en el formulario para editarlo.
 */
async function prepareCoachEdition(event) {
    try {
        const coach = await apiGet(`${COACHES_URL}/${event.target.dataset.id}`);
        openCoachForm(coach);
    } catch (error) {
        alert(error.message);
    }
}

/**
 * handleCoachSubmission(event)
 * Crea (POST) o edita (PUT) un coach.
 *
 * Ya no se manda admin_id: quién es el dueño del coach lo decide el servidor a
 * partir del token (si lo crea un admin, queda a su cargo). Mandarlo desde aquí
 * habría permitido asignarle un coach a otro admin escribiendo su id a mano.
 */
async function handleCoachSubmission(event) {
    event.preventDefault();

    const coachId = document.getElementById('coach-id').value;
    const isEditing = Boolean(coachId);

    const payload = {
        full_name: document.getElementById('coach-name').value,
        phone: document.getElementById('coach-phone').value || null,
        email: document.getElementById('coach-email').value || null,
        document_number: document.getElementById('number-document').value || null,
        birthdate: document.getElementById('coach-birthdate').value || null
    };

    // Usuario y contraseña solo viajan al CREAR: al editar no se tocan.
    if (!isEditing) {
        payload.username = document.getElementById('coach-username').value || null;
        payload.password = document.getElementById('coach-password').value || null;
    }

    const url = isEditing ? `${COACHES_URL}/${coachId}` : COACHES_URL;
    const method = isEditing ? 'PUT' : 'POST';

    try {
        await apiSend(url, method, payload, 'No se pudo guardar el coach.');

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
 *
 * El aviso es explícito porque el borrado arrastra en cascada a sus atletas,
 * rutinas y ejercicios: es una acción que no se puede deshacer y conviene que
 * quede claro ANTES, no después.
 */
async function removeCoach(event) {
    const confirmed = confirm(
        'Eliminar este coach borrará también SUS ATLETAS, SUS RUTINAS y SUS EJERCICIOS.\n\n' +
        'Esta acción no se puede deshacer. ¿Continuar?'
    );
    if (!confirmed) return;

    try {
        await apiSend(`${COACHES_URL}/${event.target.dataset.id}`, 'DELETE', undefined, 'No se pudo eliminar el coach.');
        await renderCoaches();
    } catch (error) {
        alert(error.message);
    }
}
