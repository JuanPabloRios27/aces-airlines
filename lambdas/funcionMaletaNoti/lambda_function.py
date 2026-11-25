"""
maleta-notification  ·  Envía por correo (SES) los avisos de maletas
Responsable: Persona A (maletas)

Se dispara con los mensajes de la cola SQS "queueMaletas".
Mensajes que entiende:
  {"tipo": "maleta_confirmada", "id_maleta": "MALXXXXXX"}
"""
from aces_comun import (
    TABLA_MALETAS, enviar_correo, fmt_kg, obtener_ticket, plantilla_correo, procesar_cola, tabla,
)


def lambda_handler(event, context):
    return procesar_cola(event, procesar)


def procesar(msg):
    if msg.get("tipo") != "maleta_confirmada":
        print("Mensaje ignorado:", msg)
        return

    maleta = tabla(TABLA_MALETAS).get_item(Key={"id_maleta": msg["id_maleta"]}).get("Item")
    if not maleta:
        print("La maleta ya no existe:", msg)
        return
    ticket = obtener_ticket(maleta["id_ticket"])

    cargo = int(maleta.get("cargo_exceso", 0))
    parrafos = [
        f"Hola {ticket.get('nombre', '')},",
        f"Tu maleta de <b>{maleta['tipo']}</b> ({fmt_kg(maleta['peso_kg'])} kg) fue "
        f"<b>confirmada</b> para el vuelo <b>{ticket['vuelo']}</b> "
        f"{ticket['origen']} → {ticket['destino']}.",
        f"Número de maleta: <b>{maleta['id_maleta']}</b>",
    ]
    if cargo:
        parrafos.append(f"Cargo por exceso de peso: <b>${cargo:,} COP</b>".replace(",", "."))
    enviar_correo(
        ticket["id_propietario"],
        f"Maleta confirmada · {ticket['vuelo']} · {maleta['id_maleta']}",
        plantilla_correo("Tu maleta está confirmada ✈", parrafos),
    )
