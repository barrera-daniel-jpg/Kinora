// Rutas de atletas (tabla base_v1.athletes + su usuario en base_v1.users).
//
// Igual que el coach, un atleta son dos filas (users + athletes) y por eso crearlo
// va en una transacción.
//
// Quién ve y gestiona atletas:
//   · superadmin -> todos.
//   · admin      -> los atletas de los coaches que él creó (cascada: admin -> coach -> atleta).
//   · coach      -> solo los suyos.
//   · athlete    -> solo su propia ficha, y de lectura.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

/**
 * visibilityClause(user)
 * El WHERE de LECTURA según el rol, derivado del token y no de la URL.
 * Antes el recorte venía de "?coach_id=" / "?admin_id=", así que cambiar un número
 * en la barra de direcciones bastaba para ver los atletas de otro.
 *
 * @returns {{ where: string, params: any[] }}
 */
function visibilityClause(user) {
  switch (user.role) {
    case "superadmin":
      return { where: "", params: [] };

    case "admin":
      return { where: "WHERE c.admin_id = $1", params: [user.id] };

    case "coach":
      return { where: "WHERE a.coach_id = $1", params: [user.coach_id] };

    // El atleta solo se ve a sí mismo.
    case "athlete":
      return { where: "WHERE a.id = $1", params: [user.athlete_id] };

    default:
      return { where: "WHERE false", params: [] };
  }
}

/**
 * assertCanManageAthlete(user, athleteId)
 * Comprueba que este usuario puede EDITAR/BORRAR a este atleta, y devuelve su fila.
 *
 * Ojo con la diferencia frente a visibilityClause: el atleta se VE a sí mismo, pero
 * no se puede editar ni borrar solo. Por eso son dos comprobaciones distintas y no
 * se reutiliza una para lo otro.
 *
 * @throws {Error} 404 si no existe, 403 si está fuera de su ámbito.
 */
async function assertCanManageAthlete(user, athleteId) {
  const result = await pool.query(
    `SELECT a.*, c.admin_id
       FROM athletes a
       LEFT JOIN coaches c ON c.id = a.coach_id
      WHERE a.id = $1`,
    [athleteId]
  );
  if (!result.rows.length) throw Object.assign(new Error("Atleta no encontrado."), { status: 404 });

  const athlete = result.rows[0];

  if (user.role === "superadmin") return athlete;
  if (user.role === "coach" && athlete.coach_id === user.coach_id) return athlete;
  if (user.role === "admin" && athlete.admin_id === user.id) return athlete;

  throw Object.assign(new Error("Ese atleta no está a tu cargo."), { status: 403 });
}

/**
 * GET /api/athletes
 * Lista los atletas del ámbito de quien pregunta.
 *
 * Incluye routine_count y completed_count, calculados en la BD, para que la lista
 * pueda mostrar el % de cumplimiento de cada atleta sin tener que pedir todas las
 * rutinas aparte y cruzarlas en el navegador.
 */
router.get("/", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const result = await pool.query(
      `SELECT a.id, a.user_id, a.coach_id, a.full_name, a.document_number, a.birthdate,
              u.username, u.email, u.is_active,
              c.full_name AS coach_name,
              (SELECT COUNT(*) FROM routine_assignments ra
                WHERE ra.athlete_id = a.id AND ra.is_active = true)::int AS routine_count,
              (SELECT COUNT(*) FROM routine_assignments ra
                WHERE ra.athlete_id = a.id AND ra.is_active = true
                  AND ra.status = 'completed')::int AS completed_count
         FROM athletes a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN coaches c ON c.id = a.coach_id
         ${where}
        ORDER BY a.full_name`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/athletes/:id
 * Un atleta puntual, si está dentro del ámbito de quien pregunta.
 *
 * El filtro se aplica también aquí: sin él bastaba con probar ids (/1, /2, /3...)
 * para leer la ficha —documento y fecha de nacimiento incluidos— de cualquier
 * atleta del sistema.
 */
router.get("/:id", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const idParam = `$${params.length + 1}`;
    const scoped = where
      ? `${where.replace(/^WHERE /, "WHERE (")}) AND a.id = ${idParam}`
      : `WHERE a.id = ${idParam}`;

    const result = await pool.query(
      `SELECT a.id, a.user_id, a.coach_id, a.full_name, a.document_number, a.birthdate,
              u.username, u.email, u.is_active,
              c.full_name AS coach_name
         FROM athletes a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN coaches c ON c.id = a.coach_id
         ${scoped}`,
      [...params, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Atleta no encontrado." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/athletes
 * Crea el usuario (role 'athlete') y su perfil.
 *
 * A qué coach queda asignado:
 *   · coach      -> a sí mismo, siempre. No puede darle un atleta a otro coach.
 *   · admin/superadmin -> al coach que indiquen en coach_id.
 * Por eso el coach_id del cuerpo se ignora cuando quien crea es un coach: si se
 * respetara, un coach podría inyectar atletas en la lista de otro.
 */
router.post("/", async (req, res) => {
  if (req.user.role === "athlete") {
    return res.status(403).json({ error: "Un atleta no puede crear otros atletas." });
  }

  const { username, password, email, full_name, document_number, birthdate, coach_id } = req.body;
  if (!username || !password || !full_name || !document_number || !birthdate) {
    return res.status(400).json({
      error: "username, password, full_name, document_number y birthdate son obligatorios.",
    });
  }

  const assignedCoachId = req.user.role === "coach" ? req.user.coach_id : coach_id || null;

  const client = await pool.connect();
  try {
    // Un admin solo puede colgar el atleta de un coach SUYO.
    if (req.user.role === "admin" && assignedCoachId) {
      const owns = await client.query(
        `SELECT 1 FROM coaches WHERE id = $1 AND admin_id = $2`,
        [assignedCoachId, req.user.id]
      );
      if (!owns.rows.length) {
        return res.status(403).json({ error: "Ese coach no está a tu cargo." });
      }
    }

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
      [userId, assignedCoachId, full_name, document_number, birthdate]
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

/**
 * PUT /api/athletes/:id
 * Actualiza el perfil del atleta (y el correo/estado de su usuario).
 * Solo quien lo tiene a cargo; el propio atleta no se edita a sí mismo.
 */
router.put("/:id", async (req, res) => {
  const { full_name, document_number, birthdate, coach_id, email, is_active } = req.body;

  const client = await pool.connect();
  try {
    const athlete = await assertCanManageAthlete(req.user, req.params.id);

    // Un coach no puede pasarle su atleta a otro coach: su coach_id se queda fijo.
    const newCoachId = req.user.role === "coach" ? athlete.coach_id : coach_id || null;

    await client.query("BEGIN");

    await client.query(
      `UPDATE athletes
          SET full_name = $1, document_number = $2, birthdate = $3, coach_id = $4
        WHERE id = $5`,
      [full_name, document_number, birthdate, newCoachId, req.params.id]
    );

    if (email !== undefined) {
      await client.query(`UPDATE users SET email = $1 WHERE id = $2`, [email || null, athlete.user_id]);
    }
    if (is_active !== undefined) {
      await client.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [Boolean(is_active), athlete.user_id]);
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
 * DELETE /api/athletes/:id
 * Elimina el usuario del atleta; su perfil y sus datos caen por ON DELETE CASCADE.
 */
router.delete("/:id", async (req, res) => {
  try {
    const athlete = await assertCanManageAthlete(req.user, req.params.id);

    await pool.query(`DELETE FROM users WHERE id = $1`, [athlete.user_id]);
    res.json({ deleted: Number(req.params.id) });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el atleta tiene rutinas o sesiones asociadas." });
    }
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
