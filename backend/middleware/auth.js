// Autenticación y permisos de la API.
//
// Al iniciar sesión, el servidor firma un token (JWT) con la identidad del usuario
// y se lo entrega. El navegador lo devuelve en cada petición y aquí se verifica la
// firma. La identidad siempre se lee del token (req.user), nunca de la URL ni del
// cuerpo de la petición.
import jwt from "jsonwebtoken";

// Secreto con el que se firman los tokens. Debe definirse en el .env; si falta,
// el servidor aborta al arrancar en vez de usar un valor inseguro por defecto.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "Falta JWT_SECRET en el .env. Genera uno con:\n" +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
}

// Cuánto dura la sesión antes de tener que volver a iniciar sesión.
const TOKEN_EXPIRATION = "8h";

/**
 * signToken(user)
 * Crea el token que se le entrega al usuario al iniciar sesión.
 *
 * Dentro va solo lo necesario para decidir permisos: quién es (id, username),
 * qué puede hacer (role) y a qué perfil corresponde (coach_id / athlete_id).
 * Nunca se incluye la contraseña ni su hash, porque el JWT va firmado pero no
 * cifrado y cualquiera que lo tenga puede leer su contenido.
 *
 * @param {object} user Fila de users, ya con coach_id/athlete_id resueltos.
 * @returns {string} El token firmado.
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      coach_id: user.coach_id || null,
      athlete_id: user.athlete_id || null,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRATION }
  );
}

/**
 * requireAuth
 * Middleware que exige un token válido. Se pone antes de las rutas protegidas;
 * si el token falta, está vencido o fue alterado, corta con 401.
 *
 * Si todo va bien, deja la identidad verificada en req.user para que las rutas
 * la usen.
 */
export function requireAuth(req, res, next) {
  // Formato estándar: "Authorization: Bearer <token>".
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Falta el token de sesión. Inicia sesión de nuevo." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    // Distinguimos el token caducado para avisar al usuario de que su sesión
    // expiró, en vez de tratarlo como un token inválido.
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
    }
    return res.status(401).json({ error: "Token de sesión inválido." });
  }
}

/**
 * requireRole(...roles)
 * Middleware que restringe una ruta a ciertos roles. Se usa DESPUÉS de requireAuth,
 * porque necesita req.user ya resuelto.
 *
 * Ejemplo: solo el superadmin puede crear admins.
 *   router.post("/", requireAuth, requireRole("superadmin"), handler)
 *
 * @param {...string} roles Roles que sí pueden entrar.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "No tienes permiso para hacer esto." });
    }
    next();
  };
}

/**
 * canModify(user, row)
 * La regla ÚNICA de permiso de escritura sobre ejercicios y rutinas.
 * Contesta: "¿este usuario puede editar/borrar esta fila?".
 *
 *   - El superadmin puede con todo, incluido el catálogo base.
 *   - created_by NULL -> es del catálogo base: nadie más lo toca (solo se usa y se ve).
 *   - En cualquier otro caso, solo su creador.
 *
 * Está centralizada en una sola función para que todas las rutas apliquen la
 * misma regla de escritura.
 *
 * @param {object} user Identidad verificada (req.user).
 * @param {object} row  Fila con la columna created_by.
 * @returns {boolean}
 */
export function canModify(user, row) {
  if (user.role === "superadmin") return true;
  if (row.created_by == null) return false; // catálogo base: intocable.
  return row.created_by === user.id;
}

/**
 * scopeFilter(user)
 * Devuelve el recorte de datos que le toca ver a cada usuario según su rol,
 * calculado a partir del token:
 *   - superadmin -> {} (sin recorte: lo ve todo)
 *   - admin      -> { adminId }   lo suyo y lo de los coaches que creó
 *   - coach      -> { coachId }   solo lo suyo
 *   - athlete    -> { athleteId } solo lo que le asignaron
 *
 * @param {object} user Identidad verificada (req.user).
 */
export function scopeFilter(user) {
  switch (user.role) {
    case "superadmin": return {};
    case "admin":      return { adminId: user.id };
    case "coach":      return { coachId: user.coach_id };
    case "athlete":    return { athleteId: user.athlete_id };
    default:           return { adminId: -1 }; // Rol desconocido: no ve nada.
  }
}
