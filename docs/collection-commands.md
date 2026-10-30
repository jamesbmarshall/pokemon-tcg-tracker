# Authorized collection commands

U10a extracts `executeCollectionCommand` from the existing Fastify `mutate`
adapter. The executor receives a trusted actor, collection, retry key, request
digest and expected revision. It returns the native result, committed revision
and replay flag. It checks current membership before replaying a receipt; a
revoked editor cannot retrieve a previous result through this boundary.

The executor owns the synchronous SQLite transaction. The native writer, revision
increment and durable receipt commit or roll back together. Provider requests,
upload decoding and other asynchronous preparation belong outside the transaction.
The write-protocol floor and storage checks still precede new writes. Native
writers remain authoritative; this extraction does not change their validation,
data formats or SQL.

`mutate` remains the HTTP adapter used by current routes. It obtains the actor
from the authenticated request, preserves the existing request digest, derives
the narrowly scoped collection-deletion and self-leave exceptions from the route,
and writes ETag/replay response headers. CSRF enforcement remains in existing
HTTP hooks. The executor is an internal service, not an authentication mechanism:
never populate its context from a submitted JSON body or a share token.

U10b must introduce operation-specific services for both storage implementations,
including game scope, validation, entries, wishlist, notes, graded/sealed items
and lists. This executor alone does not establish command or API parity. U11 will
route shared and compatibility APIs through those services after parity tests.
