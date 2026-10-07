# Copy to .env next to this file, which is not committed. Everything else is in oauth2-proxy.cfg.

# The one callback url, always on the base domain - register exactly this one with the provider.
# Sign-ins that start on a preview come back here and are then sent on to the preview.
OAUTH2_PROXY_REDIRECT_URL=https://preview.example.com/__oauth2/callback

# The leading dot is what makes the session valid for every preview host below the base domain,
# and lets oauth2-proxy send the browser back to them after the sign-in. With a port in the public
# url (local setups), the whitelist needs it too: .preview.localhost:9000
OAUTH2_PROXY_COOKIE_DOMAINS=.preview.example.com
OAUTH2_PROXY_WHITELIST_DOMAINS=.preview.example.com

# false only for plain http, e.g. locally
OAUTH2_PROXY_COOKIE_SECURE=true

# Any provider of oauth2-proxy works, see https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/
# For GitHub: an OAuth app with the callback url above, restricted to the members of an organization.
OAUTH2_PROXY_PROVIDER=github
OAUTH2_PROXY_GITHUB_ORG=vivid-planet
OAUTH2_PROXY_CLIENT_ID=""
OAUTH2_PROXY_CLIENT_SECRET=""

# 32 random bytes: openssl rand -base64 32 | tr -- '+/' '-_'
OAUTH2_PROXY_COOKIE_SECRET=""
