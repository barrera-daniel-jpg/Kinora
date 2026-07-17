import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet } from '../../services/api.js';

/**
 * initDashboard()
 * Resumen de la cuenta, distinto según el rol.
 *
 * Ya no se mandan filtros (?coach_id=, ?admin_id=) en ninguna llamada: el backend
 * mira el token y devuelve solo el ámbito de quien pregunta. Por eso los cuatro
 * roles piden exactamente las mismas URLs y aun así cada uno recibe lo suyo — el
 * recorte lo hace el servidor, que es el único que no se puede engañar.
 */
export async function initDashboard() {
    const user = AuthService.getCurrentUser();
    if (!user) return;

    document.getElementById('user-name').textContent = user.full_name || user.username;
    document.getElementById('user-role').textContent = (user.role || '').toUpperCase();

    startClock();

    const metricsContainer = document.getElementById('metrics-container');

    try {
        if (user.role === 'athlete') {
            await renderAthleteMetrics(metricsContainer);
        } else if (user.role === 'coach') {
            await renderCoachMetrics(metricsContainer);
        } else {
            await renderAdminMetrics(metricsContainer, user);
        }
    } catch (error) {
        metricsContainer.innerHTML = `<p style="color: var(--danger);">No se pudo cargar el resumen: ${error.message}</p>`;
    }
}

/**
 * startClock()
 * Fecha y hora en vivo, en español. Se refresca cada minuto (no cada segundo:
 * no se muestran los segundos, así que hacerlo más seguido solo gastaría trabajo).
 *
 * El contenedor puede no existir según la vista, de ahí la comprobación previa.
 */
function startClock() {
    const dateElement = document.getElementById('fecha-hora-actual');
    if (!dateElement) return;

    const update = () => {
        dateElement.textContent = new Date().toLocaleDateString('es-CO', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };
    update();
    setInterval(update, 60000);
}

/**
 * metricCard(title, value, color)
 * Fabrica una tarjeta de métrica. Existe para no repetir el mismo bloque de HTML
 * con estilos incrustados una docena de veces.
 */
function metricCard(title, value, color = 'var(--text)') {
    return `
        <div class="card">
            <h3>${title}</h3>
            <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: ${color};">${value}</p>
        </div>`;
}

/**
 * renderAthleteMetrics(container)
 * El atleta ve el estado de SUS rutinas asignadas.
 *
 * El estado sale de la asignación (assignments), no de la rutina: la misma rutina
 * puede estar completada para él y pendiente para otro compañero.
 */
async function renderAthleteMetrics(container) {
    const user = AuthService.getCurrentUser();
    const routines = await apiGet(`${API_URL}/routines`);

    // De cada rutina nos quedamos con la asignación de ESTE atleta, que es la que
    // lleva su estado personal.
    const myAssignments = routines
        .map(routine => (routine.assignments || []).find(a => a.athlete_id === user.athlete_id))
        .filter(Boolean);

    const countBy = status => myAssignments.filter(a => a.status === status).length;

    container.innerHTML =
        metricCard('Mis Rutinas', routines.length) +
        metricCard('Pendientes', countBy('pending'), '#f59e0b') +
        metricCard('En Progreso', countBy('in_progress'), 'var(--primary)') +
        metricCard('Completadas', countBy('completed'), 'var(--success)') +
        metricCard('Canceladas', countBy('cancelled'), 'var(--danger)');
}

/**
 * renderCoachMetrics(container)
 * El coach ve el resumen de lo suyo.
 */
async function renderCoachMetrics(container) {
    const [routines, exercises, athletes] = await Promise.all([
        apiGet(`${API_URL}/routines`),
        apiGet(`${API_URL}/exercises`),
        apiGet(`${API_URL}/athletes`)
    ]);

    // Se separan los propios del catálogo base: al coach le interesa saber cuántos
    // ejercicios ha creado él, no un total que mezcla los suyos con los de todos.
    const misEjercicios = exercises.filter(e => e.created_by != null).length;

    container.innerHTML =
        metricCard('Mis Rutinas', routines.length) +
        metricCard('Mis Ejercicios', misEjercicios, 'var(--primary)') +
        metricCard('Catálogo disponible', exercises.length) +
        metricCard('Mis Atletas', athletes.length, 'var(--success)');
}

/**
 * renderAdminMetrics(container, user)
 * Resumen para admin y superadmin.
 *
 * Las cinco peticiones van con Promise.all (en paralelo) y no una tras otra: no
 * dependen entre sí, así que encadenarlas solo haría esperar de más al usuario.
 * El superadmin además ve el conteo de admins, que a un admin no le corresponde.
 */
async function renderAdminMetrics(container, user) {
    const isSuper = user.role === 'superadmin';

    const [coaches, athletes, exercises, routines, admins] = await Promise.all([
        apiGet(`${API_URL}/coaches`),
        apiGet(`${API_URL}/athletes`),
        apiGet(`${API_URL}/exercises`),
        apiGet(`${API_URL}/routines`),
        isSuper ? apiGet(`${API_URL}/admins`) : Promise.resolve([])
    ]);

    // El superadmin ve totales globales; el admin, solo su parcela.
    const alcance = isSuper ? 'todos' : 'míos';

    container.innerHTML =
        (isSuper ? metricCard('Admins', admins.length) : '') +
        metricCard(isSuper ? 'Coaches' : 'Mis Coaches', coaches.length) +
        metricCard(`Atletas (${alcance})`, athletes.length, 'var(--success)') +
        metricCard(`Ejercicios (${alcance})`, exercises.length, 'var(--primary)') +
        metricCard(`Rutinas (${alcance})`, routines.length);
}
