// Punto de entrada del backend: levanta el servidor Express,
// habilita CORS (para que el frontend de Vite pueda llamarlo) y monta las rutas.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { testConnection } from "./db.js";
import authRoutes from "./routes/auth.js";
import exerciseRoutes from "./routes/exercises.js";
import coachRoutes from "./routes/coaches.js";
import athleteRoutes from "./routes/athletes.js";
import routineRoutes from "./routes/routines.js";
import adminRoutes from "./routes/admins.js";

dotenv.config();

const app = express();

// CORS: permite que el frontend de Vite (http://localhost:5173) llame a esta API.
// CORS_ORIGIN se define en el .env; si falta, se deja pasar cualquier origen local.
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : undefined));
app.use(express.json());    // Parsea el cuerpo JSON de las peticiones.

// Chequeo rápido de salud del servidor.
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Rutas de la API.
app.use("/api/auth", authRoutes);
app.use("/api/exercises", exerciseRoutes);
app.use("/api/coaches", coachRoutes);
app.use("/api/athletes", athleteRoutes);
app.use("/api/routines", routineRoutes);
app.use("/api/admins", adminRoutes);

const PORT = Number(process.env.API_PORT || 3001);

app.listen(PORT, async () => {
  try {
    const info = await testConnection();
    console.log(`✅ API de Kinora escuchando en http://localhost:${PORT}`);
    console.log(`✅ Conectado a la base de datos "${info.db}" (esquema ${info.schema})`);
  } catch (error) {
    console.error("❌ No se pudo conectar a PostgreSQL:", error.message);
    console.error("   Revisa que el contenedor Docker esté corriendo y el .env sea correcto.");
  }
});
