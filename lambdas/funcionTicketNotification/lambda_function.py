"""
ticket-notification  ·  Envía por correo (SES) todo lo de tiquetes
Responsable: Mari (tiquetes)

Se dispara con los mensajes de la cola SQS "queueTickets".
Tipos de mensaje:
  reserva_creada      -> confirmación de la reserva con el código
  reserva_modificada  -> resumen de cambios (Funcionalidad 4)
  pasabordo           -> pasabordo PDF adjunto (Funcionalidad 3)
  codigo_mfa          -> código de 6 dígitos para cancelar (Funcionalidad 5)
  ticket_cancelado    -> confirmación de cancelación (Funcionalidad 5)
"""
from aces_comun import (
    BUCKET_TICKETS, enviar_correo, obtener_ticket, plantilla_correo, procesar_cola, s3,
)

NOMBRES_CAMPOS = {"asiento": "Asiento", "telefono": "Teléfono", "nombre": "Nombre"}


def lambda_handler(event, context):
    return procesar_cola(event, procesar)


def resumen_vuelo(t):
    return (f"Vuelo <b>{t['vuelo']}</b> · {t['origen']} → {t['destino']} · "
            f"{str(t['fecha_vuelo']).replace('T', ' ')[:16]} · Asiento <b>{t['asiento']}</b>")


def procesar(msg):
    tipo = msg.get("tipo")
    t = obtener_ticket(msg["id_ticket"])
    destino = t["id_propietario"]
    hola = f"Hola {t.get('nombre', '')},"

    if tipo == "reserva_creada":
        enviar_correo(destino, f"Tu reserva {t['id_ticket']} está lista", plantilla_correo(
            "¡Reserva confirmada!",
            [hola, resumen_vuelo(t),
             "Con este código y tu correo puedes registrar maletas, hacer check-in "
             "o modificar tu reserva en SkyCheck:"],
            destacado=t["id_ticket"]))

    elif tipo == "reserva_modificada":
        ant = msg.get("anteriores", {})
        filas = [f"{NOMBRES_CAMPOS.get(k, k)}: {ant.get(k) or '—'} → <b>{v}</b>"
                 for k, v in msg.get("cambios", {}).items()]
        enviar_correo(destino, f"Modificaste tu reserva {t['id_ticket']}", plantilla_correo(
            "Tu reserva fue modificada",
            [hola, "Estos son los cambios que hiciste:", "<br>".join(filas), resumen_vuelo(t),
             "Si no fuiste tú, comunícate con la aerolínea."]))

    elif tipo == "pasabordo":
        pdf = s3().get_object(Bucket=BUCKET_TICKETS, Key=t["pasabordo_key"])["Body"].read()
        enviar_correo(destino, f"Tu pasabordo · {t['vuelo']} {t['origen']}-{t['destino']}",
                      plantilla_correo("Check-in completado ✈",
                                       [hola, resumen_vuelo(t),
                                        "Adjuntamos tu pasabordo en PDF. Preséntalo con tu "
                                        "documento en la puerta de embarque."]),
                      adjunto=(f"pasabordo-{t['id_ticket']}.pdf", pdf, "application/pdf"))

    elif tipo == "codigo_mfa":
        enviar_correo(destino, f"Código para cancelar tu reserva {t['id_ticket']}",
                      plantilla_correo(
                          "Código de verificación",
                          [hola, f"Pediste cancelar la reserva <b>{t['id_ticket']}</b>. "
                                 "Usa este código para confirmar (vence en 10 minutos):"],
                          destacado=msg["codigo"]))

    elif tipo == "ticket_cancelado":
        enviar_correo(destino, f"Reserva {t['id_ticket']} cancelada", plantilla_correo(
            "Tu tiquete fue cancelado",
            [hola, resumen_vuelo(t),
             "La cancelación quedó registrada. Tus maletas asociadas también fueron canceladas."]))

    else:
        print("Mensaje ignorado:", msg)
