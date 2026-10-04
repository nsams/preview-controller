/**
 * Posts to the login route of the controller like its login page does. It is a plain form on
 * purpose: the answer sets the session cookie and redirects back here.
 */
export function LoginForm() {
    return (
        <div className="card">
            <p>This environment is password protected.</p>
            <form method="post" action="/__preview-controller/login">
                <input type="hidden" name="redirectTo" value={window.location.pathname + window.location.search} />
                <input type="password" name="password" placeholder="Password" autoFocus autoComplete="current-password" />
                <button type="submit">Sign in</button>
            </form>
        </div>
    );
}
