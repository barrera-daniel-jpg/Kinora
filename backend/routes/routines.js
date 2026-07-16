// Rutas de rutinas (base_v1.routines) con sus ejercicios (routine_exercises)
// y sus asignaciones a atletas (routine_assignments).
// Una rutina se arma en varias tablas, por eso crear/editar usa transacciones.
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// Subconsultas reutilizables: arman el array de ejercicios y de atletas de cada rutina.
const EXERCISES_SUBQUERY = `
  (SELECT COALESCE(json_agg(re_row ORDER BY re_row.order_index), '[]')
     FROM (
       SELECT re.id, re.exercise_id, e.name AS exercise_name, e.muscle_group,
              re.sets, re.reps, re.rest_seconds, re.weight_kg, re.rpe, re.notes,
              re.order_index
         FROM routine_exercises re
         JOIN exercises e ON e.id = re.exercise_id
        WHERE re.routine_id = r.id
     ) re_row) AS exercises`;

const ASSIGNMENTS_SUBQUERY = `
  (SELECT COALESCE(json_agg(a_row), '[]')
     FROM (
       SELECT ra.athlete_id, a.full_name AS athlete_name
         FROM routine_assignments ra
         JOIN athletes a ON a.id = ra.athlete_id
        WHERE ra.routine_id = r.id AND ra.is_active = true
     ) a_row) AS assignments`;

// GET /api/routines             -> todas las rutinas (superadmin).
// GET /api/routines?coach_id=N  -> AISLAMIENTO: solo las rutinas que creó ese coach.
// GET /api/routines?admin_id=N  -> AISLAMIENTO: las rutinas de los coaches de ese admin.
// GET /api/routines?athlete_id= -> vista de atleta: solo las asignadas a ese atleta.
// El superadmin no envía filtro y ve todas.
router.get("/", async (req, res) => {
  const { athlete_id, coach_id, admin_id } = req.query;
  try {
    // LEFT JOIN a coaches para poder filtrar por el admin dueño del coach.
    let sql = `
      SELECT r.*, ${EXERCISES_SUBQUERY}, ${ASSIGNMENTS_SUBQUERY}
        FROM routines r
        LEFT JOIN coaches c ON c.id = r.coach_id`;
    const params = [];
    const conditions = [];

    // Aislamiento por coach: solo las rutinas de las que es dueño.
    if (coach_id) {
      params.push(coach_id);
      conditions.push(`r.coach_id = $${params.length}`);
    }
    // Aislamiento por admin: las rutinas de cualquier coach de ese admin.
    if (admin_id) {
      params.push(admin_id);
      conditions.push(`c.admin_id = $${params.length}`);
    }
    // Vista de atleta: solo las rutinas que le fueron asignadas.
    if (athlete_id) {
      params.push(athlete_id);
      conditions.push(`EXISTS (
          SELECT 1 FROM routine_assignments ra
           WHERE ra.routine_id = r.id AND ra.athlete_id = $${params.length} AND ra.is_active = true
        )`);
    }

    if (conditions.length) sql += ` WHERE ` + conditions.join(" AND ");
    sql += ` ORDER BY r.id`;

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/routines/:id -> una rutina con sus ejercicios y asignaciones.
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, ${EXERCISES_SUBQUERY}, ${ASSIGNMENTS_SUBQUERY}
         FROM routines r WHERE r.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Rutina no encontrada." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Inserta los ejercicios y las asignaciones de una rutina.
 * Se usa tanto al crear como al editar (tras limpiar los anteriores).
 */
async function insertChildren(client, routineId, exercises, athleteIds) {
  // Ejercicios de la rutina: el orden en el array define order_index (1, 2, 3...).
  if (Array.isArray(exercises)) {
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      await client.query(
        `INSERT INTO routine_exercises
           (routine_id, exercise_id, sets, reps, rest_seconds, weight_kg, rpe, notes, order_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          routineId, ex.exercise_id, ex.sets, ex.reps, ex.rest_seconds || 60,
          // Campos opcionales: cadena vacía o undefined -> NULL.
          ex.weight_kg === "" || ex.weight_kg == null ? null : ex.weight_kg,
          ex.rpe === "" || ex.rpe == null ? null : ex.rpe,
          ex.notes || null,
          i + 1,
        ]
      );
    }
  }
  // Asignaciones a atletas.
  if (Array.isArray(athleteIds)) {
    for (const athleteId of athleteIds) {
      await client.query(
        `INSERT INTO routine_assignments (routine_id, athlete_id) VALUES ($1, $2)`,
        [routineId, athleteId]
      );
    }
  }
}

// POST /api/routines -> crea la rutina + sus ejercicios + sus asignaciones.
router.post("/", async (req, res) => {
  const { coach_id, name, description, weekly_frequency, exercises, athlete_ids } = req.body;
  if (!name || !weekly_frequency) {
    return res.status(400).json({ error: "name y weekly_frequency son obligatorios." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const routineResult = await client.query(
      `INSERT INTO routines (coach_id, name, description, weekly_frequency)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [coach_id || null, name, description || null, weekly_frequency]
    );
    const routineId = routineResult.rows[0].id;

    await insertChildren(client, routineId, exercises, athlete_ids);

    await client.query("COMMIT");
    res.status(201).json({ id: routineId });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(mapError(error)).json({ error: describeError(error) });
  } finally {
    client.release();
  }
});

// PUT /api/routines/:id -> reemplaza los datos, ejercicios y asignaciones de la rutina.
router.put("/:id", async (req, res) => {
  const { coach_id, name, description, weekly_frequency, exercises, athlete_ids } = req.body;
  const routineId = req.params.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated = await client.query(
      `UPDATE routines
          SET coach_id = $1, name = $2, description = $3, weekly_frequency = $4
        WHERE id = $5
        RETURNING id`,
      [coach_id || null, name, description || null, weekly_frequency, routineId]
    );
    if (!updated.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Rutina no encontrada." });
    }

    // Estrategia simple y segura: borrar los hijos y volver a insertarlos.
    await client.query(`DELETE FROM routine_exercises WHERE routine_id = $1`, [routineId]);
    await client.query(`DELETE FROM routine_assignments WHERE routine_id = $1`, [routineId]);
    await insertChildren(client, routineId, exercises, athlete_ids);

    await client.query("COMMIT");
    res.json({ id: routineId });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(mapError(error)).json({ error: describeError(error) });
  } finally {
    client.release();
  }
});

// DELETE /api/routines/:id -> elimina la rutina (los hijos caen por ON DELETE CASCADE).
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM routines WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Rutina no encontrada." });
    res.json({ deleted: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Asignaciones sueltas (para asignar/quitar una rutina a un atleta desde la
//     vista de Atletas, sin abrir la rutina completa). ---

// POST /api/routines/:id/assignments  body { athlete_id } -> asigna la rutina al
// atleta. Idempotente: si ya existe la reactiva (is_active = true).
router.post("/:id/assignments", async (req, res) => {
  const { athlete_id } = req.body;
  if (!athlete_id) return res.status(400).json({ error: "athlete_id es obligatorio." });
  try {
    await pool.query(
      `INSERT INTO routine_assignments (routine_id, athlete_id, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (routine_id, athlete_id) DO UPDATE SET is_active = true`,
      [req.params.id, athlete_id]
    );
    res.status(201).json({ routine_id: Number(req.params.id), athlete_id: Number(athlete_id) });
  } catch (error) {
    if (error.code === "23503") return res.status(400).json({ error: "La rutina o el atleta no existe." });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/routines/:id/assignments/:athleteId -> quita la asignación.
router.delete("/:id/assignments/:athleteId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM routine_assignments WHERE routine_id = $1 AND athlete_id = $2 RETURNING id`,
      [req.params.id, req.params.athleteId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Esa asignación no existe." });
    res.json({ deleted: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Traduce códigos de error de Postgres a status HTTP legibles.
function mapError(error) {
  if (error.code === "23503") return 400; // FK inexistente (ejercicio/atleta no existe)
  if (error.code === "23505") return 409; // duplicado (mismo atleta u orden repetido)
  if (error.code === "23514") return 400; // check (reps/sets/frecuencia fuera de rango)
  return 500;
}
function describeError(error) {
  if (error.code === "23503") return "Un ejercicio o atleta referenciado no existe.";
  if (error.code === "23505") return "Hay un atleta o un orden de ejercicio duplicado.";
  if (error.code === "23514") return "Valores fuera de rango (revisa series, repeticiones o frecuencia 1-7).";
  return error.message;
}

export default router;
