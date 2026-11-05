const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pixel-office · sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #1b1d2b;
    background-image: linear-gradient(#232638 2px, transparent 2px), linear-gradient(90deg, #232638 2px, transparent 2px);
    background-size: 32px 32px;
    font: 16px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #e8e6d9;
  }
  form {
    width: min(340px, 90vw); padding: 28px; background: #2b2e45;
    border: 4px solid #0f1020; box-shadow: 8px 8px 0 #0f1020; image-rendering: pixelated;
  }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: 1px; }
  h1 span { color: #f4b860; }
  p { margin: 0 0 20px; color: #a9a7c4; font-size: 13px; }
  label { display: block; font-size: 13px; margin-bottom: 6px; color: #a9a7c4; }
  input {
    width: 100%; padding: 10px; font: inherit; color: inherit;
    background: #1b1d2b; border: 3px solid #0f1020; outline: none;
  }
  input:focus { border-color: #f4b860; }
  button {
    margin-top: 16px; width: 100%; padding: 10px; font: inherit; font-weight: bold; cursor: pointer;
    color: #1b1d2b; background: #f4b860; border: 3px solid #0f1020; box-shadow: 4px 4px 0 #0f1020;
  }
  button:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 #0f1020; }
  .forms { display: grid; gap: 18px; justify-items: center; }
  .tv input { text-align: center; font-size: 22px; letter-spacing: 6px; text-transform: lowercase; }
  .err { margin: 0 0 14px; padding: 8px; background: #5b2333; border: 3px solid #0f1020; color: #ffd6dc; font-size: 13px; }
</style>
</head>
<body>
<div class="forms">
<form method="post" action="/login">
  <h1>pixel<span>-office</span></h1>
  <p>Sign in to watch your agents work.</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <label for="password">Password or admin token</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Enter the office</button>
</form>
<form method="post" action="/tv" class="tv">
  <label for="code">Setting up a TV? Enter its code</label>
  <input id="code" name="code" placeholder="abc-def" maxlength="9" autocomplete="off" autocapitalize="off" spellcheck="false" required>
  <button type="submit">Show the office</button>
</form>
</div>
</body>
</html>`;
}
