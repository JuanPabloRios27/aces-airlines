"""
elimina-ticket  ·  Funcionalidad 5 (paso 2): confirmar cancelación con el código
Responsable: Mari (tiquetes)

Ruta (tickets-api):
  POST /tickets/{id_ticket}/cancelacion/confirmar   body: {"correo": "...", "codigo": "123456"}

Valida el código (máx. 5 intentos, 10 min de vigencia). Si es correcto:
  * el ticket pasa a estado "cancelado"
  * sus maletas pasan a "cancelada"
  * se borra el código y se encola el correo de confirmación
"""
import hashlib
import hmac

from aces_comun import (
    COLA_TICKETS, TABLA_AUTH, TABLA_MALETAS, TABLA_TICKETS, ErrorApi, ahora_epoch,
    ahora_iso, api, encolar, maletas_de_ticket, obtener_ticket_del_pasajero, requeridos,
    respuesta, tabla,
)

MAX_INTENTOS = 5


def hash_codigo(id_ticket, codigo):
    return hashlib.sha256(f"{id_ticket}:{codigo}".encode()).hexdigest()


@api
def lambda_handler(req, context):
    if req.ruta != "POST /tickets/{id_ticket}/cancelacion/confirmar":
        raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")
    requeridos(req.body, "correo", "codigo")
    ticket = obtener_ticket_del_pasajero(req.params.get("id_ticket"), req.body["correo"])
    id_ticket = ticket["id_ticket"]
    if ticket["estado"] == "cancelado":
        raise ErrorApi(409, "Esta reserva ya está cancelada")

    auth = tabla(TABLA_AUTH).get_item(Key={"auth_id": id_ticket}).get("Item")
    if not auth or int(auth["expira"]) < ahora_epoch():
        raise ErrorApi(410, "El código expiró o no existe. Pide uno nuevo.")
    if int(auth.get("intentos", 0)) >= MAX_INTENTOS:
        tabla(TABLA_AUTH).delete_item(Key={"auth_id": id_ticket})
        raise ErrorApi(429, "Demasiados intentos. Pide un código nuevo.")

    codigo = str(req.body["codigo"]).strip()
    if not hmac.compare_digest(hash_codigo(id_ticket, codigo), auth["codigo_hash"]):
        intentos = int(auth.get("intentos", 0)) + 1
        tabla(TABLA_AUTH).update_item(
            Key={"auth_id": id_ticket},
            UpdateExpression="SET intentos = :i",
            ExpressionAttributeValues={":i": intentos},
        )
        restantes = MAX_INTENTOS - intentos
        raise ErrorApi(401, f"Código incorrecto. Te quedan {restantes} intentos.",
                       intentos_restantes=restantes)

    # Código correcto -> cancelación definitiva
    tabla(TABLA_AUTH).delete_item(Key={"auth_id": id_ticket})
    ticket["estado"] = "cancelado"
    ticket["cancelado_en"] = ahora_iso()
    ticket["actualizado_en"] = ticket["cancelado_en"]
    tabla(TABLA_TICKETS).put_item(Item=ticket)
    for m in maletas_de_ticket(id_ticket):
        if m["estado"] != "cancelada":
            m["estado"] = "cancelada"
            tabla(TABLA_MALETAS).put_item(Item=m)

    encolar(COLA_TICKETS, {"tipo": "ticket_cancelado", "id_ticket": id_ticket})
    ticket.pop("pasabordo_key", None)
    return respuesta(200, {"mensaje": "Tu tiquete fue cancelado", "ticket": ticket})
