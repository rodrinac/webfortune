terraform {
  required_version = ">= 1.11.0"
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "eu-west-1"
}
variable "image_uri" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "Use an immutable ECR image digest, not a mutable tag."
  }
}
variable "runtime_role_arn" { type = string }
variable "api_id" { type = string }

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "webfortune", ManagedBy = "Terraform" }
  }
}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/webfortune-prod"
  retention_in_days = 14
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/webfortune-prod"
  retention_in_days = 14
}
resource "aws_lambda_function" "app" {
  function_name = "webfortune-prod"
  role          = var.runtime_role_arn
  package_type  = "Image"
  image_uri     = var.image_uri
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10
  depends_on    = [aws_cloudwatch_log_group.lambda]
}
resource "aws_apigatewayv2_integration" "app" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.app.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 12000
}
resource "aws_apigatewayv2_route" "app" {
  api_id    = var.api_id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.app.id}"
}
resource "aws_apigatewayv2_stage" "prod" {
  api_id      = var.api_id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId", status = "$context.status"
      routeKey  = "$context.routeKey", integrationError = "$context.integrationErrorMessage"
    })
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id   = "AllowWebfortuneAPI"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.app.function_name
  principal      = "apigateway.amazonaws.com"
  source_arn     = "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${var.api_id}/*/*"
  source_account = data.aws_caller_identity.current.account_id
}
output "api_url" { value = "https://${var.api_id}.execute-api.${var.aws_region}.amazonaws.com" }
