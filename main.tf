# =============================================================================
#  SkyCheck · ACES Airlines  —  Infraestructura completa (Terraform)
#
#  terraform init
#  terraform apply -var="correo_remitente=tu_correo@gmail.com"
#
#  Al terminar imprime "url_web": esa es la página de SkyCheck.
#  (SES está en modo sandbox: revisa el correo de verificación que te llega
#   a cada dirección y dale clic al enlace antes de probar los correos.)
# =============================================================================
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.region
}

# ----------------------------------------------------------------- variables
variable "region" {
  type    = string
  default = "us-east-2"
}

variable "correo_remitente" {
  description = "Correo desde el que SES envía (se verifica en SES)"
  type        = string
}

variable "correos_verificados" {
  description = "Correos extra que pueden RECIBIR mientras SES esté en sandbox (los de las pruebas)"
  type        = list(string)
  default     = []
}

variable "agent_key" {
  description = "Clave que usa el agente/gerente en la vista de agente"
  type        = string
  default     = "aces-agente-2026"
  sensitive   = true
}

variable "rol_lambda_existente_arn" {
  description = "Si tu cuenta no deja crear roles IAM (ej. AWS Academy), pon aquí el ARN de un rol existente (LabRole)"
  type        = string
  default     = ""
}

data "aws_caller_identity" "actual" {}

locals {
  sufijo = data.aws_caller_identity.actual.account_id

  # Lambdas Python con su carpeta y la API donde se exponen (null = las dispara SQS)
  lambdas = {
    "maleta-lambda"       = { carpeta = "funcionMaleta", api = "maletas" }
    "maleta-revisar"      = { carpeta = "funcionMaletaRevisar", api = "maletas" }
    "maleta-confirmacion" = { carpeta = "funcionMaletaConfirmation", api = "maletas" }
    "maleta-notification" = { carpeta = "funcionMaletaNoti", api = null }
    "ticket-lambda"       = { carpeta = "funcionTicket", api = "tickets" }
    "cod-auth"            = { carpeta = "funcionCodAuth", api = "tickets" }
    "elimina-ticket"      = { carpeta = "funcionEliminaTicket", api = "tickets" }
    "ticket-notification" = { carpeta = "funcionTicketNotification", api = null }
  }

  # Lambdas conectadas a API Gateway -> nombre de la API
  funciones_http = merge(
    { for k, v in local.lambdas : k => v.api if v.api != null },
    { "aces-index" = "tickets" }
  )

  # Rutas de cada API -> lambda que las atiende
  rutas = {
    "POST /maletas"                                 = { api = "maletas", lambda = "maleta-lambda" }
    "GET /maletas"                                  = { api = "maletas", lambda = "maleta-lambda" }
    "DELETE /maletas/{id_maleta}"                   = { api = "maletas", lambda = "maleta-lambda" }
    "POST /maletas/revisar"                         = { api = "maletas", lambda = "maleta-revisar" }
    "POST /maletas/{id_maleta}/confirmar"           = { api = "maletas", lambda = "maleta-confirmacion" }
    "POST /tickets"                                 = { api = "tickets", lambda = "ticket-lambda" }
    "GET /tickets"                                  = { api = "tickets", lambda = "ticket-lambda" }
    "GET /tickets/{id_ticket}"                      = { api = "tickets", lambda = "ticket-lambda" }
    "PUT /tickets/{id_ticket}"                      = { api = "tickets", lambda = "ticket-lambda" }
    "POST /tickets/{id_ticket}/checkin"             = { api = "tickets", lambda = "ticket-lambda" }
    "POST /tickets/{id_ticket}/cancelacion"         = { api = "tickets", lambda = "cod-auth" }
    "POST /tickets/{id_ticket}/cancelacion/confirmar" = { api = "tickets", lambda = "elimina-ticket" }
    # Todo lo demás (/, /index.html, /css/...) lo sirve la lambda del front
    "$default" = { api = "tickets", lambda = "aces-index" }
  }

  rol_arn = var.rol_lambda_existente_arn != "" ? var.rol_lambda_existente_arn : one(aws_iam_role.lambda_rol[*].arn)

  entorno = {
    TABLA_TICKETS    = aws_dynamodb_table.tickets.name
    TABLA_MALETAS    = aws_dynamodb_table.maletas.name
    TABLA_AUTH       = aws_dynamodb_table.auth.name
    BUCKET_MALETAS   = aws_s3_bucket.maletas.bucket
    BUCKET_TICKETS   = aws_s3_bucket.tickets.bucket
    COLA_MALETAS     = aws_sqs_queue.maletas.url
    COLA_TICKETS     = aws_sqs_queue.tickets.url
    CORREO_REMITENTE = var.correo_remitente
    AGENT_KEY        = var.agent_key
  }
}

# ----------------------------------------------------------------------- IAM
resource "aws_iam_role" "lambda_rol" {
  count = var.rol_lambda_existente_arn == "" ? 1 : 0
  name  = "ACES-ROLES-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole",
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "logs" {
  count      = var.rol_lambda_existente_arn == "" ? 1 : 0
  role       = aws_iam_role.lambda_rol[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "permisos" {
  count = var.rol_lambda_existente_arn == "" ? 1 : 0
  name  = "skycheck-permisos"
  role  = aws_iam_role.lambda_rol[0].id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"],
        Resource = flatten([for t in [aws_dynamodb_table.tickets, aws_dynamodb_table.maletas, aws_dynamodb_table.auth] :
        [t.arn, "${t.arn}/index/*"]])
      },
      {
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = ["${aws_s3_bucket.maletas.arn}/*", "${aws_s3_bucket.tickets.arn}/*"]
      },
      {
        Effect = "Allow",
        Action = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"],
        Resource = [aws_sqs_queue.maletas.arn, aws_sqs_queue.tickets.arn]
      },
      {
        Effect   = "Allow",
        Action   = ["ses:SendEmail", "ses:SendRawEmail"],
        Resource = "*"
      }
    ]
  })
}

# ----------------------------------------------------------------------- SQS
resource "aws_sqs_queue" "dead_petitions" {
  name = "dead_petitions_queue"
}

resource "aws_sqs_queue" "maletas" {
  name                       = "queueMaletas"
  delay_seconds              = 0 # antes 90: los correos llegaban 1,5 min tarde
  max_message_size           = 4096
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60 # debe ser >= al timeout de la lambda
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_petitions.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "tickets" {
  name                       = "queueTickets"
  delay_seconds              = 0
  max_message_size           = 4096
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_petitions.arn
    maxReceiveCount     = 3
  })
}

# ------------------------------------------------------------------ DynamoDB
resource "aws_dynamodb_table" "maletas" {
  name         = "maleta-db"
  billing_mode = "PAY_PER_REQUEST" # capa gratuita
  hash_key     = "id_maleta"

  attribute {
    name = "id_maleta"
    type = "S"
  }
  attribute {
    name = "id_ticket"
    type = "S"
  }
  attribute {
    name = "estado"
    type = "S"
  }
  global_secondary_index {
    name            = "por-ticket" # maletas de una reserva
    hash_key        = "id_ticket"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "por-estado" # maletas pendientes para el agente
    hash_key        = "estado"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "tickets" {
  name         = "ticket-db"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id_ticket"

  attribute {
    name = "id_ticket"
    type = "S"
  }
  attribute {
    name = "id_propietario"
    type = "S"
  }
  attribute {
    name = "vuelo"
    type = "S"
  }
  global_secondary_index {
    name            = "por-propietario"
    hash_key        = "id_propietario"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "por-vuelo" # para validar asientos ocupados
    hash_key        = "vuelo"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "auth" {
  name         = "autentification-db"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "auth_id" # = id_ticket

  attribute {
    name = "auth_id"
    type = "S"
  }
  attribute {
    name = "user_id"
    type = "S"
  }
  global_secondary_index {
    name            = "por-usuario"
    hash_key        = "user_id"
    projection_type = "ALL"
  }
  ttl {
    attribute_name = "expira" # DynamoDB borra solo los códigos vencidos
    enabled        = true
  }
}

# ------------------------------------------------------------------------ S3
# Los nombres de bucket son únicos en TODO AWS; por eso llevan el id de la cuenta.
resource "aws_s3_bucket" "maletas" {
  bucket        = "aces-maletas-${local.sufijo}"
  force_destroy = true
  tags          = { proyecto = "skycheck", contenido = "comprobantes-maletas" }
}

resource "aws_s3_bucket" "tickets" {
  bucket        = "aces-tickets-${local.sufijo}"
  force_destroy = true
  tags          = { proyecto = "skycheck", contenido = "pasabordos" }
}

resource "aws_s3_bucket_public_access_block" "maletas" {
  bucket                  = aws_s3_bucket.maletas.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "tickets" {
  bucket                  = aws_s3_bucket.tickets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ----------------------------------------------------------------------- SES
resource "aws_ses_email_identity" "correos" {
  for_each = toset(concat([var.correo_remitente], var.correos_verificados))
  email    = each.value
}

# -------------------------------------------------------------------- Lambda
data "archive_file" "comun" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/comun"
  output_path = "${path.module}/.build/layer-comun.zip"
}

resource "aws_lambda_layer_version" "comun" {
  layer_name          = "aces-comun"
  filename            = data.archive_file.comun.output_path
  source_code_hash    = data.archive_file.comun.output_base64sha256
  compatible_runtimes = ["python3.12"]
}

data "archive_file" "web" {
  type        = "zip"
  source_dir  = "${path.module}/frontend"
  output_path = "${path.module}/.build/layer-web.zip"
}

resource "aws_lambda_layer_version" "web" {
  layer_name          = "aces-web"
  filename            = data.archive_file.web.output_path
  source_code_hash    = data.archive_file.web.output_base64sha256
  compatible_runtimes = ["python3.12"]
}

data "archive_file" "fn" {
  for_each    = merge({ for k, v in local.lambdas : k => v.carpeta }, { "aces-index" = "aces-index" })
  type        = "zip"
  source_dir  = "${path.module}/lambdas/${each.value}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_lambda_function" "fn" {
  for_each         = local.lambdas
  function_name    = each.key
  role             = local.rol_arn
  runtime          = "python3.12"
  handler          = "lambda_function.lambda_handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  layers           = [aws_lambda_layer_version.comun.arn]
  timeout          = 15
  memory_size      = 256

  environment {
    variables = local.entorno
  }

  depends_on = [aws_iam_role_policy.permisos, aws_iam_role_policy_attachment.logs]
}

resource "aws_lambda_function" "aces_index" {
  function_name    = "aces-index"
  role             = local.rol_arn
  runtime          = "python3.12"
  handler          = "lambda_function.lambda_handler"
  filename         = data.archive_file.fn["aces-index"].output_path
  source_code_hash = data.archive_file.fn["aces-index"].output_base64sha256
  layers           = [aws_lambda_layer_version.web.arn]
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      MALETA_API_URL = aws_apigatewayv2_api.api["maletas"].api_endpoint
      TICKET_API_URL = aws_apigatewayv2_api.api["tickets"].api_endpoint
    }
  }

  depends_on = [aws_iam_role_policy_attachment.logs]
}

locals {
  invoke_arns = merge(
    { for k, f in aws_lambda_function.fn : k => f.invoke_arn },
    { "aces-index" = aws_lambda_function.aces_index.invoke_arn }
  )
  nombres_funciones = merge(
    { for k, f in aws_lambda_function.fn : k => f.function_name },
    { "aces-index" = aws_lambda_function.aces_index.function_name }
  )
}

# Las notificaciones se disparan con los mensajes de SQS
resource "aws_lambda_event_source_mapping" "maletas" {
  event_source_arn        = aws_sqs_queue.maletas.arn
  function_name           = aws_lambda_function.fn["maleta-notification"].arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "tickets" {
  event_source_arn        = aws_sqs_queue.tickets.arn
  function_name           = aws_lambda_function.fn["ticket-notification"].arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}

# --------------------------------------------------------------- API Gateway
resource "aws_apigatewayv2_api" "api" {
  for_each      = { maletas = "maleta-api", tickets = "tickets-api" }
  name          = each.value
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "x-agent-key"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  for_each    = toset(["maletas", "tickets"])
  api_id      = aws_apigatewayv2_api.api[each.key].id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_apigatewayv2_integration" "int" {
  for_each               = local.funciones_http
  api_id                 = aws_apigatewayv2_api.api[each.value].id
  integration_type       = "AWS_PROXY"
  integration_uri        = local.invoke_arns[each.key]
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "ruta" {
  for_each  = local.rutas
  api_id    = aws_apigatewayv2_api.api[each.value.api].id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.int[each.value.lambda].id}"
}

resource "aws_lambda_permission" "apigw" {
  for_each      = local.funciones_http
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = local.nombres_funciones[each.key]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api[each.value].execution_arn}/*"
}

# ------------------------------------------------------------------- Salidas
output "url_web" {
  description = "Abre esta URL en el navegador: es la página de SkyCheck"
  value       = "${aws_apigatewayv2_api.api["tickets"].api_endpoint}/"
}

output "maleta_api_url" {
  value = aws_apigatewayv2_api.api["maletas"].api_endpoint
}

output "ticket_api_url" {
  value = aws_apigatewayv2_api.api["tickets"].api_endpoint
}

output "buckets" {
  value = [aws_s3_bucket.maletas.bucket, aws_s3_bucket.tickets.bucket]
}
