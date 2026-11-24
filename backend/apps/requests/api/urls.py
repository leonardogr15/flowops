from django.urls import path

from .views import (
    ApproveView,
    CancelView,
    CommentsView,
    DuplicateView,
    InboxView,
    RejectView,
    RequestDetailView,
    RequestsView,
    SubmitView,
    TimelineView,
)

urlpatterns = [
    path("org/requests", RequestsView.as_view(), name="requests"),
    path("org/requests/<uuid:pk>", RequestDetailView.as_view(), name="request-detail"),
    path("org/requests/<uuid:pk>/submit", SubmitView.as_view(), name="request-submit"),
    path("org/requests/<uuid:pk>/cancel", CancelView.as_view(), name="request-cancel"),
    path("org/requests/<uuid:pk>/approve", ApproveView.as_view(), name="request-approve"),
    path("org/requests/<uuid:pk>/reject", RejectView.as_view(), name="request-reject"),
    path("org/requests/<uuid:pk>/duplicate", DuplicateView.as_view(), name="request-duplicate"),
    path("org/requests/<uuid:pk>/comments", CommentsView.as_view(), name="request-comments"),
    path("org/requests/<uuid:pk>/timeline", TimelineView.as_view(), name="request-timeline"),
    path("org/inbox", InboxView.as_view(), name="inbox"),
]
