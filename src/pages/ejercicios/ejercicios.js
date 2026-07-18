import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend } from '../../services/api.js';

// Endpoint del catálogo de ejercicios en el backend (tabla base_v1.exercises).
const EXERCISES_URL = `${API_URL}/exercises`;

// Roles que pueden tener ejercicios propios. El atleta solo consulta el catálogo.
const CREATOR_ROLES = ['coach', 'admin', 'superadmin'];

/**
 * initEjercicios()
 * Controlador de la vista de Ejercicios. El router lo ejecuta tras inyectar el HTML.
 *
 * Ya no hace falta mandar filtros en la URL: el backend deduce del token quién
 * pregunta y devuelve solo lo que esa persona puede ver.
 */
export async function initEjercicios() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-exercise');
    const formContainer = document.getElementById('exercise-form-container');
    const exerciseForm = document.getElementById('exercise-form');
    const cancelButton = document.getElementById('btn-cancel-exercise');

    // El botón de crear se esconde a quien no puede crear. Es solo comodidad visual:
    // si alguien lo forzara, el backend responde 403 igualmente.
    if (!currentUser || !CREATOR_ROLES.includes(currentUser.role)) {
        showCreateButton.style.display = 'none';
    }

    showCreateButton.addEventListener('click', () => {
        resetExerciseForm();
        document.getElementById('exercise-id').value = '';
        document.getElementById('exercise-form-title').textContent = 'Crear Ejercicio';
        formContainer.style.display = 'block';
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        resetExerciseForm();
    });

    exerciseForm.addEventListener('submit', handleExerciseSubmission);

    await renderExercises();
}

function resetExerciseForm() {
    document.getElementById('exercise-form').reset();
}

/**
 * renderExercises()
 * Trae los ejercicios visibles y dibuja una tarjeta por cada uno.
 *
 * Los botones de editar/borrar se pintan según el `can_edit` que manda el backend,
 * y no según el rol. La diferencia importa: un coach ve el catálogo base pero no lo
 * puede tocar, así que decidir por rol le mostraría botones que siempre fallarían.
 * Con can_edit, cada tarjeta sabe si ESE ejercicio concreto es suyo.
 */
async function renderExercises() {
    const listContainer = document.getElementById('exercises-list');
    listContainer.innerHTML = '';

    let exercises;
    try {
        exercises = await apiGet(EXERCISES_URL);
    } catch (error) {
        listContainer.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    if (!exercises.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay ejercicios en el catálogo.</p>';
        return;
    }

    exercises.forEach(exercise => {
        const card = document.createElement('div');
        card.className = 'card';

        const actionsHTML = exercise.can_edit
            ? `<div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                   <button class="btn btn-edit-exercise" data-id="${exercise.id}">Editar</button>
                   <button class="btn btn-danger btn-delete-exercise" data-id="${exercise.id}">Eliminar</button>
               </div>`
            : '';

        // Distintivo del catálogo base, para que se entienda de un vistazo POR QUÉ
        // ese ejercicio no trae botones, en vez de parecer un fallo de la página.
        const badge = exercise.created_by == null
            ? '<span class="badge-base" title="Del catálogo base: lo puedes usar en tus rutinas, pero no modificar">Catálogo base</span>'
            : '';

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${exercise.name} ${badge}</h3>
            <div style="display: grid; gap: 0.3rem; color: var(--a-text-muted);">
                <p style="margin: 0;"><small>Grupo muscular: ${exercise.muscle_group || 'Sin categoría'}</small></p>
                <p style="margin: 0;"><small>Equipo: ${exercise.equipment || 'No especificado'}</small></p>
                <p style="margin: 0;"><small>Dificultad: ${exercise.difficulty || 'No especificada'}</small></p>
                ${exercise.description ? `<p style="margin: 0.4rem 0 0;"><small>${exercise.description}</small></p>` : ''}
            </div>
            ${actionsHTML}
        `;
        listContainer.appendChild(card);
    });

    document.querySelectorAll('.btn-edit-exercise').forEach(button =>
        button.addEventListener('click', prepareExerciseEdition));
    document.querySelectorAll('.btn-delete-exercise').forEach(button =>
        button.addEventListener('click', removeExercise));
}

/**
 * handleExerciseSubmission(event)
 * Crea (POST) o actualiza (PUT) un ejercicio.
 *
 * Ya no se manda coach_id: el dueño lo decide el servidor a partir del token.
 * Mandarlo desde aquí no servía de nada —el backend lo ignora— y hacía creer que
 * el cliente elegía de quién es cada ejercicio.
 */
async function handleExerciseSubmission(event) {
    event.preventDefault();

    const exerciseId = document.getElementById('exercise-id').value;

    const exercisePayload = {
        name: document.getElementById('exercise-name').value,
        muscle_group: document.getElementById('exercise-category').value, // categoría = grupo muscular
        equipment: document.getElementById('exercise-equipment').value,
        difficulty: document.getElementById('exercise-difficulty').value, // valores en minúscula
        description: document.getElementById('exercise-description').value
    };

    // Editar (PUT sobre :id) o crear (POST): misma llamada, cambia el método y la URL.
    const url = exerciseId ? `${EXERCISES_URL}/${exerciseId}` : EXERCISES_URL;
    const method = exerciseId ? 'PUT' : 'POST';

    try {
        await apiSend(url, method, exercisePayload, 'No se pudo guardar el ejercicio.');

        document.getElementById('exercise-form-container').style.display = 'none';
        resetExerciseForm();
        await renderExercises();
    } catch (error) {
        console.error('Error al guardar el ejercicio:', error);
        alert(error.message);
    }
}

/**
 * prepareExerciseEdition(event)
 * Carga los datos de un ejercicio en el formulario para editarlo.
 */
async function prepareExerciseEdition(event) {
    const exerciseId = event.target.dataset.id;

    try {
        const exercise = await apiGet(`${EXERCISES_URL}/${exerciseId}`);

        document.getElementById('exercise-id').value = exercise.id;
        document.getElementById('exercise-name').value = exercise.name || '';
        document.getElementById('exercise-category').value = exercise.muscle_group || '';
        document.getElementById('exercise-equipment').value = exercise.equipment || '';
        document.getElementById('exercise-difficulty').value = exercise.difficulty || 'principiante';
        document.getElementById('exercise-description').value = exercise.description || '';

        document.getElementById('exercise-form-title').textContent = 'Editar Ejercicio';
        document.getElementById('exercise-form-container').style.display = 'block';
    } catch (error) {
        alert(error.message);
    }
}

/**
 * removeExercise(event)
 * Elimina un ejercicio tras confirmar.
 */
async function removeExercise(event) {
    if (!confirm('¿Seguro que deseas eliminar este ejercicio?')) return;

    const exerciseId = event.target.dataset.id;
    try {
        await apiSend(`${EXERCISES_URL}/${exerciseId}`, 'DELETE', undefined, 'No se pudo eliminar el ejercicio.');
        await renderExercises();
    } catch (error) {
        alert(error.message);
    }
}
