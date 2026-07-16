import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend, scopeQuery } from '../../services/api.js';

// Endpoints del backend.
const ROUTINES_URL = `${API_URL}/routines`;
const EXERCISES_URL = `${API_URL}/exercises`;
const ATHLETES_URL = `${API_URL}/athletes`;

// Ejercicios que se van agregando a la rutina en el formulario (aún sin guardar).
// Cada item: { exercise_id, exercise_name, sets, reps, rest_seconds }
let draftExercises = [];

export async function initProjects() {
    const currentUser = AuthService.getCurrentUser();
    const createProjectButton = document.getElementById('btn-show-create');
    const formContainer = document.getElementById('form-container');
    const projectFormElement = document.getElementById('project-form');
    const cancelButton = document.getElementById('btn-cancel');
    const addExerciseButton = document.getElementById('btn-add-exercise');

    // Solo el coach crea/edita rutinas.
    if (currentUser.role !== 'coach') {
        createProjectButton.style.display = 'none';
    }

    createProjectButton.addEventListener('click', async () => {
        await populateAthleteOptions();
        await populateExerciseOptions();
        resetRoutineForm();
        document.getElementById('project-id').value = '';
        document.getElementById('form-title').textContent = 'Crear Rutina';
        formContainer.style.display = 'block';
    });

    cancelButton.addEventListener('click', () => {
        formContainer.style.display = 'none';
        resetRoutineForm();
    });

    addExerciseButton.addEventListener('click', handleAddExercise);
    projectFormElement.addEventListener('submit', handleProjectSubmission);

    await populateAthleteOptions();
    await populateExerciseOptions();
    await renderProjects();
}

function resetRoutineForm() {
    document.getElementById('project-form').reset();
    draftExercises = [];
    renderExerciseList();
}

/**
 * populateAthleteOptions()
 * Llena el multi-select de atletas para asignar la rutina.
 */
async function populateAthleteOptions() {
    const athleteSelect = document.getElementById('routine-athlete');
    if (!athleteSelect) return;

    // Aislamiento: al asignar una rutina, un coach solo elige SUS atletas (?coach_id=);
    // un admin, los de SUS coaches (?admin_id=); el superadmin, todos.
    const currentUser = AuthService.getCurrentUser();
    const athletes = await apiGet(`${ATHLETES_URL}${scopeQuery(currentUser)}`);
    athleteSelect.innerHTML = athletes.length
        ? athletes.map(a => `<option value="${a.id}">${a.full_name}</option>`).join('')
        : '<option value="" disabled>No hay atletas registrados</option>';
}

/**
 * populateExerciseOptions()
 * Llena el desplegable de ejercicios con el catálogo. El value es el id real,
 * porque routine_exercises referencia exercise_id con clave foránea.
 */
async function populateExerciseOptions() {
    const exerciseSelect = document.getElementById('exercise-select');
    if (!exerciseSelect) return;

    // Aislamiento: un coach arma la rutina con SUS ejercicios + el catálogo global;
    // un admin, con los de SUS coaches + el catálogo; el superadmin, con todos.
    const currentUser = AuthService.getCurrentUser();
    const exercises = await apiGet(`${EXERCISES_URL}${scopeQuery(currentUser)}`);
    exerciseSelect.innerHTML = exercises.length
        ? exercises.map(e => `<option value="${e.id}">${e.name} (${e.muscle_group})</option>`).join('')
        : '<option value="">No hay ejercicios en el catálogo</option>';
}

/**
 * handleAddExercise()
 * Agrega el ejercicio seleccionado (con sus series/reps/descanso) al borrador.
 */
function handleAddExercise() {
    const exerciseSelect = document.getElementById('exercise-select');
    const exerciseId = exerciseSelect.value;
    const exerciseName = exerciseSelect.options[exerciseSelect.selectedIndex]?.text || '';
    const sets = Number(document.getElementById('exercise-sets').value);
    const reps = Number(document.getElementById('exercise-reps').value);
    const restSeconds = Number(document.getElementById('exercise-rest').value);
    // Prescripción opcional: si el campo está vacío se guarda como null.
    const weightRaw = document.getElementById('exercise-weight').value;
    const rpeRaw = document.getElementById('exercise-rpe').value;
    const notes = document.getElementById('exercise-notes').value.trim();
    const weightKg = weightRaw === '' ? null : Number(weightRaw);
    const rpe = rpeRaw === '' ? null : Number(rpeRaw);

    if (!exerciseId || !sets || !reps) {
        alert('Elige un ejercicio y completa series y repeticiones.');
        return;
    }

    if (rpe !== null && (rpe < 0 || rpe > 10)) {
        alert('El RPE debe estar entre 0 y 10.');
        return;
    }

    // Evitar redundancia: no permitir el mismo ejercicio dos veces en la rutina.
    // (routine_exercises no tiene unique en (routine_id, exercise_id), así que el
    //  freno es aquí; si se quiere repetir el estímulo, se suben las series.)
    if (draftExercises.some(ex => ex.exercise_id === Number(exerciseId))) {
        alert('Ese ejercicio ya está en la rutina. Ajusta sus series/repeticiones en la lista de abajo.');
        return;
    }

    draftExercises.push({
        exercise_id: Number(exerciseId),
        exercise_name: exerciseName,
        sets,
        reps,
        rest_seconds: restSeconds || 60,
        weight_kg: weightKg,
        rpe,
        notes: notes || null
    });

    renderExerciseList();
    document.getElementById('exercise-sets').value = '3';
    document.getElementById('exercise-reps').value = '10';
    document.getElementById('exercise-rest').value = '60';
    document.getElementById('exercise-weight').value = '';
    document.getElementById('exercise-rpe').value = '';
    document.getElementById('exercise-notes').value = '';
}

/**
 * renderExerciseList()
 * Pinta la lista de ejercicios que se han agregado al borrador de la rutina.
 */
function renderExerciseList() {
    const exerciseListContainer = document.getElementById('exercise-list');
    if (!exerciseListContainer) return;

    if (!draftExercises.length) {
        exerciseListContainer.innerHTML = '<p style="color: var(--text-muted);">Aún no se agregaron ejercicios.</p>';
        return;
    }

    exerciseListContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${draftExercises.map((exercise, index) => `
                <div class="card" style="padding: 0.9rem;">
                    <div style="display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
                        <strong>${exercise.exercise_name}</strong>
                        <button type="button" class="btn btn-danger" data-index="${index}">Quitar</button>
                    </div>
                    <p style="margin: 0.4rem 0 0; font-size: 0.9rem;">
                        Series: ${exercise.sets} · Reps: ${exercise.reps} · Descanso: ${exercise.rest_seconds} s${
                            exercise.weight_kg != null ? ` · Peso: ${exercise.weight_kg} kg` : ''
                        }${
                            exercise.rpe != null ? ` · RPE: ${exercise.rpe}` : ''
                        }
                    </p>
                    ${exercise.notes ? `<p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-muted);">📝 ${exercise.notes}</p>` : ''}
                </div>
            `).join('')}
        </div>
    `;

    exerciseListContainer.querySelectorAll('button[data-index]').forEach(button => {
        button.addEventListener('click', () => {
            draftExercises.splice(Number(button.dataset.index), 1);
            renderExerciseList();
        });
    });
}

/**
 * renderProjects()
 * Lista las rutinas. El coach ve todas; el atleta solo las suyas (read-only).
 */
async function renderProjects() {
    const currentUser = AuthService.getCurrentUser();
    const projectListContainer = document.getElementById('projects-list');
    projectListContainer.innerHTML = '';

    // Aislamiento por rol:
    //  - coach:      solo SUS rutinas             (?coach_id=)
    //  - athlete:    solo las asignadas a él      (?athlete_id=)
    //  - admin:      las de SUS coaches           (?admin_id=)
    //  - superadmin: todas (sin filtro)
    const url = currentUser.role === 'athlete'
        ? `${ROUTINES_URL}?athlete_id=${currentUser.athlete_id}`
        : `${ROUTINES_URL}${scopeQuery(currentUser)}`;
    const routines = await apiGet(url);

    if (!routines.length) {
        projectListContainer.innerHTML = '<p style="color: var(--text-muted);">No hay rutinas para mostrar.</p>';
        return;
    }

    routines.forEach(routine => {
        const projectCard = document.createElement('div');
        projectCard.className = 'card';

        let actionsHTML = '';
        if (currentUser.role === 'coach') {
            actionsHTML = `
                <div style="margin-top: 1rem; display:flex; gap: 0.5rem;">
                    <button class="btn btn-edit" data-id="${routine.id}">Editar</button>
                    <button class="btn btn-danger btn-delete" data-id="${routine.id}">Eliminar</button>
                </div>
            `;
        }

        const exerciseList = Array.isArray(routine.exercises) && routine.exercises.length
            ? `<ul style="margin: 0.4rem 0 0; padding-left: 1.1rem;">${routine.exercises.map(ex =>
                `<li style="margin-bottom: 0.35rem;"><strong>${ex.exercise_name}</strong> — ${ex.sets} Series x ${ex.reps} Reps · ${ex.rest_seconds || '—'} s de descanso${
                    ex.weight_kg != null ? ` · ${ex.weight_kg} kg` : ''
                }${
                    ex.rpe != null ? ` · RPE ${ex.rpe}` : ''
                }${
                    ex.notes ? `<br><small style="color: var(--text-muted);">📝 ${ex.notes}</small>` : ''
                }</li>`
              ).join('')}</ul>`
            : '<p style="margin: 0.4rem 0 0; color: var(--text-muted);">Sin ejercicios agregados</p>';

        const assignedNames = Array.isArray(routine.assignments) && routine.assignments.length
            ? routine.assignments.map(a => a.athlete_name).join(', ')
            : 'Sin asignar';

        projectCard.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${routine.name}</h3>
            <p style="margin: 0.25rem 0 0.5rem; color: var(--text-muted);">${routine.description || 'Sin descripción'}</p>
            <div style="display: grid; gap: 0.35rem; margin-bottom: 0.6rem;">
                <p style="margin: 0;"><small>Frecuencia: ${routine.weekly_frequency} días/semana</small></p>
                <p style="margin: 0;"><small>Atletas: ${assignedNames}</small></p>
            </div>
            <div style="margin-top: 0.5rem; padding: 0.7rem; border-radius: 8px; background: var(--surface-subtle);">
                <strong>Ejercicios:</strong>
                ${exerciseList}
            </div>
            ${actionsHTML}
        `;
        projectListContainer.appendChild(projectCard);
    });

    document.querySelectorAll('.btn-delete').forEach(button => button.addEventListener('click', removeProject));
    document.querySelectorAll('.btn-edit').forEach(button => button.addEventListener('click', prepareProjectEdition));
}

/**
 * handleProjectSubmission(event)
 * Crea (POST) o actualiza (PUT) una rutina con sus ejercicios y asignaciones.
 */
async function handleProjectSubmission(event) {
    event.preventDefault();

    const currentUser = AuthService.getCurrentUser();
    const projectId = document.getElementById('project-id').value;

    // Una rutina sin ejercicios no tiene sentido: se exige al menos uno.
    if (!draftExercises.length) {
        alert('Agrega al menos un ejercicio a la rutina antes de guardarla.');
        return;
    }

    // IDs de atletas seleccionados en el multi-select.
    const athleteSelect = document.getElementById('routine-athlete');
    const athleteIds = Array.from(athleteSelect.selectedOptions)
        .map(option => Number(option.value))
        .filter(Boolean);

    const routinePayload = {
        coach_id: currentUser.coach_id,
        name: document.getElementById('routine-name').value,
        description: document.getElementById('routine-objective').value || null,
        weekly_frequency: Number(document.getElementById('routine-frequency').value),
        exercises: draftExercises.map(ex => ({
            exercise_id: ex.exercise_id,
            sets: ex.sets,
            reps: ex.reps,
            rest_seconds: ex.rest_seconds,
            weight_kg: ex.weight_kg,
            rpe: ex.rpe,
            notes: ex.notes
        })),
        athlete_ids: athleteIds
    };

    // Editar (PUT sobre :id) o crear (POST): misma llamada, cambia el método y la URL.
    const url = projectId ? `${ROUTINES_URL}/${projectId}` : ROUTINES_URL;
    const method = projectId ? 'PUT' : 'POST';

    try {
        await apiSend(url, method, routinePayload, 'No se pudo guardar la rutina.');

        document.getElementById('form-container').style.display = 'none';
        resetRoutineForm();
        await renderProjects();
    } catch (error) {
        console.error('Error al guardar la rutina:', error);
        alert(error.message);
    }
}

/**
 * prepareProjectEdition(event)
 * Carga una rutina existente en el formulario para editarla.
 */
async function prepareProjectEdition(event) {
    const projectId = event.target.dataset.id;

    await populateAthleteOptions();
    await populateExerciseOptions();

    const routine = await apiGet(`${ROUTINES_URL}/${projectId}`);

    document.getElementById('project-id').value = routine.id;
    document.getElementById('routine-name').value = routine.name || '';
    document.getElementById('routine-objective').value = routine.description || '';
    document.getElementById('routine-frequency').value = routine.weekly_frequency || 3;

    // Marcar como seleccionados los atletas ya asignados.
    const assignedIds = (routine.assignments || []).map(a => String(a.athlete_id));
    Array.from(document.getElementById('routine-athlete').options).forEach(option => {
        option.selected = assignedIds.includes(option.value);
    });

    // Cargar los ejercicios de la rutina en el borrador.
    draftExercises = (routine.exercises || []).map(ex => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.rest_seconds,
        // La BD devuelve numeric como string; normalizamos a número o null.
        weight_kg: ex.weight_kg != null ? Number(ex.weight_kg) : null,
        rpe: ex.rpe != null ? Number(ex.rpe) : null,
        notes: ex.notes || null
    }));
    renderExerciseList();

    document.getElementById('form-title').textContent = 'Editar Rutina';
    document.getElementById('form-container').style.display = 'block';
}

/**
 * removeProject(event)
 * Elimina una rutina tras confirmar.
 */
async function removeProject(event) {
    if (!confirm('¿Seguro que deseas eliminar esta rutina?')) return;

    const projectId = event.target.dataset.id;
    try {
        await apiSend(`${ROUTINES_URL}/${projectId}`, 'DELETE', undefined, 'No se pudo eliminar la rutina.');
        await renderProjects();
    } catch (error) {
        alert(error.message);
    }
}
