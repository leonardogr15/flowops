from django.contrib import admin

from .models import Membership, Organization


class MembershipInline(admin.TabularInline):  # type: ignore[type-arg]
    model = Membership
    extra = 0
    raw_id_fields = ("user",)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name", "slug", "created_at")
    search_fields = ("name", "slug")
    inlines = (MembershipInline,)
