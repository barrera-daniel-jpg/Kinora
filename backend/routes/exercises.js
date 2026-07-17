// CRUD del catálogo de ejercicios (tabla base_v1.exercises).
//
// Dos reglas gobiernan este archivo:
//
// 1) Lectura: cada usuario ve el catálogo base (created_by IS NULL) más lo de su
//    ámbito:
//      · coach      -> catálogo base + los que él creó
//      · admin      -> catálogo base + los suyos + los de sus coaches
//      · athlete    -> catálogo base + los de su coach (solo consulta)
//      · superadmin -> todo
//
// 2) Escritura: ver un ejercicio no da derecho a editarlo. Cada usuario solo puede
//    modificar los que creó él; el catálogo base es de solo lectura. Lo decide
//    canModify().
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, canModify } from "../middleware/auth.js";

const router = Router();

// Todas las rutas de este archivo exigen sesión iniciada.
router.use(requireAuth);

/**
 * visibilityClause(user)
 * Arma el WHERE de lectura que le corresponde al usuario según su rol (regla 1).
 *
 * Devuelve el fragmento SQL y sus parámetros por separado, para que los ids viajen
 * como parámetros ($1, $2...) y no se puedan inyectar SQL a través de ellos.
 *
 * @param {object} user Identidad verificada (req.user).
 * @returns {{ where: string, params: any[] }}
 */
function visibilityClause(user) {
  switch (user.role) {
    // Lo ve todo: sin recorte.
    case "superadmin":
      return { where: "", params: [] };

    // Catálogo base + lo que creó él.
    case "coach":
      return {
        where: "WHERE e.created_by IS NULL OR e.created_by = $1",
        params: [user.id],
      };

    // Catálogo base + lo suyo + lo de los coaches que él creó.
    // El IN busca los usuarios de esos coaches, porque created_by guarda el
    // users.id del creador y no el coaches.id.
    case "admin":
      return {
        where: `WHERE e.created_by IS NULL
                   OR e.created_by = $1
                   OR e.created_by IN (SELECT user_id FROM coaches WHERE admin_id = $1)`,
        params: [user.id],
      };

    // Solo consulta: catálogo base + lo que creó su coach, para poder leer los
    // nombres de los ejercicios de las rutinas que le asignaron.
    case "athlete":
      return {
        where: `WHERE e.created_by IS NULL
                   OR e.created_by IN (
                        SELECT c.user_id FROM coaches c
                          JOIN athletes a ON a.coach_id = c.id
                         WHERE a.id = $1)`,
        params: [user.athlete_id],
      };

    // Rol desconocido: no ve nada (cerramos por defecto).
    default:
      return { where: "WHERE false", params: [] };
  }
}

/**
 * GET /api/exercises
 * Lista los ejercicios visibles para quien pregunta (regla 1).
 *
 * Cada fila incluye `can_edit`, que le dice al frontend si este usuario puede
 * editar el ejercicio, para mostrar u ocultar los botones. Es solo ayuda visual:
 * el permiso real se vuelve a comprobar en el PUT y el DELETE.
 */
router.get("/", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const result = await pool.query(
      `SELECT e.* FROM exercises e ${where} ORDER BY e.muscle_group, e.name`,
      params
    );
    res.json(result.rows.map(row => ({ ...row, can_edit: canModify(req.user, row) })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exercises/filters
 * Devuelve los grupos musculares y equipos que EXISTEN de verdad entre los
 * ejercicios que este usuario puede ver.
 *
 * Alimenta el filtro en cascada del armador de rutinas, para no ofrecer grupos
 * musculares que darían una lista vacía. Se calcula en la BD con DISTINCT.
 */
router.get("/filters", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    const result = await pool.query(
      `SELECT DISTINCT e.muscle_group, e.equipment FROM exercises e ${where}`,
      params
    );

    // Un solo recorrido para armar las dos listas de valores únicos.
    const muscleGroups = [...new Set(result.rows.map(r => r.muscle_group))].sort();
    const equipment = [...new Set(result.rows.map(r => r.equipment))].sort();

    res.json({ muscle_groups: muscleGroups, equipment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exercises/:id
 * Un ejercicio puntual, siempre que el usuario tenga permiso para verlo.
 *
 * El filtro de visibilidad se aplica también aquí: sin él, bastaría con probar
 * ids a mano (/api/exercises/1, /2, /3...) para leer el catálogo privado de otro
 * coach. Se responde 404 y no 403 a propósito, para no confirmar que ese id existe.
 */
router.get("/:id", async (req, res) => {
  try {
    const { where, params } = visibilityClause(req.user);
    // La cláusula ya trae su propio WHERE; la encadenamos con AND o abrimos uno nuevo.
    const idParam = `$${params.length + 1}`;
    const scoped = where ? `${where.replace(/^WHERE /, "WHERE (")}) AND e.id = ${idParam}` : `WHERE e.id = ${idParam}`;

    const result = await pool.query(`SELECT e.* FROM exercises e ${scoped}`, [...params, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });

    res.json({ ...result.rows[0], can_edit: canModify(req.user, result.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/exercises
 * Crea un ejercicio. El atleta no puede: solo consulta el catálogo.
 *
 * Quién queda como dueño (created_by) NO lo decide el cliente, lo decide el
 * servidor a partir del token. Si viniera en el cuerpo de la petición, un coach
 * podría crear un ejercicio a nombre de otro.
 *   · superadmin -> created_by NULL: lo que crea el superadmin ES el catálogo base,
 *                   compartido con todos.
 *   · coach/admin -> created_by = él mismo: material privado que solo él edita.
 */
router.post("/", async (req, res) => {
  if (req.user.role === "athlete") {
    return res.status(403).json({ error: "Un atleta no puede crear ejercicios." });
  }

  const { name, muscle_group, equipment, difficulty, description, gif_url } = req.body;
  if (!name || !muscle_group || !equipment || !difficulty) {
    return res.status(400).json({ error: "name, muscle_group, equipment y difficulty son obligatorios." });
  }

  // Dueño y biblioteca, ambos derivados del token.
  const createdBy = req.user.role === "superadmin" ? null : req.user.id;
  const coachId = req.user.role === "coach" ? req.user.coach_id : null;

  try {
    const result = await pool.query(
      `INSERT INTO exercises (coach_id, created_by, name, muscle_group, equipment, difficulty, description, gif_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [coachId, createdBy, name, muscle_group, equipment, difficulty, description || null, gif_url || null]
    );
    res.status(201).json({ ...result.rows[0], can_edit: true });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya tienes un ejercicio con ese nombre." });
    if (error.code === "23514") return res.status(400).json({ error: "Dificultad inválida (usa: principiante, intermedio o avanzado)." });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/exercises/:id
 * Edita un ejercicio, solo si es del usuario (regla 2).
 *
 * Leemos la fila ANTES de escribir para preguntarle a canModify() de quién es.
 * Sin ese paso, un coach podría mandar PUT /api/exercises/1 y reescribir la
 * Sentadilla del catálogo base que usan todos los demás.
 *
 * created_by y coach_id NO se tocan en el UPDATE: el dueño de un ejercicio no
 * cambia al editarlo, y dejarlo pasar permitiría "regalar" o robar material ajeno.
 */
router.put("/:id", async (req, res) => {
  const { name, muscle_group, equipment, difficulty, description, gif_url } = req.body;

  try {
    const existing = await pool.query(`SELECT * FROM exercises WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });

    if (!canModify(req.user, existing.rows[0])) {
      return res.status(403).json({
        error: existing.rows[0].created_by == null
          ? "Este ejercicio es del catálogo base y no se puede modificar. Crea una copia propia si necesitas cambiarlo."
          : "Solo puedes modificar los ejercicios que creaste tú.",
      });
    }

    const result = await pool.query(
      `UPDATE exercises
         SET name = $1, muscle_group = $2, equipment = $3,
             difficulty = $4, description = $5, gif_url = $6
       WHERE id = $7
       RETURNING *`,
      [name, muscle_group, equipment, difficulty, description || null, gif_url || null, req.params.id]
    );
    res.json({ ...result.rows[0], can_edit: true });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya tienes un ejercicio con ese nombre." });
    if (error.code === "23514") return res.status(400).json({ error: "Dificultad inválida (usa: principiante, intermedio o avanzado)." });
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/exercises/:id
 * Elimina un ejercicio, solo si es del usuario (misma comprobación que el PUT).
 */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await pool.query(`SELECT * FROM exercises WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Ejercicio no encontrado." });

    if (!canModify(req.user, existing.rows[0])) {
      return res.status(403).json({
        error: existing.rows[0].created_by == null
          ? "Este ejercicio es del catálogo base y no se puede eliminar."
          : "Solo puedes eliminar los ejercicios que creaste tú.",
      });
    }

    await pool.query(`DELETE FROM exercises WHERE id = $1`, [req.params.id]);
    res.json({ deleted: Number(req.params.id) });
  } catch (error) {
    // 23503 = clave foránea: el ejercicio está usado en una rutina o sesión.
    // La FK es ON DELETE RESTRICT justamente para no vaciar rutinas ya asignadas.
    if (error.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el ejercicio está asignado a una rutina o sesión." });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
