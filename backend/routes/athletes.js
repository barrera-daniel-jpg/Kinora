// Rutas de atletas (tabla base_v1.athletes + su usuario en base_v1.users).
// Crear un atleta implica crear PRIMERO un usuario (role 'athlete') y luego su perfil.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const router = Router();

// GET /api/athletes             -> todos los atletas (superadmin).
// GET /api/athletes?coach_id=N  -> AISLAMIENTO: solo los atletas de ese coach.
// GET /api/athletes?admin_id=N  -> AISLAMIENTO: los atletas cuyos coaches pertenecen a
//    ese admin (cascada dueño → coach → atleta). El superadmin no envía filtro y ve todos.
router.get("/", async (req, res) => {
  const { coach_id, admin_id } = req.query;
  try {
    const params = [];
    const conditions = [];
    if (coach_id) {
      params.push(coach_id);
      conditions.push(`a.coach_id = $${params.length}`);
    }
    if (admin_id) {
      params.push(admin_id);
      conditions.push(`c.admin_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT a.id, a.user_id, a.coach_id, a.full_name, a.document_number, a.birthdate,
              u.username, u.email, u.is_active,
              c.full_name AS coach_name
         FROM athletes a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN coaches c ON c.id = a.coach_id
         ${where}
        ORDER BY a.id`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/athletes/:id -> un atleta puntual.
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.user_id, a.coach_id, a.full_name, a.document_number, a.birthdate,
              u.username, u.email, u.is_active
         FROM athletes a
         JOIN users u ON u.id = a.user_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Atleta no encontrado." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/athletes -> crea usuario (role athlete) + perfil de atleta.
router.post("/", async (req, res) => {
  const { username, password, email, full_name, document_number, birthdate, coach_id } = req.body;
  if (!username || !password || !full_name || !document_number || !birthdate) {
    return res.status(400).json({
      error: "username, password, full_name, document_number y birthdate son obligatorios.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, email)
       VALUES ($1, $2, 'athlete', $3)
       RETURNING id`,
      [username, password_hash, email || null]
    );
    const userId = userResult.rows[0].id;

    const athleteResult = await client.query(
      `INSERT INTO athletes (user_id, coach_id, full_name, document_number, birthdate)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, coach_id || null, full_name, document_number, birthdate]
    );

    await client.query("COMMIT");
    res.status(201).json(athleteResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ error: "El usuario, correo o número de documento ya está registrado." });
    }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// PUT /api/athletes/:id -> actualiza el perfil del atleta (y correo del usuario).
router.put("/:id", async (req, res) => {
  const { full_name, document_number, birthdate, coach_id, email } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const athleteResult = await client.query(
      `UPDATE athletes
          SET full_name = $1, document_number = $2, birthdate = $3, coach_id = $4
        WHERE id = $5
        RETURNING user_id`,
      [full_name, document_number, birthdate, coach_id || null, req.params.id]
    );
    if (!athleteResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Atleta no encontrado." });
    }

    if (email !== undefined) {
      await client.query(`UPDATE users SET email = $1 WHERE id = $2`, [email || null, athleteResult.rows[0].user_id]);
    }

    await client.query("COMMIT");
    res.json({ updated: req.params.id });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "El correo o documento ya está en uso." });
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// DELETE /api/athletes/:id -> elimina el usuario (y en cascada su perfil de atleta).
router.delete("/:id", async (req, res) => {
  try {
    // Borrar el usuario elimina el atleta por el ON DELETE CASCADE del esquema.
    const athlete = await pool.query(`SELECT user_id FROM athletes WHERE id = $1`, [req.params.id]);
    if (!athlete.rows.length) return res.status(404).json({ error: "Atleta no encontrado." });

    await pool.query(`DELETE FROM users WHERE id = $1`, [athlete.rows[0].user_id]);
    res.json({ deleted: req.params.id });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el atleta tiene rutinas o sesiones asociadas." });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
