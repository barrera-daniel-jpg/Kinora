// Rutas de administración de ADMINS, para el rol "superadmin" (el jefe por encima).
// Un admin NO tiene tabla de perfil: es simplemente una fila en "users" con
// role = 'admin'. Por eso aquí trabajamos directamente sobre la tabla users.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const router = Router();

// GET /api/admins -> lista de todos los usuarios con rol 'admin'.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, is_active, created_at
         FROM users
        WHERE role = 'admin'
        ORDER BY id`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admins -> crea un usuario con rol 'admin' y su contraseña hasheada.
router.post("/", async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username y password son obligatorios." });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, email)
       VALUES ($1, $2, 'admin', $3)
       RETURNING id, username, email, is_active`,
      [username, password_hash, email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El nombre de usuario o correo ya está registrado." });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admins/:id -> elimina un usuario admin.
// Guarda de seguridad: solo borra si el usuario es realmente rol 'admin', para que
// esta ruta no pueda usarse para eliminar superadmins, coaches o atletas.
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'admin' RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Admin no encontrado (o el usuario no es un admin)." });
    }
    res.json({ deleted: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
