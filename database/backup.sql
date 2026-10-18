-- Respaldo completo de payment_db (payment-service): esquema + datos de ejemplo (database/seed.sql).
-- Generado con pg_dump --no-owner --no-privileges. Restaurar en una base vacía:
--   psql "$DATABASE_URL" -f database/backup.sql

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: billers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billers (
    code character varying(40) NOT NULL,
    name character varying(80) NOT NULL,
    currency character varying(3) DEFAULT 'COP'::character varying NOT NULL,
    account_id uuid,
    account_number character varying(11),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(6) NOT NULL,
    biller_code character varying(40) NOT NULL,
    reference character varying(20) NOT NULL,
    period character varying(7),
    due_date date,
    source_account_id uuid NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency character varying(3) DEFAULT 'COP'::character varying NOT NULL,
    description character varying(140) NOT NULL,
    idempotency_key uuid NOT NULL,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    ledger_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    topup_type character varying(30)
);


--
-- Name: saved_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_bills (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    biller_code character varying(40) NOT NULL,
    reference character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: billers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billers (code, name, currency, account_id, account_number, updated_at) FROM stdin;
fac-acueducto	Acueducto de Bogotá	COP	3a000000-0000-4000-8000-0000000000a1	90000000001	2026-10-01 13:00:00+00
\.


--
-- Data for Name: payment_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_requests (id, user_id, kind, biller_code, reference, period, due_date, source_account_id, amount, currency, description, idempotency_key, status, ledger_transaction_id, created_at, updated_at, topup_type) FROM stdin;
3e000000-0000-4000-8000-000000000001	11111111-1111-4111-8111-111111111111	bill	fac-acueducto	12345678	2026-09	2026-10-15	3a000000-0000-4000-8000-000000000001	85000.00	COP	Acueducto de Bogotá · Ref. 12345678	7c000000-0000-4000-8000-000000000004	completed	7b000000-0000-4000-8000-000000000004	2026-10-04 15:00:00+00	2026-10-04 15:00:00+00	\N
\.


--
-- Data for Name: saved_bills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.saved_bills (id, user_id, biller_code, reference, created_at) FROM stdin;
3e000000-0000-4000-8000-0000000000b1	11111111-1111-4111-8111-111111111111	fac-acueducto	12345678	2026-10-04 15:00:00+00
\.


--
-- Name: saved_bills PK_8c03b089d4a5a2601df632cb49e; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_bills
    ADD CONSTRAINT "PK_8c03b089d4a5a2601df632cb49e" PRIMARY KEY (id);


--
-- Name: payment_requests PK_9299e570c6d9babbe54752e16ec; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT "PK_9299e570c6d9babbe54752e16ec" PRIMARY KEY (id);


--
-- Name: billers PK_d0302d8ecc59e27423eead559f7; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billers
    ADD CONSTRAINT "PK_d0302d8ecc59e27423eead559f7" PRIMARY KEY (code);


--
-- Name: IDX_9e5abe228a909135bd1a689376; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_9e5abe228a909135bd1a689376" ON public.payment_requests USING btree (idempotency_key);


--
-- Name: idx_payment_requests_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_requests_user_created ON public.payment_requests USING btree (user_id, created_at);


--
-- Name: uq_payment_requests_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payment_requests_bill ON public.payment_requests USING btree (biller_code, reference, period) WHERE (((kind)::text = 'bill'::text) AND ((status)::text = ANY (ARRAY[('processing'::character varying)::text, ('completed'::character varying)::text])));


--
-- Name: uq_saved_bills_user_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_saved_bills_user_bill ON public.saved_bills USING btree (user_id, biller_code, reference);


--
-- PostgreSQL database dump complete
--


