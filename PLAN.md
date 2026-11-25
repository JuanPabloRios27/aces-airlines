# Plan de trabajo · quién hace qué

El proyecto se divide en **dos mitades verticales**. Cada quien es dueño del back **y** del front de su mitad, así cada uno puede explicar su parte completa en la sustentación.

> Cambien "Persona A" por su nombre en este archivo y en los comentarios de los archivos.

## Persona A — Maletas y check-in (F1, F2, F3)

| Capa | Archivos |
| :- | :- |
| Lambdas | `lambdas/funcionMaleta/` (maleta-lambda) · `lambdas/funcionMaletaRevisar/` (maleta-revisar) · `lambdas/funcionMaletaConfirmation/` (maleta-confirmacion) · `lambdas/funcionMaletaNoti/` (maleta-notification) |
| Front | `frontend/maletas.html` + `js/maletas.js` · `frontend/checkin.html` + `js/checkin.js` · `js/agente-maletas.js` (pestaña "Maletas por confirmar") |
| AWS | tabla `maleta-db`, bucket `aces-maletas-*`, cola `queueMaletas`, API `maleta-api` |
| También | Generador del PDF del pasabordo (`generar_pdf_pasabordo` en `aces_comun.py`) |

## Mari — Tiquetes y reserva (F4, F5, F6)

| Capa | Archivos |
| :- | :- |
| Lambdas | `lambdas/funcionTicket/` (ticket-lambda) · `lambdas/funcionCodAuth/` (cod-auth) · `lambdas/funcionEliminaTicket/` (elimina-ticket) · `lambdas/funcionTicketNotification/` (ticket-notification) |
| Front | `frontend/reserva.html` + `js/reserva.js` · `frontend/modificar.html` + `js/modificar.js` · `frontend/cancelar.html` + `js/cancelar.js` · `js/agente-reservas.js` (pestaña "Reservas") |
| AWS | tablas `ticket-db` y `autentification-db` (TTL), bucket `aces-tickets-*`, cola `queueTickets`, API `tickets-api` |

## Base compartida (cambiarla solo avisándole al otro)

`frontend/index.html`, `js/inicio.js`, `js/api.js`, `js/mock.js`, `js/ui.js`, `js/config.js`, `js/agente.js`, `css/styles.css`, `lambdas/comun/`, `lambdas/aces-index/`, `main.tf`, `tests/`.

* Si agregan una ruta nueva: va en `main.tf` (`local.rutas`), en la lambda, en `js/api.js` **y** en `js/mock.js`, para que el modo demo siga funcionando.
* Si cambian una regla de negocio (límites de peso, intentos del MFA…), cámbienla en la lambda y en `mock.js`.

## Git

```bash
git checkout -b maletas      # Persona A
git checkout -b tiquetes     # Mari
# ...trabajan, hacen commit...
git push -u origin <su-rama> # y abren un Pull Request a main
```

## Estado

- [x] Back de los 6 flujos (9 lambdas + layer)
- [x] `main.tf` completo (rutas, integraciones, CORS, SQS→Lambda, SES, S3 privado, TTL)
- [x] Front de los 6 flujos + panel de agentes + modo demo
- [x] Pruebas con moto (`tests/test_backend.py`) y servidor local
- [ ] `terraform apply` en la cuenta de AWS y verificar correos en SES
- [ ] Probar los flujos en la nube con correos reales
- [ ] Capturas y diagrama para el informe / sustentación
