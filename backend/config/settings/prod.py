from .base import *  # noqa: F403
from .base import env, env_bool

DEBUG = False
# Production must choose a real mail backend; the console default would write invitation links to logs.
MAILERS = {"default": {"BACKEND": env("EMAIL_BACKEND")}}
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SSL_REDIRECT", False)
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30 if SECURE_SSL_REDIRECT else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_SSL_REDIRECT
