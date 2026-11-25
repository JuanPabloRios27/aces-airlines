"""
aces-index  ·  Sirve la interfaz web (carpeta frontend/) de SkyCheck
Responsables: ambos (base compartida)

Está conectada a la ruta $default de tickets-api, así que todo lo que no sea
/tickets/... (por ejemplo /, /index.html, /css/styles.css) lo responde esta lambda.

Los archivos del front llegan en el Lambda Layer "aces-web", que AWS
descomprime en /opt. El archivo /js/config.js se genera aquí mismo con las URLs
reales de las APIs (vienen de variables de entorno puestas por Terraform), así
el front no necesita URLs escritas a mano.
"""
import json
import os

WEB_DIR = os.path.realpath(os.environ.get("WEB_DIR", "/opt"))
MALETA_API = os.environ.get("MALETA_API_URL", "")
TICKET_API = os.environ.get("TICKET_API_URL", "")

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


def _resp(status, cuerpo, tipo="text/html; charset=utf-8", cache="no-cache"):
    return {
        "statusCode": status,
        "headers": {"Content-Type": tipo, "Cache-Control": cache},
        "body": cuerpo,
    }


def lambda_handler(event, context):
    metodo = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    if metodo not in ("GET", "HEAD"):
        return _resp(404, json.dumps({"error": "Ruta no encontrada"}), TIPOS[".json"])

    path = event.get("rawPath", "/") or "/"
    if path.endswith("/"):
        path += "index.html"

    if path == "/js/config.js":
        config = {"maletaApi": MALETA_API.rstrip("/"), "ticketApi": TICKET_API.rstrip("/"),
                  "mock": False}
        return _resp(200, f"window.SKYCHECK_CONFIG = {json.dumps(config)};", TIPOS[".js"])

    ext = os.path.splitext(path)[1].lower()
    if ext not in TIPOS:
        return _resp(404, "<h1>404</h1>")

    # Evita salir de la carpeta web (../../etc/passwd)
    ruta = os.path.realpath(os.path.join(WEB_DIR, path.lstrip("/")))
    if not ruta.startswith(WEB_DIR + os.sep) or not os.path.isfile(ruta):
        return _resp(404, "<h1>404 · Página no encontrada</h1><a href='/'>Volver</a>")

    with open(ruta, encoding="utf-8") as f:
        contenido = f.read()
    cache = "no-cache" if ext == ".html" else "public, max-age=300"
    return _resp(200, contenido, TIPOS[ext], cache)
