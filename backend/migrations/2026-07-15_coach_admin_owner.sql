-- Migración: dueño (admin) de cada coach — jerarquía multi-tenant completa.
--
-- Ahora cada coach pertenece al admin que lo creó,
-- de modo que cada admin solo ve/gestiona LO SUYO. El superadmin ve todo.
--
-- admin_id apunta a users.id (un admin NO tiene tabla de perfil; es una fila en
-- users con role='admin'). ON DELETE SET NULL: si se borra el admin, sus coaches
-- quedan "huérfanos" (admin_id NULL) en vez de borrarse.
--
-- Idempotente: se puede correr varias veces sin error.
--
-- Ejecutar:
--   docker exec -i kinora_local psql -U Kinora -d kinora < backend/migrations/2026-07-15_coach_admin_owner.sql

ALTER TABLE base_v1.coaches
  ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES base_v1.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coaches_admin_id ON base_v1.coaches(admin_id);
