// Rutas de rutinas (base_v1.routines) con sus ejercicios (routine_exercises)
// y sus asignaciones a atletas (routine_assignments).
//
// Una rutina vive repartida en tres tablas, así que crear o editar siempre va
// dentro de una transacción: o se guarda entera, o no se guarda nada. Si no,
// un fallo a mitad dejaría una rutina sin ejercicios o con la mitad de ellos.
//
// Permisos, igual que en los ejercicios:
//   · VER      -> lo tuyo, lo de tu ámbito y las rutinas base (created_by IS NULL).
//   · MODIFICAR-> solo lo que creaste tú (canModify). Las rutinas base solo las
//                 toca el superadmin.
//   · El atleta solo ve las que le asignaron, y de ellas únicamente puede cambiar
//     su propio estado (pendiente / en progreso / completada / cancelada).
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, canModify } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

// Estados válidos de una rutina para un atleta. Mismo listado que el CHECK de la
// BD (ver migración 2026-07-16): la BD es la que manda, esto solo evita ir hasta
// ella para rebotar un valor que ya sabemos que es inválido.
const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

// Subconsultas reutilizables: arman el array de ejercicios y de atletas de cada rutina.
const EXERCISES_SUBQUERY = `
  (SELECT COALESCE(json_agg(re_row ORDER BY re_row.order_index), '[]')
     FROM (
       SELECT re.id, re.exercise_id, e.name AS exercise_name, e.muscle_group, e.equipment,
              re.sets, re.reps, re.rest_seconds, re.weight_kg, re.rpe, re.notes,
              re.order_index
         FROM routine_exercises re
         JOIN exercises e ON e.id = re.exercise_id
        WHERE re.routine_id = r.id
     ) re_row) AS exercises`;

// Incluye el estado de cada atleta: la misma rutina puede estar completada para
// uno y pendiente para otro, por eso el estado sale de routine_assignments.
const ASSIGNMENTS_SUBQUERY = `
  (SELECT COALESCE(json_agg(a_row), '[]')
     FROM (
       SELECT ra.athlete_id, a.full_name AS athlete_name, ra.status, ra.assigned_at
         FROM routine_assignments ra
         JOIN athletes a ON a.id = ra.athlete_id
        WHERE ra.routine_id = r.id AND ra.is_active = true
     ) a_row) AS assignments`;

/**
 * visibilityClause(user)
 * El WHERE de LECTURA según el rol. Mismo criterio que en exercises.js.
 * Los valores viajan como parámetros ($1...), nunca pegados al texto del SQL.
 *
 * @param {object} user Identidad verificada (req.user).
 * @returns {{ where: string, params: any[] }}
 */
function visibilityClause(user) {
  switch (user.role) {
    case "superadmin":
      return { where: "", params: [] };

    case "coach":
      return {
        where: "WHERE r.created_by IS NULL OR r.created_by = $1",
        params: [user.id],
      };

    case "admin":
      return {
        where: `WHERE r.created_by IS NULL
                   OR r.created_by = $1
                   OR r.created_by IN (SELECT user_id FROM coaches WHERE admin_id = $1)`,
        params: [user.id],
      };

    // El atleta solo ve lo que le asignaron y sigue activo. Las rutinas base NO
    // entran: son plantillas del sistema, no algo que él deba entrenar hasta que
    // un coach se la asigne.
    case "athlete":
      return {
        where: `WHERE EXISTS (
                  SELECT 1 FROM routine_assignments ra
                   WHERE ra.routine_id = r.id AND ra.athlete_id = $1 AND ra.is_active = true)`,
        params: [user.athlete_id],
      };

    default:
      return { where: "WHERE false", params: [] };
  }
}

/**
 * assertExercisesVisible(client, user, exercises)
 * Comprueba que TODOS los ejercicios que se quieren meter en la rutina son
 * ejercicios que este usuario puede ver.
 *
 * Sin esto, un coach podría mandar a mano un exercise_id cualquiera y colar en su
 * rutina el ejercicio privado de otro coach — y de paso averiguar que existe.
 * Se llama dentro de la transacción, así que si falla no queda nada a medias.
 *
 * @throws {Error} con status 400 si algún ejercicio no existe o no es visible.
 */
async function assertExercisesVisible(client, user, exercises) {
  if (!Array.isArray(exercises) || !exercises.length) return;

  const ids = [...new Set(exercises.map(ex => Number(ex.exercise_id)))];

  // El superadmin ve todo: basta con confirmar que los ids existen.
  const visibilitySql = user.role === "superadmin"
    ? `SELECT id FROM exercises WHERE id = ANY($1)`
    : user.role === "admin"
      ? `SELECT id FROM exercises
          WHERE id = ANY($1)
            AND (created_by IS NULL
                 OR created_by = $2
                 OR created_by IN (SELECT user_id FROM coaches WHERE admin_id = $2))`
      : `SELECT id FROM exercises
          WHERE id = ANY($1) AND (created_by IS NULL OR created_by = $2)`;

  const params = user.role === "superadmin" ? [ids] : [ids, user.id];
  const found = await client.query(visibilitySql, params);

  if (found.rows.length !== ids.length) {
    throw Object.assign(
      new Error("La rutina incluye un ejercicio que no existe o al que no tienes acceso."),
      { status: 400 }
    );
  }
}

/**
 * assertAthletesInScope(client, user, athleteIds)
 * Comprueba que el usuario puede asignarle la rutina a esos atletas.
 *
 * Un coach solo asigna a SUS atletas; un admin, a los de sus coaches. Sin esta
 * comprobación, un coach podría mandarle una rutina al atleta de otro coach.
 *
 * @throws {Error} con status 403 si algún atleta queda fuera de su ámbito.
 */
async function assertAthletesInScope(client, user, athleteIds) {
  if (!Array.isArray(athleteIds) || !athleteIds.length) return;
  if (user.role === "superadmin") return; // El superadmin asigna a quien sea.

  const ids = [...new Set(athleteIds.map(Number))];

  const scopeSql = user.role === "admin"
    ? `SELECT a.id FROM athletes a
         JOIN coaches c ON c.id = a.coach_id
        WHERE a.id = ANY($1) AND c.admin_id = $2`
    : `SELECT a.id FROM athletes a WHERE a.id = ANY($1) AND a.coach_id = $2`;

  const params = user.role === "admin" ? [ids, user.id] : [ids, user.coach_id];
  const found = await client.query(scopeSql, params);

  if (found.rows.length !== ids.length) {
    throw Object.assign(
      new Error("Estás intentando asignar la rutina a un atleta que no está a tu cargo."),
      { status: 403 }
    );
  }
}

/**
 * GET /api/routines
 * Lista las rutinas visibles para quien pregunta.
 * `can_edit` en cada fila le dice al frontend si mostrar los botones de editar/borrar.
 */
router.get("/", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const result = await pool.query(
      `SELECT r.*, ${EXERCISES_SUBQUERY}, ${ASSIGNMENTS_SUBQUERY}
         FROM routines r
         ${where}
        ORDER BY r.id`,
      params
    );
    res.json(result.rows.map(row => ({ ...row, can_edit: canModify(req.user, row) })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/routines/:id
 * Una rutina con sus ejercicios y asignaciones, si el usuario puede verla.
 * Devuelve 404 (y no 403) cuando no tiene acceso, para no revelar que ese id existe.
 */
router.get("/:id", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const idParam = `$${params.length + 1}`;
    const scoped = where
      ? `${where.replace(/^WHERE /, "WHERE (")}) AND r.id = ${idParam}`
      : `WHERE r.id = ${idParam}`;

    const result = await pool.query(
      `SELECT r.*, ${EXERCISES_SUBQUERY}, ${ASSIGNMENTS_SUBQUERY}
         FROM routines r ${scoped}`,
      [...params, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Rutina no encontrada." });

    res.json({ ...result.rows[0], can_edit: canModify(req.user, result.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * insertChildren(client, routineId, exercises, athleteIds)
 * Inserta los ejercicios y las asignaciones de una rutina.
 * Se usa al crear y al editar (en este último caso, tras borrar los anteriores).
 */
async function insertChildren(client, routineId, exercises, athleteIds) {
  // El orden del array define order_index (1, 2, 3...): es el orden en que el
  // atleta debe hacer los ejercicios, así que se respeta tal cual llegó.
  if (Array.isArray(exercises)) {
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      await client.query(
        `INSERT INTO routine_exercises
           (routine_id, exercise_id, sets, reps, rest_seconds, weight_kg, rpe, notes, order_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          routineId, ex.exercise_id, ex.sets, ex.reps, ex.rest_seconds || 60,
          // Prescripción opcional: cadena vacía o undefined -> NULL.
          ex.weight_kg === "" || ex.weight_kg == null ? null : ex.weight_kg,
          ex.rpe === "" || ex.rpe == null ? null : ex.rpe,
          ex.notes || null,
          i + 1,
        ]
      );
    }
  }

  if (Array.isArray(athleteIds)) {
    for (const athleteId of athleteIds) {
      await client.query(
        `INSERT INTO routine_assignments (routine_id, athlete_id) VALUES ($1, $2)`,
        [routineId, athleteId]
      );
    }
  }
}

/**
 * POST /api/routines
 * Crea la rutina + sus ejercicios + sus asignaciones, todo en una transacción.
 *
 * Igual que en los ejercicios, el dueño lo pone el servidor desde el token:
 *   · superadmin -> created_by NULL (rutina base, plantilla del sistema)
 *   · coach/admin -> created_by = él mismo
 */
router.post("/", async (req, res) => {
  if (req.user.role === "athlete") {
    return res.status(403).json({ error: "Un atleta no puede crear rutinas." });
  }

  const { name, description, weekly_frequency, exercises, athlete_ids } = req.body;
  if (!name || !weekly_frequency) {
    return res.status(400).json({ error: "name y weekly_frequency son obligatorios." });
  }

  const createdBy = req.user.role === "superadmin" ? null : req.user.id;
  const coachId = req.user.role === "coach" ? req.user.coach_id : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validar ANTES de insertar: si algo no cuadra, la transacción no llegó a escribir.
    await assertExercisesVisible(client, req.user, exercises);
    await assertAthletesInScope(client, req.user, athlete_ids);

    const routineResult = await client.query(
      `INSERT INTO routines (coach_id, created_by, name, description, weekly_frequency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [coachId, createdBy, name, description || null, weekly_frequency]
    );
    const routineId = routineResult.rows[0].id;

    await insertChildren(client, routineId, exercises, athlete_ids);

    await client.query("COMMIT");
    res.status(201).json({ id: routineId });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(error.status || mapError(error)).json({ error: error.status ? error.message : describeError(error) });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/routines/:id
 * Reemplaza los datos, ejercicios y asignaciones de la rutina. Solo su dueño.
 *
 * created_by y coach_id no se tocan: editar una rutina no cambia de quién es.
 */
router.put("/:id", async (req, res) => {
  const { name, description, weekly_frequency, exercises, athlete_ids } = req.body;
  const routineId = req.params.id;

  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT * FROM routines WHERE id = $1`, [routineId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Rutina no encontrada." });

    if (!canModify(req.user, existing.rows[0])) {
      return res.status(403).json({
        error: existing.rows[0].created_by == null
          ? "Esta rutina es una plantilla base y no se puede modificar. Crea una copia propia si necesitas cambiarla."
          : "Solo puedes modificar las rutinas que creaste tú.",
      });
    }

    await client.query("BEGIN");

    await assertExercisesVisible(client, req.user, exercises);
    await assertAthletesInScope(client, req.user, athlete_ids);

    await client.query(
      `UPDATE routines SET name = $1, description = $2, weekly_frequency = $3 WHERE id = $4`,
      [name, description || null, weekly_frequency, routineId]
    );

    // Estrategia simple y segura: borrar los hijos y volver a insertarlos.
    // Contrapartida conocida: se pierde el estado que cada atleta tenía en esta
    // rutina (vuelve a 'pending'). Es aceptable porque editar la rutina cambia
    // el plan de entrenamiento, así que el progreso anterior ya no aplica.
    await client.query(`DELETE FROM routine_exercises WHERE routine_id = $1`, [routineId]);
    await client.query(`DELETE FROM routine_assignments WHERE routine_id = $1`, [routineId]);
    await insertChildren(client, routineId, exercises, athlete_ids);

    await client.query("COMMIT");
    res.json({ id: Number(routineId) });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(error.status || mapError(error)).json({ error: error.status ? error.message : describeError(error) });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/routines/:id
 * Elimina la rutina (los hijos caen por ON DELETE CASCADE). Solo su dueño.
 */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await pool.query(`SELECT * FROM routines WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Rutina no encontrada." });

    if (!canModify(req.user, existing.rows[0])) {
      return res.status(403).json({
        error: existing.rows[0].created_by == null
          ? "Esta rutina es una plantilla base y no se puede eliminar."
          : "Solo puedes eliminar las rutinas que creaste tú.",
      });
    }

    await pool.query(`DELETE FROM routines WHERE id = $1`, [req.params.id]);
    res.json({ deleted: Number(req.params.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
/**
 * assertOwnsRoutine(user, routineId)
 * Devuelve la rutina si el usuario la puede gestionar; si no, lanza.
 * Asignar una rutina es una forma de modificarla, así que exige ser su dueño.
 */
async function assertOwnsRoutine(user, routineId) {
  const result = await pool.query(SELECT * FROM routines WHERE id = $1, [routineId]);
  if (!result.rows.length) throw Object.assign(new Error("Rutina no encontrada."), { status: 404 });
  if (!canModify(user, result.rows[0])) {
    throw Object.assign(new Error("Solo puedes asignar las rutinas que creaste tú."), { status: 403 });
  }
  return result.rows[0];
}

/**
 * POST /api/routines/:id/assignments   body { athlete_id }
 * Asigna la rutina a un atleta. Es idempotente: si la asignación ya existía pero
 * estaba desactivada, la reactiva en vez de fallar por clave duplicada.
 */
router.post("/:id/assignments", async (req, res) => {
  const { athlete_id } = req.body;
  if (!athlete_id) return res.status(400).json({ error: "athlete_id es obligatorio." });

  const client = await pool.connect();
  try {
    await assertOwnsRoutine(req.user, req.params.id);
    await assertAthletesInScope(client, req.user, [athlete_id]);

    await client.query(
      `INSERT INTO routine_assignments (routine_id, athlete_id, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (routine_id, athlete_id) DO UPDATE SET is_active = true`,
      [req.params.id, athlete_id]
    );
    res.status(201).json({ routine_id: Number(req.params.id), athlete_id: Number(athlete_id) });
  } catch (error) {
    if (error.code === "23503") return res.status(400).json({ error: "La rutina o el atleta no existe." });
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/routines/:id/assignments/:athleteId
 * Quita la asignación de una rutina a un atleta.
 */
router.delete("/:id/assignments/:athleteId", async (req, res) => {
  try {
    await assertOwnsRoutine(req.user, req.params.id);

    const result = await pool.query(
      DELETE FROM routine_assignments WHERE routine_id = $1 AND athlete_id = $2 RETURNING id,
      [req.params.id, req.params.athleteId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Esa asignación no existe." });
    res.json({ deleted: result.rows[0].id });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * PATCH /api/routines/:id/assignments/:athleteId/status   body { status }
 * Cambia el estado de la rutina PARA ESE ATLETA (pendiente / en progreso /
 * completada / cancelada).
 *
 * Es la única escritura que un atleta puede hacer, y solo sobre SU propia
 * asignación: la comparación con req.user.athlete_id impide que marque como
 * completada la rutina de otro. Al coach dueño también se le permite, para poder
 * corregir el estado o cancelar una rutina.
 */
router.patch("/:id/assignments/:athleteId/status", async (req, res) => {
  const { status } = req.body;
  const athleteId = Number(req.params.athleteId);

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: Estado inválido. Usa uno de: ${VALID_STATUSES.join(", ")}. });
  }

  try {
    // Un atleta solo puede tocar su propia fila; los demás roles, solo si son
    // dueños de la rutina.
    if (req.user.role === "athlete") {
      if (athleteId !== req.user.athlete_id) {
        return res.status(403).json({ error: "Solo puedes cambiar el estado de tus propias rutinas." });
      }
    } else {
      await assertOwnsRoutine(req.user, req.params.id);
    }

    const result = await pool.query(
      `UPDATE routine_assignments SET status = $1
        WHERE routine_id = $2 AND athlete_id = $3
        RETURNING id, status`,
      [status, req.params.id, athleteId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Esa asignación no existe." });

    res.json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Traduce códigos de error de Postgres a status HTTP legibles.
function mapError(error) {
  if (error.code === "23503") return 400; // FK inexistente (ejercicio/atleta no existe)
  if (error.code === "23505") return 409; // duplicado (mismo nombre de rutina, mismo atleta)
  if (error.code === "23514") return 400; // check (reps/sets/frecuencia fuera de rango)
  return 500;
}
function describeError(error) {
  if (error.code === "23503") return "Un ejercicio o atleta referenciado no existe.";
  if (error.code === "23505") return "Ya tienes una rutina con ese nombre, o hay un atleta repetido.";
  if (error.code === "23514") return "Valores fuera de rango (revisa series, repeticiones o frecuencia 1-7).";
  return error.message;
}

export default router;
