"""
maleta-confirmacion  ·  Funcionalidad 2: Confirmar maleta en el check-in
Responsable: Persona A (maletas)

Ruta (maleta-api), solo agentes (header x-agent-key):
  POST /maletas/{id_maleta}/confirmar   body opcional: {"peso_real_kg": 21.4}

1. Pesa (opcional) y cambia el estado de la maleta a "confirmada".
2. Guarda el comprobante en S3 (bucket de maletas).
3. Encola una notificación en SQS (queueMaletas) -> maleta-notification la envía por correo.
"""
from aces_comun import (
    BUCKET_MALETAS, COLA_MALETAS, TABLA_MALETAS, ErrorApi, a_json, ahora_iso, api,
    encolar, obtener_ticket, respuesta, revisar_peso, s3, tabla, url_firmada,
)


@api
def lambda_handler(req, context):
    if req.ruta != "POST /maletas/{id_maleta}/confirmar":
        raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")
    req.exigir_agente()

    id_maleta = req.params.get("id_maleta", "")
    maleta = tabla(TABLA_MALETAS).get_item(Key={"id_maleta": id_maleta}).get("Item")
    if not maleta:
        raise ErrorApi(404, "Maleta no encontrada")
    if maleta["estado"] != "pendiente":
        raise ErrorApi(409, f"La maleta ya está {maleta['estado']}")

    ticket = obtener_ticket(maleta["id_ticket"])
    if ticket["estado"] == "cancelado":
        raise ErrorApi(409, "La reserva de esta maleta fue cancelada")

    # Si el agente la pesó en el counter, se recalcula con el peso real
    if req.body.get("peso_real_kg") not in (None, ""):
        revision = revisar_peso(maleta["tipo"], req.body["peso_real_kg"])
        if not revision["permitido"]:
            raise ErrorApi(422, revision["mensaje"], revision=revision)
        maleta.update({k: revision[k] for k in ("peso_kg", "exceso_kg", "cargo_exceso")})

    maleta["estado"] = "confirmada"
    maleta["confirmado_en"] = ahora_iso()
    maleta["comprobante_key"] = f"comprobantes/{maleta['id_ticket']}/{id_maleta}.json"

    comprobante = {
        "tipo": "comprobante_maleta",
        "aerolinea": "ACES Airlines",
        "maleta": {k: v for k, v in maleta.items() if k != "comprobante_key"},
        "pasajero": {"nombre": ticket.get("nombre"), "documento": ticket.get("documento")},
        "vuelo": {k: ticket.get(k) for k in ("vuelo", "origen", "destino", "fecha_vuelo")},
    }
    s3().put_object(
        Bucket=BUCKET_MALETAS,
        Key=maleta["comprobante_key"],
        Body=a_json(comprobante).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )
    tabla(TABLA_MALETAS).put_item(Item=maleta)

    encolar(COLA_MALETAS, {"tipo": "maleta_confirmada", "id_maleta": id_maleta})

    return respuesta(200, {
        "maleta": maleta,
        "comprobante_url": url_firmada(BUCKET_MALETAS, maleta["comprobante_key"]),
    })
