# Documentación técnica — Kinora

> Guía completa para entender, levantar y mantener el proyecto. Pensada para
> programadores que se incorporan al equipo. Cubre: tecnologías (y **por qué** cada
> una), qué hace **cada módulo y cada función**, el modelo de datos, un **glosario**,
> y **qué alternativas existían** en cada decisión de diseño.
>
> **Regla del proyecto**: Kinora corre **solo en local**. El equipo acordó **no**
> subirlo a la nube, así que el código y esta documentación están deliberadamente
> simplificados para desarrollo local (sin rutas de despliegue, SSL ni JWT productivo).
>
> Última actualización: 2026-07-15

---

## Índice

1. [Visión general de la arquitectura](#1-visión-general-de-la-arquitectura)
2. [Tecnologías usadas y por qué](#2-tecnologías-usadas-y-por-qué)
3. [Cómo levantar el proyecto](#3-cómo-levantar-el-proyecto)
4. [Estructura de carpetas](#4-estructura-de-carpetas)
5. [Módulos del FRONTEND (qué hace cada uno y por qué)](#5-módulos-del-frontend)
6. [Módulos del BACKEND (qué hace cada uno y por qué)](#6-módulos-del-backend)
7. [Catálogo de funciones](#7-catálogo-de-funciones)
8. [Modelo de datos](#8-modelo-de-datos)
9. [Endpoints de la API](#9-endpoints-de-la-api)
10. [Roles, permisos y aislamiento multi-tenant](#10-roles-permisos-y-aislamiento-multi-tenant)
11. [Cómo fluye una petición (ejemplo: login)](#11-cómo-fluye-una-petición-ejemplo-login)
12. [Decisiones de diseño y alternativas](#12-decisiones-de-diseño-y-alternativas)
13. [Limpieza realizada](#13-limpieza-realizada)
14. [Limitaciones conocidas y pendientes (TODO)](#14-limitaciones-conocidas-y-pendientes-todo)
15. [Glosario](#15-glosario)
16. [Preguntas frecuentes](#16-preguntas-frecuentes)

---

## 1. Visión general de la arquitectura

Kinora es una app de gestión de rutinas de entrenamiento. Tiene **tres piezas** que
corren por separado en la máquina local:

```
┌────────────────────┐      HTTP/JSON       ┌──────────────────────┐      SQL       ┌─────────────────────┐
│  FRONTEND (Vite)   │ ───────────────────▶ │  BACKEND (Express)   │ ─────────────▶ │ PostgreSQL (Docker) │
│  Vanilla JS + SPA  │ ◀─────────────────── │  API REST  /api/...  │ ◀───────────── │  esquema base_v1    │
│  localhost:5173    │                      │  localhost:3001      │                │  "kinora_local":5433│
└────────────────────┘                      └──────────────────────┘                └─────────────────────┘
        src/                                        backend/
```

- **Frontend** (`src/`): SPA (aplicación de página única) en **JavaScript puro**, sin
  framework. Un router propio (`src/router/index.js`) intercambia vistas sin recargar
  la página. Se sirve con **Vite** en desarrollo.
- **Backend** (`backend/`): API REST con **Express** (ESM). Habla con PostgreSQL por
  medio del driver `pg`. Hashea contraseñas con `bcryptjs`.
- **Base de datos**: **PostgreSQL** dentro de un contenedor **Docker** llamado
  `kinora_local`. Todas las tablas viven en el esquema **`base_v1`** (NO en `public`).

**Regla mental de la separación de responsabilidades:**

| Capa | Responsabilidad | NO hace |
|------|-----------------|---------|
| Frontend | Pintar vistas, capturar eventos, decidir qué botones mostrar por rol | No valida seguridad real; no toca la BD directamente |
| Backend | Validar entrada, ejecutar SQL, traducir errores, transacciones | No renderiza HTML; no guarda estado de sesión |
| Base de datos | Persistir datos, integridad referencial (FK, CHECK, UNIQUE) | No tiene lógica de negocio compleja |

---

## 2. Tecnologías usadas y por qué

| Tecnología | Para qué se usa | Por qué esta y no otra |
|-----------|-----------------|------------------------|
| **JavaScript (ES Modules)** | Toda la lógica, front y back | Un solo lenguaje en las dos capas: menos fricción para el equipo. ESM (`import/export`) es el estándar moderno, funciona nativo en el navegador y en Node ≥14. |
| **Vite** `^8` | Servidor de desarrollo + bundler del frontend | Arranque instantáneo, recarga en caliente (HMR) y build de producción con cero configuración. Alternativas: Webpack (más pesado y con más config), Parcel (menos control). |
| **Vanilla JS (sin framework)** | SPA, router y renderizado | El proyecto es de aprendizaje: sin React/Vue se entiende **cómo funciona** un router y el ciclo de render por dentro. Alternativa: React/Vue darían reactividad y componentes, pero esconden el mecanismo que aquí se quiere mostrar. |
| **Express** `^4` | API REST del backend | El framework HTTP más difundido de Node: mínimo, con middlewares (`cors`, `express.json`) y enrutado por archivo. Alternativas: Fastify (más rápido), NestJS (más estructura, más curva). |
| **PostgreSQL** | Base de datos relacional | Los datos son fuertemente relacionales (usuarios → coaches → atletas → rutinas → ejercicios). Un motor SQL con FK/CHECK/UNIQUE garantiza integridad. Alternativas: MySQL (equivalente), MongoDB (mala elección: relaciones N:N a mano). |
| **Docker** | Contenerizar PostgreSQL | Levantar la BD igual en cualquier máquina sin instalar Postgres a mano. Alternativa: Postgres instalado en el sistema (más frágil entre equipos). |
| **`pg`** (node-postgres) | Driver que conecta el backend con Postgres | Es el driver estándar; usamos un **Pool** de conexiones y **consultas parametrizadas** (`$1, $2`) que evitan inyección SQL. Alternativa: un ORM (Prisma, Sequelize) — más comodidad pero más magia y peso; aquí queremos ver el SQL. |
| **`bcryptjs`** | Hashear y verificar contraseñas | Nunca se guardan contraseñas en texto plano. `bcrypt` incorpora *salt* y coste configurable. Elegimos la variante `bcryptjs` (JS puro) para no compilar binarios nativos. Alternativa: `bcrypt` nativo (más rápido, requiere toolchain de compilación). |
| **`dotenv`** | Cargar credenciales desde `backend/.env` | Mantiene usuario/clave/puerto **fuera del código** y fuera de git. Alternativa: variables de entorno del sistema (menos cómodo en dev). |
| **`cors`** | Permitir que el frontend (`:5173`) llame a la API (`:3001`) | Sin CORS el navegador bloquea las peticiones entre distintos puertos. |
| **Fetch API** | Peticiones HTTP desde el frontend | Nativa del navegador, basada en promesas; no necesita librería (axios sería una dependencia extra innecesaria). |
| **localStorage** | Guardar la sesión del usuario en el navegador | Simple y persistente entre recargas. Alternativa real (futura): un JWT en cookie httpOnly, que hoy **no** está implementado. |

### Versiones exactas de las dependencias

Leídas de los `package.json`. Los frontales `^` indican "compatible con esa versión o
superior menor" (rango semver).

| Librería | Versión | Ubicación | Tipo |
|----------|---------|-----------|------|
| `express` | `^4.19.2` | `backend/package.json` | dependencia |
| `pg` | `^8.12.0` | `backend/package.json` | dependencia |
| `bcryptjs` | `^2.4.3` | `backend/package.json` | dependencia |
| `dotenv` | `^16.4.5` | `backend/package.json` | dependencia |
| `cors` | `^2.8.5` | `backend/package.json` | dependencia |
| `vite` | `^8.0.16` | `package.json` (raíz) | devDependency |

> El frontend **no** tiene dependencias de ejecución: usa solo APIs nativas del navegador
> (Fetch, localStorage, ES Modules). `vite` es únicamente herramienta de desarrollo/build.
> **No hay ninguna librería de JWT** (`jsonwebtoken` u otra): la autenticación por token
> no está implementada (ver [§14](#14-limitaciones-conocidas-y-pendientes-todo)).

> **Nota sobre "solo local"**: el driver `pg` y `cors` soportarían despliegue en la nube
> (SSL, orígenes remotos), pero como el equipo decidió no desplegar, esas ramas se
> quitaron para dejar el código más corto y claro (ver [§13](#13-limpieza-realizada)).

---

## 3. Cómo levantar el proyecto

Necesitas **tres cosas corriendo a la vez**: la base de datos, el backend y el frontend.

### 3.1. Base de datos (Docker)

El contenedor debe estar arriba:

```bash
docker ps | grep kinora_local
# Debe mostrar: kinora_local ... 0.0.0.0:5433->5432/tcp
```

Si no está corriendo: `docker start kinora_local`.

### 3.2. Backend (Express + PostgreSQL)

```bash
cd backend
npm install          # solo la primera vez
npm run seed         # (opcional) carga usuarios y ejercicios de prueba — ver §10
npm start            # levanta la API en http://localhost:3001
#   o: npm run dev   # igual, pero se reinicia al guardar (node --watch)
```

Al arrancar, la consola debe mostrar:

```
>> API de Kinora escuchando en http://localhost:3001
>> Conectado a la base de datos "kinora" (esquema base_v1)
```

Para probar solo la conexión a la BD sin levantar el servidor: `node test-db.js`.

### 3.3. Frontend (Vite)

Desde la **raíz** del proyecto (no dentro de `backend/`):

```bash
npm install          # solo la primera vez
npm run dev          # levanta Vite, normalmente en http://localhost:5173
```

Abre la URL que imprime Vite e inicia sesión (credenciales en [§10](#credenciales-de-prueba-tras-npm-run-seed)).

### Scripts disponibles

| Ubicación | Script | Qué hace |
|-----------|--------|----------|
| raíz | `npm run dev` | Servidor de desarrollo de Vite (frontend). |
| raíz | `npm run build` | Build de producción del frontend en `dist/`. |
| raíz | `npm run preview` | Sirve localmente la build de `dist/`. |
| `backend/` | `npm start` | Levanta la API (`node server.js`). |
| `backend/` | `npm run dev` | Igual con recarga automática (`node --watch`). |
| `backend/` | `npm run seed` | Carga datos de prueba en la BD. |

---

## 4. Estructura de carpetas

```
Kinora-Project/
├── backend/                     # API REST (Express)
│   ├── server.js                # Punto de entrada: CORS, JSON y montaje de rutas
│   ├── db.js                    # Pool de conexión a PostgreSQL (lee .env)
│   ├── .env                     # Credenciales y config (NO se sube a git)
│   ├── seed.js                  # Carga datos de prueba (superadmin/admin/coach/atleta + ejercicios)
│   ├── create-superadmin.js     # Crea/promueve SOLO el superadmin
│   ├── rehash.js                # Utilidad: pasa a bcrypt hashes que estén en texto plano
│   ├── test-db.js               # Utilidad: prueba la conexión a la BD
│   ├── migrations/              # Cambios de esquema versionados (.sql idempotentes)
│   └── routes/                  # Un archivo por recurso de la API
│       ├── auth.js              #   POST /login y /register
│       ├── exercises.js         #   CRUD de ejercicios
│       ├── coaches.js           #   CRUD de coaches (usuario + perfil; dueño = admin_id)
│       ├── athletes.js          #   CRUD de atletas (usuario + perfil)
│       ├── admins.js            #   CRUD de admins (solo superadmin)
│       └── routines.js          #   CRUD de rutinas + ejercicios + asignaciones
│
├── src/                         # Frontend (SPA en JS puro)
│   ├── main.js                  # Arranca el router cuando el DOM está listo
│   ├── router/index.js          # Router SPA: mapea rutas → HTML + controlador
│   ├── services/
│   │   ├── api.js               # URL base + helpers de red (apiGet/apiSend/scopeQuery)
│   │   └── auth.js              # AuthService: login/logout/sesión en localStorage
│   ├── helpers/loadHTML.js      # fetch() de un archivo .html como texto
│   ├── components/navbar/       # Barra de navegación (visible solo con sesión)
│   ├── css/styles.css           # Estilos globales (tema oscuro + acento lima)
│   ├── images/                  # Imágenes usadas por landing y login
│   └── pages/                   # Una carpeta por vista (.html + .js)
│       ├── landing/  login/  dashboard/
│       ├── projects/            # Rutinas (el archivo se llama "projects" por herencia)
│       ├── ejercicios/  atletas/  coaches/  admins/
│       └── legal/               # Términos y Condiciones / Privacidad (texto estático)
│
├── index.html                   # HTML raíz que carga src/main.js
├── vite.config.js               # Config de Vite (defaults)
├── package.json                 # Frontend (scripts dev/build/preview)
├── README.md                    # Quick-start resumido
└── DOCUMENTACION.md             # Este documento
```

---

## 5. Módulos del FRONTEND

Cada vista sigue el mismo patrón: un **`.html`** (marcado, se inyecta en `#app`) y un
**`.js`** con una función `init*()` que el router ejecuta tras inyectar el HTML. Esa
función engancha eventos y pinta datos traídos de la API.

### `index.html` (raíz)
Documento base. Contiene dos contenedores que la SPA rellena en caliente:
- `#navbar-container` → la barra de navegación.
- `#app` → el contenido de la vista actual.

Carga `src/main.js` como módulo. **Por qué así**: en una SPA el HTML "de verdad" es
mínimo; todo lo demás se inyecta con JavaScript sin recargar la página.

### `src/main.js`
Importa los estilos globales e invoca `router()` en el evento `DOMContentLoaded`. Es el
**único** punto de arranque de la app.

### `src/router/index.js` — el enrutador SPA (núcleo)
Es el corazón de la navegación. Contiene:
- **`routes`**: mapa `ruta → { html, init, private, alwaysAccessible }`. Cada entrada
  dice qué HTML cargar, qué controlador ejecutar y si exige sesión.
- **`navigateTo(path)`**: cambia la URL con `history.pushState` (sin recargar) y
  vuelve a renderizar. Es la función que llaman todos los botones para "navegar".
- **`router()`**: el ciclo central en cada navegación:
  1. **Protege rutas**: una ruta privada sin sesión redirige a `/login`; un usuario
     logueado que abre una ruta pública (que no sea `alwaysAccessible`) va al dashboard.
  2. Renderiza la **navbar** condicionalmente.
  3. Carga e inyecta el **HTML** de la vista en `#app`.
  4. Ejecuta el **controlador** `init()` de esa vista.
- Escucha `popstate` para soportar los botones **atrás/adelante** del navegador.

**Por qué un router propio**: mostrar el mecanismo (History API + render manual) sin la
"caja negra" de React Router. Alternativa: enrutado por hash (`#/ruta`) — más simple
pero URLs feas; se prefirió la History API.

### `src/helpers/loadHTML.js`
`loadHTML(path)`: descarga un `.html` como **texto** vía `fetch` y lo devuelve. Si falla,
devuelve un HTML de error en vez de lanzar, para que el router no se rompa. **Por qué
como texto y no como DOM**: el router lo inyecta con `innerHTML`, más simple que clonar
nodos.

### `src/services/api.js` — capa de red
Centraliza **toda** la comunicación con el backend, para no repetir `fetch` en cada
página:
- **`API_URL`**: constante con la base `http://localhost:3001/api`.
- **`apiGet(url)`**: GET que devuelve el JSON ya parseado (para listar/leer).
- **`apiSend(url, method, body, fallbackMessage)`**: POST/PUT/DELETE con manejo de
  errores unificado (si el backend responde ≠ 2xx, lanza un `Error` con el mensaje del
  servidor).
- **`scopeQuery(user)`**: devuelve el `?...` de **aislamiento** según el rol (coach →
  `?coach_id=`, admin → `?admin_id=`, superadmin → `''`). Es la pieza que hace que cada
  usuario "vea lo suyo" (ver [§10](#10-roles-permisos-y-aislamiento-multi-tenant)).

### `src/services/auth.js` — sesión
Objeto `AuthService` con `login`, `logout`, `getCurrentUser`, `isAuthenticated`. El login
llama al backend (username + password), y si es válido guarda el usuario devuelto en
`localStorage` bajo la clave `user_session`. Las contraseñas se verifican **en el
servidor** con bcrypt; el frontend nunca las compara.

### `src/components/navbar/`
- **`navbar.html`**: marcado de la barra (botones Dashboard, Rutinas, Ejercicios,
  Atletas, Coaches, Admins, Cerrar sesión).
- **`navbar.js`** (`renderNavbar`): muestra la barra **solo si hay sesión** y, mediante
  la matriz `NAV_ROLES`, oculta cada enlace que el rol actual no puede usar. Los
  listeners se enganchan una sola vez; la visibilidad se recalcula en cada render.

### Páginas (`src/pages/`)
| Página | Controlador | Qué hace | Quién la usa |
|--------|-------------|----------|--------------|
| `landing/` | `initLanding` | Portada pública de marketing; botones que llevan al login o al formulario de solicitud de acceso. | Cualquiera (sin sesión) |
| `login/` | `initLogin` | Formulario de acceso (usuario + contraseña). | Cualquiera |
| `dashboard/` | `initDashboard` | Tarjetas con métricas (conteos) según el rol. | Todos los roles |
| `projects/` | `initProjects` | **Gestión de rutinas**: crear/editar/eliminar, constructor de ejercicios, asignación a atletas. | Coach (crea), atleta (solo ve) |
| `ejercicios/` | `initEjercicios` | **Catálogo de ejercicios**: CRUD. | Coach (crea), otros ven |
| `atletas/` | `initAtleta` | **Gestión de atletas** + panel para asignar/quitar rutinas. | Coach / admin / superadmin |
| `coaches/` | `initCoaches` | **Gestión de coaches** (crea usuario + perfil). | Admin / superadmin |
| `admins/` | `initAdmins` | **Gestión de admins**. | Superadmin |
| `legal/` | `initLegal` | Términos y Privacidad (texto estático, elegido por `?type=`). | Cualquiera |

> **Nota histórica**: la carpeta se llama `projects/` (y los ids `project-*`) porque el
> proyecto nació como un CRUD genérico de "proyectos" y se reconvirtió a "rutinas". Se
> conservó el nombre para no romper referencias; conceptualmente **projects = rutinas**.

### Formularios de solicitud de acceso (landing)

Como el alta de usuarios la hace un coach/admin (no hay auto-registro público), la
landing no crea cuentas: sus CTA abren **Google Forms** de solicitud en una pestaña
nueva. Las URLs están centralizadas en la constante `REQUEST_FORMS` de
`pages/landing/landing.js` (un solo lugar para cambiarlas):

| Botón (landing) | `data-cta` / `id` | Acción |
|-----------------|-------------------|--------|
| "Solicitar Acceso" (nav) y CTA final | `#nav-cta`, `#final-cta-btn` | Abre el formulario **general**. |
| "Quiero ser Coach" | `data-cta="coach"` | Abre el formulario de **coach**. |
| "Quiero ser Atleta" | `data-cta="atleta"` | Abre el formulario de **atleta**. |
| "Iniciar Sesión" (nav) y "Soy Coach"/"Soy Atleta" (hero) | `#nav-login`, `#cta-coach`, `#cta-atleta` | Navegan a `/login` (no abren formulario). |

URLs actuales:
- General / Coach → `https://forms.gle/ix7tePMizVstVeFz7`
- Atleta → `https://forms.gle/eeYwqkrEcUqXQdtz7`

> El login (`pages/login/login.js`) también tiene un enlace "Solicítalo aquí"
> (`#auth-request`) que abre el formulario general.

### Orden de uso de las vistas (flujo de navegación)

Cómo encajan las vistas entre sí a lo largo de una sesión típica. Toda navegación pasa
por `router()`, que protege las rutas privadas y elige qué pintar según haya o no sesión.

```
                          (sin sesión)                         (con sesión)
  ┌──────────┐  botón login   ┌────────┐  login OK   ┌───────────────────────────┐
  │ landing  │ ─────────────▶ │ login  │ ──────────▶ │        DASHBOARD          │
  │  "/"     │                │"/login"│             │   (métricas por rol)      │
  └──────────┘                └────────┘             └────────────┬──────────────┘
       │  footer: Términos/Privacidad                             │  navbar (enlaces por rol)
       ▼                                                          ▼
  ┌──────────┐                        ┌─────────────────────────────────────────────────┐
  │  legal   │ (alwaysAccessible:     │  athlete → Rutinas (solo lectura)                │
  │ "/legal" │  se ve con o sin       │  coach   → Rutinas · Ejercicios · Atletas        │
  └──────────┘  sesión)               │  admin   → + Coaches                             │
                                      │  super   → + Admins                              │
                                      └─────────────────────────────────────────────────┘
```

**Reglas de acceso que aplica el router** (ver `router/index.js`):
- Ruta **privada** sin sesión → redirige a `/login`.
- Ruta **pública** con sesión (p. ej. `/` o `/login`) → redirige a `/dashboard`
  (para no volver al marketing/login ya autenticado).
- Excepción **`alwaysAccessible`** (`/legal`): se ve con o sin sesión y **no** redirige.

**Encadenamiento lógico de las vistas de gestión** (rol coach, caso más completo):

```
1) Ejercicios   → crear el catálogo de ejercicios (materia prima).
2) Atletas      → dar de alta a los atletas (crea usuario + perfil).
3) Rutinas      → armar una rutina eligiendo ejercicios del catálogo (paso 1)
                  y asignándola a atletas (paso 2).
4) Atletas      → (opcional) panel "Asignar rutinas" para asignar/quitar sin abrir la rutina.
5) Atleta entra → ve en Dashboard y en Rutinas SOLO lo que su coach le asignó.
```

Este orden refleja las dependencias de datos: no puedes montar una rutina útil sin
ejercicios (paso 1) ni asignarla sin atletas (paso 2). El **admin** y el **superadmin**
siguen el mismo flujo pero un nivel más arriba (primero crean coaches/admins).

---

## 6. Módulos del BACKEND

El backend es una API REST con un archivo por recurso. Todos comparten el mismo `pool`
de conexión (`db.js`) y el mismo patrón: validar entrada → ejecutar SQL parametrizado →
responder JSON o un error con código HTTP adecuado.

### `server.js` — punto de entrada
Crea la app Express, habilita `cors` y `express.json()`, expone `/api/health`, y **monta
cada router** bajo su prefijo (`/api/auth`, `/api/exercises`, …). Al hacer `listen`,
prueba la conexión a la BD y lo reporta por consola.

### `db.js` — conexión
Crea un **Pool** de `pg` con los parámetros del `.env` y fija el `search_path` a
`base_v1` para poder escribir `users` en vez de `base_v1.users` en cada consulta.
Exporta `pool` (para consultas) y `testConnection()` (chequeo de arranque). **Por qué un
Pool y no una conexión suelta**: reutiliza conexiones entre peticiones (más eficiente y
seguro ante concurrencia).

### `routes/auth.js`
- `POST /register`: crea un usuario + su perfil (coach o athlete) en una **transacción**.
- `POST /login`: busca el usuario por `username`, compara la contraseña con
  `bcrypt.compare`, y devuelve sus datos (incluyendo `coach_id`/`athlete_id` vía LEFT
  JOIN) **sin** el hash.

### `routes/exercises.js`
CRUD del catálogo de ejercicios. El GET admite `?coach_id=` y `?admin_id=` para el
aislamiento, e **incluye siempre el catálogo global** (`coach_id IS NULL`).

### `routes/coaches.js`
Listar y crear coaches (usuario `role='coach'` + perfil, en transacción). El `DELETE`
hace un **borrado en cascada manual** (atletas → rutinas → ejercicios → usuario) dentro
de una transacción, por una razón sutil de integridad explicada en el propio archivo
(ver también [§12](#12-decisiones-de-diseño-y-alternativas)).

### `routes/athletes.js`
CRUD de atletas. Crear = usuario `role='athlete'` + perfil en transacción. Editar toca
el perfil y, si viene, el correo del usuario. Borrar elimina el **usuario** y el atleta
cae por `ON DELETE CASCADE`.

### `routes/admins.js`
Un admin **no** tiene tabla de perfil: es una fila en `users` con `role='admin'`. Por eso
estas rutas trabajan directamente sobre `users`. El `DELETE` solo borra si el usuario es
realmente `role='admin'` (guarda para no borrar superadmins/coaches/atletas por esta vía).

### `routes/routines.js`
El módulo más complejo. Una rutina vive en tres tablas (`routines`,
`routine_exercises`, `routine_assignments`), por eso crear/editar usan transacciones.
- Dos **subconsultas reutilizables** (`EXERCISES_SUBQUERY`, `ASSIGNMENTS_SUBQUERY`) arman,
  con `json_agg`, el array de ejercicios y de atletas de cada rutina en una sola query.
- `insertChildren()` inserta ejercicios (con su `order_index`) y asignaciones; se reutiliza
  en crear y editar.
- Editar = actualizar la cabecera + **borrar y reinsertar** los hijos.
- Endpoints extra `/:id/assignments` para asignar/quitar una rutina a un atleta sin abrir
  el formulario completo.
- `mapError`/`describeError` traducen códigos de Postgres a HTTP legibles.

### Utilidades del backend (scripts sueltos, se corren a mano)
| Archivo | Para qué | Cuándo usarlo |
|---------|----------|---------------|
| `seed.js` | Cargar datos de prueba (superadmin/admin/coach/atleta + 5 ejercicios). Idempotente. | Primera vez, o para tener con qué entrar. |
| `create-superadmin.js` | Crear/promover **solo** el superadmin sin correr todo el seed. | BD con datos reales donde no quieres tocar nada más. |
| `rehash.js` | Convertir a bcrypt contraseñas guardadas en texto plano. | Migrar datos viejos con claves en claro. |
| `test-db.js` | Verificar la conexión y contar usuarios. | Diagnóstico rápido de la BD. |
| `migrations/*.sql` | Cambios de esquema versionados e idempotentes. | Aplicar con `docker exec -i kinora_local psql ... < archivo.sql`. |

---

## 7. Catálogo de funciones

Referencia rápida de **cada función** relevante, agrupada por archivo.

### Frontend

| Función | Archivo | Qué hace |
|---------|---------|----------|
| `router()` | `router/index.js` | Ciclo de navegación: protege rutas, pinta navbar, inyecta HTML, ejecuta el `init`. |
| `navigateTo(path)` | `router/index.js` | Cambia la URL sin recargar y vuelve a renderizar. |
| `loadHTML(path)` | `helpers/loadHTML.js` | Descarga un `.html` como texto; devuelve HTML de error si falla. |
| `apiGet(url)` | `services/api.js` | GET → JSON parseado. |
| `apiSend(url, method, body, msg)` | `services/api.js` | POST/PUT/DELETE con manejo de error unificado. |
| `scopeQuery(user)` | `services/api.js` | Devuelve el `?coach_id=`/`?admin_id=`/`''` de aislamiento por rol. |
| `AuthService.login(username, password)` | `services/auth.js` | Autentica contra el backend y guarda la sesión. |
| `AuthService.logout()` | `services/auth.js` | Borra la sesión de `localStorage`. |
| `AuthService.getCurrentUser()` | `services/auth.js` | Devuelve el usuario en sesión o `null`. |
| `AuthService.isAuthenticated()` | `services/auth.js` | `true` si hay sesión. |
| `renderNavbar()` | `components/navbar/navbar.js` | Pinta la barra y muestra/oculta enlaces por rol. |
| `initLanding()` | `pages/landing/landing.js` | Engancha los CTA de la portada (login / solicitar acceso / menú móvil / footer legal). |
| `initLogin()` | `pages/login/login.js` | Captura el submit del login y navega al dashboard si tiene éxito. |
| `initDashboard()` | `pages/dashboard/dashboard.js` | Calcula y pinta las métricas (conteos) según el rol. |
| `initProjects()` | `pages/projects/projects.js` | Inicializa la vista de rutinas y engancha eventos. |
| `populateAthleteOptions()` | `pages/projects/projects.js` | Llena el multi-select de atletas para asignar. |
| `populateExerciseOptions()` | `pages/projects/projects.js` | Llena el desplegable de ejercicios del catálogo. |
| `handleAddExercise()` | `pages/projects/projects.js` | Agrega el ejercicio elegido (series/reps/etc.) al borrador. |
| `renderExerciseList()` | `pages/projects/projects.js` | Pinta la lista de ejercicios del borrador (con botón "quitar"). |
| `renderProjects()` | `pages/projects/projects.js` | Lista las rutinas (coach: editar/eliminar; atleta: solo lectura). |
| `handleProjectSubmission(e)` | `pages/projects/projects.js` | Crea (POST) o actualiza (PUT) la rutina. |
| `prepareProjectEdition(e)` | `pages/projects/projects.js` | Precarga el formulario para editar una rutina. |
| `removeProject(e)` | `pages/projects/projects.js` | Elimina una rutina tras confirmar. |
| `initEjercicios()` | `pages/ejercicios/ejercicios.js` | Inicializa el catálogo de ejercicios. |
| `renderExercises()` | `pages/ejercicios/ejercicios.js` | Pinta las tarjetas de ejercicios. |
| `handleExerciseSubmission(e)` | `pages/ejercicios/ejercicios.js` | Crea/actualiza un ejercicio (mapea categoría → `muscle_group`). |
| `prepareExerciseEdition(e)` / `removeExercise(e)` | `pages/ejercicios/ejercicios.js` | Editar / eliminar ejercicio. |
| `initAtleta()` | `pages/atletas/atletas.js` | Inicializa la gestión de atletas y el panel de asignación. |
| `populateCoachOptions()` | `pages/atletas/atletas.js` | Llena el selector de coach (solo lo usa el admin). |
| `renderAthletes()` | `pages/atletas/atletas.js` | Pinta las tarjetas de atletas. |
| `openAssignRoutines(e)` / `renderAssignPanel()` / `toggleAssignment(e)` | `pages/atletas/atletas.js` | Panel para asignar/quitar rutinas a un atleta. |
| `handleAthleteSubmission(e)` / `prepareAthleteEdition(e)` / `removeAthlete(e)` | `pages/atletas/atletas.js` | Crear / editar / eliminar atleta. |
| `initCoaches()` / `renderCoaches()` / `handleCoachSubmission(e)` / `removeCoach(e)` | `pages/coaches/coaches.js` | CRUD de coaches (el admin etiqueta el coach con su `admin_id`). |
| `initAdmins()` / `renderAdmins()` / `handleAdminSubmission(e)` / `removeAdmin(e)` | `pages/admins/admins.js` | CRUD de admins (solo superadmin). |
| `initLegal()` | `pages/legal/legal.js` | Pinta Términos o Privacidad según `?type=`. |

### Backend

| Función / Ruta | Archivo | Qué hace |
|----------------|---------|----------|
| `testConnection()` | `db.js` | Consulta de arranque para validar la conexión. |
| `POST /auth/register` | `routes/auth.js` | Crea usuario + perfil en transacción. |
| `POST /auth/login` | `routes/auth.js` | Verifica credenciales con bcrypt; devuelve el usuario sin el hash. |
| GET/GET:id/POST/PUT/DELETE | `routes/exercises.js` | CRUD de ejercicios + filtros de aislamiento y catálogo global. |
| GET/POST/DELETE | `routes/coaches.js` | Listar/crear coaches + borrado en cascada manual. |
| GET/GET:id/POST/PUT/DELETE | `routes/athletes.js` | CRUD de atletas (crear = usuario + perfil). |
| GET/POST/DELETE | `routes/admins.js` | CRUD de admins (opera sobre `users`). |
| GET/GET:id/POST/PUT/DELETE + `/:id/assignments` | `routes/routines.js` | CRUD de rutinas + asignaciones sueltas. |
| `insertChildren(client, id, ex, ath)` | `routes/routines.js` | Inserta ejercicios y asignaciones de una rutina. |
| `mapError(e)` / `describeError(e)` | `routes/routines.js` | Traducen códigos de Postgres a HTTP + mensaje legible. |

---

## 8. Modelo de datos

Todas las tablas viven en el esquema **`base_v1`**. El frontend se **adaptó al esquema
SQL real** (no al revés).

### Tablas principales

- **`users`** — tabla de login. Columnas clave: `username` (UNIQUE), `password_hash`
  (bcrypt), `role` ∈ `superadmin` / `admin` / `coach` / `athlete` (minúscula), `email`
  (UNIQUE), `is_active`, `created_at`.
- **`coaches`** — perfil del coach. Apunta a `user_id`; guarda `full_name`, `phone`,
  `is_approved` y **`admin_id`** (el `users.id` del admin dueño; separa coaches por admin).
- **`athletes`** — perfil del atleta. Apunta a `user_id` y a `coach_id`; guarda
  `full_name`, `document_number`, `birthdate`.
- **`exercises`** — catálogo. `name`, `muscle_group`, `equipment`, `difficulty` ∈
  `principiante`/`intermedio`/`avanzado`, `description`, `gif_url`, `coach_id`
  (`NULL` = ejercicio **global**, compartido por todos).
- **`routines`** — cabecera de la rutina: `coach_id`, `name`, `description`,
  `weekly_frequency`.
- **`routine_exercises`** — ejercicios dentro de una rutina (N:1 con `routines`):
  `sets`, `reps`, `rest_seconds`, `weight_kg`, `rpe`, `notes`, `order_index`.
- **`routine_assignments`** — relación N:N rutina ↔ atleta: `routine_id`, `athlete_id`,
  `is_active` (UNIQUE(`routine_id`, `athlete_id`)).
- **`training_sessions`** / **`session_exercises`** — registro de lo **ejecutado** (vs.
  lo prescrito). Existen en el esquema pero **aún no tienen UI** (ver [§14](#14-limitaciones-conocidas-y-pendientes-todo)).

### Diagrama de relaciones (simplificado)

```
users ──1:1── coaches ──1:N── athletes
  │              │  └────────────1:N── routines ──1:N── routine_exercises ──N:1── exercises
  │              │                        └────1:N── routine_assignments ──N:1── athletes
  └── role='admin' (sin perfil)   coaches.admin_id ─▶ users.id (admin dueño)
```

### Mapeos que conviene recordar (concepto viejo → real)

| Frontend / concepto viejo | Columna real / API |
|---------------------------|--------------------|
| login por `email` | login por **`username`** |
| roles `Coach` / `atleta` | **`coach`** / **`athlete`** (minúscula) |
| `user.name` | **`user.full_name`** (con *fallback* a `username`) |
| ejercicio: `category` | **`muscle_group`** |
| atleta: `age`/`weight`/`height`/`phone` | **no existen**; se usan `document_number`, `birthdate` |
| rutina: `status` global | **no existe**; se modela asignación activa (`is_active`) |
| "projects" | **rutinas** (`routines`) |

### Reglas de integridad importantes

- `exercises.coach_id` es **`ON DELETE SET NULL`**, pero hay un índice único parcial
  `UNIQUE(name) WHERE coach_id IS NULL` (nombres únicos en el catálogo global). Esta
  combinación obliga al borrado en cascada manual de `coaches.js` (ver [§12](#12-decisiones-de-diseño-y-alternativas)).
- `athletes.user_id` es `ON DELETE CASCADE`: borrar el usuario borra el atleta.
- `routine_exercises`/`routine_assignments` caen por `ON DELETE CASCADE` al borrar la
  rutina.
- CHECK en `routine_exercises`: `weight_kg >= 0` y `0 <= rpe <= 10` (migración de prescripción).

---

## 9. Endpoints de la API

Todos cuelgan de `http://localhost:3001/api`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/health` | Chequeo de salud (`{status:"ok"}`). |
| POST | `/auth/login` | Login por `username` + `password`. |
| POST | `/auth/register` | Alta de usuario + perfil (coach o athlete). |
| GET/POST | `/exercises` | Listar / crear ejercicio. |
| GET | `/exercises?coach_id=N` | Aislamiento: ejercicios del coach N **+ catálogo global**. |
| GET | `/exercises?admin_id=N` | Aislamiento: ejercicios de los coaches del admin N **+ global**. |
| GET/PUT/DELETE | `/exercises/:id` | Ver / editar / borrar ejercicio. |
| GET/POST | `/coaches` | Listar / crear coach (usuario + perfil; `POST` acepta `admin_id`). |
| GET | `/coaches?admin_id=N` | Aislamiento: solo los coaches del admin N. |
| DELETE | `/coaches/:id` | Borrar coach y **todos sus datos** en cascada (transacción). |
| GET/POST | `/athletes` | Listar / crear atleta (usuario + perfil). |
| GET | `/athletes?coach_id=N` | Aislamiento: los atletas del coach N. |
| GET | `/athletes?admin_id=N` | Aislamiento: los atletas de los coaches del admin N. |
| GET/PUT/DELETE | `/athletes/:id` | Ver / editar / borrar atleta. |
| GET/POST | `/admins` | Listar / crear admin (solo superadmin). |
| DELETE | `/admins/:id` | Borrar admin (solo si el usuario es realmente `role='admin'`). |
| GET | `/routines` | Todas las rutinas (superadmin). |
| GET | `/routines?coach_id=N` | Aislamiento: las rutinas del coach N. |
| GET | `/routines?admin_id=N` | Aislamiento: las rutinas de los coaches del admin N. |
| GET | `/routines?athlete_id=N` | Vista de atleta: solo las asignadas a ese atleta. |
| GET/PUT/DELETE | `/routines/:id` | Ver / editar / borrar rutina. |
| POST | `/routines` | Crear rutina + ejercicios + asignaciones. |
| POST | `/routines/:id/assignments` | Asignar la rutina a un atleta (idempotente). |
| DELETE | `/routines/:id/assignments/:athleteId` | Quitar una asignación. |

**Traducción de errores de PostgreSQL a HTTP** (comentado en el código):
`23505` = duplicado → **409**; `23503` = clave foránea inexistente → **400/409**;
`23514` = valor fuera de un CHECK → **400**.

---

## 10. Roles, permisos y aislamiento multi-tenant

Hay **cuatro roles** en jerarquía (cada uno "por encima" del siguiente):

- **superadmin**: el jefe. Gestiona **admins** y hereda todo lo de un admin. Es el ÚNICO
  que ve **todo el sistema sin aislamiento**.
- **admin**: gestiona **sus** coaches y, en cascada, los atletas/rutinas/ejercicios de
  esos coaches. Crea usuarios con contraseña.
- **coach**: gestiona ejercicios, atletas (los suyos) y rutinas. Solo ve **lo suyo**.
- **athlete**: vista de solo lectura de sus rutinas asignadas.

### Matriz de visibilidad

| Recurso | Coach | Admin | Superadmin |
|---------|-------|-------|------------|
| Coaches | — | solo `admin_id = suyo` | todos |
| Atletas | solo `coach_id = suyo` | los de **sus** coaches | todos |
| Rutinas | solo `coach_id = suyo` | las de **sus** coaches | todas |
| Ejercicios | `coach_id = suyo` **+** globales | los de **sus** coaches **+** globales | todos |
| Admins | — | — | los gestiona |

### Cómo funciona técnicamente

Dos "llaves" separan los datos, en cascada **admin → coach → atleta/rutina/ejercicio**:
- **`coaches.admin_id`** → apunta al `users.id` del admin dueño.
- **`coach_id`** (en `athletes`/`routines`/`exercises`) → separa esos recursos por coach.

El backend acepta `?coach_id=N` y `?admin_id=N` en los GET; para el filtro por admin hace
`JOIN` con `coaches` y compara `coaches.admin_id`. El frontend genera ese query con
`scopeQuery(user)`:
- coach → `?coach_id=<user.coach_id>`
- admin → `?admin_id=<user.id>`
- superadmin → `''` (sin filtro)

Al **crear**, el coach nace con su `admin_id`/`coach_id` grabado, así el dato queda
aislado desde su origen.

> ⚠️ **Seguridad**: como la API aún **no usa token** (ver [§14](#14-limitaciones-conocidas-y-pendientes-todo)), `coach_id`/`admin_id`
> viajan en la URL y son **falsificables** a mano. El aislamiento hoy es a nivel de UX,
> no de seguridad real.

### Credenciales de prueba (tras `npm run seed`)

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| superadmin | `superadmin` | `123456` |
| admin | `admin` | `123456` |
| coach | `coach` | `123456` |
| athlete | `atleta` | `123456` |

> El superadmin del seed es configurable con `SUPERADMIN_USERNAME` / `_PASSWORD` /
> `_EMAIL` en `backend/.env`. Para crear/promover un superadmin sin correr todo el seed:
> `node backend/create-superadmin.js <usuario> <contraseña> [correo]`.

---

## 11. Cómo fluye una petición (ejemplo: login)

Seguir este recorrido es la mejor forma de entender la conexión completa:

1. El usuario escribe usuario/contraseña en `login.html` y envía el formulario;
   `login.js` captura el `submit`.
2. `login.js` llama a `AuthService.login(username, password)` (`services/auth.js`).
3. `AuthService` hace `fetch(POST /api/auth/login)` con el JSON.
4. `server.js` enruta `/api/auth` → `routes/auth.js`.
5. `auth.js` busca el usuario por `username`, compara la contraseña con
   `bcrypt.compare()` y, si coincide, devuelve sus datos (rol, `full_name`,
   `coach_id`/`athlete_id`) **sin** el hash.
6. `AuthService` guarda ese objeto en `localStorage` bajo `user_session`.
7. `login.js` hace `navigateTo('/dashboard')` y el router pinta el dashboard.

A partir de ahí, todas las páginas leen la sesión con `AuthService.getCurrentUser()` y
llaman a los endpoints con `apiGet`/`apiSend`, usando `scopeQuery(user)` para el
aislamiento. El `role` de la sesión decide qué botones/vistas se muestran.

---

## 12. Decisiones de diseño y alternativas

Aquí se explican las decisiones no obvias y **qué otras formas había** de resolverlas.

### 12.1. Router propio con la History API
- **Qué se hizo**: un mapa de rutas + `history.pushState` + render manual en `#app`.
- **Alternativas**: (a) enrutado por hash (`#/ruta`) — más simple pero URLs feas;
  (b) React Router / Vue Router — potente pero esconde el mecanismo. Se eligió el router
  propio por ser **educativo** y sin dependencias.

### 12.2. Transacciones al crear coach/atleta/rutina
- **Qué se hizo**: `BEGIN / COMMIT / ROLLBACK` porque cada alta toca **varias tablas**
  (usuario + perfil, o rutina + ejercicios + asignaciones).
- **Por qué**: si falla un paso intermedio, no debe quedar un usuario sin perfil ni una
  rutina a medias. La transacción garantiza "todo o nada" (atomicidad).
- **Alternativa**: insertar sin transacción y limpiar a mano si algo falla — frágil y
  propenso a datos huérfanos.

### 12.3. Editar rutina = borrar y reinsertar los hijos
- **Qué se hizo**: al hacer PUT, se **borran** `routine_exercises`/`routine_assignments`
  y se reinsertan desde el payload (`insertChildren`).
- **Por qué**: es simple y siempre deja el estado consistente, sin tener que calcular
  qué filas cambiaron.
- **Alternativa**: un *diff* (detectar altas/bajas/modificaciones) — más eficiente pero
  mucho más código y más fácil de equivocar. Para el volumen de datos actual, borrar y
  reinsertar es preferible.

### 12.4. Borrado en cascada manual del coach
- **Problema**: `exercises.coach_id` es `ON DELETE SET NULL`. Si solo se borrara el
  usuario del coach, sus ejercicios pasarían a `coach_id NULL` (catálogo global) y su
  nombre podría **chocar** con el índice único parcial `UNIQUE(name) WHERE coach_id IS
  NULL` → error `23505` y borrado revertido.
- **Qué se hizo**: en `DELETE /coaches/:id`, dentro de una transacción, se borran en
  orden atletas → rutinas → ejercicios → usuario.
- **Alternativa**: cambiar la FK a `ON DELETE CASCADE` en el esquema — más limpio, pero
  implicaba una migración de esquema; se resolvió en la capa de aplicación.

### 12.5. Prescripción (rutina) vs. ejecución (sesión)
- **Qué se hizo**: `routine_exercises` guarda lo que el coach **prescribe** (peso/RPE/
  notas objetivo); `session_exercises` guardaría lo **ejecutado**. Son cosas distintas y
  por eso viven en tablas separadas.
- **Estado**: la parte de ejecución (`training_sessions`) aún no tiene UI.

### 12.6. Contraseñas con `bcryptjs` (JS puro)
- **Por qué `bcryptjs` y no `bcrypt`**: `bcryptjs` no compila binarios nativos, así que
  se instala sin toolchain de C. `bcrypt` (nativo) es más rápido pero da problemas de
  instalación entre máquinas. Para local, `bcryptjs` es más portable.

### 12.7. Aislamiento en la query, no en un token
- **Qué se hizo**: el frontend manda `?coach_id=`/`?admin_id=`.
- **Limitación asumida**: es **falsificable** (ver [§14](#14-limitaciones-conocidas-y-pendientes-todo)). Se aceptó porque el
  proyecto es académico y corre en local; la alternativa correcta (derivar el id de un
  JWT en el servidor) queda como pendiente.

### 12.8. Sin framework en el frontend
- **Trade-off**: más código repetitivo (cada página engancha sus propios eventos y
  vuelve a pintar a mano), a cambio de **cero dependencias** y transparencia total del
  flujo. Un framework reduciría el *boilerplate* pero añadiría curva y peso.

---

## 13. Limpieza realizada

Cambios aplicados en esta revisión para quitar código muerto, arreglos y simplificar a
"solo local" (sin tocar la lógica del programa):

**Bugs / código muerto**
- `landing.html`: se arregló el botón de login de la barra (tenía `id` duplicado
  `cta-coach`, un typo "Inicar Sesion" y HTML malformado); ahora es `#nav-login`
  ("Iniciar Sesión") y está cableado en `landing.js`.
- `landing.html`: el botón decorativo del mockup tenía `id="btn btn-lg phone-btn"`
  (un `id` con espacios, inválido). Se le quitó el `id` y se marcó como decorativo
  (`aria-hidden`, `tabindex="-1"`).
- `landing.js`: se eliminó la referencia muerta a ese `id` inválido dentro de la lista
  de CTA.
- `login.js`: se quitaron los `console.log` de depuración.

**Simplificación a "solo local"** (el equipo acordó no subir a la nube)
- `db.js`: se eliminó la rama de conexión **cloud** (`DATABASE_URL` + SSL de Neon/Render).
  Queda solo la conexión local al contenedor Docker. Se corrigió el nombre por defecto
  de la BD a `kinora`.
- `services/api.js`: `API_URL` es ahora una constante fija a `localhost:3001` (se quitó
  el `import.meta.env.VITE_API_URL` de producción).
- `server.js`: se simplificó el comentario de CORS (se quitó la mención a dominios de
  la nube).
- `backend/.env`: se quitaron `JWT_SECRET` y `JWT_EXPIRES_IN` (no hay JWT implementado).

**Archivos/artefactos sin uso**
- `package.json` (raíz): se quitó la dependencia **`pg`** (el navegador no puede usarla).
- Se eliminó `public/images/atleta-hero.png` (no lo referenciaba nadie).
- Se eliminó la carpeta `dist/` (build regenerable con `npm run build`; está en
  `.gitignore`).
- `README.md`: se reescribió (estaba desactualizado: hablaba de `json-server`, `db.json`
  y roles `Coach`/`atleta` que ya no existen).

---

## 14. Limitaciones conocidas y pendientes (TODO)

- **Autenticación por token (lo más urgente)**: el login **no emite JWT**. La sesión se
  guarda tal cual en `localStorage` y los endpoints están **abiertos** (sin middleware
  que valide quién llama ni su rol). El aislamiento admin/coach es **falsificable**
  porque `coach_id`/`admin_id` vienen de la query. Solución correcta: emitir un JWT en el
  login, protegerlas con middleware por rol y **derivar** el `coach_id`/`admin_id` del
  token, no de la URL.
- **Registro de entrenamientos**: `training_sessions` / `session_exercises` existen en el
  esquema pero **no tienen UI**.
- **Editar credenciales** (usuario/contraseña) de coaches y atletas ya creados: hoy solo
  se establecen al crear.
- **Página de "perfil de atleta"** para el coach (ver un atleta + sus rutinas en detalle),
  a construir contra `/api/athletes/:id` y `/api/routines?athlete_id=`.
- **Datos previos sin dueño**: los coaches creados antes de la migración `admin_id`
  tienen `admin_id = NULL`, por lo que **solo el superadmin los ve**. Para asignarlos:
  `UPDATE base_v1.coaches SET admin_id = <user_id_del_admin> WHERE id = <coach>;`

---

## 15. Glosario

| Término | Significado en Kinora |
|---------|-----------------------|
| **SPA** (Single Page Application) | App que carga una sola página HTML y cambia de vista con JavaScript, sin recargar. |
| **Router** | Módulo que decide qué vista pintar según la URL (`src/router/index.js`). |
| **Controlador (`init*`)** | Función JS de una vista que el router ejecuta tras inyectar su HTML; engancha eventos y pinta datos. |
| **Vista / página** | Par `.html` + `.js` dentro de `src/pages/`. |
| **Endpoint** | URL de la API que responde a un método HTTP (p. ej. `POST /api/coaches`). |
| **CRUD** | Create, Read, Update, Delete (crear/leer/actualizar/borrar). |
| **Pool** | Conjunto de conexiones a Postgres reutilizables (`db.js`). |
| **Transacción** (`BEGIN/COMMIT/ROLLBACK`) | Grupo de operaciones SQL "todo o nada". |
| **Hash / bcrypt** | Cifrado unidireccional de la contraseña; no se puede revertir, solo comparar. |
| **Aislamiento multi-tenant** | Que cada usuario vea solo "lo suyo" según su rol y sus llaves (`coach_id`/`admin_id`). |
| **Prescripción** | Lo que el coach pide en la rutina (peso/RPE/notas objetivo), en `routine_exercises`. |
| **Ejecución / sesión** | Lo que el atleta realmente hizo (futuro, `session_exercises`). |
| **Catálogo global** | Ejercicios con `coach_id NULL`, visibles para todos. |
| **Migración** | Script SQL versionado que evoluciona el esquema (`backend/migrations/`). |
| **Idempotente** | Que se puede ejecutar varias veces con el mismo resultado (seed y migraciones lo son). |
| **RPE** | *Rate of Perceived Exertion*: esfuerzo percibido, escala 0–10. |
| **`muscle_group`** | Grupo muscular del ejercicio (lo que antes se llamaba "categoría"). |
| **`scopeQuery`** | Helper del frontend que arma el `?coach_id=`/`?admin_id=` de aislamiento. |
| **Seed** | Carga de datos iniciales de prueba (`seed.js`). |
| **projects = rutinas** | La carpeta `projects/` gestiona rutinas; el nombre es herencia histórica. |
| **ESM / ES Modules** | Sistema de módulos estándar de JavaScript (`import`/`export`). El proyecto lo usa en front y back (`"type": "module"`). |
| **CORS** (Cross-Origin Resource Sharing) | Mecanismo del navegador que permite que el frontend (`:5173`) llame a la API (`:3001`), en distinto puerto. Se habilita con el middleware `cors` en `server.js`. |
| **JWT** (JSON Web Token) | Token firmado para autenticar peticiones sin guardar sesión en el servidor. **No está implementado** en Kinora; figura como pendiente en [§14](#14-limitaciones-conocidas-y-pendientes-todo). |
| **HMR** (Hot Module Replacement) | Recarga en caliente de Vite: al guardar un archivo, actualiza la vista en el navegador sin recargar toda la página. |
| **FK / clave foránea** (foreign key) | Columna que referencia la clave primaria de otra tabla (p. ej. `athletes.coach_id → coaches.id`). Garantiza integridad referencial y define el comportamiento en cascada (`ON DELETE CASCADE`/`SET NULL`). |
| **Payload** | El cuerpo (JSON) que el frontend envía al backend en un POST/PUT (p. ej. el objeto rutina con sus ejercicios y atletas). |
| **localStorage** | Almacén clave-valor del navegador, persistente entre recargas. Kinora guarda ahí la sesión (`user_session`). |
| **Middleware** | Función que Express ejecuta antes de las rutas (p. ej. `cors`, `express.json()` que parsea el JSON entrante). |

---

## 16. Preguntas frecuentes

- **"El frontend carga pero no puedo entrar."** → ¿corriste `npm run seed`? ¿está el
  backend arriba en el 3001? ¿está el contenedor Docker corriendo? Mira la consola del
  navegador y la del backend.
- **"`\dt` no muestra tablas en psql."** → las tablas están en `base_v1`, no en `public`.
  Usa `\dt base_v1.*`.
- **"¿Qué base de datos es?"** → `kinora` (según `backend/.env` → `DB_NAME`), en el
  contenedor Docker `kinora_local`, puerto host `5433`.
- **"Cambié el `.env` y no toma."** → reinicia el backend; `dotenv` lee el `.env` solo al
  arrancar.
- **"¿Por qué la carpeta se llama `projects` si son rutinas?"** → herencia histórica; se
  conservó el nombre para no romper referencias. Conceptualmente son rutinas.
- **"¿Se puede desplegar en la nube?"** → el equipo decidió que **no**: el proyecto corre
  solo en local y el código se simplificó para ese escenario.
</content>
</invoke>
