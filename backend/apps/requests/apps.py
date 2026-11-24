from django.apps import AppConfig


class RequestsConfig(AppConfig):
    name = "apps.requests"
    label = "requests"

    def ready(self) -> None:
        from . import receivers  # noqa: F401  (connects signal receivers)
