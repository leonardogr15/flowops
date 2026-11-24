from django.contrib import admin

from .models import WorkflowTemplate


@admin.register(WorkflowTemplate)
class WorkflowTemplateAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name", "category", "organization", "updated_at")
    list_filter = ("category",)
    search_fields = ("name",)
