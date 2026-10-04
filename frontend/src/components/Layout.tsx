import AppBar from "@mui/material/AppBar";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Toolbar from "@mui/material/Toolbar";
import { Outlet } from "react-router";

export function Layout() {
    return (
        <>
            <AppBar position="static" elevation={0}>
                <Toolbar variant="dense">
                    <Link href="/" color="inherit" underline="none" variant="h6">
                        Preview Controller
                    </Link>
                </Toolbar>
            </AppBar>
            <Container maxWidth="lg" sx={{ py: 3 }}>
                <Outlet />
            </Container>
        </>
    );
}
