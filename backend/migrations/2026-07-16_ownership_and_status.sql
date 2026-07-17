-- Migración: dueño real de ejercicios/rutinas + estado de la rutina por atleta.
--
-- ── Parte 1: created_by (el dueño que decide QUIÉN puede editar) ──────────────
--
-- El problema que resuelve: hasta ahora "de quién es un ejercicio" se deducía de
-- exercises.coach_id. Eso deja fuera al admin, que no tiene perfil de coach (un
-- admin es solo una fila en users con role='admin'), así que todo lo que creaba
-- un admin quedaba con coach_id NULL y se confundía con el catálogo base.
--
-- created_by apunta a users(id): sirve igual para un coach y para un admin, y
-- define el permiso de ESCRITURA con una regla única:
--
--   created_by IS NULL  -> CATÁLOGO BASE. Es el material que trae el sistema.
--                          Todos lo VEN y lo usan en sus rutinas, pero solo el
--                          superadmin lo puede editar o borrar.
--   created_by = X      -> lo creó el usuario X. Solo X (y el superadmin) lo
--                          puede editar o borrar; los demás solo lo ven.
--
-- Ojo con la diferencia entre las dos columnas, porque conviven:
--   coach_id   -> VISIBILIDAD: de qué biblioteca de coach cuelga (aislamiento al listar).
--   created_by -> PERMISO: quién lo puede modificar.
-- Un ejercicio creado por un admin tiene coach_id NULL pero created_by = ese admin,
-- y por eso ya no se confunde con el catálogo base.
--
-- ON DELETE SET NULL: si se borra el usuario que lo creó, el recurso NO se borra;
-- pasa al catálogo base en vez de desaparecer y arrastrar las rutinas que lo usan.
--
-- ── Parte 2: estado de la rutina ──────────────────────────────────────────────
--
-- El estado va en routine_assignments y NO en routines, porque una misma rutina
-- se asigna a varios atletas a la vez: Ana puede haberla completado mientras Luis
-- sigue en progreso. Si el estado viviera en routines, ambos compartirían el mismo
-- valor y se pisarían entre sí.
--
-- Idempotente: se puede correr varias veces sin error.
--
-- Ejecutar:
--   docker exec -i kinora_local psql -U Kinora -d kinora < backend/migrations/2026-07-16_ownership_and_status.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Columna created_by en exercises y routines.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE base_v1.exercises
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES base_v1.users(id) ON DELETE SET NULL;

ALTER TABLE base_v1.routines
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES base_v1.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON base_v1.exercises(created_by);
CREATE INDEX IF NOT EXISTS idx_routines_created_by  ON base_v1.routines(created_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Backfill de los datos que ya existían.
--
-- Todo lo que hoy cuelga de un coach pasa a tener como dueño al USUARIO de ese
-- coach, para que ese coach siga pudiendo editar lo suyo tras la migración.
-- Lo que tiene coach_id NULL se queda con created_by NULL: es el catálogo base.
--
-- El WHERE created_by IS NULL evita repisar dueños si la migración se corre dos veces.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE base_v1.exercises e
   SET created_by = c.user_id
  FROM base_v1.coaches c
 WHERE e.coach_id = c.id
   AND e.created_by IS NULL;

UPDATE base_v1.routines r
   SET created_by = c.user_id
  FROM base_v1.coaches c
 WHERE r.coach_id = c.id
   AND r.created_by IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Estado de la rutina, por atleta asignado.
--
-- 'pending' por defecto: al asignar una rutina, el atleta todavía no la empezó.
-- Los valores son los mismos cuatro de siempre, ahora en minúscula y validados
-- por la BD para que no entren variantes sueltas ("Completado", "completed"...).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE base_v1.routine_assignments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routine_assignments_status_check') THEN
    ALTER TABLE base_v1.routine_assignments
      ADD CONSTRAINT routine_assignments_status_check
      CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_routine_assignments_status ON base_v1.routine_assignments(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Reajuste de los índices de nombre único, de coach_id a created_by.
--
-- Por qué hay que tocarlos: los índices viejos daban por hecho que "sin coach_id"
-- significaba "del catálogo base". Con los admins creando material eso se rompe,
-- porque un ejercicio de un admin también tiene coach_id NULL. Con el índice viejo,
-- un admin que creara "Sentadilla" chocaba contra la "Sentadilla" del catálogo base
-- y recibía un error de duplicado que no tenía ningún sentido para él.
--
-- Al pasar la unicidad a created_by, la regla queda como uno espera:
--   - el catálogo base no puede tener dos "Sentadilla";
--   - cada usuario no puede tener dos "Sentadilla" SUYAS;
--   - pero un admin y un coach sí pueden tener cada uno la suya, y ambas pueden
--     convivir con la del catálogo base.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS base_v1.idx_exercises_base_unique_name;
DROP INDEX IF EXISTS base_v1.idx_exercises_coach_unique_name;
DROP INDEX IF EXISTS base_v1.idx_routines_base_unique_name;
DROP INDEX IF EXISTS base_v1.idx_routines_coach_unique_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_base_unique_name
  ON base_v1.exercises(name) WHERE created_by IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_owner_unique_name
  ON base_v1.exercises(created_by, name) WHERE created_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routines_base_unique_name
  ON base_v1.routines(name) WHERE created_by IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_routines_owner_unique_name
  ON base_v1.routines(created_by, name) WHERE created_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) coaches.brithdate -> coaches.birthdate (corrección de un error de tipeo).
--
-- La columna quedó mal escrita ("brithdate"). La tabla athletes sí usa el nombre
-- correcto, "birthdate", así que la misma idea tenía dos nombres distintos según
-- la tabla y era fácil equivocarse al escribir una consulta.
--
-- Idempotente: solo renombra si todavía existe la mal escrita.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'base_v1' AND table_name = 'coaches' AND column_name = 'brithdate'
  ) THEN
    ALTER TABLE base_v1.coaches RENAME COLUMN brithdate TO birthdate;
  END IF;
END $$;
