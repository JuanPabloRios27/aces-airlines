"""
aces_comun.py - Código compartido por todas las lambdas de SkyCheck.

Se despliega como Lambda Layer ("aces-comun"): todo lo que está en la carpeta
python/ del layer queda importable desde cualquier lambda con:

    from aces_comun import api, ErrorApi, ...

Contiene:
  * Respuestas HTTP (formato API Gateway HTTP API, payload v2.0)
  * Lectura del evento (método, ruta, body, query, headers)
  * Acceso a DynamoDB / S3 / SQS / SES
  * Reglas de negocio compartidas (límites de equipaje, validaciones)
  * Generador de PDF del pasabordo (sin librerías externas)
"""
import base64
import json
import os
import random
import re
import time
import traceback
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.config import Config

# --------------------------------------------------------------------------
# Configuración (viene de las variables de entorno que pone Terraform)
# --------------------------------------------------------------------------
REGION = os.environ.get("AWS_REGION", "us-east-2")
TABLA_TICKETS = os.environ.get("TABLA_TICKETS", "ticket-db")
TABLA_MALETAS = os.environ.get("TABLA_MALETAS", "maleta-db")
TABLA_AUTH = os.environ.get("TABLA_AUTH", "autentification-db")
BUCKET_MALETAS = os.environ.get("BUCKET_MALETAS", "")
BUCKET_TICKETS = os.environ.get("BUCKET_TICKETS", "")
COLA_MALETAS = os.environ.get("COLA_MALETAS", "")
COLA_TICKETS = os.environ.get("COLA_TICKETS", "")
CORREO_REMITENTE = os.environ.get("CORREO_REMITENTE", "")
AGENT_KEY = os.environ.get("AGENT_KEY", "")

# Reglas de equipaje
LIMITES_KG = {"cabina": Decimal("10"), "bodega": Decimal("23")}
PESO_MAXIMO_ABSOLUTO = Decimal("32")  # por encima de esto no se acepta
CARGO_POR_KG_EXCESO = 15000           # COP por kg de exceso
MAX_MALETAS_POR_TICKET = 3

ESTADOS_TICKET = ("reservado", "checkin", "cancelado")
ESTADOS_MALETA = ("pendiente", "confirmada", "cancelada")


# --------------------------------------------------------------------------
# Clientes AWS (se crean perezosamente para que los tests con moto funcionen)
# --------------------------------------------------------------------------
_cache = {}


def _cliente(nombre, **kw):
    if nombre not in _cache:
        _cache[nombre] = boto3.client(nombre, region_name=REGION, **kw)
    return _cache[nombre]


def dynamo():
    if "dynamo_res" not in _cache:
        _cache["dynamo_res"] = boto3.resource("dynamodb", region_name=REGION)
    return _cache["dynamo_res"]


def tabla(nombre):
    return dynamo().Table(nombre)


def s3():
    return _cliente("s3", config=Config(signature_version="s3v4",
                                        s3={"addressing_style": "virtual"}))


def sqs():
    return _cliente("sqs")


def ses():
    return _cliente("ses")


# --------------------------------------------------------------------------
# Utilidades generales
# --------------------------------------------------------------------------
class ErrorApi(Exception):
    """Error controlado: se convierte en una respuesta HTTP con ese status."""

    def __init__(self, status, mensaje, **extra):
        super().__init__(mensaje)
        self.status = status
        self.mensaje = mensaje
        self.extra = extra


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, set):
        return list(o)
    raise TypeError(f"No serializable: {type(o)}")


def a_json(data):
    return json.dumps(data, default=_json_default, ensure_ascii=False)


def respuesta(status, data):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": a_json(data),
    }


def ahora_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ahora_epoch():
    return int(time.time())


def generar_id(prefijo, largo=6):
    # Sin caracteres que se confunden (0/O, 1/I)
    alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return prefijo + "".join(random.SystemRandom().choice(alfabeto) for _ in range(largo))


def normalizar_correo(correo):
    correo = (correo or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", correo):
        raise ErrorApi(400, "El correo no es válido")
    return correo


def a_decimal(valor, campo):
    try:
        d = Decimal(str(valor))
    except Exception:
        raise ErrorApi(400, f"'{campo}' debe ser un número")
    if d <= 0:
        raise ErrorApi(400, f"'{campo}' debe ser mayor que cero")
    return d.quantize(Decimal("0.1"))


def fmt_kg(valor):
    """Decimal("24.0") -> "24", Decimal("2.5") -> "2.5" """
    d = Decimal(str(valor))
    return f"{d.normalize():f}" if d != d.to_integral_value() else str(int(d))


def requeridos(body, *campos):
    faltan = [c for c in campos if body.get(c) in (None, "")]
    if faltan:
        raise ErrorApi(400, "Faltan campos: " + ", ".join(faltan))


# --------------------------------------------------------------------------
# Lectura del evento de API Gateway (HTTP API, payload format 2.0)
# --------------------------------------------------------------------------
class Peticion:
    def __init__(self, event):
        ctx = event.get("requestContext", {})
        self.metodo = ctx.get("http", {}).get("method", "GET")
        self.ruta = event.get("routeKey", "")           # ej: "POST /maletas"
        self.path = event.get("rawPath", "/")
        self.params = event.get("pathParameters") or {}
        self.query = event.get("queryStringParameters") or {}
        self.headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        raw = event.get("body") or ""
        if raw and event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        try:
            self.body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise ErrorApi(400, "El body no es JSON válido")
        if not isinstance(self.body, dict):
            raise ErrorApi(400, "El body debe ser un objeto JSON")

    def exigir_agente(self):
        if not AGENT_KEY or self.headers.get("x-agent-key") != AGENT_KEY:
            raise ErrorApi(401, "Clave de agente inválida")


def api(funcion):
    """Decorador para handlers HTTP: arma la Peticion y convierte errores."""

    def handler(event, context):
        try:
            return funcion(Peticion(event), context)
        except ErrorApi as e:
            return respuesta(e.status, {"error": e.mensaje, **e.extra})
        except Exception:
            traceback.print_exc()
            return respuesta(500, {"error": "Error interno del servidor"})

    return handler


# --------------------------------------------------------------------------
# Reglas de negocio compartidas
# --------------------------------------------------------------------------
def revisar_peso(tipo, peso_kg):
    """Revisa una maleta contra los límites. Devuelve un dict con el resultado."""
    tipo = (tipo or "").strip().lower()
    if tipo not in LIMITES_KG:
        raise ErrorApi(400, "El tipo debe ser 'cabina' o 'bodega'")
    peso = a_decimal(peso_kg, "peso_kg")
    limite = LIMITES_KG[tipo]
    exceso = max(Decimal("0"), peso - limite)
    permitido = peso <= PESO_MAXIMO_ABSOLUTO and not (tipo == "cabina" and exceso > 0)
    cargo = int((exceso * CARGO_POR_KG_EXCESO).to_integral_value()) if tipo == "bodega" else 0

    if peso > PESO_MAXIMO_ABSOLUTO:
        mensaje = f"Ninguna maleta puede superar {fmt_kg(PESO_MAXIMO_ABSOLUTO)} kg."
    elif tipo == "cabina" and exceso > 0:
        mensaje = f"El equipaje de cabina no puede superar {fmt_kg(limite)} kg. Regístrala como bodega."
    elif exceso > 0:
        mensaje = f"Tiene {fmt_kg(exceso)} kg de exceso. Cargo adicional: ${cargo:,} COP.".replace(",", ".")
    else:
        mensaje = "La maleta cumple con el peso permitido."

    return {
        "tipo": tipo,
        "peso_kg": peso,
        "limite_kg": limite,
        "exceso_kg": exceso,
        "cargo_exceso": cargo,
        "permitido": permitido,
        "mensaje": mensaje,
    }


def obtener_ticket(id_ticket):
    id_ticket = (id_ticket or "").strip().upper()
    item = tabla(TABLA_TICKETS).get_item(Key={"id_ticket": id_ticket}).get("Item")
    if not item:
        raise ErrorApi(404, "No encontramos esa reserva")
    return item


def obtener_ticket_del_pasajero(id_ticket, correo):
    """El pasajero se identifica con código de reserva + correo."""
    ticket = obtener_ticket(id_ticket)
    if ticket.get("id_propietario") != normalizar_correo(correo):
        # Mismo mensaje que 404 para no revelar qué reservas existen
        raise ErrorApi(404, "No encontramos esa reserva")
    return ticket


def maletas_de_ticket(id_ticket):
    from boto3.dynamodb.conditions import Key
    res = tabla(TABLA_MALETAS).query(
        IndexName="por-ticket",
        KeyConditionExpression=Key("id_ticket").eq(id_ticket),
    )
    return sorted(res.get("Items", []), key=lambda m: m.get("creado_en", ""))


def url_firmada(bucket, key, segundos=3600):
    if not bucket or not key:
        return None
    return s3().generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=segundos
    )


def encolar(url_cola, mensaje):
    if not url_cola:
        print("AVISO: cola no configurada, mensaje descartado:", mensaje)
        return
    sqs().send_message(QueueUrl=url_cola, MessageBody=a_json(mensaje))


# --------------------------------------------------------------------------
# Correo (SES)
# --------------------------------------------------------------------------
def plantilla_correo(titulo, parrafos, destacado=None):
    """HTML sencillo y compatible con clientes de correo."""
    bloque = ""
    if destacado:
        bloque = (
            '<div style="margin:24px 0;padding:18px;background:#0b1f3a;color:#fff;'
            'border-radius:12px;font-size:28px;letter-spacing:6px;text-align:center;'
            f'font-family:monospace">{destacado}</div>'
        )
    cuerpo = "".join(f'<p style="margin:0 0 12px">{p}</p>' for p in parrafos)
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;'
        'color:#1c2733">'
        '<div style="background:#0b1f3a;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">'
        '<b style="font-size:20px">SkyCheck</b> <span style="opacity:.7">· ACES Airlines</span></div>'
        '<div style="border:1px solid #e3e8ef;border-top:0;padding:24px;border-radius:0 0 12px 12px">'
        f'<h2 style="margin:0 0 16px;color:#0b1f3a">{titulo}</h2>{cuerpo}{bloque}'
        '<p style="margin-top:24px;font-size:12px;color:#7a8696">Este es un correo automático '
        'del proyecto SkyCheck (Universidad El Bosque).</p></div></div>'
    )


def enviar_correo(destino, asunto, html, adjunto=None):
    """Envía un correo. adjunto = (nombre_archivo, bytes, mime) opcional."""
    if not CORREO_REMITENTE:
        raise RuntimeError("CORREO_REMITENTE no está configurado")
    if not adjunto:
        ses().send_email(
            Source=CORREO_REMITENTE,
            Destination={"ToAddresses": [destino]},
            Message={
                "Subject": {"Data": asunto, "Charset": "UTF-8"},
                "Body": {"Html": {"Data": html, "Charset": "UTF-8"}},
            },
        )
        return

    from email.mime.application import MIMEApplication
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart("mixed")
    msg["Subject"] = asunto
    msg["From"] = CORREO_REMITENTE
    msg["To"] = destino
    msg.attach(MIMEText(html, "html", "utf-8"))
    nombre, datos, mime = adjunto
    parte = MIMEApplication(datos, _subtype=mime.split("/")[-1])
    parte.add_header("Content-Disposition", "attachment", filename=nombre)
    msg.attach(parte)
    ses().send_raw_email(
        Source=CORREO_REMITENTE,
        Destinations=[destino],
        RawMessage={"Data": msg.as_string()},
    )


def procesar_cola(event, procesar_mensaje):
    """Recorre los mensajes de SQS; los que fallen vuelven a la cola (y luego a la DLQ)."""
    fallidos = []
    for record in event.get("Records", []):
        try:
            procesar_mensaje(json.loads(record["body"]))
        except Exception:
            traceback.print_exc()
            fallidos.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": fallidos}


# --------------------------------------------------------------------------
# PDF del pasabordo (PDF 1.4 escrito a mano, sin dependencias)
# --------------------------------------------------------------------------
def _pdf_texto(s):
    s = str(s).encode("cp1252", "replace").decode("cp1252")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def hora_colombia(iso):
    """Convierte un ISO en UTC a hora de Colombia (UTC-5, sin horario de verano)."""
    from datetime import timedelta
    try:
        return (datetime.fromisoformat(iso) - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return str(iso or "")[:16]


def generar_pdf_pasabordo(ticket):
    """Devuelve los bytes de un PDF con el pasabordo del ticket."""
    W, H = 612, 300  # tamaño de la página (puntos)
    c = []  # comandos de dibujo

    def rect(x, y, w, h, rgb):
        c.append(f"{rgb[0]} {rgb[1]} {rgb[2]} rg {x} {y} {w} {h} re f")

    def texto(x, y, s, tam=10, negrita=False, rgb=(0.11, 0.15, 0.2)):
        fuente = "F2" if negrita else "F1"
        c.append(f"BT {rgb[0]} {rgb[1]} {rgb[2]} rg /{fuente} {tam} Tf {x} {y} Td "
                 f"({_pdf_texto(s)}) Tj ET")

    navy = (0.043, 0.122, 0.227)
    coral = (1, 0.478, 0.271)
    gris = (0.45, 0.5, 0.57)
    blanco = (1, 1, 1)

    rect(0, 0, W, H, (1, 1, 1))
    rect(0, H - 56, W, 56, navy)
    texto(24, H - 36, "SkyCheck", 20, True, blanco)
    texto(130, H - 35, "ACES Airlines  -  Pasabordo / Boarding pass", 11, False, (0.8, 0.85, 0.92))
    rect(0, H - 60, W, 4, coral)

    origen = ticket.get("origen", "---")
    destino = ticket.get("destino", "---")
    texto(24, 190, origen, 40, True, navy)
    texto(150, 200, ">", 26, True, coral)
    texto(185, 190, destino, 40, True, navy)

    def campo(x, y, etiqueta, valor):
        texto(x, y + 14, etiqueta.upper(), 7, True, gris)
        texto(x, y, valor, 12, True, navy)

    campo(24, 140, "Pasajero", ticket.get("nombre", ""))
    campo(24, 100, "Vuelo", ticket.get("vuelo", ""))
    campo(110, 100, "Fecha", str(ticket.get("fecha_vuelo", ""))[:16].replace("T", " "))
    campo(250, 100, "Asiento", ticket.get("asiento", ""))
    campo(330, 100, "Reserva", ticket.get("id_ticket", ""))
    campo(24, 60, "Documento", ticket.get("documento", ""))
    campo(180, 60, "Maletas facturadas", str(ticket.get("maletas_confirmadas", 0)))
    campo(330, 60, "Check-in (COL)", hora_colombia(ticket.get("checkin_en", "")))

    # Talón (lado derecho) con línea punteada
    c.append(f"0.8 0.83 0.87 RG [4 4] 0 d 1 w 440 10 m 440 {H - 70} l S [] 0 d")
    campo(458, 190, "Vuelo", ticket.get("vuelo", ""))
    campo(458, 150, "Asiento", ticket.get("asiento", ""))
    campo(458, 110, "Ruta", f"{origen} > {destino}")
    # "código de barras" decorativo generado a partir del id
    semilla = sum(ord(ch) for ch in ticket.get("id_ticket", "X"))
    rnd = random.Random(semilla)
    x = 458
    while x < 590:
        ancho = rnd.choice([1, 1, 2, 3])
        rect(x, 30, ancho, 50, navy)
        x += ancho + rnd.choice([1, 2, 2, 3])
    texto(24, 20, "Presenta este pasabordo y tu documento en la puerta de embarque.", 8, False, gris)

    contenido = "\n".join(c).encode("cp1252", "replace")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] "
         "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>").encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(contenido)).encode() + b" >>\nstream\n" + contenido + b"\nendstream",
    ]
    salida = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, obj in enumerate(objetos, start=1):
        offsets.append(len(salida))
        salida += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        salida += f"{off:010d} 00000 n \n".encode()
    salida += (f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
               f"startxref\n{xref}\n%%EOF\n").encode()
    return bytes(salida)
