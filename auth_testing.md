# Custom JWT authentication QA checklist

1. Verify stored password hashes start with `$2b$` and required MongoDB indexes exist.
2. Verify login returns access and refresh tokens as secure httpOnly cookies; `/auth/me` accepts cookies.
3. Verify CORS uses an explicit frontend origin with credentials enabled.
4. Verify five failed attempts trigger a temporary lockout and successful login clears attempts.
5. Verify startup seed creates a missing admin and updates an existing admin hash when the configured password changes.
6. Verify bearer-token fallback, logout cookie deletion, token expiry/type checks, and password reset token TTL.
