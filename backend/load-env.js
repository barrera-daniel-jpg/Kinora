// Carga las variables de entorno desde backend/.env.

// Calcula la ruta del .env a partir de la ubicación de este archivo
// (import.meta.url), para que funcione sin importar desde dónde se ejecute:
// `npm run api` desde la raíz, `node server.js` desde backend/ o un script suelto.
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(backendDir, ".env") });
