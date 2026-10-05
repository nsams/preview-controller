import { Button } from "@dextinity/admin";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Field } from "./Field.tsx";

/**
 * Posts to the login route of the controller like its login page does. It is a plain form on
 * purpose: the answer sets the session cookie and redirects back here.
 */
export function LoginForm() {
    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography sx={{ mb: 2 }}>The session has expired, this environment is password protected.</Typography>
            <Stack component="form" method="post" action="/__preview-controller/login" direction="row" spacing={2} sx={{ alignItems: "flex-end" }}>
                <input type="hidden" name="redirectTo" value={window.location.pathname + window.location.search} />
                <Field type="password" name="password" label="Password" autoFocus autoComplete="current-password" sx={{ flex: 1 }} />
                <Button type="submit">Sign in</Button>
            </Stack>
        </Paper>
    );
}
