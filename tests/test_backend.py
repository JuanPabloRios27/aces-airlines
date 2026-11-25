"""
Pruebas del back con moto (AWS simulado en memoria, no gasta nada).

    pip install boto3 "moto[dynamodb,s3,sqs,ses]" pytest
    pytest -q tests/

Recorre los 6 flujos: crear reserva, registrar maleta, confirmar maleta,
modificar reserva, check-in con pasabordo, cancelación con MFA y los correos.
"""
import importlib.util
import json
import os
import sys

import boto3
import pytest
from moto import mock_aws

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAMBDAS = os.path.join(RAIZ, "lambdas")
sys.path.insert(0, os.path.join(LAMBDAS, "comun", "python"))

os.environ.update({
    "AWS_REGION": "us-east-2", "AWS_DEFAULT_REGION": "us-east-2",
    "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test",
    "TABLA_TICKETS": "ticket-db", "TABLA_MALETAS": "maleta-db",
    "TABLA_AUTH": "autentification-db", "BUCKET_MALETAS": "aces-maletas-test",
    "BUCKET_TICKETS": "aces-tickets-test", "CORREO_REMITENTE": "skycheck@ejemplo.com",
    "AGENT_KEY": "clave-agente",
})
AGENTE = {"x-agent-key": "clave-agente"}


def cargar(carpeta):
    spec = importlib.util.spec_from_file_location(
        carpeta, os.path.join(LAMBDAS, carpeta, "lambda_function.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def evento(ruta, path, body=None, query=None, params=None, headers=None):
    return {
        "routeKey": ruta, "rawPath": path,
        "requestContext": {"http": {"method": ruta.split(" ")[0]}},
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query, "pathParameters": params,
        "headers": headers or {}, "isBase64Encoded": False,
    }


def llamar(mod, *args, **kw):
    r = mod.lambda_handler(evento(*args, **kw), None)
    return r["statusCode"], json.loads(r["body"])


@pytest.fixture
def aws():
    with mock_aws():
        import aces_comun
        aces_comun._cache.clear()
        ddb = boto3.client("dynamodb", region_name="us-east-2")

        def crear_tabla(nombre, pk, gsis):
            attrs = {pk} | set(gsis.values())
            ddb.create_table(
                TableName=nombre, BillingMode="PAY_PER_REQUEST",
                KeySchema=[{"AttributeName": pk, "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in attrs],
                GlobalSecondaryIndexes=[{
                    "IndexName": n, "KeySchema": [{"AttributeName": a, "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"}} for n, a in gsis.items()] or None,
            ) if gsis else ddb.create_table(
                TableName=nombre, BillingMode="PAY_PER_REQUEST",
                KeySchema=[{"AttributeName": pk, "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": pk, "AttributeType": "S"}])

        crear_tabla("ticket-db", "id_ticket", {"por-propietario": "id_propietario",
                                               "por-vuelo": "vuelo"})
        crear_tabla("maleta-db", "id_maleta", {"por-ticket": "id_ticket", "por-estado": "estado"})
        crear_tabla("autentification-db", "auth_id", {"por-usuario": "user_id"})
        s3 = boto3.client("s3", region_name="us-east-2")
        for b in ("aces-maletas-test", "aces-tickets-test"):
            s3.create_bucket(Bucket=b, CreateBucketConfiguration={"LocationConstraint": "us-east-2"})
        sqs = boto3.client("sqs", region_name="us-east-2")
        aces_comun.COLA_MALETAS = sqs.create_queue(QueueName="queueMaletas")["QueueUrl"]
        aces_comun.COLA_TICKETS = sqs.create_queue(QueueName="queueTickets")["QueueUrl"]
        boto3.client("ses", region_name="us-east-2").verify_email_identity(
            EmailAddress="skycheck@ejemplo.com")
        aces_comun.BUCKET_MALETAS = "aces-maletas-test"
        aces_comun.BUCKET_TICKETS = "aces-tickets-test"
        yield sqs


def vaciar_cola(sqs, url):
    msgs = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get("Messages", [])
    for m in msgs:
        sqs.delete_message(QueueUrl=url, ReceiptHandle=m["ReceiptHandle"])
    return {"Records": [{"messageId": m["MessageId"], "body": m["Body"]} for m in msgs]}


def test_flujo_completo(aws):
    import aces_comun
    sqs = aws
    ticket_l = cargar("funcionTicket")
    maleta_l = cargar("funcionMaleta")
    revisar_l = cargar("funcionMaletaRevisar")
    confirmar_l = cargar("funcionMaletaConfirmation")
    noti_m = cargar("funcionMaletaNoti")
    noti_t = cargar("funcionTicketNotification")
    auth_l = cargar("funcionCodAuth")
    elimina_l = cargar("funcionEliminaTicket")

    # --- crear reserva (agente)
    datos = {"nombre": "Laura Pérez", "correo": "Laura@Correo.com", "documento": "1012345678",
             "vuelo": "ac204", "origen": "bog", "destino": "MDE",
             "fecha_vuelo": "2026-12-15T07:30", "asiento": "12a"}
    st, _ = llamar(ticket_l, "POST /tickets", "/tickets", body=datos)
    assert st == 401
    st, r = llamar(ticket_l, "POST /tickets", "/tickets", body=datos, headers=AGENTE)
    assert st == 201, r
    t = r["ticket"]
    tid = t["id_ticket"]
    assert t["id_propietario"] == "laura@correo.com" and t["asiento"] == "12A"
    # mismo asiento en el mismo vuelo -> 409
    st, _ = llamar(ticket_l, "POST /tickets", "/tickets", body={**datos, "correo": "x@y.co"},
                   headers=AGENTE)
    assert st == 409

    # correo de reserva creada
    ev = vaciar_cola(sqs, aces_comun.COLA_TICKETS)
    assert noti_t.lambda_handler(ev, None) == {"batchItemFailures": []}

    # --- consultar con correo equivocado -> 404
    st, _ = llamar(ticket_l, "GET /tickets/{id_ticket}", f"/tickets/{tid}",
                   query={"correo": "otro@correo.com"}, params={"id_ticket": tid})
    assert st == 404

    # --- revisar peso
    st, r = llamar(revisar_l, "POST /maletas/revisar", "/maletas/revisar",
                   body={"tipo": "bodega", "peso_kg": 25})
    assert st == 200 and r["exceso_kg"] == 2 and r["cargo_exceso"] == 30000 and r["permitido"]
    st, r = llamar(revisar_l, "POST /maletas/revisar", "/maletas/revisar",
                   body={"tipo": "cabina", "peso_kg": 12})
    assert not r["permitido"]

    # --- registrar maletas
    st, r = llamar(maleta_l, "POST /maletas", "/maletas",
                   body={"id_ticket": tid, "correo": "laura@correo.com", "tipo": "bodega",
                         "peso_kg": 25, "descripcion": "Maleta roja"})
    assert st == 201, r
    mid = r["maleta"]["id_maleta"]
    st, r = llamar(maleta_l, "POST /maletas", "/maletas",
                   body={"id_ticket": tid, "correo": "laura@correo.com", "tipo": "cabina",
                         "peso_kg": 8})
    assert st == 201
    mid2 = r["maleta"]["id_maleta"]
    st, r = llamar(maleta_l, "POST /maletas", "/maletas",
                   body={"id_ticket": tid, "correo": "laura@correo.com", "tipo": "cabina",
                         "peso_kg": 15})
    assert st == 422

    # quitar la de cabina
    st, _ = llamar(maleta_l, "DELETE /maletas/{id_maleta}", f"/maletas/{mid2}",
                   query={"id_ticket": tid, "correo": "laura@correo.com"},
                   params={"id_maleta": mid2})
    assert st == 200

    # pendientes (agente)
    st, r = llamar(maleta_l, "GET /maletas", "/maletas", query={"estado": "pendiente"},
                   headers=AGENTE)
    assert st == 200 and [m["id_maleta"] for m in r["maletas"]] == [mid]
    assert r["maletas"][0]["ticket"]["nombre"] == "Laura Pérez"

    # --- confirmar maleta con peso real
    st, r = llamar(confirmar_l, "POST /maletas/{id_maleta}/confirmar", f"/maletas/{mid}/confirmar",
                   body={"peso_real_kg": 22.4}, params={"id_maleta": mid}, headers=AGENTE)
    assert st == 200, r
    assert r["maleta"]["estado"] == "confirmada" and r["maleta"]["cargo_exceso"] == 0
    assert r["comprobante_url"].startswith("https://")
    ev = vaciar_cola(sqs, aces_comun.COLA_MALETAS)
    assert len(ev["Records"]) == 1
    assert noti_m.lambda_handler(ev, None) == {"batchItemFailures": []}
    st, _ = llamar(confirmar_l, "POST /maletas/{id_maleta}/confirmar", f"/maletas/{mid}/confirmar",
                   params={"id_maleta": mid}, headers=AGENTE)
    assert st == 409

    # --- modificar reserva
    st, r = llamar(ticket_l, "PUT /tickets/{id_ticket}", f"/tickets/{tid}",
                   body={"correo": "laura@correo.com", "asiento": "3C", "telefono": "+57 3001234567"},
                   params={"id_ticket": tid})
    assert st == 200, r
    assert r["cambios"] == {"asiento": "3C", "telefono": "+57 3001234567"}
    ev = vaciar_cola(sqs, aces_comun.COLA_TICKETS)
    assert noti_t.lambda_handler(ev, None) == {"batchItemFailures": []}

    # --- check-in -> pasabordo PDF
    st, r = llamar(ticket_l, "POST /tickets/{id_ticket}/checkin", f"/tickets/{tid}/checkin",
                   body={"correo": "laura@correo.com"}, params={"id_ticket": tid})
    assert st == 200, r
    assert r["ticket"]["estado"] == "checkin" and r["ticket"]["pasabordo_url"]
    pdf = boto3.client("s3", region_name="us-east-2").get_object(
        Bucket="aces-tickets-test", Key=f"pasabordos/{tid}.pdf")["Body"].read()
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    with open("/tmp/pasabordo-prueba.pdf", "wb") as f:
        f.write(pdf)
    ev = vaciar_cola(sqs, aces_comun.COLA_TICKETS)
    assert noti_t.lambda_handler(ev, None) == {"batchItemFailures": []}
    # ya no se puede modificar
    st, _ = llamar(ticket_l, "PUT /tickets/{id_ticket}", f"/tickets/{tid}",
                   body={"correo": "laura@correo.com", "asiento": "4C"}, params={"id_ticket": tid})
    assert st == 409

    # --- cancelación con MFA
    st, r = llamar(auth_l, "POST /tickets/{id_ticket}/cancelacion", f"/tickets/{tid}/cancelacion",
                   body={"correo": "laura@correo.com"}, params={"id_ticket": tid})
    assert st == 200, r
    st, _ = llamar(auth_l, "POST /tickets/{id_ticket}/cancelacion", f"/tickets/{tid}/cancelacion",
                   body={"correo": "laura@correo.com"}, params={"id_ticket": tid})
    assert st == 429  # reenvío muy rápido
    ev = vaciar_cola(sqs, aces_comun.COLA_TICKETS)
    codigo = json.loads(ev["Records"][0]["body"])["codigo"]
    assert noti_t.lambda_handler(ev, None) == {"batchItemFailures": []}

    malo = "000000" if codigo != "000000" else "111111"
    st, r = llamar(elimina_l, "POST /tickets/{id_ticket}/cancelacion/confirmar",
                   f"/tickets/{tid}/cancelacion/confirmar",
                   body={"correo": "laura@correo.com", "codigo": malo}, params={"id_ticket": tid})
    assert st == 401 and r["intentos_restantes"] == 4
    st, r = llamar(elimina_l, "POST /tickets/{id_ticket}/cancelacion/confirmar",
                   f"/tickets/{tid}/cancelacion/confirmar",
                   body={"correo": "laura@correo.com", "codigo": codigo}, params={"id_ticket": tid})
    assert st == 200, r
    assert r["ticket"]["estado"] == "cancelado"
    st, r = llamar(ticket_l, "GET /tickets/{id_ticket}", f"/tickets/{tid}",
                   query={"correo": "laura@correo.com"}, params={"id_ticket": tid})
    assert r["ticket"]["estado"] == "cancelado"
    assert all(m["estado"] == "cancelada" for m in r["ticket"]["maletas"])
    ev = vaciar_cola(sqs, aces_comun.COLA_TICKETS)
    assert noti_t.lambda_handler(ev, None) == {"batchItemFailures": []}

    # listado (agente)
    st, r = llamar(ticket_l, "GET /tickets", "/tickets", headers=AGENTE)
    assert st == 200 and len(r["tickets"]) == 1


def test_errores_controlados(aws):
    ticket_l = cargar("funcionTicket")
    r = ticket_l.lambda_handler({**evento("POST /tickets", "/tickets", headers=AGENTE),
                                 "body": "{no es json"}, None)
    assert r["statusCode"] == 400
    st, r = llamar(ticket_l, "GET /tickets/{id_ticket}", "/tickets/NOEXISTE",
                   query={"correo": "a@b.co"}, params={"id_ticket": "NOEXISTE"})
    assert st == 404


def test_aces_index(tmp_path):
    (tmp_path / "index.html").write_text("<h1>hola</h1>", encoding="utf-8")
    os.environ["WEB_DIR"] = str(tmp_path)
    os.environ["MALETA_API_URL"] = "https://maletas.example"
    idx = cargar("aces-index")

    def get(path):
        return idx.lambda_handler({"rawPath": path,
                                   "requestContext": {"http": {"method": "GET"}}}, None)

    assert get("/")["body"] == "<h1>hola</h1>"
    assert "https://maletas.example" in get("/js/config.js")["body"]
    assert get("/../../etc/passwd.html")["statusCode"] == 404
    assert get("/nada.html")["statusCode"] == 404
