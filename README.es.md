# FlowOps

[English](README.md) · **Español**

Flujos de aprobación para equipos de operaciones de múltiples organizaciones: las solicitudes de compras, gastos y accesos llegan a los responsables adecuados, en orden y con un registro de cada decisión.

> **Estado: MVP completo, sin desplegar.** Las cuentas, las organizaciones, la gestión de personas, los flujos de aprobación versionados y el ciclo completo de una solicitud (envío, aprobación, rechazo y auditoría) funcionan de principio a fin y se ejecutan en local con un solo comando. Consulta el [Plan de desarrollo](#plan-de-desarrollo).

![Django](https://img.shields.io/badge/Django-6.1-0C4B33) ![React](https://img.shields.io/badge/React-19-149ECA) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791) ![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue)

## Funcionalidades disponibles

- **Inicio de sesión** con correo y contraseña. Sesiones en el servidor, protección CSRF (incluido el inicio de sesión) y limitación de intentos fallidos.
- **Organizaciones y roles.** Crea organizaciones, cambia entre aquellas a las que perteneces y consulta tu rol (propietario, administrador o miembro).
- **Aislamiento entre organizaciones.** Cada solicitud se ejecuta en el contexto de una organización. Las solicitudes de datos de otras organizaciones reciben un `404`.
- **Permisos por rol.** Los miembros pueden consultar; los administradores y propietarios gestionan personas, flujos y configuración; solo los propietarios gestionan a otros propietarios.
- **Invitaciones.** Los administradores invitan por correo. Los enlaces funcionan una sola vez, caducan a los 7 días y solo para la dirección invitada; las personas nuevas crean su cuenta al aceptar.
- **Gestión de miembros.** Cambia roles, elimina miembros o abandona una organización. Siempre queda al menos un propietario, incluso con cambios simultáneos.
- **Plantillas de flujo.** Define quién aprueba cada tipo de solicitud y en qué orden, con un constructor visual de pasos y una vista previa de la ruta en tiempo real. Las plantillas tienen versiones: los administradores editan un borrador y lo publican, las versiones publicadas no cambian y los miembros solo ven las rutas publicadas.
- **Solicitudes y aprobaciones.** Crea un borrador y envíalo; sigue, paso a paso, la versión del flujo con la que se envió. Los aprobadores deciden desde su bandeja, un rechazo exige un motivo y una solicitud rechazada puede duplicarse como borrador nuevo. Nadie puede aprobar su propia solicitud, sea cual sea su rol. Si dos personas deciden el mismo paso a la vez, solo cuenta una decisión y la otra persona recibe un aviso.
- **Decisión de un administrador.** Si ya nadie puede decidir un paso (el aprobador se fue o cambió de rol), un administrador distinto del solicitante puede decidirlo con un comentario obligatorio, que queda registrado como decisión de administrador. Los administradores reciben un aviso cuando un paso se queda sin ningún aprobador posible.
- **Personas que se van.** Sus solicitudes se conservan y los aprobadores pueden seguir decidiéndolas. Un administrador puede cancelar una de esas solicitudes mientras está en revisión, con un motivo obligatorio que queda en la auditoría; las solicitudes de miembros activos solo las cancela quien las creó.
- **Registro de auditoría.** Los cambios en solicitudes, las decisiones, los comentarios y los cambios de miembros y de flujos quedan en un registro de solo inserción: por solicitud para quien puede verla y de toda la organización para los administradores.
- **Bandeja y notificaciones.** Los pasos que esperan tu decisión, un contador en la navegación y notificaciones en la aplicación sobre asignaciones, resultados y comentarios.
- **Aplicación web.** Interfaz adaptable en React con estados de carga, ausencia de datos, error y permisos, navegación por teclado y comprobaciones automatizadas de accesibilidad.
- **Operación básica.** Rutas de comprobación de funcionamiento y disponibilidad, registros JSON con identificadores de solicitud, errores según RFC 9457 y documentación OpenAPI en `/api/docs/`.

## Arquitectura

```mermaid
flowchart LR
    B[Navegador<br/>SPA en React] -->|mismo origen| N[nginx<br/>archivos estáticos + proxy inverso]
    N -->|/api, /health| A[Django + DRF<br/>gunicorn]
    A --> P[(PostgreSQL 18)]
    A --> R[(Redis<br/>caché + limitación de solicitudes)]
```

| Capa | Responsabilidad |
|---|---|
| `backend/apps/accounts` | Usuarios identificados por correo, inicio y cierre de sesión, limitación de intentos de acceso |
| `backend/apps/organizations` | Organizaciones, membresías, roles, resolución de la organización, permisos e invitaciones |
| `backend/apps/workflows` | Plantillas de flujo, versiones y pasos de aprobación |
| `backend/apps/requests` | Solicitudes, tareas de aprobación, comentarios, máquina de estados, reglas de elegibilidad y bandeja |
| `backend/apps/audit` | Eventos de auditoría de solo inserción y la API de auditoría para administradores |
| `backend/apps/notifications` | Notificaciones en la aplicación |
| `backend/common` | Errores con detalles del problema, middleware de identificadores de solicitud, registros JSON y comprobaciones de funcionamiento |
| `frontend/src` | Aplicación React: cliente de API generado desde OpenAPI, contexto de sesión y organización, páginas |

En cada aplicación Django, las **vistas** solo gestionan HTTP, los **servicios** realizan escrituras dentro de transacciones y los **selectores** realizan lecturas limitadas a la organización actual.

### Decisiones técnicas

- [ADR-0001 Múltiples organizaciones: esquema compartido y aislamiento aplicado por la aplicación](docs/adr/0001-multi-tenancy.md)
- [ADR-0002 Autenticación: sesiones en el servidor con CSRF para una SPA del mismo origen](docs/adr/0002-authentication.md)
- [ADR-0003 Versiones del entorno de ejecución y las herramientas](docs/adr/0003-runtime-and-tooling-versions.md)
- [ADR-0004 Invitaciones y protección del propietario](docs/adr/0004-invitations-and-owner-protection.md)
- [ADR-0005 Plantillas de flujo versionadas en lugar de un motor de flujos genérico](docs/adr/0005-versioned-workflow-templates.md)
- [ADR-0006 Máquina de estados de las solicitudes y control de concurrencia](docs/adr/0006-request-state-machine-and-concurrency.md) (en inglés)
- [ADR-0007 Registro de auditoría de solo inserción](docs/adr/0007-append-only-audit-log.md) (en inglés)

## Inicio rápido

Requisitos: Docker con Compose v2 y `make`. Para ejecutar las pruebas del frontend o de extremo a extremo fuera de Docker, también necesitas Node.js 22 o superior.

```bash
git clone https://github.com/leonardogr15/flowops.git
cd flowops
make demo   # crea .env con secretos locales aleatorios, compila, inicia y carga datos de demostración
```

`make` usa `python3`, `python` o `py`, el que exista. Sin `make` (por ejemplo, en Windows sin herramientas adicionales), ejecuta directamente los mismos pasos:

```bash
python scripts/make_env.py
docker compose up -d --build --wait
docker compose exec api python manage.py seed_demo
```

Abre <http://localhost:8080>. Documentación de la API: <http://localhost:8080/api/docs/>.

> Los servicios de Compose son una **demostración local**: la API utiliza el servidor de desarrollo de Django con `DEBUG` activado, los puertos se vinculan a `127.0.0.1` y las cookies no llevan `Secure` porque se usa HTTP sin cifrar. No es una configuración de despliegue. La imagen de producción (`backend/Dockerfile`, etapa `runtime`) usa gunicorn con `config.settings.prod` y se construye en integración continua (CI). La administración de Django no se expone mediante nginx; localmente está en <http://localhost:8000/admin/>.

### Cuentas de demostración

Todos los usuarios de demostración comparten la contraseña almacenada como `DEMO_PASSWORD` en el archivo `.env` generado. Las personas y empresas son ficticias.

| Correo electrónico | Organización | Rol |
|---|---|---|
| `olivia.owner@flowops.test` | Orbital Supplies Co. | Propietaria |
| `adam.admin@flowops.test` | Orbital Supplies Co. | Administrador |
| `maya.member@flowops.test` | Orbital Supplies Co. | Miembro |
| `raj.approver@flowops.test` | Orbital Supplies Co. / Kestrel Analytics | Miembro / Administrador |
| `kim.owner@flowops.test` | Kestrel Analytics | Propietaria |

Inicia sesión como Maya y Adam para ver las diferencias de permisos en las páginas de miembros, flujos y configuración. Raj puede cambiar entre dos organizaciones. La demostración incluye un flujo publicado, un borrador y solicitudes en todos los estados. Para seguir una aprobación completa, envía una solicitud como Maya y apruébala como Raj (paso 1), Adam (paso 2) y Olivia (paso 3); cada paso aparece en la bandeja de esa persona. Los correos de invitación se muestran en el registro de la API (`docker compose logs api`); el diálogo de invitación también muestra el enlace una vez.

## Descripción de la API

Todas las rutas están bajo `/api/v1/`. Los métodos no seguros requieren la cabecera `X-CSRFToken`. Las rutas vinculadas a una organización requieren `X-Organization: <slug de la organización>`.

| Método y ruta | Autenticación | Limitado a una organización | Miembro | Administrador | Propietario |
|---|---|---|:-:|:-:|:-:|
| `GET /auth/csrf` | ninguna | no | – | – | – |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | sesión | no | – | – | – |
| `GET /organizations` (mis organizaciones) · `POST /organizations` (crear y convertirse en propietario) | sesión | no | – | – | – |
| `GET /org` | sesión | sí | sí | sí | sí |
| `PATCH /org` (cambiar nombre) | sesión | sí | no (403) | sí | sí |
| `GET /org/members` | sesión | sí | sí | sí | sí |
| `PATCH /org/members/{id}` (rol) · `DELETE /org/members/{id}` | sesión | sí | solo abandonar | sí¹ | sí |
| `GET /org/invitations` · `POST /org/invitations` · `DELETE /org/invitations/{id}` | sesión | sí | no (403) | sí | sí |
| `GET /invitations/{token}` · `POST /invitations/{token}/accept` | el token | no | – | – | – |
| `GET /org/workflow-templates` · `GET /org/workflow-templates/{id}` | sesión | sí | solo publicados | sí | sí |
| `POST /org/workflow-templates` · `PATCH …/{id}` · `PUT …/{id}/draft` · `POST …/{id}/publish` | sesión | sí | no (403) | sí | sí |
| `GET /org/requests` (`scope`, `status`) · `GET /org/requests/{id}` | sesión | sí | propias y en las que participa² | todas | todas |
| `POST /org/requests` · `PATCH /org/requests/{id}` (borrador) · `POST …/{id}/submit` · `…/cancel`⁴ · `…/duplicate` | sesión | sí | solicitante | solicitante | solicitante |
| `POST /org/requests/{id}/approve` · `…/reject` (cuerpo: `step`, `comment`) | sesión | sí | elegible³ | elegible³ | elegible³ |
| `GET` y `POST /org/requests/{id}/comments` · `GET …/{id}/timeline` | sesión | sí | si puede verla | sí | sí |
| `GET /org/inbox`⁵ · `GET /org/notifications` · `GET …/unread` · `POST …/{id}/read` | sesión | sí | propias | propias | propias |
| `GET /org/audit-events` | sesión | sí | no (403) | sí | sí |

¹ Los administradores no pueden otorgar, cambiar ni quitar el rol de propietario; solo los propietarios pueden. El último propietario nunca puede degradarse ni eliminarse (`409`).

² Solicitudes que el miembro creó o en las que es o fue aprobador. Las demás devuelven `404`.

³ El miembro indicado, o cualquiera con el rol del paso o superior; nunca el solicitante. Si nadie es elegible, deciden los administradores y propietarios distintos del solicitante, con un comentario obligatorio. Un `step` o una `revision` desactualizados devuelven `409`; enviar cuando un paso no tiene ningún aprobador posible devuelve `422` (`urn:flowops:problem:no_eligible_approver`).

⁴ Los administradores y propietarios también pueden cancelar una solicitud en revisión cuyo solicitante ya no es miembro, con un `reason` obligatorio que se escribe en la auditoría. Con solicitudes de miembros activos reciben `403`.

⁵ Devuelve `{count, results, limit}`: cuenta todas las tareas abiertas que esperan tu decisión y lista las `limit` (200) más antiguas.

Códigos de estado: `401` si no has iniciado sesión, `403` si tu rol no tiene permiso, `404` para organizaciones a las que no perteneces (indistinguibles de las que no existen) y `400` si falta la cabecera de organización. Los errores usan `application/problem+json`.

## Seguridad

| Control | Ubicación |
|---|---|
| Cookie de sesión con `HttpOnly`, `SameSite=Lax` y `Secure` fuera del desarrollo local | `config/settings/base.py` |
| CSRF en cada solicitud no segura, incluido el inicio de sesión | `apps/accounts/api/views.py` |
| Contraseñas con hash Argon2 y longitud mínima de 12 caracteres | `config/settings/base.py` |
| Error genérico para correo desconocido, contraseña incorrecta y usuario inactivo | `LoginView` |
| Límite de intentos de acceso por (IP del cliente, correo) y por IP para todos los correos; número de proxies de confianza para evitar la suplantación de `X-Forwarded-For`; hashes de los correos en las claves de limitación | `apps/accounts/throttles.py`, `NUM_PROXIES` |
| Las solicitudes entre organizaciones devuelven 404; las pruebas de aislamiento cubren cada ruta, incluidos identificadores de objetos de otra organización | `apps/organizations/tests/test_isolation.py` |
| Tokens de invitación: 256 bits aleatorios, guardados solo como SHA-256, de un solo uso, caducan a los 7 días y están ligados al correo invitado; reinvitar revoca el enlace anterior | `apps/organizations/members.py` |
| Los tokens de invitación nunca llegan a los registros: los registros de Django, el registro de acceso de nginx (ruta y `Referer`) y los mensajes de error muestran `[redacted]`; el registro de acceso de gunicorn está desactivado (Django registra cada solicitud). La CI falla si aparece un token en los registros del entorno de extremo a extremo | `common/redaction.py`, `frontend/nginx.conf`, `.github/workflows/ci.yml` |
| Enviar invitaciones (30 por hora) y crear organizaciones (5 por hora) tienen límite por usuario, para que una cuenta no sirva para enviar correos masivos; al superarlo se responde `429` con `Retry-After` | `common/throttling.py`, `config/settings/base.py` |
| Los cambios de rol vuelven a leer al miembro que actúa y bloquean las filas de propietarios, de modo que degradaciones simultáneas no pueden dejar la organización sin propietario | `apps/organizations/members.py` |
| Las transiciones de una solicitud se ejecutan con bloqueos de fila en un orden fijo (plantilla, solicitud, tarea abierta). Las decisiones indican el paso actual y el envío la revisión actual, así que dobles clics, reintentos y decisiones simultáneas se aplican una sola vez | `apps/requests/services.py`, ADR-0006 |
| El solicitante nunca decide su propia solicitud, tampoco si es administrador o propietario; la decisión de un administrador exige un comentario y queda marcada en la auditoría | `apps/requests/policy.py` |
| Los eventos de auditoría se escriben en la misma transacción que el cambio; una protección en el modelo y un trigger de PostgreSQL impiden modificarlos o borrarlos (resistente a manipulación, no inmutable criptográficamente) | `apps/audit/`, ADR-0007 |
| La visibilidad de las solicitudes se aplica en las consultas: quien no participa recibe `404`, y se ocultan las notificaciones de solicitudes que ya no puede ver | `apps/requests/policy.py`, `apps/notifications/` |
| Las versiones publicadas de un flujo son inmutables (en los servicios y en el modelo); al publicar se comprueba de nuevo que los aprobadores siguen siendo miembros | `apps/workflows/` |
| La configuración de producción no arranca sin un `EMAIL_BACKEND` explícito, para que los enlaces de invitación nunca acaben en los registros a través del backend de consola local | `config/settings/prod.py` |
| Permisos denegados por defecto; comprobación de roles en el servidor, nunca solo en la interfaz | `apps/organizations/permissions.py` |
| Identificadores públicos UUIDv7 (sin identificadores secuenciales en las URL) | `common/models.py` |
| CSP (incluido `object-src 'none'`), `X-Frame-Options`, `nosniff` y `Referrer-Policy` en cada respuesta; la administración de Django no se enruta por el punto de entrada público | `frontend/security-headers.conf`, `frontend/nginx.conf` |
| Contenedores ejecutados sin privilegios de root; secretos únicamente mediante variables de entorno | Archivos `Dockerfile`, `.env.example` |
| Búsqueda de secretos en todo el historial de Git y el directorio de trabajo en CI | `.github/workflows/ci.yml` (gitleaks) |

Para informar de una vulnerabilidad, consulta [SECURITY.md](SECURITY.md).

## Pruebas

| Conjunto de pruebas | Comando | Cobertura |
|---|---|---|
| Backend | `make test-api` | Autenticación, CSRF, limitación de solicitudes, organizaciones, matrices de permisos, aislamiento entre organizaciones, invitaciones, protección del último propietario con concurrencia, versiones de flujos, máquina de estados de las solicitudes, decisiones simultáneas sobre PostgreSQL real, autoaprobación, decisión de administrador, trigger de auditoría y reversión. Cobertura mínima: 85 % |
| Análisis estático y tipos del backend | `make lint-api` | ruff, mypy (modo estricto, con complementos de Django y DRF) |
| Frontend | `make test-web` | Inicio de sesión, redirecciones, cambio de organización, configuración, miembros y roles, invitaciones y aceptación, constructor y publicación de flujos, solicitudes (crear, enviar, aprobar, rechazar, decisión simultánea perdida), bandeja, notificaciones, registro de auditoría, comprobaciones de accesibilidad con axe |
| Análisis estático y tipos del frontend | `make lint-web` | oxlint (las advertencias provocan fallos), TypeScript estricto |
| Extremo a extremo | `make e2e-up` y después `make e2e` | Playwright con tamaños de pantalla de escritorio y móvil contra los servicios reales: inicio de sesión, sesión caducada que vuelve a la misma página, invitar y unirse, crear y publicar un flujo, una solicitud aprobada por Raj, Adam y Olivia con su auditoría completa, rechazo y duplicado, autoaprobación rechazada en la interfaz y en la API, y dos administradores decidiendo el mismo paso a la vez |
| Contrato | `make schema-check` | El esquema OpenAPI versionado coincide con el código; los tipos TypeScript generados coinciden con el esquema (CI) |

El flujo de CI (`.github/workflows/ci.yml`) ejecuta estas comprobaciones con cada envío de cambios y solicitud de integración, además de ejecutar gitleaks sobre todo el historial.

`make e2e-up` levanta un proyecto Compose separado (`flowops-e2e`, con su propia base de datos) a partir de `docker-compose.e2e.yml`, así que los datos de prueba nunca se mezclan con la demo; detén antes la demo (`make down`), porque ambos usan los mismos puertos. La API usa la imagen de producción con gunicorn, sin montar el código fuente ni el recargador automático de desarrollo, así que editar archivos durante las pruebas no puede reiniciar el servidor a mitad de una prueba. `make e2e` lee `DEMO_PASSWORD` de `.env`. `make e2e-reset` borra solo la base de datos de extremo a extremo. Ejecuta `make web-install` una vez antes de los objetivos de frontend y de extremo a extremo; `make help` lista todos los objetivos.

## Estructura del proyecto

```
backend/        Proyecto Django (config/, apps/, common/), openapi.yaml, Dockerfile
frontend/       Aplicación React (src/), pruebas Playwright (e2e/), configuración nginx, Dockerfile
docs/adr/       Registros de decisiones de arquitectura
scripts/        Scripts auxiliares para uso local
```

## Plan de desarrollo

| Hito | Alcance | Estado |
|---|---|---|
| Bases | Cuentas, organizaciones, aislamiento, permisos y estructura de la aplicación | **Completado** |
| Personas | Invitaciones por correo, gestión de miembros y protección del último propietario | **Completado** |
| Flujos de trabajo | Plantillas versionadas con pasos de aprobación ordenados | **Completado** |
| Solicitudes | Enviar, aprobar, rechazar y comentar; máquina de estados con protección ante concurrencia; registro de auditoría; notificaciones en la aplicación | **Completado** |
| Notificaciones | Notificaciones por correo | Planificado |
| Refuerzo de seguridad | Seguridad por fila en PostgreSQL, inicio de sesión con OIDC y límites de solicitudes por organización | Más adelante |

## Licencia

[MIT](LICENSE) © 2026 Leonardo Galvis
