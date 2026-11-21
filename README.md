# SkyCheck

**ACES Projects presenta:** SkyCheck, un sistema de automatización para la gestión de tiquetes, check-in y reserva de maletas, desarrollado bajo una arquitectura *serverless* en AWS para la asignatura de **Nube y Arquitectura Serverless** de la **Universidad El Bosque**.

---

## Funcionalidades

El sistema implementa seis flujos principales orientados a eventos:

| # | Funcionalidad | Descripción | Servicios AWS |
| :--- | :--- | :--- | :--- |
| 1 | **Registrar maleta** | El pasajero registra su equipaje asociado a una reserva y queda guardado con estado `pendiente`. | API Gateway, Lambda, DynamoDB |
| 2 | **Confirmar maleta en check-in** | Durante el check-in se confirma la maleta, su estado cambia a `confirmada` y se guarda el comprobante. | API Gateway, Lambda, DynamoDB, S3 |
| 3 | **Generar pasabordo y notificar** | Al completar el check-in se genera el pasabordo en formato PDF y se envía por correo electrónico. | Lambda, S3, SQS, SES |
| 4 | **Modificar reserva** | El pasajero actualiza datos de su reserva (asiento, contacto o maletas) antes del check-in y recibe notificación por correo. | API Gateway, Lambda, DynamoDB, SQS, SES |
| 5 | **Cancelar tiquete con MFA** | El pasajero solicita la cancelación, recibe un código de verificación por correo y solo con ese código se confirma la cancelación definitiva. | API Gateway, Lambda, DynamoDB, SQS, SES |
| 6 | **Consultar estado** | El pasajero consulta el estado actual de su reserva y de su equipaje. | API Gateway, Lambda, DynamoDB |

---

## Arquitectura y Stack Tecnológico

* **Proveedor Cloud:** Amazon Web Services (AWS)
* **Lenguaje:** Python 3.11 y javascript
* **Infraestructura como Código (IaC):** Terraform (`main.tf`)
* **Servicios principales:**
  * **Amazon API Gateway:** Exposición de endpoints REST para consumo desde clientes (Postman o interfaz web).
  * **AWS Lambda:** Ejecución de la lógica de negocio sin servidores (pago por uso).
  * **Amazon DynamoDB:** Almacenamiento NoSQL para reservas, maletas y códigos de autenticación MFA.
  * **Amazon S3:** Almacenamiento de comprobantes y pasabordos generados.
  * **Amazon SQS:** Colas de mensajería para desacoplar y gestionar las peticiones de notificación.
  * **Amazon SES:** Envío de correos electrónicos de confirmación, notificaciones y códigos MFA.

---

## Componentes del Sistema

| Servicio | Nombre | Descripción |
| :--- | :--- | :--- |
| API Gateway | `maleta-api` | Punto de entrada para la gestión y confirmación de maletas. |
| API Gateway | `ticket-api` | Punto de entrada para la gestión, consulta y cancelación de tiquetes. |
| Lambda | `aces-index` | Interfaz web, sesión donde se hace el respectivo check-in y registro de maletas para ser comprobadas de parte de los usuarios y gerentes de la aerolinea. |
| Lambda | `maleta-lambda` | Lógica de creación y modificación de registros de maletas en la base de datos. |
| Lambda | `maleta-confirmacion` | Lógica para confirmar el equipaje durante el check-in y almacenar su comprobante. |
| Lambda | `ticket-lambda` | Lógica de creación, modificación y cancelación definitiva de tiquetes. |
| Lambda | `cod-auth` | Generación y validación de códigos de autenticación (MFA) para cancelaciones. |
| Lambda | `maleta-notificacion` | Prepara la notificación de maletas para su envío por correo. |
| Lambda | `ticket-notificacion` | Prepara la notificación de tiquetes y pasabordos para su envío por correo. |
| DynamoDB | `maleta-db` | Tabla con los registros de maletas. |
| DynamoDB | `ticket-db` | Tabla con los registros de tiquetes y reservas. |
| DynamoDB | `auth-ticket` | Tabla para almacenar y validar los códigos temporales de autenticación MFA. |
| S3 | `maleta-almacen` | Bucket para almacenar comprobantes y registros de maletas. |
| S3 | `ticket-almacen` | Bucket para almacenar pasabordos y registros de tiquetes. |
| SQS | `peticion-maleta` | Cola de mensajes para encolar notificaciones relacionadas con maletas. |
| SQS | `peticion-ticket` | Cola de mensajes para encolar notificaciones y códigos MFA de tiquetes. |
| SES | `envio-correo` | Servicio encargado del envío de correos electrónicos a los pasajeros. |

---

## Estructura del Repositorio

```text
aces-airlines/
├── lambdas/        # Código fuente de las funciones AWS Lambda en Python
├── main.tf         # Definición de la infraestructura en AWS con Terraform
└── README.md       # Documentación del proyecto
