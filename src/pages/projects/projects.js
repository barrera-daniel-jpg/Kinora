import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, apiSend } from '../../services/api.js';

// Endpoints del backend.
const ROUTINES_URL = `${API_URL}/routines`;
const EXERCISES_URL = `${API_URL}/exercises`;
const ATHLETES_URL = `${API_URL}/athletes`;

// Ejercicios que se van agregando a la rutina en el formulario (aún sin guardar).
// Cada item: { exercise_id, exercise_name, sets, reps, rest_seconds, weight_kg, rpe, notes }
let draftExercises = [];

// ── Cachés del formulario ───────────────────────────────────────────────────
// El catálogo y los atletas se descargan UNA vez al abrir el formulario y se
// guardan aquí. Los filtros (músculo, equipo, buscador) trabajan sobre estos
// arrays en memoria, sin volver a llamar a la API.
//
// Por qué: el filtro en cascada se recalcula con cada tecla que escribe el coach.
// Si cada pulsación disparara un fetch, la lista parpadearía, las respuestas
// podrían llegar desordenadas y se castigaría al servidor sin necesidad. El
// catálogo no cambia mientras se arma una rutina, así que basta con traerlo una vez.
let allExercises = [];
let allAthletes = [];

// Atletas marcados (ids). Es un Set y no un array porque la pregunta que se hace
// todo el rato es "¿está este marcado?": en un Set es inmediato, y además impide
// duplicados por construcción.
let selectedAthleteIds = new Set();

export async function initProjects() {
    const currentUser = AuthService.getCurrentUser();
    const createProjectButton = document.getElementById('btn-show-create');
    const formContainer = document.getElementById('form-container');
    const projectFormElement = document.getElementById('project-form');
    const cancelButton = document.getElementById('btn-cancel');
    const addExerciseButton = document.getElementById('btn-add-exercise');

    // El atleta no crea rutinas: solo consulta las suyas y marca su estado.
    if (currentUser.role === 'athlete') {
        createProjectButton.style.display = 'none';
    }

    createProjectButton.addEventListener('click', () => {
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

    setupPickerEvents();

    // El catálogo y los atletas se cargan una vez; los filtros trabajan sobre ellos
    // en memoria. El atleta no arma rutinas, así que no necesita nada de esto.
    if (currentUser.role !== 'athlete') {
        await loadFormData();
    }
    await renderProjects();
}

/**
 * setupPickerEvents()
 * Conecta los filtros del armador de rutinas y el selector de atletas.
 *
 * Se llama UNA vez al iniciar la vista, no en cada repintado: los elementos que
 * llevan escucha (los <select>, los buscadores) son fijos en el HTML. Solo su
 * contenido cambia. Si se reconectara en cada render, cada evento se dispararía
 * tantas veces como veces se hubiera repintado la página.
 */
function setupPickerEvents() {
    const muscleFilter = document.getElementById('filter-muscle');
    const equipmentFilter = document.getElementById('filter-equipment');
    const exerciseSearch = document.getElementById('exercise-search');
    const exerciseSelect = document.getElementById('exercise-select');

    // Paso 1 -> rehace el paso 2 (el material depende del grupo) y luego la lista.
    muscleFilter?.addEventListener('change', () => {
        populateEquipmentFilter(muscleFilter.value);
        renderExercisePicker();
    });

    // Paso 2 -> solo rehace la lista.
    equipmentFilter?.addEventListener('change', renderExercisePicker);

    // 'input' y no 'change': filtra mientras se escribe, sin esperar a salir del campo.
    exerciseSearch?.addEventListener('input', renderExercisePicker);

    // Al cambiar de ejercicio marcado, actualizar su detalle.
    exerciseSelect?.addEventListener('change', updateExercisePreview);

    // Selector de atletas.
    document.getElementById('athlete-search')?.addEventListener('input', renderAthletePicker);

    // "Todos" marca solo los que se ven ahora mismo: con un buscador puesto, es lo
    // que uno espera ("todos los que estoy viendo"), no todos los del sistema.
    document.getElementById('btn-athletes-all')?.addEventListener('click', () => {
        visibleAthletes().forEach(a => selectedAthleteIds.add(a.id));
        renderAthletePicker();
    });
    document.getElementById('btn-athletes-none')?.addEventListener('click', () => {
        selectedAthleteIds.clear();
        renderAthletePicker();
    });
}

/**
 * visibleAthletes()
 * Los atletas que pasan el buscador ahora mismo, que son los que el usuario ve.
 */
function visibleAthletes() {
    const term = (document.getElementById('athlete-search')?.value || '').trim().toLowerCase();
    return term
        ? allAthletes.filter(a => a.full_name.toLowerCase().includes(term))
        : allAthletes;
}

/**
 * resetRoutineForm()
 * Deja el formulario en blanco: campos, borrador de ejercicios y atletas marcados.
 *
 * form.reset() solo limpia los <input> y <select> del HTML. El borrador y la
 * selección de atletas viven en variables de JavaScript, así que hay que vaciarlos
 * a mano: si no, la siguiente rutina nacería con los ejercicios de la anterior.
 */
function resetRoutineForm() {
    document.getElementById('project-form').reset();
    draftExercises = [];
    selectedAthleteIds.clear();

    // form.reset() deja los filtros en su valor inicial ("Todos"), así que las dos
    // listas se repintan sin recorte.
    populateEquipmentFilter('');
    renderExercisePicker();
    renderAthletePicker();
    renderExerciseList();
}

/**
 * loadFormData()
 * Descarga el catálogo de ejercicios y la lista de atletas, una sola vez, y pinta
 * los dos selectores del formulario.
 *
 * Las dos peticiones van en paralelo (Promise.all) porque no dependen entre sí:
 * encadenarlas solo haría esperar el doble. El backend ya recorta ambas listas
 * según el token, así que aquí llega exactamente lo que este usuario puede usar.
 */
async function loadFormData() {
    const [exercises, athletes] = await Promise.all([
        apiGet(EXERCISES_URL),
        apiGet(ATHLETES_URL)
    ]);

    allExercises = exercises;
    allAthletes = athletes;

    populateMuscleFilter();
    renderExercisePicker();
    renderAthletePicker();
}

// ── Selector de atletas (casillas) ──────────────────────────────────────────

/**
 * renderAthletePicker()
 * Pinta la lista de atletas como casillas, filtrada por lo que haya en el buscador.
 *
 * Sustituye al <select multiple> de antes, que obligaba a mantener Ctrl/Cmd para
 * marcar a varios — imposible en un móvil, donde no existe esa tecla. Con casillas
 * cada toque marca o desmarca, que es lo que cualquiera espera.
 *
 * La selección NO vive en el DOM sino en selectedAthleteIds. Es la diferencia que
 * hace que funcione: al escribir en el buscador se redibuja la lista, y si el
 * estado estuviera en las casillas, los que quedan fuera del filtro se
 * "desmarcarían" solos al desaparecer. Guardándolo aparte, buscar no pierde nada.
 */
function renderAthletePicker() {
    const container = document.getElementById('athlete-list');
    const searchInput = document.getElementById('athlete-search');
    if (!container) return;

    const term = (searchInput?.value || '').trim().toLowerCase();
    const filtered = term
        ? allAthletes.filter(a => a.full_name.toLowerCase().includes(term))
        : allAthletes;

    // El buscador solo estorba si hay pocos atletas; aparece cuando hace falta.
    if (searchInput) {
        searchInput.style.display = allAthletes.length > 6 ? '' : 'none';
    }

    if (!allAthletes.length) {
        container.innerHTML = '<p class="picker-empty">No tienes atletas registrados. Créalos en la sección Atletas.</p>';
        updateAthleteCount();
        return;
    }
    if (!filtered.length) {
        container.innerHTML = `<p class="picker-empty">Ningún atleta coincide con “${term}”.</p>`;
        updateAthleteCount();
        return;
    }

    container.innerHTML = filtered.map(athlete => `
        <label class="check-item">
            <input type="checkbox" value="${athlete.id}" ${selectedAthleteIds.has(athlete.id) ? 'checked' : ''}>
            <span class="check-item-name">${athlete.full_name}</span>
            ${athlete.coach_name ? `<span class="check-item-meta">${athlete.coach_name}</span>` : ''}
        </label>
    `).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.addEventListener('change', () => {
            const id = Number(box.value);
            if (box.checked) selectedAthleteIds.add(id);
            else selectedAthleteIds.delete(id);
            updateAthleteCount();
        });
    });

    updateAthleteCount();
}

/**
 * updateAthleteCount()
 * Muestra cuántos atletas hay marcados.
 *
 * Importa porque, con el buscador puesto, los marcados pueden estar fuera de la
 * vista: sin este contador parecería que no hay ninguno seleccionado.
 */
function updateAthleteCount() {
    const label = document.getElementById('athlete-count');
    if (!label) return;

    const n = selectedAthleteIds.size;
    label.textContent = n === 0
        ? 'Ningún atleta seleccionado (puedes guardar la rutina y asignarla después).'
        : `${n} atleta${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}.`;
}

// ── Selector de ejercicios (filtro en cascada) ──────────────────────────────

/**
 * populateMuscleFilter()
 * Llena el paso 1 con los grupos musculares que EXISTEN en el catálogo visible.
 *
 * Se sacan de los propios ejercicios en vez de escribir una lista fija: así nunca
 * se ofrece un grupo que no tenga ni un ejercicio detrás, y si mañana alguien crea
 * uno con un grupo nuevo, aparece solo.
 */
function populateMuscleFilter() {
    const select = document.getElementById('filter-muscle');
    if (!select) return;

    const groups = [...new Set(allExercises.map(e => e.muscle_group))].sort();
    select.innerHTML = '<option value="">Todos los grupos</option>' +
        groups.map(g => `<option value="${g}">${capitalize(g)}</option>`).join('');
}

/**
 * populateEquipmentFilter(muscleGroup)
 * Llena el paso 2 con el material disponible PARA EL GRUPO YA ELEGIDO.
 *
 * Esta dependencia es la razón de ser de la cascada: si eliges "pecho", no tiene
 * sentido ofrecerte "cuerda" cuando no hay ningún ejercicio de pecho con cuerda.
 * Al elegirlo, la lista de ejercicios saldría vacía y parecería un fallo.
 */
function populateEquipmentFilter(muscleGroup) {
    const select = document.getElementById('filter-equipment');
    if (!select) return;

    const previous = select.value;
    const pool = muscleGroup
        ? allExercises.filter(e => e.muscle_group === muscleGroup)
        : allExercises;

    const equipment = [...new Set(pool.map(e => e.equipment))].sort();
    select.innerHTML = '<option value="">Todo el material</option>' +
        equipment.map(eq => `<option value="${eq}">${capitalize(eq)}</option>`).join('');

    // Si el material que estaba elegido sigue existiendo para el grupo nuevo, se
    // respeta; si no, se vuelve a "Todo". Sin esto, el <select> se quedaría
    // mostrando un valor que ya no está en sus opciones y filtraría por nada.
    select.value = equipment.includes(previous) ? previous : '';
}

/**
 * filterExercises()
 * Aplica los tres filtros a la vez y devuelve los ejercicios que quedan.
 *
 * El buscador por nombre se combina con los otros dos (no los reemplaza): así
 * "press" + grupo "pecho" da solo los press de pecho.
 */
function filterExercises() {
    const muscle = document.getElementById('filter-muscle')?.value || '';
    const equipment = document.getElementById('filter-equipment')?.value || '';
    const term = (document.getElementById('exercise-search')?.value || '').trim().toLowerCase();

    return allExercises.filter(exercise => {
        if (muscle && exercise.muscle_group !== muscle) return false;
        if (equipment && exercise.equipment !== equipment) return false;
        if (term && !exercise.name.toLowerCase().includes(term)) return false;
        return true;
    });
}

/**
 * renderExercisePicker()
 * Pinta el paso 3 con los ejercicios que pasan los filtros.
 *
 * Los que ya están en la rutina se marcan como "ya agregado" y se deshabilitan,
 * en lugar de dejar que el coach los elija y recibir un aviso después. Es mejor
 * que la opción imposible no se pueda tocar a explicar por qué falló.
 */
function renderExercisePicker() {
    const select = document.getElementById('exercise-select');
    const counter = document.getElementById('exercise-count');
    if (!select) return;

    const filtered = filterExercises();
    const alreadyAdded = new Set(draftExercises.map(ex => ex.exercise_id));

    if (!allExercises.length) {
        select.innerHTML = '<option value="">No hay ejercicios en el catálogo</option>';
        if (counter) counter.textContent = '';
        return;
    }
    if (!filtered.length) {
        select.innerHTML = '<option value="">Ningún ejercicio coincide con los filtros</option>';
        if (counter) counter.textContent = '(0 resultados)';
        updateExercisePreview();
        return;
    }

    select.innerHTML = filtered.map(exercise => {
        const added = alreadyAdded.has(exercise.id);
        return `<option value="${exercise.id}" ${added ? 'disabled' : ''}>${exercise.name}${added ? ' — ya agregado' : ''}</option>`;
    }).join('');

    // Dejar marcado el primero que sí se pueda agregar: con el detalle de abajo,
    // el coach ve algo útil sin tener que hacer clic primero.
    const firstUsable = filtered.find(e => !alreadyAdded.has(e.id));
    if (firstUsable) select.value = String(firstUsable.id);

    if (counter) {
        counter.textContent = `(${filtered.length} de ${allExercises.length})`;
    }
    updateExercisePreview();
}

/**
 * updateExercisePreview()
 * Muestra el detalle del ejercicio marcado (grupo, equipo, dificultad, descripción).
 *
 * Sirve para distinguir entre ejercicios de nombre parecido —hay muchos "press"—
 * sin tener que abrir el catálogo en otra pantalla y perder el formulario a medias.
 */
function updateExercisePreview() {
    const preview = document.getElementById('exercise-preview');
    const select = document.getElementById('exercise-select');
    if (!preview || !select) return;

    const exercise = allExercises.find(e => e.id === Number(select.value));
    if (!exercise) {
        preview.textContent = '';
        preview.style.display = 'none';
        return;
    }

    preview.style.display = '';
    preview.innerHTML = `
        <strong>${exercise.name}</strong>
        <span class="preview-meta">${capitalize(exercise.muscle_group)} · ${capitalize(exercise.equipment)} · ${capitalize(exercise.difficulty)}</span>
        ${exercise.description ? `<br><span class="preview-desc">${exercise.description}</span>` : ''}
    `;
}

/**
 * capitalize(text)
 * Primera letra en mayúscula. Los valores se guardan en minúscula en la BD (para
 * que "Pecho" y "pecho" no acaben siendo dos grupos distintos), así que solo se
 * capitalizan al mostrarlos.
 */
function capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * handleAddExercise()
 * Agrega el ejercicio seleccionado (con sus series/reps/descanso) al borrador.
 */
function handleAddExercise() {
    const exerciseSelect = document.getElementById('exercise-select');
    const exerciseId = exerciseSelect.value;

    // El nombre se toma del catálogo en memoria y no del texto de la <option>,
    // porque ese texto puede llevar añadidos como " — ya agregado" y acabaría
    // guardándose el sufijo dentro del nombre del ejercicio en la rutina.
    const exercise = allExercises.find(e => e.id === Number(exerciseId));
    const exerciseName = exercise ? exercise.name : '';

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
    // Repintar el paso 3: el que se acaba de agregar pasa a "ya agregado" y se
    // deshabilita, y el marcado salta al siguiente que sí se puede usar.
    renderExercisePicker();

    // La prescripción se limpia, pero los FILTROS no se tocan a propósito: quien
    // arma un día de pierna agrega varios ejercicios de pierna seguidos, y volver
    // a poner "Todos" en cada uno le haría repetir el filtro cada vez.
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

    // Una sola URL para todos los roles: el backend mira el token y devuelve lo que
    // a cada uno le corresponde (el coach lo suyo, el atleta lo que le asignaron,
    // el admin lo de sus coaches, el superadmin todo).
    let routines;
    try {
        routines = await apiGet(ROUTINES_URL);
    } catch (error) {
        projectListContainer.innerHTML = `<p style="color: var(--danger);">${error.message}</p>`;
        return;
    }

    if (!routines.length) {
        projectListContainer.innerHTML = '<p style="color: var(--text-muted);">No hay rutinas para mostrar.</p>';
        return;
    }

    routines.forEach(routine => {
        const projectCard = document.createElement('div');
        projectCard.className = 'card';

        // Los botones salen de can_edit (lo dice el backend por cada rutina), no del
        // rol: un coach ve las plantillas base pero no las puede tocar, así que
        // decidir por rol le pintaría botones que siempre darían error.
        const actionsHTML = routine.can_edit
            ? `<div style="margin-top: 1rem; display:flex; gap: 0.5rem;">
                   <button class="btn btn-edit" data-id="${routine.id}">Editar</button>
                   <button class="btn btn-danger btn-delete" data-id="${routine.id}">Eliminar</button>
               </div>`
            : '';

        // El atleta no edita la rutina, pero sí marca en qué punto va. Es su única
        // escritura permitida y solo sobre SU propia asignación.
        const statusHTML = currentUser.role === 'athlete'
            ? renderStatusSelector(routine, currentUser.athlete_id)
            : '';

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

        // Al coach le interesa el estado de CADA atleta, no solo sus nombres: así ve
        // de un vistazo quién va al día sin abrir la ficha de cada uno.
        const assignedNames = Array.isArray(routine.assignments) && routine.assignments.length
            ? routine.assignments.map(a => `${a.athlete_name} ${statusBadge(a.status)}`).join(', ')
            : 'Sin asignar';

        const badge = routine.created_by == null
            ? '<span class="badge-base" title="Plantilla base: la puedes consultar, pero no modificar">Plantilla base</span>'
            : '';

        projectCard.innerHTML = `
            <h3 style="margin-bottom: 0.4rem;">${routine.name} ${badge}</h3>
            <p style="margin: 0.25rem 0 0.5rem; color: var(--text-muted);">${routine.description || 'Sin descripción'}</p>
            <div style="display: grid; gap: 0.35rem; margin-bottom: 0.6rem;">
                <p style="margin: 0;"><small>Frecuencia: ${routine.weekly_frequency} días/semana</small></p>
                <p style="margin: 0;"><small>Atletas: ${assignedNames}</small></p>
            </div>
            <div style="margin-top: 0.5rem; padding: 0.7rem; border-radius: 8px; background: var(--surface-subtle);">
                <strong>Ejercicios:</strong>
                ${exerciseList}
            </div>
            ${statusHTML}
            ${actionsHTML}
        `;
        projectListContainer.appendChild(projectCard);
    });

    document.querySelectorAll('.btn-delete').forEach(button => button.addEventListener('click', removeProject));
    document.querySelectorAll('.btn-edit').forEach(button => button.addEventListener('click', prepareProjectEdition));
    document.querySelectorAll('.select-status').forEach(select => select.addEventListener('change', updateStatus));
}

// Etiquetas y colores de cada estado. Las claves son los valores que guarda la BD
// (routine_assignments.status); el texto en español es solo para mostrar.
const STATUS_LABELS = {
    pending:     { text: 'Pendiente',   color: '#f59e0b' },
    in_progress: { text: 'En progreso', color: 'var(--primary)' },
    completed:   { text: 'Completada',  color: 'var(--success)' },
    cancelled:   { text: 'Cancelada',   color: 'var(--danger)' }
};

/**
 * statusBadge(status)
 * Píldora de color con el estado de un atleta en una rutina.
 */
function statusBadge(status) {
    const info = STATUS_LABELS[status] || STATUS_LABELS.pending;
    return `<span style="color: ${info.color}; font-weight: 600;">(${info.text})</span>`;
}

/**
 * renderStatusSelector(routine, athleteId)
 * Desplegable para que el atleta marque en qué punto va con SU rutina.
 *
 * Se busca su propia asignación dentro de la rutina porque el estado es por atleta:
 * la misma rutina puede estar completada para él y pendiente para un compañero.
 */
function renderStatusSelector(routine, athleteId) {
    const mine = (routine.assignments || []).find(a => a.athlete_id === athleteId);
    if (!mine) return '';

    const options = Object.entries(STATUS_LABELS).map(([value, info]) =>
        `<option value="${value}" ${mine.status === value ? 'selected' : ''}>${info.text}</option>`
    ).join('');

    return `
        <div style="margin-top: 1rem;">
            <label style="display: block; font-size: 0.85rem; margin-bottom: 0.3rem; color: var(--text-muted);">Mi estado:</label>
            <select class="select-status" data-routine-id="${routine.id}" data-athlete-id="${athleteId}">
                ${options}
            </select>
        </div>
    `;
}

/**
 * updateStatus(event)
 * Guarda el nuevo estado que eligió el atleta.
 *
 * Si falla se repinta la lista entera: así el desplegable vuelve al valor real que
 * hay en la base de datos, en vez de quedarse mostrando un estado que no se guardó.
 */
async function updateStatus(event) {
    const { routineId, athleteId } = event.target.dataset;

    try {
        await apiSend(
            `${ROUTINES_URL}/${routineId}/assignments/${athleteId}/status`,
            'PATCH',
            { status: event.target.value },
            'No se pudo actualizar el estado.'
        );
    } catch (error) {
        alert(error.message);
        await renderProjects();
    }
}

/**
 * handleProjectSubmission(event)
 * Crea (POST) o actualiza (PUT) una rutina con sus ejercicios y asignaciones.
 */
async function handleProjectSubmission(event) {
    event.preventDefault();

    const projectId = document.getElementById('project-id').value;

    // Una rutina sin ejercicios no tiene sentido: se exige al menos uno.
    if (!draftExercises.length) {
        alert('Agrega al menos un ejercicio a la rutina antes de guardarla.');
        return;
    }

    // Los atletas marcados salen del Set, no del DOM: con el buscador puesto, los
    // marcados que no coinciden con la búsqueda no están dibujados en pantalla, y
    // leerlos del DOM los dejaría fuera de la rutina sin avisar.
    const athleteIds = [...selectedAthleteIds];

    // Ya no se manda coach_id: el dueño de la rutina lo fija el servidor a partir
    // del token. Enviarlo desde aquí habría permitido crear rutinas a nombre de otro.
    const routinePayload = {
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

    let routine;
    try {
        routine = await apiGet(`${ROUTINES_URL}/${projectId}`);
    } catch (error) {
        return alert(error.message);
    }

    // Empezar en limpio: sin esto, los ejercicios y atletas de la rutina que se
    // editó ANTES seguirían en el borrador y se colarían en esta.
    resetRoutineForm();

    document.getElementById('project-id').value = routine.id;
    document.getElementById('routine-name').value = routine.name || '';
    document.getElementById('routine-objective').value = routine.description || '';
    document.getElementById('routine-frequency').value = routine.weekly_frequency || 3;

    // Marcar los atletas que ya tienen la rutina asignada.
    selectedAthleteIds = new Set((routine.assignments || []).map(a => a.athlete_id));
    renderAthletePicker();

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
    // Repintar el paso 3 para que los que ya están en la rutina salgan como
    // "ya agregado" y no se puedan añadir dos veces.
    renderExercisePicker();

    document.getElementById('form-title').textContent = 'Editar Rutina';
    document.getElementById('form-container').style.display = 'block';
    // El formulario está arriba del todo; sin esto, al pulsar "Editar" en una
    // rutina del final de la lista, parece que no ha pasado nada.
    document.getElementById('form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
