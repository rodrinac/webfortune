const value = process.env.VITE_API_URL;
if (!value)
  throw new Error(
    "VITE_API_URL is required for production builds. Set it to the Terraform api_url output.",
  );
const url = new URL(value);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  /^(localhost|127\.|\[::1\])/.test(url.hostname)
) {
  throw new Error(
    "VITE_API_URL must be a public HTTPS API URL without credentials, query, or fragment.",
  );
}
