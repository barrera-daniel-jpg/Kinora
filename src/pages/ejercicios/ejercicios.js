import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend, scopeQuery } from '../../services/api.js';

// Endpoint del catálogo de ejercicios en el backend (tabla base_v1.exercises).
const EXERCISES_URL = `${API_URL}/exercises`;

/**
 * initEjercicios()
 * Controlador de la vista de Ejercicios. El router lo ejecuta tras inyectar el HTML.
 * - Conecta botones y formulario.
 * - Restringe la creación/edición al rol "coach".
 * - Pinta el catálogo.
 */
export async function initEjercicios() {
    const currentUser = AuthService.getCurrentUser();

    const showCreateButton = document.getElementById('btn-show-create-exercise');
    const formContainer = document.getElementById('exercise-form-container');
    const exerciseForm = document.getElementById('exercise-form');
    const cancelButton = document.getElementById('btn-cancel-exercise');

    // Solo un coach puede dar de alta o editar ejercicios.
    if (!currentUser || currentUser.role !== 'coach') {
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
 * Trae los ejercicios del backend y dibuja una tarjeta por cada uno.
 * Nota: en la BD la categoría se llama "muscle_group".
 */
async function renderExercises() {
    const currentUser = AuthService.getCurrentUser();
    const listContainer = document.getElementById('exercises-list');
    listContainer.innerHTML = '';

    // Aislamiento: un coach ve SUS ejercicios + el catálogo global (?coach_id=); un admin,
    // los de SUS coaches + el catálogo (?admin_id=); el superadmin los ve todos.
    const exercises = await apiGet(`${EXERCISES_URL}${scopeQuery(currentUser)}`);

    if (!exercises.length) {
        listContainer.innerHTML = '<p style="color: var(--a-text-muted);">Aún no hay ejercicios en el catálogo.</p>';
        return;
    }

    exercises.forEach(exercise => {
        const card = document.createElement('div');
        card.className = 'card';

        let actionsHTML = '';
        if (currentUser && currentUser.role === 'coach') {
            actionsHTML = `
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                    <button class="btn btn-edit-exercise" data-id="${exercise.id}">Editar</button>
                    <button class="btn btn-danger btn-delete-exercise" data-id="${exercise.id}">Eliminar</button>
                </div>
            `;
        }

        card.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${exercise.name}</h3>
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
 * Mapea los campos del formulario a las columnas reales de la tabla.
 */
async function handleExerciseSubmission(event) {
    event.preventDefault();

    const currentUser = AuthService.getCurrentUser();
    const exerciseId = document.getElementById('exercise-id').value;

    const exercisePayload = {
        name: document.getElementById('exercise-name').value,
        muscle_group: document.getElementById('exercise-category').value, // categoría = grupo muscular
        equipment: document.getElementById('exercise-equipment').value,
        difficulty: document.getElementById('exercise-difficulty').value, // valores en minúscula
        description: document.getElementById('exercise-description').value,
        coach_id: currentUser ? currentUser.coach_id : null
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
    const exercise = await apiGet(`${EXERCISES_URL}/${exerciseId}`);

    document.getElementById('exercise-id').value = exercise.id;
    document.getElementById('exercise-name').value = exercise.name || '';
    document.getElementById('exercise-category').value = exercise.muscle_group || '';
    document.getElementById('exercise-equipment').value = exercise.equipment || '';
    document.getElementById('exercise-difficulty').value = exercise.difficulty || 'principiante';
    document.getElementById('exercise-description').value = exercise.description || '';

    document.getElementById('exercise-form-title').textContent = 'Editar Ejercicio';
    document.getElementById('exercise-form-container').style.display = 'block';
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
