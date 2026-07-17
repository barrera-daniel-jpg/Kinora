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
| `jsonwebtoken` | `^9.0.3` | `backend/package.json` | dependencia |
| `dotenv` | `^16.4.5` | `backend/package.json` | dependencia |
| `cors` | `^2.8.5` | `backend/package.json` | dependencia |
| `vite` | `^8.0.16` | `package.json` (raíz) | devDependency |

> **Son dos paquetes distintos.** Todo lo del backend vive en `backend/package.json` y se
> instala en `backend/node_modules`; la raíz solo tiene Vite. Por eso hay que ejecutar
> `npm install` **en los dos sitios** (ver [§3.3](#33-backend-express--postgresql)). Cuidado con instalar una
> dependencia del backend en la raíz: se duplica y las dos copias se desincronizan.

> El frontend **no** tiene dependencias de ejecución: usa solo APIs nativas del navegador
> (Fetch, localStorage, ES Modules). `vite` es únicamente herramienta de desarrollo/build.

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

### 3.2. Configuración (`backend/.env`)

El backend no arranca sin este archivo. **No se sube al repositorio** (está en
`.gitignore`), así que en una máquina nueva hay que crearlo:

```bash
API_PORT=3001

DB_HOST=localhost
POSTGRES_PORT=5433
DB_NAME=kinora
DB_SCHEMA=base_v1
POSTGRES_USER=Kinora
POSTGRES_PASSWORD=<la contraseña del contenedor>

# Orígenes autorizados a llamar a la API desde el navegador.
# Admite varios separados por comas: Vite cambia de puerto solo si el 5173 está ocupado.
CORS_ORIGIN=http://localhost:5173,http://localhost:5174

# Secreto con el que se firman los tokens de sesión. OBLIGATORIO.
# Genera uno propio con:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<cadena larga y aleatoria>
```

Sobre `JWT_SECRET`: si falta, el servidor **aborta al arrancar** con un mensaje que
explica cómo generarlo. Es deliberado — un secreto por defecto o vacío permitiría a
cualquiera firmar tokens falsos y hacerse pasar por superadmin, y el fallo pasaría
inadvertido. Al cambiarlo, todas las sesiones abiertas dejan de valer.

### 3.3. Backend (Express + PostgreSQL)

**Dos paquetes, dos `package.json`.** El backend tiene sus propias dependencias en
`backend/package.json` y su propio `backend/node_modules`; la raíz solo tiene Vite. Es
la razón de que haya que instalar en los dos sitios.

Desde la **raíz** del proyecto:

```bash
npm install                    # dependencias del frontend
npm install --prefix backend   # dependencias del backend
npm run api                    # levanta la API en http://localhost:3001
npm run seed                   # (opcional) usuarios y ejercicios de prueba — ver §10
```

También se puede trabajar desde dentro de `backend/`:

```bash
cd backend
npm start            # igual que "npm run api" desde la raíz
npm run dev          # igual, pero se reinicia al guardar (node --watch)
```

Al arrancar, la consola debe mostrar:

```
>> API de Kinora escuchando en http://localhost:3001
>> Conectado a la base de datos "kinora" (esquema base_v1)
```

Para probar solo la conexión a la BD sin levantar el servidor: `node backend/test-db.js`.

### 3.4. Migraciones

Cada cambio de esquema es un `.sql` en `backend/migrations/`, y **todos son
idempotentes**: se pueden correr las veces que haga falta sin romper nada, así que ante
la duda, córrelos.

```bash
docker exec -i kinora_local psql -U Kinora -d kinora < backend/migrations/<archivo>.sql
```

### 3.5. Frontend (Vite)

Desde la **raíz** del proyecto:

```bash
npm run dev          # levanta Vite, normalmente en http://localhost:5173
```

Abre la URL que imprime Vite e inicia sesión (credenciales en [§10](#credenciales)).

> Si Vite avisa de que el 5173 está ocupado y salta al 5174, comprueba que ese puerto
> esté en `CORS_ORIGIN`. Si no, la página carga pero **todas** las llamadas fallan con un
> error de CORS que no menciona el puerto por ningún lado.

### Scripts disponibles

| Ubicación | Script | Qué hace |
|-----------|--------|----------|
| raíz | `npm run dev` | Servidor de desarrollo de Vite (frontend). |
| raíz | `npm run api` | Levanta la API (`node backend/server.js`). |
| raíz | `npm run seed` | Carga datos de prueba en la BD. |
| raíz | `npm run build` | Build de producción del frontend en `dist/`. |
| raíz | `npm run preview` | Sirve localmente la build de `dist/`. |
| `backend/` | `npm start` | Levanta la API (`node server.js`). |
| `backend/` | `npm run dev` | Igual con recarga automática (`node --watch`). |
| `backend/` | `npm run seed` | Carga datos de prueba en la BD. |

---

## 4. Estructura de carpetas

```
Kinora-Project/
├── backend/                     # API REST (Express) — paquete propio (package.json aparte)
│   ├── load-env.js              # Carga el .env sin depender del directorio de ejecución
│   ├── server.js                # Punto de entrada: CORS, JSON y montaje de rutas
│   ├── db.js                    # Pool de conexión a PostgreSQL (lee .env)
│   ├── .env                     # Credenciales, CORS y JWT_SECRET (NO se sube a git)
│   ├── package.json             # Dependencias del backend (express, pg, bcryptjs, jwt…)
│   ├── seed.js                  # Carga datos de prueba (superadmin/admin/coach/atleta + ejercicios)
│   ├── create-superadmin.js     # Crea/promueve SOLO el superadmin
│   ├── rehash.js                # Utilidad: pasa a bcrypt hashes que estén en texto plano
│   ├── test-db.js               # Utilidad: prueba la conexión a la BD
│   ├── migrations/              # Cambios de esquema versionados (.sql idempotentes)
│   ├── middleware/
│   │   └── auth.js              # JWT + permisos: requireAuth, requireRole, canModify
│   └── routes/                  # Un archivo por recurso de la API
│       ├── auth.js              #   POST /login, /register, /change-password
│       ├── exercises.js         #   CRUD de ejercicios (+ /filters para la cascada)
│       ├── coaches.js           #   CRUD de coaches (usuario + perfil; dueño = admin_id)
│       ├── athletes.js          #   CRUD de atletas (usuario + perfil)
│       ├── admins.js            #   CRUD de admins (solo superadmin)
│       └── routines.js          #   CRUD de rutinas + ejercicios + asignaciones + estado
│
├── src/                         # Frontend (SPA en JS puro)
│   ├── main.js                  # Arranca el router cuando el DOM está listo
│   ├── router/index.js          # Router SPA: mapea rutas → HTML + controlador
│   ├── services/
│   │   ├── api.js               # URL base + helpers de red (apiGet/apiSend) + token
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
- **`apiGet(url)`**: GET autenticado que devuelve el JSON ya parseado (para listar/leer).
  **Lanza** si el backend responde con error; antes lo devolvía como si fueran datos y la
  página acababa recorriendo un `{error:"…"}` como si fuera un array.
- **`apiSend(url, method, body, fallbackMessage)`**: POST/PUT/PATCH/DELETE con manejo de
  errores unificado (si el backend responde ≠ 2xx, lanza un `Error` con el mensaje del
  servidor, así los avisos de permiso llegan tal cual al usuario).
- **`getToken` / `setToken` / `clearToken`**: acceso al token en `localStorage`.
- Ambos helpers añaden `Authorization: Bearer <token>` a cada petición y, ante un **401**,
  limpian la sesión y mandan al login (es lo que ocurre cuando el token caduca).

> **Ya no existe `scopeQuery(user)`.** Antes construía el `?coach_id=`/`?admin_id=` que
> el backend se creía. Sobra porque ahora el ámbito se deriva del token en el servidor
> (ver [§12.7](#127-aislamiento-derivado-de-un-token-jwt-no-de-la-url)).

### `src/services/auth.js` — sesión
Objeto `AuthService` con `login`, `logout`, `getCurrentUser`, `isAuthenticated` y
`changePassword`. Las contraseñas se verifican **en el servidor** con bcrypt; el frontend
nunca las compara.

Al iniciar sesión guarda **dos cosas separadas**, y la distinción importa:

| Clave | Qué es | Para qué |
|-------|--------|----------|
| `auth_token` | La **credencial** (JWT firmado) | Lo único que el backend acepta como prueba de identidad |
| `user_session` | Los **datos** del usuario | Pintar la interfaz: nombre, rol, qué botones mostrar |

`user_session` es texto plano y el usuario lo puede editar a mano. Si alguien se cambia
el rol a `superadmin` ahí, verá más botones en pantalla — pero el backend leerá su rol
**real** del token firmado y le responderá 403. Por eso las decisiones de interfaz pueden
salir de `user_session`, pero las de seguridad jamás.

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
de conexión (`db.js`) y el mismo patrón: **exigir sesión** → validar entrada → ejecutar
SQL parametrizado → responder JSON o un error con código HTTP adecuado.

### `load-env.js` — configuración
Carga `backend/.env` calculando su ruta desde `import.meta.url`, y no desde el directorio
en que se lanzó node. **Por qué**: dotenv por defecto busca el `.env` en el directorio de
trabajo; con `npm run api` desde la raíz buscaba `/Kinora/.env`, no lo encontraba y el
servidor arrancaba sin base de datos ni `JWT_SECRET`. Debe importarse **antes** que
cualquier módulo que lea `process.env`.

### `server.js` — punto de entrada
Crea la app Express, habilita `cors` (admite **varios orígenes** separados por comas) y
`express.json()`, expone `/api/health`, y **monta cada router** bajo su prefijo
(`/api/auth`, `/api/exercises`, …). Al hacer `listen`, prueba la conexión a la BD.

> Su primera línea es `import "./load-env.js"`, y el orden importa: JavaScript evalúa
> todos los `import` antes de ejecutar la primera instrucción, así que cargar el `.env`
> más abajo sería demasiado tarde — `middleware/auth.js` ya habría leído `JWT_SECRET`
> vacío.

### `middleware/auth.js` — identidad y permisos
El archivo más importante del backend. Contiene:
- `signToken(user)` — firma el JWT al iniciar sesión.
- `requireAuth` — verifica la firma y deja la identidad en `req.user`; si no, **401**.
- `requireRole(...roles)` — restringe una ruta a ciertos roles; si no, **403**.
- `canModify(user, row)` — **la regla única** de escritura: superadmin puede con todo;
  `created_by IS NULL` (catálogo base) no lo toca nadie más; el resto, solo su creador.
- `scopeFilter(user)` — el recorte de lectura que le toca a cada rol.

Que `canModify` viva en un solo sitio es deliberado: si cada ruta implementara su propia
versión, tarde o temprano una se dejaría media regla.

### `db.js` — conexión
Crea un **Pool** de `pg` con los parámetros del `.env` y fija el `search_path` a
`base_v1` para poder escribir `users` en vez de `base_v1.users` en cada consulta.
Exporta `pool` (para consultas) y `testConnection()` (chequeo de arranque). **Por qué un
Pool y no una conexión suelta**: reutiliza conexiones entre peticiones (más eficiente y
seguro ante concurrencia).

### `routes/auth.js`
- `POST /login`: busca el usuario por `username`, compara con `bcrypt.compare` y devuelve
  sus datos (con `coach_id`/`athlete_id` vía LEFT JOIN) **+ el token**, nunca el hash.
- `POST /register`: crea usuario + perfil en una **transacción**. Protegida: solo
  superadmin/admin, y no permite crear superadmins.
- `POST /change-password`: exige la contraseña actual aunque ya haya sesión, para que
  nadie secuestre una cuenta con el navegador abierto.

### `routes/exercises.js`
CRUD del catálogo. `visibilityClause(user)` arma el WHERE de lectura según el rol, y cada
`PUT`/`DELETE` comprueba la propiedad con `canModify` **antes** de escribir. Cada fila
sale con `can_edit` para que el frontend sepa qué botones pintar. `GET /filters` alimenta
el filtro en cascada del armador de rutinas.

### `routes/coaches.js`
CRUD de coaches (usuario `role='coach'` + perfil, en transacción). `assertCanManageCoach`
impide que el admin A toque a los coaches del admin B — antes eso solo se aplicaba al
listar, así que bastaba conocer un id ajeno para editarlo. El `DELETE` hace un **borrado
en cascada manual** (atletas → rutinas → ejercicios → usuario) dentro de una transacción,
por una razón sutil de integridad explicada en el propio archivo (ver también
[§12.4](#124-borrado-en-cascada-manual-del-coach)).

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
| `apiGet(url)` | `services/api.js` | GET autenticado → JSON parseado. Lanza si el backend da error. |
| `apiSend(url, method, body, msg)` | `services/api.js` | POST/PUT/PATCH/DELETE autenticado, con manejo de error unificado. |
| `getToken()` / `setToken(t)` / `clearToken()` | `services/api.js` | Leen y escriben el token de sesión en `localStorage`. |
| `AuthService.login(username, password)` | `services/auth.js` | Autentica, guarda el token y los datos del usuario. |
| `AuthService.logout()` | `services/auth.js` | Borra token y datos de `localStorage`. |
| `AuthService.getCurrentUser()` | `services/auth.js` | Devuelve el usuario en sesión o `null`. |
| `AuthService.isAuthenticated()` | `services/auth.js` | `true` si hay token **y** datos de usuario. |
| `AuthService.changePassword(actual, nueva)` | `services/auth.js` | Cambia la contraseña del usuario en sesión. |
| `renderNavbar()` | `components/navbar/navbar.js` | Pinta la barra y muestra/oculta enlaces por rol. |
| `initLanding()` | `pages/landing/landing.js` | Engancha los CTA de la portada (login / solicitar acceso / menú móvil / footer legal). |
| `initLogin()` | `pages/login/login.js` | Captura el submit del login y navega al dashboard si tiene éxito. |
| `initDashboard()` | `pages/dashboard/dashboard.js` | Calcula y pinta las métricas (conteos) según el rol. |
| `initProjects()` | `pages/projects/projects.js` | Inicializa la vista de rutinas y engancha eventos. |
| `loadFormData()` | `pages/projects/projects.js` | Descarga catálogo y atletas **una vez**; los filtros trabajan en memoria. |
| `setupPickerEvents()` | `pages/projects/projects.js` | Conecta filtros y selector de atletas (una sola vez, no en cada render). |
| `renderAthletePicker()` / `updateAthleteCount()` | `pages/projects/projects.js` | Casillas de atletas (sustituyen al `<select multiple>`) y contador. |
| `populateMuscleFilter()` / `populateEquipmentFilter(m)` | `pages/projects/projects.js` | Pasos 1 y 2 de la cascada; el material depende del músculo elegido. |
| `filterExercises()` / `renderExercisePicker()` | `pages/projects/projects.js` | Aplican los tres filtros y pintan el paso 3. |
| `updateExercisePreview()` | `pages/projects/projects.js` | Muestra el detalle del ejercicio marcado. |
| `handleAddExercise()` | `pages/projects/projects.js` | Agrega el ejercicio elegido (series/reps/etc.) al borrador. |
| `renderExerciseList()` | `pages/projects/projects.js` | Pinta la lista de ejercicios del borrador (con botón "quitar"). |
| `renderProjects()` | `pages/projects/projects.js` | Lista las rutinas; los botones salen de `can_edit`. |
| `statusBadge(s)` / `renderStatusSelector(r, id)` / `updateStatus(e)` | `pages/projects/projects.js` | Estado por atleta: píldora, selector y guardado. |
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
| `signToken(user)` | `middleware/auth.js` | Firma el JWT con la identidad del usuario al iniciar sesión. |
| `requireAuth` | `middleware/auth.js` | Verifica el token y deja `req.user`; si no, **401**. |
| `requireRole(...roles)` | `middleware/auth.js` | Restringe una ruta a ciertos roles; si no, **403**. |
| `canModify(user, row)` | `middleware/auth.js` | **La regla única de escritura**: superadmin todo; catálogo base nadie; el resto, su creador. |
| `scopeFilter(user)` | `middleware/auth.js` | El recorte de lectura que le toca a cada rol. |
| `POST /auth/login` | `routes/auth.js` | Verifica con bcrypt; devuelve el usuario **+ token**, sin el hash. |
| `POST /auth/register` | `routes/auth.js` | Crea usuario + perfil en transacción (solo superadmin/admin). |
| `POST /auth/change-password` | `routes/auth.js` | Cambia la contraseña propia; exige la actual. |
| `visibilityClause(user)` | `routes/exercises.js`, `routines.js`, `athletes.js` | Arma el WHERE de lectura según el rol, con parámetros (nunca concatenando ids). |
| `GET /exercises/filters` | `routes/exercises.js` | Grupos y equipos existentes, para el filtro en cascada. |
| `assertExercisesVisible()` / `assertAthletesInScope()` | `routes/routines.js` | Impiden colar en una rutina ejercicios o atletas ajenos. |
| `assertOwnsRoutine(user, id)` | `routes/routines.js` | Asignar es modificar: exige ser dueño de la rutina. |
| `PATCH /routines/:id/assignments/:aid/status` | `routes/routines.js` | Estado por atleta; única escritura del atleta. |
| `assertCanManageCoach()` | `routes/coaches.js` | Impide que un admin toque a los coaches de otro. |
| `assertCanManageAthlete()` | `routes/athletes.js` | Ídem con atletas (el atleta se ve, pero no se edita a sí mismo). |
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
  `document_number`, `birthdate`, `is_approved` y **`admin_id`** (el `users.id` del admin
  dueño; separa coaches por admin).
- **`athletes`** — perfil del atleta. Apunta a `user_id` y a `coach_id`; guarda
  `full_name`, `document_number`, `birthdate`.
- **`exercises`** — catálogo. `name`, `muscle_group`, `equipment`, `difficulty` ∈
  `principiante`/`intermedio`/`avanzado`, `description`, `gif_url`, `coach_id` (de qué
  biblioteca cuelga) y **`created_by`** (quién lo puede modificar; `NULL` = **catálogo
  base**).
- **`routines`** — cabecera de la rutina: `coach_id`, **`created_by`**, `name`,
  `description`, `weekly_frequency`.
- **`routine_exercises`** — ejercicios dentro de una rutina (N:1 con `routines`):
  `sets`, `reps`, `rest_seconds`, `weight_kg`, `rpe`, `notes`, `order_index`.
- **`routine_assignments`** — relación N:N rutina ↔ atleta: `routine_id`, `athlete_id`,
  `is_active`, **`status`** ∈ `pending`/`in_progress`/`completed`/`cancelled`
  (UNIQUE(`routine_id`, `athlete_id`)).
- **`training_sessions`** / **`session_exercises`** — registro de lo **ejecutado** (vs.
  lo prescrito). Existen en el esquema pero **aún no tienen UI** (ver [§14](#14-limitaciones-conocidas-y-pendientes-todo)).

> **`coach_id` y `created_by` no son lo mismo**, aunque suelen coincidir:
> `coach_id` responde a *"¿de qué biblioteca cuelga?"* (visibilidad) y `created_by` a
> *"¿quién lo puede modificar?"* (permiso). Se separan porque un **admin no tiene perfil
> de coach**: lo que él crea tiene `coach_id NULL` pero `created_by = él`, y así no se
> confunde con el catálogo base. Ver [§12.8](#128-el-dueño-created_by-separado-del-ámbito-coach_id).

> **El `status` va en la asignación, no en la rutina**: una misma rutina se asigna a
> varios atletas, y Ana puede haberla completado mientras Luis sigue en progreso. Si el
> estado viviera en `routines`, ambos compartirían valor y se pisarían.

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
| rutina: `status` global | vive **por atleta** en `routine_assignments.status` |
| "projects" | **rutinas** (`routines`) |
| ejercicio "global" | **catálogo base** (`created_by IS NULL`) |
| `coaches.brithdate` (mal escrito) | **`coaches.birthdate`** (corregido por migración) |

### Reglas de integridad importantes

- `exercises.coach_id` es **`ON DELETE SET NULL`**, pero hay un índice único parcial
  `UNIQUE(name) WHERE created_by IS NULL` (nombres únicos en el catálogo base). Esta
  combinación obliga al borrado en cascada manual de `coaches.js` (ver [§12.4](#124-borrado-en-cascada-manual-del-coach)).
- `created_by` es **`ON DELETE SET NULL`**: si se borra el usuario que creó un ejercicio,
  este **no** se borra — pasa al catálogo base. Es a propósito: desaparecer arrastraría
  las rutinas de otros que lo estén usando.
- Nombres únicos **por dueño**: `UNIQUE(created_by, name) WHERE created_by IS NOT NULL`.
  Así un coach y un admin pueden tener cada uno su "Sentadilla", y ambas convivir con la
  del catálogo base.
- `athletes.user_id` es `ON DELETE CASCADE`: borrar el usuario borra el atleta.
- `routine_exercises`/`routine_assignments` caen por `ON DELETE CASCADE` al borrar la
  rutina.
- `routine_exercises.exercise_id` es **`ON DELETE RESTRICT`**: no se puede borrar un
  ejercicio que esté dentro de una rutina (daría **409**). Evita vaciar rutinas asignadas.
- CHECK en `routine_exercises`: `weight_kg >= 0` y `0 <= rpe <= 10`.
- CHECK en `routine_assignments.status`: solo los cuatro valores válidos. La BD es la
  autoridad; el backend valida antes solo para no ir hasta ella con algo ya inválido.

---

## 9. Endpoints de la API

Todos cuelgan de `http://localhost:3001/api`.

**Todas las rutas exigen el token de sesión**, salvo `/health` y `/auth/login`
(que es donde se obtiene). El token va en la cabecera:

```
Authorization: Bearer <token>
```

Fíjate en que **ningún endpoint acepta ya `?coach_id=` ni `?admin_id=`**. El recorte
de datos lo decide el servidor leyendo el token; no hay nada que el cliente pueda
escribir en la URL para ver más de lo que le toca. Es decir: **todos los roles piden
la misma URL** y cada uno recibe lo suyo.

### Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/health` | Chequeo de salud (`{status:"ok"}`). Sin token. |
| POST | `/auth/login` | Login por `username` + `password`. Devuelve los datos del usuario **+ `token`**. Sin token. |
| POST | `/auth/register` | Alta de usuario + perfil. **Solo superadmin y admin**; no puede crear superadmins. |
| POST | `/auth/change-password` | Cambia la contraseña del usuario de la sesión. Exige la actual. |

### Ejercicios

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/exercises` | Los que el usuario puede ver. Cada fila trae `can_edit`. |
| GET  | `/exercises/filters` | Grupos musculares y equipos existentes, para el filtro en cascada. |
| POST | `/exercises` | Crear. El dueño (`created_by`) sale del token. El atleta no puede. |
| GET  | `/exercises/:id` | Ver uno (404 si no es visible para él). |
| PUT/DELETE | `/exercises/:id` | Editar / borrar. **Solo el dueño**; el catálogo base solo el superadmin. |

### Coaches — *solo superadmin y admin*

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/coaches` | Los de su ámbito (el admin, solo los suyos). |
| GET  | `/coaches/:id` | Ver uno (403 si es de otro admin). |
| POST | `/coaches` | Crear usuario + perfil. El `admin_id` sale del token. |
| PUT  | `/coaches/:id` | Editar perfil, correo y acceso (`is_active`). |
| DELETE | `/coaches/:id` | Borrar el coach y **todos sus datos** en cascada (transacción). |

### Atletas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/athletes` | Los de su ámbito. Incluye `routine_count` y `completed_count` (cumplimiento). |
| GET  | `/athletes/:id` | Ver uno. El atleta solo se ve a sí mismo. |
| POST | `/athletes` | Crear. Si lo crea un coach, queda a su cargo. |
| PUT/DELETE | `/athletes/:id` | Editar / borrar. Solo quien lo tiene a cargo. |

### Admins — *solo superadmin*

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/admins` | Listar, con `coach_count` (cuántos coaches tiene cada uno). |
| POST | `/admins` | Crear. |
| PUT  | `/admins/:id` | Editar usuario, correo y acceso (`is_active`). |
| DELETE | `/admins/:id` | Borrar. Devuelve `orphaned_coaches`: sus coaches quedan sin dueño, no se borran. |

### Rutinas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/routines` | Las de su ámbito. El atleta, solo las asignadas. Trae `exercises`, `assignments` y `can_edit`. |
| GET  | `/routines/:id` | Ver una (404 si no es visible para él). |
| POST | `/routines` | Crear rutina + ejercicios + asignaciones (una transacción). |
| PUT/DELETE | `/routines/:id` | Editar / borrar. **Solo el dueño.** |
| POST | `/routines/:id/assignments` | Asignar a un atleta (idempotente). Solo el dueño y solo a atletas suyos. |
| DELETE | `/routines/:id/assignments/:athleteId` | Quitar la asignación. |
| PATCH | `/routines/:id/assignments/:athleteId/status` | Cambiar el estado. **Única escritura del atleta**, y solo sobre la suya. |

### Códigos de respuesta

| Código | Significa |
|--------|-----------|
| **401** | No hay token, es inválido o caducó → hay que volver a iniciar sesión. |
| **403** | Hay sesión, pero ese usuario no tiene permiso (no es suyo, o su rol no llega). |
| **404** | No existe **o no es visible para él**. Se usa en vez de 403 al leer, para no confirmar que ese id existe. |
| **409** | Conflicto: nombre duplicado, o se intenta borrar algo que otro está usando. |

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

### Las dos preguntas que hay que separar

Casi toda la confusión con los permisos viene de mezclar dos cosas distintas:

- **VER** (lectura) → *¿qué filas te salen al listar?* Lo decide tu ámbito.
- **MODIFICAR** (escritura) → *¿puedes editar o borrar ESTA fila?* Lo decide quién la creó.

**Ver algo no da derecho a tocarlo.** Un coach ve la "Sentadilla" del catálogo base y
la usa en sus rutinas, pero no la puede cambiar: la comparten todos los demás. Es
exactamente la regla de "no modificar los de la base de datos".

### Matriz de VISIBILIDAD (qué ves al listar)

| Recurso | Athlete | Coach | Admin | Superadmin |
|---------|---------|-------|-------|------------|
| Ejercicios | base + los de su coach | base **+ los suyos** | base + los suyos + los de **sus** coaches | todos |
| Rutinas | solo las asignadas a él | base **+ las suyas** | base + las suyas + las de **sus** coaches | todas |
| Atletas | solo él mismo | solo los suyos | los de **sus** coaches | todos |
| Coaches | — | — | solo `admin_id = suyo` | todos |
| Admins | — | — | — | los gestiona |

### Matriz de MODIFICACIÓN (qué puedes editar o borrar)

| Quién | Catálogo base (`created_by IS NULL`) | Lo suyo | Lo de otro |
|-------|--------------------------------------|---------|------------|
| Athlete | ✗ (solo el estado de SU rutina) | ✗ | ✗ |
| Coach | ✗ | ✓ | ✗ |
| Admin | ✗ | ✓ | ✗ |
| Superadmin | ✓ | ✓ | ✓ |

### Cómo funciona técnicamente

**La identidad viaja en un token firmado (JWT), no en la URL.** Al iniciar sesión, el
servidor mete en el token quién eres (`id`, `role`, `coach_id`, `athlete_id`) y lo firma
con `JWT_SECRET`. El navegador lo devuelve en cada petición y el servidor comprueba la
firma. Como el secreto solo lo conoce el servidor, **cambiar un solo carácter del token
lo invalida**: no se puede falsificar.

De ahí salen las tres columnas que gobiernan los permisos:

| Columna | Responde a | Dónde |
|---------|-----------|-------|
| `created_by` | **quién puede modificarlo** | `exercises`, `routines` |
| `coach_id` | de qué biblioteca cuelga (visibilidad) | `exercises`, `routines`, `athletes` |
| `coaches.admin_id` | qué admin manda sobre ese coach | `coaches` |

`created_by` apunta a `users.id`, así que sirve igual para un coach y para un admin
(recuerda: **un admin no tiene perfil**, es solo una fila en `users`). Su regla es una
sola, y vive en un único sitio — `canModify()` en `backend/middleware/auth.js`:

```js
if (user.role === "superadmin") return true;   // el superadmin puede con todo
if (row.created_by == null) return false;      // catálogo base: intocable
return row.created_by === user.id;             // solo su creador
```

Al **crear**, el dueño lo pone el servidor desde el token, nunca el cliente:

- **superadmin** → `created_by = NULL` → lo que crea **es** el catálogo base, y lo ve todo el mundo.
- **coach / admin** → `created_by = él mismo` → material privado que solo él edita.

El frontend recibe un `can_edit` calculado por el backend en cada fila y lo usa para
pintar o esconder los botones. **Eso es solo cosmética**: el permiso se vuelve a
comprobar en cada `PUT`/`DELETE`. Si alguien edita `user_session` en el navegador para
ponerse `role: "superadmin"`, verá más botones — y recibirá un `403` en cuanto los pulse,
porque su rol real está dentro del token firmado.

> **La diferencia con la versión anterior:** antes el ámbito llegaba en la URL
> (`?coach_id=3`) y el servidor se lo creía. Cambiar ese número a mano bastaba para ver
> los datos de otro. El aislamiento era **de interfaz**, no de seguridad. Hoy la URL no
> lleva ámbito y no hay nada que falsificar.

### Credenciales

`node backend/seed.js` crea usuarios de ejemplo (`superadmin`, `admin`, `coach`,
`atleta`, todos con contraseña `123456`), pero **solo si no existen ya**. En una base con
datos reales puede que solo exista el `superadmin`.

> El superadmin del seed es configurable con `SUPERADMIN_USERNAME` / `_PASSWORD` /
> `_EMAIL` en `backend/.env`. Para crear/promover un superadmin sin correr todo el seed:
> `node backend/create-superadmin.js <usuario> <contraseña> [correo]`.
>
> ⚠️ Las contraseñas `123456` son solo para desarrollo local. Antes de publicar esto en
> internet hay que cambiarlas todas.

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
5. `auth.js` busca el usuario por `username` y compara la contraseña con
   `bcrypt.compare()`. Si coincide, llama a `signToken(user)`
   (`middleware/auth.js`), que **firma un token** con su identidad.
6. Devuelve sus datos (rol, `full_name`, `coach_id`/`athlete_id`) **+ el `token`**, y
   nunca el hash de la contraseña.
7. `AuthService` guarda dos cosas por separado en `localStorage`:
   - `auth_token` → la **credencial**: lo que prueba quién eres ante el backend.
   - `user_session` → los **datos para pintar** la interfaz (nombre, rol).
8. `login.js` hace `navigateTo('/dashboard')` y el router pinta el dashboard.

**Y en cada petición posterior:**

9. La página llama a `apiGet`/`apiSend` (`services/api.js`), que añaden solo
   `Authorization: Bearer <token>`. Ya no se manda ningún filtro en la URL.
10. En el backend, `requireAuth` comprueba la firma y deja la identidad verificada en
    `req.user`. Si el token falta, caducó o fue manipulado, corta con **401** y la ruta
    ni se ejecuta.
11. La ruta arma su `WHERE` a partir de `req.user` (nunca de `req.query`), así que cada
    quien recibe su ámbito.
12. Si el backend responde 401, `api.js` limpia la sesión y manda al login: es lo que
    pasa cuando el token caduca (a las 8 horas).

> Las dos claves de `localStorage` tienen papeles distintos a propósito. `user_session`
> es texto plano que el usuario puede editar; sirve para decidir **qué se dibuja**.
> `auth_token` está firmado y sirve para decidir **qué se permite**. Por eso las
> decisiones de interfaz pueden salir de `user_session`, pero las de seguridad jamás.

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
  usuario del coach, sus ejercicios pasarían a `coach_id NULL` y su nombre podría
  **chocar** con el índice único parcial de nombres del catálogo base → error `23505` y
  borrado revertido.
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

### 12.7. Aislamiento derivado de un token (JWT), no de la URL
- **Cómo era antes**: el frontend mandaba `?coach_id=`/`?admin_id=` y el servidor se lo
  creía. Cambiar ese número a mano en la barra de direcciones bastaba para leer los datos
  de otro coach, y un `curl` se saltaba la interfaz entera. El aislamiento era **de
  interfaz, no de seguridad**.
- **Qué se hizo**: el login firma un JWT con la identidad real; `requireAuth` lo verifica
  y deja el resultado en `req.user`; cada ruta arma su `WHERE` **desde `req.user`, nunca
  desde `req.query`**. Ese fue el cambio de fondo: no que se añadiera un token, sino que
  **el cliente dejó de ser la fuente de su propia identidad**.
- **Alternativas**:
  - *Sesiones con cookie en servidor*: más fácil de revocar al instante, pero obliga a
    guardar estado de sesión y complica el CORS entre `:5173` y `:3001`. Un JWT no
    necesita estado.
  - *Seguridad a nivel de fila en PostgreSQL (RLS)*: la protección más férrea, porque
    vive en la BD y no se puede saltar desde ninguna capa. Descartada por ser bastante
    más compleja de montar y depurar para lo que pide este proyecto.
- **Contrapartida asumida**: un JWT **no se puede revocar** antes de que caduque. Si se
  suspende a un usuario (`is_active = false`), su token sigue valiendo hasta 8 horas. Se
  acepta porque la ventana es corta; si hiciera falta cortar el acceso al instante,
  habría que comprobar `is_active` contra la BD en cada petición.

### 12.8. El dueño (`created_by`) separado del ámbito (`coach_id`)
- **El problema**: "de quién es un ejercicio" se deducía de `exercises.coach_id`. Pero un
  **admin no tiene perfil de coach**, así que todo lo que creaba nacía con `coach_id NULL`
  y se confundía con el catálogo base. No había forma de distinguir "material del sistema"
  de "material de un admin".
- **Qué se hizo**: una columna `created_by → users.id`, que vale igual para coach y admin,
  y que define **solo** el permiso de escritura. `coach_id` se quedó con la visibilidad.
  Dos columnas porque son dos preguntas distintas (ver [§10](#10-roles-permisos-y-aislamiento-multi-tenant)).
- **`created_by IS NULL` = catálogo base**: todos lo ven y lo usan, solo el superadmin lo
  toca. Al ser el valor por defecto de una columna nueva, los datos que ya existían
  quedaron bien clasificados sin tocarlos.
- **Efecto lateral que hubo que arreglar**: los índices de nombre único iban por
  `coach_id`, así que un admin que creara "Sentadilla" chocaba contra la del catálogo
  base con un error de duplicado sin sentido para él. Se movieron a `created_by`.

### 12.9. Sin framework en el frontend
- **Trade-off**: más código repetitivo (cada página engancha sus propios eventos y
  vuelve a pintar a mano), a cambio de **cero dependencias** y transparencia total del
  flujo. Un framework reduciría el *boilerplate* pero añadiría curva y peso.

### 12.10. Filtro en cascada en vez de un desplegable único
- **El problema**: los ejercicios iban todos en un `<select>` plano. Con un catálogo de
  35 (y creciendo), encontrar uno era desplazarse por una lista sin orden útil para quien
  está planificando un entrenamiento.
- **Qué se hizo**: se reduce por pasos, en el orden en que se piensa una rutina —
  **músculo → material → ejercicio** — más un buscador por nombre que salta los tres
  pasos. Cada paso se calcula a partir del anterior: si eliges "pecho", el material solo
  ofrece el que existe **para pecho**, así que ninguna combinación deja la lista vacía.
- **Por qué se filtra en memoria y no con llamadas a la API**: el catálogo se descarga una
  vez al abrir el formulario. Si cada tecla del buscador disparara un `fetch`, la lista
  parpadearía, las respuestas podrían llegar desordenadas y se castigaría al servidor sin
  motivo. El catálogo no cambia mientras armas una rutina.
- **Alternativa**: `<datalist>` (autocompletado nativo del navegador). Se descartó porque
  no permite mostrar el detalle del ejercicio ni deshabilitar los ya agregados.

### 12.11. Casillas en vez de `<select multiple>` para los atletas
- **El problema**: asignar la rutina a varios atletas exigía mantener **Ctrl/Cmd** pulsado
  mientras se hacía clic. En un móvil no existe la tecla Ctrl: era **literalmente
  imposible** asignar una rutina a dos atletas desde un teléfono.
- **Qué se hizo**: una lista de casillas donde cada toque marca o desmarca, con buscador
  (aparece si hay más de 6), botones "Todos"/"Ninguno" y un contador de seleccionados.
  Filas de 44px de alto: por debajo de eso, el dedo falla el toque.
- **Detalle que lo hace funcionar**: la selección vive en un `Set` de JavaScript, **no en
  el DOM**. Al escribir en el buscador la lista se redibuja, y si el estado estuviera en
  las casillas, los marcados que quedan fuera del filtro se perderían solos. Por eso, al
  guardar, los ids salen del `Set` y no de leer el DOM.

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

**Archivos/artefactos sin uso**
- `package.json` (raíz): se quitó la dependencia **`pg`** (el navegador no puede usarla).
- Se eliminó `public/images/atleta-hero.png` (no lo referenciaba nadie).
- Se eliminó la carpeta `dist/` (build regenerable con `npm run build`; está en
  `.gitignore`).
- `README.md`: se reescribió (estaba desactualizado: hablaba de `json-server`, `db.json`
  y roles `Coach`/`atleta` que ya no existen).

### Revisión de seguridad y UX (julio 2026)

**Seguridad** (detalle en [§10](#10-roles-permisos-y-aislamiento-multi-tenant) y [§12.7](#127-aislamiento-derivado-de-un-token-jwt-no-de-la-url))
- Se añadió **autenticación con JWT**: `backend/middleware/auth.js` (`signToken`,
  `requireAuth`, `requireRole`, `canModify`, `scopeFilter`). Todas las rutas quedaron
  protegidas y el ámbito ya **no** se lee de la URL.
- `POST /auth/register` **era público**: cualquiera podía crear un superadmin sin
  autenticarse. Ahora exige sesión de superadmin/admin y no permite crear superadmins.
- Se añadió el chequeo de **propiedad** en cada `PUT`/`DELETE`: antes bastaba con conocer
  un id ajeno para editarlo, porque el aislamiento solo se aplicaba al listar.
- `JWT_SECRET` volvió al `.env` y ahora es **obligatorio**: el servidor aborta si falta,
  en vez de arrancar con un secreto inseguro sin avisar.

**Bugs encontrados**
- `POST /api/coaches` **descartaba en silencio** `document_number` y la fecha de
  nacimiento: el formulario los pedía como obligatorios y nunca se guardaban.
- La columna `coaches.brithdate` estaba **mal escrita** (`athletes` sí usa `birthdate`).
  Renombrada por migración.
- `backend/load-env.js` (nuevo): dotenv buscaba el `.env` en el directorio **desde el que
  se lanza node**, no junto al archivo. Con `npm run api` desde la raíz no lo encontraba y
  el servidor arrancaba sin configuración. Ahora la ruta se calcula desde
  `import.meta.url` y funciona desde cualquier sitio.
- `CORS_ORIGIN` solo admitía **un** origen. Si Vite saltaba al 5174 por tener el 5173
  ocupado, la app cargaba pero todas las llamadas fallaban. Ahora acepta una lista.
- `api.js`: `apiGet` devolvía los errores **como si fueran datos**, así que las páginas
  intentaban recorrer un `{error:"…"}` como un array. Ahora lanza.

**CRUD que faltaba**
- `PUT /api/coaches/:id` y `PUT /api/admins/:id`: sin ellos, corregir un correo mal
  escrito obligaba a borrar y recrear — perdiendo por el camino rutinas y atletas.

**UX** (detalle en [§12.10](#1210-filtro-en-cascada-en-vez-de-un-desplegable-único) y [§12.11](#1211-casillas-en-vez-de-select-multiple-para-los-atletas))
- Armador de rutinas: filtro en cascada **músculo → material → ejercicio** + buscador.
- Atletas: casillas en vez de `<select multiple>` — asignar a varios era imposible en móvil.
- Se recuperó el **estado de la rutina** (pendiente/en progreso/completada/cancelada), por
  atleta, y el **% de cumplimiento** en la lista de atletas.

---

## 14. Limitaciones conocidas y pendientes (TODO)

**Seguridad**
- **Recuperar contraseña**: existe `POST /auth/change-password` (exige la actual), pero no
  hay un "olvidé mi contraseña" para quien no puede entrar. Si un atleta pierde la suya,
  hoy la única salida es que su coach la reponga por la BD. Hacerlo bien pide correo.
- **El token no se puede revocar** antes de que caduque (8 h): suspender a un usuario
  (`is_active = false`) le impide **volver** a entrar, pero su sesión abierta sigue
  valiendo. Ver la contrapartida en [§12.7](#127-aislamiento-derivado-de-un-token-jwt-no-de-la-url).
- **El token vive en `localStorage`**, así que es legible por JavaScript y por tanto
  vulnerable a XSS. Lo correcto en producción sería una cookie `httpOnly`; se aceptó
  porque simplifica el CORS entre `:5173` y `:3001` en local.
- **Las contraseñas de ejemplo son `123456`.** Hay que cambiarlas antes de exponer esto.
- **No hay límite de intentos de login**: se puede probar contraseñas a lo bruto sin freno.

**Funcionalidad**
- **Registro de entrenamientos**: `training_sessions` / `session_exercises` existen en el
  esquema pero **no tienen UI**. Es lo que cierra el círculo entre lo que el coach
  prescribe y lo que el atleta ejecuta (ver [§12.5](#125-prescripción-rutina-vs-ejecución-sesión)).
- **Página de "perfil de atleta"** para el coach (un atleta + sus rutinas en detalle),
  a construir contra `/api/athletes/:id`.
- **Editar el usuario/contraseña** de coaches y atletas ya creados: hoy solo se
  establecen al crear, y cada quien cambia la suya con `/auth/change-password`.
- **Editar una rutina reinicia el estado de sus atletas** a "pendiente", porque el PUT
  borra y reinserta las asignaciones (ver [§12.3](#123-editar-rutina--borrar-y-reinsertar-los-hijos)).

**Datos**
- **Coaches sin dueño**: los creados antes de la migración `admin_id`, o directamente por
  el superadmin, tienen `admin_id = NULL` y **solo los ve el superadmin**. Para asignarlos:
  `UPDATE base_v1.coaches SET admin_id = <user_id_del_admin> WHERE id = <coach>;`
- **No hay pruebas automatizadas.** La verificación es manual (ver
  `.claude/skills/verify/SKILL.md`, que documenta cómo levantar y conducir la app).

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
| **Aislamiento multi-tenant** | Que cada usuario vea solo "lo suyo" según su rol. El recorte lo decide el servidor a partir del token. |
| **Prescripción** | Lo que el coach pide en la rutina (peso/RPE/notas objetivo), en `routine_exercises`. |
| **Ejecución / sesión** | Lo que el atleta realmente hizo (futuro, `session_exercises`). |
| **Catálogo base** | Ejercicios y rutinas con **`created_by IS NULL`**: los ve y usa todo el mundo, pero solo el superadmin los modifica. Antes se le llamaba "catálogo global". |
| **`created_by`** | El **dueño**: quién puede modificar esa fila. Responde a "¿es mío?". |
| **`coach_id`** | El **ámbito**: de qué biblioteca de coach cuelga. Responde a "¿lo veo?". No confundir con `created_by`. |
| **`can_edit`** | Campo que el backend añade a cada fila para que el frontend sepa si pintar los botones. Es cosmética: el permiso se revalida en cada escritura. |
| **Migración** | Script SQL versionado que evoluciona el esquema (`backend/migrations/`). |
| **Idempotente** | Que se puede ejecutar varias veces con el mismo resultado (seed y migraciones lo son). |
| **RPE** | *Rate of Perceived Exertion*: esfuerzo percibido, escala 0–10. |
| **`muscle_group`** | Grupo muscular del ejercicio (lo que antes se llamaba "categoría"). |
| **Filtro en cascada** | Reducir el catálogo por pasos (músculo → material → ejercicio), donde cada paso se calcula con el anterior. |
| **Seed** | Carga de datos iniciales de prueba (`seed.js`). |
| **projects = rutinas** | La carpeta `projects/` gestiona rutinas; el nombre es herencia histórica. |
| **ESM / ES Modules** | Sistema de módulos estándar de JavaScript (`import`/`export`). El proyecto lo usa en front y back (`"type": "module"`). |
| **CORS** (Cross-Origin Resource Sharing) | Mecanismo del navegador que permite que el frontend (`:5173`) llame a la API (`:3001`), en distinto puerto. Se habilita con el middleware `cors` en `server.js`. |
| **JWT** (JSON Web Token) | Token firmado que prueba quién eres en cada petición, sin que el servidor guarde sesión. Va en `Authorization: Bearer …`. Está **firmado, no cifrado**: cualquiera puede leer su contenido, pero nadie puede alterarlo sin el `JWT_SECRET`. |
| **`JWT_SECRET`** | La clave con la que el servidor firma los tokens (en `backend/.env`). Si se filtrara, cualquiera podría fabricar tokens y hacerse pasar por superadmin. |
| **401 vs 403** | **401** = no sé quién eres (falta el token o caducó) → vuelve a entrar. **403** = sé quién eres, pero esto no es tuyo. |
| **HMR** (Hot Module Replacement) | Recarga en caliente de Vite: al guardar un archivo, actualiza la vista en el navegador sin recargar toda la página. |
| **FK / clave foránea** (foreign key) | Columna que referencia la clave primaria de otra tabla (p. ej. `athletes.coach_id → coaches.id`). Garantiza integridad referencial y define el comportamiento en cascada (`ON DELETE CASCADE`/`SET NULL`). |
| **Payload** | El cuerpo (JSON) que el frontend envía al backend en un POST/PUT (p. ej. el objeto rutina con sus ejercicios y atletas). |
| **localStorage** | Almacén clave-valor del navegador, persistente entre recargas. Kinora guarda ahí `auth_token` (la credencial) y `user_session` (los datos para pintar). |
| **Middleware** | Función que Express ejecuta antes de las rutas (p. ej. `cors`, `express.json()`, o `requireAuth`, que corta la petición si no hay token válido). |

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
