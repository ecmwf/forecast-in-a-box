import { useEffect } from "react";

import { showNotification } from "@mantine/notifications";

const OidcCallback = () => {
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get("error");

        if (error) {
            console.error("OIDC Error:", urlParams.get('error_description'));
            showNotification({
                color: 'red',
                message: `OIDC Error`
            });
            return;
        }
        const code = urlParams.get("code");
        const state = urlParams.get("state");

        fetch(`/api/v1/auth/oidc/callback?code=${code}&state=${state}`)
            .then(res => res.json())
            .then(data => {
                localStorage.setItem("fiabtoken", data.access_token);
                // redirect to app home
                window.location.href = "/";
            }).catch(err => {
                console.error("Error during OIDC callback:", err);
                showNotification({
                    color: 'red',
                    message: 'Error during OIDC callback'
                });
            });
    }, []);

    return null;
};

export default OidcCallback;
