"""
ticket-lambda  ·  Tiquetes: crear, consultar, modificar y hacer check-in
Responsable: Mari (tiquetes)  ·  el check-in/pasabordo lo usa Persona A

Rutas (tickets-api):
  POST /tickets                         (agente) crea una reserva
  GET  /tickets                         (agente) lista las reservas
  GET  /tickets/{id_ticket}?correo=     Funcionalidad 6: consultar estado (reserva + maletas)
  PUT  /tickets/{id_ticket}             Funcionalidad 4: modificar reserva (asiento / contacto)
  POST /tickets/{id_ticket}/checkin     Funcionalidad 3: check-in -> pasabordo PDF en S3 + correo
"""
import re

from boto3.dynamodb.conditions import Key

from aces_comun import (
    BUCKET_TICKETS, COLA_TICKETS, TABLA_TICKETS, ErrorApi, ahora_iso, api, encolar,
    generar_id, generar_pdf_pasabordo, maletas_de_ticket, normalizar_correo,
    obtener_ticket_del_pasajero, requeridos, respuesta, s3, tabla, url_firmada,
)

RE_ASIENTO = re.compile(r"^([1-9]|[12][0-9]|30)[A-F]$")   # filas 1-30, columnas A-F
RE_IATA = re.compile(r"^[A-Z]{3}$")


@api
def lambda_handler(req, context):
    rutas = {
        "POST /tickets": crear,
        "GET /tickets": listar,
        "GET /tickets/{id_ticket}": consultar,
        "PUT /tickets/{id_ticket}": modificar,
        "POST /tickets/{id_ticket}/checkin": checkin,
    }
    if req.ruta not in rutas:
        raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")
    return rutas[req.ruta](req)


# ---------------------------------------------------------------- helpers
def validar_asiento(asiento):
    asiento = str(asiento or "").strip().upper()
    if not RE_ASIENTO.match(asiento):
        raise ErrorApi(400, "Asiento inválido (ej: 12A, filas 1-30, columnas A-F)")
    return asiento


def asientos_ocupados(vuelo, fecha_vuelo, excepto=None):
    res = tabla(TABLA_TICKETS).query(IndexName="por-vuelo",
                                     KeyConditionExpression=Key("vuelo").eq(vuelo))
    return {
        t["asiento"] for t in res.get("Items", [])
        if t.get("estado") != "cancelado"
        and t.get("fecha_vuelo") == fecha_vuelo
        and t["id_ticket"] != excepto
    }


def vista_publica(ticket):
    """Lo que se le devuelve al front (con maletas y link del pasabordo)."""
    t = dict(ticket)
    t["maletas"] = maletas_de_ticket(ticket["id_ticket"])
    t["pasabordo_url"] = url_firmada(BUCKET_TICKETS, ticket.get("pasabordo_key"))
    t.pop("pasabordo_key", None)
    return t


# ---------------------------------------------------------------- rutas
def crear(req):
    req.exigir_agente()
    b = req.body
    requeridos(b, "nombre", "correo", "documento", "vuelo", "origen", "destino",
               "fecha_vuelo", "asiento")
    origen, destino = b["origen"].strip().upper(), b["destino"].strip().upper()
    if not (RE_IATA.match(origen) and RE_IATA.match(destino)) or origen == destino:
        raise ErrorApi(400, "Origen y destino deben ser códigos IATA distintos (ej: BOG, MDE)")

    vuelo = b["vuelo"].strip().upper()
    asiento = validar_asiento(b["asiento"])
    fecha = str(b["fecha_vuelo"]).strip()
    if asiento in asientos_ocupados(vuelo, fecha):
        raise ErrorApi(409, f"El asiento {asiento} ya está ocupado en el vuelo {vuelo}")

    ticket = {
        "id_ticket": generar_id("SKY"),
        "id_propietario": normalizar_correo(b["correo"]),
        "nombre": b["nombre"].strip()[:80],
        "documento": str(b["documento"]).strip()[:20],
        "telefono": str(b.get("telefono", "")).strip()[:20],
        "vuelo": vuelo,
        "origen": origen,
        "destino": destino,
        "fecha_vuelo": fecha,
        "asiento": asiento,
        "estado": "reservado",
        "creado_en": ahora_iso(),
        "actualizado_en": ahora_iso(),
    }
    tabla(TABLA_TICKETS).put_item(Item=ticket,
                                  ConditionExpression="attribute_not_exists(id_ticket)")
    encolar(COLA_TICKETS, {"tipo": "reserva_creada", "id_ticket": ticket["id_ticket"]})
    return respuesta(201, {"ticket": ticket})


def listar(req):
    req.exigir_agente()
    items = tabla(TABLA_TICKETS).scan().get("Items", [])
    items.sort(key=lambda t: t.get("creado_en", ""), reverse=True)
    for t in items:
        t.pop("pasabordo_key", None)
    return respuesta(200, {"tickets": items})


def consultar(req):
    requeridos(req.query, "correo")
    ticket = obtener_ticket_del_pasajero(req.params.get("id_ticket"), req.query["correo"])
    return respuesta(200, {"ticket": vista_publica(ticket)})


def modificar(req):
    b = req.body
    requeridos(b, "correo")
    ticket = obtener_ticket_del_pasajero(req.params.get("id_ticket"), b["correo"])
    if ticket["estado"] != "reservado":
        raise ErrorApi(409, "Solo puedes modificar la reserva antes del check-in")

    cambios = {}
    if b.get("asiento") not in (None, ""):
        asiento = validar_asiento(b["asiento"])
        if asiento != ticket["asiento"]:
            if asiento in asientos_ocupados(ticket["vuelo"], ticket["fecha_vuelo"],
                                            excepto=ticket["id_ticket"]):
                raise ErrorApi(409, f"El asiento {asiento} ya está ocupado")
            cambios["asiento"] = asiento
    if b.get("telefono") not in (None, "") and str(b["telefono"]).strip() != ticket.get("telefono"):
        tel = str(b["telefono"]).strip()
        if not re.fullmatch(r"\+?[0-9 ]{7,20}", tel):
            raise ErrorApi(400, "Teléfono inválido")
        cambios["telefono"] = tel
    if b.get("nombre") not in (None, "") and b["nombre"].strip() != ticket.get("nombre"):
        cambios["nombre"] = b["nombre"].strip()[:80]

    if not cambios:
        raise ErrorApi(400, "No hay cambios para guardar")

    anteriores = {k: ticket.get(k) for k in cambios}
    ticket.update(cambios)
    ticket["actualizado_en"] = ahora_iso()
    tabla(TABLA_TICKETS).put_item(Item=ticket)
    encolar(COLA_TICKETS, {"tipo": "reserva_modificada", "id_ticket": ticket["id_ticket"],
                           "cambios": cambios, "anteriores": anteriores})
    return respuesta(200, {"ticket": vista_publica(ticket), "cambios": cambios})


def checkin(req):
    requeridos(req.body, "correo")
    ticket = obtener_ticket_del_pasajero(req.params.get("id_ticket"), req.body["correo"])
    if ticket["estado"] == "cancelado":
        raise ErrorApi(409, "La reserva está cancelada")
    if ticket["estado"] == "checkin":
        raise ErrorApi(409, "Ya hiciste el check-in de esta reserva")

    maletas = maletas_de_ticket(ticket["id_ticket"])
    ticket["estado"] = "checkin"
    ticket["checkin_en"] = ahora_iso()
    ticket["actualizado_en"] = ticket["checkin_en"]
    ticket["maletas_registradas"] = len([m for m in maletas if m["estado"] != "cancelada"])
    ticket["maletas_confirmadas"] = len([m for m in maletas if m["estado"] == "confirmada"])
    ticket["pasabordo_key"] = f"pasabordos/{ticket['id_ticket']}.pdf"

    s3().put_object(
        Bucket=BUCKET_TICKETS,
        Key=ticket["pasabordo_key"],
        Body=generar_pdf_pasabordo(ticket),
        ContentType="application/pdf",
        ContentDisposition=f'inline; filename="pasabordo-{ticket["id_ticket"]}.pdf"',
    )
    tabla(TABLA_TICKETS).put_item(Item=ticket)
    encolar(COLA_TICKETS, {"tipo": "pasabordo", "id_ticket": ticket["id_ticket"]})
    return respuesta(200, {"ticket": vista_publica(ticket)})
