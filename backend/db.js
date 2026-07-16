// Conexión a PostgreSQL.
// En local usa el contenedor Docker "kinora_local" (host/puerto/usuario/clave sueltos, sin SSL).
// En producción (Render) usa DATABASE_URL con SSL.
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

// Esquema donde viven las tablas (base_v1), no el "public" por defecto.
const DB_SCHEMA = process.env.DB_SCHEMA || "base_v1";

// Fijamos el search_path al abrir la conexión, para escribir "users"
// en vez de "base_v1.users" en todas las consultas.
const searchPathOption = `-c search_path=${DB_SCHEMA},public`;

const isProduction = process.env.NODE_ENV === "production";

export const pool = isProduction
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      options: searchPathOption,
    })
  : new pg.Pool({
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