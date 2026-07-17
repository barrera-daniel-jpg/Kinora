// rehash-passwords.js
// Convierte a bcrypt cualquier password_hash que aún esté en texto plano.
// Los hashes bcrypt empiezan con $2a$, $2b$ o $2y$ — todo lo demás se re-hashea.
// Uso: node rehash-passwords.js

import bcrypt from "bcryptjs";
import { pool } from "./db.js";

async function rehash() {
  try {
    // Trae solo los usuarios que NO tienen un hash bcrypt.
    const { rows } = await pool.query(
      `SELECT id, username, password_hash
         FROM users
        WHERE password_hash NOT LIKE '$2a$%'
          AND password_hash NOT LIKE '$2b$%'
          AND password_hash NOT LIKE '$2y$%'`
    );

    if (!rows.length) {
      console.log(">> Todos los passwords ya están hasheados con bcrypt. Nada que hacer.");
      return;
    }

    console.log(`Usuarios a migrar: ${rows.length}`);

    for (const user of rows) {
      // El "password_hash" actual contiene el password en texto plano.
      const newHash = await bcrypt.hash(user.password_hash, 10);
      await pool.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newHash, user.id]
      );
      console.log(`  ✓ ${user.username}`);
    }

    console.log(">> Migración completa. Ya puedes hacer login con las contraseñas originales.");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

rehash();