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
variable "state_bucket" { type = string }
variable "lock_table" { type = string }
variable "github_repository" {
  type    = string
  default = "rodrinac/webfortune"
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "webfortune", ManagedBy = "Terraform" }
  }
}
data "aws_caller_identity" "current" {}
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_ecr_repository" "app" {
  name                 = "webfortune"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_apigatewayv2_api" "app" {
  name          = "webfortune-prod"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["https://webfortune.app", "https://rodrinac.github.io"]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_iam_role" "runtime" {
  name = "webfortune-prod-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}
resource "aws_iam_role_policy" "runtime" {
  role = aws_iam_role.runtime.id
  name = "write-function-logs"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/webfortune-prod:*"
    }]
  })
}

resource "aws_iam_role" "deploy" {
  name = "webfortune-github-actions-production-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:production"
      } }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  role = aws_iam_role.deploy.id
  name = "deploy-webfortune"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid = "RegistryLogin", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*"
      },
      {
        Sid      = "PublishImages", Effect = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Sid      = "DeployFunction", Effect = "Allow"
        Action   = ["lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:DeleteFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:ListVersionsByFunction", "lambda:GetFunctionCodeSigningConfig", "lambda:GetPolicy", "lambda:AddPermission", "lambda:RemovePermission", "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags", "lambda:GetFunctionConcurrency", "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency"]
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:webfortune-prod"
      },
      {
        Sid       = "PassRuntimeRole", Effect = "Allow", Action = ["iam:PassRole"]
        Resource  = aws_iam_role.runtime.arn
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
      },
      {
        Sid      = "ConfigureOnlyThisAPI", Effect = "Allow"
        Action   = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE", "apigateway:TagResource", "apigateway:UntagResource"]
        Resource = ["arn:aws:apigateway:${var.aws_region}::/apis/${aws_apigatewayv2_api.app.id}", "arn:aws:apigateway:${var.aws_region}::/apis/${aws_apigatewayv2_api.app.id}/*"]
      },
      {
        Sid      = "ManageLogs", Effect = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:ListTagsLogGroup", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource"]
        Resource = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/webfortune-prod*", "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/apigateway/webfortune-prod*"]
      },
      {
        Sid = "DescribeLogs", Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*"
      },
      {
        Sid      = "ManageLogDelivery", Effect = "Allow"
        Action   = ["logs:CreateLogDelivery", "logs:DeleteLogDelivery", "logs:GetLogDelivery", "logs:ListLogDeliveries", "logs:UpdateLogDelivery"]
        Resource = "*"
      },
      {
        Sid    = "ManageLogResourcePolicy", Effect = "Allow"
        Action = ["logs:DescribeResourcePolicies", "logs:PutResourcePolicy"], Resource = "*"
      },
      {
        Sid       = "ReadStateBucket", Effect = "Allow", Action = ["s3:ListBucket"]
        Resource  = "arn:aws:s3:::${var.state_bucket}"
        Condition = { StringLike = { "s3:prefix" = ["webfortune/prod/*"] } }
      },
      {
        Sid      = "ServiceState", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/webfortune/prod/terraform.tfstate"
      },
      {
        Sid      = "ServiceStateLock", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/webfortune/prod/terraform.tfstate.tflock"
      },
      {
        Sid       = "StateLock", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource  = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.lock_table}"
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["${var.state_bucket}/webfortune/prod/terraform.tfstate*"] }, Null = { "dynamodb:LeadingKeys" = "false" } }
      },
      {
        Sid      = "DescribeLockTable", Effect = "Allow", Action = ["dynamodb:DescribeTable"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.lock_table}"
      }
    ]
  })
}

resource "aws_ecr_repository_policy" "lambda" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaImageRetrieval", Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
      Condition = { ArnLike = { "aws:SourceArn" = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:webfortune-prod" } }
    }]
  })
}

output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "runtime_role_arn" { value = aws_iam_role.runtime.arn }
output "repository_url" { value = aws_ecr_repository.app.repository_url }
output "api_id" { value = aws_apigatewayv2_api.app.id }
output "api_url" { value = aws_apigatewayv2_api.app.api_endpoint }
