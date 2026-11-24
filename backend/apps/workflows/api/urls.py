from django.urls import path

from .views import TemplateDetailView, TemplateDraftView, TemplatePublishView, TemplatesView

urlpatterns = [
    path("org/workflow-templates", TemplatesView.as_view(), name="workflow-templates"),
    path("org/workflow-templates/<uuid:pk>", TemplateDetailView.as_view(), name="workflow-template-detail"),
    path(
        "org/workflow-templates/<uuid:pk>/draft", TemplateDraftView.as_view(), name="workflow-template-draft"
    ),
    path(
        "org/workflow-templates/<uuid:pk>/publish",
        TemplatePublishView.as_view(),
        name="workflow-template-publish",
    ),
]
