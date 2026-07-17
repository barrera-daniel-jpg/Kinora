import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend } from '../../services/api.js';

// Endpoint de atletas del backend. Crear un atleta implica, en el servidor,
// crear un usuario (role 'athlete') y su perfil en la tabla athletes.
const ATHLETES_URL = `${API_URL}/athletes`;
const COACHES_URL = `${API_URL}/coaches`;
const ROUTINES_URL = `${API_URL}/routines`;

// Atleta cuyo panel de "asignar rutinas" está abierto (para refrescar tras cada toggle).
let assignPanelAthleteId = null;
let assignPanelAthleteName = '';

// El coach, el admin y el superadmin pueden gestionar atletas.
function canManageAthletes(user) {
    return user && (user.role === 'coach' || user.role === 'admin' || user.role === 'superadmin');
}

/**
 * populateCoachOptions()
 * Llena el selector de coach (solo lo usa el admin) con la lista de coaches.
 */
async function populateCoachOptions() {
    const coachSelect = document.getElementById('athlete-coach');
    if (!coachSelect) return;

    // El backend ya recorta la lista según el token: un admin solo recibe SUS
    // coaches y el superadmin los recibe todos. Aquí no hace falta filtrar nada.
    const coaches = await apiGet(COACHES_URL);
    coachSelect.innerHTML = '<option value="">Sin coach</option>' +
        coaches.map(c => `<option value="${c.id}">${c.full_name}</option>`).join('');
}

/**
 * initAtleta()
 * Controlador de la vista de Atletas. Solo el coach puede crear/editar/eliminar.
 */
export async function initAtleta() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-athlete');
    const formContainer = document.getElementById('athlete-form-container');
    const athleteForm = document.getElementById('athlete-form');
    const cancelButton = document.getElementById('btn-cancel-athlete');

    if (!canManageAthletes(currentUser)) {
        showCreateButton.style.display = 'none';
    }

    // El admin elige el coach del atleta; para un coach se asigna solo.
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin');
    if (isAdmin) {
        await populateCoachOptions();
    }

    showCreateButton.addEventListener('click', () => {
        resetAthleteForm();
        document.getElementById('athlete-id').value = '';
        document.getElementById('athlete-form-title').textContent = 'Crear Atleta';
        // Al crear se piden usuario y contraseña.
        setUserFieldsVisible(true);
        // El selector de coach solo se muestra al admin.
        document.getElementById('athlete-coach-group').style.display = isAdmin ? 'block' : 'none';
        formContainer.style.display = 'block';
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        resetAthleteForm();
    });

    athleteForm.addEventListener('submit', handleAthleteSubmission);

    // Cerrar el panel de asignación de rutinas.
    document.getElementById('btn-close-assign').addEventListener('click', () => {
        document.getElementById('assign-routines-container').style.display = 'none';
        assignPanelAthleteId = null;
    });

    await renderAthletes();
}

function resetAthleteForm() {
    document.getElementById('athlete-form').reset();
}

/**
 * setUserFieldsVisible(visible)
 * El nombre de usuario y la contraseña solo se establecen al CREAR el atleta;
 * al editar se ocultan (no reemitimos credenciales desde esta vista).
 */
function setUserFieldsVisible(visible) {
    document.getElementById('athlete-user-group').style.display = visible ? 'block' : 'none';
    document.getElementById('athlete-password-group').style.display = visible ? 'block' : 'none';
    document.getElementById('athlete-username').required = visible;
    document.getElementById('athlete-password').required = visible;
}

/**
 * complianceHTML(athlete)
 * Barra de cumplimiento: qué porcentaje de sus rutinas asignadas ha completado.
 *
 * routine_count y completed_count los cuenta el backend en la propia consulta, así
 * que aquí solo es una división. Antes esto no existía y el coach no tenía forma de
 * ver de un vistazo quién está al día y quién no.
 *
 * El color es intencionado: verde >= 80%, ámbar >= 50%, rojo por debajo. Un número
 * suelto obliga a leer y comparar; el color se entiende sin pensar.
 */
function complianceHTML(athlete) {
    const total = athlete.routine_count ?? 0;
    if (!total) return '<small style="color: var(--text-muted);">Sin rutinas asignadas</small>';

    const done = athlete.completed_count ?? 0;
    const percent = Math.round((done / total) * 100);
    const color = percent >= 80 ? 'var(--success)' : percent >= 50 ? '#f59e0b' : 'var(--danger)';

    return `<small>Cumplimiento:
        <strong style="color: ${color};">${percent}%</strong>
        <span style="color: var(--text-muted);">(${done} de ${total} rutinas)</span>
    </small>`;
}

/**
 * renderAthletes()
 * Trae los atletas del backend y dibuja una tarjeta por cada uno.
 */
async function renderAthletes() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('athletes-list');
    listContainer.innerHTML = '';

    // El recorte por rol lo hace el backend a partir del token.
    let athletes;
    try {
        athletes = await apiGet(ATHLETES_URL);
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    if (!athletes.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay atletas registrados.</p>';
        return;
    }

    athletes.forEach(athlete => {
        const card = document.createElement('div');
        card.className = 'card';

        let actionsHTML = '';
        if (canManageAthletes(currentUser)) {
            actionsHTML = `
                <div style="margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    <button class="btn btn-assign-routines" data-id="${athlete.id}" data-name="${athlete.full_name}">Asignar rutinas</button>
                    <button class="btn btn-edit-athlete" data-id="${athlete.id}">Editar</button>
                    <button class="btn btn-danger btn-delete-athlete" data-id="${athlete.id}">Eliminar</button>
                </div>
            `;
        }

        // birthdate llega como fecha ISO; mostramos solo la parte de fecha.
        const birthdate = athlete.birthdate ? String(athlete.birthdate).slice(0, 10) : 'No registrada';

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${athlete.full_name}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Usuario: ${athlete.username}</small></p>
                <p style="margin: 0;"><small>Correo: ${athlete.email || 'No registrado'}</small></p>
                <p style="margin: 0;"><small>Documento: ${athlete.document_number}</small></p>
                <p style="margin: 0;"><small>Nacimiento: ${birthdate}</small></p>
                ${athlete.coach_name ? `<p style="margin: 0;"><small>Coach: ${athlete.coach_name}</small></p>` : ''}
                <p style="margin: 0.2rem 0 0;">${complianceHTML(athlete)}</p>
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-edit-athlete').forEach(button =>
        button.addEventListener('click', prepareAthleteEdition));
    document.querySelectorAll('.btn-delete-athlete').forEach(button =>
        button.addEventListener('click', removeAthlete));
    document.querySelectorAll('.btn-assign-routines').forEach(button =>
        button.addEventListener('click', openAssignRoutines));
}

/**
 * openAssignRoutines(event)
 * Abre el panel de asignación para un atleta y lo pinta.
 */
async function openAssignRoutines(event) {
    assignPanelAthleteId = event.target.dataset.id;
    assignPanelAthleteName = event.target.dataset.name || '';
    document.getElementById('assign-routines-title').textContent = `Rutinas de ${assignPanelAthleteName}`;
    document.getElementById('assign-routines-container').style.display = 'block';
    await renderAssignPanel();
}

/**
 * renderAssignPanel()
 * Lista las rutinas que este usuario puede asignar y marca las que YA tiene el
 * atleta, con un botón para asignar o quitar cada una. Un atleta puede tener varias.
 *
 * Antes esto hacía DOS peticiones: una para las rutinas disponibles y otra para las
 * del atleta. No hace falta: cada rutina ya viene con su lista de `assignments`, así
 * que saber si este atleta está dentro es mirar ese array. Una petición menos y sin
 * riesgo de que las dos respuestas se contradigan.
 *
 * Solo se ofrecen las rutinas con can_edit: asignar es modificar la rutina, así que
 * las que no son suyas (catálogo base incluido) el backend las rechazaría.
 */
async function renderAssignPanel() {
    const container = document.getElementById('assign-routines-list');
    container.innerHTML = '<p style="color: var(--a-text-muted);">Cargando…</p>';

    let routines;
    try {
        routines = await apiGet(ROUTINES_URL);
    } catch (error) {
        container.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    const athleteId = Number(assignPanelAthleteId);
    const available = routines.filter(r => r.can_edit);

    if (!available.length) {
        container.innerHTML = '<p style="color: var(--a-text-muted);">No tienes rutinas propias para asignar. Crea una en la sección Rutinas.</p>';
        return;
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
            ${available.map(routine => {
                const isAssigned = (routine.assignments || []).some(a => a.athlete_id === athleteId);
                return `
                    <div class="card" style="padding: 0.8rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                        <div>
                            <strong>${routine.name}</strong>
                            <p style="margin: 0.2rem 0 0; font-size: 0.85rem; color: var(--a-text-muted);">
                                ${routine.weekly_frequency} días/semana · ${(routine.exercises || []).length} ejercicios
                                ${isAssigned ? ' · <span style="color: var(--a-accent, #a3e635);">Asignada</span>' : ''}
                            </p>
                        </div>
                        <button class="btn ${isAssigned ? 'btn-danger' : ''} btn-toggle-assign"
                                data-routine-id="${routine.id}" data-assigned="${isAssigned}">
                            ${isAssigned ? 'Quitar' : 'Asignar'}
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    container.querySelectorAll('.btn-toggle-assign').forEach(button =>
        button.addEventListener('click', toggleAssignment));
}

/**
 * toggleAssignment(event)
 * Asigna (POST) o quita (DELETE) una rutina al atleta abierto en el panel.
 */
async function toggleAssignment(event) {
    const routineId = event.target.dataset.routineId;
    const isAssigned = event.target.dataset.assigned === 'true';

    // Si ya la tiene -> DELETE (quitar); si no -> POST (asignar).
    try {
        if (isAssigned) {
            await apiSend(`${ROUTINES_URL}/${routineId}/assignments/${assignPanelAthleteId}`,
                'DELETE', undefined, 'No se pudo actualizar la asignación.');
        } else {
            await apiSend(`${ROUTINES_URL}/${routineId}/assignments`,
                'POST', { athlete_id: Number(assignPanelAthleteId) }, 'No se pudo actualizar la asignación.');
        }
        // Se repintan los dos: el panel (para el botón Asignar/Quitar) y la lista
        // de atletas, porque el cumplimiento depende de cuántas rutinas tiene y
        // acaba de cambiar. Sin esto, el porcentaje de la tarjeta quedaría viejo.
        await Promise.all([renderAssignPanel(), renderAthletes()]);
    } catch (error) {
        alert(error.message);
    }
}

/**
 * handleAthleteSubmission(event)
 * Crea (POST) o actualiza (PUT) un atleta.
 */
async function handleAthleteSubmission(event) {
    event.preventDefault();

    const currentUser = AuthService.getCurrentUser();
    const athleteId = document.getElementById('athlete-id').value;

    // El coach asigna sus propios atletas; el admin elige el coach en el selector.
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin');
    const selectedCoachId = document.getElementById('athlete-coach').value;
    const coachId = isAdmin
        ? (selectedCoachId ? Number(selectedCoachId) : null)
        : (currentUser ? currentUser.coach_id : null);

    // Campos comunes a crear y editar.
    const basePayload = {
        full_name: document.getElementById('athlete-name').value,
        document_number: document.getElementById('athlete-document').value,
        birthdate: document.getElementById('athlete-birthdate').value,
        email: document.getElementById('athlete-email').value || null,
        coach_id: coachId
    };

    try {
        if (athleteId) {
            // Edición: solo datos del perfil (no credenciales). PUT sobre :id.
            await apiSend(`${ATHLETES_URL}/${athleteId}`, 'PUT', basePayload, 'No se pudo guardar el atleta.');
        } else {
            // Creación: añade usuario y contraseña al payload. POST.
            const createPayload = {
                ...basePayload,
                username: document.getElementById('athlete-username').value,
                password: document.getElementById('athlete-password').value
            };
            await apiSend(ATHLETES_URL, 'POST', createPayload, 'No se pudo guardar el atleta.');
        }

        document.getElementById('athlete-form-container').style.display = 'none';
        resetAthleteForm();
        await renderAthletes();
    } catch (error) {
        console.error('Error al guardar el atleta:', error);
        alert(error.message);
    }
}

/**
 * prepareAthleteEdition(event)
 * Carga los datos de un atleta en el formulario para editarlo.
 */
async function prepareAthleteEdition(event) {
    const athleteId = event.target.dataset.id;
    const athlete = await apiGet(`${ATHLETES_URL}/${athleteId}`);

    document.getElementById('athlete-id').value = athlete.id;
    document.getElementById('athlete-name').value = athlete.full_name || '';
    document.getElementById('athlete-document').value = athlete.document_number || '';
    document.getElementById('athlete-birthdate').value = athlete.birthdate ? String(athlete.birthdate).slice(0, 10) : '';
    document.getElementById('athlete-email').value = athlete.email || '';

    // Al editar no cambiamos usuario/contraseña desde aquí.
    setUserFieldsVisible(false);

    // El admin puede reasignar el coach; para un coach el selector queda oculto.
    const currentUser = AuthService.getCurrentUser();
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin');
    document.getElementById('athlete-coach-group').style.display = isAdmin ? 'block' : 'none';
    if (isAdmin) {
        document.getElementById('athlete-coach').value = athlete.coach_id ? String(athlete.coach_id) : '';
    }

    document.getElementById('athlete-form-title').textContent = 'Editar Atleta';
    document.getElementById('athlete-form-container').style.display = 'block';
}

/**
 * removeAthlete(event)
 * Elimina un atleta tras confirmar.
 */
async function removeAthlete(event) {
    if (!confirm('¿Seguro que deseas eliminar este atleta?')) return;

    const athleteId = event.target.dataset.id;
    try {
        await apiSend(`${ATHLETES_URL}/${athleteId}`, 'DELETE', undefined, 'No se pudo eliminar el atleta.');
        await renderAthletes();
    } catch (error) {
        alert(error.message);
    }
}
