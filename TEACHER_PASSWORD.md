# Teacher Dashboard Access

## Default Password

The default teacher password is: `teacher123`

## Changing the Password

Edit `config/homework.js` and change the `teacherPassword` value:

```javascript
window.HOMEWORK_CONFIG = {
  // ... other config
  teacherPassword: "your-secure-password-here",
  // ... questions
};
```

## Accessing the Dashboard

1. Go to your homework URL
2. Click "Teacher Login" on the main screen
3. Enter the password
4. Or navigate directly to: `your-site.netlify.app/#teacher`

## Dashboard Features

- **Completed Submissions** - View all submitted homework with scores
- **Currently Working** - Real-time view of students in progress
- **Submission Details** - Click any submission to see full answers and AI feedback
- **AI Overview** - Select multiple submissions and click "AI Overview" for class-wide analysis

## Security Notes

- The password is stored in plain text in the config file
- For higher security, set `TEACHER_PASSWORD` as an environment variable in Netlify
- The dashboard is protected by password, but submissions are stored server-side

## Environment Variable Override

You can override the config file password by setting an environment variable:

1. Go to Netlify → Site settings → Environment variables
2. Add: `TEACHER_PASSWORD` = `your-password`
3. Redeploy

The environment variable takes precedence over the config file.
