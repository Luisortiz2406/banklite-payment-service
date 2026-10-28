# Payment Service (`payment-service`)

[![Despliegue](https://github.com/Luisortiz2406/banklite-payment-service/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/Luisortiz2406/banklite-payment-service/actions/workflows/deploy.yml)

Pagos del cliente: facturas de servicios (de demostración), recargas de celular, facturas inscritas y pagos QR a comercios.

Parte de **BankLite**, banco digital académico construido con microservicios. Cada
microservicio tiene su propia base de datos y se comunica con los demás por HTTP
(red interna) o por eventos en RabbitMQ.

## Responsabilidad dentro de la arquitectura

Orquesta los pagos a terceros con el mismo patrón de dos pasos que las transferencias:
**preparar** (el servicio fija el monto de la factura, valida la referencia y la cuenta)
y **confirmar** con la clave dinámica, que registra el pago en ledger-service hacia la
cuenta de comercio del convenio. También procesa las recargas que se pagan con puntos
(las pide rewards-service).

**Reglas de negocio principales**

- El monto de una factura lo fija el servicio, no el cliente; referencia de 6 a 14 dígitos; recargas a un celular de 10 dígitos que empiece por 3.
- Una factura se paga **una sola vez por periodo** (`YYYY-MM`).
- Recargas entre el mínimo y el máximo publicados en `GET /payments/catalog`.
- Confirmación con clave dinámica e `idempotencyKey` hacia el ledger.
- Las facturas son de demostración: no hay conexión con convenios reales y se dice en la interfaz.

**Comunicación con otros servicios**

| | |
|---|---|
| Publica eventos | — |
| Consume eventos | — |
| Llama a | account-service: cuenta origen y cuenta del convenio<br>ledger-service: pagos y canjes<br>auth-service: clave dinámica |
| Lo llaman | rewards-service: `POST /internal/payments/reward-topups`<br>api-gateway (rutas `/payments/*`) |
| Integraciones externas | — |

Todo el tráfico externo entra por el **api-gateway** (único servicio público), que
enruta por prefijo (`/payments`), aplica CORS y límite de peticiones, y bloquea las
rutas internas.

## Tecnologías

- Node.js 20, NestJS 10 y TypeScript
- PostgreSQL con TypeORM (`synchronize: true`: las tablas se crean desde las entidades)
- JWT (`@nestjs/jwt`) y `class-validator` para validar todo lo que entra
- Docker (imagen `node:20-alpine`) y despliegue en Railway

## Base de datos (`payment_db`)

| Tabla | Contenido |
|---|---|
| `billers` | Convenios (código, nombre y cuenta de comercio). |
| `payment_requests` | Pagos y recargas, estado y transacción del ledger. |
| `saved_bills` | Facturas inscritas por el cliente. |

En `database/`:

| Archivo | Qué es |
|---|---|
| `schema.sql` | Esquema (tablas, índices, restricciones), generado con `pg_dump --schema-only` desde la base que crea TypeORM. |
| `seed.sql` | Datos de ejemplo de un escenario de demo compartido por todos los servicios (clientes ficticios Ana y Carlos, con los mismos UUID en todas las bases). |
| `backup.sql` | Respaldo completo (esquema + datos de ejemplo) listo para restaurar. |

Restaurar en una base vacía:

```bash
createdb payment_db
psql "postgres://usuario:clave@localhost:5432/payment_db" -f database/backup.sql
# o, por partes:
psql "$DATABASE_URL" -f database/schema.sql -f database/seed.sql
```

Si se arranca el servicio con una base vacía, TypeORM crea las tablas solo.

## Instalación y ejecución

Requisitos: Node.js 20, PostgreSQL 16.

```bash
npm ci
cp .env.example .env     # completa los secretos (ver abajo)
npm run start:dev        # desarrollo, recarga al guardar
# producción:
npm run build && npm run start:prod
```

Con Docker:

```bash
docker build -t banklite-payment-service .
docker run --env-file .env -p 3011:3011 banklite-payment-service
```

El sistema completo (los 12 servicios, Postgres, RabbitMQ y el gateway) se levanta
desde el repositorio principal con `docker compose up -d --build`.

Comprobar: `curl http://localhost:3011/health`

## Endpoints principales

A través del gateway las rutas son las mismas (`http://localhost:8080/payments/...`).

### Públicos (sin sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio y de su base (`SELECT 1`); responde 503 con `status: down` si la base no contesta. |
| GET | `/payments/catalog` | Rango y tipos de recarga. |

### Del cliente (`Authorization: Bearer <token de acceso>`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/payments/billers` | Convenios disponibles. |
| GET | `/payments/bills` | Consulta una factura por convenio y referencia. |
| GET | `/payments/qr/stores` | Comercios para pago QR. |
| GET | `/payments/saved-bills` | Facturas inscritas. |
| POST | `/payments/saved-bills` | Inscribe una factura. |
| DELETE | `/payments/saved-bills/:id` | Elimina una factura inscrita. |
| GET | `/payments` | Historial de pagos. |
| POST | `/payments/prepare` | Prepara un pago (factura, recarga o QR). |
| POST | `/payments/:id/confirm` | Confirma con la clave dinámica y paga en el ledger. |
| POST | `/payments/:id/cancel` | Cancela un pago pendiente. |

### Internos (solo red privada, `x-internal-key`; el gateway responde 404 desde afuera)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/internal/payments/reward-topups` | Recarga pagada con puntos (rewards-service). |

## Variables de entorno

Ver `.env.example`. Los secretos se generan con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (uno distinto
por variable). El servicio **no arranca** si un secreto falta, es corto, es un valor de
ejemplo o se repite entre dos variables (`src/config/env.validation.ts`). En Railway
todas se configuran como variables del servicio, nunca en el código.

| Variable | Obligatoria | Ejemplo / por defecto | Para qué sirve |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` en local; `production` en Railway (lo fija el Dockerfile). |
| `PORT` | No | `3011` | Puerto HTTP del servicio. |
| `DATABASE_URL` | **Sí** (no arranca sin ella) | `postgres://payment_svc:<DB_PASSWORD_PAYMENT>@localhost:5432/payment_db` | Conexión a PostgreSQL de **su** base (rol propio, sin acceso a las demás). |
| `JWT_SECRET` | **Sí** (no arranca sin ella) | — | Firma de los JWT de clientes (el mismo valor que en auth-service). |
| `ACCOUNT_SERVICE_URL` | Sí | `http://localhost:3002` | URL interna de account-service. |
| `LEDGER_SERVICE_URL` | Sí | `http://localhost:3006` | URL interna de ledger-service. |
| `AUTH_SERVICE_URL` | Sí | `http://localhost:3001` | URL interna de auth-service. |
| `INTERNAL_API_KEY` | **Sí** (no arranca sin ella) | — | Clave interna **propia** de este servicio; la manda en `x-internal-key` al llamar a otros. |
| `INTERNAL_TRUSTED_KEYS` | No | — | Claves internas que acepta, `servicio:clave,servicio:clave` (ver `InternalKeyGuard`). |
| `HTTP_READ_RETRIES` | No | `1` | Reintentos de las lecturas (GET) a otros servicios; las escrituras no se reintentan. |

## Pruebas

Pruebas de reglas de negocio (Jest): una factura se paga una sola vez por periodo (también con dos pagos simultáneos), monto fijado por la factura, clave dinámica, reintento con la misma clave, rango de recargas y recargas con puntos (cancelada solo si el ledger la rechaza).

Corren contra un PostgreSQL real, porque esas reglas dependen de transacciones,
bloqueos e índices únicos. Cada corrida crea una base temporal y la borra al terminar:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

Sin `TEST_DATABASE_URL` se omiten en local; en la CI son obligatorias (el workflow
levanta un Postgres de servicio).

## Despliegue

Lo despliega **GitHub Actions** (`.github/workflows/deploy.yml`, que usa el workflow
reutilizable de [banklite-pipelines](https://github.com/Luisortiz2406/banklite-pipelines)):

1. **test**: lint, formato, build y pruebas con Postgres (también en cada pull request).
2. **docker** (solo `main`): imagen en GHCR `ghcr.io/luisortiz2406/banklite-payment-service`,
   etiquetada con el SHA del commit y `latest` (se guardan las últimas 5).
3. **deploy** (solo `main`): `railway up --ci` sube el commit a Railway, que lo
   construye con el `Dockerfile` y aplica `railway.json` (health check en `/health`);
   el job espera a que el despliegue quede activo.

El repositorio está desconectado del autodeploy de Railway: un push a `main` despliega
solo a través de este pipeline, y únicamente si las pruebas pasan. Rollback: panel de
Railway → *Deployments* → versión anterior → *Rollback*. El servicio no tiene dominio público propio: se accede
por el gateway.

- Estado del servicio y de su base: [https://api-gateway-production-dd7f.up.railway.app/health](https://api-gateway-production-dd7f.up.railway.app/health) (entrada `payment-service`: `status` y `database` deben estar en `ok`)
- Endpoint público de prueba: https://api-gateway-production-dd7f.up.railway.app/payments/catalog
- Rutas de este servicio: `https://api-gateway-production-dd7f.up.railway.app/payments/...`
- Aplicación web: https://frontend-production-eff3c.up.railway.app

## Repositorios relacionados

Servicios de BankLite con los que se comunica este. **Llama a** / **Lo llama**: HTTP
por la red interna; **Recibe** / **Envía**: eventos en RabbitMQ. Cada uno vive y se
despliega desde su propio repositorio.

| Repositorio | Relación con este servicio |
|---|---|
| [banklite-api-gateway](https://github.com/Luisortiz2406/banklite-api-gateway) | **Lo llama:** punto de entrada público, le enruta las rutas de este servicio |
| [banklite-account-service](https://github.com/Luisortiz2406/banklite-account-service) | **Llama a:** cuenta origen y cuenta del convenio |
| [banklite-ledger-service](https://github.com/Luisortiz2406/banklite-ledger-service) | **Llama a:** pagos, recargas y canjes |
| [banklite-auth-service](https://github.com/Luisortiz2406/banklite-auth-service) | **Llama a:** verificación de la clave dinámica |
| [banklite-rewards-service](https://github.com/Luisortiz2406/banklite-rewards-service) | **Lo llama:** recargas pagadas con puntos (`/internal/payments/reward-topups`) |
