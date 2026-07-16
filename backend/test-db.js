// test-db.js — verifica que el backend puede hablar con Postgres.
import { pool } from './db.js';

try {
  const { rows } = await pool.query(
    "SELECT current_database() AS base, current_user AS usuario, current_schema() AS esquema"
  );
  console.log('✅ Conectado:', rows[0]);

  const { rows: users } = await pool.query('SELECT COUNT(*) FROM users');
  console.log(`Usuarios en la BD: ${users[0].count}`);
} catch (err) {
  console.error('❌ Error:', err.message);
} finally {
  await pool.end();
}