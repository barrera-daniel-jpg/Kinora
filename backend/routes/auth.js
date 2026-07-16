// Rutas de autenticación: registro e inicio de sesión.
// Las contraseñas se guardan HASHEADAS con bcrypt en users.password_hash.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const router = Router();

const VALID_ROLES = ["superadmin", "admin", "coach", "athlete"];

/**
 * POST /api/auth/register
 * Crea un usuario (tabla users) y su perfil asociado (coaches o athletes)
 * dentro de una transacción, para que ambas inserciones ocurran o ninguna.
 */
router.post("/register", async (req, res) => {
  const {
    username, password, email, role, full_name,
    phone,                          // solo coaches
    document_number, birthdate, coach_id, // solo atletas
  } = req.body;

  if (!username || !password || !role || !full_name) {
    return res.status(400).json({ error: "username, password, role y full_name son obligatorios." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role inválido. Usa uno de: ${VALID_ROLES.join(", ")}.` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, role, email, is_active`,
      [username, password_hash, role, email || null]
    );
    const user = userResult.rows[0];

    if (role === "coach") {
      await client.query(
        `INSERT INTO coaches (user_id, full_name, phone) VALUES ($1, $2, $3)`,
        [user.id, full_name, phone || null]
      );
    } else if (role === "athlete") {
      if (!document_number || !birthdate) {
        // Lanzamos para que el catch haga ROLLBACK.
        throw Object.assign(new Error("document_number y birthdate son obligatorios para atletas."), { status: 400 });
      }
      await client.query(
        `INSERT INTO athletes (user_id, coach_id, full_name, document_number, birthdate)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, coach_id || null, full_name, document_number, birthdate]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(user);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ error: "El nombre de usuario, correo o documento ya está registrado." });
    }
    res.status(error.status || 500).json({ error: error.message || "No se pudo registrar el usuario." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/auth/login
 * Verifica username + password. Devuelve los datos del usuario junto con
 * el id de su perfil (coach_id o athlete_id) y su nombre completo.
 */
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username y password son obligatorios." });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.password_hash, u.role, u.email, u.is_active,
              c.id AS coach_id,
              a.id AS athlete_id,
              COALESCE(c.full_name, a.full_name) AS full_name
       FROM users u
       LEFT JOIN coaches c ON c.user_id = u.id
       LEFT JOIN athletes a ON a.user_id = u.id
       WHERE u.username = $1`,
      [username]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Credenciales incorrectas." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Credenciales incorrectas." });
    }

    delete user.password_hash; // Nunca devolvemos el hash al cliente.
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
