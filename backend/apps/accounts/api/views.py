from __future__ import annotations

from typing import cast

from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import User
from ..throttles import LoginRateThrottle
from .serializers import LoginSerializer, UserSerializer

CsrfResponse = inline_serializer("CsrfResponse", {"csrfToken": serializers.CharField()})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie so the SPA can send X-CSRFToken on unsafe requests."""

    permission_classes = [permissions.AllowAny]
    tenant_scoped = False

    @extend_schema(responses=CsrfResponse, operation_id="auth_csrf")
    def get(self, request: Request) -> Response:
        return Response({"csrfToken": get_token(request._request)})


@method_decorator(csrf_protect, name="dispatch")  # DRF skips CSRF for anonymous users; login must not
class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]
    tenant_scoped = False

    @extend_schema(request=LoginSerializer, responses={200: UserSerializer}, operation_id="auth_login")
    def post(self, request: Request) -> Response:
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(
            request._request, username=data.validated_data["email"], password=data.validated_data["password"]
        )
        if user is None:  # same message for unknown email, wrong password and inactive user
            raise AuthenticationFailed("Invalid email or password.")
        login(request._request, user)  # rotates the session key (prevents fixation)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    tenant_scoped = False

    @extend_schema(request=None, responses={204: None}, operation_id="auth_logout")
    def post(self, request: Request) -> Response:
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    tenant_scoped = False

    @extend_schema(responses=UserSerializer, operation_id="auth_me")
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(cast(User, request.user)).data)
