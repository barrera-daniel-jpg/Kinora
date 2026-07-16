// CRUD del catálogo de ejercicios (tabla base_v1.exercises).
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/exercises             -> todos los ejercicios (superadmin).
// GET /api/exercises?coach_id=N  -> AISLAMIENTO: los ejercicios de ese coach MÁS los del
//    catálogo global (coach_id NULL), compartidos por todos.
// GET /api/exercises?admin_id=N  -> AISLAMIENTO: los ejercicios de los coaches de ese admin
//    MÁS el catálogo global. El superadmin no envía filtro y ve todos.
router.get("/", async (req, res) => {
  const { coach_id, admin_id } = req.query;
  try {
    const params = [];
    let where = "";
    if (coach_id) {
      params.push(coach_id);
      // e.coach_id = coach pedido, o global (compartido).
      where = `WHERE e.coach_id = $1 OR e.coach_id IS NULL`;
    } else if (admin_id) {
      params.push(admin_id);
      // Ejercicios de cualquier coach de ese admin, o globales (compartidos).
      where = `WHERE c.admin_id = $1 OR e.coach_id IS NULL`;
    }
    const result = await pool.query(
      `SELECT e.* FROM exercises e
         LEFT JOIN coaches c ON c.id = e.coach_id
         ${where} ORDER BY e.id`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/exercises/:id -> un ejercicio puntual.
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM exercises WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/exercises -> crea un ejercicio.
router.post("/", async (req, res) => {
  const { coach_id, name, muscle_group, equipment, difficulty, description, gif_url } = req.body;
  if (!name || !muscle_group || !equipment || !difficulty) {
    return res.status(400).json({ error: "name, muscle_group, equipment y difficulty son obligatorios." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO exercises (coach_id, name, muscle_group, equipment, difficulty, description, gif_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [coach_id || null, name, muscle_group, equipment, difficulty, description || null, gif_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un ejercicio con ese nombre." });
    if (error.code === "23514") return res.status(400).json({ error: "Dificultad inválida (usa: principiante, intermedio o avanzado)." });
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/exercises/:id -> actualiza un ejercicio.
router.put("/:id", async (req, res) => {
  const { coach_id, name, muscle_group, equipment, difficulty, description, gif_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE exercises
         SET coach_id = $1, name = $2, muscle_group = $3, equipment = $4,
             difficulty = $5, description = $6, gif_url = $7
       WHERE id = $8
       RETURNING *`,
      [coach_id || null, name, muscle_group, equipment, difficulty, description || null, gif_url || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un ejercicio con ese nombre." });
    if (error.code === "23514") return res.status(400).json({ error: "Dificultad inválida (usa: principiante, intermedio o avanzado)." });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/exercises/:id -> elimina un ejercicio.
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM exercises WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });
    res.json({ deleted: result.rows[0].id });
  } catch (error) {
    // 23503 = violación de clave foránea: el ejercicio está usado en una rutina o sesión.
    if (error.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el ejercicio está asignado a una rutina o sesión." });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
