import { Button } from "@dextinity/admin";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * Shown when the api answers 401. Loading the page again is all it takes: the controller sends a
 * browser without a session to the sign-in of oauth2-proxy, which leads back here.
 */
export function SessionExpired() {
    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <Typography>The session has expired.</Typography>
                <Button onClick={() => window.location.reload()}>Sign in again</Button>
            </Stack>
        </Paper>
    );
}
