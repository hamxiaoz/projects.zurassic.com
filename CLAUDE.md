# Claude Rules — projects.zurassic.com

This is a **public GitHub repository**. Apply the following rules at all times:

## Security & Privacy

- Never commit or expose local file system paths (e.g. `/Users/...`, `/home/...`)
- Never commit or expose usernames, email addresses, or any personal identifiers
- Never commit credentials, API keys, tokens, or secrets of any kind
- Never commit `.env` files or any config containing sensitive values
- Before committing, check that no personal or sensitive information is included in file contents or commit messages
- If a file might contain sensitive info, read it and verify before staging it

## What's safe to reference publicly

- The GitHub repo: `hamxiaoz/projects.zurassic.com`
- The domain: `projects.zurassic.com`
- The Vercel project name: `projects.zurassic.com`

## Google Analytics

All projects in this repo use GA4 measurement ID `G-HK044STX6K`.
Every new project's HTML file must include the gtag snippet in `<head>`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-HK044STX6K"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-HK044STX6K');
</script>
```
