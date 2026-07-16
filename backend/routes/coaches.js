// Rutas de coaches (tabla base_v1.coaches + su usuario en base_v1.users).
// Crear un coach implica crear PRIMERO un usuario (role 'coach') y luego su perfil.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const router = Router();

// GET /api/coaches             -> todos los coaches (superadmin).
// GET /api/coaches?admin_id=N  -> AISLAMIENTO: solo los coaches de ese admin (dueño).
// El frontend envía admin_id cuando quien consulta es un admin; el superadmin no lo
// envía y así ve a todos.
router.get("/", async (req, res) => {
  const { admin_id } = req.query;
  try {
    const params = [];
    let where = "";
    if (admin_id) {
      params.push(admin_id);
      where = `WHERE c.admin_id = $1`;
    }
    const result = await pool.query(
      `SELECT c.id, c.user_id, c.full_name, c.phone, c.is_approved, c.admin_id, u.email, u.username
         FROM coaches c
         JOIN users u ON u.id = c.user_id
         ${where}
        ORDER BY c.id`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/coaches -> crea usuario (role coach) + perfil de coach, con su contraseña.
// admin_id: el id (users.id) del admin dueño. Lo envía el admin que crea el coach;
// el superadmin puede omitirlo (coach sin dueño, admin_id NULL).
router.post("/", async (req, res) => {
  const { username, password, email, full_name, phone, admin_id } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "username, password y full_name son obligatorios." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, email)
       VALUES ($1, $2, 'coach', $3)
       RETURNING id`,
      [username, password_hash, email || null]
    );
    const userId = userResult.rows[0].id;

    // is_approved = true: el coach fue dado de alta por un admin, así que ya está aprobado.
    const coachResult = await client.query(
      `INSERT INTO coaches (user_id, full_name, phone, is_approved, admin_id)
       VALUES ($1, $2, $3, true, $4)
       RETURNING *`,
      [userId, full_name, phone || null, admin_id || null]
    );

    await client.query("COMMIT");
    res.status(201).json(coachResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ error: "El nombre de usuario o correo ya está registrado." });
    }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// DELETE /api/coaches/:id -> elimina el coach y TODOS sus datos privados, en cascada.
//
// Por qué esta lógica y no un simple DELETE del usuario:
// La FK exercises.coach_id es ON DELETE SET NULL. Si sólo borráramos el usuario, los
// ejercicios del coach quedarían con coach_id NULL (se "promoverían" al catálogo global),
// y su nombre chocaría con el índice único parcial idx_exercises_base_unique_name
// (UNIQUE(name) WHERE coach_id IS NULL) -> error 23505 y el borrado se revierte.
// Solución: borrar explícitamente lo del coach, en orden, dentro de una transacción.
router.delete("/:id", async (req, res) => {
  const coachId = req.params.id;
  const client = await pool.connect();
  try {
    const coach = await client.query(`SELECT user_id FROM coaches WHERE id = $1`, [coachId]);
    if (!coach.rows.length) return res.status(404).json({ error: "Coach no encontrado." });
    const userId = coach.rows[0].user_id;

    await client.query("BEGIN");

    // 1) Atletas del coach: al borrar su usuario, cascada athletes -> training_sessions
    //    (-> session_exercises), routine_assignments y observations.
    await client.query(
      `DELETE FROM users WHERE id IN (SELECT user_id FROM athletes WHERE coach_id = $1)`,
      [coachId]
    );

    // 2) Rutinas del coach: cascada routine_exercises y routine_assignments; libera los
    //    ejercicios del RESTRICT que impide borrarlos si están en una rutina.
    await client.query(`DELETE FROM routines WHERE coach_id = $1`, [coachId]);

    // 3) Ejercicios privados del coach: ya sin referencias, se borran en vez de
    //    orfanizarse al catálogo global (esa era la causa del error de índice único).
    await client.query(`DELETE FROM exercises WHERE coach_id = $1`, [coachId]);

    // 4) Usuario del coach: cascada su perfil (coaches) y sus observations.
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query("COMMIT");
    res.json({ deleted: coachId });
  } catch (error) {
    await client.query("ROLLBACK");
    // 23503 = alguna FK RESTRICT bloqueó: un ejercicio del coach lo usa la rutina o
    // sesión de OTRO coach/atleta. Hay que reasignarlo/borrarlo a mano primero.
    if (error.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: hay ejercicios del coach usados por rutinas o sesiones de otros. Reasígnalos o bórralos primero.",
      });
    }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
