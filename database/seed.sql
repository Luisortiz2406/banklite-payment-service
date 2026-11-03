-- Datos de ejemplo de payment_db (payment-service). Escenario de demo compartido por todos
-- los microservicios (mismos UUID): Ana Pérez y Carlos Gómez, clientes de prueba,
-- y una cuenta de comercio. Datos inventados: no son personas ni documentos reales.
-- Cargar después del esquema:  psql "$DATABASE_URL" -f database/schema.sql -f database/seed.sql
-- (si la base ya tiene estas filas, ON CONFLICT DO NOTHING las deja como están)

BEGIN;
-- Las facturas son de demostración: Banklite no está conectado a los convenios reales.
INSERT INTO public.billers (code, name, currency, account_id, account_number, updated_at) VALUES
  ('fac-acueducto', 'Aguas Demo Sabana', 'COP', '3a000000-0000-4000-8000-0000000000a1', '90000000001', '2026-10-01 08:00:00-05')
ON CONFLICT DO NOTHING;

INSERT INTO public.payment_requests (id, user_id, kind, biller_code, reference, period, due_date, source_account_id, amount, currency, description, idempotency_key, status, ledger_transaction_id, created_at, updated_at) VALUES
  ('3e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bill', 'fac-acueducto', '12345678', '2026-09', '2026-10-15', '3a000000-0000-4000-8000-000000000001', 85000, 'COP', 'Aguas Demo Sabana · Ref. 12345678', '7c000000-0000-4000-8000-000000000004', 'completed', '7b000000-0000-4000-8000-000000000004', '2026-10-04 10:00:00-05', '2026-10-04 10:00:00-05')
ON CONFLICT DO NOTHING;

INSERT INTO public.saved_bills (id, user_id, biller_code, reference, created_at) VALUES
  ('3e000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'fac-acueducto', '12345678', '2026-10-04 10:00:00-05')
ON CONFLICT DO NOTHING;

COMMIT;
