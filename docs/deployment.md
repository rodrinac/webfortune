# AWS + GitHub Pages deployment

## Architecture

GitHub Pages → API Gateway HTTP API → Lambda container → `fortune`.

The static UI renders the returned text as cowsay-style ASCII art in the browser. AWS hosts the existing Rust HTTP server with Lambda Web Adapter. HTTP API provides CORS for exactly `https://rodrinac.github.io`, plus throttling at 10 requests/second with a burst of 20. Throttling is best-effort, not a spending cap. There is no database, VPC, NAT gateway, or always-running server. Lambda uses 256 MB and a 10-second timeout; CloudWatch log retention is 14 days. AWS usage and ECR image storage are billable.

## One-time bootstrap

Use the same AWS account and `eu-west-1` region as cinemaclub. The account must already have the GitHub OIDC provider, S3 state bucket, and DynamoDB lock table used by that project.

`infra/bootstrap` owns the ECR repository, HTTP API with CORS, runtime role, and a separate GitHub deployment role. The runtime role can only write its own logs. The deployment role can publish to the webfortune repository, manage the named function and its logs, pass only its runtime role, configure only its HTTP API, and access only its service state/locks. CI cannot change IAM or read cinemaclub state. Bootstrap changes require a local administrator.

```sh
aws login --region eu-west-1
node scripts/terraform-local.mjs -chdir=infra/bootstrap init \
  -backend-config=bucket=cinemaclub-tfstate-118462784293-euw1 \
  -backend-config=key=webfortune/bootstrap/terraform.tfstate \
  -backend-config=region=eu-west-1 \
  -backend-config=dynamodb_table=cinemaclub-tf-locks \
  -backend-config=encrypt=true
node scripts/terraform-local.mjs -chdir=infra/bootstrap plan \
  -var=state_bucket=cinemaclub-tfstate-118462784293-euw1 \
  -var=lock_table=cinemaclub-tf-locks -out=bootstrap.tfplan
node scripts/terraform-local.mjs -chdir=infra/bootstrap apply bootstrap.tfplan
```

The local helper passes temporary `aws login` credentials directly into Terraform's process environment because AWS provider 5.x predates this credential source. It never writes credentials to disk or logs. GitHub Actions uses OIDC directly.

Two separate remote state keys are used:

- `webfortune/bootstrap/terraform.tfstate`: administrator-managed bootstrap resources.
- `webfortune/prod/terraform.tfstate`: application resources managed by CI.

Never reuse cinemaclub's state key or destroy its shared bucket/lock table. DynamoDB locking matches the existing project; Terraform reports it as deprecated in favor of S3 lockfiles, so migrate both projects deliberately in a separate change.

## GitHub settings

Create the `production` environment with deployment branches restricted to `main`. Configure its secret `AWS_ROLE_TO_ASSUME` from bootstrap output `deploy_role_arn`.

Set these production environment variables:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | `eu-west-1` |
| `API_ID` | bootstrap `api_id` |
| `RUNTIME_ROLE_ARN` | bootstrap `runtime_role_arn` |
| `ECR_REPOSITORY_URL` | bootstrap `repository_url` |
| `TF_STATE_BUCKET` | `cinemaclub-tfstate-118462784293-euw1` |
| `TF_STATE_LOCK_TABLE` | `cinemaclub-tf-locks` |

Enable GitHub Pages with **GitHub Actions** as the source. The `github-pages` environment should allow only `main`. Merge the deployment workflow into main, or manually dispatch **Deploy production** on main.

The pipeline pins each deployment to its triggering commit. ECR tags are immutable commit SHAs; reruns reuse an existing image. Terraform deploys the image digest, then the Pages build consumes the successful backend job's API URL. The web build requires no AWS permissions and does not read Terraform state.

## Verification and recovery

After a successful deployment, open `https://rodrinac.github.io/webfortune/`. Choose a category, request another fortune, and copy the cow. The pipeline smoke-checks `/health`, random/category fortunes, query validation, unknown routes, method rejection, and CORS headers.

To retry a failed deployment, rerun the failed workflow. If the backend was already updated but Pages failed, the previous UI stays published and remains compatible with the API. If bootstrap variables or permissions changed, apply bootstrap locally before rerunning. Revert a bad application commit with a new commit on main; the normal workflow rebuilds and deploys it. Keep previously deployed ECR digests for recovery; do not expire images still referenced by Lambda.

For failures inspect the workflow logs, `/aws/lambda/webfortune-prod`, and `/aws/apigateway/webfortune-prod`. API Gateway throttling can return 429 during bursts; normal smoke tests intentionally do not expect a deterministic burst cutoff.

To tear down intentionally, destroy the application Terraform stack first with its existing image/role/API variables, then the bootstrap stack. The ECR repository refuses deletion while it contains images. Remove the Pages site separately if retiring the project. Preserve the shared state bucket and lock table.

References: [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter), [Lambda container images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html), [HTTP API CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
