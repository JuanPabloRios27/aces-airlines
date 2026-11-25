"""
Servidor local que corre el back REAL (las lambdas) sobre AWS simulado (moto).
Sirve para probar el front contra las lambdas sin gastar nada en AWS.

    pip install boto3 "moto[dynamodb,s3,sqs,ses]"
    python tests/servidor_local.py          # abre http://localhost:8000

Al arrancar crea una reserva de prueba para laura@demo.co (el código sale en consola).
Clave de agente: clave-local
Los "correos" que mandaría SES se imprimen en la consola.
"""
import importlib.util
import json
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = int(os.environ.get("PUERTO", "8000"))
URL = f"http://localhost:{PUERTO}"
sys.path.insert(0, os.path.join(RAIZ, "lambdas", "comun", "python"))
os.environ.update({
    "AWS_REGION": "us-east-2", "AWS_DEFAULT_REGION": "us-east-2",
    "AWS_ACCESS_KEY_ID": "local", "AWS_SECRET_ACCESS_KEY": "local",
    "BUCKET_MALETAS": "aces-maletas-local", "BUCKET_TICKETS": "aces-tickets-local",
    "CORREO_REMITENTE": "skycheck@local.test", "AGENT_KEY": "clave-local",
    "WEB_DIR": os.path.join(RAIZ, "frontend"), "MALETA_API_URL": URL, "TICKET_API_URL": URL,
})

import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

mock = mock_aws()
mock.start()


def cargar(carpeta):
    spec = importlib.util.spec_from_file_location(
        carpeta.replace("-", "_"), os.path.join(RAIZ, "lambdas", carpeta, "lambda_function.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def crear_recursos():
    import aces_comun
    ddb = boto3.client("dynamodb")
    tablas = {
        "ticket-db": ("id_ticket", {"por-propietario": "id_propietario", "por-vuelo": "vuelo"}),
        "maleta-db": ("id_maleta", {"por-ticket": "id_ticket", "por-estado": "estado"}),
        "autentification-db": ("auth_id", {"por-usuario": "user_id"}),
    }
    for nombre, (pk, gsis) in tablas.items():
        ddb.create_table(
            TableName=nombre, BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": pk, "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"}
                                  for a in {pk, *gsis.values()}],
            GlobalSecondaryIndexes=[{"IndexName": n,
                                     "KeySchema": [{"AttributeName": a, "KeyType": "HASH"}],
                                     "Projection": {"ProjectionType": "ALL"}}
                                    for n, a in gsis.items()])
    s3 = boto3.client("s3")
    for b in ("aces-maletas-local", "aces-tickets-local"):
        s3.create_bucket(Bucket=b, CreateBucketConfiguration={"LocationConstraint": "us-east-2"})
    sqs = boto3.client("sqs")
    aces_comun.COLA_MALETAS = sqs.create_queue(QueueName="queueMaletas")["QueueUrl"]
    aces_comun.COLA_TICKETS = sqs.create_queue(QueueName="queueTickets")["QueueUrl"]
    boto3.client("ses").verify_email_identity(EmailAddress="skycheck@local.test")
    # Mostrar en consola los correos que "manda" SES
    original = aces_comun.enviar_correo

    def correo_en_consola(destino, asunto, html, adjunto=None):
        texto = re.sub(r"<[^>]+>", " ", html)
        print(f"\n📧  PARA: {destino}\n    ASUNTO: {asunto}\n    {' '.join(texto.split())[:300]}"
              + (f"\n    ADJUNTO: {adjunto[0]}" if adjunto else ""))
        original(destino, asunto, html, adjunto)

    aces_comun.enviar_correo = correo_en_consola


crear_recursos()
import aces_comun  # noqa: E402

L = {c: cargar(c) for c in ("funcionMaleta", "funcionMaletaRevisar", "funcionMaletaConfirmation",
                            "funcionMaletaNoti", "funcionTicket", "funcionCodAuth",
                            "funcionEliminaTicket", "funcionTicketNotification", "aces-index")}

# Mismas rutas que main.tf
RUTAS = [
    ("POST /maletas/revisar", "funcionMaletaRevisar"),
    ("POST /maletas/{id_maleta}/confirmar", "funcionMaletaConfirmation"),
    ("POST /maletas", "funcionMaleta"), ("GET /maletas", "funcionMaleta"),
    ("DELETE /maletas/{id_maleta}", "funcionMaleta"),
    ("POST /tickets/{id_ticket}/cancelacion/confirmar", "funcionEliminaTicket"),
    ("POST /tickets/{id_ticket}/cancelacion", "funcionCodAuth"),
    ("POST /tickets/{id_ticket}/checkin", "funcionTicket"),
    ("POST /tickets", "funcionTicket"), ("GET /tickets", "funcionTicket"),
    ("GET /tickets/{id_ticket}", "funcionTicket"), ("PUT /tickets/{id_ticket}", "funcionTicket"),
]


def buscar_ruta(metodo, path):
    for ruta, lam in RUTAS:
        m, plantilla = ruta.split(" ")
        if m != metodo:
            continue
        regex = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", plantilla) + "$"
        ok = re.match(regex, path)
        if ok:
            return ruta, lam, ok.groupdict()
    return "$default", "aces-index", {}


def vaciar_colas():
    sqs = boto3.client("sqs")
    for url, lam in ((aces_comun.COLA_MALETAS, "funcionMaletaNoti"),
                     (aces_comun.COLA_TICKETS, "funcionTicketNotification")):
        msgs = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get("Messages", [])
        if msgs:
            L[lam].lambda_handler({"Records": [{"messageId": m["MessageId"], "body": m["Body"]}
                                               for m in msgs]}, None)
            for m in msgs:
                sqs.delete_message(QueueUrl=url, ReceiptHandle=m["ReceiptHandle"])


class Manejador(BaseHTTPRequestHandler):
    def _atender(self):
        url = urllib.parse.urlsplit(self.path)
        ruta, lam, params = buscar_ruta(self.command, url.path)
        largo = int(self.headers.get("Content-Length") or 0)
        query = dict(urllib.parse.parse_qsl(url.query)) or None
        evento = {
            "routeKey": ruta, "rawPath": url.path, "rawQueryString": url.query,
            "requestContext": {"http": {"method": self.command}},
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "queryStringParameters": query, "pathParameters": params or None,
            "body": self.rfile.read(largo).decode() if largo else None, "isBase64Encoded": False,
        }
        r = L[lam].lambda_handler(evento, None)
        cuerpo = r["body"].encode("utf-8")
        self.send_response(int(r["statusCode"]))
        for k, v in r.get("headers", {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)
        vaciar_colas()

    do_GET = do_POST = do_PUT = do_DELETE = _atender

    def log_message(self, fmt, *args):
        if "/tickets" in self.path or "/maletas" in self.path:
            print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


if __name__ == "__main__":
    # Reserva de prueba
    t = L["funcionTicket"]
    r = t.lambda_handler({
        "routeKey": "POST /tickets", "rawPath": "/tickets",
        "requestContext": {"http": {"method": "POST"}}, "headers": {"x-agent-key": "clave-local"},
        "body": json.dumps({"nombre": "Laura Pérez", "correo": "laura@demo.co",
                            "documento": "1012345678", "telefono": "+57 3001234567",
                            "vuelo": "AC204", "origen": "BOG", "destino": "MDE",
                            "fecha_vuelo": "2026-12-15T07:30", "asiento": "12A"})}, None)
    codigo = json.loads(r["body"])["ticket"]["id_ticket"]
    vaciar_colas()
    print(f"\n✈  SkyCheck local en {URL}\n   Reserva de prueba: {codigo} / laura@demo.co"
          f"\n   Clave de agente: clave-local\n")
    ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador).serve_forever()
