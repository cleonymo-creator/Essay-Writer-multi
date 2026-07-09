# Teacher & Admin Accounts

Teacher access is **not** a shared password in a config file (that legacy model,
including the old `teacher123` default, has been removed). Teachers and admins
have individual accounts stored in Firestore, authenticated with per-user
PBKDF2 password hashes and session tokens, handled by
`netlify/functions/teacher-auth.js`.

## Creating the first admin

On a fresh deployment with no teacher accounts yet, the **first account you
register becomes the initial admin** — the sign-up flow allows the very first
teacher to be created without existing credentials. After that, creating new
teachers requires an existing admin session.

1. Open the app and go to the teacher area (teacher login / sign-up).
2. Register with your name, email, and a password (**minimum 8 characters**).
3. This first account is created as an admin.

## Adding more teachers

Once at least one account exists, new teachers can only be created by a
logged-in admin (via the Teacher Management panel in the dashboard). Roles:

- **admin** — full access, including managing other teachers and all classes.
- **teacher** — scoped to their own students and classes.

## Passwords & reset

- Passwords are hashed (PBKDF2, per-user salt) and never stored in plaintext.
- Password reset is handled through Firebase Authentication (reset emails), with
  the `send-password-reset` function. Admins can also trigger resets for teachers
  and students from the dashboard.
- There is **no** environment-variable or config-file password, and no
  `?auth=` query-param bypass — every teacher/admin endpoint requires a valid
  session token.

## Accessing the dashboard

1. Go to the app URL and choose teacher login.
2. Sign in with your account email and password.
3. You land on the dashboard (submissions, in-progress tracking, students,
   classes, essays, and — for admins — teacher management).

## Security notes

- All teacher/admin actions are verified server-side against a session token;
  the client UI is never the authorization boundary.
- Session tokens live in the `teacherSessions` Firestore collection, which the
  browser cannot read directly (see `firestore.rules`).
