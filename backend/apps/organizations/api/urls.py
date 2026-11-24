from django.urls import path

from .people import (
    AcceptInvitationView,
    InvitationDetailView,
    InvitationPreviewView,
    InvitationsView,
    MemberDetailView,
)
from .views import CurrentOrganizationView, MembersView, MyOrganizationsView

urlpatterns = [
    path("organizations", MyOrganizationsView.as_view(), name="my-organizations"),
    path("org", CurrentOrganizationView.as_view(), name="current-organization"),
    path("org/members", MembersView.as_view(), name="org-members"),
    path("org/members/<uuid:pk>", MemberDetailView.as_view(), name="org-member-detail"),
    path("org/invitations", InvitationsView.as_view(), name="org-invitations"),
    path("org/invitations/<uuid:pk>", InvitationDetailView.as_view(), name="org-invitation-detail"),
    path("invitations/<str:token>", InvitationPreviewView.as_view(), name="invitation-preview"),
    path("invitations/<str:token>/accept", AcceptInvitationView.as_view(), name="invitation-accept"),
]
