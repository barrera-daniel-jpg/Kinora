# 🏋️ Kinora — Gestión de Rutinas de Entrenamiento

Aplicación web de página única (**SPA**) para gestionar rutinas de entrenamiento en una
jerarquía **superadmin → admin → coach → atleta**. El coach crea ejercicios y rutinas y
las asigna a sus atletas; el atleta ve las suyas. Un dashboard resume la información
según el rol.

> 📘 **Documentación técnica completa** (arquitectura, cada módulo/función, modelo de
> datos, glosario y decisiones de diseño): ver **[`DOCUMENTACION.md`](./DOCUMENTACION.md)**.

Formularios de solicitud de acceso (desde la landing):
- General / Coach: https://forms.gle/ix7tePMizVstVeFz7
- Atleta: https://forms.gle/eeYwqkrEcUqXQdtz7

---

## 🧱 Arquitectura (tres piezas, todo en local)

```
Frontend (Vite, Vanilla JS)  ──HTTP/JSON──▶  Backend (Express)  ──SQL──▶  PostgreSQL (Docker)
   localhost:5173                              localhost:3001              kinora_local:5433
```

El proyecto corre **solo en local** (el equipo acordó no desplegarlo en la nube).

---

## 🛠 Tecnologías

| Tecnología | Uso |
|------------|-----|
| **Vite** `^8` | Servidor de desarrollo y bundler del frontend. |
| **JavaScript (ES Modules)** | Lógica de front y back, sin frameworks. |
| **Express** `^4` | API REST del backend. |
| **PostgreSQL** (en **Docker**) | Base de datos (esquema `base_v1`). |
| **`pg`** | Driver de PostgreSQL (consultas parametrizadas). |
| **`bcryptjs`** | Hasheo de contraseñas. |
| **Fetch API + localStorage** | Peticiones HTTP y persistencia de sesión. |

Por qué cada una: ver [`DOCUMENTACION.md` §2](./DOCUMENTACION.md#2-tecnologías-usadas-y-por-qué).

---

## 📋 Requisitos previos

- **Node.js** 18 o superior · **npm** · **Docker** (para la base de datos).

---

## ▶️ Puesta en marcha

Necesitas **tres cosas corriendo a la vez**.

### 1. Base de datos (Docker)

```bash
docker ps | grep kinora_local        # comprobar que está arriba
docker start kinora_local            # si no lo está
```

### 2. Backend (API)

```bash
cd backend
npm install          # solo la primera vez
npm run seed         # (opcional) carga datos de prueba
npm start            # API en http://localhost:3001
```

### 3. Frontend (desde la raíz del proyecto)

```bash
npm install          # solo la primera vez
npm run dev          # Vite en http://localhost:5173
```

---

## 👤 Usuarios de prueba (tras `npm run seed`)

Login por **nombre de usuario**. Contraseña de todos: **`123456`**.

| Rol | Usuario |
|-----|---------|
| superadmin | `superadmin` |
| admin | `admin` |
| coach | `coach` |
| athlete | `atleta` |

---

## 📂 Estructura (resumen)

```
backend/     API REST (Express): server.js, db.js, routes/, seed.js, migrations/
src/         Frontend SPA: main.js, router/, services/, components/, pages/
index.html   HTML raíz (#navbar-container + #app)
DOCUMENTACION.md   Documentación técnica detallada
```

Detalle de cada módulo y función: [`DOCUMENTACION.md`](./DOCUMENTACION.md).

---

## 🔐 Roles (resumen)

- **superadmin**: gestiona admins y ve todo el sistema.
- **admin**: gestiona sus coaches y, en cascada, sus atletas/rutinas/ejercicios.
- **coach**: gestiona sus ejercicios, atletas y rutinas.
- **athlete**: ve sus rutinas asignadas (solo lectura).

---

> ⚠️ **Nota de seguridad (proyecto académico):** el login aún **no emite token JWT** y
> los endpoints están abiertos; el aislamiento por rol es a nivel de UI y es
> falsificable. No usar en producción tal cual. Ver
> [`DOCUMENTACION.md` §14](./DOCUMENTACION.md#14-limitaciones-conocidas-y-pendientes-todo).
</content>
