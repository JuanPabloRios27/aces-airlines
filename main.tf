# main.tf
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
provider "aws"{
    region = "us-east-2"
}
resource "aws_iam_role" "lambda_rol"{
    name                = "ACES-ROLES-lambda"
    assume_role_policy    = jsonencode({Version = "0.1",Statement = [{ 
        Effect="Allow", Action = "sts:AssumeRole", 
        Principal = { Service = "lambda.amazonaws.com" }}]})
}
resource "aws_sqs_queue" "dead_petitions"{
    name = "dead_petitions_queue"
}
resource "aws_apigatewayv2_api" "http" {
    name            = "maleta-api"
    protocol_type   = "HTTP"
}
resource "aws_apigatewayv2_api" "http_secondary" {
    name            = "tickets-api"
    protocol_type   = "HTTP"
}
resource "aws_lambda_function" "api"{
    function_name = "maleta-lambda"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_secondary"{
    function_name = "maleta-revisar"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_tertiary"{
    function_name = "maleta-confirmacion"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_forty"{
    function_name = "cod-auth"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_firty"{
    function_name = "elimina-ticket"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_sixty"{
    function_name = "ticket-notification"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_lambda_function" "api_seventy"{
    function_name = "maleta-notification"
    role          = aws_iam_role.lambda_rol.arn
    runtime       = "python3.12"
    handler       = "app-handler"
    filename      = "funcion.zip"
}
resource "aws_dynamodb_table" "tabla_1" {
  name          = "maleta-db"
  billing_mode  = "PROVISIONED" #Esto ayude para que llegue a la capa grautita
  hash_key      = "id" #Hash key es la partition key
  range_key     = "id_registry" #Ordena el registro que van llegando las maletas
  attribute {
    name = "id"
    type = "S"
  } 
  attribute {
    name = "id_registry"
    type = "N"
  } 
  attribute {
    name= "user_propietario"
    type= "S"
  }
  global_secondary_index {
    name = "ticket-id"
    key_schema {
        attribute_name = "user_propietario"
        key_type = "HASH"
    }
    projection_type = "ALL"
  }
}
resource "aws_dynamodb_table" "tabla_2" {
    name          = "ticket-db"
    billing_mode  = "PROVISIONED" #Esto ayude para que llegue a la capa grautita
    hash_key      = "id_ticket" #Hash key es la partition key
    attribute {
        name    =  "id_ticket"
        type    =   "S"
    }
    attribute {
        name = "id_propietario"
        type = "S"
    }
    global_secondary_index {
        name = "content-ticket"
        key_schema {
            attribute_name = "id_propietario"
            key_type = "HASH"
        }
        projection_type = "ALL"
    }
}
resource "aws_dynamodb_table" "tabla_3" {
  name          =   "autentification-db"
  billing_mode  =   "PROVISIONED" #Esto ayude para que llegue a la capa grautita
  hash_key      =   "auth_id" #Hash key es la partition key
  attribute {
    name = "auth_id"
    type = "S"
  } 
  attribute {
    name = "user_id"
    type = "S"
  } 
  global_secondary_index {
    name = "user"
    key_schema {
        attribute_name = "user_id"
        key_type = "HASH"
    }
    projection_type = "ALL"
  }
}
resource "aws_s3_bucket" "bucket_1" {
  bucket = "maleta_almacen"
  tags = {
    maleta = "maleta"
  }
}
resource "aws_s3_bucket" "bucket_2"{
    bucket = "ticket_almacen"
    tags = {
      ticket = "ticket"
    }
}
resource "aws_sqs_queue" "main"{
    name                        = "queue-maletas"
    delay_seconds               = 90
    max_message_size            = 2408
    message_retention_seconds   = 86400
    receive_wait_time_seconds   = 10
    redrive_policy = jsonencode({
        deadLetterTargetArn = aws_sqs_queue.dead_petitions.arn
        maxReceiveCount     = 9
        })
    tags = {
        Environment = "production"
    }
}
resource "aws_sqs_queue" "main_2"{
    name                        = "queue-tickets"
    delay_seconds               = 90
    max_message_size            = 2408
    message_retention_seconds   = 86400
    receive_wait_time_seconds   = 10
    redrive_policy = jsonencode({
        deadLetterTargetArn     = aws_sqs_queue.dead_petitions.arn
        maxReceiveCount         = 9
    })
    tags = {
        Environment = "production"
    }
}