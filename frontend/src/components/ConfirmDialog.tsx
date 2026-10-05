import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

export function ConfirmDialog({
    open,
    title,
    text,
    confirmLabel,
    onConfirm,
    onClose,
}: {
    open: boolean;
    title: string;
    text: string;
    confirmLabel: string;
    onConfirm: () => void;
    onClose: () => void;
}) {
    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText>{text}</DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    color="error"
                    variant="contained"
                    onClick={() => {
                        onClose();
                        onConfirm();
                    }}
                >
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
