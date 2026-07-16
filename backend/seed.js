// Datos iniciales para poder usar la app: como las tablas están vacías,
// creamos un coach (para iniciar sesión), un atleta de prueba y ejercicios base.
// Es idempotente: si ya existen (por username), no los duplica.
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

async function ensureUser(client, { username, password, role, email }) {
  const existing = await client.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length) return existing.rows[0].id;

  // El email tiene índice UNIQUE. Si ese correo ya lo usa otro usuario (por ej.
  // datos reales cargados en la BD), guardamos el usuario de prueba con email NULL
  // para no romper el seed por una colisión de correo.
  const emailTaken = email
    ? (await client.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rows.length > 0
    : false;

  const password_hash = await bcrypt.hash(password, 10);
  const inserted = await client.query(
    `INSERT INTO users (username, password_hash, role, email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, password_hash, role, emailTaken ? null : email]
  );
  return inserted.rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 0a) Superadmin: es el "jefe" por encima del admin (gestiona admins y hace todo lo
    //     que un admin). Sus credenciales se pueden fijar en el .env
    //     (SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD / SUPERADMIN_EMAIL); si no, usa el
    //     default de desarrollo "superadmin" / "123456".
    await ensureUser(client, {
      username: process.env.SUPERADMIN_USERNAME || "superadmin",
      password: process.env.SUPERADMIN_PASSWORD || "123456",
      role: "superadmin",
      email: process.env.SUPERADMIN_EMAIL || "superadmin@kinora.com",
    });

    // 0b) Admin: usuario "admin" / contraseña "123456". Gestiona coaches y atletas.
    await ensureUser(client, {
      username: "admin", password: "123456", role: "admin", email: "admin@kinora.com",
    });

    // 1) Coach de acceso: usuario "coach" / contraseña "123456".
    const coachUserId = await ensureUser(client, {
      username: "coach", password: "123456", role: "coach", email: "coach@kinora.com",
    });
    let coach = await client.query(`SELECT id FROM coaches WHERE user_id = $1`, [coachUserId]);
    if (!coach.rows.length) {
      coach = await client.query(
        `INSERT INTO coaches (user_id, full_name, phone, is_approved)
         VALUES ($1, 'Daniel Coach', '3000000000', true) RETURNING id`,
        [coachUserId]
      );
    }
    const coachId = coach.rows[0].id;

    // 2) Atleta de prueba: usuario "atleta" / contraseña "123456".
    const athleteUserId = await ensureUser(client, {
      username: "atleta", password: "123456", role: "athlete", email: "atleta@kinora.com",
    });
    const athleteExists = await client.query(`SELECT id FROM athletes WHERE user_id = $1`, [athleteUserId]);
    if (!athleteExists.rows.length) {
      await client.query(
        `INSERT INTO athletes (user_id, coach_id, full_name, document_number, birthdate)
         VALUES ($1, $2, 'Camila Atleta', '1001001001', '2000-05-15')`,
        [athleteUserId, coachId]
      );
    }

    // 3) Ejercicios base del catálogo (coach_id del coach recién creado).
    // muscle_group/equipment en minúscula: mismo convenio que el <select> del
    // formulario (ejercicios.html) para no crear duplicados tipo "Pecho" vs "pecho".
    const baseExercises = [
      ["Sentadilla",     "piernas", "barra",         "intermedio"],
      ["Press de banca", "pecho",   "barra",         "intermedio"],
      ["Peso muerto",    "espalda", "barra",         "avanzado"],
      ["Dominadas",      "espalda", "peso corporal", "intermedio"],
      ["Plancha",        "core",    "peso corporal", "principiante"],
    ];
    for (const [name, muscle_group, equipment, difficulty] of baseExercises) {
      await client.query(
        `INSERT INTO exercises (coach_id, name, muscle_group, equipment, difficulty)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [coachId, name, muscle_group, equipment, difficulty]
      );
    }

    await client.query("COMMIT");
    console.log("✅ Datos iniciales cargados.");
    console.log(`   Superadmin -> usuario: ${process.env.SUPERADMIN_USERNAME || "superadmin"}  contraseña: ${process.env.SUPERADMIN_PASSWORD || "123456"}`);
    console.log("   Admin  -> usuario: admin   contraseña: 123456");
    console.log("   Coach  -> usuario: coach   contraseña: 123456");
    console.log("   Atleta -> usuario: atleta  contraseña: 123456");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error al cargar datos iniciales:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
