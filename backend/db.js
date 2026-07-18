// Conexión a PostgreSQL.
// El proyecto corre SOLO en local: se conecta al contenedor Docker "kinora_local"
// con host/puerto/usuario/clave sueltos del .env y sin SSL. No hay rama de nube
// (el equipo acordó no desplegar; ver DOCUMENTACION.md §13).
// load-env.js va primero: deja listas las variables del .env (y encuentra el
// archivo aunque el script se lance desde la raíz del proyecto).
import "./load-env.js";
import pg from "pg";

// Esquema donde viven las tablas (base_v1), no el "public" por defecto.
const DB_SCHEMA = process.env.DB_SCHEMA || "base_v1";

// Fijamos el search_path al abrir la conexión, para escribir "users"
// en vez de "base_v1.users" en todas las consultas.
const searchPathOption = `-c search_path=${DB_SCHEMA},public`;

// Pool de conexiones al Postgres local (contenedor Docker "kinora_local").
// Un Pool reutiliza conexiones entre peticiones en vez de abrir una por consulta.
export const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5433),
  database: process.env.DB_NAME || "kinora",
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  options: searchPathOption,
});

// Comprueba al arranque que la conexión funciona y avisa si falla.
export async function testConnection() {
  const result = await pool.query("SELECT current_database() AS db, current_schema() AS schema");
  return result.rows[0];
}