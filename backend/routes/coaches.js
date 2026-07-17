// Rutas de coaches (tabla base_v1.coaches + su usuario en base_v1.users).
//
// Un coach son SIEMPRE dos filas: una en users (con la contraseña y el rol) y otra
// en coaches (su perfil). Por eso crearlo va dentro de una transacción: si fallara
// a mitad, quedaría un usuario sin perfil que puede iniciar sesión pero no existe
// como coach en ninguna pantalla.
//
// Quién gestiona coaches:
//   · superadmin -> todos los coaches del sistema.
//   · admin      -> solo los coaches que él creó (coaches.admin_id = su users.id).
//   · coach/athlete -> nadie más entra aquí.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Este módulo entero es solo para superadmin y admin.
router.use(requireAuth, requireRole("superadmin", "admin"));

/**
 * assertCanManageCoach(user, coachId)
 * Comprueba que este usuario puede tocar ESTE coach, y devuelve su fila.
 *
 * Es la pieza que impide que el admin A edite o borre a los coaches del admin B.
 * Antes no existía: el aislamiento solo se aplicaba al LISTAR, así que bastaba con
 * conocer un id ajeno para editarlo. Ahora se comprueba también al escribir.
 *
 * @throws {Error} 404 si no existe, 403 si es de otro admin.
 */
async function assertCanManageCoach(user, coachId) {
  const result = await pool.query(`SELECT * FROM coaches WHERE id = $1`, [coachId]);
  if (!result.rows.length) throw Object.assign(new Error("Coach no encontrado."), { status: 404 });

  const coach = result.rows[0];
  if (user.role !== "superadmin" && coach.admin_id !== user.id) {
    throw Object.assign(new Error("Ese coach no está a tu cargo."), { status: 403 });
  }
  return coach;
}

/**
 * GET /api/coaches
 * Lista los coaches del ámbito de quien pregunta.
 *
 * El recorte sale del token: antes venía de "?admin_id=" en la URL, así que un
 * admin podía escribir el id de otro y ver a sus coaches. Ya no se lee de ahí.
 */
router.get("/", async (req, res) => {
  try {
    // El superadmin no lleva filtro; el admin queda limitado a los suyos.
    const isAdmin = req.user.role === "admin";
    const where = isAdmin ? "WHERE c.admin_id = $1" : "";
    const params = isAdmin ? [req.user.id] : [];

    const result = await pool.query(
      `SELECT c.id, c.user_id, c.full_name, c.phone, c.is_approved, c.admin_id,
              c.document_number, c.birthdate,
              u.email, u.username, u.is_active
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

/**
 * GET /api/coaches/:id
 * Un coach puntual, si está en el ámbito de quien pregunta.
 */
router.get("/:id", async (req, res) => {
  try {
    await assertCanManageCoach(req.user, req.params.id);

    const result = await pool.query(
      `SELECT c.id, c.user_id, c.full_name, c.phone, c.is_approved, c.admin_id,
              c.document_number, c.birthdate,
              u.email, u.username, u.is_active
         FROM coaches c
         JOIN users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/coaches
 * Crea el usuario (role 'coach') y su perfil, con la contraseña hasheada.
 *
 * admin_id sale del token, no del cuerpo: si un admin crea el coach, queda a su
 * cargo; si lo crea el superadmin, el coach queda sin dueño (NULL) y solo el
 * superadmin lo gestiona. Aceptarlo del cliente permitiría colgarle un coach a otro admin.
 *
 * is_approved = true: lo dio de alta alguien con autoridad, así que ya está aprobado.
 */
router.post("/", async (req, res) => {
  const { username, password, email, full_name, phone, document_number, birthdate } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "username, password y full_name son obligatorios." });
  }

  const adminId = req.user.role === "admin" ? req.user.id : null;

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

    // document_number y birthdate se guardan de verdad. Antes el formulario los
    // pedía como obligatorios pero el INSERT no los incluía, así que se perdían
    // en silencio: el usuario los escribía y el perfil quedaba siempre vacío.
    const coachResult = await client.query(
      `INSERT INTO coaches (user_id, full_name, phone, is_approved, admin_id, document_number, birthdate)
       VALUES ($1, $2, $3, true, $4, $5, $6)
       RETURNING *`,
      [userId, full_name, phone || null, adminId, document_number || null, birthdate || null]
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

/**
 * PUT /api/coaches/:id
 * Edita el perfil del coach y el correo de su usuario.
 *
 * Faltaba por completo: hasta ahora un coach solo se podía crear y borrar, así que
 * corregir un teléfono mal escrito obligaba a eliminarlo y volverlo a crear —
 * perdiendo de paso sus rutinas y sus atletas.
 *
 * La contraseña NO se cambia aquí: para eso está POST /api/auth/change-password,
 * que exige conocer la actual.
 */
router.put("/:id", async (req, res) => {
  const { full_name, phone, document_number, birthdate, email, is_active } = req.body;

  const client = await pool.connect();
  try {
    const coach = await assertCanManageCoach(req.user, req.params.id);

    await client.query("BEGIN");

    await client.query(
      `UPDATE coaches
          SET full_name = $1, phone = $2, document_number = $3, birthdate = $4
        WHERE id = $5`,
      [full_name, phone || null, document_number || null, birthdate || null, req.params.id]
    );

    // Los campos del usuario solo se tocan si vinieron en la petición: así, editar
    // el teléfono no borra el correo por mandarlo vacío sin querer.
    if (email !== undefined) {
      await client.query(`UPDATE users SET email = $1 WHERE id = $2`, [email || null, coach.user_id]);
    }
    // is_active en false = suspender el acceso sin borrar nada. El login lo respeta.
    if (is_active !== undefined) {
      await client.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [Boolean(is_active), coach.user_id]);
    }

    await client.query("COMMIT");
    res.json({ updated: Number(req.params.id) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "El correo o documento ya está en uso." });
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/coaches/:id
 * Elimina el coach y TODOS sus datos privados, en cascada y en orden.
 *
 * Por qué no basta con borrar el usuario y dejar que la BD haga cascada:
 * la FK exercises.coach_id es ON DELETE SET NULL. Al borrar solo el usuario, los
 * ejercicios del coach se quedaban con coach_id NULL, o sea "ascendían" al catálogo
 * base, y su nombre chocaba con el índice único de nombres base -> error 23505 y el
 * borrado entero se revertía. Por eso se borra a mano lo suyo, en este orden, dentro
 * de una transacción.
 */
router.delete("/:id", async (req, res) => {
  const coachId = req.params.id;
  const client = await pool.connect();
  try {
    const coach = await assertCanManageCoach(req.user, coachId);

    await client.query("BEGIN");

    // 1) Atletas del coach: al borrar su usuario, cascada athletes -> training_sessions
    //    (-> session_exercises), routine_assignments y observations.
    await client.query(
      `DELETE FROM users WHERE id IN (SELECT user_id FROM athletes WHERE coach_id = $1)`,
      [coachId]
    );

    // 2) Rutinas del coach: cascada routine_exercises y routine_assignments; libera
    //    los ejercicios del RESTRICT que impide borrarlos si están en una rutina.
    await client.query(`DELETE FROM routines WHERE coach_id = $1`, [coachId]);

    // 3) Ejercicios privados del coach: ya sin referencias, se borran en vez de
    //    orfanizarse al catálogo base (esa era la causa del error de índice único).
    await client.query(`DELETE FROM exercises WHERE coach_id = $1`, [coachId]);

    // 4) Usuario del coach: cascada su perfil (coaches) y sus observations.
    await client.query(`DELETE FROM users WHERE id = $1`, [coach.user_id]);

    await client.query("COMMIT");
    res.json({ deleted: Number(coachId) });
  } catch (error) {
    await client.query("ROLLBACK");
    // 23503 = alguna FK RESTRICT bloqueó: un ejercicio del coach lo usa la rutina o
    // sesión de OTRO coach/atleta. Hay que reasignarlo o borrarlo a mano primero.
    if (error.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: hay ejercicios del coach usados por rutinas o sesiones de otros. Reasígnalos o bórralos primero.",
      });
    }
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
