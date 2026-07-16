import { AuthService } from '../../services/auth.js';
import { API_URL, apiGet, scopeQuery } from '../../services/api.js';

export async function initDashboard() {
    const user = AuthService.getCurrentUser();
    document.getElementById('user-name').textContent = user.full_name || user.username;
    document.getElementById('user-role').textContent = (user.role || '').toUpperCase();

    const metricsContainer = document.getElementById('metrics-container');

    if (user.role === 'coach') {
        // AISLAMIENTO: el coach ve el resumen de LO SUYO (pasa ?coach_id=).
        const cid = user.coach_id;
        const [routines, exercises, athletes] = await Promise.all([
            apiGet(`${API_URL}/routines?coach_id=${cid}`),
            apiGet(`${API_URL}/exercises?coach_id=${cid}`),
            apiGet(`${API_URL}/athletes?coach_id=${cid}`)
        ]);

        metricsContainer.innerHTML = `
            <div class="card">
                <h3>Mis Rutinas</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--text);">${routines.length}</p>
            </div>
            <div class="card">
                <h3>Mis Ejercicios (+ catálogo)</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--primary);">${exercises.length}</p>
            </div>
            <div class="card">
                <h3>Mis Atletas</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--success);">${athletes.length}</p>
            </div>
        `;
    } else if (user.role === 'admin' || user.role === 'superadmin') {
        // AISLAMIENTO por admin: el admin ve el resumen de LO SUYO (sus coaches y, en
        // cascada, sus atletas/ejercicios/rutinas) pasando ?admin_id=. El superadmin no
        // filtra (scopeQuery devuelve '') y ve el resumen GLOBAL, más el conteo de Admins.
        const isSuper = user.role === 'superadmin';
        const scope = scopeQuery(user); // '?admin_id=<id>' para admin; '' para superadmin
        const [coaches, athletes, exercises, routines, admins] = await Promise.all([
            apiGet(`${API_URL}/coaches${scope}`),
            apiGet(`${API_URL}/athletes${scope}`),
            apiGet(`${API_URL}/exercises${scope}`),
            apiGet(`${API_URL}/routines${scope}`),
            isSuper ? apiGet(`${API_URL}/admins`) : Promise.resolve([])
        ]);

        const adminsCard = isSuper ? `
            <div class="card">
                <h3>Admins</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--text);">${admins.length}</p>
            </div>` : '';

        // El superadmin ve totales globales; el admin, "los suyos".
        const alcance = isSuper ? 'todos' : 'míos';
        metricsContainer.innerHTML = `
            ${adminsCard}
            <div class="card">
                <h3>${isSuper ? 'Coaches' : 'Mis Coaches'}</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--text);">${coaches.length}</p>
            </div>
            <div class="card">
                <h3>Atletas (${alcance})</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--success);">${athletes.length}</p>
            </div>
            <div class="card">
                <h3>Ejercicios (${alcance})</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0; color: var(--primary);">${exercises.length}</p>
            </div>
            <div class="card">
                <h3>Rutinas (${alcance})</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0;">${routines.length}</p>
            </div>
        `;
    } else {
        // Un atleta ve solo sus rutinas asignadas.
        const routines = await apiGet(`${API_URL}/routines?athlete_id=${user.athlete_id}`);

        metricsContainer.innerHTML = `
            <div class="card">
                <h3>Mis Rutinas Asignadas</h3>
                <p style="font-size: 2.5rem; font-weight: bold; margin: 0;">${routines.length}</p>
            </div>
        `;
    }
}
