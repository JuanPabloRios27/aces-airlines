"""
cod-auth  ·  Funcionalidad 5 (paso 1): pedir código MFA para cancelar
Responsable: Mari (tiquetes)

Ruta (tickets-api):
  POST /tickets/{id_ticket}/cancelacion     body: {"correo": "..."}

Genera un código de 6 dígitos, guarda SOLO su hash en la tabla de
autenticación (expira en 10 minutos, con TTL de DynamoDB) y encola el
envío del código por correo.
"""
import hashlib
import secrets

from aces_comun import (
    COLA_TICKETS, TABLA_AUTH, ErrorApi, ahora_epoch, ahora_iso, api, encolar,
    obtener_ticket_del_pasajero, requeridos, respuesta, tabla,
)

VIGENCIA_SEGUNDOS = 600     # 10 minutos
ESPERA_REENVIO = 60         # no se puede pedir otro código antes de 1 minuto


def hash_codigo(id_ticket, codigo):
    return hashlib.sha256(f"{id_ticket}:{codigo}".encode()).hexdigest()


@api
def lambda_handler(req, context):
    if req.ruta != "POST /tickets/{id_ticket}/cancelacion":
        raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")
    requeridos(req.body, "correo")
    ticket = obtener_ticket_del_pasajero(req.params.get("id_ticket"), req.body["correo"])
    if ticket["estado"] == "cancelado":
        raise ErrorApi(409, "Esta reserva ya está cancelada")

    id_ticket = ticket["id_ticket"]
    ahora = ahora_epoch()
    previo = tabla(TABLA_AUTH).get_item(Key={"auth_id": id_ticket}).get("Item")
    if previo and ahora - int(previo.get("creado_epoch", 0)) < ESPERA_REENVIO:
        espera = ESPERA_REENVIO - (ahora - int(previo["creado_epoch"]))
        raise ErrorApi(429, f"Espera {espera} segundos para pedir otro código", espera=espera)

    codigo = f"{secrets.randbelow(1_000_000):06d}"
    tabla(TABLA_AUTH).put_item(Item={
        "auth_id": id_ticket,
        "user_id": ticket["id_propietario"],
        "codigo_hash": hash_codigo(id_ticket, codigo),
        "intentos": 0,
        "creado_epoch": ahora,
        "creado_en": ahora_iso(),
        "expira": ahora + VIGENCIA_SEGUNDOS,   # atributo TTL de DynamoDB
    })
    # El código viaja solo en el mensaje hacia la lambda de correo
    encolar(COLA_TICKETS, {"tipo": "codigo_mfa", "id_ticket": id_ticket, "codigo": codigo})

    correo = ticket["id_propietario"]
    usuario, dominio = correo.split("@")
    oculto = usuario[:2] + "•" * max(1, len(usuario) - 2) + "@" + dominio
    return respuesta(200, {
        "mensaje": f"Enviamos un código de verificación a {oculto}",
        "expira_en_segundos": VIGENCIA_SEGUNDOS,
    })
