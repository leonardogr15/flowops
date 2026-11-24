# 0004. Invitations and owner protection

- Status: Accepted
- Date: 2026-11-24

## Context

Organizations grow by invitation; there is no public sign-up. An invitation link is a credential:
whoever holds it can join with the invited role. Organizations must also never end up without an
owner, even when two owners change roles at the same moment.

## Decision

- **Token:** 256 bits from `secrets.token_urlsafe(32)`. Only its SHA-256 hash is stored, so a database
  leak does not reveal usable links. The raw link is emailed and shown once to the inviter.
- **Binding:** an invitation can be accepted only by the invited email address. A signed-in user with
  another address gets 403; an anonymous visitor whose email already has an account must sign in.
- **Lifetime:** single use, 7-day expiry, and re-inviting the same address revokes the previous link.
  Unknown, expired, revoked and used links all return the same 404.
- **Roles:** the owner role is never granted by invitation; nobody can invite above their own role.
- **Owner protection:** role changes and removals lock all owner rows (`SELECT … FOR UPDATE`, ordered
  by primary key) and re-read the acting member before checking permissions. The last owner can't be
  demoted or removed (409).
- **Error order:** objects are looked up within the active organization before role checks, so ids
  from another organization always return 404 (ADR-0001).

## Alternatives considered

- **Signed, stateless tokens (e.g. JWT):** no table needed, but they can't be revoked or made single-use
  without storing state anyway.
- **Optimistic checks without locks:** simpler, but two concurrent demotions could both see "another
  owner exists" and leave none. A concurrency test reproduces this scenario against PostgreSQL.

## Consequences

- Invitation acceptance creates the account and signs it in; password rules are Django's validators.
- Email delivery uses Django's `MAILERS` setting (console in the local demo); a failed send keeps the
  invitation valid and the inviter can share the link instead.
