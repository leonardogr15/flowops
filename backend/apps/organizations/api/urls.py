from django.urls import path

from .views import CurrentOrganizationView, MembersView, MyOrganizationsView

urlpatterns = [
    path("organizations", MyOrganizationsView.as_view(), name="my-organizations"),
    path("org", CurrentOrganizationView.as_view(), name="current-organization"),
    path("org/members", MembersView.as_view(), name="org-members"),
]
