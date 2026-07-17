// Crea (o reactiva) el usuario SUPERADMIN sin tocar el resto de datos.
// El superadmin es el "jefe" por encima del admin: gestiona admins y hereda
// todos los poderes de un admin, pero además ve TODO el sistema (sin aislamiento).
//
// Uso:
//   node create-superadmin.js <username> <password> [email]
//   # o tomando las credenciales del .env (SUPERADMIN_USERNAME / _PASSWORD / _EMAIL):
//   node create-superadmin.js
//
// Es idempotente: si el username ya existe, solo se asegura de que sea superadmin
// y esté activo (no cambia la contraseña salvo que se pase una nueva).
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

async function main() {
  const username = process.argv[2] || process.env.SUPERADMIN_USERNAME;
  const password = process.argv[3] || process.env.SUPERADMIN_PASSWORD;
  const email = process.argv[4] || process.env.SUPERADMIN_EMAIL || null;

  if (!username || !password) {
    console.error("❌ Falta usuario o contraseña.");
    console.error("   Uso: node create-superadmin.js <username> <password> [email]");
    console.error("   (o define SUPERADMIN_USERNAME y SUPERADMIN_PASSWORD en backend/.env)");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT id FROM users WHERE username = $1`, [username]);

    if (existing.rows.length) {
      // Ya existe: lo promovemos a superadmin activo y (si se pasó) le fijamos la contraseña.
      const password_hash = await bcrypt.hash(password, 10);
      await client.query(
        `UPDATE users SET role = 'superadmin', is_active = true, password_hash = $2 WHERE id = $1`,
        [existing.rows[0].id, password_hash]
      );
      console.log(`>> Usuario "${username}" actualizado a superadmin (activo).`);
    } else {
      // No existe: lo creamos. Si el email choca con otro usuario, lo dejamos en NULL.
      const emailTaken = email
        ? (await client.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rows.length > 0
        : false;
      const password_hash = await bcrypt.hash(password, 10);
      const inserted = await client.query(
        `INSERT INTO users (username, password_hash, role, email)
          VALUES ($1, $2, 'superadmin', $3) RETURNING id`,
        [username, password_hash, emailTaken ? null : email]
      );
      console.log(`>> Superadmin creado (id ${inserted.rows[0].id}) -> usuario: ${username}`);
      if (emailTaken) console.log(`   ⚠️ El correo "${email}" ya estaba en uso: se guardó con email NULL.`);
    }
  } catch (error) {
    console.error("❌ No se pudo crear el superadmin:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
