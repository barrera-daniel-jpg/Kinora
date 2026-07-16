-- Migración: prescripción por ejercicio en la rutina (peso objetivo, RPE y notas).
--
-- Antes: routine_exercises solo tenía sets/reps/rest_seconds. El coach no podía
-- indicar con qué peso, a qué esfuerzo (RPE) ni dejar una aclaración por ejercicio.
-- Estos campos son la PRESCRIPCIÓN (lo que el coach pide); lo REALMENTE ejecutado
-- se registra aparte en session_exercises (weight_kg/notes). Por eso aquí van con
-- prefijo/typos "target" donde aplica y todos son opcionales (NULL permitido).
--
-- Idempotente: se puede correr varias veces sin error.
--
-- Ejecutar:
--   docker exec -i kinora_local psql -U Kinora -d kinora < backend/migrations/2026-07-15_routine_exercise_prescription.sql

ALTER TABLE base_v1.routine_exercises
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rpe       NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS notes     TEXT;

-- Checks (idempotentes vía DO block, porque ADD CONSTRAINT IF NOT EXISTS no existe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routine_exercises_weight_kg_check') THEN
    ALTER TABLE base_v1.routine_exercises
      ADD CONSTRAINT routine_exercises_weight_kg_check CHECK (weight_kg IS NULL OR weight_kg >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routine_exercises_rpe_check') THEN
    ALTER TABLE base_v1.routine_exercises
      ADD CONSTRAINT routine_exercises_rpe_check CHECK (rpe IS NULL OR (rpe >= 0 AND rpe <= 10));
  END IF;
END $$;
