import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * Posts to the login route of the controller like its login page does. It is a plain form on
 * purpose: the answer sets the session cookie and redirects back here.
 */
export function LoginForm() {
    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography sx={{ mb: 2 }}>The session has expired, this environment is password protected.</Typography>
            <Stack component="form" method="post" action="/__preview-controller/login" direction="row" spacing={1}>
                <input type="hidden" name="redirectTo" value={window.location.pathname + window.location.search} />
                <TextField type="password" name="password" label="Password" size="small" autoFocus autoComplete="current-password" sx={{ flex: 1 }} />
                <Button type="submit" variant="contained">
                    Sign in
                </Button>
            </Stack>
        </Paper>
    );
}
