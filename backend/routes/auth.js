// Rutas de autenticación: inicio de sesión y alta de usuarios.
// Las contraseñas se guardan HASHEADAS con bcrypt en users.password_hash; la
// verificación ocurre siempre en el servidor, nunca en el navegador.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { signToken, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Roles que se pueden dar de alta por la API. 'superadmin' se deja fuera a
// propósito: se crea a mano con backend/create-superadmin.js.
const CREATABLE_ROLES = ["admin", "coach", "athlete"];

/**
 * POST /api/auth/register
 * Crea un usuario (tabla users) y su perfil asociado (coaches o athletes) dentro
 * de una transacción, para que ambas inserciones ocurran juntas o ninguna.
 * Solo la pueden usar el superadmin y los admins.
 */
router.post("/register", requireAuth, requireRole("superadmin", "admin"), async (req, res) => {
  const {
    username, password, email, role, full_name,
    phone,                                 // solo coaches
    document_number, birthdate, coach_id,  // solo atletas
  } = req.body;

  if (!username || !password || !role || !full_name) {
    return res.status(400).json({ error: "username, password, role y full_name son obligatorios." });
  }
  if (!CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role inválido. Usa uno de: ${CREATABLE_ROLES.join(", ")}.` });
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
      // admin_id: el coach queda a cargo del admin que lo creó. Si lo crea el
      // superadmin, se queda sin dueño (NULL) y solo él lo gestiona.
      const adminId = req.user.role === "admin" ? req.user.id : null;
      await client.query(
        `INSERT INTO coaches (user_id, full_name, phone, is_approved, admin_id)
         VALUES ($1, $2, $3, true, $4)`,
        [user.id, full_name, phone || null, adminId]
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
 * Verifica username + password y, si son correctos, devuelve los datos del usuario
 * junto con un token de sesión (JWT) que el frontend manda en las siguientes
 * peticiones para identificarse.
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
    // Usamos el mismo mensaje si el usuario no existe, está inactivo o la
    // contraseña falla, para no revelar qué usuarios existen.
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Credenciales incorrectas." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Credenciales incorrectas." });
    }

    delete user.password_hash; // Nunca devolvemos el hash al cliente.
    res.json({ ...user, token: signToken(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/change-password
 * Cambia la contraseña del usuario con la sesión abierta. Pide la contraseña
 * actual como confirmación antes de aplicar la nueva.
 */
router.post("/change-password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "current_password y new_password son obligatorios." });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
  }

  try {
    const result = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado." });

    const matches = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!matches) return res.status(401).json({ error: "La contraseña actual no es correcta." });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [password_hash, req.user.id]);

    res.json({ updated: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
