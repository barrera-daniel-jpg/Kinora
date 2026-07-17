// Punto de entrada del backend: levanta el servidor Express,
// habilita CORS y monta las rutas de la API.

// Carga las variables del .env. Va como primer import para dejarlas listas
// antes de que el resto de módulos las lean.
import "./load-env.js";

import express from "express";
import cors from "cors";

import { testConnection } from "./db.js";
import authRoutes from "./routes/auth.js";
import exerciseRoutes from "./routes/exercises.js";
import coachRoutes from "./routes/coaches.js";
import athleteRoutes from "./routes/athletes.js";
import routineRoutes from "./routes/routines.js";
import adminRoutes from "./routes/admins.js";

const app = express();

// Define qué páginas web pueden llamar a esta API desde el navegador.
// CORS_ORIGIN se lee del .env y admite varios orígenes separados por comas.
// Si no está definido, se permite cualquier origen (cómodo en local).
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean)
  : null;

app.use(cors(corsOrigins ? { origin: corsOrigins } : undefined));
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
    console.log(`>> API de Kinora escuchando en http://localhost:${PORT}`);
    console.log(`>> Conectado a la base de datos "${info.db}" (esquema ${info.schema})`);
  } catch (error) {
    console.error(">> No se pudo conectar a PostgreSQL:", error.message);
    console.error(">> Revisa que el contenedor Docker esté corriendo y el .env sea correcto.");
  }
});
