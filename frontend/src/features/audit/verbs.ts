/** Plain-language names for audit verbs (FE-07). The technical verb stays available as secondary text. */
export const VERB_LABEL: Record<string, string> = {
  "request.created": "Created the draft",
  "request.updated": "Edited the draft",
  "request.submitted": "Submitted for approval",
  "task.approved": "Approved a step",
  "task.rejected": "Rejected a step",
  "request.approved": "Request approved",
  "request.rejected": "Request rejected",
  "request.cancelled": "Cancelled the request",
  "comment.added": "Commented",
  "invitation.sent": "Sent an invitation",
  "invitation.revoked": "Revoked an invitation",
  "invitation.accepted": "Accepted an invitation",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "member.left": "Left the organization",
  "template.created": "Created a workflow",
  "template.updated": "Renamed or described a workflow",
  "template.draft_saved": "Saved a workflow draft",
  "template.published": "Published a workflow",
};

export function verbLabel(verb: string): string {
  return VERB_LABEL[verb] ?? verb;
}
