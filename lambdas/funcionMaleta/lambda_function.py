"""
maleta-lambda  ·  Funcionalidad 1: Registrar maleta (+ consultar / quitar)
Responsable: Persona A (maletas)

Rutas (maleta-api):
  POST   /maletas                 -> registra una maleta en estado "pendiente"
  GET    /maletas?id_ticket=&correo=   -> maletas de una reserva (pasajero)
  GET    /maletas?estado=pendiente     -> maletas por estado (agente, header x-agent-key)
  DELETE /maletas/{id_maleta}?id_ticket=&correo=  -> quita una maleta pendiente
"""
from boto3.dynamodb.conditions import Key

from aces_comun import (
    MAX_MALETAS_POR_TICKET, TABLA_MALETAS, ESTADOS_MALETA, ErrorApi, ahora_iso, api,
    generar_id, maletas_de_ticket, obtener_ticket, obtener_ticket_del_pasajero,
    requeridos, respuesta, revisar_peso, tabla,
)


@api
def lambda_handler(req, context):
    if req.ruta == "POST /maletas":
        return registrar(req)
    if req.ruta == "GET /maletas":
        return listar(req)
    if req.ruta == "DELETE /maletas/{id_maleta}":
        return eliminar(req)
    raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")


def registrar(req):
    b = req.body
    requeridos(b, "id_ticket", "correo", "tipo", "peso_kg")
    ticket = obtener_ticket_del_pasajero(b["id_ticket"], b["correo"])
    if ticket["estado"] != "reservado":
        raise ErrorApi(409, "Solo puedes agregar maletas antes del check-in")

    revision = revisar_peso(b["tipo"], b["peso_kg"])
    if not revision["permitido"]:
        raise ErrorApi(422, revision["mensaje"], revision=revision)

    activas = [m for m in maletas_de_ticket(ticket["id_ticket"]) if m["estado"] != "cancelada"]
    if len(activas) >= MAX_MALETAS_POR_TICKET:
        raise ErrorApi(409, f"Máximo {MAX_MALETAS_POR_TICKET} maletas por reserva")

    maleta = {
        "id_maleta": generar_id("MAL"),
        "id_ticket": ticket["id_ticket"],
        "tipo": revision["tipo"],
        "peso_kg": revision["peso_kg"],
        "exceso_kg": revision["exceso_kg"],
        "cargo_exceso": revision["cargo_exceso"],
        "descripcion": str(b.get("descripcion", ""))[:120],
        "estado": "pendiente",
        "creado_en": ahora_iso(),
    }
    tabla(TABLA_MALETAS).put_item(Item=maleta)
    return respuesta(201, {"maleta": maleta, "revision": revision})


def listar(req):
    q = req.query
    if q.get("estado"):
        req.exigir_agente()
        if q["estado"] not in ESTADOS_MALETA:
            raise ErrorApi(400, "Estado inválido")
        res = tabla(TABLA_MALETAS).query(
            IndexName="por-estado", KeyConditionExpression=Key("estado").eq(q["estado"])
        )
        maletas = sorted(res.get("Items", []), key=lambda m: m.get("creado_en", ""))
        # El agente necesita ver de quién es cada maleta
        cache = {}
        for m in maletas:
            if m["id_ticket"] not in cache:
                try:
                    t = obtener_ticket(m["id_ticket"])
                    cache[m["id_ticket"]] = {k: t.get(k) for k in
                                             ("nombre", "vuelo", "origen", "destino", "estado")}
                except ErrorApi:
                    cache[m["id_ticket"]] = None
            m["ticket"] = cache[m["id_ticket"]]
        return respuesta(200, {"maletas": maletas})

    requeridos(q, "id_ticket", "correo")
    ticket = obtener_ticket_del_pasajero(q["id_ticket"], q["correo"])
    return respuesta(200, {"maletas": maletas_de_ticket(ticket["id_ticket"])})


def eliminar(req):
    q = req.query
    requeridos(q, "id_ticket", "correo")
    ticket = obtener_ticket_del_pasajero(q["id_ticket"], q["correo"])
    if ticket["estado"] != "reservado":
        raise ErrorApi(409, "Ya no se pueden modificar las maletas de esta reserva")

    id_maleta = req.params.get("id_maleta", "")
    maleta = tabla(TABLA_MALETAS).get_item(Key={"id_maleta": id_maleta}).get("Item")
    if not maleta or maleta["id_ticket"] != ticket["id_ticket"]:
        raise ErrorApi(404, "Maleta no encontrada")
    if maleta["estado"] != "pendiente":
        raise ErrorApi(409, "Solo se pueden quitar maletas pendientes")

    tabla(TABLA_MALETAS).delete_item(Key={"id_maleta": id_maleta})
    return respuesta(200, {"eliminada": id_maleta})
