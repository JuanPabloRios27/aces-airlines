# SkyCheck

**ACES Projects presenta:** SkyCheck, un sistema de automatización para la gestión de tiquetes, check-in y reserva de maletas, desarrollado bajo una arquitectura *serverless* en AWS para la asignatura de **Nube y Arquitectura Serverless** de la **Universidad El Bosque**.

---

## Funcionalidades

| # | Funcionalidad | Qué pasa | Endpoint | Lambda(s) | Servicios AWS |
| :- | :- | :- | :- | :- | :- |
| 1 | **Registrar maleta** | El pasajero registra su equipaje (cabina ≤ 10 kg, bodega ≤ 23 kg, máx. 3). Se revisa el peso en vivo y queda en estado `pendiente`. | `POST /maletas/revisar` · `POST /maletas` | `maleta-revisar`, `maleta-lambda` | API Gateway, Lambda, DynamoDB |
| 2 | **Confirmar maleta en check-in** | El agente pesa la maleta en el counter, pasa a `confirmada`, el comprobante se guarda en S3 y se avisa por correo. | `POST /maletas/{id}/confirmar` | `maleta-confirmacion` → `maleta-notification` | API Gateway, Lambda, DynamoDB, S3, SQS, SES |
| 3 | **Generar pasabordo y notificar** | Al hacer check-in se genera el pasabordo en PDF, se guarda en S3 y se envía adjunto por correo. | `POST /tickets/{id}/checkin` | `ticket-lambda` → `ticket-notification` | Lambda, S3, SQS, SES |
| 4 | **Modificar reserva** | Antes del check-in el pasajero cambia asiento (mapa del avión), nombre o teléfono y recibe un correo con los cambios. | `PUT /tickets/{id}` | `ticket-lambda` → `ticket-notification` | API Gateway, Lambda, DynamoDB, SQS, SES |
| 5 | **Cancelar tiquete con MFA** | Se envía un código de 6 dígitos (vence en 10 min, máx. 5 intentos, se guarda solo su hash). Con el código se cancela el tiquete y sus maletas. | `POST /tickets/{id}/cancelacion` · `POST /tickets/{id}/cancelacion/confirmar` | `cod-auth`, `elimina-ticket` → `ticket-notification` | API Gateway, Lambda, DynamoDB (TTL), SQS, SES |
| 6 | **Consultar estado** | El pasajero entra con código de reserva + correo y ve su reserva, sus maletas y su pasabordo. | `GET /tickets/{id}?correo=` | `ticket-lambda` | API Gateway, Lambda, DynamoDB |

Extra para administrar: `POST /tickets` y `GET /tickets` (crear y listar reservas, panel de agentes) y `GET /maletas?estado=pendiente`. Las rutas de agente piden el header `x-agent-key`.

---

## Arquitectura

```text
                 ┌──────────────── tickets-api (HTTP API) ─────────────────┐
 Navegador ────► │ $default ──────────────► aces-index (sirve el front)    │
   (front)       │ /tickets... ───────────► ticket-lambda, cod-auth,       │
     │           │                          elimina-ticket                 │──► DynamoDB: ticket-db,
     │           └──────────────────────────────────────────────────────────┘    autentification-db
     │           ┌──────────────── maleta-api (HTTP API, CORS) ────────────┐
     └─────────► │ /maletas... ───────────► maleta-lambda, maleta-revisar, │──► DynamoDB: maleta-db
                 │                          maleta-confirmacion            │──► S3: comprobantes
                 └──────────────────────────────────────────────────────────┘
   ticket-lambda ──► S3 (pasabordos PDF)
   lambdas ──► SQS queueTickets ──► ticket-notification ──► SES ──► correo del pasajero
   lambdas ──► SQS queueMaletas ──► maleta-notification ──► SES       (fallos → dead_petitions_queue)
```

* **Proveedor Cloud:** Amazon Web Services (AWS), región `us-east-2` (Ohio)
* **Lenguajes:** Python 3.12 (back) · HTML, CSS y JavaScript sin frameworks (front)
* **Infraestructura como código:** Terraform (`main.tf`)
* **Código compartido:** Lambda Layer `aces-comun` (`lambdas/comun/python/aces_comun.py`): respuestas HTTP, validaciones, correo y generador de PDF.
* **Front:** se publica como Lambda Layer `aces-web` y lo sirve la lambda `aces-index` en la raíz de `tickets-api`. El archivo `js/config.js` se genera con las URLs reales de las APIs, así que no hay que escribirlas a mano.

## Estructura del repositorio

```text
aces-airlines/
├── frontend/                 # Interfaz web (HTML + CSS + JS)
│   ├── index.html            # inicio: buscar reserva
│   ├── reserva.html          # F6 consultar estado
│   ├── maletas.html          # F1 registrar maletas
│   ├── checkin.html          # F3 check-in y pasabordo
│   ├── modificar.html        # F4 modificar reserva
│   ├── cancelar.html         # F5 cancelar con MFA
│   ├── agente.html           # F2 confirmar maletas + crear reservas (agentes)
│   ├── css/styles.css
│   └── js/                   # api.js, mock.js, ui.js + un .js por página
├── lambdas/
│   ├── comun/python/aces_comun.py   # layer compartido
│   ├── aces-index/                  # sirve el front
│   ├── funcionMaleta/               # maleta-lambda
│   ├── funcionMaletaRevisar/        # maleta-revisar
│   ├── funcionMaletaConfirmation/   # maleta-confirmacion
│   ├── funcionMaletaNoti/           # maleta-notification
│   ├── funcionTicket/               # ticket-lambda
│   ├── funcionCodAuth/              # cod-auth
│   ├── funcionEliminaTicket/        # elimina-ticket
│   └── funcionTicketNotification/   # ticket-notification
├── tests/
│   ├── test_backend.py       # pruebas de todos los flujos con AWS simulado (moto)
│   └── servidor_local.py     # corre el back real + el front en http://localhost:8000
├── main.tf                   # toda la infraestructura
├── terraform.tfvars.example
└── PLAN.md                   # quién hace qué
```

---

## Desplegar en AWS

Requisitos: [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5 y credenciales de AWS configuradas (`aws configure`).

```bash
cp terraform.tfvars.example terraform.tfvars   # y llena tus correos
terraform init
terraform validate
terraform apply
```

Al final imprime `url_web`: esa es la página de SkyCheck.

**Después del primer `apply`:**

1. **SES en sandbox:** a cada correo de `correo_remitente` y `correos_verificados` le llega un correo de AWS. Hay que darle clic al enlace de verificación. Mientras SES esté en sandbox, solo se puede enviar **a** correos verificados.
2. Entra a `url_web` → **Agentes** → clave (`agent_key`) → **Reservas** → crea una reserva con un correo verificado. El código llega a ese correo.
3. Con ese código y el correo, prueba todos los flujos desde el inicio.

> ¿La cuenta no deja crear roles IAM (AWS Academy)? Pon `rol_lambda_existente_arn` con el ARN del `LabRole` en `terraform.tfvars`.
>
> Para borrar todo: `terraform destroy`.

## Probar sin AWS

**Solo el front (modo demo):** abre `frontend/index.html` con doble clic o con Live Server. Usa datos falsos guardados en el navegador.
Reserva demo: `SKY7Q2M4K` / `laura@demo.co` · clave de agente: `aces-agente-2026`.

**Back real + front, en tu PC (AWS simulado):**

```bash
pip install boto3 "moto[dynamodb,s3,sqs,ses]" pytest
pytest -q tests/                  # pruebas de los 6 flujos
python tests/servidor_local.py    # abre http://localhost:8000
```

Los correos que se enviarían se imprimen en la consola, incluido el código MFA.
