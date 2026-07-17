// Rutas de gestión de ADMINS. Exclusivas del superadmin.
//
// Un admin NO tiene tabla de perfil: es simplemente una fila en "users" con
// role = 'admin'. Por eso aquí se trabaja directamente sobre users y no hacen
// falta transacciones — se toca una sola tabla.
//
// El WHERE role = 'admin' se repite en TODAS las consultas a propósito. Es la
// barrera que impide que estas rutas se usen para tocar a un coach, un atleta o
// —peor— a otro superadmin: aunque alguien pase el id de un superadmin, la fila
// no cuadra con el filtro y no se encuentra.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Solo el superadmin gestiona admins.
router.use(requireAuth, requireRole("superadmin"));

/**
 * GET /api/admins
 * Lista los admins, con la cuenta de coaches que tiene cada uno a su cargo.
 *
 * El conteo se calcula en la BD con una subconsulta en vez de traer todos los
 * coaches al navegador para contarlos ahí: una consulta en lugar de dos, y no
 * se transfieren datos que no se van a mostrar.
 */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM coaches c WHERE c.admin_id = u.id)::int AS coach_count
         FROM users u
        WHERE u.role = 'admin'
        ORDER BY u.id`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admins
 * Crea un usuario con rol 'admin' y su contraseña hasheada.
 */
router.post("/", async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username y password son obligatorios." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, email)
       VALUES ($1, $2, 'admin', $3)
       RETURNING id, username, email, is_active`,
      [username, password_hash, email || null]
    );
    res.status(201).json({ ...result.rows[0], coach_count: 0 });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El nombre de usuario o correo ya está registrado." });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admins/:id
 * Edita un admin: correo, usuario y si su acceso está activo.
 *
 * Faltaba: para corregir un correo mal escrito había que borrar el admin y crearlo
 * de nuevo, lo que dejaba a todos sus coaches sin dueño por el camino.
 *
 * is_active permite SUSPENDER a un admin sin borrar nada: deja de poder entrar
 * (el login comprueba is_active), pero sus coaches siguen colgando de él. Es la
 * opción prudente frente al DELETE, que sí los deja huérfanos.
 */
router.put("/:id", async (req, res) => {
  const { username, email, is_active } = req.body;

  try {
    // COALESCE: si un campo no viene en la petición, se queda como estaba. Así,
    // actualizar solo el correo no borra el resto por mandarlos vacíos.
    const result = await pool.query(
      `UPDATE users
          SET username  = COALESCE($1, username),
              email     = $2,
              is_active = COALESCE($3, is_active)
        WHERE id = $4 AND role = 'admin'
        RETURNING id, username, email, is_active`,
      [username || null, email !== undefined ? email || null : null, is_active, req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Admin no encontrado (o el usuario no es un admin)." });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El nombre de usuario o correo ya está en uso." });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admins/:id
 * Elimina un admin.
 *
 * Sus coaches NO se borran: la FK coaches.admin_id es ON DELETE SET NULL, así que
 * quedan sin dueño y pasan a ser gestionados solo por el superadmin. Es deliberado
 * — borrar a un admin no debería arrastrar a sus coaches, atletas y rutinas.
 *
 * Se avisa de cuántos coaches quedan huérfanos para que el superadmin sepa que
 * tiene que reasignarlos.
 */
router.delete("/:id", async (req, res) => {
  try {
    const orphans = await pool.query(
      `SELECT COUNT(*)::int AS count FROM coaches WHERE admin_id = $1`,
      [req.params.id]
    );

    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'admin' RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Admin no encontrado (o el usuario no es un admin)." });
    }

    res.json({ deleted: result.rows[0].id, orphaned_coaches: orphans.rows[0].count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
