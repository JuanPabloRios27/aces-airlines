"""
maleta-revisar  ·  Revisa el peso de una maleta antes de registrarla
Responsable: Persona A (maletas)

Ruta (maleta-api):
  POST /maletas/revisar   body: {"tipo": "bodega"|"cabina", "peso_kg": 25.5}

El front la llama mientras el pasajero escribe el peso, para mostrarle
en vivo si la maleta pasa, cuánto exceso tiene y cuánto le cobrarían.
"""
from aces_comun import ErrorApi, api, requeridos, respuesta, revisar_peso


@api
def lambda_handler(req, context):
    if req.ruta != "POST /maletas/revisar":
        raise ErrorApi(404, f"Ruta no soportada: {req.ruta}")
    requeridos(req.body, "tipo", "peso_kg")
    return respuesta(200, revisar_peso(req.body["tipo"], req.body["peso_kg"]))
